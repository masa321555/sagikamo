// S-04 リスクマップ。62区市町村をリスク指数（高齢者1万人あたり詐欺認知件数）で色分け。
// - 当年/前年切替、自宅/実家の2地点切替（localStorage保存）、タップで詳細表示
// - 手口別フィルタは公開データに内訳がないため提供せず、「詐欺全体」単一指標（注記表示）
// - 指数が算出不可の場合はグレー表示（0扱いしない）
// - 名称ラベルはMapLibreのシンボルレイヤー（衝突自動間引き）。漢字・かなは localIdeographFontFamily で
//   端末フォントをローカル描画するため、外部のグリフサーバーに依存しない。自宅/実家は別レイヤーで常時表示

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { MapLayerMouseEvent } from "maplibre-gl";

// MapLibreはWorkerを実行時にURL組み立てで読み込むため、バンドラがWorkerチャンクを出力できない。
// public/maplibre/ に同梱したWorkerファイルを明示指定する（npm run sync-maplibre で更新）
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
import "maplibre-gl/dist/maplibre-gl.css";
import { getStats, getTowns } from "../api.ts";
import { getRegion, setRegion, SLOT_LABELS, type RegionSlot } from "../region.ts";
import { DemoBadge, SourceNote } from "../components/common.tsx";
import { Icon } from "../components/icons.tsx";
import type { MuniStat, StatsJson, TownsJson } from "../types.ts";

type YearMode = "current" | "prev";
type MetricMode = "senior" | "all"; // 高齢者1万人あたり ／ 都民1万人あたり（全年代）

// 色は白→ネイビー系の段階（色覚多様性に配慮し単色相の濃淡＋凡例に数値）
const CLASS_COLORS = ["#e8eef5", "#b9cbe0", "#7f9cc0", "#41628f", "#1f3a5f"];
const NO_DATA_COLOR = "#c9c9c9";

interface GeoFeature {
  type: "Feature";
  properties: { code: number; name: string };
  geometry: { type: string; coordinates: unknown };
}

function indexOf(m: MuniStat, mode: YearMode, metric: MetricMode): number | null {
  if (metric === "senior") return mode === "current" ? m.riskIndex : m.riskIndexPrevYear;
  return mode === "current" ? m.riskIndexAll : m.riskIndexAllPrevYear;
}

/** 等量分類（五分位）の階級境界を求める */
function computeBreaks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return [q(0.2), q(0.4), q(0.6), q(0.8)];
}

function classify(v: number | null, breaks: number[]): number | null {
  if (v === null) return null;
  let i = 0;
  while (i < breaks.length && v > breaks[i]) i++;
  return i;
}

function bboxOf(geom: { type: string; coordinates: unknown }): [[number, number], [number, number]] {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as [number, number];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    } else if (Array.isArray(c)) {
      for (const cc of c) walk(cc);
    }
  };
  walk(geom.coordinates);
  return [[minX, minY], [maxX, maxY]];
}

/** ラベル代表点: 最大面積のポリゴン（島しょは主島）の外周リングの重心。タイル境界での二重配置を避けるため事前計算する */
function labelPointOf(geom: { type: string; coordinates: unknown }): [number, number] {
  const polygons = (geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates]) as number[][][][];
  let best: { x: number; y: number; area: number } | null = null;
  for (const poly of polygons) {
    const ring = poly[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
    }
    if (a === 0) continue;
    const area = Math.abs(a) / 2;
    if (!best || area > best.area) best = { x: cx / (3 * a), y: cy / (3 * a), area };
  }
  if (best) return [best.x, best.y];
  const [[minX, minY], [maxX, maxY]] = bboxOf(geom);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** 自宅/実家ピン画像: 白丸＋ネイビーの家アイコン（ラインスタイル。カラー絵文字は使わない）
 *  filled=true（自宅）は塗りつぶし、false（実家）は線画で区別する */
