// Anthropic LLMプロバイダ（純粋モジュール: Node/Cloudflare Workers共用。Node専用APIを使わない）
// 注意: 入力文面・レスポンス原文をログに出さない（CLAUDE.mdルール2）。

import Anthropic from "@anthropic-ai/sdk";

export interface JudgeImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  dataBase64: string; // 保存・ログ出力禁止
}

export interface JudgeLlmRequest {
  systemPrompt: string;
  userText: string; // 判定対象の文面（保存・ログ出力禁止）
  image?: JudgeImage; // スクリーンショット判定用（保存・ログ出力禁止）
  outputSchema: Record<string, unknown>;
}

export interface LlmClient {
  readonly providerName: string;
  /** 構造化出力でJSONオブジェクトを返す。パース済み・スキーマ準拠は呼び出し側で検証する */
  judgeStructured(req: JudgeLlmRequest): Promise<unknown>;
}

export const DEFAULT_MODEL = "claude-opus-5";

export interface AnthropicClientOptions {
  apiKey: string;
  model?: string;
  effort?: "low" | "medium" | "high";
}

export class AnthropicLlmClient implements LlmClient {
  readonly providerName = "anthropic";
  private client: Anthropic;
  private model: string;
  private effort: "low" | "medium" | "high";

  constructor(opts: AnthropicClientOptions) {
    if (!opts.apiKey) {
      throw new Error("ANTHROPIC_API_KEY が設定されていません。");
    }
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
    // 判定は貼り付け→表示10秒以内が目標（spec 3章）のため既定はlow。精度検証時に引き上げ可
    this.effort = opts.effort ?? "low";
  }

  async judgeStructured(req: JudgeLlmRequest): Promise<unknown> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (req.image) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: req.image.mediaType, data: req.image.dataBase64 },
      });
    }
    content.push({
      type: "text",
      text: req.userText.trim().length > 0 ? req.userText : "添付画像に写っている文面を読み取って判定してください。",
    });
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: req.systemPrompt,
      output_config: {
        effort: this.effort,
        format: { type: "json_schema", schema: req.outputSchema },
      },
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") {
      throw new Error("LLMが判定を拒否しました（safety refusal）");
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error(`LLMレスポンスにテキストがありません（stop_reason=${response.stop_reason}）`);
    }
    return JSON.parse(textBlock.text);
  }
}
