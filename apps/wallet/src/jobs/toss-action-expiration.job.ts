import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, lte } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { AbandonService } from '../payment-intents/abandon.service';

const DEFAULT_ACTION_EXPIRATION_CRON = '*/5 * * * *';
const DEFAULT_ACTION_EXPIRATION_BATCH_SIZE = 100;

/**
 * Reclaims in-flight checkout actions (REQUIRES_ACTION, e.g. Toss checkout) that
 * passed their short `actionExpiresAt` deadline without completing. Routes each
 * through AbandonService — releasing provider-side holds and soft-resetting the
 * intent to CREATED — distinct from the 24h ExpirationJob which fully CANCELs.
 */
@Injectable()
export class TossActionExpirationJob {
  private readonly logger = new Logger(TossActionExpirationJob.name);
  private readonly batchSize: number;

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly abandonService: AbandonService,
  ) {
    const raw = process.env.WALLET_TOSS_ACTION_EXPIRATION_BATCH_SIZE;
    const parsed = Number(raw);
    this.batchSize =
      Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_ACTION_EXPIRATION_BATCH_SIZE;
  }

  @Cron(process.env.WALLET_TOSS_ACTION_EXPIRATION_CRON ?? DEFAULT_ACTION_EXPIRATION_CRON)
  async runScheduledExpiration(): Promise<void> {
    try {
      const result = await this.expireDueActions();
      if (result.reclaimed > 0 || result.failed > 0) {
        this.logger.log(
          `Toss action expiration: reclaimed=${result.reclaimed}, failed=${result.failed}, scanned=${result.scanned}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Toss action expiration batch failed: ${message}`);
    }
  }

  async expireDueActions(): Promise<{ scanned: number; reclaimed: number; failed: number }> {
    const now = new Date();

    // `action_expires_at <= now` excludes NULLs, so only stamped, expired actions match.
    const dueActions = await this.dbService.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(and(eq(paymentIntents.status, 'REQUIRES_ACTION'), lte(paymentIntents.actionExpiresAt, now)))
      .limit(this.batchSize);

    let reclaimed = 0;
    let failed = 0;

    for (const intent of dueActions) {
      try {
        await this.abandonService.abandon(intent.id, `toss-action-expiration:${intent.id}`);
        reclaimed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to reclaim action for intent ${intent.id}: ${message}`);
        failed++;
      }
    }

    return { scanned: dueActions.length, reclaimed, failed };
  }
}
