/**
 * ==============================================================================
 * Cloudflare Worker: CCU AI Gateway v2 (Hybrid FAQ Vector Search & PDPA Guard)
 * Issue #03: อัปเกรด Cloudflare Worker Gateway ให้รองรับ FAQ Vector Search
 * โครงการ: CCU Nurse AI Assistant (หอผู้ป่วยวิกฤตโรคหัวใจ โรงพยาบาลศิริราช)
 * วิศวกรผู้รับผิดชอบ: น้องคำหล้า (Khamla AI/Full-Stack Dev)
 * ตรวจสอบโดย: พี่ก้อง (AI Lead Architect) & อ้าย (Project Owner)
 * ==============================================================================
 */

// Configuration Defaults & Environment Bindings
const GEMINI_EMBEDDING_MODEL = 'text-embedding-004';
const GEMINI_CHAT_MODEL = 'gemini-1.5-flash';
const DEFAULT_MATCH_THRESHOLD = 0.72; // Threshold ความคล้ายคลึงสำหรับ FAQ Direct Match
const DEFAULT_MATCH_COUNT = 3;

/**
 * CORS Headers สำหรับเว็บแอพพลิเคชัน CCU Nurse Pocket
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Content-Type': 'application/json; charset=utf-8'
};

/**
 * PDPA Sanitizer & Guardrails
 * ตรวจจับและปฏิเสธคำถามที่มีข้อมูลระบุตัวตนผู้ป่วย (HN, เลข 13 หลัก, ชื่อ/เตียง)
 */
function inspectPdpaViolation(text) {
  if (!text) return null;

  // 1. ตรวจจับคำว่า HN หรือ Hospital Number ตามด้วยตัวเลข
  const hnPattern = /\b(hn|h\.n\.)\s*[:=\-]?\s*\d{4,10}\b/i;
  if (hnPattern.test(text)) {
    return 'ตรวจพบรหัสประจำตัวผู้ป่วย (HN) ในข้อความคำถาม';
  }

  // 2. ตรวจจับเลขบัตรประชาชน 13 หลัก หรือตัวเลขยาวติดกันเกิน 7 หลัก
  const idPattern = /\b\d{13}\b|\b\d{7,10}\b/;
  if (idPattern.test(text)) {
    return 'ตรวจพบตัวเลขที่อาจเป็นหมายเลขประจำตัวผู้ป่วยหรือเลขบัตรประชาชน';
  }

  // 3. ตรวจจับชื่อ-นามสกุล ที่มีคำนำหน้า นาย/นาง/นางสาว/ด.ช./ด.ญ.
  const namePattern = /(นาย|นาง|นางสาว|ด\.ช\.|ด\.ญ\.|คุณ)\s+[ก-๙]{2,}\s+[ก-๙]{2,}/;
  if (namePattern.test(text)) {
    return 'ตรวจพบชื่อ-นามสกุลของผู้ป่วยในข้อความคำถาม';
  }

  // 4. ตรวจจับระบุเตียงคนไข้เฉพาะเจาะจง เช่น เตียง 4, เตียง CCU-05
  const bedPattern = /\b(เตียง|bed)\s*(ccu)?\s*[-_]?\d{1,2}\b/i;
  if (bedPattern.test(text)) {
    return 'ตรวจพบการระบุหมายเลขเตียงผู้ป่วย กรุณาถามในเชิงหลักการพยาบาลทั่วไป';
  }

  return null;
}

/**
 * เรียก Gemini text-embedding-004 เพื่อแปลงคำถามเป็น 768-dim Vector
 */
