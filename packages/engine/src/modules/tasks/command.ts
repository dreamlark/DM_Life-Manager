import { nanoid } from 'nanoid';
import { writeTx } from '../../db/client';
import { appendEvent } from '../../events/EventStore';
import { eventBus } from '../../eventbus/EventBus';
import * as repo from './repository';
import * as flowRepo from '../flow/repository';
import {
  createTaskSchema,
  completeTaskSchema,
  uncompleteTaskSchema,
  updateTaskSchema,
  setQuadrantSchema,
  scheduleTaskSchema,
  setMitSchema,
  deleteTaskSchema,
  ensureDailySchema,
  DOMAIN_KEYS,
  type TaskPriority,
  type TaskView,
} from '@dm-life/shared';

/**
 * 单一写路径：Zod 校验 → db.transaction(append事件 + 更新实体) → eventBus.publish。
 * 前端只发命令，绝不直接写实体表。
 */

export function createTask(input: unknown): TaskView {
  const data = createTaskSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();
  // 非每日例行任务默认归属当天；每日例行模板 taskDate 置空（由 ensureDaily 实例化到具体日期）
  const taskDate = data.taskDate ?? (data.repeat === 'daily' ? null : repo.todayStr());

  const env = writeTx(() => {
    repo.insertTask({ id, ...data, taskDate, now });
    return     appendEvent({
      type: 'TaskCreated',
      payload: {
        taskId: id,
        title: data.title,
        domainKey: data.domainKey,
        projectId: data.projectId ?? null,
        importance: data.importance,
        urgency: data.urgency,
        isMit: data.isMit,
        mitOrder: data.mitOrder ?? null,
        scheduledStart: data.scheduledStart ?? null,
        scheduledEnd: data.scheduledEnd ?? null,
        dueAt: data.dueAt ?? null,
        description: data.description,
        priority: data.priority,
      },
    });
  });

  eventBus.publish(env);
  return repo.getTask(id)!;
}

export function completeTask(input: unknown): TaskView {
  const { id, quality } = completeTaskSchema.parse(input);
  const completedAt = new Date().toISOString();
  // 注意力峰值：该任务绑定的 flow 专注时段最高评分（无则 null）
  const attentionPeak = flowRepo.getPeakScoreForTask(id);

  const env = writeTx(() => {
    repo.markComplete(id, completedAt, quality ?? null, attentionPeak);
    return appendEvent({
      type: 'TaskCompleted',
      payload: { taskId: id, completedAt, quality: quality ?? null, attentionPeak },
    });
  });

  eventBus.publish(env);
  return repo.getTask(id)!;
}

/** 取消完成：与 completeTask 对称，把状态回退为 todo，写 TaskUncompleted 事件。 */
export function uncompleteTask(input: unknown): TaskView {
  const { id } = uncompleteTaskSchema.parse(input);

  const env = writeTx(() => {
    repo.markIncomplete(id);
    return appendEvent({
      type: 'TaskUncompleted',
      payload: { taskId: id },
    });
  });

  eventBus.publish(env);
  return repo.getTask(id)!;
}

export function setQuadrant(input: unknown): TaskView {
  const data = setQuadrantSchema.parse(input);

  const env = writeTx(() => {
    repo.updateQuadrant(data.id, data.importance, data.urgency);
    return appendEvent({
      type: 'TaskQuadrantChanged',
      payload: { taskId: data.id, importance: data.importance, urgency: data.urgency },
    });
  });

  eventBus.publish(env);
  return repo.getTask(data.id)!;
}

export function scheduleTask(input: unknown): TaskView {
  const data = scheduleTaskSchema.parse(input);

  const env = writeTx(() => {
    repo.updateSchedule(data.id, data.scheduledStart, data.scheduledEnd);
    return appendEvent({
      type: 'TaskScheduled',
      payload: { taskId: data.id, scheduledStart: data.scheduledStart, scheduledEnd: data.scheduledEnd },
    });
  });

  eventBus.publish(env);
  return repo.getTask(data.id)!;
}

export function listToday(date?: string): TaskView[] {
  return repo.listForDate(date ?? repo.todayStr());
}

/** 每日例行：把 daily 模板实例化到指定日期（已存在则跳过）。走单一写路径。 */
export function ensureDaily(input: unknown): void {
  const { date } = ensureDailySchema.parse(input);
  const envs = writeTx(() => {
    const out: ReturnType<typeof appendEvent>[] = [];
    for (const t of repo.listDailyTemplates()) {
      if (repo.hasInstance(t.id, date)) continue;
      const id = nanoid();
      const now = new Date().toISOString();
      const priority = (t.priority as TaskPriority) ?? 'medium';
      repo.insertTask({
        id,
        title: t.title,
        domainKey: (t.domainKey ?? 'work') as (typeof DOMAIN_KEYS)[number],
        projectId: t.projectId,
        importance: !!t.importance,
        urgency: !!t.urgency,
        isMit: false,
        mitOrder: null,
        scheduledStart: t.scheduledStart,
        scheduledEnd: t.scheduledEnd,
        dueAt: null,
        description: t.description ?? '',
        priority,
        taskDate: date,
        repeat: 'none',
        sourceDailyId: t.id,
        now,
      });
      out.push(
        appendEvent({
          type: 'TaskCreated',
          payload: {
            taskId: id,
            title: t.title,
            domainKey: (t.domainKey ?? 'work') as (typeof DOMAIN_KEYS)[number],
            projectId: t.projectId,
            importance: !!t.importance,
            urgency: !!t.urgency,
            isMit: false,
            mitOrder: null,
            scheduledStart: t.scheduledStart,
            scheduledEnd: t.scheduledEnd,
            dueAt: null,
            description: t.description ?? '',
            priority,
          },
        }),
      );
    }
    return out;
  });
  for (const env of envs) eventBus.publish(env);
}

export function listAll(): TaskView[] {
  return repo.listAll();
}

export function setMit(input: unknown): TaskView {
  const data = setMitSchema.parse(input);

  const env = writeTx(() => {
    repo.updateMit(data.id, data.isMit, data.mitOrder ?? null);
    return appendEvent({
      type: 'TaskQuadrantChanged',
      payload: { taskId: data.id, importance: false, urgency: false },
    });
  });

  eventBus.publish(env);
  return repo.getTask(data.id)!;
}

/** 编辑任务：仅回写显式传入的字段，走事件溯源单一写路径。 */
export function updateTask(input: unknown): TaskView {
  const data = updateTaskSchema.parse(input);
  const { id, ...rest } = data;
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) changes[k] = v;
  }

  const env = writeTx(() => {
    repo.updateTaskFields(id, rest);
    return appendEvent({ type: 'TaskUpdated', payload: { taskId: id, changes } });
  });

  eventBus.publish(env);
  return repo.getTask(id)!;
}

export function deleteTask(input: unknown): void {
  const { id } = deleteTaskSchema.parse(input);
  const task = repo.getTask(id);
  if (!task) return; // 幂等：已删除则无操作

  const env = writeTx(() => {
    repo.deleteTask(id);
    return appendEvent({
      type: 'TaskDeleted',
      payload: { taskId: id, title: task.title },
    });
  });

  eventBus.publish(env);
}
