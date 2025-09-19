import { z } from 'zod';

// -----------------------------------------------------------------
// -- 교환 관련 타입 (Exchange Types)
// -----------------------------------------------------------------

/** 교환 재배송 처리 요청 시 Body 데이터 타입 */
// 네이버 API에서 허용하는 배송 방법 코드 목록 (이미 정의되어 있다면 생략)
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

// 네이버 API에서 허용하는 택배사 코드 목록 (새로 추가)
const NAVER_DELIVERY_COMPANIES = [
  'CJGLS',
  'HYUNDAI',
  'HANJIN',
  'KGB',
  'EPOST',
  'MTINTER',
  '1004HOME',
  'TWOFASTEXPRESS',
  'ACE',
  'ACIEXPRESS',
  'ADCAIR',
  'AIRWAY',
  'APEX',
  'ARAMEX',
  'ARGO',
  'AIRBOYExpress',
  'KOREXG',
  'CUPARCEL',
  'CWAYEXPRESS',
  'DHL',
  'DHLDE',
  'DHLGLOBALMAIL',
  'DPD',
  'ECMSEspress',
  'EFS',
  'EMS',
  'EZUSA',
  'EUROPARCEL',
  'FEDEX',
  'GOP',
  'GOS',
  'GPSLOGIX',
  'GSFRESH',
  'GSIEXPRESS',
  'GSMNTON',
  'GSPOSTBOX',
  'CVSNET',
  'GS더프레시',
  'GSTHEFRESH',
  'GTSLOGIS',
  'HYBRID',
  'HI',
  'IK',
  'KGLNET',
  'KT',
  'LGEL',
  'LTL',
  'NDEXKOREA',
  'SBGLS',
  'SFEX',
  'SLX',
  'SSG',
  'TNT',
  'LOGISPARTNER',
  'UPS',
  'USPS',
  'WIZWA',
  'YJSWORLD',
  'YJS',
  'YUNDA',
  'IPARCEL',
  'KY',
  'KUNYOUNG',
  'KDEXP',
  'KIN',
  'KORYO',
  'GDSP',
  'KOKUSAI',
  'GOODTOLUCK',
  'NAEUN',
  'NOGOK',
  'NONGHYUP',
  'HANAROMART',
  'DAELIM',
  'DAESIN',
  'DAEWOON',
  'THEBAO',
  'DODOFLEX',
  'DONGGANG',
  'DONGJIN',
  'CHAINLOGIS',
  'DRABBIT',
  'JMNP',
  'ONEDAYLOGIS',
  'LINEEXP',
  'ROADSUNEXPRESS',
  'LOGISVALLEY',
  'POOLATHOME',
  'LOTOS',
  'HLCGLOBAL',
  'LOTTECHILSUNG',
  'MDLOGIS',
  'DASONG',
  'BABABA',
  'BANPOOM',
  'VALEX',
  'SHIPNERGY',
  'PANTOS',
  'VROONG',
  'BRIDGE',
  'EKDP',
  'SELC',
  'SEORIM',
  'SWGEXP',
  'SUNGHUN',
  'SEBANG',
  'SMARTLOGIS',
  'SPARKLE',
  'SPASYS1',
  'CRLX',
  'ANYTRACK',
  'ABOUTPET',
  'ESTHER',
  'VENDORPIA',
  'ACTCORE',
  'HKHOLDINGS',
  'NTLPS',
  'TODAYPICKUP',
  'RUSH',
  'ALLIN',
  'ALLTAKOREA',
  'WIDETECH',
  'YONGMA',
  'DCOMMERCE',
  'WEVILL',
  'HONAM',
  'WOORIHB',
  'WOOJIN',
  'REGISTPOST',
  'WOONGJI',
  'WARPEX',
  'WINION',
  'WIHTYOU',
  'WEMOVE',
  'UFREIGHT',
  'EUNHA',
  'INNOS',
  'EMARTEVERYDAY',
  'ESTLA',
  'ETOMARS',
  'GENERALPOST',
  'ILSHIN',
  'ILYANG',
  'GNETWORK',
  'ZENIEL',
  'JLOGIST',
  'GENIEGO',
  'GDAKOREA',
  'GHSPEED',
  'JIKGUMOON',
  'CHUNIL',
  'CHOROC',
  'CHOROCMAEUL',
  'COSHIP',
  'KJT',
  'QRUN',
  'CUBEFLOW',
  'QXPRESS',
  'HEREWEGO',
  'TOMATO',
  'TODAY',
  'TSG',
  'TEAMFRESH',
  'PATEK',
  'XINPATEK',
  'PANASIA',
  'PANSTAR',
  'FOREVER',
  'PULMUONE',
  'FREDIT',
  'FRESHMATES',
  'FRESH',
  'PINGPONG',
  'HOWSER',
  'HIVECITY',
  'HANDALUM',
  'HANDEX',
  'HANMI',
  'HANSSEM',
  'HANWOORI',
  'HPL',
  'HDEXP',
  'HERWUZUG',
  'GLOVIS',
  'HOMEINNO',
  'HOMEPICKTODAY',
  'HOMEPICK',
  'HOMEPLUSDELIVERY',
  'HOMEPLUSEXPRESS',
  'CARGOPLEASE',
  'HWATONG',
  'CH1',
  'LETUS',
  'LETUS3PL',
  'CASA',
  'GCS',
  'GKGLOBAL',
  'BRCH',
  'DNDN',
  'GONELO',
  'JCLS',
  'JWTNL',
  'GS25',
  'CU',
] as const;

