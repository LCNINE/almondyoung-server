import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReplenishmentSettingsReader } from './replenishment-settings.reader';
import { DemandSeriesWriter, DemandRebuildResult } from './demand-series.writer';
import { DemandProfileRefresher, ProfileRefreshResult } from './demand-profile.refresher';
import { LeadTimeProfileRefresher, LeadTimeRefreshResult } from './lead-time-profile.refresher';
import { addDays, kstDateOf } from './calendar';

export type RefreshSeries = 'window' | 'full';

export interface RefreshSummary {
  series: RefreshSeries;
  today: string;
  startedAt: string;
  finishedAt: string;
  demandSeries: DemandRebuildResult;
  profiles: ProfileRefreshResult;
  leadTimes: LeadTimeRefreshResult;
}

/**
 * 야간 배치 (스펙 §8.3): ① 시계열 창 upsert → ② 프로필 → ③ 리드타임. 각 단계는 제 트랜잭션이라
 * 앞 단계의 커밋은 남고, 실패하면 뒤를 돌리지 않는다(부분 갱신된 프로필 위에 리드타임만 새것이 되는 상태를 피한다).
 * recompute 엔드포인트는 같은 run() 을 동기로 부른다. 크론 리더 선출이 없어 인스턴스가 둘이면 두 번 도는데
 * 결과가 같다. `SCHEDULE_ROOT` 가 전역이라 이 모듈은 ScheduleModule 을 import 하지 않는다(#599).
 */
@Injectable()
export class ReplenishmentRefreshJob {
  private readonly logger = new Logger(ReplenishmentRefreshJob.name);

  constructor(
    private readonly settingsReader: ReplenishmentSettingsReader,
    private readonly seriesWriter: DemandSeriesWriter,
    private readonly profileRefresher: DemandProfileRefresher,
    private readonly leadTimeRefresher: LeadTimeProfileRefresher,
  ) {}

  @Cron('40 3 * * *', { name: 'replenishment-profile-refresh', timeZone: 'Asia/Seoul' })
  async nightly(): Promise<void> {
    try {
      const summary = await this.run('window');
      this.logger.log(
        `✅ replenishment refresh: series ${summary.demandSeries.rows} rows (${summary.demandSeries.from}~${summary.demandSeries.to}), ` +
          `profiles ${summary.profiles.skus} skus ${JSON.stringify(summary.profiles.byPattern)}, ` +
          `lead-times suppliers=${summary.leadTimes.suppliers} routes=${summary.leadTimes.routes}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`replenishment refresh job failed: ${message}`, stack);
    }
  }

  async run(series: RefreshSeries, now: Date = new Date()): Promise<RefreshSummary> {
    const startedAt = now.toISOString();
    const today = kstDateOf(now);
    const settings = await this.settingsReader.read();

    const demandSeries =
      series === 'full'
        ? await this.seriesWriter.rebuildCoreFull({ to: today, coreSince: settings.demandCoreSince })
        : await this.seriesWriter.rebuildCoreWindow({
            from: addDays(today, -settings.demandRecomputeDays),
            to: today,
            coreSince: settings.demandCoreSince,
          });
    const profiles = await this.profileRefresher.refreshAll({ today });
    const leadTimes = await this.leadTimeRefresher.refreshAll({ today });

    return { series, today, startedAt, finishedAt: new Date().toISOString(), demandSeries, profiles, leadTimes };
  }
}
