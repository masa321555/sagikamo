// B-3: stats.json の独立検算。build_stats.ts とは別ロジックで再計算し突合する。
// - 検算1: D1サマリー行の値を「町丁行の積上げ」（小計行・サマリーセクション除外）で再計算して突合
// - 検算2: 合計 = ２３区計 + 多摩地区・島部計 + 他県 + 海外認知 + 不明 の整合
// - 検算3: 62区市町村の網羅・重複なし
// - 検算4: リスク指数の再計算突合と0除算・欠損の扱い
// - 検算5: contacts.json の自治体名がD3の62自治体と整合
// すべてPASS/FAIL形式で出力し、FAILが1件でもあれば終了コード1。

import fs from "node:fs";
import path from "node:path";
import {
  RAW_DIR, CACHE_DIR, SOURCES,
  parseD1Csv, parseD1Api, buildMuniMaster,
  D1_SPECIAL_ROWS, D1_WARDS_TOTAL_ROWS,
  readJson,
  type ApiResponse, type D1Row,
} from "./lib/opendata.ts";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`PASS: ${label}`); }
  else { fail++; console.log(`FAIL: ${label}${detail ? " — " + detail : ""}`); }
}

interface StatsJson {
  tokyoTotal: { sagiCurrent: number; sagiPrevYear: number };
  municipalities: {
    code: number; name: string; d1Name: string; pop65: number; popTotal: number;
    sagiCurrent: number; sagiPrevYear: number;
    riskIndex: number | null; riskIndexPrevYear: number | null;
    riskIndexAll: number | null; riskIndexAllPrevYear: number | null;
  }[];
}

/** サマリーセクション（末尾の連続した自治体名・特殊行ブロック）の開始indexを求める */
function summaryStart(rows: D1Row[], muniNames: Set<string>): number {
  let i = rows.length;
  while (i > 0) {
    const a = rows[i - 1].area;
    if (muniNames.has(a) || D1_SPECIAL_ROWS.includes(a)) i--;
    else break;
  }
  return i;
}

/** 独立検算: 町丁行の積上げで自治体別の件数を再計算する（buildとは別ロジック） */
function recalcByChocho(rows: D1Row[], d1Names: string[]): Map<string, number> {
  const nameSet = new Set(d1Names);
  const start = summaryStart(rows, nameSet);
  const body = rows.slice(0, start);
  // 長い名前を先にマッチさせる（例: 西多摩郡日の出町 と 西多摩郡檜原村 は互いに独立だが安全側で）
  const sorted = [...d1Names].sort((a, b) => b.length - a.length);
  const sums = new Map<string, number>(d1Names.map((n) => [n, 0]));
  for (const r of body) {
    const muni = sorted.find((n) => r.area.startsWith(n));
    if (!muni) continue; // 町丁セクションに属さない行はない想定（特殊行はサマリー側のみ）
    if (r.area === `${muni}計`) continue; // 自治体小計行は除外（二重計上防止）
    sums.set(muni, sums.get(muni)! + r.sagi);
  }
  return sums;
}

function verifyD1(label: string, rows: D1Row[], d1Names: string[], statsValues: Map<string, number>): void {
  const nameSet = new Set(d1Names);
  const start = summaryStart(rows, nameSet);
  const summarySection = rows.slice(start);

  // サマリーセクションの構造: 62自治体 + 特殊行6種
  check(`${label}: サマリーセクションが68行`, summarySection.length === 68, `実際=${summarySection.length}`);

  const summaryMap = new Map(summarySection.map((r) => [r.area, r.sagi]));

  // 検算1: 町丁積上げ vs サマリー行
  const recalc = recalcByChocho(rows, d1Names);
  const mismatches: string[] = [];
  for (const n of d1Names) {
    if (recalc.get(n) !== summaryMap.get(n)) {
      mismatches.push(`${n}: 積上げ=${recalc.get(n)} サマリー=${summaryMap.get(n)}`);
    }
  }
  check(`${label}: 町丁積上げとサマリー行が62自治体すべて一致`, mismatches.length === 0, mismatches.slice(0, 5).join(" / "));

  // 検算1b: stats.jsonに載った値がサマリー行と一致
  const statMismatch: string[] = [];
  for (const n of d1Names) {
    if (statsValues.get(n) !== summaryMap.get(n)) {
      statMismatch.push(`${n}: stats=${statsValues.get(n)} サマリー=${summaryMap.get(n)}`);
    }
  }
  check(`${label}: stats.jsonの値がD1サマリー行と一致`, statMismatch.length === 0, statMismatch.slice(0, 5).join(" / "));

  // 検算2: 合計行の内訳整合
  const v = (...names: string[]) => {
    for (const name of names) {
      const x = summaryMap.get(name);
      if (x !== undefined) return x;
    }
    throw new Error(`${label}: サマリーセクションに「${names.join("/")}」行がない`);
  };
  const wards = d1Names.slice(0, 23).reduce((s, n) => s + v(n), 0); // 先頭23件=23区（D3の地域コード順）
  const rest = d1Names.slice(23).reduce((s, n) => s + v(n), 0);
  check(`${label}: 23区の積上げ = ２３区計`, wards === v(...D1_WARDS_TOTAL_ROWS), `積上げ=${wards} 公表=${v(...D1_WARDS_TOTAL_ROWS)}`);
  check(`${label}: 市町村部の積上げ = 多摩地区・島部計`, rest === v("多摩地区・島部計"), `積上げ=${rest} 公表=${v("多摩地区・島部計")}`);
  const totalCalc = v(...D1_WARDS_TOTAL_ROWS) + v("多摩地区・島部計") + v("他県") + v("海外認知") + v("不明");
  check(`${label}: 合計 = ２３区計+多摩地区・島部計+他県+海外認知+不明`, totalCalc === v("合計"), `内訳計=${totalCalc} 合計行=${v("合計")}`);
}

