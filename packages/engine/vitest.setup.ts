import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 测试隔离：vitest 默认以独立 worker 进程运行每个测试文件，
 * 这里为每个进程分配一个唯一的临时数据目录（DM_LIFE_DATA_DIR），
 * 避免并行测试共享同一 db 文件导致数据互相污染
 * （此前 notes-pressure 偶发失败即源于此）。
 */
if (process.env.VITEST) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-life-test-'));
  process.env.DM_LIFE_DATA_DIR = dir;
}
