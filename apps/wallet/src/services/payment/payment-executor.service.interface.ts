import type { PaymentIntent } from '../../shared/database/types';
import type {
  PaymentRequest,
  PaymentResult,
  ProviderType,
} from '../../providers/payment-provider.interface';

/**
 * PaymentExecutorService Port (인터페이스)
 *
 * 책임: 결제 승인/캡처/조회 실행
 * - 정책 검증 및 Provider 호출
 * - 순수 비즈니스 로직만 정의
 */
export interface PaymentExecutorService {
  /**
   * 결제 승인(Authorization)을 검증하고 실행합니다.
   */
  authorize(
    request: PaymentRequest,
    provider: ProviderType,
    intent: PaymentIntent,
    options?: { tx?: any },
  ): Promise<PaymentResult>;

  /**
   * 결제 캡처(Capture)를 실행합니다.
   */
  capture(
    attemptId: string,
    provider: ProviderType,
    amount: number,
    options?: { tx?: any },
  ): Promise<PaymentResult>;

  /**
   * 결제 상태를 조회합니다.
   */
  inquire(
    intentId: string,
    provider: ProviderType,
  ): Promise<{ status: string; transactionId: string }>;
}
