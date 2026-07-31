import type { Database } from 'sql.js';
import { sqlDb } from './client';
import { SCHEMA_VERSION } from './version';
import { logger } from '../logging';

/**
 * 单条结构性迁移：升级到 `version` 所需执行的 DDL/DML。
 * `up` 允许抛错——`migrate()` 会在事务内捕获并整体回滚，绝不残留半吊子结构。
 */
export interface MigrationStep {
  version: number;
  name: string;
  up: (db: Database) => void;
}

/**
 * 基准 DDL（首启建表，幂等 `IF NOT EXISTS`）。P0 用原生 DDL 而非 drizzle-kit push，
 * 以保证启动时自包含、零额外步骤。**全程不含任何 DROP / 覆盖写**，保证更新程序不丢失数据。
 */
const BASELINE_DDL = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  causation_id TEXT,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_agg ON events(aggregate_id);
CREATE INDEX IF NOT EXISTS idx_events_type_t ON events(type, occurred_at);

CREATE TABLE IF NOT EXISTS domains (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_quarter_focus INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  para_type TEXT NOT NULL,
  goal_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  pdca_state TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  domain_key TEXT NOT NULL REFERENCES domains(key),
  project_id TEXT REFERENCES projects(id),
  importance INTEGER NOT NULL DEFAULT 0,
  urgency INTEGER NOT NULL DEFAULT 0,
  is_mit INTEGER NOT NULL DEFAULT 0,
  mit_order INTEGER,
  status TEXT NOT NULL DEFAULT 'todo',
  scheduled_start TEXT,
  scheduled_end TEXT,
  due_at TEXT,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  completion_quality INTEGER,
  attention_peak INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks(domain_key, status);
CREATE INDEX IF NOT EXISTS idx_tasks_mit ON tasks(is_mit, mit_order);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  links TEXT,
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  embedded_at TEXT,
  embedding TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_embedded ON notes(embedded_at);

CREATE TABLE IF NOT EXISTS interests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  attention INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  domain_key TEXT,
  effort_budget TEXT NOT NULL DEFAULT 'tbd',
  status TEXT NOT NULL DEFAULT 'incubating',
  linked_task_id TEXT,
  linked_project_id TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  linked_note_count INTEGER NOT NULL DEFAULT 0,
  validated_at TEXT,
  converted_at TEXT,
  archived_at TEXT,
  discarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interest_status ON interests(status);
CREATE INDEX IF NOT EXISTS idx_interest_domain ON interests(domain_key);

CREATE VIEW IF NOT EXISTS task_quadrant AS
SELECT id,
  CASE WHEN importance = 1 AND urgency = 1 THEN 'q1'
       WHEN importance = 1 AND urgency = 0 THEN 'q2'
       WHEN importance = 0 AND urgency = 1 THEN 'q3'
       ELSE 'q4' END AS quadrant
FROM tasks;

CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  creditor TEXT NOT NULL,
  principal REAL NOT NULL,
  apr REAL,
  min_payment REAL,
  due_day INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);

