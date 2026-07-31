import { nanoid } from 'nanoid';
import { writeTx } from '../../db/client';
import { appendEvent } from '../../events/EventStore';
import { eventBus } from '../../eventbus/EventBus';
import * as repo from './repository';
import { embed } from '../../knowledge/embed';
import { ingestNoteSchema, updateNoteSchema, deleteNoteSchema } from '@dm-life/shared';

export function ingestNote(input: unknown): string {
  const data = ingestNoteSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();
  const embedding = JSON.stringify(embed([data.title, data.bodyMarkdown].join('\n')));

  const env = writeTx(() => {
    repo.insertNote({
      id,
      title: data.title,
      bodyMarkdown: data.bodyMarkdown,
      links: data.links,
      tags: data.tags,
      kind: data.kind,
      taskId: data.taskId ?? null,
      now,
      embedding,
      embeddedAt: now,
    });
    return appendEvent({ type: 'NoteIngested', payload: { noteId: id } });
  });

  eventBus.publish(env);
  return id;
}

export function updateNote(input: unknown): string {
  const data = updateNoteSchema.parse(input);
  const now = new Date().toISOString();

  const env = writeTx(() => {
    const fields: Parameters<typeof repo.updateNoteFields>[1] = {};
    if (data.title !== undefined) fields.title = data.title;
    if (data.bodyMarkdown !== undefined) fields.bodyMarkdown = data.bodyMarkdown;
    if (data.links !== undefined) fields.links = JSON.stringify(data.links);
    if (data.tags !== undefined) fields.tags = JSON.stringify(data.tags);
    if (data.taskId !== undefined) fields.taskId = data.taskId;
    // 标题或正文变更 -> 重算 embedding，保持向量与内容一致
    if (data.title !== undefined || data.bodyMarkdown !== undefined) {
      const cur = repo.getNoteById(data.id);
      const title = data.title ?? cur?.title ?? '';
      const body = data.bodyMarkdown ?? cur?.bodyMarkdown ?? '';
      fields.embedding = JSON.stringify(embed([title, body].join('\n')));
      fields.embeddedAt = now;
    }
    repo.updateNoteFields(data.id, fields, now);
    return appendEvent({ type: 'NoteUpdated', payload: { noteId: data.id } });
  });

  eventBus.publish(env);
  return data.id;
}

export function deleteNote(input: unknown): void {
  const { id } = deleteNoteSchema.parse(input);
  const env = writeTx(() => {
    repo.deleteNote(id);
    return appendEvent({ type: 'NoteDeleted', payload: { noteId: id } });
  });
  eventBus.publish(env);
}

/** 列表（只读，不走写事务）；透传 kind 过滤（灵感/记事本分流） */
export function listNotes(kind?: 'idea' | 'notebook'): ReturnType<typeof repo.listNotes> {
  return repo.listNotes(50, kind);
}
