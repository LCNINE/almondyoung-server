import { z } from 'zod';

// =================================================================
// == 공통 응답 스키마 생성 헬퍼
// =================================================================
export function createNaverApiResponseSchema<T extends z.ZodTypeAny>(
  dataSchema: T,
) {
  return z.object({
    timestamp: z.iso.date(),
    traceId: z.string(),
    data: dataSchema,
  });
}

export function createNaverApiResponseSchemaOptional<T extends z.ZodTypeAny>(
  dataSchema: T,
) {
  return z.object({
    timestamp: z.iso.date(),
    traceId: z.string(),
    data: dataSchema.optional(),
  });
}

// =================================================================
// == 공통 코드 정의
// =================================================================
const NAVER_DELIVERY_METHODS = [
  'DELIVERY',
  'GDFW_ISSUE_SVC',
  'VISIT_RECEIPT',
  'DIRECT_DELIVERY',
  'QUICK_SVC',
  'NOTHING',
  'RETURN_DESIGNATED',
  'RETURN_DELIVERY',
  'RETURN_INDIVIDUAL',
  'RETURN_MERCHANT',
  'UNKNOWN',
] as const;

const NAVER_HOLDBACK_REASONS = [
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
] as const;

const NAVER_RETURN_REASONS = [
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
] as const;

const NAVER_CANCEL_REASONS = [
  'INTENT_CHANGED',
  'COLOR_AND_SIZE',
  'WRONG_ORDER',
  'PRODUCT_UNSATISFIED',
  'DELAYED_DELIVERY',
  'SOLD_OUT',
  'INCORRECT_INFO',
] as const;

const NAVER_SALE_STATUS_TYPES = [
  'WAIT',
  'SALE',
  'OUTOFSTOCK',
  'UNADMISSION',
  'REJECTION',
  'SUSPENSION',
  'CLOSE',
  'PROHIBITION',
  'DELETE',
] as const;

const NAVER_RANGE_TYPES = [
  'PAYED_DATETIME',
  'ORDERED_DATETIME',
  'DISPATCHED_DATETIME',
  'PURCHASE_DECIDED_DATETIME',
  'CLAIM_REQUESTED_DATETIME',
  'CLAIM_COMPLETED_DATETIME',
  'COLLECT_COMPLETED_DATETIME',
  'GIFT_RECEIVED_DATETIME',
  'HOPE_DELIVERY_INFO_CHANGED_DATETIME',
] as const;

const NAVER_PRODUCT_ORDER_STATUSES = [
  'PAYMENT_WAITING',
  'PAYED',
  'DELIVERING',
  'DELIVERED',
  'PURCHASE_DECIDED',
  'EXCHANGED',
  'CANCELED',
  'RETURNED',
  'CANCELED_BY_NOPAYMENT',
] as const;

const NAVER_CLAIM_STATUSES = [
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
] as const;

const NAVER_PLACE_ORDER_STATUS_TYPES = ['NOT_YET', 'OK', 'CANCEL'] as const;

// =================================================================
// == 요청 Body 스키마
// =================================================================
export const ExchangeRedeliveryBodySchema = z.object({
  reDeliveryMethod: z.enum(NAVER_DELIVERY_METHODS),
  reDeliveryCompany: z.string().min(1),
  reDeliveryTrackingNumber: z.string().min(1),
});
export type ExchangeRedeliveryBody = z.infer<
  typeof ExchangeRedeliveryBodySchema
>;

export const HoldExchangeBodySchema = z.object({
  holdbackClassType: z.enum(NAVER_HOLDBACK_REASONS),
  holdbackExchangeDetailReason: z.string().min(1),
  extraExchangeFeeAmount: z.number().optional(),
});
export type HoldExchangeBody = z.infer<typeof HoldExchangeBodySchema>;

export const RejectExchangeBodySchema = z.object({
  rejectExchangeReason: z.string().min(1),
});
export type RejectExchangeBody = z.infer<typeof RejectExchangeBodySchema>;

export const HoldReturnBodySchema = z.object({
  holdbackClassType: z.enum(NAVER_HOLDBACK_REASONS),
  holdbackReturnDetailReason: z.string().min(1),
  extraReturnFeeAmount: z.number().optional(),
});
export type HoldReturnBody = z.infer<typeof HoldReturnBodySchema>;

export const RejectReturnBodySchema = z.object({
  rejectReturnReason: z.string().min(1),
});
export type RejectReturnBody = z.infer<typeof RejectReturnBodySchema>;

export const RequestReturnBodySchema = z.object({
  returnReason: z.enum(NAVER_RETURN_REASONS),
  collectDeliveryMethod: z.enum(NAVER_DELIVERY_METHODS),
  collectDeliveryCompany: z.string().optional(),
  collectTrackingNumber: z.string().optional(),
  returnQuantity: z.number().int().positive().optional(),
});
export type RequestReturnBody = z.infer<typeof RequestReturnBodySchema>;

export const RequestCancelBodySchema = z.object({
  cancelReason: z.enum(NAVER_CANCEL_REASONS),
  cancelDetailedReason: z.string().max(500).optional(),
  cancelQuantity: z.number().int().positive().optional(),
});
export type RequestCancelBody = z.infer<typeof RequestCancelBodySchema>;

export const DispatchProductOrderSchema = z.object({
  productOrderId: z.string().min(1),
  deliveryMethod: z.enum(NAVER_DELIVERY_METHODS),
  deliveryCompanyCode: z.string().min(1),
  trackingNumber: z.string().min(1),
  dispatchDate: z.string().datetime(),
});
export type DispatchProductOrder = z.infer<typeof DispatchProductOrderSchema>;

