// 任务 → 家庭共享：候选共享项 + 快照构建器（module='task'）。
// 设计见通用 shared_items 桥接。server 仅存快照，不回源 engine，故快照须自包含。
import type { TaskView } from '@dm-life/shared';
import type { SelectedShareItem, ShareCandidate } from '../shared/types';
import { QUADRANTS } from '@dm-life/shared';

/** 汇总本地任务（排除每日例行模板，模板本身不入共享清单），产出左池候选项（总览 + 按象限分组） */
export function buildTaskCandidates(tasks: TaskView[]): ShareCandidate[] {
  const out: ShareCandidate[] = [];
  const usable = (tasks ?? []).filter((t) => t.repeat !== 'daily');
  out.push({ itemType: 'overview', itemKey: '*', label: `共 ${usable.length} 个任务`, group: '总览' });
  for (const q of QUADRANTS) {
    const items = usable.filter((t) => t.quadrant === q.key);
    for (const t of items) {
      out.push({ itemType: 'task', itemKey: String(t.id), label: t.title, group: q.title });
    }
  }
  return out;
}

/** 根据候选项与最新本地数据，构建某项的快照（供保存/重推使用） */
export function taskSnapshotFor(sel: SelectedShareItem, tasks: TaskView[]): unknown {
  if (sel.itemType === 'overview') {
    const usable = (tasks ?? []).filter((t) => t.repeat !== 'daily');
    return {
      total: usable.length,
      done: usable.filter((t) => t.status === 'done').length,
      updatedAt: new Date().toISOString(),
    };
  }
  const t = ((tasks ?? []) as any[]).find((x) => String(x.id) === sel.itemKey) ?? {};
  return {
    title: t.title,
    quadrant: t.quadrant,
    importance: t.importance,
    urgency: t.urgency,
    domainKey: t.domainKey,
    status: t.status,
    priority: t.priority,
    scheduledStart: t.scheduledStart,
    description: t.description,
    updatedAt: new Date().toISOString(),
  };
}
