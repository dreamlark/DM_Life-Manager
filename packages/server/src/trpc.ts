// 共享 tRPC 实例（server 内部路由共用，避免 personal 域路由与 router 相互循环依赖）。
import { initTRPC, TRPCError } from '@trpc/server';
import type { AuthContext } from './rbac';

const t = initTRPC.context<AuthContext>().create();
export const router = t.router;
export const publicProcedure = t.procedure;

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先登录' });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
export const authedProcedure = publicProcedure.use(isAuthed);
export { t };
