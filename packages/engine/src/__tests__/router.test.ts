import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, dbPath } from '../db/client';
import { migrate } from '../db/migrate';
import { appRouter } from '../router/appRouter';
import fs from 'node:fs';

/**
 * 进程内路由冒烟测试：用 tRPC 的 createCaller 直接调用 appRouter，
 * 完全绕过 HTTP / 网络沙箱，验证「reminders 路由已正确挂载且端到端可用」。
 */
describe('tRPC 路由层冒烟（进程内 createCaller）', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
    await initDb();
    migrate();
  });

  it('reminders 全链路：建钟 → 列表 → 完成自动上发条 → tick 响铃', async () => {
    const caller = appRouter.createCaller({});

    const created = await caller.reminders.create({
      title: '路由测试钟',
      domainKey: 'work',
      periodRule: '每3个月',
      leadChain: [7, 1, 0],
      nextFireAt: new Date(Date.now() + 5 * 86400000).toISOString(),
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('active');

    const list = await caller.reminders.list();
    expect(list.some((c) => c.id === created.id)).toBe(true);

    const completed = await caller.reminders.complete({ id: created.id });
    expect(completed.status).toBe('active');
    expect(new Date(completed.nextFireAt).getTime()).toBeGreaterThan(Date.now());

    // tick 不应抛错（无到期钟，fired/overdue 应为空数组）
    const tick = await caller.reminders.tick();
    expect(Array.isArray(tick.fired)).toBe(true);
    expect(Array.isArray(tick.overdue)).toBe(true);
  });

  it('upcoming 仅返回未来 30 天内的钟', async () => {
    const caller = appRouter.createCaller({});
    const up = await caller.reminders.upcoming();
    const horizon = Date.now() + 30 * 86400000;
    for (const c of up) {
      expect(new Date(c.nextFireAt).getTime()).toBeLessThanOrEqual(horizon);
    }
  });

  it('跨模块回归：finance / tasks / domains 路由仍可调用', async () => {
    const caller = appRouter.createCaller({});
    expect(Array.isArray(await caller.finance.debts.list())).toBe(true);
    expect(Array.isArray(await caller.tasks.today())).toBe(true);
    expect(Array.isArray(await caller.domains.list())).toBe(true);
  });

  it('system 路由挂载：dataStatus / exportAll 可经 createCaller 调用', async () => {
    const caller = appRouter.createCaller({});
    const status = await caller.system.dataStatus();
    expect(status.schemaVersion).toBe(1);
    expect(status.appVersion).toBeTruthy();
    const bundle = await caller.system.exportAll();
    expect(bundle.format).toBe('dm-life-export');
    expect(typeof bundle.tables).toBe('object');
  });
});
