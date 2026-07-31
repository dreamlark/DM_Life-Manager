// 提醒 → 家庭共享：候选共享项 + 快照构建器（module='reminder'）。
// 设计见通用 shared_items 桥接。server 仅存快照，不回源 engine，故快照须自包含。
import { relTime } from '@dm-life/shared';
import type { SelectedShareItem, ShareCandidate } from '../shared/types';

/** 汇总本地提醒数据，产出左池候选项（总览 + 每只钟） */
export function buildReminderCandidates(clocks: any[]): ShareCandidate[] {
  const out: ShareCandidate[] = [];
  const active = (clocks ?? []).filter((c) => c.status !== 'done');
  out.push({
    itemType: 'overview',
    itemKey: '*',
    label: `共 ${active.length} 只钟在跑`,
    group: '总览',
  });
  for (const c of clocks ?? []) {
    const next = c.status === 'done' ? '已完成' : relTime(c.nextFireAt);
    out.push({
      itemType: 'clock',
      itemKey: String(c.id),
      label: `${c.title} · ${next}`,
      group: '我的钟',
    });
  }
  return out;
}

/** 根据候选项与最新本地数据，构建某项的快照（供保存/重推使用） */
export function reminderSnapshotFor(sel: SelectedShareItem, clocks: any[]): unknown {
  if (sel.itemType === 'overview') {
    const arr = clocks ?? [];
    const active = arr.filter((c) => c.status !== 'done');
    return {
      total: arr.length,
      active: active.length,
      due: arr.filter((c) => c.status === 'due').length,
      overdue: arr.filter((c) => c.status === 'overdue').length,
      updatedAt: new Date().toISOString(),
    };
  }
  const c = (clocks ?? []).find((x) => String(x.id) === sel.itemKey) ?? {};
  return {
    title: c.title,
    periodRule: c.periodRule,
    nextFireAt: c.nextFireAt,
    status: c.status,
    domainKey: c.domainKey,
    noteLinked: c.noteLinked ?? null,
    updatedAt: new Date().toISOString(),
  };
}
