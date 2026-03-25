import { z } from 'zod';

// =================================================================
// == 1. 공통 응답 스키마
// =================================================================

/**
 * 공통 응답 구조체 (Data 포함)
 */
export function createNaverApiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    timestamp: z.string().datetime(),
    traceId: z.string(),
    data: dataSchema,
  });
}

/**
 * 공통 응답 구조체 (Data Optional)
 */
export function createNaverApiResponseSchemaOptional<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    timestamp: z.string().datetime(),
    traceId: z.string(),
    data: dataSchema.optional(),
  });
}

/**
 * 다수 API(클레임/주문)에서 공통으로 사용하는 실패 정보 구조체
 */
export const FailProductOrderInfoSchema = z.object({
  productOrderId: z.string(),
  code: z.string(),
  message: z.string(),
});
export type FailProductOrderInfo = z.infer<typeof FailProductOrderInfoSchema>;

/**
 * 주문-클레임 처리 API의 공통 응답 데이터 구조체
 */
export const ClaimProcessResponseDataSchema = z.object({
  successProductOrderIds: z.array(z.string()),
  failProductOrderInfos: z.array(FailProductOrderInfoSchema),
});
export type ClaimProcessResponseData = z.infer<typeof ClaimProcessResponseDataSchema>;

/**
 * 주문-클레임 처리 API의 공통 응답 래퍼 구조체 (data가 optional일 수 있음)
 * (approveCancel, approveReturn 등)
 */
export const NaverClaimProcessResponseSchema = createNaverApiResponseSchema(ClaimProcessResponseDataSchema.optional());
export type NaverClaimProcessResponse = z.infer<typeof NaverClaimProcessResponseSchema>;

// =================================================================
// == 2. 공통 상수 (Enum)
// =================================================================

/**
 * 배송 방법 코드
 * (naver-api.zod.ts와 naver-dispatch.zod.ts의 중복 정의 통합)
 */
export const DeliveryMethodSchema = z.enum([
  'DELIVERY', // 택배, 등기, 소포
  'GDFW_ISSUE_SVC', // 굿스플로 송장 출력
  'VISIT_RECEIPT', // 방문 수령
  'DIRECT_DELIVERY', // 직접 전달
  'QUICK_SVC', // 퀵서비스
  'NOTHING', // 배송 없음
  'RETURN_DESIGNATED', // 지정 반품 택배
  'RETURN_DELIVERY', // 일반 반품 택배
  'RETURN_INDIVIDUAL', // 직접 반송
  'RETURN_MERCHANT', // 판매자 직접 수거(장보기 전용)
  'UNKNOWN', // 알 수 없음(예외 처리에 사용)
]);
export type DeliveryMethod = z.infer<typeof DeliveryMethodSchema>;

/**
 * 택배사 코드
 * (naver-dispatch.zod.ts에서 가져옴)
 */
export const DeliveryCompanyCodeSchema = z.enum([
  'CJGLS', // CJ대한통운
  'HYUNDAI', // 롯데택배
  'HANJIN', // 한진택배
  'KGB', // 로젠택배
  'EPOST', // 우체국택배
  'CUPARCEL', // CU편의점택배
  'DHL', // DHL
  'FEDEX', // FEDEX
  'UPS', // UPS
  'EMS', // EMS
  'MTINTER',
  'AIRWAY',
  'KOREXG',
  'EZUSA',
  'TNT',
  'USPS',
  'KDEXP',
  'GOODTOLUCK',
  'DAELIM',
  'DONGGANG',
  'LOTTECHILSUNG',
  'PANTOS',
  'VROONG',
  'HONAM',
  'CHUNIL',
  'TEAMFRESH',
  'FRESH',
  'HOMEPLUSDELIVERY',
  'CH1', // 기타 택배
]);
export type DeliveryCompanyCode = z.infer<typeof DeliveryCompanyCodeSchema>;

/**
 * 클레임 보류 사유
 * (naver-api.zod.ts에서 가져옴)
 */
export const HoldbackReasonSchema = z.enum([
  'RETURN_DELIVERYFEE',
  'EXTRAFEEE',
  'RETURN_DELIVERYFEE_AND_EXTRAFEEE',
  'RETURN_PRODUCT_NOT_DELIVERED',
  'ETC',
  'EXCHANGE_DELIVERYFEE',
  'EXCHANGE_EXTRAFEE',
  'EXCHANGE_PRODUCT_READY',
  'EXCHANGE_PRODUCT_NOT_DELIVERED',
  'EXCHANGE_HOLDBACK',
  'SELLER_CONFIRM_NEED',
  'PURCHASER_CONFIRM_NEED',
  'SELLER_REMIT',
  'ETC2',
]);
export type HoldbackReason = z.infer<typeof HoldbackReasonSchema>;

