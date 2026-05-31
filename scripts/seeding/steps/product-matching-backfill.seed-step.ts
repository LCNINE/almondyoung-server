import { SeedStep } from './base-seed-step';
import { SeedApplyResult, SeedCheckResult } from '../lib/types';

interface MissingVariantRow {
  variant_id: string;
}

interface CountRow {
  count: number;
}

interface MasterVariantRow {
  variant_id: string;
  master_id: string;
}

export class ProductMatchingBackfillSeedStep extends SeedStep {
  readonly groups = ['backfill'] as const;

  constructor(databaseUrl: string) {
    super('ProductMatchingBackfill', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const missingCount = await this.countMissingActiveVariants();

    return {
      service: this.serviceName,
      items: [
        {
          entity: 'active variants without matching',
          expected: missingCount,
          existing: 0,
          missing: missingCount,
        },
      ],
      isFullySeeded: missingCount === 0,
      summary:
        missingCount === 0
          ? 'All active variants have product matching rows'
          : `${missingCount} active variant(s) missing product matching rows`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    let itemsApplied = 0;

    try {
      this.logger.step(1, 3, 'Finding active variants without product matchings');
      const variantIds = await this.findMissingActiveVariantIds();

      if (variantIds.length === 0) {
        this.logger.success('No product matching backfill needed');
        return {
          service: this.serviceName,
          success: true,
          itemsApplied,
          duration: Date.now() - start,
        };
      }

      this.logger.step(2, 3, 'Resolving product masters for variants');
      const masterIdsByVariantId = await this.resolveMasterIds(variantIds);

      this.logger.step(3, 3, 'Inserting pending product matchings');
      for (const variantId of variantIds) {
        const rows = await this.client`
          INSERT INTO product_matchings (
            variant_id,
            master_id,
            status,
            priority,
            strategy,
            is_resolved
          )
          VALUES (
            ${variantId},
            ${masterIdsByVariantId.get(variantId) ?? null},
            'pending',
            'high',
            NULL,
            false
          )
          ON CONFLICT (variant_id) DO NOTHING
          RETURNING id
        `;
        itemsApplied += rows.length;
      }

      this.logger.success(`Product matching backfill completed (${itemsApplied} inserted)`);
      return {
        service: this.serviceName,
        success: true,
        itemsApplied,
        duration: Date.now() - start,
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.logger.error('Product matching backfill failed', error);
      return {
        service: this.serviceName,
        success: false,
        itemsApplied,
        duration: Date.now() - start,
        error: message,
      };
    }
  }

  private async countMissingActiveVariants(): Promise<number> {
    const rows = await this.client<CountRow[]>`
      SELECT count(*)::int AS count
      FROM product_variants pv
      WHERE pv.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM product_matchings pm
          WHERE pm.variant_id = pv.id
        )
    `;

    return rows[0]?.count ?? 0;
  }

  private async findMissingActiveVariantIds(): Promise<string[]> {
    const rows = await this.client<MissingVariantRow[]>`
      SELECT pv.id AS variant_id
      FROM product_variants pv
      WHERE pv.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM product_matchings pm
          WHERE pm.variant_id = pv.id
        )
      ORDER BY pv.id
    `;

    return rows.map((row) => row.variant_id);
  }

  private async resolveMasterIds(variantIds: string[]): Promise<Map<string, string>> {
    if (variantIds.length === 0) return new Map();

    const rows = await this.client<MasterVariantRow[]>`
      SELECT DISTINCT variant_id, master_id
      FROM product_master_variants
      WHERE variant_id = ANY(${variantIds})
    `;

    const masterIdsByVariantId = new Map<string, Set<string>>();
    for (const row of rows) {
      const masterIds = masterIdsByVariantId.get(row.variant_id) ?? new Set<string>();
      masterIds.add(row.master_id);
      masterIdsByVariantId.set(row.variant_id, masterIds);
    }

    const resolved = new Map<string, string>();
    for (const variantId of variantIds) {
      const masterIds = masterIdsByVariantId.get(variantId) ?? new Set<string>();
      if (masterIds.size === 1) {
        resolved.set(variantId, Array.from(masterIds)[0]);
        continue;
      }

      this.logger.warn(
        `variant ${variantId} has ${masterIds.size} distinct master_id rows; inserting matching with master_id NULL`,
      );
    }

    return resolved;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
