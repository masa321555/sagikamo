// Cloudflare Worker: 静的アセット配信 ＋ 判定プロキシAPI（Phase E）
// 開発サーバー（src/server/dev_api.ts）と同一のエンドポイント仕様:
//   POST /api/judge, GET /api/stats, GET /api/contacts, GET /api/techniques
// 判定はステートレス。入力文面・画像をログ・ストレージに書かない（CLAUDE.mdルール2）。

import { AnthropicLlmClient } from "../src/lib/llm/anthropic.ts";
import { createJudgeContext, judgeText, techniqueLabel, type JudgeContext } from "../src/lib/judge/judge.ts";
import techniquesJson from "../data/config/techniques.json";
import statsJson from "../data/cache/stats.json";
import contactsJson from "../data/cache/contacts.json";
import townsJson from "../data/cache/towns.json";

interface Env {
  ANTHROPIC_API_KEY: string; // wrangler secret
  LLM_MODEL?: string;
  LLM_EFFORT?: "low" | "medium" | "high";
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

let judgeCtx: JudgeContext | null = null;

async function handleJudge(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { text?: unknown; image?: { mediaType?: unknown; dataBase64?: unknown } }
    | null;
  if (!body) return json(400, { error: "リクエスト形式が不正です" });

  const text = typeof body.text === "string" ? body.text : "";
  if (text.length > 8000) {
    return json(400, { error: "文面が長すぎます（8000文字まで）" });
  }
  const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
  let image: { mediaType: (typeof ALLOWED_MEDIA)[number]; dataBase64: string } | undefined;
  if (body.image) {
    const { mediaType, dataBase64 } = body.image;
    if (
      typeof mediaType !== "string" ||
      !ALLOWED_MEDIA.includes(mediaType as (typeof ALLOWED_MEDIA)[number]) ||
      typeof dataBase64 !== "string" ||
      !/^[A-Za-z0-9+/=]+$/.test(dataBase64)
    ) {
      return json(400, { error: "画像の形式が不正です（JPEG/PNG/WebP/GIFに対応）" });
    }
    if (dataBase64.length > 7_000_000) {
      return json(400, { error: "画像が大きすぎます（5MBまで）" });
    }
    image = { mediaType: mediaType as (typeof ALLOWED_MEDIA)[number], dataBase64 };
  }
  if (text.trim().length === 0 && !image) {
    return json(400, { error: "文面または画像を入力してください" });
  }

  if (!judgeCtx) {
    judgeCtx = createJudgeContext(
      new AnthropicLlmClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL, effort: env.LLM_EFFORT }),
      techniquesJson,
    );
  }
  const result = await judgeText(judgeCtx, { text, image });
  return json(200, { ...result, techniqueLabel: techniqueLabel(judgeCtx.techniques, result.technique) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        if (url.pathname === "/api/stats" && request.method === "GET") return json(200, statsJson);
        if (url.pathname === "/api/contacts" && request.method === "GET") return json(200, contactsJson);
        if (url.pathname === "/api/towns" && request.method === "GET") return json(200, townsJson);
        if (url.pathname === "/api/techniques" && request.method === "GET") return json(200, techniquesJson);
        if (url.pathname === "/api/judge" && request.method === "POST") return await handleJudge(request, env);
        return json(404, { error: "not found" });
      } catch (e) {
        // 入力文面がエラーメッセージ経由で漏れないよう定型文のみ返す
        const msg = e instanceof Error ? e.message : "";
        console.error(`[api] ${request.method} ${url.pathname} error: ${msg.slice(0, 200)}`);
        return json(500, { error: "判定サービスでエラーが発生しました。しばらくしてからもう一度お試しください。" });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
