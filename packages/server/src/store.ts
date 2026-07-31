// M2.1 —— Drizzle 驱动的 repository（替代 M1 内存 Map）
// 方法签名与返回类型与 M1 完全一致，auth/rbac/router 仅需适配 async 调用，无需改业务语义。
import { randomUUID } from 'node:crypto';
import { eq, and, sql, desc, asc, or, isNull, isNotNull, gte, lt, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getDb, resolveDataDir } from './db';
import {
  users,
  families,
  memberships,
  invitations,
  sessions,
  calendarEvents,
  sharedFinanceItems,
  sharedItems,
  domains,
  projects,
  tasks,
  interests,
  notes,
  debts,
  incomes,
  transactions,
  assets,
  budgets,
  reminderClocks,
  focusSessions,
  financeTransfers,
  systemMeta,
} from './db/schema';
import type {
  User,
  Family,
  Membership,
  Invitation,
  Session,
  Role,
  CalendarEvent,
  SharedFinanceItem,
  SharedFinanceItemType,
  SharedFinanceScope,
  SharedItem,
  SharedItemModule,
  SharedItemScope,
} from './types';
import {
  getDebtSummary,
  getRepaymentSchedule,
  type DebtCalcInput,
} from './finance/schedule';
import { computeNextFire } from '@dm-life/shared';
import { SYSTEM_AUTHOR_ID, SYSTEM_FAMILY_ID, ensureSystemAuthor, ensureSystemFamily } from './db/systemAuthor';
import type {
  CreateTaskInput,
  TaskView,
  InterestView,
  InterestStatus,
  NoteView,
  DebtView,
  IncomeView,
  TransactionView,
  AssetView,
  BudgetView,
  FinanceSummary,
  TransferView,
  ReminderView,
  FocusSessionView,
  DomainView,
  DomainSummary,
  DomainBalanceWheel,
  ProjectView,
  InterestReviewQuery,
  FlowSummaryQuery,
} from '@dm-life/shared';

/** 心流汇总视图（对齐 engine modules/flow/repository.FlowSummary；server 端按 family 隔离复刻） */
export interface FlowSummary {
  range: 'week' | 'month';
  axis: 'domain' | 'project';
  cols: { key: string; label: string }[];
  rows: {
    key: string;
    name: string;
    color?: string;
    cells: Record<string, { score: number | null; count: number; deepRatio: number; hours: number }>;
  }[];
  energySeries: { t: string; energy: number | null }[];
  attentionSeries: { t: string; score: number | null }[];
  insights: {
    goldenHour: number | null;
    topDomains: { key: string; name: string; avg: number; count: number }[];
    pseudoWork: { key: string; name: string; hours: number; avgScore: number }[];
    totalSessions: number;
    skipped: number;
    avgScore: number | null;
    avgEnergyEnd: number | null;
  };
  lowAttentionAlerts: string[];
}

