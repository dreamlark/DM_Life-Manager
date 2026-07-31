import type { ReactNode } from 'react';
import { FloatingIcon, type IconTone } from './FloatingIcon';

/**
 * 统一应用顶栏（最终方案 P1 · UI 收敛）
 * 个人模式（LocalApp）与协作模式共用同一套顶栏视觉，确保两种模式风格一致。
 * 仅使用 theme.css 的中性令牌 + Tailwind 工具类，跨主题/跨模式安全。
 */
export function AppTopBar({
  title,
  brandIcon = '🏠',
  brandTone = 'emerald' as IconTone,
  onBack,
  backLabel = '个人',
  right,
}: {
  title: string;
  brandIcon?: string;
  brandTone?: IconTone;
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
}) {
  return (
    <header className="dm-topbar">
      <div className="dm-topbar-left">
        <FloatingIcon icon={brandIcon} tone={brandTone} size="sm" />
        <span className="dm-brand">{title}</span>
        {onBack && (
          <button
            className="rounded-md px-2.5 py-1 text-xs text-gray-400 transition-colors hover:text-gray-200"
            type="button"
            title="返回个人功能（保留协作模式设置）"
            onClick={onBack}
          >
            {backLabel}
          </button>
        )}
      </div>
      <div className="dm-topbar-right">{right}</div>
    </header>
  );
}
