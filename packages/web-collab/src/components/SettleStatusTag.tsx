import { useState } from 'react';

export interface SettleStatusTagProps {
  /** 当前是否已结清（受控） */
  settled: boolean;
  /** 状态变更回调，参数为切换后的目标状态 */
  onChange: (settled: boolean) => void;
  /** 是否禁用交互 */
  disabled?: boolean;
  /** 尺寸：sm 紧凑（列表行内用），md 标准 */
  size?: 'sm' | 'md';
  /** 附加类名 */
  className?: string;
}

/**
 * 结清状态标签组件
 * - 已结清：绿底绿字；未结清：红底红字，文字与状态同步
 * - 点击即在两种状态间切换，并触发 onChange 回调通知父组件
 * - 切换时提供「缩放 + 高亮环」过渡反馈，点击区清晰可识别
 * - 响应式：字号 / 触控区随 size 适配，桌面与移动端均可点
 */
export function SettleStatusTag({
  settled,
  onChange,
  disabled = false,
  size = 'sm',
  className = '',
}: SettleStatusTagProps) {
  const [pulsing, setPulsing] = useState(false);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    // 在「冒泡阶段」阻止事件冒泡到父级行（避免触发行展开/收起）。
    // 注意：绝不能在捕获阶段 stopPropagation —— 否则 React 会跳过本元素自身的
    // onClick，导致点击无响应（这正是此前「点击结清标签没反应」的根因）。
    e.stopPropagation();
    // 立即给出视觉脉冲反馈，再通知父组件落库
    setPulsing(true);
    window.setTimeout(() => setPulsing(false), 350);
    onChange(!settled);
  };

  const sizeCls =
    size === 'sm'
      ? 'px-2 py-0.5 text-[10px] min-w-[3.25rem]'
      : 'px-3 py-1 text-xs min-w-[4rem]';

  const palette = settled
    ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/25'
    : 'bg-rose-500/15 text-rose-300 ring-rose-500/30 hover:bg-rose-500/25';

  const feedback = pulsing
    ? 'scale-105 ring-2 ring-offset-1 ring-offset-bg-base'
    : 'scale-100 ring-1';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={settled}
      disabled={disabled}
      onClick={handleClick}
      title={settled ? '已结清 · 点击改为未结清' : '未结清 · 点击改为已结清'}
      className={[
        'inline-flex select-none items-center justify-center gap-1.5 rounded-full font-medium',
        'cursor-pointer transition-all duration-300 ease-out active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        sizeCls,
        palette,
        feedback,
        disabled ? 'cursor-not-allowed opacity-50' : '',
        className,
      ].join(' ')}
    >
      <span
        className={[
          'h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300',
          settled ? 'bg-emerald-400' : 'bg-rose-400',
        ].join(' ')}
      />
      {settled ? '已结清' : '未结清'}
    </button>
  );
}
