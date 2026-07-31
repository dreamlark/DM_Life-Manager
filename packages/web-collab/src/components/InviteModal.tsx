import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { can, ASSIGNABLE_ROLES } from '../lib/rbac';
import type { Role } from '@dm-life/server';
import { roleLabel } from './RoleBadge';

export function InviteModal({ familyId, myRole }: { familyId: string; myRole: Role }) {
  const [role, setRole] = useState<Role>('member');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  async function generate() {
    setError(null);
    setBusy(true);
    try {
      const r = await trpc.families.invite.mutate({ familyId, role });
      setToken(r.token);
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setToken(null);
  }

  if (!open) return null;
  const canInvite = can(myRole, 'manageMembers');

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>邀请家人</h3>
          <button className="icon-btn" onClick={close} type="button">
            ✕
          </button>
        </div>

        {!token ? (
          <>
            <p className="modal-sub">选择新成员加入后的角色</p>
            <div className="role-picker">
              {ASSIGNABLE_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={role === r ? 'role-opt active' : 'role-opt'}
                  onClick={() => setRole(r)}
                >
                  {roleLabel(r)}
                </button>
              ))}
            </div>
            {error && <div className="form-error">{error}</div>}
            <button className="btn-primary magnetic" disabled={!canInvite || busy} onClick={generate} type="button">
              {busy ? '生成中…' : '生成邀请令牌'}
            </button>
            {!canInvite && <p className="modal-hint">当前角色无权邀请成员</p>}
          </>
        ) : (
          <>
            <p className="modal-sub">复制下面的令牌，通过任意方式发给家人：</p>
            <code className="token-box">{token}</code>
            <div className="modal-actions">
              <button
                className="btn-primary magnetic"
                type="button"
                onClick={() => navigator.clipboard?.writeText(token)}
              >
                复制令牌
              </button>
              <button className="btn-ghost" type="button" onClick={close}>
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function extractMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return '操作失败，请重试';
}
