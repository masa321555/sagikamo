// B-1: 東京都オープンデータの取得 → data/cache/raw/ に保存
// 失敗時はダミーで代替せず、URL・ステータス・レスポンスを表示して終了コード1で停止する（CLAUDE.mdルール4）

import fs from "node:fs";
import path from "node:path";
import { RAW_DIR, SOURCES, fetchAllFromApi, parseD1Csv, writeJson } from "./lib/opendata.ts";

interface FetchRecord {
  key: string;
  name: string;
  provider: string;
  url: string;
  fetchedAt: string; // ISO8601
  httpStatus: number | null;
  bytes: number;
  rows: number;
  period: string | null; // データの対象期間（例: 令和8年6月累計）
  note: string;
}

const records: FetchRecord[] = [];

async function fetchD1CurrentCsv(): Promise<void> {
  const src = SOURCES.d1CurrentCsv;
  const res = await fetch(src.url);
  if (!res.ok) {
    throw new Error(`D1(当年CSV)取得失敗: ${src.url} → HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // スキーマ検証（パースが通ること＝ヘッダに市区町丁/その他詐欺/総合計がある）
  const { rows } = parseD1Csv(buf);
  if (rows.length < 1000) {
    throw new Error(`D1(当年CSV)の行数が異常に少ない: ${rows.length}行`);
  }

  // 掲載ページから「◯月累計」ラベルを取得（ページはUTF-8。R8.csvへのリンクテキストが「n月累計…」）。
  // 取得できない場合は period=null のまま記録し警告する（創作しない: CLAUDE.mdルール3）。
  let period: string | null = null;
  const pageRes = await fetch(src.pageUrl);
  if (pageRes.ok) {
    const pageHtml = await pageRes.text();
    const m = pageHtml.match(/R8\.csv"[^>]*>\s*([0-9０-９]{1,2})月累計/);
    if (m) {
      const month = m[1].replace(/[０-９]/g, (c) => String("０１２３４５６７８９".indexOf(c)));
      period = `令和8年${month}月累計`;
    }
  }
  if (period === null) {
    console.warn(`警告: D1掲載ページから「◯月累計」ラベルを特定できませんでした（${src.pageUrl}）。period=null で記録します。`);
  }

  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, src.file), buf); // 原文（Shift_JIS）のまま保存
  records.push({
    key: src.key, name: src.name, provider: src.provider, url: src.url,
    fetchedAt: new Date().toISOString(), httpStatus: res.status, bytes: buf.length,
    rows: rows.length, period, note: src.note,
  });
  console.log(`OK D1当年: ${rows.length}行 ${buf.length}bytes period=${period}`);
}

async function fetchApiSource(
  src: { key: string; name: string; provider: string; apiId: string; file: string; note: string },
  period: string | null,
  minRows: number,
): Promise<void> {
  const data = await fetchAllFromApi(src.apiId);
  if (data.hits.length < minRows) {
    throw new Error(`${src.key}の件数が想定より少ない: ${data.hits.length}行（最低${minRows}行を想定）`);
  }
  fs.mkdirSync(RAW_DIR, { recursive: true });
  writeJson(path.join(RAW_DIR, src.file), data);
  const url = `https://service.api.metro.tokyo.lg.jp/api/${src.apiId}/json`;
  records.push({
    key: src.key, name: src.name, provider: src.provider, url,
    fetchedAt: new Date().toISOString(), httpStatus: 200, bytes: 0,
    rows: data.hits.length, period, note: src.note,
  });
  console.log(`OK ${src.key}: ${data.hits.length}行 (${data.metadata.dataTitle})`);
}

async function main(): Promise<void> {
  await fetchD1CurrentCsv();
  await fetchApiSource(SOURCES.d1PrevApi, "令和7年（年間）", 4000);
  await fetchApiSource(SOURCES.d3Age3, "令和8年1月1日現在", 62);
  await fetchApiSource(SOURCES.d4Contacts, null, 100);
  writeJson(path.join(RAW_DIR, "fetch_meta.json"), { records });
  console.log(`\n完了: ${records.length}ソースを ${RAW_DIR} に保存しました。`);
}

main().catch((e) => {
  console.error("\n=== 取得失敗（ダミーで代替せず停止します） ===");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
