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
import { StagedApproval, isDeferredApprovalIntent } from './deferred-approval';

/**
 * 적재된 승인이 확정되기를 기다리는 시간. Medusa 가 cart.complete 로 주문을 만들고 승인을
 * 트리거하기까지의 정상 소요는 수 초이므로 넉넉하다. 지나면 TossActionExpirationJob 이
 * charge 를 회수하고 PG 미승인 결제는 자동 만료된다(= 돈이 빠지지 않는 방향).
 */
const DEFAULT_STAGED_APPROVAL_TTL_MINUTES = 10;

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

    // 2. 지연 승인 모드(Medusa 체크아웃): 여기서 승인하지 않고 파라미터만 적재한다.
    //    실제 승인은 주문 생성 + 재고예약이 끝난 뒤 Medusa 가 finalize-approval 로 트리거한다.
    const intent = await this.loadIntent(intentId);
    if (isDeferredApprovalIntent(intent.metadata)) {
      await this.stageApproval(charge, paymentKey, orderId, amount);
      this.logger.log(`approve staged (deferred approval): intentId=${intentId} chargeId=${charge.id}`);
      return;
    }

    // 3. Call Toss API confirm
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

  /**
   * 결제창 완료 파라미터를 charge 에 적재만 하고 승인 API 는 호출하지 않는다.
   *
   * charge 는 REQUIRES_ACTION 그대로 두어 intent 도 REQUIRES_ACTION 에 머문다
   * (almond-payment 가 'pending' 으로 매핑 → completeCartWorkflow 가 정상 진행).
   * providerTransactionId 는 승인 전이므로 비워 둔다 — 미승인 paymentKey 로 취소/환불이
   * 시도되지 않게 하기 위함이다.
   */
  private async stageApproval(charge: Charge, paymentKey: string, orderId: string, amount: number): Promise<void> {
    if (charge.amount !== amount) {
      throw new UnprocessableEntityException({
        error: 'TOSS_AMOUNT_MISMATCH',
        message: `Expected amount ${charge.amount}, received ${amount}`,
      });
    }

    const expectedOrderId = charge.id.replace(/-/g, '');
    if (orderId !== expectedOrderId) {
      throw new UnprocessableEntityException({
        error: 'TOSS_ORDER_ID_MISMATCH',
        message: 'orderId does not match the charge',
      });
    }

    const staged: StagedApproval = {
      provider: 'TOSS',
      providerToken: paymentKey,
      orderId,
      amount,
      stagedAt: new Date().toISOString(),
    };

    await this.chargesService.updateStatus(charge.id, 'REQUIRES_ACTION', {
      responsePayload: { ...(charge.responsePayload ?? {}), stagedApproval: staged },
    });

    // 확정 대기 창을 다시 연다. 고객이 결제창에서 오래 머물러 원래 actionExpiresAt 이 임박했더라도
    // 주문 생성까지의 몇 초를 확보하기 위함.
    await this.dbService.db
      .update(paymentIntents)
      .set({ actionExpiresAt: new Date(Date.now() + this.stagedApprovalTtlMs()) })
      .where(eq(paymentIntents.id, charge.intentId));
  }

  private stagedApprovalTtlMs(): number {
    const raw = Number(process.env.WALLET_STAGED_APPROVAL_TTL_MINUTES);
    const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STAGED_APPROVAL_TTL_MINUTES;
    return minutes * 60_000;
  }

  /**
   * 적재된 승인을 실제 PG 승인으로 확정한다 (주문 생성 성공 후 Medusa 가 트리거).
   * 승인 실패는 charge/intent 를 실패 처리하고 throw 해, 호출자인 Medusa 워크플로가
   * 주문·재고예약을 롤백하게 한다.
   */
  async confirmStaged(charge: Charge, staged: StagedApproval, correlationId: string): Promise<void> {
    const result = await this.tossApi.confirmPayment(staged.providerToken, staged.amount, staged.orderId);
    this.logger.log(`staged approval confirm: intentId=${charge.intentId} ok=${result.ok}`);

    if (!result.ok) {
      this.logger.error(`Toss API confirm failed (staged): ${JSON.stringify(result.error)}`);
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
