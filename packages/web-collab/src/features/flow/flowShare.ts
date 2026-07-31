// 心流 → 家庭共享：候选共享项 + 快照构建器（module='flow'）。
// 心流是聚合分析（无独立条目），故共享「我的专注概览」聚合快照即可。server 仅存快照，不回源 engine。
import type { FlowSummaryQuery } from '@dm-life/shared';
import type { SelectedShareItem, ShareCandidate } from '../shared/types';

/** 用最新专注概览，产出左池候选项（单条：我的专注概览） */
export function buildFlowCandidates(summary: unknown): ShareCandidate[] {
  const ins = (summary as { insights?: any })?.insights;
  const label = ins
    ? `专注 ${ins.totalSessions ?? 0} 段 · 均分 ${ins.avgScore != null ? Number(ins.avgScore).toFixed(1) : '—'}`
    : '我的专注概览';
  return [
    {
      itemType: 'overview',
      itemKey: '*',
      label,
      group: '总览',
    },
  ];
}

/** 根据候选项与最新概览，构建快照（供保存/重推使用） */
export function flowSnapshotFor(_sel: SelectedShareItem, summary: unknown): unknown {
  const ins = (summary as { insights?: any })?.insights ?? {};
  return {
    totalSessions: ins.totalSessions ?? 0,
    avgScore: ins.avgScore ?? null,
    avgEnergyEnd: ins.avgEnergyEnd ?? null,
    goldenHour: ins.goldenHour ?? null,
    topDomains: ins.topDomains ?? [],
    pseudoWork: ins.pseudoWork ?? [],
    updatedAt: new Date().toISOString(),
  };
}

/** 共享默认用的概览查询参数（与个人模式默认一致） */
export const FLOW_SHARE_QUERY: FlowSummaryQuery = { range: 'week', unit: 'hour', axis: 'domain' };
