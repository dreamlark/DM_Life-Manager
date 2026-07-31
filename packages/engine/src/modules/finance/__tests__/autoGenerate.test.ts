import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, dbPath } from '../../../db/client';
import { migrate } from '../../../db/migrate';
import { seedDomains } from '../../../db/seed';
import * as repo from '../repository';
import fs from 'node:fs';

// 当月 15 号：payDay=10 / dueDay=5 均已到达，应触发生成
const JULY = new Date('2026-07-15T10:00:00');
const AUG = new Date('2026-08-15T10:00:00');

describe('财务自动刷新：autoGenerateMonthly（变量遮蔽回归）', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { recursive: true, force: true });
    await initDb();
    migrate();
    seedDomains();

    // 固定月薪收入源（每月 10 号发）
    repo.insertIncome({
      id: 'inc_1',
      source: '工资',
      amount: 5000,
      currency: 'CNY',
      receivedAt: '2026-07-01',
      recurring: true,
      note: 'test',
      now: JULY.toISOString(),
      incomeMode: 'monthly',
      payDay: 10,
      monthlyAvg: 5000,
    });
    // 活跃债务（每月 5 号扣款；apr=0 时月供=本金/期数=100，且 minPayment 兜底）
    repo.insertDebt({
      id: 'debt_1',
      creditor: '银行',
      principal: 1200,
      apr: 0,
      minPayment: 100,
      dueDay: 5,
      status: 'active',
      debtType: 'loan',
      termMonths: 12,
      repaymentMethod: 'equal_installment',
      startDate: '2026-07-01',
      now: JULY.toISOString(),
    });
  });

  it('正常流程：生成固定收入 + 债务还款流水，不抛错且计数正确', () => {
    const before = repo.listTransactions().length;
    // 关键：修复前此处会抛错 —— incomes/debts 被局部 number 遮蔽，误传给 .from()
    const res = repo.autoGenerateMonthly(JULY);
    expect(res).toEqual({ incomes: 1, debts: 1, skipped: 0 });
    expect(repo.listTransactions().length).toBe(before + 2);
  });

  it('边界：同月重复调用 -> 全部 skipped，不重复生成', () => {
    const res = repo.autoGenerateMonthly(JULY);
    expect(res).toEqual({ incomes: 0, debts: 0, skipped: 2 });
    // 流水总数不再增加（仍是上一次生成的 2 条）
    expect(repo.listTransactions().length).toBe(2);
  });

  it('跨月：新月份再次生成，且按 来源/债务+月份 去重', () => {
    const res = repo.autoGenerateMonthly(AUG);
    expect(res).toEqual({ incomes: 1, debts: 1, skipped: 0 });
    expect(repo.listTransactions().length).toBe(4);
    // 8 月重复 -> skipped
    const res2 = repo.autoGenerateMonthly(AUG);
    expect(res2).toEqual({ incomes: 0, debts: 0, skipped: 2 });
  });
});

describe('财务自动刷新：autoGenerateMonthly — 空数据边界', () => {
  beforeAll(async () => {
    // 全新空库（无收入源/债务），隔离验证全 0 分支
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { recursive: true, force: true });
    await initDb();
    migrate();
    seedDomains();
  });

  it('无任何收入源/债务时返回全 0 且不抛错', () => {
    const res = repo.autoGenerateMonthly(JULY);
    expect(res).toEqual({ incomes: 0, debts: 0, skipped: 0 });
    expect(repo.listTransactions().length).toBe(0);
  });
});
