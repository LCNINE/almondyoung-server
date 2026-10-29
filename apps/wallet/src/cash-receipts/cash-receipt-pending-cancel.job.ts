import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { CashReceiptsService } from './cash-receipts.service';

/** 응답이 끊긴 현금영수증 취소를 같은 멱등 키로 확정한다. 행 단위로는 cancelForRefund 의 FOR UPDATE 가 막는다. */
@Injectable()
export class CashReceiptPendingCancelJob {
  private readonly logger = new Logger(CashReceiptPendingCancelJob.name);

  constructor(private readonly cashReceipts: CashReceiptsService) {}

  @CronOnce('0 */10 * * * *', { name: 'cash-receipt-pending-cancel' })
  async run(): Promise<void> {
    try {
      const { scanned, failed } = await this.cashReceipts.resolvePendingCancels();
      if (scanned > 0) this.logger.log(`cash-receipt-pending-cancel: scanned=${scanned} failed=${failed}`);
    } catch (error) {
      this.logger.error(
        `cash-receipt-pending-cancel failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
