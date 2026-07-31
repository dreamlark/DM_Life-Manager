import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Play,
  Square,
  Star,
  Brain,
  TrendingUp,
  AlertTriangle,
  Clock,
  X,
  Plus,
  Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import { trpcLocal as trpc } from '../../lib/trpcLocal';
import {
  ATTENTION_TYPES,
  type AttentionType,
  type FlowSummaryQuery,
  type Interruption,
} from '@dm-life/shared';
import { FlowShareConfig } from './FlowShareConfig';
import { SHARE_BTN } from '../shared/shareButton';
import { useCollaborative } from '../../store/modeStore';

const ATTENTION_LABEL: Record<AttentionType, string> = {
  deep: '深度工作',
  shallow: '浅层工作',
  passive: '被动学习',
  recovery: '恢复',
};

/** 评分 → 颜色（1 浅灰 → 5 深绿），null = 无数据 */
function scoreColor(score: number | null): string {
  if (score == null) return 'rgba(255,255,255,0.04)';
  const t = Math.max(0, Math.min(1, (score - 1) / 4));
  const lo = [75, 85, 99];
  const hi = [22, 163, 74];
  const c = lo.map((l, i) => Math.round(l + ((hi[i] ?? 0) - l) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onChange(n === value ? null : n)}
          className="transition-transform hover:scale-110"
          title={`${n} 星`}
        >
          <Star
            size={22}
            className={n <= (hover ?? value ?? 0) ? 'text-yellow-400' : 'text-gray-600'}
            fill={n <= (hover ?? value ?? 0) ? 'currentColor' : 'none'}
          />
        </button>
      ))}
      {value != null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-1 text-xs text-gray-500 hover:text-gray-300"
        >
          清除
        </button>
      )}
    </div>
  );
}

/* ===================== 专注启动器 + 实时计时 ===================== */

interface ActiveSession {
  taskId: string | null;
  domainKey: string | null;
  projectId: string | null;
  attentionType: AttentionType;
  startedAt: string;
  energyStart: number;
  interruptions: Interruption[];
}

