import { create } from 'zustand';

/**
 * PIN 锁屏凭据库（替代失效的「记住我」）。
 *
 * 设计要点：
 * - 凭据（协作模式的邮箱/密码，或个人模式的本地标记）用「PIN 派生的密钥」经 Web Crypto
 *   AES-GCM 加密后写入 localStorage。重启后只需输入 PIN 即可解密并自动登录，无需再输邮箱密码。
 * - PIN 仅用于本地锁屏，绝不明文存储；仅保存 PBKDF2 的 salt + AES-GCM 的 iv + 密文。
 * - 凭据库带过期时间（PIN_VALIDITY_MS）：有效期内只需 PIN 即可解锁登录；过期后必须重新
 *   输入账号密码登录（首次登录同理：本地无有效库即视为需认证）。每次成功解锁会刷新过期时间，
 *   保证「活跃使用期间」始终只需 PIN。
 * - 锁定时长（空闲自动锁）单独持久化，0 表示「从不自动锁」。
 */

const VAULT_KEY = 'dm-pinvault';
const LOCK_KEY = 'dm-pinlock';
const VALIDITY_KEY = 'dm-pin-validity';

/** PIN 有效期预设选项（单位：毫秒）。0 表示「永久」。 */
export const PIN_VALIDITY_OPTIONS = [
  { label: '1 天', ms: 1 * 24 * 60 * 60 * 1000 },
  { label: '7 天', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 天', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '90 天', ms: 90 * 24 * 60 * 60 * 1000 },
  { label: '1 年', ms: 365 * 24 * 60 * 60 * 1000 },
  { label: '永久', ms: 0 },
] as const;

const DEFAULT_VALIDITY_MS = PIN_VALIDITY_OPTIONS[1]!.ms;

/** 读取用户设置的 PIN 有效期（ms），非法/未设置时回退 7 天。 */
export function getPinValidityMs(): number {
  try {
    const raw = localStorage.getItem(VALIDITY_KEY);
    if (raw === null) return DEFAULT_VALIDITY_MS;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    /* 隐私模式读取失败时忽略 */
  }
  return DEFAULT_VALIDITY_MS;
}

function setPinValidityMs(ms: number) {
  try {
    localStorage.setItem(VALIDITY_KEY, String(ms));
  } catch {
    /* 隐私模式忽略 */
  }
}

// —— P2-12：PIN 解锁限流（防御本地暴力枚举）——
// 客户端锁死可被清空 localStorage 绕过，属纵深防御；目标是把「随手试 PIN」的成本抬到不划算。
const ATTEMPT_KEY = 'dm-pin-attempts';
const LOCK_UNTIL_KEY = 'dm-pin-lock-until';
/** 失败后基础锁定时长（ms），按指数退避翻倍（10s → 20s → 40s …）。 */
const PIN_LOCK_BASE_MS = 10_000;
/** 锁定封顶时长（ms）：1 小时。 */
const PIN_LOCK_MAX_MS = 60 * 60_000;

function getFailed(): number {
  try {
    const n = Number(localStorage.getItem(ATTEMPT_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
function setFailed(n: number) {
  try {
    localStorage.setItem(ATTEMPT_KEY, String(n));
  } catch {
    /* 隐私模式忽略 */
  }
}
function getLockUntil(): number {
  try {
    const n = Number(localStorage.getItem(LOCK_UNTIL_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
function setLockUntil(ts: number) {
  try {
    localStorage.setItem(LOCK_UNTIL_KEY, String(ts));
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 距离 PIN 锁死解除还有多少毫秒（0 = 未锁定，可立即尝试）。UI 用于反馈倒计时。 */
export function pinLockRemainingMs(): number {
  return Math.max(0, getLockUntil() - Date.now());
}

/** PIN 凭据有效期（本地“记住我”窗口）。过期后需重新输入账号密码登录。 */
export const PIN_VALIDITY_MS = DEFAULT_VALIDITY_MS;

export interface PinCreds {
  email?: string;
  password?: string;
  /** 个人模式无账号凭据，仅用本地标记占位以便校验 PIN */
  local?: boolean;
}

interface VaultBlob {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
  /** 凭据过期时间戳（ms）。超过则需重新输入账号密码登录。 */
  expiresAt: number;
}

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptCreds(pin: string, creds: PinCreds): Promise<VaultBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16))) as Uint8Array<ArrayBuffer>;
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12))) as Uint8Array<ArrayBuffer>;
  const key = await deriveKey(pin, salt);
  const data = new TextEncoder().encode(JSON.stringify(creds));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const validityMs = getPinValidityMs();
  const expiresAt =
    validityMs === 0 ? Number.MAX_SAFE_INTEGER : Date.now() + validityMs;
  return {
    v: 1,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
    // 写入时即附带过期时间，形成带有效期的“记住我”窗口
    expiresAt,
  };
}

async function decryptCreds(pin: string, blob: VaultBlob): Promise<PinCreds | null> {
  try {
    const key = await deriveKey(pin, fromB64(blob.salt));
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(blob.iv) },
      key,
      fromB64(blob.ct),
    );
    return JSON.parse(new TextDecoder().decode(pt)) as PinCreds;
  } catch {
    return null;
  }
}

function readVault(): VaultBlob | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Partial<VaultBlob>;
    if (!b.salt || !b.iv || !b.ct) return null;
    // 兼容旧版库（无 expiresAt）：视为仍处于有效期内，祖父级给予一个全新窗口，避免老用户被迫重登
    return {
      v: 1,
      salt: b.salt,
      iv: b.iv,
      ct: b.ct,
      expiresAt: b.expiresAt ?? Date.now() + PIN_VALIDITY_MS,
    };
  } catch {
    return null;
  }
}

