// S1（A02/A07）：弱/占位 JWT 密钥检测回归测试。
// 覆盖 isWeakJwtSecret 启发式与 resolveJwtSecret 的 fail-closed 行为。
/// <reference types="vitest" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isWeakJwtSecret, resolveJwtSecret } from '../auth';

// 一个足够强、长度足够、字符多样、熵高的密钥（模拟 openssl rand -base64 48）
const STRONG = 'k7Vn2mQpXr4tLw8JhYc6bFg3sD1aZ0eU9oWi5NkTqR6uPv2'; // 长度 48

describe('S1 弱 JWT 密钥检测', () => {
  it('长度不足 32 位判为弱', () => {
    expect(isWeakJwtSecret('short-key').weak).toBe(true);
  });

  it('命中占位/弱词模式（CHANGE_ME / secret / password / test / 123 等）判为弱', () => {
    expect(isWeakJwtSecret('CHANGE_ME_please').weak).toBe(true);
    expect(isWeakJwtSecret('my-super-secret').weak).toBe(true);
    expect(isWeakJwtSecret('password123').weak).toBe(true);
    expect(isWeakJwtSecret('test-key-123').weak).toBe(true);
    expect(isWeakJwtSecret('changeMe-now').weak).toBe(true);
  });

  it('字符多样性不足（如全同字符）判为弱', () => {
    // 长度 48 但去重字符数=1 → 低熵/低多样性
    expect(isWeakJwtSecret('a'.repeat(48)).weak).toBe(true);
  });

  it('长度足够且高熵的密钥判为强', () => {
    const r = isWeakJwtSecret(STRONG);
    expect(r.weak).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it('生产环境命中弱密钥 → resolveJwtSecret fail-closed 抛错', () => {
    vi.stubEnv('JWT_SECRET', 'secret');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET|强度不足|拒绝启动/);
  });

  it('生产环境使用强密钥 → 正常返回', () => {
    vi.stubEnv('JWT_SECRET', STRONG);
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveJwtSecret()).toBe(STRONG);
  });

  it('生产环境缺失 JWT_SECRET → 抛错（杜绝默认弱密钥裸奔）', () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => resolveJwtSecret()).toThrow(/缺少环境变量 JWT_SECRET|拒绝启动/);
  });

  it('非生产环境弱密钥不抛错（仅告警），保持本地链路可用', () => {
    vi.stubEnv('JWT_SECRET', 'secret');
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => resolveJwtSecret()).not.toThrow();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  // 默认回到非生产，避免污染
  vi.stubEnv('NODE_ENV', 'test');
});
