export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1"

export const BET_TYPES = {
  SPF: "胜平负",
  RQSPF: "让球胜平负",
  BF: "比分",
  ZJQ: "总进球数",
  BQC: "半全场",
} as const

export const MATCH_STATUS = {
  SCHEDULED: "未开始",
  LIVE: "进行中",
  FINISHED: "已结束",
  POSTPONED: "延期",
  CANCELLED: "取消",
} as const
