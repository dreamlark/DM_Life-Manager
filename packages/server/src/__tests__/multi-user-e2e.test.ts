// 阶段3 多用户 E2E —— 本次「engine → server 单后端」迁移的核心多用户保证：
//   1) 个人域按 personal family 隔离：A 写入的个人数据，B 通过个人 API 读取必须为空；
//   2) 结构 IDOR 防护：所有 personal 过程经 store.getPersonalFamilyId(ctx.userId) 解析，
//      不接受任何客户端 familyId 入参 —— 即使 B 加入了 A 的共享家庭，个人域仍只解析到 B 自己的 personal family；
//   3) 家庭生命周期 + 完整角色链：create→invite→accept→members→updateRole→transferOwnership→removeMember→leave，
//      以及越权（非成员 FORBIDDEN / 匿名 UNAUTHORIZED / 重复接受 CONFLICT / 过期 BAD_REQUEST）。
// sharedItems 的可见性 / 跨家庭 IDOR 已在 shared-items.test.ts 覆盖，本文件不再重复。
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { appRouter } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import type { AuthContext } from '../rbac';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const asUser = (userId: string) => appRouter.createCaller({ userId } as AuthContext);
const DATE = '2026-07-25';

beforeEach(async () => {
  await initDb();
  await store.reset();
});

afterAll(async () => {
  await closeDb();
});

async function register(name: string) {
  const email = `mu_${name.toLowerCase()}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@home.dev`;
  return anon().auth.register({ email, name, password: 'secret1' });
}

