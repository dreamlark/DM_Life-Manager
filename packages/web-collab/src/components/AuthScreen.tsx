import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { useAuthStore } from '../store/authStore';
import { usePinStore } from '../store/pinStore';
import { FloatingIcon } from './FloatingIcon';
import { PinField } from './AppLock';

type Mode = 'login' | 'register';

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const openSetup = usePinStore((s) => s.openSetup);
  const setup = usePinStore((s) => s.setup);
  const hasPin = usePinStore((s) => s.hasPin);
  const expired = usePinStore((s) => s.expired);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPin('');
    setConfirmPin('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'register') {
      if (pin.length !== 4) {
        setError('请输入 4 位数字 PIN');
        return;
      }
      if (pin !== confirmPin) {
        setError('两次输入的 PIN 不一致');
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'register') {
        const r = await trpc.auth.register.mutate({ name, email, password });
        setTokens(r.accessToken, r.refreshToken);
        setUser(r.user);
        // 注册时直接完成 PIN 设置，把账号凭据加密保存在本地，不再弹 PIN 设置弹窗
        await setup(pin, { email, password });
      } else {
        const r = await trpc.auth.login.mutate({ email, password });
        setTokens(r.accessToken, r.refreshToken);
        setUser(r.user);
        // 首次登录（无 PIN 库）或凭据过期（库存在但超期）→ 引导设置/重设 PIN。
        if (!hasPin || expired) openSetup({ email, password }, hasPin);
      }
      onAuthed();
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card glass">
        <div className="brand">
          <FloatingIcon icon="🏡" tone="indigo" size="lg" />
          <h1>人生管理系统</h1>
        </div>

        <div className="seg">
          <button
            className={mode === 'login' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => switchMode('login')}
            type="button"
          >
            登录
          </button>
          <button
            className={mode === 'register' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => switchMode('register')}
            type="button"
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <label className="field">
              <span>昵称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字" required />
            </label>
          )}
          <label className="field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@home.dev"
              required
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              minLength={6}
              required
            />
          </label>

          {mode === 'register' && (
            <>
              <label className="field">
                <span>设置 4 位 PIN</span>
                <PinField value={pin} onChange={(v) => { setPin(v); setError(null); }} />
                <span className="field-hint">用于锁屏后快速解锁，仅保存在本机</span>
              </label>
              <label className="field">
                <span>确认 PIN</span>
                <PinField value={confirmPin} onChange={(v) => { setConfirmPin(v); setError(null); }} />
              </label>
            </>
          )}

          {error && <div className="form-error">{error}</div>}

          <button className="btn-primary magnetic" disabled={busy} type="submit">
            {busy ? '处理中…' : mode === 'register' ? '创建账号' : '进入'}
          </button>
        </form>

        <p className="auth-tip">
          {mode === 'register'
            ? '注册即创建你的个人空间，开启人生管理系统'
            : '登录后继续管理你的人生系统'}
        </p>
      </div>
    </div>
  );
}

function extractMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return '操作失败，请重试';
}
