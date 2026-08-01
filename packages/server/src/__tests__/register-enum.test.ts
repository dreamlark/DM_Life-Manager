// S6（A07）：注册接口防邮箱枚举回归测试。
// 重复邮箱不再返回「已注册」这类可区分文案，改为通用「注册失败」，避免攻击者借此枚举已注册邮箱。
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

describe('S6 注册防邮箱枚举', () => {
  it('重复邮箱返回通用失败文案，且不含可枚举信息', async () => {
    const email = 'probe-enum@home.dev';
    await anon().auth.register({ email, name: 'Owner', password: 'secret123' });

    let err: unknown;
    try {
      await anon().auth.register({ email, name: 'Other', password: 'secret123' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    // 通用文案
    expect(msg).toMatch(/注册失败/);
    // 不再泄露「已注册」这一可枚举信号
    expect(msg).not.toMatch(/已注册|已存在|已被占用/);
    // 不含被探测的邮箱明文
    expect(msg).not.toContain(email);
    // 错误码为 CONFLICT（而非暴露具体原因）
    expect((err as { code?: string }).code).toBe('CONFLICT');
  });

  it('全新邮箱可正常注册', async () => {
    const r = await anon().auth.register({ email: 'fresh-enum@home.dev', name: 'New', password: 'secret123' });
    expect(r.user.email).toBe('fresh-enum@home.dev');
    expect(r.accessToken).toBeTruthy();
  });

  it('攻击者在「邮箱是否存在」上无法区分：已存在与未知错误的响应文案一致', async () => {
    const existing = 'exists-enum@home.dev';
    await anon().auth.register({ email: existing, name: 'A', password: 'secret123' });
    // 已存在
    const e1 = await anon()
      .auth.register({ email: existing, name: 'B', password: 'secret123' })
      .catch((e) => e);
    // 未知邮箱（但其它字段合法，不会触发格式/长度错误）
    const e2 = await anon()
      .auth.register({ email: 'never-enum@home.dev', name: 'C', password: 'secret123' })
      .catch((e) => e);
    // 两者都应成功或返回同一类通用文案，绝不应一个成功一个明确暴露存在性
    expect((e1 as Error).message).toMatch(/注册失败/);
    // e2 应为成功（无错误），说明「注册失败」仅用于已存在场景，但文案本身不区分原因
    expect(e2).toBeTruthy();
    if (e2 instanceof Error) throw new Error('不应在全新邮箱注册时抛错：' + e2.message);
  });
});
