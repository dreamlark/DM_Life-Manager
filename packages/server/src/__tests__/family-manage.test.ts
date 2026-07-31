// M2.3 测试 —— families.list / removeMember / updateRole / transferOwnership（真实 PG 兼容库 PGLite 内存实例）
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
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

describe('M2.3 families 管理 + RBAC', () => {
  it('list 返回当前用户所属家庭及角色（多家庭切换基础）', async () => {
    const alice = await anon().auth.register({ email: 'list-a@home.dev', name: 'Alice', password: 'secret1' });
    const f1 = await asUser(alice.user.id).families.create({ name: '杨家' });
    const f2 = await asUser(alice.user.id).families.create({ name: '陈家' });

    const bob = await anon().auth.register({ email: 'list-b@home.dev', name: 'Bob', password: 'secret1' });
    const inv = await asUser(alice.user.id).families.invite({ familyId: f1.id, role: 'member' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    const aliceFamilies = await asUser(alice.user.id).families.list();
    expect(aliceFamilies.find((f) => f.id === f1.id)?.role).toBe('owner');
    expect(aliceFamilies.find((f) => f.id === f2.id)?.role).toBe('owner');

    const bobFamilies = await asUser(bob.user.id).families.list();
    expect(bobFamilies.find((f) => f.id === f1.id)?.role).toBe('member');
  });

  it('owner 可移除 member；移除后成员列表只剩 owner', async () => {
    const alice = await anon().auth.register({ email: 'rm-a@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });
    const bob = await anon().auth.register({ email: 'rm-b@home.dev', name: 'Bob', password: 'secret1' });
    const inv = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'member' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    await asUser(alice.user.id).families.removeMember({ familyId: family.id, userId: bob.user.id });
    const members = await asUser(alice.user.id).families.members({ familyId: family.id });
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('owner');
  });

  it('owner 不能移除自己（应提示所有者不可被移除）', async () => {
    const alice = await anon().auth.register({ email: 'rmself@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });
    await expect(
      asUser(alice.user.id).families.removeMember({ familyId: family.id, userId: alice.user.id }),
    ).rejects.toThrow(/所有者不可被移除/);
  });

  it('admin 可将 member 改为 child（updateRole）', async () => {
    const alice = await anon().auth.register({ email: 'ur-a@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });
    const admin = await anon().auth.register({ email: 'ur-admin@home.dev', name: 'Admin', password: 'secret1' });
    const invAdmin = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'admin' });
    await asUser(admin.user.id).families.acceptInvite({ token: invAdmin.token });
    const bob = await anon().auth.register({ email: 'ur-b@home.dev', name: 'Bob', password: 'secret1' });
    const invBob = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'member' });
    await asUser(bob.user.id).families.acceptInvite({ token: invBob.token });

    await asUser(admin.user.id).families.updateRole({ familyId: family.id, userId: bob.user.id, role: 'child' });
    const members = await asUser(alice.user.id).families.members({ familyId: family.id });
    const bobMember = members.find((m) => m.userId === bob.user.id);
    expect(bobMember?.role).toBe('child');
  });

  it('updateRole 不能手动设为 owner', async () => {
    const alice = await anon().auth.register({ email: 'uro-a@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });
    const bob = await anon().auth.register({ email: 'uro-b@home.dev', name: 'Bob', password: 'secret1' });
    const inv = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'member' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    await expect(
      asUser(alice.user.id).families.updateRole({ familyId: family.id, userId: bob.user.id, role: 'owner' }),
    ).rejects.toThrow(/不能手动设为 owner|转让/);
  });

  it('owner 转让后自身降为 admin，目标升为 owner', async () => {
    const alice = await anon().auth.register({ email: 'to-a@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });
    const bob = await anon().auth.register({ email: 'to-b@home.dev', name: 'Bob', password: 'secret1' });
    const inv = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'admin' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    await asUser(alice.user.id).families.transferOwnership({ familyId: family.id, userId: bob.user.id });

    const aliceFamilies = await asUser(alice.user.id).families.list();
    expect(aliceFamilies.find((f) => f.id === family.id)?.role).toBe('admin');
    const bobFamilies = await asUser(bob.user.id).families.list();
    expect(bobFamilies.find((f) => f.id === family.id)?.role).toBe('owner');
  });

  it('member 无 manageMembers，移除成员被 FORBIDDEN', async () => {
    const alice = await anon().auth.register({ email: 'rbac-a@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });
    const bob = await anon().auth.register({ email: 'rbac-b@home.dev', name: 'Bob', password: 'secret1' });
    const inv = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'member' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    await expect(
      asUser(bob.user.id).families.removeMember({ familyId: family.id, userId: alice.user.id }),
    ).rejects.toThrow(/FORBIDDEN|无权/);
  });

  it('child 无 manageMembers，改角色被 FORBIDDEN', async () => {
    const alice = await anon().auth.register({ email: 'rbac2-a@home.dev', name: 'Alice', password: 'secret1' });
    const family = await asUser(alice.user.id).families.create({ name: '杨家' });
    const bob = await anon().auth.register({ email: 'rbac2-b@home.dev', name: 'Bob', password: 'secret1' });
    const inv = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'child' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    await expect(
      asUser(bob.user.id).families.updateRole({ familyId: family.id, userId: alice.user.id, role: 'member' }),
    ).rejects.toThrow(/FORBIDDEN|无权/);
  });
});
