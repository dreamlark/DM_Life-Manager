import { useDroppable } from '@dnd-kit/core';
import { trpc } from '../../lib/trpcLocal';
import { useUI } from '../../store/uiStore';
import { TaskCard } from './TaskCard';
import { hourOfScheduled } from '@dm-life/shared';
import type { TaskView } from '@dm-life/shared';

// 时间块覆盖的小时范围（08:00 - 22:00），每个小时是一个可拖入的落点
const HOURS = Array.from({ length: 15 }, (_, i) => i + 8);

function TimeSlot({
  hour,
  tasks,
  colorOf,
}: {
  hour: number;
  tasks: TaskView[];
  colorOf: (k: string) => string | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${hour}` });
  return (
    <div
      ref={setNodeRef}
      data-hour={hour}
      className={`flex shrink-0 flex-col gap-1 rounded-lg border p-1 transition ${
        isOver ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-bg-border bg-bg-base/60'
      }`}
    >
      <div className="px-0.5 text-[10px] font-medium text-gray-500">{String(hour).padStart(2, '0')}:00</div>
      {tasks.length === 0 ? (
        <div className="m-auto text-[10px] text-gray-600">+</div>
      ) : (
        tasks.map((t) => <TaskCard key={t.id} task={t} color={colorOf(t.domainKey)} scope="slot" />)
      )}
    </div>
  );
}

/**
 * 左侧纵向时间块轨道：把一天按小时纵向铺开，任务可拖入某个整点落位到对应计划时间。
 * 与之前横向时间块同源（slot-${hour} 落点 id 不变），LocalApp 的 onDragEnd 复用同一套拖放逻辑。
 */
export function TimeRail() {
  const boardDate = useUI((s) => s.boardDate);
  const { data: tasks = [] } = trpc.tasks.today.useQuery({ date: boardDate });
  const { data: domains = [] } = trpc.domains.list.useQuery(undefined);
  const colorOf = (k: string) => domains.find((d: any) => d.key === k)?.color;
  // 时间块不随「8+1 领域」筛选：领域筛选只作用于四象限（见 CenterColumn）
  const visible = tasks;

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden rounded-xl border border-bg-border bg-bg-panel p-2">
      <div className="flex items-center gap-1 px-0.5 text-xs font-semibold text-gray-200">时间块</div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
        {HOURS.map((h) => (
          <TimeSlot
            key={h}
            hour={h}
            tasks={visible.filter((t: any) => hourOfScheduled(t.scheduledStart) === h)}
            colorOf={colorOf}
          />
        ))}
      </div>
    </div>
  );
}
