// まもるカード（F-04）: 家族向け共有画像をCanvasで生成する。
// やさしい日本語・大きな文字（spec）。断定表現は使わない（内容は定型文＋判定結果の特徴のみ）。
// 画像はブラウザ内で生成し、サーバーへ送信しない。

import { kamoAssetUrl } from "./components/common.tsx";

export interface MamoruCardParams {
  addressee?: string | null; // 宛名（例: おかあさんへ）。画像にのみ描画し、保存しない
  riskLabel: string | null; // 例: 要注意（図鑑からの生成時はnull）
  title: string; // 例: 還付金詐欺
  headline: string; // 例: こんな電話に気をつけて
  lines: string[]; // 特徴・フレーズ（最大3件表示）
  actionText: string; // 最初にすること
  regionLine: string | null; // 例: 世田谷区では今年302件（任意）
  sourceLine: string; // 出典表示
}

const W = 1080;
const NAVY = "#1f3a5f";
const AMBER_BG = "#fdf3e0";
const AMBER_BORDER = "#e6a23c";
const AMBER_TEXT = "#7a4e00";
const GREEN_BG = "#eef6ea";
const GREEN_DARK = "#3f6b31";

/** 同一オリジンの画像を読み込む（失敗時はnull。カードはキャラなしで生成を続ける） */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** まもるカード画像を生成してBlob(PNG)とプレビュー用DataURLを返す */
export async function generateMamoruCard(p: MamoruCardParams): Promise<{ blob: Blob; dataUrl: string }> {
  const canvas = document.createElement("canvas");
  const ctx0 = canvas.getContext("2d");
  if (!ctx0) throw new Error("画像を作成できませんでした");
  const ctx = ctx0;

  const font = (size: number, bold = true) =>
    `${bold ? "bold " : ""}${size}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif`;

  // ---- レイアウト計算のため先に高さを見積もる（テキスト折返し分） ----
  canvas.width = W;
  canvas.height = 100; // 仮
  const PAD = 56;
  const CONTENT_W = W - PAD * 2;

  ctx.font = font(44, false);
  const bodyLines = p.lines.slice(0, 3).flatMap((l) => wrapText(ctx, "・" + l, CONTENT_W - 20));
  ctx.font = font(42);
  const actionLines = wrapText(ctx, p.actionText, CONTENT_W - 60);
  ctx.font = font(40);
  const regionLines = p.regionLine ? wrapText(ctx, p.regionLine, CONTENT_W - 20) : [];

  const kamo = await loadImage(kamoAssetUrl("card", "png"));
  const addressee = (p.addressee ?? "").trim();
  const kamoH = 150; // キャラクター＋宛名の白い帯（ヘッダーの紺の上には置かない）
  const stripH = kamo || addressee ? kamoH + 30 : 0;

  const headerH = 130;
  const riskH = 150;
  const headlineH = 90;
  const bodyH = bodyLines.length * 64 + 20;
  const regionH = regionLines.length > 0 ? regionLines.length * 58 + 30 : 0;
  const actionH = actionLines.length * 60 + 110;
  const footerH = 110;
  const H = headerH + stripH + riskH + headlineH + bodyH + regionH + actionH + footerH + 60;

  canvas.height = H;

  // ---- 背景 ----
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // ---- ヘッダー ----
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, headerH);
  ctx.fillStyle = "#ffffff";
  ctx.font = font(56);
  ctx.fillText("💌 まもるカード", PAD, 84);
  ctx.font = font(34, false);
  ctx.textAlign = "right";
  ctx.fillText("サギカモ", W - PAD, 84);
  ctx.textAlign = "left";

  // ---- キャラクター＋宛名（白背景の帯） ----
  let y = headerH + 20;
  if (stripH > 0) {
    let textX = PAD;
    if (kamo) {
      const kw = Math.round((kamo.width / kamo.height) * kamoH);
      ctx.drawImage(kamo, PAD, y, kw, kamoH);
      textX = PAD + kw + 28;
    }
    if (addressee) {
      ctx.fillStyle = NAVY;
      ctx.font = font(56);
      ctx.fillText(addressee, textX, y + 95);
    }
    y += stripH;
  }
  y += 20;

  // ---- 危険度＋手口名（アンバー枠） ----
  ctx.fillStyle = AMBER_BG;
  ctx.strokeStyle = AMBER_BORDER;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(PAD - 16, y - 10, CONTENT_W + 32, riskH - 30, 20);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = AMBER_TEXT;
  ctx.font = font(60);
  const riskTitle = p.riskLabel ? `⚠️ ${p.riskLabel}: ${p.title}` : `⚠️ ${p.title}`;
  ctx.font = ctx.measureText(riskTitle).width > CONTENT_W ? font(48) : font(60);
  ctx.fillText(riskTitle, PAD + 8, y + 70);
  y += riskH + 10;

  // ---- 見出し ----
  ctx.fillStyle = NAVY;
  ctx.font = font(46);
  ctx.fillText(p.headline, PAD, y + 40);
  y += headlineH;

  // ---- 特徴・フレーズ ----
  ctx.fillStyle = "#22303f";
  ctx.font = font(44, false);
  for (const line of bodyLines) {
    ctx.fillText(line, PAD + 10, y + 40);
    y += 64;
  }
  y += 20;

  // ---- 地域件数（任意・実データ） ----
  if (regionLines.length > 0) {
    ctx.fillStyle = NAVY;
    ctx.font = font(40);
    for (const line of regionLines) {
      ctx.fillText(line, PAD, y + 36);
      y += 58;
    }
    y += 30;
  }

  // ---- 最初にすること（グリーン枠） ----
  ctx.fillStyle = GREEN_BG;
  ctx.beginPath();
  ctx.roundRect(PAD - 16, y, CONTENT_W + 32, actionLines.length * 60 + 90, 20);
  ctx.fill();
  ctx.fillStyle = GREEN_DARK;
  ctx.font = font(40);
  ctx.fillText("✅ こまったら", PAD + 8, y + 56);
  ctx.font = font(42);
  let ay = y + 116;
  for (const line of actionLines) {
    ctx.fillText(line, PAD + 8, ay);
    ay += 60;
  }
  y += actionLines.length * 60 + 110;

  // ---- フッター（出典） ----
  ctx.fillStyle = "#52606d";
  ctx.font = font(28, false);
  const srcLines = wrapText(ctx, p.sourceLine, CONTENT_W);
  let fy = H - footerH + 20;
  for (const line of srcLines.slice(0, 2)) {
    ctx.fillText(line, PAD, fy);
    fy += 38;
  }

  const dataUrl = canvas.toDataURL("image/png");
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像の生成に失敗しました"))), "image/png");
  });
  return { blob, dataUrl };
}

/** 共有（Web Share API）。使えない環境ではダウンロードにフォールバック */
export async function shareMamoruCard(blob: Blob): Promise<"shared" | "downloaded"> {
  const file = new File([blob], "mamoru-card.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "まもるカード（サギカモ）" });
      return "shared";
    } catch {
      // ユーザーキャンセル等 → ダウンロードにフォールバックせずそのまま返す
      return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mamoru-card.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}
