import { SetMetadata } from '@nestjs/common';

export const IS_SERVICE_KEY_ROUTE_KEY = 'is_service_key_route';

/**
 * 서비스 고유 내부 키(`MEMBERSHIP_INTERNAL_KEY` 등)로 들어오는 서버 간 라우트. 그 키는 여러 테넌트를 섬기는 호출자
 * (core 등)도 쥐므로 테넌트를 말하지 못한다 — «T 만 섬김» 앱의 문은 이 표식이 붙은 라우트에 테넌트 헤더를 요구한다.
 *
 * 분류·인증 표식이 아니다. 키 검사는 그 앱의 가드나 핸들러가 하고, 전역 인증 면제는 `@Public()` 이 한다.
 * `@InternalOnly()` 는 이 표식을 스스로 단다. 어느 라우트가 달아야 하는지는 `scripts/security/permission-wiring.spec.ts`.
 */
export const ServiceKeyRoute = () => SetMetadata(IS_SERVICE_KEY_ROUTE_KEY, true);
