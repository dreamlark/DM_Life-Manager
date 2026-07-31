import { useState, useRef } from 'react';
import { Clock, Bell, Check, AlarmClock, RotateCw, CalendarClock, Pencil, Trash2, X, Share2 } from 'lucide-react';
import { trpcLocal as trpc } from '../../lib/trpcLocal';
import { useReminderAlarm } from './useReminderAlarm';
import { ReminderShareConfig } from './ReminderShareConfig';
import { SHARE_BTN } from '../shared/shareButton';
import { useCollaborative } from '../../store/modeStore';
import { toLocalInput, relTime, DOMAIN_KEYS, type ReminderView } from '@dm-life/shared';

const inputCls =
  'rounded-md bg-bg-base px-2 py-1 text-xs text-gray-100 outline-none ring-accent/30 focus:ring-2';
const btnCls =
  'flex items-center gap-1 rounded-md border border-bg-border bg-bg-raised px-2 py-1 text-xs text-gray-200 hover:border-accent/50';
const iconBtn = 'rounded p-1 text-gray-500 transition-colors hover:text-accent';
const delIconBtn = 'rounded p-1 text-gray-500 transition-colors hover:text-red-400';

const STATUS_BADGE: Record<ReminderView['status'], { label: string; cls: string }> = {
  active: { label: '待响铃', cls: 'bg-bg-base text-gray-400' },
  due: { label: '响铃中', cls: 'bg-amber-500/15 text-amber-300' },
  overdue: { label: '已逾期', cls: 'bg-red-500/15 text-red-300' },
  done: { label: '已完成', cls: 'bg-emerald-500/15 text-emerald-300' },
};

/**
 * 周期规则预设（仅 6 种，值与 computeNextFire 的解析规则一致，确保引擎能正确算出下次响铃）。
 * 已移除「自定义」自由文本输入——周期规则统一为受控下拉，交互与数据处理完全一致。
 */
const PERIOD_PRESETS: { value: string; label: string }[] = [
  { value: '单次', label: '单次（仅一次）' },
  { value: '每天', label: '每天' },
  { value: '每周', label: '每周' },
  { value: '每月', label: '每月' },
  { value: '每季度', label: '每季度' },
  { value: '每年', label: '每年' },
];

