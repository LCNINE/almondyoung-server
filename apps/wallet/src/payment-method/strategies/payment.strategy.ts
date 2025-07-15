export const PAYMENT_STRATEGY_REGISTRY = 'PAYMENT_STRATEGY_REGISTRY';

export interface PaymentMethodStrategy {
  /**
   * 이 전략이 지원하는 결제수단 유형 리스트
   */
  supportedTypes(): string[];
  /**
   * 이 전략이 지원하는 결제수단 유형인지 여부
   * @param methodType 결제수단 유형 (ex: "CARD", "BANK_ACCOUNT")
   */
  supports(methodType: string): boolean;
  /**
   * 결제수단 등록 처리
   * @param payload methodType에 맞는 상세 등록 정보 포함
   * @param tx 트랜잭션 객체
   */
  register(
    payload: unknown,
    tx: any,
  ): Promise<{ id: string; hmsResponse: any }>;
  /**
   * 결제수단 삭제 처리
   * @param paymentMethodId 결제수단 ID
   */
  delete(paymentMethodId: string): Promise<void>;
  /**
   * 유효성 검사: 필요 시 zod 스키마 기반 처리
   * @param payload 원시 요청값
   */
  validate(payload: unknown): void;
}
