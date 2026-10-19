import type { Permission } from '@permission-catalog';
import type { MainMenu, MenuItem } from '../utils/menu';

/**
 * 화면 진입 권한의 정본. 메뉴·헤더 검색·모바일 메뉴는 이 표를 조회해 보이기를 정한다.
 *
 * 키는 화면 경로다(라우트 그룹 제외, 동적 세그먼트는 `[id]` 그대로). 상세·생성·편집 화면은
 * 가장 가까운 상위 경로를 물려받고, 다르면 따로 적는다. 진입 권한은 그 화면의 주 데이터를
 * 부르는 API 의 권한이다 — 화면은 열렸는데 주 데이터가 403 인 상태를 만들지 않으려고.
 */
export type ScreenAccess =
  | { readonly kind: 'open' }
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'permission'; readonly anyOf: readonly Permission[] };

const OPEN: ScreenAccess = { kind: 'open' };
const SIGNED_IN: ScreenAccess = { kind: 'authenticated' };
const any = (...anyOf: Permission[]): ScreenAccess => ({ kind: 'permission', anyOf });

export const SCREEN_ACCESS: Readonly<Record<string, ScreenAccess>> = {
  '/': any('analytics.report.read'),
  '/unauthorized': OPEN,
  '/account/change-password': SIGNED_IN,
  '/company/my-account': SIGNED_IN,
  '/demo/manual': SIGNED_IN,
  // 개발 서버 전용 시안 미리보기 — 배포 빌드에서는 페이지가 404 를 낸다
  '/restock-preview': OPEN,

  // 회사/조직
  '/users': any('iam.role.read'),
  '/company/integrations/oauth-clients': any('system.oauth_client.write'),

  // 채널/고객
  '/account/customer': any('customer.profile.read'),
  '/account/blacklist': any('customer.profile.read'),
  '/account/sales-channel': any('channel.account.read'),
  '/account/sales-channel/medusa-customers': any('customer.profile.read'),
  '/customer-window': any('customer.profile.read'),

  // 주문/출고
  '/order/matching': any('order.order.read'),
  '/order/print-orders': any('order.order.read'),
  '/order/channel-mismatches': any('channel.account.read'),
  '/order/manual-single': any('order.order.write'),
  '/order/manual-bulk': any('order.order.write'),
  '/order/fulfillment-manual': any('fulfillment.order.write'),
  '/order/history': any('order.order.read'),
  '/order/stall-board': any('fulfillment.order.read'),
  '/order/fulfillments': any('fulfillment.order.read'),
  '/order/regional-invoice': any('order.order.read'),
  '/order/shipment-round': any('fulfillment.order.read'),
  '/order/picking-list': any('fulfillment.shipment.read'),
  '/order/waybill-issue': any('fulfillment.order.read'),
  '/order/inspection': any('fulfillment.shipment.read'),
  '/order/outbound-batches': any('fulfillment.shipment.read'),
  '/order/direct-ship': any('fulfillment.order.read'),
  '/order/consolidation': any('fulfillment.shipment.read'),
  '/order/location-optimization': any('fulfillment.order.read'),

  // 상품
  '/mall/products-list': any('catalog.product.read'),
  '/mall/product-registration': any('catalog.product.write'),
  '/mall/my-drafts': any('catalog.product.read'),
  '/mall/bulk-sessions': any('catalog.product.read'),
  '/mall/categories': any('catalog.product.read'),
  '/mall/tags': any('catalog.product.read'),
  '/mall/channel-listings': any('catalog.product.read'),
  '/mall/channel-categories': any('catalog.product.read'),
  '/mall/bulk': any('catalog.bulk.execute'),
  '/mall/audit': any('catalog.product.read'),
  '/mall/digital-assets': any('catalog.product.read'),
  '/mall/ownerships': any('customer.profile.read'),
  '/mall/pricing': any('catalog.product.read'),

  // 재고
  '/inventory/status': any('inventory.stock.read'),
  '/inventory/skus': any('inventory.stock.read'),
  '/inventory/sku-groups': any('inventory.stock.read'),
  '/inventory/movement': any('inventory.stock.read'),
  '/inventory/reservations': any('inventory.stock.read'),
  '/inventory/stocktaking': any('inventory.stock.read'),
  '/inventory/purchase-orders': any('inventory.master.read'),
  '/inventory/replenishment': any('inventory.master.read'),
  '/inventory/inbound': any('inventory.stock.read'),
  '/inventory/suppliers': any('inventory.master.read'),
  '/inventory/supplier-categories': any('inventory.master.read'),
  '/inventory/locations': any('inventory.stock.read'),
  '/inventory/warehouses': any('inventory.stock.read'),
  '/inventory/delivery-profiles': any('inventory.stock.read'),
  '/inventory/holders': any('inventory.stock.read'),
  '/inventory/returns': any('inventory.stock.read'),
  '/inventory/product-registration': any('catalog.product.write'),
  '/matching': any('order.order.read'),
  '/mobile': any('inventory.stock.read', 'fulfillment.shipment.read'),

  // CS
  '/cs': any('cs.inquiry.read'),
  '/cs/return-exchange': any('order.claim.read'),
  '/cs/reviews': any('cs.review.read'),
  '/cs/reviews/new': any('cs.review.moderate'),
  '/cs/qna': any('cs.inquiry.read'),
  '/cs/business-licenses': any('customer.profile.read'),
  '/logo-contest': any('cs.review.read'),

  // 통계
  '/statistics': any('analytics.report.read'),
  '/statistics/profit': any('analytics.finance.read'),
  '/statistics/settings': any('analytics.finance.read'),
  '/statistics/reviews': any('cs.review.read'),

  // 자사몰·마케팅
  '/mall/marketing/messages': any('messaging.message.read'),
  '/mall/banner-groups': any('marketing.display.read'),
  '/mall/popups': any('marketing.display.read'),
  '/mall/notices': any('marketing.display.read'),
  '/mall/marketing/points': any('payment.payment.read'),
  '/mall/marketing/coupons': any('marketing.promotion.read'),
  '/mall/marketing/campaigns': any('marketing.promotion.read'),
  '/mall/marketing/time-sale': any('marketing.promotion.read'),
  '/mall/marketing/time-sale/new': any('marketing.promotion.write'),
  '/mall/marketing/time-sale/[id]/edit': any('marketing.promotion.write'),
  '/mall/marketing/events': any('marketing.promotion.read'),
  '/mall/shop-listings': any('cs.review.read'),
  '/mall/shop-listings/new': any('marketing.shop_listing.write'),
  '/mall/almond-templates': any('marketing.almond_template.read'),
  '/mall/shipping-groups': any('system.shipping_profile.read'),
  '/mall/regions': any('system.region.read'),
  '/messages': any('messaging.message.read'),

  // 결제
  '/payments': any('payment.payment.read'),
  '/payments/refunds': any('payment.refund.read'),
  '/payments/refund-requests': any('payment.refund.read'),

  // 멤버십
  '/membership': any('membership.member.read'),
  '/membership/billing-history': any('membership.billing.read'),
  '/membership/cancellations': any('membership.billing.read'),

  // 문서·운영
  '/archive': any('archive.page.read'),
  '/events/trace': any('system.operations.read'),
  '/events/failures': any('system.operations.read'),
  '/demo': any('system.operations.read'),
};

