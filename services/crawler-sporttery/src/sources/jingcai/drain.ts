import { upsertDailyMatches, upsertMatchDetail, upsertVoteSnapshots, getLatestBusinessDate } from "../../db/writer.js";
import { Workset } from "./workset.js";
import { addDaysStr, formatDate } from "./time.js";

export const DEFAULT_COMPLETE_DATE = "2026-08-03";

// 整日排干：schedules+最终votes → 各场 detail oddsHistory → 累计 votes 快照，
// 全部成功后删 JSON、删日；任一步失败保留下轮重试（幂等）。
export async function drainDate(ws: Workset, date: string): Promise<boolean> {
  const matches = ws.matchesOf(date);
  if (matches.length === 0) return true;
  try {
    await upsertDailyMatches(matches);
    for (const m of matches) {
      const jf = ws.readMatch(m.matchId);
      if (!jf) continue;
      if (jf.detail) await upsertMatchDetail(jf.matchId, jf.detail);
      const snaps = jf.voteSnapshots ?? [];
      if (snaps.length > 0) {
        await upsertVoteSnapshots(snaps.map((s) => ({ matchId: jf.matchId, at: s.at, had: s.had, handicap: s.handicap })));
      }
    }
    return true;
  } catch (err) {
    console.log(`[Drain] ${date} 导入失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// completeDate 顺序推进：只随"排干入库"推进（空条目不再参与推进）。
export function advanceCompleteDate(ws: Workset, endDate: Date, drained: string[]): void {
  const endStr = formatDate(endDate);
  let cd = ws.completeDate ?? DEFAULT_COMPLETE_DATE;
  const drainedSet = new Set(drained);
  while (true) {
    const n = addDaysStr(cd, 1);
    if (n > endStr) break;
    if (drainedSet.has(n)) { cd = n; continue; }
    break;
  }
  ws.setCompleteDate(cd);
}

// 启动自愈：completeDate = 数据库最新 business_date（权威来源），空则用默认基线。
export async function reconcileCompleteDate(ws: Workset): Promise<void> {
  const dbMax = await getLatestBusinessDate();
  if (dbMax) {
    ws.setCompleteDate(dbMax);
  } else if (!ws.completeDate) {
    ws.setCompleteDate(DEFAULT_COMPLETE_DATE);
  }
}
