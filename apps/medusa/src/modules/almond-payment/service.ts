import { AbstractPaymentProvider } from '@medusajs/framework/utils';
import type {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
} from '@medusajs/framework/types';

import type {
  ProviderWebhookPayload,
  WebhookActionResult,
} from '@medusajs/framework/types';
import { PaymentActions } from '@medusajs/framework/utils';
/**
 * 구성 옵션
 */
type CaptureMode = 'AUTO' | 'MANUAL'; // AUTO: 즉시결제(토스 등), MANUAL: BNPL(승인만)
type Options = {
  baseUrl: string;
  apiKey?: string;
  defaultIntentType?: string; // zod enum 값과 일치해야 함 (예: "PURCHASE")
  defaultReturnUrl?: string;
  defaultCancelUrl?: string;
  defaultCaptureMode?: CaptureMode; // 기본값: "MANUAL" 추천(BNPL)
  webhookSecret?: string; // (추후) 웹훅 서명 검증용
};

/**
 * Medusa에 저장되는 세션/페이먼트 데이터(최소 필드)
 */
type SessionData = {
  wallet: {
    intentId: string;
    checkoutSessionId?: string;
    redirectUrl?: string;
    amount?: number;
    currency?: string;
    captureMode?: CaptureMode;
    instrument?: string;
  };
};

type PaymentData = {
  wallet: {
    intentId: string;
    attemptId?: string;
    transactionId?: string;
    providerStatus?: string;
    capturedAt?: string;
    captureMode?: CaptureMode;
    refunds?: Array<{ id: string; amount: number; createdAt: string }>;
  };
};

/** ---- 유틸 ---- */
const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isFinite(n))
      throw new Error(`amount is not a finite number: ${v}`);
    return n;
  }
  // BigNumber 등일 수 있으므로 valueOf/ toString 고려
  // @ts-ignore
  if (v && typeof v.valueOf === 'function') {
    const n = Number(v.valueOf());
    if (!Number.isFinite(n))
      throw new Error(`amount is not a finite number: ${String(v)}`);
    return n;
  }
  throw new Error(`Unsupported amount type: ${typeof v}`);
};

class AlmondPaymentProvider extends AbstractPaymentProvider<Options> {
  static identifier = 'almond-payment';

  /** utils의 StripeBase처럼 내부에 보관 */
  protected options_: Options;
  protected container_: any;

  constructor(container: any, options: Options) {
    // @ts-ignore
    super(container, options);
    this.container_ = container;
    this.options_ = options;
  }

  /** StripeBase 호환 getter (this.options 사용 가능하게) */
  get options(): Options {
    return this.options_;
  }

