// 東京都オープンデータの取得・パース共通処理
// データソースの定義は docs/data.md（Phase A調査結果）に基づく

import fs from "node:fs";
import path from "node:path";

export const RAW_DIR = path.join(process.cwd(), "data", "cache", "raw");
export const CACHE_DIR = path.join(process.cwd(), "data", "cache");
export const SEED_DIR = path.join(process.cwd(), "data", "seed");

export const API_BASE = "https://service.api.metro.tokyo.lg.jp/api";

// apiId・URLは Phase A（docs/data.md）で実データ検証済みのもの
export const SOURCES = {
  d1CurrentCsv: {
    key: "d1_current",
    name: "区市町村の町丁別、罪種別及び手口別認知件数（月累計）令和8年分",
    provider: "警視庁",
    url: "https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.files/R8.csv",
    pageUrl: "https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.html",
    file: "d1_current.csv",
    note: "APIカタログ未登録のため警視庁サイトから月次バッチで直接取得（Shift_JIS）。公表当時の暫定値。",
  },
  d1PrevApi: {
    key: "d1_prev",
    name: "区市町村の町丁別、罪種別及び手口別認知件数（月累計）令和7年分",
    provider: "警視庁",
    apiId: "t000022d1700000021-0632e1972402bbe7acd54e1baa425f94-0",
    file: "d1_prev_r7.json",
    note: "東京都オープンデータAPI経由。令和7年の年間確定分（元CSV: R7.csv）。",
  },
  d3Age3: {
    key: "d3",
    name: "住民基本台帳による東京都の世帯と人口（町丁別・年齢別）令和8年1月 第３‐１表 区市町村、年齢３区分別人口（人口総数）",
    provider: "東京都総務局",
    apiId: "t000003d2000001115-fc3e15adb482542f766115471be19a90-0",
    file: "d3_age3_r8.json",
    note: "令和8年1月1日現在。65歳以上人口はリスク指数の分母。",
  },
  d4Contacts: {
    key: "d4",
    name: "高齢者等の異変に気付いた際の区市町村連絡先一覧",
    provider: "東京都福祉局",
    apiId: "t000054d0000000084-95089ae4131e4cfcfd43b9eeef5fb705-0",
    file: "d4_contacts.json",
    note: "version 1.0.3（698行）。先頭にヘッダ的な空行が1行あり取り込み時に除外。",
  },
} as const;

export interface ApiResponse {
  total: number;
  subtotal: number;
  limit: number;
  offset: number | null;
  metadata: { apiId: string; dataTitle: string; datasetTitle: string };
  hits: Record<string, unknown>[];
}

