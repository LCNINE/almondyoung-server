import { z } from 'zod';

/**
 * 쿠팡 발주서 목록 조회 API Zod 스키마
 *
 * API 문서: GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets
 *
 * @author Channel Adapter Team
 * @version 1.0.0
 */

/**
 * 쿠팡 발주서 상태 enum
 */
export const CoupangOrderStatusSchema = z.enum([
  'ACCEPT', // 결제완료
  'INSTRUCT', // 상품준비중
  'DEPARTURE', // 배송지시
  'DELIVERING', // 배송중
  'FINAL_DELIVERY', // 배송완료
  'NONE_TRACKING', // 업체 직접 배송(배송 연동 미적용), 추적불가
]);

/**
 * 통화 정보 스키마 (ISO-4217 표준)
 */
export const CurrencySchema = z.object({
  /**
   * 통화 코드 (ISO-4217 표준 준수), 대문자 3개
   * @example "KRW"
   */
  currencyCode: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/),

  /**
   * 통화 정수 부분, 64 bit
   * @example 19000
   */
  units: z.number().int(),

  /**
   * 통화 소수점 부분, 32 bit, 값 범위 [-999999999, 999999999]
   * @example 0
   */
  nanos: z.number().int().min(-999999999).max(999999999),
});

/**
 * 주문자 정보 스키마
 */
export const OrdererSchema = z.object({
  /**
   * 주문자 이름
   * @example "신*희"
   */
  name: z.string(),

  /**
   * 주문자 email (미사용, 빈값)
   * @example ""
   */
  email: z.string().optional(),

  /**
   * 수취인 연락처(안심번호) (E.164표준 준수)
   * @example "+1(555)444-1234"
   */
  safeNumber: z.string(),

  /**
   * 주문자 연락처(실전화번호) (E.164표준 준수)
   * null 값 가능
   */
  ordererNumber: z.string().nullable(),
});

/**
 * 수취인 정보 스키마
 */
export const ReceiverSchema = z.object({
  /**
   * 수취인 이름
   * @example "신*희"
   */
  name: z.string(),

  /**
   * 수취인 연락처(안심번호) (E.164표준 준수)
   * @example "+1(555)444-1234"
   */
  safeNumber: z.string(),

  /**
   * 수취인 연락처(실전화번호) (E.164표준 준수)
   */
  receiverNumber: z.string().nullable(),

  /**
   * 수취인 배송지1
   * @example "경기 오산시 가수동 **아파트"
   */
  addr1: z.string(),

  /**
   * 수취인 배송지2
   * @example "109동 *호"
   */
  addr2: z.string(),

  /**
   * 수취인 우편번호
   * @example "447-700"
   */
  postCode: z.string(),
});

/**
 * 해외배송정보 스키마
 */
export const OverseaShippingInfoSchema = z.object({
  /**
   * 개인통관 고유부호
   */
  personalCustomsClearanceCode: z.string().optional(),

  /**
   * 미사용
   */
  orderersSsn: z.string().optional(),

  /**
   * 통관용 구매자 전화번호 (E.164표준 준수)
   */
  ordererPhoneNumber: z.string().optional(),
});

/**
 * 주문 상품 정보 스키마
 */
