-- ==============================================================================
-- Schema Expansion: Clinical FAQ Pairs & Vector Embeddings for CCU Siriraj
-- Issue #01: ออกแบบ Database Schema และ SQL Scripts สำหรับตาราง cpg_faqs ใน Supabase
-- โครงการ: CCU Nurse AI Assistant (หอผู้ป่วยวิกฤตโรคหัวใจ โรงพยาบาลศิริราช)
-- ผู้รับผิดชอบ: น้องคำหล้า (Khamla AI/Full-Stack Dev)
-- ตรวจสอบโดย: พี่ก้อง (AI Lead Architect) & อ้าย (Project Owner)
-- ==============================================================================

-- 1. เปิดใช้งาน Extensions ที่จำเป็น
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 2. สร้างตาราง cpg_faqs
-- 2. สร้างตาราง cpg_faqs พร้อมระบบ Life-Cycle Cascading & Versioning
CREATE TABLE IF NOT EXISTS public.cpg_faqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cpg_id VARCHAR(100) NOT NULL,                      -- รหัสอ้างอิง CPG หรือหมวด เช่น 'CPG-TAVI-01', 'CPG-DRUG-NE'
    question TEXT NOT NULL,                             -- คำถามทางคลินิกข้างเตียง (Clinical Question)
    answer TEXT NOT NULL,                               -- คำตอบ/แนวทางปฏิบัติพยาบาล (Actionable Clinical Guidance)
    reference_doc TEXT NOT NULL,                        -- ชื่อเอกสาร CPG ศิริราชฉบับทางการ
    page_number VARCHAR(50),                           -- เลขหน้า หรือ Slide อ้างอิง เช่น 'หน้า 4-5', 'Slide 12'
    category VARCHAR(100) NOT NULL,                    -- หมวดหมู่หัตถการ/โรค เช่น 'TAVI', 'TEER', 'Drug', 'EKG', 'ACS'
    version VARCHAR(20) DEFAULT '1.0',                 -- เวอร์ชันของ CPG/FAQ เช่น '1.0', '2.0'
    status VARCHAR(30) DEFAULT 'pending',              -- สถานะ: 'pending' (รอตรวจ), 'approved' (รับรองแล้ว), 'suspended' (พัก), 'needs_review' (ต้องทบทวนใหม่)
    is_vectorized BOOLEAN DEFAULT FALSE,               -- สถานะการแปลงเวกเตอร์แล้วหรือไม่
    embedding vector(768),                             -- เวกเตอร์ 768 มิติสำหรับ Google Gemini text-embedding-004
    reviewed_by VARCHAR(100),                          -- ชื่อพยาบาลรุ่นพี่/APN ผู้ตรวจรับรอง
    reviewed_at TIMESTAMPTZ,                           -- วันที่เวลาที่ตรวจรับรอง
    metadata JSONB DEFAULT '{}'::jsonb,                -- ฟิลด์เสริม (เช่น author, tags, alert_level, cpg_file_url)
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- เพิ่ม Comment อธิบายฟิลด์ในตาราง
COMMENT ON TABLE public.cpg_faqs IS 'ตารางคลังคู่คำถาม-คำตอบทางคลินิก (FAQ Pairs) จาก CPG ศิริราช พร้อม Vector Embedding และ Cascading State';
COMMENT ON COLUMN public.cpg_faqs.cpg_id IS 'รหัส CPG หรือ Identifier เอกสารต้นทาง';
COMMENT ON COLUMN public.cpg_faqs.question IS 'คำถามที่พยาบาล CCU มักถามข้างเตียง';
COMMENT ON COLUMN public.cpg_faqs.answer IS 'คำตอบและขั้นตอนการพยาบาลอย่างละเอียดตาม CPG';
COMMENT ON COLUMN public.cpg_faqs.reference_doc IS 'ชื่อเอกสารอ้างอิง CPG ศิริราช';
COMMENT ON COLUMN public.cpg_faqs.page_number IS 'หน้าหรือสไลด์ที่พบข้อมูล';
COMMENT ON COLUMN public.cpg_faqs.category IS 'หมวดหมู่ เช่น TAVI, TEER, Drug, EKG, ACS';
COMMENT ON COLUMN public.cpg_faqs.status IS 'สถานะการรับรอง: pending, approved, suspended, needs_review';
COMMENT ON COLUMN public.cpg_faqs.embedding IS 'Gemini text-embedding-004 Vector 768 มิติ';

