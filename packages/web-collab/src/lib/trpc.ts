import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@dm-life/server/router';
import { useAuthStore } from '../store/authStore';
import { tryRefresh } from './refresh';

// 服务端地址：开发期走 vite 代理（同源 /trpc → 4100），生产用 VITE_SERVER_URL 直连
const SERVER_URL = (import.meta.env.VITE_SERVER_URL || `${location.origin}/trpc`).replace(/\/$/, '');

// 自定义 fetch：注入 Bearer，遇到 401 自动用 refresh 旋转一次后重试
// （旋转锁集中在 lib/refresh.ts，trpc.ts 与 trpcLocal.ts 共用，避免并发 401 重复刷新致强制登出）
async function authedFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const access = useAuthStore.getState().accessToken;
  const headers = new Headers(init?.headers);
  if (access) headers.set('Authorization', `Bearer ${access}`);
  let res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const next = useAuthStore.getState().accessToken;
      if (next) headers.set('Authorization', `Bearer ${next}`);
      res = await fetch(url, { ...init, headers });
    }
  }
  return res;
}

/**
 * 登录（或刷新成功）后，应用仅需持有 server 下发的 accessToken / refreshToken；
 * 个人模式与协作模式共用同一后端，不再有独立的 engine 共享令牌。
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: SERVER_URL, fetch: authedFetch })],
});
