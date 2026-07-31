/** 四象限（艾森豪威尔矩阵）定义与映射。engine 与 web 共用，避免漂移。 */

export type QuadrantKey = 'q1' | 'q2' | 'q3' | 'q4';

export interface QuadrantMeta {
  key: QuadrantKey;
  title: string;
  hint: string;
  /** Tailwind 边框色，用于看板四象限容器描边 */
  cls: string;
  importance: boolean;
  urgency: boolean;
}

export const QUADRANTS: QuadrantMeta[] = [
  { key: 'q1', title: '重要且紧急', hint: '立即做', cls: 'border-red-500/40', importance: true, urgency: true },
  { key: 'q2', title: '重要不紧急', hint: '计划做', cls: 'border-amber-500/40', importance: true, urgency: false },
  { key: 'q3', title: '紧急不重要', hint: '委托', cls: 'border-sky-500/40', importance: false, urgency: true },
  { key: 'q4', title: '不重要不紧急', hint: '减少', cls: 'border-gray-600/40', importance: false, urgency: false },
];

/** 四象限 → 任务 importance/urgency 标志 */
export function quadrantFlags(q: QuadrantKey): { importance: boolean; urgency: boolean } {
  const meta = QUADRANTS.find((x) => x.key === q) ?? QUADRANTS[0]!;
  return { importance: meta.importance, urgency: meta.urgency };
}

/** 默认的「新建任务」象限（可被用户自定义覆盖，存 localStorage） */
export const DEFAULT_QUADRANT: QuadrantKey = 'q1';
