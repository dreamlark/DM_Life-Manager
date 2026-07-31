import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { User, Settings, Share2 } from 'lucide-react';
import { trpcLocal } from './lib/trpcLocal';
import { useEventStreamLocal } from './lib/sseLocal';
import { useUI } from './store/uiStore';
import { SettingsPage } from './components/SettingsPage';
import type { Tab } from './lib/tabs';
import { TAB_LABELS, TAB_ORDER } from './lib/tabs';
import { FloatingIcon } from './components/FloatingIcon';
import { buildScheduleTimes, todayStr } from '@dm-life/shared';
import { LeftColumn } from './features/board/LeftColumn';
import { CenterColumn } from './features/board/CenterColumn';
import { RightColumn } from './features/board/RightColumn';
import { TaskCardOverlay } from './features/board/TaskCard';
import { CommandPalette } from './features/command-palette/CommandPalette';
import { TaskDetailDialog } from './features/board/TaskDetailDialog';
import { TaskShareConfig } from './features/board/TaskShareConfig';
import { SHARE_BTN } from './features/shared/shareButton';
import { FinancePage } from './features/finance/FinancePage';
import { ReminderShopPage } from './features/reminder/ReminderShopPage';
import { NotesHubPage } from './features/notes/NotesHubPage';
import { MindMapPage } from './features/mindmap/MindMapPage';
import { FlowPage } from './features/flow/FlowPage';
import { DomainBalancePage } from './features/domains/DomainBalancePage';
import { IncubatorPage } from './features/interests/IncubatorPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { useCollaborative } from './store/modeStore';

const QUADRANT_KEYS = ['q1', 'q2', 'q3', 'q4'];
const resolveId = (id: string) => id.replace(/^(mit-|slot-)/, '');

/**
 * 顶部 Tab 按钮（模块级组件，保持稳定的函数标识）。
 * 注意：绝不能定义在 LocalApp 渲染函数内部——否则每次父组件因实时查询/SSE/拖拽状态重渲染时，
 * React 会把按钮整棵卸载重挂，导致 mousedown→mouseup 间的 click 事件丢失，表现为“点击无反应”。
 */
