import { useEffect } from 'react';
import { useRealtimeStore } from '../lib/realtime';

/** 全局通知 toast（实时网关推送的事件提示），在成员/任务两个标签下都可见 */
export function Toasts() {
  const notify = useRealtimeStore((s) => s.notify);
  const clearNotify = useRealtimeStore((s) => s.clearNotify);

  useEffect(() => {
    if (!notify) return;
    const t = setTimeout(() => clearNotify(), 3000);
    return () => clearTimeout(t);
  }, [notify, clearNotify]);

  if (!notify) return null;
  return (
    <div className="toast" key={notify.id} onClick={clearNotify} role="status">
      {notify.text}
    </div>
  );
}
