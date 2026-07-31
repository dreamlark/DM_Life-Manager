// 领域平衡 → 家庭共享：候选共享项 + 快照构建器（module='domains'）。
// 平衡轮快照自带领域名/时长/色，自包含。server 仅存快照，不回源 engine。
import type { SelectedShareItem, ShareCandidate } from '../shared/types';

export interface WheelItem {
  key: string;
  name: string;
  minutes: number;
  score: number;
  color?: string;
}
export interface BalanceWheelSnapshot {
  week?: string;
  wheel: WheelItem[];
  topStresses: string[];
}

/** 用某周平衡轮，产出左池候选项（总览 + 每个领域） */
export function buildDomainCandidates(wheel: BalanceWheelSnapshot | undefined): ShareCandidate[] {
  const items = wheel?.wheel ?? [];
  const out: ShareCandidate[] = [];
  out.push({
    itemType: 'overview',
    itemKey: '*',
    label: `本周领域平衡（${items.length} 个领域）`,
    group: '总览',
  });
  for (const w of items) {
    out.push({
      itemType: 'domain',
      itemKey: w.key,
      label: w.name,
      group: '领域',
    });
  }
  return out;
}

/** 根据候选项与最新平衡轮，构建某项的快照（供保存/重推使用） */
export function domainSnapshotFor(sel: SelectedShareItem, wheel: BalanceWheelSnapshot | undefined): unknown {
  const items = wheel?.wheel ?? [];
  if (sel.itemType === 'overview') {
    const total = items.reduce((a, w) => a + w.minutes, 0);
    return {
      week: wheel?.week ?? null,
      totalMinutes: total,
      wheel: items,
      topStresses: wheel?.topStresses ?? [],
      updatedAt: new Date().toISOString(),
    };
  }
  const w = items.find((x) => x.key === sel.itemKey) ?? ({} as WheelItem);
  return {
    name: w.name,
    minutes: w.minutes,
    score: w.score,
    color: w.color,
    updatedAt: new Date().toISOString(),
  };
}
