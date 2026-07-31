import { useMemo, useState } from 'react';
import {
  FlaskConical,
  Star,
  Archive,
  Trash2,
  CheckCircle2,
  Rocket,
  Plus,
  ScanSearch,
  ListChecks,
  ArrowLeft,
  Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import { trpcLocal as trpc } from '../../lib/trpcLocal';
import { cn } from '../../lib/cn';
import { relTime, type InterestView, type InterestStatus, type EffortBudget, type InterestSource } from '@dm-life/shared';
import { InterestCaptureModal } from './InterestCaptureModal';
import { InterestShareConfig } from './InterestShareConfig';
import { SHARE_BTN } from '../shared/shareButton';
import { useCollaborative } from '../../store/modeStore';

/* 状态 / 来源 / 精力预算 的中文标签与配色，集中维护，避免散落。 */
const STATUS_LABEL: Record<InterestStatus, string> = {
  incubating: '孵化中',
  validated: '已验证',
  converted: '已转化',
  archived: '已归档',
  discarded: '已丢弃',
};
const STATUS_BADGE: Record<InterestStatus, string> = {
  incubating: 'bg-amber-400/15 text-amber-300',
  validated: 'bg-emerald-400/15 text-emerald-300',
  converted: 'bg-sky-400/15 text-sky-300',
  archived: 'bg-gray-400/15 text-gray-400',
  discarded: 'bg-red-400/15 text-red-300',
};
const SOURCE_LABEL: Record<InterestSource, string> = {
  manual: '自主灵感',
  project: '项目触发',
  thought: '某个思考',
  note: '关联笔记',
};
const EFFORT_LABEL: Record<EffortBudget, string> = {
  '30min': '30 分钟',
  '3h': '3 小时',
  sustained: '持续投入',
  tbd: '暂不确定',
};

const TABS: { key: 'all' | InterestStatus; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'incubating', label: '孵化中' },
  { key: 'validated', label: '已验证' },
  { key: 'converted', label: '已转化' },
  { key: 'archived', label: '已归档' },
  { key: 'discarded', label: '已丢弃' },
];

function retentionColor(v: number): string {
  if (v < 30) return 'bg-red-500';
  if (v < 60) return 'bg-amber-400';
  return 'bg-emerald-400';
}