function parentOf(route: string): string | null {
  const cut = route.replace(/\/[^/]+$/, '');
  return cut === route || cut === '' ? null : cut;
}

export function resolveScreenAccess(route: string): ScreenAccess | undefined {
  if (route === '/') return SCREEN_ACCESS['/'];
  for (let at: string | null = route; at !== null; at = parentOf(at)) {
    if (Object.hasOwn(SCREEN_ACCESS, at)) return SCREEN_ACCESS[at];
  }
  return undefined;
}

export function canAny(held: ReadonlySet<string>, anyOf: readonly string[]): boolean {
  return anyOf.some((permission) => held.has(permission));
}

export function canAccess(access: ScreenAccess, held: ReadonlySet<string>): boolean {
  return access.kind !== 'permission' || canAny(held, access.anyOf);
}

const isRealItem = (item: MenuItem) => Boolean(item.path) && !item.isComingSoon;

export function isMenuItemVisible(item: MenuItem, held: ReadonlySet<string>): boolean {
  if (!item.path) return false;
  const access = resolveScreenAccess(item.path);
  return access !== undefined && canAccess(access, held);
}

function prune(items: MenuItem[], held: ReadonlySet<string>): MenuItem[] {
  return items.flatMap((item): MenuItem[] => {
    if (item.children && item.children.length > 0) {
      const children = prune(item.children, held);
      const selfVisible = item.path ? isMenuItemVisible(item, held) : false;
      return children.length > 0 || selfVisible ? [{ ...item, children }] : [];
    }
    if (item.isComingSoon) return [item];
    return isMenuItemVisible(item, held) ? [item] : [];
  });
}

const hasOpenable = (items: readonly MenuItem[], held: ReadonlySet<string>): boolean =>
  items.some((item) => (isRealItem(item) && isMenuItemVisible(item, held)) || hasOpenable(item.children ?? [], held));

/**
 * 한 메인 메뉴의 하위 목록에서 보이는 항목만 남긴다. 상위 항목은 보이는 하위가 있을 때만.
 * «준비중» 항목은 그 메인 메뉴에 실제로 열리는 화면이 하나라도 있을 때 그대로 둔다 —
 * 오늘처럼 «준비중»만 모인 묶음(예: 경영지원)도 보이고, 권한이 전혀 없는 메인 메뉴는 통째로 숨는다.
 */
export function filterMenuItems(items: MenuItem[], held: ReadonlySet<string>): MenuItem[] {
  const kept = prune(items, held);
  return hasOpenable(kept, held) ? kept : [];
}

function firstPath(items: readonly MenuItem[], held: ReadonlySet<string>, skipSignedIn: boolean): string | null {
  for (const item of items) {
    if (item.path && !item.isComingSoon) {
      const access = resolveScreenAccess(item.path);
      const permitted = access !== undefined && canAccess(access, held);
      if (permitted && !(skipSignedIn && access.kind !== 'permission')) return item.path;
    }
    if (item.children) {
      const found = firstPath(item.children, held, skipSignedIn);
      if (found) return found;
    }
  }
  return null;
}

/** 첫 화면(`/`) 권한이 없을 때 갈 곳. 로그인만 요구하는 화면(내 계정 등)은 건너뛴다. */
export function firstAccessiblePath(menus: readonly MainMenu[], held: ReadonlySet<string>): string | null {
  for (const menu of menus) {
    const found = firstPath(menu.children, held, true);
    if (found) return found;
  }
  return null;
}

/** 메인 탭을 눌렀을 때 그 탭 안에서 갈 곳. */
export function firstAccessiblePathIn(menu: MainMenu, held: ReadonlySet<string>): string | null {
  return firstPath(menu.children, held, true) ?? firstPath(menu.children, held, false);
}
