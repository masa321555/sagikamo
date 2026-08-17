// B-2: data/cache/raw/ → UI用JSON（data/cache/stats.json, contacts.json）を生成
// - 区市町村単位の詐欺関連件数（当年=令和8年月累計 / 前年=令和7年）
// - リスク指数 = 当年の詐欺関連認知件数 ÷ 65歳以上人口 × 10,000（spec 2.3）
// - 件数はすべて取得済み実データから算出。LLM・推定による補完はしない（CLAUDE.mdルール3）

import fs from "node:fs";
import path from "node:path";
import {
  RAW_DIR, CACHE_DIR, SOURCES,
  parseD1Csv, parseD1Api, extractMuniSummary, buildMuniMaster, extractTownRanking,
  D1_SPECIAL_ROWS, D1_TOTAL_ROW,
  readJson, writeJson,
  type ApiResponse,
} from "./lib/opendata.ts";

const TOWN_TOP_N = 5;

interface FetchMeta {
  records: {
    key: string; name: string; provider: string; url: string;
    fetchedAt: string; rows: number; period: string | null; note: string;
  }[];
}

export interface MuniStat {
  code: number;
  name: string; // D3表記（UI表示用）
  d1Name: string;
  pop65: number;
  popTotal: number; // 総人口（全年代）
  sagiCurrent: number; // 当年（令和8年月累計）の「その他詐欺」認知件数
  sagiPrevYear: number; // 前年（令和7年・年間）の同件数
  riskIndex: number | null; // 高齢者1万人あたり。分母0・欠損時はnull（「算出不可」表示）
  riskIndexPrevYear: number | null;
  riskIndexAll: number | null; // 全年代（都民1万人あたり）
  riskIndexAllPrevYear: number | null;
}

function riskIndex(sagi: number, pop65: number): number | null {
  if (!Number.isFinite(pop65) || pop65 <= 0) return null;
  return Math.round((sagi / pop65) * 10000 * 10) / 10; // 小数1桁
}

