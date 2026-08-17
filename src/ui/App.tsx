// アプリシェル: ハッシュルーティング＋ヘッダー＋フッター（相談導線常設）＋下部ナビ

import { useEffect, useState } from "react";
import { Home } from "./pages/Home.tsx";
import { Result } from "./pages/Result.tsx";
import { MapPage } from "./pages/MapPage.tsx";
import { Zukan } from "./pages/Zukan.tsx";
import { Consult } from "./pages/Consult.tsx";
import { About } from "./pages/About.tsx";
import { PhoneCheck } from "./pages/PhoneCheck.tsx";
import { isForcedDemo } from "./api.ts";
import type { JudgeResponse } from "./types.ts";

type Route = "home" | "result" | "map" | "zukan" | "consult" | "about" | "phone";

function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("result")) return "result";
  if (h.startsWith("map")) return "map";
  if (h.startsWith("zukan")) return "zukan";
  if (h.startsWith("consult")) return "consult";
  if (h.startsWith("about")) return "about";
  if (h.startsWith("phone")) return "phone";
  return "home";
}

export function navigate(route: Route): void {
  location.hash = route === "home" ? "/" : `/${route}`;
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  // 判定結果はメモリ内のみに保持（保存しない: CLAUDE.mdルール2）
  const [judgeResult, setJudgeResult] = useState<{ result: JudgeResponse; isDemo: boolean } | null>(null);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute());
      // ページ遷移時は必ず最上部から表示する（判定結果の危険度バナーが最初に見えるように）
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ハッシュ変更を伴わない画面切替（判定直後など）でも最上部へ
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route, judgeResult]);

  const page = (() => {
    switch (route) {
      case "result":
        return judgeResult ? (
          <Result result={judgeResult.result} isDemoJudgement={judgeResult.isDemo} />
        ) : (
          <Home onJudged={(r, d) => { setJudgeResult({ result: r, isDemo: d }); navigate("result"); }} />
        );
      case "map": return <MapPage />;
      case "zukan": return <Zukan />;
      case "consult": return <Consult />;
      case "about": return <About />;
      case "phone":
        return <PhoneCheck onJudged={(r, d) => { setJudgeResult({ result: r, isDemo: d }); navigate("result"); }} />;
      default:
        return <Home onJudged={(r, d) => { setJudgeResult({ result: r, isDemo: d }); navigate("result"); }} />;
    }
  })();

  return (
    <div className="app">
      <header className="app-header">
        <h1>サギカモ</h1>
        {isForcedDemo() && <span className="demo-badge">サンプルデータ</span>}
        <a className="about-button" href="#/about">サギカモとは？</a>
      </header>
      <main>{page}</main>
      <div className="consult-strip" aria-label="相談窓口">
        <a href="tel:110">110 緊急</a>
        <a href="tel:%239110">#9110 警察相談</a>
        <a href="tel:188">188 消費者</a>
      </div>
      <nav className="bottom-nav" aria-label="メインナビゲーション">
        <a href="#/" className={route === "home" || route === "result" ? "active" : ""}>
          <span className="nav-icon" aria-hidden="true">🔍</span>判定
        </a>
        <a href="#/map" className={route === "map" ? "active" : ""}>
          <span className="nav-icon" aria-hidden="true">🗾</span>マップ
        </a>
        <a href="#/zukan" className={route === "zukan" ? "active" : ""}>
          <span className="nav-icon" aria-hidden="true">📖</span>図鑑
        </a>
        <a href="#/consult" className={route === "consult" ? "active" : ""}>
          <span className="nav-icon" aria-hidden="true">📞</span>相談
        </a>
      </nav>
    </div>
  );
}
