// providers/payment-provider.interface.ts

import {
  PaymentResult,
  RefundResult,
  CaptureResult,
} from '../interfaces/payment-gateway.interface';

/**
 * 결제 Provider 전략 인터페이스
 * - 모든 Provider (HMS, TOSS, KAKAOPAY, POINTS, BNPL)가 구현
 * - 정책 기반 라우팅과 연동
 */
export interface PaymentProvider {
  /**
   * Provider 식별자
   */
  readonly providerId: string;

  /**
   * 지원하는 결제 타입들
   */

  /**
   * 결제 처리
   */
  processPayment(request: PaymentRequest): Promise<PaymentResult>;

  /**
   * 환불 처리
   */
  refundPayment(request: RefundRequest): Promise<RefundResult>;

  /**
   * 결제 확정 (BNPL 전용)
   */
  capturePayment?(request: CaptureRequest): Promise<CaptureResult>;

  /**
   * 프로필 등록 (저장형 결제수단용)
   */
  registerProfile?(
    request: ProfileRegistrationRequest,
  ): Promise<ProfileRegistrationResult>;
}

// === 요청/응답 타입 ===

export interface PaymentRequest {
  intentId: string;
  attemptId: string;
  amount: number;
  type: PaymentType;
  userId: string;

  // 결제 수단 종류 명시
  instrumentType: 'PROFILE' | 'ONE_TIME';
  profileId?: string; // PROFILE일 때 사용
  instrumentRef?: string; // ONE_TIME일 때 승인키/토큰

  // 메타데이터
  metadata?: Record<string, any>;
}

export interface RefundRequest {
  intentId: string;
  originalAttemptId: string;
  refundId: string;
  amount: number;
  reason?: string;
  userId: string; // 환불 대상 사용자 ID

  // 원본 결제 정보
  originalTransactionId: string;
  originalProvider: string;

  metadata?: Record<string, any>;
}

export interface CaptureRequest {
  attemptIds: string[];
  transactionIds?: string[]; // 스케줄러에서 미리 채워줄 수 있음
  intentId?: string; // 선택적 (로깅/디버깅 용)
  metadata?: Record<string, any>;
}

export interface ProfileRegistrationRequest {
  userId: string;
  profileType: 'CARD' | 'BANK_ACCOUNT' | 'BNPL' | 'WALLET';
  profileName: string;
  paymentPurpose: 'SUBSCRIPTION' | 'PURCHASE' | 'BOTH';
  isDefault: boolean;
  phone: string;

  // HMS 카드 회원등록 API 필수값
  paymentNumber?: string; // 카드번호
  payerName?: string; // 카드 소유자명
  payerNumber?: string; // 생년월일
  validUntil?: string; // 카드 유효기간 MMYY
  password?: string; // 비밀번호 앞 2자리
  paymentCompany?: string; // 카드사 코드

  // HMS 배치 CMS 등록 API 필수값
  accountNumber?: string; // 계좌번호
  billingDay?: number; // 결제일
  consentId?: string; // 동의서 ID
  agreementKey?: string; // 동의서 키
  agreementKind?: string; // 동의서 종류
  consentStatus?: string; // 동의 상태
  consentSubmittedAt?: string; // 동의서 제출 시간
  consentReviewedAt?: string; // 동의서 검토 시간

  // BNPL 필드
  creditLimit?: number;

  // 부가 정보
  metadata?: Record<string, any>;
}

export interface ProfileRegistrationResult {
  success: boolean;
  profileId: string;
  hmsMemberId?: string;
  error?: string;
  metadata?: Record<string, any>;
}

// === 공통 타입 ===

export type PaymentType =
  | 'ORDER' // 일반 주문 결제
  | 'MEMBERSHIP_FEE' // 정기 결제
  | 'BNPL_CAPTURE'; // BNPL 확정

export type PaymentProvider_ID =
  | 'HMS_CARD' // 효성 카드
  | 'HMS_BNPL' // 효성 BNPL
  | 'TOSS' // 토스페이먼츠
  | 'KAKAOPAY' // 카카오페이
  | 'POINTS'; // 내부 포인트
