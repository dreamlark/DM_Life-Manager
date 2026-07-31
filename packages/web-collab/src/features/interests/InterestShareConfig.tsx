// 灵感孵化器 共享配置（个人模式 · 挂在 IncubatorPage 头部「共享到家庭」按钮）。
// 复用通用 SharedItemsConfigModal；本组件用 trpcLocal 拉取本地灵感、构建候选与快照。
import { useMemo } from 'react';
import { trpcLocal } from '../../lib/trpcLocal';
import { SharedItemsConfigModal } from '../shared/SharedItemsConfigModal';
import { buildInterestsCandidates, interestsSnapshotFor } from './interestsShare';
import type { InterestView } from '@dm-life/shared';

export function InterestShareConfig({ open, onClose }: { open: boolean; onClose: () => void }) {
  const localUtils = trpcLocal.useUtils();
  const listQ = trpcLocal.interests.list.useQuery(undefined);
  const interests = useMemo<InterestView[]>(() => listQ.data ?? [], [listQ.data]);
  const candidates = useMemo(() => buildInterestsCandidates(interests), [interests]);

  const fetchBagFresh = async () => localUtils.client.interests.list.query();

  return (
    <SharedItemsConfigModal
      open={open}
      onClose={onClose}
      module="interests"
      candidates={candidates}
      fetchBagFresh={fetchBagFresh}
      snapshotFor={interestsSnapshotFor}
      title="共享灵感孵化器到家庭"
      emptyHint="你还没有家庭，无法共享灵感数据。"
    />
  );
}
