// 思维导图 → 家庭共享：候选共享项 + 快照构建器（module='mindmap'）。
// 脑图纯属本地数据（localStorage，无 engine API），故 fetchBagFresh 直接读 loadStore()。
// 设计见通用 shared_items 桥接。server 仅存快照，不回源 engine，故快照须自包含（含完整 MindElixirData）。
import { loadStore, type MindMapStore } from './mindMapStorage';
import type { SelectedShareItem, ShareCandidate } from '../shared/types';

/** 汇总本地脑图，产出左池候选项（总览 + 每张脑图） */
export function buildMindmapCandidates(store: MindMapStore): ShareCandidate[] {
  const maps = store?.maps ?? [];
  const out: ShareCandidate[] = [];
  out.push({
    itemType: 'overview',
    itemKey: '*',
    label: `共 ${maps.length} 张脑图`,
    group: '总览',
  });
  for (const m of maps) {
    out.push({
      itemType: 'map',
      itemKey: m.id,
      label: m.name,
      group: '我的脑图',
    });
  }
  return out;
}

/** 根据候选项与最新本地数据，构建某项的快照（供保存/重推使用） */
export function mindmapSnapshotFor(sel: SelectedShareItem, store: MindMapStore): unknown {
  const maps = store?.maps ?? [];
  if (sel.itemType === 'overview') {
    return {
      total: maps.length,
      updatedAt: new Date().toISOString(),
    };
  }
  const m = maps.find((x) => x.id === sel.itemKey) ?? ({} as (typeof maps)[number]);
  return {
    name: m.name,
    data: m.data,
    updatedAt: new Date().toISOString(),
  };
}
