import {
  Boxes,
  ClipboardList,
  CreditCard,
  Crown,
  Megaphone,
  MessageSquare,
  Package,
  Receipt,
  RefreshCcw,
  ShoppingBag,
  Star,
  Store,
  Tag,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

export interface QuickActionItem {
  /** localStorage 에 저장되는 안정적인 식별자. path 가 바뀌어도 유지된다. */
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
}

/**
 * 빠른 액션에 넣을 수 있는 전체 후보(마스터 풀).
 * 유저는 이 풀에서 노출 항목과 순서만 고른다 — 임의의 메뉴를 직접 추가하지는 못한다.
 * 풀에 항목을 새로 추가하면 "뺀 적 없는" 기존 유저에게도 자동으로 노출된다(useQuickActions 참고).
 */
export const QUICK_ACTION_POOL: QuickActionItem[] = [
  { id: 'order-history', label: '주문 이력', icon: Package, path: '/order/history' },
  { id: 'order-matching', label: '매칭', icon: Boxes, path: '/order/matching' },
  { id: 'inventory-status', label: '재고 현황', icon: Warehouse, path: '/inventory/status' },
  { id: 'cs-qna', label: 'QnA', icon: MessageSquare, path: '/cs/qna' },
  { id: 'account-customer', label: '회원 관리', icon: Users, path: '/account/customer' },
  { id: 'account-sales-channel', label: '판매처', icon: Store, path: '/account/sales-channel' },
  { id: 'membership-members', label: '멤버십', icon: Crown, path: '/membership/members' },
  { id: 'mall-coupons', label: '쿠폰', icon: Tag, path: '/mall/marketing/coupons' },
  { id: 'inventory-purchase-orders', label: '발주관리', icon: ClipboardList, path: '/inventory/purchase-orders' },
  { id: 'inventory-inbound', label: '입고 관리', icon: Truck, path: '/inventory/inbound' },
  { id: 'mall-products-list', label: '상품 목록', icon: ShoppingBag, path: '/mall/products-list' },
  { id: 'payments', label: '결제 내역', icon: CreditCard, path: '/payments' },
  { id: 'payments-refunds', label: '환불 내역', icon: Receipt, path: '/payments/refunds' },
  { id: 'cs-reviews', label: '리뷰 관리', icon: Star, path: '/cs/reviews' },
  { id: 'cs-return-exchange', label: '반품·교환', icon: RefreshCcw, path: '/cs/return-exchange' },
  { id: 'mall-notices', label: '공지사항', icon: Megaphone, path: '/mall/notices' },
];

export const QUICK_ACTION_POOL_IDS = QUICK_ACTION_POOL.map((a) => a.id);