export const OrderItemSchema = z.object({
  /**
   * vendorItemPackageId (미사용 / 없는 경우 0으로 리턴)
   */
  vendorItemPackageId: z.number().default(0),

  /**
   * vendorItemPackageName (미사용)
   */
  vendorItemPackageName: z.string().optional(),

  /**
   * productId (optional / 없는 경우 0으로 리턴)
   */
  productId: z.number().default(0),

  /**
   * 옵션ID
   * @example 3242596358
   */
  vendorItemId: z.number(),

  /**
   * 노출상품명
   * @example "인디고뱅크키즈 기모 테잎배색 트레이닝 팬츠 IKTM17WG1, 07 DARK GREY, 160호"
   */
  vendorItemName: z.string(),

  /**
   * 주문시 item의 구매 수량
   * 발주 가능 수량 = shippingCount - (holdCountForCancel + cancelCount)
   */
  shippingCount: z.number().int().min(0),

  /**
   * 개당 상품 가격
   */
  salesPrice: CurrencySchema,

  /**
   * 결제 가격: salesPrice * shippingCount
   */
  orderPrice: CurrencySchema,

  /**
   * 총 할인 가격
   */
  discountPrice: CurrencySchema,

  /**
   * 즉시할인 쿠폰 할인 금액
   */
  instantCouponDiscount: CurrencySchema,

  /**
   * 다운로드 쿠폰 할인 금액
   */
  downloadableCouponDiscount: CurrencySchema,

  /**
   * 쿠팡 지원 할인 (장바구니/카테고리 쿠폰 등)
   */
  coupangDiscount: CurrencySchema,

  /**
   * external code (optional)
   */
  externalVendorSkuCode: z.string().optional(),

  /**
   * 상품별 개별 입력 항목 (optional)
   */
  etcInfoHeader: z.string().nullable(),

  /**
   * 상품별 개별 입력 항목에 대한 사용자의 입력값 (optional)
   * 필드는 존재하나 값이 없는 상태, etcInfoValues 사용 권장
   */
  etcInfoValue: z.string().nullable(),

  /**
   * 상품별 개별 입력 항목에 대한 사용자의 입력값 리스트 (optional)
   */
  etcInfoValues: z.array(z.string()).optional(),

  /**
   * 등록상품ID
   * @example 80240831
   */
  sellerProductId: z.number(),

  /**
   * 등록상품명
   * @example "인디고뱅크키즈 A5 기모 배색츄키니 IKTM17WG1"
   */
  sellerProductName: z.string(),

  /**
   * 등록옵션명
   * @example "07 DARK GREY 160호"
   */
  sellerProductItemName: z.string(),

  /**
   * 최초등록옵션명
   * @example "07 DARK GREY/160호"
   */
  firstSellerProductItemName: z.string(),

  /**
   * 취소수량
   */
  cancelCount: z.number().int().min(0).default(0),

  /**
   * 환불대기수량
   */
  holdCountForCancel: z.number().int().min(0).default(0),

  /**
   * 주문시 출고예정일 (불리배송 출고예정일) (ISO-8601표준)
   * optional / yyyy-mm-dd
   */
  estimatedShippingDate: z.string().optional(),

  /**
   * 실제 출고예정일 (분리배송 시) (ISO-8601표준)
   * optional / yyyy-mm-dd
   */
  plannedShippingDate: z.string().optional(),

  /**
   * 운송장번호 업로드 일시 (ISO-8601표준)
   * optional / yyyy-MM-dd'T'HH:mm:ss
   */
  invoiceNumberUploadDate: z.string().optional(),

  /**
   * 업체상품옵션 추가 정보 (optional / key:value 형태)
   */
  extraProperties: z.record(z.any()).optional(),

  /**
   * 최저가 상품 여부
   */
  pricingBadge: z.boolean().default(false),

  /**
   * 중고 상품 여부
   */
  usedProduct: z.boolean().default(false),

  /**
   * 구매확정일자 (ISO-8601표준)
   * yyyy-MM-dd HH:mm:ss
   */
  confirmDate: z.string().optional(),

  /**
   * 배송비구분 (유료, 무료)
   */
  deliveryChargeTypeName: z.string().optional(),

  /**
   * 자동생성옵션 ID
   */
  upBundleVendorItemId: z.number().optional(),

  /**
   * 자동생성옵션 노출상품명
   */
  upBundleVendorItemName: z.string().optional(),

  /**
   * 자동생성옵션 개수
   */
  upBundleSize: z.number().optional(),

  /**
   * 자동생성옵션 아이템 여부
   */
  upBundleItem: z.boolean().default(false),

  /**
   * 주문 취소 여부
   */
  canceled: z.boolean().default(false),
});

/**
 * 쿠팡 발주서 스키마
 */
export const CoupangOrderSheetSchema = z.object({
  /**
   * 배송번호(묶음배송번호)
   * @example 64253897***6401429
   */
  shipmentBoxId: z.number(),

  /**
   * 주문번호
   * @example 22000009546234
   */
  orderId: z.number(),

  /**
   * 주문일시 (ISO-8601표준)
   * YYYY-MM-DDThh:mm:ss.ssssss±hh:mm
   */
  orderedAt: z.string().datetime(),

  /**
   * 주문자 정보
   */
  orderer: OrdererSchema,

  /**
   * 결제일시 (ISO-8601표준)
   * YYYY-MM-DDThh:mm:ss.ssssss±hh:mm
   */
  paidAt: z.string().datetime(),

  /**
   * 발주서 상태
   */
  status: CoupangOrderStatusSchema,

  /**
   * 배송비
   */
  shippingPrice: CurrencySchema,

  /**
   * 도서산간배송비
   */
  remotePrice: CurrencySchema.nullable(),

  /**
   * 도서산간여부
   */
  remoteArea: z.boolean().default(false),

  /**
   * 배송메세지 (optional)
   */
  parcelPrintMessage: z.string().optional(),

  /**
   * 분리배송여부
   */
  splitShipping: z.boolean().default(false),

  /**
   * 분리배송가능여부
   */
  ableSplitShipping: z.boolean().default(false),

  /**
   * 수취인 정보
   */
  receiver: ReceiverSchema,

  /**
   * 주문 상품 목록
   */
  orderItems: z.array(OrderItemSchema),

  /**
   * 해외배송정보 (optional)
   */
  overseaShippingInfoDto: OverseaShippingInfoSchema.optional(),

  /**
   * 택배사
   * @example "CJ 대한통운"
   */
  deliveryCompanyName: z.string().optional(),

  /**
   * 운송장번호
   */
  invoiceNumber: z.string().optional(),

  /**
   * 출고일(발송일) (ISO-8601표준)
   * YYYY-MM-DDThh:mm:ss.ssssss±hh:mm
   */
  inTrasitDateTime: z.string().datetime().optional(),

  /**
   * 배송완료일 (ISO-8601표준)
   * YYYY-MM-DDThh:mm:ss.ssssss±hh:mm
   */
  deliveredDate: z.string().datetime().optional(),

  /**
   * 결제위치
   * @example "안드로이드앱"
   */
  refer: z.string().optional(),

  /**
   * 배송유형
   * THIRD_PARTY, CGF, CGF LITE
   */
  shipmentType: z.string().optional(),
});

