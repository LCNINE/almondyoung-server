import { NextResponse, type NextRequest } from 'next/server';

import { selfOrigin } from '../../../lib/auth/access-token';
import { sanitizeInternalRedirect } from '../../../lib/auth/internal-redirect';
import { createAuthorizationRequest } from '../../../lib/auth/oidc-client';
import { writeStateCookie } from '../../../lib/auth/session-cookies';

/**
 * storefront → wallet-web 진입점.
 *
 * 쇼핑몰이 지금 로그인한 고객을 보증하게 한다. state·PKCE verifier·nonce 를 이 브라우저의 쿠키에 두고
 * 쇼핑몰 `/api/wallet-handoff` 로 보내면, 쇼핑몰이 자기 세션 계정 몫의 인가 코드를 받아 `/auth/callback`
 * 으로 돌려보낸다. 콜백은 /login 과 같은 검증(state·PKCE·nonce)을 거치므로 남이 받은 코드를 이 브라우저에
 * 심을 수 없고, 코드는 한 번만 교환된다. 쇼핑몰 세션이 없으면 콜백이 login_required 를 받아 /login 으로 간다.
 *
 * 남아 있는 wallet-web 세션은 쓰지 않는다. 쇼핑몰에서 계정을 전환한 브라우저에서는 그 세션이 이전 계정이다.
 */
export function GET(request: NextRequest): NextResponse {
  const redirectTo = sanitizeInternalRedirect(request.nextUrl.searchParams.get('redirect_to'));
  const storefrontOrigin = process.env.STOREFRONT_ORIGIN;

  if (!storefrontOrigin) {
    // 쇼핑몰 주소를 모르면 보증받을 곳이 없으니 IdP 의 지금 계정으로 다시 로그인한다.
    const login = new URL('/login', selfOrigin() ?? request.nextUrl.origin);
    login.searchParams.set('redirect_to', redirectTo);

    return NextResponse.redirect(login);
  }

  const handoffUrl = new URL('/api/wallet-handoff', storefrontOrigin).toString();
  const { authorizeUrl, stateRecord } = createAuthorizationRequest(redirectTo, 'none', handoffUrl);
  const response = NextResponse.redirect(authorizeUrl);
  writeStateCookie(response.cookies, stateRecord);

  return response;
}
