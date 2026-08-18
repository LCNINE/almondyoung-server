import { defineConfig, devices } from 'playwright/test';

/**
 * 멤버십 가격 캐시 분리 E2E 설정.
 *
 * 로컬 Medusa(:9000)와 스토어프론트(:8000)는 러너 스크립트가 띄운다. 쿠키는 시나리오마다
 * 다르게 넣어야 해서 storageState 를 전역으로 두지 않고 테스트가 직접 context 를 만든다.
 */
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