/**
 * 쿠팡 발주서 목록 조회 API 응답 스키마
 */
export const CoupangOrderSheetListResponseSchema = z.object({
  /**
   * 서버 응답 코드
   * @example 200
   */
  code: z.number().int(),

  /**
   * 서버 응답 메세지
   * @example "OK"
   */
  message: z.string(),

  /**
   * 발주서 목록 (결과가 없을 때는 빈 리스트)
   */
  data: z.array(CoupangOrderSheetSchema),

  /**
   * 다음 페이지 요청 전송시 필요한 token 값
   * 마지막 페이지인 경우 빈 값으로 리턴
   */
  nextToken: z.string().optional(),
});

/**
 * 쿠팡 발주서 목록 조회 API 요청 파라미터 스키마
 */
export const CoupangOrderSheetRequestSchema = z.object({
  /**
   * 판매자 ID
   * @example "A00012345"
   */
  vendorId: z
    .string()
    .regex(/^A\d{8}$/, '올바른 판매자 ID 형식이어야 합니다 (예: A00012345)'),

  /**
   * 검색 시작일시 (ISO-8601표준)
   * "yyyy-mm-dd+09:00" 형태
   * @example "2025-07-01+09:00"
   */
  createdAtFrom: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}\+\d{2}:\d{2}$/,
      'ISO-8601 표준 형식이어야 합니다 (예: 2025-07-01+09:00)',
    ),

  /**
   * 검색 종료일시 (ISO-8601표준)
   * "yyyy-mm-dd+09:00" 형태
   * 최대 31일까지 조회 가능
   * @example "2025-07-31+09:00"
   */
  createdAtTo: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}\+\d{2}:\d{2}$/,
      'ISO-8601 표준 형식이어야 합니다 (예: 2025-07-31+09:00)',
    ),

  /**
   * 발주서 상태
   */
  status: CoupangOrderStatusSchema,

  /**
   * 다음 페이지 조회를 위한 token값
   * 첫번째 페이지 조회시에는 필요하지 않음
   */
  nextToken: z.string().optional(),

  /**
   * 페이지당 최대 조회 요청 값
   * default = 50, 최대 50개
   */
  maxPerPage: z.number().int().min(1).max(50).default(50),

  /**
   * search type for order sheets results
   * searchType=timeFrame이면 발주서 목록 조회(분단위 전체)로 수행
   * 그 외에는 발주서 목록 조회(일단위 페이징)로 수행
   */
  searchType: z.string().optional(),
});

// 타입 추출
export type CoupangOrderStatus = z.infer<typeof CoupangOrderStatusSchema>;
export type Currency = z.infer<typeof CurrencySchema>;
export type Orderer = z.infer<typeof OrdererSchema>;
export type Receiver = z.infer<typeof ReceiverSchema>;
export type OverseaShippingInfo = z.infer<typeof OverseaShippingInfoSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type CoupangOrderSheet = z.infer<typeof CoupangOrderSheetSchema>;
export type CoupangOrderSheetListResponse = z.infer<
  typeof CoupangOrderSheetListResponseSchema
>;
export type CoupangOrderSheetRequest = z.infer<
  typeof CoupangOrderSheetRequestSchema
>;

/**
 * 쿠팡 상태를 내부 표준 상태로 매핑하는 함수
 */
export function mapCoupangStatusToInternal(
  coupangStatus: CoupangOrderStatus,
): string {
  const statusMap: Record<CoupangOrderStatus, string> = {
    ACCEPT: 'PAID', // 결제완료
    INSTRUCT: 'PREPARING', // 상품준비중
    DEPARTURE: 'READY_TO_SHIP', // 배송지시
    DELIVERING: 'SHIPPED', // 배송중
    FINAL_DELIVERY: 'DELIVERED', // 배송완료
    NONE_TRACKING: 'SHIPPED', // 업체 직접 배송(배송 연동 미적용), 추적불가
  };

  return statusMap[coupangStatus] || coupangStatus;
}

/**
 * 날짜 범위 검증 함수 (최대 31일)
 */
export function validateDateRange(
  createdAtFrom: string,
  createdAtTo: string,
): boolean {
  const fromDate = new Date(createdAtFrom.replace('+09:00', ''));
  const toDate = new Date(createdAtTo.replace('+09:00', ''));

  const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays <= 31;
}
