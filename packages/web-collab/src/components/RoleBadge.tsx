import type { Role } from '@dm-life/server';

const ROLE_META: Record<Role, { label: string; emoji: string; cls: string }> = {
  owner: { label: '所有者', emoji: '👑', cls: 'role-owner' },
  admin: { label: '管理员', emoji: '🛡️', cls: 'role-admin' },
  member: { label: '成员', emoji: '🙂', cls: 'role-member' },
  child: { label: '儿童', emoji: '🧒', cls: 'role-child' },
  guest: { label: '访客', emoji: '👋', cls: 'role-guest' },
};

export function RoleBadge({ role, size = 'md' }: { role: Role; size?: 'sm' | 'md' }) {
  const m = ROLE_META[role];
  return (
    <span className={`role-badge ${m.cls} ${size === 'sm' ? 'role-sm' : ''}`}>
      <span className="role-emoji">{m.emoji}</span>
      {m.label}
    </span>
  );
}

export function roleLabel(role: Role): string {
  return ROLE_META[role].label;
}
