import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpcLocal, queryClientLocal, trpcLocalFetch, SERVER_TRPC_URL } from './lib/trpcLocal';
import App from './App';
import { BackendGate } from './components/BackendGate';
import './tailwind.css';
import './styles.css';
import './styles/theme.css';

// 个人模式（单机版）tRPC 客户端：统一后端，经 vite /trpc 代理转发到 packages/server（:4100）。
// 请求携带 Bearer accessToken（见 lib/trpcLocal.ts 的 trpcLocalFetch），由 server 按 familyId 隔离数据。
const trpcLocalClient = trpcLocal.createClient({
  links: [httpBatchLink({ url: SERVER_TRPC_URL, fetch: trpcLocalFetch })],
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <trpcLocal.Provider client={trpcLocalClient} queryClient={queryClientLocal}>
      <QueryClientProvider client={queryClientLocal}>
        <BackendGate>
          <App />
        </BackendGate>
      </QueryClientProvider>
    </trpcLocal.Provider>
  </React.StrictMode>,
);
