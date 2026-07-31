import { z } from 'zod';

/**
 * 命令输入边界（Zod）。CommandHandler 一律先校验，不信任前端。
 */

export const DOMAIN_KEYS = [
  'health',
  'family',
  'work',
  'wealth',
  'social',
  'growth',
  'leisure',
  'spirit',
  'quarter',
] as const;

/** 任务优先级（日历/看板排序用） */
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** 重复规则：none=单次；daily=每日例行（按模板每日自动实例化到指定日期） */
export const TASK_REPEAT = ['none', 'daily'] as const;
export type TaskRepeat = (typeof TASK_REPEAT)[number];

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  domainKey: z.enum(DOMAIN_KEYS),
  projectId: z.string().nullable().optional(),
  importance: z.boolean().optional().default(false),
  urgency: z.boolean().optional().default(false),
  isMit: z.boolean().optional().default(false),
  mitOrder: z.number().int().min(0).max(2).nullable().optional(),
  scheduledStart: z.string().nullable().optional(),
  scheduledEnd: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  /** 任务描述（日历详情面板展示） */
  description: z.string().max(5000).optional().default(''),
  /** 优先级：low / medium / high（默认 medium） */
  priority: z.enum(TASK_PRIORITIES).optional().default('medium'),
  /** 任务所属日期（YYYY-MM-DD）；省略时非每日例行默认归为当天，每日例行模板为 null */
  taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** 重复规则（默认 none） */
  repeat: z.enum(TASK_REPEAT).optional().default('none'),
  /** 每日例行实例的来源模板 id（系统写入，用户无需传） */
  sourceDailyId: z.string().nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const completeTaskSchema = z.object({
  id: z.string().min(1),
  /** MIT 完成质量（1-5 星）；省略=跳过评分 */
  quality: z.number().int().min(1).max(5).nullable().optional(),
});
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

/** 取消完成：把任务状态从 done 回退为 todo，并清空完成质量/注意力峰值。 */
export const uncompleteTaskSchema = z.object({
  id: z.string().min(1),
});
export type UncompleteTaskInput = z.infer<typeof uncompleteTaskSchema>;

/** 编辑任务：仅传需要修改的字段（其余保持原值）。至少传一个可编辑字段。 */
export const updateTaskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(500).optional(),
    domainKey: z.enum(DOMAIN_KEYS).optional(),
    projectId: z.string().nullable().optional(),
    importance: z.boolean().optional(),
    urgency: z.boolean().optional(),
    dueAt: z.string().nullable().optional(),
    scheduledStart: z.string().nullable().optional(),
    scheduledEnd: z.string().nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    /** 状态：待办/进行中/已完成/已归档（详情弹窗可编辑；done 实际由 complete 命令处理时间戳） */
    status: z.enum(['todo', 'doing', 'done', 'archived']).optional(),
    /** 任务所属日期（YYYY-MM-DD）；可改到其他日期 */
    taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    /** 重复规则 */
    repeat: z.enum(TASK_REPEAT).optional(),
  })
  .refine((d) => Object.keys(d).length > 1, { message: '至少需要修改一个字段' });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const deleteTaskSchema = z.object({
  id: z.string().min(1),
});
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;

export const setQuadrantSchema = z.object({
  id: z.string().min(1),
  importance: z.boolean(),
  urgency: z.boolean(),
});
export type SetQuadrantInput = z.infer<typeof setQuadrantSchema>;

export const scheduleTaskSchema = z.object({
  id: z.string().min(1),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
});
export type ScheduleTaskInput = z.infer<typeof scheduleTaskSchema>;

export const setMitSchema = z.object({
  id: z.string().min(1),
  isMit: z.boolean(),
  mitOrder: z.number().int().min(0).max(2).nullable().optional(),
});
export type SetMitInput = z.infer<typeof setMitSchema>;

/** 每日例行：把标记为 daily 的模板任务实例化到指定日期（已存在则跳过） */
export const ensureDailySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date 需为 YYYY-MM-DD'),
});
export type EnsureDailyInput = z.infer<typeof ensureDailySchema>;

/* ============ 灵感孵化器 / 兴趣筛选器 ============ */

export const INTEREST_STATUSES = ['incubating', 'validated', 'converted', 'archived', 'discarded'] as const;
export type InterestStatus = (typeof INTEREST_STATUSES)[number];

