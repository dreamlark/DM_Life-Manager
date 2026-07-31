import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, dbPath } from '../db/client';
import { migrate } from '../db/migrate';
import { appRouter } from '../router/appRouter';
import fs from 'node:fs';

/**
 * 进程内路由冒烟：notes.list + insights.pressure 两个 P1 新增表面。
 * 绕过 HTTP / 沙箱网络，直接 createCaller 验证。
 */
describe('notes & pressure 路由冒烟（进程内 createCaller）', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
    await initDb();
    migrate();
  });

  it('notes：摄入 → 列表倒序且 links/tags 正确解析', async () => {
    const caller = appRouter.createCaller({});

    await caller.notes.ingest({
      title: '第一条灵感',
      bodyMarkdown: '关于压力背包的设想',
      tags: ['idea', 'p1'],
      links: ['https://example.com/a'],
    });
    await caller.notes.ingest({
      title: '第二条灵感',
      bodyMarkdown: '补充细节',
      tags: ['follow-up'],
      links: [],
    });

    const list = await caller.notes.list();
    expect(list.length).toBe(2);
    // 倒序：第二条在前
    expect(list[0].title).toBe('第二条灵感');
    expect(list[1].title).toBe('第一条灵感');
    // JSON 字段解析
    expect(list[1].tags).toEqual(['idea', 'p1']);
    expect(list[1].links).toEqual(['https://example.com/a']);
  });

  it('pressure：结构正确、score 收敛在 0-100', async () => {
    const caller = appRouter.createCaller({});
    const p = await caller.insights.pressure();
    expect(p).toHaveProperty('score');
    expect(p).toHaveProperty('level');
    expect(p).toHaveProperty('breakdown');
    expect(p.score).toBeGreaterThanOrEqual(0);
    expect(p.score).toBeLessThanOrEqual(100);
    // 当前测试库无逾期/债务数据 → 应为 calm 且全 0
    expect(p.level).toBe('calm');
    expect(p.breakdown.overdueReminders).toBe(0);
    expect(p.breakdown.overdueTasks).toBe(0);
    expect(p.breakdown.activeDebts).toBe(0);
  });
});
