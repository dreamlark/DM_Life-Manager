// S7（A04）：快照体积校验 + 导入包（bundle）表名白名单回归测试。
// - 共享快照（sharedItems / sharedFinance）受 SNAPSHOT_MAX_BYTES 体积边界约束，避免超大载荷打满内存。
// - 个人备份导入仅允许已知表名，拒绝未知键（防御写入非预期表/列）。
/// <reference types="vitest" />
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter, snapshotSchema } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import type { AuthContext } from '../rbac';

const anon = () => appRouter.createCaller({ userId: null } as AuthContext);
const asUser = (userId: string) => appRouter.createCaller({ userId } as AuthContext);

beforeEach(async () => {
  await initDb();
  await store.reset();
});
afterAll(async () => {
  await closeDb();
});

describe('S7 共享快照体积校验', () => {
  it('正常体积的快照可解析通过', () => {
    const r = snapshotSchema.safeParse({ title: '房贷', dueDay: 15 });
    expect(r.success).toBe(true);
  });

  it('超过 SNAPSHOT_MAX_BYTES（默认 256KB）的超大快照被拒', () => {
    const big = 'x'.repeat(300 * 1024); // 约 300KB，超过默认 256KB 上限
    const r = snapshotSchema.safeParse({ payload: big });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('快照体积过大'))).toBe(true);
    }
  });
});

describe('S7 个人备份导入表名白名单', () => {
  it('导入含未知表名被拒（BAD_REQUEST：未知备份表）', async () => {
    const u = await anon().auth.register({ email: 'imp-evil@home.dev', name: 'A', password: 'secret123' });
    await expect(
      asUser(u.user.id).system.importAll({ bundle: { evilTable: [{ id: 'x' }] } as unknown as Record<string, unknown[]> }),
    ).rejects.toThrow(/未知备份表/);
  });

  it('仅含已知表名的导入不会被白名单拦截', async () => {
    const u = await anon().auth.register({ email: 'imp-ok@home.dev', name: 'A', password: 'secret123' });
    // 空数组的已知表名应通过白名单校验（真正的写入由 importPersonalData 处理，非本测试关注点）
    let err: { code?: string; message?: string } | null = null;
    try {
      await asUser(u.user.id).system.importAll({ bundle: { domains: [], tasks: [] } });
    } catch (e) {
      err = e as { code?: string; message?: string };
    }
    // 不应因「未知备份表」被拒；允许其它业务层错误（如空数据），但白名单本身放行
    expect(err?.message ?? '').not.toMatch(/未知备份表/);
  });
});
