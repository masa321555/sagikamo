// 電話チェック: 番号の確認（任意・ルールベース）→ ボタンをえらぶだけの3問 → 判定。
// - 番号チェックはこの端末の中だけで行う（番号そのものは保存も送信もしない。送るのは番号帯の分類IDのみ）
// - 3問の選択内容から定型の説明文を組み立て、通常の判定と同じLLMパイプラインに通す
//   （判定ロジックを一元化し、断定禁止・検証・サニタイズを共通で担保するため）

import { useState } from "react";
import phoneRulesJson from "../../../data/config/phone_rules.json";
import { postJudge, postPhoneStat } from "../api.ts";
import { BlockGuide, LoadingKamo } from "../components/common.tsx";
import { Icon, type IconName } from "../components/icons.tsx";
import {
  checkPhoneNumber, PHONE_LEVEL_DISPLAY, PHONE_NUMBER_NOTICE,
  type PhoneCheckResult, type PhoneLevel, type PhoneRule,
} from "../../lib/phone/check.ts";
import { PRESSURE_CHOICES, WHAT_CHOICES, WHO_CHOICES, type PhoneChoice } from "../../lib/phone/questions.ts";
import type { JudgeResponse } from "../types.ts";

const PHONE_RULES = (phoneRulesJson as unknown as { rules: PhoneRule[] }).rules;
const LEVEL_ICON: Record<PhoneLevel, IconName> = { high: "alert", caution: "alertCircle", info: "info" };
const LEVEL_CLASS: Record<PhoneLevel, string> = { high: "risk-high", caution: "risk-caution", info: "risk-low" };

type MatchedNumber = Extract<PhoneCheckResult, { ok: true }>;

