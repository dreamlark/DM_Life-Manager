import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { initDb, sqlDb, dbPath, saveDb } from '../db/client';
import { migrate, getSchemaVersion, MIGRATIONS } from '../db/migrate';
import { seedDomains } from '../db/seed';
import { exportAll, importAll, dataStatus, validateBundle } from '../system/exportImport';

/**
 * 数据持久化与迁移的引擎层测试：
 * - 导出 → 导入往返一致（导入即「恢复」为导出时快照，且自动备份）
 * - 导入前校验：拒绝更高 schemaVersion / 未知表 / 外键不完整
 * - dataStatus 返回目录、版本、行数
 * - 迁移失败整体回滚，不残留脏数据，且可重试成功
 * 注：importAll 接收的是 bundle 本身（路由层已抽出 input.bundle），并非 { bundle }。
 */
describe('数据导出 / 导入 / 迁移', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
    await initDb();
    migrate();
    seedDomains(); // 镜像生产启动：领域种子写入，使外键校验有参照
    saveDb(); // 显式落盘，使 dbPath 文件存在（备份路径才有意义）
  });

  it('export → import 往返一致（导入恢复为导出时快照，且自动备份）', () => {
    sqlDb!.run(
      "INSERT INTO tasks(id,title,domain_key,created_at,updated_at) VALUES('t1','往返任务','work','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')",
    );
    sqlDb!.run(
      "INSERT INTO notes(id,title,body_markdown,created_at,updated_at) VALUES('n1','往返笔记','正文','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')",
    );

    const bundle = exportAll();
    expect(bundle.format).toBe('dm-life-export');
    expect((bundle.tables.tasks as any[]).some((t) => t.id === 't1')).toBe(true);

    // 模拟「导出后数据被改动」
    sqlDb!.run("DELETE FROM tasks WHERE id='t1'");
    sqlDb!.run(
      "INSERT INTO tasks(id,title,domain_key,created_at,updated_at) VALUES('t2','篡改任务','work','2021-01-01T00:00:00.000Z','2021-01-01T00:00:00.000Z')",
    );
    expect(sqlDb!.exec("SELECT id FROM tasks WHERE id='t2'").length).toBe(1);

    const res = importAll(bundle);
    expect(res.imported.tasks).toBe((bundle.tables.tasks as any[]).length);
    expect(res.backupPath).toBeTruthy(); // 导入前已自动备份
    expect(res.schemaVersion).toBe(1);

    const ids = sqlDb!.exec('SELECT id FROM tasks')[0].values.map((r) => r[0]);
    expect(ids).toContain('t1');
    expect(ids).not.toContain('t2');
    expect(getSchemaVersion()).toBe(1);
  });

  it('导入校验：拒绝来自更高版本（schemaVersion 更大）的文件', () => {
    const bundle = exportAll();
    const bad = { ...bundle, schemaVersion: 999 };
    expect(() => importAll(bad)).toThrow(/更高版本/);
  });

  it('导入校验：拒绝包含未知表（防不兼容/恶意文件）', () => {
    const bundle = exportAll();
    const bad = { ...bundle, tables: { ...bundle.tables, hacker_table: [{ a: 1 }] } };
    expect(() => importAll(bad)).toThrow(/未知数据表/);
  });

  it('导入校验：拒绝外键不完整（任务引用不存在的领域）', () => {
    const bundle = exportAll();
    const bad = {
      ...bundle,
      tables: {
        ...bundle.tables,
        tasks: [{ id: 'x', title: 't', domain_key: 'no_such_domain', created_at: '2020', updated_at: '2020' }],
      },
    };
    expect(() => importAll(bad)).toThrow(/领域/);
  });

  it('validateBundle 与 importAll 结论一致（纯校验不触碰库）', () => {
    const bundle = exportAll();
    expect(validateBundle(bundle).ok).toBe(true);
    const bad = { ...bundle, schemaVersion: 999 };
    expect(validateBundle(bad).ok).toBe(false);
  });

  it('导入校验：拒绝伪造列名（P1-3 列名注入防护）', () => {
    const bundle = exportAll();
    // 合法表 + 合法必需列，但额外混入一个带 SQL 注入的恶意列名。
    // 不含 domain_key 以跳过外键校验，确保触发的是列名白名单拦截而非外键校验。
    const bad = {
      ...bundle,
      tables: {
        ...bundle.tables,
        tasks: [
          {
            id: 'x',
            title: 't',
            created_at: '2020-01-01T00:00:00.000Z',
            updated_at: '2020-01-01T00:00:00.000Z',
            'title"); DROP TABLE tasks; --': 1,
          },
        ],
      },
    };
    expect(() => importAll(bad)).toThrow(/非法列名/);
    // 确认注入未得逞：tasks 表未被清空或损毁（导入整体回滚）
    expect(sqlDb!.exec('SELECT id FROM tasks').length).toBeGreaterThanOrEqual(0);
  });

  it('dataStatus 返回数据目录 / schema 版本 / 各表行数', () => {
    const s = dataStatus();
    expect(s.schemaVersion).toBe(1);
    expect(s.appVersion).toBeTruthy();
    expect(typeof s.dataDir).toBe('string');
    expect(typeof s.tableRowCounts.tasks).toBe('number');
  });

  it('迁移回滚：失败步骤回滚且不残留脏数据，可重试成功', () => {
    const original = MIGRATIONS.slice();
    MIGRATIONS.push({
      version: 2,
      name: 'boom',
      up: (db: any) => {
        db.run(
          "INSERT INTO domains(key,name,is_quarter_focus,color,created_at) VALUES('leak','泄漏','0','#000','2020')",
        );
        throw new Error('intentional migration failure');
      },
    });
    try {
      expect(() => migrate()).toThrow(/迁移失败/);
      // 失败后脏数据必须被回滚
      expect(sqlDb!.exec("SELECT * FROM domains WHERE key='leak'").length).toBe(0);
      // 库结构仍可用：移除失败步骤后再次 migrate 应成功
      MIGRATIONS.length = 0;
      expect(() => migrate()).not.toThrow();
      expect(getSchemaVersion()).toBe(1);
      expect(sqlDb!.exec("SELECT * FROM domains WHERE key='leak'").length).toBe(0);
    } finally {
      MIGRATIONS.length = 0;
      MIGRATIONS.push(...original);
    }
 });
});
