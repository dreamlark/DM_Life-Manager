// M2.1 —— 数据库工厂
// 运行时双方言：
//  - 生产：DATABASE_URL 以 postgres:// 开头 → postgres-js 连接真实 Postgres（表由 migrations/ 迁移建立）
//  - 开发/测试：默认文件模式（~/.dm-life/data，自动持久化）；可用 PGLITE_DIR 或 DATABASE_URL 覆盖，或通过 ~/.dm-life/config.json 的 pgliteDir 配置
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import * as schema from './schema';
import { ensureSchema } from './ensure';

type Db = PgliteDatabase<typeof schema>;

/**
 * 解析 PGLite 文件模式数据目录（按优先级）：
 *  1. DATABASE_URL 以 postgres:// 开头 → 返回 null（使用真实 Postgres，不走文件）
 *  2. 环境变量 PGLITE_DIR → 直接使用
 *  3. 配置文件 ~/.dm-life/config.json 的 pgliteDir 字段
 *  4. 默认 ~/.dm-life/data
 * PGlite 会自动创建不存在的目录。
 */
export function resolveDataDir(): string | null {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres://')) {
    return null;
  }
  if (process.env.PGLITE_DIR) return process.env.PGLITE_DIR;
  try {
    const cfgPath = join(homedir(), '.dm-life', 'config.json');
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as { pgliteDir?: string };
      if (cfg.pgliteDir) return cfg.pgliteDir;
    }
  } catch {
    /* 解析失败忽略，回落默认 */
  }
  return join(homedir(), '.dm-life', 'data');
}

let _db: Db | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pg: any = null;

/** 初始化并返回单例数据库实例；首次调用时按环境建立连接并建表 */
export async function initDb(): Promise<Db> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith('postgres://')) {
    const client = postgres(url, { max: 10 });
    // 查询构造接口与 PGlite 兼容，统一按 PGliteDatabase 类型暴露，简化 server 仓库的查询类型推导
    _db = drizzlePg(client, { schema }) as unknown as Db;
    // 生产环境表结构由 migrations/ 管理，不在此处 ensure，避免与迁移版本冲突
  } else {
    // 开发/测试：默认文件模式（~/.dm-life/data），重启后数据持久化；
    // 可通过 PGLITE_DIR 或 ~/.dm-life/config.json 的 pgliteDir 覆盖（为块3 UI 配置预留）
    const dir = resolveDataDir()!;
    // PGlite 的 nodefs 仅做非递归 mkdir；全新安装时父目录（如 ~/.dm-life）可能不存在，
    // 必须预先递归创建，否则 initDb 直接抛 ENOENT，导致服务在干净环境下无法启动（默认文件模式）。
    mkdirSync(dir, { recursive: true });
    _pg = new PGlite(dir);
    _db = drizzle(_pg, { schema });
    await ensureSchema(_db);
  }
  return _db;
}

/** 获取已初始化的数据库实例（未初始化时抛错，提醒先 await initDb()） */
export function getDb(): Db {
  if (!_db) throw new Error('数据库未初始化，请先 await initDb()');
  return _db;
}

/** 关闭连接（测试/进程退出时调用） */
export async function closeDb(): Promise<void> {
  if (_pg) {
    await _pg.close();
    _pg = null;
  }
  _db = null;
}
