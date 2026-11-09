import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronOnce } from '@app/cron-once';
import { ReservationReconcileService } from './reservation-reconcile.service';

export const DEFAULT_RECONCILE_MAX_FIXES = 200;

/** Medusa 예약 하루 대사 크론 (#1247). 한도 미설정·잘못된 값은 기본값. */
@Injectable()
export class ReservationReconcileJob {
  private readonly logger = new Logger(ReservationReconcileJob.name);

  constructor(
    private readonly service: ReservationReconcileService,
    private readonly configService: ConfigService,
  ) {}

  @CronOnce('30 4 * * *', { name: 'medusa-reservation-reconcile', timeZone: 'Asia/Seoul' })
  async run(): Promise<void> {
    const raw = Number(this.configService.get<string | number>('MEDUSA_RESERVATION_RECONCILE_MAX_FIXES'));
    const limit = Number.isInteger(raw) && raw >= 0 && this.configured() ? raw : DEFAULT_RECONCILE_MAX_FIXES;
    try {
      const record = await this.service.run({ limit });
      this.logger.log(`예약 대사 ${record.status}: 후보 ${record.candidates}, 고침 ${record.fixes}, 실패 ${record.fixFailures}`);
    } catch (error) {
      this.logger.error(`예약 대사 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private configured(): boolean {
    const v = this.configService.get<string | number>('MEDUSA_RESERVATION_RECONCILE_MAX_FIXES');
    return v !== undefined && v !== null && String(v).trim() !== '';
  }
}
