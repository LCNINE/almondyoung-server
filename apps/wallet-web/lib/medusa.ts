import 'server-only';

import Medusa from '@medusajs/js-sdk';

import { getMedusaJwt } from './auth/session-cookies';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

/**
 * Medusa Store API 클라이언트. **서버사이드 전용**이다 — 자격증명이 httpOnly 쿠키에 있고,
 * 서버에서만 호출하는 덕분에 Medusa 의 STORE_CORS 에 wallet-web 을 넣지 않아도 된다.
 * 브라우저에서 부르는 코드가 섞이면 CORS 에러로 즉시 드러나므로 그대로 둔다.
 */
export const medusa = new Medusa({
  baseUrl: requireEnv('MEDUSA_URL'),
  debug: process.env.NODE_ENV === 'development',
  publishableKey: requireEnv('MEDUSA_PUBLISHABLE_KEY'),
  auth: { type: 'jwt' },
});

/**
 * storefront `lib/data/cookies.ts` 의 getAuthHeaders 대응물. 핸드오프로 받아둔 medusa 토큰을
 * Bearer 로 실어 준다.
 *
 * ⚠️ null 을 그냥 흘려보내면 안 된다. Medusa 의 membership-price-visibility 미들웨어는 비인증
 * 요청에 **조용히 비회원가**를 돌려주고(에러 없음), assigned 쿠폰도 말없이 거부된다. 호출부는
 * null 이면 체크아웃을 진행시키지 말고 storefront 로 되돌려 재핸드오프해야 한다.
 */
export async function getMedusaAuthHeaders(): Promise<{ authorization: string } | null> {
  const token = await getMedusaJwt();
  return token ? { authorization: `Bearer ${token}` } : null;
}
