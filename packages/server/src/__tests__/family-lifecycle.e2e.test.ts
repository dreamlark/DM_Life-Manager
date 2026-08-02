// DM_LifeManager 家庭生命周期（family lifecycle）端到端测试
//
// 覆盖本次后端改动（router.ts 的 families.leave/disband/list、store.disbandFamily、
// realtime/eventBus 的 family.disbanded、audit 的 family.disband）：
//   A) 成员退出（member leave）成功且不解散家庭（发布 member.left）
//   B) owner 且唯一成员 leave → 自动 disband：家庭行删除、共享快照硬清、发布 family.disbanded
//   C) 个人家庭 leave → BAD_REQUEST（个人空间不可退出）；个人家庭 disband → BAD_REQUEST（个人空间不可解散）
//   D) 非 owner 成员 disband → FORBIDDEN；owner 但还有其他成员时 leave → BAD_REQUEST（请先转让所有者）
//   E) families.list 回传 kind（personal / shared）
//
// 范式（与 family-isolation / cross-user-isolation / family-manage 一致）：
//   beforeEach 调 initDb()+store.reset()，afterAll 调 closeDb()；通过 appRouter.createCaller 调用真实 tRPC 路径。
//
// ⚠️ 沙箱限制：本文件在本沙箱未实际执行（PGlite WASM 初始化被沙箱拦截 + safe-delete 垫片超时）。
//    请在本地执行验证： npm run test -w packages/server
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { appRouter } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import { subscribeEvents } from '../realtime/eventBus';
import type { AuthContext } from '../rbac';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const asUser = (userId: string) => appRouter.createCaller({ userId } as AuthContext);

/** 注册一个用户并回传 caller + userId（复用项目真实 auth 路径；注册即建个人家庭 + membership(owner)） */
async function register(email: string) {
  const reg = await anon().auth.register({ email, name: 'tester', password: 'secret123' });
  return { userId: reg.user.id, me: asUser(reg.user.id) };
}

beforeEach(async () => {
  await initDb();
  await store.reset();
});

afterAll(async () => {
  await closeDb();
});

describe('A) 成员退出（member leave）—— 不解散家庭', () => {
  it('B（成员）leave 成功，家庭仍在且 owner A 仍是唯一成员，发布 member.left', async () => {
    const a = await register('leave-a-member@home.dev');
    const family = await a.me.families.create({ name: '杨家' });
    const b = await register('leave-b-member@home.dev');
    const inv = await a.me.families.invite({ familyId: family.id, role: 'member' });
    await b.me.families.acceptInvite({ token: inv.token });

    const events: any[] = [];
    const unsub = subscribeEvents((e) => events.push(e));
    let res: { ok: boolean; disbanded?: boolean };
    try {
      res = await b.me.families.leave({ familyId: family.id });
    } finally {
      unsub();
    }
    expect(res.ok).toBe(true);
    expect(res.disbanded).toBeUndefined();

    // 家庭仍在，且只剩 owner A（B 的成员关系被移除）
    const members = await store.getMembershipsByFamily(family.id);
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('owner');

    // A 仍能看到家庭；B 已看不到
    const aList = await a.me.families.list();
    expect(aList.find((f) => f.id === family.id)).toBeDefined();
    const bList = await b.me.families.list();
    expect(bList.find((f) => f.id === family.id)).toBeUndefined();

    // 实时事件 member.left 已发布（familyId + userId 正确）
    const left = events.filter((e) => e.kind === 'member.left' && e.familyId === family.id && e.userId === b.userId);
    expect(left).toHaveLength(1);
  });
});

