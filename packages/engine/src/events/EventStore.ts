import { nanoid } from 'nanoid';
import { db } from '../db/client';
import { events } from '../db/schema';
import type { AppEvent, EventEnvelope } from '@dm-life/shared';

/** 从事件载荷推断聚合根 id（事件表里 aggregate_id 用于索引回放） */
function inferAggregateId(payload: AppEvent['payload']): string {
  const p = payload as unknown as Record<string, unknown>;
  return String(
    p.taskId ??
      p.projectId ??
      p.noteId ??
      p.key ??
      p.debtId ??
      p.incomeId ??
      p.transactionId ??
      p.assetId ??
      p.budgetId ??
      p.reminderId ??
      'unknown',
  );
}

/**
 * 仅追加写入 events 表。必须在调用方的 db.transaction() 内执行，
 * 与实体仓库的更新构成原子双写（ADR-002）。
 */
export function appendEvent(
  event: AppEvent,
  opts?: { causationId?: string; correlationId?: string },
): EventEnvelope {
  const envelope: EventEnvelope = {
    id: nanoid(),
    type: event.type,
    aggregateId: inferAggregateId(event.payload),
    payload: event.payload,
    occurredAt: new Date().toISOString(),
    causationId: opts?.causationId,
    correlationId: opts?.correlationId,
  };

  db.insert(events)
    .values({
      id: envelope.id,
      type: envelope.type,
      aggregateId: envelope.aggregateId,
      payload: JSON.stringify(envelope.payload),
      occurredAt: envelope.occurredAt,
      causationId: envelope.causationId ?? null,
      correlationId: envelope.correlationId ?? null,
    })
    .run();

  return envelope;
}