export const EFFORT_BUDGETS = ['30min', '3h', 'sustained', 'tbd'] as const;
export type EffortBudget = (typeof EFFORT_BUDGETS)[number];

export const INTEREST_SOURCES = ['project', 'thought', 'note', 'manual'] as const;
export type InterestSource = (typeof INTEREST_SOURCES)[number];

/** 捕捉一条灵感/兴趣（经命令面板或快捷记录先落入孵化器，不直接进任务/笔记） */
export const captureInterestSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().max(5000).optional().default(''),
  attention: z.number().int().min(1).max(3).optional().default(1),
  sourceType: z.enum(INTEREST_SOURCES).optional().default('manual'),
  sourceRef: z.string().nullable().optional(),
  domainKey: z.string().nullable().optional(),
  effortBudget: z.enum(EFFORT_BUDGETS).optional().default('tbd'),
});
export type CaptureInterestInput = z.infer<typeof captureInterestSchema>;

/** 编辑兴趣字段 */
export const updateInterestSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(500).optional(),
    content: z.string().max(5000).nullable().optional(),
    attention: z.number().int().min(1).max(3).optional(),
    effortBudget: z.enum(EFFORT_BUDGETS).optional(),
    domainKey: z.string().nullable().optional(),
    sourceType: z.enum(INTEREST_SOURCES).optional(),
    sourceRef: z.string().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 1, { message: '至少需要修改一个字段' });
export type UpdateInterestInput = z.infer<typeof updateInterestSchema>;

/** 改变状态（归档/丢弃等；验证/转化用专用命令） */
export const setInterestStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['archived', 'discarded', 'incubating']),
});
export type SetInterestStatusInput = z.infer<typeof setInterestStatusSchema>;

/** 立即验证：系统建一个极小验证任务并标记已验证 */
export const validateInterestSchema = z.object({
  id: z.string().min(1),
});
export type ValidateInterestInput = z.infer<typeof validateInterestSchema>;

/** 转化为项目：系统建一个 PARA 项目并标记已转化 */
export const convertInterestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(), // 省略则用兴趣标题
});
export type ConvertInterestInput = z.infer<typeof convertInterestSchema>;

/** 兴趣审查查询（可选状态过滤） */
export const interestReviewQuerySchema = z.object({
  status: z.enum(INTEREST_STATUSES).optional(),
});
export type InterestReviewQuery = z.infer<typeof interestReviewQuerySchema>;

/** 兴趣视图（含计算的留存指数与年龄天数） */
export const interestViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  attention: z.number().int(),
  sourceType: z.enum(INTEREST_SOURCES),
  sourceRef: z.string().nullable(),
  domainKey: z.string().nullable(),
  effortBudget: z.enum(EFFORT_BUDGETS),
  status: z.enum(INTEREST_STATUSES),
  linkedTaskId: z.string().nullable(),
  linkedProjectId: z.string().nullable(),
  viewCount: z.number().int(),
  linkedNoteCount: z.number().int(),
  validatedAt: z.string().nullable(),
  convertedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  discardedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  retentionIndex: z.number().int(), // 0-100 兴趣留存指数
  ageDays: z.number().int(), // 孵化天数
  reviewPriority: z.number().int(), // 审查排序权重（越高越先审）
  discardSuggestion: z.boolean(), // 低留存 → 建议丢弃
});
export type InterestView = z.infer<typeof interestViewSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  paraType: z.enum(['project', 'area', 'resource', 'archive']),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const noteKindEnum = z.enum(['idea', 'notebook']);
export type NoteKind = z.infer<typeof noteKindEnum>;

export const ingestNoteSchema = z.object({
  title: z.string().min(1).max(500),
  bodyMarkdown: z.string().default(''),
  links: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  /** 笔记类型：灵感(idea) / 记事本(notebook)，用于同一张表分流到不同页面 */
  kind: noteKindEnum.optional().default('idea'),
  /** 记事本可关联一个任务，记录其详情与规划 */
  taskId: z.string().nullable().optional(),
});
export type IngestNoteInput = z.infer<typeof ingestNoteSchema>;

export const noteViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  bodyMarkdown: z.string(),
  links: z.array(z.string()),
  tags: z.array(z.string()),
  kind: noteKindEnum.default('idea'),
  taskId: z.string().nullable(),
  createdAt: z.string(),
});
export type NoteView = z.infer<typeof noteViewSchema>;

