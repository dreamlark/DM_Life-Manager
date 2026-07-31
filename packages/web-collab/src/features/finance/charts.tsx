// 家庭财务看板图表：纯手写 SVG（零新增依赖，规避 C 盘 ENOSPC）。
// 统一使用 CSS 变量（--accent 等）保证浅/深主题一致。

export interface BarDatum {
  label: string;
  income: number;
  expense: number;
}

export function BarChart({ data, height = 180 }: { data: BarDatum[]; height?: number }) {
  const W = 680;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padTop = 10;
  const padBottom = 22;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBottom;
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const groupW = plotW / Math.max(1, data.length);
  const barW = Math.min(26, (groupW - 18) / 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="text-gray-400" role="img" aria-label="收入与支出对比">
      <defs>
        <linearGradient id="barIncome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {/* 基线 */}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke="rgba(128,128,128,0.3)" strokeWidth="1" />
      {data.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="currentColor" fontSize="12">
          暂无数据
        </text>
      )}
      {data.map((d, i) => {
        const gx = padL + i * groupW + groupW / 2;
        const incH = (d.income / max) * plotH;
        const expH = (d.expense / max) * plotH;
        const incX = gx - barW - 3;
        const expX = gx + 3;
        const y0 = padTop + plotH;
        return (
          <g key={i}>
            <rect x={incX} y={y0 - incH} width={barW} height={incH} rx={4} fill="url(#barIncome)" />
            <rect x={expX} y={y0 - expH} width={barW} height={expH} rx={4} fill="#fb7185" opacity={0.85} />
            <text x={gx} y={H - 6} textAnchor="middle" fill="currentColor" fontSize="10">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({ data, size = 200 }: { data: DonutSlice[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;
  const stroke = 22;
  const radius = r - stroke / 2;
  const circ = 2 * Math.PI * radius;

  let offset = 0;
  const segs = data.map((d) => {
    const frac = total > 0 ? d.value / total : 0;
    const len = frac * circ;
    const seg = { ...d, dash: len, gap: circ - len, off: -offset };
    offset += len;
    return seg;
  });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="text-gray-100" role="img" aria-label="支出类别占比">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(128,128,128,0.22)" strokeWidth={stroke} />
        {total > 0 &&
          segs.map((s, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${s.dash} ${s.gap}`}
              strokeDashoffset={s.off}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: 'stroke-dasharray 0.4s ease' }}
            />
          ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="currentColor" fontSize="15" fontWeight={700}>
          {total.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="currentColor" opacity={0.6} fontSize="10">
          支出合计
        </text>
      </svg>
      <ul className="space-y-1 text-xs">
        {segs.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-gray-300">{s.label}</span>
            <span className="ml-auto text-gray-500">
              {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const DONUT_PALETTE = [
  '#60a5fa',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#fb7185',
  '#22d3ee',
  '#facc15',
  '#4ade80',
  '#c084fc',
];
