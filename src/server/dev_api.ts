// 開発用APIミドルウェア（Viteプラグイン）。
// 本番ではCloudflare Workersが同一のエンドポイント（/api/judge, /api/stats, /api/contacts, /api/techniques）を提供する（Phase E）。
// 注意: 判定はステートレス。入力文面をログ・ファイル・レスポンス以外へ出さない（CLAUDE.mdルール2）。

import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createLlmClient } from "../lib/llm/client.ts";
import { createJudgeContext, judgeText, techniqueLabel, type JudgeContext } from "../lib/judge/judge.ts";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function serveCachedJson(res: ServerResponse, relPath: string): void {
  const p = path.join(process.cwd(), relPath);
  if (!fs.existsSync(p)) {
    sendJson(res, 503, { error: `${relPath} がありません。npm run fetch-opendata && npm run build-stats を実行してください。` });
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(fs.readFileSync(p, "utf-8"));
}

export function devApiPlugin(): Plugin {
  let judgeCtx: JudgeContext | null = null;

  return {
    name: "sagikanchi-dev-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          const url = req.url ?? "";
          if (!url.startsWith("/api/")) return next();

          try {
            if (url === "/api/stats" && req.method === "GET") {
              return serveCachedJson(res, "data/cache/stats.json");
            }
            if (url === "/api/contacts" && req.method === "GET") {
              return serveCachedJson(res, "data/cache/contacts.json");
            }
            if (url === "/api/towns" && req.method === "GET") {
              return serveCachedJson(res, "data/cache/towns.json");
            }
            if (url === "/api/techniques" && req.method === "GET") {
              return serveCachedJson(res, "data/config/techniques.json");
            }
            if (url === "/api/judge" && req.method === "POST") {
              const body = JSON.parse(await readBody(req)) as {
                text?: unknown;
                image?: { mediaType?: unknown; dataBase64?: unknown };
              };
              const text = typeof body.text === "string" ? body.text : "";
              if (text.length > 8000) {
                return sendJson(res, 400, { error: "文面が長すぎます（8000文字まで）" });
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
                  return sendJson(res, 400, { error: "画像の形式が不正です（JPEG/PNG/WebP/GIFに対応）" });
                }
                if (dataBase64.length > 7_000_000) {
                  return sendJson(res, 400, { error: "画像が大きすぎます（5MBまで）" });
                }
                image = { mediaType: mediaType as (typeof ALLOWED_MEDIA)[number], dataBase64 };
              }
              if (text.trim().length === 0 && !image) {
                return sendJson(res, 400, { error: "文面または画像を入力してください" });
              }
              if (!judgeCtx) {
                const techniquesJson = JSON.parse(
                  fs.readFileSync(path.join(process.cwd(), "data", "config", "techniques.json"), "utf-8"),
                ) as unknown;
                judgeCtx = createJudgeContext(createLlmClient(), techniquesJson);
              }
              const result = await judgeText(judgeCtx, { text, image });
              return sendJson(res, 200, {
                ...result,
                techniqueLabel: techniqueLabel(judgeCtx.techniques, result.technique),
              });
            }
            return sendJson(res, 404, { error: "not found" });
          } catch (e) {
            // エラーメッセージに入力文面が含まれないよう定型文のみ返す
            const msg = e instanceof Error ? e.message : "判定に失敗しました";
            const safe = msg.includes("ANTHROPIC_API_KEY") ? msg : "判定サービスでエラーが発生しました。しばらくしてからもう一度お試しください。";
            console.error(`[dev-api] ${req.method} ${url} でエラー（詳細はマスク）: ${safe}`);
            return sendJson(res, 500, { error: safe });
          }
        })();
      });
    },
  };
}
