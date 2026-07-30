import { defineConfig, devices } from 'playwright/test';

/**
 * 멤버십 해지 UI E2E 설정.
 *
 * 백엔드 스텁(3000/3001/5001)과 스토어프론트 dev 서버(8000)는 러너 스크립트가 띄운다 —
 * 시나리오별로 스텁을 다시 띄워야 해서 webServer 옵션 대신 스크립트에서 관리한다.
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
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
    // 보호 경로(/mypage)는 미들웨어가 _medusa_jwt 로 막고, api() 는 accessToken 을 요구한다.
    storageState: {
      cookies: [
        {
          name: 'accessToken',
          value: process.env.E2E_TOKEN ?? '',
          domain: 'localhost',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
        {
          name: '_medusa_jwt',
          value: process.env.E2E_TOKEN ?? '',
          domain: 'localhost',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