function TabButton({
  id,
  label,
  active,
  onChange,
}: {
  id: Tab;
  label: string;
  active: boolean;
  onChange: (id: Tab) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(id)}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        active ? 'bg-bg-raised text-accent' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * 个人模式外壳（复制自 packages/web 的 App，逻辑 1:1，仅改写数据客户端为 trpcLocal）。
 * 单机版代码保持不动，此处为复制后的等效实现。各功能 Tab 将随迁移逐步填充。
 */
export default function LocalApp({
  onOpenFamily,
  onLogout,
  onDeleteAccount,
}: {
  onOpenFamily: () => void;
  onLogout: () => void;
  onDeleteAccount: () => void;
}) {
  const [tab, setTab] = useState<Tab>('board');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const enabledTabs = useUI((s) => s.enabledTabs);
  const isTabEnabled = useUI((s) => s.isTabEnabled);
  // 当前 tab 被禁用时自动回到每日看板（看板不可关闭）
  useEffect(() => {
    if (!isTabEnabled(tab) && tab !== 'board') {
      setTab('board');
    }
  }, [tab, isTabEnabled]);
  const setQuadrant = trpcLocal.tasks.setQuadrant.useMutation();
  const setSchedule = trpcLocal.tasks.schedule.useMutation();
  const boardDate = useUI((s) => s.boardDate);
  const setBoardDate = useUI((s) => s.setBoardDate);
  const localUtils = trpcLocal.useUtils();
  const ensureDaily = trpcLocal.tasks.ensureDaily.useMutation();
  const { data: allTasks = [] } = trpcLocal.tasks.today.useQuery({ date: boardDate });
  const { data: domains = [] } = trpcLocal.domains.list.useQuery(undefined);
  const [activeId, setActiveId] = useState<string | null>(null);
  const collaborative = useCollaborative();
  useEventStreamLocal();

  // 进入看板（或切换查看日期）时，把每日例行模板实例化到该日期（仅今天及未来；过去日期不回溯生成）。
  // 关键修复：useMutation 的返回值每帧都会换新引用，若把它放进依赖数组，useEffect 会每帧重跑 →
  // 每帧 ensureDaily.mutate() → onSuccess 又 invalidate() → 重新渲染 → 引用再变 → 无限循环。
  // 该循环会疯狂 invalidate tasks.today，使「完成」等操作的 refetch 永远被下一帧取消/覆盖，看板卡在旧状态（切页才偶发刷新）。
  // 用 ref 守卫：同一个 boardDate 只实例化一次；依赖只放 boardDate（mutate 本身引用稳定）。
  const ensuredRef = useRef<string | null>(null);
  useEffect(() => {
    if (boardDate >= todayStr() && ensuredRef.current !== boardDate) {
      ensuredRef.current = boardDate;
      ensureDaily.mutate({ date: boardDate }, { onSuccess: () => { void localUtils.tasks.today.invalidate(); void localUtils.insights.dailyCard.invalidate(); } });
    }
  }, [boardDate]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const taskId = resolveId(String(active.id));
    if (overId !== taskId && QUADRANT_KEYS.includes(overId)) {
      setQuadrant.mutate({
        id: taskId,
        importance: overId === 'q1' || overId === 'q2',
        urgency: overId === 'q1' || overId === 'q3',
      }, { onSuccess: () => { void localUtils.tasks.today.invalidate(); void localUtils.insights.dailyCard.invalidate(); } });
    } else if (overId.startsWith('slot-')) {
      const hour = Number(overId.slice(5));
      const { scheduledStart, scheduledEnd } = buildScheduleTimes(hour, 0, 60);
      setSchedule.mutate({ id: taskId, scheduledStart, scheduledEnd }, { onSuccess: () => { void localUtils.tasks.today.invalidate(); void localUtils.insights.dailyCard.invalidate(); } });
    }
  };

  const onDragCancel = () => setActiveId(null);

  // #304 看板左右边栏可拖拽调整宽度，宽度持久化到 localStorage（dm-board-cols）。
  // 仅在大屏（>1100px，三栏都可见）应用内联 grid 模板；窄屏交给 styles.css 媒体查询收起。
  const clampW = (n: number) => Math.max(180, Math.min(460, Number.isFinite(n) ? n : 250));
  const loadW = (side: 'left' | 'right', fallback: number): number => {
    try {
      const raw = localStorage.getItem('dm-board-cols');
      if (raw) {
        const o = JSON.parse(raw);
        const v = side === 'left' ? o.left : o.right;
        if (Number.isFinite(v)) return clampW(v);
      }
    } catch {
      // ignore
    }
    return fallback;
  };
  const [leftW, setLeftW] = useState(() => loadW('left', 250));
  const [rightW, setRightW] = useState(() => loadW('right', 290));
  // #309 修复：窗口宽度变化时重新决定是否应用自定义 grid（避免切页/resize 后布局错乱）
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const gridRef = useRef<HTMLDivElement>(null);
  const leftWRef = useRef(leftW);
  leftWRef.current = leftW;
  const rightWRef = useRef(rightW);
  rightWRef.current = rightW;
  const dragRef = useRef<{ which: 'left' | 'right'; startX: number; startW: number } | null>(null);

  const startDrag = (which: 'left' | 'right', e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = {
      which,
      startX: e.clientX,
      startW: which === 'left' ? leftWRef.current : rightWRef.current,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const raw = d.which === 'left' ? d.startW + dx : d.startW - dx;
      const w = clampW(raw);
      if (d.which === 'left') setLeftW(w);
      else setRightW(w);
      const el = gridRef.current;
      if (el) {
        el.style.gridTemplateColumns =
          d.which === 'left'
            ? `${w}px 6px minmax(0, 1fr) 6px ${rightWRef.current}px`
            : `${leftWRef.current}px 6px minmax(0, 1fr) 6px ${w}px`;
      }
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(
          'dm-board-cols',
          JSON.stringify({ left: leftWRef.current, right: rightWRef.current }),
        );
      } catch {
        // ignore
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const activeTask = activeId ? allTasks.find((t: any) => t.id === resolveId(activeId)) : null;
  const activeColor = activeTask ? domains.find((d: any) => d.key === activeTask.domainKey)?.color : undefined;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="flex h-screen flex-col bg-bg-base text-fg">
        <header className="flex items-center gap-2 border-b border-bg-border px-4 py-3">
          <span className="flex items-center gap-2">
            <FloatingIcon icon="💎" tone="indigo" size="sm" />
            <span className="text-sm font-bold text-accent">DM_life</span>
          </span>
          <nav className="ml-3 flex items-center gap-1">
            {TAB_ORDER.filter((id) => id === 'board' || enabledTabs[id] !== false).map((id) => (
              <TabButton key={id} id={id} label={TAB_LABELS[id]} active={tab === id} onChange={setTab} />
            ))}
          </nav>
          <span className="ml-auto flex items-center gap-2">
            {collaborative && (
              <button
                onClick={onOpenFamily}
                title="进入家庭协作"
                className="flex items-center gap-1 rounded-md border border-bg-border bg-bg-raised px-2.5 py-1 text-xs text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
              >
                <User size={13} /> 协作
              </button>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              title="设置"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-bg-border bg-bg-raised text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
            >
              <Settings size={19} />
            </button>
          </span>
        </header>
        <main className="flex-1 overflow-hidden">
          {tab === 'notes' ? (
            <NotesHubPage />
          ) : tab === 'reminder' ? (
            <ReminderShopPage />
          ) : tab === 'finance' ? (
            <FinancePage />
          ) : tab === 'mindmap' ? (
            <MindMapPage />
          ) : tab === 'flow' ? (
            <FlowPage />
          ) : tab === 'domains' ? (
            <DomainBalancePage />
          ) : tab === 'incubator' ? (
            <IncubatorPage />
          ) : tab === 'calendar' ? (
            <CalendarPage />
          ) : tab === 'board' ? (
            <div className="flex h-full flex-col overflow-hidden p-4">
              {/* 看板工具条：日期选择 + 每日例行实例化 + 共享到家庭 */}
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-200">每日看板</span>
                <input
                  type="date"
                  value={boardDate}
                  onChange={(e) => setBoardDate(e.target.value)}
                  className="rounded-lg bg-bg-base px-2 py-1 text-xs text-gray-100 outline-none ring-accent/40 focus:ring-2"
                  title="查看某天的看板"
                />
                <button
                  onClick={() => setBoardDate(todayStr())}
                  className="rounded-md border border-bg-border bg-bg-raised px-2 py-1 text-xs text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
                  title="回到今天"
                >
                  今日
                </button>
                {boardDate !== todayStr() && (
                  <span className="text-[11px] text-amber-300/80">查看历史/未来日期（统计仅计入对应日期）</span>
                )}
                {collaborative && (
                  <button
                    onClick={() => setShareOpen(true)}
                    className={`${SHARE_BTN} ml-auto`}
                    title="把当日看板任务共享到家庭"
                  >
                    <Share2 size={13} /> 共享到家庭
                  </button>
                )}
              </div>
              <div
                ref={gridRef}
                className="board-grid"
                style={
                  windowWidth > 1100
                    ? { gridTemplateColumns: `${leftW}px 6px minmax(0, 1fr) 6px ${rightW}px` }
                    : undefined
                }
              >
                <LeftColumn />
                <div
                  className="board-splitter"
                  onPointerDown={(e) => startDrag('left', e)}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="拖拽调整左栏宽度"
                  title="拖拽调整左栏宽度"
                />
                <CenterColumn onOpenFlow={() => setTab('flow')} />
                <div
                  className="board-splitter"
                  onPointerDown={(e) => startDrag('right', e)}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="拖拽调整右栏宽度"
                  title="拖拽调整右栏宽度"
                />
                <RightColumn />
              </div>
              {collaborative && <TaskShareConfig open={shareOpen} onClose={() => setShareOpen(false)} />}
            </div>
          ) : (
            <div className="grid h-full place-items-center p-10 text-center">
              <div>
                <div className="text-lg font-semibold text-gray-200">「{TAB_LABELS[tab]}」模块迁移中</div>
                <div className="mt-2 text-sm text-gray-400">
                  该单机版功能将在后续步骤逐一迁移至联机版，保持与原单机版一致的逻辑。
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      <CommandPalette />
      <TaskDetailDialog />
      <SettingsPage
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onLogout={onLogout}
        onDeleteAccount={onDeleteAccount}
      />
      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCardOverlay task={activeTask} color={activeColor} accentBorder={activeTask.isMit} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