function FocusLauncher({ onRecorded }: { onRecorded: () => void }) {
  const { data: tasks = [] } = trpc.tasks.today.useQuery(undefined);
  const { data: domains = [] } = trpc.domains.list.useQuery(undefined);
  const record = trpc.flow.record.useMutation(undefined);

  const [taskId, setTaskId] = useState('');
  const [domainKey, setDomainKey] = useState('');
  const [attentionType, setAttentionType] = useState<AttentionType>('deep');
  const [energyStart, setEnergyStart] = useState(3);

  const [active, setActive] = useState<ActiveSession | null>(null);
  const [sec, setSec] = useState(0);
  const [assessOpen, setAssessOpen] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [energyEnd, setEnergyEnd] = useState(3);
  const [interruptions, setInterruptions] = useState<Interruption[]>([]);
  const blurAt = useRef<number | null>(null);

  // 实时计时
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  // 窗口失焦 → 温和记录一次中断
  useEffect(() => {
    if (!active) return;
    const onBlur = () => {
      blurAt.current = Date.now();
    };
    const onFocus = () => {
      if (blurAt.current && Date.now() - blurAt.current > 1500) {
        setInterruptions((list) => [
          ...list,
          { at: new Date().toISOString(), kind: null },
        ]);
        blurAt.current = null;
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [active]);

  const selectedTask = tasks.find((t: any) => t.id === taskId);
  const resolvedDomain = selectedTask?.domainKey ?? domainKey;
  const resolvedProject = selectedTask?.projectId ?? null;

  const start = () => {
    if (!resolvedDomain && !selectedTask) {
      toast.error('请先选择一个任务或领域');
      return;
    }
    setActive({
      taskId: selectedTask?.id ?? null,
      domainKey: resolvedDomain || null,
      projectId: resolvedProject,
      attentionType,
      startedAt: new Date().toISOString(),
      energyStart,
      interruptions: [],
    });
    setSec(0);
  };

  const stop = () => {
    if (!active) return;
    setInterruptions(active.interruptions);
    setActive(null);
    setAssessOpen(true);
  };

  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');

  const submit = () => {
    if (!active) return;
    record.mutate(
      {
        taskId: active.taskId,
        domainKey: active.domainKey,
        projectId: active.projectId,
        attentionType: active.attentionType,
        startedAt: active.startedAt,
        endedAt: new Date().toISOString(),
        score: score ?? null,
        energyStart: active.energyStart,
        energyEnd,
        interruptions,
      },
      {
        onSuccess: () => {
          toast.success('专注时段已记录');
          onRecorded();
          setAssessOpen(false);
          setScore(null);
          setInterruptions([]);
        },
      },
    );
  };

  if (active) {
    return (
      <>
        <section className="rounded-xl border border-accent/40 bg-bg-panel p-4 shadow-[0_0_24px_-8px_rgba(34,197,94,0.5)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-accent" />
              <span className="text-sm text-gray-200">
                {selectedTask?.title ?? resolvedDomain
                  ? domains.find((d: any) => d.key === resolvedDomain)?.name
                  : '专注中'}
              </span>
              <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-accent">
                {ATTENTION_LABEL[active.attentionType]}
              </span>
            </div>
            <span className="font-mono text-lg text-gray-100">
              {mm}:{ss}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={stop}
              className="flex items-center gap-1.5 rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/25"
            >
              <Square size={12} /> 结束并评估
            </button>
            <span className="text-xs text-gray-500">
              离开窗口会自动记一次中断（{interruptions.length} 次）
            </span>
          </div>
        </section>

        <AssessmentModal
          open={assessOpen}
          onClose={() => setAssessOpen(false)}
          score={score}
          setScore={setScore}
          energyEnd={energyEnd}
          setEnergyEnd={setEnergyEnd}
          interruptions={interruptions}
          setInterruptions={setInterruptions}
          onSubmit={submit}
        />
      </>
    );
  }

  return (
    <section className="rounded-xl border border-bg-border bg-bg-panel p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-200">
        <Brain size={16} className="text-accent" /> 开始一次专注
      </h3>
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            className="w-full rounded-md bg-bg-base px-2 py-2 text-xs text-gray-100 outline-none ring-accent/30 focus:ring-2"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">不关联任务（仅选领域）</option>
            {tasks.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {!taskId && (
            <select
              className="w-full rounded-md bg-bg-base px-2 py-2 text-xs text-gray-100 outline-none ring-accent/30 focus:ring-2 sm:w-40"
              value={domainKey}
              onChange={(e) => setDomainKey(e.target.value)}
            >
              <option value="">选择领域</option>
              {domains.map((d: any) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">注意力类型</span>
          {ATTENTION_TYPES.map((a) => (
            <button
              key={a}
              onClick={() => setAttentionType(a)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                attentionType === a
                  ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
                  : 'bg-bg-base text-gray-400 hover:text-gray-200'
              }`}
            >
              {ATTENTION_LABEL[a]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">开始时的能量</span>
          <StarRating value={energyStart} onChange={(v) => setEnergyStart(v ?? 3)} />
        </div>

        <button
          onClick={start}
          disabled={!resolvedDomain && !selectedTask}
          className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:opacity-90 disabled:opacity-40"
        >
          <Play size={13} /> 开始专注
        </button>
      </div>
    </section>
  );
}

/* ===================== 评估弹窗 ===================== */

function AssessmentModal({
  open,
  onClose,
  score,
  setScore,
  energyEnd,
  setEnergyEnd,
  interruptions,
  setInterruptions,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  score: number | null;
  setScore: (v: number | null) => void;
  energyEnd: number;
  setEnergyEnd: (v: number) => void;
  interruptions: Interruption[];
  setInterruptions: (v: Interruption[]) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-bg-border bg-bg-raised p-5 shadow-2xl">
          <div className="mb-4 flex items-center gap-2">
            <Brain size={16} className="text-accent" />
            <Dialog.Title className="text-sm font-semibold text-gray-100">这次专注怎么样？</Dialog.Title>
            <button
              className="ml-auto rounded-md p-1 text-gray-500 hover:bg-bg-base hover:text-gray-200"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-xs text-gray-400">专注质量（可跳过）</div>
              <StarRating value={score} onChange={setScore} />
            </div>

            <div>
              <div className="mb-1.5 text-xs text-gray-400">结束时的能量</div>
              <StarRating value={energyEnd} onChange={(v) => setEnergyEnd(v ?? 3)} />
            </div>

            {interruptions.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs text-gray-400">
                  记录了 {interruptions.length} 次中断，可标记原因（可选）
                </div>
                <div className="space-y-1.5">
                  {interruptions.map((it, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                      <Clock size={11} />
                      <span className="text-gray-500">
                        {new Date(it.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <button
                        onClick={() =>
                          setInterruptions(
                            interruptions.map((x, j) =>
                              j === i ? { ...x, kind: x.kind === 'internal' ? null : 'internal' } : x,
                            ),
                          )
                        }
                        className={`rounded px-1.5 py-0.5 ${
                          it.kind === 'internal' ? 'bg-orange-500/20 text-orange-300' : 'bg-bg-base text-gray-500'
                        }`}
                      >
                        内部
                      </button>
                      <button
                        onClick={() =>
                          setInterruptions(
                            interruptions.map((x, j) =>
                              j === i ? { ...x, kind: x.kind === 'external' ? null : 'external' } : x,
                            ),
                          )
                        }
                        className={`rounded px-1.5 py-0.5 ${
                          it.kind === 'external' ? 'bg-sky-500/20 text-sky-300' : 'bg-bg-base text-gray-500'
                        }`}
                      >
                        外部
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  setScore(null);
                  onSubmit();
                }}
                className="rounded-md border border-bg-border bg-bg-raised px-3 py-2 text-xs text-gray-300 hover:border-accent/50"
              >
                跳过评分
              </button>
              <button
                onClick={onSubmit}
                className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-black hover:opacity-90"
              >
                <Plus size={13} /> 保存
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ===================== 注意力热力图 ===================== */

function AttentionHeatmap({ summary }: { summary: ReturnType<typeof useFlowSummary> }) {
  const { data } = summary;
  if (!data) return <div className="text-xs text-gray-600">加载中…</div>;
  const maxLabelLen = 10;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="sticky left-0 bg-bg-panel" />
            {data.cols.map((c: any) => (
              <th key={c.key} className="px-1 text-center text-[10px] font-normal text-gray-500">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r: any) => (
            <tr key={r.key}>
              <td
                className="sticky left-0 bg-bg-panel pr-2 text-right text-[11px] text-gray-400"
                style={{ maxWidth: 120 }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full align-middle"
                  style={{ backgroundColor: r.color ?? '#666' }}
                />{' '}
                {r.name.length > maxLabelLen ? r.name.slice(0, maxLabelLen) + '…' : r.name}
              </td>
              {data.cols.map((c: any) => {
                const cell = r.cells[c.key];
                const bg = cell?.score != null ? scoreColor(cell.score) : 'rgba(255,255,255,0.04)';
                return (
                  <td key={c.key} className="h-7 w-7 rounded" style={{ backgroundColor: bg }} title={
                    cell?.count
                      ? `${r.name} · ${c.label}\n评分 ${cell.score ?? '—'} · ${cell.count} 次 · ${cell.hours}h`
                      : '无数据'
                  }>
                    {cell?.count ? (
                      <span className="flex h-full w-full items-center justify-center text-[9px] text-black/70">
                        {cell.score ?? ''}
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-500">
        <span>低质量分心</span>
        <div className="h-3 w-24 rounded" style={{ background: 'linear-gradient(to right, rgb(75,85,99), rgb(22,163,74))' }} />
        <span>高度心流</span>
      </div>
    </div>
  );
}

/* ===================== 能量 / 注意力叠加图 ===================== */

function EnergyAttentionChart({ summary }: { summary: ReturnType<typeof useFlowSummary> }) {
  const { data } = summary;
  if (!data) return null;
  const energy = data.energySeries;
  const attn = data.attentionSeries;
  if (energy.length === 0 && attn.length === 0)
    return <div className="text-xs text-gray-600">暂无能量 / 注意力数据</div>;
  const pts = attn.length >= energy.length ? attn : energy;
  const W = 520;
  const H = 140;
  const pad = 24;
  const n = pts.length;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, n - 1);
  const y = (v: number) => H - pad - ((v - 1) / 4) * (H - pad * 2);
  const line = (series: { t: string; energy?: number | null; score?: number | null }[], key: 'energy' | 'score') =>
    series
      .map((p, i) => {
        const v = p[key];
        if (v == null) return '';
        return `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[1, 2, 3, 4, 5].map((g) => (
        <line key={g} x1={pad} y1={y(g)} x2={W - pad} y2={y(g)} stroke="rgba(255,255,255,0.06)" />
      ))}
      <path d={line(energy, 'energy')} fill="none" stroke="#f59e0b" strokeWidth={2} />
      <path d={line(attn, 'score')} fill="none" stroke="#22c55e" strokeWidth={2} />
      <g>
        {pts.map((p: any, i: any) => (
          <text key={i} x={x(i)} y={H - 6} fontSize={8} fill="#888" textAnchor="middle">
            {p.t.slice(5)}
          </text>
        ))}
      </g>
    </svg>
  );
}

/* ===================== 主页面 ===================== */

function useFlowSummary(query: FlowSummaryQuery) {
  // tRPC v11 类型未暴露 staleTime，运行期合法
  return trpc.flow.summary.useQuery(query, { staleTime: 10_000 } as any);
}

export function FlowPage() {
  const utils = trpc.useUtils();
  const [range, setRange] = useState<'week' | 'month'>('week');
  const [unit, setUnit] = useState<'hour' | 'day'>('hour');
  const [axis, setAxis] = useState<'domain' | 'project'>('domain');
  const [shareOpen, setShareOpen] = useState(false);
  const collaborative = useCollaborative();

  const query: FlowSummaryQuery = { range, unit, axis };
  const summary = useFlowSummary(query);
  const onRecorded = () => void utils.flow.summary.invalidate();

  const insights = summary.data?.insights;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold text-gray-100">心流仪表盘</h2>
        <span className="text-xs text-gray-500">看清你的注意力流向与质量</span>
        <div className="ml-auto">
          {collaborative && (
            <button
              className={`${SHARE_BTN}`}
              onClick={() => setShareOpen(true)}
              title="共享到家庭"
            >
              <Share2 size={13} /> 共享到家庭
            </button>
          )}
        </div>
      </div>

      <FocusLauncher onRecorded={onRecorded} />

      {/* 概览卡 */}
      {insights && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="专注时段" value={String(insights.totalSessions)} />
          <Stat label="平均评分" value={insights.avgScore != null ? insights.avgScore.toFixed(1) : '—'} />
          <Stat label="平均能量" value={insights.avgEnergyEnd != null ? insights.avgEnergyEnd.toFixed(1) : '—'} />
          <Stat
            label="黄金时段"
            value={insights.goldenHour != null ? `${insights.goldenHour}:00` : '—'}
          />
        </div>
      )}

      {/* 热力图 */}
      <section className="rounded-xl border border-bg-border bg-bg-panel p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-200">
            <TrendingUp size={15} className="text-accent" /> 注意力热力图
          </h3>
          <div className="ml-auto flex flex-wrap gap-1.5 text-xs">
            <Seg options={[['week', '周'], ['month', '月']]} value={range} onChange={setRange} />
            <Seg options={[['hour', '按小时'], ['day', '按天']]} value={unit} onChange={setUnit} />
            <Seg options={[['domain', '领域'], ['project', '项目']]} value={axis} onChange={setAxis} />
          </div>
        </div>
        <AttentionHeatmap summary={summary} />
      </section>

      {/* 能量 × 注意力 */}
      <section className="rounded-xl border border-bg-border bg-bg-panel p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">能量曲线 × 注意力评分</h3>
        <EnergyAttentionChart summary={summary} />
        <div className="mt-1 flex items-center gap-4 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded bg-amber-500" /> 能量
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded bg-green-500" /> 注意力
          </span>
        </div>
      </section>

      {/* 洞察 */}
      {insights && (
        <section className="rounded-xl border border-bg-border bg-bg-panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-200">洞察</h3>
          <div className="space-y-3 text-xs text-gray-400">
            {insights.goldenHour != null && (
              <p>
                🌟 你最容易进入深度状态的时段是 <b className="text-accent">{insights.goldenHour}:00</b> 前后，把最重要的 MIT 安排在这里。
              </p>
            )}
            {insights.topDomains.length > 0 && (
              <p>
                📌 注意力质量最高的领域：
                {insights.topDomains.map((d: any) => (
                  <span key={d.key} className="ml-1 rounded bg-bg-raised px-1.5 py-0.5 text-accent">
                    {d.name} {d.avg}
                  </span>
                ))}
              </p>
            )}
            {insights.pseudoWork.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                <div className="mb-1 flex items-center gap-1 text-amber-300">
                  <AlertTriangle size={12} /> 可能的「伪工作」
                </div>
                {insights.pseudoWork.map((p: any) => (
                  <div key={p.key} className="text-gray-400">
                    「{p.name}」投入 {p.hours}h，但平均评分仅 {p.avgScore} —— 时间不少，注意力却不在场。
                  </div>
                ))}
              </div>
            )}
            {summary.data?.lowAttentionAlerts.map((a: any, i: any) => (
              <div key={i} className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2.5 text-sky-200">
                💡 {a}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 共享到家庭配置面板 */}
      {collaborative && <FlowShareConfig open={shareOpen} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-bg-border bg-bg-panel p-3">
      <div className="text-lg font-semibold text-gray-100">{value}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-bg-border">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-2 py-1 transition ${
            value === v ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