  /** 공통 fetch 래퍼 */
  private async request<T>(
    path: string,
    init: RequestInit = {},
    idemKey?: string,
  ): Promise<T> {
    const url = `${this.options.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.options.apiKey
        ? { Authorization: `Bearer ${this.options.apiKey}` }
        : {}),
      ...(idemKey ? { 'Idempotency-Key': idemKey } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `${init.method ?? 'GET'} ${path} failed: ${res.status} ${text}`,
      );
    }
    // 비어있는 바디일 수도 있음
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      // @ts-ignore
      return undefined;
    }
    return (await res.json()) as T;
  }

  /** ========== 1) initiate: 외부 intent + (웹일 경우) checkout session 생성 → { id, data } ========== */
  async initiatePayment({
    currency_code,
    amount,
    data,
    context,
  }: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const idemKey = context?.idempotency_key;
    console.log('initiatePayment', context, data);

    // intentType
    const intentType =
      (data as any)?.intentType || this.options.defaultIntentType;
    if (!intentType) {
      throw new Error(
        'initiatePayment: intentType is required (data.intentType or options.defaultIntentType)',
      );
    }

    // customerId: context.customer.id -> 우리 월렛의 DTO 요구사항에 맞춰 전달
    const customerId =
      (context as any)?.customer?.id ||
      (context as any)?.account_holder?.data?.id ||
      (data as any)?.customerId;
    if (!customerId) {
      throw new Error('initiatePayment: customerId is required');
    }

    const amountNum = toNumber(amount);
    const currency = currency_code ?? 'KRW';

    // (A) INTENT 생성: POST /v2/payments/intents
    const intent = await this.request<{ id: string }>(
      `/v2/payments/intents`,
      {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          amount: amountNum,
          type: String(intentType),
        }),
      },
      idemKey,
    );

    // (B) CHECKOUT SESSION (웹 체크아웃일 때): POST /v2/payments/checkout/sessions
    const returnUrl =
      (context as any)?.return_url ||
      this.options.defaultReturnUrl ||
      'https://example.com/payment/return';
    const cancelUrl =
      (context as any)?.cancel_url ||
      this.options.defaultCancelUrl ||
      'https://example.com/payment/cancel';

    const session = await this.request<{
      sessionId: string;
      paymentUrl: string;
      intentId: string;
    }>(`/v2/payments/checkout/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        intentId: intent.id,
        returnUrl,
        cancelUrl,
      }),
    });

    const captureMode: CaptureMode =
      ((data as any)?.captureMode as CaptureMode) ||
      this.options.defaultCaptureMode ||
      'MANUAL';

    const sessionData: SessionData = {
      wallet: {
        intentId: intent.id,
        checkoutSessionId: session.sessionId, // 문서 키 사용
        redirectUrl: session.paymentUrl, // 문서 키 사용
        amount: amountNum,
        currency,
        captureMode,
        instrument: (data as any)?.instrument,
      },
    };

    return {
      id: intent.id,
      data: sessionData,
    };
  }

  /** ========== 2) authorize: 모든 결제 수단에서 승인만 처리. 항상 "authorized" 반환. ========== */
  async authorizePayment(
    input: AuthorizePaymentInput,
  ): Promise<AuthorizePaymentOutput> {
    const s = (input.data as SessionData | undefined)?.wallet;
    if (!s?.intentId)
      throw new Error('authorizePayment: missing intentId in session data');

    const idemKey = input.context?.idempotency_key;

    const paymentKey =
      (input.context as any)?.paymentKey || (input.context as any)?.payment_key;
    const providerType =
      (input.context as any)?.providerType ||
      (input.context as any)?.provider_type;

    let result: any = null;

    if (paymentKey) {
      // 토스 결제 - 승인만 처리
      result = await this.request<any>(
        `/v2/payments/intents/${s.intentId}/authorize`,
        {
          method: 'POST',
          body: JSON.stringify({ provider: 'TOSS', paymentKey }),
        },
        idemKey,
      );
    } else if (providerType) {
      // BNPL/서버 간 결제 - 승인만 처리
      const profileId =
        (input.context as any)?.profileId || (input.context as any)?.profile_id;
      const instrumentRef =
        (input.context as any)?.instrumentRef ||
        (input.context as any)?.instrument_ref;

      result = await this.request<any>(
        `/v2/payments/intents/${s.intentId}/authorize`,
        {
          method: 'POST',
          body: JSON.stringify({ providerType, profileId, instrumentRef }),
        },
        idemKey,
      );
    } else {
      throw new Error(
        'authorizePayment: paymentKey or providerType is required',
      );
    }

    const paymentData: PaymentData = {
      wallet: {
        intentId: s.intentId,
        attemptId: result?.attemptId,
        transactionId: result?.transactionId,
        providerStatus: 'AUTHORIZED', // 승인만 처리하므로 항상 AUTHORIZED
        captureMode: s.captureMode,
      },
    };

    // 주문 생성 트리거는 항상 authorized (변경 없음)
    return { status: 'authorized', data: paymentData };
  }

  /** ========== 3) capture: 모든 결제 수단에서 실제 capture 처리 ========== */
  async capturePayment(
    input: CapturePaymentInput,
  ): Promise<CapturePaymentOutput> {
    const pd = input.data as PaymentData | undefined;
    if (!pd?.wallet?.intentId) {
      throw new Error('capturePayment: missing intentId in payment data');
    }

    const idemKey = input.context?.idempotency_key;
    const amount = toNumber(input.data?.amount || 0);

    // Wallet 서버의 capture API 호출
    const result = await this.request<any>(
      `/v2/payments/intents/${pd.wallet.intentId}/capture`,
      {
        method: 'POST',
        body: JSON.stringify({
          amount,
          attemptId: pd.wallet.attemptId,
        }),
      },
      idemKey,
    );

    const updatedPaymentData: PaymentData = {
      wallet: {
        ...pd.wallet,
        providerStatus: 'CAPTURED',
        capturedAt: result?.capturedAt || new Date().toISOString(),
      },
    };

    return { data: updatedPaymentData };
  }

  /** ========== 4) 취소 ==========
   * 월렛에 /v2/payment-intents/:id/cancel 이 생기면 여기서 호출로 교체
   */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data as any };
  }

  /** ========== 5) 삭제(=취소와 동일 처리) ========== */
  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return this.cancelPayment(input as any);
  }

  /** ========== 6) 상태 조회 ==========
   * 월렛에 status 조회 엔드포인트가 없으니 session data의 추론/보수값으로 반환
   */
  async getPaymentStatus(
    input: GetPaymentStatusInput,
  ): Promise<GetPaymentStatusOutput> {
    const pd = input?.data as PaymentData | undefined;
    const status =
      pd?.wallet?.providerStatus === 'SUCCEEDED'
        ? 'captured'
        : pd?.wallet?.providerStatus === 'AUTHORIZED'
          ? 'authorized'
          : 'pending';
    // @ts-ignore - Medusa의 GetPaymentStatusOutput 형태와 호환되도록 최소값만
    return { data: input.data as any, status };
  }

  /** ========== 7) 환불 ==========
   * 월렛에 /v2/payment-refunds 생기면 호출 추가
   */
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    // TODO: 월렛 환불 API 연결
    return { data: input.data as any };
  }

  /** ========== 8) 조회 ==========
   * 월렛에 retrieve API가 생기면 연결
   */
  async retrievePayment(
    input: RetrievePaymentInput,
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data as any };
  }

  /** ========== 9) 업데이트 ==========
   * 금액/통화 변경 시 월렛 PATCH가 필요하면 여기에 연결
   */
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: input.data as any, status: 'pending' as any };
  }

  /** ========== 10) 웹훅 ==========
   * 현재 네 문서에 명확한 스키마가 없으므로 any로 두고 매핑만 제공 (추후 HMAC 검증 추가)
   */
  // 아래 헬퍼는 다양한 키 이름을 허용해 session_id/amount를 뽑아줍니다.
  private extractWebhookActionData = (raw: Record<string, any>) => {
    // session_id 후보들 (너희 월렛 웹훅 스펙에 맞춰 추가/수정 가능)
    const sessionId =
      raw.session_id ??
      raw.sessionId ??
      raw.checkout_session_id ??
      raw.checkoutSessionId ??
      raw.payment_session_id ??
      raw.metadata?.session_id ??
      raw.session?.id ??
      raw.intentId ?? // 최후수단
      raw.intent_id;

    if (!sessionId) {
      throw new Error('Webhook payload missing `session_id` (or equivalent).');
    }

    // amount 후보들
    const amountRaw =
      raw.amount ??
      raw.amount_authorized ??
      raw.amount_received ??
      raw.amount_captured ??
      raw.capturedAmount ??
      raw.total ??
      raw.value ??
      raw.data?.amount;

    const toNumber = (v: any) => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      if (typeof v?.valueOf === 'function') {
        const n = Number(v.valueOf());
        if (Number.isFinite(n)) return n;
      }
      return 0;
    };

    return {
      session_id: String(sessionId),
      amount: toNumber(amountRaw), // BigNumberInput 호환(number OK)
    };
  };

  async getWebhookActionAndData(
    webhookData: ProviderWebhookPayload['payload'],
  ): Promise<WebhookActionResult> {
    // 보통 너희 월렛이 보낸 JSON 본문
    const body = webhookData.data as Record<string, any>;
    const evt = body?.type ?? body?.event ?? body?.event_type ?? '';

    // 공통 데이터 추출 (Medusa가 요구)
    const actionData = this.extractWebhookActionData(body);

    switch (evt) {
      case 'payment.authorized':
        return {
          action: PaymentActions.AUTHORIZED,
          data: actionData,
        };
      case 'payment.captured':
      case 'payment.settled':
        return {
          action: PaymentActions.SUCCESSFUL, // 캡처 완료
          data: actionData,
        };
      case 'payment.canceled':
        return {
          action: PaymentActions.CANCELED,
          data: actionData,
        };
      case 'payment.failed':
        return {
          action: PaymentActions.FAILED,
          data: actionData,
        };
      // 필요 시 여기서 다른 이벤트도 매핑 추가
      default:
        // NOT_SUPPORTED는 data가 꼭 필요하진 않지만, 타입 문제 피하려면 넣어도 OK
        return {
          action: PaymentActions.NOT_SUPPORTED,
          data: actionData,
        };
    }
  }
}

export default AlmondPaymentProvider;
