// M2.1 冒烟测试 —— 在真实 PG 兼容数据库（PGLite 内存实例）上跑完整链路
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { appRouter } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import { signAccess, verifyAccess } from '../auth';
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

describe('M2.1 鉴权 + 家庭 + RBAC', () => {
  it('注册并登录，返回双令牌', async () => {
    const reg = await anon().auth.register({ email: 'alice@home.dev', name: 'Alice', password: 'secret1' });
    expect(reg.user.email).toBe('alice@home.dev');
    expect(reg.accessToken).toBeTruthy();
    expect(reg.refreshToken).toBeTruthy();
    const login = await anon().auth.login({ email: 'alice@home.dev', password: 'secret1' });
    expect(login.accessToken).toBeTruthy();
  });

  it('重复注册邮箱冲突', async () => {
    await anon().auth.register({ email: 'dup@home.dev', name: 'D', password: 'secret1' });
    await expect(anon().auth.register({ email: 'dup@home.dev', name: 'D2', password: 'secret1' })).rejects.toThrow(/已注册/);
  });

  it('完整链路：建家庭 → 邀请 child → 接受 → 成员列表见两人', async () => {
    const alice = await anon().auth.register({ email: 'a2@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });

    const inv = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'child' });
    expect(inv.role).toBe('child');

    const bob = await anon().auth.register({ email: 'bob@home.dev', name: 'Bob', password: 'secret1' });
    const accepted = await asUser(bob.user.id).families.acceptInvite({ token: inv.token });
    expect(accepted.role).toBe('child');
    expect(accepted.familyId).toBe(family.id);

    const members = await asUser(alice.user.id).families.members({ familyId: family.id });
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.role).sort()).toEqual(['child', 'owner']);
  });

  it('child 越权邀请成员被 FORBIDDEN', async () => {
    const alice = await anon().auth.register({ email: 'a3@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });
    const inv = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'member' });

    const bob = await anon().auth.register({ email: 'bob3@home.dev', name: 'Bob', password: 'secret1' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    await expect(asUser(bob.user.id).families.invite({ familyId: family.id, role: 'child' })).rejects.toThrow(
      /FORBIDDEN|无权/,
    );
  });

  it('非家庭成员查看成员列表被 FORBIDDEN', async () => {
    const alice = await anon().auth.register({ email: 'a4@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });

    const stranger = await anon().auth.register({ email: 'stranger@home.dev', name: 'X', password: 'secret1' });
    await expect(asUser(stranger.user.id).families.members({ familyId: family.id })).rejects.toThrow(/FORBIDDEN|不是该家庭/);
  });

  it('refresh 旋转出新令牌', async () => {
    await anon().auth.register({ email: 'a5@home.dev', name: 'Alice', password: 'secret1' });
    const login = await anon().auth.login({ email: 'a5@home.dev', password: 'secret1' });
    const rotated = await anon().auth.refresh({ refreshToken: login.refreshToken });
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
  });

  it('家庭所有者不能离开', async () => {
    const alice = await anon().auth.register({ email: 'a6@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });
    await expect(asUser(alice.user.id).families.leave({ familyId: family.id })).rejects.toThrow(/不能直接离开|转让|解散/);
  });

  it('JWT 防伪（P0-1）：篡改签名的令牌被拒，合法令牌可解析', async () => {
    const token = signAccess('user-1');
    expect(verifyAccess(token)).toBe('user-1');
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    // 改签名段 → 验签失败
    expect(() => verifyAccess(`${parts[0]}.${parts[1]}.forged-signature`)).toThrow();
    // 完全非法
    expect(() => verifyAccess('not-a-jwt')).toThrow();
  });

  it('rememberMe 控制 refresh 有效期：false≈1天，true≈30天', async () => {
    const short = await anon().auth.register({ email: 'short@home.dev', name: 'S', password: 'secret1', rememberMe: false });
    const long = await anon().auth.register({ email: 'long@home.dev', name: 'L', password: 'secret1', rememberMe: true });

    const sShort = await store.getSession(short.refreshToken);
    const sLong = await store.getSession(long.refreshToken);
    expect(sShort).toBeTruthy();
    expect(sLong).toBeTruthy();

    const now = Date.now();
    const ttlShort = new Date(sShort!.expiresAt).getTime() - now;
    const ttlLong = new Date(sLong!.expiresAt).getTime() - now;
    // 容差 ±2 分钟
    expect(Math.abs(ttlShort - 24 * 3600 * 1000)).toBeLessThan(2 * 60 * 1000);
    expect(Math.abs(ttlLong - 30 * 24 * 3600 * 1000)).toBeLessThan(2 * 60 * 1000);
  });
});
