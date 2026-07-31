import { db } from '../../db/client';
import { focusSessions, domains, projects } from '../../db/schema';
import { gte, eq } from 'drizzle-orm';
import type {
  FocusSessionView,
  FlowSummaryQuery,
} from '@dm-life/shared';

export interface InsertSessionInput {
  id: string;
  taskId: string | null;
  domainKey: string | null;
  projectId: string | null;
  attentionType: 'deep' | 'shallow' | 'passive' | 'recovery';
  startedAt: string;
  endedAt: string;
  score: number | null;
  energyStart: number | null;
  energyEnd: number | null;
  interruptions: string; // JSON
  note: string | null;
  now: string;
}

function parseInterruptions(v: string | null): Array<{ at: string; kind: 'internal' | 'external' | null; reason?: string }> {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function insertSession(p: InsertSessionInput): void {
  db.insert(focusSessions)
    .values({
      id: p.id,
      taskId: p.taskId,
      domainKey: p.domainKey,
      projectId: p.projectId,
      attentionType: p.attentionType,
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      score: p.score,
      energyStart: p.energyStart,
      energyEnd: p.energyEnd,
      interruptions: p.interruptions,
      note: p.note,
      createdAt: p.now,
    })
    .run();
}

interface SessionRow {
  id: string;
  taskId: string | null;
  domainKey: string | null;
  projectId: string | null;
  attentionType: string;
  startedAt: string;
  endedAt: string;
  score: number | null;
  energyStart: number | null;
  energyEnd: number | null;
  interruptions: string | null;
  note: string | null;
}

export function listSessions(limit = 50): FocusSessionView[] {
  const rows = db
    .select()
    .from(focusSessions)
    .orderBy(focusSessions.startedAt)
    .limit(limit)
    .all() as SessionRow[];
  return rows
    .reverse()
    .map((r) => ({
      id: r.id,
      taskId: r.taskId,
      domainKey: r.domainKey,
      projectId: r.projectId,
      attentionType: r.attentionType as FocusSessionView['attentionType'],
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      score: r.score,
      energyStart: r.energyStart,
      energyEnd: r.energyEnd,
      interruptions: parseInterruptions(r.interruptions),
      note: r.note,
    }));
}

/**
 * 某任务绑定的专注时段中的最高评分（注意力峰值）。无评分记录返回 null。
 * 只读，供 tasks.completeTask 回写注意力峰值使用。
 */
export function getPeakScoreForTask(taskId: string): number | null {
  const rows = db
    .select({ score: focusSessions.score })
    .from(focusSessions)
    .where(eq(focusSessions.taskId, taskId))
    .all() as Array<{ score: number | null }>;
  let peak: number | null = null;
  for (const r of rows) {
    if (r.score != null && (peak == null || r.score > peak)) peak = r.score;
  }
  return peak;
}

function dayKey(iso: string): string {
  // 本地日期 YYYY-MM-DD
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hourOf(iso: string): number {
  return new Date(iso).getHours();
}
function durationH(isoStart: string, isoEnd: string): number {
  const ms = new Date(isoEnd).getTime() - new Date(isoStart).getTime();
  return Math.max(0, ms / 3_600_000);
}

export interface FlowSummary {
  range: 'week' | 'month';
  axis: 'domain' | 'project';
  cols: { key: string; label: string }[];
  rows: {
    key: string;
    name: string;
    color?: string;
    cells: Record<string, { score: number | null; count: number; deepRatio: number; hours: number }>;
  }[];
  energySeries: { t: string; energy: number | null }[];
  attentionSeries: { t: string; score: number | null }[];
  insights: {
    goldenHour: number | null;
    topDomains: { key: string; name: string; avg: number; count: number }[];
    pseudoWork: { key: string; name: string; hours: number; avgScore: number }[];
    totalSessions: number;
    skipped: number;
    avgScore: number | null;
    avgEnergyEnd: number | null;
  };
  lowAttentionAlerts: string[];
}

export function summarize(q: FlowSummaryQuery): FlowSummary {
  const days = q.range === 'week' ? 7 : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = db
    .select()
    .from(focusSessions)
    .where(gte(focusSessions.startedAt, since))
    .all() as SessionRow[];

  // 维度行（领域 / 项目）+ 名称/颜色映射
  const axisRows =
    q.axis === 'domain'
      ? (db.select().from(domains).all() as Array<{ key: string; name: string; color: string }>)
      : (db
          .select()
          .from(projects)
          .all() as Array<{ id: string; name: string; color?: string }>);
  const nameOf = new Map<string, string>();
  const colorOf = new Map<string, string>();
  for (const r of axisRows) {
    const k = q.axis === 'domain' ? (r as any).key : (r as any).id;
    nameOf.set(k, (r as any).name);
    if ((r as any).color) colorOf.set(k, (r as any).color);
  }

  // 列：小时模式 = 0..23；天模式 = 区间内每天
  let cols: { key: string; label: string }[];
  if (q.unit === 'hour') {
    cols = Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: `${String(h).padStart(2, '0')}` }));
  } else {
    cols = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      cols.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}` });
    }
  }

  // 初始化行
  const rowDefs = new Map<string, { name: string; color?: string }>();
  for (const r of axisRows) {
    const k = q.axis === 'domain' ? (r as any).key : (r as any).id;
    rowDefs.set(k, { name: (r as any).name, color: (r as any).color });
  }
  rowDefs.set('__none', { name: '未分类' });

  const cellMap = new Map<string, Record<string, { score: number | null; count: number; deepRatio: number; hours: number }>>();
  for (const [k, def] of rowDefs) {
    const cells: Record<string, { score: number | null; count: number; deepRatio: number; hours: number }> = {};
    for (const c of cols) cells[c.key] = { score: null, count: 0, deepRatio: 0, hours: 0 };
    cellMap.set(k, cells);
  }

  // 能量 / 注意力 日序列
  const energyByDay = new Map<string, number[]>();
  const scoreByDay = new Map<string, number[]>();

  // 洞察累加
  const hourScoreSum = new Map<number, { sum: number; n: number }>();
  const domainAgg = new Map<string, { sum: number; n: number; hours: number; interrupts: number }>();
  let totalSessions = 0;
  let skipped = 0;
  let scoreSum = 0;
  let scoreN = 0;
  let energyEndSum = 0;
  let energyEndN = 0;

  for (const r of rows) {
    totalSessions += 1;
    const score = r.score == null ? null : Number(r.score);
    if (score == null) skipped += 1;
    if (score != null) {
      scoreSum += score;
      scoreN += 1;
    }
    if (r.energyEnd != null) {
      energyEndSum += Number(r.energyEnd);
      energyEndN += 1;
    }
    const interrupts = parseInterruptions(r.interruptions).length;

    const rowKey = (q.axis === 'domain' ? r.domainKey : r.projectId) ?? '__none';
    if (!cellMap.has(rowKey)) {
      cellMap.set(rowKey, (() => {
        const cells: Record<string, { score: number | null; count: number; deepRatio: number; hours: number }> = {};
        for (const c of cols) cells[c.key] = { score: null, count: 0, deepRatio: 0, hours: 0 };
        return cells;
      })());
      rowDefs.set(rowKey, { name: nameOf.get(rowKey) ?? rowKey });
    }
    const colKey = q.unit === 'hour' ? String(hourOf(r.startedAt)) : dayKey(r.startedAt);
    const cell = cellMap.get(rowKey)![colKey];
    if (cell) {
      cell.count += 1;
      cell.hours += durationH(r.startedAt, r.endedAt);
      if (score != null) {
        cell.score = (cell.score == null ? 0 : cell.score) + score; // 暂存和
      }
      if (r.attentionType === 'deep') cell.deepRatio += 1;
    }

    // 能量/注意力日序列
    const dk = dayKey(r.startedAt);
    if (r.energyEnd != null) {
      if (!energyByDay.has(dk)) energyByDay.set(dk, []);
      energyByDay.get(dk)!.push(Number(r.energyEnd));
    }
    if (score != null) {
      if (!scoreByDay.has(dk)) scoreByDay.set(dk, []);
      scoreByDay.get(dk)!.push(score);
    }

    // 洞察
    const h = hourOf(r.startedAt);
    if (score != null) {
      const cur = hourScoreSum.get(h) ?? { sum: 0, n: 0 };
      cur.sum += score;
      cur.n += 1;
      hourScoreSum.set(h, cur);
    }
    if (r.domainKey) {
      const agg = domainAgg.get(r.domainKey) ?? { sum: 0, n: 0, hours: 0, interrupts: 0 };
      if (score != null) agg.sum += score;
      if (score != null) agg.n += 1;
      agg.hours += durationH(r.startedAt, r.endedAt);
      agg.interrupts += interrupts;
      domainAgg.set(r.domainKey, agg);
    }
  }

  // 归一化 cell.score → 均值；并过滤掉完全无数据的行
  const outRows = Array.from(cellMap.entries())
    .map(([k, cells]) => {
      const normCells: Record<string, { score: number | null; count: number; deepRatio: number; hours: number }> = {};
      let total = 0;
      for (const [ck, c] of Object.entries(cells)) {
        const avg = c.count > 0 && c.score != null ? Number((c.score / c.count).toFixed(2)) : null;
        normCells[ck] = {
          score: avg,
          count: c.count,
          deepRatio: c.count > 0 ? Number((c.deepRatio / c.count).toFixed(2)) : 0,
          hours: Number(c.hours.toFixed(2)),
        };
        total += c.count;
      }
      return { key: k, name: rowDefs.get(k)?.name ?? k, color: rowDefs.get(k)?.color, cells: normCells, total };
    })
    .filter((r) => r.total > 0)
    .map(({ total: _t, ...rest }) => rest);

  // 日序列输出（按日期排序）
  const energySeries = Array.from(energyByDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, arr]) => ({ t, energy: Number((arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(2)) }));
  const attentionSeries = Array.from(scoreByDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, arr]) => ({ t, score: Number((arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(2)) }));

  // 洞察
  let goldenHour: number | null = null;
  let goldenBest = -1;
  for (const [h, v] of hourScoreSum) {
    if (v.n >= 2 && v.sum / v.n > goldenBest) {
      goldenBest = v.sum / v.n;
      goldenHour = h;
    }
  }

  const topDomains = Array.from(domainAgg.entries())
    .map(([k, v]) => ({ key: k, name: nameOf.get(k) ?? k, avg: v.n > 0 ? Number((v.sum / v.n).toFixed(2)) : 0, count: v.n }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3);

  // 伪工作：投入时长高(>2h) 但平均评分低(<3)
  const pseudoWork = Array.from(domainAgg.entries())
    .filter(([, v]) => v.hours >= 2 && v.n > 0 && v.sum / v.n < 3)
    .map(([k, v]) => ({ key: k, name: nameOf.get(k) ?? k, hours: Number(v.hours.toFixed(1)), avgScore: Number((v.sum / v.n).toFixed(2)) }))
    .sort((a, b) => b.hours - a.hours);

  // 低压强提醒（压力背包联动）：持续低评分 + 高频中断的领域
  const lowAttentionAlerts: string[] = [];
  for (const [k, v] of domainAgg) {
    const avg = v.n > 0 ? v.sum / v.n : 5;
    if (v.n >= 3 && avg < 3 && v.interrupts >= 2) {
      lowAttentionAlerts.push(`你对「${nameOf.get(k) ?? k}」的投入度下降（平均评分 ${avg.toFixed(1)}、中断 ${v.interrupts} 次），是失去兴趣还是阻力过大？`);
    }
  }

  return {
    range: q.range,
    axis: q.axis,
    cols,
    rows: outRows,
    energySeries,
    attentionSeries,
    insights: {
      goldenHour,
      topDomains,
      pseudoWork,
      totalSessions,
      skipped,
      avgScore: scoreN > 0 ? Number((scoreSum / scoreN).toFixed(2)) : null,
      avgEnergyEnd: energyEndN > 0 ? Number((energyEndSum / energyEndN).toFixed(2)) : null,
    },
    lowAttentionAlerts,
  };
}
