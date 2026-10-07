// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.job.ts
import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { OrderReconcileRunner } from './order-reconcile.runner';

/**
 * 리컨실러 1분 주기(스펙 §4.3-5). CronOnce 가 주기당 클러스터 한 번을 보장하고, 같은 프로세스 안에서 앞 실행이
 * 1분을 넘기면 다음 틱을 건너뛴다. 실패는 로그만 — 다음 주기가 다시 한다.
 */
@Injectable()
export class OrderReconcileJob {
  private readonly logger = new Logger(OrderReconcileJob.name);
  private running = false;

  constructor(private readonly runner: OrderReconcileRunner) {}

  @CronOnce('* * * * *', { name: 'order-reconcile' })
  async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(now: Date = new Date()): Promise<'ran' | 'skipped' | 'failed'> {
    if (this.running) return 'skipped';
    this.running = true;
    try {
      await this.runner.runAll(now);
      return 'ran';
    } catch (error) {
      this.logger.error(
        `order-reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'failed';
    } finally {
      this.running = false;
    }
  }
}
