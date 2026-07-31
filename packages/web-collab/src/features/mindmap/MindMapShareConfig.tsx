// 思维导图 共享配置（个人模式 · 挂在 MindMapPage 头部「共享到家庭」按钮）。
// 复用通用 SharedItemsConfigModal；脑图纯本地，直接用 loadStore() 读取最新数据。
import { useMemo } from 'react';
import { SharedItemsConfigModal } from '../shared/SharedItemsConfigModal';
import { buildMindmapCandidates, mindmapSnapshotFor } from './mindmapShare';
import { loadStore } from './mindMapStorage';

export function MindMapShareConfig({ open, onClose }: { open: boolean; onClose: () => void }) {
  // 脑图存于 localStorage，非 engine；打开时即时读取最新快照
  const store = useMemo(() => (open ? loadStore() : { activeId: '', maps: [] }), [open]);
  const candidates = useMemo(() => buildMindmapCandidates(store), [store]);

  const fetchBagFresh = async () => loadStore();

  return (
    <SharedItemsConfigModal
      open={open}
      onClose={onClose}
      module="mindmap"
      candidates={candidates}
      fetchBagFresh={fetchBagFresh}
      snapshotFor={mindmapSnapshotFor}
      title="共享脑图到家庭"
      emptyHint="你还没有家庭，无法共享脑图数据。"
    />
  );
}
