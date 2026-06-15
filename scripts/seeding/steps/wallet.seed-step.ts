import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import { DEFAULT_PAYMENT_PROVIDER_DESCRIPTORS } from '../../../apps/wallet/src/providers/provider-descriptors';

/**
 * 결제수단 운영 policy baseline.
 *
 * 지원 provider 목록의 SoT는 wallet ProviderRegistry descriptor다. 이 seed는
 * 최초 kr 리전과 공개 checkout provider의 policy row/FK anchor만 보조로 만든다.
 */
const BASELINE_CHECKOUT_PROVIDERS = DEFAULT_PAYMENT_PROVIDER_DESCRIPTORS.filter(
  (descriptor) => descriptor.publicExposure === 'checkout',
);

const CATALOG_POLICY = BASELINE_CHECKOUT_PROVIDERS.map((descriptor) => ({
  code: descriptor.code,
  displayName: descriptor.displayName,
  description: descriptor.description,
  isEnabled: descriptor.defaultEnabled,
  sortOrder: descriptor.defaultSortOrder,
})) as readonly {
  code: string;
  displayName: string;
  description: string | null;
  isEnabled: boolean;
  sortOrder: number;
}[];

const REGIONS = [{ code: 'kr', name: '대한민국', isActive: true, sortOrder: 10 }] as const;

const REGION_METHODS = BASELINE_CHECKOUT_PROVIDERS.map((descriptor) => ({
  regionCode: 'kr',
  catalogCode: descriptor.code,
  isEnabled: true,
  sortOrder: descriptor.defaultSortOrder,
})) as readonly { regionCode: string; catalogCode: string; isEnabled: boolean; sortOrder: number }[];

export class WalletSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string) {
    super('Wallet', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const existingCatalog = await this.findExistingKeys(
      'payment_method_catalog',
      CATALOG_POLICY.map((c) => c.code),
      'code',
    );
    const missingCatalog = CATALOG_POLICY.filter((c) => !existingCatalog.has(c.code));

    const existingRegions = await this.findExistingKeys(
      'regions',
      REGIONS.map((r) => r.code),
      'code',
    );
    const missingRegions = REGIONS.filter((r) => !existingRegions.has(r.code));

    const mappingCount = await this.countRows('region_payment_methods');
    const missingMappings = Math.max(0, REGION_METHODS.length - mappingCount);

    const items = [
      {
        entity: 'payment_method_catalog',
        expected: CATALOG_POLICY.length,
        existing: existingCatalog.size,
        missing: missingCatalog.length,
        missingDetails: missingCatalog.map((c) => c.code),
      },
      {
        entity: 'regions',
        expected: REGIONS.length,
        existing: existingRegions.size,
        missing: missingRegions.length,
        missingDetails: missingRegions.map((r) => r.code),
      },
      {
        entity: 'region_payment_methods',
        expected: REGION_METHODS.length,
        existing: mappingCount,
        missing: missingMappings,
        missingDetails: [],
      },
    ];

    const isFullySeeded = items.every((i) => i.missing === 0);
    const totalMissing = items.reduce((sum, i) => sum + i.missing, 0);

    return {
      service: 'Wallet',
      items,
      isFullySeeded,
      summary: isFullySeeded ? 'All Wallet seed data present' : `${totalMissing} missing record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    let itemsApplied = 0;

    try {
      this.logger.step(1, 3, 'Inserting payment method catalog');
      for (const c of CATALOG_POLICY) {
        await this.db.execute(sql`
          INSERT INTO payment_method_catalog (code, display_name, description, is_enabled, sort_order)
          VALUES (${c.code}, ${c.displayName}, ${c.description}, ${c.isEnabled}, ${c.sortOrder})
          ON CONFLICT (code) DO NOTHING
        `);
      }
      itemsApplied += CATALOG_POLICY.length;

      this.logger.step(2, 3, 'Inserting regions');
      for (const r of REGIONS) {
        await this.db.execute(sql`
          INSERT INTO regions (code, name, is_active, sort_order)
          VALUES (${r.code}, ${r.name}, ${r.isActive}, ${r.sortOrder})
          ON CONFLICT (code) DO NOTHING
        `);
      }
      itemsApplied += REGIONS.length;

      this.logger.step(3, 3, 'Inserting region payment methods');
      for (const m of REGION_METHODS) {
        await this.db.execute(sql`
          INSERT INTO region_payment_methods (region_id, catalog_id, is_enabled, sort_order)
          SELECT r.id, c.id, ${m.isEnabled}, ${m.sortOrder}
          FROM regions r, payment_method_catalog c
          WHERE r.code = ${m.regionCode} AND c.code = ${m.catalogCode}
          ON CONFLICT (region_id, catalog_id) DO NOTHING
        `);
      }
      itemsApplied += REGION_METHODS.length;

      this.logger.success('Wallet seeding completed');
      return { service: 'Wallet', success: true, itemsApplied, duration: Date.now() - start };
    } catch (error: any) {
      this.logger.error('Wallet seeding failed', error);
      return { service: 'Wallet', success: false, itemsApplied, duration: Date.now() - start, error: error.message };
    }
  }
}
