import { nanoid } from 'nanoid';
import { writeTx } from '../../db/client';
import { appendEvent } from '../../events/EventStore';
import { eventBus } from '../../eventbus/EventBus';
import * as repo from './repository';
import { createProjectSchema, type ProjectView } from '@dm-life/shared';

export function createProject(input: unknown): ProjectView {
  const data = createProjectSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  const env = writeTx(() => {
    repo.insertProject({ id, ...data, now });
    return appendEvent({
      type: 'ProjectCreated',
      payload: { projectId: id, name: data.name, paraType: data.paraType },
    });
  });

  eventBus.publish(env);
  return repo.getProject(id)!;
}

export function listProjects(): ProjectView[] {
  return repo.list();
}
