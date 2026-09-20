// サギカモとは（初回利用者向けの説明ページ）
// トーンは「隣にいる冷静な家族」。断定表現を使わず、見立てであることを明示する（CLAUDE.mdルール1・6章）
// キャラクターは判定・結果画面と同じポーズを使い分け、白背景カード上にのみ配置する

import { Kamo } from "../components/common.tsx";
import { Icon } from "../components/icons.tsx";

export function About() {
  return (
    <div>
      <h2 className="section-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>サギカモとは</h2>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <p style={{ margin: 0, flex: 1 }}>
          サギカモは、「これって詐欺かも?」と感じたときに使う、無料の詐欺被害防止サービスです。
          不審な文面をAIが見立て、東京都の実データ（警視庁の統計）とあわせて、次にすべき行動までご案内します。
        </p>
        <Kamo pose="base" size={96} alt="サギカモのキャラクター" />
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>こんなときに使ってください</h3>
        <ul className="evidence-list">
          <li>身に覚えのない料金請求のSMS・メール・ハガキが届いたとき</li>
          <li>役所・警察・銀行を名乗る電話やメッセージが来たとき</li>
          <li>SNSやマッチングアプリで投資やお金の話が出たとき</li>
          <li>パソコンやスマホに突然「ウイルス感染」の警告が出たとき</li>
          <li>ご家族に届いた不審なメッセージが心配なとき</li>
        </ul>
        <p style={{ marginBottom: 0 }}>
          迷ったら、まず貼ってみてください。判定は無料で、貼り付けた内容が保存されることはありません。
        </p>
      </div>

      <h3 className="section-title">おもな機能</h3>

      <div className="card">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <p className="icon-title" style={{ margin: 0, fontWeight: 800, color: "var(--navy)" }}><Icon name="search" size={20} />判定</p>
            <p>
              AIが「どの手口に近いか」「危険度はどれくらいか」を根拠つきで見立てて、
              あなたの街での認知件数と、次にすべき行動までお伝えします。
              伝え方は4とおり。使いやすい方法をお選びください。
            </p>
          </div>
          <Kamo pose="inspect" size={80} alt="虫眼鏡で文面を調べるサギカモ" />
        </div>
        <ul className="evidence-list" style={{ marginBottom: 0 }}>
          <li><strong>電話チェック</strong>: あやしい電話は、ボタンをえらぶだけ（文字入力は不要）</li>
          <li><strong>貼り付け</strong>: メール・SMS・LINEなどの文面をコピーして貼るだけ</li>
          <li><strong>カメラ・写真</strong>: 届いたハガキや、べつの携帯の画面を撮って判定。スクリーンショットもOK</li>
          <li><strong>声で伝える</strong>: 電話で言われた内容を、話すだけで入力</li>
        </ul>
        <p style={{ marginBottom: 0 }}>
          判定結果は音声での読み上げにも対応しています。
        </p>
      </div>

      <div className="card">
        <p className="icon-title" style={{ margin: 0, fontWeight: 800, color: "var(--navy)" }}><Icon name="map" size={20} />マップ</p>
        <p style={{ marginBottom: 0 }}>
          東京都の62区市町村ごとに、詐欺の認知件数をもとにしたリスク指数を色分けした地図で見られます。
          指数は「全年代」と「高齢者」で切り替えられ、地域は一覧からもえらべます。
          地域を選ぶと、その中で件数が多い町丁トップ5もわかります。
          「自宅」と「実家」を登録しておくと、離れて暮らすご家族の地域の状況もすぐ確認できます。
        </p>
      </div>

      <div className="card">
        <p className="icon-title" style={{ margin: 0, fontWeight: 800, color: "var(--navy)" }}><Icon name="book" size={20} />図鑑</p>
        <p style={{ marginBottom: 0 }}>
          ニセ警察詐欺・還付金詐欺・SNS型投資詐欺など、代表的な8つの手口を紹介しています。
          よくあるフレーズと「最初にすること」を知っておくだけでも、いざというときの備えになります。
        </p>
      </div>

      <div className="card">
        <p className="icon-title" style={{ margin: 0, fontWeight: 800, color: "var(--navy)" }}><Icon name="phone" size={20} />相談</p>
        <p style={{ marginBottom: 0 }}>
          「110（緊急）」「#9110（警察相談）」「188（消費者ホットライン）」の使い分けと、
          お住まいの区市町村の相談窓口をご案内します。ひとりで抱え込まず、早めの相談が一番の対策です。
        </p>
      </div>

      <div className="card" style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <p className="icon-title" style={{ margin: 0, fontWeight: 800, color: "var(--navy)" }}><Icon name="mail" size={20} />まもるカード</p>
          <p style={{ marginBottom: 0 }}>
            判定結果や手口図鑑から、注意してほしいポイントをやさしい言葉と大きな文字でまとめた
            1枚の画像を作れます。LINEなどで送るだけで、離れて暮らすご家族に
            「こんな連絡に気をつけて」を伝えられます。あなたの判定が、家族の備えになります。
          </p>
        </div>
        <Kamo pose="card" size={80} alt="カードを差し出すサギカモ" />
      </div>

      <p className="source-note">
        判定はAIによる「見立て」であり、詐欺かどうかを断定するものではありません。
        地図や件数はすべて警視庁・東京都の公開データに基づいており、画面に出典を表示しています。
        貼り付けた文面・画像は判定後すぐに破棄され、保存されません。
      </p>

      <p style={{ marginTop: 16 }}>
        <a className="button-secondary" href="#/">さっそく判定してみる</a>
      </p>
    </div>
  );
}
