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

@Injectable()
export class TossPaymentProvider implements PaymentProvider {
  readonly providerType = 'TOSS';

  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async getUserMethods(userId: string): Promise<PaymentMethod[]> {
    return this.dbService.db.transaction(async (tx) => {
      const db = tx as typeof this.dbService.db;
      const existing = await db
        .select()
        .from(paymentMethods)
        .where(
          and(
            eq(paymentMethods.userId, userId),
            eq(paymentMethods.type, 'TOSS'),
            eq(paymentMethods.isDeleted, false),
          ),
        );

      if (existing.length > 0) return existing;

      return db
        .insert(paymentMethods)
        .values({
          userId,
          type: 'TOSS',
          displayName: '카드결제',
          isReusable: true,
          isDeleted: false,
          providerData: {},
        })
        .returning();
    });
  }

  async validateMethod(_params: ValidateMethodParams): Promise<void> {
    // TOSS payment method is always valid
  }

  async deleteMethod(_params: DeleteMethodParams): Promise<void> {
    throw new BadRequestException({
      error: 'TOSS_METHOD_NOT_DELETABLE',
      message: 'Toss payment method cannot be deleted',
    });
  }

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    if (params.currency.toUpperCase() !== 'KRW') {
      return {
        status: 'FAILED',
        errorCode: 'TOSS_CURRENCY_NOT_SUPPORTED',
        errorMessage: `TOSS provider supports KRW only: ${params.currency}`,
      };
    }

    const orderId = params.chargeId.replace(/-/g, '');
    return {
      status: 'REQUIRES_ACTION',
      nextAction: {
        type: 'TOSS_CHECKOUT',
        orderId,
        orderName: (params.metadata?.orderName as string) ?? '결제',
        clientKey: process.env.TOSS_CLIENT_KEY ?? '',
        amount: params.amount,
        currency: params.currency,
      },
    };
  }

  async capture(_params: ChargeParams): Promise<ChargeResult> {
    return { status: 'SUCCEEDED' };
  }

  async cancel(params: ChargeParams): Promise<ChargeResult> {
    const rows = await this.dbService.db
      .select({ providerTransactionId: charges.providerTransactionId })
      .from(charges)
      .where(eq(charges.id, params.chargeId))
      .limit(1);

    const paymentKey = rows[0]?.providerTransactionId;
    if (!paymentKey) {
      return { status: 'FAILED', errorCode: 'TOSS_PAYMENT_KEY_NOT_FOUND' };
    }

    const secretKey = process.env.TOSS_SECRET_KEY ?? '';
    const auth = Buffer.from(`${secretKey}:`).toString('base64');
    const res = await fetch(
      `https://api.tosspayments.com/v1/payments/${paymentKey}/cancels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cancelReason: '고객 요청', cancelAmount: params.amount }),
      },
    );

    if (res.ok) return { status: 'SUCCEEDED' };
    const err = await res.json().catch(() => ({}));
    return {
      status: 'FAILED',
      errorCode: (err as any).code,
      errorMessage: (err as any).message,
    };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const rows = await this.dbService.db
      .select({ providerTransactionId: charges.providerTransactionId })
      .from(charges)
      .where(eq(charges.id, params.chargeId))
      .limit(1);

    const paymentKey = rows[0]?.providerTransactionId;
    if (!paymentKey) {
      return { status: 'FAILED', errorCode: 'TOSS_PAYMENT_KEY_NOT_FOUND' };
    }

    const secretKey = process.env.TOSS_SECRET_KEY ?? '';
    const auth = Buffer.from(`${secretKey}:`).toString('base64');
    const res = await fetch(
      `https://api.tosspayments.com/v1/payments/${paymentKey}/cancels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cancelReason: params.reasonCode ?? '고객 요청',
          cancelAmount: params.amount,
        }),
      },
    );

    if (res.ok) {
      return { status: 'SUCCEEDED', providerRefundId: paymentKey };
    }

    const err = await res.json().catch(() => ({}));
    return {
      status: 'FAILED',
      errorCode: err.code,
      errorMessage: err.message,
    };
  }
}