/** 兴趣卡片：列表模式与审查模式共用，审查模式额外渲染 4 个快速决策按钮。 */
function InterestCard({
  item,
  domainName,
  projectName,
  mode,
  onValidate,
  onConvert,
  onArchive,
  onDiscard,
}: {
  item: InterestView;
  domainName?: string;
  projectName?: string;
  mode: 'list' | 'review';
  onValidate: (id: string) => void;
  onConvert: (id: string) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const lowRetention = item.discardSuggestion;
  return (
    <article
      className={cn(
        'flex flex-col rounded-xl border bg-bg-panel p-3 transition-colors',
        lowRetention ? 'border-red-500/40 ring-1 ring-red-500/30' : 'border-bg-border',
      )}
    >
      <div className="mb-1.5 flex items-start gap-2">
        <h4 className="flex-1 text-sm font-medium leading-snug text-gray-100">{item.title}</h4>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px]', STATUS_BADGE[item.status])}>
          {STATUS_LABEL[item.status]}
        </span>
      </div>

      {item.content && (
        <p className="mb-2 line-clamp-3 text-xs leading-relaxed text-gray-400">{item.content}</p>
      )}

      {/* 关注度 */}
      <div className="mb-1.5 flex items-center gap-1">
        {[1, 2, 3].map((n) => (
          <Star
            key={n}
            size={12}
            className={item.attention >= n ? 'text-accent' : 'text-gray-600'}
            fill={item.attention >= n ? 'currentColor' : 'none'}
          />
        ))}
        <span className="ml-1 text-[10px] text-gray-500">初始关注度</span>
      </div>

      {/* 元信息 */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
        <span>精力：{EFFORT_LABEL[item.effortBudget]}</span>
        <span>来源：{SOURCE_LABEL[item.sourceType]}</span>
        {domainName && <span className="text-accent/80">领域：{domainName}</span>}
        {item.sourceType === 'project' && projectName && <span>项目：{projectName}</span>}
        {item.linkedNoteCount > 0 && <span>🔗 笔记×{item.linkedNoteCount}</span>}
      </div>

      {/* 留存指数条 */}
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] text-gray-500">留存</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-raised">
          <div className={cn('h-full rounded-full', retentionColor(item.retentionIndex))} style={{ width: `${item.retentionIndex}%` }} />
        </div>
        <span className="text-[10px] tabular-nums text-gray-400">{item.retentionIndex}</span>
      </div>

      <div className="flex items-center justify-between text-[10px] text-gray-600">
        <span>孵化 {item.ageDays} 天</span>
        <span>{relTime(item.createdAt)}</span>
      </div>

      {item.linkedTaskId && item.status === 'validated' && (
        <div className="mt-1 text-[10px] text-emerald-300/80">✓ 已生成验证任务</div>
      )}
      {item.linkedProjectId && item.status === 'converted' && (
        <div className="mt-1 text-[10px] text-sky-300/80">✓ 已转化为项目</div>
      )}

      {lowRetention && (
        <div className="mt-2 rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
          留存指数偏低，建议丢弃或尽快转化。
        </div>
      )}

      {/* 审查模式的 4 个快速决策 */}
      {mode === 'review' && (
        <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-bg-border pt-2.5">
          <button
            onClick={() => onValidate(item.id)}
            className="flex items-center justify-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1.5 text-[11px] text-emerald-300 transition hover:bg-emerald-500/25"
          >
            <CheckCircle2 size={12} /> 验证
          </button>
          <button
            onClick={() => onConvert(item.id)}
            className="flex items-center justify-center gap-1 rounded-md bg-sky-500/15 px-2 py-1.5 text-[11px] text-sky-300 transition hover:bg-sky-500/25"
          >
            <Rocket size={12} /> 转化
          </button>
          <button
            onClick={() => onArchive(item.id)}
            className="flex items-center justify-center gap-1 rounded-md bg-bg-raised px-2 py-1.5 text-[11px] text-gray-300 transition hover:text-gray-100"
          >
            <Archive size={12} /> 归档
          </button>
          <button
            onClick={() => onDiscard(item.id)}
            className="flex items-center justify-center gap-1 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300 transition hover:bg-red-500/20"
          >
            <Trash2 size={12} /> 丢弃
          </button>
        </div>
      )}
    </article>
  );
}

const createBtn =
  'flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:opacity-90';

