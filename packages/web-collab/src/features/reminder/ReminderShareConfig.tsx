// 提醒共享配置（个人模式 · 挂在 ReminderShopPage 头部「共享到家庭」按钮）。
// 复用通用 SharedItemsConfigModal；本组件只负责用 trpcLocal 拉取本地提醒、构建候选与快照。
import { useMemo } from 'react';
import { trpcLocal } from '../../lib/trpcLocal';
import { SharedItemsConfigModal } from '../shared/SharedItemsConfigModal';
import { buildReminderCandidates, reminderSnapshotFor } from './reminderShare';

export function ReminderShareConfig({ open, onClose }: { open: boolean; onClose: () => void }) {
  const localUtils = trpcLocal.useUtils();
  const listQ = trpcLocal.reminders.list.useQuery(undefined);

  const candidates = useMemo(() => buildReminderCandidates((listQ.data ?? []) as any[]), [listQ.data]);

  const fetchBagFresh = async () => (await localUtils.client.reminders.list.query()) as any[];

  return (
    <SharedItemsConfigModal
      open={open}
      onClose={onClose}
      module="reminder"
      candidates={candidates}
      fetchBagFresh={fetchBagFresh}
      snapshotFor={reminderSnapshotFor}
      title="共享提醒到家庭"
      emptyHint="你还没有家庭，无法共享提醒数据。"
    />
  );
}
