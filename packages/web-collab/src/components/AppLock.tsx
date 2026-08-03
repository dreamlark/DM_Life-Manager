import { useCallback, useEffect, useRef, useState } from 'react';
import { usePinStore, pinLockRemainingMs, type PinCreds } from '../store/pinStore';
import { FloatingIcon } from './FloatingIcon';

interface AppLockProps {
  children: React.ReactNode;
  /** PIN 解锁成功后回调：协作模式用解密出的凭据自动登录，个人模式无需处理 */
  onUnlock: (creds: PinCreds) => Promise<boolean> | void;
  /** 用户选择「忘记 PIN」：清空凭据库后回到登录 / 重新设置 */
  onForgotPin: () => void;
}

/** 四位数字 PIN 输入框（自动跳格、支持粘贴） */
export function PinField({
  value,
  onChange,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 4 }, (_, i) => value[i] ?? '');

  const setDigit = (i: number, ch: string) => {
    const arr = digits.slice();
    arr[i] = ch;
    const next = arr.join('').replace(/\s/g, '');
    onChange(next);
    if (ch && i < 3) refs.current[i + 1]?.focus();
  };

  return (
    <div className="pin-field">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          className="pin-cell"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, '').slice(-1);
            setDigit(i, ch);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
            onChange(text);
            refs.current[Math.min(text.length, 3)]?.focus();
          }}
        />
      ))}
    </div>
  );
}

export function AppLock({ children, onUnlock, onForgotPin }: AppLockProps) {
  const hasPin = usePinStore((s) => s.hasPin);
  const locked = usePinStore((s) => s.locked);
  const setupOpen = usePinStore((s) => s.setupOpen);
  const rearm = usePinStore((s) => s.rearm);
  const lockDurationMin = usePinStore((s) => s.lockDurationMin);

  const finalizeSetup = usePinStore((s) => s.finalizeSetup);
  const cancelSetup = usePinStore((s) => s.cancelSetup);
  const unlock = usePinStore((s) => s.unlock);
  const removePin = usePinStore((s) => s.removePin);

  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockRemaining, setLockRemaining] = useState(0);

  const idleTimer = useRef<number | null>(null);

  // P2-12：PIN 锁死期间轮询剩余时间，驱动倒计时文案与输入禁用
  useEffect(() => {
    if (!locked || setupOpen) return;
    let timer: number | undefined;
    const tick = () => {
      const rem = pinLockRemainingMs();
      setLockRemaining(rem);
      if (rem > 0) timer = window.setTimeout(tick, 500);
    };
    tick();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
    // lockRemaining 也在依赖里：输错 PIN 后 lockUntil 写入 localStorage 但 React 状态未变，
    // 若只依赖 [locked, setupOpen]，tick 不会重新启动，倒计时被「冻结」导致输入框一直 disabled、
    // 用户无法再次输入 PIN（只能点「忘记 PIN」）。加入 lockRemaining 让倒计时持续走到 0 后自动解禁。
  }, [locked, setupOpen, lockRemaining]);

  // 空闲自动锁：解锁且已设 PIN 时，超时无操作则锁定
  useEffect(() => {
    if (locked || !hasPin || lockDurationMin <= 0) return;
    const reset = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => usePinStore.getState().lockNow(), lockDurationMin * 60_000);
    };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [locked, hasPin, lockDurationMin]);

  const doUnlock = useCallback(async () => {
    const rem = pinLockRemainingMs();
    if (rem > 0) {
      setLockRemaining(rem);
      setError(`尝试过于频繁，请 ${Math.ceil(rem / 1000)} 秒后重试`);
      return;
    }
    if (pin.length !== 4) {
      setError('请输入 4 位 PIN');
      return;
    }
    setBusy(true);
    setError(null);
    const creds = await unlock(pin);
    if (!creds) {
      setBusy(false);
      const rem2 = pinLockRemainingMs();
      setLockRemaining(rem2);
      setError(rem2 > 0 ? `PIN 错误，请 ${Math.ceil(rem2 / 1000)} 秒后重试` : 'PIN 错误，请重试');
      setPin('');
      return;
    }
    const ok = await onUnlock(creds);
    setBusy(false);
    if (!ok) {
      // 解密成功但重新登录失败（如凭据过期）：清空库，回退到登录
      removePin();
      onForgotPin();
      return;
    }
    setPin('');
  }, [pin, unlock, onUnlock, removePin, onForgotPin]);

  // 输入满 4 位后自动解锁，无需点击确认按钮
  useEffect(() => {
    if (pin.length === 4 && !busy && !setupOpen && locked && lockRemaining === 0) {
      void doUnlock();
    }
  }, [pin, busy, setupOpen, locked, lockRemaining, doUnlock]);

  const doSetup = useCallback(async () => {
    if (pin.length !== 4) {
      setError('请输入 4 位 PIN');
      return;
    }
    if (pin !== confirm) {
      setError('两次输入的 PIN 不一致');
      return;
    }
    setBusy(true);
    await finalizeSetup(pin);
    setBusy(false);
    setPin('');
    setConfirm('');
  }, [pin, confirm, finalizeSetup]);

  // 正常态：渲染应用本体
  if (!locked && !setupOpen) return <>{children}</>;

  // 设置 PIN（首次登录 / 首次进入个人模式 / 凭据过期重设）
  if (setupOpen) {
    return (
      <div className="applock">
        <div className="applock-card glass">
          <FloatingIcon icon="🔐" tone="violet" size="lg" />
          <h2>{rearm ? '重新设置 4 位 PIN' : '设置 4 位 PIN'}</h2>
          <p className="applock-sub">
            {rearm
              ? '本机已有的 PIN 属于另一个账户，请重新设置 4 位 PIN 绑定当前账户（凭据仍将经 PIN 加密保存在本机）。'
              : '用于锁屏后快速解锁，凭据将经 PIN 加密保存在本机。'}
          </p>
          <PinField value={pin} onChange={(v) => { setPin(v); setError(null); }} autoFocus />
          <PinField value={confirm} onChange={(v) => { setConfirm(v); setError(null); }} />
          {error && <div className="form-error">{error}</div>}
          <button className="btn-primary magnetic" disabled={busy} onClick={doSetup} type="button">
            {busy ? '保存中…' : '确认设置'}
          </button>
          <button className="btn-ghost sm" type="button" onClick={() => { cancelSetup(); setPin(''); setConfirm(''); }}>
            暂不设置
          </button>
        </div>
      </div>
    );
  }

  // 锁屏解锁
  return (
    <div className="applock">
      <div className="applock-card glass">
        <FloatingIcon icon="🔒" tone="rose" size="lg" />
        <h2>已锁定</h2>
        <p className="applock-sub">输入 4 位 PIN 解锁应用</p>
        <PinField
          value={pin}
          onChange={(v) => { setPin(v); setError(null); }}
          autoFocus
          disabled={busy || lockRemaining > 0}
        />
        {error && <div className="form-error">{error}</div>}
        {lockRemaining > 0 && (
          <div className="form-error" aria-live="polite">
            PIN 已锁定，约 {Math.ceil(lockRemaining / 1000)} 秒后重试
          </div>
        )}
        <button className="btn-ghost sm" type="button" onClick={onForgotPin}>
          忘记 PIN？
        </button>
      </div>
    </div>
  );
}
