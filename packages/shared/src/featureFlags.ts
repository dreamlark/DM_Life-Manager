/**
 * 功能开关（预留增量升级能力）
 *
 * 默认全部关闭。新特性先合并后端契约 + feature flag = false，
 * 前端 / 移动端按 flag 决定是否暴露 UI，做到「升级不影响现有使用与数据」。
 * 后续阶段把对应 flag 翻为 true 即可灰度开放，无需改动数据结构或迁移。
 */
export const FEATURE_FLAGS = {
  /** 金额互转：后端契约（schema / 迁移 / command / router）已就绪，前端 UI 在 P4 开放 */
  transfer: false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

/** 读取某个功能是否开放（预留给前端/移动端运行时判断） */
export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  return Boolean(FEATURE_FLAGS[key]);
}
