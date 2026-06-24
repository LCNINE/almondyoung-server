import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
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
import { WalletSchema, paymentMethods } from '../../schema';
import { and, eq } from 'drizzle-orm';
import { PointsLedgerService, PointsOperationResult } from './points-ledger.service';

@Injectable()
export class PointsPaymentProvider implements PaymentProvider {
  readonly providerType = 'POINTS';
  readonly autoCapture = true;
  readonly actionMode = 'interactive' as const;

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly pointsLedgerService: PointsLedgerService,
  ) {}

  async getUserMethods(userId: string): Promise<PaymentMethod[]> {
    return this.dbService.db.transaction(async (tx) => {
      const db = tx as typeof this.dbService.db;
      const existing = await db
        .select()
        .from(paymentMethods)
        .where(
          and(
            eq(paymentMethods.userId, userId),
            eq(paymentMethods.type, 'POINTS'),
            eq(paymentMethods.isDeleted, false),
          ),
        );

      if (existing.length > 0) return existing;

      return db
        .insert(paymentMethods)
        .values({
          userId,
          type: 'POINTS',
          displayName: null,
          isReusable: true,
          isDeleted: false,
          providerData: {},
        })
        .returning();
    });
  }

  async validateMethod(_params: ValidateMethodParams): Promise<void> {
    // POINTS payment method is always valid - the balance is checked at authorize time
  }

  async deleteMethod(_params: DeleteMethodParams): Promise<void> {
    // POINTS cannot be deleted - they always exist as long as the customer exists
    throw new BadRequestException({
      error: 'POINTS_METHOD_NOT_DELETABLE',
      message: 'Points payment method cannot be deleted',
    });
  }

  async authorize(params: ChargeParams): Promise<ChargeResult> {
    if (params.currency.toUpperCase() !== 'KRW') {
      return {
        status: 'FAILED',
        errorCode: 'POINTS_CURRENCY_NOT_SUPPORTED',
        errorMessage: `POINTS provider supports KRW only: ${params.currency}`,
      };
    }

    const result = await this.dbService.db.transaction((tx) =>
      this.pointsLedgerService.authorize(tx, {
        intentId: params.intentId,
        legId: params.chargeId,
        attemptId: params.chargeId,
        amount: params.amount,
        currency: params.currency,
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
        correlationId: params.correlationId,
        metadata: params.metadata,
      }),
    );

    return this.mapAuthorizeResult(result);
  }

  async capture(params: ChargeParams): Promise<ChargeResult> {
    const result = await this.dbService.db.transaction((tx) =>
      this.pointsLedgerService.capture(tx, {
        intentId: params.intentId,
        legId: params.chargeId,
        attemptId: params.chargeId,
        amount: params.amount,
        currency: params.currency,
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
        correlationId: params.correlationId,
        metadata: params.metadata,
      }),
    );

    return this.mapCaptureResult(result);
  }

  async cancel(params: ChargeParams): Promise<ChargeResult> {
    const result = await this.dbService.db.transaction((tx) =>
      this.pointsLedgerService.cancel(tx, {
        intentId: params.intentId,
        legId: params.chargeId,
        attemptId: params.chargeId,
        amount: params.amount,
        currency: params.currency,
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
        correlationId: params.correlationId,
        metadata: params.metadata,
      }),
    );

    return this.mapCancelResult(result);
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const result = await this.dbService.db.transaction((tx) =>
      this.pointsLedgerService.refund(tx, {
        intentId: params.intentId,
        legId: params.chargeId,
        attemptId: params.refundId,
        amount: params.amount,
        currency: params.currency,
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
        correlationId: params.correlationId,
        metadata: params.metadata,
      }),
    );

    if (result.resultStatus === 'REFUNDED') {
      return {
        status: 'SUCCEEDED',
        providerRefundId: result.providerTransactionId,
        raw: result.raw,
      };
    }

    const raw = result.raw ?? {};
    return {
      status: 'FAILED',
      errorCode: String(raw['reasonCode'] ?? 'POINTS_REFUND_FAILED'),
      errorMessage: String(raw['reasonCode'] ?? 'Points refund failed'),
      raw: result.raw,
    };
  }

  private mapAuthorizeResult(result: PointsOperationResult): ChargeResult {
    if (result.resultStatus === 'AUTHORIZED') {
      return {
        status: 'SUCCEEDED',
        providerTransactionId: result.providerTransactionId,
        raw: result.raw,
      };
    }

    const raw = result.raw ?? {};
    return {
      status: 'FAILED',
      errorCode: String(raw['reasonCode'] ?? 'POINTS_AUTHORIZE_FAILED'),
      errorMessage: String(raw['reasonCode'] ?? 'Points authorization failed'),
      raw: result.raw,
    };
  }

  private mapCaptureResult(result: PointsOperationResult): ChargeResult {
    if (result.resultStatus === 'CAPTURED') {
      return {
        status: 'SUCCEEDED',
        providerTransactionId: result.providerTransactionId,
        raw: result.raw,
      };
    }

    const raw = result.raw ?? {};
    return {
      status: 'FAILED',
      errorCode: String(raw['reasonCode'] ?? 'POINTS_CAPTURE_FAILED'),
      errorMessage: String(raw['reasonCode'] ?? 'Points capture failed'),
      raw: result.raw,
    };
  }

  private mapCancelResult(result: PointsOperationResult): ChargeResult {
    if (result.resultStatus === 'CANCELLED') {
      return {
        status: 'SUCCEEDED',
        providerTransactionId: result.providerTransactionId,
        raw: result.raw,
      };
    }

    const raw = result.raw ?? {};
    return {
      status: 'FAILED',
      errorCode: String(raw['reasonCode'] ?? 'POINTS_CANCEL_FAILED'),
      errorMessage: String(raw['reasonCode'] ?? 'Points cancellation failed'),
      raw: result.raw,
    };
  }
}
