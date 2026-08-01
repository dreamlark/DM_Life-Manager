// S4 + S11：字段上限与口令最小长度回归测试。
// S4：口令最小长度 6 → 8（A07 暴力破解缓解）
// S11：昵称 / 家庭名称等用户可控字段加最大长度上限，避免异常超长输入（A04 资源滥用/存储异常）
/// <reference types="vitest" />
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import type { AuthContext } from '../rbac';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const asUser = (userId: string) => appRouter.createCaller({ userId } as AuthContext);

beforeEach(async () => {
  await initDb();
  await store.reset();
});
afterAll(async () => {
  await closeDb();
});

describe('S4 口令最小长度', () => {
  it('口令长度 7 被拒（至少 8 位）', async () => {
    await expect(
      anon().auth.register({ email: 'pw7@home.dev', name: 'A', password: '1234567' }),
    ).rejects.toThrow(/密码至少 8 位/);
  });

  it('口令长度 8 通过', async () => {
    const r = await anon().auth.register({ email: 'pw8@home.dev', name: 'A', password: '12345678' });
    expect(r.accessToken).toBeTruthy();
  });
});

describe('S11 字段最大长度上限', () => {
  it('注册昵称超过 200 字被拒', async () => {
    const longName = '王'.repeat(201);
    await expect(
      anon().auth.register({ email: 'name-long@home.dev', name: longName, password: 'secret123' }),
    ).rejects.toThrow(/昵称过长/);
  });

  it('合法昵称（≤200）通过', async () => {
    const r = await anon().auth.register({ email: 'name-ok@home.dev', name: '王'.repeat(200), password: 'secret123' });
    expect(r.user.name).toBe('王'.repeat(200));
  });

  it('家庭名称超过 100 字被拒', async () => {
    const u = await anon().auth.register({ email: 'fam-long@home.dev', name: 'A', password: 'secret123' });
    const longFam = '家'.repeat(101);
    await expect(asUser(u.user.id).families.create({ name: longFam })).rejects.toThrow(/家庭名称过长/);
  });

  it('合法家庭名称（≤100）通过', async () => {
    const u = await anon().auth.register({ email: 'fam-ok@home.dev', name: 'A', password: 'secret123' });
    const fam = await asUser(u.user.id).families.create({ name: '家'.repeat(100) });
    expect(fam.name).toBe('家'.repeat(100));
  });
});
