import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 联机版 Web 开发服务器：将 /trpc、/ws、/health 代理到统一后端 server（默认 4100，可用 VITE_SERVER_PORT 覆盖）。
// 个人域已整体迁移到 server，不再有独立的 engine 进程。
const SERVER_PORT = Number(process.env.VITE_SERVER_PORT || 4100);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/trpc': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
      },
      // 健康检查：用于 BackendGate 判断协作服务是否已初始化完成
      '/health': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
      },
      // 实时网关：把 WebSocket 升级也代理到协作服务（ws:true 必须）
      '/ws': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
