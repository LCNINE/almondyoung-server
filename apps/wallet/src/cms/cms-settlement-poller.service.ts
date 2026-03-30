import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { WalletSchema, cmsWithdrawals } from '../schema';
import { CmsWithdrawal } from '../types';
import { CmsApiClient } from './cms-api.client';
import { ChargesService } from '../charges/charges.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { AutoCaptureService } from '../payment-intents/auto-capture.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
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
    const yesterday = this.getYesterdayDate();
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

  private async processWithdrawal(withdrawal: CmsWithdrawal): Promise<void> {
    const result = await this.cmsApi.getWithdrawal(withdrawal.transactionId);
    if (!result.ok) {
      this.logger.warn(
        `CMS withdrawal query failed for ${withdrawal.transactionId}: ${result.error.code} ${result.error.message}`,
      );
      return;
    }

    const apiStatus = result.data.status ?? '';

    if (apiStatus === '출금성공' || apiStatus === 'SUCCEEDED') {
      await this.handleWithdrawalSuccess(withdrawal, result.data);
    } else if (apiStatus === '출금실패' || apiStatus === 'FAILED') {
      await this.handleWithdrawalFailure(withdrawal, result.data);
    } else if (apiStatus === '출금중' || apiStatus === 'PROCESSING') {
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
    apiData: Record<string, unknown>,
  ): Promise<void> {
    const correlationId = `cms-poller:${withdrawal.transactionId}`;
    const now = new Date().toISOString();

    // 1. cms_withdrawal → SUCCEEDED
    await this.dbService.db
      .update(cmsWithdrawals)
      .set({
        status: 'SUCCEEDED',
        resultCode: (apiData.resultCode as string) ?? null,
        resultMessage: (apiData.resultMsg as string) ?? null,
        actualAmount: (apiData.actualAmount as number) ?? null,
        fee: (apiData.fee as number) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(cmsWithdrawals.id, withdrawal.id));

    // 2. charge → SUCCEEDED
    await this.chargesService.updateStatus(withdrawal.chargeId, 'SUCCEEDED', {
      providerTransactionId: withdrawal.transactionId,
    });

    // 3. intent 정보 조회 → AUTHORIZED + outbox event + auto-capture
    const intent = await this.paymentIntentsService.findById(withdrawal.intentId);
    if (!intent) {
      this.logger.error(`Intent not found for withdrawal ${withdrawal.transactionId}: ${withdrawal.intentId}`);
      return;
    }

    await this.dbService.db.transaction(async (tx) => {
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
    apiData: Record<string, unknown>,
  ): Promise<void> {
    const correlationId = `cms-poller:${withdrawal.transactionId}`;
    const now = new Date().toISOString();

    // 1. cms_withdrawal → FAILED
    await this.dbService.db
      .update(cmsWithdrawals)
      .set({
        status: 'FAILED',
        resultCode: (apiData.resultCode as string) ?? null,
        resultMessage: (apiData.resultMsg as string) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(cmsWithdrawals.id, withdrawal.id));

    // 2. charge → FAILED
    await this.chargesService.updateStatus(withdrawal.chargeId, 'FAILED', {
      errorCode: (apiData.resultCode as string) ?? 'CMS_WITHDRAWAL_FAILED',
      errorMessage: (apiData.resultMsg as string) ?? 'CMS withdrawal failed',
    });

    // 3. intent → FAILED + 이벤트 발행
    const intent = await this.paymentIntentsService.findById(withdrawal.intentId);

    await this.dbService.db.transaction(async (tx) => {
      await this.stateTransitionService.transitionIntent(
        withdrawal.intentId,
        'FAILED',
        {
          correlationId,
          reasonCode: 'CMS_SETTLEMENT_FAILED',
          reasonMessage: `CMS withdrawal ${withdrawal.transactionId} failed: ${(apiData.resultMsg as string) ?? ''}`,
          triggeredByType: 'SYSTEM',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_FAILED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: withdrawal.intentId,
            payload: buildPaymentIntentEventPayload({
              intentId: withdrawal.intentId,
              userId: intent?.userId ?? '',
              status: 'FAILED',
              payableAmount: intent?.payableAmount ?? 0,
              currency: intent?.currency ?? 'KRW',
              occurredAt: now,
            }),
          },
        },
        'PENDING_SETTLEMENT',
        tx,
      );
    });

    this.logger.warn(`CMS withdrawal ${withdrawal.transactionId} failed → intent ${withdrawal.intentId} FAILED`);
  }

  /**
   * 어제 날짜를 YYYYMMDD 형식으로 반환 (KST 기준).
   */
  private getYesterdayDate(): string {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);
    kstNow.setUTCDate(kstNow.getUTCDate() - 1);

    const year = kstNow.getUTCFullYear();
    const month = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstNow.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}
