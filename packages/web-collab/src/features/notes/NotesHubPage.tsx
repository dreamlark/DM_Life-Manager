import { useMemo, useState } from 'react';
import { Lightbulb, NotebookPen, Plus, Link2, Pencil, Trash2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { trpcLocal as trpc } from '../../lib/trpcLocal';
import { relTime, type NoteView, type NoteKind } from '@dm-life/shared';
import { NoteFormModal } from './NoteFormModal';
import { NotesShareConfig } from './NotesShareConfig';
import { SHARE_BTN } from '../shared/shareButton';
import { useCollaborative } from '../../store/modeStore';

/** 把笔记正文（含 ![alt](src) 图片语法）渲染为 React 节点。仅放行 data:image / http(s) 链接，避免 XSS。 */
function renderBody(body: string) {
  const parts: React.ReactNode[] = [];
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(body)) !== null) {
    if (m.index > lastIndex) {
      parts.push(
        <span key={key++} className="whitespace-pre-wrap">
          {body.slice(lastIndex, m.index)}
        </span>,
      );
    }
    const [full, alt] = m;
    const src = m[2] ?? '';
    if (/^(data:image\/|https?:\/\/)/i.test(src)) {
      parts.push(
        <img
          key={key++}
          src={src}
          alt={alt}
          className="my-2 max-h-48 w-auto rounded-lg border border-bg-border object-contain"
        />,
      );
    } else {
      parts.push(
        <span key={key++} className="whitespace-pre-wrap">
          {full}
        </span>,
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < body.length) {
    parts.push(
      <span key={key++} className="whitespace-pre-wrap">
        {body.slice(lastIndex)}
      </span>,
    );
  }
  return parts;
}

export function NoteCard({
  note,
  taskTitle,
  onEdit,
}: {
  note: NoteView;
  taskTitle?: string;
  onEdit: (n: NoteView) => void;
}) {
  const del = trpc.notes.delete.useMutation(undefined);
  const utils = trpc.useUtils();

  return (
    <article className="flex flex-col rounded-xl border border-bg-border bg-bg-panel p-3">
      <div className="mb-1 flex items-start gap-2">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
            note.kind === 'notebook'
              ? 'bg-accent/15 text-accent'
              : 'bg-amber-400/15 text-amber-300'
          }`}
        >
          {note.kind === 'notebook' ? '记事' : '灵感'}
        </span>
        <h4 className="flex-1 text-sm font-medium text-gray-100">{note.title}</h4>
        <span className="shrink-0 text-[10px] text-gray-500">{relTime(note.createdAt)}</span>
        <button
          className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:text-accent"
          title="编辑"
          onClick={() => onEdit(note)}
        >
          <Pencil size={12} />
        </button>
        <button
          className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:text-red-400"
          title="删除"
          onClick={() => {
            if (window.confirm(`删除「${note.title}」？此操作不可撤销。`)) {
              del.mutate(
                { id: note.id },
                { onSuccess: () => void utils.notes.list.invalidate() },
              );
            }
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {note.bodyMarkdown && (
        <div className="mb-2 text-xs leading-relaxed text-gray-400">{renderBody(note.bodyMarkdown)}</div>
      )}
      {taskTitle && <div className="mb-1 text-[11px] text-accent">🔗 关联任务：{taskTitle}</div>}
      {(note.tags.length > 0 || note.links.length > 0) && (
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {note.tags.map((t) => (
            <span key={t} className="rounded-full bg-bg-raised px-2 py-0.5 text-[10px] text-accent">
              #{t}
            </span>
          ))}
          {note.links.map((l) => {
            // 存储型 XSS 防护：仅允许 http(s)/mailto 协议，过滤 javascript:/data: 等危险链接
            const safe = /^https?:\/\//i.test(l) || /^mailto:/i.test(l);
            if (!safe) return null;
            return (
              <a
                key={l}
                href={l}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-0.5 rounded-full bg-bg-raised px-2 py-0.5 text-[10px] text-gray-400 hover:text-accent"
              >
                <Link2 size={9} /> 链接
              </a>
            );
          })}
        </div>
      )}
    </article>
  );
}

const createBtn =
  'ml-auto flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:opacity-90';

type Filter = 'all' | NoteKind;

export function NotesHubPage() {
  const { data: ideaNotes = [] } = trpc.notes.list.useQuery({ kind: 'idea' });
  const { data: notebookNotes = [] } = trpc.notes.list.useQuery({ kind: 'notebook' });
  const { data: tasks = [] } = trpc.tasks.today.useQuery(undefined);
  const [filter, setFilter] = useState<Filter>('all');
  const [createKind, setCreateKind] = useState<NoteKind | null>(null);
  const [editNote, setEditNote] = useState<NoteView | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const collaborative = useCollaborative();

  // 任务 id → 标题，用于记事本卡片展示「关联任务」
  const taskTitleById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tasks) map[t.id] = t.title;
    return map;
  }, [tasks]);

  // 按筛选聚合；全部时合并两类并按创建时间倒序
  const notes = useMemo<NoteView[]>(() => {
    const list =
      filter === 'idea'
        ? ideaNotes
        : filter === 'notebook'
          ? notebookNotes
          : [...notebookNotes, ...ideaNotes];
    return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [filter, ideaNotes, notebookNotes]);

  const segBtn = (id: Filter, label: string) => (
    <button
      onClick={() => setFilter(id)}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        filter === id ? 'bg-bg-raised text-accent' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold text-gray-100">灵感 · 记事本</h2>
        <span className="text-xs text-gray-500">灵感沉淀想法，记事本承载任务详情与拆解</span>
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
          <button className={createBtn} onClick={() => setCreateKind('idea')}>
            <Lightbulb size={13} /> 新建灵感
          </button>
          <button className={createBtn} onClick={() => setCreateKind('notebook')}>
            <NotebookPen size={13} /> 新建记事
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {segBtn('all', '全部')}
        {segBtn('idea', '灵感')}
        {segBtn('notebook', '记事本')}
        <span className="ml-auto text-[11px] text-gray-500">
          灵感 {ideaNotes.length} · 记事 {notebookNotes.length}
        </span>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-bg-border bg-bg-panel/50 py-12 text-center text-sm text-gray-600">
          <NotebookPen size={28} className="text-gray-500" />
          {filter === 'notebook'
            ? '还没有记事，把某个任务的详情、规划或拆解写在这里吧'
            : filter === 'idea'
              ? '还没有灵感，点右上角「新建灵感」记录第一条 ✦'
              : '还没有内容，用右上角按钮记录灵感或记事吧 ✦'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              taskTitle={n.kind === 'notebook' && n.taskId ? taskTitleById[n.taskId] : undefined}
              onEdit={setEditNote}
            />
          ))}
        </div>
      )}

      {/* 新建：根据所点按钮决定 kind 与是否显示关联任务 */}
      <NoteFormModal
        open={createKind !== null}
        onClose={() => setCreateKind(null)}
        defaultKind={createKind ?? 'idea'}
        showTaskSelect={createKind === 'notebook'}
        title={createKind === 'notebook' ? '新建记事' : '新建灵感'}
      />
      {/* 编辑：按笔记自身 kind 决定是否显示关联任务 */}
      <NoteFormModal
        open={!!editNote}
        onClose={() => setEditNote(null)}
        defaultKind={(editNote?.kind as NoteKind) ?? 'idea'}
        showTaskSelect={editNote?.kind === 'notebook'}
        note={editNote ?? undefined}
        title={editNote?.kind === 'notebook' ? '编辑记事' : '编辑灵感'}
      />

      {/* 共享到家庭配置面板 */}
      {collaborative && <NotesShareConfig open={shareOpen} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
