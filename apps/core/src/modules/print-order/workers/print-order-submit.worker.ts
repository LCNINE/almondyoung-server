import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression } from '@nestjs/schedule';
import { CronOnce } from '@app/cron-once';
import { PRINT_ORDER_STALE_MS, PrintOrderSubmitManager } from '../services/print-order-submit.manager';
import { PrintOrderRepository } from '../services/print-order.repository';

const CLAIM_LIMIT = 10;

@Injectable()
export class PrintOrderSubmitWorker {
  private readonly logger = new Logger(PrintOrderSubmitWorker.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly repository: PrintOrderRepository,
    private readonly manager: PrintOrderSubmitManager,
  ) {}

  @CronOnce(CronExpression.EVERY_MINUTE, { name: 'print-order-submit', timeZone: 'Asia/Seoul' })
  async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<void> {
    if (this.config.get<string>('PRINT_ORDER_SUBMIT_ENABLED') !== 'true') return;
    if (this.running) return;
    this.running = true;
    try {
      const stale = await this.repository.staleSubmitting(new Date(Date.now() - PRINT_ORDER_STALE_MS));
      for (const row of stale) await this.each(row.id, () => this.manager.recoverStale(row));
      // 판매주문 하나씩 집어 선점 시각이 처리 직전에 찍히게 한다. 여러 판매주문을 한꺼번에 집으면 뒤쪽 주문이 처리 전에 stale 이 된다
      for (let i = 0; i < CLAIM_LIMIT; i++) {
        const rows = await this.repository.claimDueBatch(new Date());
        if (rows.length === 0) break;
        await this.each(rows.map((row) => row.id).join(','), () => this.manager.submitBatch(rows));
      }
    } catch (error) {
      this.logger.error(`print-order-submit failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async each(id: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(`print order ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
