// dm-life All-in-One 编排器
// 在单个容器内以子进程方式拉起 engine + server，并由内置 caddy 统一对外暴露。
// 设计目标（对应最终方案的 P1）：一个容器、一个端口、零必填配置。
//
// - 缺失 JWT_SECRET / ENGINE_API_TOKEN 时自动生成并持久化到 /data/.env.auto（幂等）。
// - 任一子进程非预期退出 → 整体退出，由容器 restart 策略自愈。

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..', '..'); // 仓库根（容器内 /app）
const DATA_DIR = process.env.DM_LIFE_DATA_DIR || '/data';
const AUTO_ENV = join(DATA_DIR, '.env.auto');

// ---- 1. 密钥自生成（零必填配置） ----
mkdirSync(DATA_DIR, { recursive: true });
let auto = {};
if (existsSync(AUTO_ENV)) {
  for (const line of readFileSync(AUTO_ENV, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) auto[m[1]] = m[2];
  }
}
// S1（A02/A07）：若 JWT_SECRET / ENGINE_API_TOKEN 缺失或命中弱值，则（重新）生成强随机值并回写 .env.auto。
function isWeakSecret(s) {
  if (!s || s.length < 32) return true;
  if (/CHANGE_ME|insecure|example|password|secret|test|123|changeme/i.test(s)) return true;
  const uniq = new Set(s.split('')).size;
  if (uniq < 16) return true;
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] ?? 0) + 1;
  let entropy = 0;
  for (const c of Object.values(freq)) {
    const p = c / s.length;
    entropy -= p * Math.log2(p);
  }
  if (entropy < 3.5) return true;
  return false;
}
function genStrong() {
  return randomBytes(48).toString('base64');
}
function ensureSecret(key) {
  const cur = process.env[key] ?? auto[key];
  if (!cur || isWeakSecret(cur)) {
    const strong = genStrong();
    auto[key] = strong;
    process.env[key] = strong;
    console.log(`[allinone] ${key} 缺失或强度不足，已重新生成强随机值并回写 ${AUTO_ENV}`);
  } else {
    process.env[key] = cur;
  }
}
ensureSecret('JWT_SECRET');
ensureSecret('ENGINE_API_TOKEN');
// 把补齐后的密钥回写，保证重启幂等（已存在则原值不变）。
// 密钥文件以 0600 写入，避免宿主机卷上其他用户读到 JWT_SECRET / ENGINE_API_TOKEN。
const out = Object.entries(auto)
  .map(([k, v]) => `${k}=${v}`)
  .join('\n') + '\n';
writeFileSync(AUTO_ENV, out, { mode: 0o600 });
try {
  chmodSync(AUTO_ENV, 0o600);
} catch {
  /* 已写入 0600，chmod 仅兜底 */
}

// ---- 2. 启动子进程 ----
const children = [];
const boot = (name, cmd, args, env) => {
  const p = spawn(cmd, args, {
    cwd: APP_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[${name}] `;
  p.stdout.on('data', (d) => process.stdout.write(tag + d));
  p.stderr.on('data', (d) => process.stderr.write(tag + d));
  p.on('exit', (code, signal) => {
    console.error(`${tag}exited code=${code} signal=${signal}`);
    // 非预期退出：整体退出，交给容器 restart 自愈
    shutdown(1);
  });
  children.push({ name, p });
  return p;
};

console.log('[allinone] starting dm-life core services...');

// 统一后端（账户/家庭/个人域/共享/WS）——单后端，个人模式与协作模式共用
boot('server', 'npm', ['start', '-w', 'packages/server'], {
  NODE_ENV: 'production',
  PORT: '4100',
  PGLITE_DIR: DATA_DIR,
  // S3（A05）：默认不再用 '*'，改指前端真实源（可用 WEB_ORIGIN 覆盖）。同源经 caddy 反代时无需跨域。
  CORS_ORIGIN: process.env.WEB_ORIGIN || 'http://localhost:5173',
  // F2 修复：caddy 经 localhost 反代到 server，故仅信任来自 127.0.0.1 的 X-Forwarded-For，
  // 使登录/注册限流能拿到真实客户端 IP；直连 4100（无代理）则用 socket 真实地址。
  TRUST_PROXY_IPS: '127.0.0.1',
});

// 反向代理 + 静态托管 + 自动证书（caddy）
boot('caddy', 'caddy', ['run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], {});

// ---- 3. 优雅退出 ----
let shutting = false;
function shutdown(code = 0) {
  if (shutting) return;
  shutting = true;
  console.log(`[allinone] shutting down (${code})...`);
  for (const { p } of children) {
    try {
      p.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 3000);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
