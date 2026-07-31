// #209 测试 —— 通用 sharedItems 服务端（提醒/记事/脑图/心流/领域… 复用桥接）
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

async function register(name: string) {
  const e = `si_${name.toLowerCase()}_${Date.now()}@home.dev`;
  const r = await anon().auth.register({ email: e, name, password: 'secret1' });
  return r;
}

describe('#209 通用 sharedItems 服务端', () => {
  it('owner 推送 reminder 快照 → listByFamily 按 module 过滤返回，scope=all 对成员可见', async () => {
    const alice = await register('Alice');
    const fam = await asUser(alice.user.id).families.list();
    const familyId = fam[0]!.id;

    const upserted = await asUser(alice.user.id).sharedItems.upsert({
      familyId,
      module: 'reminder',
      itemType: 'clock',
      itemKey: 'r1',
      label: '每月房贷提醒',
      scope: 'all',
      allowedUserIds: [],
      snapshot: { title: '每月房贷', dueDay: 15 },
    });
    expect(upserted.id).toBeTruthy();
    expect(upserted.module).toBe('reminder');

    const list = await asUser(alice.user.id).sharedItems.listByFamily({ familyId, module: 'reminder' });
    expect(list).toHaveLength(1);
    expect(list[0]!.itemKey).toBe('r1');
  });

  it('scope=specific 时按 allowedUserIds 过滤可见性', async () => {
    const alice = await register('Alice');
    const bob = await register('Bob');
    const fam = await asUser(alice.user.id).families.list();
    const familyId = fam[0]!.id;
    const inv = await asUser(alice.user.id).families.invite({ familyId, role: 'member' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    // alice 推送一项仅对 bob 可见的快照
    await asUser(alice.user.id).sharedItems.upsert({
      familyId,
      module: 'notes',
      itemType: 'note',
      itemKey: 'n1',
      label: '旅行计划',
      scope: 'specific',
      allowedUserIds: [bob.user.id],
      snapshot: { text: '...' },
    });

    const aliceList = await asUser(alice.user.id).sharedItems.listByFamily({ familyId });
    const bobList = await asUser(bob.user.id).sharedItems.listByFamily({ familyId });
    expect(aliceList).toHaveLength(1); // 推送人总是可见
    expect(bobList).toHaveLength(1); // 被授权可见

    // 再注册 carol 未授权 → 看不到
    const carol = await register('Carol');
    const inv2 = await asUser(alice.user.id).families.invite({ familyId, role: 'member' });
    await asUser(carol.user.id).families.acceptInvite({ token: inv2.token });
    const carolList = await asUser(carol.user.id).sharedItems.listByFamily({ familyId });
    expect(carolList).toHaveLength(0);
  });

  it('相同 module+itemType+itemKey 幂等 upsert（唯一键冲突更新，不新增行）', async () => {
    const alice = await register('Alice');
    const fam = await asUser(alice.user.id).families.list();
    const familyId = fam[0]!.id;
    const p1 = await asUser(alice.user.id).sharedItems.upsert({
      familyId, module: 'flow', itemType: 'session', itemKey: 'f1', label: '专注 A', scope: 'all', allowedUserIds: [], snapshot: { minutes: 25 },
    });
    const p2 = await asUser(alice.user.id).sharedItems.upsert({
      familyId, module: 'flow', itemType: 'session', itemKey: 'f1', label: '专注 A（改）', scope: 'all', allowedUserIds: [], snapshot: { minutes: 50 },
    });
    expect(p1.id).toBe(p2.id);
    expect(p2.label).toBe('专注 A（改）');
    const list = await asUser(alice.user.id).sharedItems.listByFamily({ familyId });
    expect(list).toHaveLength(1);
  });

  it('remove 后该 family 不再有共享项', async () => {
    const alice = await register('Alice');
    const fam = await asUser(alice.user.id).families.list();
    const familyId = fam[0]!.id;
    const r = await asUser(alice.user.id).sharedItems.upsert({
      familyId, module: 'domains', itemType: 'wheel', itemKey: '*', label: '平衡轮', scope: 'all', allowedUserIds: [], snapshot: { scores: {} },
    });
    await asUser(alice.user.id).sharedItems.remove({ familyId, id: r.id });
    const list = await asUser(alice.user.id).sharedItems.listByFamily({ familyId });
    expect(list).toHaveLength(0);
  });

  it('guest 无 manageShared → upsert 被 FORBIDDEN；但有 viewShared → 可 list', async () => {
    const alice = await register('Alice');
    const guest = await register('Guest');
    const fam = await asUser(alice.user.id).families.list();
    const familyId = fam[0]!.id;
    const inv = await asUser(alice.user.id).families.invite({ familyId, role: 'guest' });
    await asUser(guest.user.id).families.acceptInvite({ token: inv.token });

    await expect(
      asUser(guest.user.id).sharedItems.upsert({
        familyId, module: 'reminder', itemType: 'clock', itemKey: 'x', label: 'x', scope: 'all', allowedUserIds: [], snapshot: {},
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // alice 推送后 guest 应能 list（scope=all，viewShared 可见）
    await asUser(alice.user.id).sharedItems.upsert({
      familyId, module: 'reminder', itemType: 'clock', itemKey: 'a', label: 'a', scope: 'all', allowedUserIds: [], snapshot: {},
    });
    const guestList = await asUser(guest.user.id).sharedItems.listByFamily({ familyId });
    expect(guestList).toHaveLength(1);
  });

  it('非家庭成员 listByFamily 被 FORBIDDEN', async () => {
    const alice = await register('Alice');
    const fam = await asUser(alice.user.id).families.list();
    const familyId = fam[0]!.id;
    const outsider = await register('Outsider');
    await expect(asUser(outsider.user.id).sharedItems.listByFamily({ familyId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('家庭成员可标记完成/备注共享项（requireMembership），非成员被 FORBIDDEN', async () => {
    const alice = await register('Alice');
    const bob = await register('Bob');
    const fam = await asUser(alice.user.id).families.list();
    const familyId = fam[0]!.id;
    const inv = await asUser(alice.user.id).families.invite({ familyId, role: 'member' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    const r = await asUser(alice.user.id).sharedItems.upsert({
      familyId, module: 'task', itemType: 'task', itemKey: 't1', label: '倒垃圾', scope: 'all', allowedUserIds: [], snapshot: { title: '倒垃圾' },
    });

    // bob（成员）标记完成 + 备注 → 成功（协作操作），且 task 模块的 snapshot.status 同步更新
    await asUser(bob.user.id).sharedItems.update({ familyId, id: r.id, done: true, note: '今晚做' });
    let aliceList = await asUser(alice.user.id).sharedItems.listByFamily({ familyId, module: 'task' });
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]!.done).toBe(true);
    expect(aliceList[0]!.note).toBe('今晚做');
    expect((aliceList[0]!.snapshot as { status?: string }).status).toBe('done');

    // 取消完成后 snapshot.status 回退为 todo
    await asUser(bob.user.id).sharedItems.update({ familyId, id: r.id, done: false });
    aliceList = await asUser(alice.user.id).sharedItems.listByFamily({ familyId, module: 'task' });
    expect(aliceList[0]!.done).toBe(false);
    expect((aliceList[0]!.snapshot as { status?: string }).status).toBe('todo');

    // 非家庭成员无法 update
    const carol = await register('Carol');
    await expect(asUser(carol.user.id).sharedItems.update({ familyId, id: r.id, done: false }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('批量 sync：一次 upsert 多项 + 按 owner 删除未选项，且不会误删他人共享', async () => {
    const alice = await register('Alice');
    const bob = await register('Bob');
    const fam = await asUser(alice.user.id).families.list();
    const familyId = fam[0]!.id;
    const inv = await asUser(alice.user.id).families.invite({ familyId, role: 'member' });
    await asUser(bob.user.id).families.acceptInvite({ token: inv.token });

    // alice 批量同步 3 项（单次请求 + 单事务）
    const upserts = ['a', 'b', 'c'].map((k) => ({
      familyId, module: 'task', itemType: 'task', itemKey: k, label: k.toUpperCase(), scope: 'all' as const, allowedUserIds: [], snapshot: {},
    }));
    await asUser(alice.user.id).sharedItems.sync({ familyId, upserts, removes: [] });
    let list = await asUser(alice.user.id).sharedItems.listByFamily({ familyId, module: 'task' });
    expect(list).toHaveLength(3);

    // 删除 a、b，保留 c（removes 仅删本人共享项）
    const aId = list.find((x) => x.itemKey === 'a')!.id;
    const bId = list.find((x) => x.itemKey === 'b')!.id;
    await asUser(alice.user.id).sharedItems.sync({ familyId, upserts: [], removes: [aId, bId] });
    list = await asUser(alice.user.id).sharedItems.listByFamily({ familyId, module: 'task' });
    expect(list).toHaveLength(1);
    expect(list[0]!.itemKey).toBe('c');

    // bob 把 alice 的 c 放进 removes → 因 owner 范围约束，不被删除
    await asUser(bob.user.id).sharedItems.sync({ familyId, upserts: [], removes: [list[0]!.id] });
    list = await asUser(alice.user.id).sharedItems.listByFamily({ familyId, module: 'task' });
    expect(list).toHaveLength(1);
  });

  it('guest 无 manageShared → update/remove 共享项被 FORBIDDEN（N1：阻断 guest 越权写入）', async () => {
    const alice = await register('Alice');
    const guest = await register('Guest');
    const fam = await asUser(alice.user.id).families.list();
    const familyId = fam[0]!.id;
    const inv = await asUser(alice.user.id).families.invite({ familyId, role: 'guest' });
    await asUser(guest.user.id).families.acceptInvite({ token: inv.token });

    const item = await asUser(alice.user.id).sharedItems.upsert({
      familyId, module: 'task', itemType: 'task', itemKey: 't1', label: 'x', scope: 'all', allowedUserIds: [], snapshot: { title: 't' },
    });
    // guest 仅 viewShared，无 manageShared → update / remove 均须 FORBIDDEN
    await expect(
      asUser(guest.user.id).sharedItems.update({ familyId, id: item.id, done: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      asUser(guest.user.id).sharedItems.remove({ familyId, id: item.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('跨家庭 IDOR：用自家 family 权限操作他人 family 的共享项应无效（N1）', async () => {
    const alice = await register('Alice');
    const famA = await asUser(alice.user.id).families.list();
    const familyA = famA[0]!.id;
    const item = await asUser(alice.user.id).sharedItems.upsert({
      familyId: familyA, module: 'task', itemType: 'task', itemKey: 't1', label: 'x', scope: 'all', allowedUserIds: [], snapshot: { title: 't' },
    });

    // bob 是另一个无关家庭的 owner（拥有 manageShared），但 item 属于 alice 的 familyA
    const bob = await register('Bob');
    const famB = await asUser(bob.user.id).families.list();
    const familyB = famB[0]!.id;

    // remove：权限通过（bob 是 familyB 的 owner），但因 familyId 过滤，跨家庭项不会被删
    await asUser(bob.user.id).sharedItems.remove({ familyId: familyB, id: item.id });
    let aliceList = await asUser(alice.user.id).sharedItems.listByFamily({ familyId: familyA });
    expect(aliceList.find((x) => x.id === item.id)).toBeTruthy();

    // update：同理，跨家庭项不会被篡改
    await asUser(bob.user.id).sharedItems.update({ familyId: familyB, id: item.id, done: true });
    aliceList = await asUser(alice.user.id).sharedItems.listByFamily({ familyId: familyA });
    expect(aliceList.find((x) => x.id === item.id)!.done).toBe(false);
  });
});
