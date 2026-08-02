import { describe, it, expect, afterEach } from 'vitest';

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

// 动态导入：确保上面的 localStorage 垫片先就位，再加载 pinStore（其顶层会调用 readVault）。
const { encryptCreds, decryptCreds, hasWebCrypto } = await import('./pinStore');

// noble 原语（与被测模块回落分支使用同一套，证明字节级互通）。
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { gcm } from '@noble/ciphers/aes';

// —— 原生 Web Crypto 派生 / 加解密（模拟 HTTPS 安全上下文路径）——
async function nativeDeriveKey(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
async function nativeEncrypt(key: CryptoKey, iv: Uint8Array<ArrayBuffer>, pt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt));
}
async function nativeDecrypt(key: CryptoKey, iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const PIN = '8080-lan-pin';
const SALT = crypto.getRandomValues(new Uint8Array(16));
const IV = crypto.getRandomValues(new Uint8Array(12));
const PT = new TextEncoder().encode(JSON.stringify({ email: 'a@b.com', password: 's3cr3t' }));

describe('跨后端字节兼容（noble ↔ Web Crypto.subtle）', () => {
  it('noble 加密 → subtle 解密（HTTP 写入的 vault 可被 HTTPS 解锁）', async () => {
    const keyNoble = pbkdf2(sha256, new TextEncoder().encode(PIN), SALT, { c: 150_000, dkLen: 32 });
    const ctNoble = gcm(keyNoble, IV).encrypt(PT);
    const k = await nativeDeriveKey(PIN, SALT);
    const back = await nativeDecrypt(k, IV, new Uint8Array(ctNoble));
    expect(bytesEqual(back, PT)).toBe(true);
  });

  it('subtle 加密 → noble 解密（HTTPS 写入的 vault 可被 HTTP 解锁）', async () => {
    const k = await nativeDeriveKey(PIN, SALT);
    const ctSubtle = await nativeEncrypt(k, IV, PT);
    const keyNoble = pbkdf2(sha256, new TextEncoder().encode(PIN), SALT, { c: 150_000, dkLen: 32 });
    const back = gcm(keyNoble, IV).decrypt(ctSubtle);
    expect(bytesEqual(back, PT)).toBe(true);
  });
});

describe('功能往返（encryptCreds/decryptCreds，Node 下 isSecureContext=false → 走 noble 回落）', () => {
  it('正确 PIN 还原原文', async () => {
    const creds = { email: 'u@x.io', password: 'pw' };
    const blob = await encryptCreds('pin123', creds);
    expect(blob.v).toBe(1);
    expect(typeof blob.salt).toBe('string');
    expect(typeof blob.iv).toBe('string');
    expect(typeof blob.ct).toBe('string');
    expect(typeof blob.expiresAt).toBe('number');
    const out = await decryptCreds('pin123', blob);
    expect(out).toEqual(creds);
  });

  it('错误 PIN 返回 null（GCM 标签校验失败）', async () => {
    const blob = await encryptCreds('right', { local: true });
    const out = await decryptCreds('wrong', blob);
    expect(out).toBeNull();
  });

  it('VaultBlob 字段与旧版格式一致（v/salt/iv/ct/expiresAt）', async () => {
    const blob = await encryptCreds('p', { email: 'e' });
    expect(Object.keys(blob).sort()).toEqual(['ct', 'expiresAt', 'iv', 'salt', 'v']);
  });
});

describe('hasWebCrypto 分支', () => {
  const original = (globalThis as unknown as { isSecureContext?: boolean }).isSecureContext;
  afterEach(() => {
    const g = globalThis as unknown as { isSecureContext?: boolean };
    if (original === undefined) delete g.isSecureContext;
    else g.isSecureContext = original;
  });

  it('Node 测试环境（非安全上下文）返回 false → 回落 noble', () => {
    expect(hasWebCrypto()).toBe(false);
  });

  it('临时置 isSecureContext=true 时返回 true → 走原生', () => {
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });
    expect(hasWebCrypto()).toBe(true);
  });
});
