import { db } from '../../db/client';
import { domains, tasks, focusSessions } from '../../db/schema';
import type { DomainView, DomainSummary, DomainBalanceWheel } from '@dm-life/shared';

type DomainRow = typeof domains.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type FocusRow = typeof focusSessions.$inferSelect;

function rowToView(row: DomainRow): DomainView {
  return {
    key: row.key,
    name: row.name,
    isQuarterFocus: !!row.isQuarterFocus,
    color: row.color,
  };
}

export function list(): DomainView[] {
  const rows = db.select().from(domains).all() as DomainRow[];
  return rows.map(rowToView);
}

/**
 * 每领域聚合：任务总数 / 已完成 / 进行中 + 累计专注分钟（来自 focus_sessions，全量）+ 完成率。
 * 纯只读，不走写事务。
 */
export function summary(): DomainSummary[] {
  const all = list();
  const taskRows = db.select().from(tasks).all() as TaskRow[];
  const focusRows = db.select().from(focusSessions).all() as FocusRow[];

  const taskAgg = new Map<string, { total: number; done: number; active: number }>();
  for (const t of taskRows) {
    const a = taskAgg.get(t.domainKey) ?? { total: 0, done: 0, active: 0 };
    a.total += 1;
    if (t.status === 'done') a.done += 1;
    else if (t.status === 'todo' || t.status === 'doing') a.active += 1;
    taskAgg.set(t.domainKey, a);
  }

  const focusAgg = new Map<string, number>();
  for (const f of focusRows) {
    if (!f.domainKey || !f.startedAt || !f.endedAt) continue;
    const ms = new Date(f.endedAt).getTime() - new Date(f.startedAt).getTime();
    if (ms <= 0) continue;
    focusAgg.set(f.domainKey, (focusAgg.get(f.domainKey) ?? 0) + Math.round(ms / 60000));
  }

  return all.map((d) => {
    const a = taskAgg.get(d.key) ?? { total: 0, done: 0, active: 0 };
    const focusMinutes = focusAgg.get(d.key) ?? 0;
    const doneRate = a.total > 0 ? a.done / a.total : 0;
    return {
      key: d.key,
      name: d.name,
      color: d.color,
      isQuarterFocus: !!d.isQuarterFocus,
      taskTotal: a.total,
      taskDone: a.done,
      taskActive: a.active,
      focusMinutes,
      doneRate,
    };
  });
}

/**
 * 解析「周」窗口：week 为周一日期 YYYY-MM-DD，返回 [周一 00:00 UTC, 下周一 00:00 UTC)。
 * 非法格式直接抛错（边界/异常场景由调用方或 router 的 Zod 拦截）。
 */
export function getWeekWindow(week: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    throw new Error(`无效的 week 参数: ${week}（应为 YYYY-MM-DD）`);
  }
  const d = new Date(week + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) {
    throw new Error(`无效的 week 参数: ${week}（日期无法解析）`);
  }
  const start = d.toISOString();
  const end = new Date(d.getTime() + 7 * 86400000).toISOString();
  return { start, end };
}

/**
 * 平衡轮聚合：以「该周（周一~周日）内各领域的真实专注投入时长」为权重，
 * 输出每领域分钟数、相对最大领域的归一化得分（0-100），以及开放任务最多的压力代理领域。
 * 此前为 stub（全 0）；现接入 focus_sessions 真实数据，无需改表。
 */
export function balanceWheel(week: string): DomainBalanceWheel {
  const { start, end } = getWeekWindow(week);
  const all = list();

  const focusRows = db.select().from(focusSessions).all() as FocusRow[];
  const minutes = new Map<string, number>();
  for (const f of focusRows) {
    if (!f.domainKey || !f.startedAt || !f.endedAt) continue;
    // 仅计入窗口内（ISO 字符串字典序 = 时间序）
    if (f.startedAt < start || f.startedAt >= end) continue;
    const ms = new Date(f.endedAt).getTime() - new Date(f.startedAt).getTime();
    if (ms <= 0) continue;
    minutes.set(f.domainKey, (minutes.get(f.domainKey) ?? 0) + Math.round(ms / 60000));
  }

  const domainMinutes: Record<string, number> = {};
  let max = 0;
  for (const d of all) {
    const m = minutes.get(d.key) ?? 0;
    domainMinutes[d.key] = m;
    if (m > max) max = m;
  }

  const wheel = all.map((d) => {
    const m = minutes.get(d.key) ?? 0;
    return {
      key: d.key,
      name: d.name,
      color: d.color,
      minutes: m,
      score: max > 0 ? Math.round((m / max) * 100) : 0,
    };
  });

  // 压力代理：开放任务（todo+doing）数最多的领域，取前 3
  const taskRows = db.select().from(tasks).all() as TaskRow[];
  const open = new Map<string, number>();
  for (const t of taskRows) {
    if (t.status === 'todo' || t.status === 'doing') {
      open.set(t.domainKey, (open.get(t.domainKey) ?? 0) + 1);
    }
  }
  const topStresses = [...open.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  return { week, wheel, domainMinutes, topStresses };
}
