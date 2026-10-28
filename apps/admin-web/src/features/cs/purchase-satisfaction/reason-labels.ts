import type { PurchaseSatisfactionReason } from '@/lib/types/dto/purchase-satisfaction';

export const PURCHASE_SATISFACTION_REASON_LABELS: Record<PurchaseSatisfactionReason, string> = {
  ADDRESS_INPUT: '배송지 입력이 불편했어요',
  COUPON_DISCOUNT: '쿠폰·할인 적용이 어려웠어요',
  CASH_RECEIPT: '현금영수증 신청이 어려웠어요',
  PAYMENT_METHOD: '결제 수단이 불편했어요',
  PAYMENT_ERROR: '결제 중 오류가 났어요',
  PRODUCT_SEARCH: '원하는 상품을 찾기 어려웠어요',
  OTHER: '기타',
};
