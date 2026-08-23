// S-01 ホーム（貼り付け画面）。説明・登録・チュートリアルなし、貼るまで0秒（spec デザイン原則3）
// リテラシーに応じた3つの入口を用意する:
//   電話 → えらぶだけの電話チェック（#/phone） / 紙・別端末 → カメラ撮影 / メール等 → 貼り付け・スクショ・音声入力
// 画像・文面ともサーバーに保存しない（CLAUDE.mdルール2）。

import { useEffect, useRef, useState } from "react";
import { getSampleJudgement, getStats, isForcedDemo, postJudge, type JudgeImagePayload } from "../api.ts";
import { isDictationSupported, startDictation, type DictationHandle } from "../speech.ts";
import { DemoBadge, Kamo, LoadingKamo } from "../components/common.tsx";
import type { JudgeResponse, StatsJson } from "../types.ts";

/** 送信前に画像を縮小してJPEG化する（長辺1568px。通信量とAPIコストを抑える） */
async function fileToJudgeImage(file: File): Promise<{ payload: JudgeImagePayload; previewUrl: string }> {
  const bitmap = await createImageBitmap(file);
  const MAX = 1568;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return {
    payload: { mediaType: "image/jpeg", dataBase64: dataUrl.split(",")[1] },
    previewUrl: dataUrl,
  };
}

export function Home({ onJudged }: { onJudged: (result: JudgeResponse, isDemoJudgement: boolean) => void }) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ payload: JudgeImagePayload; previewUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [stats, setStats] = useState<{ data: StatsJson; isDemo: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const dictation = useRef<DictationHandle | null>(null);

  useEffect(() => {
    // ヒーローカードの都合計は stats.json（警視庁D1「合計」行由来・verify-statsで検算済み）から取得。ハードコードしない
    getStats().then((s) => {
      setStats(s);
      if (import.meta.env.DEV) {
        console.info(`[hero] 都合計=${s.data.tokyoTotal.sagiCurrent} 期間=${s.data.tokyoTotal.currentPeriod} 出典=${s.data.sources.d1Current.name} isDemo=${s.isDemo}`);
      }
    });
    return () => dictation.current?.stop();
  }, []);

  const onFileSelected = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("画像ファイル（写真・スクリーンショット）を選んでください");
      return;
    }
    try {
      setImage(await fileToJudgeImage(f));
    } catch {
      setError("画像を読み込めませんでした。別の画像でお試しください");
    }
  };

  const clearImage = () => {
    setImage(null);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  };

  const toggleDictation = () => {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    setError(null);
    const handle = startDictation(
      (t) => setText((prev) => (prev ? prev + " " : "") + t),
      () => setListening(false),
      (msg) => { setError(msg); setListening(false); },
    );
    if (handle) {
      dictation.current = handle;
      setListening(true);
    }
  };

  const judge = async () => {
    dictation.current?.stop();
    setBusy(true);
    setError(null);
    try {
      const result = await postJudge(text, image?.payload);
      setText(""); // 判定後は入力を画面からも消す（保存しない）
      clearImage();
      onJudged(result, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "判定に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const canJudge = text.trim().length > 0 || image !== null;

  return (
    <div>
      <p className="first-copy">怪しいと思ったら、撮って送るだけ。<br />判定の根拠は、東京都の実データです。</p>

      {stats && (
        <a className="hero-card" href="#/map" aria-label="東京都の詐欺認知件数。タップでリスクマップへ">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="hero-lead">東京都で今年、詐欺の認知は</p>
            <p className="hero-number">
              {stats.data.tokyoTotal.sagiCurrent.toLocaleString()}<span className="hero-unit">件。</span>
            </p>
            <p className="source-note" style={{ margin: "2px 0 0" }}>
              {stats.data.tokyoTotal.currentPeriod ?? ""}・出典: {stats.data.sources.d1Current.provider}「区市町村の町丁別、罪種別及び手口別認知件数」
              {stats.isDemo && <> <DemoBadge show /></>}
            </p>
            <p className="hero-link">あなたの街は？ → マップを見る</p>
          </div>
          <Kamo pose="base" size={96} alt="サギカモのキャラクター" />
        </a>
      )}

      <a className="phone-entry" href="#/phone">
        <span className="phone-entry-title">📞 あやしい電話が来た方はこちら</span>
        <span className="phone-entry-sub">ボタンをえらぶだけでチェックできます<br />（文字入力は不要です）</span>
      </a>

      <div className="attach-block" style={{ marginTop: 0 }}>
        <span className="field-label">① 写真で判定</span>
        {!image ? (
          <>
            <button type="button" className="attach-button" onClick={() => cameraInput.current?.click()}>
              📷 カメラで撮って判定<br />（ハガキ・封筒・ほかの画面）
            </button>
            <button type="button" className="attach-button" onClick={() => fileInput.current?.click()}>
              🖼️ 保存ずみの写真・<br />スクリーンショットを選ぶ
            </button>
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              aria-label="カメラで撮影"
              onChange={(e) => onFileSelected(e.target.files?.[0])}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              aria-label="写真・スクリーンショットを選択"
              onChange={(e) => onFileSelected(e.target.files?.[0])}
            />
            <p className="source-note" style={{ margin: "6px 0 0" }}>
              届いたハガキや、べつの携帯電話の画面は「カメラで撮って判定」が便利です。
            </p>
          </>
        ) : (
          <div className="attach-preview">
            <img src={image.previewUrl} alt="添付した画像のプレビュー" />
            <button type="button" className="button-secondary" onClick={clearImage}>✕ 画像を取り消す</button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <label htmlFor="paste" className="field-label">② または、文面を貼り付ける か、話して伝える</label>
        <textarea
          id="paste"
          className="paste-area"
          placeholder={"メール・SMS・LINEなどの文面をここに貼り付けてください\n（文面を長押し→コピー→ここを長押し→ペースト）"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {isDictationSupported() ? (
          <button type="button" className={`mic-button${listening ? " listening" : ""}`} onClick={toggleDictation}>
            {listening ? "🔴 聞き取り中…（タップで停止）" : <>🎤 話して伝える<br />（電話で言われた内容など）</>}
          </button>
        ) : (
          <p className="source-note" style={{ margin: "6px 0 0" }}>
            🎤 声で入力するには: 上の入力欄をタップして、キーボードの<strong>マイクボタン</strong>を押して話してください。
          </p>
        )}
      </div>

      {busy && <LoadingKamo />}
      <button className="judge-button" onClick={judge} disabled={busy || !canJudge}>
        {busy ? "判定中…" : "判定する"}
      </button>

      {error && (
        <div className="error-box" role="alert" style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 8px" }}>{error}</p>
          <button
            className="button-secondary"
            onClick={() => onJudged(getSampleJudgement(), true)}
          >
            サンプル判定を見る（サンプルデータ）
          </button>
        </div>
      )}
      {isForcedDemo() && !error && (
        <p style={{ marginTop: 12 }}>
          <button className="button-secondary" onClick={() => onJudged(getSampleJudgement(), true)}>
            サンプル判定を見る（サンプルデータ）
          </button>
        </p>
      )}
      <p className="source-note" style={{ marginTop: 16 }}>
        貼り付けた文面・画像はその場で判定し、サーバーに保存しません。<br />文面内のURLへのアクセスも行いません。
      </p>
    </div>
  );
}