export function IncubatorPage() {
  const utils = trpc.useUtils();
  const { data: all = [] } = trpc.interests.list.useQuery(undefined);
  const { data: domains = [] } = trpc.domains.list.useQuery(undefined);
  const { data: projects = [] } = trpc.projects.list.useQuery(undefined);

  const [mode, setMode] = useState<'list' | 'review'>('list');
  const [filter, setFilter] = useState<'all' | InterestStatus>('all');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const collaborative = useCollaborative();

  // 审查模式：只取孵化中、按推荐权重排序
  const { data: reviewData = [] } = trpc.interests.review.useQuery(
    { status: 'incubating' },
    // tRPC v11 类型未暴露 enabled，运行期合法
    { enabled: mode === 'review' } as any,
  );

  const validate = trpc.interests.validate.useMutation();
  const convert = trpc.interests.convert.useMutation();
  const setStatus = trpc.interests.setStatus.useMutation();

  const onArchive = (id: string) => setStatus.mutate({ id, status: 'archived' }, { onSuccess: () => { void utils.interests.list.invalidate(); void utils.interests.review.invalidate(); }, onError: (e: any) => toast.error(`操作失败：${e.message}`) });
  const onDiscard = (id: string) => {
    if (window.confirm('丢弃该兴趣？丢弃后可在「已丢弃」标签找回（重新孵化需后端支持）。')) {
      setStatus.mutate({ id, status: 'discarded' }, { onSuccess: () => { void utils.interests.list.invalidate(); void utils.interests.review.invalidate(); }, onError: (e: any) => toast.error(`操作失败：${e.message}`) });
    }
  };

  const domainName = (key?: string | null) => domains.find((d: any) => d.key === key)?.name;
  const projectName = (id?: string | null) => projects.find((p: any) => p.id === id)?.name;

  const counts = useMemo(() => {
    const c: Record<'all' | InterestStatus, number> = {
      all: all.length,
      incubating: 0,
      validated: 0,
      converted: 0,
      archived: 0,
      discarded: 0,
    };
    for (const i of all) c[i.status as keyof typeof c] += 1;
    return c;
  }, [all]);

  const filtered = filter === 'all' ? all : all.filter((i: any) => i.status === filter);
  const items = mode === 'review' ? reviewData : filtered;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-gray-100">
          <FlaskConical size={16} className="text-accent" /> 灵感孵化器
        </h2>
        <span className="text-xs text-gray-500">捕捉的灵感先进孵化器，经审查再决定去向</span>

        <div className="ml-auto flex items-center gap-2">
          {collaborative && (
            <button
              className={`${SHARE_BTN}`}
              onClick={() => setShareOpen(true)}
              title="共享到家庭"
            >
              <Share2 size={13} /> 共享到家庭
            </button>
          )}
          {mode === 'review' ? (
            <button
              onClick={() => setMode('list')}
              className="flex items-center gap-1 rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs text-gray-300 transition hover:text-gray-100"
            >
              <ArrowLeft size={13} /> 退出审查
            </button>
          ) : (
            <button
              onClick={() => {
                setMode('review');
                setFilter('all');
              }}
              disabled={counts.incubating === 0}
              className="flex items-center gap-1.5 rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs text-gray-200 transition hover:border-accent/50 hover:text-accent disabled:opacity-40"
              title={counts.incubating === 0 ? '暂无孵化中的兴趣' : '按推荐优先级逐一决策'}
            >
              <ScanSearch size={13} /> 开始审查（{counts.incubating}）
            </button>
          )}
          <button className={createBtn} onClick={() => setCaptureOpen(true)}>
            <Plus size={13} /> 捕捉灵感
          </button>
        </div>
      </div>

      {/* 状态筛选 tab（审查模式隐藏，审查只看孵化中） */}
      {mode === 'list' && (
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
                filter === t.key ? 'bg-bg-raised text-accent' : 'text-gray-400 hover:text-gray-200',
              )}
            >
              {t.label}
              <span className="rounded-full bg-bg-raised/80 px-1.5 text-[10px] tabular-nums text-gray-500">
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>
      )}

      {mode === 'review' && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-gray-300">
          <ListChecks size={14} className="text-accent" />
          按推荐优先级排序（隐性关注、季度重点、高关注度、低留存靠前）。对每条做 验证 / 转化 / 归档 / 丢弃 决策。
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-bg-border bg-bg-panel/50 py-12 text-center text-sm text-gray-600">
          {mode === 'review'
            ? '孵化中的兴趣已审查完毕 🎉'
            : '这里还没有灵感，点右上角「捕捉灵感」记录第一条 ✦'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item: any) => (
            <InterestCard
              key={item.id}
              item={item}
              mode={mode}
              domainName={domainName(item.domainKey)}
              projectName={projectName(item.sourceRef)}
              onValidate={(id) => validate.mutate({ id }, { onSuccess: () => { void utils.interests.list.invalidate(); void utils.interests.review.invalidate(); toast.success('已验证，并生成一条 30 分钟验证任务'); }, onError: (e: any) => toast.error(`验证失败：${e.message}`) })}
              onConvert={(id) => convert.mutate({ id }, { onSuccess: () => { void utils.interests.list.invalidate(); void utils.interests.review.invalidate(); toast.success('已转化为 PARA 项目'); }, onError: (e: any) => toast.error(`转化失败：${e.message}`) })}
              onArchive={onArchive}
              onDiscard={onDiscard}
            />
          ))}
        </div>
      )}

      <InterestCaptureModal open={captureOpen} onClose={() => setCaptureOpen(false)} />
      {collaborative && <InterestShareConfig open={shareOpen} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
