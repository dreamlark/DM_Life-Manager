// CDP screenshot tour for DM_LifeManager-review web-collab (no external deps; uses system Chrome)
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const OUT = 'D:\\DMYY\\DM_LifeManager-review\\deliverables\\gstack\\assets';
const BASE = 'http://127.0.0.1:5000/';
const EMAIL = 'demo' + Date.now() + '@home.dev';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startChrome() {
  const args = [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:\\Users\\39488\\AppData\\Local\\Temp\\chrome-dm',
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

const log = (...a) => console.log('[shot]', ...a);

async function main() {
  const chrome = startChrome();
  await sleep(1500);
  const wsUrl = await getPageWs();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // viewport fixed via --window-size=1440,900

  const nav = async (url) => {
    await cdp.send('Page.navigate', { url });
    await sleep(1800);
    for (let i = 0; i < 30; i++) {
      try { const s = await cdp.ev('document.readyState'); if (s === 'complete') break; } catch {}
      await sleep(300);
    }
    await sleep(500);
  };
  const waitText = async (t, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await cdp.ev('document.body && document.body.innerText.includes(' + JSON.stringify(t) + ')')) return true; } catch {}
      await sleep(300);
    }
    return false;
  };
  const waitSel = async (sel, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await cdp.ev('!!document.querySelector(' + JSON.stringify(sel) + ')')) return true; } catch {}
      await sleep(300);
    }
    return false;
  };
  const shot = async (name) => {
    await sleep(700);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(OUT + '\\' + name + '.png', Buffer.from(data, 'base64'));
    log('shot', name);
  };
  const clickText = (t) => cdp.ev('(function(){const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()===' + JSON.stringify(t) + ');if(b){b.click();return true;}return false;})()');
  const clickTitle = (t) => cdp.ev('(function(){const b=[...document.querySelectorAll("button")].find(x=>x.getAttribute("title")===' + JSON.stringify(t) + ');if(b){b.click();return true;}return false;})()');
  const clickContains = (t) => cdp.ev('(function(){const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes(' + JSON.stringify(t) + '));if(b){b.click();return true;}return false;})()');
  const setByPh = (ph, v) => cdp.ev('(function(){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;const el=[...document.querySelectorAll("input")].find(i=>i.placeholder&&i.placeholder.includes(' + JSON.stringify(ph) + '));if(!el)return false;s.call(el,' + JSON.stringify(v) + ');el.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
  const pressKey = (key, code, vk, mods = 0) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mods, key, code, windowsVirtualKeyCode: vk }).then(() => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 0, key, code, windowsVirtualKeyCode: vk }));
  const fillPin = (pin) => cdp.ev('(function(){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;const cells=[...document.querySelectorAll(".pin-cell")];for(let i=0;i<cells.length;i++){s.call(cells[i],' + JSON.stringify(pin) + '[i]);cells[i].dispatchEvent(new Event("input",{bubbles:true}));}return cells.length;})()');

  const run = async (label, fn) => { try { log('step', label); await fn(); } catch (e) { log('FAIL', label, e.message); } };

  await run('nav-auth', async () => { await nav(BASE); await waitSel('.auth-card', 10000); await shot('01-auth'); });
  await run('register', async () => {
    await clickText('注册'); await sleep(400);
    await setByPh('你的名字', '演示用户');
    await setByPh('you@home.dev', EMAIL);
    await setByPh('至少', 'demo1234');
    await clickText('创建账号');
    await waitSel('.pin-cell', 10000);
    await shot('02-pinsetup');
  });
  await run('pin-confirm', async () => {
    await fillPin('12341234');
    await clickText('确认设置');
    await waitText('每日看板', 10000);
    await sleep(1800);
    await shot('03-board');
  });
  const tabs = [['财务','04-finance'],['提醒','05-reminder'],['灵感·记事','06-notes'],['脑图','07-mindmap'],['日历','08-calendar'],['心流','09-flow'],['平衡轮','10-domains'],['孵化器','11-incubator']];
  for (const [label, name] of tabs) {
    await run('tab-' + label, async () => { await clickText(label); await sleep(1200); await shot(name); });
  }
  await run('cmd-palette', async () => {
    await pressKey('k', 'KeyK', 75, 2);
    await sleep(1000);
    await shot('12-commandpalette');
    await pressKey('Escape', 'Escape', 27);
    await sleep(500);
  });
  await run('settings', async () => { await clickTitle('设置'); await sleep(900); await shot('13-settings'); await pressKey('Escape', 'Escape', 27); await sleep(500); });
  await run('collab-mode', async () => {
    await clickTitle('设置'); await sleep(800);
    await clickText('运行模式'); await sleep(500);
    await clickContains('协作模式'); await sleep(600);
    await pressKey('Escape', 'Escape', 27); await sleep(600);
  });
  await run('collab-open', async () => {
    await clickText('协作'); await sleep(1200);
    await waitText('成员', 12000);
    await sleep(1500);
    await shot('14-collab-members');
  });
  await run('collab-finance', async () => { await clickText('财务'); await sleep(1200); await shot('15-collab-finance'); });
  await run('collab-shared', async () => { await clickText('共享'); await sleep(1200); await shot('16-collab-shared'); });

  log('DONE');
  try { ws.close(); } catch {}
  try { chrome.kill('SIGTERM'); } catch {}
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
