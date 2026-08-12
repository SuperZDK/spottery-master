import * as fs from "fs";
import * as path from "path";
import { isRefund, isSettled } from "./completeness.js";

const WORKSET_PATH = path.join(import.meta.dirname, "../../../data/jingcai/workset.json");
const MATCHES_DIR = path.join(path.dirname(WORKSET_PATH), "matches");

export interface WorksetMatch {
  matchId: number;
  businessDate: string;
  matchDate?: string;
  matchNum?: string;
  homeTeam?: string;
  homeTeamId?: number;
  awayTeam?: string;
  awayTeamId?: number;
  league?: string;
  leagueId?: number;
  kickoffTime?: string | null;
  matchResult?: string;
  poolStatus?: string;
  had?: any;
  handicap?: any;
  firstOddsAt?: string | null;
  lastOddsAt?: string | null;
  finalOddsFetched?: boolean;
  detailFetched?: boolean;
  [key: string]: any;
}

export interface VoteSnapshot {
  at: string;
  had?: any;
  handicap?: any;
}

export interface MatchFile {
  matchId: number;
  businessDate: string;
  kickoffTime?: string | null;
  detail?: any;
  voteSnapshots?: VoteSnapshot[];
  lastOddsAt?: string;
  lastVoteAt?: string;
}

interface DateEntry {
  attempts: number;
  lastVoteAt?: string | null;
  matches: WorksetMatch[];
}

interface WorksetData {
  version: number;
  updatedAt: string;
  completeDate: string | null;
  dates: Record<string, DateEntry>;
}

export class Workset {
  private data: WorksetData = { version: 3, updatedAt: "", completeDate: null, dates: {} };

