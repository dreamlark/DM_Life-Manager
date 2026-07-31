import { useCallback, useEffect, useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { onBoardEvent } from '../lib/realtime';
import { useFamilyStore } from '../store/familyStore';
import { useAuthStore } from '../store/authStore';
import { can } from '../lib/rbac';
import type { Role, CalendarEvent } from '@dm-life/server';
import { Toasts } from './Toasts';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** ISO -> datetime-local 输入框值（本地时区 YYYY-MM-DDTHH:mm） */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function fmtTime(iso: string, allDay: boolean): string {
  if (allDay) return '全天';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
function fmtDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** 生成某月的日历矩阵（周日为每周起点），不足补 null */
function monthMatrix(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function CalendarPage() {
  const families = useFamilyStore((s) => s.families);
  const currentFamilyId = useFamilyStore((s) => s.currentFamilyId);
  const members = useFamilyStore((s) => s.members);
  const me = useAuthStore((s) => s.user);

  const current = families.find((f) => f.id === currentFamilyId) ?? null;
  const myRole: Role | null = current?.role ?? null;
  const canCreate = can(myRole, 'createEvent');
  const canEdit = can(myRole, 'editEvent');

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; event?: CalendarEvent; defaultStart?: string } | null>(null);

  const nameOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.userId, m.name]));
    return (id: string) => map.get(id) ?? '未知';
  }, [members]);

  const refresh = useCallback(
    async (familyId?: string) => {
      const fid = familyId ?? currentFamilyId;
      if (!fid) return;
      const list = await trpc.calendarEvents.list.query({ familyId: fid });
      setEvents(list);
    },
    [currentFamilyId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh, currentFamilyId]);

  // 实时网关：收到当前家庭的 calendar.* 事件即刷新日历（跨成员无需 reload）
  useEffect(() => {
    const off = onBoardEvent((e) => {
      if (e.familyId === currentFamilyId && typeof e.kind === 'string' && e.kind.startsWith('calendar.')) {
        void refresh();
      }
    });
    return off;
  }, [currentFamilyId, refresh]);

  const weeks = useMemo(() => monthMatrix(viewYear, viewMonth), [viewYear, viewMonth]);
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = new Date(ev.startAt).toDateString();
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  const canDelete = (ev: CalendarEvent) => ev.createdBy === me?.id || myRole === 'owner' || myRole === 'admin';

  async function remove(ev: CalendarEvent) {
    if (!window.confirm(`删除事件「${ev.title}」？`)) return;
    setBusyId(ev.id);
    try {
      await trpc.calendarEvents.remove.mutate({ eventId: ev.id });
      setFeedback('已删除事件');
      await refresh();
    } catch (e) {
      setFeedback(extractMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!currentFamilyId) {
    return (
      <div className="board">
        <div className="board-feedback">请先在「成员」标签创建或加入一个家庭。</div>
      </div>
    );
  }

  return (
    <div className="board">
      <header className="board-head glass">
        <div className="board-title">
          <span className="board-emoji">📅</span>
          <div>
            <h2>家庭共享日历</h2>
            <div className="my-role">家庭日程 · 创建 / 编辑 / 实时同步</div>
          </div>
        </div>
        <div className="board-head-right">
          {canCreate && (
            <button
              className="btn-primary magnetic"
              type="button"
              onClick={() =>
                setModal({
                  mode: 'create',
                  defaultStart: new Date(viewYear, viewMonth, today.getDate(), 9, 0).toISOString(),
                })
              }
            >
              ＋ 新建事件
            </button>
          )}
        </div>
      </header>

      {feedback && <div className="board-feedback">{feedback}</div>}
      <Toasts />

      <div className="cal-nav glass">
        <button className="icon-btn" type="button" onClick={() => gotoMonth(-1)} title="上个月">
          ‹
        </button>
        <span className="cal-title">
          {viewYear} 年 {viewMonth + 1} 月
        </span>
        <button className="icon-btn" type="button" onClick={() => gotoMonth(1)} title="下个月">
          ›
        </button>
        <button className="btn-ghost sm" type="button" onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}>
          今天
        </button>
      </div>

      <div className="cal-grid glass">
        <div className="cal-weekdays">
          {WEEKDAYS.map((w) => (
            <div key={w} className="cal-weekday">
              {w}
            </div>
          ))}
        </div>
        <div className="cal-weeks">
          {weeks.map((week, wi) => (
            <div key={wi} className="cal-week">
              {week.map((day, di) => {
                if (!day) return <div key={di} className="cal-cell empty" />;
                const dayEvents = eventsByDay.get(day.toDateString()) ?? [];
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={di}
                    className={`cal-cell${isToday ? ' today' : ''}`}
                    onClick={() =>
                      canCreate &&
                      setModal({
                        mode: 'create',
                        defaultStart: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0).toISOString(),
                      })
                    }
                  >
                    <div className="cal-daynum">{day.getDate()}</div>
                    <div className="cal-events">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          className="cal-chip"
                          disabled={busyId === ev.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ mode: 'edit', event: ev });
                          }}
                        >
                          <span className="cal-chip-time">{fmtTime(ev.startAt, ev.allDay)}</span>
                          <span className="cal-chip-title">{ev.title}</span>
                        </button>
                      ))}
                      {dayEvents.length > 3 && <div className="cal-more">+{dayEvents.length - 3} 更多</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {modal && (
        <EventModal
          familyId={currentFamilyId}
          mode={modal.mode}
          event={modal.event}
          defaultStart={modal.defaultStart}
          canEdit={canEdit}
          canDelete={modal.event ? canDelete(modal.event) : false}
          nameOf={nameOf}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await refresh();
          }}
        />
      )}
    </div>
  );

  function gotoMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  }
}

