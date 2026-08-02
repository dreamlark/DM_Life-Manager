// 单后端 family/tenant 隔离端到端测试。
//
// 本文件替换并更名自陈旧的 `zone-isolation.e2e.test.ts`（旧双后端「zone（私区/公区）」模型）。
// 架构已收敛为单后端 All-in-One（ADR-006），数据模型采用 family/tenant 抽象：
//   - 每个用户注册即服务端自动创建 personal family（`store.getPersonalFamilyId(userId)` 服务端派生，
//     不接受客户端 familyId 入参），所有 personal 域 procedure 经该 familyId 隔离。
//   - 用户可创建/加入 shared family，带 RBAC 角色（owner/admin/member/child）；共享条目走 sharedItems 模块。
//   - 数据行双写 ownerId / visibility(默认 'private') / version / lastEditedBy / familyId。
//
// 调研结论（见 cross-user-isolation.test.ts / delete-account.test.ts / family-manage.test.ts /
// shared-items.test.ts / personal-domains.test.ts）：
//   - 跨用户 personal 隔离已由 cross-user-isolation.test.ts 覆盖 → 此处不再重复#1（私区隔离）。
//   - deleteAccount 级联 + public 行改挂 SYSTEM_AUTHOR_ID 已由 cross-user-isolation.test.ts（评审#5）
//     与 delete-account.test.ts 覆盖 → 此处不再重复#5。
// 本文件保留兄弟测试「未覆盖、仍有价值」的独特回归覆盖：
//   A) 双写一致性（ownerId/visibility/version/lastEditedBy/familyId）——迁移期过渡 guard。
//   B) 乐观锁 LWW 字段级合并 + version 递增 + lastEditedBy 写入（比 cross-user-isolation 的 smoke test 更深）。
//   C) ensureSystemAuthor 幂等 upsert（便宜，保留）。
//   D) [SECURITY FINDING] 当前 `visibility='public'` 仍经 resolveZone 的 `(familyId=me OR visibility='public')`
//      分支全局可读——多租户下是泄漏。本文件用断言锁定「当前实际行为」并打标记，待迁移 D.6
//      （resolveZone 切换为 ownerId=ctx.userId 严格作用域）后须改写断言并关闭该发现。
//
// 范式（与兄弟文件一致）：beforeEach 调 initDb()+store.reset()，afterAll 调 closeDb()；
// 通过 appRouter.createCaller 调用。
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appRouter } from '../router';
import { initDb, closeDb, getDb } from '../db';
import { store } from '../store';
import { SYSTEM_AUTHOR_ID, ensureSystemAuthor } from '../db/systemAuthor';
import type { AuthContext } from '../rbac';
import { tasks, users, financeTransfers } from '../db/schema';

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

