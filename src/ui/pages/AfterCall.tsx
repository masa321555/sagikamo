// 対処ナビ: 電話に出てしまった・情報を伝えてしまった後の「次にすること」を段階別に示す。
// LLMは使わず、src/lib/after/steps.ts の確定文言だけを表示する（断定・法的判断なし）。
// 何をえらんだかは保存も送信もしない。

import { useState } from "react";
import { AFTER_CONTACT_DISPLAY, AFTER_STAGES, type AfterStage } from "../../lib/after/steps.ts";
import { BlockGuide } from "../components/common.tsx";

export function AfterCall() {
  const [stage, setStage] = useState<AfterStage | null>(null);

  if (!stage) {
    return (
      <div>
        <h2 className="section-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>出てしまった・伝えてしまったとき</h2>
        <p style={{ marginTop: 0 }}>
          あわてなくて大丈夫。いまの状況にいちばん近いものをえらぶと、次にすることをご案内します。
        </p>
        {AFTER_STAGES.map((s) => (
          <button key={s.id} type="button" className="choice-button" onClick={() => { setStage(s); window.scrollTo(0, 0); }}>
            {s.label}
          </button>
        ))}
        <p className="source-note">えらんだ内容は保存も送信もされません。</p>
        <p style={{ marginTop: 16 }}>
          <a className="button-secondary" href="#/consult">← 相談窓口へ</a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="section-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>{stage.label}</h2>
      <p style={{ marginTop: 0, fontWeight: 700 }}>{stage.lead}</p>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>次にすること</h3>
        <ol className="after-steps">
          {stage.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>

      {stage.contacts.map((c) => {
        const d = AFTER_CONTACT_DISPLAY[c];
        return (
          <div key={c} className="consult-card">
            <a className="tel" href={d.tel}>{d.number}</a>
            <p style={{ margin: "4px 0 0" }}>{d.description}</p>
          </div>
        );
      })}

      <BlockGuide />

      <p style={{ marginTop: 16 }}>
        <button type="button" className="button-secondary" onClick={() => { setStage(null); window.scrollTo(0, 0); }}>
          ← ほかの状況をえらぶ
        </button>
      </p>
    </div>
  );
}
