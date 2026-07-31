import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Wallet,
  TrendingUp,
  Receipt,
  Landmark,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  PiggyBank,
  CalendarClock,
  Activity,
  AlertCircle,
  Download,
  Share2,
} from 'lucide-react';
import { trpc } from '../../lib/trpcLocal';
import { SettleStatusTag } from '../../components/SettleStatusTag';
import { BudgetPanel } from './BudgetPanel';
import { FinanceShareConfig } from './FinanceShareConfig';
import { SHARE_BTN } from '../shared/shareButton';
import { useCollaborative } from '../../store/modeStore';

const today = () => new Date().toISOString().slice(0, 10);

function fmt(n: number): string {
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

/**
 * 把日期输入（发放日/扣款日/利率重定价日）清洗为合法天数字段：
 * 空值→undefined（可空），非数字→undefined，越界→夹到 1-31。
 * 这是修复「收入源记一笔」payDay 校验（必须 ≤ 31）报错的根因——前端保证绝不提交越界值，
 * 即便用户输入 99 也会被夹到 31，不会再触发 Zod too_big 报错。
 */
function clampDay(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = parseInt(t, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(31, Math.max(1, n));
}

const REPAYMENT_LABELS: Record<string, string> = {
  equal_installment: '等额本息',
  equal_principal: '等额本金',
  equal_interest: '等本等息',
  interest_first: '先息后本',
};
/** 债务「还款方式」四种标准方法 */
const REPAYMENT_OPTIONS = [
  { value: 'equal_installment', label: '等额本息' },
  { value: 'equal_principal', label: '等额本金' },
  { value: 'equal_interest', label: '等本等息' },
  { value: 'interest_first', label: '先息后本' },
] as const;
const DEBT_TYPE_OPTIONS = [
  { value: 'mortgage', label: '房贷' },
  { value: 'credit_card', label: '信用卡' },
  { value: 'consumer', label: '消费贷' },
  { value: 'secured', label: '抵押贷' },
  { value: 'other', label: '其他' },
] as const;
const RATE_TYPE_OPTIONS = [
  { value: 'fixed', label: '固定利率' },
  { value: 'benchmark', label: '基准利率' },
  { value: 'lpr', label: 'LPR' },
] as const;
const RATE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  RATE_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);
/** 重定价基准（P0-1） */
const REPRICING_BENCHMARK_OPTIONS = [
  { value: 'LPR_1Y', label: 'LPR 1年期' },
  { value: 'LPR_5Y', label: 'LPR 5年期' },
  { value: 'PBOC_BASE', label: '央行基准利率' },
] as const;
const REPRICING_CYCLE_OPTIONS = [
  { value: '12', label: '每年' },
  { value: '6', label: '每半年' },
  { value: '3', label: '每季' },
] as const;
const REPRICING_ANCHOR_OPTIONS = [
  { value: 'anniversary', label: '对年对月对日' },
  { value: 'fixed_date', label: '固定日历日' },
] as const;
const ASSET_CLASS_OPTIONS = [
  { value: 'cash', label: '现金' },
  { value: 'investment', label: '投资' },
  { value: 'property', label: '不动产' },
  { value: 'fixed_asset', label: '固定资产' },
  { value: 'income_source', label: '收入源' },
  { value: 'other', label: '其他' },
] as const;
const INCOME_TYPE_OPTIONS = [
  { value: 'salary', label: '工资' },
  { value: 'bonus', label: '奖金' },
  { value: 'investment', label: '投资收益' },
  { value: 'parttime', label: '兼职' },
  { value: 'business', label: '经营' },
  { value: 'other', label: '其他' },
] as const;

function Panel({
  title,
  icon: Icon,
  children,
  right,
}: {
  title: string;
  icon: typeof Wallet;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-bg-border bg-bg-panel p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-200">
        <Icon size={16} className="text-accent" /> {title}
        {right && <span className="ml-auto">{right}</span>}
      </h3>
      {children}
    </section>
  );
}

const inputCls =
  'rounded-md bg-bg-base px-2 py-1 text-xs text-gray-100 outline-none ring-accent/30 focus:ring-2';
const btnCls =
  'flex items-center gap-1 rounded-md border border-bg-border bg-bg-raised px-2 py-1 text-xs text-gray-200 hover:border-accent/50 disabled:opacity-50';
const iconBtn = 'rounded p-1 text-gray-500 transition-colors hover:text-accent';
const delIconBtn = 'rounded p-1 text-gray-500 transition-colors hover:text-red-400';

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'green' | 'blue' | 'amber' }) {
  const tones: Record<string, string> = {
    default: 'bg-bg-base text-gray-400',
    green: 'bg-emerald-500/15 text-emerald-300',
    blue: 'bg-sky-500/15 text-sky-300',
    amber: 'bg-amber-500/15 text-amber-300',
  };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${tones[tone]}`}>{children}</span>;
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-base">
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent/80 to-accent transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ============ 通用弹窗外壳（遮罩 + ESC + 关闭按钮） ============ */
function ModalShell({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 max-h-[85vh] w-full ${maxWidth} overflow-y-auto rounded-xl border border-bg-border bg-bg-panel p-4 shadow-2xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-200">{title}</h4>
          <button className={iconBtn} onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        {children}
        {footer && <div className="mt-3 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ============ 总览卡片 ============ */
function SummaryCards() {
  const { data } = trpc.finance.summary.useQuery(undefined);
  const cards = [
    { label: '净资产', value: data?.netWorth ?? 0, accent: true },
    { label: '总资产', value: data?.totalAssets ?? 0 },
    { label: '总负债', value: data?.totalDebt ?? 0 },
    { label: '月收入(源)', value: data?.monthlyIncome ?? 0, tone: 'green' as const },
    { label: '月还款', value: data?.monthlyDebtPayment ?? 0, tone: 'amber' as const },
    { label: '本月收支净额', value: (data?.monthIncome ?? 0) - (data?.monthExpense ?? 0) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-bg-base px-3 py-2.5">
          <div
            className={`text-lg font-semibold ${
              c.accent ? 'text-accent' : c.tone === 'green' ? 'text-emerald-300' : c.tone === 'amber' ? 'text-amber-300' : 'text-gray-100'
            }`}
          >
            {fmt(c.value)}
          </div>
          <div className="text-[10px] text-gray-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ============ 月度趋势 ============ */
function TrendPanel() {
  const { data } = trpc.finance.trend.useQuery({ months: 6 });
  const rows = data ?? [];
  const max = Math.max(1, ...rows.map((r: any) => Math.max(r.income, r.expense)));
  return (
    <Panel title="月度收支趋势" icon={TrendingUp}>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-600">暂无流水数据</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r: any) => (
            <div key={r.month} className="text-xs">
              <div className="mb-1 flex justify-between text-[10px] text-gray-500">
                <span>{r.month}</span>
                <span className={r.net >= 0 ? 'text-emerald-300' : 'text-red-300'}>净额 {fmt(r.net)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 text-[10px] text-emerald-400">收</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-base">
                  <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${(r.income / max) * 100}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 text-[10px] text-red-400">支</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-base">
                  <div className="h-full rounded-full bg-red-400/70" style={{ width: `${(r.expense / max) * 100}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ============ 债务还款进度（行内，单笔 = 第二层） ============ */
function DebtProgress({ id }: { id: string }) {
  const { data } = trpc.finance.debtSchedule.useQuery({ id });
  if (!data || data.summary.totalMonths <= 0) return null;
  const pct = Math.round(data.summary.principalProgress * 100);
  const monthsPct = Math.round(data.summary.progress * 100);
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="shrink-0 text-[10px] text-gray-600">单笔</span>
      <ProgressBar value={data.summary.principalProgress} />
      <span className="shrink-0 text-[10px] text-gray-500">已还本 {pct}%</span>
      <span className="shrink-0 text-[10px] text-gray-600">（期数 {monthsPct}%）</span>
    </div>
  );
}

