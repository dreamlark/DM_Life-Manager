// 方案 B：把家庭成员共享的「事项」一键导入到自己的个人页面（本地 engine）。
// 复用各个人页已验证的同一批 trpcLocal 写命令，零新增 API，避免引入新 bug。
// 支持走 engine 的 4 个内容模块：notes / task / reminder / interests。
// （mindmap 走 localStorage、domains/flow 为聚合总览，无干净单实体导入，不在本助手范围内。）
import { trpcLocal } from '../../lib/trpcLocal';
import type { SharedItemView } from './types';

type LocalUtils = ReturnType<typeof trpcLocal.useUtils>;

/** 是否支持「导入到我的页面」（仅单条内容、且模块有干净的本地实体创建路径） */
export function isImportable(item: SharedItemView): boolean {
  return (
    ['notes', 'task', 'reminder', 'interests'].includes(item.module) && item.itemType !== 'overview'
  );
}

/**
 * 把一条共享项复制为本地个人实体（不删除共享项，纯导入）。
 * 通过 useUtils() 返回的 client 代理发起 mutation（utils.client.X.mutate），
 * 这样不经过 react-query 的 mutation observer，调用方自行控制刷新。
 * @param utils 由调用方在组件内通过 trpcLocal.useUtils() 取得后传入。
 * @returns 成功提示文案
 */
export async function importSharedToLocal(utils: LocalUtils, item: SharedItemView): Promise<string> {
  const s = (item.snapshot ?? {}) as Record<string, unknown>;
  switch (item.module) {
    case 'notes':
      await utils.client.notes.ingest.mutate({
        title: item.label || '导入的笔记',
        bodyMarkdown: typeof s.bodyMarkdown === 'string' ? s.bodyMarkdown : '',
        kind: s.kind === 'notebook' ? 'notebook' : 'idea',
        tags: [],
        links: [],
      });
      return `已导入笔记「${item.label}」到「灵感·记事」`;
    case 'task':
      await utils.client.tasks.create.mutate({
        title: item.label || '导入的任务',
        domainKey: (typeof s.domainKey === 'string' ? s.domainKey : 'work') as never,
        importance: !!s.importance,
        urgency: !!s.urgency,
        priority: (typeof s.priority === 'string' ? s.priority : 'medium') as never,
        description: typeof s.description === 'string' ? s.description : '',
        scheduledStart: typeof s.scheduledStart === 'string' ? s.scheduledStart : null,
      });
      return `已导入任务「${item.label}」到「每日看板」`;
    case 'reminder':
      await utils.client.reminders.create.mutate({
        title: item.label || '导入的提醒',
        domainKey: (typeof s.domainKey === 'string' ? s.domainKey : 'work') as never,
        periodRule: typeof s.periodRule === 'string' && s.periodRule ? s.periodRule : '每年',
        nextFireAt:
          typeof s.nextFireAt === 'string' && s.nextFireAt
            ? s.nextFireAt
            : new Date().toISOString(),
        leadChain: [7, 1, 0],
      });
      return `已导入提醒「${item.label}」到「人生钟表铺」`;
    case 'interests':
      await utils.client.interests.capture.mutate({
        title: item.label || '导入的灵感',
        content: typeof s.content === 'string' ? s.content : '',
        attention: typeof s.attention === 'number' ? s.attention : 1,
        domainKey: typeof s.domainKey === 'string' ? s.domainKey : null,
        effortBudget: (typeof s.effortBudget === 'string' ? s.effortBudget : 'tbd') as never,
        sourceType: (typeof s.sourceType === 'string' ? s.sourceType : 'manual') as never,
      });
      return `已导入灵感「${item.label}」到「灵感孵化器」`;
    default:
      throw new Error('该模块暂不支持导入到个人页面');
  }
}
