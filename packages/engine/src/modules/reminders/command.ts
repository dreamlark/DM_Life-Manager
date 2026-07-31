import { nanoid } from 'nanoid';
import { db } from '../../db/client';
import { reminderClocks } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { writeTx } from '../../db/client';
import { appendEvent } from '../../events/EventStore';
import { eventBus } from '../../eventbus/EventBus';
import * as repo from './repository';
import {
  createReminderSchema,
  completeReminderSchema,
  rewindReminderSchema,
  snoozeReminderSchema,
  deleteReminderSchema,
  updateReminderSchema,
  computeNextFire,
  type CreateReminderInput,
  type CompleteReminderInput,
  type RewindReminderInput,
  type SnoozeReminderInput,
  type ReminderView,
} from '@dm-life/shared';

/**
 * 单一写路径：Zod 校验 → writeTx(append事件 + 更新实体) → eventBus.publish。
 * 与任务/财务模块完全一致，前端只发命令，绝不直接写 reminder_clocks。
 */

/* ---------- 建钟 ---------- */
export function createReminder(input: unknown): ReminderView {
  const data = createReminderSchema.parse(input) as CreateReminderInput;
  const id = nanoid();
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.insertClock({
      id,
      title: data.title,
      domainKey: data.domainKey,
      periodRule: data.periodRule,
      leadChain: data.leadChain,
      noteLinked: data.noteLinked ?? null,
      nextFireAt: data.nextFireAt,
      now,
    });
    return appendEvent({
      type: 'ReminderClockCreated',
      payload: {
        reminderId: id,
        title: data.title,
        domainKey: data.domainKey,
        periodRule: data.periodRule,
        leadChain: data.leadChain,
        noteLinked: data.noteLinked ?? null,
        nextFireAt: data.nextFireAt,
      },
    });
  });

  eventBus.publish(env);
  return repo.listClocks().find((c) => c.id === id)!;
}

/* ---------- 完成（一键完成并自动上发条到下一周期） ---------- */
export function completeReminder(input: unknown): ReminderView {
  const { id } = completeReminderSchema.parse(input) as CompleteReminderInput;
  const now = new Date().toISOString();

  const env = writeTx(() => {
    const row = repo.getClock(id);
    if (!row) throw new Error(`reminder not found: ${id}`);
    const next = computeNextFire(row.periodRule, now);
    const fields: Parameters<typeof repo.updateClockFields>[1] = { lastCompletedAt: now };
    if (next === null) {
      // 「单次」提醒：完成即终止，不再上发条到下一周期
      fields.status = 'done';
    } else {
      fields.nextFireAt = next;
      fields.status = 'active';
    }
    repo.updateClockFields(id, fields, now);
    return appendEvent({ type: 'ReminderCompleted', payload: { reminderId: id, completedAt: now } });
  });

  eventBus.publish(env);
  return repo.listClocks().find((c) => c.id === id)!;
}

/* ---------- 手动上发条（重置下次响铃） ---------- */
export function rewindReminder(input: unknown): ReminderView {
  const data = rewindReminderSchema.parse(input) as RewindReminderInput;
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.updateClockFields(data.id, { nextFireAt: data.nextFireAt, status: 'active' }, now);
    return appendEvent({
      type: 'ReminderClockRewound',
      payload: { reminderId: data.id, nextFireAt: data.nextFireAt },
    });
  });

  eventBus.publish(env);
  return repo.listClocks().find((c) => c.id === data.id)!;
}

/* ---------- 推迟 ---------- */
export function snoozeReminder(input: unknown): ReminderView {
  const data = snoozeReminderSchema.parse(input) as SnoozeReminderInput;
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.updateClockFields(data.id, { nextFireAt: data.nextFireAt, status: 'active' }, now);
    return appendEvent({
      type: 'ReminderSnoozed',
      payload: { reminderId: data.id, nextFireAt: data.nextFireAt },
    });
  });

  eventBus.publish(env);
  return repo.listClocks().find((c) => c.id === data.id)!;
}

/* ---------- 编辑（标题/周期/提前链/关联笔记） ---------- */
export function updateReminder(input: unknown): ReminderView {
  const data = updateReminderSchema.parse(input);
  const now = new Date().toISOString();

  const env = writeTx(() => {
    const fields: Parameters<typeof repo.updateClockFields>[1] = {};
    if (data.title !== undefined) fields.title = data.title;
    if (data.periodRule !== undefined) fields.periodRule = data.periodRule;
    if (data.leadChain !== undefined) fields.leadChain = data.leadChain;
    if (data.noteLinked !== undefined) fields.noteLinked = data.noteLinked;
    repo.updateClockFields(data.id, fields, now);
    const row = repo.getClock(data.id)!;
    let leadChain: number[] = [7, 1, 0];
    try {
      const arr = JSON.parse(row.leadChain);
      if (Array.isArray(arr)) leadChain = arr.map((n) => Number(n));
    } catch {
      /* 容错 */
    }
    return appendEvent({
      type: 'ReminderUpdated',
      payload: {
        reminderId: data.id,
        title: row.title,
        periodRule: row.periodRule,
        leadChain,
        noteLinked: row.noteLinked,
      },
    });
  });

  eventBus.publish(env);
  return repo.listClocks().find((c) => c.id === data.id)!;
}

/* ---------- 删除 ---------- */
export function deleteReminder(input: unknown): void {
  const { id } = deleteReminderSchema.parse(input);
  const env = writeTx(() => {
    repo.deleteClock(id);
    return appendEvent({ type: 'ReminderDeleted', payload: { reminderId: id } });
  });
  eventBus.publish(env);
}

/** 全部钟（用于「钟表铺」时间线） */
export function listClocks(): ReminderView[] {
  return repo.listClocks();
}

/** 未来 horizonIso 内即将响铃的钟（今日/明日的提醒摘要） */
export function listUpcoming(horizonIso: string): ReminderView[] {
  return repo.listUpcoming(horizonIso);
}

/**
 * 调度器 tick：把到期钟置为 due 并广播 ReminderFired；把超出宽限仍未处理的钟置为
 * overdue 并广播 ReminderOverdue（前端据此平静地转入压力背包低优先级卡）。
 */
export function tickReminders(graceDays = 7): { fired: string[]; overdue: string[] } {
  const now = new Date().toISOString();
  const graceIso = new Date(Date.now() - graceDays * 86400000).toISOString();
  const fired: string[] = [];
  const overdue: string[] = [];

  const envs = writeTx(() => {
    const collected = [];
    const dueNow = db
      .select()
      .from(reminderClocks)
      .where(sql`status='active' AND next_fire_at <= ${now}`)
      .all() as Array<typeof reminderClocks.$inferSelect>;
    for (const r of dueNow) {
      repo.updateClockFields(r.id, { status: 'due', lastFiredAt: now }, now);
      collected.push(appendEvent({ type: 'ReminderFired', payload: { reminderId: r.id, firedAt: now } }));
      fired.push(r.id);
    }
    const overdueNow = db
      .select()
      .from(reminderClocks)
      .where(sql`status='due' AND last_fired_at <= ${graceIso}`)
      .all() as Array<typeof reminderClocks.$inferSelect>;
    for (const r of overdueNow) {
      repo.updateClockFields(r.id, { status: 'overdue' }, now);
      collected.push(appendEvent({ type: 'ReminderOverdue', payload: { reminderId: r.id, overdueSince: now } }));
      overdue.push(r.id);
    }
    return collected;
  });

  for (const env of envs) eventBus.publish(env);
  return { fired, overdue };
}
