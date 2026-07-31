import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { events, reminderClocks } from '../db/schema';
import { migrate } from '../db/migrate';
import { initDb, dbPath } from '../db/client';
import { eventBus } from '../eventbus/EventBus';
import * as remindersCommand from '../modules/reminders/command';
import { computeNextFire } from '@dm-life/shared';
import fs from 'node:fs';

function eventCount() {
  return (db.select().from(events).all() as unknown[]).length;
}
function clockCount() {
  return (db.select().from(reminderClocks).all() as unknown[]).length;
}

describe('提醒钟表铺：单一写路径 + 周期解析 + 调度 tick', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
    await initDb();
    migrate();
  });

  it('computeNextFire 解析常见周期规则', () => {
    const base = '2026-01-15T00:00:00.000Z';
    expect(computeNextFire('每3个月', base)!.startsWith('2026-04-15')).toBe(true);
    expect(computeNextFire('每季度', base)!.startsWith('2026-04-15')).toBe(true);
    expect(computeNextFire('每2周', base)!.startsWith('2026-01-29')).toBe(true);
    expect(computeNextFire('每年', base)!.startsWith('2027-01-15')).toBe(true);
    // 「单次」不再重复
    expect(computeNextFire('单次', base)).toBeNull();
    // 无法识别回退 +30 天
    const fallback = new Date(computeNextFire('随便写', base)!).getTime();
    expect(fallback - new Date(base).getTime()).toBe(30 * 86400000);
  });

  it('createReminder 双写 events + reminder_clocks 并触发 EventBus', () => {
    const beforeE = eventCount();
    const beforeC = clockCount();
    let published = false;
    const unsub = eventBus.subscribe(() => {
      published = true;
    });

    const clock = remindersCommand.createReminder({
      title: '车险续保',
      domainKey: 'wealth',
      periodRule: '每3个月',
      leadChain: [7, 1, 0],
      noteLinked: '保单照片',
      nextFireAt: new Date(Date.now() + 5 * 86400000).toISOString(),
    });

    unsub();
    expect(clockCount()).toBe(beforeC + 1);
    expect(eventCount()).toBe(beforeE + 1);
    expect(published).toBe(true);
    expect(clock.status).toBe('active');
    expect(clock.leadChain).toEqual([7, 1, 0]);
    expect(clock.noteLinked).toBe('保单照片');

    const all = db.select().from(events).all() as Array<{ type: string }>;
    expect(all.some((x) => x.type === 'ReminderClockCreated')).toBe(true);
  });

  it('completeReminder 自动上发条到下一周期（status 回到 active 且时间推后）', () => {
    const clock = remindersCommand.createReminder({
      title: '季度复盘',
      domainKey: 'work',
      periodRule: '每季度',
      nextFireAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const oldFire = clock.nextFireAt;

    const done = remindersCommand.completeReminder({ id: clock.id });
    expect(done.status).toBe('active');
    expect(new Date(done.nextFireAt).getTime()).toBeGreaterThan(new Date(oldFire).getTime());
    expect(done.lastCompletedAt).not.toBeNull();

    const all = db.select().from(events).all() as Array<{ type: string }>;
    expect(all.some((x) => x.type === 'ReminderCompleted')).toBe(true);
  });

  it('tickReminders 让到期钟响铃、超宽限钟转逾期', () => {
    // 一只宽限内刚响铃的钟（创建后由 tick 置 due，last_fired_at=now）
    const fresh = remindersCommand.createReminder({
      title: '宽限内',
      domainKey: 'family',
      periodRule: '每1个月',
      nextFireAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    });
    // 一只已超宽限的钟：直接置为 due 且 last_fired_at 早于 7 天宽限
    const due = remindersCommand.createReminder({
      title: '逾期测试',
      domainKey: 'health',
      periodRule: '每1个月',
      nextFireAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    });
    db.update(reminderClocks)
      .set({ status: 'due', lastFiredAt: new Date(Date.now() - 10 * 86400000).toISOString() })
      .where(eq(reminderClocks.id, due.id))
      .run();

    const { fired, overdue } = remindersCommand.tickReminders();
    // 宽限内的钟被响铃，已逾期的钟不再重复响铃
    expect(fired).toContain(fresh.id);
    expect(fired).not.toContain(due.id);
    // 逾期测试钟已超 7 天宽限 → 转逾期
    expect(overdue).toContain(due.id);
    expect(overdue).not.toContain(fresh.id);

    const dueRow = db
      .select()
      .from(reminderClocks)
      .where(eq(reminderClocks.id, due.id))
      .get() as { status: string };
    expect(dueRow.status).toBe('overdue');

    const events2 = db.select().from(events).all() as Array<{ type: string }>;
    expect(events2.some((x) => x.type === 'ReminderFired')).toBe(true);
    expect(events2.some((x) => x.type === 'ReminderOverdue')).toBe(true);
  });
});
