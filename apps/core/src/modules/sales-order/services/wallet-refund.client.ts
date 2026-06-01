import { Injectable, Logger } from '@nestjs/common';

export type WalletRefundStatus = 'SUCCEEDED' | 'PENDING' | 'FAILED';

export interface WalletRefundResult {
  status: WalletRefundStatus;
  refundId: string;
  intentId: string;
  amount: number;
  currency: string;
  reasonCode: string | null;
  reasonMessage: string | null;
  manualConfirmable: boolean;
}

export interface WalletRefundByIntentResponse {
  intentId: string;
  refunds: WalletRefundResult[];
}

export type WalletRefundOutcome =
  | { kind: 'success'; refunds: WalletRefundResult[] }
  | { kind: 'partial_pending'; refunds: WalletRefundResult[] }
  | { kind: 'failed'; errorCode: string; errorMessage: string }
  | { kind: 'no_intent_id' }
  | { kind: 'wallet_unavailable'; errorMessage: string };

/**
 * Core → Wallet 환불 HTTP 클라이언트.
 *
 * WALLET_BASE_URL, WALLET_API_KEY 환경 변수로 Wallet 서비스를 지정한다.
 * 두 변수가 없으면 환불 시도 자체를 건너뛰고 `wallet_unavailable` outcome을 반환한다.
 */
@Injectable()
export class WalletRefundClient {
  private readonly logger = new Logger(WalletRefundClient.name);
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;

  constructor() {
    this.baseUrl = process.env.WALLET_BASE_URL;
    this.apiKey = process.env.WALLET_API_KEY;
  }

  async refundByIntent(
    intentId: string,
    amount: number,
    options: { reasonCode?: string; reasonMessage?: string; correlationId: string },
  ): Promise<WalletRefundOutcome> {
    if (!this.baseUrl || !this.apiKey) {
      this.logger.warn(
        `[WalletRefundClient] WALLET_BASE_URL or WALLET_API_KEY not configured. ` +
          `Skipping refund for intent ${intentId}. correlationId=${options.correlationId}`,
      );
      return { kind: 'wallet_unavailable', errorMessage: 'WALLET_BASE_URL or WALLET_API_KEY not set' };
    }

    const url = `${this.baseUrl}/v1/payment-intents/${intentId}/refund`;
    this.logger.log(
      `[WalletRefundClient] Requesting refund: intentId=${intentId} amount=${amount} correlationId=${options.correlationId}`,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'Idempotency-Key': options.correlationId,
          'X-Correlation-Id': options.correlationId,
        },
        body: JSON.stringify({
          amount,
          reasonCode: options.reasonCode,
          reasonMessage: options.reasonMessage,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[WalletRefundClient] Network error for intent ${intentId}: ${message}. correlationId=${options.correlationId}`,
      );
      return { kind: 'wallet_unavailable', errorMessage: message };
    }

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const errorCode = (body as any)?.error ?? `HTTP_${response.status}`;
      const errorMessage = (body as any)?.message ?? response.statusText;
      this.logger.error(
        `[WalletRefundClient] Wallet returned ${response.status} for intent ${intentId}: ${errorCode} ${errorMessage}`,
      );
      return { kind: 'failed', errorCode, errorMessage };
    }

    let data: WalletRefundByIntentResponse;
    try {
      // Wallet API returns `id` per refund record; normalize to `refundId` for Core types.
      const raw = (await response.json()) as { intentId: string; refunds?: Array<Record<string, unknown>> };
      data = {
        intentId: raw.intentId,
        refunds: (raw.refunds ?? []).map((r) => ({
          refundId: (r.id ?? r.refundId ?? '') as string,
          intentId: (r.intentId ?? intentId) as string,
          status: r.status as WalletRefundStatus,
          amount: Number(r.amount ?? 0),
          currency: (r.currency ?? 'KRW') as string,
          reasonCode: (r.reasonCode ?? null) as string | null,
          reasonMessage: (r.reasonMessage ?? null) as string | null,
          manualConfirmable: Boolean(r.manualConfirmable ?? false),
        })),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[WalletRefundClient] Failed to parse Wallet response for intent ${intentId}: ${message}`);
      return { kind: 'wallet_unavailable', errorMessage: `Invalid JSON from Wallet: ${message}` };
    }

    const refunds = data.refunds ?? [];
    const hasFailed = refunds.some((r) => r.status === 'FAILED');
    const hasPending = refunds.some((r) => r.status === 'PENDING');

    if (hasFailed) {
      const failed = refunds.find((r) => r.status === 'FAILED');
      return {
        kind: 'failed',
        errorCode: failed?.reasonCode ?? 'REFUND_FAILED',
        errorMessage: failed?.reasonMessage ?? 'Wallet refund failed',
      };
    }
    if (hasPending) {
      return { kind: 'partial_pending', refunds };
    }
    return { kind: 'success', refunds };
  }
}
