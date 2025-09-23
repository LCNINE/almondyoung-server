import { PaymentError } from '../../providers/payment-provider.interface';
import { PaymentIntent } from '../../shared/database/types';

/**
 * 주어진 조건이 거짓일 경우 에러를 던지는 헬퍼 함수
 * @param condition 검증할 조건
 * @param code 에러 코드
 * @param message 에러 메시지
 */
function invariant(
  condition: any,
  code: string,
  message: string,
): asserts condition {
  if (!condition) {
    throw new PaymentError(code, message);
  }
}

/**
 * Intent가 PENDING 상태인지 단언합니다.
 * @param intent 검증할 PaymentIntent 객체
 */
export function assertIntentIsPending(intent: PaymentIntent): void {
  invariant(
    intent.status === 'PENDING',
    'INTENT_ALREADY_PROCESSED',
    `Intent is already processed. Current status: ${intent.status}`,
  );
}

/**
 * Intent가 만료되지 않았는지 단언합니다.
 * @param intent 검증할 PaymentIntent 객체
 */
export function assertIntentIsNotExpired(intent: PaymentIntent): void {
  invariant(
    intent.expiresAt.getTime() > Date.now(),
    'INTENT_EXPIRED',
    `Intent has expired at ${intent.expiresAt.toISOString()}`,
  );
}

// ... (사용자 상태 검증, 프로필 유효성 검증 등 다양한 Assert 함수 추가 가능)
