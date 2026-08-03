// Bug A 回归：账号密码登录成功后，若本机 PIN 库属于同一账户，就不该再要求重新录入 PIN。
// 旧逻辑 AuthScreen 在每次密码登录后无条件 openSetup(...)，导致「登录完还要再录两次 PIN」。
// 修复引入 rearmForAccount(email)：同账户 → 续期本地 PIN 窗口（'rearmed'，直接进应用）；
// 无库 → 'absent'（首次设置）；异账户 → 'mismatch'（必须重设，不能让 A 的 PIN 解出 B 的凭据）。
// 本测试同时锁死安全red line：续期只改明文 expiresAt，salt/iv/ct 一个字节都不动，PIN 仍能解密。
import { describe, it, expect, beforeEach } from 'vitest';

// 在导入被测模块前补齐 Node 下缺失的 localStorage（pinStore 模块加载时会调用 readVault）。
const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => {
    mem.set(k, String(v));
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() {
    return mem.size;
  },
} as unknown as Storage;
(globalThis as unknown as { localStorage: Storage }).localStorage = ls;

const { usePinStore, decryptCreds, hasValidVault, isVaultExpired } = await import('./pinStore');

const VAULT_KEY = 'dm-pinvault';
const ACCT_KEY = 'dm-pinvault-acct';
const PIN = '2468';
const EMAIL = 'owner@home.dev';
const CREDS = { email: EMAIL, password: 'secret123' };

type Blob = { v: 1; salt: string; iv: string; ct: string; expiresAt: number };
const readBlob = (): Blob => JSON.parse(mem.get(VAULT_KEY) as string) as Blob;

beforeEach(async () => {
  mem.clear();
  usePinStore.setState({
    hasPin: false,
    locked: false,
    expired: false,
    setupOpen: false,
    rearm: false,
    pendingCreds: null,
  });
  await usePinStore.getState().setup(PIN, CREDS);
});

describe('Bug A：密码登录后不再重复要求录入 PIN', () => {
  it('同一账户密码登录 → rearmed，且不打开 PIN 设置弹窗', () => {
    const r = usePinStore.getState().rearmForAccount(EMAIL);
    expect(r).toBe('rearmed');
    const s = usePinStore.getState();
    expect(s.setupOpen).toBe(false);
    expect(s.locked).toBe(false);
    expect(s.expired).toBe(false);
    expect(s.hasPin).toBe(true);
  });

  it('续期只改 expiresAt：salt/iv/ct 逐字节不变，PIN 仍能解出原凭据', async () => {
    const before = readBlob();
    // 先把有效期改到过去，确保续期确实推进了 expiresAt
    mem.set(VAULT_KEY, JSON.stringify({ ...before, expiresAt: Date.now() - 1000 }));
    expect(isVaultExpired()).toBe(true);

    expect(usePinStore.getState().rearmForAccount(EMAIL)).toBe('rearmed');

    const after = readBlob();
    expect(after.salt).toBe(before.salt);
    expect(after.iv).toBe(before.iv);
    expect(after.ct).toBe(before.ct); // 密文零改动 → 加密强度与 PIN 绑定关系不变
    expect(after.v).toBe(before.v);
    expect(Object.keys(after).sort()).toEqual(['ct', 'expiresAt', 'iv', 'salt', 'v']);
    expect(after.expiresAt).toBeGreaterThan(Date.now());
    expect(hasValidVault()).toBe(true);

    // 关键安全断言：PIN 依然是解密的唯一钥匙
    expect(await decryptCreds(PIN, after)).toEqual(CREDS);
    expect(await decryptCreds('9999', after)).toBeNull();
  });

  it('另一个账户登录 → mismatch，必须重设 PIN（不能用 A 的 PIN 解出 B 的凭据）', () => {
    expect(usePinStore.getState().rearmForAccount('other@home.dev')).toBe('mismatch');
    // 未被续期，也未静默改写归属
    expect(mem.get(ACCT_KEY)).toBeTruthy();
  });

  it('邮箱大小写/首尾空格不影响归属判定', () => {
    expect(usePinStore.getState().rearmForAccount('  OWNER@Home.DEV  ')).toBe('rearmed');
  });

  it('本机没有 PIN 库 → absent（走首次设置流程）', () => {
    usePinStore.getState().removePin();
    expect(usePinStore.getState().rearmForAccount(EMAIL)).toBe('absent');
    expect(mem.get(ACCT_KEY)).toBeUndefined();
  });

  it('旧版库（升级前没有账户指纹）按同账户处理并补登记，不打扰老用户', () => {
    mem.delete(ACCT_KEY);
    expect(usePinStore.getState().rearmForAccount(EMAIL)).toBe('rearmed');
    expect(mem.get(ACCT_KEY)).toBeTruthy(); // 已补登记
    // 补登记之后，异账户仍然能被识别出来
    expect(usePinStore.getState().rearmForAccount('other@home.dev')).toBe('mismatch');
  });

  it('换 PIN 后归属指纹随新盐重算，仍判定为同一账户', async () => {
    const oldFp = mem.get(ACCT_KEY);
    await usePinStore.getState().setup('1357', CREDS); // 重新加密 → 换盐
    expect(mem.get(ACCT_KEY)).not.toBe(oldFp); // 盐变了，指纹必须跟着变
    expect(usePinStore.getState().rearmForAccount(EMAIL)).toBe('rearmed');
  });
});
