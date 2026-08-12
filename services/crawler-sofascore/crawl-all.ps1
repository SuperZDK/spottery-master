$ProgressFile = Join-Path $PSScriptRoot "data\crawl_progress.json"
$LogFile = Join-Path $PSScriptRoot "data\crawl_log.txt"

# 联赛按优先级排序
$LeagueOrder = @(
  # Phase 1: 五大联赛
  "premier-league",
  "laliga",
  "bundesliga",
  "serie-a",
  "ligue-1",
  # Phase 2: 欧冠 + 其他一级联赛
  "uefa-champions-league",
  "eredivisie",
  "liga-portugal",
  "mls",
  "j1-league",
  "allsvenskan",
  "eliteserien",
  "veikkausliiga",
  # Phase 3: 欧联 + 二级联赛
  "uefa-europa-league",
  "championship",
  "2-bundesliga",
  "ligue-2",
  "league-one",
  # Phase 4: 其他联赛
  "eerste-divisie",
  "j2-league",
  "a-league-men",
  "uefa-conference-league",
  # Phase 5: 杯赛
  "fa-cup",
  "efl-cup",
  "dfb-pokal",
  "coppa-italia",
  "coupe-de-france",
  "copa-del-rey",
  "supercopa-de-espana",
  "community-shield",
  "j-league-cup"
)

function Log {
  param($Msg)
  $Time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$Time $Msg" | Out-File -FilePath $LogFile -Append
  Write-Host "$Time $Msg"
}

# 读取进度
$Completed = @{}
if (Test-Path $ProgressFile) {
  $Completed = Get-Content $ProgressFile | ConvertFrom-Json
}

Log "=== 开始爬取 ==="
$Total = $LeagueOrder.Count

for ($i = 0; $i -lt $LeagueOrder.Count; $i++) {
  $slug = $LeagueOrder[$i]
  $num = $i + 1

  if ($Completed.$slug) {
    Log "[$num/$Total] $slug - 已完成, 跳过"
    continue
  }

  Log "[$num/$Total] $slug - 开始爬取..."
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  npx tsx "src/scrapers/sofascore/fetch-details.ts" $slug

  $sw.Stop()
  $Elapsed = [math]::Round($sw.Elapsed.TotalMinutes, 1)

  # 标记完成
  $Completed.$slug = @{
    completedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    durationMin = $Elapsed
  }
  $Completed | ConvertTo-Json | Set-Content $ProgressFile

  Log "[$num/$Total] $slug - 完成, 耗时 ${Elapsed}min"
}

Log "=== 全部完成 ==="
