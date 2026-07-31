import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { events, tasks } from '../db/schema';
import { migrate } from '../db/migrate';
import { initDb, dbPath } from '../db/client';
import { eventBus } from '../eventbus/EventBus';
import * as tasksCommand from '../modules/tasks/command';
import fs from 'node:fs';

function counts() {
  const e = (db.select().from(events).all() as unknown[]).length;
  const t = (db.select().from(tasks).all() as unknown[]).length;
  return { e, t };
}

describe('单一写路径：事务内双写一致 + 事件驱动', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath); // 干净的库，避免跨 run 累积
    await initDb();
    migrate();
  });

  it('createTask 同时写入 events 与 tasks，并触发 EventBus', () => {
    const before = counts();
    let published = false;
    const unsub = eventBus.subscribe(() => {
      published = true;
    });

    const task = tasksCommand.createTask({
      title: '单元测试任务',
      domainKey: 'work',
      importance: true,
      urgency: false,
      isMit: true,
      mitOrder: 0,
    });

    unsub();
    const after = counts();
    expect(after.t).toBe(before.t + 1);
    expect(after.e).toBe(before.e + 1);

    const all = db.select().from(events).all() as Array<{ type: string }>;
    expect(all.some((x) => x.type === 'TaskCreated')).toBe(true);
    expect(task.status).toBe('todo');
    expect(task.isMit).toBe(true);
    expect(task.quadrant).toBe('q2');
    expect(published).toBe(true);
  });

  it('completeTask 在同事务写入 TaskCompleted 且实体 status=done', () => {
    const before = counts();
    const task = tasksCommand.createTask({ title: '待完成', domainKey: 'health' });
    tasksCommand.completeTask({ id: task.id });
    const after = counts();
    expect(after.e).toBe(before.e + 2); // created + completed

    const row = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .get() as { status: string; completed_at: string | null };
    expect(row.status).toBe('done');
    expect(row.completed_at).not.toBeNull();
  });

  it('uncompleteTask 把 status 回退为 todo 并清空完成指标', () => {
    const task = tasksCommand.createTask({ title: '完成后再取消', domainKey: 'work' });
    tasksCommand.completeTask({ id: task.id, quality: 4 });
    tasksCommand.uncompleteTask({ id: task.id });
    const row = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .get() as {
      status: string;
      completed_at: string | null;
      completion_quality: number | null;
      attention_peak: number | null;
    };
    expect(row.status).toBe('todo');
    // sql.js 的 NULL 经 drizzle 读出为 undefined，验证"清空"而非原值残留
    expect(row.completed_at).toBeUndefined();
    expect(row.completion_quality).toBeUndefined();
    expect(row.attention_peak).toBeUndefined();
  });
});
