// M2 共享日历（创建 / 编辑 / 删除）+ RBAC —— 真实 PG 兼容库 PGLite 内存实例
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { appRouter } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import type { AuthContext } from '../rbac';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const asUser = (userId: string) => appRouter.createCaller({ userId } as AuthContext);

/** 建立 alice(owner) + bob(member) + kid(child) 的家庭，返回上下文 */
async function seedFamily() {
  const alice = await anon().auth.register({ email: 'cal-a@home.dev', name: 'Alice', password: 'secret1' });
  const family = await asUser(alice.user.id).families.create({ name: '杨家' });
  const bob = await anon().auth.register({ email: 'cal-b@home.dev', name: 'Bob', password: 'secret1' });
  const inv = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'member' });
  await asUser(bob.user.id).families.acceptInvite({ token: inv.token });
  const kid = await anon().auth.register({ email: 'cal-k@home.dev', name: 'Kid', password: 'secret1' });
  const invK = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'child' });
  await asUser(kid.user.id).families.acceptInvite({ token: invK.token });
  return { alice, bob, kid, family };
}

beforeEach(async () => {
  await initDb();
  await store.reset();
});
afterAll(async () => {
  await closeDb();
});

describe('M2 共享日历：创建 / 编辑 / 删除 + RBAC', () => {
  it('owner 创建事件，list 按 startAt 升序返回；guest 无 createEvent 被 FORBIDDEN', async () => {
    const { alice, family } = await seedFamily();
    const later = new Date(Date.now() + 3600_000).toISOString();
    const sooner = new Date(Date.now() + 600_000).toISOString();
    const ev1 = await asUser(alice.user.id).calendarEvents.create({
      familyId: family.id,
      title: '晚一点的聚会',
      startAt: later,
    });
    const ev2 = await asUser(alice.user.id).calendarEvents.create({
      familyId: family.id,
      title: '稍早的晨跑',
      startAt: sooner,
      allDay: true,
    });
    expect(ev1.title).toBe('晚一点的聚会');
    expect(ev2.allDay).toBe(true);

    const list = await asUser(alice.user.id).calendarEvents.list({ familyId: family.id });
    expect(list.map((e) => e.id)).toEqual([ev2.id, ev1.id]); // 升序

    // guest 无 createEvent
    const guest = await anon().auth.register({ email: 'cal-g@home.dev', name: 'Guest', password: 'secret1' });
    const invG = await asUser(alice.user.id).families.invite({ familyId: family.id, role: 'guest' });
    await asUser(guest.user.id).families.acceptInvite({ token: invG.token });
    await expect(
      asUser(guest.user.id).calendarEvents.create({ familyId: family.id, title: 'guest 试试', startAt: sooner }),
    ).rejects.toThrow(/FORBIDDEN|无权/);
  });

  it('child 可创建事件，但不可编辑他人事件（editEvent）', async () => {
    const { alice, kid, family } = await seedFamily();
    const start = new Date(Date.now() + 600_000).toISOString();
    // child 创建
    const ev = await asUser(kid.user.id).calendarEvents.create({ familyId: family.id, title: 'kid 的钢琴课', startAt: start });
    expect(ev.createdBy).toBe(kid.user.id);

    // child 改 alice 创建的事件 → FORBIDDEN（无 editEvent）
    const evA = await asUser(alice.user.id).calendarEvents.create({ familyId: family.id, title: 'alice 的会议', startAt: start });
    await expect(
      asUser(kid.user.id).calendarEvents.update({ eventId: evA.id, title: '被 kid 篡改' }),
    ).rejects.toThrow(/FORBIDDEN|无权/);
    // child 可改自己创建的
    const updated = await asUser(kid.user.id).calendarEvents.update({ eventId: ev.id, title: 'kid 的钢琴课(改)' });
    expect(updated!.title).toBe('kid 的钢琴课(改)');
  });

  it('删除权限边界：创建人可删自己的；成员删他人被 FORBIDDEN；owner 可删他人', async () => {
    const { alice, bob, family } = await seedFamily();
    const start = new Date(Date.now() + 600_000).toISOString();
    const evA = await asUser(alice.user.id).calendarEvents.create({ familyId: family.id, title: 'alice 事件', startAt: start });
    const evB = await asUser(bob.user.id).calendarEvents.create({ familyId: family.id, title: 'bob 事件', startAt: start });

    // bob 删 alice 的事件 → FORBIDDEN
    await expect(asUser(bob.user.id).calendarEvents.remove({ eventId: evA.id })).rejects.toThrow(/FORBIDDEN|无权/);
    // bob 删自己的 → ok
    await asUser(bob.user.id).calendarEvents.remove({ eventId: evB.id });
    const list = await asUser(alice.user.id).calendarEvents.list({ familyId: family.id });
    expect(list.find((e) => e.id === evB.id)).toBeFalsy();
    // owner 删 alice 创建的 → ok
    await asUser(alice.user.id).calendarEvents.remove({ eventId: evA.id });
    const list2 = await asUser(alice.user.id).calendarEvents.list({ familyId: family.id });
    expect(list2.find((e) => e.id === evA.id)).toBeFalsy();
  });

  it('不存在的事件 update/remove 返回 NOT_FOUND', async () => {
    const { alice, family } = await seedFamily();
    await expect(
      asUser(alice.user.id).calendarEvents.update({ eventId: '00000000-0000-0000-0000-000000000000', title: 'x' }),
    ).rejects.toThrow(/不存在/);
    await expect(
      asUser(alice.user.id).calendarEvents.remove({ eventId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/不存在/);
  });
});
