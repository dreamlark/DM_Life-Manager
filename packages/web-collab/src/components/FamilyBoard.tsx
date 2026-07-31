import { useCallback, useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';
import { onBoardEvent, useRealtimeStore } from '../lib/realtime';
import { useFamilyStore } from '../store/familyStore';
import { useAuthStore } from '../store/authStore';
import { can } from '../lib/rbac';
import type { Role } from '@dm-life/server';
import { RoleBadge } from './RoleBadge';
import { InviteModal } from './InviteModal';
import { Toasts } from './Toasts';

// 稳定的空数组引用，供 Zustand 选择器返回，避免每次渲染产生新数组触发无限循环
const EMPTY: string[] = [];

export function FamilyBoard({ onLeft }: { onLeft: () => void }) {
  const families = useFamilyStore((s) => s.families);
  const currentFamilyId = useFamilyStore((s) => s.currentFamilyId);
  const members = useFamilyStore((s) => s.members);
  const setMembers = useFamilyStore((s) => s.setMembers);
  const setCurrent = useFamilyStore((s) => s.setCurrent);
  const setFamilies = useFamilyStore((s) => s.setFamilies);
  const resetFamily = useFamilyStore((s) => s.reset);

  const me = useAuthStore((s) => s.user);
  // 注意：必须选中稳定值（字符串/数组引用），避免每次渲染返回新数组触发 Zustand v5 无限循环
  const onlineList = useRealtimeStore((s) => (currentFamilyId ? (s.online[currentFamilyId] ?? EMPTY) : EMPTY));
  const onlineIds = onlineList;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const current = families.find((f) => f.id === currentFamilyId) ?? null;
  const myRole = current?.role ?? null;
  const amManager = can(myRole, 'manageMembers');
  const amOwner = myRole === 'owner';

  const refreshMembers = useCallback(
    async (familyId?: string) => {
      const fid = familyId ?? currentFamilyId;
      if (!fid) return;
      const ms = await trpc.families.members.query({ familyId: fid });
      setMembers(ms);
    },
    [currentFamilyId, setMembers],
  );

  // 实时网关：收到当前家庭的板级事件即刷新成员网格（无需手动 reload）
  useEffect(() => {
    const off = onBoardEvent((e) => {
      if (e.familyId === currentFamilyId) void refreshMembers();
    });
    return off;
  }, [currentFamilyId, refreshMembers]);

  async function switchFamily(id: string) {
    setCurrent(id);
    setFeedback(null);
    await refreshMembers(id);
  }

  async function leave() {
    if (!currentFamilyId || !window.confirm('确定退出当前家庭？')) return;
    await trpc.families.leave.mutate({ familyId: currentFamilyId });
    resetFamily();
    onLeft();
  }

  async function removeMember(userId: string, name: string) {
    if (!currentFamilyId || !window.confirm(`将 ${name} 移出家庭？`)) return;
    setBusyId(userId);
    try {
      await trpc.families.removeMember.mutate({ familyId: currentFamilyId, userId });
      setFeedback(`已移除 ${name}`);
      await refreshMembers();
    } catch (e) {
      setFeedback(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(userId: string, name: string, role: Role) {
    if (!currentFamilyId) return;
    setBusyId(userId);
    try {
      await trpc.families.updateRole.mutate({ familyId: currentFamilyId, userId, role });
      setFeedback(`${name} 的角色已更新为 ${role}`);
      await refreshMembers();
    } catch (e) {
      setFeedback(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  async function transfer(userId: string, name: string) {
    if (!currentFamilyId || !window.confirm(`将家庭所有者转让给 ${name}？你将降级为管理员。`)) return;
    setBusyId(userId);
    try {
      await trpc.families.transferOwnership.mutate({ familyId: currentFamilyId, userId });
      setFeedback(`已将所有者转让给 ${name}`);
      // 角色变更后刷新家庭列表与成员
      const list = await trpc.families.list.query();
      setFamilies(list);
      await refreshMembers();
    } catch (e) {
      setFeedback(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  async function createFamily() {
    const name = newName.trim();
    if (!name) return;
    setCreateBusy(true);
    try {
      const f = await trpc.families.create.mutate({ name });
      const list = await trpc.families.list.query();
      setFamilies(list);
      setCurrent(f.id);
      if (me) {
        setMembers([
          { userId: me.id, name: me.name, email: me.email, role: 'owner', joinedAt: new Date().toISOString() },
        ]);
      }
      setCreateOpen(false);
      setNewName('');
      setFeedback(`已创建家庭「${name}」`);
    } catch (e) {
      setFeedback(errMsg(e));
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="board">
      <header className="board-head glass">
        <div className="board-title">
          <span className="board-emoji">🏡</span>
          <div>
            <h2>{current ? current.name : '暂无家庭'}</h2>
            {myRole && (
              <div className="my-role">
                我的角色：<RoleBadge role={myRole} size="sm" />
              </div>
            )}
          </div>
        </div>

        <div className="board-head-right">
          {families.length > 0 && (
            <select
              className="family-switch"
              value={currentFamilyId ?? ''}
              onChange={(e) => switchFamily(e.target.value)}
            >
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}

          <button className="btn-ghost magnetic" type="button" onClick={() => setCreateOpen((v) => !v)}>
            ＋ 创建家庭
          </button>
          {amManager && (
            <button className="btn-primary magnetic" type="button" onClick={() => setInviteOpen(true)}>
              ＋ 邀请成员
            </button>
          )}
          <button className="btn-exit" type="button" onClick={leave} title="退出当前家庭">
            ↩ 退出家庭
          </button>
        </div>
      </header>

      {feedback && <div className="board-feedback">{feedback}</div>}

      <Toasts />

      {createOpen && (
        <div className="create-row glass">
          <label className="field" style={{ flex: 1 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="家庭名称，如「李家」"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createFamily();
              }}
              autoFocus
            />
          </label>
          <button className="btn-primary sm magnetic" type="button" disabled={createBusy} onClick={() => void createFamily()}>
            {createBusy ? '创建中…' : '创建'}
          </button>
          <button className="btn-ghost sm" type="button" onClick={() => setCreateOpen(false)}>
            取消
          </button>
        </div>
      )}

      {myRole === 'child' && (
        <div className="child-notice glass">
          🧒 你是儿童成员：可以看到家人与任务，但财务金额与管理操作对你隐藏。
        </div>
      )}

      <div className="member-grid">
        {members.map((m) => {
          const isSelf = me?.id === m.userId;
          const isOwner = m.role === 'owner';
          const isOnline = onlineIds.includes(m.userId);
          return (
            <div key={m.userId} className={`member-card glass${isOnline ? ' online' : ''}`}>
              <div className="member-top">
                <div className="avatar">{(m.name || '?').slice(0, 1).toUpperCase()}</div>
                <div className="member-meta">
                  <div className="member-name">
                    {m.name}
                    {isSelf && <span className="you-tag">你</span>}
                  </div>
                  <div className="member-email">{m.email}</div>
                </div>
                <RoleBadge role={m.role} />
              </div>

              {(amManager || amOwner) && !isSelf && (
                <div className="member-actions">
                  {amManager && !isOwner && (
                    <>
                      <select
                        className="role-select"
                        value={m.role}
                        disabled={busyId === m.userId}
                        onChange={(e) => changeRole(m.userId, m.name, e.target.value as Role)}
                      >
                        <option value="admin">管理员</option>
                        <option value="member">成员</option>
                        <option value="child">儿童</option>
                        <option value="guest">访客</option>
                      </select>
                      <button
                        className="btn-danger sm"
                        type="button"
                        disabled={busyId === m.userId}
                        onClick={() => removeMember(m.userId, m.name)}
                      >
                        移除
                      </button>
                    </>
                  )}
                  {amOwner && !isOwner && (
                    <button
                      className="btn-ghost sm"
                      type="button"
                      disabled={busyId === m.userId}
                      onClick={() => transfer(m.userId, m.name)}
                    >
                      👑 转让所有者
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {inviteOpen && currentFamilyId && (
        <InviteModal familyId={currentFamilyId} myRole={myRole ?? 'guest'} />
      )}
    </div>
  );
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return '操作失败';
}
