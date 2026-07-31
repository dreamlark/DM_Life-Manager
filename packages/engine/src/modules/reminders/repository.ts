import { db } from '../../db/client';
import { reminderClocks } from '../../db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import type { ReminderView } from '@dm-life/shared';

type ClockRow = typeof reminderClocks.$inferSelect;

function parseLeadChain(raw: string | null): number[] {
  if (!raw) return [7, 1, 0];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map((n) => Number(n));
  } catch {
    /* 容错 */
  }
  return [7, 1, 0];
}

function rowToView(r: ClockRow): ReminderView {
  return {
    id: r.id,
    title: r.title,
    domainKey: r.domainKey,
    periodRule: r.periodRule,
    leadChain: parseLeadChain(r.leadChain),
    noteLinked: r.noteLinked,
    nextFireAt: r.nextFireAt,
    lastFiredAt: r.lastFiredAt,
    lastCompletedAt: r.lastCompletedAt,
    status: r.status as ReminderView['status'],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** 全部钟（按下次响铃升序），用于「钟表铺」完整时间线 */
export function listClocks(): ReminderView[] {
  const rows = db.select().from(reminderClocks).orderBy(asc(reminderClocks.nextFireAt)).all() as ClockRow[];
  return rows.map(rowToView);
}

/**
 * 「即将响铃」：未来 horizonIso 内、且未归档的钟（ISO8601 字符串可字典序比较）。
 * 默认只展示待处理（active/due/overdue），其余在页面安静折叠。
 */
export function listUpcoming(horizonIso: string): ReminderView[] {
  const rows = db
    .select()
    .from(reminderClocks)
    .where(sql`status IN ('active','due','overdue') AND next_fire_at <= ${horizonIso}`)
    .orderBy(asc(reminderClocks.nextFireAt))
    .all() as ClockRow[];
  return rows.map(rowToView);
}

export function getClock(id: string): ClockRow | undefined {
  return db.select().from(reminderClocks).where(eq(reminderClocks.id, id)).get() as ClockRow | undefined;
}

export function insertClock(p: {
  id: string;
  title: string;
  domainKey: string;
  periodRule: string;
  leadChain: number[];
  noteLinked: string | null;
  nextFireAt: string;
  now: string;
}): void {
  db.insert(reminderClocks)
    .values({
      id: p.id,
      title: p.title,
      domainKey: p.domainKey,
      periodRule: p.periodRule,
      leadChain: JSON.stringify(p.leadChain),
      noteLinked: p.noteLinked,
      nextFireAt: p.nextFireAt,
      status: 'active',
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}

export function updateClockFields(
  id: string,
  fields: Partial<{
    nextFireAt: string;
    leadChain: number[];
    status: 'active' | 'due' | 'overdue' | 'done';
    lastFiredAt: string | null;
    lastCompletedAt: string | null;
    title: string;
    periodRule: string;
    noteLinked: string | null;
  }>,
  now: string,
): void {
  const set: Record<string, unknown> = { updatedAt: now };
  if (fields.nextFireAt !== undefined) set.nextFireAt = fields.nextFireAt;
  if (fields.status !== undefined) set.status = fields.status;
  if (fields.lastFiredAt !== undefined) set.lastFiredAt = fields.lastFiredAt;
  if (fields.lastCompletedAt !== undefined) set.lastCompletedAt = fields.lastCompletedAt;
  if (fields.leadChain !== undefined) set.leadChain = JSON.stringify(fields.leadChain);
  if (fields.title !== undefined) set.title = fields.title;
  if (fields.periodRule !== undefined) set.periodRule = fields.periodRule;
  if (fields.noteLinked !== undefined) set.noteLinked = fields.noteLinked;
  db.update(reminderClocks).set(set).where(eq(reminderClocks.id, id)).run();
}

export function deleteClock(id: string): void {
  db.delete(reminderClocks).where(eq(reminderClocks.id, id)).run();
}