async function getGeminiEmbedding(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: {
        parts: [{ text: text }]
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding API failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data?.embedding?.values || null;
}

/**
 * ค้นหา FAQ ที่ตรงกันจาก Supabase ผ่าน Postgres RPC match_cpg_faqs
 */
async function searchSupabaseFaqs(queryVector, env, options = {}) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey || !queryVector) {
    return [];
  }

  const rpcUrl = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/match_cpg_faqs`;
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    },
    body: JSON.stringify({
      query_embedding: queryVector,
      match_threshold: options.threshold || DEFAULT_MATCH_THRESHOLD,
      match_count: options.count || DEFAULT_MATCH_COUNT,
      filter_category: options.category || null
    })
  });

  if (!res.ok) {
    console.warn(`Supabase RPC match_cpg_faqs error (${res.status}):`, await res.text());
    return [];
  }

  return await res.json();
}

/**
 * เรียก Gemini Chat Generation เพื่อตอบคำถามโดยอิงจาก CPG Context
 */
async function generateGroundedAnswer(question, contextPrompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent?key=${apiKey}`;

  const systemPrompt = `
คุณคือ "CCU Nurse AI Assistant" ผู้ช่วยปัญญาประดิษฐ์ประจำหอผู้ป่วยวิกฤตโรคหัวใจ (CCU) โรงพยาบาลศิริราช
ภารกิจ: ให้คำตอบเชิงปฏิบัติการพยาบาลแก่พยาบาลวิชาชีพข้างเตียงอย่างแม่นยำ กระชับ และอ้างอิง CPG ศิริราช

กฎระเบียบเข้มงวด (Strict Rules):
1. **Zero Hallucination**: ตอบเฉพาะข้อมูลที่มีในบริบท CPG ที่แนบมาเท่านั้น ห้ามคิดค้นหรือคาดเดาขนาดยา/แนวทางรักษาเอง
2. **Actionable Steps**: สรุปเป็นขั้นตอน 1, 2, 3 พร้อมระบุค่าสังเกตสำคัญ (Vital signs, Alert limits)
3. **High-Alert Drug Warning**: หากเป็นยาช่วยฟื้นคืนชีพหรือยาเสี่ยงสูง ต้องเน้นย้ำ Route (IV/Central line) และการ Titrate อย่างระมัดระวัง
4. **Reference Grounding**: ระบุชื่อเอกสารอ้างอิงและเลขหน้าท้ายคำตอบเสมอ
`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{
          text: `คำถามจากพยาบาล: ${question}\n\nบริบท CPG อ้างอิง:\n${contextPrompt}\n\nกรุณาตอบคำถามข้างต้นตามหลักวิชาชีพพยาบาล CCU ศิริราช`
        }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 1024
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Chat API Error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'ขออภัย ไม่สามารถสร้างคำตอบได้ในขณะนี้';
}

/**
 * Main Cloudflare Worker Fetch Handler
 */