/** APIを全件ページネーション取得する。件数が合わない場合は例外。 */
export async function fetchAllFromApi(apiId: string, pageSize = 1000): Promise<ApiResponse> {
  const all: Record<string, unknown>[] = [];
  let first: ApiResponse | null = null;
  let offset = 0;
  for (;;) {
    const url = `${API_BASE}/${apiId}/json?limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) {
      throw new Error(`API取得失敗: ${url} → HTTP ${res.status}\n${(await res.text()).slice(0, 500)}`);
    }
    const page = (await res.json()) as ApiResponse;
    if (!first) first = page;
    all.push(...page.hits);
    if (all.length >= page.total || page.hits.length === 0) break;
    offset = all.length;
  }
  if (!first) throw new Error(`API取得失敗（レスポンスなし）: ${apiId}`);
  if (all.length !== first.total) {
    throw new Error(`API取得件数不一致: ${apiId} total=${first.total} 取得=${all.length}`);
  }
  return { ...first, subtotal: all.length, hits: all };
}

// ---- D1（認知件数）のパース ----

export const D1_SAGI_COLUMN = "その他詐欺"; // 詐欺関連手口の抽出条件（Phase Aゲート承認）
export const D1_AREA_COLUMN = "市区町丁";
export const D1_TOTAL_ROW = "合計";
// 「23区計」は年次により全角/半角の表記揺れがある（R8=２３区計、R7=23区計）
export const D1_WARDS_TOTAL_ROWS = ["２３区計", "23区計"];
export const D1_SPECIAL_ROWS = [...D1_WARDS_TOTAL_ROWS, "多摩地区・島部計", "他県", "海外認知", "不明", D1_TOTAL_ROW];

export interface D1Row {
  area: string;
  sagi: number;
  total: number;
}

/** Shift_JISのCSVバイト列をD1行配列にする（ヘッダ検証込み） */
export function parseD1Csv(buf: Buffer): { header: string[]; rows: D1Row[] } {
  const text = new TextDecoder("shift_jis").decode(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = splitCsvLine(lines[0]);
  const areaIdx = header.indexOf(D1_AREA_COLUMN);
  const sagiIdx = header.indexOf(D1_SAGI_COLUMN);
  const totalIdx = header.indexOf("総合計");
  if (areaIdx < 0 || sagiIdx < 0 || totalIdx < 0) {
    throw new Error(`D1 CSVヘッダが想定と異なります: ${header.join(",")}`);
  }
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return {
      area: cells[areaIdx],
      sagi: parseCount(cells[sagiIdx], cells[areaIdx]),
      total: parseCount(cells[totalIdx], cells[areaIdx]),
    };
  });
  return { header, rows };
}

/** D1 API（JSON）のhitsをD1行配列にする */
export function parseD1Api(hits: Record<string, unknown>[]): D1Row[] {
  return hits.map((h) => ({
    area: String(h[D1_AREA_COLUMN]),
    sagi: parseCount(h[D1_SAGI_COLUMN], String(h[D1_AREA_COLUMN])),
    total: parseCount(h["総合計"], String(h[D1_AREA_COLUMN])),
  }));
}

function parseCount(v: unknown, area: string): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  const s = String(v ?? "").trim();
  if (/^\d+$/.test(s)) return Number(s);
  throw new Error(`D1件数のパース失敗: 市区町丁=${area} 値=${JSON.stringify(v)}`);
}

/** ダブルクォート対応の簡易CSV分割（D1はクォート・カンマ内包なしだが念のため） */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * D1の区市町村サマリー行を抽出する。
 * ファイル構造: 町丁別セクション（「◯◯計」小計行を含む）→ 末尾に区市町村サマリーセクション。
 * 同名行が複数ある場合（例: 西多摩郡檜原村）はサマリーセクション側＝最後の出現を採る。
 */
export function extractMuniSummary(rows: D1Row[], muniNamesD1: string[]): Map<string, D1Row> {
  const lastIndex = new Map<string, number>();
  rows.forEach((r, i) => {
    if (muniNamesD1.includes(r.area)) lastIndex.set(r.area, i);
  });
  const missing = muniNamesD1.filter((n) => !lastIndex.has(n));
  if (missing.length > 0) {
    throw new Error(`D1にサマリー行が見つからない自治体: ${missing.join(", ")}`);
  }
  const map = new Map<string, D1Row>();
  for (const [name, idx] of lastIndex) map.set(name, rows[idx]);
  return map;
}

export interface TownRank {
  name: string; // 表示用町丁名（自治体名プレフィックスを除去。自治体全域1行の場合は「全域」）
  sagi: number;
}

/**
 * D1の町丁行から区市町村ごとの「その他詐欺」件数ランキングを作る。
 * - 末尾のサマリーセクション（自治体名・特殊行の連続ブロック）と「◯◯計」小計行は除外
 * - 自治体名と同名の町丁行（例: 西多摩郡檜原村の単独行）は「全域」として扱う
 */
export function extractTownRanking(rows: D1Row[], muniNamesD1: string[], topN: number): Map<string, TownRank[]> {
  const nameSet = new Set(muniNamesD1);
  // サマリーセクション開始位置（末尾から自治体名・特殊行が連続する範囲）
  let start = rows.length;
  while (start > 0) {
    const a = rows[start - 1].area;
    if (nameSet.has(a) || D1_SPECIAL_ROWS.includes(a)) start--;
    else break;
  }
  const body = rows.slice(0, start);
  const sorted = [...muniNamesD1].sort((a, b) => b.length - a.length);
  const towns = new Map<string, TownRank[]>(muniNamesD1.map((n) => [n, []]));
  for (const r of body) {
    const muni = sorted.find((n) => r.area.startsWith(n));
    if (!muni) continue;
    if (r.area === `${muni}計`) continue; // 小計行は除外（二重計上防止）
    const townName = r.area === muni ? "全域" : r.area.slice(muni.length);
    towns.get(muni)!.push({ name: townName, sagi: r.sagi });
  }
  const result = new Map<string, TownRank[]>();
  for (const [muni, list] of towns) {
    result.set(
      muni,
      list.filter((t) => t.sagi > 0).sort((a, b) => b.sagi - a.sagi).slice(0, topN),
    );
  }
  return result;
}

// ---- D3（年齢3区分人口）のパース ----

export const D3_POP65_COLUMN = "老年人口(65歳以上)／総数(人)";
export const D3_POP_YOUNG_COLUMN = "年少人口(0～14歳)／総数(人)";
export const D3_POP_WORKING_COLUMN = "生産年齢人口(15～64歳)／総数(人)";
export const D3_MUNI_LAYER = 4; // 地域階層=4 が区市町村

export interface Muni {
  code: number; // JIS市区町村コード（D3の地域コード）
  name: string; // D3表記（例: 三宅村）
  d1Name: string; // D1表記（例: 三宅島三宅村）
  pop65: number;
  popTotal: number; // 総人口（年少+生産年齢+老年）
}

/** D1側の自治体名表記へ変換する（島しょ部・郡部の表記差。docs/data.md §2.3） */
export function toD1Name(d3Name: string): string {
  const special: Record<string, string> = {
    三宅村: "三宅島三宅村",
    八丈町: "八丈島八丈町",
    瑞穂町: "西多摩郡瑞穂町",
    日の出町: "西多摩郡日の出町",
    檜原村: "西多摩郡檜原村",
    奥多摩町: "西多摩郡奥多摩町",
  };
  return special[d3Name] ?? d3Name;
}

/** D3のhitsから62区市町村マスタ（人口付き）を作る */
export function buildMuniMaster(hits: Record<string, unknown>[]): Muni[] {
  const readPop = (h: Record<string, unknown>, col: string, name: string): number => {
    const v = h[col];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(`D3の人口値が不正: ${name} ${col} = ${JSON.stringify(v)}`);
    }
    return v;
  };
  const munis = hits
    .filter((h) => Number(h["地域階層"]) === D3_MUNI_LAYER)
    .map((h) => {
      const name = String(h["地域"]);
      const pop65 = readPop(h, D3_POP65_COLUMN, name);
      const popTotal = pop65 + readPop(h, D3_POP_YOUNG_COLUMN, name) + readPop(h, D3_POP_WORKING_COLUMN, name);
      return { code: Number(h["地域コード"]), name, d1Name: toD1Name(name), pop65, popTotal };
    });
  if (munis.length !== 62) {
    throw new Error(`D3の区市町村数が62ではありません: ${munis.length}`);
  }
  return munis;
}

// ---- ユーティリティ ----

export function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

export function writeJson(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
