import { db } from '../../db/client';
import { debts, incomes, transactions, assets, budgets, financeTransfers } from '../../db/schema';
import { eq, desc, or } from 'drizzle-orm';
import type {
  DebtView,
  IncomeView,
  TransactionView,
  AssetView,
  FinanceSummary,
  BudgetView,
  TransferView,
} from '@dm-life/shared';
import { getDebtSummary, getRepaymentSchedule, type DebtCalcInput, type ScheduleRow, type DebtSummary } from './schedule';

type DebtRow = typeof debts.$inferSelect;
type IncomeRow = typeof incomes.$inferSelect;
type TxnRow = typeof transactions.$inferSelect;
type AssetRow = typeof assets.$inferSelect;
type AssetClass = (typeof assets.$inferInsert)['assetClass'];

function parseJsonArray(raw: string | null): any[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null): any | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

function safeStr(v: unknown): string {
  return v == null ? '' : String(v);
}

function debtRowToView(r: DebtRow): DebtView {
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
    rateAdjustments: parseJsonArray(r.rateAdjustments),
    repricing: parseJsonObject(r.repricing),
    prepayments: parseJsonArray(r.prepayments).map((p: any) => ({
      date: safeStr(p.date),
      amount: Number(p.amount) || 0,
      type: p.type ?? 'reduce_term',
    })),
    parentDebtId: r.parentDebtId,
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    remainingPrincipal: getDebtSummary(debtRowToCalcInput(r)).remainingPrincipal,
  };
}
function incomeRowToView(r: IncomeRow): IncomeView {
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
    rateAdjustments: parseJsonArray(r.rateAdjustments).map((a: any) => ({
      effectiveDate: safeStr(a.effectiveDate),
      newAmount: Number(a.newAmount) || 0,
    })),
    createdAt: r.createdAt,
  };
}
function txnRowToView(r: TxnRow): TransactionView {
  return {
    id: r.id,
    kind: r.kind,
    category: r.category,
    amount: r.amount,
    merchant: r.merchant,
    occurredAt: r.occurredAt,
    debtId: r.debtId,
    incomeSourceId: r.incomeSourceId,
    note: r.note,
    createdAt: r.createdAt,
  };
}
function assetRowToView(r: AssetRow): AssetView {
  return {
    id: r.id,
    name: r.name,
    assetClass: r.assetClass,
    value: r.value,
    asOf: r.asOf,
    linkedIncomeSourceId: r.linkedIncomeSourceId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** 把 DebtRow 映射成还款引擎输入 */
function debtRowToCalcInput(r: DebtRow): DebtCalcInput {
  return {
    principal: r.principal,
    annualRate: r.apr ?? 0,
    termMonths: r.termMonths ?? 0,
    repaymentMethod: (r.repaymentMethod as DebtCalcInput['repaymentMethod']) ?? 'equal_installment',
    startDate: r.startDate ?? r.createdAt,
    rateType: (r.rateType as DebtCalcInput['rateType']) ?? null,
    baseRate: r.baseRate ?? null,
    rateSpread: r.rateSpread ?? null,
    rateAdjustments: r.rateAdjustments ?? null,
    repricing: r.repricing ?? null,
    prepayments: r.prepayments ?? null,
  };
}

/* ---------- 债务 ---------- */
export function listDebts(): DebtView[] {
  const rows = db.select().from(debts).orderBy(desc(debts.createdAt)).all() as DebtRow[];
  return rows.map(debtRowToView);
}
export function getDebt(id: string): DebtRow | undefined {
  return db.select().from(debts).where(eq(debts.id, id)).get() as DebtRow | undefined;
}
export function getIncome(id: string): IncomeRow | undefined {
  return db.select().from(incomes).where(eq(incomes.id, id)).get() as IncomeRow | undefined;
}
export function getTransaction(id: string): TxnRow | undefined {
  return db.select().from(transactions).where(eq(transactions.id, id)).get() as TxnRow | undefined;
}
export function getAsset(id: string): AssetRow | undefined {
  return db.select().from(assets).where(eq(assets.id, id)).get() as AssetRow | undefined;
}
export function insertDebt(p: {
  id: string;
  creditor: string;
  principal: number;
  apr: number | null;
  minPayment: number | null;
  dueDay: number | null;
  status: 'active' | 'paid' | 'frozen';
  now: string;
  debtType?: string;
  termMonths?: number | null;
  repaymentMethod?: string;
  startDate?: string | null;
  rateType?: string | null;
  baseRate?: number | null;
  rateSpread?: number | null;
  rateAdjustments?: string | null;
  repricing?: string | null;
  prepayments?: string | null;
  parentDebtId?: string | null;
  note?: string;
}): void {
  db.insert(debts)
    .values({
      id: p.id,
      creditor: p.creditor,
      principal: p.principal,
      apr: p.apr,
      minPayment: p.minPayment,
      dueDay: p.dueDay,
      status: p.status,
      debtType: p.debtType ?? 'other',
      termMonths: p.termMonths ?? null,
      repaymentMethod: p.repaymentMethod ?? 'equal_installment',
      startDate: p.startDate ?? null,
      rateType: p.rateType ?? null,
      baseRate: p.baseRate ?? null,
      rateSpread: p.rateSpread ?? null,
      rateAdjustments: p.rateAdjustments ?? null,
      repricing: p.repricing ?? null,
      prepayments: p.prepayments ?? null,
      parentDebtId: p.parentDebtId ?? null,
      note: p.note ?? '',
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}
export function updateDebtFields(
  id: string,
  fields: Partial<{
    creditor: string;
    principal: number;
    apr: number | null;
    minPayment: number | null;
    dueDay: number | null;
    status: 'active' | 'paid' | 'frozen';
    debtType: string;
    termMonths: number | null;
    repaymentMethod: string;
    startDate: string | null;
    rateType: string | null;
    baseRate: number | null;
    rateSpread: number | null;
    rateAdjustments: string | null;
    repricing: string | null;
    prepayments: string | null;
    parentDebtId: string | null;
    note?: string;
  }>,
  now: string,
): void {
  db.update(debts).set({ ...fields, updatedAt: now }).where(eq(debts.id, id)).run();
}

export function deleteDebtById(id: string): void {
  db.delete(debts).where(eq(debts.id, id)).run();
}

/* ---------- 收入 ---------- */
export function listIncomes(): IncomeView[] {
  const rows = db.select().from(incomes).orderBy(desc(incomes.receivedAt)).all() as IncomeRow[];
  return rows.map(incomeRowToView);
}
export function insertIncome(p: {
  id: string;
  source: string;
  amount: number;
  currency: string;
  receivedAt: string;
  recurring: boolean;
  note: string;
  now: string;
  incomeType?: string;
  monthlyAvg?: number | null;
  isFixed?: boolean;
  incomeMode?: string;
  payDay?: number | null;
  adjustmentDay?: number | null;
  rateAdjustments?: string | null;
}): void {
  db.insert(incomes)
    .values({
      id: p.id,
      source: p.source,
      amount: p.amount,
      currency: p.currency,
      receivedAt: p.receivedAt,
      recurring: p.recurring,
      note: p.note,
      incomeType: p.incomeType ?? 'salary',
      monthlyAvg: p.monthlyAvg ?? null,
      isFixed: p.isFixed ?? true,
      incomeMode: p.incomeMode ?? 'monthly',
      payDay: p.payDay ?? null,
      adjustmentDay: p.adjustmentDay ?? null,
      rateAdjustments: p.rateAdjustments ?? null,
      createdAt: p.now,
    })
    .run();
}
/** incomes 表无 updatedAt 列，仅更新传入字段 */
export function updateIncomeFields(
  id: string,
  fields: Partial<{
    source: string;
    amount: number;
    note: string;
    incomeType: string;
    monthlyAvg: number | null;
    isFixed: boolean;
    incomeMode: string;
    payDay: number | null;
    adjustmentDay: number | null;
    rateAdjustments: string | null;
  }>,
): void {
  db.update(incomes).set({ ...fields }).where(eq(incomes.id, id)).run();
}
export function deleteIncomeById(id: string): void {
  db.delete(incomes).where(eq(incomes.id, id)).run();
}

/* ---------- 交易流水 ---------- */
export function listTransactions(): TransactionView[] {
  const rows = db.select().from(transactions).orderBy(desc(transactions.occurredAt)).all() as TxnRow[];
  return rows.map(txnRowToView);
}
export function insertTransaction(p: {
  id: string;
  kind: 'expense' | 'income' | 'debt_payment';
  category: string;
  amount: number;
  merchant: string | null;
  occurredAt: string;
  note: string;
  debtId?: string | null;
  incomeSourceId?: string | null;
  now: string;
}): void {
  db.insert(transactions)
    .values({
      id: p.id,
      kind: p.kind,
      category: p.category,
      amount: p.amount,
      merchant: p.merchant,
      occurredAt: p.occurredAt,
      note: p.note,
      debtId: p.debtId ?? null,
      incomeSourceId: p.incomeSourceId ?? null,
      createdAt: p.now,
    })
    .run();
}
/** transactions 表无 updatedAt 列，仅更新传入字段 */
export function updateTransactionFields(
  id: string,
  fields: Partial<{
    kind: 'expense' | 'income' | 'debt_payment';
    category: string;
    amount: number;
    note: string;
    debtId: string | null;
    incomeSourceId: string | null;
  }>,
): void {
  db.update(transactions).set({ ...fields }).where(eq(transactions.id, id)).run();
}
export function deleteTransactionById(id: string): void {
  db.delete(transactions).where(eq(transactions.id, id)).run();
}

/* ---------- 资产 ---------- */
export function listAssets(): AssetView[] {
  const rows = db.select().from(assets).orderBy(desc(assets.asOf)).all() as AssetRow[];
  return rows.map(assetRowToView);
}
export function insertAsset(p: {
  id: string;
  name: string;
  assetClass: AssetClass;
  value: number;
  asOf: string;
  linkedIncomeSourceId?: string | null;
  now: string;
}): void {
  db.insert(assets)
    .values({
      id: p.id,
      name: p.name,
      assetClass: p.assetClass,
      value: p.value,
      asOf: p.asOf,
      linkedIncomeSourceId: p.linkedIncomeSourceId ?? null,
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}
export function updateAssetValue(
  id: string,
  value: number,
  asOf: string,
  now: string,
  linkedIncomeSourceId?: string | null,
  assetClass?: AssetClass,
  name?: string,
): void {
  const set: Partial<typeof assets.$inferInsert> = { value, asOf, updatedAt: now };
  if (linkedIncomeSourceId !== undefined) set.linkedIncomeSourceId = linkedIncomeSourceId;
  if (assetClass !== undefined) set.assetClass = assetClass;
  if (name !== undefined) set.name = name;
  db.update(assets).set(set).where(eq(assets.id, id)).run();
}
export function deleteAssetById(id: string): void {
  db.delete(assets).where(eq(assets.id, id)).run();
}

/* ---------- 预算（整体/分类月度限额） ---------- */
type BudgetRow = typeof budgets.$inferSelect;

/** 当月（YYYY-MM）支出流水金额，按 scope/category 过滤 */
function monthExpenseFor(monthStr: string, category: string | null): number {
  const txnRows = db.select().from(transactions).all() as TxnRow[];
  const monthExpenses = txnRows.filter(
    (t) => t.kind === 'expense' && (t.occurredAt || '').slice(0, 7) === monthStr,
  );
  const matched = category ? monthExpenses.filter((t) => t.category === category) : monthExpenses;
  return matched.reduce((s, t) => s + t.amount, 0);
}

function budgetRowToView(r: BudgetRow): BudgetView {
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const spent = monthExpenseFor(monthStr, r.scope === 'category' ? r.category : null);
  const remaining = Math.round((r.monthlyLimit - spent + Number.EPSILON) * 100) / 100;
  const progress =
    r.monthlyLimit > 0
      ? Math.max(0, Math.min(1.5, Math.round((spent / r.monthlyLimit + Number.EPSILON) * 100) / 100))
      : 0;
  return {
    id: r.id,
    name: r.name,
    scope: r.scope,
    category: r.category,
    monthlyLimit: r.monthlyLimit,
    spent: Math.round((spent + Number.EPSILON) * 100) / 100,
    remaining,
    progress,
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function listBudgets(): BudgetView[] {
  const rows = db.select().from(budgets).orderBy(desc(budgets.createdAt)).all() as BudgetRow[];
  return rows.map(budgetRowToView);
}

export function getBudget(id: string): BudgetRow | undefined {
  return db.select().from(budgets).where(eq(budgets.id, id)).get() as BudgetRow | undefined;
}

export function insertBudget(p: {
  id: string;
  name: string;
  scope: 'overall' | 'category';
  category: string | null;
  monthlyLimit: number;
  note: string;
  now: string;
}): void {
  db.insert(budgets)
    .values({
      id: p.id,
      name: p.name,
      scope: p.scope,
      category: p.category,
      monthlyLimit: p.monthlyLimit,
      note: p.note,
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}

export function updateBudgetFields(
  id: string,
  fields: Partial<{
    name: string;
    scope: 'overall' | 'category';
    category: string | null;
    monthlyLimit: number;
    note: string;
  }>,
  now: string,
): void {
  db.update(budgets).set({ ...fields, updatedAt: now }).where(eq(budgets.id, id)).run();
}

export function deleteBudgetById(id: string): void {
  db.delete(budgets).where(eq(budgets.id, id)).run();
}

/* ---------- 还款计划（引擎计算） ---------- */
export function debtSchedule(id: string): { summary: DebtSummary; schedule: ScheduleRow[] } | null {
  const row = getDebt(id);
  if (!row) return null;
  const input = debtRowToCalcInput(row);
  return { summary: getDebtSummary(input), schedule: getRepaymentSchedule(input) };
}

export interface DebtProgressItem {
  id: string;
  creditor: string;
  debtType: string;
  status: string;
  principal: number;
  remainingPrincipal: number;
  /** 计划已还本金（按起贷日推算：本金 - 剩余本金） */
  paidPrincipal: number;
  /** 实际已还本金（Σ 实际 debt_payment 流水对应期本金；P0-2 勾稽） */
  actualPaidPrincipal: number;
  paidMonths: number;
  totalMonths: number;
  progress: number;
  /** 本金偿还进度（已还本金 / 原始本金） */
  principalProgress: number;
}

export interface DebtProgressOverall {
  /** 整体还款进度（按本金加权的单笔进度均值，与单笔进度条口径一致） */
  progress: number;
  paidPrincipal: number;
  /** 实际已还本金合计（P0-2 勾稽） */
  actualPaidPrincipal: number;
  remainingPrincipal: number;
  totalPrincipal: number;
  paidMonths: number;
  totalMonths: number;
}

/**
 * 双层还款进度汇总：
 *  - items：每笔债务的「单笔进度」（已还本金 / 剩余本金 / 已还期数 / 总期数 / 进度）
 *  - overall：跨所有有期限债务的「整体进度」（按本金加权，与单笔进度条同一口径）
 * 一次查询计算全部，避免前端对每笔债务各发一次 debtSchedule。
 */
export function debtProgressSummary(): { items: DebtProgressItem[]; overall: DebtProgressOverall } {
  const rows = (db.select().from(debts).all() as DebtRow[]).filter((d) => (d.termMonths ?? 0) > 0);

  // 实际还款流水（按债务分组），用于 P0-2 勾稽「实际已还本金」
  const payTxns = (db.select().from(transactions).all() as TxnRow[]).filter(
    (t) => t.kind === 'debt_payment' && t.debtId,
  );
  const txnCountByDebt = new Map<string, number>();
  for (const t of payTxns) {
    if (!t.debtId) continue;
    txnCountByDebt.set(t.debtId, (txnCountByDebt.get(t.debtId) ?? 0) + 1);
  }

  const items: DebtProgressItem[] = rows.map((r) => {
    const sum = getDebtSummary(debtRowToCalcInput(r));
    const progress = r.status === 'paid' ? 1 : sum.progress;
    const principalProgress = r.status === 'paid' ? 1 : sum.principalProgress;
    const plannedPaid = Math.max(0, r.principal - sum.remainingPrincipal);
    // 实际已还本金：有真实还款流水时，按流水期数累计还款计划对应期本金；否则回退到计划值。
    const actualCount = txnCountByDebt.get(r.id) ?? 0;
    let actualPaid = plannedPaid;
    if (actualCount > 0 && sum.totalMonths > 0) {
      const schedule = getRepaymentSchedule(debtRowToCalcInput(r));
      const n = Math.min(actualCount, schedule.length);
      actualPaid = schedule.slice(0, n).reduce((s, row) => s + row.principal, 0);
    }
    return {
      id: r.id,
      creditor: r.creditor,
      debtType: r.debtType,
      status: r.status,
      principal: r.principal,
      remainingPrincipal: sum.remainingPrincipal,
      paidPrincipal: round2(plannedPaid),
      actualPaidPrincipal: round2(actualPaid),
      paidMonths: sum.paidMonths,
      totalMonths: sum.totalMonths,
      progress: Math.max(0, Math.min(1, progress)),
      principalProgress: Math.max(0, Math.min(1, principalProgress)),
    };
  });

  let totalPrincipal = 0;
  let weightedProgress = 0;
  let totalPaidPrincipal = 0;
  let totalActualPaid = 0;
  let totalRemaining = 0;
  let totalMonthsAll = 0;
  let paidMonthsAll = 0;
  for (const it of items) {
    totalPrincipal += it.principal;
    totalPaidPrincipal += it.paidPrincipal;
    totalActualPaid += it.actualPaidPrincipal;
    totalRemaining += it.remainingPrincipal;
    totalMonthsAll += it.totalMonths;
    paidMonthsAll += it.paidMonths;
    weightedProgress += it.principalProgress * it.principal;
  }
  const overallProgress = totalPrincipal > 0 ? weightedProgress / totalPrincipal : 0;

  return {
    items,
    overall: {
      progress: Math.max(0, Math.min(1, overallProgress)),
      paidPrincipal: round2(totalPaidPrincipal),
      actualPaidPrincipal: round2(totalActualPaid),
      remainingPrincipal: round2(totalRemaining),
      totalPrincipal: round2(totalPrincipal),
      paidMonths: paidMonthsAll,
      totalMonths: totalMonthsAll,
    },
  };
}

/**
 * 债务优化建议（P1-3）：雪崩法（先还高利率）/ 滚雪球法（先还小额）。
 * 基于真实引擎摘要（当前利率、剩余本金、月供）排序，返回带理由与排名的建议序列。
 */
export interface PayoffAdviceItem {
  debtId: string;
  creditor: string;
  currentRate: number;
  remainingPrincipal: number;
  monthlyPayment: number;
  rank: number;
  reason: string;
}
export function debtPayoffAdvice(mode: 'avalanche' | 'snowball'): PayoffAdviceItem[] {
  const rows = (db.select().from(debts).all() as DebtRow[]).filter(
    (d) => d.status === 'active' && (d.termMonths ?? 0) > 0,
  );
  const items: PayoffAdviceItem[] = rows.map((r) => {
    const sum = getDebtSummary(debtRowToCalcInput(r));
    return {
      debtId: r.id,
      creditor: r.creditor,
      currentRate: sum.currentRate,
      remainingPrincipal: sum.remainingPrincipal,
      monthlyPayment: sum.monthlyPayment,
      rank: 0,
      reason: '',
    };
  });

  const cmp =
    mode === 'avalanche'
      ? (a: PayoffAdviceItem, b: PayoffAdviceItem) => b.currentRate - a.currentRate || b.remainingPrincipal - a.remainingPrincipal
      : (a: PayoffAdviceItem, b: PayoffAdviceItem) => a.remainingPrincipal - b.remainingPrincipal || b.currentRate - a.currentRate;

  items.sort((a, b) => cmp(a, b));

  items.forEach((it, i) => {
    it.rank = i + 1;
    if (mode === 'avalanche') it.reason = `利率最高 ${it.currentRate}%，先还省利息`;
    else it.reason = `余额最小 ${fmt0(it.remainingPrincipal)}，先还得正反馈`;
  });
  return items;
}

function fmt0(n: number): string {
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

/* ---------- 月度收支趋势 ---------- */
export function monthlyTrend(months: number): { month: string; income: number; expense: number; net: number }[] {
  const now = new Date();
  const trend: { month: string; income: number; expense: number; net: number }[] = [];
  const txnRows = db.select().from(transactions).all() as TxnRow[];

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthTxns = txnRows.filter((t) => (t.occurredAt || '').slice(0, 7) === monthStr);
    const income = monthTxns.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = monthTxns
      .filter((t) => t.kind === 'expense' || t.kind === 'debt_payment')
      .reduce((s, t) => s + t.amount, 0);
    trend.push({
      month: monthStr,
      income: round2(income),
      expense: round2(expense),
      net: round2(income - expense),
    });
  }
  return trend;
}

/* ---------- 自动刷新：生成本月固定收入 + 债务还款流水 ---------- */
export function autoGenerateMonthly(now = new Date()): { incomes: number; debts: number; skipped: number } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const thisMonthStr = `${y}-${String(m + 1).padStart(2, '0')}`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  let incomeCount = 0;
  let debtCount = 0;
  let skipped = 0;

  // 已存在的本月流水（按 来源/债务 + 月份 去重）
  const existing = db.select().from(transactions).all() as TxnRow[];
  const existingKeys = new Set(
    existing.filter((t) => (t.occurredAt || '').slice(0, 7) === thisMonthStr).map((t) => txnKey(t)),
  );

  // 固定收入源
  const incomeRows = db.select().from(incomes).all() as IncomeRow[];
  for (const inc of incomeRows) {
    if (inc.incomeMode !== 'monthly') continue;
    const payDay = Math.min(inc.payDay ?? 28, lastDay);
    const payDate = `${thisMonthStr}-${String(payDay).padStart(2, '0')}`;
    if (now < new Date(payDate)) continue;
    const amount = inc.monthlyAvg ?? inc.amount;
    const key = `income:${inc.id}:${thisMonthStr}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const id = `tx_${cryptoRandom()}`;
    insertTransaction({
      id,
      kind: 'income',
      category: inc.source,
      amount,
      merchant: null,
      occurredAt: payDate,
      note: '自动生成',
      incomeSourceId: inc.id,
      now: now.toISOString(),
    });
    incomeCount += 1;
  }

  // 活跃债务：按扣款日生成还款流水
  const debtRows = (db.select().from(debts).all() as DebtRow[]).filter((d) => d.status === 'active');
  for (const d of debtRows) {
    const sum = getDebtSummary(debtRowToCalcInput(d));
    if (sum.paidMonths >= sum.totalMonths && sum.totalMonths > 0) continue;
    const dedDay = Math.min(d.dueDay ?? new Date(d.startDate ?? d.createdAt).getDate(), lastDay);
    const dedDate = `${thisMonthStr}-${String(dedDay).padStart(2, '0')}`;
    if (now < new Date(dedDate)) continue;
    const key = `debt:${d.id}:${thisMonthStr}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const id = `tx_${cryptoRandom()}`;
    insertTransaction({
      id,
      kind: 'debt_payment',
      category: d.creditor,
      amount: sum.monthlyPayment > 0 ? sum.monthlyPayment : d.minPayment ?? 0,
      merchant: null,
      occurredAt: dedDate,
      note: '自动生成',
      debtId: d.id,
      now: now.toISOString(),
    });
    debtCount += 1;
  }

  return { incomes: incomeCount, debts: debtCount, skipped };
}

function txnKey(t: TxnRow): string {
  if (t.incomeSourceId) return `income:${t.incomeSourceId}:${(t.occurredAt || '').slice(0, 7)}`;
  if (t.debtId) return `debt:${t.debtId}:${(t.occurredAt || '').slice(0, 7)}`;
  return `${t.kind}:${t.category}:${t.occurredAt}`;
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------- 总览（仓库层聚合，非 VIEW，便于跨表计算） ---------- */
export function summary(): FinanceSummary {
  const debtRows = db.select().from(debts).all() as DebtRow[];
  const incomeRows = db.select().from(incomes).all() as IncomeRow[];
  const txnRows = db.select().from(transactions).all() as TxnRow[];
  const assetRows = db.select().from(assets).all() as AssetRow[];

  let totalDebt = 0;
  let monthlyMinPayment = 0;
  let debtCount = 0;
  for (const d of debtRows) {
    if (d.status !== 'active') continue;
    const sum = getDebtSummary(debtRowToCalcInput(d));
    // 已真正还清的债务（剩余本金为 0）不应再计入总负债和月还款，
    // 避免用户点击「结清」或自然还清后仍占用现金流统计。
    const hasSchedule = sum.totalMonths > 0;
    if (hasSchedule && sum.remainingPrincipal <= 0) continue;
    debtCount += 1;
    totalDebt += hasSchedule ? sum.remainingPrincipal : d.principal;
    monthlyMinPayment += hasSchedule ? sum.monthlyPayment : (d.minPayment ?? 0);
  }

  // 月度固定收入（月度收入源）
  let monthlyIncome = 0;
  let incomeSourceCount = 0;
  for (const i of incomeRows) {
    if (i.incomeMode === 'monthly') {
      incomeSourceCount += 1;
      monthlyIncome += i.monthlyAvg ?? i.amount;
    }
  }

  const totalAssets = assetRows.reduce((s, a) => s + a.value, 0);
  const totalIncome = txnRows
    .filter((t) => t.kind === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = txnRows
    .filter((t) => t.kind === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  // 当月收支
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthIncome = txnRows
    .filter((t) => t.kind === 'income' && (t.occurredAt || '').slice(0, 7) === thisMonth)
    .reduce((s, t) => s + t.amount, 0);
  const monthExpense = txnRows
    .filter((t) => (t.kind === 'expense' || t.kind === 'debt_payment') && (t.occurredAt || '').slice(0, 7) === thisMonth)
    .reduce((s, t) => s + t.amount, 0);

  const monthlyExpense = txnRows
    .filter((t) => t.kind === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  const netWorth = totalAssets - totalDebt;

  return {
    totalDebt: round2(totalDebt),
    monthlyMinPayment: round2(monthlyMinPayment),
    totalAssets: round2(totalAssets),
    totalIncome: round2(totalIncome),
    totalExpense: round2(totalExpense),
    netWorth: round2(netWorth),
    monthlyIncome: round2(monthlyIncome),
    monthlyDebtPayment: round2(monthlyMinPayment),
    monthlyExpense: round2(monthlyExpense),
    monthIncome: round2(monthIncome),
    monthExpense: round2(monthExpense),
    debtCount,
    incomeSourceCount,
  };
}

/* ---------- 全局账目核对（只读，不写库） ---------- */
export interface ReconcileDiscrepancy {
  /** 差异归属范围，如 debt:招商银行 / global:paymentFlow / transaction:<id> */
  scope: string;
  message: string;
  /** 差异金额（已还本金 − 还款流水 等口径，正数表示登记多于流水） */
  diff: number;
}
export interface ReconcileResult {
  balanced: boolean;
  /** 净资产 = Σ 资产 − Σ 债务剩余本金 */
  netWorth: number;
  assetsTotal: number;
  /** Σ 债务剩余本金（未偿余额） */
  debtsTotal: number;
  /** Σ 流水 where kind==='income' */
  totalIncome: number;
  /** Σ 流水 where kind==='expense' */
  totalExpense: number;
  /** Σ 债务已还本金 */
  totalDebtPaid: number;
  /** Σ 还款流水（kind==='debt_payment'）金额 */
  paymentFlowTotal: number;
  discrepancies: ReconcileDiscrepancy[];
}

const RECONCILE_EPS = 0.01;

/**
 * 全局账目核对：把「债务登记表（引擎推算的剩余本金/已还本金）」与「还款流水（debt_payment）」
 * 双向勾稽。防御式：缺失数据不产生异常，仅产出空 discrepancies。
 *  - 逐笔债务：登记已还本金（principal − remaining） vs 该债务还款流水合计
 *  - 全局：Σ 已还本金 vs Σ 还款流水金额
 *  - 完整性：还款流水引用了不存在的债务 → 孤立流水
 * balanced = discrepancies.length === 0
 */
export function reconcile(): ReconcileResult {
  const debtRows = (db.select().from(debts).all() as DebtRow[]).filter((d) => (d.termMonths ?? 0) > 0);
  const txnRows = db.select().from(transactions).all() as TxnRow[];
  const assetRows = db.select().from(assets).all() as AssetRow[];

  const debtIds = new Set((db.select().from(debts).all() as DebtRow[]).map((d) => d.id));

  // 每笔债务的「登记已还本金」与「未偿余额」
  let debtsTotal = 0;
  let totalDebtPaid = 0;
  const paidByDebt = new Map<string, number>();
  for (const r of debtRows) {
    const sum = getDebtSummary(debtRowToCalcInput(r));
    const remaining = sum.remainingPrincipal;
    const paid = Math.max(0, r.principal - remaining);
    debtsTotal += remaining;
    totalDebtPaid += paid;
    paidByDebt.set(r.id, paid);
  }

  const assetsTotal = assetRows.reduce((s, a) => s + a.value, 0);
  const totalIncome = txnRows.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = txnRows.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);

  const payTxns = txnRows.filter((t) => t.kind === 'debt_payment');
  const paymentFlowTotal = payTxns.reduce((s, t) => s + t.amount, 0);

  const netWorth = assetsTotal - debtsTotal;

  const discrepancies: ReconcileDiscrepancy[] = [];

  // 逐笔：登记已还本金 vs 该债务还款流水合计
  const flowByDebt = new Map<string, number>();
  for (const t of payTxns) {
    if (!t.debtId) continue;
    flowByDebt.set(t.debtId, (flowByDebt.get(t.debtId) ?? 0) + t.amount);
  }
  for (const r of debtRows) {
    const paid = paidByDebt.get(r.id) ?? 0;
    const flow = flowByDebt.get(r.id) ?? 0;
    const diff = Math.round((paid - flow + Number.EPSILON) * 100) / 100;
    if (Math.abs(diff) > RECONCILE_EPS) {
      discrepancies.push({
        scope: `debt:${r.creditor}`,
        message: `债务「${r.creditor}」登记已还本金 ${round2(paid)}，还款流水合计 ${round2(flow)}（差额含利息/不一致）`,
        diff,
      });
    }
  }

  // 全局：Σ 已还本金 vs Σ 还款流水
  const globalDiff = Math.round((totalDebtPaid - paymentFlowTotal + Number.EPSILON) * 100) / 100;
  if (Math.abs(globalDiff) > RECONCILE_EPS) {
    discrepancies.push({
      scope: 'global:paymentFlow',
      message: `全局还款流水 ${round2(paymentFlowTotal)} 与已还本金合计 ${round2(totalDebtPaid)} 不一致`,
      diff: globalDiff,
    });
  }

  // 完整性：还款流水引用了不存在的债务（孤立流水）
  for (const t of payTxns) {
    if (t.debtId && !debtIds.has(t.debtId)) {
      discrepancies.push({
        scope: `transaction:${t.id}`,
        message: `还款流水 ${t.id} 引用了不存在的债务 ${t.debtId}`,
        diff: Math.round((t.amount + Number.EPSILON) * 100) / 100,
      });
    }
  }

  return {
    balanced: discrepancies.length === 0,
    netWorth: round2(netWorth),
    assetsTotal: round2(assetsTotal),
    debtsTotal: round2(debtsTotal),
    totalIncome: round2(totalIncome),
    totalExpense: round2(totalExpense),
    totalDebtPaid: round2(totalDebtPaid),
    paymentFlowTotal: round2(paymentFlowTotal),
    discrepancies,
  };
}

/* ---------- 报表导出（只读，返回字符串内容） ---------- */
export interface ExportReportResult {
  format: 'csv' | 'json';
  filename: string;
  content: string;
}

/**
 * 导出财务报表为 CSV 或 JSON 字符串（调用方负责下载）。
 *  - json：{ generatedAt, period, summary, debts, incomes, assets, transactions }
 *  - csv：汇总表头 + transactions 明细（date,type,category,amount,note），含 CSV 引号转义
 * month 形如 '2026-07'，仅过滤 transactions 明细；汇总仍为全局口径，period 标注区间。
 */
export function exportReport(input: { format: 'csv' | 'json'; month?: string }): ExportReportResult {
  const { format, month } = input;
  const debtRows = db.select().from(debts).all() as DebtRow[];
  const incomeRows = db.select().from(incomes).all() as IncomeRow[];
  const assetRows = db.select().from(assets).all() as AssetRow[];
  let txnRows = db.select().from(transactions).all() as TxnRow[];

  const assetsTotal = assetRows.reduce((s, a) => s + a.value, 0);
  const debtsTotal = debtRows.reduce((s, r) => s + getDebtSummary(debtRowToCalcInput(r)).remainingPrincipal, 0);
  const netWorth = assetsTotal - debtsTotal;
  const totalIncome = txnRows.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = txnRows.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);

  const period = month ?? 'all';
  if (month) {
    txnRows = txnRows.filter((t) => (t.occurredAt || '').slice(0, 7) === month);
  }

  const now = new Date();
  const fileMonth = month ?? now.toISOString().slice(0, 7);
  const filename = `finance-report-${fileMonth}.${format}`;

  if (format === 'json') {
    const content = JSON.stringify(
      {
        generatedAt: now.toISOString(),
        period,
        summary: {
          assetsTotal: round2(assetsTotal),
          debtsTotal: round2(debtsTotal),
          netWorth: round2(netWorth),
          totalIncome: round2(totalIncome),
          totalExpense: round2(totalExpense),
        },
        debts: debtRows.map(debtRowToView),
        incomes: incomeRows.map(incomeRowToView),
        assets: assetRows.map(assetRowToView),
        transactions: txnRows.map(txnRowToView),
      },
      null,
      2,
    );
    return { format, filename, content };
  }

  // CSV：汇总表头 + 明细
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
    lines.push(
      `${date},${t.kind},${csvCell(t.category)},${t.amount},${csvCell(t.note)}`,
    );
  }
  return { format, filename, content: lines.join('\n') };
}

function csvCell(s: string): string {
  const v = s ?? '';
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ============ 金额互转（预留契约 P3） ============ */
type TransferRow = typeof financeTransfers.$inferSelect;

function transferRowToView(r: TransferRow): TransferView {
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

/**
 * 幂等插入：若同一 idempotencyKey 已存在，直接返回首条记录，避免网络重试造成重复转账。
 * 必须在 writeTx 事务内调用（与 appendEvent 共享同一原子边界）。
 */
export function insertTransfer(p: {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  note: string;
  idempotencyKey?: string | null;
  now: string;
}): TransferView {
  if (p.idempotencyKey) {
    const existing = db
      .select()
      .from(financeTransfers)
      .where(eq(financeTransfers.idempotencyKey, p.idempotencyKey))
      .get() as TransferRow | undefined;
    if (existing) return transferRowToView(existing);
  }
  db.insert(financeTransfers)
    .values({
      id: p.id,
      fromAccountId: p.fromAccountId,
      toAccountId: p.toAccountId,
      amountMinor: p.amountMinor,
      currency: p.currency,
      occurredAt: p.occurredAt,
      note: p.note,
      idempotencyKey: p.idempotencyKey ?? null,
      reversed: 0,
      reversedAt: null,
      createdAt: p.now,
    })
    .run();
  return transferRowToView(
    db.select().from(financeTransfers).where(eq(financeTransfers.id, p.id)).get() as TransferRow,
  );
}

export function listTransfers(opts: {
  limit: number;
  offset: number;
  accountId?: string;
}): TransferView[] {
  let rows: TransferRow[];
  if (opts.accountId) {
    rows = db
      .select()
      .from(financeTransfers)
      .where(
        or(
          eq(financeTransfers.fromAccountId, opts.accountId),
          eq(financeTransfers.toAccountId, opts.accountId),
        ),
      )
      .orderBy(desc(financeTransfers.occurredAt))
      .limit(opts.limit)
      .offset(opts.offset)
      .all() as TransferRow[];
  } else {
    rows = db
      .select()
      .from(financeTransfers)
      .orderBy(desc(financeTransfers.occurredAt))
      .limit(opts.limit)
      .offset(opts.offset)
      .all() as TransferRow[];
  }
  return rows.map(transferRowToView);
}

export function getTransfer(id: string): TransferView | undefined {
  const r = db
    .select()
    .from(financeTransfers)
    .where(eq(financeTransfers.id, id))
    .get() as TransferRow | undefined;
  return r ? transferRowToView(r) : undefined;
}

/** 撤销标记（预留：当前仅置 reversed，不自动回滚手动余额） */
export function reverseTransfer(id: string, reversedAt: string): void {
  db.update(financeTransfers).set({ reversed: 1, reversedAt }).where(eq(financeTransfers.id, id)).run();
}
