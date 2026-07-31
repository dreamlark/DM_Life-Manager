#!/bin/sh
# 统一入口：非 root 运行前的归属修正。
#
# 镜像以 USER node（uid 1000）运行以缩小容器逃逸影响面（N4）。但 /data 由 compose 的
# bind mount（./data/engine、./data/server）挂载，运行时该目录归属宿主机（通常 root），
# 会覆盖构建期的 chown，导致 node 用户落盘报 EACCES。
#
# 解决：以镜像默认的 root 身份先修正 /data 归属，再降权到 node 运行实际命令。
# 优先用 setpriv（直接 exec，保持 PID 1 = 应用，信号可达）；缺失时回退 su。
set -e

if [ -d /data ]; then
  chown -R node:node /data 2>/dev/null || true
fi

if command -v setpriv >/dev/null 2>&1; then
  exec setpriv --reuid=node --regid=node --clear-groups -- "$@"
fi

exec su node -s /bin/sh -c "$*"
