import { SetMetadata } from '@nestjs/common';

export const IS_KEY_AUTH_ROUTE_KEY = 'is_key_auth_route';

/**
 * 사람 토큰이 아니라 그 앱의 가드가 검사하는 키(머천트 API 키 등)로 들어오는 라우트.
 *
 * 분류 표식일 뿐 인증을 면제하지 않는다. `JwtAuthGuard` 가 전역인 앱의 서비스 간 라우트는
 * 이 표식 대신 `@InternalOnly()` 를 쓴다 — 거기서는 이 표식만으론 401 이 난다.
 */
export const KeyAuthRoute = () => SetMetadata(IS_KEY_AUTH_ROUTE_KEY, true);
