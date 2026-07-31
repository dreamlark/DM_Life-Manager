import type { ReactNode } from 'react';

export type IconTone = 'indigo' | 'pink' | 'emerald' | 'amber' | 'sky' | 'violet' | 'rose';
export type IconSize = 'sm' | 'md' | 'lg';

/**
 * 立体浮空「彩绘」图标容器：玻璃质感外壳 + 渐变光晕 + 多层立体阴影 + 缓慢悬浮动画。
 * 内部可放 emoji（天然彩色「彩绘」字形）或 lucide 图标。用于品牌 / 板块 / 关键操作入口，
 * 让整套图标在浅色与深色下都呈现统一的「浮空 3D」高级观感，告别扁平线性图标的廉价感。
 */
export function FloatingIcon({
  icon,
  tone = 'indigo',
  size = 'md',
  float = true,
  className = '',
}: {
  icon: ReactNode;
  tone?: IconTone;
  size?: IconSize;
  float?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`floating-icon fi-${size} fi-glass tone-${tone}${float ? '' : ' fi-static'}${
        className ? ' ' + className : ''
      }`}
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}