describe('B) owner 且唯一成员 leave → 自动 disband', () => {
  it('A 唯一成员 leave → disbanded:true，家庭行与共享快照被清，发布 family.disbanded', async () => {
    const a = await register('auto-disband-a@home.dev');
    const family = await a.me.families.create({ name: '陈家' });

    // 预置共享快照（日历 / 共享项 / 共享财务），用于验证解散后硬删（不 re-home）
    await a.me.calendarEvents.create({ familyId: family.id, title: '解散前事件', startAt: '2026-08-01T10:00:00.000Z' });
    await a.me.sharedItems.upsert({ familyId: family.id, module: 'reminders', itemType: 'reminder', itemKey: 'r1', label: '提醒', snapshot: { note: 'x' } });
    await a.me.sharedFinance.upsert({ familyId: family.id, itemType: 'summary', itemKey: 's1', label: '汇总', snapshot: { total: 1 } });

    // 预置存在性 sanity：解散前快照确实写入
    expect((await store.listCalendarEvents(family.id)).length).toBe(1);
    expect((await store.listSharedItems(family.id)).length).toBe(1);
    expect((await store.listSharedFinanceByFamily(family.id)).length).toBe(1);

    const events: any[] = [];
    const unsub = subscribeEvents((e) => events.push(e));
    let res: { ok: boolean; disbanded?: boolean };
    try {
      res = await a.me.families.leave({ familyId: family.id });
    } finally {
      unsub();
    }
    expect(res).toMatchObject({ ok: true, disbanded: true });

    // 家庭行已删除
    expect(await store.getFamily(family.id)).toBeUndefined();

    // 共享快照被硬删（解散语义）
    expect((await store.listCalendarEvents(family.id)).length).toBe(0);
    expect((await store.listSharedItems(family.id)).length).toBe(0);
    expect((await store.listSharedFinanceByFamily(family.id)).length).toBe(0);

    // 列表中不再出现该家庭（A 的个人空间不受影响，仍在）
    const aList = await a.me.families.list();
    expect(aList.find((f) => f.id === family.id)).toBeUndefined();

    // 实时事件 family.disbanded 已发布（actor 为 A）
    const disbanded = events.filter((e) => e.kind === 'family.disbanded' && e.familyId === family.id);
    expect(disbanded).toHaveLength(1);
    expect(disbanded[0]!.actorId).toBe(a.userId);
  });
});

describe('C) 个人家庭不可退出 / 不可解散', () => {
  it('个人家庭 leave → BAD_REQUEST（个人空间不可退出），家庭与成员关系不受影响', async () => {
    const a = await register('personal-leave@home.dev');
    const personalId = await store.getPersonalFamilyId(a.userId);

    await expect(a.me.families.leave({ familyId: personalId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('个人空间不可退出'),
    });

    // 家庭仍在，且 A 仍是成员（未被误删 / 误退；leave 在 kind 检查后即抛错，无写入）
    expect(await store.getFamily(personalId)).toBeDefined();
    expect((await store.getMembershipsByFamily(personalId)).some((m) => m.userId === a.userId)).toBe(true);
  });

  it('个人家庭 disband → BAD_REQUEST（个人空间不可解散），家庭仍在', async () => {
    const a = await register('personal-disband@home.dev');
    const personalId = await store.getPersonalFamilyId(a.userId);

    await expect(a.me.families.disband({ familyId: personalId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('个人空间不可解散'),
    });

    expect(await store.getFamily(personalId)).toBeDefined();
  });
});

describe('D) 解散权限与约束', () => {
  it('非 owner 成员 disband → FORBIDDEN（只有家庭所有者可以解散家庭），家庭仍在', async () => {
    const a = await register('disband-perm-a@home.dev');
    const family = await a.me.families.create({ name: '林家' });
    const b = await register('disband-perm-b@home.dev');
    const inv = await a.me.families.invite({ familyId: family.id, role: 'member' });
    await b.me.families.acceptInvite({ token: inv.token });

    await expect(b.me.families.disband({ familyId: family.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('只有家庭所有者可以解散家庭'),
    });

    // 家庭未被解散（B 无权）；两名成员关系完好
    expect(await store.getFamily(family.id)).toBeDefined();
    expect((await store.getMembershipsByFamily(family.id)).length).toBe(2);
  });

  it('owner 但还有其他成员时 leave → BAD_REQUEST（请先转让所有者），家庭与成员仍在', async () => {
    const a = await register('owner-leave-a@home.dev');
    const family = await a.me.families.create({ name: '黄家' });
    const b = await register('owner-leave-b@home.dev');
    const inv = await a.me.families.invite({ familyId: family.id, role: 'member' });
    await b.me.families.acceptInvite({ token: inv.token });

    await expect(a.me.families.leave({ familyId: family.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('请先转让所有者'),
    });

    // 家庭与两名成员仍在（未解散、未退出）
    expect(await store.getFamily(family.id)).toBeDefined();
    expect((await store.getMembershipsByFamily(family.id)).length).toBe(2);
    const aList = await a.me.families.list();
    expect(aList.find((f) => f.id === family.id)?.role).toBe('owner');
  });
});

describe('E) families.list 回传 kind', () => {
  it('list 同时回传 personal（个人空间）与 shared（共享家庭）kind', async () => {
    const a = await register('list-kind@home.dev');
    const personalId = await store.getPersonalFamilyId(a.userId);
    const shared = await a.me.families.create({ name: '赵家' });

    const list = await a.me.families.list();
    const personalEntry = list.find((f) => f.id === personalId);
    const sharedEntry = list.find((f) => f.id === shared.id);

    expect(personalEntry?.kind).toBe('personal');
    expect(sharedEntry?.kind).toBe('shared');
  });
});
