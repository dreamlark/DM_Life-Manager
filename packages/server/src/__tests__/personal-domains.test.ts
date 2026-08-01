// 个人域迁移冒烟测试：注册即创建 personal family，所有 personal 域 procedure 经
// store.getPersonalFamilyId 隔离；校验「不抛错 + 形状合理」。
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

describe('个人域（从 engine 迁移到 server，按 personal family 隔离）', () => {
  it('注册 → tasks.ensureDaily / today / create 正常工作', async () => {
    const u = await anon().auth.register({ email: 'pd-a@home.dev', name: 'A', password: 'secret123' });
    const me = asUser(u.user.id);

    await me.tasks.ensureDaily({ date: DATE });
    const today = await me.tasks.today({ date: DATE });
    expect(Array.isArray(today)).toBe(true);

    const created = await me.tasks.create({
      title: '写一篇周报',
      domainKey: 'work',
      taskDate: DATE,
    });
    expect(created.id).toBeTruthy();
    expect(created.domainKey).toBe('work');
    expect(created.quadrant).toMatch(/^q[1-4]$/);

    const afterToday = await me.tasks.today({ date: DATE });
    expect(afterToday.length).toBeGreaterThanOrEqual(1);
  });

  it('finance.summary / debts / incomes 返回合理数值形状', async () => {
    const u = await anon().auth.register({ email: 'pd-b@home.dev', name: 'B', password: 'secret123' });
    const me = asUser(u.user.id);

    const summary = await me.finance.summary();
    expect(typeof summary.totalDebt).toBe('number');
    expect(typeof summary.netWorth).toBe('number');
    expect(typeof summary.debtCount).toBe('number');
    expect(summary.debtCount).toBe(0);

    const debts = await me.finance.debts.list();
    expect(Array.isArray(debts)).toBe(true);

    const created = await me.finance.debts.create({
      creditor: '招行信用卡',
      principal: 10000,
      apr: 18,
      minPayment: 500,
      dueDay: 5,
    });
    expect(created.id).toBeTruthy();
    expect(typeof created.remainingPrincipal).toBe('number');

    const summary2 = await me.finance.summary();
    expect(summary2.debtCount).toBe(1);
    expect(summary2.totalDebt).toBeGreaterThan(0);
  });

  it('insights.dailyCard / pressure 返回合理形状', async () => {
    const u = await anon().auth.register({ email: 'pd-c@home.dev', name: 'C', password: 'secret123' });
    const me = asUser(u.user.id);

    const card = await me.insights.dailyCard({ date: DATE });
    expect(typeof card.total).toBe('number');
    expect(typeof card.done).toBe('number');
    expect(typeof card.mitCount).toBe('number');
    expect(card.domainCounts).toBeTypeOf('object');

    const pressure = await me.insights.pressure();
    expect(typeof pressure.score).toBe('number');
    expect(['calm', 'mild', 'tense', 'overloaded']).toContain(pressure.level);
  });

  it('reminders.list / domains.list / notes.ingest / knowledge.semanticSearch 正常', async () => {
    const u = await anon().auth.register({ email: 'pd-d@home.dev', name: 'D', password: 'secret123' });
    const me = asUser(u.user.id);

    expect(Array.isArray(await me.reminders.list())).toBe(true);

    const domains = await me.domains.list();
    expect(Array.isArray(domains)).toBe(true);
    expect(domains.length).toBeGreaterThanOrEqual(9); // 8+1 领域种子

    const noteId = await me.notes.ingest({ title: '灵感：用 PGlite 替代 sql.js', bodyMarkdown: '服务端内嵌真实 Postgres' });
    expect(typeof noteId).toBe('string');

    const results = await me.knowledge.semanticSearch({ query: 'PGlite Postgres 嵌入', k: 5 });
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('title');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('snippet');
    }
  });

  it('flow.summary 返回热力图/洞察形状', async () => {
    const u = await anon().auth.register({ email: 'pd-e@home.dev', name: 'E', password: 'secret123' });
    const me = asUser(u.user.id);

    const summary = await me.flow.summary({ range: 'week', unit: 'hour', axis: 'domain' });
    expect(summary.range).toBe('week');
    expect(Array.isArray(summary.cols)).toBe(true);
    expect(Array.isArray(summary.rows)).toBe(true);
    expect(summary.insights).toHaveProperty('totalSessions');
    expect(Array.isArray(summary.lowAttentionAlerts)).toBe(true);
  });

  it('projects.create / interests.capture 正常且按 family 隔离', async () => {
    const u = await anon().auth.register({ email: 'pd-f@home.dev', name: 'F', password: 'secret123' });
    const me = asUser(u.user.id);

    const p = await me.projects.create({ name: '上线 v2', paraType: 'project' });
    expect(p.id).toBeTruthy();
    expect(p.paraType).toBe('project');

    const it = await me.interests.capture({ title: '想学帆板', attention: 2, sourceType: 'thought' });
    expect(it.id).toBeTruthy();
    expect(typeof it.retentionIndex).toBe('number');
  });
});
