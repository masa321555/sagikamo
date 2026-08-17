// 電話チェック: 文字入力ゼロ・ボタンをえらぶだけで電話の内容を判定するウィザード（3問）。
// 選択内容から定型の説明文を組み立て、通常の判定と同じLLMパイプラインに通す
// （判定ロジックを一元化し、断定禁止・検証・サニタイズを共通で担保するため）。

import { useState } from "react";
import { postJudge } from "../api.ts";
import type { JudgeResponse } from "../types.ts";

interface Choice {
  label: string; // ボタン表示
  fragment: string; // 判定用の定型文
}

const WHO_CHOICES: Choice[] = [
  { label: "👮 警察・検察を名乗っていた", fragment: "警察官または検察官を名乗る相手" },
  { label: "🏢 役所・年金事務所・税務署を名乗っていた", fragment: "区役所・市役所・年金事務所・税務署の職員を名乗る相手" },
  { label: "🏦 銀行・カード会社を名乗っていた", fragment: "銀行・銀行協会・カード会社の職員を名乗る相手" },
  { label: "👨‍👩‍👧 息子・娘・孫（家族）を名乗っていた", fragment: "息子・娘・孫など家族を名乗る相手" },
  { label: "📱 電話会社・パソコンのサポートを名乗っていた", fragment: "電話会社や大手IT企業のサポートを名乗る相手" },
  { label: "❓ 知らない人・よくわからない", fragment: "名乗らない、またはよく知らない相手" },
];

const WHAT_CHOICES: Choice[] = [
  { label: "💰 お金を振り込んで・用意して と言われた", fragment: "お金の振り込みや現金の用意を求められた" },
  { label: "🏧 ATMへ行くように言われた（還付金など）", fragment: "医療費や保険料の還付金があると言われ、ATMへ行って手続きするよう案内された" },
  { label: "💳 キャッシュカードを渡す・交換すると言われた", fragment: "キャッシュカードの確認・交換・預かりが必要と言われた。暗証番号についても聞かれた" },
  { label: "🚨 口座が犯罪に使われている・逮捕状が出ている", fragment: "口座が犯罪に使われている、逮捕状が出ている、捜査に協力するよう言われた" },
  { label: "📞 携帯をなくした・番号が変わった と言われた", fragment: "携帯電話をなくして番号が変わったと言われ、その後お金の話が出た" },
  { label: "📈 投資すればもうかる と言われた", fragment: "投資すれば必ずもうかると勧誘された" },
  { label: "🏠 家族構成やお金のことを聞かれた", fragment: "在宅時間・家族構成・自宅にある現金など、お金や暮らしのことをあれこれ聞かれた" },
  { label: "❓ その他・よくわからない", fragment: "内容ははっきりしないが、不審に感じる話をされた" },
];

const PRESSURE_CHOICES: Choice[] = [
  { label: "はい、急がされた・口止めされた", fragment: "今日中に・今すぐと急がされたり、誰にも話さないよう口止めされた" },
  { label: "いいえ", fragment: "特に急がされてはいない" },
  { label: "よくわからない", fragment: "急がされたかどうかははっきりしない" },
];

export function PhoneCheck({ onJudged }: { onJudged: (result: JudgeResponse, isDemoJudgement: boolean) => void }) {
  const [step, setStep] = useState(0); // 0:誰から 1:内容 2:急がされたか
  const [who, setWho] = useState<Choice | null>(null);
  const [what, setWhat] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const judgeWith = async (pressure: Choice) => {
    setBusy(true);
    setError(null);
    try {
      // 選択肢から定型の説明文を組み立てて判定にかける（自由文の入力なし）
      const composed = `電話がかかってきました。相手: ${who!.fragment}。言われた内容: ${what!.fragment}。${pressure.fragment}。`;
      const result = await postJudge(composed);
      onJudged(result, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "判定に失敗しました。しばらくしてからもう一度お試しください");
      setBusy(false);
    }
  };

  const questions = [
    {
      title: "だれからの電話でしたか?",
      choices: WHO_CHOICES,
      onPick: (c: Choice) => { setWho(c); setStep(1); },
    },
    {
      title: "どんなことを言われましたか?",
      sub: "いちばん近いものをえらんでください",
      choices: WHAT_CHOICES,
      onPick: (c: Choice) => { setWhat(c); setStep(2); },
    },
    {
      title: "「今すぐ」と急がされたり、「誰にも話さないで」と言われましたか?",
      choices: PRESSURE_CHOICES,
      onPick: (c: Choice) => void judgeWith(c),
    },
  ];

  if (busy) {
    return (
      <div>
        <h2 className="section-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>📞 電話チェック</h2>
        <p className="loading" style={{ fontSize: "1.25rem" }}>チェックしています…そのままお待ちください（10秒ほど）</p>
      </div>
    );
  }

  const q = questions[step];
  return (
    <div>
      <h2 className="section-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>📞 電話チェック</h2>
      <p className="phone-progress">質問 {step + 1} / 3</p>
      <p style={{ fontSize: "1.25rem", fontWeight: 700 }}>{q.title}</p>
      {"sub" in q && q.sub && <p className="source-note" style={{ marginTop: 0 }}>{q.sub}</p>}

      {q.choices.map((c) => (
        <button key={c.label} type="button" className="choice-button" onClick={() => q.onPick(c)}>
          {c.label}
        </button>
      ))}

      {error && <div className="error-box" role="alert" style={{ marginTop: 12 }}>{error}</div>}

      <p style={{ marginTop: 16 }}>
        {step > 0 ? (
          <button type="button" className="button-secondary" onClick={() => setStep(step - 1)}>← 前の質問へもどる</button>
        ) : (
          <a className="button-secondary" href="#/">← もどる</a>
        )}
      </p>
    </div>
  );
}
