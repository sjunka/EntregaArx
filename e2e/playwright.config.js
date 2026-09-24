import { defineConfig } from '@playwright/test'

// Corre contra docker compose (`docker compose up -d --build` en la raíz). La clave demo sale de ../.env.
try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch { /* en CI llega por entorno */ }

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:4173/', locale: 'es-CO', trace: 'retain-on-failure' },
})
