import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Database, SqlValue } from 'sql.js';
import { sqlDb, dbPath, saveDb } from '../db/client';
import { getSchemaVersion } from '../db/migrate';
import { SCHEMA_VERSION, APP_VERSION, BUNDLE_FORMAT } from '../db/version';
import { config, dataDirConfigPath } from '../config';
import { logger } from '../logging';

/**
 * 可导出/导入的业务数据表（不含 `schema_meta` 等引擎内部簿记表，
 * 也排除 `task_quadrant` 视图——视图由 tasks 实时派生，无需导出）。
 */
export const KNOWN_TABLES = [
  'events',
  'domains',
  'projects',
  'tasks',
  'interests',
  'notes',
  'debts',
  'incomes',
  'transactions',
  'assets',
  'budgets',
  'reminder_clocks',
  'focus_sessions',
] as const;

type Row = Record<string, unknown>;
type TableMap = Record<string, Row[]>;

/** 导出/导入 bundle 的结构化定义（zod），供路由层做输入校验。 */
export const exportBundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  schemaVersion: z.number().int().nonnegative(),
  appVersion: z.string().optional(),
  exportedAt: z.string().optional(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
export type ExportBundle = z.infer<typeof exportBundleSchema>;

/* ----------------------------- 导出 ----------------------------- */

function dumpTable(name: string): Row[] {
  const res = sqlDb!.exec(`SELECT * FROM ${name}`);
  const first = res[0];
  if (!first) return [];
  const { columns, values } = first;
  return values.map((row) => {
    const obj: Row = {};
    columns.forEach((c, i) => (obj[c] = row[i]));
    return obj;
  });
}

/** 导出全部业务数据为标准化 JSON bundle（含格式/版本标识）。 */
export function exportAll(): ExportBundle {
  if (!sqlDb) throw new Error('数据库尚未初始化');
  const tables: TableMap = {};
  for (const name of KNOWN_TABLES) {
    tables[name] = dumpTable(name);
  }
  return {
    format: BUNDLE_FORMAT,
    schemaVersion: getSchemaVersion() || SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/* ----------------------------- 校验 ----------------------------- */

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * 导入前校验：格式标识、schema 版本（向后兼容——只接受 <= 当前版本的 bundle）、
 * 未知表拒绝、以及关键外键完整性检查（任务/提醒引用的领域必须存在）。
 */
export function validateBundle(bundle: ExportBundle): ValidationResult {
  if (bundle.format !== BUNDLE_FORMAT) {
    return { ok: false, error: '文件格式不被识别（format 字段缺失或错误）' };
  }
  if (typeof bundle.schemaVersion !== 'number' || !Number.isFinite(bundle.schemaVersion)) {
    return { ok: false, error: '缺少有效的 schemaVersion' };
  }
  if (bundle.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `导出文件来自更高版本（v${bundle.schemaVersion}），当前应用仅支持到 v${SCHEMA_VERSION}。请先升级应用后再导入。`,
    };
  }
  if (!bundle.tables || typeof bundle.tables !== 'object') {
    return { ok: false, error: '文件缺少 tables 数据' };
  }
  for (const key of Object.keys(bundle.tables)) {
    if (!KNOWN_TABLES.includes(key as (typeof KNOWN_TABLES)[number])) {
      return { ok: false, error: `包含未知数据表「${key}」，可能来自不兼容的版本` };
    }
    if (!Array.isArray(bundle.tables[key])) {
      return { ok: false, error: `数据表「${key}」格式错误（应为数组）` };
    }
  }

  // 关键外键完整性：任务 / 提醒引用的领域必须存在
  const domainKeys = new Set((bundle.tables.domains ?? []).map((d) => d.key));
  for (const t of bundle.tables.tasks ?? []) {
    if (t.domain_key != null && !domainKeys.has(t.domain_key)) {
      return { ok: false, error: `任务 ${String(t.id)} 引用的领域「${String(t.domain_key)}」在数据中不存在` };
    }
  }
  for (const r of bundle.tables.reminder_clocks ?? []) {
    if (r.domain_key != null && !domainKeys.has(r.domain_key)) {
      return { ok: false, error: `提醒 ${String(r.id)} 引用的领域「${String(r.domain_key)}」在数据中不存在` };
    }
  }

  return { ok: true };
}

/* ----------------------------- 导入 ----------------------------- */

function normalizeValue(v: unknown): SqlValue {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return (v as SqlValue) ?? null;
}

// 合法列名字符集（SQL 标识符白名单）：字母/下划线开头，仅含字母数字下划线。
// 用于阻断导入 bundle 中伪造列名导致的 SQL 注入（P1-3）。
const SAFE_COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function loadTable(name: string, rows: Row[]): void {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]!);
  if (!cols.length) return;
  // P1-3：任何列名不符合白名单即拒绝整批导入，杜绝 `); DROP ... --` 之类注入
  for (const c of cols) {
    if (!SAFE_COLUMN_RE.test(c)) {
      throw new Error(`导入数据包含非法列名「${c}」（仅允许字母/数字/下划线，且以字母或下划线开头），已拒绝导入以防注入`);
    }
  }
  const placeholders = cols.map(() => '?').join(',');
  const stmt = sqlDb!.prepare(
    `INSERT INTO ${name} (${cols.join(',')}) VALUES (${placeholders})`,
  );
  try {
    for (const r of rows) {
      stmt.run(cols.map((c) => normalizeValue(r[c])));
    }
  } finally {
    stmt.free();
  }
}

