// M2.1 tRPC router —— auth + families 全套，含 RBAC 保护（store 已切换为 Drizzle 异步仓库）
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { store } from './store';
import {
  hashPassword,
  verifyPassword,
  issueSession,
  rotateRefresh,
  verifyAccess,
  revokeSession,
  revokeAllSessions,
} from './auth';
import { requirePermission, requireMembership, type AuthContext } from './rbac';
import { publishEvent } from './realtime/eventBus';
import { closeUserSessions } from './realtime/hub';
import { router, authedProcedure, publicProcedure, t } from './trpc';
import { personalRouters } from './personal';
import * as audit from './audit';
import type { Role, PublicUser, SharedItemModule } from './types';

/* ----------------------------- P1-5 登录限流 -----------------------------
 * 进程内滑动窗口限流，按客户端 IP 计费，用于遏制针对登录/注册/刷新接口的
 * 暴力破解与枚举。阈值通过环境变量可配，默认偏宽松以免误伤正常多用户 NAS。
 * 注意：这是应用层兜底；生产仍建议配合 Caddy/网关层限流。
 */
const RATE_CONFIG = {
  login: { limit: Number(process.env.RATE_LOGIN_LIMIT ?? 20), windowMs: 10 * 60 * 1000 },
  register: { limit: Number(process.env.RATE_REGISTER_LIMIT ?? 10), windowMs: 10 * 60 * 1000 },
  refresh: { limit: Number(process.env.RATE_REFRESH_LIMIT ?? 60), windowMs: 10 * 60 * 1000 },
};
const rateBuckets = new Map<string, { hits: number[]; windowMs: number }>();
export function rateLimited(bucket: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateBuckets.get(bucket)?.hits ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    rateBuckets.set(bucket, { hits, windowMs });
    return true;
  }
  hits.push(now);
  rateBuckets.set(bucket, { hits, windowMs });
  return false;
}

/**
 * 清理所有命中均已过期的限流桶：分布式爆破会制造大量独立客户端 IP 桶，
 * 若不清理，rateBuckets 将随独立客户端数无限增长，构成内存泄漏 / 间接 DoS 向量。
 * 由下方定时器周期性调用；__sweepRateBuckets 暴露给测试与运维探针验证。
 */
function sweepRateBuckets(): number {
  const now = Date.now();
  let removed = 0;
  for (const [k, v] of rateBuckets) {
    if (!v.hits.some((t) => now - t < v.windowMs)) {
      rateBuckets.delete(k);
      removed++;
    }
  }
  return removed;
}
const RATE_SWEEP_MS = Number(process.env.RATE_SWEEP_MS ?? 5 * 60 * 1000);
const rateSweepTimer = setInterval(sweepRateBuckets, RATE_SWEEP_MS);
// 不阻止进程退出（测试 / 短生命周期场景）
if (typeof rateSweepTimer.unref === 'function') rateSweepTimer.unref();

/** 测试 / 运维探针：当前限流桶数量 */
export function __rateBucketCount(): number {
  return rateBuckets.size;
}
/** 测试 / 运维探针：立即执行一次限流桶清理，返回清理数量 */
export function __sweepRateBuckets(): number {
  return sweepRateBuckets();
}
function rateLimitMiddleware(kind: keyof typeof RATE_CONFIG) {
  const cfg = RATE_CONFIG[kind];
  return t.middleware(({ ctx, next }) => {
    const ip = ctx.ip;
    let bucket: string;
    let effLimit = cfg.limit;
    if (ip) {
      bucket = `rl:${kind}:${ip}`;
    } else {
      // S12（A07/D）：IP 未知（socket.remoteAddress 缺失）时不退化为可被轻易绕过的单共享桶，
      // 改为落入最严格全局桶，并施加远低于常规的硬性上限，避免匿名流量绕过限流。
      bucket = `rl:${kind}:__strict_unknown__`;
      const unknownLimit = Number(process.env.RATE_UNKNOWN_LIMIT ?? 5);
      effLimit = Math.min(cfg.limit, unknownLimit);
    }
    if (rateLimited(bucket, effLimit, cfg.windowMs)) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: '尝试过于频繁，请稍后再试' });
    }
    return next();
  });
}

const emailSchema = z.string().email('邮箱格式不正确');
// S4（A07）：口令最小长度 6 → 8
const passwordSchema = z.string().min(8, '密码至少 8 位');
const roleSchema = z.enum(['owner', 'admin', 'member', 'child', 'guest'] as const);