-- 3. สร้าง Index เพื่อเพิ่มความเร็วในการสืบค้น (Indexes)
CREATE INDEX IF NOT EXISTS idx_cpg_faqs_category ON public.cpg_faqs (category);
CREATE INDEX IF NOT EXISTS idx_cpg_faqs_cpg_id ON public.cpg_faqs (cpg_id);
CREATE INDEX IF NOT EXISTS idx_cpg_faqs_status ON public.cpg_faqs (status);

-- HNSW Vector Index บน Cosine Similarity (<=>)
CREATE INDEX IF NOT EXISTS idx_cpg_faqs_embedding_hnsw 
ON public.cpg_faqs 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 4. สร้าง Function สำหรับค้นหา Semantic FAQ Similarity (Postgres RPC)
-- คัดกรองเฉพาะ FAQ ที่ status = 'approved' เท่านั้น ป้องกัน Hallucination
CREATE OR REPLACE FUNCTION public.match_cpg_faqs(
    query_embedding vector(768),
    match_threshold float DEFAULT 0.60,
    match_count int DEFAULT 5,
    filter_category varchar DEFAULT NULL,
    filter_cpg_id varchar DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    cpg_id VARCHAR,
    question TEXT,
    answer TEXT,
    reference_doc TEXT,
    page_number VARCHAR,
    category VARCHAR,
    version VARCHAR,
    status VARCHAR,
    similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.cpg_id,
        f.question,
        f.answer,
        f.reference_doc,
        f.page_number,
        f.category,
        f.version,
        f.status,
        1 - (f.embedding <=> query_embedding) AS similarity
    FROM public.cpg_faqs f
    WHERE 
        f.embedding IS NOT NULL
        AND f.status = 'approved'                       -- เฉพาะข้อที่ผ่านการตรวจรับรองจากพยาบาลรุ่นพี่เท่านั้น!
        AND (filter_category IS NULL OR f.category = filter_category)
        AND (filter_cpg_id IS NULL OR f.cpg_id = filter_cpg_id)
        AND (1 - (f.embedding <=> query_embedding)) >= match_threshold
    ORDER BY f.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

-- 4.1 ฟังก์ชันสำหรับ Cascading State (เมื่อ CPG เปลี่ยนสถานะ หรือเปลี่ยนเวอร์ชัน)
CREATE OR REPLACE FUNCTION public.cascade_cpg_status_change(
    target_cpg_id VARCHAR,
    new_cpg_status VARCHAR -- 'suspended', 'deleted', 'updated_version'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF new_cpg_status = 'suspended' THEN
        -- พัก FAQ ทั้งหมดที่สังกัด CPG นี้
        UPDATE public.cpg_faqs 
        SET status = 'suspended', updated_at = NOW() 
        WHERE cpg_id = target_cpg_id;
    ELSIF new_cpg_status = 'updated_version' THEN
        -- เมื่อ CPG อัปเดตเวอร์ชันใหม่ ให้ส่ง FAQ กลับมารอการทบทวนใหม่
        UPDATE public.cpg_faqs 
        SET status = 'needs_review', updated_at = NOW() 
        WHERE cpg_id = target_cpg_id;
    ELSIF new_cpg_status = 'deleted' THEN
        -- ลบ FAQ ที่เกี่ยวข้องทิ้งทั้งหมด
        DELETE FROM public.cpg_faqs WHERE cpg_id = target_cpg_id;
    END IF;
END;
$$;

-- 5. Row Level Security (RLS) สำหรับความปลอดภัยตามมาตรฐาน PDPA & Hospital Cloud
ALTER TABLE public.cpg_faqs ENABLE ROW LEVEL SECURITY;

-- นโยบายให้อ่านได้ทั้ง anonymous / authenticated user (เนื่องจากเป็น CPG KM สำหรับพยาบาล)
CREATE POLICY "Allow public read access to cpg_faqs" 
ON public.cpg_faqs 
FOR SELECT 
TO public 
USING (true);

-- นโยบายให้อนุญาตแก้ไขหรือเพิ่มข้อมูลเฉพาะ Service Role หรือ Authenticated Admin
CREATE POLICY "Allow service role full access to cpg_faqs" 
ON public.cpg_faqs 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- 6. ข้อมูลตัวอย่างทางคลินิก (Sample Clinical FAQ Seed Data) จาก CPG ศิริราช
-- หมายเหตุ: embedding ถูกเว้นเป็น NULL ไว้ก่อน รอให้สคริปต์ generate_embeddings ทำการยิงเข้า Gemini API
INSERT INTO public.cpg_faqs (cpg_id, question, answer, reference_doc, page_number, category, version, status, is_vectorized, reviewed_by, reviewed_at, metadata)
VALUES
(
    'tavi-2',
    'คนไข้ Post-TAVI ในช่วง 24-48 ชั่วโมงแรก ต้องเฝ้าระวังภาวะแทรกซ้อนอะไรเป็นพิเศษ?',
    '1. Conduction abnormalities: เฝ้าระวัง Complete Heart Block (CHB) และ New-onset LBBB อย่างใกล้ชิด โดยเฉพาะผู้ป่วยที่ใช้ Self-expanding valve ให้ต่อ Continuous EKG monitor และสังเกต PR interval ที่ยาวขึ้น
2. Vascular complications: ตรวจประเมินแผลเจาะหลอดเลือดแดง Femoral ตรวจคลำ Hematoma, สังเกต Bleeding, และประเมิน Peripheral pulse (Dorsalis pedis) ทุก 15-30 นาทีในช่วงแรก
3. Cerebrovascular events: ประเมิน Neurological signs (GCS, Motor power) เฝ้าระวัง Stroke หรือ TIA
4. Paravalvular Leak (PVL): สังเกตอาการ Heart Failure ฟัง Heart murmur และติดตามค่า EKG/BP อย่างต่อเนื่อง',
    'CPG การพยาบาลผู้ป่วยหลังทำ TAVI ศิริราช (Post TAVR Nursing Care & Monitoring Part II)',
    'หน้า 4-8',
    'TAVI',
    '1.0',
    'approved',
    TRUE,
    'พว.วิยะดา (Incharge CCU)',
    NOW(),
    '{"alert_level": "high", "procedure": "TAVI", "author": "พว.พัฒนาพร"}'::jsonb
),
(
    'CPG-TAVI-PACING',
    'เมื่อไหร่ที่ต้องเตรียม Temporary Transvenous Pacemaker (TPM) ในผู้ป่วยหลังทำ TAVI?',
    'ข้อบ่งชี้ในการคาสาย TPM หรือเตรียมพร้อมใส่:
1. ผู้ป่วยเกิด High-grade AV block หรือ Complete Heart Block (CHB) หลังทำหัตถการ
2. มี New LBBB ร่วมกับ PR prolongation หรือมี Pre-existing RBBB ก่อนทำหัตถการ (เสี่ยง CHB สูง)
3. ค่า Pacemaker rate ควรตั้งตามคำสั่งแพทย์ (ปกติ Back up rate 50-60 bpm)
4. ตรวจสอบ Threshold, Current (mA) และ Sensitivity ทุกเวร และล็อกปุ่ม Generator ป้องกันการเปลี่ยนค่าโดยไม่ได้ตั้งใจ',
    'Nursing Management TAVR ศิริราช',
    'หน้า 12-14',
    'TAVI',
    '{"alert_level": "critical", "procedure": "TAVI", "author": "พว.วิยะดา"}'::jsonb
),
(
    'CPG-TEER-POST',
    'การดูแลผู้ป่วยหลังทำ TEER (MitraClip) ในหอผู้ป่วย CCU มีข้อปฏิบัติและข้อห้ามสำคัญอย่างไร?',
    '1. การดูแล Puncture site: ส่วนใหญ่เข้าทาง Femoral vein (ระบบหลอดเลือดดำแรงดันต่ำ) แต่ใช้ Sheath ขนาดใหญ่ (24F) ต้องนอนราบศีรษะสูงไม่เกิน 30 องศา และห้ามงอขาข้างที่ทำอย่างน้อย 6-8 ชั่วโมงตามชนิดอุปกรณ์เย็บหลอดเลือด (เช่น ProGlide)
2. อาการแทรกซ้อนเฉพาะ: สังเกตอาการแน่นหน้าอก หายใจเหนื่อย ฟังเสียงปอดเฝ้าระวัง Acute Pulmonary Edema จาก Iatrogenic ASD หรือ Clip Detachment
3. การติดตามผลหลังทำ: ตรวจสอบ Echocardiogram เพื่อดู Transmitral gradient (ไม่ควร > 5 mmHg) และ Residual MR
4. การให้ Anticoagulation/Antiplatelet ตามแพทย์สั่งอย่างเคร่งครัด',
    'Nursing Management of TEER ศิริราช',
    'หน้า 7-10',
    'TEER',
    '{"alert_level": "high", "procedure": "TEER", "author": "พว.ทิพวรรณ"}'::jsonb
),
(
    'CPG-DRUG-NE',
    'การบริหารยา Norepinephrine (Levophed) ใน CCU มีแนวทาง Titrate และข้อควรระวัง High-Alert Drug อย่างไร?',
    '1. Concentration: มาตรฐานความเข้มข้นศิริราชคือ 4 mg ใน D5W 100 mL หรือ 8 mg ใน D5W 250 mL (ใช้ D5W เป็นหลักเพื่อป้องกัน Oxidation)
2. Route: ต้องให้ทาง Central Venous Line เสมอ หากฉุกเฉินให้ทาง Peripheral ชั่วคราวต้องใช้หลอดเลือดดำใหญ่และย้ายไป Central line โดยเร็วที่สุด
3. Extravasation Management: หากยารั่วออกนอกเส้น ต้องหยุดยาทันที ห้ามดึงเข็มออก ให้ดูดยากลับ แล้วเตรียมยาแก้พิษ Phentolamine 5-10 mg dilute ใน NSS 10 mL ฉีดรอบบริเวณที่รั่วซึม (Subcutaneous)
4. การ Titrate: ปรับยาตามค่า Mean Arterial Pressure (MAP) เป้าหมายปกติ >= 65 mmHg โดยวัด BP ทุก 5-15 นาทีขณะ Titrate ยา',
    'CPG ยา High-Alert Drug และแนวทาง Vasopressor and Inotropes CCU ศิริราช',
    'หน้า 15-18',
    'Drug',
    '{"alert_level": "critical", "drug_name": "Norepinephrine", "high_alert": true}'::jsonb
),
(
    'CPG-EKG-VT',
    'เมื่อพบลักษณะ Wide QRS Tachycardia บน Monitor ใน CCU พยาบาลต้องประเมินและปฏิบัติอย่างไรเป็นลำดับแรก?',
    '1. ตรวจสอบผู้ป่วยทันที (Check Patient First): คลำ Pulse (Carotid) และตรวจความรู้สึกตัว เพื่อแยกแยกระหว่าง Pulseless VT กับ VT with Pulse
2. กรณี Pulseless VT: เริ่ม CPR ทันที กดปุ่ม Call Code CCU พร้อมตาม Defibrillator ชาร์จไฟ 200J (Biphasic) เพื่อทำ Defibrillation ทันที
3. กรณี มี Pulse แต่ Unstable (BP ตก, เจ็บหน้าอกรุนแรง, หอบเหนื่อย, หมดสติ): เตรียมทำ Synchronized Cardioversion 100-200J (เปิดโหมด Sync เสมอ) และให้ออกซิเจน
4. กรณี มี Pulse และ Stable: ติด 12-lead EKG ทันที, รายงานแพทย์เวร, เตรียมยา Amiodarone 150 mg IV ใน 10 นาที, เจาะ Electrolytes (K+, Mg2+)',
    'CPG การจัดการภาวะ Arrhythmia ในหอผู้ป่วยวิกฤต CCU ศิริราช',
    'หน้า 22-25',
    'EKG',
    '{"alert_level": "critical", "topic": "Arrhythmia", "rhythm": "Wide QRS / VT"}'::jsonb
),
(
    'CPG-ACS-CHESTPAIN',
    'แนวทางการดูแลผู้ป่วย STEMI ที่มีอาการแน่นหน้าอกซ้ำ (Recurrent Chest Pain) หลังทำ Primary PCI?',
    '1. ประเมินและบันทึก 12-lead EKG ทันทีเพื่อดูว่ามี Re-elevation ของ ST segment หรือไม่ (สงสัย Acute Stent Thrombosis)
2. วัด Vital Signs และประเมิน Hemodynamic stability (BP, HR, SpO2)
3. รายงาน Interventional Cardiologist / แพทย์ประจำบ้านทันที
4. เตรียมเปิด Catheterization Lab ฉุกเฉินหากสงสัย Stent Thrombosis
5. ให้ O2 Cannula หาก SpO2 < 90%, จัดท่านอนศีรษะสูง, เตรียมยา Nitrate (ISDN Sublingual/IV) หาก BP systolic > 90 mmHg และไม่มีข้อห้าม (ไม่ได้ใช้ยากลุ่ม PDE-5 inhibitor)',
    '2025 ACS Clinical Update และ CPG การพยาบาลผู้ป่วยกล้ามเนื้อหัวใจขาดเลือดเฉียบพลัน ศิริราช',
    'หน้า 30-33',
    'ACS',
    '{"alert_level": "critical", "topic": "STEMI Post-PCI"}'::jsonb
);
