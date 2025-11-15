import { CookieSerializeOptions } from '@fastify/cookie';

interface CookieEnvironment {
  isRailway: boolean;
  isProd: boolean;
  corsOrigin: string;
}

/**
 * 환경에 맞는 쿠키 옵션을 생성합니다
 * @param env - 환경 설정 객체
 * @returns Fastify 쿠키 옵션
 */
export function getCookieOptions(
  env: CookieEnvironment,
): CookieSerializeOptions {
  const { isRailway, isProd, corsOrigin } = env;

  // 프론트엔드가 로컬 개발 환경인지 확인
  const isLocalFrontend =
    corsOrigin.includes('localhost') ||
    corsOrigin.includes('127.0.0.1') ||
    corsOrigin.startsWith('http://');

  const cookieOptions: CookieSerializeOptions = {
    path: '/',
    httpOnly: true,
    sameSite: isRailway && isLocalFrontend ? 'none' : 'lax', // Railway 환경이어도 프론트가 로컬이면 none
    secure: isRailway,
    // 프로덕션이고 로컬 프론트가 아닐 때만 domain 설정
    domain: isRailway ? '.railway.app' : undefined,

    // ...(isProd && !isLocalFrontend
    //   ? { domain: `.${getDomain(corsOrigin)}` }
    //   : {}),
  };

  return cookieOptions;
}

/**
 * URL에서 도메인을 추출합니다
 */
function getDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * 디버깅용 쿠키 정보를 로깅합니다
 */
export function logCookieDebugInfo(
  env: CookieEnvironment,
  cookieOptions: CookieSerializeOptions,
): void {
  console.log('🍪 쿠키 설정 디버깅:', {
    environment: {
      isRailway: env.isRailway,
      isProd: env.isProd,
      corsOrigin: env.corsOrigin,
    },
    cookieOptions,
  });
}
