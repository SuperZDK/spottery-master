import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

// ============================================================
// 统一自动映射入口：供其他定时任务/外部调度一键触发全部三源映射。
// 按依赖顺序串联 3 个独立脚本（子进程方式，隔离错误互不阻断）：
//   1) build-team-map.ts  球队映射（增量：新增 titan 队自动搜 sofa，无命中进人工清单）
//   2) build-match-map.ts 比赛映射（联赛表 + cross_source_matches 全量重扫，幂等）
//   3) fill-jc-name.ts    竞彩名回填（增量游标 cursor.json）
// 运行：npx tsx mapping/scripts/run-mapping.ts [--skip-team|--skip-match|--skip-jc] [--date YYYY-MM-DD]
// 参数透传：
//   --retry-no-hit / --revalidate / --backfill-only  透传给 build-team-map.ts
//   --leagues-only                                    透传给 build-match-map.ts
//   --date YYYY-MM-DD                                透传给 build-match-map.ts（按日增量重建比赛映射）
// 退出码：任一步失败 → 1（供调度感知）；全部成功 → 0。
// ============================================================

const MONOREPO = join(import.meta.dirname, "../..");
loadEnv({ path: join(MONOREPO, ".env") });

const SCRIPTS_DIR = join(MONOREPO, "mapping", "scripts");
const TITAN_BIN = process.platform === "win32" ? "npx.cmd" : "npx";
const argv = process.argv.slice(2);

const SKIP_TEAM = argv.includes("--skip-team");
const SKIP_MATCH = argv.includes("--skip-match");
const SKIP_JC = argv.includes("--skip-jc");

const TEAM_PASSTHROUGH = ["--retry-no-hit", "--revalidate", "--backfill-only"].filter((a) => argv.includes(a));
const DATE_ARG = argv.find((a) => a.startsWith("--date="));
const MATCH_PASSTHROUGH = [
  ...(argv.includes("--leagues-only") ? ["--leagues-only"] : []),
  ...(DATE_ARG ? [DATE_ARG] : []),
];

function runStep(name: string, script: string, pass: string[]): boolean {
  console.log(`\n[run-mapping] === 步骤 ${name}：${script} ${pass.join(" ")} ===`);
  try {
    execFileSync(TITAN_BIN, ["tsx", join(SCRIPTS_DIR, script), ...pass], {
      cwd: SCRIPTS_DIR,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    console.log(`[run-mapping] 步骤 ${name} 完成`);
    return true;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    console.error(`[run-mapping] 步骤 ${name} 失败（exit=${err.status ?? "?"}）`, err.message ?? "");
    return false;
  }
}

async function main() {
  const started = Date.now();
  const results: { step: string; ok: boolean }[] = [];

  if (!SKIP_TEAM) results.push({ step: "球队映射 build-team-map", ok: runStep("球队映射", "build-team-map.ts", TEAM_PASSTHROUGH) });
  else console.log("[run-mapping] 跳过球队映射（--skip-team）");

  if (!SKIP_MATCH) results.push({ step: "比赛映射 build-match-map", ok: runStep("比赛映射", "build-match-map.ts", MATCH_PASSTHROUGH) });
  else console.log("[run-mapping] 跳过比赛映射（--skip-match）");

  if (!SKIP_JC) results.push({ step: "竞彩名回填 fill-jc-name", ok: runStep("竞彩名回填", "fill-jc-name.ts", []) });
  else console.log("[run-mapping] 跳过竞彩名回填（--skip-jc）");

  const failed = results.filter((r) => !r.ok);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n[run-mapping] 汇总：${results.length - failed.length}/${results.length} 成功，耗时 ${elapsed}s`);
  for (const r of results) console.log(`  ${r.ok ? "OK  " : "FAIL"}  ${r.step}`);

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[run-mapping] 未捕获异常", e);
  process.exitCode = 1;
});
