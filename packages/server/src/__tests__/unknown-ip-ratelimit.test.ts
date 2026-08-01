// S12（A07/D）：未知客户端 IP 时落入最严格全局限流桶，施加远低于常规的硬性上限，
// 避免匿名流量通过「每 IP 一桶」退化成可被轻易绕过的单共享桶而绕过限流（间接 DoS / 爆破）。
/// <reference types="vitest" />
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import type { AuthContext } from '../rbac';

// 直连调用 createCaller 不携带真实 socket，ctx.ip 为 undefined → 落入 __strict_unknown__ 桶
const anon = () => appRouter.createCaller({ userId: null } as AuthContext);

beforeEach(async () => {
  await initDb();
  await store.reset();
});
afterAll(async () => {
  await closeDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('S12 未知 IP 限流桶', () => {
  it('RATE_UNKNOWN_LIMIT=0 时，未知 IP 的首次调用即被限流（TOO_MANY_REQUESTS）', async () => {
    vi.stubEnv('RATE_UNKNOWN_LIMIT', '0');
    // 中间件实时读取 RATE_UNKNOWN_LIMIT，故可在用例内动态调整
    await expect(
      anon().auth.register({ email: 'unk0@home.dev', name: 'A', password: 'secret123' }),
    ).rejects.toThrow();
  });

  it('RATE_UNKNOWN_LIMIT=2 时，未知 IP 的第 3 次调用被限流（前 2 次放行）', async () => {
    vi.stubEnv('RATE_UNKNOWN_LIMIT', '2');
    // 前两次：落严格全局桶，未达上限 → 放行（即便邮箱重复也只会在限流之后才校验，故用不同邮箱）
    await expect(
      anon().auth.register({ email: 'unk1@home.dev', name: 'A', password: 'secret123' }),
    ).resolves.toBeTruthy();
    await expect(
      anon().auth.register({ email: 'unk2@home.dev', name: 'B', password: 'secret123' }),
    ).resolves.toBeTruthy();
    // 第三次：命中硬性上限 → 限流
    await expect(
      anon().auth.register({ email: 'unk3@home.dev', name: 'C', password: 'secret123' }),
    ).rejects.toThrow(/频繁|TOO_MANY_REQUESTS/);
  });
});
