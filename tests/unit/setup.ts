// Ambiente dos testes de integração: banco Postgres dedicado (NUNCA o de produção).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://invictus:devpass@localhost:5432/invictus_test";
process.env.APP_SECRET = "test-secret";
process.env.APP_URL = "http://localhost:3000";
process.env.MP_ACCESS_TOKEN = "TEST-unit";
process.env.MP_WEBHOOK_SECRET = "unit-webhook-secret";
process.env.LOG_SILENT = "1";