function main(): void {
  const stats = readJson<StatsJson>(path.join(CACHE_DIR, "stats.json"));
  const d3 = readJson<ApiResponse>(path.join(RAW_DIR, SOURCES.d3Age3.file));
  const munis = buildMuniMaster(d3.hits);
  const d1Names = munis.map((m) => m.d1Name);

  // 検算3: 62自治体の網羅・重複なし・地域コード妥当
  check("stats.json: 自治体が62件", stats.municipalities.length === 62, `実際=${stats.municipalities.length}`);
  const codes = new Set(stats.municipalities.map((m) => m.code));
  check("stats.json: 地域コードに重複なし", codes.size === 62);
  check("stats.json: 地域コードが13101〜13421の範囲", stats.municipalities.every((m) => m.code >= 13101 && m.code <= 13421));
  const d3Names = new Set(munis.map((m) => m.name));
  check("stats.json: 自治体名がD3と完全一致", stats.municipalities.every((m) => d3Names.has(m.name)));

  // 検算1,2: D1当年・前年
  const d1Cur = parseD1Csv(fs.readFileSync(path.join(RAW_DIR, SOURCES.d1CurrentCsv.file))).rows;
  const d1Prev = parseD1Api(readJson<ApiResponse>(path.join(RAW_DIR, SOURCES.d1PrevApi.file)).hits);
  verifyD1("D1当年(R8)", d1Cur, d1Names, new Map(stats.municipalities.map((m) => [m.d1Name, m.sagiCurrent])));
  verifyD1("D1前年(R7)", d1Prev, d1Names, new Map(stats.municipalities.map((m) => [m.d1Name, m.sagiPrevYear])));

  // 都合計がD1の合計行と一致（stats側の値）
  const curTotal = d1Cur.filter((r) => r.area === "合計").at(-1)!.sagi;
  const prevTotal = d1Prev.filter((r) => r.area === "合計").at(-1)!.sagi;
  check("stats.json: 都合計(当年)がD1合計行と一致", stats.tokyoTotal.sagiCurrent === curTotal, `stats=${stats.tokyoTotal.sagiCurrent} D1=${curTotal}`);
  check("stats.json: 都合計(前年)がD1合計行と一致", stats.tokyoTotal.sagiPrevYear === prevTotal, `stats=${stats.tokyoTotal.sagiPrevYear} D1=${prevTotal}`);

  // 検算4: リスク指数の独立再計算（別実装: 文字列化を経由した丸めで突合）。高齢者版・全年代版の両方
  const idxMismatch: string[] = [];
  const recalcIdx = (sagi: number, pop: number): number | null =>
    pop > 0 ? Number(((sagi * 10000) / pop).toFixed(1)) : null;
  for (const m of stats.municipalities) {
    if (m.riskIndex !== recalcIdx(m.sagiCurrent, m.pop65) || m.riskIndexPrevYear !== recalcIdx(m.sagiPrevYear, m.pop65)) {
      idxMismatch.push(`${m.name}(高齢者): index=${m.riskIndex}`);
    }
    if (m.riskIndexAll !== recalcIdx(m.sagiCurrent, m.popTotal) || m.riskIndexAllPrevYear !== recalcIdx(m.sagiPrevYear, m.popTotal)) {
      idxMismatch.push(`${m.name}(全年代): index=${m.riskIndexAll}`);
    }
    for (const v of [m.riskIndex, m.riskIndexAll]) {
      if (v !== null && !Number.isFinite(v)) idxMismatch.push(`${m.name}: 非有限値`);
    }
  }
  check("リスク指数: 高齢者版・全年代版とも独立再計算と62自治体すべて一致（0除算はnull）", idxMismatch.length === 0, idxMismatch.slice(0, 5).join(" / "));
  const pop65Zero = stats.municipalities.filter((m) => m.pop65 <= 0);
  check(`65歳以上人口が0以下の自治体はリスク指数null（該当${pop65Zero.length}件）`, pop65Zero.every((m) => m.riskIndex === null));

  // 検算4b: 総人口の妥当性（総人口 ≥ 65歳以上人口。D3の3区分合計はbuildMuniMasterで検証済みの値）
  check("総人口 ≥ 65歳以上人口（62自治体すべて）", stats.municipalities.every((m) => m.popTotal >= m.pop65));
  const d3TotalCheck = stats.municipalities.every((m) => {
    const src = munis.find((x) => x.code === m.code);
    return src !== undefined && src.popTotal === m.popTotal && src.pop65 === m.pop65;
  });
  check("stats.jsonの人口値がD3レスポンス（3区分合計）と一致", d3TotalCheck);

  // 検算6: towns.json（町丁トップ5）の独立検算
  const townsJson = readJson<{ municipalities: Record<string, { name: string; sagi: number }[]> }>(
    path.join(CACHE_DIR, "towns.json"),
  );
  check("towns.json: 62自治体分のキーがある", Object.keys(townsJson.municipalities).length === 62);
  // 独立ロジックで町丁別件数を再集計してトップ5を突合
  {
    const nameSet = new Set(d1Names);
    let start = d1Cur.length;
    while (start > 0) {
      const a = d1Cur[start - 1].area;
      if (nameSet.has(a) || D1_SPECIAL_ROWS.includes(a)) start--;
      else break;
    }
    const sortedNames = [...d1Names].sort((a, b) => b.length - a.length);
    const perMuni = new Map<string, { name: string; sagi: number }[]>(d1Names.map((n) => [n, []]));
    for (const r of d1Cur.slice(0, start)) {
      const muni = sortedNames.find((n) => r.area.startsWith(n));
      if (!muni || r.area === `${muni}計`) continue;
      perMuni.get(muni)!.push({ name: r.area === muni ? "全域" : r.area.slice(muni.length), sagi: r.sagi });
    }
    const townMismatch: string[] = [];
    for (const m of munis) {
      const expected = perMuni.get(m.d1Name)!
        .filter((t) => t.sagi > 0)
        .sort((a, b) => b.sagi - a.sagi)
        .slice(0, 5);
      const actual = townsJson.municipalities[String(m.code)] ?? [];
      const sameLength = expected.length === actual.length;
      // 同数タイの並び順は不定のため、件数列の一致と名前集合の一致で検証する
      const countsMatch = sameLength && expected.every((e, i) => e.sagi === actual[i].sagi);
      const namesMatch = sameLength &&
        JSON.stringify([...expected.map((e) => e.name)].sort()) === JSON.stringify([...actual.map((a) => a.name)].sort());
      const withinTotal = actual.every((t) => t.sagi <= m.pop65 + 100000 && t.sagi >= 0); // 型健全性
      const sortedDesc = actual.every((t, i) => i === 0 || actual[i - 1].sagi >= t.sagi);
      if (!countsMatch || !namesMatch || !withinTotal || !sortedDesc) {
        townMismatch.push(m.name);
      }
    }
    check("towns.json: 独立再集計とトップ5が62自治体すべて一致（降順・件数0除外）", townMismatch.length === 0, townMismatch.slice(0, 5).join(","));
    // 町丁件数が自治体計を超えないこと
    const muniTotalByCode = new Map(stats.municipalities.map((m) => [String(m.code), m.sagiCurrent]));
    const overTotal = Object.entries(townsJson.municipalities).some(([code, list]) =>
      list.some((t) => t.sagi > (muniTotalByCode.get(code) ?? 0)),
    );
    check("towns.json: 町丁件数が自治体合計を超えない", !overTotal);
  }

  // 検算5: contacts.json の自治体名整合
  const contactsJson = readJson<{ contacts: { municipality: string }[] }>(path.join(CACHE_DIR, "contacts.json"));
  const contactMunis = new Set(contactsJson.contacts.map((c) => c.municipality));
  const unknown = [...contactMunis].filter((n) => !d3Names.has(n));
  check("contacts.json: 自治体名がすべてD3の62自治体に一致", unknown.length === 0, `不一致=${unknown.slice(0, 5).join(",")}`);
  check("contacts.json: 62自治体すべてに連絡先がある", contactMunis.size === 62, `実際=${contactMunis.size}自治体`);

  console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
  if (fail > 0) process.exit(1);
}

main();
