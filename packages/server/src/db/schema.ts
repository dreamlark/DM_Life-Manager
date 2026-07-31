// M2.1 —— 家庭协作系统 Postgres schema（drizzle-orm/pg-core）
// 全部个人域表以 family_id 作为数据隔离锚点（双写过渡期保留），并新增 zone 列：
//   owner_id / visibility / version / last_edited_by
// 读过滤改用 zone：(owner_id = 调用者 OR visibility = 'public')；写私区需 owner 匹配。
// 外键级联保证成员/邀请/会话随家庭或用户清理。
import { pgTable, uuid, text, timestamp, boolean, index, unique, jsonb, numeric, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
});

export const families = pgTable('families', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  kind: text('kind').notNull().default('personal'), // 'personal' | 'shared'
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // owner | admin | member | child | guest
    joinedAt: timestamp('joined_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    familyUserUniq: unique('memberships_family_user_uniq').on(t.familyId, t.userId),
    familyIdx: index('memberships_family_idx').on(t.familyId),
    userIdx: index('memberships_user_idx').on(t.userId),
  }),
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    role: text('role').notNull(),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }).notNull(),
  },
  (t) => ({
    familyIdx: index('invitations_family_idx').on(t.familyId),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshToken: text('refresh_token').notNull().unique(),
    expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }).notNull(),
  },
  (t) => ({
    refreshIdx: index('sessions_refresh_idx').on(t.refreshToken),
  }),
);

// ===== 共享日历（家庭共享日程） =====
// 设计见 family-collab-design.md §3.2 / §5.3：以 family_id 隔离，所有成员可见；
// createEvent 覆盖 owner/admin/member/child，editEvent 覆盖 owner/admin/member（删除仅创建人或 owner/admin）。
// P1：新增 owner_id / visibility / version(integer) / last_edited_by 以支持 zone 分区 + 乐观锁。
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startAt: timestamp('start_at', { mode: 'string', withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { mode: 'string', withTimezone: true }),
    allDay: boolean('all_day').notNull().default(false),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    // P1：version 由 timestamp 改为 integer，用于乐观锁（last-writer-wins）
    version: integer('version').notNull().default(1),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    familyIdx: index('calendar_events_family_idx').on(t.familyId),
    zoneIdx: index('calendar_events_zone_idx').on(t.ownerId, t.visibility),
    versionIdx: index('calendar_events_version_idx').on(t.version),
    startIdx: index('calendar_events_start_idx').on(t.familyId, t.startAt),
  }),
);

// ===== 个人财务共享快照（单机版 engine → 家庭协作库桥接） =====
// 设计见 finance-share-design.md §3。server 仅存 owner 推送的数值快照，不回源 engine。
// 个人端编辑财务后，经引擎 SSE 防抖重推 snapshot；家庭成员读取时按 scope/allowedUserIds 过滤。
// （桥接表，迁移阶段并入主表 public 行后废弃，本期保留 family_id 隔离语义。）
export const sharedFinanceItems = pgTable(
  'shared_finance_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(), // summary|income|expense|asset|debt|investment|budget
    itemKey: text('item_key').notNull(), // 实体 id 或 '*'（聚合）
    label: text('label').notNull(),
    scope: text('scope').notNull().default('all'), // all | specific
    allowedUserIds: jsonb('allowed_user_ids').$type<string[]>().notNull().default([]),
    snapshot: jsonb('snapshot').notNull(), // 数值快照：保证家庭端一致
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    familyIdx: index('sfi_family_idx').on(t.familyId),
    ownerIdx: index('sfi_owner_idx').on(t.familyId, t.ownerUserId),
    // upsert 唯一键（与 store.upsertSharedFinance 的 ON CONFLICT 对应）
    ownerItemUniq: unique('sfi_owner_item_uniq').on(t.familyId, t.ownerUserId, t.itemType, t.itemKey),
  }),
);