CREATE TABLE IF NOT EXISTS incomes (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  received_at TEXT NOT NULL,
  recurring INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incomes_at ON incomes(received_at);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  merchant TEXT,
  occurred_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_at ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_kind ON transactions(kind);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  value REAL NOT NULL,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_class ON assets(asset_class);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'overall',
  category TEXT,
  monthly_limit REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budgets_scope ON budgets(scope);

CREATE TABLE IF NOT EXISTS reminder_clocks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  domain_key TEXT NOT NULL REFERENCES domains(key),
  period_rule TEXT NOT NULL,
  lead_chain TEXT NOT NULL DEFAULT '[7,1,0]',
  note_linked TEXT,
  next_fire_at TEXT NOT NULL,
  last_fired_at TEXT,
  last_completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminder_fire ON reminder_clocks(next_fire_at, status);

-- 心流仪表盘：专注时段记录（认知资源管理）
CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  domain_key TEXT REFERENCES domains(key),
  project_id TEXT REFERENCES projects(id),
  attention_type TEXT NOT NULL DEFAULT 'deep',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  score INTEGER,
  energy_start INTEGER,
  energy_end INTEGER,
  interruptions TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_started ON focus_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_focus_domain ON focus_sessions(domain_key);
CREATE INDEX IF NOT EXISTS idx_focus_project ON focus_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_focus_task ON focus_sessions(task_id);

-- 金额互转（预留契约 P3）：from/to 账户间原子转账记录
CREATE TABLE IF NOT EXISTS finance_transfers (
  id TEXT PRIMARY KEY,
  from_account_id TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  occurred_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT UNIQUE,
  reversed INTEGER NOT NULL DEFAULT 0,
  reversed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfer_from ON finance_transfers(from_account_id);
CREATE INDEX IF NOT EXISTS idx_transfer_to ON finance_transfers(to_account_id);
CREATE INDEX IF NOT EXISTS idx_transfer_at ON finance_transfers(occurred_at);
`;

/**
 * 未来结构性迁移登记处（当前 SCHEMA_VERSION=1，暂无待执行步骤）。
 * 后续发布变更时，在此追加（务必按 version 升序，且 `up` 仅做**增量**变更——
 * 新增列用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 风格、新建表用 `IF NOT EXISTS`）：
 *
 *   { version: 2, name: 'add_project_color', up: (db) => {
 *       db.run("ALTER TABLE projects ADD COLUMN color TEXT");
 *   } },
 */
export const MIGRATIONS: MigrationStep[] = [];

/** 读取当前库记录的 schema 版本（无记录视为 0，即「全新/旧版库」）。 */
export function getSchemaVersion(): number {
  try {
    const rows = sqlDb!.exec("SELECT value FROM schema_meta WHERE key='schemaVersion'");
    const first = rows[0];
    if (first && first.values.length) {
      const row = first.values[0];
      if (row && row.length) {
        const v = Number(row[0]);
        return Number.isFinite(v) ? v : 0;
      }
    }
  } catch {
    /* schema_meta 尚未创建 → 返回 0（下方 migrate 会先建表） */
  }
  return 0;
}

function setSchemaVersion(v: number): void {
  sqlDb!.run(
    `INSERT INTO schema_meta(key, value) VALUES('schemaVersion', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(v)],
  );
}

/** 仅在列不存在时 ALTER，避免重复列报错中断启动（非破坏性，兼容旧库）。 */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  try {
    sqlDb!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {
    /* 列已存在 → 跳过 */
  }
}

