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
import type {
  ProviderWebhookPayload,
  WebhookActionResult,
} from '@medusajs/framework/types';

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

  private async walletFetch<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.config.walletBaseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.walletApiKey}`,
      ...(options.method && options.method !== 'GET'
        ? { 'Idempotency-Key': crypto.randomUUID() }
        : {}),
      ...((options.headers as Record<string, string>) ?? {}),
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as any)?.message ?? `Wallet API error ${res.status}: ${path}`,
      );
    }
    return res.json();
  }

  private mapStatus(walletStatus: string, captured = false): PaymentSessionStatus {
    switch (walletStatus) {
      case 'SUCCEEDED':
        return captured ? 'captured' : 'authorized';
      case 'CANCELED':
        return 'canceled';
      case 'FAILED':
        return 'error';
      default:
        return 'pending'; // CREATED, PROCESSING, REQUIRES_ACTION
    }
  }

  async initiatePayment(
    context: InitiatePaymentInput,
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context: ctx, data } = context;
    const returnUrl = ((ctx as Record<string, unknown>)?.return_url as string) ?? undefined;
    const userId = ctx?.customer?.id as string | undefined;
    if (!userId) throw new Error('customer.id is required in payment context');

    // Medusa passes its session ID via data.session_id — store it for webhook correlation
    const medusaSessionId = (data as Record<string, unknown>)?.session_id as string | undefined;

    const intent = await this.walletFetch<{ id: string }>(
      '/v1/payment-intents',
      {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(amount),
          currency: currency_code.toUpperCase(),
          userId,
          ...(returnUrl ? { returnUrl } : {}),
          ...(medusaSessionId ? { metadata: { medusa_session_id: medusaSessionId } } : {}),
        }),
      },
    );

    const sessionData: WalletSessionData = {
      intentId: intent.id,
      amount: Number(amount),
      currency: currency_code.toUpperCase(),
      userId,
      medusaSessionId,
    };
    return { id: intent.id, data: sessionData as unknown as Record<string, unknown> };
  }

  async authorizePayment(
    input: AuthorizePaymentInput,
  ): Promise<AuthorizePaymentOutput> {
    const data = input.data as unknown as WalletSessionData;
    const intent = await this.walletFetch<{ id: string; status: string }>(
      `/v1/payment-intents/${data.intentId}`,
    );

    const status = this.mapStatus(intent.status, data.captured);
    return { data: input.data, status };
  }

  async capturePayment(
    input: CapturePaymentInput,
  ): Promise<CapturePaymentOutput> {
    const { intentId } = input.data as unknown as WalletSessionData;
    await this.walletFetch(`/v1/payment-intents/${intentId}/capture`, {
      method: 'POST',
    });
    // captured: true 플래그를 data에 기록 → 이후 getPaymentStatus에서 'captured' 반환
    return {
      data: {
        ...(input.data as Record<string, unknown>),
        captured: true,
      },
    };
  }

  async cancelPayment(
    input: CancelPaymentInput,
  ): Promise<CancelPaymentOutput> {
    const { intentId } = input.data as unknown as WalletSessionData;
    await this.walletFetch(`/v1/payment-intents/${intentId}/cancel`, {
      method: 'POST',
    });
    return { data: input.data };
  }

  async deletePayment(
    input: DeletePaymentInput,
  ): Promise<DeletePaymentOutput> {
    return this.cancelPayment(input);
  }

  async refundPayment(
    input: RefundPaymentInput,
  ): Promise<RefundPaymentOutput> {
    const { intentId } = input.data as unknown as WalletSessionData;
    const refundAmount = Number(input.amount);
    await this.walletFetch(`/v1/payment-intents/${intentId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ amount: refundAmount, reasonCode: 'MEDUSA_REFUND' }),
    });
    return { data: input.data };
  }

  async retrievePayment(
    input: RetrievePaymentInput,
  ): Promise<RetrievePaymentOutput> {
    const { intentId } = input.data as unknown as WalletSessionData;
    const intent = await this.walletFetch<{
      id: string;
      status: string;
      payableAmount: number;
      currency: string;
    }>(`/v1/payment-intents/${intentId}`);
    return { data: intent as unknown as Record<string, unknown> };
  }

  async updatePayment(
    context: UpdatePaymentInput,
  ): Promise<UpdatePaymentOutput> {
    const prevData = context.data as unknown as WalletSessionData;
    const newAmount = Number(context.amount);
    const newCurrency = context.currency_code.toUpperCase();

    if (prevData.amount === newAmount && prevData.currency === newCurrency) {
      return { data: context.data };
    }

    // cancel existing intent
    await this.walletFetch(
      `/v1/payment-intents/${prevData.intentId}/cancel`,
      { method: 'POST' },
    );

    // create new intent — userId and medusaSessionId are carried over from existing session data
    const intent = await this.walletFetch<{ id: string }>(
      '/v1/payment-intents',
      {
        method: 'POST',
        body: JSON.stringify({
          amount: newAmount,
          currency: newCurrency,
          userId: prevData.userId,
          ...(prevData.medusaSessionId
            ? { metadata: { medusa_session_id: prevData.medusaSessionId } }
            : {}),
        }),
      },
    );

    const updatedData: WalletSessionData = {
      intentId: intent.id,
      amount: newAmount,
      currency: newCurrency,
      userId: prevData.userId,
      medusaSessionId: prevData.medusaSessionId,
    };
    return { data: updatedData as unknown as Record<string, unknown> };
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput,
  ): Promise<GetPaymentStatusOutput> {
    const data = input.data as unknown as WalletSessionData;
    const intent = await this.walletFetch<{ status: string }>(
      `/v1/payment-intents/${data.intentId}`,
    );
    return { status: this.mapStatus(intent.status, data.captured) };
  }

  async getWebhookActionAndData(
    webhookData: ProviderWebhookPayload['payload'],
  ): Promise<WebhookActionResult> {
    const body = webhookData.data as Record<string, any>;
    const evt: string = body?.type ?? body?.event ?? body?.event_type ?? '';

    // wallet이 intent 생성 시 저장한 medusa_session_id를 이벤트 payload에 포함시켜 보냄
    const sessionId: string | undefined =
      body?.medusa_session_id ??
      body?.metadata?.medusa_session_id ??
      body?.session_id;

    if (!sessionId) {
      throw new Error('Webhook payload missing medusa_session_id. Ensure wallet events include metadata.medusa_session_id.');
    }

    const amountRaw =
      body?.amount ??
      body?.payableAmount ??
      body?.amount_captured ??
      body?.data?.amount ??
      0;
    const amount =
      typeof amountRaw === 'number' ? amountRaw : Number(amountRaw) || 0;

    const actionData = {
      session_id: String(sessionId),
      amount: new BigNumber(amount),
    };

    switch (evt) {
      case 'payment.intent.succeeded':
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
