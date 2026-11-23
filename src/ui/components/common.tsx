// 共通コンポーネント: 危険度バナー・行動リスト・出典表示・デモバッジ
// 文言はすべて src/lib/judge/templates.ts の定型文から引く（断定禁止の構造的担保）

import { useState } from "react";
import { ACTION_DISPLAY, LOW_RISK_NOTICE, RISK_DISPLAY } from "../../lib/judge/templates.ts";
import { Icon, type IconName } from "./icons.tsx";
import type { ActionId, RiskLevel, SourceInfo } from "../types.ts";

export const RISK_ICON: Record<RiskLevel, IconName> = { high: "alert", caution: "alertCircle", low: "info" };
const ACTION_HREF: Partial<Record<ActionId, string>> = {
  consult_9110: "tel:%239110",
  consult_188: "tel:188",
  call_110: "tel:110",
};

export type KamoPose = "base" | "inspect" | "stop" | "card" | "relief" | "phone" | "book";

/** 画像を差し替えたときに上げる（ブラウザ/CDNキャッシュを確実に更新するためのクエリ） */
const KAMO_ASSET_VERSION = "2";
export function kamoAssetUrl(pose: KamoPose, ext: "png" | "webp"): string {
  return `/assets/kamo/kamo_${pose}.${ext}?v=${KAMO_ASSET_VERSION}`;
}

/** キャラクター画像（WebP＋PNGフォールバック）。白系背景のカード上にのみ配置すること */
export function Kamo({ pose, size, alt }: { pose: KamoPose; size: number; alt?: string }) {
  return (
    <picture>
      <source srcSet={kamoAssetUrl(pose, "webp")} type="image/webp" />
      <img
        src={kamoAssetUrl(pose, "png")}
        alt={alt ?? "サギカモのキャラクター"}
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
      />
    </picture>
  );
}

/** 判定中ローディング（カモが虫眼鏡で確認中） */
export function LoadingKamo({ message = "カモが確認しています…（10秒ほどお待ちください）" }: { message?: string }) {
  return (
    <div className="loading-kamo" role="status" aria-live="polite">
      <Kamo pose="inspect" size={96} alt="虫眼鏡で文面を調べるサギカモ" />
      <p className="loading-kamo-text">{message}</p>
    </div>
  );
}

/** まもるカードの宛名選択（宛名は画像にのみ描画し、保存しない） */
export const ADDRESSEE_PRESETS = ["おかあさんへ", "おとうさんへ", "おばあちゃんへ", "おじいちゃんへ", "ご家族へ"] as const;
export function AddresseeField({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const isPreset = value === "" || (ADDRESSEE_PRESETS as readonly string[]).includes(value);
  const [custom, setCustom] = useState(!isPreset);
  return (
    <div style={{ marginBottom: 8 }}>
      <label className="field-label" htmlFor="addressee">宛名（任意）</label>
      <select
        id="addressee"
        className="region-select"
        value={custom ? "__custom" : value}
        onChange={(e) => {
          if (e.target.value === "__custom") { setCustom(true); onChange(""); }
          else { setCustom(false); onChange(e.target.value); }
        }}
      >
        <option value="">宛名なし</option>
        {ADDRESSEE_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
        <option value="__custom">自分で入力する</option>
      </select>
      {custom && (
        <input
          type="text"
          className="region-select"
          style={{ marginLeft: 6, width: 160 }}
          placeholder="例: ○○さんへ"
          maxLength={12}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="宛名を入力"
        />
      )}
    </div>
  );
}

export function DemoBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="demo-badge" role="status">サンプルデータ</span>;
}

export function RiskBanner({ risk }: { risk: RiskLevel }) {
  const d = RISK_DISPLAY[risk];
  return (
    <div className={`risk-banner risk-${risk}`} role="alert">
      <div className="risk-label">
        <Icon name={RISK_ICON[risk]} size={24} />
        {d.label}
      </div>
      {d.headline && <div className="risk-headline">{d.headline}</div>}
      {risk === "low" && <div className="risk-headline">{LOW_RISK_NOTICE}</div>}
    </div>
  );
}

export function ActionList({ actions }: { actions: ActionId[] }) {
  return (
    <div>
      <h2 className="section-title">次にすること</h2>
      {actions.map((a) => {
        const d = ACTION_DISPLAY[a];
        const href = ACTION_HREF[a];
        const inner = (
          <>
            <span className="action-label">{d.label}</span>
            <span className="action-desc"> — {d.description}</span>
          </>
        );
        return href ? (
          <a key={a} className="action-item" href={href}>{inner}</a>
        ) : (
          <div key={a} className="action-item">{inner}</div>
        );
      })}
    </div>
  );
}

/**
 * 着信ブロックの案内。サギカモ自体は着信履歴の読み取りやブロックを行わないため、
 * 警視庁のアプリと固定電話向けの公的な窓口へ役割を分けて案内する。
 */
export function BlockGuide() {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 className="section-title" style={{ marginTop: 0 }}>これからの電話を防ぐには</h3>
      <ul className="evidence-list">
        <li>
          <strong>スマートフォン</strong>: 警視庁の防犯アプリ「デジポリス」に、国際電話番号からの着信をブロックする機能（国際電話番号ブロックシステム）があります。アプリでの設定が必要で、iPhoneとAndroidで使える機能に違いがあります。
        </li>
        <li>
          <strong>固定電話</strong>: 「国際電話不取扱受付センター」（
          <a href="tel:0120210364" style={{ color: "var(--navy)", fontWeight: 700 }}>0120-210-364</a>
          ）に申し込むと、海外と電話をする用がない方は国際電話の利用を休止できます。手続きが難しいときは、最寄りの警察署でも相談できます。
        </li>
      </ul>
      <p style={{ margin: "8px 0 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a
          className="button-secondary"
          href="https://www.keishicho.metro.tokyo.lg.jp/kurashi/tokushu/furikome/digipolice.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          デジポリスの案内（警視庁）
        </a>
        <a
          className="button-secondary"
          href="https://www.npa.go.jp/bureau/safetylife/sos47/case/international-phone/"
          target="_blank"
          rel="noopener noreferrer"
        >
          国際電話の対策（警察庁）
        </a>
      </p>
      <p className="source-note" style={{ marginBottom: 0 }}>
        サギカモには、着信をブロックする機能や着信履歴を読み取る機能はありません。出典: 警視庁「防犯アプリ デジポリス」／警察庁「みんなでとめよう!!国際電話詐欺」
      </p>
    </div>
  );
}

export function SourceNote({ source, isDemo }: { source: SourceInfo; isDemo: boolean }) {
  const date = source.fetchedAt ? source.fetchedAt.slice(0, 10) : "";
  return (
    <p className="source-note">
      出典: {source.name}（{source.provider}、{date}取得{source.period ? `・${source.period}` : ""}）
      {isDemo && <> <DemoBadge show /></>}
    </p>
  );
}
