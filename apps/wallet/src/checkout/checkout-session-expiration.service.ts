import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, lt } from 'drizzle-orm';
import { WalletSchema, checkoutSessions } from '../schema';

@Injectable()
export class CheckoutSessionExpirationService {
  private readonly logger = new Logger(CheckoutSessionExpirationService.name);

  constructor(private readonly dbService: DbService<WalletSchema>) {}

  @Cron('0 */10 * * * *')
  async expireStale(): Promise<void> {
    const now = new Date();

    const expired = await this.dbService.db
      .update(checkoutSessions)
      .set({ status: 'EXPIRED', updatedAt: now })
      .where(and(eq(checkoutSessions.status, 'PENDING'), lt(checkoutSessions.expiresAt, now)))
      .returning({ id: checkoutSessions.id });

    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} stale checkout sessions`);
    }
  }
}
