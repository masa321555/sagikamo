// Phase L: LINE Messaging API 連携（Webhook受信 → 判定 → Flex Message返信）
// CLAUDE.md絶対ルールの適用:
// - 受信本文・userIdと本文の対応をサーバー・KV・D1・ログのいずれにも保存しない。返信後は破棄（ルール2）
// - 返信文言は templates.ts の定型文からのみ組み立てる（断定禁止の構造的担保、ルール1）
// - 件数は data/cache/stats.json の取得値のみ表示（ルール3）
// - 受信文面内のURLへはアクセスしない（ルール5。文字列として判定に渡すのみ）

import { ACTION_DISPLAY, LOW_RISK_NOTICE, RISK_DISPLAY } from "../src/lib/judge/templates.ts";
import type { ActionId, RiskLevel } from "../src/lib/judge/schema.ts";
import statsJson from "../data/cache/stats.json";

const LINE_API = "https://api.line.me/v2/bot";
const APP_URL = "https://sagikamo.sagikanchi.workers.dev";

// LINEユーザー1人あたりのレート制限（既存のIP制限と同水準）
const RL_USER_LIMIT = 6; // 6回/分
const RL_GLOBAL_LIMIT = 30; // 全体 30回/分（/api/judge と共通の global 枠）

export type JudgeImage = { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; dataBase64: string };

export interface LineDeps {
  /** 既存の判定パイプライン（workers/index.ts の judgeCtx を共用）。テキスト・画像とも対応 */
  judge: (input: { text: string; image?: JudgeImage }) => Promise<{
    risk: RiskLevel;
    techniqueLabel: string;
    evidence: string[];
    actions: ActionId[];
  }>;
  /** 既存の Durable Objects レート制限 */
  checkRateLimit: (name: string, limit: number) => Promise<boolean>;
}

interface ExecutionCtxLike {
  waitUntil(promise: Promise<unknown>): void;
}

// ---- LINE Webhook イベントの最小型定義 ----
interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; id?: string; text?: string };
}

// ---- 署名検証（X-Line-Signature = base64(HMAC-SHA256(channel secret, body)) ） ----
export async function verifyLineSignature(secret: string, bodyText: string, signatureB64: string): Promise<boolean> {
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // crypto.subtle.verify は一致比較を内部で行う（タイミング攻撃耐性はランタイム実装に委ねる）
  return crypto.subtle.verify("HMAC", key, sigBytes as unknown as ArrayBuffer, new TextEncoder().encode(bodyText));
}