// ===== 通用个人模块共享快照（提醒/记事/脑图/心流/领域… 复用一套桥接） =====
// 与 shared_finance_items 平行：server 仅存 owner 推送的快照，读取时按 scope/allowedUserIds 过滤。
// 用 module 判别列区分业务模块，唯一键含 module，避免不同模块的相同 itemType+itemKey 冲突。
export const sharedItems = pgTable(
  'shared_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    module: text('module').notNull(), // reminder | notes | mindmap | flow | domains | ...
    itemType: text('item_type').notNull(), // 模块内子类型（如 reminder 的 clock）
    itemKey: text('item_key').notNull(), // 实体 id 或 '*'（聚合）
    label: text('label').notNull(),
    scope: text('scope').notNull().default('all'), // all | specific
    allowedUserIds: jsonb('allowed_user_ids').$type<string[]>().notNull().default([]),
    snapshot: jsonb('snapshot').notNull(), // 数值/结构化快照
    done: boolean('done').notNull().default(false), // 协作完成状态：任意家庭成员均可标记
    note: text('note'), // 协作备注（可为空）
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    familyIdx: index('si_family_idx').on(t.familyId),
    ownerIdx: index('si_owner_idx').on(t.familyId, t.ownerUserId),
    moduleIdx: index('si_module_idx').on(t.familyId, t.module),
    // upsert 唯一键（与 store.upsertSharedItem 的 ON CONFLICT 对应），含 module 判别列
    ownerItemUniq: unique('si_owner_item_uniq').on(t.familyId, t.ownerUserId, t.module, t.itemType, t.itemKey),
  }),
);

/* ============================================================================
 * 个人域表（从 engine 整体迁移到 server；全部按 family_id 隔离，归 personal family）。
 * P1 zone 化：统一加四列 owner_id / visibility / version / last_edited_by；
 *   - 索引 family_idx 改为复合 (owner_id, visibility)；并加 version 单列索引。
 *   - family_id 列保留（双写过渡期）。
 * 列名/类型尽量对齐 engine 的 sql.js schema（text/timestamp/jsonb/boolean/integer/real）。
 * 时间字段统一用 text 存 ISO 字符串，以与 engine「字符串切片取月份 / 字典序比较」逻辑完全一致。
 * ========================================================================== */

/** 8+1 领域（与个人家庭一一对应，注册 personal family 时种子写入） */
export const domains = pgTable(
  'domains',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isQuarterFocus: boolean('is_quarter_focus').notNull().default(false),
    color: text('color').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    familyKeyUniq: unique('domains_family_key_uniq').on(t.familyId, t.key),
    familyIdx: index('domains_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('domains_version_idx').on(t.version),
  }),
);

/** PARA 项目/领域/资源/归档 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    name: text('name').notNull(),
    paraType: text('para_type').notNull().default('project'),
    goalId: text('goal_id'),
    status: text('status').notNull().default('active'),
    pdcaState: text('pdca_state'),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => ({
    familyIdx: index('projects_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('projects_version_idx').on(t.version),
  }),
);

/** 任务（四象限坐标 + MIT） */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    title: text('title').notNull(),
    domainKey: text('domain_key').notNull(),
    projectId: text('project_id'),
    importance: boolean('importance').notNull().default(false),
    urgency: boolean('urgency').notNull().default(false),
    isMit: boolean('is_mit').notNull().default(false),
    mitOrder: integer('mit_order'),
    status: text('status').notNull().default('todo'),
    scheduledStart: text('scheduled_start'),
    scheduledEnd: text('scheduled_end'),
    dueAt: text('due_at'),
    description: text('description').notNull().default(''),
    priority: text('priority').notNull().default('medium'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
    completionQuality: integer('completion_quality'),
    attentionPeak: integer('attention_peak'),
    taskDate: text('task_date'),
    repeat: text('repeat').notNull().default('none'),
    sourceDailyId: text('source_daily_id'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    familyIdx: index('tasks_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('tasks_version_idx').on(t.version),
    idxDomain: index('tasks_domain_idx').on(t.ownerId, t.visibility, t.domainKey, t.status),
    idxMit: index('tasks_mit_idx').on(t.ownerId, t.visibility, t.isMit, t.mitOrder),
    idxDue: index('tasks_due_idx').on(t.ownerId, t.visibility, t.dueAt),
    idxTaskDate: index('tasks_date_idx').on(t.ownerId, t.visibility, t.taskDate),
    idxDaily: index('tasks_daily_idx').on(t.ownerId, t.visibility, t.sourceDailyId, t.taskDate),
  }),
);

