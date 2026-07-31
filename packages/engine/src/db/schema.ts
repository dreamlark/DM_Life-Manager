import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  sqliteView,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/** 仅追加事件日志（仓库层禁止 UPDATE/DELETE） */
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: text('payload').notNull(),
    occurredAt: text('occurred_at').notNull(),
    causationId: text('causation_id'),
    correlationId: text('correlation_id'),
  },
  (t) => ({
    idxAgg: index('idx_events_agg').on(t.aggregateId),
    idxTypeTime: index('idx_events_type_t').on(t.type, t.occurredAt),
  }),
);

/** 8+1 领域（首启种子） */
export const domains = sqliteTable('domains', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  isQuarterFocus: integer('is_quarter_focus', { mode: 'boolean' }).notNull().default(false),
  color: text('color').notNull(),
  createdAt: text('created_at').notNull(),
});

/** PARA 项目/领域/资源/归档 */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  paraType: text('para_type', { enum: ['project', 'area', 'resource', 'archive'] }).notNull(),
  goalId: text('goal_id'),
  status: text('status', { enum: ['active', 'frozen', 'done'] }).notNull().default('active'),
  pdcaState: text('pdca_state'),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});

/** 任务（四象限坐标 + MIT） */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    domainKey: text('domain_key').notNull().references(() => domains.key),
    projectId: text('project_id').references(() => projects.id),
    importance: integer('importance', { mode: 'boolean' }).notNull().default(false),
    urgency: integer('urgency', { mode: 'boolean' }).notNull().default(false),
    isMit: integer('is_mit', { mode: 'boolean' }).notNull().default(false),
    mitOrder: integer('mit_order'),
    status: text('status', { enum: ['todo', 'doing', 'done', 'archived'] }).notNull().default('todo'),
    scheduledStart: text('scheduled_start'),
    scheduledEnd: text('scheduled_end'),
    dueAt: text('due_at'),
    description: text('description').notNull().default(''),
    priority: text('priority', { enum: ['low', 'medium', 'high'] }).notNull().default('medium'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
    /** MIT 完成质量（1-5 星）；null=未完成或跳过评分 */
    completionQuality: integer('completion_quality'),
    /** 注意力峰值：完成该任务时，绑定 flow 专注时段的最高评分（1-5）；null=无专注数据 */
    attentionPeak: integer('attention_peak'),
    /** 任务所属日期（YYYY-MM-DD）；每日例行模板为 null，实例为具体日期 */
    taskDate: text('task_date'),
    /** 重复规则 none / daily（每日例行按模板每日实例化） */
    repeat: text('repeat', { enum: ['none', 'daily'] }).notNull().default('none'),
    /** 每日例行实例的来源模板 id；非实例为 null */
    sourceDailyId: text('source_daily_id'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    idxDomain: index('idx_tasks_domain').on(t.domainKey, t.status),
    idxMit: index('idx_tasks_mit').on(t.isMit, t.mitOrder),
    idxDue: index('idx_tasks_due').on(t.dueAt),
    idxTaskDate: index('idx_tasks_date').on(t.taskDate),
    idxDaily: index('idx_tasks_daily').on(t.sourceDailyId, t.taskDate),
  }),
);

/**
 * 兴趣筛选器 / 灵感孵化器：捕捉进来的灵感、想读的文章、想学的技能。
 * 不直接进任务/笔记，先在此孵化，经审查后 验证/转化/归档/丢弃。
 */
export const interests = sqliteTable(
  'interests',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content'), // 原始内容（想法/链接/摘要）
    attention: integer('attention').notNull().default(1), // 初始关注度 1-3 星
    sourceType: text('source_type', { enum: ['project', 'thought', 'note', 'manual'] })
      .notNull()
      .default('manual'),
    sourceRef: text('source_ref'), // 触发它的项目/笔记 id
    domainKey: text('domain_key'), // 关联领域（用于匹配季度重点）
    effortBudget: text('effort_budget', { enum: ['30min', '3h', 'sustained', 'tbd'] })
      .notNull()
      .default('tbd'), // 投入精力预算预估
    status: text('status', {
      enum: ['incubating', 'validated', 'converted', 'archived', 'discarded'],
    })
      .notNull()
      .default('incubating'),
    linkedTaskId: text('linked_task_id'), // 验证时建的极小验证任务
    linkedProjectId: text('linked_project_id'), // 转化时建的 PARA 项目
    viewCount: integer('view_count').notNull().default(0), // 隐性关注度：反复查看次数
    linkedNoteCount: integer('linked_note_count').notNull().default(0), // 关联笔记数（隐性关注度代理）
    validatedAt: text('validated_at'),
    convertedAt: text('converted_at'),
    archivedAt: text('archived_at'),
    discardedAt: text('discarded_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    idxInterestStatus: index('idx_interest_status').on(t.status),
    idxInterestDomain: index('idx_interest_domain').on(t.domainKey),
  }),
);

