// 匿名統計カウンタ（月×区×手口×危険度×チャネル）
// CLAUDE.mdルール2: 保存するのは分類値（5カラム）と件数のみ。本文・ID類は一切受け取らない設計にする。
// - recordStat は本文を引数に取れない（StatRecord に本文フィールドが存在しない）
// - ward / technique は許可リスト外を 'unknown' に落とし、risk 不正時は加算しない

import techniquesJson from "../data/config/techniques.json";
import phoneRulesJson from "../data/config/phone_rules.json";
import statsJson from "../data/cache/stats.json";
import { RISK_LEVELS } from "../src/lib/judge/schema.ts";
import { CLAIMED_ORG_IDS, WHO_CHOICES } from "../src/lib/phone/questions.ts";

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

// ---- 電話チェックの統計（番号帯 × 名乗られた組織。/api/counts/phone 系） ----
// 番号そのもの・自由入力の組織名は受け取れない設計（PhoneStatRecord は分類IDのみ）

export interface PhoneStatRecord {
  band: string; // phone_rules.json の id または 'none'（番号未入力）
  org: string; // 電話チェックの選択肢ID（'unknown'=利用者が「知らない人」を選択）。未回答は 'none'
  channel: "web" | "line";
}

const PHONE_RULES = (phoneRulesJson as { rules: { id: string; label: string }[] }).rules;
const BAND_IDS = new Set<string>(PHONE_RULES.map((r) => r.id));
const ORG_IDS = new Set<string>(CLAIMED_ORG_IDS);

/** 語彙に正規化する。語彙外の値（番号や自由文が紛れ込んだ場合を含む）は 'none'（未入力・未回答）に落とす */
export function normalizePhoneStatRecord(rec: PhoneStatRecord): PhoneStatRecord | null {
  if (!CHANNELS.has(rec.channel)) return null;
  const band = BAND_IDS.has(rec.band) ? rec.band : "none";
  const org = ORG_IDS.has(rec.org) ? rec.org : "none";
  if (band === "none" && org === "none") return null; // 何も分類できない記録は加算しない
  return { band, org, channel: rec.channel };
}

export async function recordPhoneStat(db: D1Like | undefined, rec: PhoneStatRecord): Promise<void> {
  if (!db) return;
  const v = normalizePhoneStatRecord(rec);
  if (!v) return;
  try {
    await db
      .prepare(
        `INSERT INTO counts_phone (ym, band, claimed_org, channel, n)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(ym, band, claimed_org, channel) DO UPDATE SET n = n + 1`,
      )
      .bind(currentYmJst(), v.band, v.org, v.channel)
      .run();
  } catch (e) {
    console.error(`[stats] phone record error: ${e instanceof Error ? e.message.slice(0, 200) : ""}`);
  }
}

export interface PhoneCountRow {
  band: string;
  claimed_org: string;
  n: number | null; // 小規模セル（5未満）は null に伏せる
}

async function queryPhoneMonthAll(db: D1Like, ym: string): Promise<{ band: string; claimed_org: string; n: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT band, claimed_org, SUM(n) AS n FROM counts_phone
       WHERE ym = ? GROUP BY band, claimed_org ORDER BY band, claimed_org`,
    )
    .bind(ym)
    .all<{ band: string; claimed_org: string; n: number }>();
  return results;
}

export async function queryPhoneMonth(db: D1Like, ym: string): Promise<{ rows: PhoneCountRow[]; total: number }> {
  const results = await queryPhoneMonthAll(db, ym);
  const total = results.reduce((a, r) => a + r.n, 0);
  return { rows: results.map((r) => ({ ...r, n: r.n < SUPPRESS_BELOW ? null : r.n })), total };
}

/** 管理用: 抑制なし（それでも分類IDと件数のみ） */
export function queryPhoneMonthRaw(db: D1Like, ym: string): Promise<PhoneCountRow[]> {
  return queryPhoneMonthAll(db, ym);
}

const BAND_NAMES = new Map<string, string>(PHONE_RULES.map((r) => [r.id, r.label]));
const ORG_NAMES = new Map<string, string>(WHO_CHOICES.map((c) => [c.id, c.label]));

/** CSV（UTF-8 BOM付き・Excel対応）。伏せたセルの count は空欄 */
export function phoneToCsv(ym: string, rows: PhoneCountRow[]): string {
  const header = "month,band_id,band_name,claimed_org_id,claimed_org_name,count";
  const lines = rows.map((r) =>
    [
      ym,
      r.band,
      BAND_NAMES.get(r.band) ?? "番号の入力なし",
      r.claimed_org,
      ORG_NAMES.get(r.claimed_org) ?? "未回答（番号チェックのみ）",
      r.n === null ? "" : String(r.n),
    ].join(","),
  );
  return "﻿" + [header, ...lines].join("\r\n") + "\r\n";
}
