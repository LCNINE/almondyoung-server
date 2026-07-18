import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { ChargeReleaseService } from '../payment-intents/charge-release.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
  subscriberExtraFromMetadata,
} from '../messaging/gateway-event.builder';

const DEFAULT_EXPIRATION_CRON = '*/10 * * * *';
const DEFAULT_EXPIRATION_BATCH_SIZE = 100;

export const EXPIRABLE_INTENT_STATUSES = [
  'CREATED',
  'PROCESSING',
  'REQUIRES_ACTION',
  'AWAITING_DEPOSIT',
] as const;

@Injectable()
export class ExpirationJob {
  private readonly logger = new Logger(ExpirationJob.name);
  private readonly batchSize: number;

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly stateTransitionService: StateTransitionService,
    private readonly chargeReleaseService: ChargeReleaseService,
  ) {
    const raw = process.env.WALLET_EXPIRATION_BATCH_SIZE;
    const parsed = Number(raw);
    this.batchSize = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_EXPIRATION_BATCH_SIZE;
  }

  @Cron(process.env.WALLET_EXPIRATION_CRON ?? DEFAULT_EXPIRATION_CRON)
  async runScheduledExpiration(): Promise<void> {
    try {
      const result = await this.expireDueIntents();
      if (result.expired > 0 || result.failed > 0) {
        this.logger.log(
          `Expiration batch: expired=${result.expired}, failed=${result.failed}, scanned=${result.scanned}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Expiration batch failed: ${message}`);
    }
  }

  async expireDueIntents(): Promise<{
    scanned: number;
    expired: number;
    failed: number;
  }> {
    const now = new Date();

    const dueIntents = await this.dbService.db
      .select({
        id: paymentIntents.id,
        userId: paymentIntents.userId,
        currency: paymentIntents.currency,
        payableAmount: paymentIntents.payableAmount,
        // 정산대기 intent 만료 취소 시 membership 라우팅용 subscriber 정보를 CANCELED 이벤트에 실으려면 필요(Finding 2).
        metadata: paymentIntents.metadata,
      })
      .from(paymentIntents)
      .where(
        and(
          inArray(
            paymentIntents.status,
            EXPIRABLE_INTENT_STATUSES as unknown as (typeof paymentIntents.$inferSelect)['status'][],
          ),
          lte(paymentIntents.expiresAt, now),
        ),
      )
      .limit(this.batchSize);

    let expired = 0;
    let failed = 0;

    for (const intent of dueIntents) {
      try {
        // Release provider-side holds (POINTS hold, TOSS authorize, …) before
        // cancelling, otherwise an expired composite intent leaks its points hold.
        await this.chargeReleaseService.releaseIntentCharges(intent, `expiration:${intent.id}`);
        // 만료 취소도 INTENT_CANCELED 이벤트를 발행. 무통장입금처럼 Medusa 가
        // 주문을 선생성한 경우, 미입금 만료 시 이 이벤트로 주문을 취소·정리(예약재고 해제).
        // user/admin 취소 경로(CancelService)와 동일한 이벤트라 Medusa 측 처리가 일관됨.
        // Medusa payment 가 없는 인텐트(멤버십/빌링 등)는 hook 에서 no-op 으로 안전 처리됨.
        await this.stateTransitionService.transitionIntent(intent.id, 'CANCELED', {
          correlationId: `expiration:${intent.id}`,
          reasonCode: 'INTENT_EXPIRED',
          reasonMessage: 'Payment intent expired',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_CANCELED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              userId: intent.userId ?? '',
              status: 'CANCELED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              // 정산대기 intent 가 만료로 취소돼도 membership 이 선점을 해제하도록 subscriber 정보를 실어준다(Finding 2).
              extra: subscriberExtraFromMetadata(intent.metadata),
            }),
          },
        });
        expired++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to expire intent ${intent.id}: ${message}`);
        failed++;
      }
    }

    return { scanned: dueIntents.length, expired, failed };
  }
}
