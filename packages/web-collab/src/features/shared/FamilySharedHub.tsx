// 协作模式「家庭共享」聚合页：堆叠各模块的共享看板（提醒/记事/脑图/心流/领域…）。
// 各模块只需提供 module 标识 + 快照渲染函数，复用通用 FamilySharedItemsBoard。
// 随着模块迁移逐步把对应 board 加进这里即可。
import { type ReactNode } from 'react';
import { relTime } from '@dm-life/shared';
import { FamilySharedItemsBoard } from './FamilySharedItemsBoard';
import { useMyRole } from '../../store/familyStore';
import type { SharedItemView } from './types';

// 家庭成员（非 guest）可对「共享的任务」进行协作操作（标记完成 / 备注 / 删除）
function useCollaborativeTasks(): boolean {
  const role = useMyRole();
  return role !== 'guest';
}

function renderReminder(item: SharedItemView): ReactNode {
  const s = item.snapshot ?? {};
  if (item.itemType === 'overview') {
    return `在跑 ${s.active ?? 0} · 待响 ${s.due ?? 0} · 逾期 ${s.overdue ?? 0}`;
  }
  const next = s.nextFireAt ? relTime(s.nextFireAt) : '';
  return `${s.periodRule ?? ''} · ${next} · ${s.status ?? ''}`;
}

function renderNotes(item: SharedItemView): ReactNode {
  const s = item.snapshot ?? {};
  if (item.itemType === 'overview') {
    return `灵感 ${s.idea ?? 0} · 记事 ${s.notebook ?? 0}`;
  }
  const raw = (s.bodyMarkdown ?? '') as string;
  const excerpt = raw.replace(/\n+/g, ' ').trim().slice(0, 80);
  const ellipsis = raw.length > 80 && excerpt.length >= 80 ? '…' : '';
  const prefix = s.kind === 'notebook' ? '📓 ' : '💡 ';
  return `${prefix}${excerpt}${ellipsis}`;
}

function renderMindmap(item: SharedItemView): ReactNode {
  const s = item.snapshot ?? {};
  if (item.itemType === 'overview') {
    return `共 ${s.total ?? 0} 张脑图`;
  }
  const data = (s.data ?? {}) as { nodeData?: { topic?: string } };
  const topic = data.nodeData?.topic ?? (s.name as string) ?? '';
  return `🧠 ${topic}`;
}

function renderFlow(item: SharedItemView): ReactNode {
  const s = item.snapshot ?? {};
  if (item.itemType === 'overview') {
    const avg = s.avgScore != null ? Number(s.avgScore).toFixed(1) : '—';
    const golden = s.goldenHour != null ? `${s.goldenHour}:00` : '—';
    return `专注 ${s.totalSessions ?? 0} 段 · 均分 ${avg} · 黄金时段 ${golden}`;
  }
  return '';
}

function renderDomain(item: SharedItemView): ReactNode {
  const s = item.snapshot ?? {};
  if (item.itemType === 'overview') {
    const total = s.totalMinutes ?? 0;
    const h = Math.round((total / 60) * 10) / 10;
    return `本周专注 ${h} h · ${(s.wheel?.length ?? 0)} 个领域`;
  }
  const m = s.minutes ?? 0;
  return `${s.name ?? ''} · ${m > 0 ? `${m} 分` : '无投入'}`;
}

function renderInterest(item: SharedItemView): ReactNode {
  const s = item.snapshot ?? {};
  if (item.itemType === 'overview') {
    const by = (s.byStatus ?? {}) as Record<string, number>;
    return `共 ${s.total ?? 0} 条 · 孵化中 ${by.incubating ?? 0}`;
  }
  return `${s.title ?? ''} · ${s.status ?? ''}`;
}

function renderTask(item: SharedItemView): ReactNode {
  const s = item.snapshot ?? {};
  if (item.itemType === 'overview') {
    const total = s.total ?? 0;
    const done = s.done ?? 0;
    return `共 ${total} 个任务 · 完成 ${done}`;
  }
  const flag = s.importance && s.urgency ? '重要紧急' : s.importance ? '重要' : s.urgency ? '紧急' : '日常';
  return `${s.title ?? ''} · ${flag}${s.status === 'done' ? ' · 已完成' : ''}`;
}

export function FamilySharedHub() {
  const collaborativeTasks = useCollaborativeTasks();
  return (
    <div className="space-y-6">
      <FamilySharedItemsBoard
        module="task"
        title="每日看板"
        icon="📋"
        collaborative={collaborativeTasks}
        renderSnapshot={renderTask}
        emptyHint="还没有家庭成员共享任务。在「个人模式」的每日看板点击「共享到家庭」即可把任务分享到这里。"
      />
      <FamilySharedItemsBoard
        module="reminder"
        title="人生钟表铺"
        icon="⏰"
        renderSnapshot={renderReminder}
        emptyHint="还没有家庭成员共享提醒数据。在「个人模式」的提醒页点击「共享到家庭」即可把你的钟分享到这里。"
      />
      <FamilySharedItemsBoard
        module="notes"
        title="灵感 · 记事本"
        icon="📝"
        renderSnapshot={renderNotes}
        emptyHint="还没有家庭成员共享笔记。在「个人模式」的灵感·记事页点击「共享到家庭」即可把笔记分享到这里。"
      />
      <FamilySharedItemsBoard
        module="mindmap"
        title="思维导图"
        icon="🧠"
        renderSnapshot={renderMindmap}
        emptyHint="还没有家庭成员共享脑图。在「个人模式」的脑图页点击「共享到家庭」即可把脑图分享到这里。"
      />
      <FamilySharedItemsBoard
        module="flow"
        title="心流仪表盘"
        icon="🌊"
        renderSnapshot={renderFlow}
        emptyHint="还没有家庭成员共享专注概览。在「个人模式」的心流页点击「共享到家庭」即可把你的专注数据分享到这里。"
      />
      <FamilySharedItemsBoard
        module="domains"
        title="领域平衡轮"
        icon="⚖️"
        renderSnapshot={renderDomain}
        emptyHint="还没有家庭成员共享领域平衡。在「个人模式」的平衡轮页点击「共享到家庭」即可把领域投入分享到这里。"
      />
      <FamilySharedItemsBoard
        module="interests"
        title="灵感孵化器"
        icon="🧪"
        renderSnapshot={renderInterest}
        emptyHint="还没有家庭成员共享灵感。在「个人模式」的孵化器页点击「共享到家庭」即可把灵感分享到这里。"
      />
    </div>
  );
}
