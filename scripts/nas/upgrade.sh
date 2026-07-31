#!/usr/bin/env bash
# 增量升级：拉取最新源码 -> 重建镜像 -> 滚动重启。
# 数据卷 ./data 不参与重建，升级不影响使用与数据。
# 用法：bash scripts/nas/upgrade.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

# 可选：拉取远端更新（非 git 仓库时跳过）
if [ -d .git ]; then
  echo "==> git pull"
  git pull --ff-only || echo "（git pull 跳过/失败，使用本地源码继续）"
fi

# 先备份当前数据
echo "==> 备份数据"
bash "$HERE/backup.sh" || echo "（备份失败，仍继续升级）"

# 重建镜像并滚动重启（compose 仅重建镜像，./data 卷保留）
echo "==> 重建镜像并滚动重启"
docker compose build
docker compose up -d
docker image prune -f

echo "==> 升级完成。查看状态：docker compose ps"
