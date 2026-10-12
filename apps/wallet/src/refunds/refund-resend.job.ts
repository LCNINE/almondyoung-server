import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { RefundsService } from './refunds.service';

/**
 * 멈춘 AUTO PENDING 환불을 같은 멱등 키로 마저 보낸다(#1016 36번 마무리 ③).
 * 클러스터 전체에서 주기당 한 번 — 행 단위 선점은 서비스의 조건부 UPDATE 가 한 번 더 막는다.
 */
@Injectable()
export class RefundResendJob {
  private readonly logger = new Logger(RefundResendJob.name);

  constructor(private readonly refunds: RefundsService) {}

  @CronOnce('0 */5 * * * *', { name: 'refund-stuck-resend' })
  async run(): Promise<void> {
    try {
      const { scanned, resent } = await this.refunds.resendStuckAutoPending(new Date());
      if (scanned > 0) this.logger.log(`refund-stuck-resend: scanned=${scanned} resent=${resent}`);
    } catch (error) {
      this.logger.error(`refund-stuck-resend failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
