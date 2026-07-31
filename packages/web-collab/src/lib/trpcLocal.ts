import { createTRPCReact } from '@trpc/react-query';
import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AppRouter } from '@dm-life/server/router';
import { useAuthStore } from '../store/authStore';
import { tryRefresh } from './refresh';

// 个人模式（单机版）tRPC 客户端：统一后端，指向 server 的 /trpc。
// 与协作模式共用同一后端（packages/server），仅在数据库层按 familyId 做用户/家庭隔离——
// 个人模式下 login 会自动创建一个“个人家庭”，该用户即 owner，所有个人数据归属此 family。
// trpc/trpcLocal 为 React 客户端（供组件 hooks 与 Provider 使用）。
// 401 刷新统一走 lib/refresh.ts 的 tryRefresh（单一锁），避免与协作模式客户端并发刷新互相踢下线。
export const trpc = createTRPCReact<AppRouter>();
export const trpcLocal = trpc;

// 服务端地址：开发期走 vite 代理（同源 /trpc → 4100），生产用 VITE_SERVER_URL 直连
export const SERVER_TRPC_URL = (import.meta.env.VITE_SERVER_URL || `${location.origin}/trpc`).replace(
  /\/$/,
  '',
);

export const queryClientLocal = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 500, refetchOnWindowFocus: false },
    mutations: {
      onError: (err: any) => {
        const raw = err instanceof Error ? err.message : '未知错误';
        toast.error(`操作失败：${raw}`, { duration: 6000 });
      },
    },
  },
});

// 自定义 fetch：注入 Bearer，遇到 401 自动用 refresh 旋转一次后重试。
// 旋转锁集中在 lib/refresh.ts，trpc.ts 与 trpcLocal.ts 共用，避免并发 401 重复刷新致强制登出。
export async function trpcLocalFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
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
