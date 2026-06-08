import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';

/**
 * 결제수단 카탈로그(글로벌) + 리전 + 리전별 매핑의 기준(reference) 시드.
 * 카탈로그 code 는 provider.registry 의 providerType 과 일치한다.
 * 최종 노출 = 카탈로그 is_enabled(글로벌) AND 리전 is_active AND 매핑 is_enabled.
 */
const CATALOG = [
  { code: 'POINTS', displayName: '포인트', description: '내부 포인트 결제', isEnabled: true, sortOrder: 10 },
  {
    code: 'TOSS',
    displayName: '토스페이먼츠',
    description: '카드/간편결제 (토스페이먼츠)',
    isEnabled: true,
    sortOrder: 20,
  },
  {
    code: 'BANK_TRANSFER',
    displayName: '무통장입금',
    description: '계좌 무통장 입금 (수동 확인)',
    isEnabled: true,
    sortOrder: 30,
  },
  // NICEPAY 는 provider 코드는 있으나 아직 미운영 → 글로벌 비활성으로 등록 (admin 이 준비되면 켠다)
  {
    code: 'NICEPAY',
    displayName: '나이스페이',
    description: '카드/간편결제 (나이스페이)',
    isEnabled: false,
    sortOrder: 40,
  },
] as const;

const REGIONS = [{ code: 'kr', name: '대한민국', isActive: true, sortOrder: 10 }] as const;

// kr 에서 활성화할 결제수단 (글로벌 is_enabled 와 AND 되어 최종 노출).
// NICEPAY 는 kr 매핑은 켜두되 글로벌이 꺼져 있어 실제로는 숨겨진다.
const REGION_METHODS = [
  { regionCode: 'kr', catalogCode: 'POINTS', isEnabled: true, sortOrder: 10 },
  { regionCode: 'kr', catalogCode: 'TOSS', isEnabled: true, sortOrder: 20 },
  { regionCode: 'kr', catalogCode: 'BANK_TRANSFER', isEnabled: true, sortOrder: 30 },
  { regionCode: 'kr', catalogCode: 'NICEPAY', isEnabled: true, sortOrder: 40 },
] as const;

export class WalletSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string) {
    super('Wallet', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const existingCatalog = await this.findExistingKeys(
      'payment_method_catalog',
      CATALOG.map((c) => c.code),
      'code',
    );
    const missingCatalog = CATALOG.filter((c) => !existingCatalog.has(c.code));

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
        expected: CATALOG.length,
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
      for (const c of CATALOG) {
        await this.db.execute(sql`
          INSERT INTO payment_method_catalog (code, display_name, description, is_enabled, sort_order)
          VALUES (${c.code}, ${c.displayName}, ${c.description}, ${c.isEnabled}, ${c.sortOrder})
          ON CONFLICT (code) DO NOTHING
        `);
      }
      itemsApplied += CATALOG.length;

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
