// 灵感孵化器 → 家庭共享：候选共享项 + 快照构建器（module='interests'）。
// 设计见通用 shared_items 桥接。server 仅存快照，不回源 engine，故快照须自包含。
import type { InterestView } from '@dm-life/shared';
import type { SelectedShareItem, ShareCandidate } from '../shared/types';

/** 汇总本地灵感，产出左池候选项（总览 + 每条灵感） */
export function buildInterestsCandidates(all: InterestView[]): ShareCandidate[] {
  const arr = all ?? [];
  const out: ShareCandidate[] = [];
  const incubating = arr.filter((i) => i.status === 'incubating').length;
  out.push({
    itemType: 'overview',
    itemKey: '*',
    label: `共 ${arr.length} 条灵感（孵化中 ${incubating}）`,
    group: '总览',
  });
  for (const i of arr) {
    out.push({
      itemType: 'interest',
      itemKey: String(i.id),
      label: i.title,
      group: '我的灵感',
    });
  }
  return out;
}

/** 根据候选项与最新本地数据，构建某项的快照（供保存/重推使用） */
export function interestsSnapshotFor(sel: SelectedShareItem, all: InterestView[]): unknown {
  const arr = all ?? [];
  if (sel.itemType === 'overview') {
    const by: Record<string, number> = {};
    for (const i of arr) by[i.status] = (by[i.status] ?? 0) + 1;
    return {
      total: arr.length,
      byStatus: by,
      updatedAt: new Date().toISOString(),
    };
  }
  const i = arr.find((x) => String(x.id) === sel.itemKey) ?? ({} as InterestView);
  return {
    title: i.title,
    content: (i.content ?? '').slice(0, 1000),
    status: i.status,
    attention: i.attention,
    effortBudget: i.effortBudget,
    sourceType: i.sourceType,
    retentionIndex: i.retentionIndex,
    domainKey: i.domainKey,
    ageDays: i.ageDays,
    updatedAt: new Date().toISOString(),
  };
}
