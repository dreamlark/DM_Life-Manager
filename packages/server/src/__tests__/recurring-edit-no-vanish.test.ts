// Bug C 回归：编辑任务为「每日例行」后，原任务不能从原日期/列表消失。
// 旧逻辑把原行就地改成 repeat='daily' + taskDate=null 的模板，被 listForDate 整条排除，
// 且 LocalApp 的 ensuredRef 守卫让同一 boardDate 不再跑 ensureDaily，于是当天也生不出实例 →
// 任务彻底不可见，直到新建另一个例行任务触发 ensureDaily 才「复活」。
// 修复：原行留在原日期（repeat='none'）继续可见，另建一条模板承载重复规则；全程只新增行。
/// <reference types="vitest" />
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import type { AuthContext } from '../rbac';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const today = () => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

beforeEach(async () => {
  await initDb();
  await store.reset();
});
afterAll(async () => {
  await closeDb();
});

async function makeUser(email: string) {
  const r = await anon().auth.register({ email, name: 'A', password: 'secret123' });
  return appRouter.createCaller({ userId: r.user.id } as AuthContext);
}

describe('Bug C：编辑为每日例行不丢任务', () => {
  it('把今天的普通任务改成每日例行后，原任务仍出现在今天的列表', async () => {
    const me = await makeUser('c1@home.dev');
    const created = await me.tasks.create({ title: '晨间复盘', domainKey: 'work' });
    expect(created.repeat).toBe('none');
    const before = await me.tasks.today();
    expect(before.map((t) => t.id)).toContain(created.id);

    // 编辑为每日例行
    const updated = await me.tasks.update({ id: created.id, repeat: 'daily' });
    expect(updated.id).toBe(created.id); // 原行保留，不换 id
    expect(updated.repeat).toBe('none'); // 原行仍是普通任务（锚定原日期）
    expect(updated.sourceDailyId).toBeTruthy(); // 挂到新模板

    // 关键断言：原任务没有从今天消失
    const after = await me.tasks.today();
    expect(after.map((t) => t.id)).toContain(created.id);

    // 全量里应有：1 条原任务 + 1 条 daily 模板（共 2 行），且用户数据零删除
    const all = await me.tasks.all();
    expect(all).toHaveLength(2);
    const template = all.find((t) => t.repeat === 'daily');
    expect(template).toBeTruthy();
    expect(template!.taskDate).toBeNull();
    expect(template!.title).toBe('晨间复盘');
    expect(updated.sourceDailyId).toBe(template!.id);
  });

  it('多个任务分别改成每日例行，每个原任务都在今天可见，且各自有独立模板', async () => {
    const me = await makeUser('c2@home.dev');
    const a = await me.tasks.create({ title: '喝水', domainKey: 'health' });
    const b = await me.tasks.create({ title: '拉伸', domainKey: 'health' });
    await me.tasks.update({ id: a.id, repeat: 'daily' });
    await me.tasks.update({ id: b.id, repeat: 'daily' });

    const todayList = await me.tasks.today();
    expect(todayList.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());

    const all = await me.tasks.all();
    expect(all).toHaveLength(4); // 2 原任务（repeat none） + 2 模板（repeat daily）
    const templateCount = all.filter((t) => t.repeat === 'daily').length;
    expect(templateCount).toBe(2);
  });

  it('新建时直接勾选每日例行：原任务不可见当天，但 ensureDaily 后生成今天的实例可见', async () => {
    const me = await makeUser('c3@home.dev');
    const created = await me.tasks.create({ title: '记账', domainKey: 'wealth', repeat: 'daily' });
    expect(created.repeat).toBe('daily');
    expect(created.taskDate).toBeNull();

    // 模板本身不在 today（设计如此）
    expect(await me.tasks.today()).toHaveLength(0);

    // ensureDaily 实例化今天 → 出现在今天
    await me.tasks.ensureDaily({ date: today() });
    const inst = await me.tasks.today();
    expect(inst).toHaveLength(1);
    expect(inst[0]!.sourceDailyId).toBe(created.id);
    expect(inst[0]!.repeat).toBe('none');

    // 既不会误伤其他普通任务，也不会重复生成（幂等）
    const a = await me.tasks.create({ title: '普通事', domainKey: 'work' });
    await me.tasks.ensureDaily({ date: today() });
    await me.tasks.ensureDaily({ date: today() });
    const again = await me.tasks.today();
    expect(again.map((t) => t.id).sort()).toEqual([a.id, inst[0]!.id].sort());
  });

  it('向后兼容：旧客户端仍发 { repeat:"daily", taskDate:null } 的破坏性补丁时也不丢任务', async () => {
    const me = await makeUser('c5@home.dev');
    const created = await me.tasks.create({ title: '旧客户端任务', domainKey: 'work' });
    // 旧前端会把 taskDate 一起清空、把原行就地变成模板 —— 这正是任务消失的直接原因
    const updated = await me.tasks.update({ id: created.id, repeat: 'daily', taskDate: null });
    // 服务端兜底：taskDate=null 回退到原任务日期作为锚点，原行仍是当天的普通任务
    expect(updated.repeat).toBe('none');
    expect(updated.taskDate).toBe(today());
    expect((await me.tasks.today()).map((t) => t.id)).toContain(created.id);
  });

  it('取消每日例行（回填 none）时原任务保持可见，不删除任何数据', async () => {
    const me = await makeUser('c4@home.dev');
    const created = await me.tasks.create({ title: '阅读', domainKey: 'health', repeat: 'daily' });
    expect(await me.tasks.today()).toHaveLength(0);
    await me.tasks.ensureDaily({ date: today() });
    const inst = (await me.tasks.today())[0]!;

    // 取消例行：实例脱离模板（sourceDailyId=null），仍留在原日期可见
    const cancelled = await me.tasks.update({ id: inst.id, repeat: 'none', sourceDailyId: null });
    expect(cancelled.repeat).toBe('none');
    expect(cancelled.sourceDailyId).toBeNull();
    expect((await me.tasks.today()).map((t) => t.id)).toContain(inst.id);
    // 模板行仍在（未删除）
    expect((await me.tasks.all()).some((t) => t.id === created.id)).toBe(true);
  });
});
