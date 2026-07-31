// 家庭财务共享看板（协作模式 · App.tsx 的 finance tab）。
// 读取 server 已按权限过滤的共享快照，以图表+列表呈现，支持按月份（时间）与类别筛选，并随实时事件刷新。
// 注意：协作客户端 trpc 是命令式（createTRPCClient），这里用 .query() 命令式拉取，刷新走 onBoardEvent。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '../../lib/trpc';
import { onBoardEvent } from '../../lib/realtime';
import { useFamilyStore, useMyRole } from '../../store/familyStore';
import { can } from '../../lib/rbac';
import { BarChart, DonutChart, DONUT_PALETTE } from './charts';
import type { SharedFinanceItemType, SharedFinanceItemView } from './financeShare';

function fmt(n: number): string {
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

const CATEGORY_OPTIONS: { value: 'all' | SharedFinanceItemType; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'summary', label: '总览' },
  { value: 'income', label: '收入' },
  { value: 'expense', label: '支出' },
  { value: 'asset', label: '资产' },
  { value: 'investment', label: '投资' },
  { value: 'debt', label: '债务' },
  { value: 'budget', label: '预算' },
];

function breakdownVal(item: SharedFinanceItemView, label: string): number {
  const b = (item.snapshot?.breakdown ?? []).find((x: any) => x.label === label);
  return b ? Number(b.value) : 0;
}

