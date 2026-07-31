import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { trpc } from '../../lib/trpcLocal';
import { useUI } from '../../store/uiStore';
import { cn } from '../../lib/cn';
import { useTaskShareSync } from '../shared/useTaskShareSync';
import { toLocalInput, todayStr } from '@dm-life/shared';
import type { TaskPriority, TaskView } from '@dm-life/shared';
import { Pencil, X, Trash2, Clock, Flag, CalendarClock, Tag, CheckCircle2, Circle, Archive } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  archived: '已归档',
};
const STATUS_ORDER: TaskView['status'][] = ['todo', 'doing', 'done', 'archived'];
const STATUS_BADGE: Record<string, string> = {
  todo: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  doing: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  done: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  archived: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};
const PRIORITY_LABEL: Record<TaskPriority, string> = { high: '高', medium: '中', low: '低' };
const PRIORITY_OPTIONS: { value: TaskPriority; label: string; active: string }[] = [
  { value: 'high', label: '高', active: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
  { value: 'medium', label: '中', active: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { value: 'low', label: '低', active: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
];

function fmt(iso: string | null, withTime = true): string {
  if (!iso) return '未设置';
  const s = iso.slice(0, withTime ? 16 : 10).replace('T', ' ');
  return s;
}

export function TaskDetailDialog() {
  const detailTaskId = useUI((s) => s.detailTaskId);
  const close = useUI((s) => s.closeTaskDetail);
  const { data: allTasks = [] } = trpc.tasks.all.useQuery(undefined);
  const { data: domains = [] } = trpc.domains.list.useQuery(undefined);
  const utils = trpc.useUtils();

  const update = trpc.tasks.update.useMutation(undefined);
  const complete = trpc.tasks.complete.useMutation(undefined);
  const uncomplete = trpc.tasks.uncomplete.useMutation(undefined);
  const del = trpc.tasks.delete.useMutation(undefined);
  const syncDone = useTaskShareSync();

  const task = allTasks.find((t: any) => t.id === detailTaskId) ?? null;
  const open = !!detailTaskId && !!task;

  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');
  // 编辑草稿
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<string>('todo');
  const [scheduledStart, setScheduledStart] = useState(''); // datetime-local: YYYY-MM-DDTHH:mm
  const [dueAt, setDueAt] = useState(''); // date: YYYY-MM-DD
  const [domainKey, setDomainKey] = useState('work');
  const [daily, setDaily] = useState(false);

  // 打开时初始化草稿并进入只读视图
  useEffect(() => {
    if (open && task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
      setPriority(task.priority);
      setStatus(task.status);
      setScheduledStart(task.scheduledStart ? toLocalInput(task.scheduledStart) : '');
      setDueAt(task.dueAt ? task.dueAt.slice(0, 10) : '');
      setDomainKey(task.domainKey);
      // 每日例行属性：模板(repeat='daily')或实例(sourceDailyId 有值)都算"每日例行"
      setDaily(task.repeat === 'daily' || !!task.sourceDailyId);
      setEditing(false);
      setErr('');
    }
    // 任务被删除后关闭弹窗
    if (detailTaskId && !task) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTaskId, task]);

  const onClose = () => {
    setEditing(false);
    close();
  };

  const startEdit = () => {
    setErr('');
    setEditing(true);
  };

  const save = () => {
    if (!task) return;
    const t = title.trim();
    if (!t) {
      setErr('任务名称不能为空');
      return;
    }
    const patch: Record<string, unknown> = {};
    if (t !== task.title) patch.title = t;
    if (description.trim() !== (task.description ?? '')) patch.description = description.trim();
    if (priority !== task.priority) patch.priority = priority;
    const schedLocal = task.scheduledStart ? toLocalInput(task.scheduledStart) : '';
    if (scheduledStart !== schedLocal) {
      patch.scheduledStart = scheduledStart ? new Date(scheduledStart).toISOString() : null;
    }
    const dueLocal = task.dueAt ? task.dueAt.slice(0, 10) : '';
    if (dueAt !== dueLocal) {
      patch.dueAt = dueAt ? new Date(dueAt + 'T00:00:00').toISOString() : null;
    }
    if (domainKey !== task.domainKey) patch.domainKey = domainKey;
    // 每日例行属性：模板(repeat='daily')或实例(sourceDailyId 有值)都算"每日例行"
    const wasDaily = task.repeat === 'daily' || !!task.sourceDailyId;
    if (daily !== wasDaily) {
      if (daily) {
        // 转为每日例行模板：taskDate 置空、解除任何旧的模板绑定
        patch.repeat = 'daily';
        patch.taskDate = null;
        patch.sourceDailyId = null;
      } else {
        // 取消每日例行：变回普通单次任务（若为实例则脱离模板）
        patch.repeat = 'none';
        if (!task.taskDate) patch.taskDate = todayStr();
        if (task.sourceDailyId) patch.sourceDailyId = null;
      }
    }

    const oldStatus = task.status;
    const newStatus = status;
    const statusChanged = newStatus !== oldStatus;

    const after = () => {
      // 保存后返回任务列表并刷新数据
      utils.tasks.all.invalidate();
      utils.tasks.today.invalidate();
      utils.insights.dailyCard.invalidate();
      onClose();
    };
    const doUpdate = () => {
      if (Object.keys(patch).length === 0) {
        after();
        return;
      }
      update.mutate(
        { id: task.id, ...(patch as any) },
        { onSuccess: after, onError: (e: any) => setErr(e?.message ?? '保存失败') },
      );
    };

    if (statusChanged) {
      if (newStatus === 'done') {
        // 标记完成（complete 命令负责时间戳/质量），其余字段再走 update
        complete.mutate({ id: task.id }, { onSuccess: () => { doUpdate(); void syncDone(task.id, true); } });
      } else if (oldStatus === 'done') {
        // 从已完成改到其他状态：先取消完成，再写 status + 其他字段
        uncomplete.mutate({ id: task.id }, { onSuccess: () => { patch.status = newStatus; doUpdate(); void syncDone(task.id, false); } });
      } else {
        patch.status = newStatus;
        doUpdate();
      }
    } else {
      doUpdate();
    }
  };

  const onDelete = () => {
    if (!task) return;
    if (!window.confirm(`确定删除「${task.title}」吗？此操作不可撤销。`)) return;
    del.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          utils.tasks.all.invalidate();
          utils.tasks.today.invalidate();
          utils.insights.dailyCard.invalidate();
          onClose();
        },
      },
    );
  };

  const currentDomain = domains.find((d: any) => d.key === (task?.domainKey ?? ''));

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 h-[640px] w-[560px] max-w-[94vw] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-bg-border bg-bg-raised p-5 shadow-2xl">
          {!task ? null : (
            <>
              <div className="mb-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="break-words text-lg font-semibold leading-snug text-gray-100">
                    {editing ? (
                      <input
                        autoFocus
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            save();
                          }
                        }}
                        className="w-full rounded-lg bg-bg-base px-2 py-1 text-lg text-gray-100 outline-none ring-accent/40 focus:ring-2"
                      />
                    ) : (
                      task.title
                    )}
                  </Dialog.Title>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={cn('rounded border px-1.5 py-0.5 text-[11px]', STATUS_BADGE[task.status])}>
                      {STATUS_LABEL[task.status] ?? task.status}
                    </span>
                    <span className="rounded border border-bg-border bg-bg-base px-1.5 py-0.5 text-[11px] text-gray-300">
                      优先级：{PRIORITY_LABEL[task.priority as keyof typeof PRIORITY_LABEL]}
                    </span>
                    {task.isMit && (
                      <span className="rounded border border-yellow-500/30 bg-yellow-400/15 px-1.5 py-0.5 text-[11px] text-yellow-300">
                        MIT
                      </span>
                    )}
                    {currentDomain && (
                      <span className="flex items-center gap-1 rounded border border-bg-border bg-bg-base px-1.5 py-0.5 text-[11px] text-gray-300">
                        <span className="h-2 w-2 rounded-full" style={{ background: currentDomain.color }} />
                        {currentDomain.name}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="shrink-0 rounded-md p-1 text-gray-500 hover:bg-bg-soft hover:text-gray-200"
                  title="关闭"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 只读详情 */}
              {!editing && (
                <div className="space-y-2.5 text-sm">
                  <Field icon={<Tag size={14} />} label="描述">
                    <span className="whitespace-pre-wrap break-words text-gray-200">
                      {task.description ? task.description : <span className="text-gray-500">（无）</span>}
                    </span>
                  </Field>
                  <Field icon={<Clock size={14} />} label="计划开始">
                    <span className="text-gray-200">{fmt(task.scheduledStart)}</span>
                  </Field>
                  <Field icon={<CalendarClock size={14} />} label="截止日期">
                    <span className="text-gray-200">{fmt(task.dueAt, false)}</span>
                  </Field>
                  <Field icon={<Flag size={14} />} label="象限">
                    <span className="text-gray-200">
                      {task.importance ? '重要' : '不重要'} · {task.urgency ? '紧急' : '不紧急'}
                    </span>
                  </Field>
                  <Field icon={<CalendarClock size={14} />} label="重复">
                    <span className="text-gray-200">
                      {task.sourceDailyId
                        ? '来自每日例行模板'
                        : task.repeat === 'daily'
                          ? '每日例行（按天自动复用）'
                          : '不重复'}
                    </span>
                  </Field>
                  <Field icon={<CheckCircle2 size={14} />} label="创建时间">
                    <span className="text-gray-400">{fmt(task.createdAt)}</span>
                  </Field>
                  {task.status === 'done' && (
                    <>
                      <Field icon={<CheckCircle2 size={14} />} label="完成时间">
                        <span className="text-gray-400">{fmt(task.completedAt)}</span>
                      </Field>
                      {task.completionQuality != null && (
                        <Field icon={<Flag size={14} />} label="完成质量">
                          <span className="text-yellow-300">{task.completionQuality} 星</span>
                        </Field>
                      )}
                      {task.attentionPeak != null && (
                        <Field icon={<Flag size={14} />} label="注意力峰值">
                          <span className="text-sky-300">{task.attentionPeak}</span>
                        </Field>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* 编辑表单 */}
              {editing && (
                <div className="space-y-3">
                  <div>
                    <Label>任务描述</Label>
                    <textarea
                      rows={3}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="（可选）"
                      className="mt-1 w-full resize-none rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none ring-accent/40 focus:ring-2"
                    />
                  </div>
                  <div>
                    <Label>状态</Label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none ring-accent/40 focus:ring-2"
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>优先级</Label>
                    <div className="mt-1 flex gap-1">
                      {PRIORITY_OPTIONS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => setPriority(p.value)}
                          className={cn(
                            'rounded-md border px-3 py-1 text-xs transition-colors',
                            priority === p.value
                              ? p.active
                              : 'border-bg-border bg-bg-base text-gray-400 hover:text-gray-200',
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>计划开始</Label>
                      <input
                        type="datetime-local"
                        value={scheduledStart}
                        onChange={(e) => setScheduledStart(e.target.value)}
                        className="mt-1 w-full rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none ring-accent/40 focus:ring-2"
                      />
                    </div>
                    <div>
                      <Label>截止日期</Label>
                      <input
                        type="date"
                        value={dueAt}
                        onChange={(e) => setDueAt(e.target.value)}
                        className="mt-1 w-full rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none ring-accent/40 focus:ring-2"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>领域</Label>
                    <select
                      value={domainKey}
                      onChange={(e) => setDomainKey(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none ring-accent/40 focus:ring-2"
                    >
                      {domains.map((d: any) => (
                        <option key={d.key} value={d.key}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>重复规则</Label>
                    <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={daily}
                        onChange={(e) => setDaily(e.target.checked)}
                        className="accent-accent"
                      />
                      每日例行（按天自动复用）
                    </label>
                  </div>
                  {err && <p className="text-xs text-rose-400">{err}</p>}
                </div>
              )}

              {/* 底部操作 */}
              <div className="mt-4 flex items-center gap-2">
                {editing ? (
                  <>
                    <button
                      onClick={save}
                      disabled={update.isPending || complete.isPending || uncomplete.isPending}
                      className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-bg-base hover:bg-accent/90 disabled:opacity-60"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => {
                        setEditing(false);
                        setErr('');
                      }}
                      className="rounded-lg border border-bg-border px-4 py-1.5 text-sm text-gray-300 hover:bg-bg-soft"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startEdit}
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-bg-base hover:bg-accent/90"
                  >
                    <Pencil size={14} /> 编辑
                  </button>
                )}
                <button
                  onClick={onDelete}
                  className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-500 hover:text-red-400"
                  title="删除任务"
                >
                  <Trash2 size={14} /> 删除
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-gray-400">{children}</div>;
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-bg-base/60 px-2.5 py-2">
      <span className="mt-0.5 shrink-0 text-gray-500">{icon}</span>
      <span className="w-16 shrink-0 text-gray-400">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
