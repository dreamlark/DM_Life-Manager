// In-process E2E check: load real AppData db, migrate, call tasks.all + tasks.today
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.DM_LIFE_DATA_DIR = process.env.APPDATA + '/dm-life';
process.env.DM_LIFE_SKIP_SEED = '1';

const engine = require('@dm-life/engine');
const { initDb, migrate } = engine;
await initDb();
migrate();

const { appRouter } = engine;
const caller = appRouter.createCaller({});

const all = await caller.tasks.all();
console.log('tasks.all count:', all.length);
for (const t of all.slice(0, 5)) {
  console.log('  -', JSON.stringify({ id: t.id.slice(0, 8), title: t.title, status: t.status, priority: t.priority, description: (t.description ?? '').slice(0, 20), sched: t.scheduledStart }));
}
const today = await caller.tasks.today();
console.log('tasks.today count:', today.length);

// sanity: columns present
console.log('priority field present on sample:', 'priority' in (all[0] ?? {}));
console.log('description field present on sample:', 'description' in (all[0] ?? {}));
