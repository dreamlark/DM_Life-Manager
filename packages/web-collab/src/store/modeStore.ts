import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppMode = 'collab' | 'local';

interface ModeState {
  /** collab = 协作模式（联机版原功能）；local = 个人模式（单机版功能） */
  mode: AppMode;
  setMode: (m: AppMode) => void;
  toggle: () => void;
}

/** 模式开关：持久化到浏览器存储，刷新后保持上次选择的模式 */
export const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      mode: 'local',
      setMode: (mode) => set({ mode }),
      toggle: () => set((s) => ({ mode: s.mode === 'collab' ? 'local' : 'collab' })),
    }),
    { name: 'dm-mode' },
  ),
);

/** 是否处于协作模式（联机版原功能），用于在各页面门控协作相关 UI */
export const useCollaborative = (): boolean => useModeStore((s) => s.mode === 'collab');
