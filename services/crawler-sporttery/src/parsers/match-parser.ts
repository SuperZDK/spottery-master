export interface ParsedScore {
  home: number | null;
  away: number | null;
}

export function parseMatchTime(raw: string): string {
  if (!raw) return "";

  const trimmed = raw.trim();

  const dateOnly = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec(trimmed);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00Z`;
  }

  const withTime = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (withTime) {
    const [, y, m, d, h, min, s] = withTime;
    const sec = s ?? "00";
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${min}:${sec}Z`;
  }

  const isoMatch = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(trimmed);
  if (isoMatch) {
    return trimmed;
  }

  return trimmed;
}

export function parseScore(raw: string): ParsedScore {
  if (!raw) return { home: null, away: null };

  const trimmed = raw.trim();

  const withDash = /^(\d+)\s*[:：]\s*(\d+)$/.exec(trimmed);
  if (withDash) {
    return {
      home: parseInt(withDash[1], 10),
      away: parseInt(withDash[2], 10),
    };
  }

  const vs = /^(\d+)\s*[-–]\s*(\d+)$/.exec(trimmed);
  if (vs) {
    return {
      home: parseInt(vs[1], 10),
      away: parseInt(vs[2], 10),
    };
  }

  return { home: null, away: null };
}

export function normalizeTeamName(name: string): string {
  if (!name) return "";
  return name.trim().replace(/\s+/g, " ");
}
