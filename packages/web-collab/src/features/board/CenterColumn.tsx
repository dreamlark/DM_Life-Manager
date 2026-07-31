import { useDroppable } from '@dnd-kit/core';
import { Brain } from 'lucide-react';
import { trpc } from '../../lib/trpcLocal';
import { useUI } from '../../store/uiStore';
import { TaskCard } from './TaskCard';
import { QUADRANTS } from '@dm-life/shared';
import type { TaskView } from '@dm-life/shared';

function Quadrant({
  qkey,
  title,
  hint,
  cls,
  tasks,
  colorOf,
}: {
  qkey: string;
  title: string;
  hint: string;
  cls: string;
  tasks: TaskView[];
  colorOf: (k: string) => string | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: qkey });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border bg-bg-panel p-2 transition ${cls} ${
        isOver ? 'ring-2 ring-accent' : ''
      }`}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-gray-200">{title}</span>
        <span className="text-[10px] text-gray-500">{hint}</span>
      </div>
      <div data-role="task-list" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
        {tasks.length === 0 ? (
          <div className="m-auto text-[11px] text-gray-600">拖入任务</div>
        ) : (
          tasks.map((t) => <TaskCard key={t.id} task={t} color={colorOf(t.domainKey)} />)
        )}
      </div>
    </div>
  );
}

function FocusEntryButton({ onOpenFlow }: { onOpenFlow: () => void }) {
  return (
    <button
      onClick={onOpenFlow}
      className="flex items-center gap-1 rounded-md border border-bg-border bg-bg-raised px-2 py-0.5 text-xs text-gray-200 transition hover:border-accent/50 hover:text-accent"
      title="打开心流仪表盘，开始一次专注"
    >
      <Brain size={12} /> 开始专注
    </button>
  );
}

export function CenterColumn({ onOpenFlow }: { onOpenFlow?: () => void }) {
  const boardDate = useUI((s) => s.boardDate);
  const { data: tasks = [] } = trpc.tasks.today.useQuery({ date: boardDate });
  const { data: domains = [] } = trpc.domains.list.useQuery(undefined);
  const activeDomain = useUI((s) => s.activeDomain);
  const colorOf = (k: string) => domains.find((d: any) => d.key === k)?.color;
  const inDomain = (t: TaskView) => !activeDomain || t.domainKey === activeDomain;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-sm font-semibold text-gray-200">四象限</h2>
        <span className="text-[11px] text-gray-500">按重要程度降序 · 同重要按时间排序</span>
        {onOpenFlow && <FocusEntryButton onOpenFlow={onOpenFlow} />}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3 overflow-hidden">
        {QUADRANTS.map((q) => (
          <Quadrant
            key={q.key}
            qkey={q.key}
            title={q.title}
            hint={q.hint}
            cls={q.cls}
            tasks={tasks.filter((t: any) => t.quadrant === q.key && inDomain(t))}
            colorOf={colorOf}
          />
        ))}
      </div>
    </div>
  );
}
