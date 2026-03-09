import type { MembershipTier } from "@/contexts/membership-context"

export interface QuickLink {
  label: string
  icon: string
}

export interface MenuItem {
  label: string
  icon: string
  path?: string
  action?: "logout"
}

export interface MenuSection {
  title: string
  items: MenuItem[]
}

export interface ShippingItem {
  id: string
  status: "preparing" | "shipping"
  productName: string
  price: string
  quantity: number
  orderNumber: string
  imageUrl?: string
  options?: string[]
}

export interface UserInfo {
  name: string
  email?: string
  phone?: string
}

/**
 * 배송 중 주문 정보 (데스크탑)
 */
export interface ShippingOrder {
  orderId: string
  status: string
  paymentStatus: string
  deliveryInfo: string
  shippingNote: string
  productName: string
  productImage: string
  price: string
  quantity: number
  options: string[]
  showInquiry: boolean
  orderItems: Array<{ productId: string; orderLineId: string }>
}

/**
 * 결제 정보
 */
export interface BillingInfo {
  nextBillingDate: string | null
  nextBillingAmount: number
  periodStart: string | null
  periodEnd: string | null
}

/**
 * 절약 데이터 (모바일)
 */
export interface SavingsData {
  totalSavings: number
  hasSubscription: boolean
  tierName?: string
}

/**
 * 포인트 잔액 데이터
 */
export interface PointBalanceData {
  balance: number
  withdrawable: number
}

/**
 * 배송 상태 아이템 (모바일)
 */
export type OrderStatus = "SHIPPING" | "PREPARING"

export interface OrderItem {
  id: string
  orderNumber: string
  status: OrderStatus
  statusLabel: string
  thumbnailUrl: string
}

/**
 * 멤버십 데이터 (SSR에서 전달)
 */
export interface MembershipData {
  isMembershipPricing: boolean
  tier?: MembershipTier
}
