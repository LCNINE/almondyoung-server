import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcrypt';
import { z } from 'zod';

// =================================================================
// == 1. 타입 정의 (Type Definitions)
// =================================================================

// -----------------------------------------------------------------
// -- 공통 타입 (Common Types)
// -----------------------------------------------------------------

/** 다수 API에서 공통으로 사용하는 실패 정보 구조체 */
interface FailProductOrderInfo {
  productOrderId: string;
  code: string;
  message: string;
}

/** 주문-클레임 처리 API의 공통 응답 데이터 구조체 */
interface ClaimProcessResponseData {
  successProductOrderIds: string[];
  failProductOrderInfos: FailProductOrderInfo[];
}

/** 주문-클레임 처리 API의 공통 응답 래퍼 구조체 */
export interface NaverClaimProcessResponse {
  timestamp: string;
  traceId: string;
  data: ClaimProcessResponseData;
}

/** OAuth 토큰 발급 API 응답 타입 */
interface NaverTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

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

// =================================================================
// == 2. API 클라이언트 서비스 (NaverCommerceApiService Class)
// =================================================================
@Injectable()
export class NaverCommerceApiService {
  private readonly logger = new Logger(NaverCommerceApiService.name);
  private readonly apiBaseUrl = process.env.NAVER_API_ENDPOINT || '';

  constructor(private readonly http: HttpService) {}

  // == 교환 (Exchange)
  // =================================================================

  /**
   * 1건의 상품 주문에 대한 교환을 수거 완료 처리합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */

