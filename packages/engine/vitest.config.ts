import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 每个测试文件在独立 worker 进程运行前先分配唯一临时数据目录，杜绝跨文件 db 污染
    setupFiles: ['./vitest.setup.ts'],
  },
});
