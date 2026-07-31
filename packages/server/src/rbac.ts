// M1 RBAC —— 角色权限矩阵 + 上下文解析 + 保护工具
import { TRPCError } from '@trpc/server';
import { store } from './store';
import type { Role, Membership } from './types';

export type Permission =
  | 'viewShared' // 查看共享内容（日历/任务/笔记/相册）
  | 'createTask' // 创建/认领任务
  | 'editTask' // 编辑任意任务
  | 'createEvent' // 创建日历事件
  | 'editEvent' // 编辑任意日历事件
  | 'manageMembers' // 邀请/移除成员、改角色
  | 'viewFinance' // 查看家庭账本
  | 'manageFinance' // 编辑账本/预算
  | 'manageShared' // 推送/管理个人模块共享快照（提醒/记事/脑图/心流/领域…）
  | 'manageFamily'; // 解散/转让家庭

// 权限矩阵：儿童视角刻意收窄（无财务可见、不可管成员、仅可创建不可改他人日历/任务）
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['viewShared', 'createTask', 'editTask', 'createEvent', 'editEvent', 'manageMembers', 'viewFinance', 'manageFinance', 'manageShared', 'manageFamily'],
  admin: ['viewShared', 'createTask', 'editTask', 'createEvent', 'editEvent', 'manageMembers', 'viewFinance', 'manageFinance', 'manageShared'],
  member: ['viewShared', 'createTask', 'editTask', 'createEvent', 'editEvent', 'viewFinance', 'manageShared'],
  child: ['viewShared', 'createTask', 'createEvent'],
  guest: ['viewShared'],
};

export function rolePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}
export function isChild(role: Role): boolean {
  return role === 'child';
}

export interface AuthContext {
  userId: string | null;
  /** 客户端 IP（来自 x-forwarded-for 或 socket），用于限流等，不用于鉴权判定 */
  ip?: string;
}

export async function getMembership(ctx: AuthContext, familyId: string): Promise<Membership | undefined> {
  if (!ctx.userId) return undefined;
  return store.getMembership(familyId, ctx.userId);
}

/** 必须是该家庭成员，否则 FORBIDDEN */
export async function requireMembership(ctx: AuthContext, familyId: string): Promise<Membership> {
  const m = await getMembership(ctx, familyId);
  if (!m) throw new TRPCError({ code: 'FORBIDDEN', message: '你不是该家庭成员' });
  return m;
}

/** 必须是成员且具备指定权限，否则 FORBIDDEN */
export async function requirePermission(ctx: AuthContext, familyId: string, perm: Permission): Promise<Membership> {
  const m = await requireMembership(ctx, familyId);
  if (!ROLE_PERMISSIONS[m.role].includes(perm)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `角色 ${m.role} 无权执行此操作（需要权限 ${perm}）`,
    });
  }
  return m;
}

/**
 * P1（B）：受信任编辑者校验。复用 requireMembership 语义 —— 调用者必须是该 zone 所属家庭的成员，
 * 才被允许写入「公开/共享」行（私区 owner 校验由 store.resolveZone 在 SQL 层兜底）。
 * 可选传入 perm 以进一步要求具体编辑权限（如 manageShared / manageFinance）。
 */
export async function requireTrustedEditor(
  ctx: AuthContext,
  familyId: string,
  perm?: Permission,
): Promise<Membership> {
  return perm ? requirePermission(ctx, familyId, perm) : requireMembership(ctx, familyId);
}
