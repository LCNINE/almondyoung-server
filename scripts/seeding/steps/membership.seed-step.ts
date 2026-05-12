import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import { FIXED_UUIDS } from '../constants/uuids';

const TIERS = [
  { id: FIXED_UUIDS.TIER_MEMBERSHIP, code: 'MEMBERSHIP', priorityLevel: 1 },
];

const PLANS = [
  { id: FIXED_UUIDS.PLAN_30DAYS, tierId: FIXED_UUIDS.TIER_MEMBERSHIP, price: 4990, durationDays: 30, currency: 'KRW', trialDays: 0, isActive: true },
  { id: FIXED_UUIDS.PLAN_365DAYS, tierId: FIXED_UUIDS.TIER_MEMBERSHIP, price: 49900, durationDays: 365, currency: 'KRW', trialDays: 0, isActive: true },
];

const CANCELLATION_REASONS = [
  { code: 'NOT_USING', displayText: '사용하지 않음', category: 'USER_CHOICE', sortOrder: 1, isActive: true },
  { code: 'EXPENSIVE', displayText: '가격 부담', category: 'PRICE', sortOrder: 2, isActive: true },
  { code: 'LACK_OF_BENEFITS', displayText: '혜택 부족', category: 'BENEFITS', sortOrder: 3, isActive: true },
  { code: 'USING_OTHER_SERVICE', displayText: '타사 이용', category: 'ALTERNATIVES', sortOrder: 4, isActive: true },
  { code: 'OTHER', displayText: '기타', category: 'OTHER', sortOrder: 5, isActive: true },
];

export class MembershipSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string) {
    super('Membership', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const tierIds = TIERS.map((t) => t.id);
    const existingTiers = await this.findExistingIds('tiers', tierIds);
    const missingTiers = TIERS.filter((t) => !existingTiers.has(t.id));

    const planIds = PLANS.map((p) => p.id);
    const existingPlans = await this.findExistingIds('plan', planIds);
    const missingPlans = PLANS.filter((p) => !existingPlans.has(p.id));

    const reasonCodes = CANCELLATION_REASONS.map((r) => r.code);
    const existingReasons = await this.findExistingKeys('cancellation_reasons', reasonCodes, 'code');
    const missingReasons = CANCELLATION_REASONS.filter((r) => !existingReasons.has(r.code));

    const items = [
      {
        entity: 'tiers',
        expected: TIERS.length,
        existing: existingTiers.size,
        missing: missingTiers.length,
        missingDetails: missingTiers.map((t) => t.code),
      },
      {
        entity: 'plan',
        expected: PLANS.length,
        existing: existingPlans.size,
        missing: missingPlans.length,
        missingDetails: missingPlans.map((p) => `${p.durationDays}days`),
      },
      {
        entity: 'cancellation_reasons',
        expected: CANCELLATION_REASONS.length,
        existing: existingReasons.size,
        missing: missingReasons.length,
        missingDetails: missingReasons.map((r) => r.code),
      },
    ];

    const isFullySeeded = items.every((i) => i.missing === 0);
    const totalMissing = items.reduce((sum, i) => sum + i.missing, 0);

    return {
      service: 'Membership',
      items,
      isFullySeeded,
      summary: isFullySeeded ? 'All Membership seed data present' : `${totalMissing} missing record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    let itemsApplied = 0;

    try {
      // Tiers
      this.logger.step(1, 3, 'Inserting membership tier');
      for (const tier of TIERS) {
        await this.db.execute(sql`
          INSERT INTO tiers (id, code, priority_level)
          VALUES (${tier.id}, ${tier.code}, ${tier.priorityLevel})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      itemsApplied += TIERS.length;

      // Plans
      this.logger.step(2, 3, 'Inserting membership plans');
      for (const plan of PLANS) {
        await this.db.execute(sql`
          INSERT INTO plan (id, tier_id, price, duration_days, currency, trial_days, is_active)
          VALUES (${plan.id}, ${plan.tierId}, ${plan.price}, ${plan.durationDays}, ${plan.currency}, ${plan.trialDays}, ${plan.isActive})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      itemsApplied += PLANS.length;

      // Cancellation reasons
      this.logger.step(3, 3, 'Inserting cancellation reasons');
      for (const reason of CANCELLATION_REASONS) {
        await this.db.execute(sql`
          INSERT INTO cancellation_reasons (code, display_text, category, sort_order, is_active)
          VALUES (${reason.code}, ${reason.displayText}, ${reason.category}, ${reason.sortOrder}, ${reason.isActive})
          ON CONFLICT (code) DO NOTHING
        `);
      }
      itemsApplied += CANCELLATION_REASONS.length;

      this.logger.success('Membership seeding completed');
      return { service: 'Membership', success: true, itemsApplied, duration: Date.now() - start };
    } catch (error: any) {
      this.logger.error('Membership seeding failed', error);
      return { service: 'Membership', success: false, itemsApplied, duration: Date.now() - start, error: error.message };
    }
  }
}
