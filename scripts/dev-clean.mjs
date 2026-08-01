/**
 * dev:clean — 一键杀掉当前 dev 的孤儿进程（server + web-collab）。
 *
 * 为什么需要：沙箱/开发中 `tsx watch` 起的 server 或 vite 进程会跨会话成为孤儿，
 * 占用 4100 / 5173 端口杀不掉，导致新 dev 只能换端口，前端连旧版就报
 * "No procedure found on path 'tasks.delete'" 之类的错。
 *
 * 使用：`npm run dev:clean`
 * 不传参数：列出所有 dev 相关 node/npm 进程，提示确认。
 * -y  / --yes：直接 kill 全部 dev 进程，不询问。
 */
import { execSync } from 'node:child_process';
import * as os from 'node:os';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

const PLATFORM = os.platform();

function sh(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

function listNodeProcs() {
  if (PLATFORM === 'win32') {
    // WMIC 在新版 Windows 不可用，回退到 PowerShell
    const out = sh(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"',
    );
    if (!out.trim()) return [];
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .filter((p) => p && p.CommandLine)
      .map((p) => ({ pid: Number(p.ProcessId), cmd: String(p.CommandLine) }));
  }
  // POSIX: 用 ps
  const out = sh("ps -eo pid,command -ww | grep -E 'node\\b|npm\\b' | grep -v grep || true");
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), cmd: m[2] } : null;
    })
    .filter((x) => !!x);
}

function isDevProc(cmd) {
  // 匹配单后端本地联机 dev 进程：server(:4100) 或 web-collab(:5173)
  return /packages[\\\/]server|@dm-life[\\\/]server|packages[\\\/]web-collab|@dm-life[\\\/]web-collab/.test(cmd);
}

function killProc(pid) {
  try {
    if (PLATFORM === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

function doKill(procs) {
  let ok = 0;
  let fail = 0;
  for (const p of procs) {
    if (killProc(p.pid)) {
      console.log(`  killed PID ${p.pid}`);
      ok++;
    } else {
      console.log(`  failed to kill PID ${p.pid}`);
      fail++;
    }
  }
  console.log(`[dev:clean] done. killed=${ok} failed=${fail}. ports 4100 / 5173 should be free now.`);
  console.log('  next: npm run dev');
  // 给 Windows 一点时间释放端口
  if (PLATFORM === 'win32') setTimeout(() => process.exit(0), 300);
  else process.exit(0);
}

const args = process.argv.slice(2);
const force = args.includes('-y') || args.includes('--yes');

const procs = listNodeProcs().filter((p) => isDevProc(p.cmd));

if (procs.length === 0) {
  console.log('[dev:clean] no dev processes found. ports 4100 / 5173 should be free.');
  process.exit(0);
}

console.log(`[dev:clean] found ${procs.length} dev process(es):`);
for (const p of procs) {
  // 截断过长的命令行展示
  const snippet = p.cmd.length > 100 ? p.cmd.slice(0, 97) + '...' : p.cmd;
  console.log(`  PID ${p.pid}  ${snippet}`);
}

if (!force) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Kill all? (y/N) ', (ans) => {
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('[dev:clean] cancelled.');
      process.exit(0);
    }
    doKill(procs);
  });
} else {
  doKill(procs);
}