/* ============ 债务还款进度：右上角标签 + 浮层子窗口 ============ */
function DebtProgressPopover() {
  const [open, setOpen] = useState(false);
  const [adviceMode, setAdviceMode] = useState<'avalanche' | 'snowball'>('avalanche');
  const ref = useRef<HTMLDivElement>(null);
  const { data } = trpc.finance.debtProgressSummary.useQuery(undefined);
  const { data: advice } = trpc.finance.debtPayoffAdvice.useQuery({ mode: adviceMode });

  // 点击浮层外部 / 按 Esc 关闭（无遮罩，不阻挡页面其它交互）
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const o = data?.overall;
  const pct = o ? Math.round(o.progress * 100) : 0;

  return (
    <div className="relative flex flex-col items-end" ref={ref}>
      {/* 债务进度标签（点击展开子窗口） */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-bg-panel/90 px-3 py-1.5 text-[11px] text-gray-200 shadow-lg backdrop-blur transition hover:border-accent/60"
        aria-expanded={open}
        aria-label="打开债务进度"
      >
        <Activity size={13} className="text-accent" />
        债务进度
        <span className="rounded-full bg-accent/20 px-1.5 text-accent">{pct}%</span>
      </button>

      {/* 子窗口：整体（第一层）+ 各笔（第二层），无遮罩不遮挡主区域 */}
      {open && (
        <div className="mt-2 w-80 max-h-[72vh] overflow-y-auto rounded-xl border border-bg-border bg-bg-panel/95 p-3 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-gray-200">整体已还本金进度</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-gray-400 transition hover:bg-bg-base hover:text-gray-200"
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>

          {/* 第一层：整体汇总 */}
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-bg-base">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent/70 via-accent to-emerald-400 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-gray-500">
            <div>已还本金 <span className="text-emerald-300">{fmt(o?.paidPrincipal ?? 0)}</span></div>
            <div>实际已还 <span className="text-emerald-300">{fmt(o?.actualPaidPrincipal ?? 0)}</span></div>
            <div>剩余本金 <span className="text-amber-300">{fmt(o?.remainingPrincipal ?? 0)}</span></div>
            <div>总本金 <span className="text-gray-200">{fmt(o?.totalPrincipal ?? 0)}</span></div>
          </div>

          {/* 第二层：各笔债务 */}
          <div className="mt-3 space-y-2 border-t border-bg-border/60 pt-2">
            {data?.items?.map((it: any) => {
              const ip = Math.round(it.principalProgress * 100);
              const actual = it.actualPaidPrincipal;
              return (
                <div key={it.id}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="truncate text-gray-200">{it.creditor}</span>
                    <span className="ml-2 shrink-0 text-gray-400">{ip}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-base">
                    <div className="h-full rounded-full bg-accent/70" style={{ width: `${ip}%` }} />
                  </div>
                  {(actual > 0 || it.actualPaidPrincipal > 0) && (
                    <div className="mt-0.5 text-right text-[9px] text-emerald-400/80">
                      实际已还 {fmt(it.actualPaidPrincipal)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* P1-3 最优还款策略建议（雪崩 / 滚雪球） */}
          <div className="mt-3 space-y-2 border-t border-bg-border/60 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-gray-200">最优还款策略</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={`rounded px-1.5 py-0.5 text-[10px] ${adviceMode === 'avalanche' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'}`}
                  onClick={() => setAdviceMode('avalanche')}
                >
                  雪崩法
                </button>
                <button
                  type="button"
                  className={`rounded px-1.5 py-0.5 text-[10px] ${adviceMode === 'snowball' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'}`}
                  onClick={() => setAdviceMode('snowball')}
                >
                  滚雪球
                </button>
              </div>
            </div>
            <ul className="space-y-1">
              {(advice ?? []).map((a: any) => (
                <li key={a.debtId} className="flex items-start gap-1.5 text-[10px]">
                  <span className="mt-0.5 shrink-0 rounded bg-bg-base px-1 text-gray-400">{a.rank}</span>
                  <span className="text-gray-200">{a.creditor}</span>
                  <span className="text-gray-500">{a.reason}</span>
                </li>
              ))}
              {!advice?.length && <li className="text-[10px] text-gray-600">暂无进行中的债务</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ 债务还款清单（已还 / 待还，展开） ============ */
function ScheduleTable({ rows }: { rows: { month: number; payment: number; principal: number; interest: number; remaining: number; date?: string }[] }) {
  return (
    <div className="max-h-44 overflow-y-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-bg-base/80 text-gray-500">
          <tr className="text-left">
            <th className="py-1 pr-2">期</th>
            <th className="py-1 pr-2">月供</th>
            <th className="py-1 pr-2">本金</th>
            <th className="py-1 pr-2">利息</th>
            <th className="py-1 pr-2">剩余</th>
            <th className="py-1 pr-2">实付日</th>
          </tr>
        </thead>
        <tbody className="text-gray-300">
          {rows.map((r) => (
            <tr key={r.month} className="border-t border-bg-border/50">
              <td className="py-1 pr-2">{r.month}</td>
              <td className="py-1 pr-2">{fmt(r.payment)}</td>
              <td className="py-1 pr-2">{fmt(r.principal)}</td>
              <td className="py-1 pr-2">{fmt(r.interest)}</td>
              <td className="py-1 pr-2">{fmt(r.remaining)}</td>
              <td className="py-1 pr-2 text-gray-500">{r.date ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DebtScheduleView({ id }: { id: string }) {
  const { data, isLoading } = trpc.finance.debtSchedule.useQuery({ id });
  const { data: txns } = trpc.finance.transactions.list.useQuery(undefined);
  if (isLoading) return <p className="mt-2 text-xs text-gray-500">计算还款计划中…</p>;
  if (!data) return null;
  const { summary, schedule } = data;

  // 该债务的「还款」流水，按实付日升序，用于标注每期实际还款日期
  const paidTxns = (txns ?? [])
    .filter((t: any) => t.kind === 'debt_payment' && t.debtId === id)
    .sort((a: any, b: any) => a.occurredAt.localeCompare(b.occurredAt));

  // 已还 = 已过期的期数（与已还流水取大，避免自动刷新未跑时低估）
  const paidCount = Math.max(summary.paidMonths, paidTxns.length);
  const paidRows = schedule
    .filter((r: any) => r.month <= paidCount)
    .map((r: any, i: any) => ({ ...r, date: paidTxns[i]?.occurredAt?.slice(0, 10) }));
  const unpaidRows = schedule.filter((r: any) => r.month > paidCount);

  // P0-2 实际已还勾稽：计划已还（按时间口径）vs 实际已还（按真实还款流水）
  const planPaidPrincipal = schedule.slice(0, summary.paidMonths).reduce((s: any, r: any) => s + r.principal, 0);
  const actualPaidPrincipal = paidRows.reduce((s: any, r: any) => s + (r.principal || 0), 0);
  const reconciliationDelta = actualPaidPrincipal - planPaidPrincipal;

  return (
    <div className="mt-2 space-y-2 rounded-md bg-bg-base/60 p-2">
      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-400">
        <div>月供 <span className="text-gray-100">{fmt(summary.monthlyPayment)}</span></div>
        <div>已还 <span className="text-gray-100">{paidCount}/{summary.totalMonths}</span> 期</div>
        <div>当前利率 <span className="text-gray-100">{summary.currentRate}%</span></div>
        <div>实际年化(IRR) <span className="text-sky-300">{summary.irr}%</span></div>
        <div>剩余本金 <span className="text-gray-100">{fmt(summary.remainingPrincipal)}</span></div>
        <div>总利息 <span className="text-amber-300">{fmt(summary.totalInterest)}</span></div>
        <div>总还款 <span className="text-gray-100">{fmt(summary.totalPayment)}</span></div>
        <div>原始本金 <span className="text-gray-100">{fmt(summary.principal)}</span></div>
      </div>

      {/* P0-2 实际已还 vs 计划已还 勾稽 */}
      <div className="rounded-md border border-bg-border/60 bg-bg-base/40 p-2">
        <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-gray-300">
          <Activity size={12} /> 实际已还勾稽（计划 vs 真实流水）
        </div>
        <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500">
          <div>计划已还 <span className="text-gray-300">{fmt(planPaidPrincipal)}</span></div>
          <div>实际已还 <span className="text-emerald-300">{fmt(actualPaidPrincipal)}</span></div>
          <div>
            差异{' '}
            <span className={reconciliationDelta > 0.5 ? 'text-emerald-300' : reconciliationDelta < -0.5 ? 'text-amber-300' : 'text-gray-400'}>
              {reconciliationDelta >= 0 ? '+' : ''}{fmt(reconciliationDelta)}
            </span>
          </div>
        </div>
      </div>

      {/* P1-2 提前还款收益量化 */}
      {summary.interestSaved > 0 && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-emerald-300">
            <PiggyBank size={12} /> 提前还款收益
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500">
            <div>节省利息 <span className="text-emerald-300">{fmt(summary.interestSaved)}</span></div>
            <div>缩短 <span className="text-emerald-300">{summary.termShortened} 期</span></div>
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-emerald-300">
          <Check size={12} /> 已还清单（{paidRows.length} 期）
        </div>
        {paidRows.length ? (
          <ScheduleTable rows={paidRows} />
        ) : (
          <p className="text-[10px] text-gray-600">暂无已还记录</p>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-300">
          <CalendarClock size={12} /> 待还清单（{unpaidRows.length} 期）
        </div>
        {unpaidRows.length ? (
          <ScheduleTable rows={unpaidRows} />
        ) : (
          <p className="text-[10px] text-gray-600">已全部还清 🎉</p>
        )}
      </div>
    </div>
  );
}

/* ============ 债务管理 ============ */
type RateAdjRow = { effectiveDate: string; newRate: string };
type PrepayRow = { date: string; amount: string; type: 'reduce_term' | 'reduce_payment' };
type DebtForm = {
  creditor: string;
  principal: string;
  apr: string;
  dueDay: string;
  debtType: string;
  termMonths: string;
  repaymentMethod: string;
  startDate: string;
  rateType: string;
  baseRate: string;
  rateSpread: string;
  note: string;
  rateAdjustments: RateAdjRow[];
  prepayments: PrepayRow[];
  repricingEnabled: boolean;
  repricingBenchmark: string;
  repricingSpread: string;
  repricingCycle: string;
  repricingAnchor: string;
  repricingFixedDate: string;
};
const emptyDebt: DebtForm = {
  creditor: '',
  principal: '',
  apr: '',
  dueDay: '',
  debtType: 'mortgage',
  termMonths: '',
  repaymentMethod: 'equal_installment',
  startDate: today(),
  rateType: 'fixed',
  baseRate: '',
  rateSpread: '',
  note: '',
  rateAdjustments: [],
  prepayments: [],
  repricingEnabled: false,
  repricingBenchmark: 'LPR_5Y',
  repricingSpread: '',
  repricingCycle: '12',
  repricingAnchor: 'anniversary',
  repricingFixedDate: '',
};

/**
 * 债务可编辑字段（新建与编辑共用）。仅含需求规定的字段：
 * 名称 / 类型 / 还款方式 / 本金 / 利率 / 期限 / 起始日期 / 每月扣款日 /
 * 利率重定价记录(多条) / 提前还款记录(多条) / 备注。
 * 利率重定价与提前还款改用结构化「多条记录」编辑器，替代原先的 JSON 文本框。
 */
function DebtFields({
  value,
  onChange,
}: {
  value: DebtForm;
  onChange: (patch: Partial<DebtForm>) => void;
}) {
  const setRA = (idx: number, patch: Partial<RateAdjRow>) =>
    onChange({ rateAdjustments: value.rateAdjustments.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  const addRA = () => onChange({ rateAdjustments: [...value.rateAdjustments, { effectiveDate: '', newRate: '' }] });
  const delRA = (idx: number) => onChange({ rateAdjustments: value.rateAdjustments.filter((_, i) => i !== idx) });

  const setPP = (idx: number, patch: Partial<PrepayRow>) =>
    onChange({ prepayments: value.prepayments.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });
  const addPP = () => onChange({ prepayments: [...value.prepayments, { date: '', amount: '', type: 'reduce_term' }] });
  const delPP = (idx: number) => onChange({ prepayments: value.prepayments.filter((_, i) => i !== idx) });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input className={inputCls} placeholder="名称" value={value.creditor} onChange={(v) => onChange({ creditor: v.target.value })} />
        <input className={inputCls} placeholder="本金" type="number" value={value.principal} onChange={(v) => onChange({ principal: v.target.value })} />
        <input className={inputCls} placeholder="期限(月)" type="number" value={value.termMonths} onChange={(v) => onChange({ termMonths: v.target.value })} />
        <input className={inputCls} placeholder="每月扣款日" type="number" value={value.dueDay} onChange={(v) => onChange({ dueDay: v.target.value })} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <select className={inputCls} value={value.debtType} onChange={(v) => onChange({ debtType: v.target.value })}>
          {DEBT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select className={inputCls} value={value.repaymentMethod} onChange={(v) => onChange({ repaymentMethod: v.target.value })}>
          {REPAYMENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input className={inputCls} type="date" value={value.startDate} onChange={(v) => onChange({ startDate: v.target.value })} />
        {/* 利率类型 + 对应的利率数值 */}
        <select className={inputCls} value={value.rateType} onChange={(v) => onChange({ rateType: v.target.value })}>
          {RATE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {value.rateType === 'fixed' ? (
          <input className={inputCls} placeholder="利率%" type="number" value={value.apr} onChange={(v) => onChange({ apr: v.target.value })} />
        ) : (
          <>
            <input
              className={inputCls}
              placeholder={value.rateType === 'lpr' ? 'LPR%' : '基准利率%'}
              type="number"
              value={value.baseRate}
              onChange={(v) => onChange({ baseRate: v.target.value })}
            />
            <input
              className={inputCls}
              placeholder={value.rateType === 'lpr' ? '加点(百分点)' : '浮动(百分点)'}
              type="number"
              value={value.rateSpread}
              onChange={(v) => onChange({ rateSpread: v.target.value })}
            />
          </>
        )}
      </div>

      {/* 利率重定价规则（P0-1）：仅 LPR / 基准利率 时可用，引擎据此自动生成各期利率 */}
      {value.rateType !== 'fixed' && (
        <div className="rounded-md bg-bg-base/60 p-2">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <input
              type="checkbox"
              checked={value.repricingEnabled}
              onChange={(v) => onChange({ repricingEnabled: v.target.checked })}
            />
            启用自动重定价（按 LPR / 基准 + 加点，周期重算执行利率）
          </label>
          {value.repricingEnabled && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <select
                className={inputCls}
                value={value.repricingBenchmark}
                onChange={(v) => onChange({ repricingBenchmark: v.target.value })}
              >
                {REPRICING_BENCHMARK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                className={inputCls}
                placeholder="加点(百分点)"
                type="number"
                value={value.repricingSpread}
                onChange={(v) => onChange({ repricingSpread: v.target.value })}
              />
              <select
                className={inputCls}
                value={value.repricingCycle}
                onChange={(v) => onChange({ repricingCycle: v.target.value })}
              >
                {REPRICING_CYCLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                className={inputCls}
                value={value.repricingAnchor}
                onChange={(v) => onChange({ repricingAnchor: v.target.value })}
              >
                {REPRICING_ANCHOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {value.repricingAnchor === 'fixed_date' && (
                <input
                  className={inputCls}
                  type="date"
                  value={value.repricingFixedDate}
                  onChange={(v) => onChange({ repricingFixedDate: v.target.value })}
                />
              )}
            </div>
          )}
        </div>
      )}

      <textarea
        className={inputCls + ' h-12 w-full resize-none'}
        placeholder="备注"
        value={value.note}
        onChange={(v) => onChange({ note: v.target.value })}
      />

      {/* 利率重定价记录（多条） */}
      <div className="rounded-md bg-bg-base/60 p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">利率重定价记录</span>
          <button type="button" className={btnCls} onClick={addRA}><Plus size={12} /> 添加</button>
        </div>
        {value.rateAdjustments.length === 0 && <p className="text-[10px] text-gray-600">暂无（留空则不重定价）</p>}
        {value.rateAdjustments.map((r, idx) => (
          <div key={idx} className="mb-1 flex flex-wrap items-end gap-2">
            <input className={inputCls} type="date" value={r.effectiveDate} onChange={(ev) => setRA(idx, { effectiveDate: ev.target.value })} />
            <input className={inputCls} placeholder="新利率%" type="number" value={r.newRate} onChange={(ev) => setRA(idx, { newRate: ev.target.value })} />
            <button type="button" className={delIconBtn} onClick={() => delRA(idx)}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>

      {/* 提前还款记录（多条） */}
      <div className="rounded-md bg-bg-base/60 p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">提前还款记录</span>
          <button type="button" className={btnCls} onClick={addPP}><Plus size={12} /> 添加</button>
        </div>
        {value.prepayments.length === 0 && <p className="text-[10px] text-gray-600">暂无（留空则无提前还款）</p>}
        {value.prepayments.map((p, idx) => (
          <div key={idx} className="mb-1 flex flex-wrap items-end gap-2">
            <input className={inputCls} type="date" value={p.date} onChange={(ev) => setPP(idx, { date: ev.target.value })} />
            <input className={inputCls} placeholder="金额" type="number" value={p.amount} onChange={(ev) => setPP(idx, { amount: ev.target.value })} />
            <select className={inputCls} value={p.type} onChange={(ev) => setPP(idx, { type: ev.target.value as PrepayRow['type'] })}>
              <option value="reduce_term">缩短期限</option>
              <option value="reduce_payment">减少月供</option>
            </select>
            <button type="button" className={delIconBtn} onClick={() => delPP(idx)}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ 债务表单弹窗（新增 / 编辑） ============ */
function DebtModal({
  mode,
  value,
  onChange,
  trigger,
  onSave,
  open,
  onOpenChange,
  error,
}: {
  mode: 'create' | 'edit';
  value: DebtForm;
  onChange: (patch: Partial<DebtForm>) => void;
  trigger?: React.ReactNode;
  onSave: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error?: string;
}) {
  const [localErr, setLocalErr] = useState('');

  useEffect(() => {
    if (open) setLocalErr('');
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onOpenChange(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  const handleSave = () => {
    if (!value.creditor.trim()) {
      setLocalErr('名称必填');
      return;
    }
    if (!value.principal || parseFloat(value.principal) <= 0) {
      setLocalErr('本金必须大于 0');
      return;
    }
    if (!value.termMonths || parseInt(value.termMonths, 10) <= 0) {
      setLocalErr('期限必须大于 0');
      return;
    }
    if (!value.startDate) {
      setLocalErr('起始日期必填');
      return;
    }
    setLocalErr('');
    onSave();
  };

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <div className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-bg-border bg-bg-panel p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-200">
                {mode === 'create' ? '新增债务' : '编辑债务'}
              </h4>
              <button className={iconBtn} onClick={() => onOpenChange(false)}>
                <X size={16} />
              </button>
            </div>
            <DebtFields value={value} onChange={onChange} />
            {(localErr || error) && (
              <p className="mt-2 text-[11px] text-red-400">{localErr || error}</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button className={btnCls} onClick={() => onOpenChange(false)}>
                <X size={12} /> 取消
              </button>
              <button className={btnCls} onClick={handleSave}>
                {mode === 'create' ? (
                  <><Plus size={12} /> 添加</>
                ) : (
                  <><Check size={12} /> 保存</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DebtPanel() {
  const list = trpc.finance.debts.list.useQuery(undefined);
  const create = trpc.finance.debts.create.useMutation(undefined);
  const close = trpc.finance.debts.close.useMutation();
  const reopen = trpc.finance.debts.reopen.useMutation();
  const update = trpc.finance.debts.update.useMutation(undefined);
  const del = trpc.finance.debts.delete.useMutation(undefined);
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<DebtForm>(emptyDebt);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DebtForm>(emptyDebt);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const num = (s: string) => (s === '' ? undefined : parseFloat(s));

  /**
   * 把利率类型 + 对应数值收集成后端字段：
   *  - 固定利率：用 apr，baseRate/rateSpread 置空
   *  - 基准利率 / LPR：用 baseRate + rateSpread（有效利率 = 二者之和，由引擎计算），apr 置空
   */
  const buildRateInput = (f: DebtForm) => {
    const rt = f.rateType || 'fixed';
    if (rt === 'fixed') {
      return { rateType: 'fixed', apr: num(f.apr) ?? undefined, baseRate: undefined, rateSpread: undefined };
    }
    return {
      rateType: rt,
      apr: undefined,
      baseRate: num(f.baseRate) ?? undefined,
      rateSpread: num(f.rateSpread) ?? undefined,
    };
  };

  /** 把重定价表单收集成后端字段（仅 LPR/基准 且启用时提交） */
  const buildRepricingInput = (f: DebtForm) => {
    if (f.rateType === 'fixed' || !f.repricingEnabled) return { repricing: undefined };
    return {
      repricing: {
        benchmark: f.repricingBenchmark,
        spread: num(f.repricingSpread) ?? 0,
        cycleMonths: parseInt(f.repricingCycle, 10) || 12,
        anchor: f.repricingAnchor,
        fixedDate: f.repricingAnchor === 'fixed_date' ? f.repricingFixedDate : undefined,
      },
    };
  };

  const startEdit = (d: any) => {
    setEditId(d.id);
    setErr('');
    const rp = d.repricing as any;
    setEditForm({
      ...emptyDebt,
      creditor: d.creditor,
      principal: String(d.principal),
      apr: d.apr != null ? String(d.apr) : '',
      dueDay: d.dueDay != null ? String(d.dueDay) : '',
      debtType: d.debtType || 'other',
      termMonths: d.termMonths != null ? String(d.termMonths) : '',
      repaymentMethod: d.repaymentMethod || 'equal_installment',
      startDate: (d.startDate || today()).slice(0, 10),
      rateType: d.rateType || 'fixed',
      baseRate: d.baseRate != null ? String(d.baseRate) : '',
      rateSpread: d.rateSpread != null ? String(d.rateSpread) : '',
      note: d.note || '',
      rateAdjustments: (d.rateAdjustments || []).map((r: any) => ({
        effectiveDate: r.effectiveDate,
        newRate: String(r.newRate),
      })),
      prepayments: (d.prepayments || []).map((p: any) => ({
        date: p.date,
        amount: String(p.amount),
        type: (p.type as 'reduce_term' | 'reduce_payment') || 'reduce_term',
      })),
      repricingEnabled: !!rp,
      repricingBenchmark: rp?.benchmark || 'LPR_5Y',
      repricingSpread: rp?.spread != null ? String(rp.spread) : '',
      repricingCycle: rp?.cycleMonths != null ? String(rp.cycleMonths) : '12',
      repricingAnchor: rp?.anchor || 'anniversary',
      repricingFixedDate: rp?.fixedDate || '',
    });
    setEditOpen(true);
  };

  /** 把结构化表单收集成后端需要的数组（空行/空字段自动忽略） */
  const collectArrays = (f: DebtForm) => {
    const rateAdjustments = f.rateAdjustments
      .filter((r) => r.effectiveDate && r.newRate !== '')
      .map((r) => ({ effectiveDate: r.effectiveDate, newRate: parseFloat(r.newRate) }));
    const prepayments = f.prepayments
      .filter((p) => p.date && p.amount !== '')
      .map((p) => ({ date: p.date, amount: parseFloat(p.amount), type: p.type }));
    return { rateAdjustments, prepayments };
  };

  const saveCreate = () => {
    setErr('');
    const { rateAdjustments, prepayments } = collectArrays(createForm);
    create.mutate(
      {
        creditor: createForm.creditor,
        principal: parseFloat(createForm.principal),
        ...buildRateInput(createForm),
        ...buildRepricingInput(createForm),
        dueDay: clampDay(createForm.dueDay),
        debtType: createForm.debtType,
        termMonths: num(createForm.termMonths),
        repaymentMethod: createForm.repaymentMethod as DebtForm['repaymentMethod'],
        startDate: createForm.startDate,
        note: createForm.note || undefined,
        rateAdjustments,
        prepayments,
      } as any,
      {
        onSuccess: () => {
          setCreateOpen(false);
          setCreateForm(emptyDebt);
          void utils.finance.invalidate();
        },
        onError: (e2: any) => setErr(e2.message),
      },
    );
  };

  const saveEdit = () => {
    if (!editId) return;
    setErr('');
    const { rateAdjustments, prepayments } = collectArrays(editForm);
    update.mutate(
      {
        id: editId,
        creditor: editForm.creditor,
        principal: num(editForm.principal),
        ...buildRateInput(editForm),
        ...buildRepricingInput(editForm),
        dueDay: clampDay(editForm.dueDay),
        debtType: editForm.debtType,
        termMonths: num(editForm.termMonths),
        repaymentMethod: editForm.repaymentMethod as any,
        startDate: editForm.startDate,
        note: editForm.note || undefined,
        rateAdjustments,
        prepayments,
      } as any,
      {
        onSuccess: () => {
          setEditOpen(false);
          setEditId(null);
          setEditForm(emptyDebt);
          void utils.finance.invalidate();
        },
        onError: (e2: any) => setErr(e2.message),
      },
    );
  };

  return (
    <Panel
      title="债务管理"
      icon={Wallet}
      right={
        <div className="flex items-center gap-2">
          <Badge>{list.data?.length ?? 0} 笔</Badge>
          <DebtModal
            mode="create"
            value={createForm}
            onChange={(patch) => setCreateForm({ ...createForm, ...patch })}
            open={createOpen}
            onOpenChange={setCreateOpen}
            onSave={saveCreate}
            error={err}
            trigger={
              <button
                className={btnCls}
                onClick={() => {
                  setErr('');
                  setCreateForm(emptyDebt);
                  setCreateOpen(true);
                }}
              >
                <Plus size={12} /> 新增债务
              </button>
            }
          />
        </div>
      }
    >
      <DebtModal
        mode="edit"
        value={editForm}
        onChange={(patch) => setEditForm({ ...editForm, ...patch })}
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditId(null);
        }}
        onSave={saveEdit}
        error={err}
      />
      <ul className="space-y-1.5">
        {list.data?.map((d: any) => (
          <li key={d.id} className="rounded-md bg-bg-base px-2 py-1.5 text-xs">
            <div>
              <div
                className="flex cursor-pointer items-center gap-2"
                onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                title="点击展开还款清单"
              >
                <span className="text-gray-200">{d.creditor}</span>
                <Badge>{REPAYMENT_LABELS[d.repaymentMethod] ?? d.repaymentMethod}</Badge>
                {RATE_TYPE_LABELS[d.rateType] ? <Badge tone="amber">{RATE_TYPE_LABELS[d.rateType]}</Badge> : null}
                {d.termMonths ? <Badge tone="blue">{d.termMonths}期</Badge> : null}
                <span className="ml-auto font-medium text-gray-100">{fmt(d.principal)}</span>
                <SettleStatusTag
                  settled={d.status === 'paid'}
                  disabled={close.isPending || reopen.isPending}
                  onChange={(next) => {
                    if (next) {
                      if (!window.confirm(`确认将债务「${d.creditor}」标记为结清？`)) return;
                      close.mutate({ id: d.id }, { onSuccess: () => { toast.success('债务已结清'); void utils.finance.invalidate(); }, onError: (e: any) => toast.error(e.message) });
                    } else {
                      reopen.mutate({ id: d.id }, { onSuccess: () => { toast.success('已恢复为未结清'); void utils.finance.invalidate(); }, onError: (e: any) => toast.error(e.message) });
                    }
                  }}
                />
                <button className={iconBtn} title="编辑" onClick={(ev) => { ev.stopPropagation(); startEdit(d); }}><Pencil size={12} /></button>
                <button className={delIconBtn} title="删除" onClick={(ev) => { ev.stopPropagation(); if (window.confirm(`删除债务「${d.creditor}」？`)) del.mutate({ id: d.id }); }}><Trash2 size={12} /></button>
                <span className={iconBtn} title="还款清单">
                  {expanded === d.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </span>
              </div>
              {d.principal > 0 && <DebtProgress id={d.id} />}
              {expanded === d.id && <DebtScheduleView id={d.id} />}
            </div>
          </li>
        ))}
        {!list.data?.length && <li className="text-xs text-gray-600">暂无债务</li>}
      </ul>
    </Panel>
  );
}

/* ============ 收入源 ============ */
type IncomeForm = {
  source: string;
  amount: string;
  incomeType: string;
  monthlyAvg: string;
  isFixed: boolean;
  incomeMode: string;
  payDay: string;
  adjustmentDay: string;
};
const emptyIncome: IncomeForm = {
  source: '',
  amount: '',
  incomeType: 'salary',
  monthlyAvg: '',
  isFixed: true,
  incomeMode: 'monthly',
  payDay: '10',
  adjustmentDay: '',
};

function IncomePanel() {
  const list = trpc.finance.incomes.list.useQuery(undefined);
  const record = trpc.finance.incomes.record.useMutation(undefined);
  const update = trpc.finance.incomes.update.useMutation(undefined);
  const del = trpc.finance.incomes.delete.useMutation(undefined);
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<IncomeForm>(emptyIncome);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [e, setE] = useState<IncomeForm>(emptyIncome);
  const [err, setErr] = useState('');

  const num = (s: string) => (s === '' ? undefined : parseFloat(s));

  const startEdit = (i: any) => {
    setEditId(i.id);
    setE({
      ...emptyIncome,
      source: i.source,
      amount: String(i.amount),
      incomeType: i.incomeType || 'salary',
      monthlyAvg: i.monthlyAvg != null ? String(i.monthlyAvg) : '',
      isFixed: i.isFixed,
      incomeMode: i.incomeMode || 'monthly',
      payDay: i.payDay != null ? String(i.payDay) : '',
      adjustmentDay: i.adjustmentDay != null ? String(i.adjustmentDay) : '',
    });
    setEditOpen(true);
  };
  const saveCreate = () => {
    const amt = parseFloat(form.amount);
    const allowNeg = form.incomeType === 'investment';
    if (!form.source.trim()) { setErr('请填写来源'); return; }
    if (!form.amount || !Number.isFinite(amt)) { setErr('请填写金额'); return; }
    // 「投资收益」允许负数（亏损）；其余收入类型金额须大于 0
    if (!allowNeg && amt <= 0) {
      setErr('非「投资收益」的金额须大于 0（投资收益可填负数表示亏损）');
      return;
    }
    setErr('');
    record.mutate(
      {
        source: form.source,
        amount: amt,
        receivedAt: today(),
        incomeType: form.incomeType as any,
        monthlyAvg: num(form.monthlyAvg),
        isFixed: form.isFixed,
        incomeMode: form.incomeMode as any,
        payDay: clampDay(form.payDay),
        adjustmentDay: clampDay(form.adjustmentDay),
      } as any,
      { onSuccess: () => { setCreateOpen(false); setForm(emptyIncome); setErr(''); void utils.finance.invalidate(); } },
    );
  };
  const saveEdit = (id: string) => {
    update.mutate(
      {
        id,
        source: e.source,
        monthlyAvg: num(e.monthlyAvg),
        isFixed: e.isFixed,
        incomeMode: e.incomeMode as any,
        payDay: clampDay(e.payDay),
        adjustmentDay: clampDay(e.adjustmentDay),
      } as any,
      { onSuccess: () => { setEditOpen(false); setEditId(null); void utils.finance.invalidate(); } },
    );
  };

  return (
    <Panel
      title="收入源"
      icon={PiggyBank}
      right={
        <div className="flex items-center gap-2">
          <Badge tone="green">{list.data?.length ?? 0} 源</Badge>
          <button className={btnCls} onClick={() => { setForm(emptyIncome); setCreateOpen(true); }}>
            <Plus size={12} /> 新增
          </button>
        </div>
      }
    >
      <ul className="space-y-1.5">
        {list.data?.map((i: any) => (
          <li key={i.id} className="rounded-md bg-bg-base px-2 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-gray-200">{i.source}</span>
              <Badge tone="green">{i.incomeMode === 'monthly' ? '月度' : '一次性'}</Badge>
              {i.monthlyAvg != null && <span className="text-[10px] text-gray-500">月均 {fmt(i.monthlyAvg)}</span>}
              {i.payDay != null && <span className="text-[10px] text-gray-500">{i.payDay}日发</span>}
              <span className="ml-auto font-medium text-emerald-400">{fmt(i.amount)}</span>
              <button className={iconBtn} title="编辑" onClick={() => startEdit(i)}><Pencil size={12} /></button>
              <button className={delIconBtn} title="删除" onClick={() => { if (window.confirm(`删除收入源「${i.source}」？`)) del.mutate({ id: i.id }); }}><Trash2 size={12} /></button>
            </div>
          </li>
        ))}
        {!list.data?.length && <li className="text-xs text-gray-600">暂无收入源</li>}
      </ul>

      <ModalShell
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新增收入源"
        footer={
          <>
            <button className={btnCls} onClick={() => setCreateOpen(false)}><X size={12} /> 取消</button>
            <button className={btnCls} onClick={saveCreate}><Plus size={12} /> 记一笔</button>
          </>
        }
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input className={inputCls} placeholder="来源" value={form.source} onChange={(v) => setForm({ ...form, source: v.target.value })} />
            <input className={inputCls} placeholder="本月金额" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v.target.value })} />
            <input className={inputCls} placeholder="月均" type="number" value={form.monthlyAvg} onChange={(v) => setForm({ ...form, monthlyAvg: v.target.value })} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <select className={inputCls} value={form.incomeType} onChange={(v) => setForm({ ...form, incomeType: v.target.value })}>
              {INCOME_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select className={inputCls} value={form.incomeMode} onChange={(v) => setForm({ ...form, incomeMode: v.target.value })}>
              <option value="monthly">月度</option>
              <option value="single">一次性</option>
            </select>
            <input className={inputCls} placeholder="发放日" type="number" value={form.payDay} onChange={(v) => setForm({ ...form, payDay: v.target.value })} />
          </div>
          {err && <p className="text-[11px] text-red-400">{err}</p>}
        </div>
      </ModalShell>

      <ModalShell
        open={editOpen}
        onClose={() => { setEditOpen(false); setEditId(null); }}
        title="编辑收入源"
        footer={
          <>
            <button className={btnCls} onClick={() => { setEditOpen(false); setEditId(null); }}><X size={12} /> 取消</button>
            <button className={btnCls} onClick={() => saveEdit(editId!)}><Check size={12} /> 保存</button>
          </>
        }
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <input className={inputCls} value={e.source} onChange={(v) => setE({ ...e, source: v.target.value })} placeholder="来源" />
            <input className={inputCls} placeholder="月均" type="number" value={e.monthlyAvg} onChange={(v) => setE({ ...e, monthlyAvg: v.target.value })} />
            <input className={inputCls} placeholder="发放日" type="number" value={e.payDay} onChange={(v) => setE({ ...e, payDay: v.target.value })} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <select className={inputCls} value={e.incomeMode} onChange={(v) => setE({ ...e, incomeMode: v.target.value })}>
              <option value="monthly">月度</option>
              <option value="single">一次性</option>
            </select>
            <label className="flex items-center gap-1 text-[11px] text-gray-400">
              <input type="checkbox" checked={e.isFixed} onChange={(v) => setE({ ...e, isFixed: v.target.checked })} /> 固定
            </label>
          </div>
        </div>
      </ModalShell>
    </Panel>
  );
}

/* ============ 交易流水 ============ */
function TransactionPanel() {
  const list = trpc.finance.transactions.list.useQuery(undefined);
  const record = trpc.finance.transactions.record.useMutation(undefined);
  const update = trpc.finance.transactions.update.useMutation(undefined);
  const del = trpc.finance.transactions.delete.useMutation(undefined);
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<'expense' | 'income' | 'debt_payment'>('expense');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [e, setE] = useState({ kind: 'expense' as 'expense' | 'income' | 'debt_payment', category: '', amount: '', note: '' });

  const startEdit = (t: any) => {
    setEditId(t.id);
    setE({ kind: t.kind, category: t.category, amount: String(t.amount), note: t.note });
    setEditOpen(true);
  };
  const saveCreate = () => {
    if (!category.trim() || !amount || parseFloat(amount) <= 0) return;
    record.mutate({ kind, category, amount: parseFloat(amount), occurredAt: today() } as any, {
      onSuccess: () => { setCategory(''); setAmount(''); setCreateOpen(false); void utils.finance.invalidate(); },
    });
  };
  const saveEdit = (id: string) => {
    update.mutate(
      { id, kind: e.kind, category: e.category, amount: parseFloat(e.amount), note: e.note } as any,
      { onSuccess: () => { setEditOpen(false); setEditId(null); void utils.finance.invalidate(); } },
    );
  };

  const kindLabel = (k: string) => (k === 'expense' ? '支' : k === 'debt_payment' ? '还' : '收');
  const kindTone = (k: string) => (k === 'expense' ? 'text-red-400' : k === 'debt_payment' ? 'text-amber-300' : 'text-emerald-400');

  return (
    <Panel
      title="交易流水"
      icon={Receipt}
      right={
        <button className={btnCls} onClick={() => setCreateOpen(true)}>
          <Plus size={12} /> 记一笔
        </button>
      }
    >
      <ul className="space-y-1.5">
        {list.data?.map((t: any) => (
          <li key={t.id} className="rounded-md bg-bg-base px-2 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className={`rounded bg-bg-raised px-1 text-[10px] text-gray-400`}>{kindLabel(t.kind)}</span>
              <span className="text-gray-200">{t.category}</span>
              <span className="text-[10px] text-gray-500">{t.occurredAt}</span>
              <span className={`ml-auto font-medium ${kindTone(t.kind)}`}>{fmt(t.amount)}</span>
              <button className={iconBtn} title="编辑" onClick={() => startEdit(t)}><Pencil size={12} /></button>
              <button className={delIconBtn} title="删除" onClick={() => { if (window.confirm(`删除流水「${t.category}」？`)) del.mutate({ id: t.id }); }}><Trash2 size={12} /></button>
            </div>
          </li>
        ))}
        {!list.data?.length && <li className="text-xs text-gray-600">暂无流水</li>}
      </ul>

      <ModalShell
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="记一笔流水"
        footer={
          <>
            <button className={btnCls} onClick={() => setCreateOpen(false)}><X size={12} /> 取消</button>
            <button className={btnCls} onClick={saveCreate}><Plus size={12} /> 记一笔</button>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <select className={inputCls} value={kind} onChange={(v) => setKind(v.target.value as any)}>
            <option value="expense">支出</option>
            <option value="income">收入</option>
            <option value="debt_payment">还款</option>
          </select>
          <input className={inputCls} placeholder="分类" value={category} onChange={(v) => setCategory(v.target.value)} />
          <input className={inputCls} placeholder="金额" type="number" value={amount} onChange={(v) => setAmount(v.target.value)} />
        </div>
      </ModalShell>

      <ModalShell
        open={editOpen}
        onClose={() => { setEditOpen(false); setEditId(null); }}
        title="编辑流水"
        footer={
          <>
            <button className={btnCls} onClick={() => { setEditOpen(false); setEditId(null); }}><X size={12} /> 取消</button>
            <button className={btnCls} onClick={() => saveEdit(editId!)}><Check size={12} /> 保存</button>
          </>
        }
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <select className={inputCls} value={e.kind} onChange={(v) => setE({ ...e, kind: v.target.value as any })}>
              <option value="expense">支出</option>
              <option value="income">收入</option>
              <option value="debt_payment">还款</option>
            </select>
            <input className={inputCls} value={e.category} onChange={(v) => setE({ ...e, category: v.target.value })} placeholder="分类" />
            <input className={inputCls} type="number" value={e.amount} onChange={(v) => setE({ ...e, amount: v.target.value })} placeholder="金额" />
          </div>
        </div>
      </ModalShell>
    </Panel>
  );
}

/* ============ 资产总览 ============ */
function AssetPanel() {
  const list = trpc.finance.assets.list.useQuery(undefined);
  const record = trpc.finance.assets.record.useMutation(undefined);
  const update = trpc.finance.assets.update.useMutation(undefined);
  const del = trpc.finance.assets.delete.useMutation(undefined);
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [assetClass, setAssetClass] = useState<string>('cash');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [e, setE] = useState({ value: '', asOf: today() });

  const startEdit = (a: any) => {
    setEditId(a.id);
    setE({ value: String(a.value), asOf: (a.asOf || today()).slice(0, 10) });
    setEditOpen(true);
  };
  const saveCreate = () => {
    if (!name.trim() || !value || parseFloat(value) <= 0) return;
    record.mutate({ name, value: parseFloat(value), assetClass: assetClass as any, asOf: today() } as any, {
      onSuccess: () => { setName(''); setValue(''); setCreateOpen(false); void utils.finance.invalidate(); },
    });
  };
  const saveEdit = (id: string) => {
    update.mutate(
      { id, value: parseFloat(e.value), asOf: new Date(e.asOf).toISOString() } as any,
      { onSuccess: () => { setEditOpen(false); setEditId(null); void utils.finance.invalidate(); } },
    );
  };

  return (
    <Panel
      title="资产总览"
      icon={Landmark}
      right={
        <div className="flex items-center gap-2">
          <Badge>{list.data?.length ?? 0} 项</Badge>
          <button className={btnCls} onClick={() => setCreateOpen(true)}>
            <Plus size={12} /> 添加
          </button>
        </div>
      }
    >
      <ul className="space-y-1.5">
        {list.data?.map((a: any) => (
          <li key={a.id} className="rounded-md bg-bg-base px-2 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-gray-200">{a.name}</span>
              <Badge>{ASSET_CLASS_OPTIONS.find((o) => o.value === a.assetClass)?.label ?? a.assetClass}</Badge>
              <span className="ml-auto font-medium text-gray-100">{fmt(a.value)}</span>
              <button className={iconBtn} title="编辑" onClick={() => startEdit(a)}><Pencil size={12} /></button>
              <button className={delIconBtn} title="删除" onClick={() => { if (window.confirm(`删除资产「${a.name}」？`)) del.mutate({ id: a.id }); }}><Trash2 size={12} /></button>
            </div>
          </li>
        ))}
        {!list.data?.length && <li className="text-xs text-gray-600">暂无资产</li>}
      </ul>

      <ModalShell
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新增资产"
        footer={
          <>
            <button className={btnCls} onClick={() => setCreateOpen(false)}><X size={12} /> 取消</button>
            <button className={btnCls} onClick={saveCreate}><Plus size={12} /> 添加</button>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <input className={inputCls} placeholder="名称" value={name} onChange={(v) => setName(v.target.value)} />
          <input className={inputCls} placeholder="市值" type="number" value={value} onChange={(v) => setValue(v.target.value)} />
          <select className={inputCls} value={assetClass} onChange={(v) => setAssetClass(v.target.value)}>
            {ASSET_CLASS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </ModalShell>

      <ModalShell
        open={editOpen}
        onClose={() => { setEditOpen(false); setEditId(null); }}
        title="编辑资产市值"
        footer={
          <>
            <button className={btnCls} onClick={() => { setEditOpen(false); setEditId(null); }}><X size={12} /> 取消</button>
            <button className={btnCls} onClick={() => saveEdit(editId!)}><Check size={12} /> 保存</button>
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          <input className={inputCls} type="number" value={e.value} onChange={(v) => setE({ ...e, value: v.target.value })} placeholder="市值" />
          <input className={inputCls} type="date" value={e.asOf} onChange={(v) => setE({ ...e, asOf: v.target.value })} />
        </div>
      </ModalShell>
    </Panel>
  );
}

/* ============ 账目核对 + 报表导出 ============ */
function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ReconcileExportPanel() {
  // tRPC v11 类型未暴露 enabled，运行期合法
  const reconcileQ = trpc.finance.reconcile.useQuery(undefined, { enabled: false } as any);
  const [exportArg, setExportArg] = useState<{ format: 'csv' | 'json' } | null>(null);
  // tRPC v11 类型未暴露 enabled，运行期合法
  const exportQ = trpc.finance.exportReport.useQuery(exportArg as any, { enabled: exportArg !== null } as any);
  const result = reconcileQ.data;

  useEffect(() => {
    if (exportQ.data) {
      downloadFile(exportQ.data.filename, exportQ.data.content);
      toast.success(`已导出 ${exportQ.data.filename}`);
    }
  }, [exportQ.data]);

  return (
    <Panel
      title="账目核对 · 报表导出"
      icon={Activity}
      right={
        <button
          className={btnCls}
          disabled={reconcileQ.isFetching}
          onClick={() => reconcileQ.refetch()}
        >
          <RefreshCw size={12} className={reconcileQ.isFetching ? 'animate-spin' : ''} /> 账目核对
        </button>
      }
    >
      {result ? (
        result.balanced ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            <Check size={14} /> 账目平衡（净资产 {fmt(result.netWorth)}，资产 {fmt(result.assetsTotal)}，负债 {fmt(result.debtsTotal)}）
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle size={14} /> 发现 {result.discrepancies.length} 处账目差异
            </div>
            <ul className="space-y-1">
              {result.discrepancies.map((d: any, i: number) => (
                <li key={i} className="rounded-md bg-bg-base px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone="amber">{d.scope}</Badge>
                    <span className="ml-auto text-gray-400">差额 {fmt(d.diff)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-400">{d.message}</div>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <p className="text-xs text-gray-600">点击「账目核对」检查资产负债与还款流水一致性</p>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-bg-border/60 pt-3">
        <span className="text-[11px] text-gray-500">导出报表：</span>
        <button
          className={btnCls}
          disabled={exportQ.isFetching}
          onClick={() => setExportArg({ format: 'csv' })}
        >
          <Download size={12} /> CSV
        </button>
        <button
          className={btnCls}
          disabled={exportQ.isFetching}
          onClick={() => setExportArg({ format: 'json' })}
        >
          <Download size={12} /> JSON
        </button>
      </div>
    </Panel>
  );
}

export function FinancePage() {
  const autoRefresh = trpc.finance.autoRefresh.useMutation(undefined);
  const utils = trpc.useUtils();
  const [shareOpen, setShareOpen] = useState(false);
  const collaborative = useCollaborative();
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-100">
          <Wallet size={18} className="text-accent" /> 财务中心
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <DebtProgressPopover />
          {collaborative && (
            <button
              className={`${SHARE_BTN}`}
              type="button"
              onClick={() => setShareOpen(true)}
              title="把选中的财务数据共享到家庭看板"
            >
              <Share2 size={12} /> 共享到家庭
            </button>
          )}
          <button
            className={btnCls}
            disabled={autoRefresh.isPending}
            onClick={() =>
              autoRefresh.mutate(undefined, {
                onSuccess: () => void utils.finance.invalidate(),
              })
            }
          >
            <RefreshCw size={12} className={autoRefresh.isPending ? 'animate-spin' : ''} />
            {autoRefresh.isPending ? '生成中…' : '自动刷新本月'}
          </button>
        </div>
      </div>
      {autoRefresh.data && (
        <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-accent">
          <AlertCircle size={14} /> 已生成本月流水：收入 {autoRefresh.data.incomes} 笔，还款 {autoRefresh.data.debts} 笔，跳过 {autoRefresh.data.skipped} 笔
        </div>
      )}
      <SummaryCards />
      <ReconcileExportPanel />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DebtPanel />
        <IncomePanel />
        <AssetPanel />
        <TransactionPanel />
        <TrendPanel />
        <BudgetPanel />
      </div>
      {collaborative && <FinanceShareConfig open={shareOpen} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