export function FamilyFinanceBoard() {
  const familyId = useFamilyStore((s) => s.currentFamilyId);
  const members = useFamilyStore((s) => s.members);
  const myRole = useMyRole();
  const view = can(myRole, 'viewFinance');

  const [items, setItems] = useState<SharedFinanceItemView[]>([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<'all' | SharedFinanceItemType>('all');
  const [month, setMonth] = useState<string>('all');

  // 合并刷新：去抖 + 防并发 + 可取消，与 FamilySharedItemsBoard 同款，
  // 避免财务快照更新时并发重拉挤占 localhost:5173 的连接池。
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleReload = useCallback(
    (immediate = false) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const run = async () => {
        if (!familyId || !view) return;
        if (inFlight.current) {
          dirty.current = true;
          return;
        }
        inFlight.current = true;
        const ac = new AbortController();
        setLoading(true);
        try {
          const data = await trpc.sharedFinance.listByFamily.query(
            { familyId },
            { signal: ac.signal },
          );
          setItems((data as SharedFinanceItemView[]) ?? []);
        } catch (e: unknown) {
          if ((e as { name?: string })?.name === 'AbortError') return;
          /* 无 viewFinance 权限或无数据，忽略 */
        } finally {
          inFlight.current = false;
          setLoading(false);
          if (dirty.current) {
            dirty.current = false;
            scheduleReload(true);
          }
        }
      };
      if (immediate) void run();
      else debounceRef.current = setTimeout(run, 400);
    },
    [familyId, view],
  );

  // 进入看板 / 切换家庭 / 权限变化时加载
  useEffect(() => {
    scheduleReload(true);
  }, [scheduleReload]);

  // 实时刷新：家庭成员收到财务共享快照更新事件即重拉（已按 module='finance' 精准过滤）
  useEffect(() => {
    if (!familyId) return;
    const off = onBoardEvent((e) => {
      if (e.kind !== 'sharedFinance.updated' || e.familyId !== familyId) return;
      const m = (e as { module?: string }).module;
      if (m != null && m !== 'finance') return;
      scheduleReload();
    });
    return off;
  }, [familyId, scheduleReload]);

  const memberName = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members) m.set(x.userId, x.name);
    return (id: string) => m.get(id) ?? '家庭成员';
  }, [members]);

  // 可用月份（来自快照周期）
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const p = it.snapshot?.period;
      if (p) set.add(p);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((it) => {
        if (category !== 'all' && it.itemType !== category) return false;
        if (month !== 'all' && it.snapshot?.period !== month) return false;
        return true;
      }),
    [items, category, month],
  );

  const summaryItems = filtered.filter((i) => i.itemType === 'summary');
  const listItems = filtered.filter((i) => i.itemType !== 'summary');

  // 收入 vs 支出柱状图（按 owner 聚合）
  const barData = useMemo(
    () =>
      summaryItems.map((s) => ({
        label: memberName(s.ownerUserId),
        income: breakdownVal(s, '本月收入'),
        expense: breakdownVal(s, '本月支出'),
      })),
    [summaryItems, memberName],
  );

  // 支出类别环形图（聚合全部 expense 项）
  const donutData = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const it of filtered) {
      if (it.itemType !== 'expense') continue;
      const v = Number(it.snapshot?.value ?? 0);
      byCat.set(it.itemKey, (byCat.get(it.itemKey) ?? 0) + v);
    }
    return Array.from(byCat.entries()).map(([label, value], i) => ({
      label,
      value,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length] ?? '#60a5fa',
    }));
  }, [filtered]);

  if (!view) {
    return (
      <div className="child-notice glass mx-auto mt-10 max-w-md text-center">
        🔒 家庭财务金额对你隐藏。需要「查看家庭账本」权限才能看到共享的财务数据。
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-100">📊 家庭财务</h2>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-bg-border bg-bg-panel px-2 py-1 text-xs text-gray-200"
          >
            <option value="all">全部时间</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as 'all' | SharedFinanceItemType)}
            className="rounded-md border border-bg-border bg-bg-panel px-2 py-1 text-xs text-gray-200"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">加载中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-bg-border p-8 text-center text-sm text-gray-500">
          还没有家庭成员共享财务数据。在「个人模式」的财务页点击「共享到家庭」即可把你的财务快照分享到这里。
        </div>
      ) : (
        <>
          {/* 总览卡片（每位共享者的净资产 + 明细） */}
          {summaryItems.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summaryItems.map((s) => {
                const bd = (s.snapshot?.breakdown ?? []) as { label: string; value: number }[];
                return (
                  <div key={s.id} className="rounded-xl border border-bg-border bg-bg-panel p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-200">{memberName(s.ownerUserId)} · 总览</span>
                      <ScopeBadge item={s} memberName={memberName} />
                    </div>
                    <div className="text-2xl font-bold text-accent">{fmt(Number(s.snapshot?.value ?? 0))}</div>
                    <div className="mt-1 text-[10px] text-gray-500">净资产</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {bd.map((b, i) => (
                        <span key={i} className="rounded bg-bg-base px-1.5 py-0.5 text-[10px] text-gray-400">
                          {b.label} {fmt(Number(b.value))}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 图表 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-bg-border bg-bg-panel p-4">
              <div className="mb-2 flex items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" /> 收入
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#fb7185' }} /> 支出
                </span>
              </div>
              <BarChart data={barData} />
            </div>
            <div className="rounded-xl border border-bg-border bg-bg-panel p-4">
              <div className="mb-2 text-xs text-gray-400">支出类别占比</div>
              {donutData.length === 0 ? (
                <p className="text-xs text-gray-600">暂无支出类共享数据（选择「支出」类别或请成员共享支出）。</p>
              ) : (
                <DonutChart data={donutData} />
              )}
            </div>
          </div>

          {/* 列表 */}
          <div className="overflow-hidden rounded-xl border border-bg-border bg-bg-panel">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-base text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">项目</th>
                  <th className="px-3 py-2">共享者</th>
                  <th className="px-3 py-2 text-right">数值</th>
                  <th className="px-3 py-2">范围</th>
                  <th className="px-3 py-2 text-right">更新</th>
                </tr>
              </thead>
              <tbody>
                {listItems.map((it) => (
                  <tr key={it.id} className="border-t border-bg-border">
                    <td className="px-3 py-2 text-gray-200">
                      <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-gray-400">
                        {CATEGORY_OPTIONS.find((o) => o.value === it.itemType)?.label ?? it.itemType}
                      </span>{' '}
                      {it.label}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{memberName(it.ownerUserId)}</td>
                    <td className="px-3 py-2 text-right text-gray-100">{fmt(Number(it.snapshot?.value ?? 0))}</td>
                    <td className="px-3 py-2">
                      <ScopeBadge item={it} memberName={memberName} />
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">
                      {new Date(it.updatedAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ScopeBadge({ item, memberName }: { item: SharedFinanceItemView; memberName: (id: string) => string }) {
  if (item.scope === 'all') {
    return <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">全家人</span>;
  }
  const names = (item.allowedUserIds ?? []).map(memberName).join('、');
  return (
    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300" title={names}>
      指定：{names || '—'}
    </span>
  );
}
