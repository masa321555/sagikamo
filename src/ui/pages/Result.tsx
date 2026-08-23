// S-02 判定結果。最上部のサマリーカード（危険度・手口・地域件数・カモ）→ 詳細 → 地域変更 → 行動 → まもるカード
// LLMの見立て（グレー系 ai-block）と実データ（ネイビー data-block）を視覚的に区別する（spec デザイン原則1）

import { useEffect, useState } from "react";
import { getStats, getTechniques } from "../api.ts";
import { getRegion, setRegion, SLOT_LABELS, type RegionSlot } from "../region.ts";
import { ActionList, AddresseeField, DemoBadge, Kamo, SourceNote } from "../components/common.tsx";
import { ACTION_DISPLAY, LOW_RISK_NOTICE, RISK_DISPLAY } from "../../lib/judge/templates.ts";
import { isSpeakSupported, speak, stopSpeaking } from "../speech.ts";
import { generateMamoruCard, shareMamoruCard } from "../mamoru.ts";
import type { JudgeResponse, RiskLevel, StatsJson } from "../types.ts";

const RISK_ICON: Record<RiskLevel, string> = { high: "⚠️", caution: "❕", low: "ℹ️" };

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
  const [addressee, setAddressee] = useState(""); // 画像にのみ描画。保存しない

  useEffect(() => {
    window.scrollTo(0, 0); // 結果は必ず最上部（サマリーカード）から見せる
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
  const period = stats?.data.tokyoTotal.currentPeriod ?? "今年";
  const d1 = stats?.data.sources.d1Current;
  const riskInfo = RISK_DISPLAY[result.risk];

  return (
    <div>
      {isDemoJudgement && (
        <p style={{ marginBottom: 8 }}>
          <DemoBadge show /> <span className="source-note">これはLLM判定の代わりに表示しているサンプル判定です。</span>
        </p>
      )}

      {/* ---- サマリーカード（危険度・手口・地域件数・カモを1枚に） ---- */}
      <div className="card summary-card" role="alert">
        <div className="summary-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className={`risk-pill risk-${result.risk}`}>
              <span aria-hidden="true">{RISK_ICON[result.risk]}</span> {riskInfo.label}
            </span>
            {result.risk !== "low" ? (
              <p className="summary-technique">{result.techniqueLabel}の型に近い特徴</p>
            ) : (
              <p className="summary-technique">{LOW_RISK_NOTICE}</p>
            )}
            {riskInfo.headline && <p className="summary-headline">{riskInfo.headline}</p>}
          </div>
          {/* 低リスクは「ほっと一息」。ただし定型注意文（LOW_RISK_NOTICE）はそのまま表示する */}
          <Kamo pose={result.risk === "low" ? "relief" : "stop"} size={72} alt={result.risk === "low" ? "ほっと一息つくサギカモ" : "手を前に出して止めるサギカモ"} />
        </div>

        <div className="summary-data">
          {statsError && <p className="error-box" style={{ margin: 0 }}>統計データを取得できませんでした（データ取得中/取得不可）。</p>}
          {!stats && !statsError && <p className="loading" style={{ padding: 0 }}>統計データを読み込み中…</p>}
          {stats && (
            <>
              <p style={{ margin: 0 }}>
                <span className="summary-region">{muni ? muni.name : "東京都全体"}</span>で{period}、詐欺（刑法犯）
                <span className="data-number"> {(muni ? muni.sagiCurrent : stats.data.tokyoTotal.sagiCurrent).toLocaleString()} </span>件
              </p>
              <p className="source-note" style={{ margin: "2px 0 0" }}>
                出典: {d1?.provider}「区市町村の町丁別、罪種別及び手口別認知件数」（{d1?.fetchedAt.slice(0, 10)}取得）
                {stats.isDemo && <> <DemoBadge show /></>}
              </p>
            </>
          )}
        </div>
      </div>

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
        <h2 className="section-title" style={{ marginTop: 0 }}>表示する地域を変える</h2>
        <div style={{ marginBottom: 6 }}>
          <label className="field-label" htmlFor="region-slot">地域</label>
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
        {stats && muni && (
          <p className="source-note" style={{ margin: 0 }}>
            前年（{stats.data.tokyoTotal.prevYearPeriod ?? ""}）: {muni.sagiPrevYear.toLocaleString()}件
          </p>
        )}
        <p className="source-note">※手口別の地域内訳は公開データにないため、詐欺全体の認知件数を表示しています。</p>
        {stats && <SourceNote source={stats.data.sources.d1Current} isDemo={stats.isDemo} />}
      </div>

      <ActionList actions={result.actions} />

      {result.risk !== "low" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>💌 家族に知らせる（まもるカード）</h2>
          <p className="source-note" style={{ marginTop: 0 }}>
            この判定結果を、やさしい言葉の1枚の画像にします。LINEなどでご家族に送って注意を伝えられます。
          </p>
          {!card ? (
            <>
            <AddresseeField value={addressee} onChange={setAddressee} />
            <button
              className="button-secondary"
              disabled={cardBusy}
              onClick={() => {
                void (async () => {
                  setCardBusy(true);
                  try {
                    const tech = getTechniques().techniques.find((t) => t.id === result.technique);
                    const generated = await generateMamoruCard({
                      addressee,
                      riskLabel: riskInfo.label,
                      title: result.techniqueLabel,
                      headline: "こんな連絡に気をつけて",
                      lines: result.evidence.slice(0, 3),
                      actionText: tech?.first_action ?? "一度電話を切って、#9110（警察相談専用電話）に相談しましょう",
                      regionLine: muni
                        ? `${muni.name}では${period}に${muni.sagiCurrent.toLocaleString()}件認知されています`
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
            </>
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
