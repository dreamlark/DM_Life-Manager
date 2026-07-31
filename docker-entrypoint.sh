#!/bin/sh
# dm-life All-in-One 容器入口
# 以 root 启动：修正挂载卷 /data 的归属（宿主机 ./data 常为 root 所有，
# 容器内 node uid 1000 需可写，否则编排器写 /data/.env.auto 会 EACCES 崩溃），
# 随后降权到 node 用户运行编排器（保持非 root 最小化影响面）。
set -e

mkdir -p /data
# 修复挂载卷归属（一次性，个人数据量极小，递归开销可忽略）
chown -R node:node /data 2>/dev/null || true

# 降权到 node 用户运行编排器（CMD 透传为 "$@"，已含 node 命令）
exec /usr/sbin/runuser -u node -- "$@"
