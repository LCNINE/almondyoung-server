import { defineConfig, devices } from 'playwright/test';

/**
 * 개별 배송비 그룹 표시 E2E 설정.
 *
 * 백엔드는 실제 로컬 Medusa(:9000)다 — 배송비 그룹·정책·확정 금액이 전부 서버에서 오고,
 * 체크아웃 분해는 cart.shipping_methods 확정값에 의존하므로 스텁으로는 진짜를 못 본다.
 * Medusa 와 스토어프론트 dev 서버는 러너 스크립트(run.sh)가 확인/기동한다.
 *
 * dev 서버가 라우트를 처음 밟을 때 컴파일하므로 타임아웃을 넉넉히 잡는다.
 */
export default defineConfig({
  testDir: '.',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
    navigationTimeout: 120_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
