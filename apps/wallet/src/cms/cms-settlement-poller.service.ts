import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { WalletSchema, cmsWithdrawals } from '../schema';
import { CmsWithdrawal } from '../types';
import { CmsApiClient, CmsPaymentData } from './cms-api.client';
import { kstYesterdayYyyymmdd } from './cms-date.util';
import { ChargesService } from '../charges/charges.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { AutoCaptureService } from '../payment-intents/auto-capture.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
  subscriberExtraFromMetadata,
} from '../messaging/gateway-event.builder';
import { PaymentIntentsService } from '../payment-intents/payment-intents.service';

@Injectable()
export class CmsSettlementPollerService {
  private readonly logger = new Logger(CmsSettlementPollerService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly cmsApi: CmsApiClient,
    private readonly chargesService: ChargesService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly autoCaptureService: AutoCaptureService,
    private readonly paymentIntentsService: PaymentIntentsService,
  ) {}

  /**
   * PENDING_SETTLEMENT 상태의 Intent에 대응하는 CMS 출금건의 결과를 폴링한다.
   * 매 30분 실행. 은행 영업시간 외에는 실행해도 무해 (결과가 없을 뿐).
   */
  @Cron('0 */30 * * * *')
  async pollPendingSettlements(): Promise<void> {
    // paymentDate의 D+1 이상 경과한 건만 — 결과 확인 가능 시점
    const yesterday = kstYesterdayYyyymmdd();
    const pendingWithdrawals = await this.dbService.db
      .select()
      .from(cmsWithdrawals)
      .where(
        and(
          inArray(cmsWithdrawals.status, ['REQUESTED', 'PROCESSING']),
          lte(cmsWithdrawals.paymentDate, yesterday),
        ),
      );

    if (pendingWithdrawals.length === 0) return;

    this.logger.log(`Polling ${pendingWithdrawals.length} pending CMS withdrawal(s)`);

    for (const withdrawal of pendingWithdrawals) {
      try {
        await this.processWithdrawal(withdrawal);
      } catch (err) {
        this.logger.error(`Error polling CMS withdrawal ${withdrawal.transactionId}: ${err}`);
      }
    }
  }

  /**
   * 특정 cms_withdrawal UUID로 단건 폴링 (admin trigger).
   */
  async pollWithdrawalById(id: string): Promise<void> {
    const rows = await this.dbService.db
      .select()
      .from(cmsWithdrawals)
      .where(eq(cmsWithdrawals.id, id))
      .limit(1);
    const withdrawal = rows[0];
    if (!withdrawal) throw new Error('CMS withdrawal not found: ' + id);
    await this.processWithdrawal(withdrawal);
  }

  private async processWithdrawal(withdrawal: CmsWithdrawal): Promise<void> {
    const result = await this.cmsApi.getWithdrawal(withdrawal.transactionId);
    if (!result.ok) {
      this.logger.warn(
        `CMS withdrawal query failed for ${withdrawal.transactionId}: ${result.error.code} ${result.error.message}`,
      );
      return;
    }

    const paymentData = result.data.payment;
    const apiStatus = paymentData.status ?? '';

    if (apiStatus === '출금성공') {
      await this.handleWithdrawalSuccess(withdrawal, paymentData);
    } else if (apiStatus === '출금실패') {
      await this.handleWithdrawalFailure(withdrawal, paymentData);
    } else if (apiStatus === '출금중') {
      // 출금중 상태로 전환 (최초 REQUESTED에서 PROCESSING으로)
      if (withdrawal.status === 'REQUESTED') {
        await this.dbService.db
          .update(cmsWithdrawals)
          .set({ status: 'PROCESSING', updatedAt: new Date() })
          .where(eq(cmsWithdrawals.id, withdrawal.id));
      }
      // 다음 주기에 재조회
    }
    // 그 외(출금대기 등): 다음 주기에 재조회
  }