/** 四象限视图（拖拽改 importance/urgency → 自动归类） */
export const taskQuadrant = sqliteView('task_quadrant').as((qb) =>
  qb
    .select({
      id: tasks.id,
      quadrant: sql<string>`CASE
        WHEN ${tasks.importance} = 1 AND ${tasks.urgency} = 1 THEN 'q1'
        WHEN ${tasks.importance} = 1 AND ${tasks.urgency} = 0 THEN 'q2'
        WHEN ${tasks.importance} = 0 AND ${tasks.urgency} = 1 THEN 'q3'
        ELSE 'q4' END`.as('quadrant'),
    })
    .from(tasks),
);

/** 笔记（KnowledgeBackend 摄入源）；kind 区分灵感/记事本，taskId 关联任务 */
export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    links: text('links'),
    tags: text('tags'),
    kind: text('kind', { enum: ['idea', 'notebook'] }).notNull().default('idea'),
    taskId: text('task_id').references(() => tasks.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    embeddedAt: text('embedded_at'),
    embedding: text('embedding'),
  },
  (t) => ({
    idxEmbedded: index('idx_notes_embedded').on(t.embeddedAt),
    idxNoteKind: index('idx_notes_kind').on(t.kind),
  }),
);

/* ============ 财务模块（P1） ============ */

/** 债务管理（对齐 life-manager：4 种还款方式 + 利率重定价 + 提前还款 + 续贷） */
export const debts = sqliteTable(
  'debts',
  {
    id: text('id').primaryKey(),
    creditor: text('creditor').notNull(),
    principal: real('principal').notNull(),
    apr: real('apr'),
    minPayment: real('min_payment'),
    dueDay: integer('due_day'),
    status: text('status', { enum: ['active', 'paid', 'frozen'] }).notNull().default('active'),
    // —— 新增（还款模型）——
    debtType: text('debt_type').notNull().default('other'),
    termMonths: integer('term_months'),
    repaymentMethod: text('repayment_method').notNull().default('equal_installment'),
    startDate: text('start_date'),
    rateType: text('rate_type'), // benchmark / lpr / fixed
    baseRate: real('base_rate'),
    rateSpread: real('rate_spread'),
    rateAdjustments: text('rate_adjustments'), // JSON 字符串
    prepayments: text('prepayments'), // JSON 字符串
    repricing: text('repricing'), // JSON 字符串：重定价规则（自动生成 rateAdjustments）
    parentDebtId: text('parent_debt_id'),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    idxDebtStatus: index('idx_debts_status').on(t.status),
  }),
);

/** 收入源（对齐 life-manager：月度均值 / 发放日 / 自动生流） */
export const incomes = sqliteTable(
  'incomes',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    amount: real('amount').notNull(),
    currency: text('currency').notNull().default('CNY'),
    receivedAt: text('received_at').notNull(),
    recurring: integer('recurring', { mode: 'boolean' }).notNull().default(false),
    note: text('note').notNull().default(''),
    // —— 新增（收入源模型）——
    incomeType: text('income_type').notNull().default('salary'),
    monthlyAvg: real('monthly_avg'),
    isFixed: integer('is_fixed', { mode: 'boolean' }).notNull().default(true),
    incomeMode: text('income_mode').notNull().default('monthly'), // monthly / single
    payDay: integer('pay_day'),
    adjustmentDay: integer('adjustment_day'),
    rateAdjustments: text('rate_adjustments'), // JSON 字符串
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    idxIncomeAt: index('idx_incomes_at').on(t.receivedAt),
  }),
);

