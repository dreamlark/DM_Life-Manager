// 本地联机开发一键启动：同时拉起「统一后端 server」+「联机前端 web-collab」。
// 旧的根脚本（dev:engine / dev:web / dev:all）面向桌面单机架构（engine + Tauri），
// 没有浏览器界面；本脚本对应 README §2 的本地联机路径，避免误敲 `npm run dev` 踩空。
import { spawn } from 'node:child_process';

const PROCS = [
  { name: 'server', args: ['run', 'dev', '-w', '@dm-life/server'] },
  { name: 'web', args: ['run', 'dev', '-w', '@dm-life/web-collab'] },
];

// 解析 npm 命令：优先用 npm 调起本脚本时注入的 npm_execpath（最稳，跨平台且不受 PATH 影响）；
// 否则回退到平台默认命令（用户本机直接 `npm run dev` 时走此分支）。
const npmExecPath = process.env.npm_execpath;
let NPM_CMD;
let NPM_PREFIX = [];
if (npmExecPath && /\.js$/i.test(npmExecPath)) {
  NPM_CMD = process.execPath; // 用当前 node 跑 npm-cli.js
  NPM_PREFIX = [npmExecPath];
} else if (npmExecPath) {
  NPM_CMD = npmExecPath; // e.g. npm.cmd
} else {
  NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

const children = PROCS.map((p) => {
  const child = spawn(NPM_CMD, [...NPM_PREFIX, ...p.args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${p.name}]`;
  child.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));
  child.on('exit', (code) => {
    process.stderr.write(`${tag} 进程退出，code=${code}\n`);
    shutdown();
  });
  return child;
});

function shutdown() {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* 已退出，忽略 */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[dev] 启动本地联机开发：server(:4100) + web-collab(:5173)');
console.log('[dev] 浏览器打开 http://127.0.0.1:5173  按 Ctrl+C 退出');