/** 受控下拉：选择即写入周期规则值，无自定义态。 */
function PeriodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {PERIOD_PRESETS.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

function AddClockForm() {
  const create = trpc.reminders.create.useMutation(undefined);
  const utils = trpc.useUtils();
  const domains = trpc.domains.list.useQuery(undefined);
  const [title, setTitle] = useState('');
  const [domainKey, setDomainKey] = useState<string>('wealth');
  const [periodRule, setPeriodRule] = useState('每周');
  const [leadChain, setLeadChain] = useState('7,1,0');
  const [note, setNote] = useState('');
  const [nextFireAt, setNextFireAt] = useState('');
  const [err, setErr] = useState('');
  const nextFireRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!title.trim()) { setErr('请填写标题'); return; }
    if (!nextFireAt) { setErr('请选择首次响铃时间'); return; }
    setErr('');
    create.mutate(
      {
        title: title.trim(),
        domainKey: domainKey as (typeof DOMAIN_KEYS)[number],
        periodRule,
        leadChain: leadChain
          .split(/[,\s]+/)
          .map((s) => parseInt(s, 10))
          .filter((n) => Number.isFinite(n)),
        noteLinked: note || null,
        nextFireAt: new Date(nextFireAt).toISOString(),
      },
      {
        // 不再依赖 SSE 刷新：成功即显式失效列表，确保新钟立即出现
        onSuccess: () => {
          setTitle('');
          setNote('');
          setNextFireAt('');
          void utils.reminders.list.invalidate();
          void utils.reminders.upcoming.invalidate();
        },
        onError: (e: any) => setErr(`添加失败：${e.message}`),
      },
    );
  };

  return (
    <div className="rounded-xl border border-bg-border bg-bg-panel p-3">
      <div className="mb-2 text-xs font-semibold text-gray-300">上发条 · 新建一只钟</div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">标题</span>
          <input className={inputCls} placeholder="如：车险续保" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">领域</span>
          <select className={inputCls} value={domainKey} onChange={(e) => setDomainKey(e.target.value)}>
            {domains.data?.map((d: any) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            )) ??
              DOMAIN_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">周期规则</span>
          <PeriodSelect value={periodRule} onChange={setPeriodRule} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">提前提醒(天)</span>
          <input className={inputCls} placeholder="7,1,0" value={leadChain} onChange={(e) => setLeadChain(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">首次响铃</span>
          <div className="relative">
            <input
              ref={nextFireRef}
              className={`${inputCls} min-w-[150px]`}
              type="datetime-local"
              value={nextFireAt}
              onChange={(e) => setNextFireAt(e.target.value)}
            />
          </div>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">关联笔记</span>
          <input className={inputCls} placeholder="可选" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className={btnCls} onClick={submit}>
          <Check size={12} /> 确定添加
        </button>
      </div>
      {err && <p className="text-[11px] text-red-400">{err}</p>}
    </div>
  );
}

function ClockCard({ clock }: { clock: ReminderView }) {
  const complete = trpc.reminders.complete.useMutation(undefined);
  const snooze = trpc.reminders.snooze.useMutation(undefined);
  const rewind = trpc.reminders.rewind.useMutation(undefined);
  const update = trpc.reminders.update.useMutation(undefined);
  const del = trpc.reminders.delete.useMutation(undefined);
  const utils = trpc.useUtils();
  const domains = trpc.domains.list.useQuery(undefined);
  const [rewinding, setRewinding] = useState(false);
  const [rewindAt, setRewindAt] = useState(toLocalInput(clock.nextFireAt));
  const [editing, setEditing] = useState(false);
  const [e, setE] = useState({
    title: clock.title,
    periodRule: clock.periodRule,
    leadChain: clock.leadChain.join(','),
    noteLinked: clock.noteLinked ?? '',
  });

  const domain = domains.data?.find((d: any) => d.key === clock.domainKey);
  const badge = STATUS_BADGE[clock.status];

  const startEdit = () => {
    setE({
      title: clock.title,
      periodRule: clock.periodRule,
      leadChain: clock.leadChain.join(','),
      noteLinked: clock.noteLinked ?? '',
    });
    setEditing(true);
  };
  const saveEdit = () => {
    update.mutate(
      {
        id: clock.id,
        title: e.title,
        periodRule: e.periodRule,
        leadChain: e.leadChain
          .split(/[,\s]+/)
          .map((s) => parseInt(s, 10))
          .filter((n) => Number.isFinite(n)),
        noteLinked: e.noteLinked || null,
      },
      { onSuccess: () => { setEditing(false); void utils.reminders.list.invalidate(); void utils.reminders.upcoming.invalidate(); } },
    );
  };

  return (
    <div className="rounded-xl border border-bg-border bg-bg-panel p-3">
      <div className="flex items-center gap-2">
        <Clock size={15} className="shrink-0 text-accent" />
        <span className="text-sm text-gray-100">{clock.title}</span>
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
        <button className={iconBtn} title="编辑" onClick={() => (editing ? setEditing(false) : startEdit())}>
          <Pencil size={12} />
        </button>
        <button className={delIconBtn} title="删除" onClick={() => { if (window.confirm(`删除「${clock.title}」这只钟？`)) del.mutate({ id: clock.id }); }}>
          <Trash2 size={12} />
        </button>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <input className={inputCls} value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} placeholder="标题" />
          <PeriodSelect value={e.periodRule} onChange={(v) => setE({ ...e, periodRule: v })} />
          <input className={inputCls} value={e.leadChain} onChange={(ev) => setE({ ...e, leadChain: ev.target.value })} placeholder="提前提醒(天)，如 7,1,0" />
          <input className={inputCls} value={e.noteLinked} onChange={(ev) => setE({ ...e, noteLinked: ev.target.value })} placeholder="关联笔记（可选）" />
          <div className="flex gap-2">
            <button className={btnCls} onClick={saveEdit}><Check size={12} /> 保存</button>
            <button className={btnCls} onClick={() => setEditing(false)}><X size={12} /> 取消</button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            {domain && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{ backgroundColor: `${domain.color}22`, color: domain.color }}
              >
                {domain.name}
              </span>
            )}
            <span>周期：{clock.periodRule}</span>
            {clock.status === 'done' ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CalendarClock size={12} /> 已一次性完成
              </span>
            ) : (
              <span className="flex items-center gap-1 text-gray-400">
                <CalendarClock size={12} /> 下次 {relTime(clock.nextFireAt)}
              </span>
            )}
            {clock.leadChain.length > 0 && <span>提前 {clock.leadChain.join('/')} 天</span>}
          </div>
          {clock.noteLinked && <div className="mt-1 text-[11px] text-gray-500">📎 {clock.noteLinked}</div>}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {clock.status !== 'done' && (
              <button
                className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-xs text-accent hover:bg-accent/25"
                onClick={() =>
                  complete.mutate(
                    { id: clock.id },
                    { onSuccess: () => { void utils.reminders.list.invalidate(); void utils.reminders.upcoming.invalidate(); } },
                  )
                }
              >
                <Check size={12} /> 完成
              </button>
            )}
            <button
              className={btnCls}
              onClick={() =>
                snooze.mutate(
                  { id: clock.id, nextFireAt: new Date(Date.now() + 7 * 86400000).toISOString() },
                  { onSuccess: () => { void utils.reminders.list.invalidate(); void utils.reminders.upcoming.invalidate(); } },
                )
              }
            >
              <AlarmClock size={12} /> 推迟7天
            </button>
            <button className={btnCls} onClick={() => setRewinding((v) => !v)}>
              <RotateCw size={12} /> 上发条
            </button>
          </div>
          {rewinding && (
            <div className="mt-2 flex items-center gap-2">
              <input
                className={inputCls}
                type="datetime-local"
                value={rewindAt}
                onChange={(ev) => setRewindAt(ev.target.value)}
              />
              <button
                className={btnCls}
                onClick={() => {
                  rewind.mutate(
                    { id: clock.id, nextFireAt: new Date(rewindAt).toISOString() },
                    { onSuccess: () => { void utils.reminders.list.invalidate(); void utils.reminders.upcoming.invalidate(); } },
                  );
                  setRewinding(false);
                }}
              >
                确认重置
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ReminderShopPage() {
  const tick = trpc.reminders.tick.useMutation(undefined);
  const upcoming = trpc.reminders.upcoming.useQuery(undefined);
  const all = trpc.reminders.list.useQuery(undefined);
  const [shareOpen, setShareOpen] = useState(false);
  const collaborative = useCollaborative();
  useReminderAlarm();

  const upcomingIds = new Set(upcoming.data?.map((c: any) => c.id) ?? []);
  const rest = (all.data ?? []).filter((c: any) => !upcomingIds.has(c.id));
  const dueCount = upcoming.data?.filter((c: any) => c.status === 'due' || c.status === 'overdue').length ?? 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-base font-semibold text-gray-100">人生钟表铺</h1>
          <p className="text-[11px] text-gray-500">非日常周期事务集中管理，避免与日常任务混杂成噪声</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {collaborative && (
            <button
              className={`${SHARE_BTN}`}
              title="共享到家庭"
              onClick={() => setShareOpen(true)}
            >
              <Share2 size={13} /> 共享到家庭
            </button>
          )}
          <button
            className="flex items-center gap-1 rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs text-gray-200 hover:border-accent/50"
            onClick={() => tick.mutate()}
          >
            <Bell size={13} /> 检查响铃{dueCount > 0 ? `（${dueCount} 只待处理）` : ''}
          </button>
        </div>
      </div>

      <AddClockForm />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-200">即将响铃（未来 30 天）</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {upcoming.data?.map((c: any) => (
            <ClockCard key={c.id} clock={c} />
          ))}
        </div>
        {!upcoming.data?.length && (
          <div className="rounded-xl border border-dashed border-bg-border p-6 text-center text-xs text-gray-600">
            未来 30 天没有即将响铃的钟，一切安静 ✦
          </div>
        )}
      </section>

      {rest.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-400">其余的钟（安静折叠）</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rest.map((c: any) => (
              <ClockCard key={c.id} clock={c} />
            ))}
          </div>
        </section>
      )}

      {collaborative && <ReminderShareConfig open={shareOpen} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
