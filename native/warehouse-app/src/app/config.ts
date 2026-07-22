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

// 백엔드 토큰 수용 방식(검증 §13.1). 오늘 백엔드는 쿠키를 읽으므로 기본 'cookie',
// Bearer 수용이 확인되면 VITE_API_AUTH_MODE=bearer 로 전환.
const rawAuthMode = import.meta.env.VITE_API_AUTH_MODE;
export const apiAuthMode: 'bearer' | 'cookie' =
  rawAuthMode === 'bearer' ? 'bearer' : 'cookie';
