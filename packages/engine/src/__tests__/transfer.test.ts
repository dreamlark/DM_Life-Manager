import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../db/client';
import { financeTransfers, events } from '../db/schema';
import { migrate } from '../db/migrate';
import { initDb, dbPath } from '../db/client';
import { eventBus } from '../eventbus/EventBus';
import * as financeCommand from '../modules/finance/command';
import fs from 'node:fs';

describe('金额互转（预留契约 P3）：单一写路径 + 幂等', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
    await initDb();
    migrate();
  });

  it('createTransfer 双写 events + finance_transfers，并发布事件', () => {
    const beforeE = (db.select().from(events).all() as unknown[]).length;
    const beforeT = (db.select().from(financeTransfers).all() as unknown[]).length;
    let published = false;
    const unsub = eventBus.subscribe(() => {
      published = true;
    });

    const t = financeCommand.createTransfer({
      fromAccountId: 'acc-a',
      toAccountId: 'acc-b',
      amountMinor: 12345, // 123.45 元（整数分）
      currency: 'CNY',
      occurredAt: '2026-07-17',
      note: '零钱归集',
      idempotencyKey: 'idem-001',
    });

    unsub();
    expect(t.amountMinor).toBe(12345);
    expect(t.reversed).toBe(false);
    expect(published).toBe(true);
    expect((db.select().from(financeTransfers).all() as unknown[]).length).toBe(beforeT + 1);
    expect((db.select().from(events).all() as unknown[]).length).toBe(beforeE + 1);
    const all = db.select().from(events).all() as Array<{ type: string }>;
    expect(all.some((x) => x.type === 'TransferCreated')).toBe(true);
  });

  it('同 idempotencyKey 重复提交命中幂等：不重复写、不重复发事件', () => {
    const beforeT = (db.select().from(financeTransfers).all() as unknown[]).length;
    const beforeE = (db.select().from(events).all() as unknown[]).length;
    let published = false;
    const unsub = eventBus.subscribe(() => {
      published = true;
    });

    const dup = financeCommand.createTransfer({
      fromAccountId: 'acc-x',
      toAccountId: 'acc-y',
      amountMinor: 999,
      occurredAt: '2026-07-17',
      idempotencyKey: 'idem-001', // 与第一例相同
    });

    unsub();
    expect(dup.idempotencyKey).toBe('idem-001');
    expect((db.select().from(financeTransfers).all() as unknown[]).length).toBe(beforeT); // 未新增行
    expect((db.select().from(events).all() as unknown[]).length).toBe(beforeE); // 未新增事件
    expect(published).toBe(false);
  });

  it('listTransfers 按时间倒序；accountId 过滤命中 from/to', () => {
    financeCommand.createTransfer({
      fromAccountId: 'acc-p',
      toAccountId: 'acc-q',
      amountMinor: 500,
      occurredAt: '2026-07-18',
    });
    const all = financeCommand.listTransfers({ limit: 100, offset: 0 });
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]!.occurredAt >= all[all.length - 1]!.occurredAt).toBe(true);

    const filtered = financeCommand.listTransfers({ limit: 100, offset: 0, accountId: 'acc-p' });
    expect(filtered.every((t) => t.fromAccountId === 'acc-p' || t.toAccountId === 'acc-p')).toBe(true);
  });

  it('reverseTransfer 置 reversed 标记并发布 TransferReversed（不自动回滚手动余额）', () => {
    const t = financeCommand.createTransfer({
      fromAccountId: 'acc-r',
      toAccountId: 'acc-s',
      amountMinor: 77,
      occurredAt: '2026-07-19',
    });
    const reversed = financeCommand.reverseTransfer({ id: t.id, reason: '误操作' });
    expect(reversed.reversed).toBe(true);
    expect(reversed.reversedAt).not.toBeNull();

    const got = financeCommand.getTransfer({ id: t.id });
    expect(got?.reversed).toBe(true);
    const all = db.select().from(events).all() as Array<{ type: string }>;
    expect(all.some((x) => x.type === 'TransferReversed')).toBe(true);
  });
});
