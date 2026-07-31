# 前端镜像：Vite 构建为静态资源，用 nginx 托管（Web + 移动 PWA 共用同一份静态包）
# 构建上下文 = 仓库根（docker-compose 中指定 context: .）。
FROM node:22-slim AS build
WORKDIR /app

# 根配置先入层（轻量，变动少，缓存命中率高）
COPY package.json tsconfig.base.json ./

# 源码全量复制：npm workspaces 要求每个声明的 workspace 目录存在且包含有效包结构，
# 仅复制 package.json 文件不足以让 npm 识别为 workspace 成员（npm ls --workspaces
# 不会列出它们），会导致 @dm-life/* 内部依赖被当作外部包去 registry 查找 → 404。
# 故此处必须先复制完整源码目录，再执行 npm install。
COPY packages ./packages
COPY apps ./apps

# 删 Windows lockfile 并重装（同 engine/server Dockerfile 的原因：
#   Windows 锁文件含 win32 原生二进制，Linux 容器需要 linux-x64 版本）。
RUN rm -f package-lock.json && npm install --include=dev

# 构建（仅构建目标包）
RUN npm run build -w packages/web-collab

FROM nginx:alpine
COPY --from=build /app/packages/web-collab/dist /usr/share/nginx/html
COPY packages/web-collab/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
# N4：nginx:alpine 的 worker 进程默认以非 root 的 nginx 用户（uid 101）运行，master 仅
# 为绑定 80 端口短暂保持 root 后降权，已是最小权限；此处不再强制 USER（否则无法绑定特权端口）。