/** 交易流水（对齐 life-manager：支持 debt_payment + 债务/收入源关联） */
export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['expense', 'income', 'debt_payment'] }).notNull(),
    category: text('category').notNull(),
    amount: real('amount').notNull(),
    merchant: text('merchant'),
    occurredAt: text('occurred_at').notNull(),
    note: text('note').notNull().default(''),
    debtId: text('debt_id'),
    incomeSourceId: text('income_source_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    idxTxnAt: index('idx_transactions_at').on(t.occurredAt),
    idxTxnKind: index('idx_transactions_kind').on(t.kind),
  }),
);

/** 资产总览（对齐 life-manager：fixed_asset / income_source + 关联收入源） */
export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    assetClass: text('asset_class', {
      enum: ['cash', 'investment', 'property', 'other', 'fixed_asset', 'income_source'],
    }).notNull(),
    value: real('value').notNull(),
    asOf: text('as_of').notNull(),
    linkedIncomeSourceId: text('linked_income_source_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    idxAssetClass: index('idx_assets_class').on(t.assetClass),
  }),
);

/** 预算（整体/分类月度支出限额；spent 等由引擎实时计算，不落库） */
export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    scope: text('scope', { enum: ['overall', 'category'] }).notNull().default('overall'),
    category: text('category'),
    monthlyLimit: real('monthly_limit').notNull(),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    idxBudgetScope: index('idx_budgets_scope').on(t.scope),
  }),
);

/* ============ 提醒钟表铺（P1） ============ */

/**
 * 人生钟表铺：每只「钟」管理一项非日常周期事务。
 * - 实体表只存当前状态（下次响铃 / 状态）；完成日志沉淀在 events 表（事件溯源）。
 * - lead_chain 以 JSON 字符串存储提前通知链（天）。
 */
export const reminderClocks = sqliteTable(
  'reminder_clocks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    domainKey: text('domain_key').notNull().references(() => domains.key),
    periodRule: text('period_rule').notNull(),
    leadChain: text('lead_chain').notNull().default('[7,1,0]'),
    noteLinked: text('note_linked'),
    nextFireAt: text('next_fire_at').notNull(),
    lastFiredAt: text('last_fired_at'),
    lastCompletedAt: text('last_completed_at'),
    status: text('status', { enum: ['active', 'due', 'overdue', 'done'] }).notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    idxReminderFire: index('idx_reminder_fire').on(t.nextFireAt, t.status),
  }),
);

/** 心流仪表盘：专注时段记录（认知资源管理系统的核心事实表） */
export const focusSessions = sqliteTable(
  'focus_sessions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').references(() => tasks.id),
    domainKey: text('domain_key').references(() => domains.key),
    projectId: text('project_id').references(() => projects.id),
    attentionType: text('attention_type', {
      enum: ['deep', 'shallow', 'passive', 'recovery'],
    })
      .notNull()
      .default('deep'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at').notNull(),
    score: integer('score'), // 1-5；null = 跳过评估
    energyStart: integer('energy_start'),
    energyEnd: integer('energy_end'),
    interruptions: text('interruptions').notNull().default('[]'), // JSON 数组 [{at,kind,reason?}]
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    idxFocusStarted: index('idx_focus_started').on(t.startedAt),
    idxFocusDomain: index('idx_focus_domain').on(t.domainKey),
    idxFocusProject: index('idx_focus_project').on(t.projectId),
    idxFocusTask: index('idx_focus_task').on(t.taskId),
  }),
);

/* ============ 金额互转（预留契约 P3） ============ */
/**
 * 一笔账户间转账：原子地从 from 借记、to 贷记（单一写路径内双写 events + 本表）。
 * - amount_minor：整数「分」，规避浮点误差。
 * - idempotency_key：唯一约束，重复提交返回首次结果，防网络重试造成重复转账。
 * - reversed / reversed_at：撤销标记（预留；当前不自动回滚手动余额）。
 */
export const financeTransfers = sqliteTable(
  'finance_transfers',
  {
    id: text('id').primaryKey(),
    fromAccountId: text('from_account_id').notNull(),
    toAccountId: text('to_account_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('CNY'),
    occurredAt: text('occurred_at').notNull(),
    note: text('note').notNull().default(''),
    idempotencyKey: text('idempotency_key').unique(),
    reversed: integer('reversed').notNull().default(0),
    reversedAt: text('reversed_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    idxTransferFrom: index('idx_transfer_from').on(t.fromAccountId),
    idxTransferTo: index('idx_transfer_to').on(t.toAccountId),
    idxTransferAt: index('idx_transfer_at').on(t.occurredAt),
  }),
);
