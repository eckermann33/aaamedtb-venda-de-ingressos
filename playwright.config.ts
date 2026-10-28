import { defineConfig, devices } from "@playwright/test";
import { writeFakeCamera } from "./tests/e2e/fake-camera";

/**
 * Testes ponta a ponta: sobem o app (build de produção) + o simulador do Mercado Pago.
 * Requisitos: `npm run build` antes e um Postgres de teste (E2E_DATABASE_URL).
 */
const PORT = 3100;
const MOCK_PORT = 4110;
const APP_URL = `http://localhost:${PORT}`;
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://invictus:devpass@localhost:5432/invictus_e2e";
export const WEBHOOK_SECRET = "e2e-webhook-secret";
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

// Câmera falsa (vídeo com um QR Code) para testar o leitor da portaria.
const fakeCamera = writeFakeCamera();
const chromium = {
  launchOptions: {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${fakeCamera}`,
    ],
  },
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: APP_URL, trace: "retain-on-failure", ...chromium },
  projects: [{ name: "celular", use: { ...devices["Pixel 7"], ...chromium } }],
  webServer: [
    {
      command: `node tests/mock-mp/server.mjs`,
      url: `${MOCK_URL}/__mock/state`,
      env: { MOCK_MP_PORT: String(MOCK_PORT), APP_URL, MP_WEBHOOK_SECRET: WEBHOOK_SECRET },
      reuseExistingServer: false,
    },
    {
      command: `npx next start -p ${PORT}`,
      url: `${APP_URL}/api/health`,
      env: {
        DATABASE_URL: E2E_DB,
        APP_URL,
        APP_SECRET: "e2e-secret",
        MP_ACCESS_TOKEN: "TEST-e2e",
        MP_WEBHOOK_SECRET: WEBHOOK_SECRET,
        MP_API_BASE_URL: MOCK_URL,
        CRON_SECRET: "e2e-cron",
        LOG_SILENT: "1",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
