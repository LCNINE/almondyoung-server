// RFC 8252 — public client의 redirect_uri 매칭.
// confidential client는 항상 정확 일치(RFC 6749).
// public client는 등록 URI가 loopback이면 임의 port를 허용.

import { ValidationOptions, registerDecorator } from 'class-validator';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', 'localhost']);

// 스킴 자체가 코드 실행이거나 네트워크 콜백이 될 수 없는 것들. redirect_uri 는 등록
// 화이트리스트와 exact match 로만 쓰이지만, 등록 단계에서 미리 막는다.
const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']);

/**
 * redirect_uri 로 허용되는 값인지 검사한다.
 *
 * class-validator 의 `@IsUrl` 을 쓸 수 없다 — validator.js 기본값이
 * `protocols: ['http','https','ftp']` 라 네이티브 앱의 private-use 스킴
 * (RFC 8252 §7.1, 예: `almondyoung://oauth/callback`)을 거부한다. 실제로 이 때문에
 * 앱 로그인이 `/oauth/issue-code` 에서 400 으로 죽었다. loopback(`http://127.0.0.1/...`)을
 * 쓰는 물류앱은 http 라 통과해서 구멍이 오래 드러나지 않았다.
 *
 * 허용: 절대 http(s) URL, 또는 RFC 3986 문법을 만족하는 private-use 스킴 URI.
 * 거부: 상대경로/비-URI, 위험한 스킴, fragment 포함(RFC 6749 §3.1.2 는 redirect
 *       endpoint 에 fragment 를 금지한다).
 */
export function isValidRedirectUri(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;

  const url = tryParse(value);
  if (!url) return false;
  if (url.hash) return false;
  if (DANGEROUS_SCHEMES.has(url.protocol.toLowerCase())) return false;

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    // require_tld 는 강제하지 않는다 — localhost / 127.0.0.1 이 실제로 등록돼 있다.
    return url.hostname.length > 0;
  }

  // private-use 스킴. RFC 8252 는 reverse-DNS 를 권장하지만 강제하지 않으며,
  // Expo 기본 스킴은 점이 없다(`almondyoung`). 문법만 확인한다.
  return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol);
}

/** `redirect_uri` 필드용 class-validator 데코레이터. 배열 필드에는 `{ each: true }`. */
export function IsRedirectUri(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isRedirectUri',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isValidRedirectUri(value),
        defaultMessage: (args) =>
          `${args?.property} must be an absolute http(s) URL or a private-use scheme URI (RFC 8252), without a fragment`,
      },
    });
  };
}

function tryParse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

function isLoopback(url: URL): boolean {
  // url.hostname normalizes to lowercase; ::1 stays as `[::1]` in href but `hostname` strips brackets.
  return LOOPBACK_HOSTNAMES.has(url.hostname);
}

export function matchRedirectUri(
  registered: string,
  incoming: string,
  clientType: 'confidential' | 'public',
): boolean {
  if (registered === incoming) return true;
  if (clientType !== 'public') return false;

  const reg = tryParse(registered);
  const inc = tryParse(incoming);
  if (!reg || !inc) return false;

  // Loopback: scheme/host/path 동일 + port 무관.
  if (reg.protocol === 'http:' && isLoopback(reg) && inc.protocol === 'http:' && isLoopback(inc)) {
    return reg.hostname === inc.hostname && reg.pathname === inc.pathname;
  }

  // Custom scheme(예: com.example.app:/callback) — exact match만 허용(이미 위에서 비교됨).
  return false;
}

export function isRedirectUriRegistered(
  registeredList: string[],
  incoming: string,
  clientType: 'confidential' | 'public',
): boolean {
  return registeredList.some((reg) => matchRedirectUri(reg, incoming, clientType));
}
