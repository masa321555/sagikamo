// 共通コンポーネント: 危険度バナー・行動リスト・出典表示・デモバッジ
// 文言はすべて src/lib/judge/templates.ts の定型文から引く（断定禁止の構造的担保）

import { ACTION_DISPLAY, LOW_RISK_NOTICE, RISK_DISPLAY } from "../../lib/judge/templates.ts";
import type { ActionId, RiskLevel, SourceInfo } from "../types.ts";

const RISK_ICON: Record<RiskLevel, string> = { high: "⚠️", caution: "❕", low: "ℹ️" };
const ACTION_HREF: Partial<Record<ActionId, string>> = {
  consult_9110: "tel:%239110",
  consult_188: "tel:188",
  call_110: "tel:110",
};

export function DemoBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="demo-badge" role="status">サンプルデータ</span>;
}

export function RiskBanner({ risk }: { risk: RiskLevel }) {
  const d = RISK_DISPLAY[risk];
  return (
    <div className={`risk-banner risk-${risk}`} role="alert">
      <div className="risk-label">
        <span aria-hidden="true">{RISK_ICON[risk]}</span>
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

export function SourceNote({ source, isDemo }: { source: SourceInfo; isDemo: boolean }) {
  const date = source.fetchedAt ? source.fetchedAt.slice(0, 10) : "";
  return (
    <p className="source-note">
      出典: {source.name}（{source.provider}、{date}取得{source.period ? `・${source.period}` : ""}）
      {isDemo && <> <DemoBadge show /></>}
    </p>
  );
}
