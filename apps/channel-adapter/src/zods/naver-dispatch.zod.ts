import { z } from 'zod';
import { createNaverApiResponseSchemaOptional } from './naver-api.zod';

/**
 * 네이버 커머스 API 발송처리 Zod 스키마
 *
 * API 문서: POST /v1/pay-order/seller/product-orders/dispatch
 *
 * @author Channel Adapter Team
 * @version 1.0.0
 */

/**
 * 배송 방법 코드 enum
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

/**
 * 택배사 코드 enum (주요 택배사만 포함, 전체 목록은 너무 길어서 일부만)
 */
export const DeliveryCompanyCodeSchema = z.enum([
  // 주요 택배사
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

  // 기타 택배사들 (필요시 추가)
  'MTINTER', // 엠티인터내셔널
  'AIRWAY', // AIRWAY익스프레스
  'KOREXG', // CJ대한통운(국제택배)
  'EZUSA', // EZUSA
  'TNT', // TNT
  'USPS', // USPS
  'KDEXP', // 경동택배
  'GOODTOLUCK', // 굿투럭
  'DAELIM', // 대림통운
  'DONGGANG', // 동강물류
  'LOTTECHILSUNG', // 롯데칠성
  'PANTOS', // LX판토스
  'VROONG', // 부릉
  'HONAM', // 우리택배
  'CHUNIL', // 천일택배
  'TEAMFRESH', // 팀프레시
  'FRESH', // 컬리넥스트마일
  'HOMEPLUSDELIVERY', // 홈플러스
  'CH1', // 기타 택배
]);

/**
 * 단일 상품 주문 발송처리 스키마
 */
export const DispatchProductOrderSchema = z.object({
  /**
   * 상품 주문 번호
   * @example "2022040521691281"
   */
  productOrderId: z
    .string()
    .min(1, '상품 주문 번호는 필수입니다')
    .max(50, '상품 주문 번호는 50자를 초과할 수 없습니다')
    .regex(/^\d+$/, '상품 주문 번호는 숫자만 가능합니다'),

  /**
   * 배송 방법 코드 (250바이트 내외)
   * @example "DELIVERY"
   */
  deliveryMethod: DeliveryMethodSchema,

  /**
   * 택배사 코드 (250바이트 내외)
   * @example "CJGLS"
   */
  deliveryCompanyCode: DeliveryCompanyCodeSchema,

  /**
   * 송장 번호
   * @example "1234567890123"
   */
  trackingNumber: z
    .string()
    .min(1, '송장 번호는 필수입니다')
    .max(50, '송장 번호는 50자를 초과할 수 없습니다')
    .regex(/^[a-zA-Z0-9\-]+$/, '송장 번호는 영문, 숫자, 하이픈만 가능합니다'),

  /**
   * 배송일
   * @example "2022-04-05T12:17:35.000+09:00"
   */
  dispatchDate: z
    .string()
    .datetime({ message: '올바른 ISO 8601 날짜 형식이어야 합니다' })
    .refine(
      (date) => {
        const dispatchDate = new Date(date);
        const now = new Date();
        const thirtyDaysAgo = new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000,
        );

        return dispatchDate >= thirtyDaysAgo && dispatchDate <= now;
      },
      {
        message: '배송일은 30일 전부터 현재까지만 가능합니다',
      },
    ),
});

/**
 * 네이버 발송처리 API 요청 스키마
 */
export const NaverDispatchRequestSchema = z.object({
  /**
   * 발송처리할 상품 주문 목록 (최대 30개)
   */
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

// 네이버 발송처리 응답 데이터 스키마 (타입 체크용)
const NaverDispatchDataSchema = z.object({
  results: z
    .array(
      z.object({
        productOrderId: z.string(),
        success: z.boolean(),
        message: z.string().optional(),
        errorCode: z.string().optional(),
      }),
    )
    .optional(), // 처리 결과 목록 (성공/실패 내역)
});

// 네이버 발송처리 API 응답 스키마 (타입 체크용, data가 optional)
export const NaverDispatchResponseSchema = createNaverApiResponseSchemaOptional(
  NaverDispatchDataSchema,
);

/**
 * 내부 명령에서 네이버 API 요청으로 변환하는 스키마
 */
export const InternalDispatchCommandSchema = z.object({
  type: z.literal('dispatch.confirm'),
  orderId: z.string(),
  productOrderIds: z.array(z.string()).optional(),
  productOrderId: z.string().optional(), // 단일 상품 주문의 경우
  tracking: z.object({
    companyCode: z.string(),
    number: z.string(),
  }),
  dispatchedAt: z.string().datetime().optional(),
});

// 타입 추출
export type DeliveryMethod = z.infer<typeof DeliveryMethodSchema>;
export type DeliveryCompanyCode = z.infer<typeof DeliveryCompanyCodeSchema>;
export type DispatchProductOrder = z.infer<typeof DispatchProductOrderSchema>;
export type NaverDispatchRequest = z.infer<typeof NaverDispatchRequestSchema>;
export type NaverDispatchResponse = z.infer<typeof NaverDispatchResponseSchema>;
export type InternalDispatchCommand = z.infer<
  typeof InternalDispatchCommandSchema
>;

/**
 * 택배사 코드를 네이버 API 형식으로 매핑
 */
export const DELIVERY_COMPANY_MAPPING: Record<string, DeliveryCompanyCode> = {
  CJ: 'CJGLS',
  LOTTE: 'HYUNDAI',
  HANJIN: 'HANJIN',
  LOGEN: 'KGB',
  EPOST: 'EPOST',
  CU: 'CUPARCEL',
  DHL: 'DHL',
  FEDEX: 'FEDEX',
  UPS: 'UPS',
  EMS: 'EMS',
  DEFAULT: 'CJGLS', // 기본값
};

/**
 * 내부 명령을 네이버 API 요청으로 변환하는 헬퍼 함수
 */
export function transformInternalCommandToNaverRequest(
  command: InternalDispatchCommand,
): NaverDispatchRequest {
  // productOrderIds 결정 (배열 또는 단일 값)
  const productOrderIds =
    command.productOrderIds ||
    (command.productOrderId ? [command.productOrderId] : []);

  if (productOrderIds.length === 0) {
    throw new Error('productOrderIds 또는 productOrderId가 필요합니다');
  }

  // 택배사 코드 매핑
  const deliveryCompanyCode =
    DELIVERY_COMPANY_MAPPING[command.tracking.companyCode] ||
    DELIVERY_COMPANY_MAPPING.DEFAULT;

  // 배송일 설정 (기본값: 현재 시간)
  const dispatchDate = command.dispatchedAt || new Date().toISOString();

  return {
    dispatchProductOrders: productOrderIds.map((productOrderId) => ({
      productOrderId,
      deliveryMethod: 'DELIVERY' as const,
      deliveryCompanyCode,
      trackingNumber: command.tracking.number,
      dispatchDate,
    })),
  };
}
