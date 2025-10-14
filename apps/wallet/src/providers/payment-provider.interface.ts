// Domain SSOT: Provider/Payment Types, Ports, Payload Map
// 변경 전 모든 중복 타입들을 여기로 수렴시키세요.

export enum PaymentType {
  ORDER = 'ORDER',
  BNPL_CAPTURE = 'BNPL_CAPTURE',
  MEMBERSHIP_FEE = 'MEMBERSHIP_FEE',
}

export enum ProviderType {
  HMS_CARD = 'HMS_CARD',
  HMS_BNPL = 'HMS_BNPL',
  TOSS = 'TOSS',
  POINTS = 'POINTS',
}

// 공급자 중립 Request (PG 전용 필드는 절대 넣지 않음)
export interface PaymentRequest {
  intentId: string;
  attemptId: string;
  amount: number;
  paymentType: PaymentType;
  userId: string;
  instrumentType: 'PROFILE' | 'ONE_TIME';
  profileId?: string; // PROFILE일 때만
  instrumentRef?: string; // ONE_TIME일 때(예: 토스 원타임 토큰)
  metadata?: Record<string, any>;
}

export interface PaymentResult {
  success: boolean;
  attemptId?: string | null; // 결제 시도 ID (승인 시 생성, 포인트 전액 결제 시 null)
  transactionId?: string;
  code?: string; // 도메인 코드(성공/실패)
  message?: string; // 사용자/로그 메시지
  raw?: unknown; // 원 응답 스냅샷(옵션)

  // 포인트 통합 결제 관련
  pointEventId?: number | null; // 포인트 차감 이벤트 ID
  breakdown?: {
    totalAmount: number; // 원래 금액
    pointsUsed: number; // 사용한 포인트
    finalAmount: number; // 실제 결제 금액
  };
}

// 공통 환불/취소 요청 (Provider 중립적)
export interface RefundRequest {
  transactionId?: string; // HMS에서 사용
  paymentKey?: string; // Toss에서 사용
  amount?: number; // 부분 환불 금액
  reason: string;
}

export interface CancelRequest {
  transactionId?: string; // HMS에서 사용
  paymentKey?: string; // Toss에서 사용
  reason: string;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  code?: string;
  message?: string;
  raw?: unknown;
}
export interface CancelResult {
  success: boolean;
  cancelId?: string;
  code?: string;
  message?: string;
  raw?: unknown;
}

// 현금영수증 관련 인터페이스
export interface CashReceiptRequest {
  userId: string;
  paymentIntentId: string;
  totalAmount: number;
  customerType: 'INDIVIDUAL' | 'BUSINESS'; // 개인사업자 vs 법인
  customerBusinessNumber?: string; // 사업자번호 (법인일 때 필수)
  customerName: string;
  customerPhone?: string;
  purpose: 'INCOME_DEDUCTION' | 'BUSINESS_EXPENSE'; // 소득공제 vs 사업비
}

export interface CashReceiptResult {
  success: boolean;
  receiptId?: string; // HMS에서 반환하는 현금영수증 ID
  approvalNumber?: string; // 승인번호
  receiptDate?: string; // 발급일자
  code?: string;
  message?: string;
  raw?: unknown;
}

// 세금계산서 관련 인터페이스 (기존 TaxInvoiceService 활용)
export interface TaxInvoiceRequest {
  userId: string;
  paymentIntentId: string;
  paymentAttemptId?: string;
  externalOrderId: string;
  totalAmount: number;
  supplyAmount: number;
  taxAmount: number;
  customerName: string;
  customerBusinessNumber?: string;
  supplyDate: string;
  issueDate: string;
  invoiceSnapshot: any; // 기존 TaxInvoiceService 스키마 활용
}

export interface TaxInvoiceResult {
  success: boolean;
  invoiceId?: string;
  status?: string; // PENDING, EXPORTED, ISSUED, ERROR
  code?: string;
  message?: string;
  raw?: unknown;
}

// Provider별 최종 Payload (코어 Resolver가 조립)
export type HmsCardPayload = { memberId: string; amount: number };
export type HmsBnplPayload = {
  memberId: string;
  captureAmount: number;
  invoiceId: string;
};
export type TossPayload = {
  amount: number;
  billingKey?: string;
  oneTimeToken?: string;
  metadata?: Record<string, any>; // 이 줄을 추가해주세요.
};

export type ProviderPayloadMap = {
  HMS_CARD: HmsCardPayload;
  HMS_BNPL: HmsBnplPayload;
  TOSS: TossPayload;
  POINTS: PointsPayload; // ✅ 맵에 추가
};

// ✅ 포인트 결제를 위한 Payload 타입 정의
export type PointsPayload = {
  partnerId: number;
  amount: number;
  reason?: string;
};

// ───────────────────── Ports (capabilities) ─────────────────────
// 결제 실행(필수)
export interface ChargePort<K extends ProviderType = ProviderType> {
  process(payload: ProviderPayloadMap[K]): Promise<PaymentResult>; // 레거시 호환용
  authorize?(payload: ProviderPayloadMap[K]): Promise<PaymentResult>; // 승인만
  capture?(payload: {
    attemptId: string;
    amount: number;
  }): Promise<PaymentResult>; // 캡처만
}
// 선택 기능들(필요해지면 구현)
export interface RefundPort {
  refund(request: RefundRequest): Promise<RefundResult>;
}
export interface CancelPort {
  cancel(request: CancelRequest): Promise<CancelResult>;
}

// 현금영수증 발급 포트
export interface CashReceiptPort {
  issue(request: CashReceiptRequest): Promise<CashReceiptResult>;
  // TODO: 향후 취소 기능 추가 예정
  // cancel?(receiptId: string, reason: string): Promise<CashReceiptResult>;
}

// 세금계산서 생성 포트 (기존 TaxInvoiceService 활용)
export interface TaxInvoicePort {
  create(request: TaxInvoiceRequest): Promise<TaxInvoiceResult>;
}

// 프로필 등록/검증/해지 포트(결제프로필 전용)
export interface ProfileRegistrar<TInput = any, TMeta = any> {
  register(
    input: TInput,
    ctx: { tx: any },
  ): Promise<{
    externalId?: string;
    status: string;
    // TMeta는 성공 시의 메타 타입, 실패 시엔 Record<string, any>를 허용
    meta?: TMeta | Record<string, any>;
  }>;
  revoke?(profileId: string, ctx: { tx: any }): Promise<void>;
  verify?(
    profileId: string,
    ctx: { tx: any },
  ): Promise<{ ok: boolean; status?: string; meta?: TMeta }>;
}

// 레지스트리에서 노출할 핸들(Provider별 지원 capability)
export type ProviderHandle = {
  id: ProviderType;
  profile?: ProfileRegistrar | null;
  charge?: ChargePort | null;
  refund?: RefundPort | null;
  cancel?: CancelPort | null;
  cashReceipt?: CashReceiptPort | null; // 현금영수증 발급
  taxInvoice?: TaxInvoicePort | null; // 세금계산서 생성
};

export class PaymentError extends Error {
  constructor(
    public code: string,
    msg?: string,
  ) {
    super(msg ?? code);
  }
}
