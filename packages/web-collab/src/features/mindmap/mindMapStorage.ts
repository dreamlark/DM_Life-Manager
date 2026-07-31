import type { MindElixirData } from 'mind-elixir';

export interface MindMapMeta {
  id: string;
  name: string;
  updatedAt: string;
  data: MindElixirData;
}

export interface MindMapStore {
  activeId: string;
  maps: MindMapMeta[];
}

const LEGACY_KEY = 'dm-life.mindmap.v1';
const STORE_KEY = 'dm-life.mindmaps.v2';

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newMapData(topic: string): MindElixirData {
  return {
    nodeData: {
      id: 'root',
      topic,
      children: [],
    },
  };
}

export function seedMapData(): MindElixirData {
  return {
    nodeData: {
      id: 'root',
      topic: '我的人生愿景',
      children: [
        {
          id: 'health',
          topic: '健康体魄',
          children: [
            { id: 'health-1', topic: '每周 3 次运动' },
            { id: 'health-2', topic: '规律作息' },
          ],
        },
        {
          id: 'career',
          topic: '事业与财务',
          children: [
            { id: 'career-1', topic: '主动收入增长' },
            { id: 'career-2', topic: '投资体系搭建' },
          ],
        },
        {
          id: 'growth',
          topic: '认知与关系',
          children: [
            { id: 'growth-1', topic: '深度阅读' },
            { id: 'growth-2', topic: '重要人际关系' },
          ],
        },
      ],
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function migrateLegacy(): MindMapStore | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as MindElixirData;
    const map: MindMapMeta = {
      id: newId(),
      name: '我的人生愿景',
      updatedAt: nowIso(),
      data,
    };
    return { activeId: map.id, maps: [map] };
  } catch {
    return null;
  }
}

export function loadStore(): MindMapStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MindMapStore;
      if (parsed.maps?.length > 0) return parsed;
    }
  } catch {
    /* ignore corrupted store */
  }
  const legacy = migrateLegacy();
  if (legacy) {
    saveStore(legacy);
    return legacy;
  }
  const defaultMap: MindMapMeta = {
    id: newId(),
    name: '我的人生愿景',
    updatedAt: nowIso(),
    data: seedMapData(),
  };
  const store: MindMapStore = { activeId: defaultMap.id, maps: [defaultMap] };
  saveStore(store);
  return store;
}

export function saveStore(store: MindMapStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage full or disabled */
  }
}

export function createMap(store: MindMapStore, name: string): MindMapStore {
  const map: MindMapMeta = {
    id: newId(),
    name: name || '未命名脑图',
    updatedAt: nowIso(),
    data: newMapData(name || '新脑图'),
  };
  const next: MindMapStore = { activeId: map.id, maps: [...store.maps, map] };
  saveStore(next);
  return next;
}

export function updateMap(
  store: MindMapStore,
  id: string,
  patch: Partial<Pick<MindMapMeta, 'name' | 'data'>>,
): MindMapStore {
  const next: MindMapStore = {
    ...store,
    maps: store.maps.map((m) =>
      m.id === id
        ? { ...m, ...patch, updatedAt: nowIso() }
        : m,
    ),
  };
  saveStore(next);
  return next;
}

export function deleteMap(store: MindMapStore, id: string): MindMapStore {
  const remaining = store.maps.filter((m) => m.id !== id);
  if (remaining.length === 0) {
    const fallback: MindMapMeta = {
      id: newId(),
      name: '我的人生愿景',
      updatedAt: nowIso(),
      data: seedMapData(),
    };
    const next: MindMapStore = { activeId: fallback.id, maps: [fallback] };
    saveStore(next);
    return next;
  }
  const next: MindMapStore = {
    activeId: store.activeId === id ? remaining[0]!.id : store.activeId,
    maps: remaining,
  };
  saveStore(next);
  return next;
}

export function setActiveMap(store: MindMapStore, id: string): MindMapStore {
  if (!store.maps.some((m) => m.id === id)) return store;
  const next: MindMapStore = { ...store, activeId: id };
  saveStore(next);
  return next;
}
