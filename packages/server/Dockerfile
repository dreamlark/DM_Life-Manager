# 协作后端镜像：tRPC + PGlite(文件型) / 可选真实 Postgres(DATABASE_URL)
# 默认用 PGLITE_DIR 走文件持久化（无需外部数据库）；
# 也可设 DATABASE_URL=postgres://... 改用真实 Postgres（表由 migrations/ 管理）。
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=4100 \
    PGLITE_DIR=/data \
    CORS_ORIGIN=*

WORKDIR /app

# 依赖清单先入层，利用缓存。
# 只复制目标包及其直接依赖的 workspace package.json（server 仅依赖 @dm-life/shared），
# 不复制其他 workspace（engine/web/web-collab/desktop），避免它们的内部 @dm-life/* 依赖
# 在无锁文件重装时被当作外部包去 npm 公共仓库拉取 → 404 构建失败。
# 关键②：package-lock.json 是在 Windows 上生成的，只记录 Windows 原生二进制
#（@rollup/rollup-win32-*、@esbuild/win32-*）。Docker 容器是 linux-x64——若带着
# 这个 lockfile 跑 `npm install`，npm 仍照 lockfile 还原、不会为 linux 重解析
# 可选原生二进制，触发著名 bug npm/cli#4828（tsx 依赖的 esbuild 原生二进制缺失 →
# 容器启动即崩）。npm 官方给的修复就是「删掉 lockfile 再重装」，故此处先 rm 再
# install，让 npm 按 linux 平台重新解析并装上正确的原生二进制。仓库里的 lockfile
# 仍保留给本地 Windows 开发用，不参与 Docker 构建。
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json

RUN rm -f package-lock.json && npm install --include=dev

# 源码
COPY packages ./packages
COPY apps ./apps

COPY docker-entrypoint-node.sh /usr/local/bin/docker-entrypoint-node.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-node.sh \
 && chown -R node:node /app && mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 4100

# 健康检查：/health 在 PGlite 预热完成前返回 503，故 start-period 留足冷启动时间。
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

# 入口脚本以 root 修正 /data 归属后，经 setpriv/su 降权到 node 运行（见 docker-entrypoint-node.sh）。
ENTRYPOINT ["/usr/local/bin/docker-entrypoint-node.sh"]
CMD ["npm", "start", "-w", "packages/server"]
