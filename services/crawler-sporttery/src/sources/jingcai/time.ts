export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function isWeekend(dateStr: string): boolean {
  const dow = parseDate(dateStr).getDay();
  return dow === 0 || dow === 6;
}

// 禁售时间：工作日 22:00，周末 23:00（本地时区）
export function stopTime(businessDate: string): Date {
  const d = parseDate(businessDate);
  d.setHours(isWeekend(businessDate) ? 23 : 22, 0, 0, 0);
  return d;
}

// "YYYY-MM-DD HH:MM:SS"（与历史基线 votes snapshot 格式一致）
export function stopTimeStr(businessDate: string): string {
  const d = stopTime(businessDate);
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, "0")}:00:00`;
}

export function parseLocalDateTime(str?: string | null): Date | null {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}

// 每场有效截止 T = min(开赛, 禁售)；开赛未知时默认禁售
export function effectiveStop(businessDate: string, kickoffTime?: string | null): Date {
  const cutoff = stopTime(businessDate);
  const kick = parseLocalDateTime(kickoffTime);
  if (!kick) return cutoff;
  return kick < cutoff ? kick : cutoff;
}

// 赔率关键时间点：T-1h、T-30min、T-15min、T-5min、T
export function oddsPollPoints(t: Date): Date[] {
  const base = t.getTime();
  return [
    new Date(base - 60 * MINUTE),
    new Date(base - 30 * MINUTE),
    new Date(base - 15 * MINUTE),
    new Date(base - 5 * MINUTE),
    new Date(base),
  ];
}

// votes 关键时间点：T-30min、T-15min、T
export function votePollPoints(t: Date): Date[] {
  const base = t.getTime();
  return [
    new Date(base - 30 * MINUTE),
    new Date(base - 15 * MINUTE),
    new Date(base),
  ];
}
