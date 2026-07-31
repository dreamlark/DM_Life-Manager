import { nanoid } from 'nanoid';
import { writeTx } from '../../db/client';
import { appendEvent } from '../../events/EventStore';
import { eventBus } from '../../eventbus/EventBus';
import * as repo from './repository';
import {
  createDebtSchema,
  updateDebtSchema,
  closeDebtSchema,
  reopenDebtSchema,
  deleteDebtSchema,
  deleteIncomeSchema,
  deleteTransactionSchema,
  deleteAssetSchema,
  createBudgetSchema,
  updateBudgetSchema,
  deleteBudgetSchema,
  updateIncomeSchema,
  updateTransactionSchema,
  recordIncomeSchema,
  recordTransactionSchema,
  recordAssetSchema,
  updateAssetSchema,
  exportReportInputSchema,
  transferCreateSchema,
  transferListSchema,
  transferGetSchema,
  transferReverseSchema,
  type DebtView,
  type IncomeView,
  type TransactionView,
  type AssetView,
  type FinanceSummary,
  type BudgetView,
  type TransferView,
} from '@dm-life/shared';

/**
 * 单一写路径：Zod 校验 → writeTx(append事件 + 更新实体) → eventBus.publish。
 * 与任务模块完全一致，前端只发命令，绝不直接写财务实体表。
 */

/* ---------- 债务 ---------- */
export function createDebt(input: unknown): DebtView {
  const data = createDebtSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.insertDebt({
      id,
      creditor: data.creditor,
      principal: data.principal,
      apr: data.apr ?? null,
      minPayment: data.minPayment ?? null,
      dueDay: data.dueDay ?? null,
      status: data.status,
      debtType: data.debtType ?? 'other',
      termMonths: data.termMonths ?? null,
      repaymentMethod: data.repaymentMethod ?? 'equal_installment',
      startDate: data.startDate ?? null,
      rateType: data.rateType ?? null,
      baseRate: data.baseRate ?? null,
      rateSpread: data.rateSpread ?? null,
      rateAdjustments: data.rateAdjustments ? JSON.stringify(data.rateAdjustments) : null,
      repricing: data.repricing ? JSON.stringify(data.repricing) : null,
      prepayments: data.prepayments ? JSON.stringify(data.prepayments) : null,
      parentDebtId: data.parentDebtId ?? null,
      note: data.note ?? '',
      now,
    });
    return appendEvent({
      type: 'DebtCreated',
      payload: { debtId: id, creditor: data.creditor, principal: data.principal },
    });
  });

  eventBus.publish(env);
  return repo.listDebts().find((d) => d.id === id)!;
}

export function updateDebt(input: unknown): DebtView {
  const data = updateDebtSchema.parse(input);
  const now = new Date().toISOString();

  const env = writeTx(() => {
    const fields: Parameters<typeof repo.updateDebtFields>[1] = {};
    if (data.creditor !== undefined) fields.creditor = data.creditor;
    if (data.principal !== undefined) fields.principal = data.principal;
    if (data.apr !== undefined) fields.apr = data.apr;
    if (data.minPayment !== undefined) fields.minPayment = data.minPayment;
    if (data.dueDay !== undefined) fields.dueDay = data.dueDay;
    if (data.status !== undefined) fields.status = data.status;
    if (data.debtType !== undefined) fields.debtType = data.debtType;
    if (data.termMonths !== undefined) fields.termMonths = data.termMonths ?? null;
    if (data.repaymentMethod !== undefined) fields.repaymentMethod = data.repaymentMethod;
    if (data.startDate !== undefined) fields.startDate = data.startDate ?? null;
    if (data.rateType !== undefined) fields.rateType = data.rateType ?? null;
    if (data.baseRate !== undefined) fields.baseRate = data.baseRate ?? null;
    if (data.rateSpread !== undefined) fields.rateSpread = data.rateSpread ?? null;
    if (data.rateAdjustments !== undefined)
      fields.rateAdjustments = data.rateAdjustments ? JSON.stringify(data.rateAdjustments) : null;
    if (data.repricing !== undefined)
      fields.repricing = data.repricing ? JSON.stringify(data.repricing) : null;
    if (data.prepayments !== undefined)
      fields.prepayments = data.prepayments ? JSON.stringify(data.prepayments) : null;
    if (data.parentDebtId !== undefined) fields.parentDebtId = data.parentDebtId ?? null;
    if (data.note !== undefined) fields.note = data.note ?? '';
    repo.updateDebtFields(data.id, fields, now);
    const updated = repo.getDebt(data.id);
    return appendEvent({
      type: 'DebtUpdated',
      payload: {
        debtId: data.id,
        principal: updated?.principal ?? data.principal ?? 0,
        status: updated?.status ?? 'active',
      },
    });
  });

  eventBus.publish(env);
  return repo.listDebts().find((d) => d.id === data.id)!;
}

