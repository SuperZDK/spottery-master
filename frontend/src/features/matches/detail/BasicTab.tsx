import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import type { H2HItem, FormItem, MatchDetail } from "@/types/match"
import { h2hResultColor } from "./shared"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-dashed border-muted/30 last:border-b-0">
      <div className="px-2 py-1.5 text-sm font-bold text-muted-foreground/80 bg-muted/10 border-b">{title}</div>
      <div className="px-2 py-1">{children}</div>
    </div>
  )
}

function H2hTable({ items }: { items: H2HItem[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground/60 py-3 text-center">暂无交锋数据</p>
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b text-muted-foreground hover:bg-transparent">
          <TableHead className="p-1 text-left font-normal whitespace-nowrap">时间</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">主队</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">比分</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">客队</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r, i) => (
          <TableRow key={i} className="border-b border-dashed border-muted/30 hover:bg-muted/5">
            <TableCell className="p-1 text-muted-foreground whitespace-nowrap">
              {r.match_time ? String(r.match_time).slice(0, 10) : "-"}
            </TableCell>
            <TableCell className="p-1 text-right whitespace-nowrap">{r.home_team ?? "-"}</TableCell>
            <TableCell className={`p-1 text-center whitespace-nowrap ${h2hResultColor(r.home_score, r.away_score)}`}>
              {r.home_score != null && r.away_score != null ? `${r.home_score}:${r.away_score}` : "VS"}
            </TableCell>
            <TableCell className="p-1 text-left whitespace-nowrap">{r.away_team ?? "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function FormList({ items, label }: { items: FormItem[]; label: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground/60 py-2 text-center">暂无数据</p>
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <Table>
        <TableHeader>
          <TableRow className="border-b text-muted-foreground/70 hover:bg-transparent">
            <TableHead className="p-1 text-left font-normal whitespace-nowrap">时间</TableHead>
            <TableHead className="p-1 text-left font-normal whitespace-nowrap">对阵</TableHead>
            <TableHead className="p-1 text-center font-normal whitespace-nowrap">比分</TableHead>
            <TableHead className="p-1 text-center font-normal whitespace-nowrap">主/客</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((r, i) => (
            <TableRow key={i} className="border-b border-dashed border-muted/20 hover:bg-muted/5">
              <TableCell className="p-1 text-muted-foreground whitespace-nowrap">
                {r.match_time ? String(r.match_time).slice(0, 10) : "-"}
              </TableCell>
              <TableCell className="p-1 whitespace-nowrap">{r.opponent ?? "-"}</TableCell>
              <TableCell className={`p-1 text-center whitespace-nowrap ${h2hResultColor(r.home_score, r.away_score)}`}>
                {r.home_score != null && r.away_score != null ? `${r.home_score}:${r.away_score}` : "-"}
              </TableCell>
              <TableCell className="p-1 text-center whitespace-nowrap text-muted-foreground">
                {r.is_home ? "主" : "客"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function StandingsBlock({ block }: { block: NonNullable<MatchDetail["standings"]> }) {
  const rows = [
    { label: "主队", s: block.home },
    { label: "客队", s: block.away },
  ]
  if (!block.home && !block.away) return <p className="text-sm text-muted-foreground/60 py-3 text-center">暂无积分榜数据</p>
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b text-muted-foreground/70 hover:bg-transparent">
          <TableHead className="p-1 text-left font-normal whitespace-nowrap">球队</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">排名</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">赛</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">胜</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">平</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">负</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">进/失</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">净胜</TableHead>
          <TableHead className="p-1 text-center font-normal whitespace-nowrap">积分</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ label, s }) => (
          <TableRow key={label} className="border-b border-dashed border-muted/20 hover:bg-muted/5">
            <TableCell className="p-1 font-medium whitespace-nowrap">{s?.team_name ?? label}</TableCell>
            <TableCell className="p-1 text-center whitespace-nowrap">{s?.position ?? "-"}</TableCell>
            <TableCell className="p-1 text-center whitespace-nowrap">{s?.played ?? "-"}</TableCell>
            <TableCell className="p-1 text-center whitespace-nowrap">{s?.wins ?? "-"}</TableCell>
            <TableCell className="p-1 text-center whitespace-nowrap">{s?.draws ?? "-"}</TableCell>
            <TableCell className="p-1 text-center whitespace-nowrap">{s?.losses ?? "-"}</TableCell>
            <TableCell className="p-1 text-center whitespace-nowrap">
              {s?.goals_for != null && s?.goals_against != null ? `${s.goals_for}/${s.goals_against}` : "-"}
            </TableCell>
            <TableCell className="p-1 text-center whitespace-nowrap">{s?.goal_diff ?? "-"}</TableCell>
            <TableCell className="p-1 text-center whitespace-nowrap font-bold">{s?.points ?? "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function BasicTab({ detail }: { detail: MatchDetail }) {
  const hasData = detail.h2h?.length || detail.form?.home?.length || detail.form?.away?.length || detail.standings
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground/60">
        <p className="text-sm">暂无数据</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border overflow-hidden">
      <Section title="历史交锋">
        <H2hTable items={detail.h2h ?? []} />
      </Section>
      <Section title="近期战绩">
        <div className="grid gap-2 lg:grid-cols-2">
          <FormList items={detail.form?.home ?? []} label="主队" />
          <FormList items={detail.form?.away ?? []} label="客队" />
        </div>
      </Section>
      {detail.standings && (
        <Section title="积分榜">
          <StandingsBlock block={detail.standings} />
        </Section>
      )}
    </div>
  )
}