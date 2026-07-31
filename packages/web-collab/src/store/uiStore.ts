import { create } from 'zustand';
import { DEFAULT_QUADRANT, type QuadrantKey } from '@dm-life/shared';
import { todayStr } from '@dm-life/shared';
import type { Tab } from '../lib/tabs';
import { TAB_ORDER } from '../lib/tabs';

export type Theme = 'dark' | 'light' | 'system';

/** 读取系统是否偏好深色（跟随系统时用于解析实际明暗） */
export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 把主题偏好（含 system）解析为「是否深色」 */
export function resolveIsDark(theme: Theme): boolean {
  if (theme === 'system') return getSystemPrefersDark();
  return theme === 'dark';
}

/** 把主题应用到 <html>：切换 .dark / .light 类（单一应用入口，App 顶层调用） */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dark = resolveIsDark(theme);
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
}

export type FontScale = 'small' | 'standard' | 'large' | 'xlarge';

/** 把字号档位写到 <html data-font-scale>，由 styles.css 的 html[data-font-scale] 选择器驱动根字号 */
export function applyFontScale(scale: FontScale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-font-scale', scale);
}

function getInitialFontScale(): FontScale {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('dm-font-scale');
      if (v === 'small' || v === 'standard' || v === 'large' || v === 'xlarge') return v;
    }
  } catch {
    /* 隐私模式忽略 */
  }
  return 'standard';
}

function getInitialTheme(): Theme {
  // 单一主题真相：以 localStorage['dm-theme'] 为准。
  // 未显式设置时默认「跟随系统」（更贴合多显示器/多时段场景）。
  // 已选过 dark/light/system 的用户保持原设置，向后兼容。
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('dm-theme');
      if (v === 'dark' || v === 'light' || v === 'system') return v;
    }
  } catch {
    /* 隐私模式忽略 */
  }
  return 'system';
}

function getInitialDefaultQuadrant(): QuadrantKey {
  if (typeof localStorage !== 'undefined') {
    const v = localStorage.getItem('dm-default-quadrant');
    if (v === 'q1' || v === 'q2' || v === 'q3' || v === 'q4') return v;
  }
  return DEFAULT_QUADRANT;
}

function getInitialBoardDate(): string {
  // 启动时始终回到今天，避免 localStorage 里的旧日期导致看板显示空白（"添加了任务但看不到"）。
  // 用户可以在看板上手动切换到其他日期查看，但每次启动都回到今天。
  return todayStr();
}

function getInitialEnabledTabs(): Record<Tab, boolean> {
  const allEnabled = Object.fromEntries(TAB_ORDER.map((t) => [t, true])) as Record<Tab, boolean>;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('dm-enabled-tabs');
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        for (const t of TAB_ORDER) {
          if (typeof parsed[t] === 'boolean') allEnabled[t] = parsed[t]!;
        }
      }
    }
  } catch {
    /* 忽略损坏的配置 */
  }
  return allEnabled;
}

interface UIState {
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  /** 看板按领域筛选的当前选中领域；null 表示不过滤 */
  activeDomain: string | null;
  setActiveDomain: (key: string | null) => void;
  /** 点击同一切换取消，便于领域清单项复用 */
  toggleDomain: (key: string) => void;
  /** 主题偏好（dark/light/system），持久化到 localStorage，由 App 统一同步到 <html> */
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  /** 字号档位（small/standard/large/xlarge），持久化到 localStorage，驱动 <html data-font-scale> 根字号 */
  fontScale: FontScale;
  setFontScale: (s: FontScale) => void;
  /** 任务详情弹窗：当前打开的任务 id；null 表示关闭 */
  detailTaskId: string | null;
  openTaskDetail: (id: string) => void;
  closeTaskDetail: () => void;
  /** 新建任务的默认象限（持久化，用户可在命令面板里自定义） */
  defaultQuadrant: QuadrantKey;
  setDefaultQuadrant: (q: QuadrantKey) => void;
  /** 看板当前查看的日期（持久化，默认今日）；影响任务列表与今日回顾聚合 */
  boardDate: string;
  setBoardDate: (d: string) => void;
  /** 各功能 Tab 的启用状态（默认全部启用），持久化到 localStorage */
  enabledTabs: Record<Tab, boolean>;
  setTabEnabled: (tab: Tab, enabled: boolean) => void;
  isTabEnabled: (tab: Tab) => boolean;
}

export const useUI = create<UIState>((set, get) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  fontScale: getInitialFontScale(),
  setFontScale: (fontScale) => {
    try {
      localStorage.setItem('dm-font-scale', fontScale);
    } catch {
      /* 隐私模式忽略 */
    }
    set({ fontScale });
  },
  activeDomain: null,
  setActiveDomain: (activeDomain) => set({ activeDomain }),
  toggleDomain: (key) => set((s) => ({ activeDomain: s.activeDomain === key ? null : key })),
  theme: getInitialTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem('dm-theme', theme);
    } catch {
      /* 隐私模式忽略 */
    }
    set({ theme });
  },
  toggleTheme: () =>
    set((s) => {
      // 三态循环：深色 → 浅色 → 跟随系统 → 深色
      const next: Theme = s.theme === 'dark' ? 'light' : s.theme === 'light' ? 'system' : 'dark';
      try {
        localStorage.setItem('dm-theme', next);
      } catch {
        /* 隐私模式忽略 */
      }
      return { theme: next };
    }),
  detailTaskId: null,
  openTaskDetail: (detailTaskId) => set({ detailTaskId }),
  closeTaskDetail: () => set({ detailTaskId: null }),
  defaultQuadrant: getInitialDefaultQuadrant(),
  setDefaultQuadrant: (defaultQuadrant) => {
    try {
      localStorage.setItem('dm-default-quadrant', defaultQuadrant);
    } catch {
      /* 隐私模式忽略 */
    }
    set({ defaultQuadrant });
  },
  boardDate: getInitialBoardDate(),
  setBoardDate: (boardDate) => {
    try {
      localStorage.setItem('dm-board-date', boardDate);
    } catch {
      /* 隐私模式忽略 */
    }
    set({ boardDate });
  },
  enabledTabs: getInitialEnabledTabs(),
  setTabEnabled: (tab, enabled) =>
    set((s) => {
      const next = { ...s.enabledTabs, [tab]: enabled };
      try {
        localStorage.setItem('dm-enabled-tabs', JSON.stringify(next));
      } catch {
        /* 隐私模式忽略 */
      }
      return { enabledTabs: next };
    }),
  isTabEnabled: (tab) => get().enabledTabs[tab] !== false,
}));
