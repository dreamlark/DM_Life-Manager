// P1a 跨用户 E2E：zone 隔离（私区 IDOR 护栏）/ 公区读可见 / 公区写权限 / 乐观锁冲突 / deleteUserAccount 不波及他人 / 迁移双写一致性。
// 复用现有范式：beforeEach 调 initDb()+store.reset()，afterAll 调 closeDb()；通过 appRouter.createCaller 调用。
// 关键机制（来自规格 + 评审结论）：
//   - resolveZone(table, meFamilyId) = (familyId = me OR visibility = 'public')，meFamilyId 由 store.getPersonalFamilyId(ctx.userId) 服务端派生。
//   - bumpVersionAndEdit 实现乐观锁：expectedVersion 不符 → 仍 last-writer-wins 落库并返回 { conflict: true, latestData }。
//   - deleteUserAccount：private 行按 ownerId+visibility 删；public 行 ownerId 改挂 SYSTEM_AUTHOR_ID。
// 说明：当前所有 personal 域 procedure 仅创建 visibility='private' 行（无「发布/共享」入口），故公区读/冲突/写测试里，
//       以「创建 private 行后直接把 visibility 翻为 public」模拟已发布/共享状态，以验证 zone 读/写与删除语义。
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appRouter } from '../router';
import { initDb, closeDb, getDb } from '../db';
import { store } from '../store';
import { SYSTEM_AUTHOR_ID, ensureSystemAuthor } from '../db/systemAuthor';
import type { AuthContext } from '../rbac';
import { tasks, notes, debts, projects, financeTransfers, users } from '../db/schema';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const asUser = (userId: string) => appRouter.createCaller({ userId } as AuthContext);

/** 注册一个用户并回传 caller + userId（复用项目真实 auth 路径） */
async function register(email: string) {
  const reg = await anon().auth.register({ email, name: 'u', password: 'secret123' });
  return { userId: reg.user.id, me: asUser(reg.user.id) };
}

beforeEach(async () => {
  await initDb();
  await store.reset();
});

afterAll(async () => {
  await closeDb();
});

describe('1) 私区隔离（核心 IDOR 护栏）', () => {
  it('B 看不到 A 的任何私区数据（task/note/debt/project），familyId 由服务端派生不可被客户端篡改', async () => {
    // A 建 4 种私区实体
    const a = await register('iso-a@home.dev');
    const aTask = await a.me.tasks.create({ title: 'A 私区任务', domainKey: 'work' });
    const aNote = await a.me.notes.ingest({ title: 'A 私区笔记', bodyMarkdown: '仅 A 可见' });
    const aDebt = await a.me.finance.debts.create({ creditor: 'A银行', principal: 5000, apr: 12, minPayment: 300, dueDay: 5 });
    const aProject = await a.me.projects.create({ name: 'A项目', paraType: 'project' });

    // B 是不同用户（不同 personal family）
    const b = await register('iso-b@home.dev');

    const bTasks = await b.me.tasks.all();
    const bNotes = await b.me.notes.list();
    const bDebts = await b.me.finance.debts.list();
    const bProjects = await b.me.projects.list();

    // 断言：B 的列表为空，完全不含 A 的任何私区行（resolveZone 仅含 familyId=B 或 public）
    expect(bTasks.find((t) => t.id === aTask.id)).toBeUndefined();
    expect(bNotes.find((n) => n.id === aNote)).toBeUndefined();
    expect(bDebts.find((d) => d.id === aDebt.id)).toBeUndefined();
    expect(bProjects.find((p) => p.id === aProject.id)).toBeUndefined();
    expect(bTasks.length).toBe(0);
    expect(bNotes.length).toBe(0);
    expect(bDebts.length).toBe(0);
    expect(bProjects.length).toBe(0);

    // 结构性断言：所有 personal procedure 经 store.getPersonalFamilyId(ctx.userId) 派生 familyId，
    // 不接受客户端 familyId 入参，故 B 无法伪造 A 的 familyId 越权。`getPersonalFamilyId` 派生正确。
    const db = getDb();
    const aFamily = await store.getPersonalFamilyId(a.userId);
    const aTaskRow = (await db.select().from(tasks).where(eq(tasks.id, aTask.id)))[0]!;
    expect(aTaskRow.familyId).toBe(aFamily); // A 行确实挂在 A 的 family 下
  });
});

