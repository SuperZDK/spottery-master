import { useEffect, useMemo, useRef, useState } from "react"
import { useBetSlipStore } from "@/stores/betSlipStore"
import type { PassMode as PassModeT } from "@/stores/betSlipStore"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ShoppingCart, X } from "lucide-react"
import { getMxNOptions, getFreePassOptions, calcPayout, describeRules } from "@/lib/comboUtils"
import type { SelectionOdds } from "@/lib/comboUtils"

const UNIT_STAKE = 2

const WEEKDAY_ORDER: Record<string, number> = {
  周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 7,
}

function matchSortKey(g: { matchLabel: string }): string {
  const m = g.matchLabel.match(/^(\D+)(\d+)/)
  if (!m) return g.matchLabel
  const day = WEEKDAY_ORDER[m[1]] ?? 0
  const num = parseInt(m[2], 10)
  return `${String(day).padStart(2, "0")}${String(num).padStart(4, "0")}`
}

function ComboPopover({
  flatSelections,
  combos,
  stakePerBet,
}: {
  flatSelections: SelectionOdds[]
  combos: { indices: number[]; product: number; passCount: number }[]
  stakePerBet: number
}) {
  const [open, setOpen] = useState(false)
  const [popAbove, setPopAbove] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  useEffect(() => {
    if (!open || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 4
    setPopAbove(below < 280)
  }, [open])

  const popoverStyle: React.CSSProperties = popAbove
    ? { bottom: "100%", marginBottom: "4px" }
    : { top: "100%", marginTop: "4px" }

  return (
    <div ref={ref} className="relative inline-block">
      <span
        className="cursor-pointer border-b border-dashed border-muted-foreground/40 text-xs text-muted-foreground hover:text-foreground"
        onMouseEnter={() => setOpen(true)}
        onClick={() => setOpen((v) => !v)}
      >
        明细
      </span>
      {open && (
        <div
          className="absolute right-0 z-50 max-h-80 w-80 overflow-y-auto rounded-lg border bg-popover p-3 shadow-lg"
          style={popoverStyle}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="space-y-1.5">
            {combos.map((c, i) => (
              <div key={i} className="flex items-start justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  组合{i + 1} ({c.passCount}×1):{" "}
                  {c.indices
                    .map((idx) => {
                      const sel = flatSelections[idx]
                      const label = sel.label
                      const matchCode = label.split(" ")[0]
                      const option = label.split(" ").pop() ?? ""
                      return `${matchCode} ${option}(${sel.odds.toFixed(2)})`
                    })
                    .join(" × ")}
                </span>
                <span className="shrink-0 font-medium">
                  {(c.product * stakePerBet).toFixed(2)}元
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BetSimulator() {
  const {
    groups: rawGroups, isOpen, passMode, selectedMxN, selectedFreePass, multiplier, conflictMessage,
    removeOption, toggleOpen, toggleDan, setMultiplier, setPassMode, setSelectedMxN,
    toggleFreePass, clearConflict, clearAll,
  } = useBetSlipStore()

  const groups = useMemo(() => {
    const sorted = [...rawGroups].sort((a, b) => {
      const ka = matchSortKey(a)
      const kb = matchSortKey(b)
      if (ka < kb) return -1
      if (ka > kb) return 1
      return 0
    })
    return sorted
  }, [rawGroups])

  const groupCount = groups.length

  const danGroupIds = useMemo(
    () => new Set(groups.filter((g) => g.isDan).map((g) => g.groupId)),
    [groups]
  )

  const danCount = danGroupIds.size

  const flatSelections: SelectionOdds[] = useMemo(
    () =>
      groups.flatMap((g) =>
        g.options.map((o) => ({
          groupId: g.groupId,
          label: `${g.matchLabel} ${g.betType} ${o.label}`,
          odds: o.odds,
        }))
      ),
    [groups]
  )

  const mxnOpts = useMemo(() => {
    const base = getMxNOptions(groupCount)
    if (base.length === 0 || flatSelections.length === 0) return base
    return base.map((opt) => {
      const result = calcPayout(flatSelections, opt.rules, danGroupIds)
      return { ...opt, totalBets: result.totalBets }
    })
  }, [groupCount, flatSelections, danGroupIds])

  const freeOpts = useMemo(() => {
    const base = getFreePassOptions(groupCount)
    if (base.length === 0 || flatSelections.length === 0) return base
    return base.map((opt) => {
      const result = calcPayout(flatSelections, [{ passCount: opt.passCount, count: opt.bets }], danGroupIds)
      return { ...opt, bets: result.totalBets }
    })
  }, [groupCount, flatSelections, danGroupIds])

  const activeRules = useMemo(() => {
    if (groupCount < 2) return null
    if (passMode === "mxn") {
      const opt = mxnOpts.find((o) => o.label === selectedMxN)
      return opt?.rules ?? null
    }
    if (passMode === "free" && selectedFreePass.length > 0) {
      return selectedFreePass.map((pc) => {
        const found = freeOpts.find((o) => o.passCount === pc)
        return { passCount: pc, count: found?.bets ?? 0 }
      })
    }
    return null
  }, [groupCount, passMode, selectedMxN, selectedFreePass, mxnOpts, freeOpts])

  const calcResult = useMemo(
    () =>
      activeRules && flatSelections.length > 0
        ? calcPayout(flatSelections, activeRules, danGroupIds)
        : null,
    [flatSelections, activeRules, danGroupIds]
  )

  const [multInput, setMultInput] = useState(String(multiplier))
  useEffect(() => {
    setMultInput(String(multiplier))
  }, [multiplier])

  const parsedMult = parseInt(multInput, 10)
  const multIsError = multInput === "" || isNaN(parsedMult) || parsedMult < 1
  const multIsWarning = !multIsError && parsedMult > 50
  const multMessage = multIsError ? "倍数应至少为1" : multIsWarning ? "最大倍数为50" : null
  const effectiveMult = multIsError ? 1 : Math.min(parsedMult, 50)

  const actualTotalBets = calcResult?.totalBets ?? 0
  const totalStake = actualTotalBets * UNIT_STAKE * effectiveMult
  const stakePerBet = actualTotalBets > 0 ? totalStake / actualTotalBets : 0
  const totalPayout =
    calcResult && actualTotalBets > 0
      ? calcResult.payouts.reduce((s, p) => s + p * stakePerBet, 0)
      : 0

  return (
    <>
      {/* ─── 折叠态：右下角悬浮按钮（不占布局、不遮挡正文） ─── */}
      <button
        onClick={toggleOpen}
        className="fixed bottom-4 right-4 z-40 flex h-12 items-center gap-2 rounded-full border bg-background px-4 shadow-lg transition-transform hover:scale-105"
        title={isOpen ? "收起投注模拟器" : "展开投注模拟器"}
      >
        <ShoppingCart className="h-5 w-5 text-primary" />
        <span className="text-sm font-bold">{groupCount}场</span>
      </button>

      {/* ─── 展开态：FAB 上方悬浮面板（fixed，不占布局空间） ─── */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 z-40 w-[min(26rem,calc(100vw-2rem))]">
          <Card className="max-h-[min(70vh,40rem)] overflow-y-auto border-primary/20">
            <div className="sticky top-0 flex items-center justify-between border-b bg-card/95 px-4 py-3 backdrop-blur">
              <CardTitle className="flex items-center gap-2 text-base">
                投注模拟器
                {groupCount > 0 && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                    {groupCount}场
                  </span>
                )}
              </CardTitle>
              <button
                onClick={toggleOpen}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="收起"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <CardContent className="space-y-4 pt-4">
              {groupCount === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  点击上方赔率添加投注选项
                </p>
              ) : (
                <>
                  {/* ─── Conflict Warning ─── */}
                  {conflictMessage && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                      <span className="mt-0.5 text-destructive">⚠</span>
                      <span className="flex-1 text-foreground">{conflictMessage}</span>
                      <button onClick={clearConflict} className="text-muted-foreground hover:text-foreground">✕</button>
                    </div>
                  )}

                  {/* ─── Groups (sorted) ─── */}
                  <div className="space-y-2">
                    {groups.map((g) => (
                      <div
                        key={g.groupId}
                        className={`rounded-lg border px-3 py-2 text-sm ${g.isDan ? "border-amber-300 bg-amber-50/40" : "bg-muted/30"}`}
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="truncate font-medium">
                            {g.matchLabel}
                            {g.isDan && (
                              <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded bg-amber-400 text-[10px] font-bold text-white">
                                胆
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleDan(g.groupId)}
                              className={`text-xs ${g.isDan ? "text-amber-600" : "text-muted-foreground hover:text-amber-600"}`}
                            >
                              {g.isDan ? "取消胆" : "设胆"}
                            </button>
                            <span className="text-xs text-muted-foreground">{g.betType}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {g.options.map((o) => (
                            <span
                              key={o.optionId}
                              className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
                            >
                              {o.label}
                              <span className="font-bold text-primary">{o.odds.toFixed(2)}</span>
                              <button
                                onClick={() => removeOption(g.groupId, o.optionId)}
                                className="ml-0.5 text-muted-foreground hover:text-destructive"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {danCount > 0 && (
                    <p className="text-xs text-amber-600">
                      已设 {danCount} 场胆，每条组合至少包含一场胆赛事
                    </p>
                  )}

                  {/* ─── Pass Mode Tabs ─── */}
                  {groupCount >= 2 && (
                    <div className="flex gap-1 rounded-lg bg-muted p-1">
                      {(["mxn", "free"] as PassModeT[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setPassMode(mode)}
                          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            passMode === mode
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {mode === "mxn" ? "M串N" : "自由过关"}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ─── MxN Options ─── */}
                  {groupCount >= 2 && passMode === "mxn" && (
                    <div className="flex flex-wrap gap-2">
                      {mxnOpts.map((opt) => (
                        <button
                          key={opt.label}
                          onClick={() => setSelectedMxN(opt.label)}
                          className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                            selectedMxN === opt.label
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-input hover:border-primary/50"
                          }`}
                        >
                          <div className="font-medium">{opt.label}</div>
                          <div className="text-muted-foreground">{opt.totalBets}注</div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ─── Free Pass ─── */}
                  {groupCount >= 2 && passMode === "free" && (
                    <div className="flex flex-wrap gap-2">
                      {freeOpts.map((opt) => {
                        const active = selectedFreePass.includes(opt.passCount)
                        return (
                          <button
                            key={opt.passCount}
                            onClick={() => toggleFreePass(opt.passCount)}
                            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                              active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-input hover:border-primary/50"
                            }`}
                          >
                            <div className="font-medium">过{opt.passCount}关</div>
                            <div className="text-muted-foreground">{opt.bets}注</div>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* ─── Multiplier ─── */}
                  {activeRules && (
                    <div>
                      <div className="flex items-center gap-3">
                        <label className="whitespace-nowrap text-sm text-muted-foreground">倍数</label>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={multInput}
                          onChange={(e) => setMultInput(e.target.value)}
                          onBlur={() => {
                            const n = parseInt(multInput, 10)
                            if (isNaN(n) || n < 1) {
                              setMultiplier(1)
                            } else if (n > 50) {
                              setMultiplier(50)
                            } else {
                              setMultiplier(n)
                            }
                          }}
                          className="w-20"
                        />
                        <span className="text-xs text-muted-foreground">
                          {actualTotalBets}注 × {UNIT_STAKE}元/注 × {effectiveMult}倍 = <strong>{totalStake}元</strong>
                        </span>
                      </div>
                      {multMessage && (
                        <p className={`mt-1 text-xs ${multIsError ? "text-destructive" : "text-amber-500"}`}>
                          {multMessage}
                        </p>
                      )}
                    </div>
                  )}

                  {/* ─── Calculation ─── */}
                  {calcResult && actualTotalBets > 0 && (
                    <div className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
                      {passMode === "mxn" && selectedMxN && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">过关方式</span>
                          <span className="font-medium">{selectedMxN} · {describeRules(activeRules!)}</span>
                        </div>
                      )}
                      {passMode === "free" && selectedFreePass.length > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">过关方式</span>
                          <span className="font-medium">
                            自由过关 · {selectedFreePass.map((p) => `过${p}关`).join("+")} · {describeRules(activeRules!)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">总注数</span>
                        <span className="flex items-center gap-1">
                          {actualTotalBets}注
                          <ComboPopover
                            flatSelections={flatSelections}
                            combos={calcResult.combos}
                            stakePerBet={stakePerBet}
                          />
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">总投注额</span>
                        <span>{totalStake}元（{effectiveMult}倍）</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">单注最高奖金</span>
                        <span className="font-bold text-primary">
                          {calcResult.payouts.length > 0
                            ? `${(Math.max(...calcResult.payouts) * stakePerBet).toFixed(2)}`
                            : "-"} 元
                        </span>
                      </div>
                      <div className="flex justify-between border-t pt-1.5">
                        <span className="font-medium">预计总奖金</span>
                        <span className="text-lg font-extrabold text-destructive">
                          {totalPayout.toFixed(2)} 元
                        </span>
                      </div>
                    </div>
                  )}

                  {/* ─── Actions ─── */}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={clearAll}>
                      清空
                    </Button>
                    <Button size="sm" className="flex-1" disabled={!activeRules || multIsError}>
                      模拟投注
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
