import { useMemo, useState } from 'react';
import { trpcLocal as trpc } from '../../lib/trpcLocal';
import { cn } from '../../lib/cn';
import type { TaskView, TaskPriority } from '@dm-life/shared';
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  Circle,
  CheckCircle2,
  Clock,
  Inbox,
  ArrowUpDown,
} from 'lucide-react';

/** 周一为一周起点（符合国内习惯） */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL: Record<TaskPriority, string> = { high: '高', medium: '中', low: '低' };
const STATUS_LABEL: Record<string, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  archived: '已归档',
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  high: 'bg-rose-400',
  medium: 'bg-amber-400',
  low: 'bg-sky-400',
};

const STATUS_BADGE: Record<string, string> = {
  todo: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  doing: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  done: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  archived: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

/** 任务归属日期：优先 scheduledStart，回退 dueAt。无日期则日历不展示。 */
function taskDate(t: TaskView): string | null {
  return t.scheduledStart?.slice(0, 10) ?? t.dueAt?.slice(0, 10) ?? null;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 生成覆盖整月的 6×7 日期网格（周一为起点），含上月/下月的溢出格。 */
function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 把周日(0)转成周一(0)
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

export function CalendarPage() {
  const { data: tasks = [] } = trpc.tasks.all.useQuery(undefined);
  const now = new Date();
  const todayStr = ymd(now);

  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selected, setSelected] = useState<string | null>(todayStr);
  const [statusFilter, setStatusFilter] = useState<'all' | 'todo' | 'doing' | 'done'>('all');
  const [priorityHighFirst, setPriorityHighFirst] = useState(true);

  // 按日期分组（只保留有日期的任务）
  const byDate = useMemo(() => {
    const map = new Map<string, TaskView[]>();
    for (const t of tasks) {
      const d = taskDate(t);
      if (!d) continue;
      const arr = map.get(d);
      if (arr) arr.push(t);
      else map.set(d, [t]);
    }
    // 桶内先按优先级，再按开始时间
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (p !== 0) return p;
        return (a.scheduledStart ?? '').localeCompare(b.scheduledStart ?? '');
      });
    }
    return map;
  }, [tasks]);

  const cells = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
  const maxCount = useMemo(
    () => Math.max(1, ...[...byDate.values()].map((a) => a.length)),
    [byDate],
  );

  // 选中日详情（排序 + 状态过滤）
  const dayRaw = selected ? byDate.get(selected) ?? [] : [];
  const dayTasks = useMemo(() => {
    let arr = dayRaw;
    if (statusFilter !== 'all') arr = arr.filter((t) => t.status === statusFilter);
    return [...arr].sort((a, b) => {
      const p = (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) * (priorityHighFirst ? 1 : -1);
      if (p !== 0) return p;
      return (a.scheduledStart ?? '').localeCompare(b.scheduledStart ?? '');
    });
  }, [dayRaw, statusFilter, priorityHighFirst]);

  const monthLabel = `${cursor.year} 年 ${cursor.month + 1} 月`;
  const selectedLabel = selected
    ? `${selected.slice(0, 4)} 年 ${Number(selected.slice(5, 7))} 月 ${Number(selected.slice(8, 10))} 日`
    : '未选择日期';

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 lg:flex-row">
      {/* 月历主体 */}
      <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-bg-border bg-bg-panel p-4">
        {/* 导航栏 */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-100">{monthLabel}</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-bg-border bg-bg-raised text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
              title="上个月"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
              className="rounded-lg border border-bg-border bg-bg-raised px-3 py-1 text-xs text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
            >
              今天
            </button>
            <button
              onClick={() => setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-bg-border bg-bg-raised text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
              title="下个月"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* 星期表头 */}
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-gray-500">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={cn(i >= 5 && 'text-rose-400/70')}>
              {w}
            </div>
          ))}
        </div>

        {/* 日期网格 */}
        <div className="grid flex-1 grid-cols-7 gap-1">
          {cells.map((d) => {
            const key = ymd(d);
            const inMonth = d.getMonth() === cursor.month;
            const bucket = byDate.get(key);
            const count = bucket?.length ?? 0;
            const isToday = key === todayStr;
            const isSelected = key === selected;
            const hasHigh = bucket?.some((t) => t.priority === 'high');
            const heat = count / maxCount; // 0..1 任务密度

            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={cn(
                  'group relative flex min-h-[78px] flex-col rounded-xl border p-1.5 text-left transition-all duration-200',
                  inMonth ? 'border-bg-border bg-bg-raised/40' : 'border-transparent bg-bg-raised/10',
                  isSelected
                    ? 'border-accent ring-2 ring-accent/40'
                    : count > 0
                      ? 'border-accent/30 hover:border-accent/60'
                      : 'hover:border-bg-border',
                )}
                style={
                  count > 0 && !isSelected
                    ? { backgroundColor: `rgba(139, 92, 246, ${0.06 + 0.22 * heat})` }
                    : undefined
                }
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'text-xs font-medium',
                      !inMonth ? 'text-gray-600' : isToday ? 'text-accent' : 'text-gray-300',
                    )}
                  >
                    {d.getDate()}
                  </span>
                  {isToday && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </div>

                {count > 0 && (
                  <div className="mt-auto">
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                          hasHigh ? 'bg-rose-500/20 text-rose-300' : 'bg-accent/20 text-accent',
                        )}
                      >
                        {count} 项
                      </span>
                      {hasHigh && <Flag size={11} className="text-rose-400" />}
                    </div>
                    {/* 优先级分布小点 */}
                    <div className="mt-1 flex gap-0.5">
                      {bucket!.slice(0, 4).map((t) => (
                        <span key={t.id} className={cn('h-1 w-1 rounded-full', PRIORITY_DOT[t.priority])} />
                      ))}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* 图例 */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-400" /> 高优先级
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> 中
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-sky-400" /> 低
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> 今天
          </span>
          <span>背景越深 = 当日任务越多</span>
        </div>
      </section>

      {/* 详情面板 */}
      <aside className="flex w-full shrink-0 flex-col rounded-2xl border border-bg-border bg-bg-panel p-4 lg:w-[360px]">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{selectedLabel}</h3>
            <p className="text-xs text-gray-500">{dayTasks.length} 个任务</p>
          </div>
          <button
            onClick={() => setPriorityHighFirst((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-bg-border bg-bg-raised px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
            title="按优先级排序"
          >
            <ArrowUpDown size={12} />
            {priorityHighFirst ? '高→低' : '低→高'}
          </button>
        </div>

        {/* 状态过滤 */}
        <div className="mb-3 flex flex-wrap gap-1">
          {(['all', 'todo', 'doing', 'done'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                statusFilter === s
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-bg-border bg-bg-raised/40 text-gray-400 hover:text-gray-200',
              )}
            >
              {s === 'all' ? '全部' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {/* 任务列表 */}
        <div className="flex-1 space-y-2 overflow-auto pr-1">
          {dayTasks.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-600">
              <Inbox size={28} />
              <p className="text-xs">{statusFilter === 'all' ? '这一天没有任务' : '该状态下没有任务'}</p>
            </div>
          ) : (
            dayTasks.map((t) => <TaskCard key={t.id} task={t} />)
          )}
        </div>
      </aside>
    </div>
  );
}

function TaskCard({ task }: { task: TaskView }) {
  const StatusIcon =
    task.status === 'done' ? CheckCircle2 : task.status === 'doing' ? Clock : Circle;

  return (
    <div className="rounded-xl border border-bg-border bg-bg-raised/50 p-3 transition-all duration-200 hover:border-accent/40 hover:bg-bg-raised">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-100">{task.title}</span>
        <span
          className={cn(
            'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
            STATUS_BADGE[task.status] ?? STATUS_BADGE.todo,
          )}
        >
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>

      {task.description && (
        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-gray-400">{task.description}</p>
      )}

      <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
        <span className={cn('flex items-center gap-1', task.priority === 'high' && 'text-rose-300')}>
          <Flag size={11} className={PRIORITY_DOT[task.priority].replace('bg-', 'text-')} />
          {PRIORITY_LABEL[task.priority]}优先级
        </span>
        {task.scheduledStart && (
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {task.scheduledStart.slice(11, 16)}
          </span>
        )}
        <StatusIcon size={11} className="ml-auto" />
      </div>
    </div>
  );
}
