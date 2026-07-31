#!/usr/bin/env bash
# 备份 dm-life 数据卷（engine + server 的数据库文件）。
# 用法：bash scripts/nas/backup.sh [保留份数，默认 7]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DATA_DIR="$ROOT/data"
BACKUP_DIR="$ROOT/backups"
KEEP="${1:-7}"

if [ ! -d "$DATA_DIR" ]; then
  echo "未找到数据目录：$DATA_DIR（请先启动过一次服务再备份）"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/dm-life-data-$STAMP.tar.gz"

echo "==> 打包 $DATA_DIR"
tar -czf "$OUT" -C "$DATA_DIR" .

# 仅保留最近 KEEP 份，删除更早的
echo "==> 清理旧备份（保留最近 $KEEP 份）"
ls -1t "$BACKUP_DIR"/dm-life-data-*.tar.gz 2>/dev/null \
  | tail -n +$((KEEP + 1)) \
  | xargs -r rm -f

echo "已备份：$OUT"
