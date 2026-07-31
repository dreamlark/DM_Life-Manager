import { useCallback } from 'react';
import { trpc as trpcCollab } from '../../lib/trpc';
import { useFamilyStore } from '../../store/familyStore';
import { useCollaborative } from '../../store/modeStore';

/**
 * 个人页标记任务完成时，把对应「已共享到家庭」的任务同步回协作页（双向同步的方向 B）。
 * 与 FamilySharedItemsBoard 里「协作页 → 个人页」的回写（方向 A）成对，使两端完成态一致。
 *
 * 仅在协作模式 + 已选家庭时生效；未共享 / 无网络 / 服务端异常均静默 no-op，
 * 绝不影响本地完成操作本身（本地完成走 engine，独立成功）。
 */
export function useTaskShareSync() {
  const collaborative = useCollaborative();
  const familyId = useFamilyStore((s) => s.currentFamilyId);

  return useCallback(
    async (taskId: string, done: boolean) => {
      if (!collaborative || !familyId) return;
      try {
        const items = await trpcCollab.sharedItems.listByFamily.query({ familyId });
        const hit = items.find(
          (it) => it.module === 'task' && it.itemType === 'task' && it.itemKey === taskId,
        );
        if (hit) await trpcCollab.sharedItems.update.mutate({ familyId, id: hit.id, done });
      } catch {
        /* 静默：本地完成不受协作同步失败影响 */
      }
    },
    [collaborative, familyId],
  );
}