function EventModal({
  familyId,
  mode,
  event,
  defaultStart,
  canEdit,
  canDelete,
  nameOf,
  onClose,
  onSaved,
}: {
  familyId: string;
  mode: 'create' | 'edit';
  event?: CalendarEvent;
  defaultStart?: string;
  canEdit: boolean;
  canDelete: boolean;
  nameOf: (id: string) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [startAt, setStartAt] = useState(event ? toLocalInput(event.startAt) : defaultStart ? toLocalInput(defaultStart) : '');
  const [endAt, setEndAt] = useState(event?.endAt ? toLocalInput(event.endAt) : '');
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) {
      setError('请填写事件标题');
      return;
    }
    if (!startAt) {
      setError('请选择开始时间');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        startAt: new Date(startAt).toISOString(),
        endAt: endAt ? new Date(endAt).toISOString() : undefined,
        allDay,
      };
      if (mode === 'create') {
        await trpc.calendarEvents.create.mutate({ familyId, ...payload });
      } else if (event) {
        await trpc.calendarEvents.update.mutate({ eventId: event.id, ...payload });
      }
      onSaved();
    } catch (e) {
      setError(extractMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!event) return;
    if (!window.confirm(`删除事件「${event.title}」？`)) return;
    setBusy(true);
    try {
      await trpc.calendarEvents.remove.mutate({ eventId: event.id });
      onSaved();
    } catch (e) {
      setError(extractMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const readOnly = mode === 'edit' && !canEdit && !canDelete;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{mode === 'create' ? '新建日历事件' : `事件详情 · ${event ? nameOf(event.createdBy) + ' 创建' : ''}`}</h3>
          <button className="icon-btn" type="button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>标题</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：家庭聚餐" disabled={readOnly} autoFocus />
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>地点（可选）</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如：家里 / 餐厅" disabled={readOnly} />
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>开始时间</label>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} disabled={readOnly} />
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>结束时间（可选）</label>
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} disabled={readOnly} />
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label className="checkbox">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} disabled={readOnly} /> 全天事件
          </label>
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>备注（可选）</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="补充说明" disabled={readOnly} rows={2} />
        </div>

        {event && (
          <div className="event-meta">📆 {fmtDayLabel(event.startAt)} · {event.location ? '📍 ' + event.location : '无地点'}</div>
        )}

        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          {!readOnly && (
            <button className="btn-primary magnetic" type="button" disabled={busy} onClick={submit}>
              {busy ? '保存中…' : mode === 'create' ? '创建事件' : '保存'}
            </button>
          )}
          {mode === 'edit' && canDelete && (
            <button className="btn-danger" type="button" disabled={busy} onClick={onDelete}>
              删除
            </button>
          )}
          <button className="btn-ghost" type="button" onClick={onClose}>
            {readOnly ? '关闭' : '取消'}
          </button>
        </div>
      </div>
    </div>
  );
}

function extractMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return '操作失败，请重试';
}
