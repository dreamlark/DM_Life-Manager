// M2 实时网关 —— 浏览器端 WebSocket 客户端 + 轻量状态。
// 连接同源 /ws?token=<access>（由 vite 代理到协作服务，ws:true）；自动重连；
// 暴露在线状态（familyId -> userId[]）与板级事件订阅，供看板实时刷新。
import { create } from 'zustand';
import { useAuthStore } from '../store/authStore';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface BoardEvent {
  kind: string;
  familyId: string;
  userId?: string;
  role?: string;
  actorId?: string;
  /** server 广播时携带的模块标识（sharedItems.updated 等），前端据此只刷新对应看板 */
  module?: string;
  [k: string]: unknown;
}

interface RealtimeState {
  status: ConnStatus;
  online: Record<string, string[]>; // familyId -> 在线 userId 列表
  notify: { id: number; text: string } | null;
  setStatus: (s: ConnStatus) => void;
  setOnline: (familyId: string, userIds: string[]) => void;
  pushNotify: (text: string) => void;
  clearNotify: () => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  status: 'idle',
  online: {},
  notify: null,
  setStatus: (status) => set({ status }),
  setOnline: (familyId, userIds) => set((s) => ({ online: { ...s.online, [familyId]: userIds } })),
  pushNotify: (text) => set({ notify: { id: Date.now(), text } }),
  clearNotify: () => set({ notify: null }),
}));

// 板级事件订阅（FamilyBoard 据此实时刷新）
type BoardListener = (e: BoardEvent) => void;
const boardListeners = new Set<BoardListener>();
export function onBoardEvent(cb: BoardListener): () => void {
  boardListeners.add(cb);
  return () => boardListeners.delete(cb);
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retry = 0;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function connectRealtime(): void {
  const token = useAuthStore.getState().accessToken;
  if (!token) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  useRealtimeStore.getState().setStatus('connecting');
  // P1-6：令牌经 Sec-WebSocket-Protocol 子协议头传递，不出现在 URL 中（避免被代理/访问日志记录）。
  // 浏览器原生 WebSocket 不支持自定义请求头，子协议头是标准做法且经 vite/Caddy 代理透传。
  const sock = new WebSocket(wsUrl(), [token]);
  ws = sock;

  sock.onopen = () => {
    retry = 0;
    useRealtimeStore.getState().setStatus('open');
  };
  sock.onmessage = (ev) => {
    try {
      handleMessage(JSON.parse(ev.data));
    } catch {
      /* 忽略非法消息 */
    }
  };
  sock.onclose = () => {
    useRealtimeStore.getState().setStatus('closed');
    scheduleReconnect();
  };
  sock.onerror = () => {
    sock.close();
  };
}

function handleMessage(msg: { type: string; familyId?: string; online?: string[]; event?: BoardEvent }): void {
  if (msg.type === 'presence' && msg.familyId) {
    useRealtimeStore.getState().setOnline(msg.familyId, msg.online ?? []);
    return;
  }
  if (msg.type === 'event' && msg.event) {
    const e = msg.event;
    boardListeners.forEach((cb) => cb(e));
    if (e.kind === 'member.joined') useRealtimeStore.getState().pushNotify('有家庭成员加入了');
    else if (e.kind === 'role.updated') useRealtimeStore.getState().pushNotify('成员角色已更新');
    else if (e.kind === 'ownership.transferred') useRealtimeStore.getState().pushNotify('家庭所有者已转让');
    else if (e.kind === 'member.removed') useRealtimeStore.getState().pushNotify('有成员被移出家庭');
    else if (e.kind === 'member.left') useRealtimeStore.getState().pushNotify('有成员退出了家庭');
    else if (e.kind === 'task.created') useRealtimeStore.getState().pushNotify('家庭看板新增了一个任务');
    else if (e.kind === 'task.claimed') useRealtimeStore.getState().pushNotify('有成员认领了一个任务');
    else if (e.kind === 'task.assigned') useRealtimeStore.getState().pushNotify('一个任务被指派了负责人');
    else if (e.kind === 'task.rotated') useRealtimeStore.getState().pushNotify('轮换任务已轮到下一棒');
    else if (e.kind === 'calendar.created') useRealtimeStore.getState().pushNotify('家庭日历新增了一个事件');
    else if (e.kind === 'calendar.updated') useRealtimeStore.getState().pushNotify('有成员更新了日历事件');
    else if (e.kind === 'calendar.deleted') useRealtimeStore.getState().pushNotify('有日历事件被删除');
    else if (e.kind === 'sharedFinance.updated') useRealtimeStore.getState().pushNotify('家庭财务共享数据已更新');
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  retry += 1;
  const delay = Math.min(1000 * 2 ** Math.min(retry, 4), 10_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (useAuthStore.getState().accessToken) connectRealtime();
  }, delay);
}

export function disconnectRealtime(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  retry = 0;
  useRealtimeStore.getState().setStatus('idle');
  useRealtimeStore.getState().setOnline('', []);
}