/** '교환 재배송 처리' API의 요청 본문(Body)에 대한 Zod 스키마 */
export const ExchangeRedeliveryBodySchema = z.object({
  reDeliveryMethod: z.enum(NAVER_DELIVERY_METHODS),
  reDeliveryCompany: z.enum(NAVER_DELIVERY_COMPANIES),
  reDeliveryTrackingNumber: z.string().min(1, '재배송 송장 번호는 필수입니다.'),
});
export type ExchangeRedeliveryBody = z.infer<
  typeof ExchangeRedeliveryBodySchema
>;

// 네이버 API에서 허용하는 보류 유형 코드 목록 (이미 정의되어 있다면 생략)
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

/** '교환 보류' API의 요청 본문(Body)에 대한 Zod 스키마 */
export const HoldExchangeBodySchema = z.object({
  holdbackClassType: z.enum(NAVER_HOLDBACK_REASONS),
  holdbackExchangeDetailReason: z
    .string()
    .min(1, '보류 상세 사유는 필수입니다.'),
  extraExchangeFeeAmount: z.number().optional(),
});
export type HoldExchangeBody = z.infer<typeof HoldExchangeBodySchema>;

/** 교환 거부(철회) 처리 요청 시 Body 데이터 타입 */
export const RejectExchangeBodySchema = z.object({
  rejectExchangeReason: z.string().min(1, '교환 거부 사유는 필수입니다.'),
});
export type RejectExchangeBody = z.infer<typeof RejectExchangeBodySchema>;

// -----------------------------------------------------------------
// -- 반품 관련 타입 (Return Types)
// -----------------------------------------------------------------

/** 반품 보류 처리 요청 시 Body 데이터 타입 */

/** '반품 보류' API의 요청 본문(Body)에 대한 Zod 스키마 */
export const HoldReturnBodySchema = z.object({
  holdbackClassType: z.enum(NAVER_HOLDBACK_REASONS),
  holdbackReturnDetailReason: z.string().min(1, '보류 상세 사유는 필수입니다.'),
  extraReturnFeeAmount: z.number().optional(),
});
export type HoldReturnBody = z.infer<typeof HoldReturnBodySchema>;

/** 반품 거부(철회) 처리 요청 시 Body 데이터 타입 */
export const RejectReturnBodySchema = z.object({
  rejectReturnReason: z.string().min(1, '반품 거부 사유는 필수입니다.'),
});
export type RejectReturnBody = z.infer<typeof RejectReturnBodySchema>;
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

/** '반품 요청' API의 요청 본문(Body)에 대한 Zod 스키마 */
export const RequestReturnBodySchema = z.object({
  returnReason: z.enum(NAVER_RETURN_REASONS),
  collectDeliveryMethod: z.enum(NAVER_DELIVERY_METHODS),
  collectDeliveryCompany: z.string().optional(),
  collectTrackingNumber: z.string().optional(),
  returnQuantity: z
    .number()
    .int('반품 수량은 정수여야 합니다.')
    .positive('반품 수량은 0보다 커야 합니다.')
    .optional(),
});
export type RequestReturnBody = z.infer<typeof RequestReturnBodySchema>;