function main(): void {
  const meta = readJson<FetchMeta>(path.join(RAW_DIR, "fetch_meta.json"));
  const metaOf = (key: string) => {
    const r = meta.records.find((r) => r.key === key);
    if (!r) throw new Error(`fetch_meta.jsonに ${key} の取得記録がありません。先に npm run fetch-opendata を実行してください。`);
    return r;
  };

  // D3 → 62自治体マスタ（地域コード・65歳以上人口）
  const d3 = readJson<ApiResponse>(path.join(RAW_DIR, SOURCES.d3Age3.file));
  const munis = buildMuniMaster(d3.hits);

  // D1当年（令和8年月累計・CSV）とD1前年（令和7年・API）
  const d1CurrentRaw = parseD1Csv(fs.readFileSync(path.join(RAW_DIR, SOURCES.d1CurrentCsv.file)));
  const d1PrevRaw = parseD1Api(readJson<ApiResponse>(path.join(RAW_DIR, SOURCES.d1PrevApi.file)).hits);

  const d1Names = munis.map((m) => m.d1Name);
  const currentSummary = extractMuniSummary(d1CurrentRaw.rows, d1Names);
  const prevSummary = extractMuniSummary(d1PrevRaw, d1Names);

  const stats: MuniStat[] = munis.map((m) => {
    const cur = currentSummary.get(m.d1Name)!;
    const prev = prevSummary.get(m.d1Name)!;
    return {
      code: m.code,
      name: m.name,
      d1Name: m.d1Name,
      pop65: m.pop65,
      popTotal: m.popTotal,
      sagiCurrent: cur.sagi,
      sagiPrevYear: prev.sagi,
      riskIndex: riskIndex(cur.sagi, m.pop65),
      riskIndexPrevYear: riskIndex(prev.sagi, m.pop65),
      riskIndexAll: riskIndex(cur.sagi, m.popTotal),
      riskIndexAllPrevYear: riskIndex(prev.sagi, m.popTotal),
    };
  });

  // 都全体（地域未選択時の表示用）: D1の「合計」行から取る（積上げではなく公表値をそのまま使う）
  const totalRow = (rows: { area: string; sagi: number }[]) => {
    const r = rows.filter((x) => x.area === D1_TOTAL_ROW).at(-1);
    if (!r) throw new Error("D1に「合計」行が見つかりません");
    return r.sagi;
  };

  const d1CurMeta = metaOf("d1_current");
  const d1PrevMeta = metaOf("d1_prev");
  const d3Meta = metaOf("d3");

  const statsJson = {
    generatedAt: new Date().toISOString(),
    sagiDefinition: "警視庁の刑法犯認知件数のうち「その他詐欺」列（特殊詐欺の手口別内訳は本データに存在しない）",
    sources: {
      d1Current: { name: d1CurMeta.name, provider: d1CurMeta.provider, url: d1CurMeta.url, fetchedAt: d1CurMeta.fetchedAt, period: d1CurMeta.period, note: d1CurMeta.note },
      d1PrevYear: { name: d1PrevMeta.name, provider: d1PrevMeta.provider, url: d1PrevMeta.url, fetchedAt: d1PrevMeta.fetchedAt, period: d1PrevMeta.period, note: d1PrevMeta.note },
      d3: { name: d3Meta.name, provider: d3Meta.provider, url: d3Meta.url, fetchedAt: d3Meta.fetchedAt, period: d3Meta.period, note: d3Meta.note },
    },
    tokyoTotal: {
      sagiCurrent: totalRow(d1CurrentRaw.rows),
      sagiPrevYear: totalRow(d1PrevRaw),
      currentPeriod: d1CurMeta.period,
      prevYearPeriod: d1PrevMeta.period,
    },
    municipalities: stats,
  };
  writeJson(path.join(CACHE_DIR, "stats.json"), statsJson);
  console.log(`stats.json: 自治体${stats.length}件 / 都合計(当年)=${statsJson.tokyoTotal.sagiCurrent} (前年)=${statsJson.tokyoTotal.sagiPrevYear}`);

  // 町丁トップN（当年のみ）→ towns.json（マップ詳細カード用）
  const townRanking = extractTownRanking(d1CurrentRaw.rows, d1Names, TOWN_TOP_N);
  const townsByCode: Record<string, { name: string; sagi: number }[]> = {};
  for (const m of munis) {
    townsByCode[String(m.code)] = townRanking.get(m.d1Name) ?? [];
  }
  writeJson(path.join(CACHE_DIR, "towns.json"), {
    generatedAt: new Date().toISOString(),
    note: `区市町村内で詐欺（刑法犯・その他詐欺列）の認知件数が多い町丁トップ${TOWN_TOP_N}（当年・件数0の町丁は除外）`,
    source: { name: d1CurMeta.name, provider: d1CurMeta.provider, url: d1CurMeta.url, fetchedAt: d1CurMeta.fetchedAt, period: d1CurMeta.period, note: d1CurMeta.note },
    municipalities: townsByCode,
  });
  console.log(`towns.json: ${Object.values(townsByCode).filter((v) => v.length > 0).length}自治体にランキングあり`);

  // D4 → contacts.json（区市町村セレクタ用）。先頭のヘッダ的な行（通番が空）は除外
  const d4 = readJson<ApiResponse>(path.join(RAW_DIR, SOURCES.d4Contacts.file));
  const d4Meta = metaOf("d4");
  const contacts = d4.hits
    .filter((h) => String(h["通番"] ?? "").trim() !== "" && String(h["区市町村名"] ?? "").trim() !== "")
    .map((h) => ({
      municipality: String(h["区市町村名"]),
      name: String(h["名称"]),
      phone: String(h["電話番号"] ?? ""),
      hours: String(h["対応時間帯"] ?? ""),
      address: String(h["住所"] ?? ""),
      notes: String(h["特記事項"] ?? ""),
      facilityType: String(h["施設種別"] ?? ""),
    }));
  const contactMunis = new Set(contacts.map((c) => c.municipality));
  console.log(`contacts.json: ${contacts.length}件（${contactMunis.size}自治体）`);
  writeJson(path.join(CACHE_DIR, "contacts.json"), {
    generatedAt: new Date().toISOString(),
    source: { name: d4Meta.name, provider: d4Meta.provider, url: d4Meta.url, fetchedAt: d4Meta.fetchedAt, note: d4Meta.note },
    contacts,
  });
}

main();
