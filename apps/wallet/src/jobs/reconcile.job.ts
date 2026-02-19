import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReconcileService } from '../reconcile/reconcile.service';

const DEFAULT_RECONCILE_CRON = '*/10 * * * *';

@Injectable()
export class ReconcileJob {
  private readonly logger = new Logger(ReconcileJob.name);

  constructor(private readonly reconcileService: ReconcileService) {}

  @Cron(process.env.WALLET_RECONCILE_CRON ?? DEFAULT_RECONCILE_CRON)
  async runScheduledBatch(): Promise<void> {
    try {
      await this.reconcileService.runBatch('SCHEDULED');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown reconcile batch error';
      this.logger.error(`Scheduled reconcile batch failed: ${message}`);
    }
  }
}
