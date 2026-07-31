// 真实 HTTP 层压力脚本：启动 server（tsx），并发打 /api/version 与 /health，
// 验证限流中间件、版本/升级接口在并发下稳定且延迟可控。用完后 kill 进程树，避免孤儿端口。
// 用法：node scripts/stress-http.mjs [并发数] [每类请求数]
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4199;
const BASE = `http://localhost:${PORT}`;
const CONCURRENCY = Number(process.argv[2] ?? 200);
const PER_KIND = Number(process.argv[3] ?? 400);
const PGLITE_DIR = mkdtempSync(join(tmpdir(), 'dm-life-http-stress-'));

/** 按监听端口杀进程（含 /T 子树），兜底清理 npx/tsx 派生的孤儿 node 服务，避免残留端口占用。 */
function killByPort(port) {
  try {
    const out = execSync(`netstat -ano 2>nul | findstr :${port}`).toString();
    const pids = new Set();
    for (const line of out.split('\n')) {
      const m = line.trim().match(new RegExp(`^\\S+\\s+\\S+:${port}\\s+\\S+:\\S+\\s+LISTENING\\s+(\\d+)`));
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) {
      try {
        spawn('taskkill', ['/F', '/T', '/PID', pid], { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function killTree(pid) {
  try {
    spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  killByPort(PORT); // 兜底：npx/tsx 派生的 node 服务可能不在 child.pid 子树内
}

async function waitHealth(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status === 200) return true;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function hit(path) {
  const s = Date.now();
  try {
    const r = await fetch(`${BASE}${path}`);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, ms: Date.now() - s };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - s, err: String(e) };
  }
}

async function main() {
  const child = spawn('npx', ['tsx', 'src/http-server.ts'], {
    cwd: join(process.cwd(), 'packages', 'server'),
    env: { ...process.env, PORT: String(PORT), PGLITE_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  let serverLog = '';
  child.stdout?.on('data', (d) => (serverLog += d));
  child.stderr?.on('data', (d) => (serverLog += d));

  const ready = await waitHealth();
  if (!ready) {
    console.error('[stress-http] 服务未在超时内就绪。日志:\n' + serverLog);
    killTree(child.pid);
    process.exit(1);
  }
  console.log(`[stress-http] 服务就绪（PGLITE_DIR=${PGLITE_DIR}）`);

  const paths = [];
  for (let i = 0; i < PER_KIND; i++) paths.push('/api/version');
  for (let i = 0; i < PER_KIND; i++) paths.push('/health');

  // 分批并发，控制同时 in-flight 数量，避免压垮本机 fetch 连接池
  const results = [];
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map((p) => hit(p)))));
  }

  killTree(child.pid);

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : 0);
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  console.log('===== /api/version + /health 并发压测结果 =====');
  console.log(`请求总数: ${results.length}（/api/version ${PER_KIND} + /health ${PER_KIND}，并发度 ${CONCURRENCY}）`);
  console.log(`成功(2xx): ${ok}  失败: ${fail}`);
  console.log(`状态码分布: ${JSON.stringify(byStatus)}`);
  console.log(`延迟(ms) min=${lat[0]} p50=${pct(0.5)} p95=${pct(0.95)} p99=${pct(0.99)} max=${lat[lat.length - 1]}`);
  console.log('==============================================');
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
