import { nanoid } from 'nanoid';
import { writeTx } from '../../db/client';
import { appendEvent } from '../../events/EventStore';
import { eventBus } from '../../eventbus/EventBus';
import * as repo from './repository';
import {
  recordFocusSessionSchema,
  type RecordFocusSessionInput,
  type FlowSummaryQuery,
} from '@dm-life/shared';

/**
 * 记录一次专注时段评估。
 * 走事件溯源单一写路径：事务双写(focus_sessions 实体 + events) → EventBus → SSE → 前端失效刷新。
 */
export function recordSession(input: unknown): string {
  const data = recordFocusSessionSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();
  const interruptionsJson = JSON.stringify(data.interruptions ?? []);

  const env = writeTx(() => {
    repo.insertSession({
      id,
      taskId: data.taskId ?? null,
      domainKey: data.domainKey ?? null,
      projectId: data.projectId ?? null,
      attentionType: data.attentionType,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      score: data.score ?? null,
      energyStart: data.energyStart ?? null,
      energyEnd: data.energyEnd ?? null,
      interruptions: interruptionsJson,
      note: data.note ?? null,
      now,
    });
    return appendEvent({
      type: 'FocusSessionRecorded',
      payload: {
        sessionId: id,
        taskId: data.taskId ?? null,
        domainKey: data.domainKey ?? null,
        projectId: data.projectId ?? null,
        attentionType: data.attentionType,
        score: data.score ?? null,
        startedAt: data.startedAt,
        endedAt: data.endedAt,
      },
    });
  });

  eventBus.publish(env);
  return id;
}

/** 最近专注时段列表（只读，不走写事务） */
export function listSessions(): ReturnType<typeof repo.listSessions> {
  return repo.listSessions(50);
}

/** 热力图 + 能量/注意力序列 + 洞察 + 低压强提醒 */
export function summarize(query: FlowSummaryQuery): ReturnType<typeof repo.summarize> {
  return repo.summarize(query);
}
