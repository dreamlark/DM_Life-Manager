import { useState } from 'react';
import { Command, Bell, Brain, Activity, BookOpen, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { trpc } from '../../lib/trpcLocal';
import { useUI } from '../../store/uiStore';
import { relTime } from '@dm-life/shared';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bg-base py-2">
      <div className="text-lg font-semibold text-gray-100">{value}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}

const LEVEL_META: Record<
  'calm' | 'mild' | 'tense' | 'overloaded',
  { label: string; bar: string; text: string }
> = {
  calm: { label: '轻松', bar: 'bg-emerald-400', text: 'text-emerald-400' },
  mild: { label: '轻度', bar: 'bg-cyan-400', text: 'text-cyan-400' },
  tense: { label: '紧张', bar: 'bg-amber-400', text: 'text-amber-400' },
  overloaded: { label: '超载', bar: 'bg-red-400', text: 'text-red-400' },
};

function PressureBackpack() {
  const { data } = trpc.insights.pressure.useQuery(undefined);
  const score = data?.score ?? 0;
  const level = (data?.level ?? 'calm') as keyof typeof LEVEL_META;
  const meta = LEVEL_META[level];
  const b = data?.breakdown;

  return (
    <div className="rounded-xl border border-bg-border bg-bg-panel px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <Activity size={16} className="text-accent" />
        <span className="text-sm text-gray-200">压力背包</span>
        <span className={`ml-auto text-xs font-medium ${meta.text}`}>{meta.label}</span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-base">
        <div
          className={`h-full rounded-full transition-all duration-500 ${meta.bar}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        <Mini label="逾期钟" value={b?.overdueReminders ?? 0} warn={(b?.overdueReminders ?? 0) > 0} />
        <Mini label="超期任务" value={b?.overdueTasks ?? 0} warn={(b?.overdueTasks ?? 0) > 0} />
        <Mini label="活跃债务" value={b?.activeDebts ?? 0} />
      </div>
    </div>
  );
}

function Mini({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-md bg-bg-base py-1">
      <div className={`text-sm font-semibold ${warn ? 'text-red-400' : 'text-gray-100'}`}>{value}</div>
      <div className="text-[9px] text-gray-500">{label}</div>
    </div>
  );
}

/** 心流低压强提醒：注意力持续偏低 + 高频中断的领域，在压力背包旁温和提示 */
function LowAttentionAlerts() {
  const { data } = trpc.flow.summary.useQuery({ range: 'week', unit: 'hour', axis: 'domain' });
  const alerts = data?.lowAttentionAlerts ?? [];
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {alerts.map((a: any, i: any) => (
        <div
          key={i}
          className="flex items-start gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/5 px-2.5 py-2 text-[11px] text-sky-200"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{a}</span>
        </div>
      ))}
    </div>
  );
}

function RelatedMemory() {
  const boardDate = useUI((s) => s.boardDate);
  const { data: today } = trpc.tasks.today.useQuery({ date: boardDate });
  const mitTitles = (today ?? [])
    .filter((t: any) => t.isMit)
    .map((t: any) => t.title)
    .join(' ');
  const [q, setQ] = useState('');
  const query = q.trim() || mitTitles;
  const { data, isLoading } = trpc.knowledge.semanticSearch.useQuery(
    { query, k: 4 },
    // tRPC v11 类型未暴露 enabled，运行期合法
    { enabled: query.length > 0 } as any,
  );
  const items = data ?? [];

  return (
    <div className="rounded-xl border border-bg-border bg-bg-panel px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <Brain size={16} className="text-accent" />
        <span className="text-sm text-gray-200">相关记忆</span>
        <span className="ml-auto text-[10px] text-gray-500">{items.length} 条相关</span>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={mitTitles ? '搜索记忆（默认按今日要事）' : '搜索记忆…'}
        className="mb-2 w-full rounded-lg border border-bg-border bg-bg-base px-2 py-1 text-[11px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-accent/50"
      />
      {query.length === 0 ? (
        <div className="text-[11px] text-gray-600">标记要事或输入关键词，这里会显示语义相关的笔记</div>
      ) : isLoading ? (
        <div className="text-[11px] text-gray-600">检索中…</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-gray-600">暂无相关笔记，先记录灵感吧</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((h: any) => (
            <li key={h.id} className="text-[11px]">
              <div className="flex items-center gap-1.5">
                <BookOpen size={11} className="shrink-0 text-gray-500" />
                <span className="truncate text-gray-300">{h.title}</span>
                <span className="ml-auto shrink-0 text-gray-500">{Math.round(h.score * 100)}%</span>
              </div>
              <div className="truncate pl-3.5 text-[10px] text-gray-600">{h.snippet}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReminderSummary() {
  const { data } = trpc.reminders.upcoming.useQuery(undefined);
  const items = data ?? [];
  const dueCount = items.filter((c: any) => c.status === 'due' || c.status === 'overdue').length;

  return (
    <div className="rounded-xl border border-bg-border bg-bg-panel px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <Bell size={16} className="text-accent" />
        <span className="text-sm text-gray-200">即将响铃</span>
        <span className="ml-auto text-[10px] text-gray-500">{items.length} 只 · 30天内</span>
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-gray-600">暂无提醒，一切安静 ✦</div>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 3).map((c: any) => (
            <li key={c.id} className="flex items-center gap-2 text-[11px]">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  c.status === 'overdue' ? 'bg-red-400' : c.status === 'due' ? 'bg-amber-300' : 'bg-gray-500'
                }`}
              />
              <span className="truncate text-gray-300">{c.title}</span>
              <span className="ml-auto shrink-0 text-gray-500">{relTime(c.nextFireAt)}</span>
            </li>
          ))}
          {dueCount > 0 && (
            <li className="flex items-center gap-1 text-[11px] text-amber-300">
              <AlertTriangle size={11} /> {dueCount} 只待处理
            </li>
          )}
          {dueCount === 0 && items.length > 0 && (
            <li className="flex items-center gap-1 text-[11px] text-emerald-400">
              <CheckCircle2 size={11} /> 均在宽限内
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function RightColumn() {
  const setOpen = useUI((s) => s.setPaletteOpen);
  const boardDate = useUI((s) => s.boardDate);
  const { data: insight } = trpc.insights.dailyCard.useQuery({ date: boardDate });

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border border-bg-border bg-bg-panel px-3 py-2.5 text-sm text-gray-300 hover:border-accent/50"
      >
        <Command size={16} /> 添加任务
        <span className="ml-auto text-xs text-gray-500">Ctrl/⌘ K</span>
      </button>

      <div className="rounded-xl border border-bg-border bg-bg-panel p-3">
        <h2 className="mb-2 text-sm font-semibold text-gray-200">今日回顾</h2>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="任务" value={insight?.total ?? 0} />
          <Stat label="完成" value={insight?.done ?? 0} />
          <Stat label="MIT" value={insight?.mitCount ?? 0} />
        </div>
      </div>

      <PressureBackpack />

      <LowAttentionAlerts />

      <ReminderSummary />

      <RelatedMemory />
    </div>
  );
}
