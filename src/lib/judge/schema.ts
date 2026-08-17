// C-2: 判定出力のJSONスキーマと型定義（純粋モジュール: Workers/ブラウザ/Nodeで共用）
// 断定禁止（CLAUDE.mdルール1）を構造で担保する:
// - risk / technique / actions はすべて enum。LLMが自由文で危険度を語る余地をなくす
// - 自由文は evidence（特徴の指摘）のみで、表示前に禁止表現サニタイズを通す（judge.ts)

export const RISK_LEVELS = ["high", "caution", "low"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ACTIONS = ["hang_up", "ignore_block", "consult_9110", "consult_188", "call_110"] as const;
export type ActionId = (typeof ACTIONS)[number];

export const UNKNOWN_TECHNIQUE = "unknown";

export interface JudgeResult {
  risk: RiskLevel;
  technique: string; // techniques.json のID または "unknown"
  evidence: string[]; // 根拠となる特徴（最大5件。表示前にサニタイズ済み）
  actions: ActionId[];
}

export interface TechniqueDef {
  id: string;
  name: string;
  summary: string;
  typical_phrases: string[];
  target_situation: string;
  first_action: string;
  d1_match_keywords: string[];
}

/** techniques.json のパース済みオブジェクトを検証する（読み込み手段は呼び出し側: Nodeはfs、WorkersはJSON import） */
export function validateTechniques(parsed: unknown): TechniqueDef[] {
  const obj = parsed as { techniques?: TechniqueDef[] };
  if (!Array.isArray(obj.techniques) || obj.techniques.length === 0) {
    throw new Error("techniques.json に手口定義がありません");
  }
  return obj.techniques;
}

/** 構造化出力用JSONスキーマ。technique は techniques.json のID＋unknown の enum に固定する */
export function buildJudgeOutputSchema(techniqueIds: string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["risk", "technique", "evidence", "actions"],
    properties: {
      risk: { type: "string", enum: [...RISK_LEVELS], description: "危険度の見立て" },
      technique: {
        type: "string",
        enum: [...techniqueIds, UNKNOWN_TECHNIQUE],
        description: "最も近い手口の型のID。該当なしは unknown",
      },
      evidence: {
        type: "array",
        items: { type: "string" },
        description: "根拠となる文面上の特徴（最大5件・各60文字以内。断定せず『〜という特徴』の形で）",
      },
      actions: {
        type: "array",
        items: { type: "string", enum: [...ACTIONS] },
        description: "推奨行動の組み合わせ",
      },
    },
  };
}
