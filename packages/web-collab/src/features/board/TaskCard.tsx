import { useState, useRef, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical, Check, Star, Clock, Trash2, Brain } from 'lucide-react';
import { trpc } from '../../lib/trpcLocal';
import { useUI } from '../../store/uiStore';
import { useTaskShareSync } from '../shared/useTaskShareSync';
import { cn } from '../../lib/cn';
import { toLocalInput, buildScheduleTimes, DOMAIN_KEYS } from '@dm-life/shared';
import type { TaskView } from '@dm-life/shared';

export function TaskCard({
  task,
  color,
  scope,
  accentBorder,
}: {
  task: TaskView;
  color?: string;
  /** 同一任务可能同时出现在多个区域（如左栏 MIT 与四象限），用 scope 区分 draggable id，避免重复 id 导致 dnd-kit 行为异常 */
  scope?: string;
  /** MIT 卡片高亮：accent 左边框 + 微光环，强调「今日最重要」 */
  accentBorder?: boolean;
}) {
  const complete = trpc.tasks.complete.useMutation(undefined);
  const uncomplete = trpc.tasks.uncomplete.useMutation(undefined);
  const setMit = trpc.tasks.setMit.useMutation(undefined);
  const schedule = trpc.tasks.schedule.useMutation(undefined);
  const del = trpc.tasks.delete.useMutation(undefined);
  const utils = trpc.useUtils();
  const [showTime, setShowTime] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const openTaskDetail = useUI((s) => s.openTaskDetail);
  // 方向 B：个人页标记完成 → 同步回协作页（仅协作模式+已选家庭时生效，内部静默兜底）
  const syncDone = useTaskShareSync();

  const done = task.status === 'done';
  const scheduledTime = task.scheduledStart ? toLocalInput(task.scheduledStart).slice(11, 16) : '';

  const onCompleteClick = () => {
    if (done) {
      // 已完成的卡片再次点击勾选框 = 取消完成
      uncomplete.mutate(
        { id: task.id },
        {
          onSuccess: async () => {
            await utils.tasks.today.invalidate();
            await utils.insights.dailyCard.invalidate();
            await syncDone(task.id, false); // 取消完成 → 同步协作页
          },
        },
      );
      return;
    }
    if (task.isMit) {
      setShowQuality(true); // MIT：先弹星评分再完成
    } else {
      complete.mutate(
        { id: task.id },
        {
          onSuccess: async () => {
            await utils.tasks.today.invalidate();
            await utils.insights.dailyCard.invalidate();
            await syncDone(task.id, true); // 标记完成 → 同步协作页
          },
        },
      );
    }
  };

  const submitQuality = (q: number | null) => {
    complete.mutate(
      { id: task.id, quality: q ?? undefined },
      {
        onSuccess: async () => {
          await utils.tasks.today.invalidate();
          await utils.insights.dailyCard.invalidate();
          await syncDone(task.id, true); // MIT 完成 → 同步协作页
        },
      },
    );
    setShowQuality(false);
  };

  const onDelete = () => {
    if (!window.confirm(`确定删除「${task.title}」吗？此操作不可撤销。`)) return;
    del.mutate(
      { id: task.id },
      {
        onSuccess: async () => {
          // SSE 在 vite dev proxy 偶发掉线时可能漏推 invalidate，显式兜底
          await utils.tasks.today.invalidate();
          await utils.insights.dailyCard.invalidate();
        },
      },
    );
  };

  const dragId = scope ? `${scope}-${task.id}` : task.id;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId });

  const onPickTime = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; // "HH:mm"
    if (!val) return;
    const [h, m] = val.split(':').map(Number) as [number, number];
    const { scheduledStart, scheduledEnd } = buildScheduleTimes(h, m, 60);
    schedule.mutate(
      { id: task.id, scheduledStart, scheduledEnd },
      {
        onSuccess: async () => {
          await utils.tasks.today.invalidate();
          await utils.insights.dailyCard.invalidate();
        },
      },
    );
    setShowTime(false);
  };

  // MIT / 时间块 简化卡：仅显示任务内容 + 完成勾选，移除其余修改属性按键（拖拽/领域/时间/星标/删除），
  // 与 MIT 保持完全一致的显示方式，让时间块里的任务只呈现关键信息。
  if (scope === 'mit' || scope === 'slot') {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'group relative flex items-center gap-2 rounded-lg border bg-bg-panel px-2.5 py-2 text-sm hover:border-accent/50',
          accentBorder && 'border-l-2 border-l-accent ring-1 ring-accent/20',
          isDragging && 'opacity-40',
        )}
      >
        <button
          onClick={onCompleteClick}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
            done ? 'border-green-500 bg-green-500' : 'border-gray-500 hover:border-green-400',
          )}
          title={done ? '取消完成' : '完成'}
        >
          {done && <Check size={12} className="text-black" />}
        </button>
        <span
          className={cn(
            'flex-1 min-w-0 cursor-pointer break-words whitespace-pre-wrap leading-snug',
            done && 'text-gray-500 line-through',
          )}
          title="双击查看任务详情"
          onDoubleClick={() => openTaskDetail(task.id)}
        >
          {task.title}
        </span>
        {done && task.isMit && task.completionQuality != null && (
          <span
            className="flex shrink-0 items-center gap-0.5 rounded bg-yellow-400/15 px-1 text-[10px] text-yellow-300"
            title="完成质量"
          >
            <Star size={10} fill="currentColor" />
            {task.completionQuality}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group relative flex items-center gap-2 rounded-lg border border-bg-border bg-bg-panel px-2.5 py-2 text-sm hover:border-accent/50',
        accentBorder && 'border-l-2 border-l-accent ring-1 ring-accent/20',
        isDragging && 'opacity-40',
      )}
    >
      <button {...listeners} {...attributes} className="cursor-grab text-gray-500 hover:text-gray-300" title="拖动">
        <GripVertical size={14} />
      </button>

      <button
        onClick={onCompleteClick}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded border',
          done ? 'border-green-500 bg-green-500' : 'border-gray-500 hover:border-green-400',
        )}
        title={done ? '取消完成' : task.isMit ? '完成并评分' : '完成'}
      >
        {done && <Check size={12} className="text-black" />}
      </button>

      {/* MIT 完成弹星评分（可跳过） */}
      {showQuality && !done && (
        <div
          className="absolute left-6 top-0 z-20 flex items-center gap-1 rounded-lg border border-accent/50 bg-bg-raised px-2 py-1.5 shadow-xl shadow-black/50"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="mr-1 text-[10px] text-gray-400">完成质量</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => submitQuality(n)}
              className="text-accent transition-transform hover:scale-125"
              title={`${n} 星`}
            >
              <Star size={14} fill="currentColor" />
            </button>
          ))}
          <button
            onClick={() => submitQuality(null)}
            className="ml-1 text-[10px] text-gray-500 hover:text-gray-300"
            title="跳过评分"
          >
            跳过
          </button>
        </div>
      )}

      {/* 标题：双击打开任务详情/编辑弹窗（先只读展示，可进入编辑） */}
      <span
        className={cn(
          'flex-1 min-w-0 cursor-pointer break-words whitespace-pre-wrap leading-snug line-clamp-3 hover:line-clamp-none',
          done && 'text-gray-500 line-through',
        )}
        title="双击查看任务详情"
        onDoubleClick={() => openTaskDetail(task.id)}
      >
        {task.title}
      </span>

      {/* 已完成的 MIT：展示完成质量 + 注意力峰值 */}
      {done && task.isMit && (
        <span className="flex shrink-0 items-center gap-1">
          {task.completionQuality != null && (
            <span className="flex items-center gap-0.5 rounded bg-yellow-400/15 px-1 text-[10px] text-yellow-300" title="完成质量">
              <Star size={10} fill="currentColor" />
              {task.completionQuality}
            </span>
          )}
          {task.attentionPeak != null && (
            <span className="flex items-center gap-0.5 rounded bg-sky-400/15 px-1 text-[10px] text-sky-300" title="注意力峰值（专注时段最高评分）">
              <Brain size={10} />
              {task.attentionPeak}
            </span>
          )}
        </span>
      )}

      {scheduledTime && (
        <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent">{scheduledTime}</span>
      )}

      {/* 领域切换：圆点 + 当前领域名（可点击）→ Popover 选 9 领域之一 */}
      <DomainPicker taskId={task.id} domainKey={task.domainKey} color={color} />

      <button
        onClick={() => setShowTime((v) => !v)}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn('shrink-0', scheduledTime ? 'text-accent' : 'text-gray-600 hover:text-accent')}
        title={scheduledTime ? `已安排 ${scheduledTime}` : '安排时间'}
      >
        <Clock size={14} />
      </button>

      {showTime && (
        <input
          type="time"
          autoFocus
          defaultValue={scheduledTime}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={onPickTime}
          onBlur={() => setShowTime(false)}
          className="absolute right-1 top-9 z-10 rounded border border-accent/50 bg-bg-raised px-1 py-0.5 text-xs text-gray-100"
        />
      )}

      <button
        onClick={() =>
          setMit.mutate(
            { id: task.id, isMit: !task.isMit, mitOrder: !task.isMit ? 0 : null },
            {
              onSuccess: async () => {
                await utils.tasks.today.invalidate();
                await utils.insights.dailyCard.invalidate();
              },
            },
          )
        }
        onPointerDown={(e) => e.stopPropagation()}
        className={cn('shrink-0', task.isMit ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-300')}
        title="设为 MIT"
      >
        <Star size={14} />
      </button>

      <button
        onClick={onDelete}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 text-gray-600 hover:text-red-400"
        title="删除任务"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/** 拖拽时浮在最顶层的视觉克隆（由 DndContext 的 DragOverlay 渲染，非交互） */
export function TaskCardOverlay({ task, color, accentBorder }: { task: TaskView; color?: string; accentBorder?: boolean }) {
  const scheduledTime = task.scheduledStart ? toLocalInput(task.scheduledStart).slice(11, 16) : '';
  return (
    <div
      className={cn(
        'flex cursor-grabbing items-center gap-2 rounded-lg border border-accent/60 bg-bg-panel px-2.5 py-2 text-sm shadow-2xl shadow-black/50 ring-1 ring-accent/40',
        accentBorder && 'border-l-2 border-l-accent',
      )}
    >
      <span className={cn('flex-1 truncate', task.status === 'done' && 'text-gray-500 line-through')}>
        {task.title}
      </span>
      {scheduledTime && (
        <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent">{scheduledTime}</span>
      )}
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      {task.isMit && <Star size={14} className="shrink-0 text-yellow-400" />}
    </div>
  );
}

/**
 * 领域切换器：点击圆点+领域名 → 弹出 9 领域列表 → 选中调 `tasks.update`。
 * 不引入新弹窗依赖：用受控状态 + 外部 pointerdown 检测。
 * 与 dnd-kit 拖拽手柄/GripVertical 隔离：自身按钮 + onPointerDown stopPropagation。
 */
function DomainPicker({
  taskId,
  domainKey,
  color,
}: {
  taskId: string;
  domainKey: string | null;
  color?: string;
}) {
  const { data: domains = [] } = trpc.domains.list.useQuery(undefined);
  const utils = trpc.useUtils();
  const update = trpc.tasks.update.useMutation(undefined);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 外部点击关闭（pointerdown 比 click 更早触发，避免被 dnd-kit 抢先 stop）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const current = domains.find((d: any) => d.key === domainKey);

  const pick = (key: string) => {
    if (key === domainKey) {
      setOpen(false);
      return;
    }
    update.mutate(
      { id: taskId, domainKey: key as (typeof DOMAIN_KEYS)[number] },
      {
        onSuccess: async () => {
          // SSE 兜底：写操作显式 invalidate，避免 dev proxy 偶发掉线时 UI 不刷新
          await utils.tasks.today.invalidate();
          await utils.insights.dailyCard.invalidate();
        },
      },
    );
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative shrink-0" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="切换领域"
        className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-gray-400 transition-colors hover:bg-bg-soft hover:text-gray-200"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-bg-border"
          style={{ background: color ?? '#666' }}
        />
        {current?.name ?? '未分类'}
      </button>
      {open && (
        <div
          className="absolute right-0 top-6 z-30 w-36 overflow-hidden rounded-lg border border-bg-border bg-bg-raised shadow-2xl shadow-black/50"
          role="listbox"
        >
          {domains.map((d: any) => {
            const active = d.key === domainKey;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => pick(d.key)}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors',
                  active ? 'bg-accent/15 text-accent' : 'text-gray-200 hover:bg-bg-soft',
                )}
                role="option"
                aria-selected={active}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-bg-border"
                  style={{ background: d.color }}
                />
                {d.name}
                {active && <span className="ml-auto text-[10px] text-accent">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
