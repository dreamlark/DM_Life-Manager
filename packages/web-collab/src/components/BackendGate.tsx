import { useEffect, useState, type ReactNode } from 'react';

/**
 * 后端就绪守卫：在渲染应用前先探测统一后端（server）的 /health。
 *
 * 单后端架构下，个人模式与协作模式共用同一 server（仅在数据库层按 familyId 隔离），
 * 因此只需等待 server 就绪即可进入；server（PGLite）首次启动可能需 10-30s 预热，
 * 未就绪时显示进度，就绪后自动渲染 <App/>，无需手动刷新。
 */
export function BackendGate({ children }: { children: ReactNode }) {
  const [serverReady, setServerReady] = useState(false);
  const [dots, setDots] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const checkServer = async () => {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok && alive) setServerReady(true);
      } catch {
        /* server 尚未监听或仍在预热 */
      }
    };

    const tick = () => {
      void checkServer();
      setDots((d) => (d + 1) % 4);
    };

    tick();
    timer = setInterval(tick, 1500);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  if (serverReady) return <>{children}</>;

  return (
    <div className="boot">
      <div className="connecting-card">
        <div className="spinner" />
        <p className="connecting-title">正在连接后端服务</p>
        <div className="connecting-hint space-y-2 text-left">
          <div className="flex items-center gap-2">
            <span className={serverReady ? 'text-green-400' : 'text-gray-400'}>
              {serverReady ? '✅' : '⏳'}
            </span>
            <span>后端服务 {serverReady ? '已就绪' : '正在初始化数据库（约 10-30 秒）…'}</span>
          </div>
          <p className="text-xs text-gray-500">
            首次启动需初始化本地数据库，就绪后将自动进入，无需手动刷新。
            {' .'.repeat(dots)}
          </p>
        </div>
      </div>
    </div>
  );
}