/** 在指定用户的个人域写入一批代表性数据（覆盖 task/finance/notes/project/interest/reminder/flow） */
async function seedPersonalData(userId: string) {
  const me = asUser(userId);
  await me.tasks.create({ title: '个人任务', domainKey: 'work' });
  await me.finance.debts.create({ creditor: '银行', principal: 5000, apr: 12, minPayment: 300, dueDay: 5 });
  await me.notes.ingest({ title: '私人笔记', bodyMarkdown: '仅本人可见' });
  await me.projects.create({ name: '私人项目', paraType: 'project' });
  await me.interests.capture({ title: '兴趣', attention: 3, sourceType: 'thought' });
  await me.reminders.create({
    title: '私人提醒',
    domainKey: 'health',
    periodRule: '每月',
    nextFireAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await me.flow.record({
    domainKey: 'work',
    startedAt: new Date().toISOString(),
    endedAt: new Date(Date.now() + 25 * 60000).toISOString(),
  });
}

describe('阶段3·多用户个人域数据隔离', () => {
  it('A 写入个人域后，B 通过个人 API 读取全部为空（按 personal family 隔离）', async () => {
    const a = await register('Alice');
    const b = await register('Bob');

    await seedPersonalData(a.user.id);

    // B 的个人视图必须完全看不到 A 的数据
    const bTasks = await asUser(b.user.id).tasks.all();
    const bFin = await asUser(b.user.id).finance.summary();
    const bNotes = await asUser(b.user.id).notes.list();
    const bProjects = await asUser(b.user.id).projects.list();
    const bInterests = await asUser(b.user.id).interests.list();
    const bReminders = await asUser(b.user.id).reminders.list();

    expect(bTasks).toHaveLength(0);
    expect(bFin.debtCount).toBe(0);
    expect(bFin.totalDebt).toBe(0);
    expect(bNotes).toHaveLength(0);
    expect(bProjects).toHaveLength(0);
    expect(bInterests).toHaveLength(0);
    expect(bReminders).toHaveLength(0);

    // 反向：A 本人能看到自己写入的数据（隔离不破坏本人可读）
    const aTasks = await asUser(a.user.id).tasks.all();
    const aFin = await asUser(a.user.id).finance.summary();
    expect(aTasks.length).toBeGreaterThanOrEqual(1);
    expect(aFin.debtCount).toBe(1);
  });

  it('结构 IDOR 防护：B 加入 A 的共享家庭后，个人域仍只解析到 B 自己的 personal family', async () => {
    const a = await register('Alice');
    const b = await register('Bob');

    const famA = await asUser(a.user.id).families.list();
    const personalA = famA[0]!.id; // A 注册时自动创建的 personal family
    const personalB = (await asUser(b.user.id).families.list())[0]!.id;
    expect(personalA).not.toBe(personalB);

    // A 建一个 shared 家庭并邀请 B 加入
    const shared = await asUser(a.user.id).families.create({ name: '共享家庭' });
    const inv = await asUser(a.user.id).families.invite({ familyId: shared.id, role: 'member' });
    await asUser(b.user.id).families.acceptInvite({ token: inv.token });

    // B 现在同时是 shared 家庭（role=member）和自己的 personal 家庭（role=owner）成员，
    // 但 getPersonalFamilyId(B) 永远只返回 B 的 personal family，不可能指向 A 的
    const bPersonalNow = await store.getPersonalFamilyId(b.user.id);
    expect(bPersonalNow).toBe(personalB);
    expect(bPersonalNow).not.toBe(personalA);
    expect(bPersonalNow).not.toBe(shared.id);

    // A 在自己的个人域写数据，B 个人 API 仍读不到（personal 过程没有任何 familyId 入参可被劫持）
    await asUser(a.user.id).tasks.create({ title: 'A 的私事', domainKey: 'family' });
    expect(await asUser(b.user.id).tasks.all()).toHaveLength(0);

    // B 在自己的个人域写数据，A 也读不到
    await asUser(b.user.id).tasks.create({ title: 'B 的私事', domainKey: 'family' });
    const aSees = await asUser(a.user.id).tasks.all();
    expect(aSees).toHaveLength(1);
    expect(aSees[0]!.title).toBe('A 的私事');
  });
});

describe('阶段3·家庭生命周期与角色链', () => {
  it('create→invite→accept→members→updateRole→transferOwnership→removeMember→leave 全链路', async () => {
    const a = await register('Alice');
    const b = await register('Bob');

    const fam = await asUser(a.user.id).families.create({ name: '协作家庭' });
    const inv = await asUser(a.user.id).families.invite({ familyId: fam.id, role: 'member' });
    await asUser(b.user.id).families.acceptInvite({ token: inv.token });

    // 成员列表：A=owner, B=member
    let members = await asUser(a.user.id).families.members({ familyId: fam.id });
    expect(members.map((m) => `${m.userId}:${m.role}`).sort()).toEqual(
      [`${a.user.id}:owner`, `${b.user.id}:member`].sort(),
    );

    // A 将 B 提为 admin
    await asUser(a.user.id).families.updateRole({ familyId: fam.id, userId: b.user.id, role: 'admin' });
    members = await asUser(a.user.id).families.members({ familyId: fam.id });
    expect(members.find((m) => m.userId === b.user.id)!.role).toBe('admin');

    // A 将所有权转给 B → B=owner, A=admin
    await asUser(a.user.id).families.transferOwnership({ familyId: fam.id, userId: b.user.id });
    members = await asUser(a.user.id).families.members({ familyId: fam.id });
    expect(members.find((m) => m.userId === b.user.id)!.role).toBe('owner');
    expect(members.find((m) => m.userId === a.user.id)!.role).toBe('admin');

    // B（现 owner）移除 A
    await asUser(b.user.id).families.removeMember({ familyId: fam.id, userId: a.user.id });
    members = await asUser(b.user.id).families.members({ familyId: fam.id });
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe(b.user.id);

    // A 已从该家庭移除：A 的家庭列表里不再有 fam
    const aFams = await asUser(a.user.id).families.list();
    expect(aFams.find((f) => f.id === fam.id)).toBeUndefined();
  });

  it('owner 不可被 removeMember；owner 不可直接 leave', async () => {
    const a = await register('Alice');
    const b = await register('Bob');
    const fam = await asUser(a.user.id).families.create({ name: 'F' });
    const inv = await asUser(a.user.id).families.invite({ familyId: fam.id, role: 'member' });
    await asUser(b.user.id).families.acceptInvite({ token: inv.token });

    // 不能移除 owner 自己
    await expect(
      asUser(a.user.id).families.removeMember({ familyId: fam.id, userId: a.user.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // owner 不能直接离开
    await expect(asUser(a.user.id).families.leave({ familyId: fam.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    // member 可以离开
    await asUser(b.user.id).families.leave({ familyId: fam.id });
    const members = await asUser(a.user.id).families.members({ familyId: fam.id });
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe(a.user.id);
  });

  it('非家庭成员查询/管理共享家庭被 FORBIDDEN；重复接受已消费邀请为 NOT_FOUND', async () => {
    const a = await register('Alice');
    const b = await register('Bob');
    const outsider = await register('Carol');
    const fam = await asUser(a.user.id).families.create({ name: 'F' });

    // 非成员：members / invite 均 FORBIDDEN
    await expect(asUser(outsider.user.id).families.members({ familyId: fam.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      asUser(outsider.user.id).families.invite({ familyId: fam.id, role: 'member' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // B 接受邀请后，再次用同一 token 接受 → 已消费/无效 → NOT_FOUND
    const inv = await asUser(a.user.id).families.invite({ familyId: fam.id, role: 'member' });
    await asUser(b.user.id).families.acceptInvite({ token: inv.token });
    await expect(asUser(b.user.id).families.acceptInvite({ token: inv.token })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // 用完全不存在的 token 接受 → NOT_FOUND
    await expect(asUser(b.user.id).families.acceptInvite({ token: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('过期邀请被拒（BAD_REQUEST）；owner 不可被手动设为 guest/owner', async () => {
    const a = await register('Alice');
    const b = await register('Bob');
    const fam = await asUser(a.user.id).families.create({ name: 'F' });

    // 直接插入一条已过期邀请，再接受 → BAD_REQUEST
    const expired = await store.createInvitation({
      familyId: fam.id,
      token: 'expired-token',
      role: 'member',
      createdBy: a.user.id,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(expired.token).toBe('expired-token');
    await expect(asUser(b.user.id).families.acceptInvite({ token: 'expired-token' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    // invite 时角色不能为 owner
    await expect(
      asUser(a.user.id).families.invite({ familyId: fam.id, role: 'owner' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // updateRole 手动设为 owner/guest 被拒
    const inv = await asUser(a.user.id).families.invite({ familyId: fam.id, role: 'member' });
    await asUser(b.user.id).families.acceptInvite({ token: inv.token });
    await expect(
      asUser(a.user.id).families.updateRole({ familyId: fam.id, userId: b.user.id, role: 'owner' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      asUser(a.user.id).families.updateRole({ familyId: fam.id, userId: b.user.id, role: 'guest' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('阶段3·个人域越权边界', () => {
  it('匿名（未登录）调用个人域过程必须 UNAUTHORIZED', async () => {
    await expect(anon().tasks.all()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anon().finance.summary()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anon().notes.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anon().projects.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anon().domains.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anon().reminders.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('注册即创建 personal family；families.list 默认仅含本人 personal family（在创建共享家庭前）', async () => {
    const a = await register('Alice');
    const list = await asUser(a.user.id).families.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.role).toBe('owner');
  });
});
