import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';

/**
 * 재고 보충 전역 설정 1행 (#743 A, 스펙 §6 「초기값」). 운영자가 규칙 화면(B)에서 고친다.
 * ON CONFLICT DO NOTHING — 이미 있으면 운영자가 바꾼 값을 덮지 않는다.
 */
export const REPLENISHMENT_SETTINGS_SEED = {
  // 'default' 는 apps/core/.../replenishment-settings.reader.ts 의 SETTINGS_KEY 리터럴과 같은 값이어야 한다.
  // 이 스크립트는 apps/core 를 import 할 수 없어 리터럴을 그대로 둔다.
  key: 'default',
  adiThreshold: 1.32,
  cv2Threshold: 0.49,
  classificationWindowDays: 365,
  paramWindowDaysFrequent: 90,
  paramWindowDaysSparse: 365,
  minDemandEvents: 3,
  minLeadTimeObservations: 5,
  leadTimeWindowDays: 365,
  gradeACut: 0.8,
  gradeBCut: 0.95,
  demandCoreSince: null as string | null,
  demandRecomputeDays: 14,
  consolidationBufferDays: 7,
  defaultLeadTimeDays: 30,
  defaultLeadTimeStdDays: null as number | null,
  defaultTransferLeadTimeDays: 14,
  defaultTransferLeadTimeStdDays: null as number | null,
  defaultLeadTimeCv: 0.25,
  defaultCoverDays: 30,
  defaultTransferCoverDays: 14,
};

export class ReplenishmentSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string) {
    super('Replenishment', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const existing = await this.findExistingKeys('replenishment_settings', [REPLENISHMENT_SETTINGS_SEED.key], 'key');
    const missing = existing.has(REPLENISHMENT_SETTINGS_SEED.key) ? 0 : 1;
    const items = [
      {
        entity: 'replenishment_settings',
        expected: 1,
        existing: 1 - missing,
        missing,
        missingDetails: missing ? [REPLENISHMENT_SETTINGS_SEED.key] : [],
      },
    ];
    const isFullySeeded = missing === 0;
    return {
      service: 'Replenishment',
      items,
      isFullySeeded,
      summary: isFullySeeded ? 'All Replenishment seed data present' : `${missing} missing record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    const s = REPLENISHMENT_SETTINGS_SEED;
    try {
      this.logger.step(1, 1, 'Inserting replenishment settings');
      await this.db.execute(sql`
        INSERT INTO replenishment_settings (
          key, adi_threshold, cv2_threshold, classification_window_days,
          param_window_days_frequent, param_window_days_sparse, min_demand_events,
          min_lead_time_observations, lead_time_window_days, grade_a_cut, grade_b_cut,
          demand_core_since, demand_recompute_days, consolidation_buffer_days,
          default_lead_time_days, default_lead_time_std_days,
          default_transfer_lead_time_days, default_transfer_lead_time_std_days,
          default_lead_time_cv, default_cover_days, default_transfer_cover_days
        ) VALUES (
          ${s.key}, ${s.adiThreshold}, ${s.cv2Threshold}, ${s.classificationWindowDays},
          ${s.paramWindowDaysFrequent}, ${s.paramWindowDaysSparse}, ${s.minDemandEvents},
          ${s.minLeadTimeObservations}, ${s.leadTimeWindowDays}, ${s.gradeACut}, ${s.gradeBCut},
          ${s.demandCoreSince}, ${s.demandRecomputeDays}, ${s.consolidationBufferDays},
          ${s.defaultLeadTimeDays}, ${s.defaultLeadTimeStdDays},
          ${s.defaultTransferLeadTimeDays}, ${s.defaultTransferLeadTimeStdDays},
          ${s.defaultLeadTimeCv}, ${s.defaultCoverDays}, ${s.defaultTransferCoverDays}
        )
        ON CONFLICT (key) DO NOTHING
      `);
      this.logger.success('Replenishment seeding completed');
      return { service: 'Replenishment', success: true, itemsApplied: 1, duration: Date.now() - start };
    } catch (error: any) {
      this.logger.error('Replenishment seeding failed', error);
      return { service: 'Replenishment', success: false, itemsApplied: 0, duration: Date.now() - start, error: error.message };
    }
  }
}
