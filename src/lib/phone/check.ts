// 電話番号チェック（ルールベース・LLM不使用）
// 入力された番号の「国番号・番号帯」という形式的な性質だけを、data/config/phone_rules.json のルールで即時判定する。
// - 番号そのものは保存・送信しない（返すのは番号帯の分類IDと定型文のみ。CLAUDE.mdルール2）
// - 「この番号は詐欺」とは断定しない。番号は偽装できるため、形式から言えることだけを伝える（ルール1）

export type PhoneLevel = "high" | "caution" | "info";

export interface PhoneRule {
  id: string; // 番号帯の分類ID（統計にはこのIDだけを記録する）
  label: string; // 番号帯の名称（例: 北米のフリーダイヤル帯の国際電話番号）
  level: PhoneLevel;
  note: string; // 利用者向けの説明（断定表現なし）
  fragment: string; // 電話チェックの判定文に添える定型文（番号そのものは含めない）
  match: {
    prefixes?: string[]; // 正規化後の番号への前方一致（国際は "+1844" の形、国内は "050" の形）
    suffix?: string; // 末尾一致
    international?: boolean; // true=国際番号のみ / false=国内番号のみ / 省略=どちらも
  };
}

export interface PhoneRulesJson {
  rules: PhoneRule[];
}

export type PhoneCheckResult =
  | { ok: true; ruleId: string; level: PhoneLevel; label: string; note: string; fragment: string; international: boolean }
  | { ok: false; reason: "invalid" };

/** 入力を正規化する。国際番号は "+<国番号…>"、国内番号は "0…" の数字列にそろえる。読み取れなければ null */
export function normalizePhoneNumber(input: string): string | null {
  // 全角→半角、区切り文字（空白・各種ハイフン・括弧・ピリオド）を除去
  const half = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/＋/g, "+")
    .replace(/[\s　\-‐‑–—―−ー－().（）．・]/g, "");
  if (!/^\+?\d+$/.test(half)) return null;

  let n = half;
  // 「010」は日本から見た国際電話の識別番号。国際番号として扱う
  if (!n.startsWith("+") && n.startsWith("010") && n.length >= 11) n = "+" + n.slice(3);
  // 日本の国番号つきは国内番号に戻す（+81 90… → 090…）
  if (n.startsWith("+81")) n = "0" + n.slice(3).replace(/^0/, "");

  const digits = n.replace(/^\+/, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (!n.startsWith("+") && !n.startsWith("0")) return null; // 国内番号は0始まり
  return n;
}

function ruleMatches(rule: PhoneRule, normalized: string): boolean {
  const international = normalized.startsWith("+");
  const m = rule.match;
  if (m.international !== undefined && m.international !== international) return false;
  if (m.prefixes && !m.prefixes.some((p) => normalized.startsWith(p))) return false;
  if (m.suffix && !normalized.endsWith(m.suffix)) return false;
  return true;
}

/** ルールを上から順に評価し、最初に一致したものを採用する（具体的なルールほど上に書く） */
export function checkPhoneNumber(input: string, rules: PhoneRule[]): PhoneCheckResult {
  const normalized = normalizePhoneNumber(input);
  if (!normalized) return { ok: false, reason: "invalid" };
  const rule = rules.find((r) => ruleMatches(r, normalized));
  if (!rule) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    ruleId: rule.id,
    level: rule.level,
    label: rule.label,
    note: rule.note,
    fragment: rule.fragment,
    international: normalized.startsWith("+"),
  };
}

/** メッセージ全体が電話番号だけかどうか（LINEで番号だけ送られたときの振り分け用） */
export function looksLikePhoneNumberOnly(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 30) return false;
  return normalizePhoneNumber(t) !== null;
}

/** 番号帯レベルごとの表示定義（確定文言。断定表現なし） */
export const PHONE_LEVEL_DISPLAY: Record<PhoneLevel, { label: string; headline: string }> = {
  high: {
    label: "要注意",
    headline: "詐欺の電話で使われる例が、公的機関から注意喚起されている番号帯です。心当たりがなければ、出ない・折り返さないでください。",
  },
  caution: {
    label: "注意",
    headline: "注意したほうがよい番号帯です。心当たりがなければ、急いで折り返さず、相手と用件を確かめましょう。",
  },
  info: {
    label: "番号だけでは判断できません",
    headline: "番号の形式に、とくに注意喚起されている特徴は見つかりませんでした。",
  },
};

/** 番号チェックの結果に必ず添える定型注意文（番号は偽装できるため、番号だけで判断しない） */
export const PHONE_NUMBER_NOTICE =
  "表示される電話番号は偽装できるため、番号だけでは判断できません。お金・カード・個人情報の話が出たら、一度切って相談を";