describe('2) 公区读可见', () => {
  it('A 的 public 行对 B 可见（resolveZone 含 visibility=public 分支），A 自己也能见', async () => {
    const a = await register('pub-a@home.dev');
    const aTask = await a.me.tasks.create({ title: 'A 公开发布任务', domainKey: 'work' });

    // 模拟「发布/共享」：将 A 的该行翻为 public（当前 procedure 仅产 private 行）
    const db = getDb();
    await db.update(tasks).set({ visibility: 'public' }).where(eq(tasks.id, aTask.id));

    const b = await register('pub-b@home.dev');
    const bTasks = await b.me.tasks.all();
    expect(bTasks.find((t) => t.id === aTask.id)).toBeDefined();
    expect(bTasks.find((t) => t.id === aTask.id)!.title).toBe('A 公开发布任务');

    const aTasks = await a.me.tasks.all();
    expect(aTasks.find((t) => t.id === aTask.id)).toBeDefined();
  });
});

describe('3) 公区写权限（trusted-editor / ISSUE-002）', () => {
  it('ISSUE-002 修复：未授权第三方无法改他人 public 行（FORBIDDEN）；owner 本人仍可改', async () => {
    const a = await register('tw-a@home.dev');
    const aTask = await a.me.tasks.create({ title: 'A 原任务', domainKey: 'work' });

    const db = getDb();
    await db.update(tasks).set({ visibility: 'public' }).where(eq(tasks.id, aTask.id));

    // C：与 A 无关的第三方用户
    const c = await register('tw-c@home.dev');

    // 修复后：C 非 A 的家庭成员（个人域 public 行的 owner 家族仅含 A），写入应被拦截。
    await expect(c.me.tasks.update({ id: aTask.id, title: 'C 篡改的标题' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // owner 本人仍可编辑自己的 public 行
    const res = await a.me.tasks.update({ id: aTask.id, title: 'A 改的标题' });
    expect(res.title).toBe('A 改的标题');
    const row = (await db.select().from(tasks).where(eq(tasks.id, aTask.id)))[0]!;
    expect(row.title).toBe('A 改的标题');
    expect(row.lastEditedBy).toBe(a.userId);
  });
});

describe('4) 乐观锁冲突 latestData', () => {
  it('owner 用过期 expectedVersion 提交 → conflict:true + latestData 字段级合并（LWW）', async () => {
    const a = await register('ol-a@home.dev');
    const task = await a.me.tasks.create({ title: '初始标题', domainKey: 'work', description: '初始描述' });

    const db = getDb();
    await db.update(tasks).set({ visibility: 'public' }).where(eq(tasks.id, task.id));

    const aFamily = await store.getPersonalFamilyId(a.userId);

    // 第一次提交：version 1→2，无冲突
    const aRes = await store.updateTask(aFamily, { id: task.id, title: 'A改标题' }, 1);
    expect(aRes.conflict).toBe(false);
    expect(aRes.latestData.title).toBe('A改标题');

    // 第二次提交用过期 expectedVersion=1（当前版本已 2）→ 冲突；字段级合并（LWW）
    const bRes = await store.updateTask(aFamily, { id: task.id, description: 'B改描述' }, 1);
    expect(bRes.conflict).toBe(true);
    expect(bRes.latestData.title).toBe('A改标题');
    expect(bRes.latestData.description).toBe('B改描述');

    // 数据库最终值：last-writer-wins，version 递增到 3
    const row = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]!;
    expect(row.title).toBe('A改标题');
    expect(row.description).toBe('B改描述');
    expect(row.version).toBe(3);
    expect(row.lastEditedBy).toBe(a.userId);
  });
});

describe('5) deleteUserAccount 不波及他人 + public 行改挂系统用户', () => {
  it('删 A 不波及 B 的私区数据；A 的 public 行改挂 SYSTEM_AUTHOR_ID 而非消失', async () => {
    const a = await register('del-a@home.dev');
    const aPrivTask = await a.me.tasks.create({ title: 'A 私区任务', domainKey: 'work' });
    const aPubTask = await a.me.tasks.create({ title: 'A 公开发布任务', domainKey: 'work' });

    const b = await register('del-b@home.dev');
    const bPrivTask = await b.me.tasks.create({ title: 'B 私区任务', domainKey: 'work' });
    await b.me.notes.ingest({ title: 'B 笔记', bodyMarkdown: 'b' });

    const db = getDb();
    // 将 A 的一条行翻为 public，验证注销后应改挂 SYSTEM_AUTHOR_ID 而非被删除
    await db.update(tasks).set({ visibility: 'public' }).where(eq(tasks.id, aPubTask.id));

    // 注销前：B 的私区数据存在
    const bTasksBefore = (await db.select().from(tasks).where(eq(tasks.ownerId, b.userId))).length;
    expect(bTasksBefore).toBe(1);

    // 删除 A
    await a.me.auth.deleteAccount();

    // 断言 B 的私区数据完整无损
    const bTasksAfter = await db.select().from(tasks).where(eq(tasks.ownerId, b.userId));
    expect(bTasksAfter.length).toBe(1);
    expect(bTasksAfter[0]!.id).toBe(bPrivTask.id);
    const bNotesAfter = await db.select().from(notes).where(eq(notes.ownerId, b.userId));
    expect(bNotesAfter.length).toBe(1);
    // B 经 procedure 仍能读到自己的数据
    const bTasksView = await b.me.tasks.all();
    expect(bTasksView.find((t) => t.id === bPrivTask.id)).toBeDefined();

    // 断言 A 的 public 行：改挂 SYSTEM_AUTHOR_ID 且保留（不消失）
    const aPubRow = await db.select().from(tasks).where(eq(tasks.id, aPubTask.id));
    expect(aPubRow.length).toBe(1); // 关键：不应被级联删除
    expect(aPubRow[0]!.ownerId).toBe(SYSTEM_AUTHOR_ID);
    expect(aPubRow[0]!.visibility).toBe('public');

    // 系统用户必须保留
    const usersLeft = await db.select().from(users);
    expect(usersLeft.find((u) => u.id === SYSTEM_AUTHOR_ID)).toBeDefined();
  });
});

describe('6) 迁移双写一致性 + ensureSystemAuthor 幂等', () => {
  it('双写一致性：create 同时写入新四列(ownerId/visibility/version/lastEditedBy)与旧 familyId，且读回一致', async () => {
    const a = await register('dw-a@home.dev');
    const aFamily = await store.getPersonalFamilyId(a.userId);
    const task = await a.me.tasks.create({ title: '双写任务', domainKey: 'work' });

    const db = getDb();
    const row = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]!;
    // 新四列
    expect(row.ownerId).toBe(a.userId);
    expect(row.visibility).toBe('private');
    expect(row.version).toBe(1);
    expect(row.lastEditedBy).toBeNull();
    // 旧 familyId 同时写入且等于 A 的 personal family（双写过渡期）
    expect(row.familyId).toBe(aFamily);
  });

  it('低优先表 financeTransfers 在双写下不丢：create 后读回一致', async () => {
    const a = await register('dw-t@home.dev');
    const aFamily = await store.getPersonalFamilyId(a.userId);
    const transfer = await a.me.finance.transfers.create({
      fromAccountId: 'acc-from',
      toAccountId: 'acc-to',
      amountMinor: 12345,
      occurredAt: '2026-07-25T10:00:00.000Z',
    });

    const db = getDb();
    const row = (await db.select().from(financeTransfers).where(eq(financeTransfers.id, transfer.id)))[0]!;
    expect(row).toBeTruthy();
    expect(row.ownerId).toBe(a.userId);
    expect(row.familyId).toBe(aFamily);
    expect(row.visibility).toBe('private');
    expect(row.version).toBe(1);
    // procedure 读回一致（不丢）
    const listed = await a.me.finance.transfers.list({ limit: 10 });
    expect(listed.find((t) => t.id === transfer.id)).toBeDefined();
  });

  it('ensureSystemAuthor 幂等 upsert：连续调用两次不报错且系统用户存在', async () => {
    const db = getDb();
    await ensureSystemAuthor(db);
    await ensureSystemAuthor(db); // 第二次应 ON CONFLICT DO NOTHING，不报错
    const sys = await db.select().from(users).where(eq(users.id, SYSTEM_AUTHOR_ID));
    expect(sys.length).toBe(1);
    expect(sys[0]!.email).toBe('system@localhost');
  });
});
