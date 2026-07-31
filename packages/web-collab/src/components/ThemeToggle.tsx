import { Sun, Moon, Monitor } from 'lucide-react';
import { useUI } from '../store/uiStore';

/**
 * 主题切换按钮（家庭协作视图使用）。
 * 复用全局 uiStore 作为唯一主题真相（含 system），实际明暗应用与持久化统一在 App 顶层完成，
 * 与「设置 → 外观」及个人视图顶栏按钮保持一致，避免主题状态分裂。
 */
export function ThemeToggle() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);

  // 三态循环：浅色 → 深色 → 跟随系统 → 浅色
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const label = theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统';

  return (
    <button
      className="icon-btn magnetic flex h-7 w-7 items-center justify-center rounded-md border border-bg-border bg-bg-raised text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
      title={`主题：${label}（点击切换）`}
      onClick={() => setTheme(next)}
      type="button"
    >
      <Icon size={15} />
    </button>
  );
}
