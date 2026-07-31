// 领域平衡 共享配置（个人模式 · 挂在 DomainBalancePage 头部「共享到家庭」按钮）。
// 复用通用 SharedItemsConfigModal；本组件用 trpcLocal 拉取当前周平衡轮、构建候选与快照。
import { useMemo } from 'react';
import { trpcLocal } from '../../lib/trpcLocal';
import { SharedItemsConfigModal } from '../shared/SharedItemsConfigModal';
import { buildDomainCandidates, domainSnapshotFor } from './domainShare';

export function DomainShareConfig({
  open,
  onClose,
  week,
}: {
  open: boolean;
  onClose: () => void;
  week: string;
}) {
  const localUtils = trpcLocal.useUtils();
  const wheelQ = trpcLocal.domains.balanceWheel.useQuery({ week });
  const candidates = useMemo(() => buildDomainCandidates(wheelQ.data), [wheelQ.data]);

  const fetchBagFresh = async () => localUtils.client.domains.balanceWheel.query({ week });

  return (
    <SharedItemsConfigModal
      open={open}
      onClose={onClose}
      module="domains"
      candidates={candidates}
      fetchBagFresh={fetchBagFresh}
      snapshotFor={domainSnapshotFor}
      title="共享领域平衡到家庭"
      emptyHint="你还没有家庭，无法共享领域数据。"
    />
  );
}
