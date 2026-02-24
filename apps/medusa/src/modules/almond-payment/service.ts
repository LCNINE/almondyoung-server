import { AbstractPaymentProvider, PaymentActions } from '@medusajs/framework/utils';
import type { PaymentSessionStatus } from '@medusajs/framework/types';
import type {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  AuthorizePaymentOutput,
  CapturePaymentOutput,
  CancelPaymentOutput,
  RefundPaymentOutput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  GetPaymentStatusOutput,
} from '@medusajs/framework/types';
import type {
  ProviderWebhookPayload,
  WebhookActionResult,
} from '@medusajs/framework/types';

import type { AlmondPaymentOptions, WalletSessionData } from './types';

export class AlmondPaymentProviderService extends AbstractPaymentProvider<AlmondPaymentOptions> {
  static identifier = 'almond-payment';

  constructor(container: any, options: AlmondPaymentOptions) {
    // @ts-ignore
    super(container, options);
  }

  private async walletFetch<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.options.walletBaseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.options.walletApiKey}`,
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

  private mapStatus(walletStatus: string): PaymentSessionStatus {
    switch (walletStatus) {
      case 'SUCCEEDED':
        return 'authorized';
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
    const { amount, currency_code, context: ctx } = context;
    const returnUrl = (ctx?.return_url as string) ?? undefined;

    const intent = await this.walletFetch<{ id: string }>(
      '/v1/payment-intents',
      {
        method: 'POST',
        body: JSON.stringify({
          payableAmount: Number(amount),
          currency: currency_code.toUpperCase(),
          ...(returnUrl ? { returnUrl } : {}),
        }),
      },
    );

    const sessionData: WalletSessionData = {
      intentId: intent.id,
      amount: Number(amount),
      currency: currency_code.toUpperCase(),
    };
    return { data: sessionData as unknown as Record<string, unknown> };
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
  ): Promise<AuthorizePaymentOutput> {
    const { intentId } = paymentSessionData as unknown as WalletSessionData;
    const intent = await this.walletFetch<{ id: string; status: string }>(
      `/v1/payment-intents/${intentId}`,
    );

    const status = this.mapStatus(intent.status);
    return { data: paymentSessionData, status };
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>,
  ): Promise<CapturePaymentOutput> {
    const { intentId, amount } =
      paymentSessionData as unknown as WalletSessionData;
    await this.walletFetch(`/v1/payment-intents/${intentId}/capture`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    return { data: paymentSessionData };
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>,
  ): Promise<CancelPaymentOutput> {
    const { intentId } = paymentSessionData as unknown as WalletSessionData;
    await this.walletFetch(`/v1/payment-intents/${intentId}/cancel`, {
      method: 'POST',
    });
    return { data: paymentSessionData };
  }

  async deletePayment(
    paymentSessionData: Record<string, unknown>,
  ): Promise<CancelPaymentOutput> {
    return this.cancelPayment(paymentSessionData);
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number,
  ): Promise<RefundPaymentOutput> {
    const { intentId } = paymentSessionData as unknown as WalletSessionData;
    await this.walletFetch('/v1/refunds', {
      method: 'POST',
      body: JSON.stringify({
        intentId,
        amount: refundAmount,
        reasonCode: 'MEDUSA_REFUND',
      }),
    });
    return { data: paymentSessionData };
  }

  async retrievePayment(
    paymentSessionData: Record<string, unknown>,
  ): Promise<RetrievePaymentOutput> {
    const { intentId } = paymentSessionData as unknown as WalletSessionData;
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

    // create new intent
    const intent = await this.walletFetch<{ id: string }>(
      '/v1/payment-intents',
      {
        method: 'POST',
        body: JSON.stringify({ payableAmount: newAmount, currency: newCurrency }),
      },
    );

    return {
      data: {
        intentId: intent.id,
        amount: newAmount,
        currency: newCurrency,
      } as unknown as Record<string, unknown>,
    };
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>,
  ): Promise<GetPaymentStatusOutput> {
    const { intentId } = paymentSessionData as unknown as WalletSessionData;
    const intent = await this.walletFetch<{ status: string }>(
      `/v1/payment-intents/${intentId}`,
    );
    return { status: this.mapStatus(intent.status) };
  }

  async getWebhookActionAndData(
    webhookData: ProviderWebhookPayload['payload'],
  ): Promise<WebhookActionResult> {
    const body = webhookData.data as Record<string, any>;
    const evt: string = body?.type ?? body?.event ?? body?.event_type ?? '';

    const intentId =
      body?.intentId ??
      body?.intent_id ??
      body?.session_id ??
      body?.metadata?.intent_id;

    if (!intentId) {
      throw new Error('Webhook payload missing intentId.');
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
      session_id: String(intentId),
      amount,
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
