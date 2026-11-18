import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { expectOk, probe } from '../../tenancy/isolation-check/http';
import { signInAtSite } from '../../tenancy/staff-token';
import { REPO } from '../create-tenant/local-ports';
import { STOREFRONT_CALLBACK, TENANT_ONE, type OrderPathConfig } from './config';

/**
 * 주문 경로의 구매자 — 회원가입은 auth-web 과 같은 순서(인증문자 → 확인 → 가입)로, 인증번호는 sms-stub 이 받은 것을
 * user_service DB 에서 읽는다. 🔒 가짜 값이다(번호·이메일 모두 실재하지 않는 형식).
 */
export const BUYER = {
  loginId: 'e2eorderbuyer',
  password: 'E2eOrder1234!',
  email: 'e2e-order-buyer@example.com',
  username: '주문검증',
  nickname: '주문검증',
  birthday: '1990-01-01', // auth-web 이 보내는 꼴(YYYY-MM-DD). DTO 예시 '19900101' 은 Invalid Date → 가입 500 이다
  phoneNumber: '+821012341440',
} as const;

/** 한 번 넣으면 약 680건(1건 ≈ 14,500원). 같은 reason 이면 seed-points-local 이 스스로 건너뛴다. */
const POINT_AMOUNT = 10_000_000;
const POINT_REASON = 'E2E_ORDER_PATH';

export interface CustomerSession {
  medusaJwt: string;
  /** user-service 토큰 — wallet 결제(포인트)에 쓴다 */
  userServiceToken: string;
  email: string;
}

function userServiceSite(cfg: OrderPathConfig) {
  return { baseUrl: cfg.userServiceUrl, internalSecret: cfg.oauthInternalSecret };
}

async function signedInUserId(cfg: OrderPathConfig): Promise<string | null> {
  const r = await signInAtSite(userServiceSite(cfg), BUYER.loginId, BUYER.password, TENANT_ONE);
  if (r.status < 200 || r.status >= 300) return null;
  const session = (r.body as { data: { accessToken: string } }).data.accessToken;
  const me = (await expectOk('GET', `${cfg.userServiceUrl}/users/me`, { bearer: session })) as { data: { id: string } };
  return me.data.id;
}

async function latestCode(cfg: OrderPathConfig): Promise<string> {
  const sql = postgres(cfg.userServiceDbUrl, { max: 1, connection: { default_transaction_read_only: true } });
  try {
    const rows = await sql<{ code: string }[]>`
      select code from phone_verifications where phone_number = ${BUYER.phoneNumber}
      order by created_at desc limit 1`;
    if (!rows[0]) throw new Error(`인증번호가 user_service.phone_verifications 에 없다 — sms-stub(:3099)이 떠 있나?`);
    return rows[0].code;
  } finally {
    await sql.end();
  }
}

export async function ensureBuyer(cfg: OrderPathConfig, log: (line: string) => void = console.log) {
  let userId = await signedInUserId(cfg);
  if (!userId) {
    const us = (path: string) => `${cfg.userServiceUrl}${path}`;
    await expectOk('POST', us('/twilio/send-message'), {
      json: { countryCode: 'KR', phoneNumber: BUYER.phoneNumber, purpose: 'phone_verify', channel: 'SMS' },
    });
    await expectOk('POST', us('/twilio/verify-code'), {
      json: { code: await latestCode(cfg), phoneNumber: BUYER.phoneNumber },
    });
    await expectOk('POST', us('/auth/signup'), {
      json: {
        ...BUYER,
        isOver14: true,
        termsOfService: true,
        electronicTransaction: true,
        privacyPolicy: true,
        thirdPartySharing: true,
        marketingConsent: false,
      },
    });
    userId = await signedInUserId(cfg);
    if (!userId) throw new Error(`가입한 ${BUYER.loginId} 로 로그인이 안 된다`);
    log(`구매자를 가입시켰다: ${BUYER.loginId} (${userId})`);
  }
  execFileSync('npx', ['tsx', 'scripts/local/seed-points-local.ts'], {
    cwd: REPO,
    stdio: 'ignore',
    env: {
      ...process.env,
      LOCAL_POINT_LOGIN_IDS: BUYER.loginId,
      LOCAL_POINT_AMOUNT: String(POINT_AMOUNT),
      LOCAL_POINT_REASON: POINT_REASON,
    },
  });
  return { userId };
}

function jwtPayload(token: string): { actor_id?: string; app_metadata?: { customer_id?: string } } {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
    actor_id?: string;
    app_metadata?: { customer_id?: string };
  };
}

/**
 * 스토어프론트의 SSO 로그인(`web/almondyoung-storefront/src/lib/api/medusa/sso.ts`)을 브라우저 없이 따른다.
 * 로컬 Medusa 는 AUTH_WEB_URL 이 있어 customer 를 `user-service-sso` 로만 받는다(medusa-config.js) — 브라우저가
 * auth-web 에서 하던 «코드 발급»만 내부 secret 으로 대신한다(staff-token.ts 의 tokenForUser 와 같은 호출).
 */
export async function customerSession(cfg: OrderPathConfig, userId: string): Promise<CustomerSession> {
  const store = { 'x-publishable-api-key': cfg.publishableKey };
  const start = (await expectOk('POST', `${cfg.medusaUrl}/auth/customer/user-service-sso`, {
    headers: store,
    json: { callback_url: STOREFRONT_CALLBACK },
  })) as { location: string };
  const authorize = new URL(start.location);
  const state = authorize.searchParams.get('state');
  const codeChallenge = authorize.searchParams.get('code_challenge');
  if (!state || !codeChallenge) throw new Error(`SSO 시작 응답에 state·code_challenge 가 없다: ${start.location}`);

  const issued = (await expectOk('POST', `${cfg.userServiceUrl}/oauth/internal/issue-code`, {
    headers: { 'x-internal-secret': cfg.oauthInternalSecret },
    json: {
      clientId: authorize.searchParams.get('client_id') ?? 'medusa-storefront',
      userId,
      redirectUri: authorize.searchParams.get('redirect_uri') ?? STOREFRONT_CALLBACK,
      codeChallenge,
      codeChallengeMethod: authorize.searchParams.get('code_challenge_method') ?? 'S256',
      scope: authorize.searchParams.get('scope') ?? 'openid email profile',
    },
  })) as { code: string };

  const callback = (await expectOk(
    'GET',
    `${cfg.medusaUrl}/auth/customer/user-service-sso/callback?code=${encodeURIComponent(issued.code)}&state=${encodeURIComponent(state)}`,
    { headers: store },
  )) as { token: string; idp_tokens?: { access_token: string } };
  if (!callback.idp_tokens?.access_token) throw new Error('SSO 콜백에 idp_tokens 가 없다');

  let medusaJwt = callback.token;
  const payload = jwtPayload(medusaJwt);
  if (!payload.actor_id && !payload.app_metadata?.customer_id) {
    const created = await probe('POST', `${cfg.medusaUrl}/store/customers`, {
      bearer: medusaJwt,
      headers: store,
      json: { email: BUYER.email, metadata: { almond_user_id: userId, almond_login_id: BUYER.loginId } },
    });
    if (created.status < 200 || created.status >= 300) {
      throw new Error(`Medusa 고객 만들기 실패 ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    }
    const refreshed = (await expectOk('POST', `${cfg.medusaUrl}/auth/token/refresh`, {
      bearer: medusaJwt,
      headers: store,
    })) as { token: string };
    medusaJwt = refreshed.token;
  }
  return { medusaJwt, userServiceToken: callback.idp_tokens.access_token, email: BUYER.email };
}
