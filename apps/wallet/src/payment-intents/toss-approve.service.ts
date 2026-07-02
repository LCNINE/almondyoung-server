import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { Charge, PaymentIntent } from '../types';
import { ChargesService } from '../charges/charges.service';
import { AutoCaptureService } from './auto-capture.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import { TossApiClient } from '../providers/toss/toss-api.client';
import { CashReceiptsService } from '../cash-receipts/cash-receipts.service';

@Injectable()
export class TossApproveService {
  private readonly logger = new Logger(TossApproveService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly autoCaptureService: AutoCaptureService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly tossApi: TossApiClient,
    private readonly cashReceiptsService: CashReceiptsService,
  ) {}

  async approve(
    intentId: string,
    paymentKey: string,
    orderId: string,
    amount: number,
    correlationId: string,
  ): Promise<void> {
    this.logger.log(`approve called: intentId=${intentId} orderId=${orderId} amount=${amount}`);

    // 1. Find the REQUIRES_ACTION AUTHORIZE charge
    const charge = await this.chargesService.findActiveByIntentAndOperation(intentId, 'AUTHORIZE');
    this.logger.log(`charge found: ${JSON.stringify({ id: charge?.id, status: charge?.status })}`);
    if (!charge || charge.status !== 'REQUIRES_ACTION') {
      throw new UnprocessableEntityException({
        error: 'NO_REQUIRES_ACTION_CHARGE',
        message: 'No pending Toss action found for this intent',
      });
    }

    // 2. Call Toss API confirm
    const result = await this.tossApi.confirmPayment(paymentKey, amount, orderId);
    this.logger.log(`Toss API confirm response: ok=${result.ok}`);

    if (!result.ok) {
      this.logger.error(`Toss API confirm failed: ${JSON.stringify(result.error)}`);
      await this.finalizeFailure(charge, result.error.code ?? 'TOSS_CONFIRM_FAILED', correlationId);
      throw new UnprocessableEntityException({
        error: result.error.code ?? 'TOSS_CONFIRM_FAILED',
        message: result.error.message,
      });
    }

    await this.finalizeApproval(charge, result.data.paymentKey, correlationId);
  }

  async finalizeApproval(charge: Charge, paymentKey: string, correlationId: string): Promise<void> {
    const intent = await this.loadIntent(charge.intentId);
    const now = new Date().toISOString();

    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(charge.id, 'SUCCEEDED', { providerTransactionId: paymentKey }, tx);

      await this.stateTransitionService.transitionIntent(
        intent.id,
        'AUTHORIZED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_SUCCEEDED',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_AUTHORIZED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              userId: intent.userId ?? '',
              status: 'AUTHORIZED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              occurredAt: now,
              extra: { medusa_session_id: intent.metadata?.medusa_session_id },
            }),
          },
        },
        undefined,
        tx,
      );
    });

    await this.autoCaptureService.attemptAutoCapture(charge.intentId, correlationId);

    // 무통장(토스 가상계좌) 입금이 웹훅으로 자동확인된 경우, confirm 단계에서 고객이 신청한
    // 현금영수증을 여기서 발급한다
    // 발급 실패가 결제확정을 되돌리지 않는다.
    const cashReceipt = intent.metadata?.cashReceipt as
      | { type: '소득공제' | '지출증빙'; customerIdentityNumber: string }
      | undefined;
    if (cashReceipt && intent.userId) {
      try {
        await this.cashReceiptsService.issue({ intentId: intent.id, ...cashReceipt }, intent.userId);
        this.logger.log(`cash receipt issued on webhook capture: intentId=${intent.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`cash receipt auto-issue failed (webhook capture): intentId=${intent.id}, error=${message}`);
      }
    }
  }

  async finalizeFailure(charge: Charge, errorCode: string, correlationId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(
        charge.id,
        'FAILED',
        {
          errorCode,
          errorMessage: `Payment ${errorCode.toLowerCase()} on Toss side`,
        },
        tx,
      );

      await this.stateTransitionService.transitionIntent(
        charge.intentId,
        'CREATED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_FAILED',
          reasonMessage: errorCode,
        },
        undefined,
        tx,
      );
    });
  }

  private async loadIntent(intentId: string): Promise<PaymentIntent> {
    const intent = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1)
      .then((r) => r[0]);

    if (!intent) {
      throw new NotFoundException({ error: 'INTENT_NOT_FOUND' });
    }

    return intent;
  }
}
