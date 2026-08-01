// 跨用户隔离 + 账户注销 public 改挂 + 乐观锁契约 端到端测试
// 覆盖评审 follow-up：#6 跨用户隔离、#5 deleteUserAccount public 改挂、#3 越权 id→NOT_FOUND、#4 updateX 返回 {conflict,latestData}
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appRouter } from '../router';
import { initDb, closeDb, getDb } from '../db';
import { store } from '../store';
import { SYSTEM_AUTHOR_ID, SYSTEM_FAMILY_ID } from '../db/systemAuthor';
import type { AuthContext } from '../rbac';
import { tasks, users } from '../db/schema';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const asUser = (userId: string) => appRouter.createCaller({ userId } as AuthContext);

beforeEach(async () => {
  await initDb();
  await store.reset();
});

afterAll(async () => {
  await closeDb();
});

describe('跨用户隔离（评审 #6）', () => {
  it('B 看不到 A 的私区任务；用 A 的 id 调 update 返回 NOT_FOUND 而非 500（评审 #3）', async () => {
    const a = await anon().auth.register({ email: 'a@home.dev', name: 'A', password: 'secret123' });
    const b = await anon().auth.register({ email: 'b@home.dev', name: 'B', password: 'secret123' });
    const ta = await asUser(a.user.id).tasks.create({ title: 'A 的私人任务', domainKey: 'work' });

    // B 的列表不应包含 A 的私区任务
    const bAll = await asUser(b.user.id).tasks.all();
    expect(bAll.find((t) => t.id === ta.id)).toBeUndefined();

    // B 用 A 的任务 id 直接走 store 写路径：zone 作用域拒绝 → NOT_FOUND（修复前是 500 空指针）
    const bFamily = await store.getPersonalFamilyId(b.user.id);
    await expect(store.updateTask(bFamily, { id: ta.id, title: 'hack' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.completeTask(bFamily, { id: ta.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('删除 A 账户不会删除 B 的私区数据（删 A 不删 B）', async () => {
    const a = await anon().auth.register({ email: 'a2@home.dev', name: 'A2', password: 'secret123' });
    const b = await anon().auth.register({ email: 'b2@home.dev', name: 'B2', password: 'secret123' });
    const ta = await asUser(a.user.id).tasks.create({ title: 'A2 的私人任务', domainKey: 'work' });
    const tb = await asUser(b.user.id).tasks.create({ title: 'B2 的私人任务', domainKey: 'work' });
    const aFamily = await store.getPersonalFamilyId(a.user.id);
    const bFamily = await store.getPersonalFamilyId(b.user.id);

    await asUser(a.user.id).auth.deleteAccount();

    // A 的私区任务已删除
    const db = getDb();
    expect((await db.select().from(tasks).where(eq(tasks.familyId, aFamily))).length).toBe(0);
    expect(await store.getUserById(a.user.id)).toBeUndefined();

    // B 的私区数据完好
    expect(await store.getUserById(b.user.id)).toBeDefined();
    const bAllAfter = await asUser(b.user.id).tasks.all();
    expect(bAllAfter.find((t) => t.id === tb.id)).toBeDefined();
    expect(bAllAfter.find((t) => t.id === ta.id)).toBeUndefined();
  });
});

describe('deleteUserAccount public 改挂 SYSTEM_AUTHOR_ID（评审 #5）', () => {
  it('A 的 public 任务在注销后改挂 SYSTEM_AUTHOR_ID 且仍对 B 可见', async () => {
    const a = await anon().auth.register({ email: 'a3@home.dev', name: 'A3', password: 'secret123' });
    const b = await anon().auth.register({ email: 'b3@home.dev', name: 'B3', password: 'secret123' });
    const pub = await asUser(a.user.id).tasks.create({ title: '公共任务', domainKey: 'work' });

    // 直接将其置为 public（真实写路径默认 private）
    const db = getDb();
    await db.update(tasks).set({ visibility: 'public' }).where(eq(tasks.id, pub.id));

    await asUser(a.user.id).auth.deleteAccount();

    // public 行未被删除，ownerId 改挂系统用户，familyId 迁移到系统家庭（避免 cascade）
    const rows = await db.select().from(tasks).where(eq(tasks.id, pub.id));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.ownerId).toBe(SYSTEM_AUTHOR_ID);
    expect(row.visibility).toBe('public');
    expect(row.familyId).toBe(SYSTEM_FAMILY_ID);

    // 系统用户锚点保留
    const remaining = await db.select().from(users);
    expect(remaining.find((u) => u.id === SYSTEM_AUTHOR_ID)).toBeDefined();

    // B 仍能看到该 public 行（resolveZone 含 visibility='public'）
    const bAll = await asUser(b.user.id).tasks.all();
    expect(bAll.find((t) => t.id === pub.id)).toBeDefined();
  });
});

describe('乐观锁契约 updateX 返回 {conflict, latestData}（评审 #4）', () => {
  it('tasks.update / validateInterest / convertInterest 返回 {conflict, latestData}', async () => {
    const a = await anon().auth.register({ email: 'a4@home.dev', name: 'A4', password: 'secret123' });
    const family = await store.getPersonalFamilyId(a.user.id);

    const t = await asUser(a.user.id).tasks.create({ title: '待更新', domainKey: 'work' });
    const upd = await store.updateTask(family, { id: t.id, title: '已更新' });
    expect(typeof upd.conflict).toBe('boolean');
    expect(upd.latestData).toBeDefined();
    expect(upd.latestData.id).toBe(t.id);

    const interest = await asUser(a.user.id).interests.capture({ title: '兴趣X', domainKey: 'work' });
    const validated = await store.validateInterest(family, { id: interest.id });
    expect(typeof validated.conflict).toBe('boolean');
    expect(validated.latestData).toBeDefined();

    const captured2 = await asUser(a.user.id).interests.capture({ title: '兴趣Y', domainKey: 'work' });
    const converted = await store.convertInterest(family, { id: captured2.id, name: '项目Y' });
    expect(typeof converted.conflict).toBe('boolean');
    expect(converted.latestData).toBeDefined();
  });
});
