import { createRequire } from 'node:module';

/**
 * 当前数据库 schema 版本。
 * 每次发布结构性变更（新增表/列、修改约束）时 +1，并配套在
 * `migrate.ts` 的 MIGRATIONS 中登记一个 `{ version, name, up }` 步骤。
 * 升级时引擎会自动按版本顺序执行待迁移步骤，并保证事务内原子回滚。
 */
export const SCHEMA_VERSION = 1;

/** 导出/导入 bundle 的格式标识（用于校验文件来源）。 */
export const BUNDLE_FORMAT = 'dm-life-export';

/**
 * 应用版本（与 engine package.json 对齐）。
 * 用于导出文件头（appVersion）与「设置 → 关于」页展示。
 * 优先从 package.json 读取，读取失败则回退到内置字面量。
 */
let resolvedAppVersion = '1.0.0';
try {
  const require = createRequire(import.meta.url);
  const pkg = require('../../package.json') as { version?: string };
  if (pkg?.version) resolvedAppVersion = pkg.version;
} catch {
  /* 回退：保持与 engine package.json 的 version 字段一致 */
}
export const APP_VERSION = resolvedAppVersion;
