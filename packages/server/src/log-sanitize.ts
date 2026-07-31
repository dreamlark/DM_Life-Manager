// P2-13：日志脱敏工具 —— 避免把密码 / 邮箱 / token / 数据库凭据等敏感值写入日志。
// 服务端错误日志（tRPC handler error、DB 初始化失败等）可能携带请求体（含 password/email）
// 或含凭据的连接串，直接 console.error(e) 会把这些明文落盘到 stdout/日志系统。

/** 命中即整值替换为 *** 的敏感字段名（忽略大小写）。 */
const SENSITIVE_KEY_RE =
  /^(password|passwd|pwd|token|secret|apikey|api_key|authorization|authorisation|cookie|refreshtoken|accesstoken|privatekey|salt|hash|received)$/i;

/** 连接串中的 user:pass@ → user:***@ */
const URL_CREDS_RE = /(:\/\/[^:/?#]+:)([^@\s]+)(@)/g;

function redactString(s: string): string {
  return s.replace(URL_CREDS_RE, '$1***$3');
}

function redactValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    if (SENSITIVE_KEY_RE.test(key)) return '***';
    return redactString(value);
  }
  if (value && typeof value === 'object') return redactObject(value as Record<string, unknown>);
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, v);
  }
  return out;
}

/**
 * 把任意错误对象转成「诊断够用、敏感值已脱敏」的纯对象：
 * 仅保留 message / name / code，cause 与 ZodError.issues 递归脱敏。
 */
export function sanitizeError(e: unknown): unknown {
  if (e == null) return e;
  if (typeof e === 'string') return redactString(e);
  if (e instanceof Error) {
    const base: Record<string, unknown> = {
      name: e.name,
      message: redactString(e.message),
      code: (e as { code?: unknown }).code,
    };
    const cause = (e as { cause?: unknown }).cause;
    if (cause !== undefined) base.cause = sanitizeError(cause);
    const issues = (e as { issues?: Record<string, unknown> }).issues;
    if (Array.isArray(issues)) base.issues = issues.map((it) => redactObject(it as Record<string, unknown>));
    return base;
  }
  if (typeof e === 'object') return redactObject(e as Record<string, unknown>);
  return e;
}
