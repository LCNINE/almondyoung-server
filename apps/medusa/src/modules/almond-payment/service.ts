import { AbstractPaymentProvider, BigNumber, PaymentActions } from '@medusajs/framework/utils';
import type { PaymentSessionStatus } from '@medusajs/framework/types';
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
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
} from '@medusajs/framework/types';
import type { ProviderWebhookPayload, WebhookActionResult } from '@medusajs/framework/types';

import type { AlmondPaymentOptions, WalletSessionData } from './types';

export class AlmondPaymentProviderService extends AbstractPaymentProvider<AlmondPaymentOptions> {
  static identifier = 'almond-payment';

  constructor(container: Record<string, unknown>, options: AlmondPaymentOptions) {
    super(container, options);
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.walletBaseUrl) {
      throw new Error('walletBaseUrl is required for almond-payment provider');
    }
    if (!options.walletApiKey) {
      throw new Error('walletApiKey is required for almond-payment provider');
    }
  }

  private async walletFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.walletBaseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.walletApiKey}`,
      ...(options.method && options.method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      ...((options.headers as Record<string, string>) ?? {}),
    };
    const method = (options.method ?? 'GET').toUpperCase();
    if (options.body == null && method !== 'GET' && method !== 'HEAD') {
      options.body = JSON.stringify({});
    }
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message ?? `Wallet API error ${res.status}: ${path}`);
    }
    return res.json();
  }

  private mapStatus(walletStatus: string, captured = false): PaymentSessionStatus {
    switch (walletStatus) {
      case 'AUTHORIZED':
        return 'authorized';
      case 'CAPTURED':
        return 'captured';
      case 'SUCCEEDED':
        return captured ? 'captured' : 'authorized'; // backward compat
      case 'CANCELED':
        return 'canceled';
      case 'FAILED':
        return 'error';
      default:
        return 'pending'; // CREATED, PROCESSING, REQUIRES_ACTION
    }
  }

  async initiatePayment(context: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context: ctx, data } = context;
    const returnUrl =
      (data?.returnUrl as string) ?? ((ctx as Record<string, unknown>)?.return_url as string) ?? undefined;

    const customer = (ctx as any)?.customer;
    const firstName = customer?.first_name as string | null | undefined;
    const lastName = customer?.last_name as string | null | undefined;
    const customerName = [firstName, lastName].filter(Boolean).join(' ') || undefined;
    const customerEmail = customer?.email as string | undefined;
    const customerMobilePhone = customer?.phone as string | null | undefined;
    const orderName = data?.orderName as string | undefined;

    const metadata: Record<string, unknown> = {};
    if (orderName) metadata.orderName = orderName;
    if (customerName) metadata.customerName = customerName;
    if (customerEmail) metadata.customerEmail = customerEmail;
    if (customerMobilePhone) metadata.customerMobilePhone = customerMobilePhone;

    const items = data?.items as unknown[] | undefined;

    // Medusa passes its auto-generated payment session ID (payses_*) via data.session_id.
    // We store it in intent metadata so the webhook handler can resolve the payment session
    // without a JSON column scan — see payment-events/route.ts handleCaptureProjection.
    const medusaSessionId = (data as any)?.session_id as string | undefined;
    if (medusaSessionId) metadata.medusaSessionId = medusaSessionId;

    // userId는 wallet-web에서 첫 번째 JWT 인증 GET 요청 시 자동으로 claim되므로 여기서 전달하지 않음
    const intent = await this.walletFetch<{ id: string }>('/v1/payment-intents', {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(amount),
        currency: currency_code.toUpperCase(),
        ...(returnUrl ? { returnUrl } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(items?.length ? { items } : {}),
      }),
    });

    const sessionData: WalletSessionData = {
      intentId: intent.id,
      amount: Number(amount),
      currency: currency_code.toUpperCase(),
    };
    return { id: intent.id, data: sessionData as unknown as Record<string, unknown> };
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = input.data as unknown as WalletSessionData;
    const intent = await this.walletFetch<{ id: string; status: string }>(`/v1/payment-intents/${data.intentId}`);

    const status = this.mapStatus(intent.status, data.captured);
    return { data: input.data, status };
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = input.data as unknown as WalletSessionData & { captured?: boolean };

    // Skip the Wallet API call when the payment was already captured by Core/Wallet
    // (the payment-events hook sets captured: true before running capturePaymentWorkflow).
    // Core/Wallet is the payment SSOT; this is a DB-only projection sync.
    if (!data.captured) {
      await this.walletFetch(`/v1/payment-intents/${data.intentId}/capture`, {
        method: 'POST',
      });
    }

    // captured: true 플래그를 data에 기록 → 이후 getPaymentStatus에서 'captured' 반환
    return {
      data: {
        ...(input.data as Record<string, unknown>),
        captured: true,
      },
    };
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const { intentId } = input.data as unknown as WalletSessionData;
    try {
      await this.walletFetch(`/v1/payment-intents/${intentId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch (err: any) {
      // Intent가 이미 terminal 상태(CAPTURED, FAILED 등)인 경우 취소 불가 → no-op으로 처리
      // 장바구니 수정 시 Medusa가 기존 payment session을 삭제하려 할 때 발생하는 케이스
      const msg = (err?.message ?? '') as string;
      if (msg.includes('INTENT_NOT_CANCELABLE') || msg.includes('cannot be canceled')) {
        return { data: input.data };
      }
      throw err;
    }
    return { data: input.data };
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return this.cancelPayment(input);
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const { intentId } = input.data as unknown as WalletSessionData;
    const refundAmount = Number(input.amount);
    await this.walletFetch(`/v1/payment-intents/${intentId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ amount: refundAmount, reasonCode: 'MEDUSA_REFUND' }),
    });
    return { data: input.data };
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const { intentId } = input.data as unknown as WalletSessionData;
    const intent = await this.walletFetch<{
      id: string;
      status: string;
      payableAmount: number;
      currency: string;
    }>(`/v1/payment-intents/${intentId}`);
    return { data: intent as unknown as Record<string, unknown> };
  }

  async updatePayment(context: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const prevData = context.data as unknown as WalletSessionData;
    const newAmount = Number(context.amount);
    const newCurrency = context.currency_code.toUpperCase();

    if (prevData.amount === newAmount && prevData.currency === newCurrency) {
      return { data: context.data };
    }

    // cancel existing intent (이미 terminal 상태면 무시)
    try {
      await this.walletFetch(`/v1/payment-intents/${prevData.intentId}/cancel`, { method: 'POST' });
    } catch (err: any) {
      const msg = (err?.message ?? '') as string;
      if (!msg.includes('INTENT_NOT_CANCELABLE') && !msg.includes('cannot be canceled')) {
        throw err;
      }
    }

    // create new intent — userId는 wallet-web에서 첫 GET 요청 시 자동 claim됨
    const intent = await this.walletFetch<{ id: string }>('/v1/payment-intents', {
      method: 'POST',
      body: JSON.stringify({
        amount: newAmount,
        currency: newCurrency,
      }),
    });

    const updatedData: WalletSessionData = {
      intentId: intent.id,
      amount: newAmount,
      currency: newCurrency,
    };
    return { data: updatedData as unknown as Record<string, unknown> };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = input.data as unknown as WalletSessionData;
    const intent = await this.walletFetch<{ status: string }>(`/v1/payment-intents/${data.intentId}`);
    return { status: this.mapStatus(intent.status, data.captured) };
  }

  async getWebhookActionAndData(webhookData: ProviderWebhookPayload['payload']): Promise<WebhookActionResult> {
    const body = webhookData.data as Record<string, any>;
    const evt: string = body?.type ?? body?.event ?? body?.event_type ?? '';

    // intentId = 아웃박스 payload의 필드이자 initiatePayment가 반환한 id (= Medusa session ID)
    const sessionId: string | undefined = body?.intentId ?? body?.aggregateId;

    if (!sessionId) {
      throw new Error('Webhook payload missing intentId. Ensure wallet outbox events include intentId in payload.');
    }

    const amountRaw = body?.amount ?? body?.payableAmount ?? body?.amount_captured ?? body?.data?.amount ?? 0;
    const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw) || 0;

    const actionData = {
      session_id: String(sessionId),
      amount: new BigNumber(amount),
    };

    switch (evt) {
      case 'payment.intent.authorized':
        return { action: PaymentActions.AUTHORIZED, data: actionData };
      case 'payment.intent.succeeded': // legacy
        return { action: PaymentActions.AUTHORIZED, data: actionData };
      case 'payment.intent.captured':
        return { action: PaymentActions.SUCCESSFUL, data: actionData };
      case 'payment.intent.canceled':
        return { action: PaymentActions.CANCELED, data: actionData };
      case 'payment.intent.failed':
        return { action: PaymentActions.FAILED, data: actionData };
      default:
        return { action: PaymentActions.NOT_SUPPORTED, data: actionData };
    }
  }
}

export default AlmondPaymentProviderService;
