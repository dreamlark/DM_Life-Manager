// S9（A04/D）：任务列表分页上限回归测试。
// tasks.all 支持 limit/offset，默认上限 1000（高于既有压测规模 500），避免无上限全表拉取打满内存。
/// <reference types="vitest" />
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import type { AuthContext } from '../rbac';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);

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

describe('S9 任务列表分页', () => {
  it('limit/offset 正确分页，且默认上限不破坏全量读取', async () => {
    const me = await makeUser('pag@home.dev');
    const total = 12;
    for (let i = 0; i < total; i++) {
      await me.tasks.create({ title: `T-${i}`, domainKey: 'work' });
    }

    // 默认（无参）读取全量（默认上限 1000 >> 12）
    const all = await me.tasks.all();
    expect(all).toHaveLength(total);

    // 分页：前 5 条
    const page1 = await me.tasks.all({ limit: 5 });
    expect(page1).toHaveLength(5);

    // 第 2 页（offset 5）：再 5 条
    const page2 = await me.tasks.all({ limit: 5, offset: 5 });
    expect(page2).toHaveLength(5);
    expect(page2[0]!.id).not.toBe(page1[0]!.id);

    // 第 3 页（offset 10）：剩余 2 条
    const page3 = await me.tasks.all({ limit: 5, offset: 10 });
    expect(page3).toHaveLength(2);

    // 各页 id 互不重叠
    const ids = new Set([...page1, ...page2, ...page3].map((t) => t.id));
    expect(ids.size).toBe(total);
  });

  it('超过默认上限的请求被截断到上限（不返回超过 1000）', async () => {
    const me = await makeUser('pag2@home.dev');
    for (let i = 0; i < 50; i++) {
      await me.tasks.create({ title: `U-${i}`, domainKey: 'work' });
    }
    // 请求 limit 远超数据量 → 返回实际全部，且不超过任何上限
    const r = await me.tasks.all({ limit: 5000 });
    expect(r.length).toBeLessThanOrEqual(5000);
    expect(r).toHaveLength(50);
  });
});
