/**
 * 쿠팡 Zod 스키마 통합 Export
 *
 * 모든 쿠팡 도메인의 Zod 스키마를 한 곳에서 export합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */

// 공통
export * from './coupang-common.zod';

// 도메인별
export * from './coupang-order.zod';
export * from './coupang-return.zod';
export * from './coupang-exchange.zod';
export * from './coupang-product.zod';
