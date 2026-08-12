"""竞彩 workset 状态 + 比赛明细文件（镜像 sporttery src/sources/jingcai/workset.ts）。

workset.json 结构（以 business_date 分组）：
  {
    "version": 3,
    "updatedAt": "...",
    "completeDate": "2026-08-01",
    "dates": {
      "2026-08-11": {
        "attempts": 0,
        "last_settle_at": null,
        "matches": { "<sid>": {sid, business_date, kickoff, status, match_num,
                               sclass_id, sub_id, home/away team ids+names, scores,
                               analysis_done, odds_done, last_odds_at, odds_phase} }
      }
    }
  }

比赛明细文件 data/jc/matches/{sid}.json：
  {
    "match_id": sid, "business_date": "...", "kickoff_time": "...", "last_odds_at": "...",
    "detail": {
      "analysis": {"matches": {...}, "h2h": [...], "recent_home": [...], "recent_away": [...]},
      "odds": {"asian": [...], "over_under": [...], "european": [...]}   # 每类 = 最新全量 changes 列表
    }
  }

旧平铺格式 {"matches": {sid: {...}}} 自动迁移为 dates 结构。
"""
import json
import os
import time

from core import utils

WORKSET_PATH = os.path.join(utils.DATA_DIR, "jc", "workset.json")
MATCHES_DIR = os.path.join(utils.DATA_DIR, "jc", "matches")

VERSION = 3


class Workset:
    def __init__(self):
        self.data = {
            "version": VERSION,
            "updatedAt": "",
            "completeDate": None,
            "dates": {},
        }

    # ─── 持久化 ──────────────────────────────────────────────

    def load(self) -> None:
        if os.path.isfile(WORKSET_PATH):
            try:
                with open(WORKSET_PATH, "r", encoding="utf-8") as f:
                    parsed = json.load(f)
                self.data = {
                    "version": VERSION,
                    "updatedAt": parsed.get("updatedAt", ""),
                    "completeDate": parsed.get("completeDate"),
                    "dates": parsed.get("dates", {}),
                    "matches": parsed.get("matches", {}),   # 旧平铺格式，供 _migrate 转换
                }
                self._migrate()
                return
            except (json.JSONDecodeError, OSError):
                pass
        self.data = {"version": VERSION, "updatedAt": "", "completeDate": None, "dates": {}}

    def save(self) -> None:
        self.data["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        os.makedirs(os.path.dirname(WORKSET_PATH), exist_ok=True)
        tmp = f"{WORKSET_PATH}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, WORKSET_PATH)

    def _migrate(self) -> None:
        """旧平铺 {"matches": {sid: {...}}} → dates 分组结构。"""
        matches = self.data.get("matches")
        if not isinstance(matches, dict) or not matches:
            return
        for sid, m in matches.items():
            date = m.get("business_date")
            if not date:
                continue
            entry = self.data["dates"].setdefault(date, {"attempts": 0, "last_settle_at": None, "matches": {}})
            entry["matches"][str(sid)] = m
        self.data.pop("matches", None)

    # ─── completeDate ────────────────────────────────────────

    @property
    def complete_date(self):
        return self.data.get("completeDate")

    def set_complete_date(self, date: str) -> None:
        self.data["completeDate"] = date

    # ─── dates / matches ─────────────────────────────────────

    def dates(self) -> list:
        return sorted(self.data["dates"].keys())

    def total_matches(self) -> int:
        return sum(len(entry.get("matches", {})) for entry in self.data["dates"].values())

    def matches_of(self, date: str) -> dict:
        return self.data["dates"].get(date, {}).get("matches", {})

    def date_entry(self, date: str) -> dict:
        return self.data["dates"].setdefault(date, {"attempts": 0, "last_settle_at": None, "matches": {}})

    def remove_date(self, date: str) -> None:
        self.data["dates"].pop(date, None)

    def attempts(self, date: str) -> int:
        return self.date_entry(date).get("attempts", 0)

    def increment_attempts(self, date: str) -> None:
        self.date_entry(date)["attempts"] = self.attempts(date) + 1

    def last_settle_at(self, date: str):
        return self.date_entry(date).get("last_settle_at")

    def set_last_settle_at(self, date: str, iso: str) -> None:
        self.date_entry(date)["last_settle_at"] = iso

    def prune_empty_dates(self) -> None:
        for date in list(self.data["dates"].keys()):
            if not self.data["dates"][date].get("matches"):
                del self.data["dates"][date]

    # ─── upsert match ────────────────────────────────────────

    def upsert_match(self, m: dict) -> None:
        """合并/新增一条比赛（来自 bf_jc / JcResult 解析行）。"""
        sid = m.get("sid")
        date = m.get("business_date")
        if sid is None or not date:
            return
        entry = self.date_entry(date)
        key = str(sid)
        prev = entry["matches"].get(key, {})
        merged = dict(prev)
        for k, v in m.items():
            if v is not None or k not in merged:
                merged[k] = v
        merged.setdefault("analysis_done", prev.get("analysis_done", False))
        merged.setdefault("odds_done", prev.get("odds_done", False))
        merged.setdefault("first_odds_at", prev.get("first_odds_at"))
        merged.setdefault("last_odds_at", prev.get("last_odds_at"))
        merged.setdefault("final_odds_fetched", prev.get("final_odds_fetched", False))
        merged.setdefault("refund_checked", prev.get("refund_checked", False))
        merged.setdefault("backup_done", prev.get("backup_done", False))
        merged.setdefault("odds_phase", prev.get("odds_phase", "pending"))
        merged["sid"] = sid
        merged["business_date"] = date
        entry["matches"][key] = merged

    # ─── 比赛明细文件 ────────────────────────────────────────

    def match_file_path(self, sid) -> str:
        return os.path.join(MATCHES_DIR, f"{sid}.json")

    def match_file_exists(self, sid) -> bool:
        return os.path.isfile(self.match_file_path(sid))

    def new_match_file(self, sid, business_date, kickoff=None) -> dict:
        return {
            "match_id": sid,
            "business_date": business_date,
            "kickoff_time": kickoff,
            "last_odds_at": None,
            "detail": {},
        }

    def read_match(self, sid) -> dict:
        p = self.match_file_path(sid)
        if not os.path.isfile(p):
            return None
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None

    def save_match(self, jf: dict) -> None:
        os.makedirs(MATCHES_DIR, exist_ok=True)
        tmp = f"{self.match_file_path(jf['match_id'])}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(jf, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.match_file_path(jf["match_id"]))

    def delete_match_files(self, date: str) -> None:
        for m in self.matches_of(date).values():
            p = self.match_file_path(m.get("sid"))
            if os.path.isfile(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass

    # ─── 就绪判定 ────────────────────────────────────────────

    def is_date_ready(self, date: str) -> bool:
        """整日就绪 = 所有比赛已完赛 且 每场都有完整 detail（analysis + odds）。"""
        matches = self.matches_of(date)
        if not matches:
            return False
        for m in matches.values():
            if not is_terminal(m):
                return False
            jf = self.read_match(m.get("sid"))
            if not jf:
                return False
            detail = jf.get("detail") or {}
            if not detail.get("analysis") or not detail.get("odds"):
                return False
        return True


def is_settled(m: dict) -> bool:
    return m.get("status") == -1


def is_terminal(m: dict) -> bool:
    """完场（-1）或异常终止（-10）。"""
    return m.get("status") in (-1, -10)
