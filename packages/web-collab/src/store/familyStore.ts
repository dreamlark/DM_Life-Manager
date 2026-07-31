import { create } from 'zustand';
import type { Role } from '@dm-life/server';

export interface FamilySummary {
  id: string;
  name: string;
  ownerId: string;
  role: Role;
}

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

interface FamilyState {
  families: FamilySummary[];
  currentFamilyId: string | null;
  members: MemberView[];
  setFamilies: (f: FamilySummary[]) => void;
  setCurrent: (id: string) => void;
  setMembers: (m: MemberView[]) => void;
  reset: () => void;
}

export const useFamilyStore = create<FamilyState>((set) => ({
  families: [],
  currentFamilyId: null,
  members: [],
  setFamilies: (families) =>
    set((s) => ({
      families,
      // 保持当前选择；若没有则默认第一个
      currentFamilyId: s.currentFamilyId && families.some((f) => f.id === s.currentFamilyId)
        ? s.currentFamilyId
        : (families[0]?.id ?? null),
    })),
  setCurrent: (id) => set({ currentFamilyId: id }),
  setMembers: (members) => set({ members }),
  reset: () => set({ families: [], currentFamilyId: null, members: [] }),
}));

/** 当前家庭里「我」的角色（用于 RBAC 前端开关，最终判定仍以服务端为准） */
export function useMyRole(): Role | null {
  return useFamilyStore((s) => {
    const fam = s.families.find((f) => f.id === s.currentFamilyId);
    return fam ? fam.role : null;
  });
}
