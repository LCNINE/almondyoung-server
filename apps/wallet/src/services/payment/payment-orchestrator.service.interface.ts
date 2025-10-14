import type {
  PaymentResult,
  ProviderType,
} from '../../providers/payment-provider.interface';

/**
 * PaymentOrchestratorService Port (인터페이스)
 *
 * 책임: 결제 플로우 전체 조율
 * - Intent 조회 및 검증
 * - 포인트 + 외부 결제 조합
 * - 트랜잭션 관리
 * - 상태 업데이트
 */
export interface PaymentOrchestratorService {
  /**
   * 결제 승인(Authorization) - Intent 조회부터 승인 상태 업데이트까지 담당
   */
  authorizePayment(
    intentId: string,
    providerType: ProviderType | null,
    options?: {
      usePoints?: number;
      profileId?: string;
      instrumentRef?: string;
      sessionId?: string;
      actor?: string;
      source?: string;
    },
  ): Promise<PaymentResult>;

  /**
   * 결제 캡처(Capture) - 이미 승인된 결제를 실제로 정산 처리
   */
  capturePayment(
    intentId: string,
    attemptId: string,
    amount?: number,
    options?: {
      sessionId?: string;
      actor?: string;
      source?: string;
    },
  ): Promise<PaymentResult>;
}
