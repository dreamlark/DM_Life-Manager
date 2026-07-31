import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { trpcLocal as trpc } from '../../lib/trpcLocal';
import { cn } from '../../lib/cn';
import type { EffortBudget, InterestSource } from '@dm-life/shared';

const EFFORTS: { value: EffortBudget; label: string }[] = [
  { value: '30min', label: '30 分钟' },
  { value: '3h', label: '3 小时' },
  { value: 'sustained', label: '持续投入' },
  { value: 'tbd', label: '暂不确定' },
];
const SOURCES: { value: InterestSource; label: string }[] = [
  { value: 'manual', label: '自主灵感' },
  { value: 'project', label: '由项目触发' },
  { value: 'thought', label: '某个思考' },
  { value: 'note', label: '关联笔记' },
];

/** 捕捉灵感/兴趣：先落入孵化器，不直接进任务或笔记。经审查后再决定去向。 */
export function InterestCaptureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: domains = [] } = trpc.domains.list.useQuery(undefined);
  const { data: projects = [] } = trpc.projects.list.useQuery(undefined);
  const capture = trpc.interests.capture.useMutation();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [attention, setAttention] = useState(1);
  const [effort, setEffort] = useState<EffortBudget>('tbd');
  const [source, setSource] = useState<InterestSource>('manual');
  const [sourceRef, setSourceRef] = useState('');
  const [domainKey, setDomainKey] = useState('');

  useEffect(() => {
    if (open) {
      setTitle('');
      setContent('');
      setAttention(1);
      setEffort('tbd');
      setSource('manual');
      setSourceRef('');
      setDomainKey('');
    }
  }, [open]);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    capture.mutate({
      title: t,
      content: content.trim() || undefined,
      attention,
      effortBudget: effort,
      sourceType: source,
      sourceRef: source === 'project' && sourceRef ? sourceRef : null,
      domainKey: domainKey || null,
    }, { onSuccess: () => { utils.interests.list.invalidate(); utils.interests.review.invalidate(); onClose(); } });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[520px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-bg-border bg-bg-raised p-5 shadow-2xl">
          <Dialog.Title className="text-sm font-semibold text-gray-100">捕捉灵感 / 兴趣</Dialog.Title>
          <Dialog.Description className="mt-0.5 text-xs text-gray-500">
            先进孵化器，不直接进任务或笔记。经审查后再决定去向。
          </Dialog.Description>

          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder="一句话灵感 / 想读的文章 / 想学的技能"
            className="mt-3 w-full rounded-lg bg-bg-base px-3 py-2 text-sm text-gray-100 outline-none ring-accent/40 focus:ring-2"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="原始内容（想法、链接、摘要…）"
            rows={3}
            className="mt-2 w-full resize-none rounded-lg bg-bg-base px-3 py-2 text-sm text-gray-100 outline-none ring-accent/40 focus:ring-2"
          />

          <div className="mt-3 flex items-center gap-2">
            <span className="shrink-0 text-xs text-gray-400">初始关注度</span>
            <div className="flex gap-1">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAttention(n)}
                  className={cn('transition-transform hover:scale-110', attention >= n ? 'text-accent' : 'text-gray-600')}
                  title={`${n} 星`}
                >
                  <Star size={16} fill={attention >= n ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-400">
              精力预算
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value as EffortBudget)}
                className="mt-1 w-full rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none"
              >
                {EFFORTS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-400">
              来源
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as InterestSource)}
                className="mt-1 w-full rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none"
              >
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {source === 'project' && (
              <label className="text-xs text-gray-400">
                触发项目
                <select
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none"
                >
                  <option value="">—</option>
                  {projects.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-xs text-gray-400">
              领域
              <select
                value={domainKey}
                onChange={(e) => setDomainKey(e.target.value)}
                className="mt-1 w-full rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none"
              >
                <option value="">—</option>
                {domains.map((d: any) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black hover:opacity-90"
            >
              捕捉
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