// S7（A04）：快照结构化校验——限制为可 JSON 序列化值且单值体积受控，避免超大载荷打满内存（DoS）。
// 共享快照为各模块异构结构，不强行规定字段形状（会破坏既有客户端），仅做序列化 + 体积边界校验。
const SNAPSHOT_MAX_BYTES = Number(process.env.SNAPSHOT_MAX_BYTES ?? 256 * 1024);
export const snapshotSchema = z.unknown().superRefine((val, ctx) => {
  const s = JSON.stringify(val);
  if (s === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '快照不能为空' });
    return;
  }
  if (s.length > SNAPSHOT_MAX_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '快照体积过大' });
  }
});

function toPublic(u: { id: string; email: string; name: string }): PublicUser {
  return { id: u.id, email: u.email, name: u.name };
}

export const appRouter = router({
  auth: router({
    register: publicProcedure
      .use(rateLimitMiddleware('register'))
      .input(z.object({ email: emailSchema, name: z.string().min(1, '请填写昵称').max(200, '昵称过长'), password: passwordSchema, rememberMe: z.boolean().optional().default(true) }))
      .mutation(async ({ ctx, input }) => {
        // S6（A07）：不区分「邮箱已存在 / 其它错误」，避免攻击者借此枚举已注册邮箱
        if (await store.getUserByEmail(input.email)) {
          throw new TRPCError({ code: 'CONFLICT', message: '注册失败，请稍后再试' });
        }
        const passwordHash = await hashPassword(input.password);
        const user = await store.createUser({ email: input.email, name: input.name, passwordHash });
        // 注册即创建个人家庭，保证首次进入即有看板归属（与前端「注册即创建你自己的家庭」一致）
        const family = await store.createFamily({ name: `${input.name}的家庭`, ownerId: user.id, kind: 'personal' });
        await store.addMembership({ familyId: family.id, userId: user.id, role: 'owner' });
        const tokens = await issueSession(user.id, input.rememberMe);
        audit.logSecurityEvent('auth.register', { userId: user.id, ip: ctx.ip, result: 'success' });
        return { user: toPublic(user), ...tokens };
      }),

    login: publicProcedure
      .use(rateLimitMiddleware('login'))
      .input(z.object({ email: emailSchema, password: z.string().min(1), rememberMe: z.boolean().optional().default(true) }))
      .mutation(async ({ ctx, input }) => {
        const user = await store.getUserByEmail(input.email);
        if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
          audit.logSecurityEvent('auth.login.fail', { ip: ctx.ip, result: 'failure', detail: { reason: 'invalid_credentials' } });
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '邮箱或密码错误' });
        }
        const tokens = await issueSession(user.id, input.rememberMe);
        audit.logSecurityEvent('auth.login', { userId: user.id, ip: ctx.ip, result: 'success' });
        return { user: toPublic(user), ...tokens };
      }),

    refresh: publicProcedure
      .use(rateLimitMiddleware('refresh'))
      .input(z.object({ refreshToken: z.string().min(1) }))
      .mutation(async ({ input }) => {
        try {
          const r = await rotateRefresh(input.refreshToken);
          audit.logSecurityEvent('auth.refresh', { result: 'success' });
          return r;
        } catch {
          audit.logSecurityEvent('auth.refresh', { result: 'failure', detail: { reason: 'invalid_or_expired' } });
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '刷新令牌无效或已过期' });
        }
      }),

    me: authedProcedure.query(async ({ ctx }) => {
      const user = await store.getUserById(ctx.userId);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
      return toPublic(user);
    }),

    /** 会话吊销（P1-4）：吊销当前 refresh 会话（传 refreshToken）或该用户全部会话（不传）。
     *  用于“退出登录 / 登出所有设备”，避免令牌在本地清除后仍可被复用。 */
    logout: authedProcedure
      .input(z.object({ refreshToken: z.string().min(1).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (input.refreshToken) {
          // 单设备登出：仅吊销该 refresh 会话；其余设备会话与其 WebSocket 保持不变。
          await revokeSession(input.refreshToken);
        } else {
          // 吊销全部 refresh 会话时，同步关闭该用户的全部实时连接，
          // 避免已登出用户仍显示“在线”或继续收到实时广播。
          await revokeAllSessions(ctx.userId);
          closeUserSessions(ctx.userId);
        }
        audit.logSecurityEvent('auth.logout', { userId: ctx.userId, ip: ctx.ip, result: 'success' });
        return { ok: true };
      }),

    /** 登出所有设备：吊销该用户的全部 refresh 会话并关闭其实时连接 */
    logoutAll: authedProcedure.mutation(async ({ ctx }) => {
      await revokeAllSessions(ctx.userId);
      closeUserSessions(ctx.userId);
      audit.logSecurityEvent('auth.logoutAll', { userId: ctx.userId, ip: ctx.ip, result: 'success' });
      return { ok: true };
    }),

    /** 注销账户：级联删除该用户的个人家庭、全部个人数据、成员关系与用户本身（见 store.deleteUserAccount）。
     *  不可逆；客户端应在二次确认后再调用，并在成功后清理本地令牌回到登录页。 */
    deleteAccount: authedProcedure.mutation(async ({ ctx }) => {
      await store.deleteUserAccount(ctx.userId);
      closeUserSessions(ctx.userId);
      audit.logSecurityEvent('account.delete', { userId: ctx.userId, ip: ctx.ip, result: 'success' });
      return { ok: true };
    }),
  }),

  families: router({
    create: authedProcedure
      .input(z.object({ name: z.string().min(1, '请填写家庭名称').max(100, '家庭名称过长') }))
      .mutation(async ({ ctx, input }) => {
        const family = await store.createFamily({ name: input.name, ownerId: ctx.userId, kind: 'shared' });
        await store.addMembership({ familyId: family.id, userId: ctx.userId, role: 'owner' });
        publishEvent({ kind: 'family.created', familyId: family.id, actorId: ctx.userId });
        return family;
      }),

    invite: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          role: roleSchema.refine((r) => r !== 'owner', '邀请角色不能为 owner'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageMembers');
        const token = randomUUID();
        const inv = await store.createInvitation({
          familyId: input.familyId,
          token,
          role: input.role,
          createdBy: ctx.userId,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(), // 7 天
        });
        publishEvent({ kind: 'invitation.created', familyId: input.familyId, role: input.role, actorId: ctx.userId });
        return { token: inv.token, role: inv.role, expiresAt: inv.expiresAt };
      }),

    acceptInvite: authedProcedure
      .input(z.object({ token: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const inv = await store.getInvitation(input.token);
        if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: '邀请无效' });
        if (new Date(inv.expiresAt).getTime() < Date.now()) {
          await store.deleteInvitation(input.token);
          throw new TRPCError({ code: 'BAD_REQUEST', message: '邀请已过期' });
        }
        if (await store.getMembership(inv.familyId, ctx.userId)) {
          throw new TRPCError({ code: 'CONFLICT', message: '你已是该家庭成员' });
        }
        const m = await store.addMembership({ familyId: inv.familyId, userId: ctx.userId, role: inv.role });
        await store.deleteInvitation(input.token);
        publishEvent({ kind: 'member.joined', familyId: inv.familyId, userId: ctx.userId, role: m.role, actorId: ctx.userId });
        return { familyId: inv.familyId, role: m.role };
      }),

    members: authedProcedure
      .input(z.object({ familyId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const viewer = await requireMembership(ctx, input.familyId); // 任何成员均可查看家庭成员
        // 隐私：仅 owner/admin 可见成员邮箱，避免 guest/child 等看到全部成员邮箱
        const canSeeEmail = viewer.role === 'owner' || viewer.role === 'admin';
        const maskEmail = (e?: string): string => {
          if (!e) return '';
          const at = e.indexOf('@');
          if (at <= 0) return '***';
          return `${e.charAt(0)}***@${e.slice(at + 1)}`;
        };
        const ms = await store.getMembershipsByFamily(input.familyId);
        return Promise.all(
          ms.map(async (m) => {
            const u = await store.getUserById(m.userId);
            return {
              userId: m.userId,
              name: u?.name ?? '',
              email: canSeeEmail ? (u?.email ?? '') : maskEmail(u?.email),
              role: m.role,
              joinedAt: m.joinedAt,
            };
          }),
        );
      }),

    leave: authedProcedure
      .input(z.object({ familyId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const m = await requireMembership(ctx, input.familyId);
        if (m.role === 'owner') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '家庭所有者不能直接离开，请先转让或解散' });
        }
        await store.removeMembership(m.id);
        publishEvent({ kind: 'member.left', familyId: input.familyId, userId: ctx.userId, actorId: ctx.userId });
        return { ok: true };
      }),

    /** 列出当前用户所属的全部家庭（含角色），供前端「家庭切换」使用 */
    list: authedProcedure.query(async ({ ctx }) => {
      const ms = await store.getMembershipsByUser(ctx.userId);
      const families = await Promise.all(
        ms.map(async (m) => {
          const f = await store.getFamily(m.familyId);
          return f ? { id: f.id, name: f.name, ownerId: f.ownerId, role: m.role } : null;
        }),
      );
      return families.filter((f): f is { id: string; name: string; ownerId: string; role: Role } => f !== null);
    }),

    removeMember: authedProcedure
      .input(z.object({ familyId: z.string().min(1), userId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageMembers');
        const target = await store.getMembership(input.familyId, input.userId);
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '该成员不存在' });
        if (target.role === 'owner') throw new TRPCError({ code: 'BAD_REQUEST', message: '所有者不可被移除' });
        if (target.userId === ctx.userId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '不能移除自己，请使用「退出家庭」' });
        }
        await store.removeMembership(target.id);
        publishEvent({ kind: 'member.removed', familyId: input.familyId, userId: input.userId, actorId: ctx.userId });
        return { ok: true };
      }),

    updateRole: authedProcedure
      .input(z.object({ familyId: z.string().min(1), userId: z.string().min(1), role: roleSchema }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageMembers');
        if (input.role === 'owner' || input.role === 'guest') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '不能手动设为 owner 或 guest（owner 用转让，guest 仅限邀请）' });
        }
        const target = await store.getMembership(input.familyId, input.userId);
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '该成员不存在' });
        if (target.role === 'owner') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '所有者角色不可改，请使用转让' });
        }
        const m = await store.updateMembershipRole(target.id, input.role);
        publishEvent({ kind: 'role.updated', familyId: input.familyId, userId: input.userId, role: m.role, actorId: ctx.userId });
        audit.logSecurityEvent('role.update', { userId: ctx.userId, ip: ctx.ip, result: 'success', detail: { targetUserId: input.userId, role: input.role } });
        return { role: m.role };
      }),

    transferOwnership: authedProcedure
      .input(z.object({ familyId: z.string().min(1), userId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageFamily');
        const target = await store.getMembership(input.familyId, input.userId);
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '目标成员不存在' });
        if (target.role === 'owner') throw new TRPCError({ code: 'BAD_REQUEST', message: '该成员已是所有者' });
        const me = await store.getMembership(input.familyId, ctx.userId);
        if (!me) throw new TRPCError({ code: 'NOT_FOUND', message: '你不是该家庭成员' });
        // 目标升为 owner，自己降为 admin —— 保证家庭始终有且仅有一个 owner
        await store.updateMembershipRole(target.id, 'owner');
        await store.updateMembershipRole(me.id, 'admin');
        publishEvent({ kind: 'ownership.transferred', familyId: input.familyId, from: ctx.userId, to: input.userId, actorId: ctx.userId });
        audit.logSecurityEvent('ownership.transfer', { userId: ctx.userId, ip: ctx.ip, result: 'success', detail: { from: ctx.userId, to: input.userId } });
        return { ok: true };
      }),
  }),

  // ===== 共享日历（家庭共享日程） =====
  calendarEvents: router({
    list: authedProcedure
      .input(z.object({ familyId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        await requireMembership(ctx, input.familyId);
        return store.listCalendarEvents(input.familyId);
      }),

    create: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          title: z.string().min(1, '请填写事件标题'),
          description: z.string().optional(),
          location: z.string().optional(),
          startAt: z.string().min(1, '请选择开始时间'),
          endAt: z.string().optional(),
          allDay: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'createEvent');
        const ev = await store.createCalendarEvent({
          familyId: input.familyId,
          title: input.title,
          description: input.description ?? null,
          location: input.location ?? null,
          startAt: input.startAt,
          endAt: input.endAt ?? null,
          allDay: input.allDay ?? false,
          createdBy: ctx.userId,
        });
        publishEvent({ kind: 'calendar.created', familyId: input.familyId, eventId: ev.id, actorId: ctx.userId });
        return ev;
      }),

    update: authedProcedure
      .input(
        z.object({
          eventId: z.string().min(1),
          title: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          location: z.string().nullable().optional(),
          startAt: z.string().min(1).optional(),
          endAt: z.string().nullable().optional(),
          allDay: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const ev = await store.getCalendarEvent(input.eventId);
        if (!ev) throw new TRPCError({ code: 'NOT_FOUND', message: '日历事件不存在' });
        // 任何编辑都要求仍是该家庭成员（与 remove 一致）；创建人豁免 editEvent 权限，但仍须是成员
        await requireMembership(ctx, ev.familyId);
        if (ev.createdBy !== ctx.userId) {
          await requirePermission(ctx, ev.familyId, 'editEvent');
        }
        const patch: Parameters<typeof store.updateCalendarEvent>[1] = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined) patch.description = input.description;
        if (input.location !== undefined) patch.location = input.location;
        if (input.startAt !== undefined) patch.startAt = input.startAt;
        if (input.endAt !== undefined) patch.endAt = input.endAt;
        if (input.allDay !== undefined) patch.allDay = input.allDay;
        const updated = await store.updateCalendarEvent(ev.id, patch);
        publishEvent({ kind: 'calendar.updated', familyId: ev.familyId, eventId: ev.id, actorId: ctx.userId });
        return updated;
      }),

    remove: authedProcedure
      .input(z.object({ eventId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const ev = await store.getCalendarEvent(input.eventId);
        if (!ev) throw new TRPCError({ code: 'NOT_FOUND', message: '日历事件不存在' });
        await requireMembership(ctx, ev.familyId);
        // 删除他人事件仅 owner/admin；创建人可删自己的
        const me = await store.getMembership(ev.familyId, ctx.userId);
        const isOwnerOrAdmin = me && (me.role === 'owner' || me.role === 'admin');
        if (ev.createdBy !== ctx.userId && !isOwnerOrAdmin) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '无权删除他人创建的日历事件' });
        }
        await store.deleteCalendarEvent(ev.id);
        publishEvent({ kind: 'calendar.deleted', familyId: ev.familyId, eventId: ev.id, actorId: ctx.userId });
        return { ok: true };
      }),
  }),

  // ===== 个人财务共享快照（家庭共享账本桥接） =====
  // 设计见 finance-share-design.md。server 仅存 owner 推送的快照，读取时按 viewer 过滤。
  sharedFinance: router({
    /** 读取：仅返回 viewer 可见项（scope=all 或 viewer 在 allowedUserIds） */
    listByFamily: authedProcedure
      .input(z.object({ familyId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'viewFinance');
        const all = await store.listSharedFinanceByFamily(input.familyId);
        return all.filter((it) => it.scope === 'all' || (Array.isArray(it.allowedUserIds) && it.allowedUserIds.includes(ctx.userId)));
      }),

    /** 推送/更新一项共享财务快照（owner 本人操作） */
    upsert: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          itemType: z.enum(['summary', 'income', 'expense', 'asset', 'debt', 'investment', 'budget']),
          itemKey: z.string().min(1),
          label: z.string().min(1),
          scope: z.enum(['all', 'specific']).default('all'),
          allowedUserIds: z.array(z.string()).default([]),
          snapshot: snapshotSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageFinance');
        const row = await store.upsertSharedFinance({
          familyId: input.familyId,
          ownerUserId: ctx.userId,
          itemType: input.itemType,
          itemKey: input.itemKey,
          label: input.label,
          scope: input.scope,
          allowedUserIds: input.allowedUserIds,
          snapshot: input.snapshot,
        });
        publishEvent({ kind: 'sharedFinance.updated', familyId: input.familyId, actorId: ctx.userId, module: 'finance' });
        return row;
      }),

    /** 移除一项共享财务（N1：按 familyId 过滤防跨家庭 IDOR） */
    remove: authedProcedure
      .input(z.object({ familyId: z.string().min(1), id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageFinance');
        await store.removeSharedFinance(input.id, input.familyId);
        publishEvent({ kind: 'sharedFinance.updated', familyId: input.familyId, actorId: ctx.userId, module: 'finance' });
        return { ok: true };
      }),
  }),

  // ===== 通用个人模块共享快照（提醒/记事/脑图/心流/领域… 复用一套桥接） =====
  // server 仅存 owner 推送的快照，读取时按 viewer 过滤。module 判别各业务模块。
  sharedItems: router({
    /** 读取：仅返回 viewer 可见项（scope=all 或 viewer 在 allowedUserIds），可选按 module 过滤 */
    listByFamily: authedProcedure
      .input(z.object({ familyId: z.string().min(1), module: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'viewShared');
        const all = await store.listSharedItems(input.familyId, input.module);
        // 推送人始终可见自己共享的项；scope=all 或 viewer 在被授权列表中则对其他成员可见
        return all.filter(
          (it) =>
            it.ownerUserId === ctx.userId ||
            it.scope === 'all' ||
            (Array.isArray(it.allowedUserIds) && it.allowedUserIds.includes(ctx.userId)),
        );
      }),

    /** 推送/更新一项共享快照（owner 本人操作，按 module+itemType+itemKey 唯一键 upsert） */
    upsert: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          module: z.string().min(1),
          itemType: z.string().min(1),
          itemKey: z.string().min(1),
          label: z.string().min(1),
          scope: z.enum(['all', 'specific']).default('all'),
          allowedUserIds: z.array(z.string()).default([]),
          snapshot: snapshotSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageShared');
        const row = await store.upsertSharedItem({
          familyId: input.familyId,
          ownerUserId: ctx.userId,
          module: input.module as SharedItemModule,
          itemType: input.itemType,
          itemKey: input.itemKey,
          label: input.label,
          scope: input.scope,
          allowedUserIds: input.allowedUserIds,
          snapshot: input.snapshot,
        });
        publishEvent({ kind: 'sharedItems.updated', familyId: input.familyId, actorId: ctx.userId, module: input.module });
        return row;
      }),

    /** 协作操作：标记完成 / 添加备注（仅更新 done/note，不动快照）。
     *  N1：要求 manageShared 权限（owner/admin/member），阻断 guest/child 越权写入；
     *  同时按 familyId 过滤目标项，杜绝跨家庭 IDOR。 */
    update: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          id: z.string().min(1),
          done: z.boolean().optional(),
          note: z.string().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageShared');
        const patch: { done?: boolean; note?: string | null } = {};
        if (input.done !== undefined) patch.done = input.done;
        if (input.note !== undefined) patch.note = input.note;
        await store.updateSharedItem(input.id, input.familyId, patch);
        publishEvent({ kind: 'sharedItems.updated', familyId: input.familyId, actorId: ctx.userId });
        return { ok: true };
      }),

    /** 批量同步 owner 的个人模块共享快照：单次事务 + 单次广播，杜绝 N 次 upsert/remove 的广播风暴 */
    sync: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          upserts: z
            .array(
              z.object({
                module: z.string().min(1),
                itemType: z.string().min(1),
                itemKey: z.string().min(1),
                label: z.string().min(1),
                scope: z.enum(['all', 'specific']).default('all'),
                allowedUserIds: z.array(z.string()).default([]),
                snapshot: snapshotSchema,
              }),
            )
            .default([]),
          removes: z.array(z.string().min(1)).default([]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageShared');
        await store.syncSharedItems(
          input.familyId,
          ctx.userId,
          input.upserts.map((u) => ({
            module: u.module as SharedItemModule,
            itemType: u.itemType,
            itemKey: u.itemKey,
            label: u.label,
            scope: u.scope,
            allowedUserIds: u.allowedUserIds,
            snapshot: u.snapshot,
          })),
          input.removes,
        );
        publishEvent({ kind: 'sharedItems.updated', familyId: input.familyId, actorId: ctx.userId });
        return { ok: true };
      }),

    /** 移除一项共享（要求 manageShared 权限，含他人共享的协作项；N1 同时按 familyId 过滤防跨家庭 IDOR） */
    remove: authedProcedure
      .input(z.object({ familyId: z.string().min(1), id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageShared');
        await store.removeSharedItem(input.id, input.familyId);
        publishEvent({ kind: 'sharedItems.updated', familyId: input.familyId, actorId: ctx.userId });
        return { ok: true };
      }),
  }),

  // ===== 个人域（从 engine 整体迁移到 server：按 personal family 隔离） =====
  ...personalRouters,
});

// 供真实 HTTP 层解析 Authorization: Bearer <accessToken> 使用
export function ctxFromAuthorization(header: string | undefined, ip?: string): AuthContext {
  if (!header) return { userId: null, ip };
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    return { userId: verifyAccess(token), ip };
  } catch {
    return { userId: null, ip };
  }
}

export type AppRouter = typeof appRouter;
