import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { CustomerReturnService } from './customer-return.service';

/**
 * 반품 정산 명령 재발행 5분 주기 (K8 PR6 N9). 리컨실러가 아니라 이 크론이 낸다 — 주문 진행 판정의 반품 단계가
 * 새 기록을 읽기 전(PR 10)까지 붙일 자리가 없다. CronOnce 가 주기당 클러스터 한 번을, 같은 프로세스 안에서는
 * 앞 실행이 길어지면 다음 틱을 건너뛴다. 실패는 로그만 — 다음 주기가 다시 한다.
 */
@Injectable()
export class CustomerReturnSettlementRetryCron {
  private readonly logger = new Logger(CustomerReturnSettlementRetryCron.name);
  private running = false;

  constructor(private readonly service: CustomerReturnService) {}

  @CronOnce('*/5 * * * *', { name: 'customer-return-settlement-retry' })
  async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<'ran' | 'skipped' | 'failed'> {
    if (this.running) return 'skipped';
    this.running = true;
    try {
      const reissued = await this.service.reissueStalled(new Date());
      if (reissued > 0) this.logger.log(`반품 정산 명령 재발행 ${reissued}건`);
      return 'ran';
    } catch (error) {
      this.logger.error(
        `customer-return-settlement-retry failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'failed';
    } finally {
      this.running = false;
    }
  }
}
