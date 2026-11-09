import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` só faz sentido dentro do Next.js.
      "server-only": path.resolve(import.meta.dirname, "tests/unit/empty.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Os testes compartilham um banco Postgres; rodar em série evita interferência.
    fileParallelism: false,
    setupFiles: ["tests/unit/setup.ts"],
    globalSetup: ["tests/unit/global-setup.ts"],
    testTimeout: 20000,
  },
});
