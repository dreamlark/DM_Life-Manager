// 账户注销（auth.deleteAccount）端到端测试
// 覆盖：注册→建个人数据→deleteAccount 成功→级联清除个人家庭/用户行/个人数据→旧 refreshToken 失效→未认证拒绝。
// 遵循现有范式：beforeEach 调 initDb()+store.reset()，afterAll 调 closeDb()；通过 appRouter.createCaller 调用。
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { eq, getTableName } from 'drizzle-orm';
import { appRouter } from '../router';
import { initDb, closeDb, getDb } from '../db';
import { store } from '../store';
import { SYSTEM_AUTHOR_ID } from '../db/systemAuthor';
import type { AuthContext } from '../rbac';
import {
  tasks,
  notes,
  reminderClocks,
  debts,
  incomes,
  transactions,
  assets,
  budgets,
  interests,
  projects,
  domains,
  calendarEvents,
  sharedFinanceItems,
  sharedItems,
  focusSessions,
  financeTransfers,
  systemMeta,
  users,
} from '../db/schema';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const asUser = (userId: string) => appRouter.createCaller({ userId } as AuthContext);

beforeEach(async () => {
  await initDb();
  await store.reset();
});

afterAll(async () => {
  await closeDb();
});

// deleteUserAccount 显式删除的 17 张个人表（与 schema.ts 全部带 familyId 的个人数据表一致）
const PERSONAL_TABLES = [
  tasks,
  notes,
  reminderClocks,
  debts,
  incomes,
  transactions,
  assets,
  budgets,
  interests,
  projects,
  domains,
  calendarEvents,
  sharedFinanceItems,
  sharedItems,
  focusSessions,
  financeTransfers,
  systemMeta,
] as const;

describe('账户注销（auth.deleteAccount）', () => {
  it('注册→建个人数据→注销→级联清除个人家庭/用户行/个人数据，且旧 refreshToken 失效', async () => {
    // 1) 注册，拿到 userId 与注销前颁发的 refreshToken
    const reg = await anon().auth.register({ email: 'del@home.dev', name: 'Del', password: 'secret123' });
    const userId = reg.user.id;
    const oldRefresh = reg.refreshToken;

    // 2) 通过真实 procedure 建个人数据（覆盖 tasks / notes / finance 三类）
    const me = asUser(userId);
    await me.tasks.create({ title: '个人任务', domainKey: 'work' });
    await me.notes.ingest({ title: '私人笔记', bodyMarkdown: '仅本人可见' });
    await me.finance.debts.create({ creditor: '银行', principal: 5000, apr: 12, minPayment: 300, dueDay: 5 });

    // 注销前：个人家庭与个人数据确实存在
    const personalFamilyId = await store.getPersonalFamilyId(userId);
    const db = getDb();
    expect((await db.select().from(tasks).where(eq(tasks.familyId, personalFamilyId))).length).toBe(1);
    expect((await db.select().from(notes).where(eq(notes.familyId, personalFamilyId))).length).toBe(1);
    expect((await db.select().from(debts).where(eq(debts.familyId, personalFamilyId))).length).toBe(1);

    // 3) 调用 deleteAccount，应成功返回 { ok: true }
    const res = await asUser(userId).auth.deleteAccount();
    expect(res).toEqual({ ok: true });

    // 4) 断言：用户行被删
    expect(await store.getUserById(userId)).toBeUndefined();

    // 4a) 断言：个人家庭已随用户一起清除（getPersonalFamilyId 应抛错）
    await expect(store.getPersonalFamilyId(userId)).rejects.toThrow();

    // 4b) 断言：抽样三类个人数据表已清空（tasks / notes / debts）
    expect((await db.select().from(tasks)).length).toBe(0);
    expect((await db.select().from(notes)).length).toBe(0);
    expect((await db.select().from(debts)).length).toBe(0);

    // 4c) 强断言：deleteUserAccount 显式删除的全部 17 张个人表在本用户会话内已彻底清零（无遗留隐私数据）
    for (const table of PERSONAL_TABLES) {
      const rows = await db.select().from(table);
      expect(rows.length, `个人表 ${getTableName(table)} 在注销后仍有残留行`).toBe(0);
    }

    // 4d) 断言：被注销用户已不存在；系统用户（SYSTEM_AUTHOR_ID，public 行改挂锚点）必须保留
    const remainingUsers = await db.select().from(users);
    expect(remainingUsers.find((u) => u.id === userId)).toBeUndefined();
    expect(remainingUsers.find((u) => u.id === SYSTEM_AUTHOR_ID)).toBeDefined();

    // 5) 断言：注销前拿到的旧 refreshToken 已失效（会话被吊销 → refresh 应 reject）
    await expect(anon().auth.refresh({ refreshToken: oldRefresh })).rejects.toThrow(/无效|过期/);
  });

  it('未认证（匿名）调用 deleteAccount 被 authedProcedure 拒绝（UNAUTHORIZED）', async () => {
    await expect(anon().auth.deleteAccount()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
