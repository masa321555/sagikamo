// S-02 判定結果。上から: 危険度 → 手口の型 → 根拠 → 地域件数（D1実データ・出典付き）→ 推奨行動 → あなたの街を見る
// LLMの見立て（グレー系 ai-block）と実データ（ネイビー data-block）を視覚的に区別する（spec デザイン原則1）

import { useEffect, useState } from "react";
import { getStats, getTechniques } from "../api.ts";
import { getRegion, setRegion, SLOT_LABELS, type RegionSlot } from "../region.ts";
import { ActionList, DemoBadge, RiskBanner, SourceNote } from "../components/common.tsx";
import { ACTION_DISPLAY, LOW_RISK_NOTICE, RISK_DISPLAY } from "../../lib/judge/templates.ts";
import { isSpeakSupported, speak, stopSpeaking } from "../speech.ts";
import { generateMamoruCard, shareMamoruCard } from "../mamoru.ts";
import type { JudgeResponse, StatsJson } from "../types.ts";

/** 読み上げ用テキストを定型文から組み立てる（表示と同じ内容のみ。断定表現なし） */
function buildSpeechText(result: JudgeResponse): string {
  const parts: string[] = [];
  parts.push(`判定は、${RISK_DISPLAY[result.risk].label}です。`);
  if (RISK_DISPLAY[result.risk].headline) parts.push(RISK_DISPLAY[result.risk].headline);
  if (result.risk === "low") parts.push(LOW_RISK_NOTICE);
  if (result.risk !== "low") {
    parts.push(`近い手口の型は、${result.techniqueLabel}です。`);
    if (result.evidence.length > 0) {
      parts.push("気になる特徴。" + result.evidence.join("。"));
    }
  }
  parts.push("次にすること。");
  for (const a of result.actions) {
    parts.push(`${ACTION_DISPLAY[a].label}。${ACTION_DISPLAY[a].description}`);
  }
  return parts.join(" ");
}

