/**
 * DI 토큰 정의
 * Port-Adapter 패턴을 위한 의존성 주입 토큰
 */

export const PAYMENT_SERVICE = Symbol('PaymentService');
export const PAYMENT_ORCHESTRATOR_SERVICE = Symbol(
  'PaymentOrchestratorService',
);
export const PAYMENT_EXECUTOR_SERVICE = Symbol('PaymentExecutorService');
