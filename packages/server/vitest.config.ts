import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 在 router 模块加载前放宽限流阈值，避免无 IP 的直连测试撞上生产默认上限。
    setupFiles: ['./vitest.setup.ts'],
  },
});
