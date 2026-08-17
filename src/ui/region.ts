// 2地点（自宅・実家）の選択状態。サーバー保存せずlocalStorageのみ（spec F-02）

export type RegionSlot = "home" | "jikka";

const KEYS: Record<RegionSlot, string> = {
  home: "sagikanchi.region.home",
  jikka: "sagikanchi.region.jikka",
};

export function getRegion(slot: RegionSlot): number | null {
  const v = localStorage.getItem(KEYS[slot]);
  return v ? Number(v) : null;
}

export function setRegion(slot: RegionSlot, code: number | null): void {
  if (code === null) localStorage.removeItem(KEYS[slot]);
  else localStorage.setItem(KEYS[slot], String(code));
}

export const SLOT_LABELS: Record<RegionSlot, string> = { home: "自宅", jikka: "実家" };
