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
  readonly supportedTypes: PaymentType[];

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

  // Profile 기반 결제
  profileId?: string;

  // Ephemeral 결제 (일회성)
  instrumentRef?: string;
  instrumentKind?: 'STORED' | 'EPHEMERAL';

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
  profileType: 'CARD' | 'BANK_ACCOUNT' | 'BNPL';
  profileName: string;

  // HMS 신용카드 API 필드 (callableSchema.ts 기준)
  paymentNumber?: string; // 카드번호 - 16자 이내 숫자만
  payerName?: string; // 카드 소유자명 - 10자 이내
  payerNumber?: string; // 생년월일 - 6-10자리 숫자만
  validUntil?: string; // 카드 유효기간 MMYY - 4자리 숫자
  password?: string; // 비밀번호 앞 2자리 - 2자리 숫자

  // HMS API 내부 변환용 (validUntil → validYear/validMonth)
  validYear?: string; // 유효기간 년도 YY (내부 변환)
  validMonth?: string; // 유효기간 월 MM (내부 변환)

  // HMS 배치 CMS API 필드
  paymentCompany?: string; // 은행 코드
  accountNumber?: string; // 계좌번호

  // BNPL 필드
  creditLimit?: number;
  billingCycleDay?: number;

  // 공통 연락처 정보 (HMS API 필수/선택 필드)
  phone?: string;
  email?: string;
  zipcode?: string;
  address1?: string;
  address2?: string;

  // 레거시 필드 (호환성 유지)
  cardToken?: string;
  billingKey?: string;
  bankCode?: string;
  accountHolder?: string;

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
  | 'BNPL_CAPTURE' // BNPL 확정
  | 'REFUND'; // 환불

export type PaymentProvider_ID =
  | 'HMS_CARD' // 효성 카드
  | 'HMS_BNPL' // 효성 BNPL
  | 'TOSS' // 토스페이먼츠
  | 'KAKAOPAY' // 카카오페이
  | 'POINTS'; // 내부 포인트
