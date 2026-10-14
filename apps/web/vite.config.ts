import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/web",
  worker: { format: "es" },
  build: { outDir: "../../dist/web", emptyOutDir: false },
  server: { proxy: { "/api": { target: "http://localhost:3000", ws: true } } },
});
