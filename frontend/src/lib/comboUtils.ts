export interface PassRule {
  passCount: number
  count: number
}

export interface MxNOption {
  label: string
  totalBets: number
  rules: PassRule[]
}

const MXN_TABLE: Record<number, MxNOption[]> = {
  2: [{ label: "2x1", totalBets: 1, rules: [{ passCount: 2, count: 1 }] }],
  3: [
    { label: "3x1", totalBets: 1, rules: [{ passCount: 3, count: 1 }] },
    { label: "3x3", totalBets: 3, rules: [{ passCount: 2, count: 3 }] },
    { label: "3x4", totalBets: 4, rules: [{ passCount: 2, count: 3 }, { passCount: 3, count: 1 }] },
  ],
  4: [
    { label: "4x1", totalBets: 1, rules: [{ passCount: 4, count: 1 }] },
    { label: "4x4", totalBets: 4, rules: [{ passCount: 3, count: 4 }] },
    { label: "4x5", totalBets: 5, rules: [{ passCount: 3, count: 4 }, { passCount: 4, count: 1 }] },
    { label: "4x6", totalBets: 6, rules: [{ passCount: 2, count: 6 }] },
    { label: "4x11", totalBets: 11, rules: [{ passCount: 2, count: 6 }, { passCount: 3, count: 4 }, { passCount: 4, count: 1 }] },
  ],
  5: [
    { label: "5x1", totalBets: 1, rules: [{ passCount: 5, count: 1 }] },
    { label: "5x5", totalBets: 5, rules: [{ passCount: 4, count: 5 }] },
    { label: "5x6", totalBets: 6, rules: [{ passCount: 4, count: 5 }, { passCount: 5, count: 1 }] },
    { label: "5x10", totalBets: 10, rules: [{ passCount: 2, count: 10 }] },
    { label: "5x16", totalBets: 16, rules: [{ passCount: 3, count: 10 }, { passCount: 4, count: 5 }, { passCount: 5, count: 1 }] },
    { label: "5x20", totalBets: 20, rules: [{ passCount: 2, count: 10 }, { passCount: 3, count: 10 }] },
    { label: "5x26", totalBets: 26, rules: [{ passCount: 2, count: 10 }, { passCount: 3, count: 10 }, { passCount: 4, count: 5 }, { passCount: 5, count: 1 }] },
  ],
  6: [
    { label: "6x1", totalBets: 1, rules: [{ passCount: 6, count: 1 }] },
    { label: "6x6", totalBets: 6, rules: [{ passCount: 5, count: 6 }] },
    { label: "6x7", totalBets: 7, rules: [{ passCount: 5, count: 6 }, { passCount: 6, count: 1 }] },
    { label: "6x15", totalBets: 15, rules: [{ passCount: 2, count: 15 }] },
    { label: "6x20", totalBets: 20, rules: [{ passCount: 3, count: 20 }] },
    { label: "6x22", totalBets: 22, rules: [{ passCount: 4, count: 15 }, { passCount: 5, count: 6 }, { passCount: 6, count: 1 }] },
    { label: "6x35", totalBets: 35, rules: [{ passCount: 2, count: 15 }, { passCount: 3, count: 20 }] },
    { label: "6x42", totalBets: 42, rules: [{ passCount: 3, count: 20 }, { passCount: 4, count: 15 }, { passCount: 5, count: 6 }, { passCount: 6, count: 1 }] },
    { label: "6x50", totalBets: 50, rules: [{ passCount: 2, count: 15 }, { passCount: 3, count: 20 }, { passCount: 4, count: 15 }] },
    { label: "6x57", totalBets: 57, rules: [{ passCount: 2, count: 15 }, { passCount: 3, count: 20 }, { passCount: 4, count: 15 }, { passCount: 5, count: 6 }, { passCount: 6, count: 1 }] },
  ],
  7: [
    { label: "7x1", totalBets: 1, rules: [{ passCount: 7, count: 1 }] },
    { label: "7x7", totalBets: 7, rules: [{ passCount: 6, count: 7 }] },
    { label: "7x8", totalBets: 8, rules: [{ passCount: 6, count: 7 }, { passCount: 7, count: 1 }] },
    { label: "7x21", totalBets: 21, rules: [{ passCount: 5, count: 21 }] },
    { label: "7x35", totalBets: 35, rules: [{ passCount: 4, count: 35 }] },
    { label: "7x120", totalBets: 120, rules: [{ passCount: 2, count: 21 }, { passCount: 3, count: 35 }, { passCount: 4, count: 35 }, { passCount: 5, count: 21 }, { passCount: 6, count: 7 }, { passCount: 7, count: 1 }] },
  ],
  8: [
    { label: "8x1", totalBets: 1, rules: [{ passCount: 8, count: 1 }] },
    { label: "8x8", totalBets: 8, rules: [{ passCount: 7, count: 8 }] },
    { label: "8x9", totalBets: 9, rules: [{ passCount: 7, count: 8 }, { passCount: 8, count: 1 }] },
    { label: "8x28", totalBets: 28, rules: [{ passCount: 6, count: 28 }] },
    { label: "8x56", totalBets: 56, rules: [{ passCount: 5, count: 56 }] },
    { label: "8x70", totalBets: 70, rules: [{ passCount: 4, count: 70 }] },
    { label: "8x247", totalBets: 247, rules: [{ passCount: 2, count: 28 }, { passCount: 3, count: 56 }, { passCount: 4, count: 70 }, { passCount: 5, count: 56 }, { passCount: 6, count: 28 }, { passCount: 7, count: 8 }, { passCount: 8, count: 1 }] },
  ],
}

