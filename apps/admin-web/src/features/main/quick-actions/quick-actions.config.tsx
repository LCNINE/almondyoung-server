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
  iconColor: string;
  bg: string;
}

/**
 * 빠른 액션에 넣을 수 있는 전체 후보(마스터 풀).
 * 유저는 이 풀에서 노출 항목과 순서만 고른다 — 임의의 메뉴를 직접 추가하지는 못한다.
 * 풀에 항목을 새로 추가하면 "뺀 적 없는" 기존 유저에게도 자동으로 노출된다(useQuickActions 참고).
 */
export const QUICK_ACTION_POOL: QuickActionItem[] = [
  { id: 'order-history', label: '주문 이력', icon: Package, path: '/order/history', iconColor: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'order-matching', label: '매칭', icon: Boxes, path: '/order/matching', iconColor: 'text-orange-600', bg: 'bg-orange-50' },
  { id: 'inventory-status', label: '재고 현황', icon: Warehouse, path: '/inventory/status', iconColor: 'text-green-600', bg: 'bg-green-50' },
  { id: 'cs-qna', label: 'QnA', icon: MessageSquare, path: '/cs/qna', iconColor: 'text-purple-600', bg: 'bg-purple-50' },
  { id: 'account-customer', label: '회원 관리', icon: Users, path: '/account/customer', iconColor: 'text-pink-600', bg: 'bg-pink-50' },
  { id: 'account-sales-channel', label: '판매처', icon: Store, path: '/account/sales-channel', iconColor: 'text-teal-600', bg: 'bg-teal-50' },
  { id: 'membership-members', label: '멤버십', icon: Crown, path: '/membership/members', iconColor: 'text-yellow-600', bg: 'bg-yellow-50' },
  { id: 'mall-coupons', label: '쿠폰', icon: Tag, path: '/mall/marketing/coupons', iconColor: 'text-red-600', bg: 'bg-red-50' },
  { id: 'inventory-purchase-orders', label: '발주관리', icon: ClipboardList, path: '/inventory/purchase-orders', iconColor: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'inventory-inbound', label: '입고 관리', icon: Truck, path: '/inventory/inbound', iconColor: 'text-cyan-600', bg: 'bg-cyan-50' },
  { id: 'mall-products-list', label: '상품 목록', icon: ShoppingBag, path: '/mall/products-list', iconColor: 'text-sky-600', bg: 'bg-sky-50' },
  { id: 'payments', label: '결제 내역', icon: CreditCard, path: '/payments', iconColor: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'payments-refunds', label: '환불 내역', icon: Receipt, path: '/payments/refunds', iconColor: 'text-rose-600', bg: 'bg-rose-50' },
  { id: 'cs-reviews', label: '리뷰 관리', icon: Star, path: '/cs/reviews', iconColor: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'cs-return-exchange', label: '반품·교환', icon: RefreshCcw, path: '/cs/return-exchange', iconColor: 'text-violet-600', bg: 'bg-violet-50' },
  { id: 'mall-notices', label: '공지사항', icon: Megaphone, path: '/mall/notices', iconColor: 'text-lime-600', bg: 'bg-lime-50' },
];

export const QUICK_ACTION_POOL_IDS = QUICK_ACTION_POOL.map((a) => a.id);
