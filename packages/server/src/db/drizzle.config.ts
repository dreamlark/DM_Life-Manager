import { defineConfig } from 'drizzle-kit';

// M2.1 —— drizzle-kit 配置（生成标准 Postgres 迁移脚本）
// 生成：npx drizzle-kit generate
// 执行迁移（真 Postgres）：DATABASE_URL=postgres://... npx drizzle-kit migrate
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  verbose: true,
  strict: true,
});
