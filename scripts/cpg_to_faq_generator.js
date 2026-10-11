/**
 * ==============================================================================
 * CPG-to-FAQ Generator & Review Pipeline for CCU Siriraj
 * Issue #02: สกัดเนื้อหา CPG เป็น FAQ Pairs + Reference Document อัตโนมัติด้วย Gemini API
 * โครงการ: CCU Nurse AI Assistant (หอผู้ป่วยวิกฤตโรคหัวใจ โรงพยาบาลศิริราช)
 * วิศวกรผู้รับผิดชอบ: น้องคำหล้า (Khamla AI/Full-Stack Dev)
 * ตรวจสอบโดย: พี่ก้อง (AI Lead Architect) & อ้าย (Project Owner)
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

// รันแบบ zero external dependency ได้ โดยใช้ fetch ที่ build-in มากับ Node.js v18+
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const EMBEDDING_MODEL = 'text-embedding-004';

/**
 * นิยาม System Prompt อิงตาม CPG Siriraj และนโยบายความปลอดภัยทางการแพทย์
 */
const CPG_EXTRACTION_SYSTEM_PROMPT = `
คุณคือ "AI Medical Knowledge Engineer" ประจำหอผู้ป่วยวิกฤตโรคหัวใจ (CCU) โรงพยาบาลศิริราช
ภารกิจของคุณคือ: อ่านและสกัดเอกสารคู่มือแนวปฏิบัติทางคลินิก (Clinical Practice Guidelines - CPG) ของโรงพยาบาลศิริราช
แล้วแปลงเป็น "คู่คำถาม-คำตอบทางคลินิกข้างเตียง (Bedside Clinical FAQ Pairs)" ที่ถูกต้อง แม่นยำ และปฏิบัติได้ทันที

หลักเกณฑ์สำคัญระดับวิกฤต (Strict Medical Governance):
1. **Zero Hallucination**: สกัดเฉพาะข้อมูลที่มีอยู่จริงในเนื้อหา CPG ที่ได้รับเท่านั้น ห้ามคาดเดา ห้ามเติมแต่งข้อมูลนอกเหนือจากเอกสาร
2. **Actionable Clinical Steps**: คำตอบต้องเป็นขั้นตอนปฏิบัติการพยาบาลที่ชัดเจน (เช่น 1, 2, 3...) ระบุค่าพารามิเตอร์, ขนาดยา, หน่วย, อาการเตือนวิกฤต (Red flags) ให้ครบถ้วน
3. **Strict Reference Grounding**: ต้องระบุชื่อเอกสารอ้างอิง และเลขหน้าหรือ Slide ต้นทางอย่างชัดเจนทุกข้อ
4. **Tone & Audience**: สำหรับพยาบาลวิชาชีพ CCU ใช้ศัพท์การแพทย์ที่ถูกต้องตามมาตรฐานศิริราช (เช่น IABP, TAVI, TEER, CHB, ECMO, High Alert Drugs)

ผลลัพธ์ต้องส่งกลับมาในรูปแบบ JSON Array เท่านั้น ไม่มีข้อความเกริ่นนำหรือ Markdown code block หุ้ม:
[
  {
    "cpg_id": "CPG-หมวด-ลำดับ เช่น CPG-TAVI-01",
    "question": "คำถามที่พยาบาล CCU มักถามข้างเตียงเกี่ยวกับการประเมิน การเฝ้าระวัง หรือการบริหารยา",
    "answer": "คำตอบแนวปฏิบัติที่กระชับ ชัดเจน และมีขั้นตอนปฏิบัติ 1, 2, 3...",
    "reference_doc": "ชื่อเอกสาร CPG ศิริราชฉบับทางการ",
    "page_number": "หน้าหรือ Slide อ้างอิง เช่น หน้า 4-5",
    "category": "หมวดหมู่ เช่น TAVI, TEER, Drug, EKG, ACS, HF, IABP, Pacemaker",
    "metadata": {
      "alert_level": "normal | high | critical",
      "tags": ["tag1", "tag2"]
    }
  }
]
`;

