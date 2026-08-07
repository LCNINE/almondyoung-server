import { SetMetadata } from '@nestjs/common';

export const IS_STORE_ROUTE_KEY = 'is_store_route';

/**
 * 로그인한 **일반 고객**(쇼핑몰 이용자)이 부르는 라우트임을 표시한다.
 *
 * `AdminRealmGuard` 는 표시가 없는 라우트를 직원 전용(admin/master)으로 간주하므로,
 * 고객 대상 엔드포인트에는 이 데코레이터가 반드시 필요하다. 인증 자체는 여전히
 * `JwtAuthGuard` 가 요구한다 — 이 표시는 "인증은 하되 직원 역할은 요구하지 않는다"는 뜻이지
 * `@Public()` 처럼 인증을 면제하지 않는다.
 *
 * 표시된 라우트는 **호출자 본인 소유의 리소스만** 다뤄야 한다. 소유권 검사(예: 주문의
 * userId 대조)는 이 데코레이터가 해주지 않으므로 서비스 계층에서 직접 해야 한다.
 */
export const StoreRoute = () => SetMetadata(IS_STORE_ROUTE_KEY, true);
