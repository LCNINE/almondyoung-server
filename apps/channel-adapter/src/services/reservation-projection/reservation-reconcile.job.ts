import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronOnce } from '@app/cron-once';
import { ReservationReconcileService } from './reservation-reconcile.service';

export const DEFAULT_RECONCILE_MAX_FIXES = 200;

/** Medusa 예약 하루 대사 크론 (#1247). 한도 미설정·잘못된 값은 기본값. */
@Injectable()
export class ReservationReconcileJob {
  private readonly logger = new Logger(ReservationReconcileJob.name);

  private readonly limit: number;

  constructor(
    private readonly service: ReservationReconcileService,
    configService: ConfigService,
  ) {
    this.limit = parseMaxFixes(configService.get<string | number>('MEDUSA_RESERVATION_RECONCILE_MAX_FIXES'));
  }

  @CronOnce('30 4 * * *', { name: 'medusa-reservation-reconcile', timeZone: 'Asia/Seoul' })
  async run(): Promise<void> {
    try {
      const record = await this.service.run({ limit: this.limit });
      this.logger.log(`예약 대사 ${record.status}: 후보 ${record.candidates}, 고침 ${record.fixes}, 실패 ${record.fixFailures}`);
    } catch (error) {
      this.logger.error(`예약 대사 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** 비었거나 숫자가 아니거나 정수가 아니거나 0 이하면 기본값 — 한도 0 은 «전부 멈춤» 이라 오타로 켜질 수 있다. */
export function parseMaxFixes(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_RECONCILE_MAX_FIXES;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RECONCILE_MAX_FIXES;
}
