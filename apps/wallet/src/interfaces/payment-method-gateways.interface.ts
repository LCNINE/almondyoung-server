// interfaces/payment-method-gateways.interface.ts

/**
 * 결제수단별 확장 인터페이스들
 * - 기본 PaymentGateway와 별개의 특수 기능 제공
 * - 각 결제수단의 라이프사이클 관리 담당
 */

import {
  PaymentMethodRegistrationRequest,
  PaymentMethodRegistrationResult,
} from './payment-gateway.interface';

/**
 * BNPL 전용 확장 인터페이스
 * - 출금동의서, 회원상태 등 BNPL만의 특수 기능
 */
export interface BnplMethodGateway {
  /**
   * BNPL 회원 등록
   */
  registerMember(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult>;

  /**
   * 출금동의서 제출
   */
  submitConsent(request: {
    memberId: string;
    file: Buffer;
    filename: string;
  }): Promise<{
    success: boolean;
    agreementId?: string;
    error?: string;
    rawResponse: any;
  }>;

  /**
   * 회원 상태 조회
   */
  getMemberStatus(memberId: string): Promise<{
    hmsStatus: string;
    registeredAt: Date | null;
    creditLimit: number;
    approvedLimit: number;
    rawResponse: any;
  }>;

  /**
   * BNPL 배치 확정 처리
   */
  batchCapture(
    authorizationIds: string[],
    batchId?: string,
  ): Promise<{
    success: boolean;
    captureIds: string[];
    failedIds: string[];
    error?: string;
    metadata?: Record<string, any>;
  }>;
}

/**
 * 카드 전용 확장 인터페이스
 * - HMS Member ID 기반 정기결제 관리
 */
export interface CardMethodGateway {
  /**
   * 정기결제 회원 등록 (HMS Member ID 발급)
   */
  registerRecurringMember(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult>;

  /**
   * HMS Member ID 유효성 검증
   */
  validateHmsMember(hmsMemberId: string): Promise<{
    isValid: boolean;
    cardInfo?: {
      maskedNumber: string;
      cardCompany: string;
      cardType: string;
    };
    error?: string;
  }>;
}

/**
 * 포인트 전용 확장 인터페이스
 * - 적립포인트 관리 (구매적립, 이벤트지급, 잔액조회)
 * - 소비자 직접 충전 불가능
 */
export interface PointMethodGateway {
  /**
   * 포인트 적립/지급 (시스템/관리자 전용)
   * - 구매 적립, 이벤트 보너스, 환불 복원, 관리자 지급
   */
  awardPoints(
    userId: string,
    amount: number,
    sourceType: 'PURCHASE_REWARD' | 'EVENT_BONUS' | 'REFUND' | 'ADMIN_GRANT',
    metadata?: Record<string, any>,
  ): Promise<{
    success: boolean;
    transactionId?: string;
    newBalance?: number;
    error?: string;
  }>;

  /**
   * 포인트 잔액 조회
   */
  getPointBalance(userId: string): Promise<{
    balance: number;
    freezeAmount: number;
    availableAmount: number;
  }>;
}