export function closeDebt(input: unknown): DebtView {
  const { id } = closeDebtSchema.parse(input);
  const closedAt = new Date().toISOString();

  const env = writeTx(() => {
    repo.updateDebtFields(id, { status: 'paid' }, closedAt);
    return appendEvent({ type: 'DebtClosed', payload: { debtId: id, closedAt } });
  });

  eventBus.publish(env);
  return repo.listDebts().find((d) => d.id === id)!;
}

export function reopenDebt(input: unknown): DebtView {
  const { id } = reopenDebtSchema.parse(input);
  const reopenedAt = new Date().toISOString();

  const env = writeTx(() => {
    repo.updateDebtFields(id, { status: 'active' }, reopenedAt);
    return appendEvent({ type: 'DebtReopened', payload: { debtId: id, reopenedAt } });
  });

  eventBus.publish(env);
  return repo.listDebts().find((d) => d.id === id)!;
}

export function deleteDebt(input: unknown): void {
  const { id } = deleteDebtSchema.parse(input);
  const env = writeTx(() => {
    repo.deleteDebtById(id);
    return appendEvent({ type: 'DebtDeleted', payload: { debtId: id } });
  });
  eventBus.publish(env);
}

export function listDebts(): DebtView[] {
  return repo.listDebts();
}

/** 单笔债务的还款计划（引擎实时计算） */
export function debtSchedule(id: string) {
  return repo.debtSchedule(id);
}

/** 债务还款进度汇总（双层：单笔 + 整体） */
export function debtProgressSummary() {
  return repo.debtProgressSummary();
}

/** 债务优化建议（雪崩 / 滚雪球） */
export function debtPayoffAdvice(mode: 'avalanche' | 'snowball') {
  return repo.debtPayoffAdvice(mode);
}

/* ---------- 收入源 ---------- */
export function recordIncome(input: unknown): IncomeView {
  const data = recordIncomeSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.insertIncome({
      id,
      source: data.source,
      amount: data.amount,
      currency: data.currency,
      receivedAt: data.receivedAt,
      recurring: data.recurring,
      note: data.note,
      incomeType: data.incomeType ?? 'salary',
      monthlyAvg: data.monthlyAvg ?? null,
      isFixed: data.isFixed ?? true,
      incomeMode: data.incomeMode ?? 'monthly',
      payDay: data.payDay ?? null,
      adjustmentDay: data.adjustmentDay ?? null,
      rateAdjustments: data.rateAdjustments ? JSON.stringify(data.rateAdjustments) : null,
      now,
    });
    return appendEvent({
      type: 'IncomeRecorded',
      payload: { incomeId: id, source: data.source, amount: data.amount, receivedAt: data.receivedAt },
    });
  });

  eventBus.publish(env);
  return repo.listIncomes().find((i) => i.id === id)!;
}

export function listIncomes(): IncomeView[] {
  return repo.listIncomes();
}

export function updateIncome(input: unknown): IncomeView {
  const data = updateIncomeSchema.parse(input);
  const env = writeTx(() => {
    const fields: Parameters<typeof repo.updateIncomeFields>[1] = {};
    if (data.source !== undefined) fields.source = data.source;
    if (data.amount !== undefined) fields.amount = data.amount;
    if (data.note !== undefined) fields.note = data.note;
    if (data.incomeType !== undefined) fields.incomeType = data.incomeType;
    if (data.monthlyAvg !== undefined) fields.monthlyAvg = data.monthlyAvg ?? null;
    if (data.isFixed !== undefined) fields.isFixed = data.isFixed;
    if (data.incomeMode !== undefined) fields.incomeMode = data.incomeMode;
    if (data.payDay !== undefined) fields.payDay = data.payDay ?? null;
    if (data.adjustmentDay !== undefined) fields.adjustmentDay = data.adjustmentDay ?? null;
    if (data.rateAdjustments !== undefined)
      fields.rateAdjustments = data.rateAdjustments ? JSON.stringify(data.rateAdjustments) : null;
    repo.updateIncomeFields(data.id, fields);
    const inc = repo.getIncome(data.id);
    return appendEvent({
      type: 'IncomeUpdated',
      payload: {
        incomeId: data.id,
        source: inc?.source ?? data.source ?? '',
        amount: inc?.amount ?? data.amount ?? 0,
      },
    });
  });
  eventBus.publish(env);
  return repo.listIncomes().find((i) => i.id === data.id)!;
}

export function deleteIncome(input: unknown): void {
  const { id } = deleteIncomeSchema.parse(input);
  const env = writeTx(() => {
    repo.deleteIncomeById(id);
    return appendEvent({ type: 'IncomeDeleted', payload: { incomeId: id } });
  });
  eventBus.publish(env);
}

