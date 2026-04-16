import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { NicepayAuthService } from './nicepay-auth.service';

export interface NicepayBillingKeyResponse {
  resultCode: string;
  resultMsg: string;
  tid: string;
  orderId: string;
  bid: string;
  authDate: string;
  cardCode: string;
  cardName: string;
}

export interface NicepayBillingConfirmResponse {
  resultCode: string;
  resultMsg: string;
  tid: string;
  orderId: string;
  status: string;
  amount: number;
  goodsName: string;
  card: {
    cardCode: string;
    cardName: string;
    cardNum: string | null;
    cardQuota: string;
    cardType: string;
    canPartCancel: boolean;
    acquCardCode: string;
    acquCardName: string;
  } | null;
  [key: string]: unknown;
}

export interface NicepayBillingExpireResponse {
  resultCode: string;
  resultMsg: string;
  tid: string;
  orderId: string;
  bid: string;
}

export type NicepayBillingApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; resultCode: string; resultMsg: string; statusCode: number };

export interface IssueBillingKeyOptions {
  encMode?: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerTel?: string;
}

@Injectable()
export class NicepayBillingApiClient {
  private readonly logger = new Logger(NicepayBillingApiClient.name);

  constructor(private readonly nicepayAuth: NicepayAuthService) {}

  async issueBillingKey(
    encData: string,
    orderId: string,
    options: IssueBillingKeyOptions = {},
  ): Promise<NicepayBillingApiResult<NicepayBillingKeyResponse>> {
    const secretKey = process.env.NICEPAY_SECRET_KEY ?? '';
    const ediDate = new Date().toISOString();
    const signData = createHash('sha256')
      .update(`${orderId}${ediDate}${secretKey}`)
      .digest('hex');

    const body: Record<string, unknown> = { encData, orderId, ediDate, signData };
    if (options.encMode) body.encMode = options.encMode;
    if (options.buyerName) body.buyerName = options.buyerName;
    if (options.buyerEmail) body.buyerEmail = options.buyerEmail;
    if (options.buyerTel) body.buyerTel = options.buyerTel;

    return this.post<NicepayBillingKeyResponse>('/v1/subscribe/regist', body);
  }

  async confirmBilling(
    bid: string,
    params: {
      orderId: string;
      amount: number;
      goodsName: string;
      cardQuota?: number;
      useShopInterest?: boolean;
      buyerName?: string;
      buyerTel?: string;
      buyerEmail?: string;
    },
  ): Promise<NicepayBillingApiResult<NicepayBillingConfirmResponse>> {
    const body: Record<string, unknown> = {
      orderId: params.orderId,
      amount: params.amount,
      goodsName: params.goodsName,
      cardQuota: params.cardQuota ?? 0,
      useShopInterest: params.useShopInterest ?? false,
    };
    if (params.buyerName) body.buyerName = params.buyerName;
    if (params.buyerTel) body.buyerTel = params.buyerTel;
    if (params.buyerEmail) body.buyerEmail = params.buyerEmail;

    return this.post<NicepayBillingConfirmResponse>(`/v1/subscribe/${bid}/payments`, body);
  }

  async expireBillingKey(bid: string, orderId: string): Promise<NicepayBillingApiResult<NicepayBillingExpireResponse>> {
    const secretKey = process.env.NICEPAY_SECRET_KEY ?? '';
    const ediDate = new Date().toISOString();
    const signData = createHash('sha256')
      .update(`${orderId}${bid}${ediDate}${secretKey}`)
      .digest('hex');

    return this.post<NicepayBillingExpireResponse>(`/v1/subscribe/${bid}/expire`, { orderId, ediDate, signData });
  }

  async cancelPayment(
    tid: string,
    orderId: string,
    amount?: number,
  ): Promise<NicepayBillingApiResult<Record<string, unknown>>> {
    const body: Record<string, unknown> = { reason: '정기결제 취소', orderId };
    if (amount !== undefined) body.cancelAmt = amount;
    return this.post<Record<string, unknown>>(`/v1/payments/${tid}/cancel`, body);
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<NicepayBillingApiResult<T>> {
    const url = `${this.nicepayAuth.getApiBase()}${path}`;
    this.logger.debug(`POST ${url}`);

    const authorization = await this.nicepayAuth.getAuthHeader();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    this.logger.debug(`NicePay billing response: status=${res.status} resultCode=${data['resultCode']}`);

    if (res.ok && data['resultCode'] === '0000') {
      return { ok: true, data: data as T };
    }

    if (!res.ok) {
      this.logger.error(`NicePay billing API error: ${res.status} ${JSON.stringify(data)}`);
    }

    return {
      ok: false,
      resultCode: (data['resultCode'] as string | undefined) ?? 'UNKNOWN',
      resultMsg: (data['resultMsg'] as string | undefined) ?? 'Unknown error',
      statusCode: res.status,
    };
  }
}
