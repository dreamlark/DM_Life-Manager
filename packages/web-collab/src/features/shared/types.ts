// 通用「个人模块 → 家庭共享」类型契约（提醒/记事/脑图/心流/领域… 复用）。
// 与 server 的 shared_items 表 + sharedItems router 一一对应。

export type ShareScope = 'all' | 'specific';

/** 配置面板左池的一个候选共享项（来自个人本地数据） */
export interface ShareCandidate {
  itemType: string; // 模块内子类型，如 reminder 的 'clock' / 'overview'
  itemKey: string; // 实体 id 或 '*'（聚合）
  label: string;
  group: string; // 分组标题
}

/** 已选中的共享项（含权限范围） */
export interface SelectedShareItem {
  itemType: string;
  itemKey: string;
  label: string;
  scope: ShareScope;
  allowedUserIds: string[];
}

/** server 返回的共享项视图（snapshot 为 any，由各模块自行解释） */
export interface SharedItemView {
  id: string;
  familyId: string;
  ownerUserId: string;
  module: string;
  itemType: string;
  itemKey: string;
  label: string;
  scope: ShareScope;
  allowedUserIds: string[];
  snapshot: any;
  done?: boolean;
  note?: string | null;
  updatedAt: string;
}
