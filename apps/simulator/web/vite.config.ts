import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "../dist/web"),
    emptyOutDir: true,
    target: "es2022",
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8788" } },
});
