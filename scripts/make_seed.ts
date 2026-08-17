// B-4: data/cache/ の生成物を data/seed/ にスナップショット固定する。
// seedはオフラインデモモード用。UIでseedを使う際は「サンプルデータ」と明示表示する（CLAUDE.mdルール4）。

import path from "node:path";
import { CACHE_DIR, SEED_DIR, readJson, writeJson } from "./lib/opendata.ts";

function main(): void {
  for (const file of ["stats.json", "contacts.json", "towns.json"]) {
    const src = path.join(CACHE_DIR, file);
    const data = readJson<Record<string, unknown>>(src);
    // シード識別メタデータを付与（実データと混同しないため。UIはこのフラグで「サンプルデータ」表示を出す）
    const seeded = {
      _seed: {
        isSeed: true,
        label: "サンプルデータ",
        snapshotAt: new Date().toISOString(),
        note: "オフラインデモ用スナップショット。表示時は必ず「サンプルデータ」と明示すること。",
      },
      ...data,
    };
    const dest = path.join(SEED_DIR, file);
    writeJson(dest, seeded);
    console.log(`seed固定: ${dest}`);
  }
}

main();
