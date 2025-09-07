import { RecurringPaymentRequestDto } from '../../../shared/dtos/recurring-payment.dto';

/**
 * 필수 키 검증 유틸리티
 */
export function assertHasKeys(
  obj: any,
  requiredKeys: string[],
  objectName: string,
): void {
  const missingKeys = requiredKeys.filter((key) => !(key in obj));
  if (missingKeys.length > 0) {
    throw new Error(
      `${objectName} missing required keys: ${missingKeys.join(', ')}`,
    );
  }
}

/**
 * 순수 결제 요청 DTO 팩토리 (v2)
 * - 구독 도메인 정보는 metadata로 불투명하게 전달
 * - 모든 필수 필드 포함
 * - 런타임 키 검증
 * - 스냅샷 테스트용 키 셋 고정
 */
export function buildRecurringPaymentRequest(
  overrides: Partial<RecurringPaymentRequestDto> = {},
): RecurringPaymentRequestDto {
  const request: RecurringPaymentRequestDto = {
    userId: overrides.userId || 'hms-test-user-1757221534583',
    paymentMethodId: overrides.paymentMethodId || '01K4H91FY4R8PYYXHBDV21DERQ',
    amount: overrides.amount || 9900,
    currency: overrides.currency || 'KRW',
    pricing: overrides.pricing,
    // ✅ 구독 정보는 불투명 메타데이터로 전달
    metadata: overrides.metadata || {
      subscriptionType: 'monthly',
      billingCycle: 30,
      correlationId: `test-${Date.now()}`,
      source: 'test-factory',
    },
  };

  // 필수 키 검증 (DTO 데코레이터 기반) - v2에서는 subscriptionType 제거
  const requiredKeys = ['userId', 'paymentMethodId', 'amount'];
  assertHasKeys(request, requiredKeys, 'RecurringPaymentRequestDto');

  // amount 범위 검증 (DTO 데코레이터 기반)
  if (request.amount < 100 || request.amount > 10000000) {
    throw new Error(
      `Invalid amount: ${request.amount}. Must be between 100 and 10000000`,
    );
  }

  return request;
}

/**
 * 불투명 메타데이터 생성 헬퍼 (MSA 단순화)
 * - Wallet 서버는 해석하지 않고 그대로 저장만
 */
export function buildOpaqueMetadata(
  overrides: {
    correlationId?: string;
    source?: string;
    [key: string]: any;
  } = {},
) {
  return {
    correlationId: overrides.correlationId || `wallet-${Date.now()}`,
    source: overrides.source || 'wallet-test',
    ...overrides, // 상위 시스템에서 보낸 추가 정보 (해석하지 않음)
  };
}

/**
 * 순수 결제 요청 팩토리 - 금액별 (MSA 단순화)
 */
export function buildPaymentRequest(
  userId: string,
  paymentMethodId: string,
  amount: number,
  metadata?: Record<string, any>,
): RecurringPaymentRequestDto {
  return buildRecurringPaymentRequest({
    userId,
    paymentMethodId,
    amount,
    metadata: metadata || {
      correlationId: `payment-${Date.now()}`,
      source: 'wallet-test',
    },
  });
}

/**
 * 할인 적용 결제 요청 팩토리 (MSA 단순화)
 */
export function buildDiscountedPaymentRequest(
  userId: string,
  paymentMethodId: string,
  finalAmount: number,
  originalAmount: number,
  discountAmount: number,
): RecurringPaymentRequestDto {
  return buildRecurringPaymentRequest({
    userId,
    paymentMethodId,
    amount: finalAmount, // 최종 결제 금액 (이미 계산된 값)
    pricing: {
      originalAmount,
      discountAmount,
      couponId: 'DISCOUNT10',
      discountRate: Math.round((discountAmount / originalAmount) * 100),
    },
    metadata: {
      correlationId: `discounted-payment-${Date.now()}`,
      source: 'billing-server', // 할인 계산은 빌링 서버에서
    },
  });
}

/**
 * 스냅샷 테스트용 키 셋 추출 (v2)
 */
export function getRecurringPaymentRequestKeys(
  request: RecurringPaymentRequestDto,
): string[] {
  return Object.keys(request).sort();
}

/**
 * v2 DTO 예상 키 셋 (스냅샷 테스트용)
 */
export const EXPECTED_PAYMENT_REQUEST_KEYS_V2 = [
  'userId',
  'paymentMethodId',
  'amount',
  'currency',
  'pricing',
  'metadata',
].sort();

/**
 * 유효하지 않은 요청 팩토리 (에러 테스트용)
 */
export function buildInvalidRecurringPaymentRequest(
  invalidField: 'userId' | 'paymentMethodId' | 'amount' | 'subscriptionType',
): Partial<RecurringPaymentRequestDto> {
  const baseRequest = buildRecurringPaymentRequest();

  switch (invalidField) {
    case 'userId':
      return { ...baseRequest, userId: '' }; // 빈 문자열
    case 'paymentMethodId':
      return { ...baseRequest, paymentMethodId: '' }; // 빈 문자열
    case 'amount':
      return { ...baseRequest, amount: 50 }; // 최소값 미만
    case 'subscriptionType':
      return {
        ...baseRequest,
        metadata: {
          ...baseRequest.metadata,
          subscriptionType: 'weekly' as any, // 지원하지 않는 enum
        },
      };
    default:
      throw new Error(`Unknown invalid field: ${invalidField}`);
  }
}

/**
 * 테스트 데이터 상수
 */
export const TEST_PAYMENT_METHOD = {
  id: '01K4H91FY4R8PYYXHBDV21DERQ',
  userId: 'hms-test-user-1757221534583',
  methodType: 'CARD' as const,
  methodName: 'HMS연동테스트카드',
  status: 'PENDING' as const,
  hmsMemberId: '0MW8AEQ47XA8B',
} as const;

export const TEST_USER_ID = TEST_PAYMENT_METHOD.userId;
export const TEST_PAYMENT_METHOD_ID = TEST_PAYMENT_METHOD.id;