/* ---------- 交易流水 ---------- */
export function recordTransaction(input: unknown): TransactionView {
  const data = recordTransactionSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.insertTransaction({
      id,
      kind: data.kind,
      category: data.category,
      amount: data.amount,
      merchant: data.merchant ?? null,
      occurredAt: data.occurredAt,
      note: data.note,
      debtId: data.debtId ?? null,
      incomeSourceId: data.incomeSourceId ?? null,
      now,
    });
    return appendEvent({
      type: 'TransactionRecorded',
      payload: {
        transactionId: id,
        kind: data.kind,
        category: data.category,
        amount: data.amount,
        occurredAt: data.occurredAt,
      },
    });
  });

  eventBus.publish(env);
  return repo.listTransactions().find((t) => t.id === id)!;
}

export function listTransactions(): TransactionView[] {
  return repo.listTransactions();
}

export function updateTransaction(input: unknown): TransactionView {
  const data = updateTransactionSchema.parse(input);
  const env = writeTx(() => {
    const fields: Parameters<typeof repo.updateTransactionFields>[1] = {};
    if (data.kind !== undefined) fields.kind = data.kind;
    if (data.category !== undefined) fields.category = data.category;
    if (data.amount !== undefined) fields.amount = data.amount;
    if (data.note !== undefined) fields.note = data.note;
    if (data.debtId !== undefined) fields.debtId = data.debtId ?? null;
    if (data.incomeSourceId !== undefined) fields.incomeSourceId = data.incomeSourceId ?? null;
    repo.updateTransactionFields(data.id, fields);
    const txn = repo.getTransaction(data.id);
    return appendEvent({
      type: 'TransactionUpdated',
      payload: {
        transactionId: data.id,
        kind: txn?.kind ?? 'expense',
        category: txn?.category ?? '',
        amount: txn?.amount ?? 0,
      },
    });
  });
  eventBus.publish(env);
  return repo.listTransactions().find((t) => t.id === data.id)!;
}

export function deleteTransaction(input: unknown): void {
  const { id } = deleteTransactionSchema.parse(input);
  const env = writeTx(() => {
    repo.deleteTransactionById(id);
    return appendEvent({ type: 'TransactionDeleted', payload: { transactionId: id } });
  });
  eventBus.publish(env);
}

/* ---------- 资产 ---------- */
export function recordAsset(input: unknown): AssetView {
  const data = recordAssetSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.insertAsset({
      id,
      name: data.name,
      assetClass: data.assetClass,
      value: data.value,
      asOf: data.asOf,
      linkedIncomeSourceId: data.linkedIncomeSourceId ?? null,
      now,
    });
    return appendEvent({
      type: 'AssetRecorded',
      payload: {
        assetId: id,
        name: data.name,
        assetClass: data.assetClass,
        value: data.value,
        asOf: data.asOf,
      },
    });
  });

  eventBus.publish(env);
  return repo.listAssets().find((a) => a.id === id)!;
}

export function updateAsset(input: unknown): AssetView {
  const data = updateAssetSchema.parse(input);
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.updateAssetValue(
      data.id,
      data.value ?? repo.getAsset(data.id)?.value ?? 0,
      data.asOf ?? repo.getAsset(data.id)?.asOf ?? now,
      now,
      data.linkedIncomeSourceId,
      data.assetClass,
      data.name,
    );
    return appendEvent({
      type: 'AssetUpdated',
      payload: {
        assetId: data.id,
        value: data.value ?? repo.getAsset(data.id)?.value ?? 0,
        asOf: data.asOf ?? repo.getAsset(data.id)?.asOf ?? now,
      },
    });
  });

  eventBus.publish(env);
  return repo.listAssets().find((a) => a.id === data.id)!;
}

export function deleteAsset(input: unknown): void {
  const { id } = deleteAssetSchema.parse(input);
  const env = writeTx(() => {
    repo.deleteAssetById(id);
    return appendEvent({ type: 'AssetDeleted', payload: { assetId: id } });
  });
  eventBus.publish(env);
}

export function listAssets(): AssetView[] {
  return repo.listAssets();
}

/* ---------- 预算（整体/分类月度限额） ---------- */
export function createBudget(input: unknown): BudgetView {
  const data = createBudgetSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();
  const scope = data.scope ?? 'overall';
  const category = data.category ?? null;

  const env = writeTx(() => {
    repo.insertBudget({
      id,
      name: data.name,
      scope,
      category,
      monthlyLimit: data.monthlyLimit,
      note: data.note ?? '',
      now,
    });
    return appendEvent({
      type: 'BudgetCreated',
      payload: { budgetId: id, name: data.name, monthlyLimit: data.monthlyLimit, scope, category },
    });
  });

  eventBus.publish(env);
  return repo.listBudgets().find((b) => b.id === id)!;
}

