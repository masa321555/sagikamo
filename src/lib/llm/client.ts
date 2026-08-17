// C-1: LLMクライアント生成（Node開発環境用ラッパー）。
// プロバイダ実装本体は anthropic.ts（純粋モジュール）にあり、Cloudflare Workersからはそちらを直接使う。
// 開発時は Anthropic API、本番はハッカソン提供のOpenCode LLMに差し替える（CLAUDE.md プロジェクト前提）。

import fs from "node:fs";
import path from "node:path";
import { AnthropicLlmClient, type LlmClient } from "./anthropic.ts";

export type { JudgeImage, JudgeLlmRequest, LlmClient } from "./anthropic.ts";

/** .dev.vars（wrangler形式 KEY=VALUE）を読み込みprocess.envへ反映する。値はログに出さない */
export function loadDevVars(): void {
  const p = path.join(process.cwd(), ".dev.vars");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const [, key, rawValue] = m;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

/** 本番（OpenCode提供LLM）用の差し替え口。提供仕様の確定後に実装する */
class OpencodeLlmClient implements LlmClient {
  readonly providerName = "opencode";
  judgeStructured(): Promise<unknown> {
    throw new Error("OpenCode LLMクライアントは未実装です。LLM_PROVIDER=anthropic を使用してください。");
  }
}

export function createLlmClient(): LlmClient {
  loadDevVars();
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  switch (provider) {
    case "anthropic":
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          "ANTHROPIC_API_KEY が設定されていません。.dev.vars に ANTHROPIC_API_KEY=... を設定してください（Phase 0の人間タスク）。",
        );
      }
      return new AnthropicLlmClient({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.LLM_MODEL,
        effort: process.env.LLM_EFFORT as "low" | "medium" | "high" | undefined,
      });
    case "opencode":
      return new OpencodeLlmClient();
    default:
      throw new Error(`未知のLLM_PROVIDER: ${provider}`);
  }
}
