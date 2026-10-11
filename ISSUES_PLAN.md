# 📌 Backlog & Issue Tracker: CPG-to-FAQ Vector RAG Architecture
**โครงการ:** CCU Nurse AI Assistant (หอผู้ป่วยวิกฤตโรคหัวใจ โรงพยาบาลศิริราช)  
**ผู้นำทีม:** อ้าย (Project Owner) & พี่ก้อง (AI Lead Architect)  
**วิศวกรผู้รับผิดชอบ:** น้องคำหล้า (Khamla AI/Full-Stack Dev)

---

## 🎯 วัตถุประสงค์ตามแนวคิดอาจารย์
เปลี่ยนจากการทำ Vector Search บนเอกสาร CPG ดิบยาวๆ มาเป็นการสร้าง **"คลังคู่คำถาม-คำตอบ (Clinical FAQ Pairs) พร้อม Reference Document กำกับทุกข้อ"** แล้วแปลงเป็น Vector Embeddings เพื่อเพิ่มความแม่นยำในการค้นหาข้างเตียงให้ใกล้เคียง 100%

---

## 📋 รายการ Issues ที่วางแผนส่งมอบ (Sprint Backlog)

### 🟢 Issue #01: Database Schema Expansion สำหรับ Clinical FAQ & Embeddings [COMPLETED ✅]
- **ผู้รับผิดชอบ:** น้องคำหล้า
- **สถานะ:** เสร็จสมบูรณ์ (Implemented)
- **ไฟล์ส่งมอบ:** [database/schema_faqs.sql](file:///home/superx-desktop/Documents/0_app_projects/a-nurse/database/schema_faqs.sql)
- **รายละเอียดที่จัดทำแล้ว:**
  - สร้างตาราง `cpg_faqs` ครบถ้วนทุกฟิลด์ (id, cpg_id, question, answer, reference_doc, page_number, category, embedding vector(768), metadata, timestamps)
  - Index แบบ HNSW บน Cosine Similarity (`vector_cosine_ops`, m=16, ef_construction=64) พร้อม B-Tree Index บน category และ cpg_id
  - Postgres RPC Function `match_cpg_faqs(query_embedding vector, match_threshold float, match_count int, filter_category varchar)`
  - ตั้งค่า RLS (Row Level Security) สำหรับความปลอดภัยทางการแพทย์
  - Seed Data ทางคลินิกจริงจาก CPG ศิริราช (Post-TAVI, TEER, Norepinephrine, EKG Wide QRS/VT, ACS STEMI Post-PCI)

---

### 🟢 Issue #02: โมดูล AI สกัด CPG เป็น FAQ อัตโนมัติ (Automated CPG-to-FAQ Generator) [COMPLETED ✅]
- **ผู้รับผิดชอบ:** น้องคำหล้า
- **สถานะ:** เสร็จสมบูรณ์ (Implemented)
- **ไฟล์ส่งมอบ:** [scripts/cpg_to_faq_generator.js](file:///home/superx-desktop/Documents/0_app_projects/a-nurse/scripts/cpg_to_faq_generator.js)
- **รายละเอียดที่จัดทำแล้ว:**
  - โมดูล `extractFaqsFromCpg(cpgContent, docMeta)` สกัด CPG เป็นโครงสร้าง JSON คู่คำถาม-คำตอบ พร้อม Reference Document และเลขหน้า
  - กำหนด Strict Clinical System Prompt (Zero-Hallucination, Actionable Steps, High-Alert Drug Safety)
  - รองรับ Gemini 2.0 / 1.5 Flash และฟังก์ชัน `generateEmbedding` ด้วย `text-embedding-004` (768 dimensions)
  - มีฟังก์ชัน Export เป็น SQL INSERT statement (`exportToSql`) และ Mock Offline Fallback รองรับการทดสอบ local
  - รันและทดสอบ Output เรียบร้อย บันทึกผลลัพธ์ใน `data/extracted_faqs_sample.json` และ `data/extracted_faqs_sample.sql`

---

### 🟢 Issue #03: อัปเกรด Cloudflare Worker Gateway ให้รองรับ FAQ Vector Search [COMPLETED ✅]
- **ผู้รับผิดชอบ:** น้องคำหล้า
- **สถานะ:** เสร็จสมบูรณ์ (Implemented)
- **ไฟล์ส่งมอบ:** [workers/ccu_ai_gateway_v2.js](file:///home/superx-desktop/Documents/0_app_projects/a-nurse/workers/ccu_ai_gateway_v2.js)
- **รายละเอียดที่จัดทำแล้ว:**
  - เพิ่มฟังก์ชัน `getGeminiEmbedding(text, apiKey)` แปลงคำถามพยาบาลเป็น 768-dim Vector ด้วย `text-embedding-004`
  - เชื่อมต่อ Supabase REST API เรียก RPC `match_cpg_faqs` ด้วย Cosine Similarity Index
  - มี Fast Direct-Match Path: หากความคล้ายคลึง $\ge 82\%$ ให้ส่งคำตอบที่ผ่านการ Verify พร้อม Reference Document & Page Number ทันที
  - มี Fallback Grounded Generation: นำข้อความจาก FAQ + Local CPG Context ส่งให้ Gemini ช่วยตอบอย่างแม่นยำ
  - นโยบาย PDPA Guard เข้มงวด: ตรวจจับ HN, เลขบัตร 13 หลัก, ชื่อ-นามสกุลผู้ป่วย และหมายเลขเตียง ป้องกันข้อมูลรั่วไหลอย่างสมบูรณ์

---

### 🟢 Issue #04: หน้าจอ UI "คลังคำถามพบบ่อยข้างเตียง (Bedside Clinical FAQs)" [COMPLETED ✅]
- **ผู้รับผิดชอบ:** น้องคำหล้า
- **สถานะ:** เสร็จสมบูรณ์ (Implemented)
- **ไฟล์ส่งมอบ:** [index.html](file:///home/superx-desktop/Documents/0_app_projects/a-nurse/index.html)
- **รายละเอียดที่จัดทำแล้ว:**
  - เพิ่ม Quick Bedside FAQ Drawer ในหน้าถาม AI พร้อมปุ่มเปิด/ปิด และ Badge แหล่งอ้างอิง CPG ศิริราช
  - ตัวกรอง Category Pills ตามหัตถการ CCU สำคัญ: ทั้งหมด, TAVI, TEER, ยาเสี่ยงสูง, EKG ด่วน, ACS/STEMI
  - พยาบาลสามารถกดคลิกเดียวเพื่อถามข้างเตียงได้ทันที โดยไม่ต้องเสียเวลาพิมพ์
  - รองรับ Offline / Instant Fallback แสดงคำตอบพร้อมอ้างอิงอย่างชัดเจนแม้เครือข่ายขัดข้อง
  - ปรับแต่งการแสดงผลกล่องข้อความ AI ตอบกลับให้แยกสถานะ Direct Match (ความแม่นยำสูง) พร้อม Reference Source ชัดเจน

