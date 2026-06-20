import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { ChargeReleaseService } from '../payment-intents/charge-release.service';

const DEFAULT_EXPIRATION_CRON = '*/10 * * * *';
const DEFAULT_EXPIRATION_BATCH_SIZE = 100;

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
      })
      .from(paymentIntents)
      .where(
        and(
          inArray(paymentIntents.status, ['CREATED', 'PROCESSING', 'REQUIRES_ACTION']),
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
        await this.stateTransitionService.transitionIntent(intent.id, 'CANCELED', {
          correlationId: `expiration:${intent.id}`,
          reasonCode: 'INTENT_EXPIRED',
          reasonMessage: 'Payment intent expired',
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
