// UI共有型。src/lib側の型と整合を保つ（判定APIのレスポンス形）

export type RiskLevel = "high" | "caution" | "low";
export type ActionId = "hang_up" | "ignore_block" | "consult_9110" | "consult_188" | "call_110";

export interface JudgeResponse {
  risk: RiskLevel;
  technique: string;
  techniqueLabel: string;
  evidence: string[];
  actions: ActionId[];
}

export interface SourceInfo {
  name: string;
  provider: string;
  url: string;
  fetchedAt: string;
  period: string | null;
  note: string;
}

export interface MuniStat {
  code: number;
  name: string;
  d1Name: string;
  pop65: number;
  popTotal: number;
  sagiCurrent: number;
  sagiPrevYear: number;
  riskIndex: number | null;
  riskIndexPrevYear: number | null;
  riskIndexAll: number | null;
  riskIndexAllPrevYear: number | null;
}

export interface StatsJson {
  _seed?: { isSeed: boolean; label: string };
  generatedAt: string;
  sagiDefinition: string;
  sources: { d1Current: SourceInfo; d1PrevYear: SourceInfo; d3: SourceInfo };
  tokyoTotal: {
    sagiCurrent: number;
    sagiPrevYear: number;
    currentPeriod: string | null;
    prevYearPeriod: string | null;
  };
  municipalities: MuniStat[];
}

export interface Contact {
  municipality: string;
  name: string;
  phone: string;
  hours: string;
  address: string;
  notes: string;
  facilityType: string;
}

export interface ContactsJson {
  _seed?: { isSeed: boolean; label: string };
  source: SourceInfo;
  contacts: Contact[];
}

export interface TownRank {
  name: string;
  sagi: number;
}

export interface TownsJson {
  _seed?: { isSeed: boolean; label: string };
  note: string;
  source: SourceInfo;
  municipalities: Record<string, TownRank[]>;
}

export interface TechniqueDef {
  id: string;
  name: string;
  summary: string;
  typical_phrases: string[];
  target_situation: string;
  first_action: string;
}

export interface TechniquesJson {
  _source: string;
  _d1_note: string;
  techniques: TechniqueDef[];
}
