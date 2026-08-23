// S-05 相談窓口。危険度別の使い分け（110/#9110/188）＋区市町村セレクタ→D4連絡先

import { useEffect, useState } from "react";
import { getContacts } from "../api.ts";
import { Kamo, SourceNote } from "../components/common.tsx";
import type { ContactsJson } from "../types.ts";

export function Consult() {
  const [contacts, setContacts] = useState<{ data: ContactsJson; isDemo: boolean } | null>(null);
  const [muni, setMuni] = useState<string>("");

  useEffect(() => {
    getContacts().then(setContacts);
  }, []);

  const munis = contacts ? [...new Set(contacts.data.contacts.map((c) => c.municipality))] : [];
  const rows = contacts && muni ? contacts.data.contacts.filter((c) => c.municipality === muni) : [];

  return (
    <div>
      <h2 className="section-title" style={{ marginTop: 0 }}>相談窓口</h2>

      <div className="consult-card">
        <a className="tel" href="tel:110">110</a>
        <p style={{ margin: "4px 0 0" }}>すでにお金を渡した・今まさに被害が起きている（緊急）</p>
      </div>
      <div className="consult-card">
        <a className="tel" href="tel:%239110">#9110</a>
        <p style={{ margin: "4px 0 0" }}>不審な電話やメールがあったが、被害はまだ（警察相談専用電話）</p>
      </div>
      <div className="consult-card">
        <a className="tel" href="tel:188">188</a>
        <p style={{ margin: "4px 0 0" }}>契約・支払い・買い物のトラブル（消費者ホットライン）</p>
      </div>

      {/* キャラクターは緊急導線（110）の周辺には置かず、区市町村窓口の導入部にのみ配置する */}
      <div className="card" style={{ marginTop: 12 }}>
        <p className="kamo-lead">迷ったら、かけて大丈夫。</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
          <p style={{ margin: 0, flex: 1, minWidth: 0 }}>
            「こんなことで電話していいのかな」と思うような内容でも、相談窓口はそのためにあります。
            ひとりで抱え込まず、早めにご相談ください。
          </p>
          <Kamo pose="phone" size={88} alt="受話器で相談の電話をかけるサギカモ" />
        </div>
      </div>

      <h2 className="section-title">お住まいの区市町村の高齢者相談窓口</h2>
      <p className="source-note" style={{ marginTop: 0 }}>
        ご家族の様子がいつもと違うと感じたときの連絡先です（地域包括支援センター等）。
      </p>
      {!contacts && <p className="loading">連絡先を読み込み中…</p>}
      {contacts && (
        <>
          <select className="region-select" aria-label="区市町村を選択" value={muni} onChange={(e) => setMuni(e.target.value)}>
            <option value="">区市町村を選択してください</option>
            {munis.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          {muni && (
            <div className="card" style={{ marginTop: 10 }}>
              {rows.map((c, i) => (
                <div key={i} className="contact-row">
                  <div style={{ fontWeight: 700 }}>{c.name}</div>
                  {c.phone && (
                    <div>
                      <a href={`tel:${c.phone.replace(/[-（）()]/g, "")}`} style={{ color: "var(--navy)", fontWeight: 700 }}>
                        {c.phone}
                      </a>
                    </div>
                  )}
                  {c.hours && <div className="source-note">{c.hours}</div>}
                  {c.notes && <div className="source-note">{c.notes}</div>}
                </div>
              ))}
            </div>
          )}
          <SourceNote source={contacts.data.source} isDemo={contacts.isDemo} />
        </>
      )}
    </div>
  );
}