describe('A) 双写一致性（迁移期 ownerId/visibility/version/lastEditedBy/familyId）', () => {
  it('tasks.create 同时写入新四列与 familyId，且读回一致', async () => {
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

  it('低优先表 financeTransfers 双写下不丢：create 后读回一致', async () => {
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
});

describe('B) 乐观锁 LWW 字段级合并 + version 递增 + lastEditedBy', () => {
  it('过期 expectedVersion 提交 → conflict:true + latestData 字段级合并（LWW），version++、lastEditedBy 写入', async () => {
    const a = await register('ol-a@home.dev');
    const task = await a.me.tasks.create({ title: '初始标题', domainKey: 'work', description: '初始描述' });

    const db = getDb();
    const aFamily = await store.getPersonalFamilyId(a.userId);

    // 第一次提交：version 1→2，无冲突
    const aRes = await store.updateTask(aFamily, { id: task.id, title: 'A改标题' }, 1);
    expect(aRes.conflict).toBe(false);
    expect(aRes.latestData.title).toBe('A改标题');

    // 第二次提交用过期 expectedVersion=1（当前版本已 2）→ 冲突；字段级合并（LWW）
    const bRes = await store.updateTask(aFamily, { id: task.id, description: 'B改描述' }, 1);
    expect(bRes.conflict).toBe(true);
    expect(bRes.latestData.title).toBe('A改标题'); // 未被第二次 set 覆盖（字段级合并）
    expect(bRes.latestData.description).toBe('B改描述');

    // 数据库最终值：last-writer-wins，version 递增到 3，lastEditedBy 记录为 A
    const row = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]!;
    expect(row.title).toBe('A改标题');
    expect(row.description).toBe('B改描述');
    expect(row.version).toBe(3);
    expect(row.lastEditedBy).toBe(a.userId);
  });
});

describe('C) SYSTEM_AUTHOR 锚点幂等', () => {
  it('ensureSystemAuthor 幂等 upsert：连续调用两次不报错且系统用户存在', async () => {
    const db = getDb();
    await ensureSystemAuthor(db);
    await ensureSystemAuthor(db); // 第二次应 ON CONFLICT DO NOTHING，不报错
    const sys = await db.select().from(users).where(eq(users.id, SYSTEM_AUTHOR_ID));
    expect(sys.length).toBe(1);
    expect(sys[0]!.email).toBe('system@localhost');
  });
});

describe('D) [SECURITY FIXED] visibility=public 全局可读（已修复）+ ISSUE-002 写护栏', () => {
  it('[SECURITY FIXED / REGRESSION GUARD] A 发布的 public 行对任意用户 B 不可见（泄漏已关闭，回归保护）', async () => {
    const a = await register('pub-leak-a@home.dev');
    const task = await a.me.tasks.create({ title: 'A 公开发布任务', domainKey: 'work' });

    // 模拟「发布/共享」：将 A 的该行翻为 public（当前 personal 写路径默认产 private 行）
    const db = getDb();
    await db.update(tasks).set({ visibility: 'public' }).where(eq(tasks.id, task.id));

    const b = await register('pub-leak-b@home.dev');
    const bTasks = await b.me.tasks.all();
    const seen = bTasks.find((t) => t.id === task.id);
    // 迁移 D.6 已落地：resolveZone 收敛为严格 familyId=me 作用域，移除全局 visibility='public' 读分支；
    // B 不再能看到 A 的 public 行。本断言验证泄漏已关闭（回归保护）。
    expect(seen).toBeUndefined();

    // 结构性佐证：该行的 familyId 仍是 A 的 personal family；resolveZone 已移除 visibility='public' 分支，
    // B 不再可见（严格 familyId=me 作用域，行仍物理属于 A 家庭）。
    const row = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]!;
    const aFamily = await store.getPersonalFamilyId(a.userId);
    const bFamily = await store.getPersonalFamilyId(b.userId);
    expect(row.familyId).toBe(aFamily); // 挂在 A 的家庭下
    expect(row.familyId).not.toBe(bFamily); // 非 B 的家庭，却因 public 可读
  });

  it('[STRICT ISOLATION] 第三方 C 无法定位/改写他人 public 行（严格隔离 → NOT_FOUND）；owner A 仍可改', async () => {
    const a = await register('tw-a@home.dev');
    const task = await a.me.tasks.create({ title: 'A 原任务', domainKey: 'work' });

    const db = getDb();
    await db.update(tasks).set({ visibility: 'public' }).where(eq(tasks.id, task.id));

    // C：与 A 无关的第三方用户。读已不泄漏（见上条）：跨家庭行根本不在 C 的 zone，update 在 zone 解析阶段即抛 NOT_FOUND（store.ts:245，比 FORBIDDEN 更严），C 无从改写——ISSUE-002 安全目标（禁止跨家庭改写）由严格隔离达成。
    const c = await register('tw-c@home.dev');
    await expect(c.me.tasks.update({ id: task.id, title: 'C 篡改的标题' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // owner 本人仍可编辑自己的 public 行
    const res = await a.me.tasks.update({ id: task.id, title: 'A 改的标题' });
    expect(res.title).toBe('A 改的标题');
    const row = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]!;
    expect(row.title).toBe('A 改的标题');
    expect(row.lastEditedBy).toBe(a.userId);
  });
});
