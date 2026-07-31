import type { EventEnvelope } from '@dm-life/shared';

type Listener = (env: EventEnvelope) => void;

/**
 * 进程内类型化事件总线。事件落库后由 CommandHandler 调用 publish，
 * SSE 通道与（未来）本地规则引擎订阅它。订阅者异常不影响发布方。
 */
class EventBus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  publish(env: EventEnvelope): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(env);
      } catch (err) {
        console.error('[EventBus] listener error', err);
      }
    }
  }
}

export const eventBus = new EventBus();
