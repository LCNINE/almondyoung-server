import { CronOnce } from '@app/cron-once';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PiiAccessRepository } from './pii-access.repository';

const DEFAULT_RETENTION_DAYS = 730;
const BATCH = 10_000;
const DAY_MS = 86_400_000;

/** 보관 기간이 지난 접속기록을 지운다. 긴 잠금을 피하려고 나눠 지운다. */
@Injectable()
export class PiiAccessRetentionCron {
  private readonly logger = new Logger(PiiAccessRetentionCron.name);

  constructor(
    private readonly repository: PiiAccessRepository,
    private readonly config: ConfigService,
  ) {}

  @CronOnce('30 3 * * *', { name: 'pii-access-log-retention' })
  async run(): Promise<void> {
    const deleted = await this.purge(new Date());
    if (deleted > 0) this.logger.log(`pii_access_log_retention deleted=${deleted}`);
  }

  async purge(now: Date): Promise<number> {
    const configured = Number(this.config.get<string>('PII_ACCESS_LOG_RETENTION_DAYS'));
    const days = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    let total = 0;
    for (;;) {
      const deleted = await this.repository.deleteBefore(cutoff, BATCH);
      total += deleted;
      if (deleted < BATCH) return total;
    }
  }
}
