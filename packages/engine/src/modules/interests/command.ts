import { nanoid } from 'nanoid';
import { writeTx } from '../../db/client';
import { appendEvent } from '../../events/EventStore';
import { eventBus } from '../../eventbus/EventBus';
import * as repo from './repository';
import * as tasksCommand from '../tasks/command';
import * as projectsCommand from '../projects/command';
import {
  captureInterestSchema,
  updateInterestSchema,
  setInterestStatusSchema,
  validateInterestSchema,
  convertInterestSchema,
  interestReviewQuerySchema,
  type InterestView,
  type InterestReviewQuery,
} from '@dm-life/shared';

/** 捕捉一条灵感/兴趣：先落入孵化器，不直接进任务/笔记。走事件溯源单一写路径。 */
export function captureInterest(input: unknown): InterestView {
  const data = captureInterestSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.insertInterest({
      id,
      title: data.title,
      content: data.content ?? '',
      attention: data.attention ?? 1,
      sourceType: data.sourceType ?? 'manual',
      sourceRef: data.sourceRef ?? null,
      domainKey: data.domainKey ?? null,
      effortBudget: data.effortBudget ?? 'tbd',
      now,
    });
    return appendEvent({
      type: 'InterestCaptured',
      payload: {
        interestId: id,
        title: data.title,
        domainKey: data.domainKey ?? null,
        sourceType: data.sourceType ?? 'manual',
        sourceRef: data.sourceRef ?? null,
      },
    });
  });

  eventBus.publish(env);
  return repo.getInterestView(id)!;
}

export function updateInterest(input: unknown): InterestView {
  const data = updateInterestSchema.parse(input);
  const { id, ...rest } = data;
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) changes[k] = v;
  }

  const env = writeTx(() => {
    repo.updateInterestFields(id, rest);
    return appendEvent({ type: 'InterestUpdated', payload: { interestId: id, changes } });
  });

  eventBus.publish(env);
  return repo.getInterestView(id)!;
}

/** 归档 / 丢弃（验证/转化用专用命令） */
export function setStatus(input: unknown): InterestView {
  const { id, status } = setInterestStatusSchema.parse(input);
  const env = writeTx(() => {
    repo.setStatus(id, status);
    return appendEvent({
      type: 'InterestStatusChanged',
      payload: { interestId: id, status, linkedTaskId: null, linkedProjectId: null },
    });
  });
  eventBus.publish(env);
  return repo.getInterestView(id)!;
}

/** 立即验证：系统建一个极小验证任务，并标记该兴趣已验证、双向关联。 */
export function validateInterest(input: unknown): InterestView {
  const { id } = validateInterestSchema.parse(input);
  const interest = repo.getInterest(id);
  if (!interest) throw new Error('兴趣不存在');

  const task = tasksCommand.createTask({
    title: `验证「${interest.title}」：花 30 分钟搜集资料`,
    domainKey: interest.domainKey ?? 'work',
  });

  const env = writeTx(() => {
    repo.setStatus(id, 'validated', task.id, null);
    return appendEvent({
      type: 'InterestStatusChanged',
      payload: { interestId: id, status: 'validated', linkedTaskId: task.id, linkedProjectId: null },
    });
  });
  eventBus.publish(env);
  return repo.getInterestView(id)!;
}

/** 转化为项目：系统建一个 PARA 项目，并标记该兴趣已转化、双向关联。 */
export function convertInterest(input: unknown): InterestView {
  const { id, name } = convertInterestSchema.parse(input);
  const interest = repo.getInterest(id);
  if (!interest) throw new Error('兴趣不存在');

  const project = projectsCommand.createProject({
    name: name ?? interest.title,
    paraType: 'project',
  });

  const env = writeTx(() => {
    repo.setStatus(id, 'converted', null, project.id);
    return appendEvent({
      type: 'InterestStatusChanged',
      payload: { interestId: id, status: 'converted', linkedTaskId: null, linkedProjectId: project.id },
    });
  });
  eventBus.publish(env);
  return repo.getInterestView(id)!;
}

export function recordView(input: unknown): InterestView {
  const { id } = (input as { id: string });
  repo.incrementView(id);
  return repo.getInterestView(id)!;
}

export function listInterests(filter?: { status?: InterestView['status'] }): InterestView[] {
  return repo.listInterests(filter);
}

export function review(query: InterestReviewQuery = {}): InterestView[] {
  const q = interestReviewQuerySchema.parse(query ?? {});
  return repo.review(q.status ? { status: q.status } : undefined);
}
