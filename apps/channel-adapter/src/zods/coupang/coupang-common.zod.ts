import { z } from 'zod';

/**
 * 쿠팡 API 공통 Zod 스키마
 *
 * 모든 쿠팡 도메인에서 공통으로 사용하는 스키마, 헬퍼 함수, 상수를 정의합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */

// =================================================================
// == 공통 헬퍼 함수 (Common Helper Functions)
// =================================================================

/**
 * 쿠팡 API 공통 응답 구조를 생성하는 제네릭 헬퍼 함수
 */
export function createCoupangApiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    code: z.number(), // e.g. 200
    message: z.string(), // e.g. "OK"
    data: dataSchema, // 실제 데이터
    nextToken: z.string().optional(), // 일부 API에서만 내려옴
  });
}

// =================================================================
// == 공통 스키마 (Common Schemas)
// =================================================================

/**
 * 통화 정보 스키마 (ISO-4217 표준)
 */
export const CurrencySchema = z.object({
  currencyCode: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/), // 통화 코드 (e.g., "KRW")
  units: z.number().int(), // 통화 정수 부분 (e.g., 19000)
  nanos: z.number().int().min(-999999999).max(999999999), // 통화 소수점 부분
});

/**
 * 쿠팡에서 지원하는 택배사 코드
 */
export const CoupangDeliveryCompanyCodeSchema = z.enum([
  'CJGLS',
  'LOTTE',
  'HANJIN',
  'LOGEN',
  'EPOST',
  'KGB',
  'HYUNDAI',
  'DHL',
  'FEDEX',
  'UPS',
  'EMS',
  'KDEXP',
  'GOODTOLUCK',
  'DAELIM',
  'DONGGANG',
  'CHUNIL',
  'HONAM',
  'DAESIN',
  'ILYANG',
  'PANTOS',
  'FRESH',
  'CVSNET',
  'OTHER',
]);

/**
 * 쿠팡 발주서 상태
 */
export const CoupangOrderStatusSchema = z.enum([
  'ACCEPT',
  'INSTRUCT',
  'DEPARTURE',
  'DELIVERING',
  'FINAL_DELIVERY',
  'NONE_TRACKING',
]);

/**
 * 주문자 정보 스키마
 */
export const OrdererSchema = z.object({
  name: z.string(), // 주문자 이름
  safeNumber: z.string(), // 주문자 연락처 (안심번호)
  ordererNumber: z.string().nullable(), // 주문자 연락처 (실제번호)
});

/**
 * 수취인 정보 스키마
 */
export const ReceiverSchema = z.object({
  name: z.string(), // 수취인 이름
  safeNumber: z.string(), // 수취인 연락처 (안심번호)
  receiverNumber: z.string().nullable(), // 수취인 연락처 (실제번호)
  addr1: z.string(), // 수취인 배송지 주소
  addr2: z.string(), // 수취인 배송지 상세주소
  postCode: z.string(), // 수취인 우편번호
});

// =================================================================
// == 타입 추출 (Type Exports)
// =================================================================

export type Currency = z.infer<typeof CurrencySchema>;
export type CoupangDeliveryCompanyCode = z.infer<typeof CoupangDeliveryCompanyCodeSchema>;
export type CoupangOrderStatus = z.infer<typeof CoupangOrderStatusSchema>;
export type Orderer = z.infer<typeof OrdererSchema>;
export type Receiver = z.infer<typeof ReceiverSchema>;

// =================================================================
// == 상수 (Constants)
// =================================================================

/**
 * 쿠팡 상태를 내부 표준 상태로 매핑하는 상수
 */
export const COUPANG_STATUS_MAPPING = {
  ACCEPT: 'PAID',
  INSTRUCT: 'PREPARING',
  DEPARTURE: 'READY_TO_SHIP',
  DELIVERING: 'SHIPPED',
  FINAL_DELIVERY: 'DELIVERED',
  NONE_TRACKING: 'SHIPPED',
  SUCCESS: 'SUCCESS',
  PARTIAL_ERROR: 'PARTIAL_ERROR',
  FAILED: 'FAILED',
  NONE: 'NONE',
} as const;

// =================================================================
// == 유틸리티 함수 (Utility Functions)
// =================================================================

/**
 * 쿠팡 상태를 내부 표준 상태로 매핑하는 함수
 */
export function mapCoupangStatusToInternal(coupangStatus: string): string {
  return COUPANG_STATUS_MAPPING[coupangStatus as keyof typeof COUPANG_STATUS_MAPPING] || coupangStatus;
}

/**
 * 날짜 범위 검증 함수 (최대 31일)
 */
export function validateCoupangDateRange(createdAtFrom: string, createdAtTo: string): boolean {
  // ISO 형식 (YYYY-MM-DDTHH:mm) 또는 단순 날짜 (YYYY-MM-DD) 모두 처리
  const fromDate = new Date(createdAtFrom.split('T')[0]);
  const toDate = new Date(createdAtTo.split('T')[0]);

  const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays <= 31;
}
