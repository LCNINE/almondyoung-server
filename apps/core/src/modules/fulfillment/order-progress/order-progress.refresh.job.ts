import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { OrderProgressManager } from './order-progress.manager';

/**
 * 정체 보드 투영 1분 갱신. CronOnce 가 주기당 클러스터 한 번을 보장하고, 같은 프로세스 안에서 앞 실행이
 * 1분을 넘기면(첫 백필) 다음 틱을 건너뛴다. 실패는 로그만 남긴다 — 화면이 evaluatedAt 으로 멈춤을 드러낸다(스펙 §8.1).
 */
@Injectable()
export class OrderProgressRefreshJob {
  private readonly logger = new Logger(OrderProgressRefreshJob.name);
  private running = false;

  constructor(private readonly manager: OrderProgressManager) {}

  @CronOnce('* * * * *', { name: 'order-progress-refresh' })
  async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(now: Date = new Date()): Promise<'ran' | 'skipped' | 'failed'> {
    if (this.running) return 'skipped';
    this.running = true;
    const started = Date.now();
    try {
      const { upserted } = await this.manager.refresh(now);
      this.logger.log(`order-progress refresh: ${upserted} rows in ${Date.now() - started}ms`);
      return 'ran';
    } catch (error) {
      this.logger.error(
        `order-progress refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'failed';
    } finally {
      this.running = false;
    }
  }
}
