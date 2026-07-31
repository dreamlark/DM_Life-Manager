import { useEffect } from 'react';
import { trpcLocal } from './trpcLocal';
import { useAuthStore } from '../store/authStore';

/**
 * 订阅 server 的 WebSocket 实时事件流（/ws）：任意写事件到来即让相关查询失效并重新拉取，
 * 实现「命令 → 事务双写 → 事件总线 → WS → 看板刷新」的闭环。
 * 令牌经 Sec-WebSocket-Protocol 子协议头传递（与协作模式 realtime.ts 一致），
 * 不出现在 URL 中，避免被代理/访问日志记录。连接断开自动重连。
 */
export function useEventStreamLocal(): void {
  const utils = trpcLocal.useUtils();

  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;

    const invalidate = (): void => {
      void utils.tasks.today.invalidate();
      void utils.tasks.all.invalidate();
      void utils.insights.dailyCard.invalidate();
      void utils.finance.summary.invalidate();
      void utils.finance.debts.list.invalidate();
      void utils.finance.incomes.list.invalidate();
      void utils.finance.transactions.list.invalidate();
      void utils.finance.assets.list.invalidate();
      void utils.finance.budgets.list.invalidate();
      void utils.reminders.list.invalidate();
      void utils.reminders.upcoming.invalidate();
      void utils.insights.pressure.invalidate();
      void utils.notes.list.invalidate();
      void utils.flow.summary.invalidate();
      void utils.flow.list.invalidate();
      void utils.interests.list.invalidate();
      void utils.interests.review.invalidate();
      void utils.domains.list.invalidate();
      void utils.domains.balanceWheel.invalidate();
      void utils.system.dataStatus.invalidate();
    };

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/ws`, [token]);
      ws = sock;

      sock.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === 'event') invalidate();
        } catch {
          /* 忽略非法消息 */
        }
      };
      sock.onerror = () => sock.close();
      sock.onclose = () => {
        if (reconnectTimer) return;
        retry += 1;
        const delay = Math.min(1000 * 2 ** Math.min(retry, 4), 10_000);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (useAuthStore.getState().accessToken) connect();
        }, delay);
      };
    };

    connect();

    return () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    };
  }, [utils]);
}
