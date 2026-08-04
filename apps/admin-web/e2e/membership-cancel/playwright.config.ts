import { defineConfig, devices } from 'playwright/test';

/**
 * 관리자 해지·환불 UI E2E 설정.
 *
 * 인증은 admin-web 의 BYPASS_AUTH=true 로 우회한다(러너가 주입). 스텁/dev 서버는 러너가 관리한다.
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4800',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