/** 实体视图（供 tRPC 返回） */
export const taskViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  domainKey: z.string(),
  projectId: z.string().nullable(),
  importance: z.boolean(),
  urgency: z.boolean(),
  isMit: z.boolean(),
  mitOrder: z.number().nullable(),
  status: z.string(),
  quadrant: z.enum(['q1', 'q2', 'q3', 'q4']),
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  dueAt: z.string().nullable(),
  description: z.string(),
  priority: z.enum(TASK_PRIORITIES),
  createdAt: z.string(),
    completedAt: z.string().nullable(),
    /** MIT 完成质量（1-5 星）；null=未完成或跳过评分 */
    completionQuality: z.number().int().nullable(),
    /** 注意力峰值：完成该任务时绑定 flow 专注时段的最高评分（1-5）；null=无专注数据 */
    attentionPeak: z.number().int().nullable(),
    /** 任务所属日期（YYYY-MM-DD）；每日例行模板为 null，实例为具体日期 */
    taskDate: z.string().nullable(),
    /** 重复规则 none / daily */
    repeat: z.enum(TASK_REPEAT),
    /** 每日例行实例的来源模板 id；非实例为 null */
    sourceDailyId: z.string().nullable(),
  },
);
export type TaskView = z.infer<typeof taskViewSchema>;

export const domainViewSchema = z.object({
  key: z.string(),
  name: z.string(),
  isQuarterFocus: z.boolean(),
  color: z.string(),
});
export type DomainView = z.infer<typeof domainViewSchema>;

/** 每领域聚合视图（领域完整聚合）：任务总数 / 已完成 / 进行中 + 累计专注分钟 + 完成率 */
export const domainSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  color: z.string(),
  isQuarterFocus: z.boolean(),
  taskTotal: z.number().int(),
  taskDone: z.number().int(),
  taskActive: z.number().int(),
  /** 该领域累计专注分钟（来自 focus_sessions，全量） */
  focusMinutes: z.number().int(),
  /** 完成率 = taskDone / taskTotal（无任务为 0） */
  doneRate: z.number(),
});
export type DomainSummary = z.infer<typeof domainSummarySchema>;

/** 平衡轮视图：给定周（周一 YYYY-MM-DD）内各领域投入分钟 + 归一化得分 + 压力代理 */
export const domainBalanceWheelSchema = z.object({
  week: z.string(),
  wheel: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      color: z.string(),
      minutes: z.number().int(),
      /** 相对当周最大投入领域的归一化得分 0-100 */
      score: z.number().int(),
    }),
  ),
  domainMinutes: z.record(z.string(), z.number().int()),
  /** 开放任务数（todo+doing）最多的领域 key，取前 3（压力代理） */
  topStresses: z.array(z.string()),
});
export type DomainBalanceWheel = z.infer<typeof domainBalanceWheelSchema>;

export const projectViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  paraType: z.string(),
  status: z.string(),
});
export type ProjectView = z.infer<typeof projectViewSchema>;

/* ============ 财务模块（P1，对齐 life-manager） ============ */

/** 重定价规则（P0-1：LPR 品种 + 加点 + 重定价周期 + 对日），引擎据此自动生成 rateAdjustments */
export const repricingSchema = z
  .object({
    benchmark: z.enum(['LPR_1Y', 'LPR_5Y', 'PBOC_BASE']),
    spread: z.number().min(-50).max(50), // 加点（百分点，签约时锁定）
    cycleMonths: z.number().int().min(1).max(12), // 12=年 / 6=半年 / 3=季
    anchor: z.enum(['anniversary', 'fixed_date']),
    fixedDate: z.string().min(1).optional(), // anchor=fixed_date 时：YYYY-MM-DD
  })
  .optional();

/** 债务可选字段（创建/更新共用） */
const debtOptionalFields = {
  debtType: z.string().max(50).optional(),
  termMonths: z.number().int().min(1).max(600).optional(),
  repaymentMethod: z
    .enum(['equal_installment', 'equal_principal', 'equal_interest', 'interest_first'])
    .optional(),
  startDate: z.string().min(1).optional(),
  rateType: z.enum(['benchmark', 'lpr', 'fixed']).nullable().optional(),
  baseRate: z.number().min(0).max(100).nullable().optional(),
  rateSpread: z.number().min(-50).max(50).nullable().optional(),
  rateAdjustments: z.array(z.object({ effectiveDate: z.string(), newRate: z.number() })).optional(),
  repricing: repricingSchema,
  prepayments: z
    .array(z.object({ date: z.string(), amount: z.number().nonnegative().max(1e15), type: z.enum(['reduce_term', 'reduce_payment']).optional() }))
    .optional(),
  parentDebtId: z.string().nullable().optional(),
  note: z.string().max(5000).optional(),
  apr: z.number().min(0).max(100).optional(),
  minPayment: z.number().nonnegative().optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  status: z.enum(['active', 'paid', 'frozen']).optional(),
};

