/**
 * 결제 Strategy 인터페이스 정의
 *
 * 설계 원칙:
 * - Strategy는 오직 외부 시스템(PG) 통신만 담당
 * - DB 트랜잭션, 멱등성, 공통 후처리는 PaymentService(Facade)에서 처리
 * - Interface Segregation Principle 적용
 */

// ═══════════════════════════════════════════════════════════════
// 공통 응답 인터페이스
// ═══════════════════════════════════════════════════════════════

export interface PaymentResult {
  success: boolean;
  transactionId: string;
  authorizationId?: string; // BNPL의 경우 승인 ID
  captureId?: string; // 카드의 경우 즉시 확정 ID
  amount: number;
  currency: string;
  status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
  error?: string;
  metadata?: Record<string, any>;
}

export interface RegistrationResult {
  success: boolean;
  paymentMethodId?: string;
  hmsMemberId?: string;
  externalMemberId?: string;
  status?: 'PENDING' | 'ACTIVE' | 'FAILED'; // optional로 변경
  error?: string;
  metadata?: Record<string, any>;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  refundedAmount: number;
  status?: 'COMPLETED' | 'FAILED' | 'PENDING'; // optional로 변경
  error?: string;
  metadata?: Record<string, any>;
}

export interface CaptureResult {
  success: boolean;
  captureId?: string;
  capturedAmount?: number;
  captureIds?: string[]; // 배치 처리용
  failedIds?: string[]; // 실패한 ID들
  status?: 'COMPLETED' | 'FAILED';
  error?: string;
  metadata?: Record<string, any>;
}

export interface StatusResult {
  success: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'FAILED' | 'INVALID'; // INVALID 추가
  hmsStatus?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface ConsentResult {
  success: boolean;
  agreementId?: string;
  error?: string;
  metadata?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════
// Strategy 역할 인터페이스 (Interface Segregation Principle)
// ═══════════════════════════════════════════════════════════════

/**
 * 결제 처리 역할
 * - 모든 결제수단이 구현해야 하는 기본 인터페이스
 * - 순수하게 PG 통신만 담당 (DB 작업은 PaymentService에서 처리)
 */
export interface PaymentProcessingStrategy {
  /**
   * 결제 처리 (PG 통신만)
   * @param amount 결제 금액
   * @param currency 통화
   * @param metadata 결제 메타데이터
   * @returns PG 응답 결과만 반환 (DB 작업 없음)
   */
  processPayment(
    amount: number,
    currency: string,
    metadata: Record<string, any>,
  ): Promise<PaymentResult>;

  /**
   * 환불 처리 (PG 통신만)
   * @param transactionId 원본 거래 ID
   * @param amount 환불 금액
   * @param reason 환불 사유
   * @returns PG 응답 결과만 반환 (DB 작업 없음)
   */
  refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
  ): Promise<RefundResult>;
}

/**
 * 결제수단 등록 역할
 * - BNPL, 카드 등 외부 시스템 회원 등록이 필요한 경우
 */
export interface RegistrableStrategy {
  /**
   * 결제수단 등록 (외부 시스템 등록만)
   * @param request 등록 요청 데이터
   * @returns 외부 시스템 등록 결과만 반환 (DB 작업 없음)
   */
  registerMethod(request: any): Promise<RegistrationResult>;
}

/**
 * 배치 처리 역할 (BNPL 전용)
 * - 승인된 거래들의 일괄 확정 처리
 */
export interface BatchProcessingStrategy {
  /**
   * 배치 확정 처리 (PG 통신만)
   * @param authorizationIds 승인 ID 목록
   * @param batchId 배치 ID
   * @returns PG 응답 결과만 반환 (DB 작업 없음)
   */
  batchCapture(
    authorizationIds: string[],
    batchId?: string,
  ): Promise<CaptureResult>;
}

/**
 * 상태 조회 역할
 * - 외부 시스템의 회원 상태 조회
 */
export interface StatusQueryStrategy {
  /**
   * 회원 상태 조회 (외부 시스템 조회만)
   * @param memberId 회원 ID
   * @returns 외부 시스템 상태 조회 결과만 반환
   */
  getMemberStatus(memberId: string): Promise<StatusResult>;
}

/**
 * 계정 관리 역할 (BNPL 전용)
 * - 외부 시스템의 계정 활성화/비활성화
 */
export interface AccountManagementStrategy {
  /**
   * 계정 활성화 (외부 시스템 통신만)
   */
  activateAccount(
    paymentMethodId: string,
    approvedLimit: number,
  ): Promise<void>;

  /**
   * 계정 비활성화 (외부 시스템 통신만)
   */
  deactivateAccount(paymentMethodId: string, reason: string): Promise<void>;
}

/**
 * 동의서 제출 역할 (BNPL 전용)
 * - 외부 시스템에 동의서 파일 제출
 */
export interface ConsentSubmissionStrategy {
  /**
   * 출금동의서 제출 (외부 시스템 통신만)
   * @param memberId 회원 ID
   * @param file 동의서 파일
   * @param filename 파일명
   * @returns 외부 시스템 제출 결과만 반환
   */
  submitConsent(
    memberId: string,
    file: Buffer,
    filename: string,
  ): Promise<ConsentResult>;
}

// ═══════════════════════════════════════════════════════════════
// Strategy 타입 정의 (타입 안정성 향상)
// ═══════════════════════════════════════════════════════════════

/**
 * 모든 Strategy의 기본 타입
 * - 최소한 PaymentProcessingStrategy는 모든 Strategy가 구현
 */
export type BasePaymentStrategy = PaymentProcessingStrategy;

/**
 * BNPL Strategy 타입 (모든 인터페이스 구현)
 */
export type BnplStrategyType = PaymentProcessingStrategy &
  RegistrableStrategy &
  BatchProcessingStrategy &
  StatusQueryStrategy &
  AccountManagementStrategy &
  ConsentSubmissionStrategy;

/**
 * 카드 Strategy 타입
 */
export type CardStrategyType = PaymentProcessingStrategy &
  RegistrableStrategy &
  StatusQueryStrategy;

/**
 * 포인트 Strategy 타입
 */
export type PointStrategyType = PaymentProcessingStrategy;

/**
 * 모든 Strategy의 Union 타입
 */
export type PaymentStrategy =
  | BnplStrategyType
  | CardStrategyType
  | PointStrategyType;
