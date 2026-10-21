import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Os builds de PRODUÇÃO do React não exportam `act` (apenas o de desenvolvimento), e o
// ambiente pode herdar NODE_ENV=production — o que faz react-dom/test-utils falhar com
// "React.act is not a function". Fixamos o modo de teste aqui, no processo principal,
// antes de o Vite resolver os módulos (é o mesmo default que o Vitest aplica quando
// NODE_ENV está ausente).
process.env["NODE_ENV"] = "test";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
