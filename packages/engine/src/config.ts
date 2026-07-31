import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * 解析默认数据目录（数据库文件 dm-life.db 的存放位置，未自定义时的回退值）。
 *
 * 关键修复（数据在「更新程序」后丢失）：
 * 旧逻辑默认把 db 放在引擎包内的 `data/`（安装/源码目录内部），一旦程序被更新、
 * 重装或工作区被重建，这个目录会被整体覆盖/删除，导致数据全部丢失。
 * 新逻辑默认放在**操作系统用户数据目录**（Windows %APPDATA%、macOS ~/Library/Application Support、
 * Linux XDG_DATA_HOME），该目录与安装目录隔离，程序更新不会触及，数据可长期保留。
 */
export function getDefaultDataDir(): string {
  // 测试环境：用系统临时目录，避免污染真实用户数据、且每个运行互相隔离
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return path.join(os.tmpdir(), 'dm-life-test-data');
  }

  // 生产/开发默认：操作系统用户数据目录（与安装目录隔离，更新程序不被清空）
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'dm-life',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'dm-life');
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'dm-life');
}

/**
 * 自定义数据目录的覆盖配置文件路径（稳定位置 = 默认用户数据目录内）。
 * 该位置不依赖 dataDir 本身，避免「先有鸡还是先有蛋」：引擎启动时总能在此读到用户自定义路径。
 */
export function dataDirConfigPath(): string {
  return path.join(getDefaultDataDir(), 'datadir.json');
}

/** 读取自定义数据目录覆盖（若存在且合法）。返回 null 表示未自定义。 */
function loadDataDirOverride(): string | null {
  try {
    const p = dataDirConfigPath();
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { dataDir?: unknown };
    if (typeof raw.dataDir === 'string' && raw.dataDir.trim().length > 0) return raw.dataDir.trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * 解析数据目录（数据库文件 dm-life.db 的存放位置）。
 *
 * 优先级：DM_LIFE_DATA_DIR 环境变量 > 覆盖配置文件(datadir.json) > 默认用户数据目录。
 * 覆盖配置文件由「设置 → 数据目录」写入，使自定义保存位置在重启后持续生效。
 */
function resolveDataDir(): string {
  if (process.env.DM_LIFE_DATA_DIR) return process.env.DM_LIFE_DATA_DIR;
  const override = loadDataDirOverride();
  if (override) return override;
  return getDefaultDataDir();
}

/** 集中配置 + fail-fast（环境变量可覆盖） */
export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 14570),
  /** 数据目录：默认放在操作系统用户数据目录（与安装目录隔离，更新程序不丢失） */
  dataDir: resolveDataDir(),
  /**
   * 引擎访问令牌（P0-2）。默认 null = 不启用鉴权（桌面单机 localhost 场景，保持向后兼容）。
   * 一旦设置（NAS 多用户远程部署时务必设置），引擎会拒绝一切未携带正确令牌的
   * tRPC / SSE / 调试端点请求，从而阻断“匿名远程导出/导入/读全部数据”。
   * 浏览器经服务端 `auth.engineToken` 获取同一令牌后随请求携带。
   */
  apiToken: process.env.ENGINE_API_TOKEN && process.env.ENGINE_API_TOKEN.trim().length > 0
    ? process.env.ENGINE_API_TOKEN.trim()
    : null,
};

if (!Number.isFinite(config.port) || config.port <= 0) {
  throw new Error(`非法 PORT: ${process.env.PORT}`);
}