function housePinImage(filled: boolean): ImageData {
  const s = 48;
  const c = document.createElement("canvas");
  c.width = s; c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(24, 24, 21, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1f3a5f";
  ctx.stroke();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (filled) {
    ctx.fillStyle = "#1f3a5f";
    ctx.beginPath();
    ctx.moveTo(24, 12);
    ctx.lineTo(37, 24);
    ctx.lineTo(33, 24);
    ctx.lineTo(33, 35);
    ctx.lineTo(15, 35);
    ctx.lineTo(15, 24);
    ctx.lineTo(11, 24);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(11, 24);
    ctx.lineTo(24, 12);
    ctx.lineTo(37, 24);
    ctx.moveTo(15, 22);
    ctx.lineTo(15, 35);
    ctx.lineTo(33, 35);
    ctx.lineTo(33, 22);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, s, s);
}

const LABEL_TEXT_COLOR = "#1F3A5F";

export function MapPage() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [stats, setStats] = useState<{ data: StatsJson; isDemo: boolean } | null>(null);
  const [towns, setTowns] = useState<{ data: TownsJson; isDemo: boolean } | null>(null);
  const [geo, setGeo] = useState<{ features: GeoFeature[] } | null>(null);
  const [mode, setMode] = useState<YearMode>("current");
  const [metric, setMetric] = useState<MetricMode>("all"); // 既定は全年代（幅広い利用者向け）
  const [selected, setSelected] = useState<number | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [regionVersion, setRegionVersion] = useState(0); // 自宅/実家の設定変更をラベルに反映するためのカウンタ

  useEffect(() => {
    getStats().then(setStats);
    getTowns().then(setTowns);
    fetch("/map/tokyo_municipalities.geojson")
      .then((r) => { if (!r.ok) throw new Error(`境界データ取得失敗 HTTP ${r.status}`); return r.json(); })
      .then(setGeo)
      .catch((e) => setMapError(e instanceof Error ? e.message : "境界データを取得できませんでした"));
  }, []);

  const statByCode = new Map<number, MuniStat>((stats?.data.municipalities ?? []).map((m) => [m.code, m]));
  const values = (stats?.data.municipalities ?? []).map((m) => indexOf(m, mode, metric)).filter((v): v is number => v !== null);
  const breaks = values.length > 0 ? computeBreaks(values) : [];

  // 地図初期化
  useEffect(() => {
    if (!mapDiv.current || !geo || !stats || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: {
        version: 8,
        // 漢字・かなはローカル描画するため実際には取得されない（text-field使用時にstyle仕様上必須のため指定）
        glyphs: "/glyphs/{fontstack}/{range}.pbf",
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#dfe7ee" } }],
      },
      center: [139.5, 35.68],
      zoom: 8.6,
      attributionControl: false,
      localIdeographFontFamily: "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Noto Sans CJK JP', sans-serif",
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "国土交通省 国土数値情報（行政区域データ）を加工" }));
    map.on("load", () => {
      map.addSource("munis", { type: "geojson", data: geo as never });
      map.addLayer({ id: "muni-fill", type: "fill", source: "munis", paint: { "fill-color": NO_DATA_COLOR, "fill-opacity": 0.9 } });
      map.addLayer({ id: "muni-line", type: "line", source: "munis", paint: { "line-color": "#ffffff", "line-width": 1 } });
      map.addLayer({
        id: "muni-selected", type: "line", source: "munis",
        paint: { "line-color": "#e6a23c", "line-width": 3 },
        filter: ["==", ["get", "code"], -1],
      });
      map.on("click", "muni-fill", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (f) setSelected(f.properties.code as number);
      });

      // 名称ラベル（点ソース。データは別effectで投入）
      map.addImage("pin-home", housePinImage(true), { pixelRatio: 2 });
      map.addImage("pin-jikka", housePinImage(false), { pixelRatio: 2 });
      map.addSource("muni-labels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "muni-label", type: "symbol", source: "muni-labels",
        filter: ["!", ["has", "slot"]],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 11, 14],
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-padding": 2,
          "symbol-sort-key": ["get", "sortKey"],
        },
        paint: { "text-color": LABEL_TEXT_COLOR, "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
      // 自宅/実家: 最優先（sort-key 0）・常時表示・アイコン付き。上位レイヤーほど先に配置されるため後に追加する
      map.addLayer({
        id: "muni-label-pinned", type: "symbol", source: "muni-labels",
        filter: ["has", "slot"],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 11, 15],
          "text-anchor": "top",
          "text-offset": [0, 0.1],
          "text-allow-overlap": true,
          "icon-image": ["case", ["==", ["get", "slot"], "home"], "pin-home", "pin-jikka"],
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "symbol-sort-key": ["get", "sortKey"],
        },
        paint: { "text-color": LABEL_TEXT_COLOR, "text-halo-color": "#ffffff", "text-halo-width": 2 },
      });
      map.on("click", "muni-label", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (f) setSelected(f.properties.code as number);
      });
      map.on("click", "muni-label-pinned", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (f) setSelected(f.properties.code as number);
      });
      // 当年⇄前年・指標切替時に0.3秒で色が変わる
      map.setPaintProperty("muni-fill", "fill-color-transition", { duration: 300, delay: 0 });
      setColors(map);
      // 初期表示: 多摩中心部〜23区東端を収める（スマホ幅でも読める大きさを優先。西多摩・島しょは
      // 自宅/実家に設定されている場合のみ範囲に含める）
      const bounds = new maplibregl.LngLatBounds([139.20, 35.52], [139.92, 35.88]);
      for (const slot of ["home", "jikka"] as RegionSlot[]) {
        const code = getRegion(slot);
        const f = code !== null ? geo.features.find((x) => x.properties.code === code) : undefined;
        if (f) bounds.extend(labelPointOf(f.geometry));
      }
      // コンテナの最終サイズ（dvh）が確定してからフィットする
      requestAnimationFrame(() => {
        map.resize();
        map.fitBounds(bounds, { padding: { top: 16, bottom: 16, left: 28, right: 28 }, duration: 0, maxZoom: 10 });
      });
      setMapReady(true);
    });
    mapRef.current = map;
    if (import.meta.env.DEV) {
      // 開発時デバッグ用
      const w = window as unknown as Record<string, unknown>;
      w.__sagimap = map;
      w.__maplibregl = maplibregl;
    }
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, stats]);

  // 色の再計算（当年/前年切替時）
  const setColors = (map: maplibregl.Map) => {
    if (!stats) return;
    const matchExpr: unknown[] = ["match", ["get", "code"]];
    for (const m of stats.data.municipalities) {
      const cls = classify(indexOf(m, mode, metric), breaks);
      matchExpr.push(m.code, cls === null ? NO_DATA_COLOR : CLASS_COLORS[cls]);
    }
    matchExpr.push(NO_DATA_COLOR);
    map.setPaintProperty("muni-fill", "fill-color", matchExpr as never);
  };
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getLayer("muni-fill")) setColors(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, metric, stats]);

  // 名称ラベルのデータ投入（全62区市町村。数値は含めない）。自宅/実家は slot 付き・sortKey 0 で最優先
  // それ以外は人口の多い順に sortKey を振り、ズームアウト時は人口の多い区市町村から表示される
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !stats || !geo) return;
    const src = map.getSource("muni-labels") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const home = getRegion("home"), jikka = getRegion("jikka");
    const popRank = new Map<number, number>(
      [...stats.data.municipalities].sort((a, b) => b.popTotal - a.popTotal).map((m, i) => [m.code, i + 1]),
    );
    const features = geo.features.map((f) => {
      const code = f.properties.code;
      const slot = code === home ? "home" : code === jikka ? "jikka" : undefined;
      const props: Record<string, unknown> = {
        code,
        name: statByCode.get(code)?.name ?? f.properties.name,
        sortKey: slot ? 0 : (popRank.get(code) ?? 999),
      };
      if (slot) props.slot = slot;
      return { type: "Feature" as const, properties: props, geometry: { type: "Point" as const, coordinates: labelPointOf(f.geometry) } };
    });
    src.setData({ type: "FeatureCollection", features });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, stats, geo, regionVersion]);

  // 選択ハイライト
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getLayer("muni-selected")) {
      map.setFilter("muni-selected", ["==", ["get", "code"], selected ?? -1]);
    }
  }, [selected]);

  /** 指定した区市町村を選択状態にして地図をズームする */
  const focusMuni = (code: number) => {
    setSelected(code);
    const f = geo?.features.find((x) => x.properties.code === code);
    if (f && mapRef.current) {
      mapRef.current.fitBounds(bboxOf(f.geometry), { padding: 40, maxZoom: 11 });
    }
  };

  const goToSlot = (slot: RegionSlot) => {
    const code = getRegion(slot);
    if (!code) {
      alert(`${SLOT_LABELS[slot]}の区市町村が未設定です。地域を選んでから「自宅に設定」を押してください。`);
      return;
    }
    focusMuni(code);
  };

  // プルダウン用グループ分け（地域コード順: 23区 → 市部 → 町村部・島しょ）
  const muniGroups: { label: string; items: MuniStat[] }[] = [
    { label: "２３区", items: (stats?.data.municipalities ?? []).filter((m) => m.code < 13200) },
    { label: "市部", items: (stats?.data.municipalities ?? []).filter((m) => m.code >= 13200 && m.code < 13300) },
    { label: "町村部・島しょ", items: (stats?.data.municipalities ?? []).filter((m) => m.code >= 13300) },
  ];

  const sel = selected !== null ? statByCode.get(selected) : null;
  const selIdx = sel ? indexOf(sel, mode, metric) : null;
  const selIdxOther = sel ? indexOf(sel, mode, metric === "all" ? "senior" : "all") : null;

  return (
    <div>
      <h2 className="section-title" style={{ marginTop: 0 }}>地域リスクマップ</h2>
      <p className="source-note" style={{ marginTop: 0 }}>
        リスク指数 = 詐欺（刑法犯）認知件数 ÷ {metric === "all" ? "人口（全年代）" : "65歳以上人口"} × 10,000（1万人あたり）。
        詐欺の被害は年代を問わず発生しています。※手口別の内訳は公開データにないため、詐欺全体の指数です。
      </p>

      <div className="map-controls">
        <div>
          <label className="field-label" htmlFor="muni-jump">地域をえらぶ</label>
          <select
            id="muni-jump"
            className="region-select"
            value={selected ?? ""}
            onChange={(e) => { if (e.target.value) focusMuni(Number(e.target.value)); }}
          >
            <option value="">地図から探す／一覧からえらぶ</option>
            {muniGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((m) => (
                  <option key={m.code} value={m.code}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="toggle-group" role="group" aria-label="指標の切替">
          <button className={metric === "all" ? "active" : ""} onClick={() => setMetric("all")}>
            全年代
          </button>
          <button className={metric === "senior" ? "active" : ""} onClick={() => setMetric("senior")}>
            高齢者
          </button>
        </div>
        <div className="toggle-group" role="group" aria-label="表示年の切替">
          <button className={mode === "current" ? "active" : ""} onClick={() => setMode("current")}>
            当年（{stats?.data.tokyoTotal.currentPeriod ?? "今年"}）
          </button>
          <button className={mode === "prev" ? "active" : ""} onClick={() => setMode("prev")}>
            前年
          </button>
        </div>
        <div className="toggle-group" role="group" aria-label="保存した地点へ移動">
          <button onClick={() => goToSlot("home")}>自宅へ</button>
          <button onClick={() => goToSlot("jikka")}>実家へ</button>
        </div>
      </div>

      {mapError && <p className="error-box">{mapError}</p>}
      <div className="map-wrap">
        <div ref={mapDiv} className="map-container" aria-label="東京都の区市町村別リスクマップ" />
        {sel && stats && (
          <div className="map-sheet" role="dialog" aria-label={`${sel.name}の詳細`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: "1.125rem" }}>{sel.name}</p>
              <button type="button" className="sheet-close" onClick={() => setSelected(null)} aria-label="閉じる"><Icon name="close" size={16} />閉じる</button>
            </div>
            <p style={{ margin: "4px 0 0" }}>
              リスク指数（{mode === "current" ? "当年" : "前年"}・{metric === "all" ? "全年代" : "高齢者"}）:
              <span className="data-number"> {selIdx === null ? "算出不可" : selIdx.toFixed(1)} </span>
              {selIdx !== null && <span className="source-note">（{metric === "all" ? "都民" : "高齢者"}1万人あたり）</span>}
            </p>
            <p className="source-note" style={{ margin: "2px 0 0" }}>
              参考: {metric === "all" ? "高齢者" : "全年代"}1万人あたりは {selIdxOther === null ? "算出不可" : selIdxOther.toFixed(1)}
            </p>
            <p style={{ margin: "4px 0 0" }}>
              認知件数: {(mode === "current" ? sel.sagiCurrent : sel.sagiPrevYear).toLocaleString()}件 ／
              人口: {sel.popTotal.toLocaleString()}人（うち65歳以上 {sel.pop65.toLocaleString()}人）
            </p>
            {(() => {
              const rank = towns?.data.municipalities[String(sel.code)] ?? [];
              if (rank.length === 0) return null;
              return (
                <div style={{ marginTop: 8 }}>
                  <p style={{ margin: 0, fontWeight: 700 }}>
                    件数が多い町丁 トップ{rank.length}（当年） {towns?.isDemo && <DemoBadge show />}
                  </p>
                  <ol style={{ margin: "2px 0 0", paddingLeft: "1.4em" }}>
                    {rank.map((t) => (
                      <li key={t.name}>{t.name} — {t.sagi.toLocaleString()}件</li>
                    ))}
                  </ol>
                </div>
              );
            })()}
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="button-secondary" onClick={() => { setRegion("home", sel.code); setRegionVersion((v) => v + 1); alert(`${sel.name}を自宅に設定しました`); }}>
                自宅に設定
              </button>
              <button className="button-secondary" onClick={() => { setRegion("jikka", sel.code); setRegionVersion((v) => v + 1); alert(`${sel.name}を実家に設定しました`); }}>
                実家に設定
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="legend" style={{ marginTop: 8 }}>
        <span style={{ width: "100%" }}>色が濃いほど、{metric === "all" ? "人口" : "65歳以上人口"}1万人あたりの件数が多い地域です。</span>
        <strong>指数:</strong>
        {breaks.length > 0 && (
          <>
            <span><span className="swatch" style={{ background: CLASS_COLORS[0] }} />〜{breaks[0].toFixed(1)}</span>
            <span><span className="swatch" style={{ background: CLASS_COLORS[1] }} />〜{breaks[1].toFixed(1)}</span>
            <span><span className="swatch" style={{ background: CLASS_COLORS[2] }} />〜{breaks[2].toFixed(1)}</span>
            <span><span className="swatch" style={{ background: CLASS_COLORS[3] }} />〜{breaks[3].toFixed(1)}</span>
            <span><span className="swatch" style={{ background: CLASS_COLORS[4] }} />それ以上</span>
          </>
        )}
        <span><span className="swatch" style={{ background: NO_DATA_COLOR }} />算出不可</span>
      </div>


      {stats && (
        <>
          <SourceNote source={stats.data.sources.d1Current} isDemo={stats.isDemo} />
          <SourceNote source={stats.data.sources.d3} isDemo={stats.isDemo} />
        </>
      )}
    </div>
  );
}
