// C-2: 表示テンプレート。ユーザー向け文言はすべてここの定型文からenumで引く。
// LLMの自由文が見出し・危険度・行動文言に混入しない構造にすることで断定禁止を担保する。
// 「確定文言」（spec 4章マイクロコピー）の変更は人間の確認が必要。

import type { ActionId, RiskLevel } from "./schema.ts";

/** 危険度の表示定義（色+アイコン+文言の冗長表示: spec 4章） */
export const RISK_DISPLAY: Record<RiskLevel, { label: string; headline: string }> = {
  high: {
    label: "要注意",
    headline: "知られた手口と共通する強い特徴が見つかりました。あわてなくて大丈夫。まずは一度、やり取りを止めましょう。",
  },
  caution: {
    label: "注意",
    headline: "注意したほうがよい特徴が見つかりました。急いで返事をせず、内容を確認しましょう。",
  },
  low: {
    label: "低リスク",
    headline: "", // low は下の定型注意文のみを表示する（headlineなし）
  },
};

/** 確定文言: low判定時に必ず表示する定型注意文（CLAUDE.mdルール1・spec 4章。一字一句変更不可） */
export const LOW_RISK_NOTICE =
  "今回の内容に、知られた手口の強い特徴は見つかりませんでした。ただし新しい手口の可能性は残ります。お金の話が出たら、一度切って相談を";

/** 推奨行動の表示定義 */
export const ACTION_DISPLAY: Record<ActionId, { label: string; description: string }> = {
  hang_up: { label: "電話を切る", description: "相手が誰でも、一度切って大丈夫です。本物の相手なら、公式の番号にかけ直して確認できます。" },
  ignore_block: { label: "無視・ブロック", description: "返信せず、送信元をブロックしましょう。記載のURLは開かないでください。" },
  consult_9110: { label: "#9110 に相談", description: "警察相談専用電話。不審だけれど被害はまだ、というときの相談先です。" },
  consult_188: { label: "188 に相談", description: "消費者ホットライン。契約・お金のトラブルの相談先です。" },
  call_110: { label: "110 に通報", description: "すでにお金を渡した・今まさに被害が起きているときは、すぐ110へ。" },
};

/** 手口不明時の表示名 */
export const UNKNOWN_TECHNIQUE_LABEL = "判別できない型";

/**
 * 断定表現の禁止パターン（CLAUDE.mdルール1）。
 * judge.ts のevidenceサニタイズと scripts/eval.ts の自動チェックの両方がこのリストを参照する。
 */
export const BANNED_ASSERTION_PATTERNS: RegExp[] = [
  /詐欺です/,
  /詐欺だ[。！\s]/,
  /詐欺である/,
  /詐欺と断定/,
  /詐欺に間違いない/,
  /間違いなく/,
  /確実に詐欺/,
  /必ず詐欺/,
  /詐欺ではありません/,
  /詐欺ではない/,
  /安全です/,
  /安心です/,
  /問題ありません/,
  /心配ありません/,
  /心配いりません/,
];

export function containsBannedAssertion(text: string): boolean {
  return BANNED_ASSERTION_PATTERNS.some((re) => re.test(text));
}

/** 判定結果をユーザー向け表示テキスト（プレーンテキスト版）に組み立てる。UIとevalの共通レンダラ */
export function renderJudgeDisplay(params: {
  risk: RiskLevel;
  techniqueLabel: string;
  evidence: string[];
  actions: ActionId[];
}): string {
  const { risk, techniqueLabel, evidence, actions } = params;
  const lines: string[] = [];
  lines.push(`【${RISK_DISPLAY[risk].label}】`);
  if (RISK_DISPLAY[risk].headline) lines.push(RISK_DISPLAY[risk].headline);
  if (risk !== "low") {
    lines.push(`近い型: ${techniqueLabel}`);
  }
  if (evidence.length > 0 && risk !== "low") {
    lines.push("気になる特徴:");
    for (const e of evidence) lines.push(`・${e}`);
  }
  if (risk === "low") {
    lines.push(LOW_RISK_NOTICE);
  }
  lines.push("次にすること:");
  for (const a of actions) {
    lines.push(`・${ACTION_DISPLAY[a].label} — ${ACTION_DISPLAY[a].description}`);
  }
  return lines.join("\n");
}
