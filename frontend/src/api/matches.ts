import client from "./client"
import type { Match, MatchListParams, MatchDetail } from "@/types/match"
import type { BettingResponse } from "@/types/odds"

export const matchesApi = {
  list: (params?: MatchListParams) =>
    client.get<Match[]>("/matches", { params }).then((r) => r.data),

  getById: (id: number) =>
    client.get<MatchDetail>(`/matches/${id}`).then((r) => r.data),

  // 竞彩日赛（5 池最新赔率），source=jingcai 时按 business_date 双源读取
  betting: (businessDate: string) =>
    client
      .get<BettingResponse>("/matches", {
        params: { source: "jingcai", business_date: businessDate },
      })
      .then((r) => r.data),
}
