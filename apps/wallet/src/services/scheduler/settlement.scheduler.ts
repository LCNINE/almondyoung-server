import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SettlementService } from '../settlement.service';

@Injectable()
export class SettlementScheduler {
  private readonly logger = new Logger(SettlementScheduler.name);

  constructor(
    private readonly settlement: SettlementService,
    private readonly config: ConfigService,
  ) {}

  /** 매일 자정(KST) 실행 → 실제 실행 여부는 billingDay로 결정 */
  @Cron(process.env.SETTLEMENT_CRON || CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    timeZone: process.env.SETTLEMENT_TIMEZONE || 'Asia/Seoul',
  })
  async runOnCron() {
    const now = new Date();

    // 오늘이 billingDay인지 판단
    const billingDay = Number(process.env.SETTLEMENT_BILLING_DAY || 10);
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC → KST 변환
    const today = kst.getUTCDate();

    if (today !== billingDay && process.env.SETTLEMENT_FORCE_RUN !== 'true') {
      this.logger.debug(
        `Skip settlement. today=${today}, billingDay=${billingDay}`,
      );
      return;
    }

    this.logger.log(
      `Settlement 실행: ${now.toISOString()} (billingDay=${billingDay})`,
    );
    await this.settlement.runMonthlySettlement(now);
  }

  /** 테스트 모드: 일정 간격마다 강제 실행 */
  @Interval(Number(process.env.SETTLEMENT_TEST_INTERVAL_MS || 300000))
  async runInTestMode() {
    if (
      process.env.SETTLEMENT_TEST_MODE !== 'true' &&
      process.env.SETTLEMENT_FORCE_RUN !== 'true'
    ) {
      return;
    }

    const now = new Date();
    this.logger.log(`Settlement 실행(TEST MODE): ${now.toISOString()}`);
    await this.settlement.runMonthlySettlement(now);
  }
}
