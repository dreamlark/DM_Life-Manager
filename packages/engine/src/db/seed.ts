import { db } from './client';
import { domains } from './schema';
import { reminderClocks, notes } from './schema';
import * as remindersCommand from '../modules/reminders/command';
import * as notesCommand from '../modules/notes/command';

/** 8+1 领域种子（首启写入，幂等） */
const SEED = [
  { key: 'health', name: '健康', color: '#22c55e' },
  { key: 'family', name: '家庭', color: '#ec4899' },
  { key: 'work', name: '工作', color: '#3b82f6' },
  { key: 'wealth', name: '财富', color: '#eab308' },
  { key: 'social', name: '社交', color: '#a855f7' },
  { key: 'growth', name: '成长', color: '#14b8a6' },
  { key: 'leisure', name: '休闲', color: '#f97316' },
  { key: 'spirit', name: '心灵', color: '#6366f1' },
  { key: 'quarter', name: '季度聚焦', color: '#ef4444', isQuarterFocus: true },
] as const;

export function seedDomains(): void {
  const existing = db.select({ key: domains.key }).from(domains).all();
  if (existing.length > 0) return;
  const now = new Date().toISOString();
  db.insert(domains)
    .values(SEED.map((d) => ({ ...d, createdAt: now })))
    .run();
  console.log(`[seed] 已写入 ${SEED.length} 个领域`);
}

const DAY = 86400000;

/** 提醒钟表铺演示种子（首启写入，幂等）：让「提醒」标签首屏非空 */
export function seedReminders(): void {
  const existing = db.select().from(reminderClocks).all();
  if (existing.length > 0) return;
  const now = Date.now();
  const mk = (days: number) => new Date(now + days * DAY).toISOString();
  remindersCommand.createReminder({
    title: '车险续保',
    domainKey: 'wealth',
    periodRule: '每3个月',
    leadChain: [7, 1, 0],
    noteLinked: '保单照片在云盘',
    nextFireAt: mk(5),
  });
  remindersCommand.createReminder({
    title: '年度报告撰写',
    domainKey: 'work',
    periodRule: '每年',
    leadChain: [14, 3, 0],
    noteLinked: null,
    nextFireAt: mk(20),
  });
  remindersCommand.createReminder({
    title: '牙医复诊',
    domainKey: 'health',
    periodRule: '每6个月',
    leadChain: [3, 1, 0],
    noteLinked: null,
    nextFireAt: mk(12),
  });
  console.log('[seed] 已写入 3 只演示钟');
}

/** 灵感记事演示种子（首启写入，幂等）：让「灵感」标签首屏非空 */
export function seedNotes(): void {
  const existing = db.select().from(notes).all();
  if (existing.length > 0) return;
  notesCommand.ingestNote({
    title: '压力背包的产品灵感',
    bodyMarkdown:
      '把「逾期提醒 + 超期任务 + 活跃债务」三类负荷加权成 0-100 压力指数，右栏实时显示，帮助用户觉察自己的承载上限。',
    tags: ['idea', 'p1', 'product'],
    links: ['https://example.com/stress-backpack'],
  });
  notesCommand.ingestNote({
    title: '人生钟表铺命名来源',
    bodyMarkdown: '非日常周期事务像一只只钟，完成时「上发条」推进到下一周期。钟表铺比「待办」更有仪式感。',
    tags: ['naming', 'design'],
    links: [],
  });
  notesCommand.ingestNote({
    title: '下一步：真实向量记忆',
    bodyMarkdown: '相关记忆目前是最近笔记的占位，后续接 embedding + 向量库做语义检索。',
    tags: ['todo', 'kb'],
    links: [],
  });
  console.log('[seed] 已写入 3 条演示灵感');
}
