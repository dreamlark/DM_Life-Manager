# DM_life — 人生管理系统（TypeScript 实现 · 单机 + 家庭协作）

一套自托管的人生管理系统：任务 / 四象限 / 时间块 / 财务 / 提醒 / 灵感 / 家庭共享。
架构为 **ADR-006 单后端 All-in-One**：统一 `server` 后端 + `web-collab` 前端 + 内置 caddy，采用 **TypeScript + React + Vite** 前端、tRPC v11 + Drizzle + PGlite（文件型，免外部数据库）、事件溯源（仅追加）引擎。

> **代码位置**：本仓库根目录即当前主线（ADR-006 单后端版），架构以 `packages/server` 为唯一后端、`apps/allinone` 为编排器、`Dockerfile.allinone` 构建单镜像。

---

## 目录

0. [近期改动（2026-07-30）](#近期改动2026-07-30)
1. [技术栈与架构](#1-技术栈与架构)
2. [本地开发运行](#2-本地开发运行)
3. [测试与质量](#3-测试与质量)
4. [🚀 部署到家庭 NAS（重点）](#4-部署到家庭-nas重点)
   - 4.1 前置条件
   - 4.2 把代码放到 NAS
   - 4.3 配置域名 / 网络（局域网 / Tailscale / 公网域名）
   - 4.4 首次启动
   - 4.5 日常访问（浏览器 + 手机 PWA）
   - 4.6 增量升级（不丢数据）
   - 4.7 备份与回滚
   - 4.8 数据与目录结构
   - 4.9 故障排查
   - 4.10 fnOS 免 git 直接拉镜像（推荐家庭 NAS）
5. [增量升级机制（版本接口 + 横幅）](#5-增量升级机制版本接口--横幅)
6. [金额互转（预留接口状态）](#6-金额互转预留接口状态)
7. [已知坑与注意事项](#7-已知坑与注意事项)
8. [延期项](#8-延期项)

---

## 近期改动（2026-07-30）

从旧双后端工作版 cherry-pick 合并而来，单后端架构未动（交付报告见仓库 `deliverables/gstack/merge-dmlife-to-review-2026-07-30.md`）：

### 引导与品牌（Auth 改版）
- **启动页品牌**：联机前端启动页标题改为「人生管理系统」，不再显示「家庭协作 / DM Life · 联机版」（`packages/web-collab/src/components/AuthScreen.tsx`）。
- **注册内联设 PIN**：注册流程在页面内直接设置 PIN（调用 `pinStore.setup`），不再弹窗；注册成功即创建本地 PIN 凭据库。
- **标签页标题**：浏览器标签固定为「DM Life Manager」（`packages/web-collab/index.html`）。

### 代码审查修复（运行时健壮性）
| 文件 | 修复 |
|---|---|
| `components/AppLock.tsx` | `useEffect` 依赖加 `lockRemaining`：输错 PIN 后倒计时走到 0 自动解禁（此前输入框被永久禁用） |
| `lib/rbac.ts` | 未知服务端角色改为 `?.includes(perm) ?? false`（此前直接抛 `TypeError` 页面崩溃） |
| `features/shared/FamilySharedItemsBoard.tsx` | `dmImportedShared` 解析加 try/catch 兜底（此前损坏的 localStorage 致组件挂载崩溃） |

### 依赖与构建
- `@dm-life/server|shared` 改为 **`file:../server|shared`** 本地链接（脱离私有 registry 也能 `npm install`）；`typescript` 提至 **`^5.7.0`**。
- 已验证：`npm install` ✅ / `tsc --noEmit` 零错误 ✅ / `vite build` 通过（dist 已重建为「DM Life Manager」）✅。

### 一键启动
- 本机开发双击 **`start-dm-life.bat`**：自动清理旧端口 → 启动 `server`（4100）+ `web-collab`（5173）→ 等 `/health` 就绪 → 自动开浏览器。已重写为单后端版（不再启动 engine）。
- 或根目录 `npm run dev`（`scripts/dev.mjs`，效果相同，Ctrl+C 退出）。

---

## 1. 技术栈与架构

**Monorepo（npm workspaces）**

| 包 | 作用 |
|---|---|
| `packages/shared` | 跨包契约：Zod schema、事件信封类型、feature flags |
| `packages/server` | **统一后端（单后端 All-in-One 唯一后端）**：tRPC v11 + Drizzle + **PGlite（文件型，免外部数据库）/ 可选真实 Postgres** + WebSocket 实时网关。个人域（任务/财务/笔记/灵感/提醒/心流/领域…）与家庭共享域均在此一处提供 |
| `packages/web-collab` | 联机前端（Web + 移动 PWA 共用一份静态包），**只连 `server`** |

> **架构收敛（ADR-006 单后端）**：原「web-collab + engine + server」双后端已**合并为单一后端 `server`**——
> 注册即自动创建「个人家庭（`kind='personal'`）」，所有个人域过程经 `store.getPersonalFamilyId(ctx.userId)` 按用户隔离；
> 共享域（日历/共享账本/共享项）走「共享家庭（`kind='shared'`）」的成员 + RBAC 模型。旧的独立后端 `packages/engine` 与桌面壳 `apps/desktop`（Tauri）已被**移除**，不属于最终架构。

**架构闭环（单一写路径 + 事件驱动）**

```
联机前端(web-collab) tRPC mutation / WebSocket
  → server: Zod 校验 + 鉴权（Bearer accessToken）
    → 解析 familyId（个人域由 getPersonalFamilyId 服务端决定，客户端不可指定 → 防 IDOR）
    → db.transaction( 追加 events 行 + 更新实体行 )   // 原子双写
    → eventBus.publish(envelope)
  → WebSocket(/ws): <envelope>                        // 实时推送，前端按 family 精准刷新
```

- `events` 表**仅追加**，实体表由命令在事务内同步更新（ADR-002）。
- 升级只重建镜像、不动数据卷 —— **升级不影响使用与数据**（见第 4、5 节）。

---

## 2. 本地开发运行

```bash
# 1. 安装依赖（仅首次）
cd DM_LifeManager-review && npm install

# 2. 启动统一后端 server（终端 A）—— 联机版唯一后端
cd packages/server && npx tsx src/http-server.ts
#    → http://127.0.0.1:4100  (tRPC: /trpc, 实时: /ws, 健康: /health)
#    可用 PORT 覆盖；默认文件模式，数据库落盘到 `~/.dm-life/data`；可用 PGLITE_DIR 或 DATABASE_URL 覆盖。

# 3. 联机前端（终端 B，含协作 / 家庭共享）
npm run dev -w @dm-life/web-collab
#    → http://127.0.0.1:5173  (Vite 已代理 /trpc、/ws、/health 到 server:4100)
```

> 联机前端默认用**相对路径**访问后端（`location.origin/trpc`、`/ws`），
> 因此无论是本机 Vite 代理、还是下面第 4 节的 Caddy 反代，都无需改动任何环境变量。
> 仅当你要把前端指向一个**独立部署**的协作服务时，才需要设 `VITE_SERVER_URL`。

---

## 3. 测试与质量

```bash
npm run test -w @dm-life/server        # vitest：安全/隔离全量测试（注册/家庭/邀请/RBAC/个人域隔离/多用户 E2E/版本接口/删号/跨用户隔离/zone 隔离，详见 packages/server/src/__tests__）
npm run build -w @dm-life/web-collab   # vite build 通过（PWA 静态包，已切到单一后端 server）
```

类型检查：`tsc --noEmit -p packages/{server,web-collab}/tsconfig.json` 均 0 错误。

> 个人域（任务/财务/笔记/灵感/提醒/心流/领域/项目/知识库…）已从旧 engine 整体迁移到 server，并新增
> `multi-user-e2e.test.ts` 验证：双用户数据隔离、结构 IDOR 防护、家庭生命周期与角色链、越权边界。

---

## 4. 🚀 部署到家庭 NAS（重点）

整套系统已**容器化**，一条命令拉起：**统一后端 `server` + 前端（web-collab 静态包）+ Caddy 反代**。联机版已收敛为**单一后端**（个人域与共享域都在 `server`，不再有独立 engine 进程）。数据通过挂载卷持久化，升级只重建镜像、不动数据。

> ⚠️ **多用户远程部署前必做（安全）**：必须为 `server` 设置强随机 `JWT_SECRET`，否则多用户上 NAS 等于裸奔（详见 4.10）。镜像包保持**私有**，禁止翻 Public。

涉及文件（均已就绪）：

```
docker-compose.simple.yml   # 编排（推荐）：单后端 all-in-one —— server + web-collab + Caddy（本地构建）
docker-compose.fnos.yml     # 编排（fnOS / 任意 Docker 主机）：直接拉取 GHCR 钉固镜像，免 git、免编译
caddy.auto.conf             # all-in-one 镜像内置的反代配置（/trpc、/ws、/health → server；其余 → 前端）
Dockerfile.allinone         # 单镜像：构建 server + web-collab，由 apps/allinone/index.mjs 拉起
apps/allinone/index.mjs     # all-in-one 启动入口（拉起 server + 内置 caddy）
.dockerignore
.github/workflows/publish.yml  # 推送 main 时自动构建并发布单一镜像 dm-life:latest 到 GHCR（包默认私有）
scripts/nas/backup.sh      # 打包 ./data 单一数据卷增量备份
```

> 最终架构只有**一个**数据卷（`./data`，容器内 `/data`）。旧的 `docker-compose.yml`/`Caddyfile`/`caddy.conf`（双后端反代）
> 与 `packages/engine`、`apps/desktop`（Tauri 壳）已**移除**；all-in-one 镜像内置 caddy，无需单独的 Caddyfile。

### 4.1 前置条件

- **NAS 支持 Docker**：群晖 Container Manager / Q威 Container Station / 飞牛 fnOS / 任意装了 Docker 的 Linux 小主机皆可。
- 至少 **约 1 GB 空闲内存 + 几百 MB 磁盘**（数据会随使用增长）。
- （推荐）一个 **Tailscale** 账号 —— 免公网 IP、免路由器端口转发，手机/电脑装了 Tailscale 即可安全访问家里服务。
- （可选）一个**真实域名** + 能改 DNS —— 走标准 Let's Encrypt 证书，最省心。

### 4.2 把代码放到 NAS

有两种放法，按你喜好选：

**方式一 · git 拉仓库（适合会升级、想保留源码）**
```bash
# 在 NAS 的终端 / Container Manager 的终端里
git clone <你的仓库地址> dm-life
cd dm-life
```
升级时一条 `git pull` 即可。对应 `docker-compose.simple.yml`（`docker compose up -d --build` 本地构建）。

**方式二 · 免 git 直接拉镜像（推荐家庭 NAS / fnOS，见 4.10）**
完全不碰源码：镜像已由 GitHub Actions 自动构建并发布到 GHCR（包**默认私有，禁止翻 Public**；私有包用带 `read:packages` 的 PAT 登录即可拉取），你只需在 fnOS 粘贴一份 compose 即可拉取运行，详见 [4.10](#410-fnos--任意-docker-主机免-git-直接拉镜像)。对应 `docker-compose.fnos.yml`。

若方式一不方便建远程仓库，也可把 `dm-life` 整个目录用 File Station / SCP 拷进 NAS 任意持久位置（如 `/volume1/docker/dm-life`）。
**确保该目录在重启后依然存在**（不要放在 `/tmp` 之类临时卷）。

### 4.3 配置域名 / 网络（三选一）

all-in-one 镜像**内置 caddy**（`caddy.auto.conf`），对外统一暴露 `:8080`，无需单独的 `Caddyfile`。
默认 HTTP（适配 Tailscale / 局域网）即开即用；需要浏览器绿锁时启用内置的 HTTPS 变体
（见 `caddy.auto.conf` 末尾注释：先 `tailscale cert 机器名.ts.net` 生成证书，再把 `:8080` 站点块
替换为域名站点块并带上 `tls` 证书路径，然后重新构建镜像）。

#### 方案 A · 公网域名（最标准，需能改 DNS）
把镜像内 caddy 的站点块改为你的域名（重建镜像，或在启动后挂载覆盖 `/etc/caddy/Caddyfile`），
Caddy 会自动申请并续期 Let's Encrypt 证书，访问 `https://dm.yourdomain.com`。
再把 `dm.yourdomain.com` 的 A 记录指向你家公网 IP，并在路由器转发 **80/443** 到 NAS（compose 的 `8080:8080` 映射改为对应端口）。

#### 方案 B · Tailscale（推荐家庭 NAS，免公网 IP / 免改路由器）
NAS 和你的每台设备都安装 Tailscale、登录同一账号，用机器名（如 `my-nas.ts.net`）访问。
由于 `*.ts.net` 不是公开可签发证书的域名，让 Caddy 用**自签名证书**即可（隧道本身已由 Tailscale 加密）：
在内置 caddy 配置站点块内加 `tls internal`，然后重建镜像。访问 `https://my-nas.ts.net`（首次浏览器/手机对自签名证书点一次「继续」即可）。

#### 方案 C · 仅局域网（最简，家人都在同一 WiFi）
不需要证书，直接走 HTTP（默认形态）：访问 `http://<NAS 内网 IP>:8080`。
> 注意：PWA「添加到主屏幕」需要 HTTPS。若想手机装成 App，请用方案 B（Tailscale + 自签名证书）。

### 4.4 首次启动

```bash
cd /path/to/dm-life
docker compose -f docker-compose.simple.yml up -d --build
```

首次构建会拉取 `node:22-slim` 等基础镜像并 `npm ci` + 前端 `vite build`，约几分钟。
构建完成后：

```bash
docker compose -f docker-compose.simple.yml ps   # 三个服务应为 Up（caddy/server/frontend）
docker compose -f docker-compose.simple.yml logs -f server   # 看后端是否成功监听 4100
```

### 4.5 日常访问

| 设备 | 操作 |
|---|---|
| 电脑浏览器 | 打开 `https://你的域名`（或 `http://NAS的IP`） |
| 手机（iOS/Android） | 浏览器打开同一地址 → 菜单「添加到主屏幕」→ 像原生 App 一样启动（PWA，离线可开） |
| 家庭成员 | 各自设备的浏览器/App 登录同一家庭空间即可共享任务、日历、财务 |

前端的 API 地址是**相对路径**，自动跟随你访问的域名，无需任何配置。

### 4.6 增量升级（不丢数据）

升级只重建镜像，**数据卷 `./data` 完全不动**，因此「升级不影响使用与数据」。

```bash
bash scripts/nas/upgrade.sh
```

该脚本会依次：`git pull`（非 git 仓库则跳过）→ 备份当前 `./data` → `docker compose build` → `docker compose up -d` → 清理旧镜像。
浏览器端也会在检测到后端要求的**最低前端版本**高于当前时，弹出**可关闭的升级提示横幅**（见第 5 节），但不会阻断使用。

### 4.7 备份与回滚

**备份**（保留最近 7 份，可改参数）：
```bash
bash scripts/nas/backup.sh 7        # 产出 backups/dm-life-data-<时间戳>.tar.gz
```

**回滚数据**：解包任一备份覆盖 `./data` 即可：
```bash
tar -xzf backups/dm-life-data-YYYYMMDD-HHMMSS.tar.gz -C ./data
docker compose restart
```

**回滚程序版本**：
```bash
git checkout <旧版本 tag/commit>
docker compose up -d --build
```

### 4.8 数据与目录结构

```
dm-life/
├── data/                      # ⚠️ 持久化数据（备份对象，docker 卷挂载于此）
│   └── server/                # PGlite 数据库文件（统一后端；默认落盘到 ~/.dm-life/data，可用 PGLITE_DIR / DATABASE_URL 覆盖）
├── backups/                   # 自动备份包（bash scripts/nas/backup.sh）
├── docker-compose.simple.yml
├── caddy.auto.conf
├── packages/...
└── scripts/nas/{backup,upgrade}.sh
```

`data/` 通过 `docker-compose.simple.yml` / `docker-compose.fnos.yml` 的 `volumes: ./data:/data` 挂载进容器，
镜像重建、容器删除都不会触碰它。最终架构只有一个数据卷（server 的 PGlite 库 + 自动密钥均落于此）。

#### 自定义数据目录位置（改 NAS 上的存放路径）

容器内数据目录**固定为 `/data`**，改不了（由 `apps/allinone/index.mjs` 的 `DM_LIFE_DATA_DIR || '/data'` 决定，并作为 `PGLITE_DIR` 传给 server；`db/index.ts` 见 `PGLITE_DIR` 即直接用）。你能改的只是「这个 `/data` 在 NAS 上落在哪个目录」——通过 compose 的卷映射决定。

**改法**：编辑 compose 的 `volumes`，把左边换成 NAS 上的绝对路径，**容器内 `/data` 保持不变**：

```yaml
services:
  dm-life:
    volumes:
      - /vol1/你的目录/dm-life-data:/data   # 左边换成你想放的 NAS 路径
```

- 若用 fnOS 的「容器 → 项目 / Compose」图形界面，在「装载路径 / 存储」一项把容器 `/data` 映射到 NAS 任意目录即可；若 UI 不暴露该映射，改用 SSH 进 NAS 在你想要的位置写 compose 再运行。
- **换目录后旧数据不会自动搬过来**：先 `docker compose down` → 把旧 `./data` 内容拷到新目录 → 再 `docker compose up -d`，否则会是一个全新空库（原数据仍在旧目录）。
- 开发机本地运行时，可用环境变量 `PGLITE_DIR`（或 `DATABASE_URL` 指向 Postgres、`~/.dm-life/config.json` 的 `pgliteDir`）覆盖，见第 2 节。

### 4.9 故障排查

| 现象 | 排查 |
|---|---|
| 页面打不开 | `docker compose -f docker-compose.simple.yml ps` 看 `frontend`/`caddy` 是否 Up；`docker compose logs -f caddy` |
| 添加任务无反应 | 后端健康：`curl http://<域名>/health`（就绪返回 `200 {status:"ok"}`，预热中返回 `503`）；`docker compose logs -f server` |
| 协作功能连不上 | 后端健康：`curl http://<域名>/health`；`docker compose logs -f server` |
| 端口 8080 被占 | 改 compose 里 `ports` 为其它宿主端口（如 `"8090:8080"`），或停掉占用 8080 的服务 |
| 证书报错 | 公网域名检查 DNS/端口转发；Tailscale/局域网改用 `tls internal` |
| 数据疑似丢失 | 确认没误删 `./data` 目录；从 `backups/` 恢复 |

---

### 4.10 fnOS / 任意 Docker 主机：免 git 直接拉镜像

如果你不想在 NAS 上 clone 仓库、也不想现场编译，可以用**预构建镜像**方案：本仓库已配置 GitHub Actions（`.github/workflows/publish.yml`），每次推送 `main` 都会自动把三个服务构建成 Docker 镜像并发布到 **GitHub Container Registry（GHCR）**。你只需在 fnOS 上拉取运行，全程不需要 git、不需要编译。

> 🔒 **安全红线（务必遵守）**
> 1. **GHCR 包保持私有，禁止翻 Public。** 公开包 + 自动拉取 `latest` 是供应链投毒的高危入口——一旦镜像源被攻破，所有部署会无声运行恶意版本。私有包即使被误推，外部也无法匿名拉取。
> 2. **镜像必须钉固到不可变标签 `:sha-<commit>` 或摘要 `:sha-<commit>@sha256:<digest>`，禁止使用 `:latest`。** `:latest` 可被覆盖，回滚/安全全靠不可变标签。
> 3. **必须设置 `JWT_SECRET`**，为强随机值（如 `openssl rand -base64 48`）。缺失时服务启动即失败（fail-closed）。联机版已无独立 engine，`ENGINE_API_TOKEN` 不再需要。
> 4. **已移除 watchtower 自动拉取 latest。** 升级改为手动：改代码 → `publish.yml` 推新 `:sha-<commit>` 镜像 → 改 compose 里的 sha 标签 → `docker compose up -d`。

镜像地址（**私有包，请用 PAT 登录拉取；标签钉固到 `:sha-<commit>`**）：

```
ghcr.io/dreamlark/dm-life:sha-<commit>   # 单镜像 all-in-one：server + web-collab 前端（PGlite / 可选 Postgres）
```

**部署步骤（fnOS「容器」→「项目 / Compose」）**

1. 在 NAS 上新建项目文件夹（如 `docker/dm-life`）。
2. 把本仓库根目录的 **`docker-compose.fnos.yml`** 放进该文件夹（all-in-one 镜像已内置 caddy，无需单独的 Caddyfile）。
3. 在该文件夹新建 **`.env`** 文件，写入：
   ```
   JWT_SECRET=<openssl rand -base64 48 的输出>
   DOMAIN=你的 Tailscale 机器名或域名
   ```
4. 把 `docker-compose.fnos.yml` 里单个 `image:` 的 `sha-REPLACE_ME` 改成你实际部署的 `:sha-<commit>`（在 GHCR 包页面的标签列表查看）。
5. 创建项目并启动。fnOS 会按 `image:` 直接从 GHCR 拉取该钉固标签的 all-in-one 镜像。

> 只有 `.env` 与 compose 文件需要你手动放到 NAS。其余全是拉取的镜像（含内置 caddy 与前端），没有源码。

**HTTPS（可选，已内置 caddy 的自动证书变体）**：all-in-one 镜像的 `caddy.auto.conf` 末尾已注释好 HTTPS 站点块
（见 `caddy.auto.conf` L43-54）。启用方式：先 `tailscale cert 机器名.ts.net` 生成证书，把 `:8080` 块替换为域名
站点块并带上 `tls` 证书路径，重新构建镜像（或挂载覆盖 `/etc/caddy/Caddyfile`）。默认 HTTP 形态（Tailscale / 局域网）
无需任何改动即可使用。

**升级**：`publish.yml` 会为每个 commit 推送不可变的 `:sha-<commit>` 镜像。升级时把 compose 里的 sha 标签改成新 commit，执行 `docker compose up -d` 即可；或用 `scripts/nas/upgrade.sh`。**不要**用 watchtower 自动拉取 `latest`。数据卷 `./data` 不参与镜像，安全不变。

**回滚到某个版本**：把 compose 里单个 `image:` 的 `:sha-<commit>` 改成历史某个具体 commit 标签，再重建项目即可。

**若拉取报 401/403**：说明镜像包未公开或未登录。解决方式（拉私有）：
- 在 fnOS「镜像 / 注册表」里登录 `ghcr.io`，用户名=`dreamlark`（或你的协作者账号），密码=带 `read:packages` 作用域的 PAT，再拉取。
- **切勿**把包翻成 Public——公开 + 可变标签是供应链风险，参考上方「安全红线」。

---

## 5. 增量升级机制（版本接口 + 横幅）

为满足「系统预留升级接口，增量升级不影响使用与数据」：

- **协作后端**新增 `GET /api/version`，返回：
  ```json
  { "backend": "x.y.z", "minFrontend": "x.y.z", "schema": 1 }
  ```
  同时 `/health`、`/ready` 响应附带 `schemaVersion`。
- **前端（web-collab）**启动即拉取该接口；仅当后端要求的 `minFrontend` 高于当前前端时才弹出**非致命、可关闭的黄色横幅**提示刷新/升级，**不阻断任何操作**。
- 数据层迁移框架（`BASELINE_DDL` + `MIGRATIONS` + `addColumnIfMissing`）保证旧库在升级后自动补齐新表/新列，向后兼容。

---

## 6. 金额互转（预留接口状态）

P3 已落地**完整的后端契约与写路径**，作为后续「金额互转/转账」功能的预留接口：

- 共享层：`transferCreate/List/Get/Reverse` Zod schema + `TransferView`、事件 `TransferCreated`/`TransferReversed`。
- 引擎表 `finance_transfers`：`amount_minor`（整数分，防浮点误差）+ `idempotency_key`（唯一约束，防重复提交）。
- 单一写路径：`repository`（幂等插入/列表/撤销）→ `command`（`writeTx` 双写事件）→ `appRouter` 注册 `finance.transfers` 子路由，并附转账幂等单测。
- **作用域边界**：当前只记转账事实，**不自动联动资产余额**（手动余额不被静默改写）。
- 通过 `featureFlags.transfer = false` 默认**关闭 UI**，等 P4 灰度开放。

> 即：接口与数据层已就位、测试通过，但前端转账界面尚未开放（P4 待做）。

---

## 7. 已知坑与注意事项

1. **（联机后端）PGlite 文件型数据库**：`server` 默认用 PGlite（纯文件，免外部数据库）；可用 `DATABASE_URL` 指向真实 Postgres 切换为生产库。数据落在 `./data`（容器内 `/data`）。
2. **tRPC v11 输入格式**：无 transformer 时 batch body 为「按下标编号的对象」`{"0":{...}}`，**不是** `[{json:{...}}]`（那是数组写法，会被判为非法）。联机版 `server` 与此一致。
3. **实时通道用 WebSocket（`/ws`）**：联机版实时刷新走 `server` 的 WebSocket 网关（前端 `useEventStreamLocal` 订阅）。
4. **后端端口**：`server` 固定 4100（可用 `PORT` 覆盖）；all-in-one 镜像经内置 caddy 对外暴露 8080。本机开发（server:4100 + web-collab:5173）用 `npm run dev` 一键拉起。
5. **Docker daemon 不可达的沙箱**：本仓库是在代码层（vitest + tsc + vite build）充分验证的；镜像构建/compose 实测需在你自己的 NAS 上执行 `docker compose up -d --build`（YAML/bash 已通过语法校验）。
6. **`npm ci` 需要 `package-lock.json`**：仓库已包含，切勿在部署前删除。

---

## 8. 延期项

- **P4 转账前端 UI**：把 `transfer` feature flag 翻为 `true` 灰度开放（后端已就绪）。
- **Tauri 原生构建（已移除）**：原 `apps/desktop` Tauri 壳已从最终架构移除；移动端走 PWA 已可用，无需原生壳。
- **知识库 embedder 热替换**：可换神经网络模型（transformers.js / 外部 API），检索链路无需改动。
- **旧双后端工作版已归档**：旧 engine/server 双后端实现保留在仓库 `archived/` 与 `docs/archive/` 下可回溯。
- **M3+**：笔记相册 / 账本可视化 / 离线更深度的 PWA。

---

> 部署出问题？先看第 4.9 节故障排查；仍卡住就把 `docker compose logs -f <服务>` 的输出贴给我。