/**
 * เรียก Gemini API เพื่อสกัด CPG Text เป็น FAQ Pairs
 * @param {string} cpgContent เนื้อหาเอกสาร CPG
 * @param {object} docMeta รายละเอียดของเอกสาร เช่น ชื่อเรื่อง หมวดหมู่
 * @returns {Promise<Array>} รายการ FAQ Pairs
 */
async function extractFaqsFromCpg(cpgContent, docMeta = {}) {
  if (!GEMINI_API_KEY) {
    console.warn('⚠️ ไม่พบ GEMINI_API_KEY: จะทำงานใน Mock Extraction Mode สำหรับการทดสอบ');
    return generateMockFaqs(docMeta);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  
  const userPrompt = `
กรุณาสกัดคู่คำถาม-คำตอบ (FAQ Pairs) จากเนื้อหา CPG ศิริราชต่อไปนี้:
ชื่อเอกสาร: ${docMeta.title || 'CPG ศิริราช'}
หมวดหมู่: ${docMeta.category || 'General'}
เล่ม/รหัส: ${docMeta.cpg_id || 'CPG-REF'}

--- เนื้อหาเอกสาร CPG ---
${cpgContent}
-------------------------
ตอบเป็น JSON Array ตามโครงสร้างที่กำหนดเท่านั้น
`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ],
    systemInstruction: {
      parts: [{ text: CPG_EXTRACTION_SYSTEM_PROMPT }]
    },
    generationConfig: {
      temperature: 0.1, // ต่ำมากเพื่อความแน่นอนและลด Hallucination
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('ไม่ได้รับคำตอบจาก Gemini API หรือรูปแบบข้อมูลไม่ถูกต้อง');
  }

  try {
    const cleanedText = rawText.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(cleanedText);
  } catch (err) {
    throw new Error(`ไม่สามารถแปลงผลลัพธ์เป็น JSON ได้: ${err.message}\nRaw: ${rawText}`);
  }
}

/**
 * คำนวณ Embedding Vector ด้วย Gemini text-embedding-004 (768 มิติ)
 * @param {string} text ข้อความคำถามหรือคำตอบ
 * @returns {Promise<number[]>} Vector 768 dimensions
 */
