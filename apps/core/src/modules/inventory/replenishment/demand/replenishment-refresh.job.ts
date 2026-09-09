import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { ReplenishmentSettingsReader } from './replenishment-settings.reader';
import { DemandSeriesWriter, DemandRebuildResult } from './demand-series.writer';
import { DemandProfileRefresher, ProfileRefreshResult } from './demand-profile.refresher';
import { LeadTimeProfileRefresher, LeadTimeRefreshResult } from './lead-time-profile.refresher';
import { addDays, kstDateOf } from './calendar';

export type RefreshSeries = 'window' | 'full';

/** run() 의 세 단계, 실행 순서 그대로. 실패 로그가 "어디까지 갔는지" 를 이름으로 남기는 데 쓴다. */
export type RefreshStage = 'demandSeries' | 'profiles' | 'leadTimes';
const STAGE_ORDER: RefreshStage[] = ['demandSeries', 'profiles', 'leadTimes'];

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
 *
 * 설정은 `run()` 초입에서 **한 번만** 읽어 세 단계에 그대로 넘긴다(`today` 와 같은 방식). B 가
 * `PUT /replenishment/rules/settings` 를 연 뒤로는 한 런이 도는 몇 초~몇십 초 사이에도 운영자가
 * 저장을 누를 수 있어서, 단계마다 따로 읽으면 한 런의 프로필이 서로 다른 창 길이 · 등급 컷으로 섞인다.
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

  @CronOnce('40 3 * * *', { name: 'replenishment-profile-refresh', timeZone: 'Asia/Seoul' })
  async nightly(): Promise<void> {
    // run() 자체는 손대지 않고 단계 완료를 옆에서 기록만 한다 — 실패 시 "어느 단계까지 커밋됐는지"를
    // 로그에 남기기 위함(운영 런북이 이 로그로 부분 실패와 전체 실패를 구별한다).
    const completedStages: RefreshStage[] = [];
    try {
      const summary = await this.run('window', new Date(), (stage) => completedStages.push(stage));
      this.logger.log(
        `✅ replenishment refresh: series ${summary.demandSeries.rows} rows (${summary.demandSeries.from}~${summary.demandSeries.to}), ` +
          `profiles ${summary.profiles.skus} skus ${JSON.stringify(summary.profiles.byPattern)}, ` +
          `lead-times suppliers=${summary.leadTimes.suppliers} routes=${summary.leadTimes.routes}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      const failedStage = STAGE_ORDER[completedStages.length] ?? 'unknown';
      const completedText = completedStages.length > 0 ? completedStages.join(', ') : '없음';
      this.logger.error(
        `replenishment refresh job failed at stage "${failedStage}" (완료된 단계: ${completedText}): ${message}`,
        stack,
      );
    }
  }

  async run(
    series: RefreshSeries,
    now: Date = new Date(),
    onStageDone?: (stage: RefreshStage) => void,
  ): Promise<RefreshSummary> {
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
    onStageDone?.('demandSeries');
    const profiles = await this.profileRefresher.refreshAll({ today, settings });
    onStageDone?.('profiles');
    const leadTimes = await this.leadTimeRefresher.refreshAll({ today, settings });
    onStageDone?.('leadTimes');

    return { series, today, startedAt, finishedAt: new Date().toISOString(), demandSeries, profiles, leadTimes };
  }
}
