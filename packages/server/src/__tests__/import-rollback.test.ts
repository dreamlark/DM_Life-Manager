// 导入原子性测试（对应 F1 修复）：importPersonalData 必须包在单一事务内，
// 任一表插入失败则整体回滚——原始数据完好、无部分泄漏。
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

describe('importPersonalData 原子性（F1 修复）', () => {
  it('中途失败整包回滚：原数据完好、无部分泄漏', async () => {
    const u = await anon().auth.register({ email: 'imp-a@home.dev', name: 'A', password: 'secret1' });
    const me = asUser(u.user.id);
    const familyId = await store.getPersonalFamilyId(u.user.id);

    // 导入前已有数据
    await me.tasks.create({ title: 'PRE-EXISTING', domainKey: 'work', taskDate: DATE });

    const bundle = {
      // 合法任务行（应能被插入）
      tasks: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          ownerId: u.user.id,
          title: 'BUNDLE-TASK',
          domainKey: 'work',
          status: 'todo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      // 故意非法：creditor 缺失（NOT NULL）→ 插入抛错，触发整体回滚
      debts: [{}],
    };

    // 应抛错
    await expect(store.importPersonalData(familyId, bundle as Record<string, any[]>)).rejects.toBeTruthy();

    // 回滚后：原有数据完好
    const afterToday = await me.tasks.today({ date: DATE });
    const titles = afterToday.map((t) => t.title);
    expect(titles).toContain('PRE-EXISTING');
    // 部分插入被回滚，bundle 的任务不应残留
    expect(titles).not.toContain('BUNDLE-TASK');
  });

  it('合法整包导入成功且计数正确', async () => {
    const u = await anon().auth.register({ email: 'imp-b@home.dev', name: 'B', password: 'secret1' });
    const familyId = await store.getPersonalFamilyId(u.user.id);
    const bundle = {
      tasks: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          ownerId: u.user.id,
          title: 'GOOD-TASK',
          domainKey: 'work',
          status: 'todo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    const res = await store.importPersonalData(familyId, bundle as Record<string, any[]>);
    expect(res.tasks).toBe(1);
    const me = asUser(u.user.id);
    const today = await me.tasks.today({ date: DATE });
    expect(today.map((t) => t.title)).toContain('GOOD-TASK');
  });
});
