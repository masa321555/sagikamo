// C-4: 評価ハーネス
// data/testcases/testcases.csv（人間が管理。このスクリプトは読むだけで改変しない）を判定APIに通し、期待値と突合する。
// 出力: 全体正答率 ／ 危険側見逃し一覧（最重要） ／ 断定表現の混入チェック（自動grep）
// 注意: テスト文面（input_text）はコンソールに出力しない（マスクする。CLAUDE.mdルール2）。

import fs from "node:fs";
import path from "node:path";
import { createLlmClient } from "../src/lib/llm/client.ts";
import { createJudgeContext, judgeText, techniqueLabel } from "../src/lib/judge/judge.ts";
import { RISK_LEVELS, UNKNOWN_TECHNIQUE, type RiskLevel } from "../src/lib/judge/schema.ts";
import { BANNED_ASSERTION_PATTERNS, renderJudgeDisplay } from "../src/lib/judge/templates.ts";

interface TestCase {
  id: string;
  inputText: string;
  expectedRisk: RiskLevel;
  expectedTechnique: string; // techniques.jsonのID / "unknown"（CSVの"none"はunknownとして扱う）
  notes: string;
}

/** クォート・改行内包に対応したCSVパーサ */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

function loadTestCases(): TestCase[] {
  const p = path.join(process.cwd(), "data", "testcases", "testcases.csv");
  const rows = parseCsv(fs.readFileSync(p, "utf-8"));
  const header = rows[0];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`testcases.csvに列がありません: ${name}`);
    return i;
  };
  const [iId, iText, iRisk, iTech, iNotes] = [col("id"), col("input_text"), col("expected_risk"), col("expected_technique"), col("notes")];
  return rows.slice(1).map((r) => {
    const expectedRisk = r[iRisk]?.trim() as RiskLevel;
    if (!RISK_LEVELS.includes(expectedRisk)) {
      throw new Error(`テストケース ${r[iId]} のexpected_riskが不正: ${r[iRisk]}`);
    }
    const rawTech = r[iTech]?.trim() ?? "";
    return {
      id: r[iId].trim(),
      inputText: r[iText],
      expectedRisk,
      expectedTechnique: rawTech === "none" || rawTech === "" ? UNKNOWN_TECHNIQUE : rawTech,
      notes: r[iNotes] ?? "",
    };
  });
}

interface CaseResult {
  id: string;
  expectedRisk: RiskLevel;
  actualRisk: RiskLevel;
  expectedTechnique: string;
  actualTechnique: string;
  bannedPhraseHits: string[];
}

const riskRank: Record<RiskLevel, number> = { low: 0, caution: 1, high: 2 };

async function main(): Promise<void> {
  const cases = loadTestCases();
  console.log(`テストケース: ${cases.length}件（testcases.csvは読み取りのみ）`);
  if (cases.some((c) => c.inputText.includes("見本"))) {
    console.log("⚠️  testcases.csvに【見本】行が含まれています。Phase 0の実ケース差し替えが未完了の可能性があります（スモークテストとして続行）。\n");
  }

  const client = createLlmClient();
  const techniquesJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "config", "techniques.json"), "utf-8"),
  ) as unknown;
  const ctx = createJudgeContext(client, techniquesJson);
  console.log(`LLM: provider=${client.providerName} / プロンプト=judge v1\n`);

  const results: CaseResult[] = [];
  for (const tc of cases) {
    const judged = await judgeText(ctx, tc.inputText);
    const display = renderJudgeDisplay({
      risk: judged.risk,
      techniqueLabel: techniqueLabel(ctx.techniques, judged.technique),
      evidence: judged.evidence,
      actions: judged.actions,
    });
    const bannedPhraseHits = BANNED_ASSERTION_PATTERNS.filter((re) => re.test(display)).map((re) => String(re));
    results.push({
      id: tc.id,
      expectedRisk: tc.expectedRisk,
      actualRisk: judged.risk,
      expectedTechnique: tc.expectedTechnique,
      actualTechnique: judged.technique,
      bannedPhraseHits,
    });
    const riskOk = judged.risk === tc.expectedRisk;
    const techOk = judged.technique === tc.expectedTechnique;
    console.log(
      `${tc.id}: risk ${tc.expectedRisk}→${judged.risk} ${riskOk ? "✓" : "✗"} / technique ${tc.expectedTechnique}→${judged.technique} ${techOk ? "✓" : "✗"}`,
    );
  }

  // ---- 集計 ----
  const riskCorrect = results.filter((r) => r.actualRisk === r.expectedRisk).length;
  const techCorrect = results.filter((r) => r.actualTechnique === r.expectedTechnique).length;
  const bothCorrect = results.filter((r) => r.actualRisk === r.expectedRisk && r.actualTechnique === r.expectedTechnique).length;

  console.log("\n===== 評価結果 =====");
  console.log(`risk正答率:      ${riskCorrect}/${results.length} (${pct(riskCorrect, results.length)})`);
  console.log(`technique正答率: ${techCorrect}/${results.length} (${pct(techCorrect, results.length)})`);
  console.log(`両方正答:        ${bothCorrect}/${results.length} (${pct(bothCorrect, results.length)})`);

  // 危険側見逃し（最重要）: 明白な詐欺文面（expected=high）を low と判定したケース
  const criticalMisses = results.filter((r) => r.expectedRisk === "high" && r.actualRisk === "low");
  // 危険側劣化: 期待より低いriskに判定したケース全般
  const downgrades = results.filter((r) => riskRank[r.actualRisk] < riskRank[r.expectedRisk]);

  console.log(`\n危険側見逃し（expected high → 判定 low）【最重要】: ${criticalMisses.length}件`);
  for (const m of criticalMisses) console.log(`  ✗ ${m.id} (期待technique: ${m.expectedTechnique})`);
  console.log(`危険側への劣化（期待より低いrisk）: ${downgrades.length}件`);
  for (const m of downgrades) console.log(`  - ${m.id}: 期待${m.expectedRisk} → 判定${m.actualRisk}`);

  const bannedTotal = results.filter((r) => r.bannedPhraseHits.length > 0);
  console.log(`\n断定表現の混入（表示テキスト全体を自動grep）: ${bannedTotal.length}件`);
  for (const b of bannedTotal) console.log(`  ✗ ${b.id}: パターン ${b.bannedPhraseHits.join(", ")}`);

  const pass = criticalMisses.length === 0 && bannedTotal.length === 0;
  console.log(`\n完了条件（危険側見逃しゼロ かつ 断定表現ゼロ）: ${pass ? "PASS" : "FAIL"}`);
  if (!pass) process.exit(1);
}

function pct(n: number, total: number): string {
  return total === 0 ? "-" : `${((n / total) * 100).toFixed(1)}%`;
}

main().catch((e) => {
  console.error("\n=== eval実行失敗（ダミー結果で代替せず停止します） ===");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
