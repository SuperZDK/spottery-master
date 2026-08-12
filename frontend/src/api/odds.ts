import client from "./client"
import type { OddsItem, OddsHistoryResponse } from "@/types/odds"

export const oddsApi = {
  getByMatch: (matchId: number) =>
    client.get<OddsItem[]>(`/matches/${matchId}/odds`).then((r) => r.data),

  getHistory: (matchId: number, oddsType: string = "SPF", bookmaker?: string) =>
    client.get<OddsHistoryResponse>(`/matches/${matchId}/odds/history`, {
      params: { odds_type: oddsType, bookmaker },
    }).then((r) => r.data),
}
