import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '../../lib/trpcLocal';
import { useUI } from '../../store/uiStore';
import { cn } from '../../lib/cn';
import { todayStr, QUADRANTS, quadrantFlags, type QuadrantKey } from '@dm-life/shared';
import type { TaskPriority } from '@dm-life/shared';
import { DOMAIN_KEYS } from '@dm-life/shared';

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; active: string }[] = [
  { value: 'high', label: '高', active: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
  { value: 'medium', label: '中', active: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { value: 'low', label: '低', active: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
];

const QUAD_ACTIVE: Record<QuadrantKey, string> = {
  q1: 'border-red-500/60 bg-red-500/10 text-rose-200',
  q2: 'border-amber-500/60 bg-amber-500/10 text-amber-200',
  q3: 'border-sky-500/60 bg-sky-500/10 text-sky-200',
  q4: 'border-gray-500/60 bg-gray-500/10 text-gray-200',
};

function autoGrow(el: HTMLTextAreaElement | null, max = 120) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const defaultQuadrant = useUI((s) => s.defaultQuadrant);
  const setDefaultQuadrant = useUI((s) => s.setDefaultQuadrant);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [domainKey, setDomainKey] = useState('work');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [quadrant, setQuadrant] = useState<QuadrantKey>('q1');
  const [date, setDate] = useState<string>(todayStr());
  const [daily, setDaily] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const { data: domains = [] } = trpc.domains.list.useQuery(undefined);
  const utils = trpc.useUtils();
  // 看板当前查看的日期——创建任务时归属该日期，避免 CommandPalette 用独立日期导致
  // "任务创建到今天但看板在查看其他日期 → 看不到新任务"的问题
  const boardDate = useUI((s) => s.boardDate);
  // 写入结果（成功刷新/关闭弹窗、失败报错）统一由 submit() 的 await 处理，
  // 这里不再挂 onSuccess/onError，避免重复 toast 与“假成功”提示。
  const create = trpc.tasks.create.useMutation(undefined);
  // 每日例行模板实例化：创建 daily 任务后主动按当前看板日期实例化当天实例（见 submit）
  const ensureDaily = trpc.tasks.ensureDaily.useMutation();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // 打开时自动聚焦名称输入；重置表单到默认值（象限跟随用户偏好）
  useEffect(() => {
    if (open) {
      // 弹窗打开时把日期同步到看板当前查看的日期，避免创建到错误日期
      setDate(boardDate);
      setTimeout(() => titleRef.current?.focus(), 0);
    } else {
      setTitle('');
      setDescription('');
      setQuadrant(defaultQuadrant);
      setDate(todayStr());
      setDaily(false);
      setSaveAsDefault(false);
      if (descRef.current) descRef.current.style.height = 'auto';
    }
  }, [open, defaultQuadrant, boardDate]);

  const submit = async () => {
    const t = title.trim();
    if (!t || create.isPending) return;
    if (daily && saveAsDefault) {
      // 每日例行模板的默认象限也一并记住
      setDefaultQuadrant(quadrant);
    } else if (saveAsDefault) {
      setDefaultQuadrant(quadrant);
    }
    const { importance, urgency } = quadrantFlags(quadrant);
    try {
      // 任务归属看板当前查看的日期（而非独立的 date 状态），确保创建后立即在看板上看到
      const effectiveDate = daily ? null : boardDate;
      await create.mutateAsync({
        title: t,
        description: description.trim(),
        domainKey: domainKey as (typeof DOMAIN_KEYS)[number],
        priority,
        importance,
        urgency,
        // 每日例行 = 模板（taskDate 置空，由 ensureDaily 按天实例化）；否则归属看板日期
        repeat: daily ? 'daily' : 'none',
        taskDate: effectiveDate,
        // 选中的日期当日 09:00 落进日历；无日期的任务日历不展示
        scheduledStart: `${boardDate}T09:00:00`,
      });
      // 每日例行：create 仅写入 taskDate=null 的"模板"，须由 ensureDaily 按 boardDate
      // 实例化为当天任务才显示。已打开看板因 LocalApp 的 ensuredRef 守卫不再跑 ensureDaily，
      // 故此处主动实例化；仅今天及未来（与 LocalApp 守卫一致，不为过去日期回灌）。
      if (daily && boardDate >= todayStr()) {
        await ensureDaily.mutateAsync({ date: boardDate });
      }
      // 仅在写入真正成功后：刷新看板/日历 + 关闭弹窗 + 提示
      // 用 boardDate 精确 invalidate（确保刷新当前查看日期的查询缓存）
      await utils.tasks.all.invalidate();
      await utils.tasks.today.invalidate();
      await utils.insights.dailyCard.invalidate();
      setTitle('');
      setDescription('');
      if (descRef.current) descRef.current.style.height = 'auto';
      setOpen(false);
      toast.success('任务已添加');
    } catch (e) {
      // 写入失败（引擎未启动/孤儿进程/网络）必须明确报错，绝不假装成功
      const msg = e instanceof Error ? e.message : '未知错误';
      toast.error(`添加失败：${msg}\n请确认后端服务已启动`);
    }
  };

  const busy = create.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/3 h-[600px] w-[520px] max-w-[92vw] max-h-[88vh] -translate-x-1/2 overflow-y-auto rounded-xl border border-bg-border bg-bg-raised p-4 shadow-2xl">
          <Dialog.Title className="sr-only">添加任务</Dialog.Title>
          <Dialog.Description className="sr-only">填写任务名称、描述并回车创建</Dialog.Description>

          <h3 className="mb-3 text-sm font-semibold text-gray-200">添加任务</h3>

          {/* 任务名称 */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="任务名称（按回车创建）"
            className="w-full rounded-lg bg-bg-base px-3 py-2 text-sm leading-relaxed text-gray-100 outline-none ring-accent/40 placeholder:text-gray-500 focus:ring-2"
          />

          {/* 任务描述 */}
          <textarea
            ref={descRef}
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="任务描述（可选，Shift+Enter 换行）"
            className="mt-2 w-full resize-none rounded-lg bg-bg-base px-3 py-2 text-sm leading-relaxed text-gray-100 outline-none ring-accent/40 placeholder:text-gray-500 focus:ring-2"
          />

          {/* 优先级 */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-xs text-gray-400">优先级</span>
              <div className="flex gap-1">
                {PRIORITY_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    disabled={busy}
                    onClick={() => setPriority(p.value)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors',
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
          </div>

          {/* 四象限选择 */}
          <div className="mt-3">
            <div className="mb-1.5 text-xs text-gray-400">所属象限</div>
            <div className="grid grid-cols-2 gap-1.5">
              {QUADRANTS.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  disabled={busy}
                  onClick={() => setQuadrant(q.key)}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                    quadrant === q.key
                      ? QUAD_ACTIVE[q.key]
                      : 'border-bg-border bg-bg-base text-gray-400 hover:text-gray-200',
                  )}
                >
                  <span className="font-medium">{q.title}</span>
                  <span className="text-[10px] opacity-70">{q.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 日期 + 每日例行 + 设为默认象限 */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-xs text-gray-400">日期</span>
              <input
                type="date"
                value={date}
                disabled={busy || daily}
                onChange={(e) => setDate(e.target.value)}
                className={cn(
                  'rounded-lg bg-bg-base px-2 py-1.5 text-xs text-gray-100 outline-none ring-accent/40 focus:ring-2',
                  daily && 'opacity-40',
                )}
              />
            </div>
            <label
              className={cn(
                'flex cursor-pointer items-center gap-1.5 text-xs text-gray-300',
                busy && 'pointer-events-none opacity-50',
              )}
            >
              <input
                type="checkbox"
                checked={daily}
                disabled={busy}
                onChange={(e) => setDaily(e.target.checked)}
                className="accent-accent"
              />
              每日例行（按天自动复用）
            </label>
            <label
              className={cn(
                'flex cursor-pointer items-center gap-1.5 text-xs text-gray-300',
                busy && 'pointer-events-none opacity-50',
              )}
            >
              <input
                type="checkbox"
                checked={saveAsDefault}
                disabled={busy}
                onChange={(e) => setSaveAsDefault(e.target.checked)}
                className="accent-accent"
              />
              设为默认象限
            </label>
          </div>

          {/* 领域 + 提交 */}
          <div className="mt-3 flex items-center gap-2">
            <span className="shrink-0 text-xs text-gray-400">领域</span>
            <select
              value={domainKey}
              onChange={(e) => setDomainKey(e.target.value)}
              className="flex-1 rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none ring-accent/40 focus:ring-2"
            >
              {domains.map((d: any) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={submit}
              disabled={!title.trim() || busy}
              className={cn(
                'shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                !title.trim() || busy
                  ? 'cursor-not-allowed bg-bg-soft text-gray-500'
                  : 'bg-accent text-bg-base hover:bg-accent/90',
              )}
            >
              {busy ? '创建中…' : '确定'}
            </button>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            按回车创建，Shift+Enter 在描述中换行{daily ? ' · 每日例行将作为模板，每天自动生成当天实例' : ''}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
