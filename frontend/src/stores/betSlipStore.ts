import { create } from "zustand"

export interface BetOption {
  optionId: string
  label: string
  odds: number
}

export interface BetGroup {
  groupId: string
  matchId: number
  matchLabel: string
  betType: string
  options: BetOption[]
  isDan: boolean
}

export type PassMode = "mxn" | "free"

interface BetSlipState {
  groups: BetGroup[]
  isOpen: boolean
  passMode: PassMode
  selectedMxN: string | null
  selectedFreePass: number[]
  multiplier: number
  conflictMessage: string | null

  addOption: (s: { matchId: number; matchLabel: string; betType: string; option: string; odds: number }) => void
  removeOption: (groupId: string, optionId: string) => void
  removeGroup: (groupId: string) => void
  toggleOpen: () => void
  toggleDan: (groupId: string) => void
  setMultiplier: (n: number) => void
  setPassMode: (m: PassMode) => void
  setSelectedMxN: (v: string | null) => void
  toggleFreePass: (passCount: number) => void
  clearConflict: () => void
  clearAll: () => void
}

export const useBetSlipStore = create<BetSlipState>((set, get) => ({
  groups: [],
  isOpen: false,
  passMode: "mxn",
  selectedMxN: null,
  selectedFreePass: [],
  multiplier: 1,
  conflictMessage: null,

  addOption: (s) => {
    const groupId = `${s.matchId}_${s.betType}`
    const optionId = `${s.matchId}_${s.betType}_${s.option}`

    const conflict = get().groups.find(
      (g) => g.matchId === s.matchId && g.betType !== s.betType
    )
    if (conflict) {
      set({
        conflictMessage: `「${s.matchLabel}」已选择「${conflict.betType}」，同一场比赛只能选择一种投注类型`,
      })
      return
    }

    const existing = get().groups.find((g) => g.groupId === groupId)
    if (existing) {
      const optExists = existing.options.find((o) => o.optionId === optionId)
      if (optExists) return
      set({
        groups: get().groups.map((g) =>
          g.groupId === groupId
            ? { ...g, options: [...g.options, { optionId, label: s.option, odds: s.odds }] }
            : g
        ),
        selectedMxN: null,
        selectedFreePass: [],
        conflictMessage: null,
      })
    } else {
      set({
        groups: [
          ...get().groups,
          {
            groupId,
            matchId: s.matchId,
            matchLabel: s.matchLabel,
            betType: s.betType,
            options: [{ optionId, label: s.option, odds: s.odds }],
            isDan: false,
          },
        ],
        selectedMxN: null,
        selectedFreePass: [],
        conflictMessage: null,
      })
    }
  },

  removeOption: (groupId, optionId) => {
    set((st) => {
      const updated = st.groups
        .map((g) =>
          g.groupId === groupId
            ? { ...g, options: g.options.filter((o) => o.optionId !== optionId) }
            : g
        )
        .filter((g) => g.options.length > 0)
      return { groups: updated, selectedMxN: null, selectedFreePass: [] }
    })
  },

  removeGroup: (groupId) => {
    set((st) => ({
      groups: st.groups.filter((g) => g.groupId !== groupId),
      selectedMxN: null,
      selectedFreePass: [],
    }))
  },

  toggleOpen: () => set((st) => ({ isOpen: !st.isOpen })),

  toggleDan: (groupId) => {
    set((st) => ({
      groups: st.groups.map((g) =>
        g.groupId === groupId ? { ...g, isDan: !g.isDan } : g
      ),
      selectedMxN: null,
      selectedFreePass: [],
    }))
  },

  setMultiplier: (n) => set({ multiplier: Math.max(1, Math.floor(n)) }),

  setPassMode: (m) => set({ passMode: m, selectedMxN: null, selectedFreePass: [] }),

  setSelectedMxN: (v) => set({ selectedMxN: v }),

  toggleFreePass: (passCount) => {
    const current = get().selectedFreePass
    const next = current.includes(passCount)
      ? current.filter((p) => p !== passCount)
      : [...current, passCount].sort((a, b) => a - b)
    set({ selectedFreePass: next })
  },

  clearConflict: () => set({ conflictMessage: null }),

  clearAll: () => set({ groups: [], multiplier: 1, selectedMxN: null, selectedFreePass: [], conflictMessage: null }),
}))