function iso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'string') return d;
  return String(d);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUser(r: any): User {
  return { id: r.id, email: r.email, name: r.name, passwordHash: r.passwordHash, createdAt: iso(r.createdAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toFamily(r: any): Family {
  return { id: r.id, name: r.name, ownerId: r.ownerId, kind: (r.kind ?? 'personal') as Family['kind'], createdAt: iso(r.createdAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMembership(r: any): Membership {
  return { id: r.id, familyId: r.familyId, userId: r.userId, role: r.role as Role, joinedAt: iso(r.joinedAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toInvitation(r: any): Invitation {
  return { id: r.id, familyId: r.familyId, token: r.token, role: r.role as Role, createdBy: r.createdBy, expiresAt: iso(r.expiresAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(r: any): Session {
  return { id: r.id, userId: r.userId, refreshToken: r.refreshToken, expiresAt: iso(r.expiresAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCalendarEvent(r: any): CalendarEvent {
  return {
    id: r.id,
    familyId: r.familyId,
    title: r.title,
    description: r.description ?? null,
    location: r.location ?? null,
    startAt: r.startAt ? iso(r.startAt) : new Date().toISOString(),
    endAt: r.endAt ? iso(r.endAt) : null,
    allDay: Boolean(r.allDay),
    createdBy: r.createdBy,
    version: Number(r.version),
    ownerId: r.ownerId,
    visibility: (r.visibility ?? 'private') as 'private' | 'public',
    lastEditedBy: r.lastEditedBy ?? null,
    createdAt: iso(r.createdAt),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSharedFinanceItem(r: any): SharedFinanceItem {
  return {
    id: r.id,
    familyId: r.familyId,
    ownerUserId: r.ownerUserId,
    itemType: r.itemType as SharedFinanceItemType,
    itemKey: r.itemKey,
    label: r.label,
    scope: (r.scope ?? 'all') as SharedFinanceScope,
    allowedUserIds: Array.isArray(r.allowedUserIds) ? (r.allowedUserIds as string[]) : [],
    snapshot: r.snapshot,
    updatedAt: iso(r.updatedAt),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSharedItem(r: any): SharedItem {
  return {
    id: r.id,
    familyId: r.familyId,
    ownerUserId: r.ownerUserId,
    module: r.module as SharedItemModule,
    itemType: r.itemType,
    itemKey: r.itemKey,
    label: r.label,
    scope: (r.scope ?? 'all') as SharedItemScope,
    allowedUserIds: Array.isArray(r.allowedUserIds) ? (r.allowedUserIds as string[]) : [],
    snapshot: r.snapshot,
    done: Boolean(r.done),
    note: r.note ?? null,
    updatedAt: iso(r.updatedAt),
  };
}

/* ============================================================================
 * P1 zone 化：zone 过滤助手
 * 双写过渡期：familyId 列保留（= 调用者的 personal family），zone 读 = 本人私区(familyId)
 *   或 visibility='public' 的公区行；写（按 id）同样作用域。该 familyId 代理等价于
 *   ownerId=调用者（personal family 的 owner 即该用户），且兼容迁移期旧 familyId 兜底。
 * TODO(P1→P1final / 迁移 D.6 删 familyId 列之前必须完成): 将 resolveZone 及全部 list/update/delete
 *   谓词由 familyId 代理切换为 ownerId=ctx.userId（即 (ownerId=me OR visibility='public')）。过渡期因
 *   personal family 的 owner==该用户且双写 familyId，二者语义等价；一旦删除 familyId 列而谓词仍依赖
 *   familyId，私区隔离将失效。切换完成后本过渡注释与 getFamilyOwner 兜底可移除。
 * ========================================================================== */

/**
 * 返回 zone 作用域 WHERE 条件：(familyId = me OR visibility = 'public')。
 * 说明（评审 F3 复核）：`public` 分支是 ISSUE-002 受信编辑跨家庭共享的**既定特性**，非脆弱不变量——
 * 个人域实体被 owner 显式置为 public 后，对他人家庭可见（读），但跨家庭写必须经 bumpVersionAndEdit
 * 的「rowFamilyId !== familyId → 需该家庭 membership 否则 FORBIDDEN」护栏拦截，故无越权改/删泄漏。
 * 全部 personal 写路径默认 visibility='private'（无 UI 入口产 public），泄漏面仅限 owner 主动发布。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveZone(table: any, meFamilyId: string) {
  return or(eq(table.familyId, meFamilyId), eq(table.visibility, 'public'));
}

/** 解析 personal family 的 owner（= 该用户），用于写入 ownerId / lastEditedBy */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFamilyOwner(familyId: string): Promise<string> {
  const db = getDb();
  const rows = await db.select({ ownerId: families.ownerId }).from(families).where(eq(families.id, familyId)).limit(1);
  return rows[0]?.ownerId ?? familyId;
}

/**
 * zone 作用域内的更新 + 乐观锁（last-writer-wins 静默刷新）。
 * - WHERE 限定在调用者 zone：and(resolveZone(table, familyId), eq(table.id, id))，杜绝越权改他行。
 * - 读取当前 version；若 expectedVersion 提供且不相等 → 仍按传入 set 覆盖落库（不抛错），
 *   返回 conflict:true（前端凭 latestData 覆盖编辑框）；否则正常写、version+1、lastEditedBy=owner。
 * - 返回 { conflict }；latestData 由调用方在更新后重新读取该实体获得。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bumpVersionAndEdit(
  table: any,
  id: string,
  familyId: string,
  set: Record<string, unknown>,
  expectedVersion?: number,
): Promise<{ conflict: boolean }> {
  const ownerId = await getFamilyOwner(familyId); // 调用者身份（个人域 personal family 的 owner == ctx.userId）
  const db = getDb();
  // P1 安全修复（评审 #3）：版本读必须套 resolveZone，禁止越权读取他人行的 version；
  // 当 id 不在调用者 zone 内时抛 NOT_FOUND（替代原裸 eq(id) 读 + 调用方 `!` 空指针 500）。
  const cur = await db
    .select({ version: table.version, rowFamilyId: table.familyId })
    .from(table)
    .where(and(resolveZone(table, familyId), eq(table.id, id)))
    .limit(1);
  if (!cur[0]) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '资源不在你的可见区域内' });
  }
  // ISSUE-002 公区写权限（trusted-editor）：本行挂在其他家庭（visibility='public' 跨域可读），
  // 写入必须由该家庭的可信成员执行；否则禁止越权改写他人 public 行（IDOR）。
  // 本人私区/本人 public 行 rowFamilyId === familyId，跳过校验（调用者即 owner）。
  if (cur[0].rowFamilyId !== familyId) {
    const mem = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.familyId, cur[0].rowFamilyId), eq(memberships.userId, ownerId)))
      .limit(1);
    if (!mem[0]) {
      throw new TRPCError({ code: 'FORBIDDEN', message: '你不是该内容所属家庭的成员，无法编辑' });
    }
  }
  const curVersion = (cur[0].version as number) ?? 0;
  const conflict = expectedVersion !== undefined && curVersion !== expectedVersion;
  // last-writer-wins：无论是否冲突都按传入 set 覆盖写入，仅 version 递增、lastEditedBy 记录。
  await db
    .update(table)
    .set({ ...set, version: curVersion + 1, lastEditedBy: ownerId })
    .where(and(resolveZone(table, familyId), eq(table.id, id)));
  return { conflict };
}

/* ============================================================================
 * 个人域辅助：行→视图映射 & 通用工具（逐行对齐 engine 各 module/repository）
 * 时间列统一为 text(ISO)，此处直接映射；JSONB 列已解析为对象/数组，按 JSON 容错归一。
 * ========================================================================== */

function todayStr(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function csvCell(s: string): string {
  const v = s ?? '';
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/** 语义检索 token 化：英文/数字词 + 单汉字（CJK 单字兜底），小写 */
function tokenizeText(s: string): Set<string> {
  const text = (s ?? '').toLowerCase();
  const tokens = new Set<string>();
  const re = /[一-鿿]|[a-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.add(m[0]);
  return tokens;
}

function asStringArray(x: unknown): string[] {
  if (Array.isArray(x)) return x.map((v) => String(v));
  if (typeof x === 'string') {
    try { const a = JSON.parse(x); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
  }
  return [];
}

function asArray(x: unknown): unknown[] {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string') {
    try { const a = JSON.parse(x); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  return [];
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function durationH(isoStart: string, isoEnd: string): number {
  const ms = new Date(isoEnd).getTime() - new Date(isoStart).getTime();
  return Math.max(0, ms / 3_600_000);
}

/** 交易去重键（autoRefresh 幂等） */
function txnKey(t: { kind: string; category: string; occurredAt: string; debtId?: string | null; incomeSourceId?: string | null }): string {
  if (t.incomeSourceId) return `income:${t.incomeSourceId}:${(t.occurredAt || '').slice(0, 7)}`;
  if (t.debtId) return `debt:${t.debtId}:${(t.occurredAt || '').slice(0, 7)}`;
  return `${t.kind}:${t.category}:${t.occurredAt}`;
}

/** 解析「周」窗口：week 为周一 YYYY-MM-DD，返回 [周一 00:00 UTC, 下周一 00:00 UTC) */
function getWeekWindow(week: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error(`无效的 week 参数: ${week}（应为 YYYY-MM-DD）`);
  const d = new Date(week + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) throw new Error(`无效的 week 参数: ${week}（日期无法解析）`);
  const start = d.toISOString();
  const end = new Date(d.getTime() + 7 * 86400000).toISOString();
  return { start, end };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asRepricing(x: any): any {
  if (x == null) return null;
  if (typeof x === 'string') {
    try { const o = JSON.parse(x); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
  }
  return x;
}

/* ============ 任务 ============ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function taskRowToView(r: any): TaskView {
  const quadrant = r.importance && r.urgency
    ? 'q1'
    : r.importance && !r.urgency
      ? 'q2'
      : !r.importance && r.urgency
        ? 'q3'
        : 'q4';
  return {
    id: r.id,
    title: r.title,
    domainKey: r.domainKey,
    projectId: r.projectId ?? null,
    importance: !!r.importance,
    urgency: !!r.urgency,
    isMit: !!r.isMit,
    mitOrder: r.mitOrder ?? null,
    status: r.status,
    quadrant: quadrant as TaskView['quadrant'],
    scheduledStart: r.scheduledStart ?? null,
    scheduledEnd: r.scheduledEnd ?? null,
    dueAt: r.dueAt ?? null,
    description: r.description ?? '',
    priority: (r.priority as TaskView['priority']) ?? 'medium',
    createdAt: r.createdAt,
    completedAt: r.completedAt ?? null,
    completionQuality: r.completionQuality ?? null,
    attentionPeak: r.attentionPeak ?? null,
    taskDate: r.taskDate ?? null,
    repeat: (r.repeat as TaskView['repeat']) ?? 'none',
    sourceDailyId: r.sourceDailyId ?? null,
  };
}

/* ============ 兴趣 ============ */
function interestAgeDays(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function interestRetention(r: any): number {
  let idx = ((r.attention - 1) / 2) * 30;
  if (r.validatedAt || r.status === 'validated') idx += 20;
  if (r.convertedAt || r.linkedProjectId || r.status === 'converted') idx += 25;
  idx += Math.min(r.linkedNoteCount, 5) * 3;
  if (r.status === 'incubating' && interestAgeDays(r.createdAt) > 30) {
    idx -= Math.min(40, Math.floor((interestAgeDays(r.createdAt) - 30) / 30) * 10);
  }
  return Math.max(0, Math.min(100, Math.round(idx)));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function interestReviewPriority(r: any, qfKeys: Set<string>, activeProjects: Set<string>): number {
  let p = 0;
  p += r.viewCount * 2;
  p += r.linkedNoteCount * 3;
  if (r.domainKey && qfKeys.has(r.domainKey)) p += 15;
  if (r.sourceType === 'project' && r.sourceRef && activeProjects.has(r.sourceRef)) p += 10;
  if (r.status === 'incubating' && r.attention >= 3) p += 12;
  const age = interestAgeDays(r.createdAt);
  if (r.status === 'incubating' && age > 30) p += Math.min(20, Math.floor(age / 30) * 5);
  if (r.status === 'incubating' && interestRetention(r) < 30) p += 8;
  return p;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function interestRowToView(r: any, qfKeys: Set<string>, activeProjects: Set<string>): InterestView {
  const retention = interestRetention(r);
  const age = interestAgeDays(r.createdAt);
  return {
    id: r.id,
    title: r.title,
    content: r.content ?? null,
    attention: r.attention,
    sourceType: r.sourceType as InterestView['sourceType'],
    sourceRef: r.sourceRef ?? null,
    domainKey: r.domainKey ?? null,
    effortBudget: r.effortBudget as InterestView['effortBudget'],
    status: r.status as InterestStatus,
    linkedTaskId: r.linkedTaskId ?? null,
    linkedProjectId: r.linkedProjectId ?? null,
    viewCount: r.viewCount,
    linkedNoteCount: r.linkedNoteCount,
    validatedAt: r.validatedAt ?? null,
    convertedAt: r.convertedAt ?? null,
    archivedAt: r.archivedAt ?? null,
    discardedAt: r.discardedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    retentionIndex: retention,
    ageDays: age,
    reviewPriority: interestReviewPriority(r, qfKeys, activeProjects),
    discardSuggestion: r.status === 'incubating' && retention < 30,
  };
}

/* ============ 财务：债务 / 收入 / 交易 / 资产 / 转账 ============ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debtRowToView(r: any): DebtView {
  return {
    id: r.id,
    creditor: r.creditor,
    principal: r.principal,
    apr: r.apr,
    minPayment: r.minPayment,
    dueDay: r.dueDay,
    status: r.status,
    debtType: r.debtType,
    termMonths: r.termMonths,
    repaymentMethod: r.repaymentMethod,
    startDate: r.startDate,
    rateType: r.rateType,
    baseRate: r.baseRate,
    rateSpread: r.rateSpread,
    rateAdjustments: asArray(r.rateAdjustments).map((a: any) => ({ effectiveDate: String(a?.effectiveDate ?? ''), newRate: Number(a?.newRate) || 0 })),
    repricing: asRepricing(r.repricing),
    prepayments: asArray(r.prepayments).map((p: any) => ({ date: String(p?.date ?? ''), amount: Number(p?.amount) || 0, type: p?.type ?? 'reduce_term' })),
    parentDebtId: r.parentDebtId ?? null,
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    remainingPrincipal: getDebtSummary(debtRowToCalcInput(r)).remainingPrincipal,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function incomeRowToView(r: any): IncomeView {
  return {
    id: r.id,
    source: r.source,
    amount: r.amount,
    currency: r.currency,
    receivedAt: r.receivedAt,
    recurring: !!r.recurring,
    note: r.note,
    incomeType: r.incomeType,
    monthlyAvg: r.monthlyAvg,
    isFixed: !!r.isFixed,
    incomeMode: r.incomeMode,
    payDay: r.payDay,
    adjustmentDay: r.adjustmentDay,
    rateAdjustments: asArray(r.rateAdjustments).map((a: any) => ({ effectiveDate: String(a?.effectiveDate ?? ''), newAmount: Number(a?.newAmount) || 0 })),
    createdAt: r.createdAt,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function txnRowToView(r: any): TransactionView {
  return {
    id: r.id,
    kind: r.kind,
    category: r.category,
    amount: r.amount,
    merchant: r.merchant ?? null,
    occurredAt: r.occurredAt,
    debtId: r.debtId ?? null,
    incomeSourceId: r.incomeSourceId ?? null,
    note: r.note,
    createdAt: r.createdAt,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assetRowToView(r: any): AssetView {
  return {
    id: r.id,
    name: r.name,
    assetClass: r.assetClass,
    value: r.value,
    asOf: r.asOf,
    linkedIncomeSourceId: r.linkedIncomeSourceId ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transferRowToView(r: any): TransferView {
  return {
    id: r.id,
    fromAccountId: r.fromAccountId,
    toAccountId: r.toAccountId,
    amountMinor: r.amountMinor,
    currency: r.currency,
    occurredAt: r.occurredAt,
    note: r.note,
    idempotencyKey: r.idempotencyKey ?? null,
    reversed: !!r.reversed,
    reversedAt: r.reversedAt ?? null,
    createdAt: r.createdAt,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reminderRowToView(r: any): ReminderView {
  return {
    id: r.id,
    title: r.title,
    domainKey: r.domainKey,
    periodRule: r.periodRule,
    leadChain: Array.isArray(r.leadChain) ? r.leadChain : [7, 1, 0],
    noteLinked: r.noteLinked ?? null,
    nextFireAt: r.nextFireAt,
    lastFiredAt: r.lastFiredAt ?? null,
    lastCompletedAt: r.lastCompletedAt ?? null,
    status: r.status as ReminderView['status'],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** 把 DebtRow 映射成还款引擎输入（JSONB 列按 JSON 容错归一） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debtRowToCalcInput(r: any): DebtCalcInput {
  return {
    principal: Number(r.principal),
    annualRate: r.apr ?? 0,
    termMonths: r.termMonths ?? 0,
    repaymentMethod: (r.repaymentMethod as DebtCalcInput['repaymentMethod']) ?? 'equal_installment',
    startDate: r.startDate ?? r.createdAt,
    rateType: (r.rateType as DebtCalcInput['rateType']) ?? null,
    baseRate: r.baseRate ?? null,
    rateSpread: r.rateSpread ?? null,
    rateAdjustments: asArray(r.rateAdjustments).map((a: any) => ({ effectiveDate: String(a?.effectiveDate ?? ''), newRate: Number(a?.newRate) || 0 })),
    repricing: asRepricing(r.repricing),
    prepayments: asArray(r.prepayments).map((p: any) => ({ date: String(p?.date ?? ''), amount: Number(p?.amount) || 0, type: p?.type ?? 'reduce_term' })),
  };
}

/** 判断异常是否为唯一约束冲突（PG 码 23505，或消息含约束名）。
 *  用于 createTransfer 等幂等写入在并发重复提交时的优雅回退。 */
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  return err.code === '23505' || /unique|transfer_idem_uniq/i.test(err.message ?? '');
}

export const store = {
  async createUser(input: { email: string; name: string; passwordHash: string }): Promise<User> {
    const db = getDb();
    const [r] = await db
      .insert(users)
      .values({ email: input.email.toLowerCase(), name: input.name, passwordHash: input.passwordHash })
      .returning();
    return toUser(r);
  },
  async getUserById(id: string): Promise<User | undefined> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? toUser(rows[0]) : undefined;
  },
  async getUserByEmail(email: string): Promise<User | undefined> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return rows[0] ? toUser(rows[0]) : undefined;
  },

  async createFamily(input: { name: string; ownerId: string; kind?: 'personal' | 'shared' }): Promise<Family> {
    const db = getDb();
    const kind = input.kind ?? 'personal';
    const [r] = await db.insert(families).values({ name: input.name, ownerId: input.ownerId, kind }).returning();
    if (!r) throw new Error('创建家庭失败');
    // 个人家庭：种子写入 8+1 领域（域名是全局编目，但按 personal family 隔离存储）
    if (kind === 'personal') {
      await store.seedDomainsForFamily(r.id);
    }
    return toFamily(r);
  },

  /**
   * 解析当前用户的「个人家庭」：取该用户 membership 中 kind='personal' 的家庭；
   * 若没有（老库迁移兜底），回退到其第一个拥有者家庭。所有 personal 域 procedure 都经此隔离。
   */
  async getPersonalFamilyId(userId: string): Promise<string> {
    const db = getDb();
    const personal = await db
      .select({ familyId: families.id })
      .from(families)
      .innerJoin(memberships, eq(memberships.familyId, families.id))
      .where(and(eq(memberships.userId, userId), eq(families.kind, 'personal')))
      .limit(1);
    if (personal.length > 0) return personal[0]!.familyId;
    // 兜底：该用户拥有的第一个家庭
    const owned = await db
      .select({ familyId: families.id })
      .from(families)
      .innerJoin(memberships, eq(memberships.familyId, families.id))
      .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')))
      .limit(1);
    if (owned.length > 0) return owned[0]!.familyId;
    const any = await db
      .select({ familyId: families.id })
      .from(families)
      .innerJoin(memberships, eq(memberships.familyId, families.id))
      .where(eq(memberships.userId, userId))
      .limit(1);
    if (any.length > 0) return any[0]!.familyId;
    throw new Error('用户尚未加入任何家庭');
  },

  /** 8+1 领域种子（幂等：same (family_id, key) 唯一约束下 ON CONFLICT DO NOTHING） */
  async seedDomainsForFamily(familyId: string): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    const SEED = [
      { key: 'health', name: '健康', color: '#22c55e', isQuarterFocus: false },
      { key: 'family', name: '家庭', color: '#ec4899', isQuarterFocus: false },
      { key: 'work', name: '工作', color: '#3b82f6', isQuarterFocus: false },
      { key: 'wealth', name: '财富', color: '#eab308', isQuarterFocus: false },
      { key: 'social', name: '社交', color: '#a855f7', isQuarterFocus: false },
      { key: 'growth', name: '成长', color: '#14b8a6', isQuarterFocus: false },
      { key: 'leisure', name: '休闲', color: '#f97316', isQuarterFocus: false },
      { key: 'spirit', name: '心灵', color: '#6366f1', isQuarterFocus: false },
      { key: 'quarter', name: '季度聚焦', color: '#ef4444', isQuarterFocus: true },
    ] as const;
    await db
      .insert(domains)
      .values(SEED.map((d) => ({ familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null, key: d.key, name: d.name, color: d.color, isQuarterFocus: d.isQuarterFocus, createdAt: now })))
      .onConflictDoNothing();
  },
  async getFamily(id: string): Promise<Family | undefined> {
    const db = getDb();
    const rows = await db.select().from(families).where(eq(families.id, id)).limit(1);
    return rows[0] ? toFamily(rows[0]) : undefined;
  },

  async addMembership(input: { familyId: string; userId: string; role: Role }): Promise<Membership> {
    const db = getDb();
    const [r] = await db.insert(memberships).values(input).returning();
    return toMembership(r);
  },
  async getMembership(familyId: string, userId: string): Promise<Membership | undefined> {
    const db = getDb();
    const rows = await db.select().from(memberships).where(and(eq(memberships.familyId, familyId), eq(memberships.userId, userId))).limit(1);
    return rows[0] ? toMembership(rows[0]) : undefined;
  },
  async getMembershipsByFamily(familyId: string): Promise<Membership[]> {
    const db = getDb();
    const rows = await db.select().from(memberships).where(eq(memberships.familyId, familyId));
    return rows.map(toMembership);
  },
  async getMembershipsByUser(userId: string): Promise<Membership[]> {
    const db = getDb();
    const rows = await db.select().from(memberships).where(eq(memberships.userId, userId));
    return rows.map(toMembership);
  },
  async removeMembership(id: string): Promise<void> {
    const db = getDb();
    await db.delete(memberships).where(eq(memberships.id, id));
  },
  async updateMembershipRole(id: string, role: Role): Promise<Membership> {
    const db = getDb();
    const [r] = await db
      .update(memberships)
      .set({ role })
      .where(eq(memberships.id, id))
      .returning();
    return toMembership(r);
  },

  async createInvitation(input: { familyId: string; token: string; role: Role; createdBy: string; expiresAt: string }): Promise<Invitation> {
    const db = getDb();
    const [r] = await db.insert(invitations).values(input).returning();
    return toInvitation(r);
  },
  async getInvitation(token: string): Promise<Invitation | undefined> {
    const db = getDb();
    const rows = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
    return rows[0] ? toInvitation(rows[0]) : undefined;
  },
  async deleteInvitation(token: string): Promise<void> {
    const db = getDb();
    await db.delete(invitations).where(eq(invitations.token, token));
  },

  async createSession(input: { userId: string; refreshToken: string; expiresAt: string }): Promise<Session> {
    const db = getDb();
    const [r] = await db.insert(sessions).values(input).returning();
    return toSession(r);
  },
  async getSession(refreshToken: string): Promise<Session | undefined> {
    const db = getDb();
    const rows = await db.select().from(sessions).where(eq(sessions.refreshToken, refreshToken)).limit(1);
    return rows[0] ? toSession(rows[0]) : undefined;
  },
  async deleteSession(refreshToken: string): Promise<void> {
    const db = getDb();
    await db.delete(sessions).where(eq(sessions.refreshToken, refreshToken));
  },
  /** 吊销某用户的全部 refresh 会话（登出所有设备） */
  async deleteSessionsByUser(userId: string): Promise<void> {
    const db = getDb();
    await db.delete(sessions).where(eq(sessions.userId, userId));
  },

  /**
   * 注销账户（P1 zone 化版）—— 遵循 v3③：
   * - 吊销该用户全部会话；
   * - 该用户的「公开（visibility='public'）」行：改挂 SYSTEM_AUTHOR_ID 保留不删（避免悬空外键 / 丢失共享价值）；
   * - 该用户的「私区（visibility='private'）」行：彻底删除（隐私清除）；
   * - 共享快照类（sharedFinanceItems/sharedItems）：按 personal 家庭删除；
   * - 移除该用户在所有家庭的成员关系；删除 personal 家庭行与用户行。
   * 双写过渡期：private 行删除同时按 ownerId 与 familyId 兜底，确保无孤儿残留。
   */
  async deleteUserAccount(userId: string): Promise<void> {
    const db = getDb();
    // 0. 先解析个人家庭 —— 注册即创建，必存在；若缺失直接抛错，避免在 undefined familyId 上误匹配。
    const personalFamilyId = await store.getPersonalFamilyId(userId);
    // 0b. 确保 SYSTEM_AUTHOR_ID 系统用户存在，作为 public 行改挂的 FK 锚点（幂等 upsert）。
    await ensureSystemAuthor(db);
    // 0c. 确保 SYSTEM_FAMILY_ID 系统家庭存在；public 行改挂时一并迁移到该系统家庭，
    //     避免 delete(families) 的 onDelete=cascade 级联误删本应保留的 public 行。
    await ensureSystemFamily(db);
    // 全部清理在一个事务内完成：任一步失败整体回滚，杜绝"半删"残留。
    await db.transaction(async (tx: any) => {
      // 1. 吊销全部会话，避免令牌在本地被清后仍可被复用
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      // 2. zone 化个人表：public 行改挂系统用户（保留），private 行删除（按 ownerId + visibility，双写 familyId 兜底）
      const zoneTables: any[] = [
        tasks, notes, reminderClocks, debts, incomes, transactions, assets, budgets,
        interests, projects, domains, focusSessions, financeTransfers, systemMeta, calendarEvents,
      ];
      for (const t of zoneTables) {
        await tx
          .update(t)
          .set({ ownerId: SYSTEM_AUTHOR_ID, lastEditedBy: SYSTEM_AUTHOR_ID, familyId: SYSTEM_FAMILY_ID })
          .where(and(eq(t.ownerId, userId), eq(t.visibility, 'public')));
        await tx
          .delete(t)
          .where(
            or(
              and(eq(t.ownerId, userId), eq(t.visibility, 'private')),
              and(eq(t.familyId, personalFamilyId), eq(t.visibility, 'private')),
            ),
          );
      }
      // 3. 共享快照类（无 zone 列）：随 personal 家庭清理
      await tx.delete(sharedFinanceItems).where(eq(sharedFinanceItems.familyId, personalFamilyId));
      await tx.delete(sharedItems).where(eq(sharedItems.familyId, personalFamilyId));
      // 4. 移除该用户在所有家庭的成员关系（含 personal 与 shared）
      await tx.delete(memberships).where(eq(memberships.userId, userId));
      // 5. 删除个人家庭行（FK onDelete cascade 作为兜底，再次确保子表清理）
      await tx.delete(families).where(eq(families.id, personalFamilyId));
      // 6. 删除用户（系统用户行保留）
      await tx.delete(users).where(eq(users.id, userId));
    });
  },

  // ===== 共享日历（家庭共享日程） =====
  async createCalendarEvent(input: {
    familyId: string;
    title: string;
    description?: string | null;
    location?: string | null;
    startAt: string;
    endAt?: string | null;
    allDay?: boolean;
    createdBy: string;
  }): Promise<CalendarEvent> {
    const db = getDb();
    const [r] = await db
      .insert(calendarEvents)
      .values({
        familyId: input.familyId,
        ownerId: input.createdBy,
        visibility: 'private',
        version: 1,
        lastEditedBy: null,
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        startAt: input.startAt,
        endAt: input.endAt ?? null,
        allDay: input.allDay ?? false,
        createdBy: input.createdBy,
      })
      .returning();
    return toCalendarEvent(r);
  },
  async getCalendarEvent(id: string): Promise<CalendarEvent | undefined> {
    const db = getDb();
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1);
    return rows[0] ? toCalendarEvent(rows[0]) : undefined;
  },
  /** 列出家庭全部日历事件，按 startAt 升序（月视图/列表共用） */
  async listCalendarEvents(familyId: string): Promise<CalendarEvent[]> {
    const db = getDb();
    const rows = await db.select().from(calendarEvents).where(resolveZone(calendarEvents, familyId));
    const all: CalendarEvent[] = rows.map(toCalendarEvent);
    return all.sort((a, b) => a.startAt.localeCompare(b.startAt));
  },
  async updateCalendarEvent(
    id: string,
    patch: Partial<{
      title: string;
      description: string | null;
      location: string | null;
      startAt: string;
      endAt: string | null;
      allDay: boolean;
    }>,
  ): Promise<CalendarEvent | undefined> {
    const db = getDb();
    // P1：version 改为 integer 乐观锁（last-writer-wins），不再使用 timestamp。
    const [cur] = await db
      .select({ version: calendarEvents.version })
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .limit(1);
    const curVersion = (cur?.version as number) ?? 0;
    const [r] = await db
      .update(calendarEvents)
      .set({ ...patch, version: curVersion + 1 })
      .where(eq(calendarEvents.id, id))
      .returning();
    return r ? toCalendarEvent(r) : undefined;
  },
  async deleteCalendarEvent(id: string): Promise<void> {
    const db = getDb();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
  },

  // ===== 个人财务共享快照（家庭协作库桥接） =====
  /** upsert：以 (family_id, owner_user_id, item_type, item_key) 唯一键冲突更新，否则插入。 */
  async upsertSharedFinance(input: {
    familyId: string;
    ownerUserId: string;
    itemType: SharedFinanceItemType;
    itemKey: string;
    label: string;
    scope: SharedFinanceScope;
    allowedUserIds: string[];
    snapshot: unknown;
  }): Promise<SharedFinanceItem> {
    const db = getDb();
    // scope=all 时忽略 allowlist，避免越权残留
    const allowedUserIds = input.scope === 'all' ? [] : input.allowedUserIds;
    const [r] = await db
      .insert(sharedFinanceItems)
      .values({
        familyId: input.familyId,
        ownerUserId: input.ownerUserId,
        itemType: input.itemType,
        itemKey: input.itemKey,
        label: input.label,
        scope: input.scope,
        allowedUserIds,
        snapshot: input.snapshot,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [sharedFinanceItems.familyId, sharedFinanceItems.ownerUserId, sharedFinanceItems.itemType, sharedFinanceItems.itemKey],
        set: {
          label: input.label,
          scope: input.scope,
          allowedUserIds,
          snapshot: input.snapshot,
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();
    return toSharedFinanceItem(r);
  },

  /** 列出家庭全部共享财务项（权限/范围过滤在 router 层按 viewer 做）。 */
  async listSharedFinanceByFamily(familyId: string): Promise<SharedFinanceItem[]> {
    const db = getDb();
    const rows = await db.select().from(sharedFinanceItems).where(eq(sharedFinanceItems.familyId, familyId));
    return rows.map(toSharedFinanceItem);
  },

  async removeSharedFinance(id: string, familyId?: string): Promise<void> {
    const db = getDb();
    // N1：必须按 familyId 过滤，否则仅凭全局 id 可越权删除其他家庭的共享财务项
    await db
      .delete(sharedFinanceItems)
      .where(familyId ? and(eq(sharedFinanceItems.id, id), eq(sharedFinanceItems.familyId, familyId)) : eq(sharedFinanceItems.id, id));
  },

  // ===== 通用个人模块共享快照（提醒/记事/脑图/心流/领域…） =====
  /** upsert：以 (family_id, owner_user_id, module, item_type, item_key) 唯一键冲突更新，否则插入。 */
  async upsertSharedItem(input: {
    familyId: string;
    ownerUserId: string;
    module: SharedItemModule;
    itemType: string;
    itemKey: string;
    label: string;
    scope: SharedItemScope;
    allowedUserIds: string[];
    snapshot: unknown;
  }): Promise<SharedItem> {
    const db = getDb();
    const allowedUserIds = input.scope === 'all' ? [] : input.allowedUserIds;
    const [r] = await db
      .insert(sharedItems)
      .values({
        familyId: input.familyId,
        ownerUserId: input.ownerUserId,
        module: input.module,
        itemType: input.itemType,
        itemKey: input.itemKey,
        label: input.label,
        scope: input.scope,
        allowedUserIds,
        snapshot: input.snapshot,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [sharedItems.familyId, sharedItems.ownerUserId, sharedItems.module, sharedItems.itemType, sharedItems.itemKey],
        set: {
          label: input.label,
          scope: input.scope,
          allowedUserIds,
          snapshot: input.snapshot,
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();
    return toSharedItem(r);
  },

  /** 列出家庭共享项；可选按 module 过滤。权限/范围过滤在 router 层按 viewer 做。 */
  async listSharedItems(familyId: string, module?: string): Promise<SharedItem[]> {
    const db = getDb();
    const rows = module
      ? await db.select().from(sharedItems).where(and(eq(sharedItems.familyId, familyId), eq(sharedItems.module, module)))
      : await db.select().from(sharedItems).where(eq(sharedItems.familyId, familyId));
    return rows.map(toSharedItem);
  },

  async removeSharedItem(id: string, familyId?: string): Promise<void> {
    const db = getDb();
    // N1：必须按 familyId 过滤，否则仅凭全局 id 可越权删除其他家庭的共享项
    await db
      .delete(sharedItems)
      .where(familyId ? and(eq(sharedItems.id, id), eq(sharedItems.familyId, familyId)) : eq(sharedItems.id, id));
  },

  /** 协作操作：家庭成员标记完成 / 添加备注（仅更新 done/note；对任务模块额外同步 snapshot.status） */
  async updateSharedItem(id: string, familyId: string | undefined, patch: { done?: boolean; note?: string | null }): Promise<void> {
    const db = getDb();
    const [row] = await db
      .select({ module: sharedItems.module })
      .from(sharedItems)
      .where(familyId ? and(eq(sharedItems.id, id), eq(sharedItems.familyId, familyId)) : eq(sharedItems.id, id));
    if (!row) return; // N1：若 id 不属于该 family（跨家庭 IDOR），视为无操作，拒绝越权写入
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.done !== undefined) set.done = patch.done;
    if (patch.note !== undefined) set.note = patch.note;
    if (patch.done !== undefined && row.module === 'task') {
      set.snapshot = sql`jsonb_set(COALESCE(${sharedItems.snapshot}, '{}'::jsonb), '{status}', to_jsonb(${patch.done ? 'done' : 'todo'}::text))`;
    }
    await db
      .update(sharedItems)
      .set(set)
      .where(familyId ? and(eq(sharedItems.id, id), eq(sharedItems.familyId, familyId)) : eq(sharedItems.id, id));
  },

  /**
   * 批量同步 owner 的个人模块共享快照：单次事务内 upsert 多项 + 删除未选项，
   * 仅触发一次广播（替代前端 N 次 upsert/remove 导致 N 次广播的连锁放大）。
   */
  async syncSharedItems(
    familyId: string,
    ownerUserId: string,
    upserts: Array<{
      module: SharedItemModule;
      itemType: string;
      itemKey: string;
      label: string;
      scope: SharedItemScope;
      allowedUserIds: string[];
      snapshot: unknown;
    }>,
    removes: string[],
  ): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx: any) => {
      for (const u of upserts) {
        const allowedUserIds = u.scope === 'all' ? [] : u.allowedUserIds;
        await tx
          .insert(sharedItems)
          .values({
            familyId,
            ownerUserId,
            module: u.module,
            itemType: u.itemType,
            itemKey: u.itemKey,
            label: u.label,
            scope: u.scope,
            allowedUserIds,
            snapshot: u.snapshot,
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: [sharedItems.familyId, sharedItems.ownerUserId, sharedItems.module, sharedItems.itemType, sharedItems.itemKey],
            set: {
              label: u.label,
              scope: u.scope,
              allowedUserIds,
              snapshot: u.snapshot,
              updatedAt: new Date().toISOString(),
            },
          });
      }
      for (const id of removes) {
        // 仅删除「本人」共享的项：listByFamily 可能返回其他成员共享给我的项，
        // 若按整张 existing 列表做差集会误删他人共享。owner-only 约束保证安全。
        await tx
          .delete(sharedItems)
          .where(and(eq(sharedItems.id, id), eq(sharedItems.ownerUserId, ownerUserId)));
      }
    });
  },
  /* ============================================================================
   * 个人域 repository（从 engine 整体迁移；全部按 familyId 隔离，归 personal family）
   * 逻辑与 engine 各 module/command/repository 逐行对齐，仅把「全局表」改为「按 familyId 过滤」，
   * 并把事件溯源写路径收敛为直接落库（server 无事件表，实时性由 publishEvent 广播保证）。
   * ========================================================================== */

  /* ---------------- 通用 JSON 辅助 ---------------- */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getDebtView(familyId: string, id: string): Promise<DebtView | null> {
    const db = getDb();
    const rows = await db.select().from(debts).where(and(resolveZone(debts, familyId), eq(debts.id, id))).limit(1);
    return rows[0] ? debtRowToView(rows[0]) : null;
  },
  async listDebts(familyId: string): Promise<DebtView[]> {
    const db = getDb();
    const rows = await db.select().from(debts).where(resolveZone(debts, familyId)).orderBy(desc(debts.createdAt));
    return rows.map(debtRowToView);
  },

  /* ============ 任务 ============ */
  async createTask(
    familyId: string,
    data: Partial<CreateTaskInput> & { title: string; domainKey: CreateTaskInput['domainKey'] },
  ): Promise<TaskView> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    const taskDate = data.taskDate ?? (data.repeat === 'daily' ? null : todayStr());
    await db.insert(tasks).values({
      id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null,
      title: data.title, domainKey: data.domainKey, projectId: data.projectId ?? null,
      importance: data.importance, urgency: data.urgency, isMit: data.isMit, mitOrder: data.mitOrder ?? null,
      status: 'todo', scheduledStart: data.scheduledStart ?? null, scheduledEnd: data.scheduledEnd ?? null,
      dueAt: data.dueAt ?? null, description: data.description ?? '', priority: data.priority ?? 'medium',
      taskDate, repeat: data.repeat ?? 'none', sourceDailyId: data.sourceDailyId ?? null,
      createdAt: now, updatedAt: now,
    });
    return (await store.getTask(familyId, id))!;
  },
  async listToday(familyId: string, date?: string): Promise<TaskView[]> {
    return store.listForDate(familyId, date ?? todayStr());
  },
  async listForDate(familyId: string, date: string): Promise<TaskView[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(tasks)
      .where(and(resolveZone(tasks, familyId), eq(tasks.repeat, 'none'), or(eq(tasks.taskDate, date), isNull(tasks.taskDate))))
      .orderBy(desc(tasks.importance), asc(sql`coalesce(${tasks.scheduledStart}, ${tasks.createdAt})`));
    return rows.map(taskRowToView);
  },
  async listAllTasks(familyId: string): Promise<TaskView[]> {
    const db = getDb();
    const rows = await db.select().from(tasks).where(resolveZone(tasks, familyId)).orderBy(asc(tasks.scheduledStart), asc(tasks.createdAt));
    return rows.map(taskRowToView);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getTask(familyId: string, id: string): Promise<TaskView | null> {
    const db = getDb();
    const rows = await db.select().from(tasks).where(and(resolveZone(tasks, familyId), eq(tasks.id, id))).limit(1);
    return rows[0] ? taskRowToView(rows[0]) : null;
  },
  async ensureDaily(familyId: string, date: string): Promise<void> {
    const db = getDb();
    const ownerId = await getFamilyOwner(familyId);
    const templates = await db.select().from(tasks).where(and(resolveZone(tasks, familyId), eq(tasks.repeat, 'daily')));
    for (const t of templates) {
      const has = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(resolveZone(tasks, familyId), eq(tasks.sourceDailyId, t.id), eq(tasks.taskDate, date)))
        .limit(1);
      if (has.length > 0) continue;
      const id = randomUUID();
      const now = new Date().toISOString();
      const priority = (t.priority as TaskView['priority']) ?? 'medium';
      await db.insert(tasks).values({
        id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null,
        title: t.title, domainKey: (t.domainKey ?? 'work') as string, projectId: t.projectId,
        importance: !!t.importance, urgency: !!t.urgency, isMit: false, mitOrder: null,
        status: 'todo', scheduledStart: t.scheduledStart, scheduledEnd: t.scheduledEnd, dueAt: null,
        description: t.description ?? '', priority, taskDate: date, repeat: 'none', sourceDailyId: t.id,
        createdAt: now, updatedAt: now,
      });
    }
  },
  async completeTask(familyId: string, input: any, expectedVersion?: number): Promise<TaskView & { conflict: boolean; latestData: TaskView }> {
    const db = getDb();
    const completedAt = new Date().toISOString();
    const attentionPeak = await store.getPeakScoreForTask(familyId, input.id);
    const set: Record<string, unknown> = { status: 'done', completedAt, completionQuality: input.quality ?? null, attentionPeak, updatedAt: completedAt };
    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);
    const view = (await store.getTask(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  async uncompleteTask(familyId: string, input: any, expectedVersion?: number): Promise<TaskView & { conflict: boolean; latestData: TaskView }> {
    const db = getDb();
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { status: 'todo', completedAt: null, completionQuality: null, attentionPeak: null, updatedAt: now };
    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);
    const view = (await store.getTask(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  async setQuadrant(familyId: string, input: any, expectedVersion?: number): Promise<TaskView & { conflict: boolean; latestData: TaskView }> {
    const db = getDb();
    const set: Record<string, unknown> = { importance: input.importance, urgency: input.urgency, updatedAt: new Date().toISOString() };
    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);
    const view = (await store.getTask(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  async scheduleTask(familyId: string, input: any, expectedVersion?: number): Promise<TaskView & { conflict: boolean; latestData: TaskView }> {
    const db = getDb();
    const set: Record<string, unknown> = { scheduledStart: input.scheduledStart, scheduledEnd: input.scheduledEnd, updatedAt: new Date().toISOString() };
    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);
    const view = (await store.getTask(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  async setMit(familyId: string, input: any, expectedVersion?: number): Promise<TaskView & { conflict: boolean; latestData: TaskView }> {
    const db = getDb();
    const set: Record<string, unknown> = { isMit: input.isMit, mitOrder: input.mitOrder ?? null, updatedAt: new Date().toISOString() };
    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);
    const view = (await store.getTask(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateTask(familyId: string, data: any, expectedVersion?: number): Promise<TaskView & { conflict: boolean; latestData: TaskView }> {
    const db = getDb();
    const { id, ...rest } = data;
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) set[k] = v;
    }
    const { conflict } = await bumpVersionAndEdit(tasks, id, familyId, set, expectedVersion);
    const view = (await store.getTask(familyId, id))!;
    return { ...view, conflict, latestData: view };
  },
  async deleteTask(familyId: string, input: { id: string }): Promise<void> {
    const db = getDb();
    await db.delete(tasks).where(and(resolveZone(tasks, familyId), eq(tasks.id, input.id)));
  },
  async getPeakScoreForTask(familyId: string, taskId: string): Promise<number | null> {
    const db = getDb();
    const rows = await db.select({ score: focusSessions.score }).from(focusSessions).where(and(resolveZone(focusSessions, familyId), eq(focusSessions.taskId, taskId)));
    let peak: number | null = null;
    for (const r of rows) {
      if (r.score != null && (peak == null || r.score > peak)) peak = r.score;
    }
    return peak;
  },

  /* ============ 兴趣孵化器 ============ */
  async captureInterest(familyId: string, data: any): Promise<InterestView> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    await db.insert(interests).values({
      id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null,
      title: data.title, content: data.content ?? '', attention: data.attention ?? 1,
      sourceType: data.sourceType ?? 'manual', sourceRef: data.sourceRef ?? null, domainKey: data.domainKey ?? null,
      effortBudget: data.effortBudget ?? 'tbd', status: 'incubating', createdAt: now, updatedAt: now,
    });
    return (await store.getInterestView(familyId, id))!;
  },
  async listInterests(familyId: string, filter?: { status?: InterestStatus }): Promise<InterestView[]> {
    const { qfKeys, activeProjects } = await store.loadInterestContext(familyId);
    const db = getDb();
    const rows = filter?.status
      ? await db.select().from(interests).where(and(resolveZone(interests, familyId), eq(interests.status, filter.status)))
      : await db.select().from(interests).where(resolveZone(interests, familyId));
    return rows.map((r) => interestRowToView(r, qfKeys, activeProjects)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async reviewInterests(familyId: string, query: InterestReviewQuery = {}): Promise<InterestView[]> {
    const { qfKeys, activeProjects } = await store.loadInterestContext(familyId);
    const db = getDb();
    const rows = query.status
      ? await db.select().from(interests).where(and(resolveZone(interests, familyId), eq(interests.status, query.status)))
      : await db.select().from(interests).where(resolveZone(interests, familyId));
    return rows
      .map((r) => interestRowToView(r, qfKeys, activeProjects))
      .sort((a, b) => b.reviewPriority - a.reviewPriority);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateInterest(familyId: string, data: any, expectedVersion?: number): Promise<InterestView & { conflict: boolean; latestData: InterestView }> {
    const db = getDb();
    const { id, ...rest } = data;
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) set[k] = v;
    }
    const { conflict } = await bumpVersionAndEdit(interests, id, familyId, set, expectedVersion);
    const view = (await store.getInterestView(familyId, id))!;
    return { ...view, conflict, latestData: view };
  },
  async setInterestStatus(familyId: string, input: any, expectedVersion?: number): Promise<InterestView & { conflict: boolean; latestData: InterestView }> {
    const db = getDb();
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { status: input.status, updatedAt: now };
    if (input.status === 'validated') set.validatedAt = now;
    if (input.status === 'converted') set.convertedAt = now;
    if (input.status === 'archived') set.archivedAt = now;
    if (input.status === 'discarded') set.discardedAt = now;
    const { conflict } = await bumpVersionAndEdit(interests, input.id, familyId, set, expectedVersion);
    const view = (await store.getInterestView(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  async validateInterest(familyId: string, input: any, expectedVersion?: number): Promise<InterestView & { conflict: boolean; latestData: InterestView }> {
    const interest = await store.getInterestRaw(familyId, input.id);
    if (!interest) throw new TRPCError({ code: 'NOT_FOUND', message: '兴趣不存在' });
    const task = await store.createTask(familyId, {
      title: `验证「${interest.title}」：花 30 分钟搜集资料`,
      domainKey: (interest.domainKey ?? 'work') as any,
    });
    const { conflict } = await bumpVersionAndEdit(
      interests, input.id, familyId,
      { status: 'validated', validatedAt: new Date().toISOString(), linkedTaskId: task.id, updatedAt: new Date().toISOString() },
      expectedVersion,
    );
    const view = (await store.getInterestView(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  async convertInterest(familyId: string, input: any, expectedVersion?: number): Promise<InterestView & { conflict: boolean; latestData: InterestView }> {
    const interest = await store.getInterestRaw(familyId, input.id);
    if (!interest) throw new TRPCError({ code: 'NOT_FOUND', message: '兴趣不存在' });
    const project = await store.createProject(familyId, { name: input.name ?? interest.title, paraType: 'project' });
    const { conflict } = await bumpVersionAndEdit(
      interests, input.id, familyId,
      { status: 'converted', convertedAt: new Date().toISOString(), linkedProjectId: project.id, updatedAt: new Date().toISOString() },
      expectedVersion,
    );
    const view = (await store.getInterestView(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  async recordInterestView(familyId: string, input: any, expectedVersion?: number): Promise<InterestView & { conflict: boolean; latestData: InterestView }> {
    const db = getDb();
    const { conflict } = await bumpVersionAndEdit(interests, input.id, familyId, { viewCount: sql`${interests.viewCount} + 1`, updatedAt: new Date().toISOString() }, expectedVersion);
    const view = (await store.getInterestView(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getInterestRaw(familyId: string, id: string): Promise<any | null> {
    const db = getDb();
    const rows = await db.select().from(interests).where(and(resolveZone(interests, familyId), eq(interests.id, id))).limit(1);
    return rows[0] ?? null;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getInterestView(familyId: string, id: string): Promise<InterestView | null> {
    const raw = await store.getInterestRaw(familyId, id);
    if (!raw) return null;
    const { qfKeys, activeProjects } = await store.loadInterestContext(familyId);
    return interestRowToView(raw, qfKeys, activeProjects);
  },
  async loadInterestContext(familyId: string): Promise<{ qfKeys: Set<string>; activeProjects: Set<string> }> {
    const db = getDb();
    const dRows = await db.select({ key: domains.key, qf: domains.isQuarterFocus }).from(domains).where(resolveZone(domains, familyId));
    const qfKeys = new Set(dRows.filter((d) => d.qf).map((d) => d.key));
    const pRows = await db.select({ id: projects.id, status: projects.status }).from(projects).where(resolveZone(projects, familyId));
    const activeProjects = new Set(pRows.filter((p) => p.status === 'active').map((p) => p.id));
    return { qfKeys, activeProjects };
  },

  /* ============ 领域 ============ */
  async listDomains(familyId: string): Promise<DomainView[]> {
    const db = getDb();
    const rows = await db.select().from(domains).where(resolveZone(domains, familyId));
    return rows.map((r) => ({ key: r.key, name: r.name, isQuarterFocus: !!r.isQuarterFocus, color: r.color }));
  },
  async summaryDomains(familyId: string): Promise<DomainSummary[]> {
    const db = getDb();
    const all = await store.listDomains(familyId);
    const taskRows = await db.select().from(tasks).where(resolveZone(tasks, familyId));
    const focusRows = await db.select().from(focusSessions).where(resolveZone(focusSessions, familyId));
    const taskAgg = new Map<string, { total: number; done: number; active: number }>();
    for (const t of taskRows as any[]) {
      const a = taskAgg.get(t.domainKey) ?? { total: 0, done: 0, active: 0 };
      a.total += 1;
      if (t.status === 'done') a.done += 1;
      else if (t.status === 'todo' || t.status === 'doing') a.active += 1;
      taskAgg.set(t.domainKey, a);
    }
    const focusAgg = new Map<string, number>();
    for (const f of focusRows as any[]) {
      if (!f.domainKey || !f.startedAt || !f.endedAt) continue;
      const ms = new Date(f.endedAt).getTime() - new Date(f.startedAt).getTime();
      if (ms <= 0) continue;
      focusAgg.set(f.domainKey, (focusAgg.get(f.domainKey) ?? 0) + Math.round(ms / 60000));
    }
    return all.map((d) => {
      const a = taskAgg.get(d.key) ?? { total: 0, done: 0, active: 0 };
      const focusMinutes = focusAgg.get(d.key) ?? 0;
      const doneRate = a.total > 0 ? a.done / a.total : 0;
      return { key: d.key, name: d.name, color: d.color, isQuarterFocus: d.isQuarterFocus, taskTotal: a.total, taskDone: a.done, taskActive: a.active, focusMinutes, doneRate };
    });
  },
  async balanceWheel(familyId: string, week: string): Promise<DomainBalanceWheel> {
    const { start, end } = getWeekWindow(week);
    const db = getDb();
    const all = await store.listDomains(familyId);
    const focusRows = await db.select().from(focusSessions).where(resolveZone(focusSessions, familyId));
    const minutes = new Map<string, number>();
    for (const f of focusRows as any[]) {
      if (!f.domainKey || !f.startedAt || !f.endedAt) continue;
      if (f.startedAt < start || f.startedAt >= end) continue;
      const ms = new Date(f.endedAt).getTime() - new Date(f.startedAt).getTime();
      if (ms <= 0) continue;
      minutes.set(f.domainKey, (minutes.get(f.domainKey) ?? 0) + Math.round(ms / 60000));
    }
    const domainMinutes: Record<string, number> = {};
    let max = 0;
    for (const d of all) {
      const m = minutes.get(d.key) ?? 0;
      domainMinutes[d.key] = m;
      if (m > max) max = m;
    }
    const wheel = all.map((d) => {
      const m = minutes.get(d.key) ?? 0;
      return { key: d.key, name: d.name, color: d.color, minutes: m, score: max > 0 ? Math.round((m / max) * 100) : 0 };
    });
    const taskRows = await db.select().from(tasks).where(resolveZone(tasks, familyId));
    const open = new Map<string, number>();
    for (const t of taskRows as any[]) {
      if (t.status === 'todo' || t.status === 'doing') {
        open.set(t.domainKey, (open.get(t.domainKey) ?? 0) + 1);
      }
    }
    const topStresses = [...open.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    return { week, wheel, domainMinutes, topStresses };
  },

  /* ============ 项目 ============ */
  async listProjects(familyId: string): Promise<ProjectView[]> {
    const db = getDb();
    const rows = await db.select().from(projects).where(resolveZone(projects, familyId));
    return rows.map((r) => ({ id: r.id, name: r.name, paraType: r.paraType, status: r.status }));
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createProject(familyId: string, data: any): Promise<ProjectView> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    await db.insert(projects).values({ id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null, name: data.name, paraType: data.paraType ?? 'project', status: 'active', createdAt: now });
    const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    const r = rows[0]!;
    return { id: r.id, name: r.name, paraType: r.paraType, status: r.status };
  },

  /* ============ 笔记 ============ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ingestNote(familyId: string, data: any): Promise<string> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    await db.insert(notes).values({
      id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null,
      title: data.title, bodyMarkdown: data.bodyMarkdown ?? '', links: data.links ?? [], tags: data.tags ?? [],
      kind: data.kind ?? 'idea', taskId: data.taskId ?? null, createdAt: now, updatedAt: now, embeddedAt: now, embedding: null,
    });
    return id;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getNote(familyId: string, id: string): Promise<NoteView | null> {
    const db = getDb();
    const rows = await db.select().from(notes).where(and(resolveZone(notes, familyId), eq(notes.id, id))).limit(1);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, title: r.title, bodyMarkdown: r.bodyMarkdown, links: asStringArray(r.links), tags: asStringArray(r.tags), kind: (r.kind as 'idea' | 'notebook') ?? 'idea', taskId: r.taskId ?? null, createdAt: r.createdAt };
  },
  async updateNote(familyId: string, data: any, expectedVersion?: number): Promise<NoteView & { conflict: boolean; latestData: NoteView }> {
    const db = getDb();
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt: now };
    if (data.title !== undefined) set.title = data.title;
    if (data.bodyMarkdown !== undefined) set.bodyMarkdown = data.bodyMarkdown;
    if (data.links !== undefined) set.links = data.links;
    if (data.tags !== undefined) set.tags = data.tags;
    if (data.taskId !== undefined) set.taskId = data.taskId;
    const { conflict } = await bumpVersionAndEdit(notes, data.id, familyId, set, expectedVersion);
    const view = (await store.getNote(familyId, data.id))!;
    return { ...view, conflict, latestData: view };
  },
  async deleteNote(familyId: string, input: { id: string }): Promise<void> {
    const db = getDb();
    await db.delete(notes).where(and(resolveZone(notes, familyId), eq(notes.id, input.id)));
  },
  async listNotes(familyId: string, kind?: 'idea' | 'notebook'): Promise<NoteView[]> {
    const db = getDb();
    const rows = kind
      ? await db.select().from(notes).where(and(resolveZone(notes, familyId), eq(notes.kind, kind)))
      : await db.select().from(notes).where(resolveZone(notes, familyId));
    return rows
      .map((r) => ({ id: r.id, title: r.title, bodyMarkdown: r.bodyMarkdown, links: asStringArray(r.links), tags: asStringArray(r.tags), kind: (r.kind as 'idea' | 'notebook') ?? 'idea', taskId: r.taskId ?? null, createdAt: r.createdAt }))
      .reverse();
  },
  async listNotesForSearch(familyId: string): Promise<Array<{ id: string; title: string; bodyMarkdown: string }>> {
    const db = getDb();
    const rows = await db.select({ id: notes.id, title: notes.title, bodyMarkdown: notes.bodyMarkdown }).from(notes).where(resolveZone(notes, familyId));
    return rows as Array<{ id: string; title: string; bodyMarkdown: string }>;
  },

  /* ============ 知识：语义检索（token-overlap 兜底，无浏览器模型依赖） ============ */
  async semanticSearch(familyId: string, query: string, k = 5): Promise<Array<{ id: string; title: string; score: number; snippet: string }>> {
    const rows = await store.listNotesForSearch(familyId);
    const q = tokenizeText(query);
    const hits = rows
      .map((r) => {
        const toks = tokenizeText(`${r.title}\n${r.bodyMarkdown}`);
        let overlap = 0;
        for (const t of toks) if (q.has(t)) overlap += 1;
        const score = q.size > 0 ? overlap / q.size : 0;
        const flat = (r.bodyMarkdown || '').replace(/\s+/g, ' ').trim();
        const snippet = flat.length > 80 ? flat.slice(0, 80) + '…' : flat;
        return { id: r.id, title: r.title, snippet, score: round2(score) };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return hits;
  },

  /* ============ 财务：债务 ============ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createDebt(familyId: string, data: any): Promise<DebtView> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    await db.insert(debts).values({
      id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null,
      creditor: data.creditor, principal: data.principal, apr: data.apr ?? null, minPayment: data.minPayment ?? null,
      dueDay: data.dueDay ?? null, status: data.status ?? 'active', debtType: data.debtType ?? 'other', termMonths: data.termMonths ?? null,
      repaymentMethod: data.repaymentMethod ?? 'equal_installment', startDate: data.startDate ?? null, rateType: data.rateType ?? null,
      baseRate: data.baseRate ?? null, rateSpread: data.rateSpread ?? null, rateAdjustments: data.rateAdjustments ? data.rateAdjustments : null,
      repricing: data.repricing ? data.repricing : null, prepayments: data.prepayments ? data.prepayments : null, parentDebtId: data.parentDebtId ?? null,
      note: data.note ?? '', createdAt: now, updatedAt: now,
    });
    return (await store.getDebtView(familyId, id))!;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateDebt(familyId: string, data: any, expectedVersion?: number): Promise<DebtView & { conflict: boolean; latestData: DebtView }> {
    const db = getDb();
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt: now };
    if (data.creditor !== undefined) set.creditor = data.creditor;
    if (data.principal !== undefined) set.principal = data.principal;
    if (data.apr !== undefined) set.apr = data.apr;
    if (data.minPayment !== undefined) set.minPayment = data.minPayment;
    if (data.dueDay !== undefined) set.dueDay = data.dueDay;
    if (data.status !== undefined) set.status = data.status;
    if (data.debtType !== undefined) set.debtType = data.debtType;
    if (data.termMonths !== undefined) set.termMonths = data.termMonths ?? null;
    if (data.repaymentMethod !== undefined) set.repaymentMethod = data.repaymentMethod;
    if (data.startDate !== undefined) set.startDate = data.startDate ?? null;
    if (data.rateType !== undefined) set.rateType = data.rateType ?? null;
    if (data.baseRate !== undefined) set.baseRate = data.baseRate ?? null;
    if (data.rateSpread !== undefined) set.rateSpread = data.rateSpread ?? null;
    if (data.rateAdjustments !== undefined) set.rateAdjustments = data.rateAdjustments ? data.rateAdjustments : null;
    if (data.repricing !== undefined) set.repricing = data.repricing ? data.repricing : null;
    if (data.prepayments !== undefined) set.prepayments = data.prepayments ? data.prepayments : null;
    if (data.parentDebtId !== undefined) set.parentDebtId = data.parentDebtId ?? null;
    if (data.note !== undefined) set.note = data.note ?? '';
    const { conflict } = await bumpVersionAndEdit(debts, data.id, familyId, set, expectedVersion);
    const view = (await store.getDebtView(familyId, data.id))!;
    return { ...view, conflict, latestData: view };
  },
  async closeDebt(familyId: string, input: any, expectedVersion?: number): Promise<DebtView & { conflict: boolean; latestData: DebtView }> {
    const db = getDb();
    const { conflict } = await bumpVersionAndEdit(debts, input.id, familyId, { status: 'paid', updatedAt: new Date().toISOString() }, expectedVersion);
    const view = (await store.getDebtView(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  async reopenDebt(familyId: string, input: any, expectedVersion?: number): Promise<DebtView & { conflict: boolean; latestData: DebtView }> {
    const db = getDb();
    const { conflict } = await bumpVersionAndEdit(debts, input.id, familyId, { status: 'active', updatedAt: new Date().toISOString() }, expectedVersion);
    const view = (await store.getDebtView(familyId, input.id))!;
    return { ...view, conflict, latestData: view };
  },
  async deleteDebt(familyId: string, input: { id: string }): Promise<void> {
    const db = getDb();
    await db.delete(debts).where(and(resolveZone(debts, familyId), eq(debts.id, input.id)));
  },
  async debtSchedule(familyId: string, id: string) {
    const db = getDb();
    const rows = await db.select().from(debts).where(and(resolveZone(debts, familyId), eq(debts.id, id))).limit(1);
    if (!rows[0]) return null;
    const input = debtRowToCalcInput(rows[0]);
    return { summary: getDebtSummary(input), schedule: getRepaymentSchedule(input) };
  },
  async debtProgressSummary(familyId: string) {
    const db = getDb();
    const rows = (await db.select().from(debts).where(resolveZone(debts, familyId))).filter((d) => (d.termMonths ?? 0) > 0);
    const payTxns = (await db.select().from(transactions).where(resolveZone(transactions, familyId))).filter((t) => t.kind === 'debt_payment' && t.debtId);
    const txnCountByDebt = new Map<string, number>();
    for (const t of payTxns) {
      if (!t.debtId) continue;
      txnCountByDebt.set(t.debtId, (txnCountByDebt.get(t.debtId) ?? 0) + 1);
    }
    const items = rows.map((r: any) => {
      const sum = getDebtSummary(debtRowToCalcInput(r));
      const progress = r.status === 'paid' ? 1 : sum.progress;
      const principalProgress = r.status === 'paid' ? 1 : sum.principalProgress;
      const plannedPaid = Math.max(0, r.principal - sum.remainingPrincipal);
      const actualCount = txnCountByDebt.get(r.id) ?? 0;
      let actualPaid = plannedPaid;
      if (actualCount > 0 && sum.totalMonths > 0) {
        const schedule = getRepaymentSchedule(debtRowToCalcInput(r));
        const n = Math.min(actualCount, schedule.length);
        actualPaid = schedule.slice(0, n).reduce((s, row) => s + row.principal, 0);
      }
      return {
        id: r.id, creditor: r.creditor, debtType: r.debtType, status: r.status, principal: r.principal,
        remainingPrincipal: round2(sum.remainingPrincipal), paidPrincipal: round2(plannedPaid), actualPaidPrincipal: round2(actualPaid),
        paidMonths: sum.paidMonths, totalMonths: sum.totalMonths, progress: Math.max(0, Math.min(1, progress)),
        principalProgress: Math.max(0, Math.min(1, principalProgress)),
      };
    });
    let totalPrincipal = 0, weightedProgress = 0, totalPaidPrincipal = 0, totalActualPaid = 0, totalRemaining = 0, totalMonthsAll = 0, paidMonthsAll = 0;
    for (const it of items) {
      totalPrincipal += it.principal; totalPaidPrincipal += it.paidPrincipal; totalActualPaid += it.actualPaidPrincipal;
      totalRemaining += it.remainingPrincipal; totalMonthsAll += it.totalMonths; paidMonthsAll += it.paidMonths;
      weightedProgress += it.principalProgress * it.principal;
    }
    const overallProgress = totalPrincipal > 0 ? weightedProgress / totalPrincipal : 0;
    return {
      items,
      overall: {
        progress: Math.max(0, Math.min(1, overallProgress)), paidPrincipal: round2(totalPaidPrincipal),
        actualPaidPrincipal: round2(totalActualPaid), remainingPrincipal: round2(totalRemaining), totalPrincipal: round2(totalPrincipal),
        paidMonths: paidMonthsAll, totalMonths: totalMonthsAll,
      },
    };
  },
  async debtPayoffAdvice(familyId: string, mode: 'avalanche' | 'snowball') {
    const db = getDb();
    const rows = (await db.select().from(debts).where(resolveZone(debts, familyId))).filter((d) => d.status === 'active' && (d.termMonths ?? 0) > 0);
    const items = rows.map((r: any) => {
      const sum = getDebtSummary(debtRowToCalcInput(r));
      return { debtId: r.id, creditor: r.creditor, currentRate: sum.currentRate, remainingPrincipal: sum.remainingPrincipal, monthlyPayment: sum.monthlyPayment, rank: 0, reason: '' };
    });
    const cmp = mode === 'avalanche'
      ? (a: typeof items[number], b: typeof items[number]) => b.currentRate - a.currentRate || b.remainingPrincipal - a.remainingPrincipal
      : (a: typeof items[number], b: typeof items[number]) => a.remainingPrincipal - b.remainingPrincipal || b.currentRate - a.currentRate;
    items.sort((a, b) => cmp(a, b));
    items.forEach((it, i) => {
      it.rank = i + 1;
      it.reason = mode === 'avalanche' ? `利率最高 ${it.currentRate}%，先还省利息` : `余额最小 ¥${Math.round(it.remainingPrincipal).toLocaleString('zh-CN')}，先还得正反馈`;
    });
    return items;
  },

  /* ============ 财务：收入源 ============ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async recordIncome(familyId: string, data: any): Promise<IncomeView> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    await db.insert(incomes).values({
      id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null,
      source: data.source, amount: data.amount, currency: data.currency ?? 'CNY', receivedAt: data.receivedAt,
      recurring: data.recurring ?? false, note: data.note ?? '', incomeType: data.incomeType ?? 'salary', monthlyAvg: data.monthlyAvg ?? null,
      isFixed: data.isFixed ?? true, incomeMode: data.incomeMode ?? 'monthly', payDay: data.payDay ?? null, adjustmentDay: data.adjustmentDay ?? null,
      rateAdjustments: data.rateAdjustments ? data.rateAdjustments : null, createdAt: now,
    });
    return (await store.getIncomeView(familyId, id))!;
  },
  async listIncomes(familyId: string): Promise<IncomeView[]> {
    const db = getDb();
    const rows = await db.select().from(incomes).where(resolveZone(incomes, familyId)).orderBy(desc(incomes.receivedAt));
    return rows.map(incomeRowToView);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateIncome(familyId: string, data: any, expectedVersion?: number): Promise<IncomeView & { conflict: boolean; latestData: IncomeView }> {
    const db = getDb();
    const set: Record<string, unknown> = {};
    if (data.source !== undefined) set.source = data.source;
    if (data.amount !== undefined) set.amount = data.amount;
    if (data.note !== undefined) set.note = data.note;
    if (data.incomeType !== undefined) set.incomeType = data.incomeType;
    if (data.monthlyAvg !== undefined) set.monthlyAvg = data.monthlyAvg ?? null;
    if (data.isFixed !== undefined) set.isFixed = data.isFixed;
    if (data.incomeMode !== undefined) set.incomeMode = data.incomeMode;
    if (data.payDay !== undefined) set.payDay = data.payDay ?? null;
    if (data.adjustmentDay !== undefined) set.adjustmentDay = data.adjustmentDay ?? null;
    if (data.rateAdjustments !== undefined) set.rateAdjustments = data.rateAdjustments ? data.rateAdjustments : null;
    const { conflict } = await bumpVersionAndEdit(incomes, data.id, familyId, set, expectedVersion);
    const view = (await store.getIncomeView(familyId, data.id))!;
    return { ...view, conflict, latestData: view };
  },
  async deleteIncome(familyId: string, input: { id: string }): Promise<void> {
    const db = getDb();
    await db.delete(incomes).where(and(resolveZone(incomes, familyId), eq(incomes.id, input.id)));
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getIncomeView(familyId: string, id: string): Promise<IncomeView | null> {
    const db = getDb();
    const rows = await db.select().from(incomes).where(and(resolveZone(incomes, familyId), eq(incomes.id, id))).limit(1);
    return rows[0] ? incomeRowToView(rows[0]) : null;
  },

  /* ============ 财务：交易流水 ============ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async recordTransaction(familyId: string, data: any): Promise<TransactionView> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    await db.insert(transactions).values({
      id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null,
      kind: data.kind, category: data.category, amount: data.amount, merchant: data.merchant ?? null,
      occurredAt: data.occurredAt, note: data.note ?? '', debtId: data.debtId ?? null, incomeSourceId: data.incomeSourceId ?? null, createdAt: now,
    });
    return (await store.getTransactionView(familyId, id))!;
  },
  async listTransactions(familyId: string): Promise<TransactionView[]> {
    const db = getDb();
    const rows = await db.select().from(transactions).where(resolveZone(transactions, familyId)).orderBy(desc(transactions.occurredAt));
    return rows.map(txnRowToView);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateTransaction(familyId: string, data: any, expectedVersion?: number): Promise<TransactionView & { conflict: boolean; latestData: TransactionView }> {
    const db = getDb();
    const set: Record<string, unknown> = {};
    if (data.kind !== undefined) set.kind = data.kind;
    if (data.category !== undefined) set.category = data.category;
    if (data.amount !== undefined) set.amount = data.amount;
    if (data.note !== undefined) set.note = data.note;
    if (data.debtId !== undefined) set.debtId = data.debtId ?? null;
    if (data.incomeSourceId !== undefined) set.incomeSourceId = data.incomeSourceId ?? null;
    const { conflict } = await bumpVersionAndEdit(transactions, data.id, familyId, set, expectedVersion);
    const view = (await store.getTransactionView(familyId, data.id))!;
    return { ...view, conflict, latestData: view };
  },
  async deleteTransaction(familyId: string, input: { id: string }): Promise<void> {
    const db = getDb();
    await db.delete(transactions).where(and(resolveZone(transactions, familyId), eq(transactions.id, input.id)));
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getTransactionView(familyId: string, id: string): Promise<TransactionView | null> {
    const db = getDb();
    const rows = await db.select().from(transactions).where(and(resolveZone(transactions, familyId), eq(transactions.id, id))).limit(1);
    return rows[0] ? txnRowToView(rows[0]) : null;
  },

  /* ============ 财务：资产 ============ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async recordAsset(familyId: string, data: any): Promise<AssetView> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    await db.insert(assets).values({
      id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null,
      name: data.name, assetClass: data.assetClass, value: data.value, asOf: data.asOf,
      linkedIncomeSourceId: data.linkedIncomeSourceId ?? null, createdAt: now, updatedAt: now,
    });
    return (await store.getAssetView(familyId, id))!;
  },
  async listAssets(familyId: string): Promise<AssetView[]> {
    const db = getDb();
    const rows = await db.select().from(assets).where(resolveZone(assets, familyId)).orderBy(desc(assets.asOf));
    return rows.map(assetRowToView);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateAsset(familyId: string, data: any, expectedVersion?: number): Promise<AssetView & { conflict: boolean; latestData: AssetView }> {
    const db = getDb();
    const now = new Date().toISOString();
    const existing = await store.getAssetRaw(familyId, data.id);
    const set: Record<string, unknown> = {
      value: data.value ?? existing?.value ?? 0, asOf: data.asOf ?? existing?.asOf ?? now, updatedAt: now,
    };
    if (data.linkedIncomeSourceId !== undefined) set.linkedIncomeSourceId = data.linkedIncomeSourceId;
    if (data.assetClass !== undefined) set.assetClass = data.assetClass;
    if (data.name !== undefined) set.name = data.name;
    const { conflict } = await bumpVersionAndEdit(assets, data.id, familyId, set, expectedVersion);
    const view = (await store.getAssetView(familyId, data.id))!;
    return { ...view, conflict, latestData: view };
  },
  async deleteAsset(familyId: string, input: { id: string }): Promise<void> {
    const db = getDb();
    await db.delete(assets).where(and(resolveZone(assets, familyId), eq(assets.id, input.id)));
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getAssetRaw(familyId: string, id: string): Promise<any | null> {
    const db = getDb();
    const rows = await db.select().from(assets).where(and(resolveZone(assets, familyId), eq(assets.id, id))).limit(1);
    return rows[0] ?? null;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getAssetView(familyId: string, id: string): Promise<AssetView | null> {
    const raw = await store.getAssetRaw(familyId, id);
    return raw ? assetRowToView(raw) : null;
  },

  /* ============ 财务：预算 ============ */
  async monthExpenseFor(familyId: string, monthStr: string, category: string | null): Promise<number> {
    const db = getDb();
    const rows = await db.select().from(transactions).where(resolveZone(transactions, familyId));
    const monthExpenses = rows.filter((t) => t.kind === 'expense' && (t.occurredAt || '').slice(0, 7) === monthStr);
    const matched = category ? monthExpenses.filter((t) => t.category === category) : monthExpenses;
    return matched.reduce((s, t) => s + Number(t.amount), 0);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createBudget(familyId: string, data: any): Promise<BudgetView> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const ownerId = await getFamilyOwner(familyId);
    const scope = data.scope ?? 'overall';
    await db.insert(budgets).values({ id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null, name: data.name, scope, category: data.category ?? null, monthlyLimit: data.monthlyLimit, note: data.note ?? '', createdAt: now, updatedAt: now });
    const all = await store.listBudgets(familyId);
    return all.find((b) => b.id === id)!;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateBudget(familyId: string, data: any, expectedVersion?: number): Promise<BudgetView & { conflict: boolean; latestData: BudgetView }> {
    const db = getDb();
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt: now };
    if (data.name !== undefined) set.name = data.name;
    if (data.scope !== undefined) set.scope = data.scope;
    if (data.category !== undefined) set.category = data.category ?? null;
    if (data.monthlyLimit !== undefined) set.monthlyLimit = data.monthlyLimit;
    if (data.note !== undefined) set.note = data.note;
    const { conflict } = await bumpVersionAndEdit(budgets, data.id, familyId, set, expectedVersion);
    const all = await store.listBudgets(familyId);
    const view = all.find((b) => b.id === data.id)!;
    return { ...view, conflict, latestData: view };
  },
  async listBudgets(familyId: string): Promise<BudgetView[]> {
    const db = getDb();
    const rows = await db.select().from(budgets).where(resolveZone(budgets, familyId)).orderBy(desc(budgets.createdAt));
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return Promise.all(
      rows.map(async (r) => {
        const spent = await store.monthExpenseFor(familyId, monthStr, r.scope === 'category' ? r.category : null);
        const spentR = round2(spent);
        const remaining = round2(Number(r.monthlyLimit) - spent);
        const progress = Number(r.monthlyLimit) > 0 ? Math.max(0, Math.min(1.5, round2(spent / Number(r.monthlyLimit)))) : 0;
        return { id: r.id, name: r.name, scope: r.scope as 'overall' | 'category', category: r.category, monthlyLimit: Number(r.monthlyLimit), spent: spentR, remaining, progress, note: r.note, createdAt: r.createdAt, updatedAt: r.updatedAt };
      }),
    );
  },
  async deleteBudget(familyId: string, input: { id: string }): Promise<void> {
    const db = getDb();
    await db.delete(budgets).where(and(resolveZone(budgets, familyId), eq(budgets.id, input.id)));
  },

  /* ============ 财务：概览 / 趋势 / 核对 / 导出 / 自动刷新 ============ */
  async financeSummary(familyId: string): Promise<FinanceSummary> {
    const db = getDb();
    const debtRows = await db.select().from(debts).where(resolveZone(debts, familyId));
    const incomeRows = await db.select().from(incomes).where(resolveZone(incomes, familyId));
    const txnRows = await db.select().from(transactions).where(resolveZone(transactions, familyId));
    const assetRows = await db.select().from(assets).where(resolveZone(assets, familyId));
    let totalDebt = 0, monthlyMinPayment = 0, debtCount = 0;
    for (const d of debtRows as any[]) {
      if (d.status !== 'active') continue;
      const sum = getDebtSummary(debtRowToCalcInput(d));
      const hasSchedule = sum.totalMonths > 0;
      if (hasSchedule && sum.remainingPrincipal <= 0) continue;
      debtCount += 1;
      totalDebt += hasSchedule ? sum.remainingPrincipal : Number(d.principal);
      monthlyMinPayment += hasSchedule ? sum.monthlyPayment : Number(d.minPayment ?? 0);
    }
    let monthlyIncome = 0, incomeSourceCount = 0;
    for (const i of incomeRows as any[]) {
      if (i.incomeMode === 'monthly') { incomeSourceCount += 1; monthlyIncome += Number(i.monthlyAvg ?? i.amount); }
    }
    const totalAssets = assetRows.reduce((s, a) => s + Number(a.value), 0);
    const totalIncome = txnRows.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const totalExpense = txnRows.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthIncome = txnRows.filter((t) => t.kind === 'income' && (t.occurredAt || '').slice(0, 7) === thisMonth).reduce((s, t) => s + Number(t.amount), 0);
    const monthExpense = txnRows.filter((t) => (t.kind === 'expense' || t.kind === 'debt_payment') && (t.occurredAt || '').slice(0, 7) === thisMonth).reduce((s, t) => s + Number(t.amount), 0);
    const monthlyExpense = txnRows.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const netWorth = totalAssets - totalDebt;
    return {
      totalDebt: round2(totalDebt), monthlyMinPayment: round2(monthlyMinPayment), totalAssets: round2(totalAssets),
      totalIncome: round2(totalIncome), totalExpense: round2(totalExpense), netWorth: round2(netWorth),
      monthlyIncome: round2(monthlyIncome), monthlyDebtPayment: round2(monthlyMinPayment), monthlyExpense: round2(monthlyExpense),
      monthIncome: round2(monthIncome), monthExpense: round2(monthExpense), debtCount, incomeSourceCount,
    };
  },
  async financeReconcile(familyId: string) {
    const db = getDb();
    const debtRows = (await db.select().from(debts).where(resolveZone(debts, familyId))).filter((d) => (d.termMonths ?? 0) > 0);
    const txnRows = await db.select().from(transactions).where(resolveZone(transactions, familyId));
    const assetRows = await db.select().from(assets).where(resolveZone(assets, familyId));
    const debtIds = new Set((await db.select().from(debts).where(resolveZone(debts, familyId))).map((d) => d.id));
    let debtsTotal = 0, totalDebtPaid = 0;
    const paidByDebt = new Map<string, number>();
    for (const r of debtRows as any[]) {
      const sum = getDebtSummary(debtRowToCalcInput(r));
      const remaining = sum.remainingPrincipal;
      const paid = Math.max(0, Number(r.principal) - remaining);
      debtsTotal += remaining; totalDebtPaid += paid; paidByDebt.set(r.id, paid);
    }
    const assetsTotal = assetRows.reduce((s, a) => s + Number(a.value), 0);
    const totalIncome = txnRows.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const totalExpense = txnRows.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const payTxns = txnRows.filter((t) => t.kind === 'debt_payment');
    const paymentFlowTotal = payTxns.reduce((s, t) => s + Number(t.amount), 0);
    const netWorth = assetsTotal - debtsTotal;
    const discrepancies: any[] = [];
    const flowByDebt = new Map<string, number>();
    for (const t of payTxns) { if (!t.debtId) continue; flowByDebt.set(t.debtId, (flowByDebt.get(t.debtId) ?? 0) + Number(t.amount)); }
    for (const r of debtRows as any[]) {
      const paid = paidByDebt.get(r.id) ?? 0;
      const flow = flowByDebt.get(r.id) ?? 0;
      const diff = Math.round((paid - flow + Number.EPSILON) * 100) / 100;
      if (Math.abs(diff) > 0.01) discrepancies.push({ scope: `debt:${r.creditor}`, message: `债务「${r.creditor}」登记已还本金 ${round2(paid)}，还款流水合计 ${round2(flow)}`, diff });
    }
    const globalDiff = Math.round((totalDebtPaid - paymentFlowTotal + Number.EPSILON) * 100) / 100;
    if (Math.abs(globalDiff) > 0.01) discrepancies.push({ scope: 'global:paymentFlow', message: `全局还款流水 ${round2(paymentFlowTotal)} 与已还本金合计 ${round2(totalDebtPaid)} 不一致`, diff: globalDiff });
    for (const t of payTxns) { if (t.debtId && !debtIds.has(t.debtId)) discrepancies.push({ scope: `transaction:${t.id}`, message: `还款流水 ${t.id} 引用了不存在的债务 ${t.debtId}`, diff: Math.round((Number(t.amount) + Number.EPSILON) * 100) / 100 }); }
    return {
      balanced: discrepancies.length === 0, netWorth: round2(netWorth), assetsTotal: round2(assetsTotal), debtsTotal: round2(debtsTotal),
      totalIncome: round2(totalIncome), totalExpense: round2(totalExpense), totalDebtPaid: round2(totalDebtPaid), paymentFlowTotal: round2(paymentFlowTotal), discrepancies,
    };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async financeExportReport(familyId: string, input: { format: 'csv' | 'json'; month?: string }) {
    const db = getDb();
    const debtRows = await db.select().from(debts).where(resolveZone(debts, familyId));
    const incomeRows = await db.select().from(incomes).where(resolveZone(incomes, familyId));
    const assetRows = await db.select().from(assets).where(resolveZone(assets, familyId));
    let txnRows = await db.select().from(transactions).where(resolveZone(transactions, familyId));
    const assetsTotal = assetRows.reduce((s, a) => s + Number(a.value), 0);
    const debtsTotal = debtRows.reduce((s, r: any) => s + getDebtSummary(debtRowToCalcInput(r)).remainingPrincipal, 0);
    const netWorth = assetsTotal - debtsTotal;
    const totalIncome = txnRows.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const totalExpense = txnRows.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const period = input.month ?? 'all';
    if (input.month) txnRows = txnRows.filter((t) => (t.occurredAt || '').slice(0, 7) === input.month);
    const now = new Date();
    const fileMonth = input.month ?? now.toISOString().slice(0, 7);
    const filename = `finance-report-${fileMonth}.${input.format}`;
    if (input.format === 'json') {
      const content = JSON.stringify({
        generatedAt: now.toISOString(), period,
        summary: { assetsTotal: round2(assetsTotal), debtsTotal: round2(debtsTotal), netWorth: round2(netWorth), totalIncome: round2(totalIncome), totalExpense: round2(totalExpense) },
        debts: debtRows.map((r) => debtRowToView(r)), incomes: incomeRows.map((r) => incomeRowToView(r)), assets: assetRows.map((r) => assetRowToView(r)), transactions: txnRows.map((r) => txnRowToView(r)),
      }, null, 2);
      return { format: input.format, filename, content };
    }
    const lines: string[] = [];
    lines.push(`资产合计,${round2(assetsTotal)}`);
    lines.push(`负债合计,${round2(debtsTotal)}`);
    lines.push(`净资产,${round2(netWorth)}`);
    lines.push(`总收入,${round2(totalIncome)}`);
    lines.push(`总支出,${round2(totalExpense)}`);
    lines.push(`统计周期,${period}`);
    lines.push('');
    lines.push('date,type,category,amount,note');
    for (const t of txnRows) {
      const date = (t.occurredAt || '').slice(0, 10);
      lines.push(`${date},${t.kind},${csvCell(t.category)},${t.amount},${csvCell(t.note)}`);
    }
    return { format: input.format, filename, content: lines.join('\n') };
  },
  async financeMonthlyTrend(familyId: string, months: number) {
    const db = getDb();
    const now = new Date();
    const trend: Array<{ month: string; income: number; expense: number; net: number }> = [];
    const txnRows = await db.select().from(transactions).where(resolveZone(transactions, familyId));
    for (let i = months - 1; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthTxns = txnRows.filter((t) => (t.occurredAt || '').slice(0, 7) === monthStr);
      const income = monthTxns.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0);
      const expense = monthTxns.filter((t) => t.kind === 'expense' || t.kind === 'debt_payment').reduce((s, t) => s + Number(t.amount), 0);
      trend.push({ month: monthStr, income: round2(income), expense: round2(expense), net: round2(income - expense) });
    }
    return trend;
  },
  async financeAutoRefresh(familyId: string, refNow: Date = new Date()): Promise<{ incomes: number; debts: number; skipped: number }> {
    const db = getDb();
    const ownerId = await getFamilyOwner(familyId);
    const y = refNow.getFullYear();
    const m = refNow.getMonth();
    const thisMonthStr = `${y}-${String(m + 1).padStart(2, '0')}`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    let incomeCount = 0, debtCount = 0, skipped = 0;
    const existing = await db.select().from(transactions).where(resolveZone(transactions, familyId));
    const existingKeys = new Set(existing.filter((t) => (t.occurredAt || '').slice(0, 7) === thisMonthStr).map((t) => txnKey(t)));
    const incomeRows = await db.select().from(incomes).where(resolveZone(incomes, familyId));
    for (const inc of incomeRows as any[]) {
      if (inc.incomeMode !== 'monthly') continue;
      const payDay = Math.min(inc.payDay ?? 28, lastDay);
      const payDate = `${thisMonthStr}-${String(payDay).padStart(2, '0')}`;
      if (refNow < new Date(payDate)) continue;
      const amount = inc.monthlyAvg ?? inc.amount;
      const key = `income:${inc.id}:${thisMonthStr}`;
      if (existingKeys.has(key)) { skipped += 1; continue; }
      const id = randomUUID();
      await db.insert(transactions).values({ id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null, kind: 'income', category: inc.source, amount, merchant: null, occurredAt: payDate, note: '自动生成', incomeSourceId: inc.id, createdAt: refNow.toISOString() });
      incomeCount += 1;
    }
    const debtRows = (await db.select().from(debts).where(resolveZone(debts, familyId))).filter((d) => d.status === 'active');
    for (const d of debtRows as any[]) {
      const sum = getDebtSummary(debtRowToCalcInput(d));
      if (sum.paidMonths >= sum.totalMonths && sum.totalMonths > 0) continue;
      const dedDay = Math.min(d.dueDay ?? new Date(d.startDate ?? d.createdAt).getDate(), lastDay);
      const dedDate = `${thisMonthStr}-${String(dedDay).padStart(2, '0')}`;
      if (refNow < new Date(dedDate)) continue;
      const key = `debt:${d.id}:${thisMonthStr}`;
      if (existingKeys.has(key)) { skipped += 1; continue; }
      const id = randomUUID();
      await db.insert(transactions).values({ id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null, kind: 'debt_payment', category: d.creditor, amount: sum.monthlyPayment > 0 ? sum.monthlyPayment : d.minPayment ?? 0, merchant: null, occurredAt: dedDate, note: '自动生成', debtId: d.id, createdAt: refNow.toISOString() });
      debtCount += 1;
    }
    return { incomes: incomeCount, debts: debtCount, skipped };
  },

  /* ============ 财务：金额互转（预留契约 P3） ============ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createTransfer(familyId: string, data: any): Promise<TransferView> {
    const db = getDb();
    const ownerId = await getFamilyOwner(familyId);
    const id = randomUUID();
    const now = new Date().toISOString();
    if (data.idempotencyKey) {
      const existing = await db.select().from(financeTransfers).where(and(eq(financeTransfers.familyId, familyId), eq(financeTransfers.idempotencyKey, data.idempotencyKey))).limit(1);
      if (existing.length) return transferRowToView(existing[0]);
    }
    try {
      await db.insert(financeTransfers).values({
        id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null, fromAccountId: data.fromAccountId, toAccountId: data.toAccountId, amountMinor: data.amountMinor,
        currency: data.currency ?? 'CNY', occurredAt: data.occurredAt, note: data.note ?? '', idempotencyKey: data.idempotencyKey ?? null,
        reversed: 0, reversedAt: null, createdAt: now,
      });
    } catch (e) {
      // 并发重复提交（相同 idempotency_key）：唯一约束拦截后回退返回既有记录，
      // 而非抛 500 / 造成重复转账（网络重试场景下幂等）。
      if (data.idempotencyKey && isUniqueViolation(e)) {
        const existing = await db.select().from(financeTransfers).where(and(eq(financeTransfers.familyId, familyId), eq(financeTransfers.idempotencyKey, data.idempotencyKey))).limit(1);
        if (existing.length) return transferRowToView(existing[0]);
      }
      throw e;
    }
    const row = (await db.select().from(financeTransfers).where(eq(financeTransfers.id, id)).limit(1))[0]!;
    return transferRowToView(row);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listTransfers(familyId: string, opts: { limit: number; offset: number; accountId?: string }): Promise<TransferView[]> {
    const db = getDb();
    let rows: any[];
    if (opts.accountId) {
      rows = await db.select().from(financeTransfers).where(and(eq(financeTransfers.familyId, familyId), or(eq(financeTransfers.fromAccountId, opts.accountId), eq(financeTransfers.toAccountId, opts.accountId)))).orderBy(desc(financeTransfers.occurredAt)).limit(opts.limit).offset(opts.offset);
    } else {
      rows = await db.select().from(financeTransfers).where(eq(financeTransfers.familyId, familyId)).orderBy(desc(financeTransfers.occurredAt)).limit(opts.limit).offset(opts.offset);
    }
    return rows.map(transferRowToView);
  },
  async getTransfer(familyId: string, id: string): Promise<TransferView | null> {
    const db = getDb();
    const rows = await db.select().from(financeTransfers).where(and(eq(financeTransfers.familyId, familyId), eq(financeTransfers.id, id))).limit(1);
    return rows[0] ? transferRowToView(rows[0]) : null;
  },
  async reverseTransfer(familyId: string, input: { id: string }): Promise<TransferView> {
    const db = getDb();
    await db.update(financeTransfers).set({ reversed: 1, reversedAt: new Date().toISOString() }).where(and(eq(financeTransfers.familyId, familyId), eq(financeTransfers.id, input.id)));
    return (await store.getTransfer(familyId, input.id))!;
  },

  /* ============ 提醒钟表铺 ============ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createReminder(familyId: string, data: any): Promise<ReminderView> {
    const db = getDb();
    const ownerId = await getFamilyOwner(familyId);
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.insert(reminderClocks).values({
      id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null, title: data.title, domainKey: data.domainKey, periodRule: data.periodRule, leadChain: data.leadChain ?? [7, 1, 0],
      noteLinked: data.noteLinked ?? null, nextFireAt: data.nextFireAt, status: 'active', createdAt: now, updatedAt: now,
    });
    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, id))).limit(1);
    return reminderRowToView(rows[0]!);
  },
  async listClocks(familyId: string): Promise<ReminderView[]> {
    const db = getDb();
    const rows = await db.select().from(reminderClocks).where(resolveZone(reminderClocks, familyId)).orderBy(asc(reminderClocks.nextFireAt));
    return rows.map(reminderRowToView);
  },
  async listUpcoming(familyId: string, horizonIso: string): Promise<ReminderView[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(reminderClocks)
      .where(and(resolveZone(reminderClocks, familyId), sql`status IN ('active','due','overdue') AND next_fire_at <= ${horizonIso}`))
      .orderBy(asc(reminderClocks.nextFireAt));
    return rows.map(reminderRowToView);
  },
  async completeReminder(familyId: string, input: { id: string }, expectedVersion?: number): Promise<ReminderView & { conflict: boolean; latestData: ReminderView }> {
    const db = getDb();
    const now = new Date().toISOString();
    const row = (await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, input.id))).limit(1))[0];
    if (!row) throw new Error(`reminder not found: ${input.id}`);
    const next = computeNextFire(row.periodRule, now);
    const set: Record<string, unknown> = { lastCompletedAt: now, updatedAt: now };
    if (next === null) set.status = 'done';
    else { set.nextFireAt = next; set.status = 'active'; }
    const { conflict } = await bumpVersionAndEdit(reminderClocks, input.id, familyId, set, expectedVersion);
    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, input.id))).limit(1);
    const view = reminderRowToView(rows[0]!);
    return { ...view, conflict, latestData: view };
  },
  async rewindReminder(familyId: string, input: { id: string; nextFireAt: string }, expectedVersion?: number): Promise<ReminderView & { conflict: boolean; latestData: ReminderView }> {
    const db = getDb();
    const { conflict } = await bumpVersionAndEdit(reminderClocks, input.id, familyId, { nextFireAt: input.nextFireAt, status: 'active', updatedAt: new Date().toISOString() }, expectedVersion);
    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, input.id))).limit(1);
    const view = reminderRowToView(rows[0]!);
    return { ...view, conflict, latestData: view };
  },
  async snoozeReminder(familyId: string, input: { id: string; nextFireAt: string }, expectedVersion?: number): Promise<ReminderView & { conflict: boolean; latestData: ReminderView }> {
    const db = getDb();
    const { conflict } = await bumpVersionAndEdit(reminderClocks, input.id, familyId, { nextFireAt: input.nextFireAt, status: 'active', updatedAt: new Date().toISOString() }, expectedVersion);
    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, input.id))).limit(1);
    const view = reminderRowToView(rows[0]!);
    return { ...view, conflict, latestData: view };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateReminder(familyId: string, data: any, expectedVersion?: number): Promise<ReminderView & { conflict: boolean; latestData: ReminderView }> {
    const db = getDb();
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt: now };
    if (data.title !== undefined) set.title = data.title;
    if (data.periodRule !== undefined) set.periodRule = data.periodRule;
    if (data.leadChain !== undefined) set.leadChain = data.leadChain;
    if (data.noteLinked !== undefined) set.noteLinked = data.noteLinked;
    const { conflict } = await bumpVersionAndEdit(reminderClocks, data.id, familyId, set, expectedVersion);
    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, data.id))).limit(1);
    const view = reminderRowToView(rows[0]!);
    return { ...view, conflict, latestData: view };
  },
  async deleteReminder(familyId: string, input: { id: string }): Promise<void> {
    const db = getDb();
    await db.delete(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, input.id)));
  },
  async tickReminders(familyId: string, graceDays: number = 7, expectedVersion?: number): Promise<{ fired: string[]; overdue: string[] }> {
    const db = getDb();
    const now = new Date().toISOString();
    const graceIso = new Date(Date.now() - graceDays * 86400000).toISOString();
    const fired: string[] = [];
    const overdue: string[] = [];
    const dueNow = await db
      .select()
      .from(reminderClocks)
      .where(and(resolveZone(reminderClocks, familyId), sql`status='active' AND next_fire_at <= ${now}`));
    for (const r of dueNow) {
      await bumpVersionAndEdit(reminderClocks, r.id, familyId, { status: 'due', lastFiredAt: now, updatedAt: now }, expectedVersion);
      fired.push(r.id);
    }
    const overdueNow = await db
      .select()
      .from(reminderClocks)
      .where(and(resolveZone(reminderClocks, familyId), sql`status='due' AND last_fired_at <= ${graceIso}`));
    for (const r of overdueNow) {
      await bumpVersionAndEdit(reminderClocks, r.id, familyId, { status: 'overdue', updatedAt: now }, expectedVersion);
      overdue.push(r.id);
    }
    return { fired, overdue };
  },

  /* ============ 心流仪表盘 ============ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async recordSession(familyId: string, data: any): Promise<string> {
    const db = getDb();
    const ownerId = await getFamilyOwner(familyId);
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.insert(focusSessions).values({
      id, familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null, taskId: data.taskId ?? null, domainKey: data.domainKey ?? null, projectId: data.projectId ?? null,
      attentionType: data.attentionType ?? 'deep', startedAt: data.startedAt, endedAt: data.endedAt, score: data.score ?? null,
      energyStart: data.energyStart ?? null, energyEnd: data.energyEnd ?? null, interruptions: data.interruptions ?? [], note: data.note ?? null, createdAt: now,
    });
    return id;
  },
  async listSessions(familyId: string, limit = 50): Promise<FocusSessionView[]> {
    const db = getDb();
    const rows = await db.select().from(focusSessions).where(resolveZone(focusSessions, familyId)).orderBy(asc(focusSessions.startedAt)).limit(limit);
    return rows
      .reverse()
      .map((r) => ({ id: r.id, taskId: r.taskId ?? null, domainKey: r.domainKey ?? null, projectId: r.projectId ?? null, attentionType: r.attentionType as FocusSessionView['attentionType'], startedAt: r.startedAt, endedAt: r.endedAt, score: r.score, energyStart: r.energyStart, energyEnd: r.energyEnd, interruptions: asArray(r.interruptions) as any[], note: r.note ?? null }));
  },
  async summarizeFlow(familyId: string, q: FlowSummaryQuery): Promise<FlowSummary> {
    const db = getDb();
    const days = q.range === 'week' ? 7 : 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = (await db.select().from(focusSessions).where(and(resolveZone(focusSessions, familyId), gte(focusSessions.startedAt, since)))) as any[];
    const axisRows = q.axis === 'domain'
      ? await db.select().from(domains).where(resolveZone(domains, familyId))
      : await db.select().from(projects).where(resolveZone(projects, familyId));
    const nameOf = new Map<string, string>();
    const colorOf = new Map<string, string>();
    for (const r of axisRows as any[]) {
      const k = q.axis === 'domain' ? r.key : r.id;
      nameOf.set(k, r.name);
      if (r.color) colorOf.set(k, r.color);
    }
    let cols: { key: string; label: string }[];
    if (q.unit === 'hour') cols = Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: `${String(h).padStart(2, '0')}` }));
    else {
      cols = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(Date.now() - i * 86400000);
        cols.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, label: `${d.getMonth() + 1}/${d.getDate()}` });
      }
    }
    const rowDefs = new Map<string, { name: string; color?: string }>();
    for (const r of axisRows as any[]) {
      const k = q.axis === 'domain' ? r.key : r.id;
      rowDefs.set(k, { name: r.name, color: r.color });
    }
    rowDefs.set('__none', { name: '未分类' });
    const cellMap = new Map<string, Record<string, { score: number | null; count: number; deepRatio: number; hours: number }>>();
    for (const [k, def] of rowDefs) {
      const cells: Record<string, { score: number | null; count: number; deepRatio: number; hours: number }> = {};
      for (const c of cols) cells[c.key] = { score: null, count: 0, deepRatio: 0, hours: 0 };
      cellMap.set(k, cells);
    }
    const energyByDay = new Map<string, number[]>();
    const scoreByDay = new Map<string, number[]>();
    const hourScoreSum = new Map<number, { sum: number; n: number }>();
    const domainAgg = new Map<string, { sum: number; n: number; hours: number; interrupts: number }>();
    let totalSessions = 0, skipped = 0, scoreSum = 0, scoreN = 0, energyEndSum = 0, energyEndN = 0;
    for (const r of rows) {
      totalSessions += 1;
      const score = r.score == null ? null : Number(r.score);
      if (score == null) skipped += 1;
      if (score != null) { scoreSum += score; scoreN += 1; }
      if (r.energyEnd != null) { energyEndSum += Number(r.energyEnd); energyEndN += 1; }
      const interrupts = asArray(r.interruptions).length;
      const rowKey = (q.axis === 'domain' ? r.domainKey : r.projectId) ?? '__none';
      if (!cellMap.has(rowKey)) {
        const cells: Record<string, { score: number | null; count: number; deepRatio: number; hours: number }> = {};
        for (const c of cols) cells[c.key] = { score: null, count: 0, deepRatio: 0, hours: 0 };
        cellMap.set(rowKey, cells);
        rowDefs.set(rowKey, { name: nameOf.get(rowKey) ?? rowKey });
      }
      const colKey = q.unit === 'hour' ? String(new Date(r.startedAt).getHours()) : dayKey(r.startedAt);
      const cell = cellMap.get(rowKey)![colKey];
      if (cell) {
        cell.count += 1;
        cell.hours += durationH(r.startedAt, r.endedAt);
        if (score != null) cell.score = (cell.score == null ? 0 : cell.score) + score;
        if (r.attentionType === 'deep') cell.deepRatio += 1;
      }
      const dk = dayKey(r.startedAt);
      if (r.energyEnd != null) { if (!energyByDay.has(dk)) energyByDay.set(dk, []); energyByDay.get(dk)!.push(Number(r.energyEnd)); }
      if (score != null) { if (!scoreByDay.has(dk)) scoreByDay.set(dk, []); scoreByDay.get(dk)!.push(score); }
      const h = new Date(r.startedAt).getHours();
      if (score != null) { const cur = hourScoreSum.get(h) ?? { sum: 0, n: 0 }; cur.sum += score; cur.n += 1; hourScoreSum.set(h, cur); }
      if (r.domainKey) { const agg = domainAgg.get(r.domainKey) ?? { sum: 0, n: 0, hours: 0, interrupts: 0 }; if (score != null) { agg.sum += score; agg.n += 1; } agg.hours += durationH(r.startedAt, r.endedAt); agg.interrupts += interrupts; domainAgg.set(r.domainKey, agg); }
    }
    const outRows = Array.from(cellMap.entries())
      .map(([k, cells]) => {
        const normCells: Record<string, { score: number | null; count: number; deepRatio: number; hours: number }> = {};
        let total = 0;
        for (const [ck, c] of Object.entries(cells)) {
          const avg = c.count > 0 && c.score != null ? Number((c.score / c.count).toFixed(2)) : null;
          normCells[ck] = { score: avg, count: c.count, deepRatio: c.count > 0 ? Number((c.deepRatio / c.count).toFixed(2)) : 0, hours: Number(c.hours.toFixed(2)) };
          total += c.count;
        }
        return { key: k, name: rowDefs.get(k)?.name ?? k, color: rowDefs.get(k)?.color, cells: normCells, total };
      })
      .filter((r) => r.total > 0)
      .map(({ total: _t, ...rest }) => rest);
    const energySeries = Array.from(energyByDay.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([t, arr]) => ({ t, energy: Number((arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(2)) }));
    const attentionSeries = Array.from(scoreByDay.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([t, arr]) => ({ t, score: Number((arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(2)) }));
    let goldenHour: number | null = null, goldenBest = -1;
    for (const [h, v] of hourScoreSum) { if (v.n >= 2 && v.sum / v.n > goldenBest) { goldenBest = v.sum / v.n; goldenHour = h; } }
    const topDomains = Array.from(domainAgg.entries()).map(([k, v]) => ({ key: k, name: nameOf.get(k) ?? k, avg: v.n > 0 ? Number((v.sum / v.n).toFixed(2)) : 0, count: v.n })).sort((a, b) => b.avg - a.avg).slice(0, 3);
    const pseudoWork = Array.from(domainAgg.entries()).filter(([, v]) => v.hours >= 2 && v.n > 0 && v.sum / v.n < 3).map(([k, v]) => ({ key: k, name: nameOf.get(k) ?? k, hours: Number(v.hours.toFixed(1)), avgScore: Number((v.sum / v.n).toFixed(2)) })).sort((a, b) => b.hours - a.hours);
    const lowAttentionAlerts: string[] = [];
    for (const [k, v] of domainAgg) {
      const avg = v.n > 0 ? v.sum / v.n : 5;
      if (v.n >= 3 && avg < 3 && v.interrupts >= 2) lowAttentionAlerts.push(`你对「${nameOf.get(k) ?? k}」的投入度下降（平均评分 ${avg.toFixed(1)}、中断 ${v.interrupts} 次），是失去兴趣还是阻力过大？`);
    }
    return {
      range: q.range, axis: q.axis, cols, rows: outRows, energySeries, attentionSeries,
      insights: {
        goldenHour, topDomains, pseudoWork, totalSessions, skipped,
        avgScore: scoreN > 0 ? Number((scoreSum / scoreN).toFixed(2)) : null,
        avgEnergyEnd: energyEndN > 0 ? Number((energyEndSum / energyEndN).toFixed(2)) : null,
      },
      lowAttentionAlerts,
    };
  },

  /* ============ 洞察 ============ */
  async dailyCard(familyId: string, date?: string) {
    const target = date ?? todayStr();
    const isToday = target === todayStr();
    const db = getDb();
    const rows = await db.select().from(tasks).where(and(resolveZone(tasks, familyId), eq(tasks.repeat, 'none'), or(eq(tasks.taskDate, target), isNull(tasks.taskDate))));
    const scoped = (rows as any[]).filter((r) => r.taskDate !== null || isToday);
    const domainCounts: Record<string, number> = {};
    let done = 0, mitCount = 0;
    for (const r of scoped) {
      domainCounts[r.domainKey] = (domainCounts[r.domainKey] ?? 0) + 1;
      if (r.status === 'done') done += 1;
      if (r.isMit) mitCount += 1;
    }
    return { total: scoped.length, done, mitCount, domainCounts };
  },
  async pressureBackpack(familyId: string) {
    const db = getDb();
    const now = new Date().toISOString();
    const overdueReminders = (await db.select({ c: sql<number>`count(*)` }).from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.status, 'overdue')))).at(0)?.c ?? 0;
    const overdueTasks = (await db.select({ c: sql<number>`count(*)` }).from(tasks).where(and(resolveZone(tasks, familyId), eq(tasks.status, 'todo'), lt(tasks.dueAt, now)))).at(0)?.c ?? 0;
    const activeDebts = (await db.select({ c: sql<number>`count(*)` }).from(debts).where(and(resolveZone(debts, familyId), eq(debts.status, 'active')))).at(0)?.c ?? 0;
    const raw = overdueReminders * 15 + overdueTasks * 10 + activeDebts * 5;
    const score = Math.min(100, raw);
    let level: 'calm' | 'mild' | 'tense' | 'overloaded' = 'calm';
    if (score >= 70) level = 'overloaded';
    else if (score >= 40) level = 'tense';
    else if (score > 0) level = 'mild';
    return { score, level, breakdown: { overdueReminders: Number(overdueReminders), overdueTasks: Number(overdueTasks), activeDebts: Number(activeDebts) } };
  },

  /* ============ 系统（遗留接口 harmless 落点） ============ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setSystemMeta(familyId: string, key: string, value: unknown): Promise<void> {
    const db = getDb();
    const ownerId = await getFamilyOwner(familyId);
    await db
      .insert(systemMeta)
      .values({ familyId, ownerId, visibility: 'private', version: 1, lastEditedBy: null, key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: [systemMeta.ownerId, systemMeta.visibility, systemMeta.key], set: { value, updatedAt: new Date().toISOString() } });
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getSystemMeta(familyId: string, key: string): Promise<any | null> {
    const db = getDb();
    const rows = await db.select().from(systemMeta).where(and(resolveZone(systemMeta, familyId), eq(systemMeta.key, key))).limit(1);
    return rows[0]?.value ?? null;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async systemDataStatus(familyId: string): Promise<any> {
    const db = getDb();
    const counts = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(tasks).where(resolveZone(tasks, familyId)),
      db.select({ c: sql<number>`count(*)` }).from(debts).where(resolveZone(debts, familyId)),
      db.select({ c: sql<number>`count(*)` }).from(incomes).where(resolveZone(incomes, familyId)),
      db.select({ c: sql<number>`count(*)` }).from(transactions).where(resolveZone(transactions, familyId)),
      db.select({ c: sql<number>`count(*)` }).from(notes).where(resolveZone(notes, familyId)),
      db.select({ c: sql<number>`count(*)` }).from(reminderClocks).where(resolveZone(reminderClocks, familyId)),
    ]);
    const dataDir = resolveDataDir();
    return {
      familyId,
      generatedAt: new Date().toISOString(),
      ok: true,
      dataDir: dataDir ?? '（外部 Postgres，无本地文件目录）',
      tableCounts: {
        tasks: Number(counts[0]?.at(0)?.c ?? 0), debts: Number(counts[1]?.at(0)?.c ?? 0), incomes: Number(counts[2]?.at(0)?.c ?? 0),
        transactions: Number(counts[3]?.at(0)?.c ?? 0), notes: Number(counts[4]?.at(0)?.c ?? 0), reminders: Number(counts[5]?.at(0)?.c ?? 0),
      },
      note:
        '数据保存在 PGlite 内嵌数据库文件中（默认位于 ' + (dataDir ?? '外部 Postgres') + '）。' +
        '可在「设置 → 数据」中修改数据目录，保存后重启后端生效。',
    };
  },

  /* ============ 个人数据导出 / 导入（替代 engine 的文件式导入导出） ============ */
  // 导出：把当前个人家庭在各个人域表的全部行序列化，供前端下载为 JSON 备份。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async exportPersonalData(familyId: string): Promise<Record<string, any[]>> {
    const db = getDb();
    const tables: Record<string, any> = {
      domains,
      projects,
      tasks,
      interests,
      notes,
      debts,
      incomes,
      transactions,
      assets,
      budgets,
      reminderClocks,
      focusSessions,
      financeTransfers,
    };
    const out: Record<string, any[]> = {};
    for (const [name, tbl] of Object.entries(tables)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out[name] = await db.select().from(tbl).where(eq((tbl as any).familyId, familyId));
    }
    return out;
  },

  // 导入：以 bundle 覆盖写回当前个人家庭。先按表清掉该 family 旧行，再整体插入，
  // 保证恢复结果等价于备份快照（familyId 强制指向当前家庭，避免跨家庭串数据）。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async importPersonalData(familyId: string, bundle: Record<string, any[]>): Promise<Record<string, number>> {
    const db = getDb();
    const tables: Record<string, any> = {
      domains,
      projects,
      tasks,
      interests,
      notes,
      debts,
      incomes,
      transactions,
      assets,
      budgets,
      reminderClocks,
      focusSessions,
      financeTransfers,
    };
    const imported: Record<string, number> = {};
    // F1 修复：整包导入包进单一事务，任一表插入失败则整体回滚，
    // 杜绝原「先逐表 delete 再 insert、不在事务内、无导入前备份」导致的部分数据永久丢失。
    await db.transaction(async (tx: any) => {
      for (const [name, rows] of Object.entries(bundle)) {
        const tbl = tables[name];
        if (!tbl || !Array.isArray(rows)) continue;
        const cleaned = rows.map((r) => ({ ...r, familyId }));
        if (cleaned.length === 0) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.delete(tbl).where(eq((tbl as any).familyId, familyId));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.insert(tbl).values(cleaned as any);
        imported[name] = cleaned.length;
      }
    });
    return imported;
  },

  async reset(): Promise<void> {
    const db = getDb();
    await db.delete(sharedFinanceItems);
    await db.delete(sharedItems);
    await db.delete(calendarEvents);
    await db.delete(sessions);
    await db.delete(invitations);
    await db.delete(memberships);
    await db.delete(financeTransfers);
    await db.delete(focusSessions);
    await db.delete(reminderClocks);
    await db.delete(budgets);
    await db.delete(transactions);
    await db.delete(assets);
    await db.delete(incomes);
    await db.delete(debts);
    await db.delete(notes);
    await db.delete(interests);
    await db.delete(tasks);
    await db.delete(projects);
    await db.delete(domains);
    await db.delete(systemMeta);
    await db.delete(families);
    await db.delete(users);
  },
};
