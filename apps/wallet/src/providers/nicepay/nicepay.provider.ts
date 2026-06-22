import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import {
  ChargeParams,
  ChargeResult,
  DeleteMethodParams,
  PaymentMethod,
  PaymentProvider,
  RefundParams,
  RefundResult,
  ValidateMethodParams,
} from '../payment-provider.interface';
import { WalletSchema, charges, paymentMethods } from '../../schema';
import { NicepayAuthService } from './nicepay-auth.service';

@Injectable()
export class NicepayPaymentProvider implements PaymentProvider {
  readonly providerType = 'NICEPAY';
  readonly autoCapture = true;
  readonly actionMode = 'interactive' as const;

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly nicepayAuth: NicepayAuthService,
  ) {}

  async getUserMethods(userId: string): Promise<PaymentMethod[]> {
    return this.dbService.db.transaction(async (tx) => {
      const db = tx as typeof this.dbService.db;
      const existing = await db
        .select()
        .from(paymentMethods)
        .where(
          and(eq(paymentMethods.userId, userId), eq(paymentMethods.type, 'NICEPAY'), eq(paymentMethods.isDeleted, false)),
        );

      if (existing.length > 0) return existing;

      return db
        .insert(paymentMethods)
        .values({
          userId,
          type: 'NICEPAY',
          displayName: '카드결제(나이스페이)',
          isReusable: true,
          isDeleted: false,
          providerData: {},
        })
        .returning();
    });
  }

  async validateMethod(_params: ValidateMethodParams): Promise<void> {}

  async deleteMethod(_params: DeleteMethodParams): Promise<void> {
    throw new BadRequestException({
      error: 'NICEPAY_METHOD_NOT_DELETABLE',
      message: 'NicePay payment method cannot be deleted',
    });
  }

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    if (params.currency.toUpperCase() !== 'KRW') {
      return {
        status: 'FAILED',
        errorCode: 'NICEPAY_CURRENCY_NOT_SUPPORTED',
        errorMessage: `NicePay provider supports KRW only: ${params.currency}`,
      };
    }

    const orderId = params.chargeId.replace(/-/g, '');
    const meta = params.metadata ?? {};
    return {
      status: 'REQUIRES_ACTION',
      nextAction: {
        type: 'NICEPAY_CHECKOUT',
        orderId,
        goodsName: (meta.orderName as string) ?? '결제',
        clientKey: process.env.NICEPAY_CLIENT_KEY ?? '',
        amount: params.amount,
        currency: params.currency,
        ...(meta.customerName ? { buyerName: meta.customerName } : {}),
        ...(meta.customerEmail ? { buyerEmail: meta.customerEmail } : {}),
      },
    };
  }

  async capture(_params: ChargeParams): Promise<ChargeResult> {
    // 나이스페이는 서버승인 시점에 capture까지 완료됨
    return { status: 'SUCCEEDED' };
  }

  async cancel(params: ChargeParams): Promise<ChargeResult> {
    const rows = await this.dbService.db
      .select({ providerTransactionId: charges.providerTransactionId })
      .from(charges)
      .where(eq(charges.id, params.chargeId))
      .limit(1);

    const tid = rows[0]?.providerTransactionId;
    if (!tid) {
      return { status: 'FAILED', errorCode: 'NICEPAY_TID_NOT_FOUND' };
    }

    const orderId = params.chargeId.replace(/-/g, '');
    const authorization = await this.nicepayAuth.getAuthHeader();
    const apiBase = (process.env.NICEPAY_CLIENT_KEY ?? '').startsWith('S2_')
      ? 'https://sandbox-api.nicepay.co.kr'
      : 'https://api.nicepay.co.kr';
    const res = await fetch(`${apiBase}/v1/payments/${tid}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: '고객 요청',
        orderId,
        cancelAmt: params.amount,
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.resultCode === '0000') return { status: 'SUCCEEDED' };
      return { status: 'FAILED', errorCode: data.resultCode, errorMessage: data.resultMsg };
    }

    const err = await res.json().catch(() => ({}));
    return { status: 'FAILED', errorCode: err.resultCode, errorMessage: err.resultMsg };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const rows = await this.dbService.db
      .select({ providerTransactionId: charges.providerTransactionId })
      .from(charges)
      .where(eq(charges.id, params.chargeId))
      .limit(1);

    const tid = rows[0]?.providerTransactionId;
    if (!tid) {
      return { status: 'FAILED', errorCode: 'NICEPAY_TID_NOT_FOUND' };
    }

    const orderId = params.chargeId.replace(/-/g, '');
    const authorization = await this.nicepayAuth.getAuthHeader();
    const apiBase2 = (process.env.NICEPAY_CLIENT_KEY ?? '').startsWith('S2_')
      ? 'https://sandbox-api.nicepay.co.kr'
      : 'https://api.nicepay.co.kr';
    const res = await fetch(`${apiBase2}/v1/payments/${tid}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: params.reasonCode ?? '고객 요청',
        orderId,
        cancelAmt: params.amount,
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.resultCode === '0000') return { status: 'SUCCEEDED', providerRefundId: tid };
      return { status: 'FAILED', errorCode: data.resultCode, errorMessage: data.resultMsg };
    }

    const err = await res.json().catch(() => ({}));
    return { status: 'FAILED', errorCode: err.resultCode, errorMessage: err.resultMsg };
  }
}