/**
 * 반품 사유 코드
 * (naver-api.zod.ts에서 가져옴)
 */
export const ReturnReasonSchema = z.enum([
  'INTENT_CHANGED',
  'COLOR_AND_SIZE',
  'WRONG_ORDER',
  'PRODUCT_UNSATISFIED',
  'DELAYED_DELIVERY',
  'SOLD_OUT',
  'DROPPED_DELIVERY',
  'BROKEN',
  'INCORRECT_INFO',
  'WRONG_DELIVERY',
  'WRONG_OPTION',
]);
export type ReturnReason = z.infer<typeof ReturnReasonSchema>;

/**
 * 취소 사유 코드
 * (naver-api.zod.ts에서 가져옴)
 */
export const CancelReasonSchema = z.enum([
  'INTENT_CHANGED',
  'COLOR_AND_SIZE',
  'WRONG_ORDER',
  'PRODUCT_UNSATISFIED',
  'DELAYED_DELIVERY',
  'SOLD_OUT',
  'INCORRECT_INFO',
]);
export type CancelReason = z.infer<typeof CancelReasonSchema>;

/**
 * 판매 상태 코드
 * (naver-api.zod.ts에서 가져옴)
 */
export const SaleStatusTypeSchema = z.enum([
  'WAIT',
  'SALE',
  'OUTOFSTOCK',
  'UNADMISSION',
  'REJECTION',
  'SUSPENSION',
  'CLOSE',
  'PROHIBITION',
  'DELETE',
]);
export type SaleStatusType = z.infer<typeof SaleStatusTypeSchema>;

/**
 * 주문 조회 기간 타입
 * (naver-api.zod.ts에서 가져옴)
 */
export const RangeTypeSchema = z.enum([
  'PAYED_DATETIME',
  'ORDERED_DATETIME',
  'DISPATCHED_DATETIME',
  'PURCHASE_DECIDED_DATETIME',
  'CLAIM_REQUESTED_DATETIME',
  'CLAIM_COMPLETED_DATETIME',
  'COLLECT_COMPLETED_DATETIME',
  'GIFT_RECEIVED_DATETIME',
  'HOPE_DELIVERY_INFO_CHANGED_DATETIME',
]);
export type RangeType = z.infer<typeof RangeTypeSchema>;

/**
 * 주문 상태 코드
 * (naver-api.zod.ts에서 가져옴)
 */
export const ProductOrderStatusSchema = z.enum([
  'PAYMENT_WAITING',
  'PAYED',
  'DELIVERING',
  'DELIVERED',
  'PURCHASE_DECIDED',
  'EXCHANGED',
  'CANCELED',
  'RETURNED',
  'CANCELED_BY_NOPAYMENT',
]);
export type ProductOrderStatus = z.infer<typeof ProductOrderStatusSchema>;

/**
 * 클레임 상태 코드
 * (naver-api.zod.ts에서 가져옴)
 */
export const ClaimStatusSchema = z.enum([
  'CANCEL_REQUEST',
  'CANCELING',
  'CANCEL_DONE',
  'CANCEL_REJECT',
  'RETURN_REQUEST',
  'EXCHANGE_REQUEST',
  'COLLECTING',
  'COLLECT_DONE',
  'EXCHANGE_REDELIVERING',
  'RETURN_DONE',
  'EXCHANGE_DONE',
  'RETURN_REJECT',
  'EXCHANGE_REJECT',
  'PURCHASE_DECISION_HOLDBACK',
  'PURCHASE_DECISION_REQUEST',
  'PURCHASE_DECISION_HOLDBACK_RELEASE',
  'ADMIN_CANCELING',
  'ADMIN_CANCEL_DONE',
  'ADMIN_CANCEL_REJECT',
]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

/**
 * 발주 상태 코드
 * (naver-api.zod.ts에서 가져옴)
 */
export const PlaceOrderStatusTypeSchema = z.enum(['NOT_YET', 'OK', 'CANCEL']);
export type PlaceOrderStatusType = z.infer<typeof PlaceOrderStatusTypeSchema>;
