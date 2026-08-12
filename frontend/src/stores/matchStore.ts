import { create } from "zustand"
import type { MatchStatus } from "@/types/match"

interface MatchFilterState {
  league: string | null
  date: string | null
  status: MatchStatus | null
  setFilter: (key: string, value: string | null) => void
  reset: () => void
}

export const useMatchStore = create<MatchFilterState>((set) => ({
  league: null,
  date: null,
  status: null,

  setFilter: (key, value) => set({ [key]: value }),

  reset: () => set({ league: null, date: null, status: null }),
}))
