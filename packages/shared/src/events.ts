/**
 * 事件信封 + 事件目录（P0）
 *
 * events 表为仅追加日志；本文件定义信封结构与所有已知事件类型。
 * 新增事件：在 AppEvent 联合类型里加一项即可，CommandHandler 负责 append。
 */

/** 通用事件信封 */
export interface EventEnvelope<T = unknown> {
  id: string;
  type: string;
  aggregateId: string;
  payload: T;
  occurredAt: string; // ISO8601 UTC
  causationId?: string;
  correlationId?: string;
}

/** P0 事件载荷 */
export interface TaskCreatedPayload {
  taskId: string;
  title: string;
  domainKey: string;
  projectId: string | null;
  importance: boolean;
  urgency: boolean;
  isMit: boolean;
  mitOrder: number | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  dueAt: string | null;
  description: string;
  priority: 'low' | 'medium' | 'high';
}
export interface TaskCompletedPayload {
  taskId: string;
  completedAt: string;
  /** MIT 完成质量（1-5 星）；undefined=非 MIT 或跳过评分 */
  quality?: number | null;
  /** 注意力峰值：完成该任务时绑定 flow 专注时段的最高评分（1-5）；undefined=无专注数据 */
  attentionPeak?: number | null;
}
export interface TaskUncompletedPayload {
  taskId: string;
}
export interface TaskUpdatedPayload {
  taskId: string;
  /** 实际被修改的字段及其新值（仅含本次变更） */
  changes: Record<string, unknown>;
}
export interface TaskQuadrantChangedPayload {
  taskId: string;
  importance: boolean;
  urgency: boolean;
}
export interface TaskScheduledPayload {
  taskId: string;
  scheduledStart: string;
  scheduledEnd: string;
}
export interface TaskDeletedPayload {
  taskId: string;
  title: string;
}
export interface InterestCapturedPayload {
  interestId: string;
  title: string;
  domainKey?: string | null;
  sourceType: 'project' | 'thought' | 'note' | 'manual';
  sourceRef?: string | null;
}
export interface InterestUpdatedPayload {
  interestId: string;
  changes: Record<string, unknown>;
}
export interface InterestStatusChangedPayload {
  interestId: string;
  status: 'incubating' | 'validated' | 'converted' | 'archived' | 'discarded';
  linkedTaskId?: string | null;
  linkedProjectId?: string | null;
}
export interface DomainCreatedPayload {
  key: string;
  name: string;
}
export interface ProjectCreatedPayload {
  projectId: string;
  name: string;
  paraType: 'project' | 'area' | 'resource' | 'archive';
}
export interface NoteIngestedPayload {
  noteId: string;
}
export interface InsightGeneratedPayload {
  week: string;
  domainMinutes: Record<string, number>;
  topStresses: string[];
}

/** 财务：债务管理 */
export interface DebtCreatedPayload {
  debtId: string;
  creditor: string;
  principal: number;
}
export interface DebtUpdatedPayload {
  debtId: string;
  principal: number;
  status: 'active' | 'paid' | 'frozen';
}
export interface DebtClosedPayload {
  debtId: string;
  closedAt: string;
}
export interface DebtReopenedPayload {
  debtId: string;
  reopenedAt: string;
}

/** 财务：收入记录 */
export interface IncomeRecordedPayload {
  incomeId: string;
  source: string;
  amount: number;
  receivedAt: string;
}

/** 财务：交易流水 */
export interface TransactionRecordedPayload {
  transactionId: string;
  kind: 'expense' | 'income' | 'debt_payment';
  category: string;
  amount: number;
  occurredAt: string;
}

/** 财务：资产总览 */
export interface AssetRecordedPayload {
  assetId: string;
  name: string;
  assetClass: 'cash' | 'investment' | 'property' | 'other' | 'fixed_asset' | 'income_source';
  value: number;
  asOf: string;
}
export interface AssetUpdatedPayload {
  assetId: string;
  value: number;
  asOf: string;
}

/** 提醒钟表铺：建钟 */
export interface ReminderClockCreatedPayload {
  reminderId: string;
  title: string;
  domainKey: string;
  periodRule: string;
  leadChain: number[];
  noteLinked: string | null;
  nextFireAt: string;
}
/** 提醒钟表铺：手动上发条（重置下次响铃） */
export interface ReminderClockRewoundPayload {
  reminderId: string;
  nextFireAt: string;
}
/** 提醒钟表铺：响铃（调度器 tick 触发） */
export interface ReminderFiredPayload {
  reminderId: string;
  firedAt: string;
}
/** 提醒钟表铺：完成（一键完成，自动上发条到下一周期） */
export interface ReminderCompletedPayload {
  reminderId: string;
  completedAt: string;
}
/** 提醒钟表铺：逾期（未处理超出宽限，转压力背包低优先级卡） */
export interface ReminderOverduePayload {
  reminderId: string;
  overdueSince: string;
}
/** 提醒钟表铺：推迟 */
export interface ReminderSnoozedPayload {
  reminderId: string;
  nextFireAt: string;
}
/** 提醒钟表铺：删除 */
export interface ReminderDeletedPayload {
  reminderId: string;
}
/** 提醒钟表铺：编辑（改标题/周期/提前链/关联笔记） */
export interface ReminderUpdatedPayload {
  reminderId: string;
  title: string;
  periodRule: string;
  leadChain: number[];
  noteLinked: string | null;
}

