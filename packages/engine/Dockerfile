# 本地引擎镜像：tRPC + Drizzle + sql.js(WASM SQLite)
# 直接经 tsx 运行 TS 源码（与本地开发一致）；依赖由 npm workspaces 安装。
# 数据持久化：挂载卷到 DM_LIFE_DATA_DIR（/data），sql.js 落盘到该目录。
# 构建上下文 = 仓库根（docker-compose 中指定 context: .），故以下 COPY 均为根相对路径。
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=14570 \
    HOST=0.0.0.0 \
    DM_LIFE_DATA_DIR=/data

WORKDIR /app

# 依赖清单先入层，利用缓存。
# 只复制目标包及其直接依赖的 workspace package.json（engine 仅依赖 @dm-life/shared），
# 不复制其他 workspace（server/web/web-collab/desktop），避免它们的内部 @dm-life/* 依赖
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
COPY packages/engine/package.json packages/engine/package.json

RUN rm -f package-lock.json && npm install --include=dev

# 源码
COPY packages ./packages
COPY apps ./apps

COPY docker-entrypoint-node.sh /usr/local/bin/docker-entrypoint-node.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-node.sh \
 && chown -R node:node /app && mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 14570

# 健康检查：引擎无匿名 /health 端点，改为 TCP 端口探活（与 ENGINE_API_TOKEN 鉴权无关）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "const net=require('net');const s=net.connect(14570,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))"

# 入口脚本以 root 修正 /data 归属后，经 setpriv/su 降权到 node 运行（见 docker-entrypoint-node.sh）。
ENTRYPOINT ["/usr/local/bin/docker-entrypoint-node.sh"]
CMD ["npm", "start", "-w", "packages/engine"]