  async approveExchangeCollection(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/collect/approve`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }

  /**
   * 1건의 상품 주문 교환 승인 건을 재배송 처리합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 재배송 정보
   * @returns API 응답 데이터
   */

  async dispatchExchangeRedelivery(
    token: string,
    productOrderId: string,
    body: ExchangeRedeliveryBody,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/dispatch`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  /**
   * 1건의 상품 주문에 대한 교환을 보류합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 교환 보류 사유 정보
   * @returns API 응답 데이터
   */

  async holdExchange(
    token: string,
    productOrderId: string,
    body: HoldExchangeBody,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/holdback`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문에 대한 교환 보류를 해제합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async releaseExchangeHold(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/holdback/release`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문에 대한 교환 요청을 거부(철회)합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 교환 거부 사유
   * @returns API 응답 데이터
   */
  async rejectExchange(
    token: string,
    productOrderId: string,
    body: RejectExchangeBody,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/reject`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  // =================================================================
  // == 반품 (Return)
  // =================================================================
  /**
   * 1건의 상품 주문에 대한 반품 요청을 승인합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */

  async approveReturn(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/approve`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }

  /**
   * 1건의 상품 주문에 대한 반품을 보류합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 반품 보류 사유 정보
   * @returns API 응답 데이터
   */
  async holdReturn(
    token: string,
    productOrderId: string,
    body: HoldReturnBody,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/holdback`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문에 대한 반품 보류를 해제합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async releaseReturnHold(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/holdback/release`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문에 대한 반품 요청을 거부(철회)합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 반품 거부 사유
   * @returns API 응답 데이터
   */
  async rejectReturn(
    token: string,
    productOrderId: string,
    body: RejectReturnBody,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/reject`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  /**
   * 1건의 상품 주문에 대해 반품 요청합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 반품 요청 정보
   * @returns API 응답 데이터
   */
  async requestReturn(
    token: string,
    productOrderId: string,
    body: RequestReturnBody,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/request`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  // =================================================================
  // == 발주 / 발송 처리 (Order / Dispatch)
  // =================================================================

  /**
   * 단수 또는 복수 개 상품 주문의 발주를 확인 처리합니다.
   * @param token 액세스 토큰
   * @param productOrderIds 발주 확인할 상품 주문 번호 배열
   * @returns API 응답 데이터
   */
  async confirmOrders(
    token: string,
    productOrderIds: string[],
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/confirm`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        { productOrderIds },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 단수 또는 복수 개 상품 주문을 발송 처리합니다.
   * @param token 액세스 토큰
   * @param dispatchProductOrders 발송 처리할 주문 정보 배열
   * @returns API 응답 데이터
   */
  async dispatchOrders(
    token: string,
    dispatchProductOrders: DispatchProductOrder[],
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/dispatch`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        { dispatchProductOrders },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 특정 상품 주문을 발송 지연 처리합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 발송 지연 사유 정보
   * @returns API 응답 데이터
   */
  async delayDispatch(
    token: string,
    productOrderId: string,
    body: DelayDispatchBody,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/delay`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
  /**
   * 배송 희망일 정보를 변경 처리합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 배송 희망일 변경 정보
   * @returns API 응답 데이터
   */
  async changeHopeDelivery(
    token: string,
    productOrderId: string,
    body: ChangeHopeDeliveryBody,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/hope-delivery/change`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  // =================================================================
  // == 주문 조회 (Order Lookup)
  // =================================================================

  /**
   * 지정된 기간 내에 변경된 상품 주문 내역을 조회합니다.
   * @param token 액세스 토큰
   * @param lastChangedFrom 조회 시작 시각 (ISO 8601 형식)
   * @returns API 응답 데이터
   */
  async getLastChangedStatuses(
    token: string,
    lastChangedFrom: string,
  ): Promise<NaverLastChangedStatusResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/last-changed-statuses`;
    const response = await firstValueFrom(
      this.http.get<NaverLastChangedStatusResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: { lastChangedFrom, limitCount: 300 },
      }),
    );
    return response.data;
  }
  /**
   * 상품 주문 번호 목록으로 상세 주문 내역을 조회합니다.
   * @param token 액세스 토큰
   * @param productOrderIds 조회할 상품 주문 번호 배열
   * @returns API 응답 데이터
   */
  async getOrderDetails(
    token: string,
    productOrderIds: string[],
  ): Promise<NaverProductOrderDetailsResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/query`;
    const response = await firstValueFrom(
      this.http.post<NaverProductOrderDetailsResponse>(
        url,
        { productOrderIds },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 조건에 맞는 상품 주문에 대한 상세 내역을 조회합니다.
   * @param token 액세스 토큰
   * @param params 조회 조건을 담은 객체
   * @returns API 응답 데이터
   */
  async queryProductOrders(
    token: string,
    params: QueryProductOrdersParams,
  ): Promise<NaverProductOrderDetailsResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders`;
    const response = await firstValueFrom(
      this.http.get<NaverProductOrderDetailsResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: params,
      }),
    );
    return response.data;
  }

  /**
   * 주문 번호(orderId)에 속한 모든 상품 주문 번호(productOrderId) 목록을 조회합니다.
   * @param token 액세스 토큰
   * @param orderId 조회할 주문 번호
   * @returns API 응답 데이터
   */
  async getProductOrderIdsByOrderId(
    token: string,
    orderId: string,
  ): Promise<NaverProductOrderIdsResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/orders/${orderId}/product-order-ids`;
    const response = await firstValueFrom(
      this.http.get<NaverProductOrderIdsResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  // =================================================================
  // == 취소 (Cancel)
  // =================================================================
  /**
   * 1건의 상품 주문에 대한 취소 요청을 승인합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async approveCancel(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/cancel/approve`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문을 취소 요청합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 취소 요청 정보
   * @returns API 응답 데이터
   */
  async requestCancel(
    token: string,
    productOrderId: string,
    body: RequestCancelBody,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/cancel/request`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  // =================================================================
  // == 인증 (Authentication)
  // =================================================================

  async getAccessToken(): Promise<string> {
    this.logger.log('네이버 커머스 API 액세스 토큰 발급 요청');
    const timestamp = Date.now().toString();
    const clientId = process.env.NAVER_CLIENT_ID ?? '';
    const clientSecret = process.env.NAVER_CLIENT_SECRET ?? '';
    const password = `${clientId}_${timestamp}`;
    const salt = clientSecret;
    const hashed = bcrypt.hashSync(password, salt);
    const clientSecretSign = Buffer.from(hashed, 'utf-8').toString('base64');
    const params = new URLSearchParams([
      ['grant_type', 'client_credentials'],
      ['client_id', clientId],
      ['timestamp', timestamp],
      ['client_secret_sign', clientSecretSign],
      ['type', 'SELF'],
    ]);
    const res = await firstValueFrom(
      this.http.post<NaverTokenResponse>(
        'https://api.commerce.naver.com/external/v1/oauth2/token',
        params,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );
    this.logger.log('✅ 액세스 토큰 발급 성공');
    return res.data.access_token;
  }
}
