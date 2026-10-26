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
import { hasConfirmAttempt, usesTossWidget } from './toss-widget-mode';
import { and } from 'drizzle-orm';
import { isTossRefundRetryable } from './toss-refund-errors';

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
    const widgetEnabled = !!(process.env.TOSS_WIDGET_CLIENT_KEY && process.env.TOSS_WIDGET_SECRET_KEY);
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
    // 결제창이 기존 방식을 열었으면(리전이 무통장을 막은 경우) 승인도 기존 키로 — checkoutMode 를 남기지 않는다
    const widgetEnabled =
      !!(process.env.TOSS_WIDGET_CLIENT_KEY && process.env.TOSS_WIDGET_SECRET_KEY) &&
      meta.tossCheckoutMode !== 'LEGACY';
    return {
      status: 'REQUIRES_ACTION',
      nextAction: {
        type: 'TOSS_CHECKOUT',
        orderId,
        orderName: (meta.orderName as string) ?? '결제',
        clientKey: process.env.TOSS_CLIENT_KEY ?? '',
        ...(widgetEnabled ? { checkoutMode: 'WIDGET' } : {}),
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
    const unconfirmed = await this.loadUnconfirmed(params.chargeId);
    if (unconfirmed) return this.settleUnconfirmed(params.chargeId, unconfirmed.useWidgetKey, params.idempotencyKey);

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
    );
    if (result.ok) return { status: 'SUCCEEDED' };
    return { status: 'FAILED', errorCode: result.error.code, errorMessage: result.error.message };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    // CAPTURE charge 엔 위젯 여부(nextAction.checkoutMode)가 없다 — AUTHORIZE charge 에서 읽어야 위젯 키로 환불된다.
    const payment = await this.getPayment(params.authorizeChargeId ?? params.chargeId);
    if (!payment) {
      return { status: 'FAILED', errorCode: 'TOSS_PAYMENT_KEY_NOT_FOUND', retryable: false };
    }

    const result = await this.tossApi.cancelPayment(
      payment.paymentKey,
      params.cancelReason ?? '고객 요청',
      params.amount,
      params.idempotencyKey,
      undefined,
      payment.useWidgetKey,
    );
    if (result.ok) {
      return { status: 'SUCCEEDED', providerRefundId: payment.paymentKey };
    }
    return {
      status: 'FAILED',
      errorCode: result.error.code,
      errorMessage: result.error.message,
      retryable: isTossRefundRetryable(result.error.code),
    };
  }

  /** 승인 시도 표식만 있고 확정된 결제 키가 없는 charge — 승인 응답을 잃었을 수 있다. */
  private async loadUnconfirmed(chargeId: string): Promise<{ useWidgetKey: boolean } | null> {
    const rows = await this.dbService.db
      .select({ providerTransactionId: charges.providerTransactionId, responsePayload: charges.responsePayload })
      .from(charges)
      .where(eq(charges.id, chargeId))
      .limit(1);
    const charge = rows[0];
    if (!charge || charge.providerTransactionId || !hasConfirmAttempt(charge.responsePayload)) return null;
    return { useWidgetKey: usesTossWidget(charge.responsePayload) };
  }

  /**
   * 토스에 실제 상태를 물어 정리한다. 돈이 빠졌거나 계좌가 열려 있으면 취소하고, 결제가 없거나 이미 끝났으면
   * 닫을 게 없다. 조회·취소가 실패하면 FAILED — 호출자(abandon·만료)가 intent 를 넘기지 않고 다음 주기에 다시 온다.
   */
  private async settleUnconfirmed(
    chargeId: string,
    useWidgetKey: boolean,
    idempotencyKey: string,
  ): Promise<ChargeResult> {
    const query = await this.tossApi.getPaymentByOrderId(chargeId.replace(/-/g, ''), useWidgetKey).catch(() => null);
    if (!query) return { status: 'FAILED', errorCode: 'TOSS_STATUS_UNKNOWN' };
    if (!query.ok) {
      return query.statusCode === 404
        ? { status: 'SUCCEEDED' }
        : { status: 'FAILED', errorCode: query.error.code ?? 'TOSS_STATUS_UNKNOWN', errorMessage: query.error.message };
    }
    // IN_PROGRESS 는 끝난 게 아니라 승인 대기다 — 지금 정리 완료로 넘기면 뒤늦게 성공한 승인이 원장 밖에 남는다.
    if (query.data.status === 'IN_PROGRESS') return { status: 'FAILED', errorCode: 'TOSS_CONFIRM_IN_PROGRESS' };
    if (!['DONE', 'WAITING_FOR_DEPOSIT', 'PARTIAL_CANCELED'].includes(query.data.status))
      return { status: 'SUCCEEDED' };

    // 만료 크론은 같은 idempotencyKey 로 매 주기 다시 온다. 토스는 실패 응답도 재생하므로 상태를 본 뒤 새 키로 취소한다.
    const canceled = await this.tossApi
      .cancelPayment(
        query.data.paymentKey,
        '결제 취소',
        undefined,
        `cancel:${idempotencyKey}:${Date.now()}`,
        undefined,
        useWidgetKey,
      )
      .catch(() => null);
    if (canceled?.ok || canceled?.error.code === 'ALREADY_CANCELED_PAYMENT') return { status: 'SUCCEEDED' };
    return {
      status: 'FAILED',
      errorCode: canceled?.error.code ?? 'TOSS_CANCEL_UNKNOWN',
      errorMessage: canceled?.error.message,
    };
  }

  private async getPayment(chargeId: string): Promise<{ paymentKey: string; useWidgetKey: boolean } | null> {
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
    };
  }
}