/** 兴趣孵化器 / 灵感孵化器 */
export const interests = pgTable(
  'interests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    title: text('title').notNull(),
    content: text('content'),
    attention: integer('attention').notNull().default(1),
    sourceType: text('source_type').notNull().default('manual'),
    sourceRef: text('source_ref'),
    domainKey: text('domain_key'),
    effortBudget: text('effort_budget').notNull().default('tbd'),
    status: text('status').notNull().default('incubating'),
    linkedTaskId: text('linked_task_id'),
    linkedProjectId: text('linked_project_id'),
    viewCount: integer('view_count').notNull().default(0),
    linkedNoteCount: integer('linked_note_count').notNull().default(0),
    validatedAt: text('validated_at'),
    convertedAt: text('converted_at'),
    archivedAt: text('archived_at'),
    discardedAt: text('discarded_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    familyIdx: index('interests_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('interests_version_idx').on(t.version),
    idxStatus: index('interests_status_idx').on(t.ownerId, t.visibility, t.status),
    idxDomain: index('interests_domain_idx').on(t.ownerId, t.visibility, t.domainKey),
  }),
);

/** 笔记（kind 区分灵感/记事本，taskId 关联任务） */
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    title: text('title').notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    links: jsonb('links').$type<string[]>().notNull().default([]),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    kind: text('kind').notNull().default('idea'),
    taskId: text('task_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    embeddedAt: text('embedded_at'),
    embedding: text('embedding'),
  },
  (t) => ({
    familyIdx: index('notes_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('notes_version_idx').on(t.version),
    idxEmbedded: index('notes_embedded_idx').on(t.ownerId, t.visibility, t.embeddedAt),
    idxKind: index('notes_kind_idx').on(t.ownerId, t.visibility, t.kind),
  }),
);

/* ============ 财务模块 ============ */

export const debts = pgTable(
  'debts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    creditor: text('creditor').notNull(),
    principal: numeric('principal', { precision: 18, scale: 2 }).notNull(),
    apr: numeric('apr', { precision: 8, scale: 4 }),
    minPayment: numeric('min_payment', { precision: 18, scale: 2 }),
    dueDay: integer('due_day'),
    status: text('status').notNull().default('active'),
    debtType: text('debt_type').notNull().default('other'),
    termMonths: integer('term_months'),
    repaymentMethod: text('repayment_method').notNull().default('equal_installment'),
    startDate: text('start_date'),
    rateType: text('rate_type'),
    baseRate: numeric('base_rate', { precision: 8, scale: 4 }),
    rateSpread: numeric('rate_spread', { precision: 8, scale: 4 }),
    rateAdjustments: jsonb('rate_adjustments'),
    repricing: jsonb('repricing'),
    prepayments: jsonb('prepayments'),
    parentDebtId: text('parent_debt_id'),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    familyIdx: index('debts_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('debts_version_idx').on(t.version),
    idxStatus: index('debts_status_idx').on(t.ownerId, t.visibility, t.status),
  }),
);

export const incomes = pgTable(
  'incomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    source: text('source').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('CNY'),
    receivedAt: text('received_at').notNull(),
    recurring: boolean('recurring').notNull().default(false),
    note: text('note').notNull().default(''),
    incomeType: text('income_type').notNull().default('salary'),
    monthlyAvg: numeric('monthly_avg', { precision: 18, scale: 2 }),
    isFixed: boolean('is_fixed').notNull().default(true),
    incomeMode: text('income_mode').notNull().default('monthly'),
    payDay: integer('pay_day'),
    adjustmentDay: integer('adjustment_day'),
    rateAdjustments: jsonb('rate_adjustments'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    familyIdx: index('incomes_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('incomes_version_idx').on(t.version),
    idxAt: index('incomes_at_idx').on(t.ownerId, t.visibility, t.receivedAt),
  }),
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    kind: text('kind').notNull(),
    category: text('category').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    merchant: text('merchant'),
    occurredAt: text('occurred_at').notNull(),
    note: text('note').notNull().default(''),
    debtId: text('debt_id'),
    incomeSourceId: text('income_source_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    familyIdx: index('transactions_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('transactions_version_idx').on(t.version),
    idxAt: index('transactions_at_idx').on(t.ownerId, t.visibility, t.occurredAt),
    idxKind: index('transactions_kind_idx').on(t.ownerId, t.visibility, t.kind),
  }),
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    name: text('name').notNull(),
    assetClass: text('asset_class').notNull(),
    value: numeric('value', { precision: 18, scale: 2 }).notNull(),
    asOf: text('as_of').notNull(),
    linkedIncomeSourceId: text('linked_income_source_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    familyIdx: index('assets_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('assets_version_idx').on(t.version),
    idxClass: index('assets_class_idx').on(t.ownerId, t.visibility, t.assetClass),
  }),
);

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    name: text('name').notNull(),
    scope: text('scope').notNull().default('overall'),
    category: text('category'),
    monthlyLimit: numeric('monthly_limit', { precision: 18, scale: 2 }).notNull(),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    familyIdx: index('budgets_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('budgets_version_idx').on(t.version),
    idxScope: index('budgets_scope_idx').on(t.ownerId, t.visibility, t.scope),
  }),
);

