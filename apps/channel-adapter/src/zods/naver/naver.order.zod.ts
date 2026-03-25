import { z } from 'zod';
import {
  createNaverApiResponseSchema,
  DeliveryMethodSchema,
  DeliveryCompanyCodeSchema,
  RangeTypeSchema,
  ProductOrderStatusSchema,
  ClaimStatusSchema,
  PlaceOrderStatusTypeSchema,
} from './naver-core.zod';

// =================================================================
// == 1. 주문/배송 관련 Body 스키마
// =================================================================

/**
 * 단일 상품 주문 발송처리 스키마
 * (from naver-dispatch.zod.ts - 상세 버전)
 */
export const DispatchProductOrderSchema = z.object({
  /** 상품 주문 번호 */
  productOrderId: z
    .string()
    .min(1, '상품 주문 번호는 필수입니다')
    .max(50, '상품 주문 번호는 50자를 초과할 수 없습니다')
    .regex(/^\d+$/, '상품 주문 번호는 숫자만 가능합니다'),

  /** 배송 방법 코드 */
  deliveryMethod: DeliveryMethodSchema,

  /** 택배사 코드 */
  deliveryCompanyCode: DeliveryCompanyCodeSchema,

  /** 송장 번호 */
  trackingNumber: z
    .string()
    .min(1, '송장 번호는 필수입니다')
    .max(50, '송장 번호는 50자를 초과할 수 없습니다')
    .regex(/^[a-zA-Z0-9\-]+$/, '송장 번호는 영문, 숫자, 하이픈만 가능합니다'),

  /** 배송일 */
  dispatchDate: z.iso.datetime({ message: '올바른 ISO 8601 날짜 형식이어야 합니다' }).refine(
    (date) => {
      // 네이버 API 정책: 배송일은 30일 전부터 현재까지만 가능
      const dispatchDate = new Date(date);
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return dispatchDate >= thirtyDaysAgo && dispatchDate <= now;
    },
    {
      message: '배송일은 30일 전부터 현재까지만 가능합니다',
    },
  ),
});

export type DispatchProductOrder = z.infer<typeof DispatchProductOrderSchema>;

/**
 * 네이버 발송처리 API 요청 스키마
 * (from naver-dispatch.zod.ts - 상세 버전)
 */
export const NaverDispatchRequestSchema = z.object({
  /** 발송처리할 상품 주문 목록 (최대 30개) */
  dispatchProductOrders: z
    .array(DispatchProductOrderSchema)
    .min(1, '최소 1개의 상품 주문이 필요합니다')
    .max(30, '최대 30개의 상품 주문만 처리 가능합니다')
    .refine(
      (orders) => {
        // 중복된 productOrderId 체크
        const orderIds = orders.map((o) => o.productOrderId);
        const uniqueOrderIds = new Set(orderIds);
        return orderIds.length === uniqueOrderIds.size;
      },
      {
        message: '중복된 상품 주문 번호가 있습니다',
      },
    ),
});
export type NaverDispatchRequest = z.infer<typeof NaverDispatchRequestSchema>;

/**
 * 배송 희망일 변경 Body 스키마
 * (from naver-api.zod.ts)
 */
export const ChangeHopeDeliveryBodySchema = z.object({
  hopeDeliveryYmd: z.string().regex(/^\d{8}$/, 'YYYYMMDD 형식이 아닙니다'),
  hopeDeliveryHm: z
    .string()
    .regex(/^\d{4}$/, 'HHMM 형식이 아닙니다')
    .optional(),
  region: z.string().min(1).max(30).optional(),
  changeReason: z.string().min(1).max(300, '변경 사유는 300자를 넘을 수 없습니다'),
});
export type ChangeHopeDeliveryBody = z.infer<typeof ChangeHopeDeliveryBodySchema>;

/**
 * 발송 지연 Body 스키마
 * (from naver-api.zod.ts)
 */
