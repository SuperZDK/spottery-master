import { useState } from "react"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import type { MatchOdds } from "@/types/match"
import type { OddsItem, OddsHistoryPoint } from "@/types/odds"
import { fmtOdds } from "./shared"

const BF_HOME = ["1:0","2:0","2:1","3:0","3:1","3:2","4:0","4:1","4:2","5:0","5:1","5:2","胜其他"]
const BF_DRAW = ["0:0","1:1","2:2","3:3","平其他"]
const BF_AWAY = ["0:1","0:2","1:2","0:3","1:3","2:3","0:4","1:4","2:4","0:5","1:5","2:5","负其他"]
const ZJQ_LABELS = ["0球","1球","2球","3球","4球","5球","6球","7+球"]
const BQC_LABELS = ["胜-胜","胜-平","胜-负","平-胜","平-平","平-负","负-胜","负-平","负-负"]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-dashed border-muted/30 last:border-b-0">
      <div className="px-2 py-1.5 text-sm font-bold text-muted-foreground/80 bg-muted/10 border-b">{title}</div>
      <div className="px-2 py-1">{children}</div>
    </div>
  )
}

function OddsArrow({ cur, prev }: { cur: number | null | undefined; prev: number | null | undefined }) {
  if (prev == null || cur == null || cur === prev) return null
  if (cur > prev) return <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-sm bg-red-200 text-red-800 font-bold text-[10px] leading-none">▲</span>
  return <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-sm bg-green-200 text-green-800 font-bold text-[10px] leading-none">▼</span>
}