export const createDebtSchema = z.object({
  creditor: z.string().min(1).max(200),
  principal: z.number().nonnegative().max(1e15),
  ...debtOptionalFields,
  status: z.enum(['active', 'paid', 'frozen']).optional().default('active'),
});
export type CreateDebtInput = z.infer<typeof createDebtSchema>;

export const updateDebtSchema = z.object({
  id: z.string().min(1),
  creditor: z.string().min(1).max(200).optional(),
  principal: z.number().nonnegative().max(1e15).optional(),
  ...debtOptionalFields,
});
export type UpdateDebtInput = z.infer<typeof updateDebtSchema>;

export const closeDebtSchema = z.object({ id: z.string().min(1) });
export type CloseDebtInput = z.infer<typeof closeDebtSchema>;

export const reopenDebtSchema = z.object({ id: z.string().min(1) });
export type ReopenDebtInput = z.infer<typeof reopenDebtSchema>;

export const recordIncomeSchema = z
  .object({
    source: z.string().min(1).max(200),
    amount: z.number().max(1e15),
    currency: z.string().min(1).max(8).optional().default('CNY'),
    receivedAt: z.string().min(1),
    recurring: z.boolean().optional().default(false),
    // —— 收入源模型 ——
    incomeType: z.string().max(50).optional().default('salary'),
    monthlyAvg: z.number().max(1e15).optional(),
    isFixed: z.boolean().optional().default(true),
    incomeMode: z.enum(['monthly', 'single']).optional().default('monthly'),
    payDay: z.number().int().min(1).max(31).optional(),
    adjustmentDay: z.number().int().min(1).max(31).optional(),
    rateAdjustments: z
      .array(z.object({ effectiveDate: z.string(), newAmount: z.number().nonnegative().max(1e15) }))
      .optional(),
    note: z.string().optional().default(''),
  })
  // 「投资收益」类允许负数（亏损），其余收入类型金额必须 > 0。
  .refine((d) => d.incomeType === 'investment' || d.amount > 0, {
    message: '非「投资收益」类的收入金额必须大于 0（投资收益可填负数表示亏损）',
    path: ['amount'],
  });
export type RecordIncomeInput = z.infer<typeof recordIncomeSchema>;

export const recordTransactionSchema = z.object({
  kind: z.enum(['expense', 'income', 'debt_payment']),
  category: z.string().min(1).max(100),
  amount: z.number().nonnegative().max(1e15),
  merchant: z.string().nullable().optional(),
  occurredAt: z.string().min(1),
  debtId: z.string().nullable().optional(),
  incomeSourceId: z.string().nullable().optional(),
  note: z.string().optional().default(''),
});
export type RecordTransactionInput = z.infer<typeof recordTransactionSchema>;

export const recordAssetSchema = z.object({
  name: z.string().min(1).max(200),
  assetClass: z.enum(['cash', 'investment', 'property', 'other', 'fixed_asset', 'income_source']),
  value: z.number().nonnegative().max(1e15),
  asOf: z.string().min(1),
  linkedIncomeSourceId: z.string().nullable().optional(),
});
export type RecordAssetInput = z.infer<typeof recordAssetSchema>;

export const updateAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  assetClass: z.enum(['cash', 'investment', 'property', 'other', 'fixed_asset', 'income_source']).optional(),
  value: z.number().nonnegative().max(1e15).optional(),
  asOf: z.string().min(1).optional(),
  linkedIncomeSourceId: z.string().nullable().optional(),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