function backupCurrentDb(): string | null {
  if (!fs.existsSync(dbPath)) return null; // 文件尚未落盘（极少见），无备份必要
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.import-backup-${stamp}.db`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function restoreBackup(backupPath: string): void {
  try {
    if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, dbPath);
  } catch (e) {
    logger.error({ err: e }, 'failed to restore db backup after failed import');
  }
}

/** 仅保留最近 3 份导入备份（keep 本身 + 另外 2 份），避免备份文件无限堆积。 */
function pruneBackups(keep: string): void {
  try {
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    const keepName = path.basename(keep);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base + '.import-backup-') && f !== keepName)
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    files.slice(2).forEach((f) => fs.rmSync(f, { force: true }));
  } catch {
    /* 清理失败不致命 */
  }
}

export interface ImportResult {
  imported: Record<string, number>;
  backupPath: string | null;
  schemaVersion: number;
}

/**
 * 导入数据：先校验 → 备份当前库文件 → 事务内「清空 + 重插」全部业务表 → 落盘。
 * 任一环节失败：回滚事务 + 用备份文件恢复原数据 + 抛出清晰错误（满足需求#3/#4）。
 * 语义为「恢复」：用 bundle 整体替换当前业务数据（schema_meta 等簿记表不动）。
 */
export function importAll(input: unknown): ImportResult {
  // 1) 结构校验（zod）
  const parsed = exportBundleSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? '未知错误';
    throw new Error(`导入文件格式不合法：${msg}`);
  }
  const bundle = parsed.data;

  // 2) 业务/版本/完整性校验
  const v = validateBundle(bundle);
  if (!v.ok) throw new Error(`导入校验失败：${v.error}`);

  // 3) 备份当前库文件（数据保护，导入即用前先备份）
  const backupPath = backupCurrentDb();

  // 4) 事务内清空 + 重插，失败回滚 + 恢复备份
  sqlDb!.run('BEGIN TRANSACTION');
  try {
    sqlDb!.run('PRAGMA foreign_keys = OFF');
    for (const name of KNOWN_TABLES) {
      sqlDb!.run(`DELETE FROM ${name}`);
      loadTable(name, bundle.tables[name] ?? []);
    }
    // 重置为当前 schema 版本（bundle 只是数据，结构以当前引擎为准）
    sqlDb!.run(
      `INSERT INTO schema_meta(key, value) VALUES('schemaVersion', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(SCHEMA_VERSION)],
    );
    sqlDb!.run('PRAGMA foreign_keys = ON');
    sqlDb!.run('COMMIT');
  } catch (err) {
    sqlDb!.run('ROLLBACK');
    if (backupPath) restoreBackup(backupPath);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`数据导入失败（已回滚并恢复原数据）：${msg}`);
  }

  // 5) 落盘 + 清理旧备份
  saveDb();
  if (backupPath) pruneBackups(backupPath);

  const imported: Record<string, number> = {};
  for (const name of KNOWN_TABLES) imported[name] = (bundle.tables[name] ?? []).length;
  logger.info({ tables: imported }, 'data import completed');
  return { imported, backupPath, schemaVersion: SCHEMA_VERSION };
}

