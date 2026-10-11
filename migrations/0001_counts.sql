-- 匿名統計カウンタ（CLAUDE.mdルール2準拠: 保存するのは下記5カラムの分類値と件数のみ。
-- 本文・電話番号・送信者名・URL・LINE userId・IP・User-Agent は一切保存しない）
CREATE TABLE IF NOT EXISTS counts (
  ym        TEXT NOT NULL,  -- 'YYYY-MM' JST基準
  ward      TEXT NOT NULL,  -- 区市町村コード（13101等）または 'unknown'
  technique TEXT NOT NULL,  -- techniques.json の id、判定不能は 'unknown'
  risk      TEXT NOT NULL,  -- high / caution / low
  channel   TEXT NOT NULL,  -- 'web' | 'line'
  n         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ym, ward, technique, risk, channel)
);
