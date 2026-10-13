import type { Permission } from '@permission-catalog';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface Rule { readonly method: HttpMethod; readonly pattern: string; readonly anyOf: readonly Permission[] }

const rule = (method: HttpMethod, pattern: string, ...anyOf: Permission[]): Rule => ({ method, pattern, anyOf });

/**
 * Medusa 는 사용자 토큰이 아니라 공유 키로 불리므로 넘기기 전에 여기서 판정한다.
 * 조회 권한은 그 경로를 부르는 화면의 진입 권한과 같게 둔다. 표에 없는 경로는 거부한다.
 * admin-web 이 실제로 부르는 조합만 적는다 — 부르지 않는 조합은 열지 않는다(`medusa-coverage.spec.ts` 가 양방향으로 지킨다).
 */
export const MEDUSA_PERMISSIONS: readonly Rule[] = [
  rule('GET', 'admin/customers', 'customer.profile.read', 'marketing.promotion.read'),
  rule('GET', 'admin/customers/:id', 'customer.profile.read', 'marketing.promotion.read'),
  rule('GET', 'admin/customers/by-almond-user/:id', 'customer.profile.read', 'marketing.promotion.read'),
  rule('GET', 'admin/customers/:id/cart', 'customer.profile.read'),
  rule('POST', 'admin/customers/:id/addresses', 'customer.profile.write'),
  rule('POST', 'admin/customers/:id/addresses/:addressId', 'customer.profile.write'),
  rule('DELETE', 'admin/customers/:id/addresses/:addressId', 'customer.profile.write'),
  rule('GET', 'admin/orders', 'order.order.read'),
  rule('GET', 'admin/orders/:id', 'order.order.read'),
  rule('GET', 'admin/products', 'catalog.product.read', 'marketing.promotion.read'),
  rule('GET', 'admin/collections', 'catalog.product.read', 'marketing.promotion.read'),
  rule('GET', 'admin/product-categories', 'catalog.product.read', 'marketing.promotion.read'),
  rule('GET', 'admin/customer-groups', 'marketing.promotion.read'),
  rule('GET', 'admin/price-lists', 'marketing.promotion.read'),
  rule('GET', 'admin/promotions', 'marketing.promotion.read'),
  rule('POST', 'admin/promotions', 'marketing.promotion.write'),
  rule('GET', 'admin/promotions/:id', 'marketing.promotion.read'),
  rule('POST', 'admin/promotions/:id', 'marketing.promotion.write'),
  rule('DELETE', 'admin/promotions/:id', 'marketing.promotion.write'),
  rule('GET', 'admin/promotions/:id/customers', 'marketing.promotion.read'),
  rule('POST', 'admin/promotions/:id/customers', 'marketing.promotion.write'),
  rule('DELETE', 'admin/promotions/:id/customers', 'marketing.promotion.write'),
  rule('GET', 'admin/campaigns', 'marketing.promotion.read'),
  rule('POST', 'admin/campaigns', 'marketing.promotion.write'),
  rule('GET', 'admin/campaigns/:id', 'marketing.promotion.read'),
  rule('POST', 'admin/campaigns/:id', 'marketing.promotion.write'),
  rule('DELETE', 'admin/campaigns/:id', 'marketing.promotion.write'),
  rule('GET', 'admin/coupon-events', 'marketing.promotion.read'),
  rule('POST', 'admin/coupon-events', 'marketing.promotion.write'),
  rule('GET', 'admin/coupon-events/:id', 'marketing.promotion.read'),
  rule('POST', 'admin/coupon-events/:id', 'marketing.promotion.write'),
  rule('DELETE', 'admin/coupon-events/:id', 'marketing.promotion.write'),
  rule('GET', 'admin/time-sales', 'marketing.promotion.read'),
  rule('POST', 'admin/time-sales', 'marketing.promotion.write'),
  rule('GET', 'admin/time-sales/:id', 'marketing.promotion.read'),
  rule('POST', 'admin/time-sales/:id', 'marketing.promotion.write'),
  rule('DELETE', 'admin/time-sales/:id', 'marketing.promotion.write'),
  rule('GET', 'admin/time-sale-settings', 'marketing.promotion.read'),
  rule('POST', 'admin/time-sale-settings', 'marketing.promotion.write'),
  rule('GET', 'admin/regions', 'system.region.read'),
  rule('POST', 'admin/regions', 'system.region.write'),
  rule('GET', 'admin/regions/:id', 'system.region.read'),
  rule('POST', 'admin/regions/:id', 'system.region.write'),
  rule('DELETE', 'admin/regions/:id', 'system.region.write'),
  rule('GET', 'admin/price-preferences', 'system.region.read'),
  rule('POST', 'admin/price-preferences', 'system.region.write'),
  rule('POST', 'admin/price-preferences/:id', 'system.region.write'),
  rule('GET', 'admin/shipping-groups', 'system.shipping_profile.read', 'catalog.product.read'),
  rule('POST', 'admin/shipping-groups', 'system.shipping_profile.write'),
  rule('POST', 'admin/shipping-groups/:code', 'system.shipping_profile.write'),
  rule('DELETE', 'admin/shipping-groups/:code', 'system.shipping_profile.write'),
  rule('GET', 'admin/shipping-area-templates', 'system.shipping_profile.read'),
  rule('POST', 'admin/shipping-area-templates', 'system.shipping_profile.write'),
  rule('DELETE', 'admin/shipping-area-templates/:code', 'system.shipping_profile.write'),
];

function matches(pattern: string, path: readonly string[]): boolean {
  const parts = pattern.split('/');
  return parts.length === path.length && parts.every((part, i) => part.startsWith(':') || part === path[i]);
}

/** 판정한 경로와 전달하는 경로가 같아야 하므로 경로 세그먼트는 허용 문자만 받는다(빈 값·점 세그먼트 제외). */
const SAFE_SEGMENT = /^[A-Za-z0-9_\-:@~.]+$/;
const isSafeSegment = (segment: string) => SAFE_SEGMENT.test(segment) && segment !== '.' && segment !== '..';

/** 표에 없으면 null — 프록시는 거부한다. 같은 길이에서 고정 세그먼트가 많은 규칙이 이긴다. */
export function requiredForMedusa(method: string, path: readonly string[]): readonly Permission[] | null {
  if (!path.every(isSafeSegment)) return null;
  const hits = MEDUSA_PERMISSIONS.filter((r) => r.method === method.toUpperCase() && matches(r.pattern, path));
  if (hits.length === 0) return null;
  const fixed = (r: Rule) => r.pattern.split('/').filter((p) => !p.startsWith(':')).length;
  return [...hits].sort((a, b) => fixed(b) - fixed(a))[0].anyOf;
}
