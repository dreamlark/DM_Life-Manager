import { db } from '../../db/client';
import { projects } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { CreateProjectInput, ProjectView } from '@dm-life/shared';

type ProjectRow = typeof projects.$inferSelect;

function rowToView(row: ProjectRow): ProjectView {
  return {
    id: row.id,
    name: row.name,
    paraType: row.paraType,
    status: row.status,
  };
}

export function list(): ProjectView[] {
  const rows = db.select().from(projects).all() as ProjectRow[];
  return rows.map(rowToView);
}

export function insertProject(p: { id: string } & CreateProjectInput & { now: string }): void {
  db.insert(projects)
    .values({
      id: p.id,
      name: p.name,
      paraType: p.paraType,
      status: 'active',
      createdAt: p.now,
    })
    .run();
}

export function getProject(id: string): ProjectView | null {
  const row = db.select().from(projects).where(eq(projects.id, id)).get() as ProjectRow | undefined;
  return row ? rowToView(row) : null;
}
