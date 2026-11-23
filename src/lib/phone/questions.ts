// 電話チェックの選択肢（画面・判定文・統計の語彙を一元化する）
// - label: ボタンの表示 / fragment: 判定にかける定型文 / id: 統計に記録する分類ID
// - 自由入力はさせない。統計には選択肢のIDだけを記録し、組織名などの自由文は記録しない（CLAUDE.mdルール2）

export interface PhoneChoice {
  id: string;
  label: string;
  fragment: string;
}

/** だれからの電話か（＝名乗られた組織。統計 counts_phone.claimed_org の語彙） */
export const WHO_CHOICES: PhoneChoice[] = [
  { id: "police", label: "警察・検察を名乗っていた", fragment: "警察官または検察官を名乗る相手" },
  { id: "gov_office", label: "役所・年金事務所・税務署を名乗っていた", fragment: "区役所・市役所・年金事務所・税務署の職員を名乗る相手" },
  { id: "bank_card", label: "銀行・カード会社を名乗っていた", fragment: "銀行・銀行協会・カード会社の職員を名乗る相手" },
  { id: "telecom", label: "総務省・電話会社を名乗っていた", fragment: "総務省や電話会社・通信会社を名乗る相手" },
  { id: "family", label: "息子・娘・孫（家族）を名乗っていた", fragment: "息子・娘・孫など家族を名乗る相手" },
  { id: "it_support", label: "パソコン・スマホのサポートを名乗っていた", fragment: "大手IT企業やセキュリティ会社のサポートを名乗る相手" },
  { id: "unknown", label: "知らない人・よくわからない", fragment: "名乗らない、またはよく知らない相手" },
];

export const WHAT_CHOICES: PhoneChoice[] = [
  { id: "auto_voice", label: "自動音声（録音の声）で、番号を押すように言われた", fragment: "録音された自動音声が流れ、案内に従って番号を押すよう指示された" },
  { id: "leak", label: "カードや口座の情報がもれた・不正に使われた と言われた", fragment: "クレジットカードや口座の情報が漏えいした、または不正に利用されていると言われた" },
  { id: "unpaid", label: "料金が未納・電話が使えなくなる と言われた", fragment: "料金が未納である、このままだと電話や回線が使えなくなると言われた" },
  { id: "transfer", label: "お金を振り込んで・用意して と言われた", fragment: "お金の振り込みや現金の用意を求められた" },
  { id: "atm", label: "ATMへ行くように言われた（還付金など）", fragment: "医療費や保険料の還付金があると言われ、ATMへ行って手続きするよう案内された" },
  { id: "cashcard", label: "キャッシュカードを渡す・交換すると言われた", fragment: "キャッシュカードの確認・交換・預かりが必要と言われた。暗証番号についても聞かれた" },
  { id: "arrest", label: "口座が犯罪に使われている・逮捕状が出ている", fragment: "口座が犯罪に使われている、逮捕状が出ている、捜査に協力するよう言われた" },
  { id: "lost_phone", label: "携帯をなくした・番号が変わった と言われた", fragment: "携帯電話をなくして番号が変わったと言われ、その後お金の話が出た" },
  { id: "invest", label: "投資すればもうかる と言われた", fragment: "投資すれば必ずもうかると勧誘された" },
  { id: "probe", label: "家族構成やお金のことを聞かれた", fragment: "在宅時間・家族構成・自宅にある現金など、お金や暮らしのことをあれこれ聞かれた" },
  { id: "other", label: "その他・よくわからない", fragment: "内容ははっきりしないが、不審に感じる話をされた" },
];

export const PRESSURE_CHOICES: PhoneChoice[] = [
  { id: "yes", label: "はい、急がされた・口止めされた", fragment: "今日中に・今すぐと急がされたり、誰にも話さないよう口止めされた" },
  { id: "no", label: "いいえ", fragment: "特に急がされてはいない" },
  { id: "unsure", label: "よくわからない", fragment: "急がされたかどうかははっきりしない" },
];

/** 統計に記録できる「名乗られた組織」のID一覧 */
export const CLAIMED_ORG_IDS: string[] = WHO_CHOICES.map((c) => c.id);
