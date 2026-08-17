// 判定オーケストレーション: プロンプト構築 → LLM呼び出し → 検証・サニタイズ
// 純粋モジュール（Node/Workers共用）。ステートレス処理。入力文面・判定結果原文の保存・ログ出力はしない（CLAUDE.mdルール2）。

import type { JudgeImage, LlmClient } from "../llm/anthropic.ts";
import { buildJudgeSystemPrompt } from "../llm/prompts/judge_v1.ts";
import {
  ACTIONS, RISK_LEVELS, UNKNOWN_TECHNIQUE,
  buildJudgeOutputSchema, validateTechniques,
  type ActionId, type JudgeResult, type RiskLevel, type TechniqueDef,
} from "./schema.ts";
import { containsBannedAssertion } from "./templates.ts";

const MAX_EVIDENCE = 5;

export interface JudgeContext {
  client: LlmClient;
  techniques: TechniqueDef[];
  systemPrompt: string;
  outputSchema: Record<string, unknown>;
}

/** techniquesJson は techniques.json のパース済みオブジェクト（Nodeはfs読込、WorkersはJSON import） */
export function createJudgeContext(client: LlmClient, techniquesJson: unknown): JudgeContext {
  const techniques = validateTechniques(techniquesJson);
  return {
    client,
    techniques,
    systemPrompt: buildJudgeSystemPrompt(techniques),
    outputSchema: buildJudgeOutputSchema(techniques.map((t) => t.id)),
  };
}

export interface JudgeInput {
  text: string;
  image?: JudgeImage; // スクリーンショット判定用
}

/**
 * 文面（テキストまたはスクリーンショット画像）を判定する。返り値は検証・サニタイズ済みのJudgeResult。
 * LLM出力がスキーマから逸脱していた場合は例外（ダミー結果で補完しない）。
 */
export async function judgeText(ctx: JudgeContext, input: string | JudgeInput): Promise<JudgeResult> {
  const { text, image } = typeof input === "string" ? { text: input, image: undefined } : input;
  if (text.trim().length === 0 && !image) {
    throw new Error("入力文面が空です");
  }
  const raw = await ctx.client.judgeStructured({
    systemPrompt: ctx.systemPrompt,
    userText: text,
    image,
    outputSchema: ctx.outputSchema,
  });
  return validateAndSanitize(raw, ctx.techniques);
}

function validateAndSanitize(raw: unknown, techniques: TechniqueDef[]): JudgeResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("LLM出力がオブジェクトではありません");
  }
  const o = raw as Record<string, unknown>;

  const risk = o.risk;
  if (!RISK_LEVELS.includes(risk as RiskLevel)) {
    throw new Error(`LLM出力のriskが不正: ${JSON.stringify(risk)}`);
  }

  const validTechniqueIds = new Set([...techniques.map((t) => t.id), UNKNOWN_TECHNIQUE]);
  const technique = o.technique;
  if (typeof technique !== "string" || !validTechniqueIds.has(technique)) {
    throw new Error(`LLM出力のtechniqueが不正: ${JSON.stringify(technique)}`);
  }

  if (!Array.isArray(o.evidence)) {
    throw new Error("LLM出力のevidenceが配列ではありません");
  }
  // 断定表現を含むevidence項目は表示に出さない（構造的ガード）。件数上限もここで担保
  const evidence = o.evidence
    .filter((e): e is string => typeof e === "string")
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && !containsBannedAssertion(e))
    .slice(0, MAX_EVIDENCE);

  if (!Array.isArray(o.actions)) {
    throw new Error("LLM出力のactionsが配列ではありません");
  }
  const actions = [...new Set(o.actions.filter((a): a is ActionId => ACTIONS.includes(a as ActionId)))];
  if (actions.length === 0) {
    // 行動提示ゼロは許容しない（spec: 危険度表示の直下に必ず「次にすること」）。riskに応じた安全側の既定を入れる
    actions.push(risk === "low" ? "consult_9110" : "hang_up", "consult_9110");
  }

  return { risk: risk as RiskLevel, technique, evidence, actions: [...new Set(actions)] };
}

/** 手口IDから表示名を引く（UI・eval共用） */
export function techniqueLabel(techniques: TechniqueDef[], id: string): string {
  if (id === UNKNOWN_TECHNIQUE) return "判別できない型";
  return techniques.find((t) => t.id === id)?.name ?? "判別できない型";
}
