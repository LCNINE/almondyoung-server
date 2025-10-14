/**
 * 결제 비즈니스 로직 모듈 - Port-Adapter 패턴
 *
 * 구조:
 * - Port (인터페이스): 비즈니스 로직 정의
 * - Adapter (구현체): 실제 구현
 *
 * 사용법:
 * - 서비스 의존성: Port 타입을 사용 (예: PaymentExecutorService)
 * - DI 바인딩: Adapter 구현체를 사용 (예: PaymentExecutorServiceImpl)
 * - 주입: 토큰 기반 주입 (예: @Inject(PAYMENT_EXECUTOR_SERVICE))
 */

// Ports (인터페이스) - 타입만 export
export type { PaymentExecutorService } from './payment-executor.service.interface';
export type { PaymentOrchestratorService } from './payment-orchestrator.service.interface';

// Adapters (구현체) - 클래스 export
export { PaymentExecutorServiceImpl } from './payment-executor.service';
export { PaymentOrchestratorServiceImpl } from './payment-orchestrator.service';

// DI 토큰
export * from './tokens';
