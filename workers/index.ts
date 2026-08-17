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

// Durable Objects の最小型定義（@cloudflare/workers-types非依存）
interface DOStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}
interface DOState {
  storage: DOStorage;
}
interface DONamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string): Promise<Response> };
}

interface Env {
  ANTHROPIC_API_KEY: string; // wrangler secret
  LLM_MODEL?: string;
  LLM_EFFORT?: "low" | "medium" | "high";
  ASSETS: { fetch(request: Request): Promise<Response> };
  RL_DO?: DONamespace; // レート制限カウンタ
}

/** レート制限カウンタ（Durable Object）。1分窓のリクエスト数を正確に数える */
export class JudgeRateLimiter {
  private state: DOState;
  constructor(state: DOState) {
    this.state = state;
  }
  async fetch(request: Request): Promise<Response> {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "0");
    const window = Math.floor(Date.now() / 60_000);
    const key = `w:${window}`;
    const count = ((await this.state.storage.get<number>(key)) ?? 0) + 1;
    await this.state.storage.put(key, count);
    await this.state.storage.delete(`w:${window - 1}`); // 前の窓は掃除
    return new Response(JSON.stringify({ success: count <= limit }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

const RL_IP_LIMIT = 6; // IPあたり 6回/分
const RL_GLOBAL_LIMIT = 30; // 全体 30回/分（クレジット消費の上限）

async function checkRateLimit(env: Env, name: string, limit: number): Promise<boolean> {
  if (!env.RL_DO) return true;
  const stub = env.RL_DO.get(env.RL_DO.idFromName(name));
  const res = await stub.fetch(`https://rl/?limit=${limit}`);
  const body = (await res.json()) as { success: boolean };
  return body.success;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

let judgeCtx: JudgeContext | null = null;

async function handleJudge(request: Request, env: Env): Promise<Response> {
  // レート制限（本文の検証より先に実施し、不正リクエストの連打も遮断する）
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const [ipOk, globalOk] = await Promise.all([
    checkRateLimit(env, `ip:${ip}`, RL_IP_LIMIT),
    checkRateLimit(env, "global", RL_GLOBAL_LIMIT),
  ]);
  if (!ipOk || !globalOk) {
    return json(429, { error: "アクセスが集中しています。1分ほど待ってから、もう一度お試しください。" });
  }

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