/** 财务：删除（债务/收入/流水/资产统一删除事件载荷） */
export interface DebtDeletedPayload {
  debtId: string;
}
export interface IncomeDeletedPayload {
  incomeId: string;
}
export interface TransactionDeletedPayload {
  transactionId: string;
}
export interface AssetDeletedPayload {
  assetId: string;
}
/** 财务：收入/流水编辑 */
export interface IncomeUpdatedPayload {
  incomeId: string;
  source: string;
  amount: number;
}
export interface TransactionUpdatedPayload {
  transactionId: string;
  kind: 'expense' | 'income' | 'debt_payment';
  category: string;
  amount: number;
}

/** 财务：自动刷新（生成本月固定收入 + 债务还款流水）结果 */
export interface FinanceAutoRefreshedPayload {
  incomes: number;
  debts: number;
  skipped: number;
}

/** 财务：预算（整体/分类月度限额） */
export interface BudgetCreatedPayload {
  budgetId: string;
  name: string;
  monthlyLimit: number;
  scope: 'overall' | 'category';
  category: string | null;
}
export interface BudgetUpdatedPayload {
  budgetId: string;
  name: string;
  monthlyLimit: number;
  scope: 'overall' | 'category';
  category: string | null;
}
export interface BudgetDeletedPayload {
  budgetId: string;
}

/** 财务：金额互转（预留契约 P3） */
export interface TransferCreatedPayload {
  transferId: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
}
export interface TransferReversedPayload {
  transferId: string;
  reason: string | null;
  reversedAt: string;
}

/** 笔记：编辑/删除（灵感与记事本共用） */
export interface NoteUpdatedPayload {
  noteId: string;
}
export interface NoteDeletedPayload {
  noteId: string;
}

/** 心流仪表盘：一次专注时段评估记录完成 */
export interface FocusSessionRecordedPayload {
  sessionId: string;
  taskId: string | null;
  domainKey: string | null;
  projectId: string | null;
  attentionType: 'deep' | 'shallow' | 'passive' | 'recovery';
  score: number | null; // 1-5；null = 跳过
  startedAt: string;
  endedAt: string;
}

/** 事件目录：type 与 payload 的判别联合 */
export type AppEvent =
  | { type: 'TaskCreated'; payload: TaskCreatedPayload }
  | { type: 'TaskCompleted'; payload: TaskCompletedPayload }
  | { type: 'TaskUncompleted'; payload: TaskUncompletedPayload }
  | { type: 'TaskUpdated'; payload: TaskUpdatedPayload }
  | { type: 'InterestCaptured'; payload: InterestCapturedPayload }
  | { type: 'InterestUpdated'; payload: InterestUpdatedPayload }
  | { type: 'InterestStatusChanged'; payload: InterestStatusChangedPayload }
  | { type: 'TaskQuadrantChanged'; payload: TaskQuadrantChangedPayload }
  | { type: 'TaskScheduled'; payload: TaskScheduledPayload }
  | { type: 'TaskDeleted'; payload: TaskDeletedPayload }
  | { type: 'DomainCreated'; payload: DomainCreatedPayload }
  | { type: 'ProjectCreated'; payload: ProjectCreatedPayload }
  | { type: 'NoteIngested'; payload: NoteIngestedPayload }
  | { type: 'InsightGenerated'; payload: InsightGeneratedPayload }
  | { type: 'DebtCreated'; payload: DebtCreatedPayload }
  | { type: 'DebtUpdated'; payload: DebtUpdatedPayload }
  | { type: 'DebtClosed'; payload: DebtClosedPayload }
  | { type: 'DebtReopened'; payload: DebtReopenedPayload }
  | { type: 'IncomeRecorded'; payload: IncomeRecordedPayload }
  | { type: 'TransactionRecorded'; payload: TransactionRecordedPayload }
  | { type: 'AssetRecorded'; payload: AssetRecordedPayload }
  | { type: 'AssetUpdated'; payload: AssetUpdatedPayload }
  | { type: 'ReminderClockCreated'; payload: ReminderClockCreatedPayload }
  | { type: 'ReminderClockRewound'; payload: ReminderClockRewoundPayload }
  | { type: 'ReminderFired'; payload: ReminderFiredPayload }
  | { type: 'ReminderCompleted'; payload: ReminderCompletedPayload }
  | { type: 'ReminderOverdue'; payload: ReminderOverduePayload }
  | { type: 'ReminderSnoozed'; payload: ReminderSnoozedPayload }
  | { type: 'ReminderDeleted'; payload: ReminderDeletedPayload }
  | { type: 'ReminderUpdated'; payload: ReminderUpdatedPayload }
  | { type: 'DebtDeleted'; payload: DebtDeletedPayload }
  | { type: 'IncomeDeleted'; payload: IncomeDeletedPayload }
  | { type: 'TransactionDeleted'; payload: TransactionDeletedPayload }
  | { type: 'AssetDeleted'; payload: AssetDeletedPayload }
  | { type: 'IncomeUpdated'; payload: IncomeUpdatedPayload }
  | { type: 'TransactionUpdated'; payload: TransactionUpdatedPayload }
  | { type: 'NoteUpdated'; payload: NoteUpdatedPayload }
  | { type: 'NoteDeleted'; payload: NoteDeletedPayload }
  | { type: 'FocusSessionRecorded'; payload: FocusSessionRecordedPayload }
  | { type: 'BudgetCreated'; payload: BudgetCreatedPayload }
  | { type: 'BudgetUpdated'; payload: BudgetUpdatedPayload }
  | { type: 'BudgetDeleted'; payload: BudgetDeletedPayload }
  | { type: 'TransferCreated'; payload: TransferCreatedPayload }
  | { type: 'TransferReversed'; payload: TransferReversedPayload }
  | { type: 'FinanceAutoRefreshed'; payload: FinanceAutoRefreshedPayload };

export type AppEventType = AppEvent['type'];
