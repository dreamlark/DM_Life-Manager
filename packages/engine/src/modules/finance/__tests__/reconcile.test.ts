import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, dbPath } from '../../../db/client';
import { migrate } from '../../../db/migrate';
import * as financeCommand from '../command';
import fs from 'node:fs';

describe('财务模块：全局账目核对 + 报表导出', () => {
  beforeAll(async () => {
    // PGLite 的 dbPath 是一个目录，必须用 recursive + force（全量运行时其它用例可能已建过）
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { recursive: true, force: true });
    await initDb();
    migrate();
  });

  it('reconcile 在干净数据（仅有债务、无流水）时 balanced=true 且无差异', () => {
    financeCommand.createDebt({
      creditor: '测试银行',
      principal: 12000,
      apr: 5,
      dueDay: 15,
      termMonths: 12,
      repaymentMethod: 'equal_installment',
      startDate: new Date().toISOString().slice(0, 10),
    });

    const r = financeCommand.reconcile();
    expect(r.balanced).toBe(true);
    expect(r.discrepancies).toHaveLength(0);
    expect(r.debtsTotal).toBe(12000); // 未偿本金 = 原始本金（尚未还款）
    expect(r.assetsTotal).toBe(0);
    expect(r.netWorth).toBe(-12000);
    expect(r.totalDebtPaid).toBe(0);
    expect(r.paymentFlowTotal).toBe(0);
  });

  it('当债务「登记已还本金」与还款流水不一致时，reconcile 返回 discrepancy', () => {
    const debt = financeCommand.listDebts()[0]!;
    // 记一笔还款流水（金额 500），但债务尚未产生任何已还本金（新发放）
    financeCommand.recordTransaction({
      kind: 'debt_payment',
      category: debt.creditor,
      amount: 500,
      occurredAt: new Date().toISOString().slice(0, 10),
      debtId: debt.id,
    });

    const r = financeCommand.reconcile();
    expect(r.balanced).toBe(false);
    expect(r.discrepancies.length).toBeGreaterThan(0);

    // 至少有一笔「逐债」差异
    const debtDisc = r.discrepancies.find((d) => d.scope === `debt:${debt.creditor}`);
    expect(debtDisc).toBeDefined();
    // 登记已还本金(0) − 流水(500) = -500
    expect(debtDisc!.diff).toBe(-500);

    // 全局：Σ 已还本金(0) − 还款流水(500) = -500
    const globalDisc = r.discrepancies.find((d) => d.scope === 'global:paymentFlow');
    expect(globalDisc).toBeDefined();
    expect(globalDisc!.diff).toBe(-500);
  });

  it('exportReport 返回合法 csv 与 json 字符串', () => {
    const csv = financeCommand.exportReport({ format: 'csv' });
    expect(csv.format).toBe('csv');
    expect(csv.filename).toMatch(/^finance-report-\d{4}-\d{2}\.csv$/);
    expect(csv.content).toContain('资产合计');
    expect(csv.content).toContain('date,type,category,amount,note');
    expect(csv.content.split('\n').some((l) => l.startsWith('2026') && l.includes('debt_payment'))).toBe(true);

    const json = financeCommand.exportReport({ format: 'json' });
    expect(json.format).toBe('json');
    expect(json.filename).toMatch(/^finance-report-\d{4}-\d{2}\.json$/);
    const parsed = JSON.parse(json.content);
    expect(parsed).toHaveProperty('generatedAt');
    expect(parsed).toHaveProperty('period', 'all');
    expect(parsed.summary).toHaveProperty('assetsTotal');
    expect(parsed.summary).toHaveProperty('netWorth');
    expect(Array.isArray(parsed.debts)).toBe(true);
    expect(Array.isArray(parsed.transactions)).toBe(true);
  });

  it('exportReport month 过滤：仅导出指定月份的 transactions', () => {
    const json = financeCommand.exportReport({ format: 'json', month: '1999-01' });
    const parsed = JSON.parse(json.content);
    expect(parsed.period).toBe('1999-01');
    expect(parsed.transactions).toHaveLength(0);
  });
});
