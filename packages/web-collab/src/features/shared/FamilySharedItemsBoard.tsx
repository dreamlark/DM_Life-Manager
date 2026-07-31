// 通用「家庭共享看板」（协作模式 · 各模块共享数据统一呈现）。
// 读取 server 已按权限过滤的共享快照（module 判别各业务模块），按 owner 分组，随实时事件刷新。
// 与 finance 的 FamilyFinanceBoard 同构，但渲染细节由 renderSnapshot 注入，故各模块无需各自写一遍看板。
// 注意：协作客户端 trpc 是命令式（createTRPCClient），这里用 .query() 命令式拉取，刷新走 onBoardEvent。
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckSquare, Square, Trash2, Download } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { trpcLocal } from '../../lib/trpcLocal';
import { toast } from 'sonner';
import { onBoardEvent } from '../../lib/realtime';
import { useFamilyStore, useMyRole } from '../../store/familyStore';
import { useAuthStore } from '../../store/authStore';
import { can } from '../../lib/rbac';
import type { SharedItemView } from './types';
import { importSharedToLocal, isImportable } from './importToLocal';

export interface FamilySharedItemsBoardProps {
  /** 业务模块标识：reminder | notes | mindmap | flow | domains */
  module: string;
  title: string;
  icon?: string;
  /** 把快照渲染为摘要（由模块自定义） */
  renderSnapshot: (item: SharedItemView) => ReactNode;
  /** 空状态提示 */
  emptyHint?: string;
  /** 是否需要特定权限查看（默认 viewShared） */
  requiredPermission?: 'viewShared' | 'viewFinance';
  /** 是否开启协作操作（标记完成 / 备注 / 删除）。默认关闭，纯只读展示。 */
  collaborative?: boolean;
}

