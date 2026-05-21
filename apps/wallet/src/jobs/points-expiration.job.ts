import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PointsAdminService } from '../admin/points-admin.service';

const DEFAULT_CRON = '0 2 * * *'; // 매일 새벽 2시

@Injectable()
export class PointsExpirationJob {
  private readonly logger = new Logger(PointsExpirationJob.name);

  constructor(private readonly pointsAdminService: PointsAdminService) {}

  @Cron(process.env.WALLET_POINTS_EXPIRATION_CRON ?? DEFAULT_CRON)
  async runScheduledExpiration(): Promise<void> {
    try {
      const result = await this.pointsAdminService.processExpiredPoints();
      if (result.processed > 0 || result.cancelled > 0) {
        this.logger.log(
          `Points expiration: processed=${result.processed}, cancelled=${result.cancelled}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Points expiration batch failed: ${message}`);
    }
  }
}
