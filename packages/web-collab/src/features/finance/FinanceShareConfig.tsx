// 财务共享配置面板（个人模式 · 挂在 FinancePage 头部「共享到家庭」按钮）。
// 左池：个人财务项（经 trpcLocal 拉取）；右清单：已选共享项，支持复选框勾选 + dnd-kit 拖拽加入，
// 每项可设范围（全家人 / 指定成员）。保存时算快照推到 server；并订阅 engine SSE，财务变更后防抖重推，保证家庭端实时一致。
// 注意：协作客户端 trpc 是命令式（createTRPCClient），这里用 .query()/.mutate() 命令式调用。
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { X, Users, Share2, Check } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { onBoardEvent } from '../../lib/realtime';
import { trpc as trpcLocal } from '../../lib/trpcLocal';
import { useFamilyStore } from '../../store/familyStore';
import { useAuthStore } from '../../store/authStore';
import { useModeStore } from '../../store/modeStore';
import {
  buildCandidates,
  snapshotFor,
  type SelectedShareItem,
  type ShareCandidate,
  type SharedFinanceItemType,
  type SharedFinanceItemView,
} from './financeShare';

function fmt(n: number): string {
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

export function FinanceShareConfig({ open, onClose }: { open: boolean; onClose: () => void }) {
  const familyId = useFamilyStore((s) => s.currentFamilyId);
  const members = useFamilyStore((s) => s.members);
  const me = useAuthStore((s) => s.user);
  const setMode = useModeStore((s) => s.setMode);

  const localUtils = trpcLocal.useUtils();

  // 本地财务数据（仅面板打开时拉取，hooks 走 trpcLocal 的 react-query provider）
  const summaryQ = trpcLocal.finance.summary.useQuery(undefined, { enabled: open } as any);
  const incomesQ = trpcLocal.finance.incomes.list.useQuery(undefined, { enabled: open } as any);
  const assetsQ = trpcLocal.finance.assets.list.useQuery(undefined, { enabled: open } as any);
  const debtsQ = trpcLocal.finance.debts.list.useQuery(undefined, { enabled: open } as any);
  const txnsQ = trpcLocal.finance.transactions.list.useQuery(undefined, { enabled: open } as any);
  const budgetsQ = trpcLocal.finance.budgets.list.useQuery(undefined, { enabled: open } as any);

  const canShare = !!familyId && members.length > 0;

  const [selected, setSelected] = useState<SelectedShareItem[]>([]);
  const [existing, setExisting] = useState<SharedFinanceItemView[]>([]);
  const [saving, setSaving] = useState(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const prefilled = useRef(false);

  const bag = useMemo(
    () => ({
      summary: summaryQ.data,
      incomes: incomesQ.data,
      assets: assetsQ.data,
      debts: debtsQ.data,
      transactions: txnsQ.data,
      budgets: budgetsQ.data,
    }),
    [summaryQ.data, incomesQ.data, assetsQ.data, debtsQ.data, txnsQ.data, budgetsQ.data],
  );

  const candidates = useMemo(() => buildCandidates(bag), [bag]);
  const groups = useMemo(() => {
    const m = new Map<string, ShareCandidate[]>();
    for (const c of candidates) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)!.push(c);
    }
    return Array.from(m.entries());
  }, [candidates]);

  // 打开时拉取已共享项并预填选择（仅一次）
  useEffect(() => {
    if (!open || !canShare || !familyId) return;
    let alive = true;
    trpc.sharedFinance.listByFamily
      .query({ familyId })
      .then((data) => {
        if (!alive) return;
        const arr = (data as SharedFinanceItemView[]) ?? [];
        setExisting(arr);
        if (!prefilled.current) {
          setSelected(
            arr.map((e) => ({
              itemType: e.itemType,
              itemKey: e.itemKey,
              label: e.label,
              scope: e.scope,
              allowedUserIds: e.allowedUserIds ?? [],
            })),
          );
          prefilled.current = true;
        }
      })
      .catch(() => {
        /* 无共享项或权限不足，忽略 */
      });
    return () => {
      alive = false;
    };
  }, [open, canShare, familyId]);

  // 重新拉取最新本地财务数据（保存/重推时用，保证快照新鲜）
  async function fetchBagFresh() {
    const c = localUtils.client;
    const [summary, incomes, assets, debts, transactions, budgets] = await Promise.all([
      c.finance.summary.query(),
      c.finance.incomes.list.query(),
      c.finance.assets.list.query(),
      c.finance.debts.list.query(),
      c.finance.transactions.list.query(),
      c.finance.budgets.list.query(),
    ]);
    return { summary, incomes, assets, debts, transactions, budgets };
  }

  function upsertInput(sel: SelectedShareItem, fresh: any) {
    return {
      itemType: sel.itemType,
      itemKey: sel.itemKey,
      label: sel.label,
      scope: sel.scope,
      allowedUserIds: sel.scope === 'specific' ? sel.allowedUserIds : [],
      snapshot: snapshotFor(sel, fresh),
    };
  }

  // SSE 重推：owner 在个人模式编辑财务 → engine SSE → 防抖重推已选项快照
  const repushRef = useRef<() => Promise<void>>(async () => {});
  repushRef.current = async () => {
    const sel = selectedRef.current;
    if (!familyId || sel.length === 0) return;
    const fresh = await fetchBagFresh();
    await Promise.all(sel.map((s) => trpc.sharedFinance.upsert.mutate({ familyId, ...upsertInput(s, fresh) })));
  };

  useEffect(() => {
    if (!open || !canShare) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onBoardEvent((e) => {
      if (e.module === 'sharedFinance' || e.kind === 'sharedFinance.updated') {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void repushRef.current(), 800);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [open, canShare, familyId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function isSelected(c: ShareCandidate): boolean {
    return selected.some((s) => s.itemType === c.itemType && s.itemKey === c.itemKey);
  }
  function toggle(c: ShareCandidate) {
    setSelected((prev) =>
      isSelected(c)
        ? prev.filter((s) => !(s.itemType === c.itemType && s.itemKey === c.itemKey))
        : [...prev, { ...c, scope: 'all', allowedUserIds: [] }],
    );
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || over.id !== 'share-drop') return;
    const id = String(active.id);
    if (!id.startsWith('cand:')) return;
    const parts = id.split(':');
    const type = parts[1] as SharedFinanceItemType;
    const key = parts.slice(2).join(':');
    const cand = candidates.find((c) => c.itemType === type && c.itemKey === key);
    if (cand && !isSelected(cand)) {
      setSelected((prev) => [...prev, { ...cand, scope: 'all', allowedUserIds: [] }]);
    }
  }

  async function handleSave() {
    if (!familyId) return;
    if (selected.length === 0) {
      toast.error('请先勾选或拖入要共享的财务项');
      return;
    }
    setSaving(true);
    try {
      const fresh = await fetchBagFresh();
      const upserts = selected.map((s) => trpc.sharedFinance.upsert.mutate({ familyId, ...upsertInput(s, fresh) }));
      const selKeys = new Set(selected.map((s) => `${s.itemType}:${s.itemKey}`));
      const removes = existing
        .filter((e) => !selKeys.has(`${e.itemType}:${e.itemKey}`))
        .map((e) => trpc.sharedFinance.remove.mutate({ familyId, id: e.id }));
      await Promise.all([...upserts, ...removes]);
      toast.success(`已共享 ${selected.length} 项财务数据到家庭`);
      onClose();
    } catch (err) {
      // 不再吞掉错误：明确提示，方便排查（如后端未起 / 权限不足 / 网络异常）
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FinanceShareConfig] 保存共享失败:', err);
      toast.error(`保存失败：${msg.slice(0, 80) || '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="glass flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-bg-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-bg-border px-4 py-3">
          <Share2 size={16} className="text-accent" />
          <h3 className="text-sm font-semibold text-gray-100">共享财务到家庭</h3>
          <button className="ml-auto rounded p-1 text-gray-400 hover:text-gray-100" type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {!canShare ? (
          <div className="p-6 text-center">
            <p className="text-sm text-gray-300">你还没有家庭，无法共享财务数据。</p>
            <p className="mt-1 text-xs text-gray-500">请先在协作模式创建或加入一个家庭。</p>
            <button
              className="mt-4 rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25"
              type="button"
              onClick={() => {
                setMode('collab');
                onClose();
              }}
            >
              去协作模式
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
              {/* 左池：候选财务项 */}
              <div>
                <div className="mb-2 text-xs font-semibold text-gray-400">个人财务项（勾选或拖拽到右侧）</div>
                <div className="space-y-3">
                  {groups.map(([group, items]) => (
                    <div key={group}>
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">{group}</div>
                      <div className="space-y-1">
                        {items.map((c) => (
                          <CandidateRow key={`${c.itemType}:${c.itemKey}`} cand={c} checked={isSelected(c)} onToggle={() => toggle(c)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 右清单：已选共享项 */}
              <ShareDropZone count={selected.length}>
                {selected.length === 0 ? (
                  <div className="flex h-full min-h-[160px] items-center justify-center rounded-lg border border-dashed border-bg-border text-xs text-gray-500">
                    把左侧财务项拖到这里，或点击勾选
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selected.map((s) => (
                      <SelectedRow
                        key={`${s.itemType}:${s.itemKey}`}
                        item={s}
                        members={members.filter((m) => m.userId !== me?.id)}
                        onChange={(patch) =>
                          setSelected((prev) =>
                            prev.map((x) =>
                              x.itemType === s.itemType && x.itemKey === s.itemKey ? { ...x, ...patch } : x,
                            ),
                          )
                        }
                        onRemove={() =>
                          setSelected((prev) => prev.filter((x) => !(x.itemType === s.itemType && x.itemKey === s.itemKey)))
                        }
                      />
                    ))}
                  </div>
                )}
              </ShareDropZone>
            </div>

            <div className="flex items-center justify-between border-t border-bg-border px-4 py-3">
              <span className="text-xs text-gray-500">已选 {selected.length} 项 · 保存后家庭端实时可见</span>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs text-gray-300 hover:border-accent/50"
                  type="button"
                  onClick={onClose}
                >
                  取消
                </button>
                <button
                  className="flex items-center gap-1 rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25"
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  <Check size={13} /> {saving ? '保存中…' : '保存共享'}
                </button>
              </div>
            </div>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function CandidateRow({ cand, checked, onToggle }: { cand: ShareCandidate; checked: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cand:${cand.itemType}:${cand.itemKey}`,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onToggle}
      className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors ${
        checked
          ? 'border-accent/50 bg-accent/10 text-accent'
          : 'border-bg-border bg-bg-base text-gray-300 hover:border-accent/30'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <input type="checkbox" checked={checked} readOnly onClick={(e) => e.stopPropagation()} onChange={onToggle} />
      <span className="truncate">{cand.label}</span>
    </div>
  );
}

function ShareDropZone({ children, count }: { children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'share-drop' });
  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-gray-400">
        <Users size={12} /> 已选共享项
        <span className="ml-1 rounded bg-bg-raised px-1.5 text-[10px] text-gray-400">{count}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[160px] rounded-lg border p-2 transition-colors ${
          isOver ? 'border-accent/60 bg-accent/5' : 'border-bg-border'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function SelectedRow({
  item,
  members,
  onChange,
  onRemove,
}: {
  item: SelectedShareItem;
  members: { userId: string; name: string }[];
  onChange: (patch: Partial<SelectedShareItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-base p-2">
      <div className="flex items-center gap-2">
        <span className="truncate text-xs text-gray-100">{item.label}</span>
        <button className="ml-auto rounded p-1 text-gray-500 hover:text-red-400" type="button" onClick={onRemove} title="移除">
          <X size={13} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <select
          value={item.scope}
          onChange={(e) => onChange({ scope: e.target.value as 'all' | 'specific', allowedUserIds: [] })}
          className="rounded border border-bg-border bg-bg-panel px-1.5 py-1 text-[11px] text-gray-200"
        >
          <option value="all">全家人可见</option>
          <option value="specific">指定成员</option>
        </select>
      </div>
      {item.scope === 'specific' && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {members.length === 0 ? (
            <span className="text-[10px] text-gray-500">无其他家庭成员</span>
          ) : (
            members.map((m) => {
              const on = item.allowedUserIds.includes(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() =>
                    onChange({
                      allowedUserIds: on
                        ? item.allowedUserIds.filter((id) => id !== m.userId)
                        : [...item.allowedUserIds, m.userId],
                    })
                  }
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    on ? 'border-accent/60 bg-accent/15 text-accent' : 'border-bg-border text-gray-400'
                  }`}
                >
                  {m.name}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