/** userIdを生のまま扱わないためのハッシュ（レート制限キー用途のみ。保存はしない） */
async function hashedUserKey(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---- LINE API 呼び出し ----
async function lineApi(accessToken: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${LINE_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // 本文・userIdはログに出さない（ステータスのみ）
    console.error(`[line] ${path} failed: HTTP ${res.status}`);
  }
}

function replyMessages(accessToken: string, replyToken: string, messages: unknown[]): Promise<void> {
  return lineApi(accessToken, "/message/reply", { replyToken, messages });
}

function replyText(accessToken: string, replyToken: string, text: string): Promise<void> {
  return replyMessages(accessToken, replyToken, [{ type: "text", text }]);
}

/** 判定中のローディング表示（失敗しても判定は続行する） */
function showLoading(accessToken: string, chatId: string): Promise<void> {
  return lineApi(accessToken, "/chat/loading/start", { chatId, loadingSeconds: 20 }).catch(() => undefined);
}

// ---- 定型メッセージ（確定文言。断定表現なし） ----
// 友だち追加時の挨拶はLINE公式アカウントの「挨拶メッセージ」機能に一本化
// （プラットフォーム側から確実に届くため。Botはfollowイベントに応答しない）

const NON_TEXT_GUIDE = [
  "あやしい文面は、テキスト（コピーして貼り付け）か写真・スクリーンショットで送ってください。",
  `地域ごとのデータや手口図鑑はWebアプリでどうぞ → ${APP_URL}`,
].join("\n");

const IMAGE_FETCH_ERROR_TEXT = "画像を読み込めませんでした。もう一度送るか、文面をテキストで貼り付けて送ってください。";
const IMAGE_TOO_LARGE_TEXT = "画像が大きすぎて読み込めませんでした（5MBまで）。スクリーンショットなど小さめの画像でお試しください。";

const RATE_LIMIT_TEXT = "アクセスが集中しています。1分ほど待ってから、もう一度お試しください。";
const ERROR_TEXT = "判定サービスでエラーが発生しました。しばらくしてからもう一度お試しください。";
const TOO_LONG_TEXT = "文面が長すぎます（8000文字まで）。あやしい部分を中心に送ってください。";

// ---- Flex Message（危険度・手口の型・都全体件数＋出典・次の行動 の既存4点セット） ----
const RISK_COLORS: Record<RiskLevel, { bg: string; text: string }> = {
  high: { bg: "#FDF3E0", text: "#7A4E00" }, // アンバー（赤の恐怖演出は使わない）
  caution: { bg: "#FDF8EC", text: "#7A4E00" },
  low: { bg: "#EEF2F6", text: "#1F3A5F" },
};
const NAVY = "#1F3A5F";
const GRAY = "#52606D";

export function buildJudgeFlex(result: {
  risk: RiskLevel;
  techniqueLabel: string;
  evidence: string[];
  actions: ActionId[];
}): unknown {
  const riskInfo = RISK_DISPLAY[result.risk];
  const colors = RISK_COLORS[result.risk];
  const stats = statsJson as unknown as {
    tokyoTotal: { sagiCurrent: number; currentPeriod: string };
    sources: { d1Current: { provider: string } };
  };

  const body: unknown[] = [];

  // 1) 危険度＋見立ての説明
  if (riskInfo.headline) {
    body.push({ type: "text", text: riskInfo.headline, wrap: true, size: "md", color: NAVY, weight: "bold" });
  }
  if (result.risk === "low") {
    // 低リスク時は定型注意文を必ず表示（CLAUDE.mdルール1）
    body.push({ type: "text", text: LOW_RISK_NOTICE, wrap: true, size: "md", color: NAVY, weight: "bold" });
  }

  // 2) 手口の型＋気になる特徴（低リスク時は型を出さない: Web版と同じ挙動）
  if (result.risk !== "low") {
    body.push({ type: "separator", margin: "lg" });
    body.push({
      type: "text",
      text: `${result.techniqueLabel}の型に近い特徴`,
      wrap: true,
      size: "md",
      weight: "bold",
      color: NAVY,
      margin: "lg",
    });
    for (const e of result.evidence.slice(0, 3)) {
      body.push({ type: "text", text: `・${e}`, wrap: true, size: "sm", color: GRAY, margin: "sm" });
    }
  }

  // 3) 都全体の当年件数＋出典（実データのみ。ルール3）
  body.push({ type: "separator", margin: "lg" });
  body.push({
    type: "text",
    text: `東京都全体で${stats.tokyoTotal.currentPeriod}、詐欺（刑法犯）${stats.tokyoTotal.sagiCurrent.toLocaleString("ja-JP")}件`,
    wrap: true,
    size: "sm",
    color: NAVY,
    weight: "bold",
    margin: "lg",
  });
  body.push({
    type: "text",
    text: `出典: ${stats.sources.d1Current.provider}「区市町村の町丁別、罪種別及び手口別認知件数」`,
    wrap: true,
    size: "xs",
    color: GRAY,
    margin: "sm",
  });

  // 4) 次にすること
  body.push({ type: "separator", margin: "lg" });
  body.push({ type: "text", text: "次にすること", size: "md", weight: "bold", color: NAVY, margin: "lg" });
  for (const a of result.actions) {
    const d = ACTION_DISPLAY[a];
    body.push({ type: "text", text: d.label, wrap: true, size: "sm", weight: "bold", color: NAVY, margin: "md" });
    body.push({ type: "text", text: d.description, wrap: true, size: "xs", color: GRAY, margin: "xs" });
  }

  return {
    type: "flex",
    altText: `判定結果: ${riskInfo.label}（AIの見立て）`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: colors.bg,
        paddingAll: "16px",
        contents: [
          { type: "text", text: `判定は「${riskInfo.label}」です`, weight: "bold", size: "lg", color: colors.text },
          { type: "text", text: "AIによる見立てであり、断定ではありません", size: "xs", color: colors.text, margin: "sm" },
        ],
      },
      body: { type: "box", layout: "vertical", paddingAll: "16px", contents: body },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "uri", label: "地域のデータ・手口図鑑を見る", uri: APP_URL },
          },
          {
            type: "text",
            text: "送られた文面は判定後に破棄され、保存されません。",
            size: "xxs",
            color: GRAY,
            wrap: true,
            align: "center",
          },
        ],
      },
    },
  };
}

