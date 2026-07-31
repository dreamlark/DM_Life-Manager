import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, dbPath } from '../../../db/client';
import { migrate } from '../../../db/migrate';
import { seedDomains } from '../../../db/seed';
import * as domainsRepo from '../repository';
import * as tasksCommand from '../../tasks/command';
import * as flowCommand from '../../flow/command';
import fs from 'node:fs';

describe('领域模块：完整聚合 + 平衡轮', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { recursive: true, force: true });
    await initDb();
    migrate();
    seedDomains(); // migrate 仅建表，领域种子在引擎启动时调用，测试需显式触发
  });

  it('summary 在干净数据（仅种子 9 领域、无任务/无专注）时全为 0', () => {
    const s = domainsRepo.summary();
    expect(s).toHaveLength(9);
    for (const d of s) {
      expect(d.taskTotal).toBe(0);
      expect(d.taskDone).toBe(0);
      expect(d.taskActive).toBe(0);
      expect(d.focusMinutes).toBe(0);
      expect(d.doneRate).toBe(0);
    }
    // 季度聚焦域存在
    expect(s.some((d) => d.key === 'quarter' && d.isQuarterFocus)).toBe(true);
  });

  it('summary 正常：work 下 1 完成 / 1 进行中 / 1 待办 → 聚合正确', () => {
    const t1 = tasksCommand.createTask({ title: '待完成任务', domainKey: 'work' });
    const t2 = tasksCommand.createTask({ title: '进行中任务', domainKey: 'work' });
    const t3 = tasksCommand.createTask({ title: '待办任务', domainKey: 'work' });
    tasksCommand.completeTask({ id: t1.id }); // → done
    tasksCommand.updateTask({ id: t2.id, status: 'doing' }); // → doing

    const work = domainsRepo.summary().find((d) => d.key === 'work')!;
    expect(work.taskTotal).toBe(3);
    expect(work.taskDone).toBe(1);
    expect(work.taskActive).toBe(2); // doing + todo
    expect(work.doneRate).toBeCloseTo(1 / 3, 5);

    // 其它领域未受影响
    const health = domainsRepo.summary().find((d) => d.key === 'health')!;
    expect(health.taskTotal).toBe(0);
  });

  it('summary focusMinutes：work 累计专注 30+60 分钟被正确汇总（日期落在平衡轮测试周之外）', () => {
    flowCommand.recordSession({
      domainKey: 'work',
      startedAt: '2026-06-01T09:00:00.000Z',
      endedAt: '2026-06-01T09:30:00.000Z', // 30 min
    });
    flowCommand.recordSession({
      domainKey: 'work',
      startedAt: '2026-06-01T10:00:00.000Z',
      endedAt: '2026-06-01T11:00:00.000Z', // 60 min
    });

    const work = domainsRepo.summary().find((d) => d.key === 'work')!;
    expect(work.focusMinutes).toBe(90);
  });

  it('balanceWheel 正常：周 2026-07-13 内 work 专注 60 分钟 → 满分 100', () => {
    flowCommand.recordSession({
      domainKey: 'work',
      startedAt: '2026-07-14T09:00:00.000Z',
      endedAt: '2026-07-14T10:00:00.000Z', // 60 min，落在窗口内
    });

    const r = domainsRepo.balanceWheel('2026-07-13');
    expect(r.week).toBe('2026-07-13');
    expect(r.domainMinutes['work']).toBe(60);
    const work = r.wheel.find((w) => w.key === 'work')!;
    expect(work.minutes).toBe(60);
    expect(work.score).toBe(100); // 当周唯一有投入，满分
  });

  it('balanceWheel 多领域归一化：health 30 / work 60 → health 得分 50、work 100', () => {
    flowCommand.recordSession({
      domainKey: 'health',
      startedAt: '2026-07-15T09:00:00.000Z',
      endedAt: '2026-07-15T09:30:00.000Z', // 30 min
    });

    const r = domainsRepo.balanceWheel('2026-07-13');
    const work = r.wheel.find((w) => w.key === 'work')!;
    const health = r.wheel.find((w) => w.key === 'health')!;
    expect(work.minutes).toBe(60);
    expect(health.minutes).toBe(30);
    expect(work.score).toBe(100);
    expect(health.score).toBe(50);
  });

  it('balanceWheel 边界：专注落在窗口外（周日之前 / 下周一及之后）被排除', () => {
    flowCommand.recordSession({
      domainKey: 'work',
      startedAt: '2026-07-12T09:00:00.000Z', // 窗口前 1 天
      endedAt: '2026-07-12T11:00:00.000Z', // 120 min，应排除
    });
    flowCommand.recordSession({
      domainKey: 'work',
      startedAt: '2026-07-20T00:00:00.000Z', // 下周一 00:00（窗口右开边界）
      endedAt: '2026-07-20T02:00:00.000Z', // 应排除
    });

    const r = domainsRepo.balanceWheel('2026-07-13');
    // work 当周投入仍为之前插入的 60 分钟，外部两笔不计
    expect(r.domainMinutes['work']).toBe(60);
  });

  it('balanceWheel 边界：空周（无专注）→ 全 0，topStresses 由开放任务推导', () => {
    const r = domainsRepo.balanceWheel('2026-05-04');
    for (const w of r.wheel) {
      expect(w.minutes).toBe(0);
      expect(w.score).toBe(0);
    }
    // work 当前有 2 个开放任务（doing+todo），应出现在压力代理中
    expect(r.topStresses).toContain('work');
    expect(r.topStresses.length).toBeGreaterThanOrEqual(1);
  });

  it('topStresses 排序：开放任务更多的领域排在前面', () => {
    tasksCommand.createTask({ title: '健康开放', domainKey: 'health' }); // 默认 todo（开放）
    const r = domainsRepo.balanceWheel('2026-05-04');
    // work 开放 2（doing+todo），health 开放 1 → work 在前
    expect(r.topStresses[0]).toBe('work');
    expect(r.topStresses).toContain('health');
  });

  it('balanceWheel 异常：非法 week 格式直接抛错', () => {
    expect(() => domainsRepo.balanceWheel('2026-7-13')).toThrow();
    expect(() => domainsRepo.balanceWheel('abc')).toThrow();
    expect(() => domainsRepo.balanceWheel('2026/07/13')).toThrow();
  });
});
