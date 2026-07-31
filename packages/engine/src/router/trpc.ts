import { initTRPC } from '@trpc/server';

/**
 * 服务端专用的 tRPC 初始化实例。
 * 只被 engine（Node 运行时）消费，绝不能被浏览器端 import —— 否则 @trpc/server 会在
 * 非 server 环境抛错导致整页白屏。类型与 Zod schema 仍放 @dm-life/shared 供 web 复用。
 */
export const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;
