import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import { FIXED_UUIDS } from '../constants/uuids';

/** `site` 는 `SalesChannel` 어휘여야 한다 (ADR-0031 결정 7) — `pim.seed-step.spec.ts` 가 지킨다. */
export const PIM_SALES_CHANNEL_SEEDS = [
  {
    id: FIXED_UUIDS.CHANNEL_ALMONDYOUNG_MEDUSA,
    type: 'ONLINE',
    site: 'medusa',
    name: '아몬드영 자사몰',
    isActive: true,
  },
];

export class PimSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string) {
    super('PIM', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const ids = PIM_SALES_CHANNEL_SEEDS.map((c) => c.id);
    const existing = await this.findExistingIds('sales_channels', ids);
    const missing = ids.filter((id) => !existing.has(id));

    const items = [
      {
        entity: 'sales_channels',
        expected: PIM_SALES_CHANNEL_SEEDS.length,
        existing: existing.size,
        missing: missing.length,
        missingDetails: missing.map((id) => PIM_SALES_CHANNEL_SEEDS.find((c) => c.id === id)!.name),
      },
    ];

    const isFullySeeded = missing.length === 0;
    return {
      service: 'PIM',
      items,
      isFullySeeded,
      summary: isFullySeeded ? 'All PIM seed data present' : `${missing.length} missing record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();

    try {
      this.logger.step(1, 1, 'Inserting sales channels');
      for (const ch of PIM_SALES_CHANNEL_SEEDS) {
        await this.db.execute(sql`
          INSERT INTO sales_channels (id, type, site, name, is_active)
          VALUES (${ch.id}, ${ch.type}, ${ch.site}, ${ch.name}, ${ch.isActive})
          ON CONFLICT (id) DO NOTHING
        `);
      }

      this.logger.success('PIM seeding completed');
      return {
        service: 'PIM',
        success: true,
        itemsApplied: PIM_SALES_CHANNEL_SEEDS.length,
        duration: Date.now() - start,
      };
    } catch (error: any) {
      this.logger.error('PIM seeding failed', error);
      return { service: 'PIM', success: false, itemsApplied: 0, duration: Date.now() - start, error: error.message };
    }
  }
}
