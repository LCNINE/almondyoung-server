import { Injectable, Logger } from '@nestjs/common';

export interface TossConfirmResponse {
  paymentKey: string;
  orderId: string;
  status: string;
  [key: string]: unknown;
}

export interface TossCancelResponse {
  paymentKey: string;
  cancels: Array<{ cancelAmount: number; cancelReason: string }>;
  [key: string]: unknown;
}

export interface TossBillingKeyResponse {
  billingKey: string;
  customerKey: string;
  cardCompany: string;
  cardNumber: string;
  method: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TossBillingConfirmResponse {
  paymentKey: string;
  orderId: string;
  status: string;
  [key: string]: unknown;
}

export interface TossCashReceiptResponse {
  receiptKey: string;
  issueNumber: string;
  issueStatus: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  transactionType: 'CONFIRM' | 'CANCEL';
  receiptUrl: string;
  amount: number;
  taxFreeAmount: number;
  [key: string]: unknown;
}

export interface TossApiError {
  code: string;
  message: string;
}

export type TossApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: TossApiError; statusCode: number };

@Injectable()
export class TossApiClient {
  private readonly logger = new Logger(TossApiClient.name);
  private readonly baseUrl = 'https://api.tosspayments.com/v1';

  private get auth(): string {
    const secretKey = process.env.TOSS_SECRET_KEY ?? '';
    return Buffer.from(`${secretKey}:`).toString('base64');
  }

  async confirmPayment(paymentKey: string, amount: number, orderId: string): Promise<TossApiResult<TossConfirmResponse>> {
    return this.post<TossConfirmResponse>('/payments/confirm', { paymentKey, orderId, amount });
  }

  async cancelPayment(
    paymentKey: string,
    cancelReason: string,
    cancelAmount?: number,
    idempotencyKey?: string,
  ): Promise<TossApiResult<TossCancelResponse>> {
    const body: Record<string, unknown> = { cancelReason };
    if (cancelAmount !== undefined) body.cancelAmount = cancelAmount;
    return this.post<TossCancelResponse>(
      `/payments/${paymentKey}/cancel`,
      body,
      idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    );
  }

  async issueBillingKey(authKey: string, customerKey: string): Promise<TossApiResult<TossBillingKeyResponse>> {
    return this.post<TossBillingKeyResponse>('/billing/authorizations/issue', { authKey, customerKey });
  }

  async confirmBilling(
    billingKey: string,
    amount: number,
    orderId: string,
    customerKey: string,
    orderName?: string,
  ): Promise<TossApiResult<TossBillingConfirmResponse>> {
    return this.post<TossBillingConfirmResponse>(`/billing/${billingKey}`, {
      customerKey,
      amount,
      orderId,
      orderName: orderName ?? '정기결제',
    });
  }

  async issueCashReceipt(params: {
    amount: number;
    orderId: string;
    orderName: string;
    type: '소득공제' | '지출증빙';
    customerIdentityNumber: string;
    taxFreeAmount?: number;
  }): Promise<TossApiResult<TossCashReceiptResponse>> {
    const body: Record<string, unknown> = {
      amount: params.amount,
      orderId: params.orderId,
      orderName: params.orderName,
      type: params.type,
      customerIdentityNumber: params.customerIdentityNumber,
    };
    if (params.taxFreeAmount !== undefined) body.taxFreeAmount = params.taxFreeAmount;
    return this.post<TossCashReceiptResponse>('/cash-receipts', body);
  }

  async cancelCashReceipt(receiptKey: string, amount?: number): Promise<TossApiResult<TossCashReceiptResponse>> {
    const body: Record<string, unknown> = {};
    if (amount !== undefined) body.amount = amount;
    return this.post<TossCashReceiptResponse>(`/cash-receipts/${receiptKey}/cancel`, body);
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<TossApiResult<T>> {
    const url = `${this.baseUrl}${path}`;
    this.logger.debug(`POST ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as T;
      return { ok: true, data };
    }

    const error = await res.json().catch(() => ({ code: 'UNKNOWN', message: 'Unknown error' }));
    this.logger.error(`Toss API error: ${res.status} ${this.stringifyError(error)}`);
    return { ok: false, error: this.normalizeError(error), statusCode: res.status };
  }

  private normalizeError(error: unknown): TossApiError {
    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      return {
        code: this.asString(record.code) ?? this.asString(record.errorCode) ?? 'UNKNOWN',
        message: this.formatMessage(record.message ?? record.errorMessage ?? error),
      };
    }

    return { code: 'UNKNOWN', message: this.formatMessage(error) };
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private formatMessage(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    return this.stringifyError(value);
  }

  private stringifyError(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
