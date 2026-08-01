// S5（A09/R）：安全审计日志回归测试。
// 校验：结构化单行 JSON 输出、敏感字段（password/token）脱敏、关键字段齐全。
/// <reference types="vitest" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logSecurityEvent } from '../audit';

describe('S5 安全审计日志', () => {
  it('输出为单行 JSON，且含 action / actor / result 字段', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      logSecurityEvent('auth.login', { userId: 'u-1', ip: '1.2.3.4', result: 'success' });
      expect(spy).toHaveBeenCalledTimes(1);
      const raw = spy.mock.calls[0]![0] as string;
      expect(raw.startsWith('[audit] ')).toBe(true);
      // 单行（无换行）
      expect(raw.includes('\n')).toBe(false);
      const parsed = JSON.parse(raw.slice('[audit] '.length));
      expect(parsed.action).toBe('auth.login');
      expect(parsed.actor).toBe('u-1');
      expect(parsed.ip).toBe('1.2.3.4');
      expect(parsed.result).toBe('success');
      expect(typeof parsed.ts).toBe('string');
    } finally {
      spy.mockRestore();
    }
  });

  it('detail 中的密码 / 令牌被脱敏为 ***', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      logSecurityEvent('auth.register', {
        userId: 'u-2',
        result: 'success',
        detail: { password: 'hunter2', token: 'abc.def.ghi', email: 'a@home.dev' },
      });
      const raw = spy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(raw.slice('[audit] '.length));
      expect(parsed.detail.password).toBe('***');
      expect(parsed.detail.token).toBe('***');
      // 整条日志中绝不出现明文密码
      expect(raw).not.toContain('hunter2');
      expect(raw).not.toContain('abc.def.ghi');
    } finally {
      spy.mockRestore();
    }
  });

  it('未登录调用方记为 anonymous', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      logSecurityEvent('auth.login.fail', { ip: '9.9.9.9', result: 'failure', detail: { reason: 'invalid' } });
      const parsed = JSON.parse((spy.mock.calls[0]![0] as string).slice('[audit] '.length));
      expect(parsed.actor).toBe('anonymous');
      expect(parsed.detail.reason).toBe('invalid');
    } finally {
      spy.mockRestore();
    }
  });
});
