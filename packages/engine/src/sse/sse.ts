import type { IncomingMessage, ServerResponse } from 'node:http';
import { eventBus } from '../eventbus/EventBus';
import type { EventEnvelope } from '@dm-life/shared';

/**
 * SSE 通道：GET /events。
 * 把 EventBus 的实时事件以 text/event-stream 推给前端 EventSource，
 * 前端据此驱动 Zustand reactiveStore 即时刷新（无需轮询）。
 */
export function attachSse(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  // 注意：前端用 EventSource.onmessage 监听无名（unnamed）消息事件。
  // 若带 `event:` 字段变成具名事件，onmessage 不会触发，导致写操作后
  // 客户端永不失效刷新（表现为“点了没反应”）。故一律发无名 message。
  // 事件类型保留在 data 负载的 env.type 中，前端可按需读取。
  const send = (env: EventEnvelope) => {
    res.write(`data: ${JSON.stringify(env)}\n\n`);
  };

  const unsubscribe = eventBus.subscribe(send);

  // 心跳保活
  const ping = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
}