export function getMxNOptions(matchCount: number): MxNOption[] {
  if (matchCount < 2) return []
  if (matchCount > 8) return [{ label: `${matchCount}x1`, totalBets: 1, rules: [{ passCount: matchCount, count: 1 }] }]
  return MXN_TABLE[matchCount] ?? []
}

export function getFreePassOptions(matchCount: number): { passCount: number; bets: number }[] {
  if (matchCount < 2) return []
  const opts: { passCount: number; bets: number }[] = []
  for (let i = 2; i <= matchCount; i++) {
    opts.push({ passCount: i, bets: C(matchCount, i) })
  }
  return opts
}

function C(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  let res = 1
  for (let i = 1; i <= k; i++) {
    res = (res * (n - i + 1)) / i
  }
  return res
}

export interface SelectionOdds {
  groupId: string
  label: string
  odds: number
}

function groupCombinations(
  items: { groupId: string; odds: number }[],
  k: number,
  danGroupIds: Set<string>
): number[][] {
  const valid: number[][] = []

  function backtrack(start: number, chosen: number[], usedGroups: Set<string>, danSelected: Set<string>) {
    if (chosen.length === k) {
      if (danGroupIds.size > 0) {
        let found = false
        for (const dg of danGroupIds) {
          if (danSelected.has(dg)) { found = true; break }
        }
        if (!found) return
      }
      valid.push([...chosen])
      return
    }
    for (let i = start; i < items.length; i++) {
      const g = items[i].groupId
      if (usedGroups.has(g)) continue
      usedGroups.add(g)
      const isDan = danGroupIds.has(g)
      if (isDan) danSelected.add(g)
      chosen.push(i)
      backtrack(i + 1, chosen, usedGroups, danSelected)
      chosen.pop()
      if (isDan) danSelected.delete(g)
      usedGroups.delete(g)
    }
  }

  backtrack(0, [], new Set(), new Set())
  return valid
}

export interface ComboDetail {
  indices: number[]
  product: number
  passCount: number
}

export function calcPayout(
  selections: SelectionOdds[],
  rules: PassRule[],
  danGroupIds: Set<string> = new Set()
): { totalBets: number; combos: ComboDetail[]; payouts: number[] } {
  let totalBets = 0
  const allCombos: ComboDetail[] = []

  for (const rule of rules) {
    const combos = groupCombinations(selections, rule.passCount, danGroupIds)
    for (const combo of combos) {
      let prod = 1
      for (const idx of combo) {
        prod *= selections[idx].odds
      }
      allCombos.push({ indices: combo, product: prod, passCount: rule.passCount })
      totalBets++
    }
  }

  return { totalBets, combos: allCombos, payouts: allCombos.map((c) => c.product) }
}

export function describeRules(rules: PassRule[]): string {
  return rules.map((r) => `${r.count}注${r.passCount}串1`).join(" + ")
}
