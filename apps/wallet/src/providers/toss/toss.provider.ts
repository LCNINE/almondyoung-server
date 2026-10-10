import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
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
import { TossApiClient } from './toss-api.client';
import { usesTossWidget, usesCustomBrandPay } from './toss-widget-mode';
import { and } from 'drizzle-orm';

@Injectable()
export class TossPaymentProvider implements PaymentProvider {
  readonly providerType = 'TOSS';
  readonly autoCapture = true;
  readonly actionMode = 'interactive' as const;

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly tossApi: TossApiClient,
  ) {}

  async getUserMethods(userId: string): Promise<PaymentMethod[]> {
    const widgetEnabled =
      process.env.TOSS_CHECKOUT_MODE !== 'CUSTOM' &&
      !!(process.env.TOSS_WIDGET_CLIENT_KEY && process.env.TOSS_WIDGET_SECRET_KEY);
    return this.dbService.db.transaction(async (tx) => {
      const db = tx as typeof this.dbService.db;
      const existing = await db
        .select()
        .from(paymentMethods)
        .where(
          and(eq(paymentMethods.userId, userId), eq(paymentMethods.type, 'TOSS'), eq(paymentMethods.isDeleted, false)),
        );

      if (existing.length > 0) {
        return widgetEnabled ? existing.map((method) => ({ ...method, displayName: '토스 결제' })) : existing;
      }

      return db
        .insert(paymentMethods)
        .values({
          userId,
          type: 'TOSS',
          displayName: widgetEnabled ? '토스 결제' : '카드결제',
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
    const meta = params.metadata ?? {};
    const widgetEnabled =
      process.env.TOSS_CHECKOUT_MODE !== 'CUSTOM' &&
      !!(process.env.TOSS_WIDGET_CLIENT_KEY && process.env.TOSS_WIDGET_SECRET_KEY);
    return {
      status: 'REQUIRES_ACTION',
      nextAction: {
        type: 'TOSS_CHECKOUT',
        orderId,
        orderName: (meta.orderName as string) ?? '결제',
        clientKey: process.env.TOSS_CLIENT_KEY ?? '',
        ...(widgetEnabled
          ? { checkoutMode: 'WIDGET' }
          : process.env.TOSS_CHECKOUT_MODE === 'CUSTOM'
            ? { checkoutMode: 'CUSTOM' }
            : {}),
        amount: params.amount,
        currency: params.currency,
        ...(meta.customerName ? { customerName: meta.customerName } : {}),
        ...(meta.customerEmail ? { customerEmail: meta.customerEmail } : {}),
        ...(meta.customerMobilePhone ? { customerMobilePhone: meta.customerMobilePhone } : {}),
      },
    };
  }

  async capture(_params: ChargeParams): Promise<ChargeResult> {
    return { status: 'SUCCEEDED' };
  }

  async cancel(params: ChargeParams): Promise<ChargeResult> {
    const payment = await this.getPayment(params.chargeId);
    if (!payment) {
      return { status: 'FAILED', errorCode: 'TOSS_PAYMENT_KEY_NOT_FOUND' };
    }

    const result = await this.tossApi.cancelPayment(
      payment.paymentKey,
      '고객 요청',
      params.amount,
      params.idempotencyKey,
      undefined,
      payment.useWidgetKey,
      payment.useBrandPayKey,
    );
    if (result.ok) return { status: 'SUCCEEDED' };
    return { status: 'FAILED', errorCode: result.error.code, errorMessage: result.error.message };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const payment = await this.getPayment(params.chargeId);
    if (!payment) {
      return { status: 'FAILED', errorCode: 'TOSS_PAYMENT_KEY_NOT_FOUND' };
    }

    const result = await this.tossApi.cancelPayment(
      payment.paymentKey,
      params.reasonCode ?? '고객 요청',
      params.amount,
      params.idempotencyKey,
      undefined,
      payment.useWidgetKey,
      payment.useBrandPayKey,
    );
    if (result.ok) {
      return { status: 'SUCCEEDED', providerRefundId: payment.paymentKey };
    }
    return { status: 'FAILED', errorCode: result.error.code, errorMessage: result.error.message };
  }

  private async getPayment(
    chargeId: string,
  ): Promise<{ paymentKey: string; useWidgetKey: boolean; useBrandPayKey: boolean } | null> {
    const rows = await this.dbService.db
      .select({ providerTransactionId: charges.providerTransactionId, responsePayload: charges.responsePayload })
      .from(charges)
      .where(eq(charges.id, chargeId))
      .limit(1);
    const charge = rows[0];
    if (!charge?.providerTransactionId) return null;
    return {
      paymentKey: charge.providerTransactionId,
      useWidgetKey: usesTossWidget(charge.responsePayload),
      useBrandPayKey: usesCustomBrandPay(charge.responsePayload),
    };
  }
}
