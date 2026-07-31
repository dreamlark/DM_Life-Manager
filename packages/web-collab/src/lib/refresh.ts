import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@dm-life/server/router';
import { useAuthStore } from '../store/authStore';

// 服务端地址：开发期走 vite 代理（同源 /trpc → 4100），生产用 VITE_SERVER_URL 直连
const SERVER_URL = (import.meta.env.VITE_SERVER_URL || `${location.origin}/trpc`).replace(/\/$/, '');

/**
 * 单一刷新用命令式客户端： deliberately 不走 authedFetch（见 trpc.ts/trpcLocal.ts），
 * 避免「刷新请求本身 401 → 又触发重试 → 递归调用 tryRefresh」的死循环。
 * 它只携带 refreshToken 调 auth.refresh 端点；失败则由 catch 统一清登。
 */
const refreshClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: SERVER_URL })],
});

/**
 * 全局唯一的刷新锁。
 *
 * 历史问题：trpc.ts 与 trpcLocal.ts 各自维护一份 `refreshing` 锁，但二者共享同一个
 * useAuthStore.refreshToken。当两类请求并发 401 时，两个独立锁会各自旋转 refresh token，
 * 后者使前者拿到的新 access/refresh token 立即失效，最终把用户强制登出。
 *
 * 把锁收拢到本模块后，无论哪个 tRPC 客户端触发 401，都走同一个 tryRefresh，
 * 并发请求会复用同一趟刷新，刷新成功后统一用新令牌重试。
 */
let refreshing: Promise<boolean> | null = null;

export async function tryRefresh(): Promise<boolean> {
  const current = refreshing;
  if (current) return current; // 已有刷新在飞，直接复用其结果
  refreshing = (async () => {
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return false;
    try {
      const res = await refreshClient.auth.refresh.mutate({ refreshToken });
      useAuthStore.getState().setTokens(res.accessToken, res.refreshToken);
      return true;
    } catch {
      useAuthStore.getState().clear();
      return false;
    }
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null; // 完成后释放锁，允许后续因过期再次刷新
  }
}
