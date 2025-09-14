// Domain SSOT: Provider/Payment Types, Ports, Payload Map
// 변경 전 모든 중복 타입들을 여기로 수렴시키세요.

export enum PaymentType {
  ORDER = 'ORDER',
  BNPL_CAPTURE = 'BNPL_CAPTURE',
  MEMBERSHIP = 'MEMBERSHIP',
}

export enum ProviderType {
  HMS_CARD = 'HMS_CARD',
  HMS_BNPL = 'HMS_BNPL',
  TOSS = 'TOSS',
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
  transactionId?: string;
  code?: string; // 도메인 코드(성공/실패)
  message?: string; // 사용자/로그 메시지
  raw?: unknown; // 원 응답 스냅샷(옵션)
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
};

// ───────────────────── Ports (capabilities) ─────────────────────
// 결제 실행(필수)
export interface ChargePort<K extends ProviderType = ProviderType> {
  process(payload: ProviderPayloadMap[K]): Promise<PaymentResult>;
}
// 선택 기능들(필요해지면 구현)
export interface RefundPort<Payload = any> {
  refund(payload: Payload): Promise<RefundResult>;
}
export interface CancelPort<Payload = any> {
  cancel(payload: Payload): Promise<CancelResult>;
}

// 프로필 등록/검증/해지 포트(결제프로필 전용)
export interface ProfileRegistrar<TInput = any, TMeta = any> {
  register(
    input: TInput,
    ctx: { tx: any },
  ): Promise<{ externalId?: string; status: string; meta?: TMeta }>;
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
};

export class PaymentError extends Error {
  constructor(
    public code: string,
    msg?: string,
  ) {
    super(msg ?? code);
  }
}