export default {
  async fetch(request, env, ctx) {
    // 1. จัดการ OPTIONS Preflight สำหรับ CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: corsHeaders
      });
    }

    try {
      const body = await request.json().catch(() => ({}));
      const action = body.action || 'chat';

      const geminiApiKey = env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        return new Response(JSON.stringify({
          error: 'CONFIG_ERROR',
          message: 'ไม่พบ GEMINI_API_KEY ใน Environment Variables ของ Worker'
        }), {
          status: 500,
          headers: corsHeaders
        });
      }

      // Feature: AI สกัดคู่คำถาม-คำตอบ (CPG-to-FAQ Generator)
      if (action === 'extract_faqs') {
        const cpgTitle = (body.cpgTitle || body.title || '').trim();
        const cpgCategory = (body.cpgCategory || body.category || 'General').trim();
        const cpgContent = (body.cpgContent || body.content || '').trim();
        const cpgAuthor = (body.cpgAuthor || body.author || 'CCU ศิริราช').trim();
        const existingQuestions = Array.isArray(body.existingQuestions) ? body.existingQuestions : [];

        if (!cpgTitle || !cpgContent) {
          return new Response(JSON.stringify({ error: 'กรุณาระบุชื่อเรื่อง (cpgTitle/title) และเนื้อหา (cpgContent/content) ของ CPG' }), {
            status: 400,
            headers: corsHeaders
          });
        }

        const existingPromptBlock = existingQuestions.length > 0 ? `
คำถามเดิมที่มีอยู่ในระบบแล้ว (ห้ามสร้างคำถามที่มีความหมายหรือเนื้อหาซ้ำกับข้อเหล่านี้โดยเด็ดขาด):
${existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
` : '';

        const prompt = `
คุณคือ AI Medical Knowledge Engineer ประจำหอผู้ป่วย CCU ศิริราช
ภารกิจ: สกัดคู่คำถาม-คำตอบข้างเตียงที่พยาบาลวิชาชีพถามบ่อยที่สุด (3-5 ข้อ) จากแนวปฏิบัตินี้:
ชื่อเรื่อง: ${cpgTitle}
หมวดหมู่: ${cpgCategory}
ผู้จัดทำ: ${cpgAuthor}
เนื้อหาแนวปฏิบัติ:
${cpgContent}
${existingPromptBlock}
กฎระเบียบ:
1. สกัดเฉพาะข้อเท็จจริงในเนื้อหา ห้ามแต่งเติมขนาดยาหรือข้อห้ามขึ้นเอง (Zero Hallucination)
2. มุ่งเน้น: การเฝ้าระวังแทรกซ้อน (Complications), ขนาดยาเสี่ยงสูง (High-Alert Drugs), ข้อห้ามสำคัญ (Pitfalls/Red flags)
3. ตรวจสอบให้แน่ใจว่าคำถามที่สกัด ไม่ซ้ำซ้อนกับคำถามเดิมที่ระบุไว้ข้างต้น
4. ผลลัพธ์ต้องส่งกลับเป็น JSON Array โดยมีรูปแบบดังนี้:
[
  {
    "question": "คำถามข้างเตียงที่ชัดเจน กระชับ",
    "answer": "คำตอบแนวปฏิบัติทางคลินิก มีขั้นตอนปฏิบัติ 1, 2, 3...",
    "reference": "${cpgTitle} (${cpgAuthor})"
  }
]
`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent?key=${geminiApiKey}`;
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          })
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini Extract API failed: ${errText}`);
        }

        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        let faqs = [];
        try {
          faqs = JSON.parse(rawText);
        } catch(e) {
          faqs = [];
        }

        return new Response(JSON.stringify({
          success: true,
          cpgTitle: cpgTitle,
          faqs: faqs
        }), {
          status: 200,
          headers: corsHeaders
        });
      }

      const question = (body.question || '').trim();
      const localCpgContext = body.cpgContext || '';

      if (!question) {
        return new Response(JSON.stringify({ error: 'กรุณาระบุคำถาม (question)' }), {
          status: 400,
          headers: corsHeaders
        });
      }

      // 2. PDPA Guard Check
      const pdpaViolation = inspectPdpaViolation(question);
      if (pdpaViolation) {
        return new Response(JSON.stringify({
          error: 'PDPA_ALERT',
          message: pdpaViolation,
          alert: 'เพื่อความปลอดภัยของผู้ป่วยตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA) ห้ามส่งชื่อ, HN หรือข้อมูลระบุตัวตนเข้าสู่ระบบ AI'
        }), {
          status: 200,
          headers: corsHeaders
        });
      }

      // 3. Vector Embedding + Supabase FAQ Search (Hybrid Strategy)
      let matchedFaqs = [];
      let queryVector = null;

      try {
        queryVector = await getGeminiEmbedding(question, geminiApiKey);
        if (queryVector) {
          matchedFaqs = await searchSupabaseFaqs(queryVector, env, {
            threshold: body.matchThreshold || DEFAULT_MATCH_THRESHOLD,
            count: body.matchCount || DEFAULT_MATCH_COUNT,
            category: body.category || null
          });
        }
      } catch (vectorErr) {
        console.warn('Vector embedding/search skipped or failed:', vectorErr.message);
      }

      // 4. กรณีพบ Exact / High-Confidence Clinical FAQ Match (Fast Bedside Path)
      if (matchedFaqs && matchedFaqs.length > 0 && matchedFaqs[0].similarity >= 0.82) {
        const topFaq = matchedFaqs[0];
        return new Response(JSON.stringify({
          source: 'cpg_faq_vector_match',
          directMatch: true,
          similarity: topFaq.similarity,
          faqId: topFaq.id,
          matchedQuestion: topFaq.question,
          answer: topFaq.answer,
          reference: {
            title: topFaq.reference_doc,
            page: topFaq.page_number,
            category: topFaq.category,
            cpg_id: topFaq.cpg_id
          },
          additionalFaqs: matchedFaqs.slice(1).map(f => ({
            question: f.question,
            similarity: f.similarity,
            reference: f.reference_doc
          }))
        }), {
          status: 200,
          headers: corsHeaders
        });
      }

      // 5. กรณีไม่พบ High Confidence Match: นำ FAQ ที่เกี่ยวข้อง + Local CPG Context ผสานเข้ากับ LLM Prompt
      let contextPrompt = '';

      if (matchedFaqs && matchedFaqs.length > 0) {
        contextPrompt += '=== ข้อมูลจากคลัง Clinical FAQ ศิริราช (Supabase Vector) ===\n';
        matchedFaqs.forEach((f, idx) => {
          contextPrompt += `[FAQ ${idx + 1}] คำถาม: ${f.question}\nคำตอบ: ${f.answer}\nอ้างอิง: ${f.reference_doc} (${f.page_number || '-'})\n\n`;
        });
      }

      if (localCpgContext) {
        contextPrompt += `=== ข้อมูลจากคลัง CPG ของหอผู้ป่วย (Catalog RAG) ===\n${localCpgContext}\n`;
      }

      // หากไม่มี Context ใดๆ ส่งข้อความเตือน Grounding
      if (!contextPrompt.trim()) {
        contextPrompt = 'ไม่มีข้อมูล CPG เฉพาะเจาะจง ให้ตอบตามแนวทางมาตรฐานการพยาบาลผู้ป่วยวิกฤตโรคหัวใจและแจ้งเตือนให้ปรึกษาแพทย์เวร';
      }

      const generatedAnswer = await generateGroundedAnswer(question, contextPrompt, geminiApiKey);

      return new Response(JSON.stringify({
        source: 'gemini_grounded_rag',
        directMatch: false,
        answer: generatedAnswer,
        vectorHits: matchedFaqs.length,
        references: matchedFaqs.map(f => ({
          title: f.reference_doc,
          page: f.page_number,
          category: f.category,
          similarity: f.similarity
        }))
      }), {
        status: 200,
        headers: corsHeaders
      });

    } catch (err) {
      return new Response(JSON.stringify({
        error: 'INTERNAL_GATEWAY_ERROR',
        message: err.message
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};
