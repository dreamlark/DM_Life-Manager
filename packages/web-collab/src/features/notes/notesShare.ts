// 灵感·记事 → 家庭共享：候选共享项 + 快照构建器（module='notes'）。
// 设计见通用 shared_items 桥接。server 仅存快照，不回源 engine，故快照须自包含。
import type { NoteView } from '@dm-life/shared';
import type { SelectedShareItem, ShareCandidate } from '../shared/types';

/** 汇总本地笔记，产出左池候选项（总览 + 每条笔记） */
export function buildNotesCandidates(notes: NoteView[]): ShareCandidate[] {
  const arr = notes ?? [];
  const out: ShareCandidate[] = [];
  const idea = arr.filter((n) => n.kind === 'idea').length;
  const notebook = arr.filter((n) => n.kind === 'notebook').length;
  out.push({
    itemType: 'overview',
    itemKey: '*',
    label: `共 ${arr.length} 条（灵感 ${idea} / 记事 ${notebook}）`,
    group: '总览',
  });
  for (const n of arr) {
    out.push({
      itemType: 'note',
      itemKey: String(n.id),
      label: n.title,
      group: n.kind === 'notebook' ? '记事本' : '灵感',
    });
  }
  return out;
}

/** 根据候选项与最新本地数据，构建某项的快照（供保存/重推使用） */
export function notesSnapshotFor(sel: SelectedShareItem, notes: NoteView[]): unknown {
  const arr = notes ?? [];
  if (sel.itemType === 'overview') {
    return {
      total: arr.length,
      idea: arr.filter((n) => n.kind === 'idea').length,
      notebook: arr.filter((n) => n.kind === 'notebook').length,
      updatedAt: new Date().toISOString(),
    };
  }
  const n = arr.find((x) => String(x.id) === sel.itemKey) ?? ({} as NoteView);
  return {
    title: n.title,
    kind: n.kind,
    // 正文可能很长，截断到 2000 字符以控制共享快照体积
    bodyMarkdown: (n.bodyMarkdown ?? '').slice(0, 2000),
    tags: n.tags ?? [],
    links: n.links ?? [],
    taskId: n.taskId ?? null,
    createdAt: n.createdAt,
    updatedAt: new Date().toISOString(),
  };
}