/* ----------------------------- 状态 ----------------------------- */

export interface DataStatus {
  dataDir: string;
  dbPath: string;
  exists: boolean;
  fileSizeBytes: number | null;
  schemaVersion: number;
  appVersion: string;
  bundleFormat: string;
  tableRowCounts: Record<string, number>;
}

/** 数据状态：目录、文件大小、schema 版本、各表行数（供设置页展示 + 导入前核对）。 */
export function dataStatus(): DataStatus {
  const exists = fs.existsSync(dbPath);
  const fileSizeBytes = exists ? fs.statSync(dbPath).size : null;

  const tableRowCounts: Record<string, number> = {};
  if (sqlDb) {
    for (const name of KNOWN_TABLES) {
      try {
        const res = sqlDb.exec(`SELECT COUNT(*) AS c FROM ${name}`);
        const r = res[0];
        if (r && r.values.length) {
          const row = r.values[0];
          tableRowCounts[name] = row && row.length ? Number(row[0]) : 0;
        } else {
          tableRowCounts[name] = 0;
        }
      } catch {
        tableRowCounts[name] = 0;
      }
    }
  }

  return {
    dataDir: config.dataDir,
    dbPath,
    exists,
    fileSizeBytes,
    schemaVersion: getSchemaVersion() || SCHEMA_VERSION,
    appVersion: APP_VERSION,
    bundleFormat: BUNDLE_FORMAT,
    tableRowCounts,
  };
}

/* --------------------------- 自定义数据目录 --------------------------- */

/**
 * 设置自定义数据目录（供「设置 → 数据目录」调用）。
 * - 校验：必须是非空绝对路径，且不同于当前目录（避免无意义写入）。
 * - 写入覆盖配置文件 datadir.json（位于默认用户数据目录内），引擎下次启动时由 config 读取生效。
 * - 不立即移动数据库：避免运行时重开 DB 引发损坏；迁移在下次启动 initDb 时安全复制完成。
 * 返回最终生效的（相对本次请求的）目录字符串。
 */
export function setCustomDataDir(dir: string): { dataDir: string; restartRequired: true } {
  const clean = (dir ?? '').trim();
  if (!clean) throw new Error('数据目录不能为空');
  if (!path.isAbsolute(clean)) throw new Error('数据目录必须是绝对路径');
  // P2-11：拒绝路径遍历（如 /data/../../etc），仅允许规范绝对路径
  if (clean.includes('..') || clean !== path.resolve(clean)) {
    throw new Error('数据目录包含非法路径片段（不允许 .. 或非规范路径）');
  }
  if (clean === config.dataDir) {
    // 与当前一致：视为无操作，但仍返回成功（无需重启）
    return { dataDir: config.dataDir, restartRequired: true };
  }
  // 确保目标目录可写（递归创建），提前暴露权限/路径错误
  fs.mkdirSync(clean, { recursive: true });
  const cfgPath = dataDirConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ dataDir: clean }, null, 2), 'utf-8');
  logger.info({ dataDir: clean, configPath: cfgPath }, 'custom data directory saved (applies after restart)');
  return { dataDir: clean, restartRequired: true };
}
