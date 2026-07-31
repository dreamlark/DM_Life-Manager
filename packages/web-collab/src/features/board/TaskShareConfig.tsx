// 任务共享配置（个人模式 · 挂在每日看板工具条「共享到家庭」按钮）。
// 复用通用 SharedItemsConfigModal；本组件只负责用 trpcLocal 拉取本地任务、构建候选与快照。
import { useMemo } from 'react';
import { trpcLocal } from '../../lib/trpcLocal';
import { SharedItemsConfigModal } from '../shared/SharedItemsConfigModal';
import { buildTaskCandidates, taskSnapshotFor } from './taskShare';

export function TaskShareConfig({ open, onClose }: { open: boolean; onClose: () => void }) {
  const localUtils = trpcLocal.useUtils();
  const listQ = trpcLocal.tasks.all.useQuery(undefined);

  const candidates = useMemo(() => buildTaskCandidates((listQ.data ?? []) as any[]), [listQ.data]);

  const fetchBagFresh = async () => (await localUtils.client.tasks.all.query()) as any[];

  return (
    <SharedItemsConfigModal
      open={open}
      onClose={onClose}
      module="task"
      candidates={candidates}
      fetchBagFresh={fetchBagFresh}
      snapshotFor={taskSnapshotFor}
      title="共享任务到家庭"
      emptyHint="你还没有家庭，无法共享任务数据。"
    />
  );
}