/* 财务实体视图 */
export const debtViewSchema = z.object({
  id: z.string(),
  creditor: z.string(),
  principal: z.number(),
  apr: z.number().nullable(),
  minPayment: z.number().nullable(),
  dueDay: z.number().nullable(),
  status: z.string(),
  // —— 还款模型 ——
  debtType: z.string(),
  termMonths: z.number().nullable(),
  repaymentMethod: z.string(),
  startDate: z.string().nullable(),
  rateType: z.string().nullable(),
  baseRate: z.number().nullable(),
  rateSpread: z.number().nullable(),
  rateAdjustments: z.array(z.object({ effectiveDate: z.string(), newRate: z.number() })),
  repricing: repricingSchema,
  prepayments: z.array(
    z.object({ date: z.string(), amount: z.number(), type: z.string().nullable() }),
  ),
  parentDebtId: z.string().nullable(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // 剩余本金（引擎按还款计划实时推算），共享快照用，避免家庭端显示 ¥0
  remainingPrincipal: z.number(),
});
export type DebtView = z.infer<typeof debtViewSchema>;

export const incomeViewSchema = z.object({
  id: z.string(),
  source: z.string(),
  amount: z.number(),
  currency: z.string(),
  receivedAt: z.string(),
  recurring: z.boolean(),
  note: z.string(),
  // —— 收入源模型 ——
  incomeType: z.string(),
  monthlyAvg: z.number().nullable(),
  isFixed: z.boolean(),
  incomeMode: z.string(),
  payDay: z.number().nullable(),
  adjustmentDay: z.number().nullable(),
  rateAdjustments: z.array(z.object({ effectiveDate: z.string(), newAmount: z.number() })),
  createdAt: z.string(),
});
export type IncomeView = z.infer<typeof incomeViewSchema>;

export const transactionViewSchema = z.object({
  id: z.string(),
  kind: z.string(),
  category: z.string(),
  amount: z.number(),
  merchant: z.string().nullable(),
  occurredAt: z.string(),
  debtId: z.string().nullable(),
  incomeSourceId: z.string().nullable(),
  note: z.string(),
  createdAt: z.string(),
});
export type TransactionView = z.infer<typeof transactionViewSchema>;

export const assetViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  assetClass: z.string(),
  value: z.number(),
  asOf: z.string(),
  linkedIncomeSourceId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetView = z.infer<typeof assetViewSchema>;

/* 预算：整体/分类的月度支出限额，spent/remaining/progress 由引擎按当月流水实时计算 */
export const budgetViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.enum(['overall', 'category']),
  category: z.string().nullable(),
  monthlyLimit: z.number(),
  /** 当月已支出（overall=全部支出；category=该分类支出） */
  spent: z.number(),
  /** 剩余可用 = monthlyLimit - spent */
  remaining: z.number(),
  /** 进度 0..1（超额可 >1，前端截断到 1 显示） */
  progress: z.number(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BudgetView = z.infer<typeof budgetViewSchema>;

export const createBudgetSchema = z.object({
  name: z.string().min(1).max(200),
  scope: z.enum(['overall', 'category']).default('overall'),
  category: z.string().max(100).nullable().optional(),
  monthlyLimit: z.number().positive('限额必须大于 0').max(1e15),
  note: z.string().max(5000).optional(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const updateBudgetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  scope: z.enum(['overall', 'category']).optional(),
  category: z.string().max(100).nullable().optional(),
  monthlyLimit: z.number().positive().max(1e15).optional(),
  note: z.string().max(5000).optional(),
});
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

export const deleteBudgetSchema = z.object({
  id: z.string().min(1),
});
export type DeleteBudgetInput = z.infer<typeof deleteBudgetSchema>;

/* 金额互转（预留契约 P3）：一笔转账原子地从 from 账户借记、to 账户贷记。
   金额以整数「分」(amountMinor) 存储，规避浮点误差；idempotencyKey 唯一约束防重复提交。
   注：本契约只建立「转账记录」事实，不自动改写 assets.value（手动余额不被动），
   后续 P4 阶段可在同一写路径内扩展余额联动。 */
export const transferCreateSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amountMinor: z.number().int().positive('金额必须为正整数（单位：分）'),
  currency: z.string().min(1).max(8).optional().default('CNY'),
  occurredAt: z.string().min(1),
  note: z.string().max(500).optional().default(''),
  /** 幂等键：相同键重复提交返回首次结果，避免网络重试造成重复转账 */
  idempotencyKey: z.string().min(1).max(100).optional(),
});
export type TransferCreateInput = z.infer<typeof transferCreateSchema>;

export const transferListSchema = z.object({
  limit: z.number().int().min(1).max(500).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),
  /** 仅看与某账户相关的转账（作为 from 或 to） */
  accountId: z.string().optional(),
});
export type TransferListInput = z.infer<typeof transferListSchema>;

