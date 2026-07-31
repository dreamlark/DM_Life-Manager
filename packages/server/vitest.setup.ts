// 测试环境专用配置：
// 1) 放宽限流阈值。限流按客户端 IP 分流，而单测通过 appRouter.createCaller 直连、无真实 IP
//    （ctx.ip=unknown），所有调用落在同一 rl:*:unknown 桶，既有用例（多次 register/login）会很快
//    撞上生产默认上限。这里在 router 模块加载前把阈值调高，仅作用于测试；限流核心逻辑由
//    rate-limit.test.ts 用显式小阈值直接覆盖，不受此处影响。生产默认（10/20/60）保持不变。
// 2) 测试隔离：为每个 vitest worker 进程分配唯一临时数据目录（PGLITE_DIR），避免并行测试文件
//    共享同一 PGlite 文件库导致锁竞争 / 数据污染（与 engine 的 DM_LIFE_DATA_DIR 隔离策略一致；
//    server 的 resolveDataDir 优先读取 PGLITE_DIR）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.RATE_REGISTER_LIMIT = process.env.RATE_REGISTER_LIMIT ?? '100000';
process.env.RATE_LOGIN_LIMIT = process.env.RATE_LOGIN_LIMIT ?? '100000';
process.env.RATE_REFRESH_LIMIT = process.env.RATE_REFRESH_LIMIT ?? '100000';

if (process.env.VITEST) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-life-server-test-'));
  process.env.PGLITE_DIR = dir;
}
