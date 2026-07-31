// End-to-end verification for the "每日例行 not shown on board" fix.
// Reuses the CDP helper pattern from shot-tour.mjs (system Chrome, no deps).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
const OUT = 'D:\\DMYY\\DM_LifeManager-review\\deliverables\\gstack';
const BASE = 'http://127.0.0.1:5000/';
const EMAIL = 'verify' + Date.now() + '@home.dev';
const TITLE = '每日例行验证任务' + Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startChrome() {
  const args = [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:\\Users\\39488\\AppData\\Local\\Temp\\chrome-dm-verify',
    '--window-size=1440,900', '--no-sandbox', '--disable-gpu',
    '--hide-scrollbars', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
  ];
  const p = spawn(CHROME, args, { stdio: 'ignore' });
  return p;
}

async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      if (res.ok) {
        const arr = await res.json();
        const t = (arr || []).find((x) => x.type === 'page') || arr[0];
        if (t && t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error('chrome devtools not up');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (p) { clearTimeout(p.timer); this.pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('cdp timeout ' + method)); }, 25000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
}

const log = (...a) => console.log('[verify]', ...a);

async function main() {
  const chrome = startChrome();
  await sleep(1500);
  const wsUrl = await getPageWs();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const nav = async (url) => {
    await cdp.send('Page.navigate', { url });
    await sleep(1800);
    for (let i = 0; i < 30; i++) {
      try { const s = await cdp.ev('document.readyState'); if (s === 'complete') break; } catch {}
      await sleep(300);
    }
    await sleep(500);
  };
  const waitText = async (t, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await cdp.ev('document.body && document.body.innerText.includes(' + JSON.stringify(t) + ')')) return true; } catch {}
      await sleep(300);
    }
    return false;
  };
  const waitSel = async (sel, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await cdp.ev('!!document.querySelector(' + JSON.stringify(sel) + ')')) return true; } catch {}
      await sleep(300);
    }
    return false;
  };
  const clickText = (t) => cdp.ev('(function(){const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()===' + JSON.stringify(t) + ');if(b){b.click();return true;}return false;})()');
  const clickContains = (t) => cdp.ev('(function(){const b=[...document.querySelectorAll("button,label")].find(x=>x.textContent.includes(' + JSON.stringify(t) + '));if(b){b.click();return true;}return false;})()');
  const setByPh = (ph, v) => cdp.ev('(function(){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;const el=[...document.querySelectorAll("input")].find(i=>i.placeholder&&i.placeholder.includes(' + JSON.stringify(ph) + '));if(!el)return false;s.call(el,' + JSON.stringify(v) + ');el.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
  const pressKey = (key, code, vk, mods = 0) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mods, key, code, windowsVirtualKeyCode: vk }).then(() => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 0, key, code, windowsVirtualKeyCode: vk }));
  const fillPin = (pin) => cdp.ev('(function(){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;const cells=[...document.querySelectorAll(".pin-cell")];for(let i=0;i<cells.length;i++){s.call(cells[i],' + JSON.stringify(pin) + '[i]);cells[i].dispatchEvent(new Event("input",{bubbles:true}));}return cells.length;})()');

  try {
    // 1) register + set PIN + enter board
    await nav(BASE);
    await waitSel('.auth-card', 10000);
    await clickText('注册'); await sleep(400);
    await setByPh('你的名字', '验证用户');
    await setByPh('you@home.dev', EMAIL);
    await setByPh('至少', 'demo1234');
    await clickText('创建账号');
    await waitSel('.pin-cell', 10000);
    await fillPin('12341234');
    await clickText('确认设置');
    const onBoard = await waitText('每日看板', 12000);
    if (!onBoard) throw new Error('did not reach board after PIN');
    await sleep(1800);
    log('reached board');

    // 2) open command palette (Ctrl+K), create a DAILY routine task
    await pressKey('k', 'KeyK', 75, 2);
    await sleep(1200);
    const paletteOpen = await waitText('任务名称', 8000);
    if (!paletteOpen) throw new Error('command palette did not open');
    await setByPh('任务名称', TITLE);
    await sleep(300);
    const checked = await clickContains('每日例行');
    log('daily checkbox clicked:', checked);
    await sleep(400);
    // focus title input then submit via Enter (input onKeyDown -> submit())
    await cdp.ev('document.querySelector("input[placeholder*=\'任务名称\']").focus()');
    await pressKey('Enter', 'Enter', 13);
    const added = await waitText('任务已添加', 10000);
    log('toast shown:', added);
    if (!added) throw new Error('create did not report success');

    // 3) wait for ensureDaily + invalidate propagation
    await sleep(4000);

    // 4) check the board DOM shows the daily task's today-instance
    const found = await cdp.ev('document.body.innerText.includes(' + JSON.stringify(TITLE) + ')');
    log('board shows daily task:', found);
    writeFileSync(OUT + '\\verify-daily.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));

    console.log(found ? 'RESULT=PASS' : 'RESULT=FAIL');
  } catch (e) {
    log('ERROR', e.message);
    console.log('RESULT=ERROR');
  } finally {
    try { ws.close(); } catch {}
    try { chrome.kill('SIGTERM'); } catch {}
    process.exit(0);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
