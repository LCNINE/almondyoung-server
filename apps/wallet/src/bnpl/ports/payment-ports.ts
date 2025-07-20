/**
 * PG (Payment Gateway) Port Interface
 *
 * Hexagonal Architecture의 Port 역할을 하는 추상 클래스
 * 모든 PG 연동은 이 인터페이스를 구현해야 함
 */

export interface PaymentRequest {
  amount: number;
  orderId: string;
  billingKey?: string;
  memberId?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface PaymentResponse {
  transactionId: string;
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';
  message?: string;
  rawResponse: any;
  capturedAt?: Date;
}

export interface RefundRequest {
  transactionId: string;
  amount: number;
  reason: string;
  metadata?: Record<string, any>;
}

export interface RefundResponse {
  refundId: string;
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';
  message?: string;
  rawResponse: any;
}

export interface MemberRegistrationRequest {
  userId: string;
  memberName: string;
  paymentCompany: string;
  paymentNumber: string;
  phone?: string;
  email?: string;
  metadata?: Record<string, any>;
}

export interface MemberRegistrationResponse {
  memberId: string;
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';
  message?: string;
  rawResponse: any;
}

export interface PaymentStatusResponse {
  transactionId: string;
  status: 'REQUESTED' | 'CAPTURED' | 'CANCELLED' | 'FAILED';
  amount: number;
  capturedAt?: Date;
  rawResponse: any;
}

/**
 * PG Port 추상 클래스
 * 모든 PG 어댑터는 이 클래스를 구현해야 함
 */
export abstract class PgPort {
  /**
   * 결제 요청
   */
  abstract charge(request: PaymentRequest): Promise<PaymentResponse>;

  /**
   * 환불 요청
   */
  abstract refund(request: RefundRequest): Promise<RefundResponse>;

  /**
   * 회원 등록 (BatchCMS용)
   */
  abstract registerMember?(
    request: MemberRegistrationRequest,
  ): Promise<MemberRegistrationResponse>;

  /**
   * 결제 상태 조회
   */
  abstract getPaymentStatus(
    transactionId: string,
  ): Promise<PaymentStatusResponse>;

  /**
   * 회원 상태 조회 (BatchCMS용)
   */
  abstract getMemberStatus?(memberId: string): Promise<{
    status: 'PENDING' | 'REGISTERED' | 'FAILED';
    registeredAt?: Date;
  }>;

  /**
   * PG 연결 상태 확인
   */
  abstract healthCheck(): Promise<{ status: 'ok' | 'error'; message: string }>;
}

// PaymentProcessingPort: 결제/환불 등 금전 이동 책임만
export interface PaymentProcessingPort {
  charge(request: PaymentRequest): Promise<PaymentResponse>;
  refund(request: RefundRequest): Promise<RefundResponse>;
  getPaymentStatus(transactionId: string): Promise<PaymentStatusResponse>;
  healthCheck(): Promise<{ status: 'ok' | 'error'; message: string }>;
}

// MethodManagementPort: 결제수단/회원 관리 책임만
export interface MethodManagementPort {
  registerMember(
    request: MemberRegistrationRequest,
  ): Promise<MemberRegistrationResponse>;
  getMemberStatus(memberId: string): Promise<{
    status: 'PENDING' | 'REGISTERED' | 'FAILED';
    registeredAt?: Date;
  }>;
}

export const PAYMENT_PROCESSING_PORT = 'PaymentProcessingPort';
export const METHOD_MANAGEMENT_PORT = 'MethodManagementPort';
