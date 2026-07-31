import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, dbPath } from '../../../db/client';
import { migrate } from '../../../db/migrate';
import { seedDomains } from '../../../db/seed';
import * as tasksCommand from '../command';
import { listForDate } from '../repository';
import fs from 'node:fs';

describe('任务模块：每日例行 + 按日期/重要度排序', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { recursive: true, force: true });
    await initDb();
    migrate();
    seedDomains();
  });

  it('每日例行模板不进看板，但 ensureDaily 会实例化到指定日期', () => {
    const tpl = tasksCommand.createTask({
      title: '晨练',
      domainKey: 'health',
      repeat: 'daily',
      importance: true,
      urgency: false,
    });
    expect(tpl.repeat).toBe('daily');
    expect(tpl.taskDate).toBeNull();

    // 看板（默认今日）不应包含每日模板本身
    const boardToday = listForDate('2026-07-14');
    expect(boardToday.find((t) => t.id === tpl.id)).toBeUndefined();

    // ensureDaily 把模板实例化到 2026-07-14
    tasksCommand.ensureDaily({ date: '2026-07-14' });
    const board = listForDate('2026-07-14');
    const inst = board.find((t) => t.title === '晨练');
    expect(inst).toBeDefined();
    expect(inst!.repeat).toBe('none');
    expect(inst!.sourceDailyId).toBe(tpl.id);
    expect(inst!.taskDate).toBe('2026-07-14');

    // 幂等：再次 ensureDaily 不重复生成
    tasksCommand.ensureDaily({ date: '2026-07-14' });
    expect(listForDate('2026-07-14').filter((t) => t.title === '晨练')).toHaveLength(1);
  });

  it('listForDate 按重要程度降序、同重要按计划时间升序', () => {
    const date = '2026-07-15';
    tasksCommand.createTask({ title: '低优先-晚', domainKey: 'work', importance: false, urgency: false, taskDate: date, scheduledStart: '2026-07-15T18:00:00' });
    tasksCommand.createTask({ title: '低优先-早', domainKey: 'work', importance: false, urgency: false, taskDate: date, scheduledStart: '2026-07-15T09:00:00' });
    tasksCommand.createTask({ title: '高优先-晚', domainKey: 'work', importance: true, urgency: true, taskDate: date, scheduledStart: '2026-07-15T20:00:00' });
    tasksCommand.createTask({ title: '高优先-早', domainKey: 'work', importance: true, urgency: true, taskDate: date, scheduledStart: '2026-07-15T08:00:00' });

    const board = listForDate(date);
    const order = board.map((t) => t.title);
    // 高优先（q1）整体在前面，且各自内部按时间升序
    const hiIdx = order.findIndex((n) => n.startsWith('高优先'));
    const loIdx = order.findIndex((n) => n.startsWith('低优先'));
    expect(hiIdx).toBeLessThan(loIdx);
    expect(order[hiIdx]).toBe('高优先-早');
    expect(order[hiIdx + 1]).toBe('高优先-晚');
    expect(order[loIdx]).toBe('低优先-早');
    expect(order[loIdx + 1]).toBe('低优先-晚');
  });

  it('非今日日期的任务不计入今日看板（按日期过滤）', () => {
    tasksCommand.createTask({ title: '明天的事情', domainKey: 'work', taskDate: '2026-07-20' });
    const tomorrow = listForDate('2026-07-20');
    expect(tomorrow.find((t) => t.title === '明天的事情')).toBeDefined();
    // 今天（非 2026-07-20）不应出现
    const todayBoard = listForDate('2026-07-14');
    expect(todayBoard.find((t) => t.title === '明天的事情')).toBeUndefined();
  });
});
