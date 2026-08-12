export function parseOddsValue(val: string | number): number {
  if (typeof val === "number") return val;

  const trimmed = val.trim();
  if (!trimmed) return 0;

  const parsed = parseFloat(trimmed);
  return isNaN(parsed) ? 0 : parsed;
}

const bookmakerNameMap: Record<string, string> = {
  "竞彩": "jingcai",
  "SB": "sbo",
  "澳门": "macau",
  "bet365": "bet365",
  "Interwetten": "interwetten",
  "威廉希尔": "williamhill",
  "立博": "ladbrokes",
  "伟德": "victoria",
  "易胜博": "expekt",
};

export function normalizeBookmakerName(name: string): string {
  if (!name) return "";
  const trimmed = name.trim();
  return bookmakerNameMap[trimmed] ?? trimmed;
}
