import {
  THEME,
  DARK_THEME,
  type Theme as METheme,
  type MindElixirData,
} from 'mind-elixir';

/**
 * mind-elixir 主题：配色对齐 web-collab 的 Tailwind 暗/亮 token（tailwind.css）。
 *
 * 为什么不直接用 MindElixir.DARK_THEME / THEME？
 *   - 库自带主题是它自己的配色（#252526 / #f6f6f6…），与应用调色板不一致；
 *   - 其 canvas 背景 --bgcolor 与应用面板也不同，暗色下仍偏灰、与周边面板割裂。
 * 这里以内置主题做「完整字段底座」（避免漏字段导致类型/渲染异常），再用应用 token 覆盖
 * cssVar，确保脑图画布随应用主题无缝切换且配色同源。
 *
 * theme.type 必须正确（'dark'/'light'）：mind-elixir 的 changeTheme 会按 type 选内置底座
 * 做兜底合并，type 错会导致部分变量回退到错误底座。
 */

// 与应用 --lc-accent 同源的强调色
const ACCENT_DARK = '#5b8cff';
const ACCENT_LIGHT = '#2f6bff';

// 分支配色：取应用语义色 token，暗色用明亮档、亮色用深色档以保证可读
const DARK_PALETTE = [
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#f87171', // red-400
  '#fb7185', // rose-400
  '#38bdf8', // sky-400
  '#facc15', // yellow-400
  '#93c5fd', // blue-400
  '#22d3ee', // cyan-400
  '#4ade80', // green-400
  '#a5b4fc', // indigo-300
];

const LIGHT_PALETTE = [
  '#16a34a', // green-600
  '#b45309', // amber-700
  '#dc2626', // red-600
  '#e11d48', // rose-600
  '#0284c7', // sky-600
  '#a16207', // yellow-700
  '#1d4ed8', // blue-600
  '#0e7490', // cyan-700
  '#15803d', // green-700
  '#4f46e5', // indigo-600
];

export const ME_LIGHT_THEME: METheme = {
  ...THEME,
  name: 'DMLight',
  type: 'light',
  palette: LIGHT_PALETTE,
  cssVar: {
    ...THEME.cssVar,
    '--bgcolor': '#ffffff', // --lc-bg-panel 亮
    '--color': '#1f2937', // --lc-gray-200 深色文字
    '--main-color': '#334155',
    '--main-bgcolor': '#eef1f7', // --lc-bg-raised 亮
    '--main-bgcolor-transparent': 'rgba(238, 241, 247, 0.8)',
    '--selected': '#2f6bff',
    '--accent-color': ACCENT_LIGHT,
    '--root-color': '#ffffff',
    '--root-bgcolor': ACCENT_LIGHT,
    '--root-border-color': 'rgba(255, 255, 255, 0.18)',
    '--panel-color': '#1f2937',
    '--panel-bgcolor': '#ffffff',
    '--panel-border-color': '#dbe1ec', // --lc-bg-border 亮
  },
};

export const ME_DARK_THEME: METheme = {
  ...DARK_THEME,
  name: 'DMDark',
  type: 'dark',
  palette: DARK_PALETTE,
  cssVar: {
    ...DARK_THEME.cssVar,
    '--bgcolor': '#11151f', // --lc-bg-panel 暗
    '--color': '#e6e9f0', // --lc-gray-200 暗
    '--main-color': '#cbd5e1',
    '--main-bgcolor': '#161b27', // --lc-bg-raised 暗
    '--main-bgcolor-transparent': 'rgba(22, 27, 39, 0.8)',
    '--selected': '#5b8cff',
    '--accent-color': ACCENT_DARK,
    '--root-color': '#ffffff',
    '--root-bgcolor': '#1e293b', // slate-800 深底，配明亮文字
    '--root-border-color': 'rgba(255, 255, 255, 0.12)',
    '--panel-color': '#e6e9f0',
    '--panel-bgcolor': '#161b27',
    '--panel-border-color': '#222a3a', // --lc-bg-border 暗
  },
};

/** 去掉数据里烘焙的 mind-elixir theme，强制让当前 UI 主题生效（修复随数据回灌的导出/切换串色） */
export function stripDataTheme(data: MindElixirData): MindElixirData {
  if (data && typeof data === 'object' && 'theme' in data && data.theme) {
    const { theme: _drop, ...rest } = data;
    return rest as MindElixirData;
  }
  return data;
}
