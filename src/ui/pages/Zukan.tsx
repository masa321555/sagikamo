// S-03 手口図鑑。techniques.json（唯一の知識ベース）のカード一覧。
// 都内件数は手口別内訳が公開データにないため、詐欺全体の件数を共通表示する（techniques.json _d1_note）

import { useEffect, useState } from "react";
import { getStats, getTechniques } from "../api.ts";
import { SourceNote } from "../components/common.tsx";
import { generateMamoruCard, shareMamoruCard } from "../mamoru.ts";
import type { StatsJson, TechniqueDef } from "../types.ts";

export function Zukan() {
  const techniques = getTechniques();
  const [stats, setStats] = useState<{ data: StatsJson; isDemo: boolean } | null>(null);
  const [card, setCard] = useState<{ techId: string; dataUrl: string; blob: Blob } | null>(null);

  useEffect(() => {
    getStats().then(setStats);
  }, []);

  const makeCard = async (t: TechniqueDef) => {
    const period = stats?.data.tokyoTotal.currentPeriod ?? "今年";
    const generated = await generateMamoruCard({
      riskLabel: null,
      title: t.name,
      headline: "よくあるフレーズに注意",
      lines: t.typical_phrases.slice(0, 3).map((p) => `「${p}」`),
      actionText: t.first_action,
      regionLine: stats
        ? `東京都内では${period}に詐欺（刑法犯）が${stats.data.tokyoTotal.sagiCurrent.toLocaleString()}件認知されています`
        : null,
      sourceLine: "出典: 警察庁・警視庁の公表資料／警視庁 認知件数データ ／ サギカモで作成",
    });
    setCard({ techId: t.id, ...generated });
  };

  return (
    <div>
      <h2 className="section-title" style={{ marginTop: 0 }}>手口図鑑</h2>
      <p style={{ marginTop: 0 }}>
        詐欺の被害は高齢者に限りません。ニセ警察詐欺は若い世代を含む幅広い世代で急増しており、
        SNS型投資詐欺・サポート詐欺・架空料金請求も働く世代が多く狙われています。
      </p>
      <p className="source-note" style={{ marginTop: 0 }}>
        分類・実例フレーズ・被害傾向は警察庁・警視庁の公表資料に基づきます。
      </p>

      {techniques.techniques.map((t) => (
        <details key={t.id} className="card zukan-card">
          <summary>{t.name}</summary>
          {/* 画像は public/zukan/<手口id>.jpg（元画像は assets_src/zukan_originals/ に保全。最適化して配置） */}
          <img
            src={`/zukan/${t.id}.jpg`}
            alt=""
            className="zukan-image"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <p>{t.summary}</p>
          <h3 className="section-title">よくあるフレーズ</h3>
          {t.typical_phrases.map((p, i) => (
            <p key={i} className="phrase">「{p}」</p>
          ))}
          <h3 className="section-title">狙われやすい状況</h3>
          <p>{t.target_situation}</p>
          <h3 className="section-title">最初にすること</h3>
          <p className="first-action">{t.first_action}</p>
          {card?.techId === t.id ? (
            <div className="mamoru-preview">
              <img src={card.dataUrl} alt="まもるカードのプレビュー" />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="button-secondary" onClick={() => void shareMamoruCard(card.blob)}>📤 共有・保存する</button>
                <button className="button-secondary" onClick={() => setCard(null)}>✕ 閉じる</button>
              </div>
            </div>
          ) : (
            <p style={{ marginBottom: 0 }}>
              <button className="button-secondary" onClick={() => void makeCard(t)}>
                💌 まもるカードを作る<br />（家族に知らせる）
              </button>
            </p>
          )}
        </details>
      ))}

      {stats && (
        <div className="card data-block" style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>
            東京都内の詐欺（刑法犯）認知件数:
            <span className="data-number"> {stats.data.tokyoTotal.sagiCurrent.toLocaleString()} </span>件
            （{stats.data.tokyoTotal.currentPeriod ?? "今年"}）
          </p>
          <p className="source-note">※手口別の内訳は公開データにないため、詐欺全体の件数です。</p>
          <SourceNote source={stats.data.sources.d1Current} isDemo={stats.isDemo} />
        </div>
      )}
    </div>
  );
}