// -----------------------------------------------------------------
// -- 발주/발송 관련 타입 (Order/Dispatch Types)
// -----------------------------------------------------------------

/** 발송 처리 요청 시 개별 주문의 데이터 타입 */
/** '발송 처리' API의 개별 주문 객체에 대한 Zod 스키마 */
export const DispatchProductOrderSchema = z.object({
  productOrderId: z.string().min(1, '상품 주문 번호는 필수입니다.'),
  deliveryMethod: z.enum(NAVER_DELIVERY_METHODS),
  deliveryCompanyCode: z.enum(NAVER_DELIVERY_COMPANIES),
  trackingNumber: z.string().min(1, '송장 번호는 필수입니다.'),
  dispatchDate: z.string().datetime('발송일은 ISO 8601 형식이어야 합니다.'),
});
export type DispatchProductOrder = z.infer<typeof DispatchProductOrderSchema>;
/** 발송 지연 처리 요청 시 Body 데이터 타입 */
export interface DelayDispatchBody {
  dispatchDueDate: string;
  delayedDispatchReason: string;
  dispatchDelayedDetailedReason: string;
}

/** 배송 희망일 변경 처리 요청 시 Body 데이터 타입에 대한 Zod 스키마 */
export const ChangeHopeDeliveryBodySchema = z.object({
  hopeDeliveryYmd: z
    .string()
    .regex(/^\d{8}$/, '배송희망일은 yyyymmdd 형식이어야 합니다.'),
  hopeDeliveryHm: z
    .string()
    .regex(/^\d{4}$/, '배송희망시간은 HHmm 형식이어야 합니다.')
    .optional(),
  region: z
    .string()
    .min(1)
    .max(30, '지역은 1~30자 사이여야 합니다.')
    .optional(),
  changeReason: z
    .string()
    .min(1, '변경 사유는 필수입니다.')
    .max(300, '변경 사유는 최대 300자입니다.'),
});
export type ChangeHopeDeliveryBody = z.infer<
  typeof ChangeHopeDeliveryBodySchema
>;

// -----------------------------------------------------------------
// -- 주문 조회 관련 타입 (Order Lookup Types)
// -----------------------------------------------------------------

/** 변경 상품 주문 정보 구조체 */
export interface ChangedProductOrder {
  orderId: string;
  productOrderId: string;
  lastChangedType: string;
  paymentDate: string;
  lastChangedDate: string;
  productOrderStatus: string;
  claimType?: string;
  claimStatus?: string;
  receiverAddressChanged: boolean;
}

/** 변경된 주문 목록 조회 API의 응답 데이터 타입 */
interface LastChangedStatusesData {
  lastChangeStatuses: ChangedProductOrder[];
  more?: { moreFrom: string; moreSequence: string };
}

/** 변경된 주문 목록 조회 API의 전체 응답 타입 */
export interface NaverLastChangedStatusResponse {
  timestamp: string;
  traceId: string;
  data: LastChangedStatusesData;
}

/** 상품 주문 상세 정보 하위 객체 (Placeholder) */
interface NaverOrderDetails {
  /* 주문 공통 상세 정보 */
}
interface NaverProductOrderDetails {
  /* 상품 주문 상세 정보 */
}
interface NaverClaimDetails {
  /* 클레임(취소/반품/교환) 상세 정보 */
}
interface NaverDeliveryDetails {
  /* 배송 상세 정보 */
}

/** 상품 주문 상세 정보 구조체 (API 응답 데이터 배열의 개별 요소) */
export interface ProductOrderInfo {
  order: NaverOrderDetails;
  productOrder: NaverProductOrderDetails;
  cancel?: NaverClaimDetails;
  return?: NaverClaimDetails;
  exchange?: NaverClaimDetails;
  beforeClaim: object;
  currentClaim: NaverClaimDetails;
  completedClaims: NaverClaimDetails[];
  delivery: NaverDeliveryDetails;
}

/** 상품 주문 상세 내역 조회 API의 전체 응답 타입 */
export interface NaverProductOrderDetailsResponse {
  timestamp: string;
  traceId: string;
  data: ProductOrderInfo[];
}

