import { db } from '../../db/client';
import { tasks, debts, reminderClocks } from '../../db/schema';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { todayStr } from '../tasks/repository';

/**
 * 每日回顾卡片：基于指定日期的任务做轻量聚合，不依赖向量检索。
 * 统计严格按日期区分：只计入 task_date = date（或遗留未设日期且当天）且非每日例行模板的任务，
 * 不得把其他日期的任务计入当日统计。
 */
export function dailyCard(date?: string): {
  total: number;
  done: number;
  mitCount: number;
  domainCounts: Record<string, number>;
} {
  const target = date ?? todayStr();
  const isToday = target === todayStr();

  const rows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.repeat, 'none'), or(eq(tasks.taskDate, target), isNull(tasks.taskDate))))
    .all() as unknown as Array<{ domain_key: string; status: string; is_mit: number; task_date: string | null }>;

  // 遗留未设日期的浮动任务仅在「所选日期 = 今日」时计入，避免污染其他日期的统计
  const scoped = rows.filter((r) => r.task_date !== null || isToday);

  const domainCounts: Record<string, number> = {};
  let done = 0;
  let mitCount = 0;
  for (const r of scoped) {
    domainCounts[r.domain_key] = (domainCounts[r.domain_key] ?? 0) + 1;
    if (r.status === 'done') done += 1;
    if (r.is_mit) mitCount += 1;
  }

  return { total: scoped.length, done, mitCount, domainCounts };
}

/**
 * 压力背包（P1）：跨表聚合三类「进行中 / 逾期未处理」负荷，
 * 加权成 0-100 压力指数并给等级标签，供右栏可视化。
 *
 * 数据源（只读聚合，不写事件）：
 * - 逾期提醒钟：reminder_clocks.status = 'overdue'
 * - 超期任务：tasks.status != 'done' 且 due_at < now
 * - 活跃债务：debts.status = 'active'（持续压力源）
 *
 * 权重设计：逾期提醒最紧急（×15）、超期任务（×10）、活跃债务（×5）。
 */
export function pressureBackpack(): {
  score: number;
  level: 'calm' | 'mild' | 'tense' | 'overloaded';
  breakdown: {
    overdueReminders: number;
    overdueTasks: number;
    activeDebts: number;
  };
} {
  const now = new Date().toISOString();

  const overdueReminders = db
    .select({ c: sql<number>`count(*)` })
    .from(reminderClocks)
    .where(eq(reminderClocks.status, 'overdue'))
    .get()?.c ?? 0;

  const overdueTasks = db
    .select({ c: sql<number>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.status, 'todo'), lt(tasks.dueAt, now)))
    .get()?.c ?? 0;

  const activeDebts = db
    .select({ c: sql<number>`count(*)` })
    .from(debts)
    .where(eq(debts.status, 'active'))
    .get()?.c ?? 0;

  const raw = overdueReminders * 15 + overdueTasks * 10 + activeDebts * 5;
  const score = Math.min(100, raw);

  let level: 'calm' | 'mild' | 'tense' | 'overloaded' = 'calm';
  if (score >= 70) level = 'overloaded';
  else if (score >= 40) level = 'tense';
  else if (score > 0) level = 'mild';

  return {
    score,
    level,
    breakdown: {
      overdueReminders: Number(overdueReminders),
      overdueTasks: Number(overdueTasks),
      activeDebts: Number(activeDebts),
    },
  };
}