export function migrate(): void {
  if (!sqlDb) throw new Error('initDb() 必须先于 migrate() 调用');

  // schema_meta 自身也用 IF NOT EXISTS 创建，绝不破坏既有数据
  sqlDb.run('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  // 整库迁移包裹在单一事务：任一环节失败 → 回滚到迁移前状态，绝不残留半吊子结构。
  // 这同时保证了「需求#4 数据迁移失败时回滚并提示用户」。
  sqlDb.run('BEGIN TRANSACTION');
  try {
    // 1) 基准建表（全部 IF NOT EXISTS → 对已有库是幂等的，等价于「升级结构」）
    sqlDb.run(BASELINE_DDL);

    // 2) 存量库增量补列：notes 增加 kind / task_id / embedding / embedded_at（已存在则忽略报错）
    //    历史基线 DDL 后续补过 embedding/embedded_at，但 CREATE TABLE IF NOT EXISTS 不会给旧库补列，
    //    导致旧库新建/保存 notes 时报 `table notes has no column named embedding`。
    addColumnIfMissing('notes', 'kind', "TEXT NOT NULL DEFAULT 'idea'");
    addColumnIfMissing('notes', 'task_id', 'TEXT');
    addColumnIfMissing('notes', 'embedding', 'TEXT');
    addColumnIfMissing('notes', 'embedded_at', 'TEXT');
    // MIT 完成回写：tasks 增加完成质量 / 注意力峰值
    addColumnIfMissing('tasks', 'completion_quality', 'INTEGER');
    addColumnIfMissing('tasks', 'attention_peak', 'INTEGER');
    // 日历/看板：tasks 增加描述 / 优先级
    addColumnIfMissing('tasks', 'description', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing('tasks', 'priority', "TEXT NOT NULL DEFAULT 'medium'");
    // 任务日期 + 每日例行：task_date / repeat / source_daily_id
    addColumnIfMissing('tasks', 'task_date', 'TEXT');
    addColumnIfMissing('tasks', 'repeat', "TEXT NOT NULL DEFAULT 'none'");
    addColumnIfMissing('tasks', 'source_daily_id', 'TEXT');

    // —— 财务模块对齐 life-manager（增量补列，兼容旧库）——
    // 债务：还款模型
    addColumnIfMissing('debts', 'debt_type', "TEXT NOT NULL DEFAULT 'other'");
    addColumnIfMissing('debts', 'term_months', 'INTEGER');
    addColumnIfMissing('debts', 'repayment_method', "TEXT NOT NULL DEFAULT 'equal_installment'");
    addColumnIfMissing('debts', 'start_date', 'TEXT');
    addColumnIfMissing('debts', 'rate_type', 'TEXT');
    addColumnIfMissing('debts', 'base_rate', 'REAL');
    addColumnIfMissing('debts', 'rate_spread', 'REAL');
    addColumnIfMissing('debts', 'rate_adjustments', 'TEXT');
    addColumnIfMissing('debts', 'prepayments', 'TEXT');
    addColumnIfMissing('debts', 'parent_debt_id', 'TEXT');
    addColumnIfMissing('debts', 'note', "TEXT NOT NULL DEFAULT ''");
    // P0-1 重定价规则自动化
    addColumnIfMissing('debts', 'repricing', 'TEXT');
    // 收入源模型
    addColumnIfMissing('incomes', 'income_type', "TEXT NOT NULL DEFAULT 'salary'");
    addColumnIfMissing('incomes', 'monthly_avg', 'REAL');
    addColumnIfMissing('incomes', 'is_fixed', 'INTEGER NOT NULL DEFAULT 1');
    addColumnIfMissing('incomes', 'income_mode', "TEXT NOT NULL DEFAULT 'monthly'");
    addColumnIfMissing('incomes', 'pay_day', 'INTEGER');
    addColumnIfMissing('incomes', 'adjustment_day', 'INTEGER');
    addColumnIfMissing('incomes', 'rate_adjustments', 'TEXT');
    // 交易流水：债务关联
    addColumnIfMissing('transactions', 'debt_id', 'TEXT');
    addColumnIfMissing('transactions', 'income_source_id', 'TEXT');
    // 资产：关联收入源
    addColumnIfMissing('assets', 'linked_income_source_id', 'TEXT');

    // 3) 执行所有「版本 > 当前库版本」的待迁移步骤（按 version 升序）
    const current = getSchemaVersion();
    const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
    for (const step of pending) {
      step.up(sqlDb);
      logger.info({ version: step.version, name: step.name }, 'applied schema migration step');
    }

    // 4) 记录当前 schema 版本（基线 DDL 的 IF NOT EXISTS 已让旧库安全达到 v1）
    setSchemaVersion(SCHEMA_VERSION);

    sqlDb.run('COMMIT');
    logger.info({ schemaVersion: SCHEMA_VERSION }, 'database migration committed');
  } catch (err) {
    sqlDb.run('ROLLBACK');
    const msg = err instanceof Error ? err.message : String(err);
    // 抛出清晰、面向用户可理解的回滚提示
    throw new Error(`数据库迁移失败（已安全回滚，数据未被修改）：${msg}`);
  }
}
