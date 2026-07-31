import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { useAuthStore } from '../store/authStore';
import { FloatingIcon } from './FloatingIcon';

export function AcceptInvite({ onJoined, onCancel }: { onJoined: () => void; onCancel: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const user = useAuthStore((s) => s.user);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await trpc.families.acceptInvite.mutate({ token: token.trim() });
      onJoined();
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card glass">
        <div className="auth-card-top">
          <span className="auth-card-spacer" />
          <button
            className="icon-btn"
            type="button"
            onClick={onCancel}
            title="返回看板"
            aria-label="返回看板"
          >
            ✕
          </button>
        </div>

        <div className="brand">
          <FloatingIcon icon="✉️" tone="pink" size="lg" />
          <h1>加入家庭</h1>
          <p className="brand-sub">{user ? `以 ${user.name} 的身份` : '粘贴邀请令牌加入'}</p>
        </div>

        <form onSubmit={accept} className="auth-form">
          <label className="field">
            <span>邀请令牌</span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="家人分享给你的邀请码"
              required
              autoFocus
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn-primary magnetic" disabled={busy} type="submit">
            {busy ? '加入中…' : '加入家庭'}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            ← 返回看板
          </button>
        </form>

        <p className="auth-tip">没有邀请码？让家人点「邀请成员」生成后发给你。</p>
      </div>
    </div>
  );
}

function extractMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return '操作失败，请重试';
}
