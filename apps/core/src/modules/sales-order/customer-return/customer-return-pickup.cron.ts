import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { CustomerReturnPickupManager } from './customer-return-pickup.manager';

/**
 * 반품 회수 워커 1분 주기 (K8 PR9). CronOnce 가 주기당 클러스터 한 번을, 같은 프로세스 안에서는 앞 실행이
 * 길어지면(한진 타임아웃이 겹치면) 다음 틱을 건너뛴다. 행 단위 겹침은 매니저의 리스가 막는다. 실패는 로그만.
 */
@Injectable()
export class CustomerReturnPickupCron {
  private readonly logger = new Logger(CustomerReturnPickupCron.name);
  private running = false;

  constructor(private readonly pickups: CustomerReturnPickupManager) {}

  @CronOnce('* * * * *', { name: 'customer-return-pickup' })
  async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<'ran' | 'skipped' | 'failed'> {
    if (this.running) return 'skipped';
    this.running = true;
    try {
      const { sent, cancelled } = await this.pickups.dispatchDue(new Date());
      if (sent + cancelled > 0) this.logger.log(`반품 회수 예약 ${sent}건 · 취소 ${cancelled}건`);
      return 'ran';
    } catch (error) {
      this.logger.error(
        `customer-return-pickup failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'failed';
    } finally {
      this.running = false;
    }
  }
}