/** 주문 번호로 상품 주문 번호 목록 조회 API의 전체 응답 타입 */
export interface NaverProductOrderIdsResponse {
  timestamp: string;
  traceId: string;
  data: string[];
}

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

/** 조건형 상품 주문 상세 내역 조회 시 Query Parameter에 대한 Zod 스키마 */
export const QueryProductOrdersParamsSchema = z.object({
  from: z.string().datetime('조회 시작일시는 ISO 8601 형식이어야 합니다.'),
  to: z
    .string()
    .datetime('조회 종료일시는 ISO 8601 형식이어야 합니다.')
    .optional(),
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

// -----------------------------------------------------------------
// -- 취소 관련 타입 (Cancel Types)
// -----------------------------------------------------------------

const NAVER_CANCEL_REASONS = [
  'INTENT_CHANGED',
  'COLOR_AND_SIZE',
  'WRONG_ORDER',
  'PRODUCT_UNSATISFIED',
  'DELAYED_DELIVERY',
  'SOLD_OUT',
  'INCORRECT_INFO',
] as const;

/** 취소 요청 처리 시 Body 데이터 타입에 대한 Zod 스키마 */
export const RequestCancelBodySchema = z.object({
  cancelReason: z.enum(NAVER_CANCEL_REASONS),
  cancelDetailedReason: z
    .string()
    .max(500, '상세 사유는 500자를 초과할 수 없습니다.')
    .optional(),
  cancelQuantity: z.number().int().positive().optional(),
});
export type RequestCancelBody = z.infer<typeof RequestCancelBodySchema>;

// 네이버 API에서 허용하는 상품 판매 상태 코드 목록
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

/** '판매 상태 변경' API의 요청 본문(Body)에 대한 Zod 스키마 */

/** 할인 혜택 객체에 대한 Zod 스키마 */
const DiscountMethodSchema = z.object({
  value: z.number().int('할인 값은 정수여야 합니다.'),
  unitType: z.enum(['PERCENT', 'WON', 'YEN', 'COUNT']),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

/** 조합형 옵션의 재고 정보 Zod 스키마 */
const OptionCombinationStockSchema = z.object({
  id: z.number().int('옵션 ID는 정수여야 합니다.'),
  stockQuantity: z.number().int('재고 수량은 정수여야 합니다.'),
  // 가격, 사용 여부 등은 재고 동기화 시 필수가 아닐 수 있으므로 optional 처리
  price: z.number().int().optional(),
  usable: z.boolean().optional(),
});

/** 표준형 옵션의 재고 정보 Zod 스키마 */
const OptionStandardStockSchema = z.object({
  id: z.number().int('옵션 ID는 정수여야 합니다.'),
  stockQuantity: z.number().int('재고 수량은 정수여야 합니다.'),
  usable: z.boolean().optional(),
});

/** '상품 옵션 재고 변경' API의 요청 본문(Body)에 대한 최종 Zod 스키마 */
export const UpdateOptionStockBodySchema = z.object({
  // C_URL_ 예시에 따라 필수로 포함
  productSalePrice: z.object({
    salePrice: z.number().int('판매가는 정수여야 합니다.'),
  }),

  // C_URL_ 예시에 따라 필수로 포함
  immediateDiscountPolicy: z.object({
    discountMethod: DiscountMethodSchema,
  }),

  // 문서에 명시된 필수 필드
  optionInfo: z.object({
    optionCombinations: z.array(OptionCombinationStockSchema).optional(),
    optionStandards: z.array(OptionStandardStockSchema).optional(),
    useStockManagement: z.boolean(),
  }),
});

/** '판매 상태 변경' API의 요청 본문(Body)에 대한 Zod 스키마 */
export const ChangeSaleStatusBodySchema = z.object({
  statusType: z.enum(NAVER_SALE_STATUS_TYPES),
  saleStartDate: z.string().datetime().optional(),
  saleEndDate: z.string().datetime().optional(),
  stockQuantity: z.number().int().max(99999999).optional(),
});
export type ChangeSaleStatusBody = z.infer<typeof ChangeSaleStatusBodySchema>;

// Zod 스키마로부터 TypeScript 타입 자동 생성
export type UpdateOptionStockBody = z.infer<typeof UpdateOptionStockBodySchema>;
