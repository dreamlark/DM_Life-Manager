import { db } from '../../db/client';
import { interests, domains, projects } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { InterestView, InterestStatus } from '@dm-life/shared';

type InterestRow = typeof interests.$inferSelect;

function ageDays(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** 兴趣留存指数（0-100）：初始关注度 + 是否验证/转化 + 关联笔记数 − 久置未处理的老化惩罚 */
export function computeRetention(r: InterestRow): number {
  let idx = ((r.attention - 1) / 2) * 30; // 0..30
  if (r.validatedAt || r.status === 'validated') idx += 20;
  if (r.convertedAt || r.linkedProjectId || r.status === 'converted') idx += 25;
  idx += Math.min(r.linkedNoteCount, 5) * 3; // 0..15（隐性关注度代理）
  if (r.status === 'incubating' && ageDays(r.createdAt) > 30) {
    idx -= Math.min(40, Math.floor((ageDays(r.createdAt) - 30) / 30) * 10);
  }
  return Math.max(0, Math.min(100, Math.round(idx)));
}

/** 审查排序权重：隐性关注度高、关联季度重点/活跃项目、高关注度未处理、久置未动 → 排前面 */
function reviewPriority(r: InterestRow, qfKeys: Set<string>, activeProjects: Set<string>): number {
  let p = 0;
  p += r.viewCount * 2;
  p += r.linkedNoteCount * 3;
  if (r.domainKey && qfKeys.has(r.domainKey)) p += 15;
  if (r.sourceType === 'project' && r.sourceRef && activeProjects.has(r.sourceRef)) p += 10;
  if (r.status === 'incubating' && r.attention >= 3) p += 12;
  const age = ageDays(r.createdAt);
  if (r.status === 'incubating' && age > 30) p += Math.min(20, Math.floor(age / 30) * 5);
  if (r.status === 'incubating' && computeRetention(r) < 30) p += 8; // 低留存推前做丢弃决策
  return p;
}

function loadContext(): { qfKeys: Set<string>; activeProjects: Set<string> } {
  const dRows = db.select({ key: domains.key, qf: domains.isQuarterFocus }).from(domains).all() as unknown as Array<{
    key: string;
    qf: number;
  }>;
  const qfKeys = new Set(dRows.filter((d) => d.qf).map((d) => d.key));
  const pRows = db.select({ id: projects.id, status: projects.status }).from(projects).all() as Array<{
    id: string;
    status: string;
  }>;
  const activeProjects = new Set(pRows.filter((p) => p.status === 'active').map((p) => p.id));
  return { qfKeys, activeProjects };
}

function rowToView(r: InterestRow, qfKeys: Set<string>, activeProjects: Set<string>): InterestView {
  const retention = computeRetention(r);
  const age = ageDays(r.createdAt);
  return {
    id: r.id,
    title: r.title,
    content: r.content ?? null,
    attention: r.attention,
    sourceType: r.sourceType as InterestView['sourceType'],
    sourceRef: r.sourceRef ?? null,
    domainKey: r.domainKey ?? null,
    effortBudget: r.effortBudget as InterestView['effortBudget'],
    status: r.status as InterestStatus,
    linkedTaskId: r.linkedTaskId ?? null,
    linkedProjectId: r.linkedProjectId ?? null,
    viewCount: r.viewCount,
    linkedNoteCount: r.linkedNoteCount,
    validatedAt: r.validatedAt ?? null,
    convertedAt: r.convertedAt ?? null,
    archivedAt: r.archivedAt ?? null,
    discardedAt: r.discardedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    retentionIndex: retention,
    ageDays: age,
    reviewPriority: reviewPriority(r, qfKeys, activeProjects),
    discardSuggestion: r.status === 'incubating' && retention < 30,
  };
}

export interface InsertInterestInput {
  id: string;
  title: string;
  content: string;
  attention: number;
  sourceType: 'project' | 'thought' | 'note' | 'manual';
  sourceRef: string | null;
  domainKey: string | null;
  effortBudget: '30min' | '3h' | 'sustained' | 'tbd';
  now: string;
}

export function insertInterest(p: InsertInterestInput): void {
  db.insert(interests)
    .values({
      id: p.id,
      title: p.title,
      content: p.content || null,
      attention: p.attention,
      sourceType: p.sourceType,
      sourceRef: p.sourceRef ?? null,
      domainKey: p.domainKey ?? null,
      effortBudget: p.effortBudget,
      status: 'incubating',
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}

export function getInterest(id: string): InterestRow | undefined {
  return db.select().from(interests).where(eq(interests.id, id)).get() as InterestRow | undefined;
}

/** 单条视图（含计算字段）：写操作后回读用 */
export function getInterestView(id: string): InterestView | null {
  const row = getInterest(id);
  if (!row) return null;
  const { qfKeys, activeProjects } = loadContext();
  return rowToView(row, qfKeys, activeProjects);
}

export function listInterests(filter?: { status?: InterestStatus }): InterestView[] {
  const { qfKeys, activeProjects } = loadContext();
  const rows = (
    filter?.status
      ? db.select().from(interests).where(eq(interests.status, filter.status)).all()
      : db.select().from(interests).all()
  ) as InterestRow[];
  return rows
    .map((r) => rowToView(r, qfKeys, activeProjects))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function updateInterestFields(
  id: string,
  fields: {
    title?: string;
    content?: string | null;
    attention?: number;
    effortBudget?: '30min' | '3h' | 'sustained' | 'tbd';
    domainKey?: string | null;
    sourceType?: 'project' | 'thought' | 'note' | 'manual';
    sourceRef?: string | null;
  },
): void {
  const now = new Date().toISOString();
  const set: Record<string, unknown> = { updatedAt: now };
  if (fields.title !== undefined) set.title = fields.title;
  if (fields.content !== undefined) set.content = fields.content;
  if (fields.attention !== undefined) set.attention = fields.attention;
  if (fields.effortBudget !== undefined) set.effortBudget = fields.effortBudget;
  if (fields.domainKey !== undefined) set.domainKey = fields.domainKey;
  if (fields.sourceType !== undefined) set.sourceType = fields.sourceType;
  if (fields.sourceRef !== undefined) set.sourceRef = fields.sourceRef;
  db.update(interests).set(set).where(eq(interests.id, id)).run();
}

export function setStatus(
  id: string,
  status: InterestStatus,
  linkedTaskId?: string | null,
  linkedProjectId?: string | null,
): void {
  const now = new Date().toISOString();
  const set: Record<string, unknown> = { status, updatedAt: now };
  if (status === 'validated') set.validatedAt = now;
  if (status === 'converted') set.convertedAt = now;
  if (status === 'archived') set.archivedAt = now;
  if (status === 'discarded') set.discardedAt = now;
  if (linkedTaskId !== undefined) set.linkedTaskId = linkedTaskId;
  if (linkedProjectId !== undefined) set.linkedProjectId = linkedProjectId;
  db.update(interests).set(set).where(eq(interests.id, id)).run();
}

export function incrementView(id: string): void {
  db.update(interests)
    .set({ viewCount: sql`${interests.viewCount} + 1`, updatedAt: new Date().toISOString() })
    .where(eq(interests.id, id))
    .run();
}

export function incrementLinkedNote(id: string): void {
  db.update(interests)
    .set({ linkedNoteCount: sql`${interests.linkedNoteCount} + 1`, updatedAt: new Date().toISOString() })
    .where(eq(interests.id, id))
    .run();
}

/** 周期兴趣审查：返回按推荐权重排序的清单（含留存指数与丢弃建议） */
export function review(filter?: { status?: InterestStatus }): InterestView[] {
  const { qfKeys, activeProjects } = loadContext();
  const rows = (
    filter?.status
      ? db.select().from(interests).where(eq(interests.status, filter.status)).all()
      : db.select().from(interests).all()
  ) as InterestRow[];
  return rows
    .map((r) => rowToView(r, qfKeys, activeProjects))
    .sort((a, b) => b.reviewPriority - a.reviewPriority);
}
