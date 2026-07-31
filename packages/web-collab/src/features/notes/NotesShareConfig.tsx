// 灵感·记事 共享配置（个人模式 · 挂在 NotesHubPage 头部「共享到家庭」按钮）。
// 复用通用 SharedItemsConfigModal；本组件只负责用 trpcLocal 拉取本地笔记、构建候选与快照。
import { useMemo } from 'react';
import { trpcLocal } from '../../lib/trpcLocal';
import { SharedItemsConfigModal } from '../shared/SharedItemsConfigModal';
import { buildNotesCandidates, notesSnapshotFor } from './notesShare';
import type { NoteView } from '@dm-life/shared';

export function NotesShareConfig({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ideaQ = trpcLocal.notes.list.useQuery({ kind: 'idea' });
  const notebookQ = trpcLocal.notes.list.useQuery({ kind: 'notebook' });
  const localUtils = trpcLocal.useUtils();

  const notes = useMemo<NoteView[]>(
    () => [...(ideaQ.data ?? []), ...(notebookQ.data ?? [])],
    [ideaQ.data, notebookQ.data],
  );
  const candidates = useMemo(() => buildNotesCandidates(notes), [notes]);

  const fetchBagFresh = async () => [
    ...(await localUtils.client.notes.list.query({ kind: 'idea' })),
    ...(await localUtils.client.notes.list.query({ kind: 'notebook' })),
  ];

  return (
    <SharedItemsConfigModal
      open={open}
      onClose={onClose}
      module="notes"
      candidates={candidates}
      fetchBagFresh={fetchBagFresh}
      snapshotFor={notesSnapshotFor}
      title="共享灵感·记事到家庭"
      emptyHint="你还没有家庭，无法共享笔记数据。"
    />
  );
}
