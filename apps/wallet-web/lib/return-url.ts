/**
 * 돌아갈 곳을 모를 때의 기본값. wallet-web 은 결제 전용이라 자기 루트(UI 데모 페이지)로
 * 보내면 «아무 데도 아닌 곳»에 떨구는 셈이다. 고객이 온 곳은 언제나 스토어프론트다.
 */
// 배포(services.ts)가 주입하는 이름은 NEXT_PUBLIC_STOREFRONT_URL 이다. _ORIGIN 만 읽던
// 동안 라이브에서는 늘 undefined 라 '/'(wallet-web 루트)로 떨어졌다 — 로고 링크와
// returnUrl fallback 이 storefront 가 아닌 곳으로 갔다. 두 이름을 모두 받는다.
export const STOREFRONT_ORIGIN =
  process.env.NEXT_PUBLIC_STOREFRONT_URL ?? process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? '/';

// safeReturnUrl 은 상대경로를 그대로 돌려주고 기본값도 '/' 라, 여기로 절대 URL 이 아닌 값이
// 들어온다. new URL(상대경로) 는 던지므로 base 를 붙여 파싱하고 상대경로면 상대경로로 돌려준다.
const RELATIVE_BASE = 'http://relative.invalid';

export function buildReturnUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl, RELATIVE_BASE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.origin === RELATIVE_BASE ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

function parseList(env: string | undefined): string[] {
  return (env ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * wallet-web 자기 origin (OIDC_REDIRECT_URI 에서 추출). access-token 모듈의 selfOrigin 과 동일하지만,
 * 그쪽은 'server-only' 를 import 해 순수 유틸에서 쓰면 테스트/번들이 깨지므로 여기서 로컬 계산한다.
 */
function selfOriginFromEnv(): string | undefined {
  const redirectUri = process.env.OIDC_REDIRECT_URI;
  if (!redirectUri) return undefined;
  try {
    return new URL(redirectUri).origin;
  } catch {
    return undefined;
  }
}

/**
 * 복귀 URL 오픈 리다이렉트 가드. returnUrl 은 storefront(별도 서브도메인)로 돌아가는 의도된
 * cross-origin 이지만, public URL 로 직접 진입하면 임의 외부 URL 로 튕길 수 있다. 허용 조건:
 *   1) 상대경로 (프로토콜-상대 //host 제외)
 *   2) wallet-web 자기 origin
 *   3) `WALLET_ALLOWED_RETURN_ORIGINS` 명시 allowlist (origin 완전일치)
 *   4) `ALLOWED_RETURN_HOST_SUFFIXES` 소유 도메인 suffix (apex·서브도메인 허용)
 * 그 외는 fallback 으로 떨군다 (fail-closed). 도메인을 코드에 하드코딩하지 않는다 — public-suffix
 * (co.kr 등) 추정 없이 배포 env 로만 신뢰 도메인을 지정한다. cross-origin storefront 복귀가
 * 필요하면 배포에서 (3) 또는 (4) 를 반드시 설정해야 한다. (Next searchParams 는 이미 디코딩됨.)
 */
export function safeReturnUrl(returnUrl: string | undefined | null, fallback = '/'): string {
  if (!returnUrl) return fallback;
  // 상대경로 허용. 단, 두 번째 문자가 '/' 또는 '\' 인 경우는 차단한다 — '//host' 는 프로토콜-상대
  // URL 이고, '/\host'(및 백슬래시 변형)는 WHATWG URL 파서가 '//host' 로 정규화해 외부로 이탈한다.
  if (returnUrl.startsWith('/') && !/^\/[/\\]/.test(returnUrl)) return returnUrl;

  let target: URL;
  try {
    target = new URL(returnUrl);
  } catch {
    return fallback;
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return fallback;

  // wallet-web 자기 origin
  const self = selfOriginFromEnv();
  if (self && target.origin === self) return returnUrl;

  // 명시 origin allowlist
  if (parseList(process.env.WALLET_ALLOWED_RETURN_ORIGINS).includes(target.origin)) return returnUrl;

  // 소유 도메인 suffix (env 로 명시된 것만; 기본값 없음)
  const host = target.hostname.toLowerCase();
  for (const suffix of parseList(process.env.ALLOWED_RETURN_HOST_SUFFIXES)) {
    const bare = (suffix.startsWith('.') ? suffix.slice(1) : suffix).toLowerCase();
    if (host === bare || host.endsWith(`.${bare}`)) return returnUrl;
  }

  return fallback;
}

/**
 * returnUrl 로 «나간다». next/navigation 의 router 는 같은 앱 안에서만 이동하므로
 * storefront 처럼 다른 origin 인 returnUrl 을 넘기면 아무 일도 일어나지 않는다.
 */
export function leaveToReturnUrl(url: string): void {
  window.location.replace(url);
}