function OddsHistoryTable({ data, showDraw = true, showSeconds = false }: { data: OddsHistoryPoint[]; showDraw?: boolean; showSeconds?: boolean }) {
  const rows = [...data].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  const hasHandicap = rows.some((r) => r.handicap != null)
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground/60 py-3 text-center">暂无历史赔率数据</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b text-muted-foreground hover:bg-transparent">
          <TableHead className="p-1 text-left font-normal whitespace-nowrap">时间</TableHead>
          {hasHandicap && <TableHead className="p-1 text-center font-normal whitespace-nowrap">让球</TableHead>}
          <TableHead className="p-1 text-right font-normal whitespace-nowrap">主胜</TableHead>
          {showDraw && <TableHead className="p-1 text-right font-normal whitespace-nowrap">平局</TableHead>}
          <TableHead className="p-1 text-right font-normal whitespace-nowrap">客胜</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const prev = rows[i + 1]
          const isInitial = i === rows.length - 1
          return (
            <TableRow key={i} className="border-b border-dashed border-muted/30 hover:bg-muted/5">
              <TableCell className="p-1 text-muted-foreground whitespace-nowrap">
                {r.time.slice(5, showSeconds ? 19 : 16).replace("T", " ")}
                {isInitial && <span className="ml-1.5 text-[10px] text-muted-foreground/50 border border-muted/20 rounded px-1">初赔</span>}
              </TableCell>
              {hasHandicap && <TableCell className="p-1 text-center font-medium text-blue-600 whitespace-nowrap">{r.handicap ?? "-"}</TableCell>}
              <TableCell className="p-1 text-right tabular-nums whitespace-nowrap">
                {r.home != null ? r.home.toFixed(2) : "-"}
                <OddsArrow cur={r.home} prev={prev?.home} />
              </TableCell>
              {showDraw && <TableCell className="p-1 text-right tabular-nums whitespace-nowrap">
                {r.draw != null ? r.draw.toFixed(2) : "-"}
                <OddsArrow cur={r.draw} prev={prev?.draw} />
              </TableCell>}
              <TableCell className="p-1 text-right tabular-nums whitespace-nowrap">
                {r.away != null ? r.away.toFixed(2) : "-"}
                <OddsArrow cur={r.away} prev={prev?.away} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function BfGrid({ data }: { data: OddsHistoryPoint[] }) {
  const items = [...data].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  const fmt = (v: number | null | undefined) => v != null ? v.toFixed(2) : "-"
  const getVal = (r: OddsHistoryPoint | undefined, label: string) => r?.options?.[label] ?? null
  if (!items.length) return <p className="text-sm text-muted-foreground/60 py-2 text-center">暂无数据</p>
  const timeStr = (r: OddsHistoryPoint) => {
    const t = r.time.slice(5, 16).replace("T", " ")
    return <>{t.slice(0, 5)}<br />{t.slice(6)}</>
  }
  return (
    <Table className="border-collapse table-fixed">
      <TableBody>
        {items.flatMap((r, i) => {
          const prev = items[i + 1]
          const isInitial = i === items.length - 1
          const homeCells = BF_HOME.map(l => (
            <TableCell key={l} className="p-1.5 text-right tabular-nums font-medium text-green-800 bg-green-50/40">
              {fmt(getVal(r, l))}<OddsArrow cur={getVal(r, l)} prev={getVal(prev, l)} />
            </TableCell>
          ))
          const drawCells = BF_DRAW.map(l => (
            <TableCell key={l} className="p-1.5 text-right tabular-nums font-medium text-yellow-800 bg-yellow-50/40">
              {fmt(getVal(r, l))}<OddsArrow cur={getVal(r, l)} prev={getVal(prev, l)} />
            </TableCell>
          ))
          const awayCells = BF_AWAY.map(l => (
            <TableCell key={l} className="p-1.5 text-right tabular-nums font-medium text-red-800 bg-red-50/40">
              {fmt(getVal(r, l))}<OddsArrow cur={getVal(r, l)} prev={getVal(prev, l)} />
            </TableCell>
          ))
          return [
            <TableRow key={`${i}-hdr`} className="bg-muted/20 border-b hover:bg-transparent">
              <TableHead className="p-1.5 text-left font-semibold whitespace-nowrap w-20">
                发布时间
                {isInitial && <span className="ml-1.5 text-[10px] text-muted-foreground/50 border border-muted/20 rounded px-1">初赔</span>}
              </TableHead>
              {BF_HOME.map(l => <TableHead key={l} className="p-1.5 text-right font-semibold whitespace-nowrap">{l}</TableHead>)}
            </TableRow>,
            <TableRow key={`${i}-h`} className="border-b border-muted/20 hover:bg-transparent">
              <TableHead rowSpan={5} className="p-1.5 font-semibold text-muted-foreground whitespace-nowrap align-top bg-muted/5">{timeStr(r)}</TableHead>
              {homeCells}
            </TableRow>,
            <TableRow key={`${i}-dl`} className="hover:bg-transparent">
              {BF_DRAW.map(l => <TableHead key={l} className="p-1.5 text-right font-bold text-yellow-800 whitespace-nowrap bg-yellow-50 border-b border-yellow-100">{l}</TableHead>)}
              <TableCell colSpan={8} rowSpan={2} className="bg-yellow-50 border-b border-yellow-100" />
            </TableRow>,
            <TableRow key={`${i}-dd`} className="border-b border-muted/20 hover:bg-transparent">
              {drawCells}
            </TableRow>,
            <TableRow key={`${i}-al`} className="hover:bg-transparent">
              {BF_AWAY.map(l => <TableHead key={l} className="p-1.5 text-right font-bold text-red-800 whitespace-nowrap bg-red-50 border-b border-red-100">{l}</TableHead>)}
            </TableRow>,
            <TableRow key={`${i}-ad`} className="border-b-2 border-muted/30 hover:bg-transparent">
              {awayCells}
            </TableRow>,
          ]
        })}
      </TableBody>
    </Table>
  )
}

function ZjqTable({ data }: { data: OddsHistoryPoint[] }) {
  const rows = [...data].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  const fmt = (v: number | null | undefined) => v != null ? v.toFixed(2) : "-"
  const getVal = (r: OddsHistoryPoint | undefined, label: string) => r?.options?.[label] ?? null
  if (!rows.length) return <p className="text-sm text-muted-foreground/60 py-2 text-center">暂无数据</p>
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b text-muted-foreground/70 hover:bg-transparent">
          <TableHead className="p-1 text-left font-normal whitespace-nowrap">时间</TableHead>
          {ZJQ_LABELS.map((l) => <TableHead key={l} className="p-1 text-right font-normal whitespace-nowrap">{l}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const prev = rows[i + 1]
          const isInitial = i === rows.length - 1
          return (
            <TableRow key={i} className="border-b border-dashed border-muted/20 hover:bg-muted/5">
              <TableCell className="p-1 text-muted-foreground whitespace-nowrap">
                {r.time.slice(5, 16).replace("T", " ")}
                {isInitial && <span className="ml-1.5 text-[10px] text-muted-foreground/50 border border-muted/20 rounded px-1">初赔</span>}
              </TableCell>
              {ZJQ_LABELS.map((l) => <TableCell key={l} className="p-1 text-right tabular-nums">{fmt(getVal(r, l))}<OddsArrow cur={getVal(r, l)} prev={getVal(prev, l)} /></TableCell>)}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function BqcTable({ data }: { data: OddsHistoryPoint[] }) {
  const rows = [...data].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  const fmt = (v: number | null | undefined) => v != null ? v.toFixed(2) : "-"
  const getVal = (r: OddsHistoryPoint | undefined, label: string) => r?.options?.[label] ?? null
  if (!rows.length) return <p className="text-sm text-muted-foreground/60 py-2 text-center">暂无数据</p>
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b text-muted-foreground/70 hover:bg-transparent">
          <TableHead className="p-1 text-left font-normal whitespace-nowrap">时间</TableHead>
          {BQC_LABELS.map((l) => <TableHead key={l} className="p-1 text-right font-normal whitespace-nowrap">{l}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const prev = rows[i + 1]
          const isInitial = i === rows.length - 1
          return (
            <TableRow key={i} className="border-b border-dashed border-muted/20 hover:bg-muted/5">
              <TableCell className="p-1 text-muted-foreground whitespace-nowrap">
                {r.time.slice(5, 16).replace("T", " ")}
                {isInitial && <span className="ml-1.5 text-[10px] text-muted-foreground/50 border border-muted/20 rounded px-1">初赔</span>}
              </TableCell>
              {BQC_LABELS.map((l) => <TableCell key={l} className="p-1 text-right tabular-nums">{fmt(getVal(r, l))}<OddsArrow cur={getVal(r, l)} prev={getVal(prev, l)} /></TableCell>)}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export default function OddsTab({ odds }: { odds: MatchOdds }) {
  const [oddsSubTab, setOddsSubTab] = useState<"jingcai" | "yapan" | "oupei">("jingcai")

  const jingcaiHistory = odds.history["SPF"] ?? []
  const jingcaiRQSPF = odds.history["RQSPF"] ?? []
  const jingcaiBF = odds.history["BF"] ?? []
  const jingcaiZJQ = odds.history["ZJQ"] ?? []
  const jingcaiBQC = odds.history["BQC"] ?? []
  const yapanHistory = odds.history["yapan"] ?? []
  const oupelHistory = odds.history["oupei"] ?? []

  return (
    <div className="space-y-2">
      {/* Instant odds comparison */}
      {odds.current.length > 0 ? (
        <div className="rounded-lg border overflow-hidden">
          <div className="px-2 py-1.5 text-sm font-bold text-muted-foreground/80 bg-muted/10 border-b">即时赔率对比</div>
          <div className="px-2 py-1">
            <Table>
              <TableHeader>
                <TableRow className="border-b text-muted-foreground/70 hover:bg-transparent">
                  <TableHead className="p-1.5 text-left font-normal whitespace-nowrap">公司</TableHead>
                  <TableHead className="p-1.5 text-right font-normal whitespace-nowrap">主胜</TableHead>
                  <TableHead className="p-1.5 text-right font-normal whitespace-nowrap">平局</TableHead>
                  <TableHead className="p-1.5 text-right font-normal whitespace-nowrap">客胜</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {odds.current.map((o: OddsItem) => (
                  <TableRow key={o.id} className="border-b border-dashed border-muted/20 hover:bg-muted/5">
                    <TableCell className="p-1.5 font-medium whitespace-nowrap">{o.bookmaker}</TableCell>
                    <TableCell className="p-1.5 text-right tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-primary">{fmtOdds(o.current_home)}</span>
                      {o.initial_home != null && o.current_home != null && o.initial_home !== o.current_home && (
                        <span className="ml-1 text-[10px] text-muted-foreground">({fmtOdds(o.initial_home)})</span>
                      )}
                    </TableCell>
                    <TableCell className="p-1.5 text-right tabular-nums whitespace-nowrap">
                      <span className="font-semibold">{fmtOdds(o.current_draw)}</span>
                      {o.initial_draw != null && o.current_draw != null && o.initial_draw !== o.current_draw && (
                        <span className="ml-1 text-[10px] text-muted-foreground">({fmtOdds(o.initial_draw)})</span>
                      )}
                    </TableCell>
                    <TableCell className="p-1.5 text-right tabular-nums whitespace-nowrap">
                      <span className="font-semibold">{fmtOdds(o.current_away)}</span>
                      {o.initial_away != null && o.current_away != null && o.initial_away !== o.current_away && (
                        <span className="ml-1 text-[10px] text-muted-foreground">({fmtOdds(o.initial_away)})</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/60">暂无赔率数据</p>
      )}

      {/* Sub-tab navigation */}
      <div className="flex border-b">
        {[
          { key: "jingcai" as const, label: "竞彩赔率" },
          { key: "yapan" as const, label: "亚盘" },
          { key: "oupei" as const, label: "欧赔" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setOddsSubTab(key)}
            className={`shrink-0 px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              oddsSubTab === key
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 竞彩赔率 */}
      {oddsSubTab === "jingcai" && (
        <div className="rounded-lg border overflow-hidden">
          <Section title="胜平负赔率变化">
            <OddsHistoryTable data={jingcaiHistory} showSeconds />
          </Section>
          <Section title="让球胜平负赔率变化">
            <OddsHistoryTable data={jingcaiRQSPF} showSeconds />
          </Section>
          <Section title="比分固定奖金">
            <BfGrid data={jingcaiBF} />
          </Section>
          <Section title="总进球固定奖金">
            <ZjqTable data={jingcaiZJQ} />
          </Section>
          <Section title="半全场胜平负固定奖金">
            <BqcTable data={jingcaiBQC} />
          </Section>
        </div>
      )}

      {/* 亚盘 */}
      {oddsSubTab === "yapan" && (
        <div className="rounded-lg border overflow-hidden">
          <div className="px-2 py-1.5 border-b bg-muted/10">
            <span className="text-sm font-bold text-muted-foreground/80">亚盘赔率变化（澳门）</span>
          </div>
          <div className="px-2 py-1">
            <OddsHistoryTable data={yapanHistory} showDraw={false} />
          </div>
        </div>
      )}

      {/* 欧赔 */}
      {oddsSubTab === "oupei" && (
        <div className="rounded-lg border overflow-hidden">
          <div className="px-2 py-1.5 border-b bg-muted/10">
            <span className="text-sm font-bold text-muted-foreground/80">欧赔赔率变化（威廉希尔）</span>
          </div>
          <div className="px-2 py-1">
            <OddsHistoryTable data={oupelHistory} />
          </div>
        </div>
      )}
    </div>
  )
}
