import { useEffect, useRef } from 'react';
import { trpcLocal as trpc } from '../../lib/trpcLocal';
import { playAlarm } from '../../lib/sound';

/**
 * 提醒响铃：监听所有钟的状态，当某只钟进入 due/overdue（真正到点）时播放提示音。
 *
 * - 用 rungRef 记录「已响过的钟」，避免每次查询刷新都重复播放；
 * - 钟被处理（完成/推迟/重置 → 不再是 due/overdue）后从集合移除，下次再响可重新播放；
 * - 「单次」钟完成后变 done，不会再次触发，符合一次性语义。
 */
export function useReminderAlarm(): void {
  const { data } = trpc.reminders.list.useQuery(undefined);
  const rungRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    for (const c of data) {
      const firing = c.status === 'due' || c.status === 'overdue';
      if (firing && !rungRef.current.has(c.id)) {
        rungRef.current.add(c.id);
        playAlarm();
      } else if (!firing) {
        rungRef.current.delete(c.id);
      }
    }
  }, [data]);
}
