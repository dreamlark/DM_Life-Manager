/**
 * 周期规则解析：把「每3个月 / 每季度 / every 2 weeks」等自由文本解析为下次响铃时间。
 * 无法识别时回退 +30 天。engine 与 web 共用同一实现，避免漂移。
 */
/**
 * 解析下次响铃时间。
 * @returns 下次响铃的 ISO 时间；返回 `null` 表示该提醒不再重复（如「单次」）。
 */
export function computeNextFire(periodRule: string, fromIso: string): string | null {
  const rule = periodRule.trim().toLowerCase();
  const d = new Date(fromIso);
  const day = /(?:每\s*(\d+)\s*天|every\s+(\d+)\s*days?)/.exec(rule);
  const week = /(?:每\s*(\d+)\s*周|every\s+(\d+)\s*weeks?)/.exec(rule);
  const month = /(?:每\s*(\d+)\s*个?月|every\s+(\d+)\s*months?)/.exec(rule);
  const year = /(?:每\s*(\d+)\s*年|every\s+(\d+)\s*years?)/.exec(rule);

  if (day) return new Date(d.getTime() + Number(day[1]) * 86400000).toISOString();
  if (week) return new Date(d.getTime() + Number(week[1]) * 7 * 86400000).toISOString();
  if (month) return addMonths(d, Number(month[1])).toISOString();
  if (year) return addYears(d, Number(year[1])).toISOString();
  // 预设关键字（钟表面板只暴露这 6 种：单次/每天/每周/每月/每季度/每年）
  if (/(每天|daily)/.test(rule)) return new Date(d.getTime() + 86400000).toISOString();
  if (/(每周|weekly)/.test(rule)) return new Date(d.getTime() + 7 * 86400000).toISOString();
  if (/(每月|monthly)/.test(rule)) return addMonths(d, 1).toISOString();
  if (/(每季度|quarterly)/.test(rule)) return addMonths(d, 3).toISOString();
  if (/(每半年|semiannual)/.test(rule)) return addMonths(d, 6).toISOString();
  if (/(每年|annually|yearly)/.test(rule)) return addYears(d, 1).toISOString();
  // 「单次」提醒：完成一次后不再重复（completeReminder 据此置为 done）
  if (/(单次|once|one-?time)/.test(rule)) return null;
  return new Date(d.getTime() + 30 * 86400000).toISOString();
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}
function addYears(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCFullYear(r.getUTCFullYear() + n);
  return r;
}

/** 把 ISO 时间转成本地 datetime-local 输入框需要的 `YYYY-MM-DDTHH:mm` */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 本地时区的今日日期（YYYY-MM-DD），用于前端任务日期默认值与看板日期比较 */
export function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 相对当前时间的中文描述：今天 / 明天 / N 天后 / 逾期 N 天 */
export function relTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(diff / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === -1) return '昨天';
  if (days > 1) return `${days} 天后`;
  return `逾期 ${-days} 天`;
}

/**
 * 基于「今天某小时:分钟」构造一段日程的起止时间。
 * 返回本地时间字符串（无时区后缀），便于 `new Date()` 按本地解析、与显示一致。
 */
export function buildScheduleTimes(
  hour: number,
  minute = 0,
  durationMin = 60,
): { scheduledStart: string; scheduledEnd: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes(),
    )}:${pad(d.getSeconds())}`;
  const start = new Date();
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start.getTime() + durationMin * 60_000);
  return { scheduledStart: fmt(start), scheduledEnd: fmt(end) };
}

/** 取已安排时间的小时（本地，0-23）；未安排或无法解析返回 null */
export function hourOfScheduled(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.getHours();
}
