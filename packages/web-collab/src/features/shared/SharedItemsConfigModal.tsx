// 通用「个人模块 → 家庭共享」配置面板（提醒/记事/脑图/心流/领域… 复用一套桥接）。
// 与 finance 的 FinanceShareConfig 同构，但业务数据由 props 注入（module / candidates / fetchBagFresh / snapshotFor），
// 故各模块只需提供自己的候选项与快照构建器，即可复用此面板，无需每模块重写一遍拖拽/范围/保存逻辑。
// server 仅存快照，不回源 engine；保存时按 (module,itemType,itemKey) 唯一键 upsert 差异，并订阅 engine SSE 防抖重推。
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
import { useFamilyStore } from '../../store/familyStore';
import { useAuthStore } from '../../store/authStore';
import { useModeStore } from '../../store/modeStore';
import type { SelectedShareItem, ShareCandidate, SharedItemView } from './types';

export interface SharedItemsConfigModalProps {
  open: boolean;
  onClose: () => void;
  /** 业务模块标识：reminder | notes | mindmap | flow | domains */
  module: string;
  /** 左池候选项（由父组件经 trpcLocal 拉取本地数据后构建） */
  candidates: ShareCandidate[];
  /** 重新拉取本地数据（保存/重推时用，保证快照新鲜） */
  fetchBagFresh: () => Promise<unknown>;
  /** 由候选项 + 最新本地数据构建某项的快照 */
  snapshotFor: (sel: SelectedShareItem, fresh: any) => unknown;
  /** 面板标题（默认「共享到家庭」） */
  title?: string;
  /** 无家庭时的提示文案 */
  emptyHint?: string;
}

export function SharedItemsConfigModal({
  open,
  onClose,
  module,
  candidates,
  fetchBagFresh,
  snapshotFor,
  title = '共享到家庭',
  emptyHint = '你还没有家庭，无法共享数据。',
}: SharedItemsConfigModalProps) {
  const familyId = useFamilyStore((s) => s.currentFamilyId);
  const members = useFamilyStore((s) => s.members);
  const me = useAuthStore((s) => s.user);
  const setMode = useModeStore((s) => s.setMode);

  const canShare = !!familyId && members.length > 0;

  const [selected, setSelected] = useState<SelectedShareItem[]>([]);
  const [existing, setExisting] = useState<SharedItemView[]>([]);
  const [saving, setSaving] = useState(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const prefilled = useRef(false);

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
    trpc.sharedItems.listByFamily
      .query({ familyId, module })
      .then((data) => {
        if (!alive) return;
        const arr = (data as SharedItemView[]) ?? [];
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
  }, [open, canShare, familyId, module]);

  async function freshBag(): Promise<any> {
    return (await fetchBagFresh()) as any;
  }

  function upsertInput(sel: SelectedShareItem, fresh: any) {
    return {
      module,
      itemType: sel.itemType,
      itemKey: sel.itemKey,
      label: sel.label,
      scope: sel.scope,
      allowedUserIds: sel.scope === 'specific' ? sel.allowedUserIds : [],
      snapshot: snapshotFor(sel, fresh),
    };
  }

  // SSE 重推：owner 在个人模式编辑数据 → engine SSE → 防抖重推已选项快照。
  // 修复：原实现在「任意」engine 事件上都重推全部已选项（无节流/无并发保护），
  // 编辑活跃时会持续产生 upsert → server 广播 → 看板重拉 的连锁，挤爆单源连接池。
  // 现改为：最少间隔 1s 且同一时刻只有一个重推在飞（去抖合并 + 并发保护）。
  const repushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repushing = useRef(false);

  function scheduleRepush(): void {
    if (repushTimer.current) clearTimeout(repushTimer.current);
    repushTimer.current = setTimeout(() => {
      void (async () => {
        if (repushing.current) {
          scheduleRepush(); // 上次还在飞，稍后补一次（合并，不叠加）
          return;
        }
        const sel = selectedRef.current;
        if (!familyId || sel.length === 0) return;
        repushing.current = true;
        try {
          const fresh = await freshBag();
          const upserts = sel.map((s) => upsertInput(s, fresh));
          // 重推同样走批量 sync（removes 为空），收敛为单次请求 + 单次广播
          await trpc.sharedItems.sync.mutate({ familyId, upserts, removes: [] });
        } catch {
          /* 重推失败忽略，下次编辑再补 */
        } finally {
          repushing.current = false;
        }
      })();
    }, 1000);
  }

  useEffect(() => {
    if (!open || !canShare) return;
    const off = onBoardEvent((e) => {
      if (e.module === 'sharedItems' || e.kind === 'sharedItems.updated') scheduleRepush();
    });
    return () => {
      if (repushTimer.current) clearTimeout(repushTimer.current);
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
    const type = parts[1];
    const key = parts.slice(2).join(':');
    const cand = candidates.find((c) => c.itemType === type && c.itemKey === key);
    if (cand && !isSelected(cand)) {
      setSelected((prev) => [...prev, { ...cand, scope: 'all', allowedUserIds: [] }]);
    }
  }

  async function serverReady(): Promise<boolean> {
    try {
      const res = await fetch('/health', { cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('请求超时')), ms)),
    ]);
  }

  async function handleSave() {
    if (!familyId) return;
    if (selected.length === 0) {
      toast.error('请先勾选或拖入要共享的项');
      return;
    }
    const ready = await serverReady();
    if (!ready) {
      toast.error('协作服务正在初始化，请稍后再试');
      return;
    }
    setSaving(true);
    try {
      const fresh = await freshBag();
      const upserts = selected.map((s) => upsertInput(s, fresh));
      const selKeys = new Set(selected.map((s) => `${s.itemType}:${s.itemKey}`));
      const removes = existing
        .filter((e) => !selKeys.has(`${e.itemType}:${e.itemKey}`))
        .map((e) => e.id);
      // 单次请求 + 单次广播：批量 upsert 多项并删除未选项，杜绝 N 次 upsert/remove 的广播风暴
      await withTimeout(trpc.sharedItems.sync.mutate({ familyId, upserts, removes }), 15000);
      toast.success(`已共享 ${selected.length} 项到家庭`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[SharedItemsConfigModal] 保存共享失败:', err);
      if (msg.includes('Failed to fetch') || msg.includes('warming') || msg.includes('503')) {
        toast.error('协作服务正在初始化，请稍后再试');
      } else {
        toast.error(`保存失败：${msg.slice(0, 80) || '未知错误'}`);
      }
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
          <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
          <button className="ml-auto rounded p-1 text-gray-400 hover:text-gray-100" type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {!canShare ? (
          <div className="p-6 text-center">
            <p className="text-sm text-gray-300">{emptyHint}</p>
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
              {/* 左池：候选共享项 */}
              <div>
                <div className="mb-2 text-xs font-semibold text-gray-400">个人数据项（勾选或拖拽到右侧）</div>
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
                  {candidates.length === 0 && (
                    <div className="rounded-lg border border-dashed border-bg-border p-4 text-center text-xs text-gray-500">
                      暂无可共享的个人数据
                    </div>
                  )}
                </div>
              </div>

              {/* 右清单：已选共享项 */}
              <ShareDropZone count={selected.length}>
                {selected.length === 0 ? (
                  <div className="flex h-full min-h-[160px] items-center justify-center rounded-lg border border-dashed border-bg-border text-xs text-gray-500">
                    把左侧数据项拖到这里，或点击勾选
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
