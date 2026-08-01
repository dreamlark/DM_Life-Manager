// S2（A01）：system.setCustomDataDir 越权加固回归测试。
// - 仅「共享家庭」的 owner/admin 可改全局数据目录；个人模式用户（仅有 personal family）应被拒。
// - 即便有权限，目标目录也必须位于允许的基目录（PGLITE_DIR 或 PGLITE_DIR_ALLOWED）内，否则拒绝任意落盘。
/// <reference types="vitest" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import type { AuthContext } from '../rbac';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const asUser = (userId: string) => appRouter.createCaller({ userId } as AuthContext);

// 把 os.homedir() 重定向到临时目录，避免 setCustomDataDir 写入真实用户 profile 下的 config.json
let fakeHome: string;
beforeAll(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-life-fakehome-'));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});
afterAll(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true });
  delete process.env.HOME;
  delete process.env.USERPROFILE;
});

beforeEach(async () => {
  await initDb();
  await store.reset();
});
afterAll(async () => {
  await closeDb();
});

describe('S2 setCustomDataDir 鉴权', () => {
  it('仅有个人家庭（无共享家庭权限）的用户被 FORBIDDEN', async () => {
    const u = await anon().auth.register({ email: 's2-personal@home.dev', name: 'A', password: 'secret123' });
    const dataRoot = process.env.PGLITE_DIR ?? path.join(fakeHome, '.dm-life', 'data');
    await expect(
      asUser(u.user.id).system.setCustomDataDir({ dir: path.join(dataRoot, 'sub-ok') }),
    ).rejects.toThrow(/FORBIDDEN|仅家庭所有者|仅.*管理员/);
  });

  it('共享家庭 owner 指向允许基目录内的子目录 → 成功', async () => {
    const u = await anon().auth.register({ email: 's2-owner@home.dev', name: 'A', password: 'secret123' });
    // families.create 默认创建 kind='shared' 的家庭，调用者即为 owner
    await asUser(u.user.id).families.create({ name: '共享家庭' });
    const dataRoot = process.env.PGLITE_DIR ?? path.join(fakeHome, '.dm-life', 'data');
    const allowedDir = path.join(dataRoot, 'custom-data-allowed');
    const r = await asUser(u.user.id).system.setCustomDataDir({ dir: allowedDir });
    expect(r.ok).toBe(true);
    expect(r.dir).toBe(path.resolve(allowedDir));
  });

  it('共享家庭 owner 指向允许基目录外的目录 → FORBIDDEN（防任意落盘）', async () => {
    const u = await anon().auth.register({ email: 's2-owner2@home.dev', name: 'A', password: 'secret123' });
    await asUser(u.user.id).families.create({ name: '共享家庭2' });
    // 数据根之外的路径（相对数据根为 ../...），不在白名单内
    const dataRoot = process.env.PGLITE_DIR ?? path.join(fakeHome, '.dm-life', 'data');
    const outside = path.resolve(dataRoot, '..', '..', `dm-life-outside-${Date.now()}`);
    await expect(
      asUser(u.user.id).system.setCustomDataDir({ dir: outside }),
    ).rejects.toThrow(/FORBIDDEN|不在允许的基目录/);
  });
});
