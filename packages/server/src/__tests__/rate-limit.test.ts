// PR-B「限流」加固的回归测试：直接验证滑动窗口核心逻辑（rateLimited）。
// 中间件仅调用该函数，故单测核心逻辑即可覆盖 register/login/refresh 三处限流。
import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimited } from '../router';

describe('限流滑动窗口（PR-B）', () => {
  // 每个用例用唯一 bucket，避免共享 rateBuckets 互相污染
  const bucket = () => `rl:test:${Math.random().toString(36).slice(2)}`;

  it('未超阈值放行，达到阈值即拒绝', () => {
    const b = bucket();
    const limit = 3;
    const windowMs = 60_000;
    expect(rateLimited(b, limit, windowMs)).toBe(false); // 第 1 次
    expect(rateLimited(b, limit, windowMs)).toBe(false); // 第 2 次
    expect(rateLimited(b, limit, windowMs)).toBe(false); // 第 3 次
    expect(rateLimited(b, limit, windowMs)).toBe(true); // 第 4 次 → 限流
  });

  it('窗口外的旧请求不计入当前窗口', () => {
    const b = bucket();
    const limit = 2;
    const windowMs = 50;
    expect(rateLimited(b, limit, windowMs)).toBe(false);
    expect(rateLimited(b, limit, windowMs)).toBe(false);
    expect(rateLimited(b, limit, windowMs)).toBe(true); // 立即第 3 次 → 限流
    // 等待窗口过去后，计数已清空，重新放行
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(rateLimited(b, limit, windowMs)).toBe(false);
        resolve();
      }, 70);
    });
  });
});