export const DelayDispatchBodySchema = z.object({
  dispatchDueDate: z.string().datetime('ISO 8601 날짜 형식이 아닙니다'),
  delayedDispatchReason: z.string().min(1, '발송 지연 사유는 필수입니다'),
  dispatchDelayedDetailedReason: z.string().min(1, '상세 사유는 필수입니다'),
});
export type DelayDispatchBody = z.infer<typeof DelayDispatchBodySchema>;

// =================================================================
// == 2. 주문 조회 관련 스키마
// =================================================================

/**
 * 주문 조회 파라미터 스키마
 * (from naver-api.zod.ts)
 */
export const QueryProductOrdersParamsSchema = z.object({
  from: z.iso.datetime('ISO 8601 날짜 형식이 아닙니다'),
  to: z.iso.datetime('ISO 8601 날짜 형식이 아닙니다').optional(),
  rangeType: RangeTypeSchema,
  productOrderStatuses: z.array(ProductOrderStatusSchema).optional(),
  claimStatuses: z.array(ClaimStatusSchema).optional(),
  placeOrderStatusType: PlaceOrderStatusTypeSchema.optional(),
  fulfillment: z.boolean().optional(),
  pageSize: z.number().int().min(1).max(300).optional(),
  page: z.number().int().min(1).optional(),
  quantityClaimCompatibility: z.boolean().optional(),
});
export type QueryProductOrdersParams = z.infer<typeof QueryProductOrdersParamsSchema>;

// =================================================================
// == 3. 주문 응답 스키마
// =================================================================

/**
 * 변경된 주문 목록 조회 응답 (getLastChangedStatuses)
 * (from naver-api.zod.ts)
 */
const NaverLastChangedStatusesDataSchema = z.object({
  lastChangeStatuses: z.array(
    z.object({
      orderId: z.string(),
      productOrderId: z.string(),
      lastChangedType: z.string(),
      paymentDate: z.iso.datetime(),
      lastChangedDate: z.iso.datetime(),
      productOrderStatus: ProductOrderStatusSchema,
      claimType: z.string().optional(), // TODO: Enum화 가능
      claimStatus: ClaimStatusSchema.optional(),
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
export const NaverLastChangedStatusResponseSchema = createNaverApiResponseSchema(NaverLastChangedStatusesDataSchema);
export type NaverLastChangedStatusResponse = z.infer<typeof NaverLastChangedStatusResponseSchema>;

/**
 * 상품 주문 상세 구조체 (Type)
 * (from naver-api.zod.ts)
 */
export interface ProductOrderInfo {
  order: any; // TODO: 상세 스키마 정의 필요
  productOrder: any; // TODO: 상세 스키마 정의 필요
  cancel?: any;
  return?: any;
  exchange?: any;
  beforeClaim: object;
  currentClaim: any;
  completedClaims: any[];
  delivery: any;
}
/** 상품 주문 상세 구조체 (Schema) - 응답용 */
const ProductOrderInfoSchema = z.object({
  order: z.any(),
  productOrder: z.any(),
  cancel: z.any().optional(),
  return: z.any().optional(),
  exchange: z.any().optional(),
  beforeClaim: z.object({}).optional(), // API 명세상 optional이 아니나, 안전을 위해
  currentClaim: z.any().optional(),
  completedClaims: z.array(z.any()).optional(),
  delivery: z.any().optional(),
});

/**
 * 상품 주문 상세 내역 응답 (getOrderDetails, queryProductOrders)
 * (from naver-api.zod.ts)
 */
export const NaverProductOrderDetailsResponseSchema = createNaverApiResponseSchema(z.array(ProductOrderInfoSchema));
export type NaverProductOrderDetailsResponse = z.infer<typeof NaverProductOrderDetailsResponseSchema>;

/**
 * 주문번호로 상품 주문번호 목록 응답 (getProductOrderIdsByOrderId)
 * (from naver-api.zod.ts)
 */
export const NaverProductOrderIdsResponseSchema = createNaverApiResponseSchema(z.array(z.string()));
export type NaverProductOrderIdsResponse = z.infer<typeof NaverProductOrderIdsResponseSchema>;
