import { Plus, Flame } from 'lucide-react';
import { trpc } from '../../lib/trpcLocal';
import { useUI } from '../../store/uiStore';
import { TaskCard } from './TaskCard';
import { TimeRail } from './TimeRail';
import { FloatingIcon } from '../../components/FloatingIcon';

export function LeftColumn() {
  const boardDate = useUI((s) => s.boardDate);
  const { data: tasks = [] } = trpc.tasks.today.useQuery({ date: boardDate });
  const { data: domains = [] } = trpc.domains.list.useQuery(undefined);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const activeDomain = useUI((s) => s.activeDomain);
  const toggleDomain = useUI((s) => s.toggleDomain);

  // MIT 列不随「8+1 领域」筛选：领域筛选只作用于四象限（见 CenterColumn），
  // 否则选定领域后新建的其它领域任务会在 MIT/时间块里“消失”，误以为没添加成功。
  const mits = tasks
    .filter((t: any) => t.isMit)
    .sort((a: any, b: any) => (a.mitOrder ?? 99) - (b.mitOrder ?? 99));
  const colorOf = (k: string) => domains.find((d: any) => d.key === k)?.color;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="relative overflow-hidden rounded-xl border border-accent/40 bg-gradient-to-b from-accent/[0.14] to-bg-panel p-3 shadow-[0_0_0_1px_rgba(91,140,255,0.12),0_10px_30px_-12px_rgba(91,140,255,0.5)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-accent to-transparent" />
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-accent">
            <Flame size={15} className="text-accent" />
            今日最重要
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">MIT</span>
          </h2>
          <button onClick={() => setOpen(true)} className="transition-transform hover:scale-110" title="添加">
            <FloatingIcon icon={<Plus size={16} />} tone="emerald" size="sm" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {mits.length === 0 && <p className="text-xs text-gray-400">点卡片上的☆设为 MIT（最多 3 件）</p>}
          {mits.length > 0 && (
            <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto pr-1">
              {mits.map((t: any) => (
                <TaskCard key={t.id} task={t} color={colorOf(t.domainKey)} scope="mit" accentBorder />
              ))}
            </div>
          )}
        </div>
        {mits.length > 0 && <p className="mt-2 text-[11px] text-gray-400">聚焦 1–3 件，今天就赢一半 ✦</p>}
      </div>

      <div className="rounded-xl border border-bg-border bg-bg-panel p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">8+1 领域</h2>
          {activeDomain && (
            <button
              onClick={() => toggleDomain(activeDomain)}
              className="text-[10px] text-gray-400 hover:text-accent"
              title="清除筛选"
            >
              清除
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-y-2">
          {domains.map((d: any) => {
            const active = activeDomain === d.key;
            return (
              <button
                key={d.key}
                onClick={() => toggleDomain(d.key)}
                className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition ${
                  active ? 'bg-accent/20 text-accent' : 'text-gray-300 hover:bg-bg-soft'
                }`}
                title={active ? '点击取消筛选' : `仅看「${d.name}」`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                {d.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <TimeRail />
      </div>
    </div>
  );
}
