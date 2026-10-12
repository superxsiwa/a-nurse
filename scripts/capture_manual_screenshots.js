const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9224;
const OUTPUT_DIR = path.join(__dirname, '../docs_portal/screenshots');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('🚀 Launching headless Chrome...');
  const chrome = spawn('/opt/google/chrome/google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--window-size=412,915',
    '--hide-scrollbars'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  console.log('Connecting to DevTools...');
  const tabs = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const tab = tabs.find(t => t.type === 'page') || tabs[0];
  if (!tab || !tab.webSocketDebuggerUrl) {
    throw new Error('No page tab found in Chrome!');
  }

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      if (msg.error) cb.reject(msg.error);
      else cb.resolve(msg.result);
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const reqId = id++;
      callbacks.set(reqId, { resolve, reject });
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }

  // Configure viewport
  await send('Emulation.setDeviceMetricsOverride', {
    width: 412,
    height: 915,
    deviceScaleFactor: 2,
    mobile: true
  });

  const fileUrl = 'file://' + path.resolve(__dirname, '../index.html');
  console.log('Navigating to:', fileUrl);
  await send('Page.navigate', { url: fileUrl });
  await new Promise(r => setTimeout(r, 1500));

  async function capture(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`📸 Saved: ${filename} (${Math.round(buffer.length / 1024)} KB)`);
  }

  async function evaluate(code) {
    return send('Runtime.evaluate', { expression: code, awaitPromise: true });
  }

  try {
    // 1. Initial Login Screen
    console.log('1. Capturing Login Screen...');
    await capture('01_login_screen.png');

    // 2. Nurse Home Screen
    console.log('2. Logging in as Nurse & Capturing Home...');
    await evaluate(`
      quickFillLogin('nurse', 'ccu7');
      switchTab('home');
    `);
    await new Promise(r => setTimeout(r, 500));
    await capture('02_home_dashboard.png');

    // 3. Nurse Home Search Result
    console.log('3. Searching for TAVI on Home...');
    await evaluate(`
      document.getElementById('mobileSearch').value = 'TAVI';
      handleSearch({ target: { value: 'TAVI' } });
    `);
    await new Promise(r => setTimeout(r, 500));
    await capture('03_home_search_tavi.png');

    // 4. Emergency SOS View
    console.log('4. Capturing Emergency SOS View...');
    await evaluate(`
      clearSearch();
      switchTab('emergency');
    `);
    await new Promise(r => setTimeout(r, 500));
    await capture('04_emergency_sos.png');

    // 5. AI Assistant View (Asking Clinical Question)
    console.log('5. Asking question in AI Assistant...');
    await evaluate(`
      switchTab('ai');
      document.getElementById('aiInput').value = 'คนไข้ Post-TAVI 24 ชม. แรก ต้องเฝ้าระวังอะไรเป็นพิเศษ?';
      askAiAssistant();
    `);
    // Wait for AI response simulated delay
    await new Promise(r => setTimeout(r, 2000));
    await capture('05_ai_assistant_response.png');

    // 6. Deduplication Modal (Instant resolution / Follow)
    console.log('6. Capturing Duplicate Notice Modal...');
    await evaluate(`
      sendJuniorQuestion('คนไข้ Post-TAVI 24 ชม. แรก ต้องเฝ้าระวังอะไรเป็นพิเศษ?');
    `);
    await new Promise(r => setTimeout(r, 800));
    await capture('06_duplicate_check_modal.png');

    // 7. Tacit Knowledge Wall
    console.log('7. Capturing Tacit Knowledge Wall...');
    await evaluate(`
      closeJuniorDuplicateNoticeModal();
      switchTab('tacit');
    `);
    await new Promise(r => setTimeout(r, 600));
    await capture('07_tacit_pearls_wall.png');

    // 8. Senior Mentorship Board (Logged in as Senior)
    console.log('8. Logging in as Senior & Opening Junior Board...');
    await evaluate(`
      quickFillLogin('senior', 'ccu7');
      switchTab('home');
      openJuniorQuestionsBoardModal();
    `);
    await new Promise(r => setTimeout(r, 800));
    await capture('08_senior_mentorship_board.png');

    // 9. Senior Answer Modal
    console.log('9. Opening Senior Answer Modal...');
    await evaluate(`
      const faqs = getFaqList();
      const target = faqs.find(f => f.status === 'pending') || faqs[0];
      if (target) {
        openAnswerJuniorFaqModal(target.id);
      }
    `);
    await new Promise(r => setTimeout(r, 800));
    await capture('09_senior_answer_modal.png');

    // 10. Admin Management Screen (Logged in as Admin)
    console.log('10. Logging in as Admin & Capturing KM View...');
    await evaluate(`
      closeAnswerJuniorFaqModal();
      closeJuniorQuestionsBoardModal();
      quickFillLogin('admin', '1234');
      switchTab('manage');
    `);
    await new Promise(r => setTimeout(r, 800));
    await capture('10_admin_km_dashboard.png');

    // 11. Admin User Role Approval Modal
    console.log('11. Opening User Role Modal...');
    await evaluate(`
      openUserRoleModal();
    `);
    await new Promise(r => setTimeout(r, 800));
    await capture('11_admin_user_roles.png');

    console.log('🎉 All 11 screenshots successfully captured!');
  } finally {
    ws.close();
    chrome.kill();
  }
}

run().catch(err => {
  console.error('Error running capture:', err);
  process.exit(1);
});

