// APIクライアント＋オフラインデモモード（D-5）。
// 統計・連絡先・手口定義はAPI失敗時に data/seed/ のスナップショットへフォールバックし、isDemo=true を返す。
// UIは isDemo のとき必ず「サンプルデータ」バッジを表示する（CLAUDE.mdルール4）。
// 判定だけはLLM必須のためフォールバックせず、明示的なデモ操作（サンプル判定を見る）のみseedを使う。

import seedStats from "../../data/seed/stats.json";
import seedContacts from "../../data/seed/contacts.json";
import seedTowns from "../../data/seed/towns.json";
import seedJudgement from "../../data/seed/sample_judgement.json";
import techniquesConfig from "../../data/config/techniques.json";
import type { ContactsJson, JudgeResponse, StatsJson, TechniquesJson, TownsJson } from "./types.ts";

export interface WithDemo<T> {
  data: T;
  isDemo: boolean;
}

/** URLに ?demo=1 が付いていたら強制デモモード（審査当日のオフライン対策） */
export function isForcedDemo(): boolean {
  return new URLSearchParams(location.search).get("demo") === "1";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getStats(): Promise<WithDemo<StatsJson>> {
  if (isForcedDemo()) return { data: seedStats as unknown as StatsJson, isDemo: true };
  try {
    return { data: await fetchJson<StatsJson>("/api/stats"), isDemo: false };
  } catch {
    return { data: seedStats as unknown as StatsJson, isDemo: true };
  }
}

export async function getContacts(): Promise<WithDemo<ContactsJson>> {
  if (isForcedDemo()) return { data: seedContacts as unknown as ContactsJson, isDemo: true };
  try {
    return { data: await fetchJson<ContactsJson>("/api/contacts"), isDemo: false };
  } catch {
    return { data: seedContacts as unknown as ContactsJson, isDemo: true };
  }
}

export async function getTowns(): Promise<WithDemo<TownsJson>> {
  if (isForcedDemo()) return { data: seedTowns as unknown as TownsJson, isDemo: true };
  try {
    return { data: await fetchJson<TownsJson>("/api/towns"), isDemo: false };
  } catch {
    return { data: seedTowns as unknown as TownsJson, isDemo: true };
  }
}

export function getTechniques(): TechniquesJson {
  // 手口定義は静的設定のためバンドルに同梱（唯一の知識ベース techniques.json と同一ファイル）
  return techniquesConfig as unknown as TechniquesJson;
}

export interface JudgeImagePayload {
  mediaType: string;
  dataBase64: string;
}

/** LLM判定（テキストおよび/またはスクリーンショット画像）。失敗時は例外（ダミーで代替しない）。 */
export async function postJudge(text: string, image?: JudgeImagePayload): Promise<JudgeResponse> {
  const res = await fetch("/api/judge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, image }),
  });
  const body = (await res.json()) as JudgeResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/** デモ用サンプル判定（明示的に「サンプル判定を見る」を押したときだけ使う） */
export function getSampleJudgement(): JudgeResponse {
  const s = seedJudgement as unknown as JudgeResponse;
  return s;
}
