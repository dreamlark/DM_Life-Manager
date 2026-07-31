// 家庭协作系统 M1 — 核心领域类型
// 注：M1 用内存存储跑通链路；这些类型是后续 Drizzle + Postgres 迁移的稳定契约。

export type Role = 'owner' | 'admin' | 'member' | 'child' | 'guest';

export const ROLES: Role[] = ['owner', 'admin', 'member', 'child', 'guest'];

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export interface Family {
  id: string;
  name: string;
  ownerId: string;
  kind?: 'personal' | 'shared';
  createdAt: string;
}

export interface Membership {
  id: string;
  familyId: string;
  userId: string;
  role: Role;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  familyId: string;
  token: string;
  role: Role;
  createdBy: string;
  expiresAt: string;
}

export interface Session {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: string;
}

export type PublicUser = Pick<User, 'id' | 'email' | 'name'>;

// ===== 共享日历（家庭共享日程） =====
export interface CalendarEvent {
  id: string;
  familyId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  createdBy: string;
  version: number;
  ownerId: string;
  visibility: 'private' | 'public';
  lastEditedBy: string | null;
  createdAt: string;
}

// ===== 个人财务共享快照（家庭协作库桥接） =====
export type SharedFinanceItemType = 'summary' | 'income' | 'expense' | 'asset' | 'debt' | 'investment' | 'budget';
export type SharedFinanceScope = 'all' | 'specific';

export interface SharedFinanceItem {
  id: string;
  familyId: string;
  ownerUserId: string;
  itemType: SharedFinanceItemType;
  itemKey: string;
  label: string;
  scope: SharedFinanceScope;
  allowedUserIds: string[];
  snapshot: unknown; // 数值快照：保证家庭端一致
  updatedAt: string;
}

// ===== 通用个人模块共享快照（提醒/记事/脑图/心流/领域…） =====
export type SharedItemModule = 'reminder' | 'notes' | 'mindmap' | 'flow' | 'domains' | 'interests' | 'task';
export type SharedItemScope = 'all' | 'specific';

export interface SharedItem {
  id: string;
  familyId: string;
  ownerUserId: string;
  module: SharedItemModule;
  itemType: string;
  itemKey: string;
  label: string;
  scope: SharedItemScope;
  allowedUserIds: string[];
  snapshot: unknown; // 数值/结构化快照：保证家庭端一致
  done?: boolean; // 协作完成状态（任意家庭成员可标记）
  note?: string | null; // 协作备注
  updatedAt: string;
}
