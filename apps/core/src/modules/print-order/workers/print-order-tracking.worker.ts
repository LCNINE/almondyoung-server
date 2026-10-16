import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { PrintOrderTrackingManager } from '../services/print-order-tracking.manager';
import { PrintOrderRepository } from '../services/print-order.repository';

export const PRINT_ORDER_TRACK_LIMIT = 200;

@Injectable()
export class PrintOrderTrackingWorker {
  private readonly logger = new Logger(PrintOrderTrackingWorker.name);
  private running = false;

  constructor(
    private readonly repository: PrintOrderRepository,
    private readonly manager: PrintOrderTrackingManager,
  ) {}

  @CronOnce('*/30 * * * *', { name: 'print-order-tracking', timeZone: 'Asia/Seoul' })
  async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.repository.trackable(PRINT_ORDER_TRACK_LIMIT);
      for (const row of rows) {
        try {
          await this.manager.refresh(row);
        } catch (error) {
          this.logger.error(
            `print order ${row.id} tracking failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`print-order-tracking failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