export const transferGetSchema = z.object({ id: z.string().min(1) });
export type TransferGetInput = z.infer<typeof transferGetSchema>;

/** 撤销一笔转账（预留：当前仅记录 reversed 标记，不自动回滚余额） */
export const transferReverseSchema = z.object({
  id: z.string().min(1),
  reason: z.string().max(500).optional(),
});
export type TransferReverseInput = z.infer<typeof transferReverseSchema>;

export const transferViewSchema = z.object({
  id: z.string(),
  fromAccountId: z.string(),
  toAccountId: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  occurredAt: z.string(),
  note: z.string(),
  idempotencyKey: z.string().nullable(),
  reversed: z.boolean(),
  reversedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TransferView = z.infer<typeof transferViewSchema>;

export const financeSummarySchema = z.object({
  totalDebt: z.number(),
  monthlyMinPayment: z.number(),
  totalAssets: z.number(),
  totalIncome: z.number(),
  totalExpense: z.number(),
  netWorth: z.number(),
  // —— 对齐 life-manager 概览 ——
  monthlyIncome: z.number(),
  monthlyDebtPayment: z.number(),
  monthlyExpense: z.number(),
  monthIncome: z.number(),
  monthExpense: z.number(),
  debtCount: z.number(),
  incomeSourceCount: z.number(),
});
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

/* ============ 报表导出输入 ============ */
export const exportReportInputSchema = z.object({
  format: z.enum(['csv', 'json']),
  /** 形如 '2026-07'，仅过滤 transactions 明细；省略则导出全部 */
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, '月份格式应为 YYYY-MM')
    .optional(),
});
export type ExportReportInput = z.infer<typeof exportReportInputSchema>;

/* ============ 提醒钟表铺（P1） ============ */

export const createReminderSchema = z.object({
  title: z.string().min(1).max(200),
  domainKey: z.enum(DOMAIN_KEYS),
  /** 周期规则自由文本，如「每3个月」「每季度」「每年」，解析失败时回退 +30 天 */
  periodRule: z.string().min(1).max(100),
  /** 提前通知链（天）：如 [7, 1, 0] 表示提前 7 天 / 1 天 / 当天提醒 */
  leadChain: z.array(z.number().int().min(0).max(365)).optional().default([7, 1, 0]),
  noteLinked: z.string().nullable().optional(),
  /** 首次响铃时间（ISO8601） */
  nextFireAt: z.string().min(1),
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export const completeReminderSchema = z.object({ id: z.string().min(1) });
export type CompleteReminderInput = z.infer<typeof completeReminderSchema>;

export const rewindReminderSchema = z.object({
  id: z.string().min(1),
  /** 手动重置的下次响铃时间（ISO8601） */
  nextFireAt: z.string().min(1),
});
export type RewindReminderInput = z.infer<typeof rewindReminderSchema>;

export const snoozeReminderSchema = z.object({
  id: z.string().min(1),
  /** 推迟到的下次响铃时间（ISO8601） */
  nextFireAt: z.string().min(1),
});
export type SnoozeReminderInput = z.infer<typeof snoozeReminderSchema>;

/* 提醒实体视图 */
export const reminderViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  domainKey: z.string(),
  periodRule: z.string(),
  leadChain: z.array(z.number()),
  noteLinked: z.string().nullable(),
  nextFireAt: z.string(),
  lastFiredAt: z.string().nullable(),
  lastCompletedAt: z.string().nullable(),
  status: z.enum(['active', 'due', 'overdue', 'done']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReminderView = z.infer<typeof reminderViewSchema>;

/* ============ 删除 / 编辑（全模块通用） ============ */

/* 财务：删除 */
export const deleteDebtSchema = z.object({ id: z.string().min(1) });
export type DeleteDebtInput = z.infer<typeof deleteDebtSchema>;
export const deleteIncomeSchema = z.object({ id: z.string().min(1) });
export type DeleteIncomeInput = z.infer<typeof deleteIncomeSchema>;
export const deleteTransactionSchema = z.object({ id: z.string().min(1) });
export type DeleteTransactionInput = z.infer<typeof deleteTransactionSchema>;
export const deleteAssetSchema = z.object({ id: z.string().min(1) });
export type DeleteAssetInput = z.infer<typeof deleteAssetSchema>;

/* 财务：收入/流水编辑 */
export const updateIncomeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1).max(200).optional(),
  amount: z.number().nonnegative().max(1e15).optional(),
  incomeType: z.string().max(50).optional(),
  monthlyAvg: z.number().nonnegative().max(1e15).optional(),
  isFixed: z.boolean().optional(),
  incomeMode: z.enum(['monthly', 'single']).optional(),
  payDay: z.number().int().min(1).max(31).optional(),
  adjustmentDay: z.number().int().min(1).max(31).optional(),
  rateAdjustments: z
    .array(z.object({ effectiveDate: z.string(), newAmount: z.number().nonnegative().max(1e15) }))
    .optional(),
  note: z.string().optional(),
});
export type UpdateIncomeInput = z.infer<typeof updateIncomeSchema>;
export const updateTransactionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['expense', 'income', 'debt_payment']).optional(),
  category: z.string().min(1).max(100).optional(),
  amount: z.number().nonnegative().max(1e15).optional(),
  debtId: z.string().nullable().optional(),
  incomeSourceId: z.string().nullable().optional(),
  note: z.string().optional(),
});
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

