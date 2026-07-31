// 心流 共享配置（个人模式 · 挂在 FlowPage 头部「共享到家庭」按钮）。
// 复用通用 SharedItemsConfigModal；本组件用 trpcLocal 拉取专注概览、构建候选与快照。
import { useMemo } from 'react';
import { trpcLocal } from '../../lib/trpcLocal';
import { SharedItemsConfigModal } from '../shared/SharedItemsConfigModal';
import { buildFlowCandidates, flowSnapshotFor, FLOW_SHARE_QUERY } from './flowShare';

export function FlowShareConfig({ open, onClose }: { open: boolean; onClose: () => void }) {
  const localUtils = trpcLocal.useUtils();
  const summaryQ = trpcLocal.flow.summary.useQuery(FLOW_SHARE_QUERY);
  const candidates = useMemo(() => buildFlowCandidates(summaryQ.data), [summaryQ.data]);

  const fetchBagFresh = async () => localUtils.client.flow.summary.query(FLOW_SHARE_QUERY);

  return (
    <SharedItemsConfigModal
      open={open}
      onClose={onClose}
      module="flow"
      candidates={candidates}
      fetchBagFresh={fetchBagFresh}
      snapshotFor={flowSnapshotFor}
      title="共享专注概览到家庭"
      emptyHint="你还没有家庭，无法共享专注数据。"
    />
  );
}