export function updateBudget(input: unknown): BudgetView {
  const data = updateBudgetSchema.parse(input);
  const now = new Date().toISOString();

  const env = writeTx(() => {
    const fields: Parameters<typeof repo.updateBudgetFields>[1] = {};
    if (data.name !== undefined) fields.name = data.name;
    if (data.scope !== undefined) fields.scope = data.scope;
    if (data.category !== undefined) fields.category = data.category ?? null;
    if (data.monthlyLimit !== undefined) fields.monthlyLimit = data.monthlyLimit;
    if (data.note !== undefined) fields.note = data.note;
    repo.updateBudgetFields(data.id, fields, now);
    const b = repo.getBudget(data.id);
    return appendEvent({
      type: 'BudgetUpdated',
      payload: {
        budgetId: data.id,
        name: b?.name ?? data.name ?? '',
        monthlyLimit: b?.monthlyLimit ?? data.monthlyLimit ?? 0,
        scope: (b?.scope as 'overall' | 'category') ?? 'overall',
        category: b?.category ?? null,
      },
    });
  });

  eventBus.publish(env);
  return repo.listBudgets().find((b) => b.id === data.id)!;
}

export function deleteBudget(input: unknown): void {
  const { id } = deleteBudgetSchema.parse(input);
  const env = writeTx(() => {
    repo.deleteBudgetById(id);
    return appendEvent({ type: 'BudgetDeleted', payload: { budgetId: id } });
  });
  eventBus.publish(env);
}

export function listBudgets(): BudgetView[] {
  return repo.listBudgets();
}

/* ---------- 仪表盘 / 趋势 / 自动刷新 ---------- */
export function summary(): FinanceSummary {
  return repo.summary();
}

/** 全局账目核对（只读，不写事件） */
export function reconcile() {
  return repo.reconcile();
}

/** 报表导出（只读，不写事件） */
export function exportReport(input: unknown) {
  const data = exportReportInputSchema.parse(input);
  return repo.exportReport({ format: data.format, month: data.month });
}

export function monthlyTrend(months: number): { month: string; income: number; expense: number; net: number }[] {
  return repo.monthlyTrend(months);
}

export function autoRefresh(): { incomes: number; debts: number; skipped: number } {
  const res = writeTx(() => {
    const generated = repo.autoGenerateMonthly(new Date());
    const env = appendEvent({ type: 'FinanceAutoRefreshed', payload: generated });
    return { generated, env };
  });
  eventBus.publish(res.env);
  return res.generated;
}

/* ---------- 金额互转（预留契约 P3） ---------- */
/**
 * 单一写路径：Zod 校验 → writeTx(幂等插入 + appendEvent) → eventBus.publish。
 * 同 idempotencyKey 重复提交命中已存在记录时，不写新事件、直接返回首条结果。
 */
export function createTransfer(input: unknown): TransferView {
  const data = transferCreateSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();
  let view: TransferView | null = null;
  let created = false;

  const env = writeTx(() => {
    view = repo.insertTransfer({
      id,
      fromAccountId: data.fromAccountId,
      toAccountId: data.toAccountId,
      amountMinor: data.amountMinor,
      currency: data.currency,
      occurredAt: data.occurredAt,
      note: data.note ?? '',
      idempotencyKey: data.idempotencyKey ?? null,
      now,
    });
    // 幂等命中（已存在同 idempotencyKey 记录）：不写事件、不发布
    if (view.id !== id) return null;
    created = true;
    return appendEvent({
      type: 'TransferCreated',
      payload: {
        transferId: id,
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        amountMinor: data.amountMinor,
        currency: data.currency,
        occurredAt: data.occurredAt,
      },
    });
  });

  if (created && env) eventBus.publish(env);
  return view!;
}

export function listTransfers(input: unknown): TransferView[] {
  const data = transferListSchema.parse(input);
  return repo.listTransfers({
    limit: data.limit,
    offset: data.offset,
    accountId: data.accountId,
  });
}

export function getTransfer(input: unknown): TransferView | undefined {
  const data = transferGetSchema.parse(input);
  return repo.getTransfer(data.id);
}

/** 撤销一笔转账（预留：仅置 reversed 标记，不自动回滚手动余额） */
export function reverseTransfer(input: unknown): TransferView {
  const data = transferReverseSchema.parse(input);
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.reverseTransfer(data.id, now);
    return appendEvent({
      type: 'TransferReversed',
      payload: { transferId: data.id, reason: data.reason ?? null, reversedAt: now },
    });
  });

  eventBus.publish(env);
  return repo.getTransfer(data.id)!;
}
