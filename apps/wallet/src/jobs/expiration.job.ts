import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IntentsService } from '../intents/intents.service';

const DEFAULT_EXPIRATION_CRON = '*/10 * * * *';

@Injectable()
export class ExpirationJob {
  private readonly logger = new Logger(ExpirationJob.name);

  constructor(private readonly intentsService: IntentsService) {}

  @Cron(process.env.WALLET_EXPIRATION_CRON ?? DEFAULT_EXPIRATION_CRON)
  async runScheduledExpiration(): Promise<void> {
    try {
      const result = await this.intentsService.expireDueIntents();
      this.logger.log(
        `Expiration batch finished: scanned=${result.scanned}, expired=${result.expired}, reconcileRequired=${result.reconcileRequired}, skipped=${result.skipped}, failed=${result.failed}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown expiration batch error';
      this.logger.error(`Scheduled expiration batch failed: ${message}`);
    }
  }
}
