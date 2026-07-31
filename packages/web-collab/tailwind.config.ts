import type { Config } from 'tailwindcss';

// 个人模式（单机版）Tailwind 令牌：一律用「lc-」前缀（lc = local），
// 与联机版 styles.css 中的 --accent 等 hex 令牌完全隔离，互不覆盖。
// 复制自 packages/web，仅把变量名加 lc- 前缀，组件类名（text-accent / bg-bg-raised …）不变。
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: v('--lc-bg-base'),
          panel: v('--lc-bg-panel'),
          raised: v('--lc-bg-raised'),
          border: v('--lc-bg-border'),
          // 半透明叠加层（hover 等），直接用完整 rgba 变量，不套 alpha
          soft: 'var(--lc-bg-soft)',
        },
        accent: v('--lc-accent'),
        gray: {
          100: v('--lc-gray-100'),
          200: v('--lc-gray-200'),
          300: v('--lc-gray-300'),
          400: v('--lc-gray-400'),
          500: v('--lc-gray-500'),
          600: v('--lc-gray-600'),
          700: v('--lc-gray-700'),
          800: v('--lc-gray-800'),
          900: v('--lc-gray-900'),
        },
        // slate 独立「反转向」主题调色板：浅色模式下 slate-200/300/400 为深色文字、slate-800/900 为浅色面板；
        // 深色模式反之。使 DomainBalancePage / CalendarPage 等直接用 text-slate-*/bg-slate-* 的页面
        // 在两种主题下都正确反转、保证对比（绝不能别名到 gray，否则浅色下面板与文字同暗、不可读）。
        slate: {
          100: v('--lc-slate-100'),
          200: v('--lc-slate-200'),
          300: v('--lc-slate-300'),
          400: v('--lc-slate-400'),
          500: v('--lc-slate-500'),
          600: v('--lc-slate-600'),
          700: v('--lc-slate-700'),
          800: v('--lc-slate-800'),
          900: v('--lc-slate-900'),
        },
        // 状态/语义色（全档位 100–600 主题感知，extend 深合并保留 50/700–900 默认档）：
        // 浅色模式用深色档、深色模式用明亮档，杜绝任何 text-<color>-<shade>
        // 在浅底不可读（#308 彻查修复：emerald-200 / rose-200 / amber-200 / sky-200 / red-200 等）。
        emerald: { 100: v('--lc-emerald-100'), 200: v('--lc-emerald-200'), 300: v('--lc-emerald-300'), 400: v('--lc-emerald-400'), 500: v('--lc-emerald-500'), 600: v('--lc-emerald-600') },
        amber: { 100: v('--lc-amber-100'), 200: v('--lc-amber-200'), 300: v('--lc-amber-300'), 400: v('--lc-amber-400'), 500: v('--lc-amber-500'), 600: v('--lc-amber-600') },
        red: { 100: v('--lc-red-100'), 200: v('--lc-red-200'), 300: v('--lc-red-300'), 400: v('--lc-red-400'), 500: v('--lc-red-500'), 600: v('--lc-red-600') },
        rose: { 100: v('--lc-rose-100'), 200: v('--lc-rose-200'), 300: v('--lc-rose-300'), 400: v('--lc-rose-400'), 500: v('--lc-rose-500'), 600: v('--lc-rose-600') },
        sky: { 100: v('--lc-sky-100'), 200: v('--lc-sky-200'), 300: v('--lc-sky-300'), 400: v('--lc-sky-400'), 500: v('--lc-sky-500'), 600: v('--lc-sky-600') },
        yellow: { 100: v('--lc-yellow-100'), 200: v('--lc-yellow-200'), 300: v('--lc-yellow-300'), 400: v('--lc-yellow-400'), 500: v('--lc-yellow-500'), 600: v('--lc-yellow-600') },
        blue: { 100: v('--lc-blue-100'), 200: v('--lc-blue-200'), 300: v('--lc-blue-300'), 400: v('--lc-blue-400'), 500: v('--lc-blue-500'), 600: v('--lc-blue-600') },
        cyan: { 100: v('--lc-cyan-100'), 200: v('--lc-cyan-200'), 300: v('--lc-cyan-300'), 400: v('--lc-cyan-400'), 500: v('--lc-cyan-500'), 600: v('--lc-cyan-600') },
        green: { 100: v('--lc-green-100'), 200: v('--lc-green-200'), 300: v('--lc-green-300'), 400: v('--lc-green-400'), 500: v('--lc-green-500'), 600: v('--lc-green-600') },
      },
      fontFamily: {
        sans: ['"Inter"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