export function FamilySharedItemsBoard({
  module,
  title,
  icon = '🔗',
  renderSnapshot,
  emptyHint,
  requiredPermission = 'viewShared',
  collaborative = false,
}: FamilySharedItemsBoardProps) {
  const familyId = useFamilyStore((s) => s.currentFamilyId);
  const members = useFamilyStore((s) => s.members);
  const myRole = useMyRole();
  const view = can(myRole, requiredPermission);
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');

  const [items, setItems] = useState<SharedItemView[]>([]);
  const [loading, setLoading] = useState(false);

  // 导入幂等守卫：记录已导入的共享项 id（持久化到 localStorage，跨视图切换 / 组件重挂载仍生效），
  // 避免重复点击「导入我的页面」把同一条共享事项反复 INSERT 进个人表。
  // 例：task 分支 importSharedToLocal 走 tasks.create 且不传 taskDate/repeat，
  // 服务端默认 taskDate=今天、repeat='none'，会被每日看板查出 → 来回切换累积重复卡片。
  const [importedIds, setImportedIds] = useState<Set<string>>(() => {
    // 防御：localStorage 中 dmImportedShared 若被损坏成非法 JSON，直接 JSON.parse 会抛错使组件挂载崩溃。
    try {
      const raw = localStorage.getItem('dmImportedShared');
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? (arr as string[]) : []);
    } catch {
      return new Set();
    }
  });

  // 合并刷新：去抖 + 防并发 + 可取消（AbortController）。
  // 多个 sharedItems.updated 事件在短窗口内只触发一次 listByFamily，
  // 避免 7 个看板 × 多标签页同时重拉把单源连接池（localhost:5173 ≈6）挤爆，
  // 导致保存按钮的响应拿不到空闲连接而卡在「保存中」/「加载中」。
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleReload = useCallback(
    (immediate = false) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const run = async () => {
        if (!familyId || !view) return;
        if (inFlight.current) {
          dirty.current = true; // 已有在飞请求：标记稍后补一次，避免叠加
          return;
        }
        inFlight.current = true;
        const ac = new AbortController();
        abortRef.current = ac;
        setLoading(true);
        try {
          const data = await trpc.sharedItems.listByFamily.query(
            { familyId, module },
            { signal: ac.signal },
          );
          setItems((data as SharedItemView[]) ?? []);
        } catch (e: unknown) {
          if ((e as { name?: string })?.name === 'AbortError') return; // 被更新的请求取代，忽略
          /* 无权限或无数据，忽略 */
        } finally {
          inFlight.current = false;
          setLoading(false);
          if (dirty.current) {
            dirty.current = false;
            scheduleReload(true); // 在飞期间又来事件，补一次
          }
        }
      };
      if (immediate) void run();
      else debounceRef.current = setTimeout(run, 400);
    },
    [familyId, view, module],
  );

  useEffect(() => {
    scheduleReload(true);
  }, [scheduleReload]);

  // 实时刷新：仅当事件属于本模块才重拉（server 已按 module 过滤广播；
  // 旧 server 不带 module 时退化为「全部重拉」，保持向后兼容）。
  useEffect(() => {
    if (!familyId) return;
    const off = onBoardEvent((e) => {
      if (e.kind !== 'sharedItems.updated' || e.familyId !== familyId) return;
      const m = (e as { module?: string }).module;
      if (m != null && m !== module) return; // 带 module 时精准过滤
      scheduleReload();
    });
    return off;
  }, [familyId, module, scheduleReload]);

  const memberName = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members) m.set(x.userId, x.name);
    return (id: string) => m.get(id) ?? '家庭成员';
  }, [members]);

  // 方案 B：把家庭成员共享的「事项」一键导入到自己的个人页面（本地 engine）。
  // 复用个人页已验证的同一批 trpcLocal 写命令，零新增 API，避免引入新 bug。
  const localUtils = trpcLocal.useUtils();
  const importOne = async (it: SharedItemView) => {
    if (importedIds.has(it.id)) {
      toast.info('该共享项已导入到我的页面');
      return;
    }
    try {
      const msg = await importSharedToLocal(localUtils, it);
      const next = new Set(importedIds).add(it.id);
      setImportedIds(next);
      localStorage.setItem('dmImportedShared', JSON.stringify([...next]));
      localUtils.invalidate(); // 让个人页（灵感/任务/提醒/孵化器）立即出现导入项
      toast.success(msg);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : '请稍后重试';
      toast.error(`导入失败：${raw}`);
    }
  };

  if (!view) {
    return (
      <div className="child-notice glass mx-auto mt-10 max-w-md text-center">
        🔒 该模块共享数据对你隐藏。需要对应权限才能查看家庭成员共享的内容。
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-100">
          <span>{icon}</span> {title}
        </h2>
        <span className="ml-auto text-xs text-gray-500">{items.length} 项共享</span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">加载中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-bg-border p-8 text-center text-sm text-gray-500">
          {emptyHint ?? '还没有家庭成员共享该模块的数据。在「个人模式」对应页面点击「共享到家庭」即可把你的数据分享到这里。'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it.id} className="flex flex-col rounded-xl border border-bg-border bg-bg-panel p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-gray-200">{memberName(it.ownerUserId)}</span>
                <ScopeBadge item={it} memberName={memberName} />
              </div>
              <div className="mb-1.5 truncate text-sm text-gray-100">{it.label}</div>
              <div className="mt-auto text-[11px] text-gray-400">{renderSnapshot(it)}</div>
              {isImportable(it) && !importedIds.has(it.id) && (
                <button
                  type="button"
                  onClick={() => void importOne(it)}
                  className="mt-1.5 flex items-center gap-1 rounded border border-bg-border px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-accent"
                >
                  <Download size={12} /> 导入我的页面
                </button>
              )}
              {collaborative && familyId && (
                <CollaborativeControls
                  item={it}
                  familyId={familyId}
                  onChanged={() => scheduleReload(true)}
                  localUtils={localUtils}
                  currentUserId={currentUserId}
                />
              )}
              <div className="mt-1.5 text-[10px] text-gray-500">
                更新于{' '}
                {new Date(it.updatedAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeBadge({ item, memberName }: { item: SharedItemView; memberName: (id: string) => string }) {
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

/**
 * 协作操作控件：任意家庭成员可标记完成 / 添加备注 / 删除共享项。
 * 走 server 的 sharedItems.update（requireMembership）与 sharedItems.remove（requireMembership），
 * 操作后触发看板即时刷新（server 会广播 sharedItems.updated，onBoardEvent 也会补一次）。
 */
function CollaborativeControls({
  item,
  familyId,
  onChanged,
  localUtils,
  currentUserId,
}: {
  item: SharedItemView;
  familyId: string;
  onChanged: () => void;
  localUtils: ReturnType<typeof trpcLocal.useUtils>;
  currentUserId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(item.note ?? '');

  const toggleDone = async () => {
    setBusy(true);
    try {
      await trpc.sharedItems.update.mutate({ familyId, id: item.id, done: !item.done });
      // 方向 A：协作页标记完成 → 回写个人页（本地 engine）。
      // 仅对「任务」类共享项回写；itemKey 即共享者本机的任务 id，
      // 只有本人本机持有该 id 的任务才会成功，其他家庭成员本机无此 id 会被捕获静默。
      if (item.module === 'task' && item.itemType === 'task') {
        try {
          if (!item.done) {
            await localUtils.client.tasks.complete.mutate({ id: item.itemKey });
          } else {
            await localUtils.client.tasks.uncomplete.mutate({ id: item.itemKey });
          }
          // 主动刷新个人看板：协作视图下 LocalApp 未挂载，SSE 事件会漏收，
          // 切回每日看板时若 query 仍 fresh 就不会重新拉取。refetch 确保状态立即同步。
          await localUtils.tasks.today.refetch();
          await localUtils.insights.dailyCard.refetch();
        } catch {
          /* 本地回写失败（如非所有者本机无此任务）不影响协作标记结果 */
        }
      }
      onChanged();
    } catch {
      /* 忽略 */
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    setBusy(true);
    try {
      await trpc.sharedItems.update.mutate({ familyId, id: item.id, note });
      setNoteOpen(false);
      onChanged();
    } catch {
      /* 忽略 */
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`确定删除「${item.label}」的共享吗？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await trpc.sharedItems.remove.mutate({ familyId, id: item.id });
      onChanged();
    } catch {
      /* 忽略 */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggleDone()}
          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
            item.done
              ? 'border-green-500/50 bg-green-500/15 text-green-300'
              : 'border-bg-border text-gray-400 hover:text-gray-200'
          }`}
        >
          {item.done ? <CheckSquare size={12} /> : <Square size={12} />} {item.done ? '已完成' : '标记完成'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setNoteOpen((v) => !v)}
          className="rounded border border-bg-border px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-200"
        >
          📝 备注
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="ml-auto rounded border border-bg-border px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-red-400"
          title="删除共享"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {noteOpen && (
        <div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="添加协作备注…"
            className="w-full rounded border border-bg-border bg-bg-base px-2 py-1 text-[11px] text-gray-100 outline-none focus:ring-1 focus:ring-accent/40"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveNote()}
            className="mt-1 rounded bg-accent/15 px-2 py-0.5 text-[10px] text-accent"
          >
            保存备注
          </button>
        </div>
      )}
      {item.note && !noteOpen && (
        <div className="rounded bg-bg-base px-2 py-1 text-[10px] text-gray-400">📝 {item.note}</div>
      )}
    </div>
  );
}