export const ChangeHopeDeliveryBodySchema = z.object({
  hopeDeliveryYmd: z.string().regex(/^\d{8}$/),
  hopeDeliveryHm: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  region: z.string().min(1).max(30).optional(),
  changeReason: z.string().min(1).max(300),
});
export type ChangeHopeDeliveryBody = z.infer<
  typeof ChangeHopeDeliveryBodySchema
>;

// 지연발송 Body (빠진 것 추가)
export const DelayDispatchBodySchema = z.object({
  dispatchDueDate: z.iso.date(),
  delayedDispatchReason: z.string().min(1),
  dispatchDelayedDetailedReason: z.string().min(1),
});
export type DelayDispatchBody = z.infer<typeof DelayDispatchBodySchema>;

// 옵션재고 변경 스키마/타입 (빠진 것 추가)
const DiscountMethodSchema = z.object({
  value: z.number().int(),
  unitType: z.enum(['PERCENT', 'WON', 'YEN', 'COUNT']),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
});
const OptionCombinationStockSchema = z.object({
  id: z.number().int(),
  stockQuantity: z.number().int(),
  price: z.number().int().optional(),
  usable: z.boolean().optional(),
});
const OptionStandardStockSchema = z.object({
  id: z.number().int(),
  stockQuantity: z.number().int(),
  usable: z.boolean().optional(),
});
export const UpdateOptionStockBodySchema = z.object({
  productSalePrice: z.object({
    salePrice: z.number().int(),
  }),
  immediateDiscountPolicy: z.object({
    discountMethod: DiscountMethodSchema,
  }),
  optionInfo: z.object({
    optionCombinations: z.array(OptionCombinationStockSchema).optional(),
    optionStandards: z.array(OptionStandardStockSchema).optional(),
    useStockManagement: z.boolean(),
  }),
});
export type UpdateOptionStockBody = z.infer<typeof UpdateOptionStockBodySchema>;

// =================================================================
// == 조회 파라미터 스키마
// =================================================================
export const QueryProductOrdersParamsSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime().optional(),
  rangeType: z.enum(NAVER_RANGE_TYPES),
  productOrderStatuses: z
    .array(z.enum(NAVER_PRODUCT_ORDER_STATUSES))
    .optional(),
  claimStatuses: z.array(z.enum(NAVER_CLAIM_STATUSES)).optional(),
  placeOrderStatusType: z.enum(NAVER_PLACE_ORDER_STATUS_TYPES).optional(),
  fulfillment: z.boolean().optional(),
  pageSize: z.number().int().min(1).max(300).optional(),
  page: z.number().int().min(1).optional(),
  quantityClaimCompatibility: z.boolean().optional(),
});
export type QueryProductOrdersParams = z.infer<
  typeof QueryProductOrdersParamsSchema
>;

// =================================================================
// == 응답 스키마/타입 (빠진 것 추가)
// =================================================================

// 변경된 주문 목록 조회 응답
const NaverLastChangedStatusesDataSchema = z.object({
  lastChangeStatuses: z.array(
    z.object({
      orderId: z.string(),
      productOrderId: z.string(),
      lastChangedType: z.string(),
      paymentDate: z.string(),
      lastChangedDate: z.string(),
      productOrderStatus: z.string(),
      claimType: z.string().optional(),
      claimStatus: z.string().optional(),
      receiverAddressChanged: z.boolean(),
    }),
  ),
  more: z
    .object({
      moreFrom: z.string(),
      moreSequence: z.string(),
    })
    .optional(),
});
export const NaverLastChangedStatusResponseSchema =
  createNaverApiResponseSchema(NaverLastChangedStatusesDataSchema);
export type NaverLastChangedStatusResponse = z.infer<
  typeof NaverLastChangedStatusResponseSchema
>;

// 상품 주문 상세 내역 응답
export const NaverProductOrderDetailsResponseSchema =
  createNaverApiResponseSchema(
    z.array(
      z.object({
        order: z.any(),
        productOrder: z.any(),
        cancel: z.any().optional(),
        return: z.any().optional(),
        exchange: z.any().optional(),
        beforeClaim: z.object({}),
        currentClaim: z.any(),
        completedClaims: z.array(z.any()),
        delivery: z.any(),
      }),
    ),
  );
export type NaverProductOrderDetailsResponse = z.infer<
  typeof NaverProductOrderDetailsResponseSchema
>;

// 주문번호로 상품 주문번호 목록 응답
export const NaverProductOrderIdsResponseSchema = createNaverApiResponseSchema(
  z.array(z.string()),
);
export type NaverProductOrderIdsResponse = z.infer<
  typeof NaverProductOrderIdsResponseSchema
>;

// 상품 주문 상세 구조체 타입 (빠진 것 추가)
export interface ProductOrderInfo {
  order: any;
  productOrder: any;
  cancel?: any;
  return?: any;
  exchange?: any;
  beforeClaim: object;
  currentClaim: any;
  completedClaims: any[];
  delivery: any;
}

// 판매 상태 변경 Body
export const ChangeSaleStatusBodySchema = z.object({
  statusType: z.enum(NAVER_SALE_STATUS_TYPES),
  saleStartDate: z.iso.date().optional(),
  saleEndDate: z.iso.date().optional(),
  stockQuantity: z.number().int().max(99999999).optional(),
});
export type ChangeSaleStatusBody = z.infer<typeof ChangeSaleStatusBodySchema>;
