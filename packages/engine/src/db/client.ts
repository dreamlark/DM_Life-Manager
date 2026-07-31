import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import initSqlJs, { type Database } from 'sql.js';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import * as schema from './schema';
import { config, getDefaultDataDir } from '../config';
import { logger } from '../logging';

/** 解析数据库文件路径：放在 config.dataDir 下（默认已是操作系统用户数据目录，与安装目录隔离） */
function resolveDbPath(): string {
  return path.join(config.dataDir, 'dm-life.db');
}

/**
 * 旧版默认路径（引擎包内 data/）。用于数据迁移：当新路径尚无文件、
 * 但旧路径存在时，自动复制过来，避免「改了默认路径后旧数据凭空消失」。
 */
const LEGACY_DB_PATH = fileURLToPath(new URL('../../data/dm-life.db', import.meta.url));

export const dbPath = resolveDbPath();

let sqlDb: Database | undefined;
// 初始化后赋值；消费方（repo/command）通过 ESM live binding 拿到初始化后的实例
let db: SQLJsDatabase<typeof schema>;

/**
 * 异步初始化数据库。sql.js 是纯 WASM，无需原生编译，沙箱/CI 直接可用。
 * 若文件已存在则加载，否则新建内存库（后续由 migrate 建表 + seed 种子）。
 */
const require = createRequire(import.meta.url);

export async function initDb(): Promise<void> {
  // 显式定位 wasm，避免 ESM/vitest 下 sql.js 默认 locateFile 找不到文件
  let locateFile: (file: string) => string;
  try {
    const wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
    locateFile = () => wasm;
  } catch {
    locateFile = (file) => file;
  }
  const SQL = await initSqlJs({ locateFile });

  // 数据迁移：新路径尚无文件，但旧版安装目录内的 db 存在 → 复制过来，保留历史数据。
  // 测试环境下跳过：避免把开发/冒烟产生的旧 data/dm-life.db 误当成真实用户数据迁移进来，
  // 否则测试 beforeAll 删除新路径后又被迁移逻辑塞回旧的脏数据，导致断言失败。
  const isTest = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
  if (!isTest && !fs.existsSync(dbPath) && fs.existsSync(LEGACY_DB_PATH)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.copyFileSync(LEGACY_DB_PATH, dbPath);
    logger.info({ from: LEGACY_DB_PATH, to: dbPath }, 'migrated database to persistent data directory');
  }

  // 自定义数据目录迁移：用户通过「设置 → 数据目录」改了保存位置后，重启首次启动时
  // 若新目录尚无 db、但默认用户数据目录（上一处）有 db，则安全复制过来，避免改路径导致旧数据“凭空消失”。
  // 测试环境跳过，避免把开发/冒烟产生的旧数据误当真实用户数据迁移。
  const defaultDbPath = path.join(getDefaultDataDir(), 'dm-life.db');
  if (
    !isTest &&
    !process.env.DM_LIFE_DATA_DIR &&
    config.dataDir !== getDefaultDataDir() &&
    !fs.existsSync(dbPath) &&
    fs.existsSync(defaultDbPath)
  ) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.copyFileSync(defaultDbPath, dbPath);
    logger.info({ from: defaultDbPath, to: dbPath }, 'migrated database to custom data directory');
  }

  if (fs.existsSync(dbPath)) {
    sqlDb = new SQL.Database(fs.readFileSync(dbPath));
    logger.info({ dbPath }, 'database loaded from disk');
  } else {
    sqlDb = new SQL.Database();
    logger.info({ dbPath }, 'database created in memory (will persist on first write)');
  }
  db = drizzle(sqlDb, { schema });
}

/** 将内存库导出为文件（sql.js 必须显式调用，否则数据只存在于内存） */
export function saveDb(): void {
  if (!sqlDb) return;
  const data = sqlDb.export();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(data));
}

/**
 * 单一写路径：事务内双写（events + 实体）→ 提交 → 显式落盘。
 * sql.js 是内存库，必须在事务成功后 export 才能保证持久化（ADR-002）。
 */
export function writeTx<T>(fn: () => T): T {
  const result = db.transaction(fn);
  saveDb();
  return result;
}

export { db, sqlDb };
