import { useEffect, useState } from 'react';
import { fetchBackendVersion, checkVersion } from '../lib/version';

/**
 * 启动版本校验横幅（非致命）。
 * 仅当协作后端要求的前端最低版本高于当前时，顶部显示一条可关闭的提示，
 * 不阻断使用——做到「升级不影响现有使用」。
 */
export function VersionBanner() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const remote = await fetchBackendVersion();
      if (!alive) return;
      const r = checkVersion(remote);
      if (!r.ok) setMsg(r.message);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!msg) return null;

  return (
    <div className="version-banner" role="status">
      <span className="version-banner-icon">⚠️</span>
      <span className="version-banner-text">{msg}</span>
      <button
        type="button"
        className="version-banner-close"
        aria-label="关闭提示"
        onClick={() => setMsg(null)}
      >
        ✕
      </button>
    </div>
  );
}
