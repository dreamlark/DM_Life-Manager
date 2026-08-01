// DM_LifeManager 压力 + 部署冒烟一体化脚本（QA 全面测试用）
// 说明：本脚本自拉起 server 子进程（tsx），对真实 HTTP tRPC 端点（:4101）施压，
// 并顺带完成部署冒烟（/health、tRPC 调用、WebSocket 广播、S3 CORS 校验）。
// 不走 vitest（vitest 的 forks 池在 Windows+PGlite 下易卡死，且本脚本需常驻 server）。
//
// 用法：node scripts/load-http.mjs
// 调参（环境变量）：LOAD_CONCURRENCY（默认 30）、LOAD_DURATION（秒，默认 30）、POOL（默认 40）
import { spawn, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const ROOT = process.cwd();
const PORT = Number(process.env.LOAD_PORT || 4101);
const PORT2 = Number(process.env.LOAD_PORT2 || 4102);
const BASE = `http://127.0.0.1:${PORT}`;
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 30);
const DURATION = Number(process.env.LOAD_DURATION || 30);
const POOL = Number(process.env.POOL || 40);

const DATA_DIR = path.join(os.tmpdir(), `dm-load-${Date.now()}`);
mkdirSync(DATA_DIR, { recursive: true });
const JWT_SECRET = randomBytes(48).toString('base64');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------- 子进程管理 ----------
function startServer(port, opts = {}) {
  const tsxCli = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
  const child = spawn(
    process.execPath,
    [tsxCli, path.join(ROOT, 'packages/server/src/http-server.ts')],
    {
      cwd: path.join(ROOT, 'packages/server'),
      env: {
        ...process.env,
        PORT: String(port),
        PGLITE_DIR: DATA_DIR + (opts.suffix || ''),
        JWT_SECRET: opts.jwt || JWT_SECRET,
        NODE_ENV: 'production',
        CORS_ORIGIN: opts.cors ?? '*',
        RATE_LOGIN_LIMIT: '100000',
        RATE_REGISTER_LIMIT: '100000',
        RATE_REFRESH_LIMIT: '100000',
        RATE_UNKNOWN_LIMIT: '100000',
        WS_TOKEN_RECHECK_MS: '600000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (d) => process.stdout.write(`[srv:${port}] ` + d));
  child.stderr.on('data', (d) => process.stderr.write(`[srv:${port}!] ` + d));
  return child;
}

async function waitHealth(port, timeoutMs = 90000) {
  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.status === 200) {
        const j = await r.json().catch(() => null);
        if (j && j.ready) return true;
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

// ---------- tRPC HTTP 客户端 ----------
// mutation → POST ?batch=1 body {"0":input}（响应为数组）
// query     → GET  ?input=<urlencoded json>（响应为单对象）
async function trpc(port, proc, input, token, method = 'POST') {
  const base = `http://127.0.0.1:${port}`;
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  let r;
  if (method === 'GET') {
    const qs = `?input=${encodeURIComponent(JSON.stringify(input ?? {}))}`;
    r = await fetch(`${base}/trpc/${proc}${qs}`, { method: 'GET', headers });
  } else {
    r = await fetch(`${base}/trpc/${proc}?batch=1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ '0': input ?? {} }),
    });
  }
  const body = await r.json().catch(() => null);
  const arr = Array.isArray(body) ? body : [body];
  const first = arr[0] ?? {};
  if (first.error) {
    return { ok: false, status: r.status, code: first.error?.data?.code ?? first.error?.code, data: null };
  }
  return { ok: true, status: r.status, code: null, data: first.result?.data ?? null };
}

// ---------- 指标 ----------
const metrics = { total: 0, ok: 0, fail: 0, latencies: [], byOp: {}, errors: {} };
function record(op, ms, ok, code) {
  metrics.total++;
  const b = metrics.byOp[op] ?? (metrics.byOp[op] = { count: 0, ok: 0, fail: 0, lats: [] });
  b.count++;
  if (ok) {
    metrics.ok++;
    b.ok++;
    b.lats.push(ms);
    metrics.latencies.push(ms);
  } else {
    metrics.fail++;
    b.fail++;
    if (code) metrics.errors[code] = (metrics.errors[code] || 0) + 1;
  }
}
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return Math.round(s[idx] * 100) / 100;
}

// ---------- 主流程 ----------
async function main() {
  log(`\n=== 启动 server（主，端口 ${PORT}）==="`);
  const mainSrv = startServer(PORT, { cors: '*' });
  const healthy = await waitHealth(PORT);
  if (!healthy) {
    log('❌ 主 server 健康探针超时');
    mainSrv.kill('SIGTERM');
    process.exit(2);
  }
  log('✅ 主 server /health 就绪');

  // ---------- 部署冒烟：注册一个用户并走通 tRPC 鉴权链路 ----------
  log(`\n=== 部署冒烟：tRPC 鉴权链路（端口 ${PORT}）===`);
  const reg = await trpc(PORT, 'auth.register', { email: `deploy_${Date.now()}@home.dev`, name: 'Deploy', password: 'secret123' });
  log(`  注册: ${reg.ok ? '✅' : '❌'} (code=${reg.code})`);
  const access = reg.data?.accessToken;
  const me = await trpc(PORT, 'auth.me', {}, access, 'GET');
  log(`  auth.me(持令牌, GET): ${me.ok ? '✅' : '❌'} (code=${me.code})`);
  const noAuth = await trpc(PORT, 'auth.me', {}, null, 'GET');
  log(`  auth.me(无令牌→401兜底): ${!noAuth.ok && (noAuth.code === 'UNAUTHORIZED' || noAuth.status === 401) ? '✅' : '⚠️'} (code=${noAuth.code})`);
  const tlist = await trpc(PORT, 'tasks.all', { limit: 10 }, access, 'GET');
  log(`  tasks.all(持令牌, GET): ${tlist.ok ? '✅' : '❌'} (code=${tlist.code})`);

  // ---------- 部署冒烟：WebSocket 鉴权 + 广播 ----------
  log(`\n=== 部署冒烟：WebSocket 鉴权 + 广播（端口 ${PORT}）===`);
  const wsFamily = await trpc(PORT, 'families.create', { name: 'WSSmoke' }, access);
  const familyId = wsFamily.data?.id;
  // 第二个用户用于接收广播
  const u2 = await trpc(PORT, 'auth.register', { email: `deploy2_${Date.now()}@home.dev`, name: 'Deploy2', password: 'secret123' });
  const access2 = u2.data?.accessToken;
  const inv = await trpc(PORT, 'families.invite', { familyId, role: 'member' }, access);
  await trpc(PORT, 'families.acceptInvite', { token: inv.data?.token }, access2);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, access2);
  let wsOpen = false;
  let received = null;
  await new Promise((resolve) => {
    ws.on('open', () => { wsOpen = true; resolve(); });
    ws.on('error', () => resolve());
    setTimeout(resolve, 10000);
  });
  log(`  WS 连接(持 access token, Sec-WebSocket-Protocol): ${wsOpen ? '✅' : '❌'}`);
  if (wsOpen) {
    const got = new Promise((resolve) => {
      ws.on('message', (d) => {
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'event') { received = m.event; resolve(m.event); }
        } catch {}
      });
    });
    await sleep(1000); // 等 familyOnline 刷新
    await trpc(PORT, 'sharedItems.upsert', {
      familyId,
      module: 'tasks',
      itemType: 'task',
      itemKey: 'ws-' + Date.now(),
      label: 'WS Item',
      snapshot: { title: 'broadcast-test' },
    }, access);
    received = await Promise.race([got, sleep(8000).then(() => null)]);
    log(`  WS 广播(sharedItems.updated 送达对端): ${received ? '✅' : '❌'}${received ? ' kind=' + received.kind : ''}`);
    ws.close();
  }

  // ---------- S3 CORS 校验：另起一个 server，CORS_ORIGIN 设为具体源 ----------
  log(`\n=== S3 CORS 校验（端口 ${PORT2}，CORS_ORIGIN=具体源）===`);
  const corsSrv = startServer(PORT2, { cors: 'http://localhost:5173', suffix: '2' });
  const h2 = await waitHealth(PORT2);
  if (h2) {
    const rAllow = await fetch(`http://127.0.0.1:${PORT2}/health`, { headers: { Origin: 'http://localhost:5173' } });
    const acaoAllow = rAllow.headers.get('access-control-allow-origin');
    const rEvil = await fetch(`http://127.0.0.1:${PORT2}/health`, { headers: { Origin: 'http://evil.com' } });
    const acaoEvil = rEvil.headers.get('access-control-allow-origin');
    log(`  合法源 → ACAO=${acaoAllow} ${acaoAllow === 'http://localhost:5173' ? '✅' : '❌'}`);
    log(`  非法源(evil.com) → ACAO=${acaoEvil} ${acaoEvil === 'http://localhost:5173' ? '✅(不回显攻击源/不为*)' : '❌'}`);
  } else {
    log('  ⚠️ CORS 校验 server 启动超时，跳过（见服务端子进程日志）');
  }
  corsSrv.kill('SIGTERM');

  // ---------- 压力测试：注册压测用户池 ----------
  log(`\n=== 压力测试准备：注册 ${POOL} 个用户 ===`);
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const email = `load_${Date.now()}_${i}@home.dev`;
    const pw = 'secret123';
    const reg = await trpc(PORT, 'auth.register', { email, name: `U${i}`, password: pw });
    if (reg.ok) pool.push({ email, password: pw, token: reg.data.accessToken });
  }
  log(`  可用压测身份：${pool.length}/${POOL}`);

  // ---------- 压力测试：混合负载 ----------
  log(`\n=== 压力测试：并发 ${CONCURRENCY}，时长 ${DURATION}s ===`);
  const memStart = sampleMem(mainSrv.pid);
  const end = Date.now() + DURATION * 1000;
  let inFlight = 0;
  function pump() {
    while (inFlight < CONCURRENCY && Date.now() < end) {
      inFlight++;
      const user = pool[Math.floor(Math.random() * pool.length)];
      doOp(user).finally(() => { inFlight--; });
    }
  }
  const iv = setInterval(pump, 5);
  pump();
  while (Date.now() < end || inFlight > 0) await sleep(50);
  clearInterval(iv);
  const memEnd = sampleMem(mainSrv.pid);

  // ---------- 汇总 ----------
  const dur = DURATION;
  const throughput = Math.round(metrics.total / dur);
  log(`\n=== 压力测试结果 ===`);
  log(`  总请求数: ${metrics.total}  成功: ${metrics.ok}  失败: ${metrics.fail}`);
  log(`  吞吐: ${throughput} req/s`);
  log(`  延迟(ms) p50=${pct(metrics.latencies, 50)} p95=${pct(metrics.latencies, 95)} p99=${pct(metrics.latencies, 99)} max=${metrics.latencies.length ? Math.max(...metrics.latencies).toFixed(1) : 0}`);
  log(`  错误率: ${metrics.total ? ((metrics.fail / metrics.total) * 100).toFixed(2) : 0}%`);
  log(`  错误分布: ${JSON.stringify(metrics.errors)}`);
  log('  分操作:');
  for (const [op, b] of Object.entries(metrics.byOp)) {
    log(`    ${op}: n=${b.count} ok=${b.ok} fail=${b.fail} p50=${pct(b.lats, 50)} p95=${pct(b.lats, 95)} p99=${pct(b.lats, 99)}`);
  }
  log(`  服务端内存(WorkingSet): 起始≈${memStart ? memStart.wsMB + 'MB' : 'N/A'} 结束≈${memEnd ? memEnd.wsMB + 'MB' : 'N/A'}`);

  mainSrv.kill('SIGTERM');
  await sleep(500);
  log('\n=== 完成 ===');
  process.exit(0);
}

async function doOp(user) {
  const roll = Math.random();
  let op, token, input, method;
  if (roll < 0.4) {
    op = 'tasks.create'; token = user.token; input = { title: `L-${Math.random().toString(36).slice(2, 8)}`, domainKey: 'work' }; method = 'POST';
  } else if (roll < 0.75) {
    op = 'tasks.all'; token = user.token; input = { limit: 50, offset: 0 }; method = 'GET';
  } else {
    op = 'auth.login'; token = null; input = { email: user.email, password: user.password }; method = 'POST';
  }
  const t0 = performance.now();
  try {
    const res = await trpc(PORT, op, input, token, method);
    record(op, performance.now() - t0, res.ok, res.code);
  } catch (e) {
    record(op, performance.now() - t0, false, 'NETERR');
  }
}

function sampleMem(pid) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-Process -Id ${pid} | Select-Object WorkingSet,CPU | ConvertTo-Json"`,
      { encoding: 'utf8' },
    );
    const j = JSON.parse(out);
    return { wsMB: Math.round((j.WorkingSet || 0) / 1048576), cpu: j.CPU };
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error('harness error', e);
  process.exit(2);
});
