# CCU Nurse Pocket Guide (Prototype)

เว็บแอปพลิเคชันต้นแบบสำหรับเป็น **คู่มือพกพาข้างเตียงพยาบาล (Bedside Pocket Guide)** วอร์ดวิกฤตหัวใจและหลอดเลือด (CCU) นวมินทรบพิตร 84 พรรษา ชั้น 7 โรงพยาบาลศิริราช

---

## 1. การทำงานหลัก (Core Features)

ออกแบบเพื่อเน้นการใช้งานบนมือถือ (Mobile-First Responsive) สแกน QR Code เข้าใช้งานได้ทันทีข้างเตียงคนไข้:

1. **หน้าหลัก (Home)**
   - ค้นหาแนวปฏิบัติด่วน (Bedside Search & Quick Filter Chips)
   - แตะเข้าถึง 4 หัวข้อสำคัญทันที (Arrhythmia EKG, High Alert Drugs, IABP & เครื่องพยุงชีพ, CAM-ICU Delirium)
   - สรุปข้อคิดสะกิดใจจากพี่ในเวร (Clinical Pearls)
2. **คลังความรู้ (Knowledge)**
   - ดูสรุปแนวปฏิบัติข้างเตียง (Bedside Checklist & Protocol)
   - รองรับการเปิดอ่านเอกสารคู่มือ PDF ฉบับเต็ม เช่น `Arrhythmia น้องICU.pdf`
3. **พี่สู่น้อง (Tacit Knowledge)**
   - ถ่ายทอดและบันทึกเกร็ดความรู้จากพยาบาลรุ่นพี่ชำนาญการสู่พยาบาลรุ่นน้อง
4. **ด่วนวิกฤต (Emergency SOS)**
   - สรุปขั้นตอนรับมือสถานการณ์ฉุกเฉินข้างเตียง: Pulseless VT/VF Arrest, Symptomatic Bradycardia, พร้อมเบอร์โทรฉุกเฉินภายในวอร์ด

---

## 2. วิธีทดสอบเปิดใช้งาน Prototype
เปิดไฟล์ `prototype/index.html` ผ่านเว็บบราวเซอร์ เช่น Google Chrome แล้วกด `F12` เพื่อดูในโหมดหน้าจอมือถือ (Device Toolbar) ได้ทันที
