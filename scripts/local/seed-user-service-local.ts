/**
 * 로컬 user_service DB 에 reference 시드(역할·스코프·admin 계정·OAuth 클라이언트)를 적용한다.
 *
 * `npm run db:seed:ref` 는 SST/AWS 에서 배포 설정을 읽어 DB URL 을 해석하므로 로컬에서는 못 쓴다.
 * 이 스크립트는 같은 `UserServiceSeedStep` 을 로컬 DATABASE_URL 로 직접 돌린다 — 시드 정의가
 * 한 곳(정본)에 남아 로컬과 라이브가 갈리지 않는다.
 *
 * 사용: npm run db:seed:user-service:local
 * 절차 전체는 docs/local-dev.md 의 "전체 스택 로컬 구동" 절.
 */
import { UserServiceSeedStep } from '../seeding/steps/user-service.seed-step';

const LOCAL_PG = process.env.LOCAL_PG ?? 'postgresql://postgres:postgres@localhost:5432';
const DATABASE_URL = process.env.USER_SERVICE_DATABASE_URL ?? `${LOCAL_PG}/user_service`;

// 로컬 전용 고정값. 라이브 시크릿과 무관하다.
const ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD ?? 'Rehearsal1234!';
// 로컬 RP 3개가 공유하는 평문 secret. 각 앱 .env 의 OIDC_CLIENT_SECRET 과 같아야 한다.
// 시드는 멱등이라 이미 있는 client 의 secret 은 보존한다(덮어쓰지 않는다).
const LOCAL_CLIENT_SECRET =
  process.env.LOCAL_OIDC_CLIENT_SECRET ?? 'local-rehearsal-medusa-storefront-secret';

if (!/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  throw new Error(`로컬 전용 스크립트다. DATABASE_URL 이 localhost 가 아니다: ${DATABASE_URL}`);
}

async function main(): Promise<void> {
  const step = new UserServiceSeedStep(DATABASE_URL, {
    adminPassword: ADMIN_PASSWORD,
    oauthClients: [
      {
        clientId: 'medusa-storefront',
        clientType: 'confidential',
        redirectUris: ['http://localhost:8000/kr/callback/oidc'],
        postLogoutRedirectUris: ['http://localhost:8000/kr'],
        allowedScopes: ['openid', 'profile', 'email'],
        clientSecret: LOCAL_CLIENT_SECRET,
      },
      {
        clientId: 'admin-web',
        clientType: 'confidential',
        redirectUris: ['http://localhost:8002/auth/callback'],
        postLogoutRedirectUris: ['http://localhost:8002/login'],
        allowedScopes: ['openid', 'profile', 'email', 'offline_access'],
        clientSecret: LOCAL_CLIENT_SECRET,
      },
      {
        clientId: 'wallet-web',
        clientType: 'confidential',
        redirectUris: ['http://localhost:3200/auth/callback'],
        postLogoutRedirectUris: ['http://localhost:3200'],
        allowedScopes: ['openid', 'profile', 'email'],
        clientSecret: LOCAL_CLIENT_SECRET,
      },
    ],
  });

  const before = await step.check();
  console.log('[check]', JSON.stringify(before, null, 2));
  const result = await step.apply();
  console.log('[apply]', JSON.stringify(result, null, 2));
  const after = await step.check();
  console.log('[recheck]', JSON.stringify(after, null, 2));
  await step.dispose();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