// ---- 画像メッセージの取得（LINEコンテンツAPI） ----
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB（Webアプリの /api/judge と同水準）

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** 受信画像をメモリ上に取得してbase64化する。保存はせず、判定後に破棄される（CLAUDE.mdルール2） */
async function fetchMessageImage(
  accessToken: string,
  messageId: string,
): Promise<{ ok: true; image: JudgeImage } | { ok: false; reason: "fetch" | "too_large" }> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error(`[line] content fetch failed: HTTP ${res.status}`);
    return { ok: false, reason: "fetch" };
  }
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const mediaType = ALLOWED_IMAGE_TYPES.find((t) => t === contentType);
  if (!mediaType) return { ok: false, reason: "fetch" };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, image: { mediaType, dataBase64: bytesToBase64(buf) } };
}

// ---- イベント処理本体 ----
async function processEvent(event: LineEvent, accessToken: string, deps: LineDeps): Promise<void> {
  const replyToken = event.replyToken;
  if (!replyToken) return;

  if (event.type !== "message" || !event.message) return;

  const isText = event.message.type === "text" && typeof event.message.text === "string";
  const isImage = event.message.type === "image" && typeof event.message.id === "string";
  if (!isText && !isImage) {
    await replyText(accessToken, replyToken, NON_TEXT_GUIDE);
    return;
  }
  const text = isText ? (event.message.text as string) : "";
  if (isText && text.trim().length === 0) return;
  if (text.length > 8000) {
    await replyText(accessToken, replyToken, TOO_LONG_TEXT);
    return;
  }

  // レート制限（ユーザー単位はハッシュ化キー。globalは/api/judgeと共通枠）
  const userId = event.source?.userId;
  const userKey = userId ? `line:${await hashedUserKey(userId)}` : "line:anonymous";
  const [userOk, globalOk] = await Promise.all([
    deps.checkRateLimit(userKey, RL_USER_LIMIT),
    deps.checkRateLimit("global", RL_GLOBAL_LIMIT),
  ]);
  if (!userOk || !globalOk) {
    await replyText(accessToken, replyToken, RATE_LIMIT_TEXT);
    return;
  }

  if (userId) await showLoading(accessToken, userId);

  // 画像はLINEコンテンツAPIから取得（メモリ上のみ。返信後に破棄）
  let image: JudgeImage | undefined;
  if (isImage) {
    const fetched = await fetchMessageImage(accessToken, event.message.id as string);
    if (!fetched.ok) {
      await replyText(accessToken, replyToken, fetched.reason === "too_large" ? IMAGE_TOO_LARGE_TEXT : IMAGE_FETCH_ERROR_TEXT);
      return;
    }
    image = fetched.image;
  }

  try {
    const result = await deps.judge({ text, image });
    await replyMessages(accessToken, replyToken, [buildJudgeFlex(result)]);
  } catch (e) {
    // 受信本文がエラーメッセージ経由で漏れないよう定型文のみ（ログも同様）
    const msg = e instanceof Error ? e.message : "";
    console.error(`[line] judge error: ${msg.slice(0, 200)}`);
    await replyText(accessToken, replyToken, ERROR_TEXT);
  }
}

/** Webhookエントリポイント。署名検証後は即200を返し、判定・返信は waitUntil で非同期処理する */
export async function handleLineWebhook(
  request: Request,
  env: { LINE_CHANNEL_SECRET?: string; LINE_CHANNEL_ACCESS_TOKEN?: string },
  ctx: ExecutionCtxLike,
  deps: LineDeps,
): Promise<Response> {
  const secret = env.LINE_CHANNEL_SECRET;
  const accessToken = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!secret || !accessToken) {
    return new Response(JSON.stringify({ error: "LINE連携が設定されていません" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const bodyText = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!signature || !(await verifyLineSignature(secret, bodyText, signature))) {
    return new Response(JSON.stringify({ error: "signature validation failed" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  let events: LineEvent[] = [];
  try {
    const parsed = JSON.parse(bodyText) as { events?: LineEvent[] };
    events = Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    events = [];
  }

  // LINEのWebhookタイムアウト・再送を避けるため即200。判定と返信はバックグラウンドで行う
  ctx.waitUntil(Promise.allSettled(events.map((ev) => processEvent(ev, accessToken, deps))));
  return new Response("ok", { status: 200 });
}