/** 凭据库是否存在且未过期（可在 PIN 锁屏阶段凭 PIN 解锁）。 */
export function hasValidVault(): boolean {
  const blob = readVault();
  return Boolean(blob) && Date.now() < blob!.expiresAt;
}

/** 凭据库是否过期（存在但已超 expiresAt）。过期即视为需重新输入账号密码。 */
export function isVaultExpired(): boolean {
  const blob = readVault();
  return Boolean(blob) && Date.now() >= blob!.expiresAt;
}

function readLockMin(): number {
  const raw = localStorage.getItem(LOCK_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 5;
}

const initBlob = readVault();
const initExpired = Boolean(initBlob) && Date.now() >= initBlob!.expiresAt;

interface PinState {
  /** 是否已设置 PIN（localStorage 中存在加密库） */
  hasPin: boolean;
  /** 当前是否处于锁定态（内存态；库有效时重启默认锁定，需 PIN 解锁） */
  locked: boolean;
  /** 凭据库是否已过期（即使有 PIN，过期也需重新账号密码登录） */
  expired: boolean;
  /** 空闲自动锁定时长（分钟），0 = 从不自动锁 */
  lockDurationMin: number;
  /** PIN 凭据有效期（毫秒），0 表示永久 */
  pinValidityMs: number;
  /** 是否正在引导用户设置/重设 PIN（首次登录/首次进入个人模式/凭据过期时弹出） */
  setupOpen: boolean;
  /** 当前设置是否为“过期重设”（影响提示文案） */
  rearm: boolean;
  /** 设置 PIN 时暂存的凭据，finalizeSetup 时加密落盘 */
  pendingCreds: PinCreds | null;

  openSetup: (creds: PinCreds, rearm?: boolean) => void;
  cancelSetup: () => void;
  finalizeSetup: (pin: string) => Promise<void>;
  /** 静默设置 PIN（不打开设置弹窗），用于注册时直接创建凭据库 */
  setup: (pin: string, creds: PinCreds) => Promise<void>;
  unlock: (pin: string) => Promise<PinCreds | null>;
  changePin: (oldPin: string, newPin: string) => Promise<boolean>;
  removePin: () => void;
  lockNow: () => void;
  setLockDuration: (min: number) => void;
  setPinValidity: (ms: number) => void;
}

export const usePinStore = create<PinState>((set, get) => ({
  hasPin: Boolean(initBlob),
  // 仅当库存在且未过期时才默认锁定；过期库等同于“未登录”，应交回账号密码登录
  locked: Boolean(initBlob) && !initExpired,
  expired: initExpired,
  lockDurationMin: readLockMin(),
  pinValidityMs: getPinValidityMs(),
  setupOpen: false,
  rearm: false,
  pendingCreds: null,

  openSetup: (creds, rearm = false) => set({ setupOpen: true, pendingCreds: creds, rearm }),
  cancelSetup: () => set({ setupOpen: false, pendingCreds: null, rearm: false }),

  finalizeSetup: async (pin) => {
    const creds = get().pendingCreds;
    if (!creds) return;
    await get().setup(pin, creds);
  },

  setup: async (pin, creds) => {
    const blob = await encryptCreds(pin, creds);
    localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
    set({ hasPin: true, locked: false, expired: false, setupOpen: false, pendingCreds: null, rearm: false });
  },

  unlock: async (pin) => {
    // P2-12：仍处于锁死窗口内直接拒绝，避免失败计数清零前继续枚举
    if (Date.now() < getLockUntil()) return null;
    const blob = readVault();
    if (!blob) return null;
    const creds = await decryptCreds(pin, blob);
    if (!creds) {
      // 失败：累计错误次数，按指数退避施加锁死（10s × 2^(n-1)，封顶 1 小时）
      const fails = getFailed() + 1;
      setFailed(fails);
      const lockMs = Math.min(PIN_LOCK_BASE_MS * Math.pow(2, fails - 1), PIN_LOCK_MAX_MS);
      setLockUntil(Date.now() + lockMs);
      return null;
    }
    // 解锁成功：清空失败计数与锁死，并用同一 PIN 重新加密刷新过期时间
    setFailed(0);
    setLockUntil(0);
    const next = await encryptCreds(pin, creds);
    localStorage.setItem(VAULT_KEY, JSON.stringify(next));
    set({ locked: false, expired: false });
    return creds;
  },

  changePin: async (oldPin, newPin) => {
    const blob = readVault();
    if (!blob) return false;
    const creds = await decryptCreds(oldPin, blob);
    if (!creds) return false;
    const next = await encryptCreds(newPin, creds);
    localStorage.setItem(VAULT_KEY, JSON.stringify(next));
    return true;
  },

  removePin: () => {
    localStorage.removeItem(VAULT_KEY);
    set({ hasPin: false, locked: false, expired: false, setupOpen: false, pendingCreds: null, rearm: false });
  },

  lockNow: () => set({ locked: true }),

  setLockDuration: (min) => {
    localStorage.setItem(LOCK_KEY, String(min));
    set({ lockDurationMin: min });
  },

  setPinValidity: (ms) => {
    setPinValidityMs(ms);
    set({ pinValidityMs: ms });
  },
}));