export function Result({ result, isDemoJudgement }: { result: JudgeResponse; isDemoJudgement: boolean }) {
  const [stats, setStats] = useState<{ data: StatsJson; isDemo: boolean } | null>(null);
  const [slot, setSlot] = useState<RegionSlot>("home");
  const [statsError, setStatsError] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [card, setCard] = useState<{ dataUrl: string; blob: Blob } | null>(null);
  const [cardBusy, setCardBusy] = useState(false);

  useEffect(() => {
    getStats().then(setStats).catch(() => setStatsError(true));
    return () => stopSpeaking(); // 画面を離れたら読み上げ停止
  }, []);

  const toggleSpeak = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
    } else {
      setSpeaking(true);
      speak(buildSpeechText(result), () => setSpeaking(false));
    }
  };

  const selectedCode = getRegion(slot);
  const muni = stats?.data.municipalities.find((m) => m.code === selectedCode) ?? null;

  return (
    <div>
      {isDemoJudgement && (
        <p style={{ marginBottom: 8 }}>
          <DemoBadge show /> <span className="source-note">これはLLM判定の代わりに表示しているサンプル判定です。</span>
        </p>
      )}
      <RiskBanner risk={result.risk} />

      {isSpeakSupported() && (
        <p style={{ margin: "0 0 12px" }}>
          <button type="button" className="button-secondary" onClick={toggleSpeak}>
            {speaking ? "⏹ 読み上げを止める" : "🔊 結果を読み上げる"}
          </button>
        </p>
      )}

      {result.risk !== "low" && (
        <div className="card ai-block">
          <h2 className="section-title" style={{ marginTop: 0 }}>近い型（AIの見立て）</h2>
          <p style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>{result.techniqueLabel}</p>
          {result.evidence.length > 0 && (
            <>
              <h3 className="section-title">気になる特徴</h3>
              <ul className="evidence-list">
                {result.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="card data-block">
        <h2 className="section-title" style={{ marginTop: 0 }}>あなたの街の実データ</h2>
        <div style={{ marginBottom: 8 }}>
          <label className="field-label" htmlFor="region-slot">表示する地域</label>
          <select id="region-slot" className="region-select" value={slot} onChange={(e) => setSlot(e.target.value as RegionSlot)}>
            <option value="home">{SLOT_LABELS.home}</option>
            <option value="jikka">{SLOT_LABELS.jikka}</option>
          </select>{" "}
          <select
            className="region-select"
            aria-label="区市町村を選択"
            value={selectedCode ?? ""}
            onChange={(e) => {
              setRegion(slot, e.target.value ? Number(e.target.value) : null);
              setStats(stats ? { ...stats } : stats); // 再描画
            }}
          >
            <option value="">未選択（都全体を表示）</option>
            {stats?.data.municipalities.map((m) => (
              <option key={m.code} value={m.code}>{m.name}</option>
            ))}
          </select>
        </div>

        {statsError && <p className="error-box">統計データを取得できませんでした（データ取得中/取得不可）。</p>}
        {!stats && !statsError && <p className="loading">統計データを読み込み中…</p>}
        {stats && (
          <>
            {muni ? (
              <p style={{ margin: 0 }}>
                {muni.name}では{stats.data.tokyoTotal.currentPeriod ?? "今年"}で、詐欺（刑法犯）が
                <span className="data-number"> {muni.sagiCurrent.toLocaleString()} </span>件認知されています
                （前年{stats.data.tokyoTotal.prevYearPeriod ?? ""}: {muni.sagiPrevYear.toLocaleString()}件）。
              </p>
            ) : (
              <p style={{ margin: 0 }}>
                東京都全体では{stats.data.tokyoTotal.currentPeriod ?? "今年"}で、詐欺（刑法犯）が
                <span className="data-number"> {stats.data.tokyoTotal.sagiCurrent.toLocaleString()} </span>件認知されています
                （前年: {stats.data.tokyoTotal.sagiPrevYear.toLocaleString()}件）。
              </p>
            )}
            <p className="source-note">※手口別の地域内訳は公開データにないため、詐欺全体の認知件数を表示しています。</p>
            <SourceNote source={stats.data.sources.d1Current} isDemo={stats.isDemo} />
          </>
        )}
      </div>

      <ActionList actions={result.actions} />

      {result.risk !== "low" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>💌 家族に知らせる（まもるカード）</h2>
          <p className="source-note" style={{ marginTop: 0 }}>
            この判定結果を、やさしい言葉の1枚の画像にします。LINEなどでご家族に送って注意を伝えられます。
          </p>
          {!card ? (
            <button
              className="button-secondary"
              disabled={cardBusy}
              onClick={() => {
                void (async () => {
                  setCardBusy(true);
                  try {
                    const tech = getTechniques().techniques.find((t) => t.id === result.technique);
                    const muniData = muni;
                    const period = stats?.data.tokyoTotal.currentPeriod ?? "今年";
                    const generated = await generateMamoruCard({
                      riskLabel: RISK_DISPLAY[result.risk].label,
                      title: result.techniqueLabel,
                      headline: "こんな連絡に気をつけて",
                      lines: result.evidence.slice(0, 3),
                      actionText: tech?.first_action ?? "一度電話を切って、#9110（警察相談専用電話）に相談しましょう",
                      regionLine: muniData
                        ? `${muniData.name}では${period}に${muniData.sagiCurrent.toLocaleString()}件認知されています`
                        : stats
                          ? `東京都全体では${period}に${stats.data.tokyoTotal.sagiCurrent.toLocaleString()}件認知されています`
                          : null,
                      sourceLine: "出典: 警視庁 区市町村の町丁別、罪種別及び手口別認知件数 ／ サギカモで作成",
                    });
                    setCard(generated);
                  } finally {
                    setCardBusy(false);
                  }
                })();
              }}
            >
              {cardBusy ? "作成中…" : "💌 まもるカードを作る"}
            </button>
          ) : (
            <div className="mamoru-preview">
              <img src={card.dataUrl} alt="まもるカードのプレビュー" />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="button-secondary" onClick={() => void shareMamoruCard(card.blob)}>
                  📤 共有・保存する
                </button>
                <button className="button-secondary" onClick={() => setCard(null)}>✕ 閉じる</button>
              </div>
            </div>
          )}
        </div>
      )}

      <p style={{ marginTop: 16 }}>
        <a className="button-secondary" href="#/map">あなたの街を見る（リスクマップ）</a>
      </p>
      <p>
        <a className="button-secondary" href="#/">別の文面を判定する</a>
      </p>
    </div>
  );
}
