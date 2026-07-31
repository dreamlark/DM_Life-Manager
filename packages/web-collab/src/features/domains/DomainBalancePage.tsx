import { useMemo, useState } from 'react';
import { Share2 } from 'lucide-react';
import { trpcLocal as trpc } from '../../lib/trpcLocal';
import { DomainShareConfig } from './DomainShareConfig';
import { SHARE_BTN } from '../shared/shareButton';
import { useCollaborative } from '../../store/modeStore';

/** 本地日期格式化为 YYYY-MM-DD（避免 toISOString 的 UTC 偏移） */
function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 取某日期所在周的周一（YYYY-MM-DD） */
function mondayOf(d: Date): string {
  const day = d.getDay(); // 0=周日 .. 6=周六
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return fmtLocal(mon);
}

function shiftWeek(week: string, deltaDays: number): string {
  const d = new Date(week + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  return fmtLocal(d);
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min} 分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

export function DomainBalancePage() {
  const [week, setWeek] = useState<string>(() => mondayOf(new Date()));
  const [shareOpen, setShareOpen] = useState(false);
  const collaborative = useCollaborative();

  const { data: summary = [] } = trpc.domains.summary.useQuery(undefined);
  const { data: wheel, isLoading } = trpc.domains.balanceWheel.useQuery({ week });

  const nameByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of summary) m.set(d.key, d.name);
    return m;
  }, [summary]);

  const totalMinutes = useMemo(
    () => (wheel ? wheel.wheel.reduce((acc: any, w: any) => acc + w.minutes, 0) : 0),
    [wheel],
  );

  return (
    <div className="h-full overflow-auto p-6 text-slate-200">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">领域平衡轮</h1>
            <p className="mt-1 text-sm text-slate-400">
              以本周各领域真实专注投入时长衡量生活重心分布
            </p>
          </div>
          <div className="flex items-center gap-2">
            {collaborative && (
              <button
                onClick={() => setShareOpen(true)}
                className={`${SHARE_BTN}`}
                title="共享到家庭"
              >
                <Share2 size={13} /> 共享到家庭
              </button>
            )}
            <button
              onClick={() => setWeek((w) => shiftWeek(w, -7))}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500"
            >
              上周
            </button>
            <span className="text-sm tabular-nums text-slate-400">{week} 起</span>
            <button
              onClick={() => setWeek((w) => shiftWeek(w, 7))}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500"
            >
              下周
            </button>
          </div>
        </header>

        {isLoading && <p className="text-sm text-slate-500">加载中…</p>}

        {wheel && (
          <>
            <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
                <span>本周专注总投入</span>
                <span className="font-semibold text-slate-200">{fmtMinutes(totalMinutes)}</span>
              </div>
              <div className="space-y-3">
                {wheel.wheel.map((w: any) => (
                  <div key={w.key} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 truncate text-right text-xs text-slate-400" title={w.name}>
                      {w.name}
                    </span>
                    <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-slate-800">
                      <div
                        className="h-full rounded-md transition-all duration-500"
                        style={{
                          width: `${Math.max(w.score, w.minutes > 0 ? 6 : 0)}%`,
                          backgroundColor: w.color,
                          opacity: w.minutes > 0 ? 0.9 : 0.25,
                        }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs tabular-nums text-slate-300">
                      {w.minutes > 0 ? fmtMinutes(w.minutes) : '—'}
                    </span>
                  </div>
                ))}
              </div>
              {totalMinutes === 0 && (
                <p className="mt-3 text-center text-xs text-slate-500">
                  本周还没有专注记录，去「心流」页记一段专注时段吧。
                </p>
              )}
            </section>

            {wheel.topStresses.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-2 text-sm font-semibold text-slate-300">压力代理（开放任务最多的领域）</h2>
                <div className="flex flex-wrap gap-2">
                  {wheel.topStresses.map((key: any) => (
                    <span
                      key={key}
                      className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-300"
                    >
                      {nameByKey.get(key) ?? key}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">领域聚合总览</h2>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">领域</th>
                  <th className="px-4 py-2 text-right font-medium">任务</th>
                  <th className="px-4 py-2 text-right font-medium">进行中</th>
                  <th className="px-4 py-2 text-right font-medium">已完成</th>
                  <th className="px-4 py-2 text-right font-medium">完成率</th>
                  <th className="px-4 py-2 text-right font-medium">累计专注</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((d: any) => (
                  <tr key={d.key} className="border-t border-slate-800/70">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        {d.name}
                        {d.isQuarterFocus && (
                          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300">
                            季度聚焦
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{d.taskTotal}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{d.taskActive}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{d.taskDone}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {d.taskTotal > 0 ? `${Math.round(d.doneRate * 100)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                      {d.focusMinutes > 0 ? fmtMinutes(d.focusMinutes) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* 共享到家庭配置面板 */}
      {collaborative && <DomainShareConfig open={shareOpen} onClose={() => setShareOpen(false)} week={week} />}
    </div>
  );
}
