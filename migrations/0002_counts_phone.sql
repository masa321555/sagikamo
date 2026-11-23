-- 電話チェックの匿名統計（CLAUDE.mdルール2準拠: 分類IDと件数のみ。
-- 電話番号そのもの・自由入力の組織名・本文・userId・IP は一切保存しない）
CREATE TABLE IF NOT EXISTS counts_phone (
  ym          TEXT NOT NULL,  -- 'YYYY-MM' JST基準
  band        TEXT NOT NULL,  -- 番号帯の分類ID（phone_rules.json の id）。番号未入力は 'none'
  claimed_org TEXT NOT NULL,  -- 名乗られた組織の分類ID（電話チェックの選択肢ID）。未回答（番号チェックのみ）は 'none'
  channel     TEXT NOT NULL,  -- 'web' | 'line'
  n           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ym, band, claimed_org, channel)
);
