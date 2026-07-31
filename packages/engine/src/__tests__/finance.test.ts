import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../db/client';
import { events, debts, transactions, assets } from '../db/schema';
import { migrate } from '../db/migrate';
import { initDb, dbPath } from '../db/client';
import { eventBus } from '../eventbus/EventBus';
import * as financeCommand from '../modules/finance/command';
import fs from 'node:fs';

function counts() {
  const e = (db.select().from(events).all() as unknown[]).length;
  const d = (db.select().from(debts).all() as unknown[]).length;
  const t = (db.select().from(transactions).all() as unknown[]).length;
  return { e, d, t };
}

describe('财务模块：单一写路径双写一致 + 总览聚合', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
    await initDb();
    migrate();
  });

  it('createDebt 同时写 events 与 debts，并触发 EventBus', () => {
    const before = counts();
    let published = false;
    const unsub = eventBus.subscribe(() => {
      published = true;
    });

    const debt = financeCommand.createDebt({
      creditor: '招商银行信用卡',
      principal: 12000,
      minPayment: 600,
      dueDay: 15,
    });

    unsub();
    const after = counts();
    expect(after.d).toBe(before.d + 1);
    expect(after.e).toBe(before.e + 1);
    expect(published).toBe(true);
    expect(debt.status).toBe('active');
    expect(debt.principal).toBe(12000);

    const all = db.select().from(events).all() as Array<{ type: string }>;
    expect(all.some((x) => x.type === 'DebtCreated')).toBe(true);
  });

  it('summary 聚合负债/支出，closeDebt 后负债从总览剔除', () => {
    const s1 = financeCommand.summary();
    expect(s1.totalDebt).toBe(12000);
    expect(s1.netWorth).toBe(-12000);

    // 记一笔支出
    financeCommand.recordTransaction({ kind: 'expense', category: '餐饮', amount: 88, occurredAt: '2026-07-07' });
    const s2 = financeCommand.summary();
    expect(s2.totalExpense).toBe(88);

    // 记一笔资产
    financeCommand.recordAsset({ name: '活期存款', assetClass: 'cash', value: 50000, asOf: '2026-07-07' });
    const s3 = financeCommand.summary();
    expect(s3.totalAssets).toBe(50000);
    expect(s3.netWorth).toBe(38000);

    // 结清债务
    const debt = financeCommand.listDebts()[0]!;
    financeCommand.closeDebt({ id: debt.id });
    const s4 = financeCommand.summary();
    expect(s4.totalDebt).toBe(0); // 已结清不再计入
    expect(s4.netWorth).toBe(50000); // 净资产 = 资产(50000) - 负债(0)；支出不计入净资产模型
  });

  it('reopenDebt 将已结清债务恢复为 active，并重新计入总览（结清标签可双向切换）', () => {
    const debt = financeCommand.listDebts()[0]!;
    expect(debt.status).toBe('paid');

    financeCommand.reopenDebt({ id: debt.id });
    const reopened = financeCommand.listDebts().find((d) => d.id === debt.id)!;
    expect(reopened.status).toBe('active');

    const s = financeCommand.summary();
    expect(s.totalDebt).toBe(12000); // 重新计入负债

    const all = db.select().from(events).all() as Array<{ type: string }>;
    expect(all.some((x) => x.type === 'DebtReopened')).toBe(true);
  });
});
