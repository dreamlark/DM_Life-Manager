/**
 * 个人功能 Tab 定义（供 LocalApp 导航与 SettingsPage 开关共用，避免循环依赖）。
 */

export type Tab =
  | 'board'
  | 'finance'
  | 'reminder'
  | 'notes'
  | 'flow'
  | 'incubator'
  | 'mindmap'
  | 'calendar'
  | 'domains';

export const TAB_LABELS: Record<Tab, string> = {
  board: '每日看板',
  finance: '财务',
  reminder: '提醒',
  notes: '灵感·记事',
  mindmap: '脑图',
  calendar: '日历',
  flow: '心流',
  domains: '平衡轮',
  incubator: '孵化器',
};

export const TAB_ORDER: Tab[] = [
  'board',
  'finance',
  'reminder',
  'notes',
  'mindmap',
  'calendar',
  'flow',
  'domains',
  'incubator',
];
