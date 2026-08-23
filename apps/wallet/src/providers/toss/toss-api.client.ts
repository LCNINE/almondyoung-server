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

export interface TossVirtualAccount {
  accountType: string;
  accountNumber: string;
  bankCode: string;
  customerName: string;
  dueDate: string;
  [key: string]: unknown;
}

export interface TossVirtualAccountResponse {
  paymentKey: string;
  orderId: string;
  status: string; // WAITING_FOR_DEPOSIT
  totalAmount: number;
  secret: string;
  virtualAccount: TossVirtualAccount;
  [key: string]: unknown;
}

export interface TossPaymentQueryResponse {
  paymentKey: string;
  orderId: string;
  status: string; // WAITING_FOR_DEPOSIT | DONE | CANCELED | PARTIAL_CANCELED | ABORTED | EXPIRED ...
  totalAmount: number;
  // 발급 응답에만 값이 있고, 이후 조회에서는 보안상 null 로 돌아온다. 웹훅 secret 대조는
  // 발급 시 charge 에 저장해 둔 값과 하며, 이 필드에 의존하지 않는다.
  secret: string | null;
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
    // 가상계좌 결제의 입금 후 환불은 환불받을 계좌가 필수 (토스가 그 계좌로 송금).
    refundReceiveAccount?: { bank: string; accountNumber: string; holderName: string },
  ): Promise<TossApiResult<TossCancelResponse>> {
    const body: Record<string, unknown> = { cancelReason };
    if (cancelAmount !== undefined) body.cancelAmount = cancelAmount;
    if (refundReceiveAccount) body.refundReceiveAccount = refundReceiveAccount;
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

  async issueVirtualAccount(params: {
    amount: number;
    orderId: string;
    orderName: string;
    customerName: string;
    bank: string;
    validHours?: number;
    customerEmail?: string;
    customerMobilePhone?: string;
  }): Promise<TossApiResult<TossVirtualAccountResponse>> {
    const body: Record<string, unknown> = {
      amount: params.amount,
      orderId: params.orderId,
      orderName: params.orderName,
      customerName: params.customerName,
      bank: params.bank,
    };
    if (params.validHours !== undefined) body.validHours = params.validHours;
    if (params.customerEmail) body.customerEmail = params.customerEmail;
    if (params.customerMobilePhone) body.customerMobilePhone = params.customerMobilePhone;
    return this.post<TossVirtualAccountResponse>('/virtual-accounts', body);
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

  /**
   * orderId(= 하이픈 뗀 chargeId)로 결제를 재조회한다. 웹훅 본문은 신뢰하지 않고 이 응답의
   * status/totalAmount/paymentKey 를 authoritative 로 쓴다. paymentKey 가 아니라 orderId 로
   * 조회하는 이유: 공격자가 본문 paymentKey 로 남의 결제를 우리 charge 에 갖다 붙이지 못하게 하기 위함.
   */
  async getPaymentByOrderId(orderId: string): Promise<TossApiResult<TossPaymentQueryResponse>> {
    return this.get<TossPaymentQueryResponse>(`/payments/orders/${encodeURIComponent(orderId)}`);
  }

  private async get<T>(path: string): Promise<TossApiResult<T>> {
    const url = `${this.baseUrl}${path}`;
    this.logger.debug(`GET ${url}`);

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${this.auth}` },
    });

    if (res.ok) {
      const data = (await res.json()) as T;
      return { ok: true, data };
    }

    const error = await res.json().catch(() => ({ code: 'UNKNOWN', message: 'Unknown error' }));
    this.logger.error(`Toss API error: ${res.status} ${this.stringifyError(error)}`);
    return { ok: false, error: this.normalizeError(error), statusCode: res.status };
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