/* 提醒：删除 / 编辑 */
export const deleteReminderSchema = z.object({ id: z.string().min(1) });
export type DeleteReminderInput = z.infer<typeof deleteReminderSchema>;
export const updateReminderSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  periodRule: z.string().min(1).max(100).optional(),
  leadChain: z.array(z.number().int().min(0).max(365)).optional(),
  noteLinked: z.string().nullable().optional(),
});
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;

/* 笔记：编辑 / 删除（灵感与记事本共用） */
export const updateNoteSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  bodyMarkdown: z.string().optional(),
  links: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  taskId: z.string().nullable().optional(),
});
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export const deleteNoteSchema = z.object({ id: z.string().min(1) });
export type DeleteNoteInput = z.infer<typeof deleteNoteSchema>;

/* ============ 心流仪表盘（认知资源管理） ============ */

/** 注意力类型：深度工作 / 浅层工作 / 被动学习 / 恢复 */
export const ATTENTION_TYPES = ['deep', 'shallow', 'passive', 'recovery'] as const;
export type AttentionType = (typeof ATTENTION_TYPES)[number];

/** 单次中断记录（窗口失焦/提前终止时温和记录） */
export const interruptionSchema = z.object({
  at: z.string(), // ISO
  kind: z.enum(['internal', 'external']).nullable().optional(),
  reason: z.string().optional(),
});
export type Interruption = z.infer<typeof interruptionSchema>;

/** 记录一次专注时段评估（score 为 null = 跳过评分） */
export const recordFocusSessionSchema = z.object({
  taskId: z.string().nullable().optional(),
  domainKey: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  attentionType: z.enum(ATTENTION_TYPES).default('deep'),
  startedAt: z.string(),
  endedAt: z.string(),
  score: z.number().int().min(1).max(5).nullable().optional(),
  energyStart: z.number().int().min(1).max(5).nullable().optional(),
  energyEnd: z.number().int().min(1).max(5).nullable().optional(),
  interruptions: z.array(interruptionSchema).optional().default([]),
  note: z.string().nullable().optional(),
});
export type RecordFocusSessionInput = z.infer<typeof recordFocusSessionSchema>;

/** 热力图 / 洞察汇总查询 */
export const flowSummaryQuerySchema = z.object({
  range: z.enum(['week', 'month']).default('week'),
  unit: z.enum(['hour', 'day']).default('hour'), // 横轴：一天的小时块 / 一周(月)的天
  axis: z.enum(['domain', 'project']).default('domain'),
  domainKey: z.string().optional(),
  projectId: z.string().optional(),
});
export type FlowSummaryQuery = z.infer<typeof flowSummaryQuerySchema>;

/** 专注时段视图（列表/详情） */
export const focusSessionViewSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  domainKey: z.string().nullable(),
  projectId: z.string().nullable(),
  attentionType: z.enum(ATTENTION_TYPES),
  startedAt: z.string(),
  endedAt: z.string(),
  score: z.number().int().nullable(),
  energyStart: z.number().int().nullable(),
  energyEnd: z.number().int().nullable(),
  interruptions: z.array(interruptionSchema),
  note: z.string().nullable(),
});
export type FocusSessionView = z.infer<typeof focusSessionViewSchema>;