  private async handleWithdrawalSuccess(
    withdrawal: CmsWithdrawal,
    apiData: CmsPaymentData,
  ): Promise<void> {
    const correlationId = `cms-poller:${withdrawal.transactionId}`;
    const now = new Date().toISOString();

    const intent = await this.paymentIntentsService.findById(withdrawal.intentId);
    if (!intent) {
      this.logger.error(`Intent not found for withdrawal ${withdrawal.transactionId}: ${withdrawal.intentId}`);
      return;
    }

    // 가드: intent가 이미 종료상태(취소/실패)면 정산성공으로 charge/intent를 되살리지 않는다.
    // (취소는 성공했지만 효성 출금이 그 사이 집행돼버린 레이스) 출금은 실제로 빠졌으므로
    // withdrawal만 SUCCEEDED로 기록해 실태를 남기고, 수동 환불/정산 대상으로 둔다.
    if (intent.status === 'CANCELED' || intent.status === 'FAILED') {
      this.logger.error(
        `[CMS][RECONCILE] 정산성공이나 intent가 이미 ${intent.status} — 출금은 집행됨, 수동 환불/정산 필요: ` +
          `intentId=${withdrawal.intentId}, txId=${withdrawal.transactionId}`,
      );
      await this.dbService.db
        .update(cmsWithdrawals)
        .set({
          status: 'SUCCEEDED',
          resultCode: apiData.result?.code ?? null,
          resultMessage: apiData.result?.message ?? null,
          actualAmount: apiData.actualAmount ?? null,
          fee: apiData.fee ?? null,
          updatedAt: new Date(),
        })
        .where(eq(cmsWithdrawals.id, withdrawal.id));
      return;
    }

    const intentMeta = (intent.metadata as Record<string, unknown>) ?? {};

    // withdrawal·charge·intent 전이를 한 트랜잭션으로 묶어 부분커밋 분열(예: charge만 SUCCEEDED)을 막는다.
    await this.dbService.db.transaction(async (tx) => {
      // 1. cms_withdrawal → SUCCEEDED
      await tx
        .update(cmsWithdrawals)
        .set({
          status: 'SUCCEEDED',
          resultCode: apiData.result?.code ?? null,
          resultMessage: apiData.result?.message ?? null,
          actualAmount: apiData.actualAmount ?? null,
          fee: apiData.fee ?? null,
          updatedAt: new Date(),
        })
        .where(eq(cmsWithdrawals.id, withdrawal.id));

      // 2. charge → SUCCEEDED
      await this.chargesService.updateStatus(
        withdrawal.chargeId,
        'SUCCEEDED',
        { providerTransactionId: withdrawal.transactionId },
        tx,
      );

      // 3. intent → AUTHORIZED (expected PENDING_SETTLEMENT — 이미 취소됐으면 여기서 throw → 전체 롤백)
      await this.stateTransitionService.transitionIntent(
        withdrawal.intentId,
        'AUTHORIZED',
        {
          correlationId,
          reasonCode: 'CMS_SETTLEMENT_SUCCEEDED',
          reasonMessage: `CMS withdrawal ${withdrawal.transactionId} succeeded`,
          triggeredByType: 'SYSTEM',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_AUTHORIZED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: withdrawal.intentId,
            payload: buildPaymentIntentEventPayload({
              intentId: withdrawal.intentId,
              userId: intent.userId ?? '',
              status: 'AUTHORIZED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              occurredAt: now,
              extra: subscriberExtraFromMetadata(intentMeta),
            }),
          },
        },
        'PENDING_SETTLEMENT',
        tx,
      );
    });

    // 4. auto-capture 시도
    await this.autoCaptureService.attemptAutoCapture(withdrawal.intentId, correlationId);

    this.logger.log(`CMS withdrawal ${withdrawal.transactionId} succeeded → intent ${withdrawal.intentId} AUTHORIZED`);
  }

  private async handleWithdrawalFailure(
    withdrawal: CmsWithdrawal,
    apiData: CmsPaymentData,
  ): Promise<void> {
    const correlationId = `cms-poller:${withdrawal.transactionId}`;
    const now = new Date().toISOString();

    // 1. cms_withdrawal → FAILED
    await this.dbService.db
      .update(cmsWithdrawals)
      .set({
        status: 'FAILED',
        resultCode: apiData.result?.code ?? null,
        resultMessage: apiData.result?.message ?? null,
        updatedAt: new Date(),
      })
      .where(eq(cmsWithdrawals.id, withdrawal.id));

    // 2. charge → FAILED
    await this.chargesService.updateStatus(withdrawal.chargeId, 'FAILED', {
      errorCode: apiData.result?.code ?? 'CMS_WITHDRAWAL_FAILED',
      errorMessage: apiData.result?.message ?? 'CMS withdrawal failed',
    });

    const intent = await this.paymentIntentsService.findById(withdrawal.intentId);
    if (!intent) {
      this.logger.error(`Intent not found for withdrawal ${withdrawal.transactionId}: ${withdrawal.intentId}`);
      return;
    }

    const intentMeta = (intent.metadata as Record<string, unknown>) ?? {};

    await this.dbService.db.transaction(async (tx) => {
      await this.stateTransitionService.transitionIntent(
        withdrawal.intentId,
        'FAILED',
        {
          correlationId,
          reasonCode: 'CMS_SETTLEMENT_FAILED',
          reasonMessage: `CMS withdrawal ${withdrawal.transactionId} failed: ${apiData.result?.message ?? ''}`,
          triggeredByType: 'SYSTEM',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_FAILED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: withdrawal.intentId,
            payload: buildPaymentIntentEventPayload({
              intentId: withdrawal.intentId,
              userId: intent.userId ?? '',
              status: 'FAILED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              occurredAt: now,
              extra: {
                ...subscriberExtraFromMetadata(intentMeta),
                errorCode: apiData.result?.code,
                errorMessage: apiData.result?.message,
              },
            }),
          },
        },
        'PENDING_SETTLEMENT',
        tx,
      );
    });

    this.logger.warn(`CMS withdrawal ${withdrawal.transactionId} failed → intent ${withdrawal.intentId} FAILED`);
  }

}
