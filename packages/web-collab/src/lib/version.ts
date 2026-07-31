/**
 * 前端版本契约（增量升级用）
 *
 * - APP_VERSION：本前端版本，与协作后端 /api/version 的 minFrontend 比较。
 * - 比较为「非致命」：仅当后端要求的最低前端版本高于当前时提示升级，
 *   不阻断使用——做到「升级不影响现有使用与数据」。
 */
export const APP_VERSION = '1.0.0';

export interface RemoteVersion {
  backend: string;
  minFrontend: string;
  schema: number;
}

/** 拉取协作后端版本信息（后端未启动/不可达时返回 null，静默不提示） */
export async function fetchBackendVersion(): Promise<RemoteVersion | null> {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as RemoteVersion;
  } catch {
    return null;
  }
}

function parse(v: string): number[] {
  return v.split('.').map((n) => parseInt(n, 10) || 0);
}

/** a > b => 正数；a < b => 负数；相等 => 0 */
export function cmpVersion(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface VersionCheck {
  ok: boolean;
  message: string;
  remote: RemoteVersion | null;
}

/** 非致命校验：仅当后端要求的前端最低版本高于当前时提示升级 */
export function checkVersion(remote: RemoteVersion | null): VersionCheck {
  if (!remote) return { ok: true, message: '', remote: null };
  if (cmpVersion(remote.minFrontend, APP_VERSION) > 0) {
    return {
      ok: false,
      message: `后端要求前端最低版本 v${remote.minFrontend}，当前为 v${APP_VERSION}，建议升级以获取兼容与增量特性。`,
      remote,
    };
  }
  return { ok: true, message: '', remote };
}
