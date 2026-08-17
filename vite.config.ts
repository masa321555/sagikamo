import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { devApiPlugin } from "./src/server/dev_api.ts";

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  server: { port: 5173, host: true }, // host: true で同一LAN内の実機からアクセス可能にする
  // maplibre-glはimport.meta.url経由でWorkerを生成するため、事前バンドルするとWorkerチャンクが404になる
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
