import 'server-only';

import { headers } from 'next/headers';
import { cache } from 'react';

import { oidcEnv } from '../auth/env';
import { resolveSiteForHost } from './site-lookup';
import { oidcEndpointsFor, requestHostFrom, type AdminSite, type OidcEndpoints } from './site-rules';

/** 이 요청의 셸 — 서버 컴포넌트에서 요청 하나에 한 번. */
export const getAdminSite = cache(async (): Promise<AdminSite> => {
  const h = await headers();
  return resolveSiteForHost(requestHostFrom((name) => h.get(name)));
});

/** 라우트 핸들러용 — 그 요청의 셸. */
export function siteOfRequest(request: Request): Promise<AdminSite> {
  return resolveSiteForHost(requestHostFrom((name) => request.headers.get(name)));
}

/** 이 셸의 로그인·로그아웃 주소(중립 화면은 null). */
export function oidcEndpointsOf(site: AdminSite): OidcEndpoints | null {
  return oidcEndpointsFor(site, {
    authorizationUrl: oidcEnv.authorizationUrl,
    redirectUri: oidcEnv.redirectUri,
    postLogoutRedirectUri: oidcEnv.postLogoutRedirectUri,
  });
}


export { redirectOriginOf } from './site-rules';