  load(): void {
    if (fs.existsSync(WORKSET_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(WORKSET_PATH, "utf-8"));
        this.data = {
          version: 3,
          updatedAt: parsed?.updatedAt ?? "",
          completeDate: parsed?.completeDate ?? null,
          dates: parsed?.dates ?? {},
        };
        this.migrate();
      } catch {
        this.data = { version: 3, updatedAt: "", completeDate: null, dates: {} };
      }
    }
  }

  // v2 → v3：把旧 workset 里内嵌的 detail 迁移到 matches/{id}.json
  private migrate(): void {
    for (const date of Object.keys(this.data.dates)) {
      const entry = this.data.dates[date];
      for (const m of entry.matches) {
        if (m.detail) {
          const jf = this.readMatch(m.matchId) ?? this.newMatchFile(m.matchId, m.businessDate);
          if (!jf.detail) {
            jf.detail = m.detail;
            jf.kickoffTime = m.detail?.matchInfo?.matchDateTime ?? m.kickoffTime ?? null;
          }
          jf.voteSnapshots = jf.voteSnapshots ?? [];
          this.saveMatch(jf);
          m.detailFetched = true;
          m.kickoffTime = m.kickoffTime ?? jf.kickoffTime ?? null;
          delete m.detail;
        }
      }
    }
  }

  get completeDate(): string | null {
    return this.data.completeDate;
  }

  setCompleteDate(date: string): void {
    this.data.completeDate = date;
  }

  get dates(): string[] {
    return Object.keys(this.data.dates).sort();
  }

  hasDate(date: string): boolean {
    return date in this.data.dates;
  }

  matchesOf(date: string): WorksetMatch[] {
    return this.data.dates[date]?.matches ?? [];
  }

  dateEntry(date: string): DateEntry {
    this.ensureDate(date);
    return this.data.dates[date];
  }

  lastVoteAt(date: string): string | null {
    return this.data.dates[date]?.lastVoteAt ?? null;
  }

  setLastVoteAt(date: string, iso: string): void {
    this.ensureDate(date);
    this.data.dates[date].lastVoteAt = iso;
  }

  attempts(date: string): number {
    return this.data.dates[date]?.attempts ?? 0;
  }

  ensureDate(date: string): void {
    if (!this.data.dates[date]) this.data.dates[date] = { attempts: 0, matches: [] };
  }

  incrementAttempts(date: string): void {
    this.ensureDate(date);
    this.data.dates[date].attempts++;
  }

  isEmpty(date: string): boolean {
    return (this.data.dates[date]?.matches?.length ?? 0) === 0;
  }

  // workset 里全部比赛数（=0 即进入 DISCOVERY 态）
  totalMatches(): number {
    let n = 0;
    for (const date of Object.keys(this.data.dates)) {
      n += this.data.dates[date]?.matches?.length ?? 0;
    }
    return n;
  }

  // 清理空条目（空条目无任何意义：发现/抓取命中时会自然创建带比赛的条目）
  pruneEmptyDates(): void {
    for (const date of Object.keys(this.data.dates)) {
      const len = this.data.dates[date]?.matches?.length ?? 0;
      if (len === 0) delete this.data.dates[date];
    }
  }

  isDateReady(date: string): boolean {
    const matches = this.matchesOf(date);
    return matches.length > 0 && matches.every((m) => isSettled(m) || isRefund(m));
  }

  removeDate(date: string): void {
    delete this.data.dates[date];
  }

  // 合并每日 getVoteV1 元数据；不处理 detail（由调用方落 JSON）
  upsertMatches(matches: any[]): void {
    for (const m of matches) {
      const date = m?.businessDate;
      if (!date || !m?.matchId) continue;
      this.ensureDate(date);
      const entry = this.data.dates[date];
      const idx = entry.matches.findIndex((x) => x.matchId === m.matchId);
      const incoming = { ...m };
      delete incoming.detail;
      if (idx >= 0) {
        const prev = entry.matches[idx];
        entry.matches[idx] = {
          ...prev,
          ...incoming,
          kickoffTime: prev.kickoffTime ?? incoming.kickoffTime ?? null,
          firstOddsAt: prev.firstOddsAt ?? incoming.firstOddsAt ?? null,
          lastOddsAt: prev.lastOddsAt ?? incoming.lastOddsAt ?? null,
          finalOddsFetched: prev.finalOddsFetched ?? incoming.finalOddsFetched ?? false,
          detailFetched: prev.detailFetched ?? incoming.detailFetched ?? false,
        };
      } else {
        entry.matches.push({
          ...incoming,
          kickoffTime: incoming.kickoffTime ?? null,
          firstOddsAt: null,
          lastOddsAt: null,
          finalOddsFetched: false,
          detailFetched: false,
        });
      }
    }
  }

  // ─── matches/{id}.json 文件操作 ───────────────────────────
  matchFilePath(matchId: number): string {
    return path.join(MATCHES_DIR, `${matchId}.json`);
  }

  matchFileExists(matchId: number): boolean {
    return fs.existsSync(this.matchFilePath(matchId));
  }

  newMatchFile(matchId: number, businessDate: string): MatchFile {
    return { matchId, businessDate, kickoffTime: null, detail: undefined, voteSnapshots: [], lastOddsAt: undefined, lastVoteAt: undefined };
  }

  readMatch(matchId: number): MatchFile | null {
    const p = this.matchFilePath(matchId);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as MatchFile;
    } catch {
      return null;
    }
  }

  saveMatch(jf: MatchFile): void {
    fs.mkdirSync(MATCHES_DIR, { recursive: true });
    const tmp = `${this.matchFilePath(jf.matchId)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(jf, null, 2), "utf-8");
    fs.renameSync(tmp, this.matchFilePath(jf.matchId));
  }

  // 排干成功后删除该日所有比赛的 JSON
  deleteMatchFiles(date: string): void {
    for (const m of this.matchesOf(date)) {
      const p = this.matchFilePath(m.matchId);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch {}
      }
    }
  }

  // 追加一条 votes 快照（与上一快照数值一致则不落），返回是否落盘
  recordVoteSnapshot(matchId: number, businessDate: string, at: string, had?: any, handicap?: any): boolean {
    let jf = this.readMatch(matchId);
    if (!jf) {
      jf = this.newMatchFile(matchId, businessDate);
    }
    jf.voteSnapshots = jf.voteSnapshots ?? [];
    const last = jf.voteSnapshots[jf.voteSnapshots.length - 1];
    if (last && last.at === at && jsonEqual(last.had, had) && jsonEqual(last.handicap, handicap)) {
      return false;
    }
    jf.voteSnapshots.push({ at, had, handicap });
    jf.lastVoteAt = at;
    this.saveMatch(jf);
    return true;
  }

  save(): void {
    this.data.updatedAt = new Date().toISOString();
    const tmp = `${WORKSET_PATH}.tmp`;
    fs.mkdirSync(path.dirname(WORKSET_PATH), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf-8");
    fs.renameSync(tmp, WORKSET_PATH);
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