export function PhoneCheck({ onJudged }: { onJudged: (result: JudgeResponse, isDemoJudgement: boolean) => void }) {
  const [step, setStep] = useState(-1); // -1:番号（任意） 0:誰から 1:内容 2:急がされたか
  const [numberInput, setNumberInput] = useState("");
  const [numberResult, setNumberResult] = useState<MatchedNumber | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [who, setWho] = useState<PhoneChoice | null>(null);
  const [what, setWhat] = useState<PhoneChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkNumber = () => {
    const r = checkPhoneNumber(numberInput, PHONE_RULES);
    if (r.ok) {
      setNumberResult(r);
      setNumberError(null);
    } else {
      setNumberResult(null);
      setNumberError("電話番号として読み取れませんでした。着信履歴の番号を、数字と「+」で入力してください。");
    }
  };

  const judgeWith = async (pressure: PhoneChoice) => {
    setBusy(true);
    setError(null);
    try {
      // 選択肢から定型の説明文を組み立てて判定にかける（自由文の入力なし。番号そのものは含めない）
      const origin = numberResult ? `発信元: ${numberResult.fragment}。` : "";
      const composed = `電話がかかってきました。${origin}相手: ${who!.fragment}。言われた内容: ${what!.fragment}。${pressure.fragment}。`;
      const result = await postJudge(composed, undefined, { band: numberResult?.ruleId ?? "none", org: who!.id });
      onJudged(result, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "判定に失敗しました。しばらくしてからもう一度お試しください");
      setBusy(false);
    }
  };

  const heading = (
    <h2 className="section-title icon-title" style={{ marginTop: 0, fontSize: "1.25rem" }}><Icon name="phone" size={22} />電話チェック</h2>
  );

  if (busy) {
    return (
      <div>
        {heading}
        <LoadingKamo message="カモが確認しています…そのままお待ちください（10秒ほど）" />
      </div>
    );
  }

  // ---- ステップ1: 電話番号の確認（任意） ----
  if (step === -1) {
    const level = numberResult ? PHONE_LEVEL_DISPLAY[numberResult.level] : null;
    return (
      <div>
        {heading}
        <p className="phone-progress">ステップ 1 / 4（番号がわかる方のみ）</p>
        <label htmlFor="phone-number" style={{ display: "block", fontSize: "1.25rem", fontWeight: 700 }}>
          かかってきた電話番号がわかりますか?
        </label>
        <p className="source-note" style={{ marginTop: 4 }}>
          着信履歴に残っている番号を入力してください。入力した番号は、この端末の中だけで確認し、保存も送信もしません。
        </p>
        <input
          id="phone-number"
          className="phone-input"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="例: +1 844 ……"
          value={numberInput}
          onChange={(e) => { setNumberInput(e.target.value); setNumberResult(null); setNumberError(null); }}
        />
        {!numberResult && (
          <>
            <button type="button" className="judge-button" onClick={checkNumber} disabled={numberInput.trim().length === 0}>
              番号をチェックする
            </button>
            {numberError && <div className="error-box" role="alert" style={{ marginTop: 12 }}>{numberError}</div>}
            <button type="button" className="choice-button" style={{ marginTop: 12 }} onClick={() => setStep(0)}>
              番号はわからない（とばして次へ）
            </button>
          </>
        )}

        {numberResult && level && (
          <>
            <div className="card summary-card" role="alert" style={{ marginTop: 12 }}>
              <span className={`risk-pill ${LEVEL_CLASS[numberResult.level]}`}>
                <Icon name={LEVEL_ICON[numberResult.level]} size={20} /> {level.label}
              </span>
              <p className="summary-technique">{numberResult.label}</p>
              <p className="summary-headline">{level.headline}</p>
              <p style={{ margin: "8px 0 0" }}>{numberResult.note}</p>
              <p className="source-note" style={{ marginBottom: 0 }}>{PHONE_NUMBER_NOTICE}</p>
            </div>
            <button type="button" className="judge-button" style={{ marginTop: 0 }} onClick={() => setStep(0)}>
              つづけて、電話の内容もチェックする
            </button>
            {numberResult.level !== "info" && (
              <p style={{ marginTop: 12 }}>
                <a className="button-secondary" href="#/after">すでに電話に出てしまった方へ（対処ナビ）</a>
              </p>
            )}
            {numberResult.level !== "info" && <BlockGuide />}
            <p style={{ marginTop: 12 }}>
              <a className="button-secondary" href="#/" onClick={() => postPhoneStat(numberResult.ruleId)}>番号だけ確認して終わる</a>
            </p>
          </>
        )}

        {!numberResult && (
          <p style={{ marginTop: 16 }}>
            <a className="button-secondary" href="#/">← もどる</a>
          </p>
        )}
      </div>
    );
  }

  // ---- ステップ2〜4: えらぶだけの3問 ----
  const questions = [
    {
      title: "だれからの電話でしたか?",
      sub: undefined as string | undefined,
      choices: WHO_CHOICES,
      onPick: (c: PhoneChoice) => { setWho(c); setStep(1); },
    },
    {
      title: "どんなことを言われましたか?",
      sub: "いちばん近いものをえらんでください",
      choices: WHAT_CHOICES,
      onPick: (c: PhoneChoice) => { setWhat(c); setStep(2); },
    },
    {
      title: "「今すぐ」と急がされたり、「誰にも話さないで」と言われましたか?",
      sub: undefined as string | undefined,
      choices: PRESSURE_CHOICES,
      onPick: (c: PhoneChoice) => void judgeWith(c),
    },
  ];

  const q = questions[step];
  return (
    <div>
      {heading}
      <p className="phone-progress">ステップ {step + 2} / 4</p>
      <p style={{ fontSize: "1.25rem", fontWeight: 700 }}>{q.title}</p>
      {q.sub && <p className="source-note" style={{ marginTop: 0 }}>{q.sub}</p>}

      {q.choices.map((c) => (
        <button key={c.id} type="button" className="choice-button" onClick={() => q.onPick(c)}>
          {c.label}
        </button>
      ))}

      {error && <div className="error-box" role="alert" style={{ marginTop: 12 }}>{error}</div>}

      <p style={{ marginTop: 16 }}>
        <button type="button" className="button-secondary" onClick={() => setStep(step - 1)}>← 前へもどる</button>
      </p>
    </div>
  );
}