/** 提醒钟表铺 */
export const reminderClocks = pgTable(
  'reminder_clocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    title: text('title').notNull(),
    domainKey: text('domain_key').notNull(),
    periodRule: text('period_rule').notNull(),
    leadChain: jsonb('lead_chain').$type<number[]>().notNull().default([7, 1, 0]),
    noteLinked: text('note_linked'),
    nextFireAt: text('next_fire_at').notNull(),
    lastFiredAt: text('last_fired_at'),
    lastCompletedAt: text('last_completed_at'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    familyIdx: index('reminder_fire_idx').on(t.ownerId, t.visibility, t.nextFireAt, t.status),
    versionIdx: index('reminder_version_idx').on(t.version),
  }),
);

/** 心流仪表盘：专注时段记录 */
export const focusSessions = pgTable(
  'focus_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    taskId: text('task_id'),
    domainKey: text('domain_key'),
    projectId: text('project_id'),
    attentionType: text('attention_type').notNull().default('deep'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at').notNull(),
    score: integer('score'),
    energyStart: integer('energy_start'),
    energyEnd: integer('energy_end'),
    interruptions: jsonb('interruptions').$type<unknown[]>().notNull().default([]),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    familyIdx: index('focus_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('focus_version_idx').on(t.version),
    idxStarted: index('focus_started_idx').on(t.ownerId, t.visibility, t.startedAt),
    idxDomain: index('focus_domain_idx').on(t.ownerId, t.visibility, t.domainKey),
    idxProject: index('focus_project_idx').on(t.ownerId, t.visibility, t.projectId),
    idxTask: index('focus_task_idx').on(t.ownerId, t.visibility, t.taskId),
  }),
);

/** 金额互转（预留契约 P3） */
export const financeTransfers = pgTable(
  'finance_transfers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    fromAccountId: text('from_account_id').notNull(),
    toAccountId: text('to_account_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('CNY'),
    occurredAt: text('occurred_at').notNull(),
    note: text('note').notNull().default(''),
    idempotencyKey: text('idempotency_key'),
    reversed: integer('reversed').notNull().default(0),
    reversedAt: text('reversed_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    familyIdx: index('transfer_family_idx').on(t.ownerId, t.visibility),
    versionIdx: index('transfer_version_idx').on(t.version),
    idxFrom: index('transfer_from_idx').on(t.ownerId, t.visibility, t.fromAccountId),
    idxTo: index('transfer_to_idx').on(t.ownerId, t.visibility, t.toAccountId),
    idxAt: index('transfer_at_idx').on(t.ownerId, t.visibility, t.occurredAt),
    uniqIdem: unique('transfer_idem_uniq').on(t.familyId, t.idempotencyKey),
  }),
);

/** 系统元数据（system.importAll / setCustomDataDir 等遗留接口的 harmless 落点） */
// P1：zone 化，唯一键改为 (owner_id, visibility, key)
export const systemMeta = pgTable(
  'system_meta',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull().default(1),
    lastEditedBy: uuid('last_edited_by').references(() => users.id),
    key: text('key').notNull(),
    value: jsonb('value'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    familyKeyUniq: unique('system_meta_owner_vis_key_uniq').on(t.ownerId, t.visibility, t.key),
    zoneIdx: index('system_meta_zone_idx').on(t.ownerId, t.visibility),
  }),
);
