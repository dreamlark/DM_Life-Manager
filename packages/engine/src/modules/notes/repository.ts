import { db } from '../../db/client';
import { notes } from '../../db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import type { NoteView } from '@dm-life/shared';

interface NoteRow {
  id: string;
  title: string;
  bodyMarkdown: string;
  links: string | null;
  tags: string | null;
  kind: string;
  taskId: string | null;
  createdAt: string;
  embedding: string | null;
}

function parseJsonArray(v: string | null): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

export function insertNote(p: {
  id: string;
  title: string;
  bodyMarkdown: string;
  links: string[];
  tags: string[];
  kind: 'idea' | 'notebook';
  taskId: string | null;
  now: string;
  embedding: string;
  embeddedAt: string;
}): void {
  db.insert(notes)
    .values({
      id: p.id,
      title: p.title,
      bodyMarkdown: p.bodyMarkdown,
      links: JSON.stringify(p.links),
      tags: JSON.stringify(p.tags),
      kind: p.kind,
      taskId: p.taskId,
      createdAt: p.now,
      updatedAt: p.now,
      embeddedAt: p.embeddedAt,
      embedding: p.embedding,
    })
    .run();
}

/** 取单条笔记的当前标题/正文（用于更新时重算 embedding） */
export function getNoteById(id: string): { title: string; bodyMarkdown: string } | undefined {
  const row = db.select().from(notes).where(eq(notes.id, id)).get() as
    | { title: string; body_markdown: string }
    | undefined;
  if (!row) return undefined;
  return { title: row.title, bodyMarkdown: row.body_markdown };
}

/** 列表：按摄入时间倒序；可按 kind 过滤（灵感/记事本分流） */
export function listNotes(limit = 50, kind?: 'idea' | 'notebook'): NoteView[] {
  const base = db.select().from(notes);
  const rows = (kind ? base.where(eq(notes.kind, kind)) : base)
    .orderBy(notes.createdAt)
    .limit(limit)
    .all() as NoteRow[];

  // 倒序（最新在前）
  return rows
    .reverse()
    .map((r) => ({
      id: r.id,
      title: r.title,
      bodyMarkdown: r.bodyMarkdown,
      links: parseJsonArray(r.links),
      tags: parseJsonArray(r.tags),
      kind: (r.kind as 'idea' | 'notebook') ?? 'idea',
      taskId: r.taskId,
      createdAt: r.createdAt,
    }));
}

/** 语义检索源：仅返回已生成 embedding 的笔记（embeddedAt 非空） */
export function listEmbeddedNotes(): Array<{ id: string; title: string; bodyMarkdown: string; embedding: string }> {
  const rows = db
    .select({ id: notes.id, title: notes.title, bodyMarkdown: notes.bodyMarkdown, embedding: notes.embedding })
    .from(notes)
    .where(isNotNull(notes.embeddedAt))
    .all() as Array<{ id: string; title: string; bodyMarkdown: string; embedding: string | null }>;
  // 仅返回确有向量数据的行（防御：理论上 where 已过滤，这里再兜底）
  return rows.filter((r) => r.embedding).map((r) => ({ id: r.id, title: r.title, bodyMarkdown: r.bodyMarkdown, embedding: r.embedding! }));
}

export function updateNoteFields(
  id: string,
  fields: Partial<{
    title: string;
    bodyMarkdown: string;
    links: string;
    tags: string;
    taskId: string | null;
    embedding: string;
    embeddedAt: string;
  }>,
  now: string,
): void {
  db.update(notes).set({ ...fields, updatedAt: now }).where(eq(notes.id, id)).run();
}

export function deleteNote(id: string): void {
  db.delete(notes).where(eq(notes.id, id)).run();
}
