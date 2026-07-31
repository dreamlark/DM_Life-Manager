import { useRef, useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Link2, Tag, Image as ImageIcon, X, Check, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { trpcLocal as trpc } from '../../lib/trpcLocal';
import type { NoteView, NoteKind } from '@dm-life/shared';

const inputCls =
  'w-full rounded-md bg-bg-base px-2.5 py-2 text-sm text-gray-100 outline-none ring-accent/30 transition focus:ring-2';
const btnCls =
  'flex items-center justify-center gap-1.5 rounded-md border border-bg-border bg-bg-raised px-3.5 py-2 text-xs font-medium text-gray-200 transition hover:border-accent/50 disabled:opacity-40';
const iconBtn =
  'flex items-center justify-center gap-1.5 rounded-md bg-bg-base px-2.5 py-2 text-xs text-gray-300 transition hover:text-accent';

interface NoteFormModalProps {
  open: boolean;
  onClose: () => void;
  defaultKind: NoteKind;
  title: string;
  /** 传入则为编辑模式，否则为新建 */
  note?: NoteView;
  /** 是否显示「关联任务」选择（记事本用） */
  showTaskSelect?: boolean;
}

/**
 * 灵感和记事本的「新建 / 编辑」共用弹窗（个人模式 · 复制自 packages/web，仅改写数据客户端为 trpcLocal）。
 * 通过 key 在每次打开时重新挂载，确保表单字段以当前 note 正确初始化。
 */
export function NoteFormModal({
  open,
  onClose,
  defaultKind,
  title,
  note,
  showTaskSelect,
}: NoteFormModalProps) {
  const isEdit = !!note;
  const ingest = trpc.notes.ingest.useMutation(undefined);
  const update = trpc.notes.update.useMutation(undefined);
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  // tRPC v11 类型未暴露 enabled，运行期合法
  const { data: tasks = [] } = trpc.tasks.today.useQuery(undefined, {
    enabled: showTaskSelect && open,
  } as any);

  const [titleState, setTitleState] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.bodyMarkdown ?? '');
  const [tags, setTags] = useState((note?.tags ?? []).join(', '));
  const [links, setLinks] = useState((note?.links ?? []).join(' '));
  const [taskId, setTaskId] = useState(note?.taskId ?? '');

  // 每次打开弹窗时重置表单：修复「新建灵感后再次新建记事，编辑框残留上次内容」的问题。
  // 新建模式下 note 为 undefined，key 恒为 'create'，Dialog 不会重新挂载，故需显式重置。
  useEffect(() => {
    if (!open) return;
    setTitleState(note?.title ?? '');
    setBody(note?.bodyMarkdown ?? '');
    setTags((note?.tags ?? []).join(', '));
    setLinks((note?.links ?? []).join(' '));
    setTaskId(note?.taskId ?? '');
  }, [open, note]);

  const splitList = (v: string) =>
    v
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('图片过大，请控制在 2MB 以内');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n' : ''}![${file.name}](${dataUrl})\n`);
      toast.success('图片已插入到正文');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const busy = ingest.isPending || update.isPending;

  const submit = () => {
    if (!titleState.trim()) {
      toast.error('标题不能为空');
      return;
    }
    const payload = {
      title: titleState.trim(),
      bodyMarkdown: body.trim(),
      tags: splitList(tags),
      links: splitList(links),
      taskId: showTaskSelect ? taskId || null : (undefined as string | null | undefined),
    };
    if (isEdit && note) {
      update.mutate(
        { id: note.id, ...payload },
        {
          onSuccess: () => {
            toast.success('已更新');
            void utils.notes.list.invalidate();
            onClose();
          },
        },
      );
    } else {
      ingest.mutate(
        { ...payload, kind: defaultKind },
        {
          onSuccess: () => {
            toast.success('已保存');
            void utils.notes.list.invalidate();
            onClose();
          },
        },
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          // key 让每次打开重新挂载，表单以当前 note 初始化
          key={note?.id ?? 'create'}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[92vw] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-bg-border bg-bg-raised shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-bg-border px-5 py-3.5">
            {isEdit ? (
              <Pencil size={16} className="text-accent" />
            ) : (
              <Plus size={16} className="text-accent" />
            )}
            <Dialog.Title className="text-sm font-semibold text-gray-100">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">
              {isEdit ? '编辑' : '新建'}
              {defaultKind === 'notebook' ? '记事' : '灵感'}的标题、正文、标签与关联
            </Dialog.Description>
            <button
              className="ml-auto rounded-md p-1 text-gray-500 transition hover:bg-bg-base hover:text-gray-200"
              onClick={onClose}
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3 overflow-y-auto px-5 py-4">
            <input
              className={inputCls}
              placeholder="标题…"
              value={titleState}
              onChange={(e) => setTitleState(e.target.value)}
              autoFocus
            />
            <textarea
              className={`${inputCls} min-h-[140px] resize-y leading-relaxed`}
              placeholder="展开记录（支持 Markdown，可插入图片）"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <div className="flex flex-1 items-center gap-1.5 rounded-md bg-bg-base px-2.5">
                <Tag size={13} className="shrink-0 text-gray-500" />
                <input
                  className="w-full bg-transparent py-2 text-xs text-gray-100 outline-none"
                  placeholder="标签（逗号分隔）"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </div>
              <div className="flex flex-1 items-center gap-1.5 rounded-md bg-bg-base px-2.5">
                <Link2 size={13} className="shrink-0 text-gray-500" />
                <input
                  className="w-full bg-transparent py-2 text-xs text-gray-100 outline-none"
                  placeholder="关联链接（空格分隔）"
                  value={links}
                  onChange={(e) => setLinks(e.target.value)}
                />
              </div>
              <button type="button" onClick={() => fileRef.current?.click()} className={iconBtn} title="插入图片">
                <ImageIcon size={13} /> 图片
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
            </div>

            {showTaskSelect && (
              <select className={inputCls} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">关联任务（可选）</option>
                {tasks.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button className={btnCls} onClick={onClose} disabled={busy}>
                <X size={13} /> 取消
              </button>
              <button
                className="flex items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:opacity-90 disabled:opacity-40"
                onClick={submit}
                disabled={busy || !titleState.trim()}
              >
                <Check size={13} /> {isEdit ? '保存修改' : '保存'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
