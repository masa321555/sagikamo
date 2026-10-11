// 匿名統計カウンタ（月×区×手口×危険度×チャネル）
// CLAUDE.mdルール2: 保存するのは分類値（5カラム）と件数のみ。本文・ID類は一切受け取らない設計にする。
// - recordStat は本文を引数に取れない（StatRecord に本文フィールドが存在しない）
// - ward / technique は許可リスト外を 'unknown' に落とし、risk 不正時は加算しない

import techniquesJson from "../data/config/techniques.json";
import statsJson from "../data/cache/stats.json";
import { RISK_LEVELS } from "../src/lib/judge/schema.ts";

// D1 の最小型定義（@cloudflare/workers-types非依存）
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

export interface StatRecord {
  ward: string; // 区市町村コード文字列 or 'unknown'
  technique: string;
  risk: string;
  channel: "web" | "line";
}

const TECHNIQUE_IDS = new Set<string>(
  (techniquesJson as { techniques: { id: string }[] }).techniques.map((t) => t.id),
);
const WARD_CODES = new Set<string>(
  (statsJson as { municipalities: { code: number }[] }).municipalities.map((m) => String(m.code)),
);
const RISK_SET = new Set<string>(RISK_LEVELS);
const CHANNELS = new Set(["web", "line"]);

/** 'YYYY-MM'（JST基準。クライアントの時刻は使わない） */
export function currentYmJst(now = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 7);
}

/** 入力値を語彙に正規化する。riskが不正なら null（=加算しない） */
export function normalizeStatRecord(rec: StatRecord): StatRecord | null {
  if (!RISK_SET.has(rec.risk) || !CHANNELS.has(rec.channel)) return null;
  return {
    ward: WARD_CODES.has(rec.ward) ? rec.ward : "unknown",
    technique: TECHNIQUE_IDS.has(rec.technique) ? rec.technique : "unknown",
    risk: rec.risk,
    channel: rec.channel,
  };
}

/** 1判定=1加算。失敗しても呼び出し元（判定レスポンス）には影響させないこと（waitUntilで呼ぶ） */
export async function recordStat(db: D1Like | undefined, rec: StatRecord): Promise<void> {
  if (!db) return; // ローカル開発等でバインディングがない場合は何もしない
  const v = normalizeStatRecord(rec);
  if (!v) return;
  try {
    await db
      .prepare(
        `INSERT INTO counts (ym, ward, technique, risk, channel, n)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(ym, ward, technique, risk, channel) DO UPDATE SET n = n + 1`,
      )
      .bind(currentYmJst(), v.ward, v.technique, v.risk, v.channel)
      .run();
  } catch (e) {
    console.error(`[stats] record error: ${e instanceof Error ? e.message.slice(0, 200) : ""}`);
  }
}

// ---- 集計（/api/counts 系） ----

export interface CountRow {
  ward: string;
  technique: string;
  risk: string;
  n: number | null; // 小規模セル（5未満）は null に伏せる
}

const SUPPRESS_BELOW = 5;

export async function queryMonth(
  db: D1Like,
  ym: string,
): Promise<{ rows: CountRow[]; total: number }> {
  const { results } = await db
    .prepare(
      `SELECT ward, technique, risk, SUM(n) AS n FROM counts
       WHERE ym = ? GROUP BY ward, technique, risk ORDER BY ward, technique, risk`,
    )
    .bind(ym)
    .all<{ ward: string; technique: string; risk: string; n: number }>();
  const total = results.reduce((a, r) => a + r.n, 0);
  const rows = results.map((r) => ({ ...r, n: r.n < SUPPRESS_BELOW ? null : r.n }));
  return { rows, total };
}

/** 管理用: 抑制なし（それでも5カラム＋件数のみ） */
export async function queryMonthRaw(db: D1Like, ym: string): Promise<CountRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ward, technique, risk, SUM(n) AS n FROM counts
       WHERE ym = ? GROUP BY ward, technique, risk ORDER BY ward, technique, risk`,
    )
    .bind(ym)
    .all<{ ward: string; technique: string; risk: string; n: number }>();
  return results;
}

const WARD_NAMES = new Map<string, string>(
  (statsJson as { municipalities: { code: number; name: string }[] }).municipalities.map((m) => [
    String(m.code),
    m.name,
  ]),
);
const TECHNIQUE_NAMES = new Map<string, string>(
  (techniquesJson as { techniques: { id: string; name: string }[] }).techniques.map((t) => [t.id, t.name]),
);

/** CSV（UTF-8 BOM付き・Excel対応）。伏せたセルの count は空欄 */
export function toCsv(ym: string, rows: CountRow[]): string {
  const header = "month,ward_code,ward_name,technique_id,technique_name,risk,count";
  const lines = rows.map((r) =>
    [
      ym,
      r.ward,
      WARD_NAMES.get(r.ward) ?? "不明・未設定",
      r.technique,
      TECHNIQUE_NAMES.get(r.technique) ?? "判別できない型",
      r.risk,
      r.n === null ? "" : String(r.n),
    ].join(","),
  );
  return "﻿" + [header, ...lines].join("\r\n") + "\r\n";
}