async function generateEmbedding(text) {
  if (!GEMINI_API_KEY) {
    // ส่ง dummy vector 768 มิติสำหรับโหมด offline / test
    return new Array(768).fill(0.001);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const payload = {
    model: `models/${EMBEDDING_MODEL}`,
    content: {
      parts: [{ text: text }]
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data?.embedding?.values || [];
}

/**
 * Mock FAQs สำหรับทดสอบ Local โดยไม่ต้องใช้ API Key
 */
function generateMockFaqs(docMeta) {
  const cat = docMeta.category || 'TAVI';
  return [
    {
      cpg_id: docMeta.cpg_id || 'CPG-TAVI-MOCK-01',
      question: `การพยาบาลผู้ป่วยหลังทำ ${cat} ในช่วงวิกฤต 24 ชั่วโมงแรก มีข้อควรระวังสำคัญอย่างไร?`,
      answer: `1. เฝ้าระวัง Hemodynamic stability สังเกต BP, HR, Rhythm ทาง Continuous Monitor\n2. ตรวจสอบแผลเจาะตรวจและคลำหา Hematoma บริเวณ Vascular access\n3. สังเกตอาการทางระบบประสาท (Neuro signs) เฝ้าระวังภาวะ Embolic stroke\n4. ปฏิบัติตามคำสั่งการให้ Antithrombotic therapy อย่างเคร่งครัด`,
      reference_doc: docMeta.title || `CPG การพยาบาลผู้ป่วย ${cat} ศิริราช`,
      page_number: 'หน้า 1-3',
      category: cat,
      metadata: {
        alert_level: 'high',
        source: 'Mock Generator Engine'
      }
    }
  ];
}

/**
 * ตรวจสอบความถูกต้องและสร้าง SQL INSERT Statement
 * @param {Array} faqs รายการ FAQs
 * @returns {string} ข้อความ SQL
 */
function exportToSql(faqs) {
  const statements = faqs.map(faq => {
    const cpg_id = (faq.cpg_id || '').replace(/'/g, "''");
    const q = (faq.question || '').replace(/'/g, "''");
    const a = (faq.answer || '').replace(/'/g, "''");
    const ref = (faq.reference_doc || '').replace(/'/g, "''");
    const page = (faq.page_number || '').replace(/'/g, "''");
    const cat = (faq.category || 'General').replace(/'/g, "''");
    const meta = JSON.stringify(faq.metadata || {}).replace(/'/g, "''");

    return `INSERT INTO public.cpg_faqs (cpg_id, question, answer, reference_doc, page_number, category, metadata)
VALUES ('${cpg_id}', '${q}', '${a}', '${ref}', '${page}', '${cat}', '${meta}'::jsonb);`;
  });

  return statements.join('\n\n');
}

/**
 * Main CLI Execution
 */
async function main() {
  console.log('🩺 === CCU Nurse Siriraj: CPG-to-FAQ Generator ===');
  console.log(`Node Environment: Node ${process.version}`);
  console.log(`Gemini API Key: ${GEMINI_API_KEY ? 'ตรวจพบ (Online Mode) ✅' : 'ไม่พบ (Offline Mock Mode) ⚠️'}`);

  const sampleDocMeta = {
    cpg_id: 'CPG-TAVI-SIRIRAJ-2024',
    title: 'คู่มือการพยาบาลผู้ป่วยหลังทำ TAVI ศิริราช (Post TAVR Monitoring)',
    category: 'TAVI'
  };

  const sampleCpgText = `
แนวทางการดูแลผู้ป่วยหลังทำ TAVI (Transcatheter Aortic Valve Implantation)
1. การเฝ้าระวัง Conduction Block: ผู้ป่วยมีความเสี่ยงเกิด Complete Heart Block (CHB) หรือ New LBBB สูงสุดใน 24-48 ชม. แรก
   - ให้เฝ้าระวัง Continuous EKG ตลอด 48 ชม.
   - หากพบ PR interval ยาวขึ้น หรือมี Bradycardia ให้เตรียม Temporary Pacemaker ทันที
2. การดูแลแผล Femoral:
   - ตรวจสอบ Dorsalis pedis pulse, Capillary refill ทุก 15 นาที x 4 ครั้ง, ทุก 30 นาที x 2 ครั้ง, แล้วทุก 1 ชั่วโมง
   - หากพบ Hematoma หรือ Active bleeding ให้ใช้มือคลำกดจุดเลือดออก (Manual compression) และรายงานแพทย์ด่วน
3. ป้องกัน Stroke: ตรวจ Pupil และ Motor power ทุก 2-4 ชั่วโมง
  `;

  console.log('\n🔄 กำลังประมวลผลสกัด FAQs จากตัวอย่าง CPG...');
  const faqs = await extractFaqsFromCpg(sampleCpgText, sampleDocMeta);
  console.log(`✅ สกัด FAQ สำเร็จ: จำนวน ${faqs.length} รายการ\n`);

  console.log(JSON.stringify(faqs, null, 2));

  // บันทึกไฟล์ผลลัพธ์ JSON สำหรับ Review
  const outputDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonOutputPath = path.join(outputDir, 'extracted_faqs_sample.json');
  fs.writeFileSync(jsonOutputPath, JSON.stringify(faqs, null, 2), 'utf-8');
  console.log(`\n💾 บันทึก JSON สำเร็จ: ${jsonOutputPath}`);

  const sqlOutputPath = path.join(outputDir, 'extracted_faqs_sample.sql');
  fs.writeFileSync(sqlOutputPath, exportToSql(faqs), 'utf-8');
  console.log(`💾 บันทึก SQL สำเร็จ: ${sqlOutputPath}`);
}

// ตรวจสอบว่าเรียกผ่าน CLI หรือ require
if (require.main === module) {
  main().catch(err => {
    console.error('❌ เกิดข้อผิดพลาดในการประมวลผล:', err);
    process.exit(1);
  });
}

module.exports = {
  extractFaqsFromCpg,
  generateEmbedding,
  exportToSql,
  CPG_EXTRACTION_SYSTEM_PROMPT
};
