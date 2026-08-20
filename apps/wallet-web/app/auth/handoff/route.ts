import { NextResponse, type NextRequest } from 'next/server';

import { unsealMedusaToken } from '@/lib/auth/handoff-seal';
import { exchangeHandoffForTokens } from '@/lib/auth/oidc-client';
import { writeCheckoutHandoffCookies, writeSessionCookies } from '@/lib/auth/session-cookies';

/**
 * storefront → wallet-web 결제 진입 핸드오프 착지점.
 *
 * storefront 가 인증된 고객에게 발급받은 단기 핸드오프 토큰(`h`)을 confidential client 인증과 함께
 * 교환해 wallet-web 자기 세션 쿠키를 발급한 뒤 원래 결제 경로로 1홉 복귀한다.
 *
 * 별도 서브도메인에서 OIDC silent-SSO / 부모도메인 쿠키 공유에 의존하던 기존 경로는 인앱브라우저·
 * iOS Safari(ITP) 에서 쿠키 격리/소실로 깨졌다. 핸드오프는 토큰을 first-party URL 로 전달하고
 * wallet-web 이 자기 호스트 쿠키를 직접 박으므로 그 환경에서도 동작한다.
 *
 * 토큰이 없거나 교환에 실패하면 기존 /auth/ensure (refresh → silent SSO) 폴백으로 떨어진다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.nextUrl.origin;
  const redirectTo = sanitizeInternalRedirect(request.nextUrl.searchParams.get('redirect_to'));
  const handoffToken = request.nextUrl.searchParams.get('h');

  if (!handoffToken) {
    return ensureFallback(origin, redirectTo);
  }

  let tokens;
  try {
    tokens = await exchangeHandoffForTokens(handoffToken);
  } catch {
    // 핸드오프 토큰 만료/무효 → 기존 세션 복구 경로로.
    return ensureFallback(origin, redirectTo);
  }

  const response = NextResponse.redirect(new URL(redirectTo, origin));
  writeSessionCookies(response.cookies, tokens);
  return response;
}

/**
 * 체크아웃 핸드오프 착지점 (POST).
 *
 * storefront 브릿지(`/{cc}/checkout`)가 자동제출 폼으로 보낸다. GET 과 달리 medusa 고객 토큰과
 * 카트 id 를 같이 받아야 하는데, 이 둘을 쿼리스트링에 실으면 브라우저 히스토리·서버 액세스 로그·
 * Referer 에 남는다. 폼 본문으로 받으면 그 노출이 없다.
 *
 * `medusa_jwt` 는 원문이 아니라 storefront 가 봉인한 값이다(60초, 카트 바인딩). 원문을 폼으로
 * 보내면 30일짜리 로그인 세션이 DOM 에 그대로 노출된다. 여기서 열어 쿠키에 넣는다.
 *
 * 열린 토큰의 진위는 검증하지 않는다 — wallet-web 은 Medusa 서명키를 모르고 알 필요도 없다.
 * Bearer 로 전달하면 Medusa 가 검증하고 위조면 401 이다. 세션 발급 권한 자체는
 * `h`(120초 1회용, confidential client 시크릿이 있어야 교환 가능)가 통제한다.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.nextUrl.origin;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return ensureFallback(origin, CHECKOUT_PATH);
  }

  const handoffToken = readField(form, 'h');
  if (!handoffToken) {
    return ensureFallback(origin, CHECKOUT_PATH);
  }

  // 카트 없이 세션만 발급하면 /checkout 이 다시 storefront 로 돌려보내 왕복만 늘어난다.
  const cartId = readField(form, 'cart_id');
  if (!cartId) {
    return ensureFallback(origin, CHECKOUT_PATH);
  }

  let tokens;
  try {
    tokens = await exchangeHandoffForTokens(handoffToken);
  } catch {
    return ensureFallback(origin, CHECKOUT_PATH);
  }

  // 303: 이 응답 이후 히스토리에 남는 것은 GET 이다. 뒤로가기·새로고침이 POST 를 재제출하지 않는다.
  const response = NextResponse.redirect(new URL(CHECKOUT_PATH, origin), 303);
  writeSessionCookies(response.cookies, tokens);
  writeCheckoutHandoffCookies(response.cookies, {
    // 봉투가 만료·위조·카트 불일치면 null. 토큰 없이 진행하면 /checkout 이 막고 재핸드오프한다.
    medusaJwt: unsealMedusaToken(readField(form, 'medusa_jwt'), cartId) ?? '',
    cartId,
    region: normalizeRegion(readField(form, 'region')),
  });
  return response;
}

const CHECKOUT_PATH = '/checkout';

/** region 은 이후 URL 경로 조립과 locale 결정에 쓰인다. 형식을 벗어나면 기본값으로 떨어뜨린다. */
function normalizeRegion(value: string): string {
  const region = value.trim().toLowerCase();
  return /^[a-z]{2}$/.test(region) ? region : 'kr';
}

function readField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function ensureFallback(origin: string, redirectTo: string): NextResponse {
  const ensure = new URL('/auth/ensure', origin);
  ensure.searchParams.set('redirect_to', redirectTo);
  return NextResponse.redirect(ensure);
}

function sanitizeInternalRedirect(value: string | null): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}
