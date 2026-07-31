/**
 * 协作后端版本契约（增量升级用）
 *
 * - backend：本服务版本（语义化）
 * - minFrontend：前端必须的最低版本，低于此版本的前端应提示升级
 * - schema：当前数据库 schema 版本（与引擎 SCHEMA_VERSION 对齐，便于双端校验）
 *
 * 升级时只改这里 + 必要时在 migrate 的 MIGRATIONS 追加步骤，
 * 做到「升级不影响现有使用与数据」。
 */
export const SERVER_VERSION = '1.0.0';
export const MIN_FRONTEND_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;

export interface VersionInfo {
  backend: string;
  minFrontend: string;
  schema: number;
}

export function getVersionInfo(): VersionInfo {
  return {
    backend: SERVER_VERSION,
    minFrontend: MIN_FRONTEND_VERSION,
    schema: SCHEMA_VERSION,
  };
}
