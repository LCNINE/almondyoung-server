import type { OidcConfig } from '../core/auth/oidc';

// These come from build-time env (VITE_*) in Phase 0. A settings screen can
// override them at runtime in a later phase (spec §9).
export const oidcConfig: OidcConfig = {
  issuer: import.meta.env.VITE_OIDC_ISSUER ?? '',
  authorizationEndpoint: import.meta.env.VITE_OIDC_AUTHORIZE ?? '',
  clientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? 'warehouse-app',
  redirectUri: 'almondwms://oauth/callback',
  scope: 'openid profile email offline_access',
};

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

// 백엔드 토큰 수용 방식(§13.1 확정). core JWT strategy 는 Bearer 헤더와 cookie(accessToken)
// 둘 다 추출하지만, 네이티브 plugin-http(Fetch 모방)는 `Cookie` 를 Fetch **금지 요청 헤더**로
// 스킵한다("Skipping cookie header … forbidden header per fetch spec") → cookie 모드는
// 네이티브에서 자격증명을 전혀 전달하지 못해 401. 그래서 기본 'bearer'.
// (Authorization 은 금지 헤더가 아님. 특수 컨텍스트에서 강제하려면 VITE_API_AUTH_MODE=cookie.)
const rawAuthMode = import.meta.env.VITE_API_AUTH_MODE;
export const apiAuthMode: 'bearer' | 'cookie' =
  rawAuthMode === 'cookie' ? 'cookie' : 'bearer';
