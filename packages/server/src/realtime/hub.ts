// M2 实时网关 —— WebSocket Hub。
// 挂在现有 http.Server 的 /ws 路径上：连接时用 ?token= 校验 JWT；按用户家庭成员
// 维护在线状态；订阅 eventBus 后向家庭全部在线成员广播领域事件，并广播在线状态变化。
// 设计依据：family-collab-design.md §3.5 / §7（WebSocket 而非 SSE，需双向在线状态）。
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { verifyAccess } from '../auth';
import { store } from '../store';
import { subscribeEvents, type RealtimeEvent } from './eventBus';

interface ConnMeta {
  userId: string;
}

// userId -> 该用户全部 socket（多标签页）
const clients = new Map<string, Set<WebSocket>>();
// userId -> 所属 familyId 集合（成员变更时刷新，用于广播定向）
const userFamilies = new Map<string, Set<string>>();
// familyId -> 当前在线 userId 集合（用于 presence 下发）
const familyOnline = new Map<string, Set<string>>();

const meta = new WeakMap<WebSocket, ConnMeta>();

function familiesOf(userId: string): Set<string> {
  return userFamilies.get(userId) ?? new Set();
}

async function refreshUserFamilies(userId: string): Promise<Set<string>> {
  const ms = await store.getMembershipsByUser(userId);
  const set = new Set(ms.map((m) => m.familyId));
  userFamilies.set(userId, set);
  return set;
}

function broadcastPresence(familyId: string): void {
  const online = Array.from(familyOnline.get(familyId) ?? []);
  const msg = JSON.stringify({ type: 'presence', familyId, online });
  for (const [uid, socks] of clients) {
    if (!familiesOf(uid).has(familyId)) continue;
    for (const ws of socks) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }
}

/** 把用户加入某家庭的在线集合并广播 presence（如该家庭在线集合为空也会广播一次让客户端感知） */
function addOnline(userId: string, familyId: string): void {
  if (!familyOnline.has(familyId)) familyOnline.set(familyId, new Set());
  familyOnline.get(familyId)!.add(userId);
  broadcastPresence(familyId);
}

function removeOnline(userId: string, familyId: string): void {
  familyOnline.get(familyId)?.delete(userId);
  broadcastPresence(familyId);
}

/**
 * 吊销某用户的全部实时连接（登出 / 登出全部设备时调用）。
 *
 * 主动关闭其 WebSocket，使已登出用户不再接收实时广播、不再显示“在线”。
 * 关闭会触发各 socket 的 close 处理器，自动完成 clients / familyOnline 的清理；
 * 这里再兜底清一次，避免依赖异步 close 事件。
 */
export function closeUserSessions(userId: string): void {
  const socks = clients.get(userId);
  if (socks && socks.size > 0) {
    for (const ws of socks) {
      try {
        ws.close(1000, 'logout');
      } catch {
        /* 已关闭/异常 socket 忽略 */
      }
    }
  }
  clients.delete(userId);
  for (const fid of familiesOf(userId)) {
    familyOnline.get(fid)?.delete(userId);
    broadcastPresence(fid);
  }
}

export function attachHub(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // P1-6：优先从 Sec-WebSocket-Protocol 子协议头取令牌（不在 URL 中，避免被日志泄露），
    // 兼容旧的 ?token= 查询参数。
    const subProto = req.headers['sec-websocket-protocol'];
    const token = (typeof subProto === 'string' && subProto.length ? subProto : url.searchParams.get('token')) ?? undefined;
    let userId: string | null = null;
    try {
      userId = token ? verifyAccess(token) : null;
    } catch {
      userId = null;
    }
    if (!userId) {
      ws.close(1008, 'unauthorized');
      return;
    }

    meta.set(ws, { userId });
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId)!.add(ws);

    const fams = await refreshUserFamilies(userId);
    for (const fid of fams) addOnline(userId, fid);

    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 25_000);

    ws.on('close', () => {
      clearInterval(heartbeat);
      const set = clients.get(userId!);
      set?.delete(ws);
      if (set && set.size === 0) {
        clients.delete(userId!);
        // 该用户所有连接都断开，才从各家庭在线集合移除
        for (const fid of familiesOf(userId!)) removeOnline(userId!, fid);
      }
    });

    ws.on('error', () => {
      /* 错误随 close 清理，无需处理 */
    });
  });

  // 订阅领域事件 → 定向广播 + 维护在线/订阅缓存
  subscribeEvents((event) => {
    void onDomainEvent(event);
  });

  async function onDomainEvent(event: RealtimeEvent): Promise<void> {
    switch (event.kind) {
      case 'member.joined':
        await refreshUserFamilies(event.userId);
        addOnline(event.userId, event.familyId);
        break;
      case 'member.removed':
      case 'member.left':
        await refreshUserFamilies(event.userId);
        removeOnline(event.userId, event.familyId);
        break;
      case 'ownership.transferred':
        await refreshUserFamilies(event.to);
        await refreshUserFamilies(event.from);
        break;
      case 'family.created':
        await refreshUserFamilies(event.actorId);
        break;
      default:
        break;
    }

    // 向该家庭全部在线成员广播事件（含操作者自身，幂等刷新）
    const targets = familyOnline.get(event.familyId);
    if (!targets || targets.size === 0) return;
    const msg = JSON.stringify({ type: 'event', event });
    for (const uid of targets) {
      const socks = clients.get(uid);
      if (!socks) continue;
      for (const ws of socks) {
        if (ws.readyState === ws.OPEN) ws.send(msg);
      }
    }
  }

  return wss;
}
