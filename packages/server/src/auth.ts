// M1 鉴权核心 —— 密码哈希 + JWT（access/refresh）
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { store } from './store';

/**
 * JWT 签名密钥（P0-1 安全急救）。
 *
 * - 生产环境（NODE_ENV=production）必须设置强随机 JWT_SECRET，否则**拒绝启动**，
 *   杜绝“带着默认弱密钥裸奔上 NAS”的致命风险（攻击者可用默认密钥伪造任意用户令牌）。
 * - 开发 / 测试环境未设置时，回退到一个确定性的临时密钥并明确告警，仅限本地使用。
 *   该回退密钥稳定，不破坏现有本地与单测链路。
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '缺少环境变量 JWT_SECRET：生产环境必须设置强随机密钥（例如 `openssl rand -base64 48`），' +
        '已拒绝启动以防止使用默认弱密钥。请在启动 engine/server 前通过环境变量注入 JWT_SECRET。',
    );
  }
  console.warn(
    '[auth] 警告：未设置 JWT_SECRET，使用临时开发密钥。该密钥仅适用于本地/测试，切勿在任何可被访问的环境使用。',
  );
  return 'dev-insecure-secret-do-not-use-in-production';
}

const JWT_SECRET = resolveJwtSecret();
const ACCESS_TTL = '15m';
const REFRESH_TTL_LONG_MS = 1000 * 60 * 60 * 24 * 30; // 30 天（勾选"记住我"）
const REFRESH_TTL_SHORT_MS = 1000 * 60 * 60 * 24; // 1 天（未勾选）

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function signAccess(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'access' }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

/** 解析 access token，返回 userId；失败抛错 */
export function verifyAccess(token: string): string {
  const payload = jwt.verify(token, JWT_SECRET) as { sub: string; typ?: string };
  if (payload.typ && payload.typ !== 'access') throw new Error('invalid token type');
  return payload.sub;
}

/** 登录/注册后签发双令牌，并落库 refresh session */
export async function issueSession(
  userId: string,
  rememberMe = true,
): Promise<{ accessToken: string; refreshToken: string }> {
  const ttl = rememberMe ? REFRESH_TTL_LONG_MS : REFRESH_TTL_SHORT_MS;
  const refreshToken = randomUUID();
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  await store.createSession({ userId, refreshToken, expiresAt });
  return { accessToken: signAccess(userId), refreshToken };
}

/** 用 refresh token 旋转出新的一组令牌；无效/过期则抛错 */
export async function rotateRefresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const session = await store.getSession(refreshToken);
  if (!session) throw new Error('invalid refresh token');
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await store.deleteSession(refreshToken);
    throw new Error('refresh token expired');
  }
  await store.deleteSession(refreshToken);
  return issueSession(session.userId);
}

/** 吊销单个 refresh 会话（当前设备登出） */
export async function revokeSession(refreshToken: string): Promise<void> {
  await store.deleteSession(refreshToken);
}

/** 吊销某用户的全部 refresh 会话（登出所有设备） */
export async function revokeAllSessions(userId: string): Promise<void> {
  await store.deleteSessionsByUser(userId);
}
