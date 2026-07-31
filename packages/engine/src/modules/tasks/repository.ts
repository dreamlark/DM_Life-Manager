import { db } from '../../db/client';
import { tasks } from '../../db/schema';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { CreateTaskInput, TaskRepeat, TaskView } from '@dm-life/shared';

type TaskRow = typeof tasks.$inferSelect;

/** 本地时区今日日期（YYYY-MM-DD），用于任务日期默认值与每日例行实例化 */
export function todayStr(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function quadrantOf(row: Pick<TaskRow, 'importance' | 'urgency'>): TaskView['quadrant'] {
  if (row.importance && row.urgency) return 'q1';
  if (row.importance && !row.urgency) return 'q2';
  if (!row.importance && row.urgency) return 'q3';
  return 'q4';
}

function rowToView(row: TaskRow): TaskView {
  return {
    id: row.id,
    title: row.title,
    domainKey: row.domainKey,
    projectId: row.projectId,
    importance: !!row.importance,
    urgency: !!row.urgency,
    isMit: !!row.isMit,
    mitOrder: row.mitOrder,
    status: row.status,
    quadrant: quadrantOf(row),
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    dueAt: row.dueAt,
    description: row.description ?? '',
    priority: (row.priority as TaskView['priority']) ?? 'medium',
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    completionQuality: row.completionQuality ?? null,
    attentionPeak: row.attentionPeak ?? null,
    taskDate: row.taskDate ?? null,
    repeat: (row.repeat as TaskRepeat) ?? 'none',
    sourceDailyId: row.sourceDailyId ?? null,
  };
}

/**
 * 按日期返回看板任务：筛选 task_date = date（或遗留未设日期的浮动任务）且非每日例行模板，
 * 排序按重要程度降序、同重要时按时间（计划开始时间，无则创建时间）升序。
 */
export function listForDate(date: string): TaskView[] {
  const rows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.repeat, 'none'), or(eq(tasks.taskDate, date), isNull(tasks.taskDate))))
    .orderBy(desc(tasks.importance), asc(sql`coalesce(${tasks.scheduledStart}, ${tasks.createdAt})`))
    .all();
  return (rows as TaskRow[]).map(rowToView);
}

/** 今日看板（默认归为当天），兼容旧调用 */
export function listToday(): TaskView[] {
  return listForDate(todayStr());
}

/** 日历等场景：返回全部任务（含描述/优先级），按 scheduledStart 升序。 */
export function listAll(): TaskView[] {
  const rows = db.select().from(tasks).orderBy(asc(tasks.scheduledStart), asc(tasks.createdAt)).all();
  return (rows as TaskRow[]).map(rowToView);
}

export function getTask(id: string): TaskView | null {
  const row = db.select().from(tasks).where(eq(tasks.id, id)).get() as TaskRow | undefined;
  return row ? rowToView(row) : null;
}

export function insertTask(
  p: { id: string } & CreateTaskInput & { now: string; taskDate?: string | null; repeat?: TaskRepeat; sourceDailyId?: string | null },
): void {
  db.insert(tasks)
    .values({
      id: p.id,
      title: p.title,
      domainKey: p.domainKey,
      projectId: p.projectId ?? null,
      importance: p.importance,
      urgency: p.urgency,
      isMit: p.isMit,
      mitOrder: p.mitOrder ?? null,
      status: 'todo',
      scheduledStart: p.scheduledStart ?? null,
      scheduledEnd: p.scheduledEnd ?? null,
      dueAt: p.dueAt ?? null,
      description: p.description ?? '',
      priority: p.priority ?? 'medium',
      taskDate: p.taskDate ?? null,
      repeat: p.repeat ?? 'none',
      sourceDailyId: p.sourceDailyId ?? null,
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}

/** 每日例行模板（repeat='daily'） */
export function listDailyTemplates(): TaskRow[] {
  return db.select().from(tasks).where(eq(tasks.repeat, 'daily')).all() as TaskRow[];
}

/** 某模板在某日期是否已实例化 */
export function hasInstance(sourceDailyId: string, date: string): boolean {
  const row = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.sourceDailyId, sourceDailyId), eq(tasks.taskDate, date)))
    .get();
  return Boolean(row);
}

export function markComplete(
  id: string,
  completedAt: string,
  completionQuality: number | null,
  attentionPeak: number | null,
): void {
  db.update(tasks)
    .set({ status: 'done', completedAt, completionQuality, attentionPeak, updatedAt: completedAt })
    .where(eq(tasks.id, id))
    .run();
}

/** 取消完成：状态回退为 todo，清空完成时间/质量/注意力峰值（未完成任务不带这些指标）。 */
export function markIncomplete(id: string): void {
  const now = new Date().toISOString();
  db.update(tasks)
    .set({ status: 'todo', completedAt: null, completionQuality: null, attentionPeak: null, updatedAt: now })
    .where(eq(tasks.id, id))
    .run();
}

export function updateQuadrant(id: string, importance: boolean, urgency: boolean): void {
  db.update(tasks)
    .set({ importance, urgency, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .run();
}

export function updateSchedule(id: string, scheduledStart: string, scheduledEnd: string): void {
  db.update(tasks)
    .set({ scheduledStart, scheduledEnd, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .run();
}

export function updateMit(id: string, isMit: boolean, mitOrder: number | null): void {
  db.update(tasks)
    .set({ isMit, mitOrder, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .run();
}

/** 编辑任务：仅更新显式传入（非 undefined）的字段，其余保持原值。 */
export function updateTaskFields(
  id: string,
  fields: {
    title?: string;
    domainKey?: string;
    projectId?: string | null;
    importance?: boolean;
    urgency?: boolean;
    dueAt?: string | null;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    description?: string | null;
    priority?: 'low' | 'medium' | 'high';
    status?: 'todo' | 'doing' | 'done' | 'archived';
  },
): void {
  const now = new Date().toISOString();
  const set: Record<string, unknown> = { updatedAt: now };
  if (fields.title !== undefined) set.title = fields.title;
  if (fields.domainKey !== undefined) set.domainKey = fields.domainKey;
  if (fields.projectId !== undefined) set.projectId = fields.projectId;
  if (fields.importance !== undefined) set.importance = fields.importance;
  if (fields.urgency !== undefined) set.urgency = fields.urgency;
  if (fields.dueAt !== undefined) set.dueAt = fields.dueAt;
  if (fields.scheduledStart !== undefined) set.scheduledStart = fields.scheduledStart;
  if (fields.scheduledEnd !== undefined) set.scheduledEnd = fields.scheduledEnd;
  if (fields.description !== undefined) set.description = fields.description;
  if (fields.priority !== undefined) set.priority = fields.priority;
  if (fields.status !== undefined) set.status = fields.status;
  db.update(tasks).set(set).where(eq(tasks.id, id)).run();
}

export function deleteTask(id: string): void {
  db.delete(tasks).where(eq(tasks.id, id)).run();
}
