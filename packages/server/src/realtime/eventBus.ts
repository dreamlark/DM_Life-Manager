// M2 实时网关 —— 进程内发布订阅（轻量 eventBus）。
// tRPC mutation 在写成功后 publish 领域事件；WS Hub 订阅后向家庭成员连接广播。
// 单实例部署足够；多实例横向扩展时换成 Redis Pub-Sub（见 family-collab-design.md §9）。
import { EventEmitter } from 'node:events';

export type RealtimeEvent =
  | { kind: 'family.created'; familyId: string; actorId: string }
  | { kind: 'invitation.created'; familyId: string; role: string; actorId: string }
  | { kind: 'member.joined'; familyId: string; userId: string; role: string; actorId: string }
  | { kind: 'member.removed'; familyId: string; userId: string; actorId: string }
  | { kind: 'member.left'; familyId: string; userId: string; actorId: string }
  | { kind: 'role.updated'; familyId: string; userId: string; role: string; actorId: string }
  | { kind: 'ownership.transferred'; familyId: string; from: string; to: string; actorId: string }
  // 共享任务（认领 / 指派 / 轮换）
  | { kind: 'task.created'; familyId: string; taskId: string; actorId: string }
  | { kind: 'task.claimed'; familyId: string; taskId: string; userId: string; actorId: string }
  | { kind: 'task.assigned'; familyId: string; taskId: string; userId: string; actorId: string }
  | { kind: 'task.updated'; familyId: string; taskId: string; actorId: string }
  | { kind: 'task.rotated'; familyId: string; taskId: string; userId: string; actorId: string }
  | { kind: 'task.deleted'; familyId: string; taskId: string; actorId: string }
  // 共享日历（家庭共享日程）
  | { kind: 'calendar.created'; familyId: string; eventId: string; actorId: string }
  | { kind: 'calendar.updated'; familyId: string; eventId: string; actorId: string }
  | { kind: 'calendar.deleted'; familyId: string; eventId: string; actorId: string }
  // 个人财务共享快照（家庭共享账本桥接）
  | { kind: 'sharedFinance.updated'; familyId: string; actorId: string; module?: string }
  // 通用个人模块共享快照（提醒/记事/脑图/心流/领域…）
  // module 用于让前端按模块精准刷新（只重拉受影响的那个看板，避免 7 个看板同时重拉挤爆连接池）
  | { kind: 'sharedItems.updated'; familyId: string; actorId: string; module?: string }
  // 个人域（从 engine 整体迁移到 server，按 personal family 隔离）。
  // 写操作在成功后 publish，前端可据此精准刷新对应看板，无需整页重拉。
  | { kind: PersonalEventKind; familyId: string; actorId: string; entityId?: string };

/**
 * 个人域写事件种类（<domain>.<verb>）。仅供 personal.ts 写成功后 publishEvent 使用，
 * 与协作版 shared* 事件互不冲突；新增个人域写路径时在此补充字面量即可。
 */
export type PersonalEventKind =
  | 'tasks.create'
  | 'tasks.complete'
  | 'tasks.uncomplete'
  | 'tasks.setQuadrant'
  | 'tasks.schedule'
  | 'tasks.setMit'
  | 'tasks.update'
  | 'tasks.delete'
  | 'tasks.ensureDaily'
  | 'interests.capture'
  | 'interests.update'
  | 'interests.setStatus'
  | 'interests.validate'
  | 'interests.convert'
  | 'interests.recordView'
  | 'projects.create'
  | 'notes.ingest'
  | 'notes.update'
  | 'notes.delete'
  | 'finance.debtCreate'
  | 'finance.debtUpdate'
  | 'finance.debtClose'
  | 'finance.debtReopen'
  | 'finance.debtDelete'
  | 'finance.incomeRecord'
  | 'finance.incomeUpdate'
  | 'finance.incomeDelete'
  | 'finance.transactionRecord'
  | 'finance.transactionUpdate'
  | 'finance.transactionDelete'
  | 'finance.assetRecord'
  | 'finance.assetUpdate'
  | 'finance.assetDelete'
  | 'finance.budgetCreate'
  | 'finance.budgetUpdate'
  | 'finance.budgetDelete'
  | 'finance.transferCreate'
  | 'finance.transferReverse'
  | 'finance.autoRefresh'
  | 'reminders.create'
  | 'reminders.complete'
  | 'reminders.rewind'
  | 'reminders.snooze'
  | 'reminders.update'
  | 'reminders.delete'
  | 'reminders.tick'
  | 'flow.record'
  | 'system.import'
  | 'system.setCustomDataDir';

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // 仅 Hub 一个订阅者，关闭告警

export function publishEvent(event: RealtimeEvent): void {
  emitter.emit('event', event);
}

export function subscribeEvents(cb: (event: RealtimeEvent) => void): () => void {
  emitter.on('event', cb);
  return () => emitter.off('event', cb);
}
