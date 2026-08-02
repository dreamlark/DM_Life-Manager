// S5（A09/R）安全审计日志 —— 结构化输出关键安全事件（登录成败、登出、改密/角色/所有权、注销等）。
// 设计原则：绝不记录密码 / 令牌 / 明文凭据；detail 字段经 log-sanitize 脱敏后再落盘。
import { redactObject } from './log-sanitize';

export type SecurityAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login.fail'
  | 'auth.refresh'
  | 'auth.logout'
  | 'auth.logoutAll'
  | 'account.delete'
  | 'role.update'
  | 'ownership.transfer'
  | 'family.disband';

export interface SecurityEventMeta {
  userId?: string;
  ip?: string;
  result: 'success' | 'failure';
  /** 任意附加信息；含敏感键（password/token/secret…）会被自动脱敏 */
  detail?: Record<string, unknown>;
}

/** 输出一条结构化安全事件到 stdout（便于集中采集 / SIEM 接入）。 */
export function logSecurityEvent(action: SecurityAction, meta: SecurityEventMeta): void {
  const entry = {
    ts: new Date().toISOString(),
    action,
    actor: meta.userId ?? 'anonymous',
    ip: meta.ip ?? null,
    result: meta.result,
    // 脱敏：detail 中可能意外包含敏感字段（如邮箱），统一走脱敏，绝不记密码/token
    detail: meta.detail ? redactObject(meta.detail) : undefined,
  };
  // 单行 JSON，便于日志系统解析；用 console.log 而非 error，避免污染错误栈
  console.log('[audit] ' + JSON.stringify(entry));
}
