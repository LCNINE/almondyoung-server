import { redirect } from 'next/navigation';

import {
  createAuthorizationRequest,
  type OidcStateRecord,
} from '@/lib/auth/oidc-client';
import { setStateCookie } from '@/lib/auth/session-cookies';

/**
 * /login 진입점.
 *
 * wallet-web 은 storefront 의 부속 서비스 — 사용자는 거의 항상 storefront 에서 이미 로그인된
 * 상태로 진입한다. 그래서 default 동작은 `prompt=none` 으로 IdP 활성 세션이 있을 때 hub 를
 * 건너뛰고 즉시 코드를 발급받는 silent SSO. 활성 세션이 없으면 IdP 가 `error=login_required`
 * 로 회신하고 `/auth/callback` 가 `prompt` 없이 다시 이 페이지로 보낸다.
 *
 * Query:
 *   - `redirect_to`: 로그인 후 복귀할 wallet-web 내부 경로 (외부 URL 거부)
 *   - `prompt` (optional):
 *       - 미전송 → default 'none' (silent SSO)
 *       - 빈 문자열 → 어떤 prompt 도 보내지 않음 (auth-web default 동작 — 다중 계정이면 hub).
 *         callback 의 login_required fallback 이 이 모드로 재진입한다.
 *       - 'select_account' → 명시적 계정 전환
 *       - 'login' → 강제 재로그인
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string; prompt?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = sanitizeInternalRedirect(params.redirect_to);
  const prompt = resolvePrompt(params.prompt);

  const { authorizeUrl, stateRecord } = createAuthorizationRequest(redirectTo, prompt);
  await setStateCookie(stateRecord);

  redirect(authorizeUrl);
}

function sanitizeInternalRedirect(value: string | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}

function resolvePrompt(raw: string | undefined): OidcStateRecord['prompt'] {
  // 미전송: default 'none' (silent SSO 시도)
  if (raw === undefined) return 'none';
  // 빈 문자열: prompt 자체를 보내지 않음 (callback 의 login_required fallback)
  if (raw === '') return undefined;
  if (raw === 'none' || raw === 'login' || raw === 'select_account' || raw === 'consent') {
    return raw;
  }
  // 알 수 없는 값은 default 'none' 으로 안전하게 처리.
  return 'none';
}
