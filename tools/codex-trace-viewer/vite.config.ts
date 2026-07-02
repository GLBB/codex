import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  root: "web",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  test: {
    environment: "jsdom",
    setupFiles: ["../tests/setup.ts"],
    include: ["../tests/**/*.test.ts", "../tests/**/*.test.tsx"]
  }
});
