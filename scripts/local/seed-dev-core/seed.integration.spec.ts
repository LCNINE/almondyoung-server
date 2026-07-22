import { execFileSync } from 'child_process';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';

const SEED_URL = process.env.SEED_DEV_CORE_URL;
const describeIfSeedDb = SEED_URL ? describe : describe.skip;

describeIfSeedDb('dev_core 시드', () => {
  jest.setTimeout(300_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    execFileSync(
      'npx',
      ['ts-node', '-r', 'tsconfig-paths/register', '--transpile-only', 'scripts/local/seed-dev-core/index.ts'],
      { stdio: 'inherit', env: { ...process.env, SEED_DEV_CORE_URL: SEED_URL } },
    );
    client = postgres(SEED_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('scope 와 role→scope 매핑이 채워진다', async () => {
    const scopeCountRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM auth.scopes`);
    expect(scopeCountRows[0].n).toBeGreaterThan(0);

    const roleScopeRows = await db.execute<{ role_name: string; scope_key: string }>(sql`
      SELECT rsm.role_name, s.key AS scope_key
      FROM auth.role_scope_mapping rsm
      JOIN auth.scopes s ON s.id = rsm.scope_id
      ORDER BY rsm.role_name, s.key
    `);

    const scopeKeysByRole = new Map<string, string[]>();
    for (const row of roleScopeRows) {
      const scopeKeys = scopeKeysByRole.get(row.role_name) ?? [];
      scopeKeys.push(row.scope_key);
      scopeKeysByRole.set(row.role_name, scopeKeys);
    }

    // 기대값은 apps/core/src/platform/auth/fulfillment-scopes.ts 의 FULFILLMENT_ROLE_MAPPINGS 를
    // import 하지 않고 여기 직접 적는다 — 검증 대상 상수를 그대로 가져와 비교하면 그 상수 자체가
    // 잘못됐을 때도 테스트가 통과해버려 회귀를 잡지 못한다.
    expect(scopeKeysByRole.get('logistics_worker')).toEqual(['fulfillment.warehouse.operate']);
    expect(scopeKeysByRole.get('logistics_manager')).toEqual([
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.reservation.transfer',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.shipment.reopen',
      'fulfillment.warehouse.operate',
    ]);
  });

  it('마스터 데이터가 결정론적으로 들어간다', async () => {
    const warehouses = await db.select().from(wmsTables.warehouses).orderBy(wmsTables.warehouses.name);
    expect(warehouses.map((w) => w.name)).toEqual(['부천 물류창고', '중국 물류창고']);

    // 아래 두 UUID 는 constants.ts 의 SEED_IDS.warehouseBucheon/China 값을 그대로 리터럴로 옮겨
    // 적은 것이다 — SEED_IDS 를 import 해서 비교하면 그 상수 자체가 잘못됐을 때도(예: 시스템 존이
    // 엉뚱한 창고에 붙는 회귀) 테스트가 통과해버려 회귀를 잡지 못한다.
    const BUCHEON_WAREHOUSE_ID = '019d0001-0001-7000-a000-000000000001';
    const CHINA_WAREHOUSE_ID = '019d0001-0002-7000-a000-000000000002';
    expect(warehouses[0].id).toBe(BUCHEON_WAREHOUSE_ID);
    expect(warehouses[1].id).toBe(CHINA_WAREHOUSE_ID);

    const locations = await db.select().from(wmsTables.locations);
    expect(locations).toHaveLength(14); // 창고 2개 × 기본 존 4 + 부천 랙 6

    // 창고 2개 × 4개 기본 존(RECEIVING/SHIPPING/DAMAGE/RETURN). 이 중 RECEIVING/RETURN 만
    // isSystem=true + systemRole 이 지정되고, SHIPPING/DAMAGE 는 평범한 zone(isSystem=false,
    // systemRole=null) 이다. warehouseId+code 조합으로 정확히 그 행을 찾아 세 필드를 모두
    // 검증한다 — 시스템 존이 다른 창고에 잘못 붙거나 systemRole 이 빠지는 회귀를 잡기 위함.
    const locationsByKey = new Map(locations.map((l) => [`${l.warehouseId}:${l.code}`, l]));
    const expectedSystemZones: Array<{
      warehouseId: string;
      code: string;
      isSystem: boolean;
      systemRole: string | null;
    }> = [
      { warehouseId: BUCHEON_WAREHOUSE_ID, code: 'RECEIVING_DEFAULT', isSystem: true, systemRole: 'inbound_default' },
      { warehouseId: BUCHEON_WAREHOUSE_ID, code: 'SHIPPING_DEFAULT', isSystem: false, systemRole: null },
      { warehouseId: BUCHEON_WAREHOUSE_ID, code: 'DAMAGE_DEFAULT', isSystem: false, systemRole: null },
      { warehouseId: BUCHEON_WAREHOUSE_ID, code: 'RETURN_DEFAULT', isSystem: true, systemRole: 'return_default' },
      { warehouseId: CHINA_WAREHOUSE_ID, code: 'RECEIVING_DEFAULT', isSystem: true, systemRole: 'inbound_default' },
      { warehouseId: CHINA_WAREHOUSE_ID, code: 'SHIPPING_DEFAULT', isSystem: false, systemRole: null },
      { warehouseId: CHINA_WAREHOUSE_ID, code: 'DAMAGE_DEFAULT', isSystem: false, systemRole: null },
      { warehouseId: CHINA_WAREHOUSE_ID, code: 'RETURN_DEFAULT', isSystem: true, systemRole: 'return_default' },
    ];
    for (const expected of expectedSystemZones) {
      const actual = locationsByKey.get(`${expected.warehouseId}:${expected.code}`);
      expect(actual).toBeDefined();
      expect(actual?.isSystem).toBe(expected.isSystem);
      expect(actual?.systemRole).toBe(expected.systemRole);
    }
    expect(locations.filter((l) => l.isSystem)).toHaveLength(4); // 창고 2개 × (RECEIVING, RETURN)

    const skus = await db.select().from(wmsTables.skus).orderBy(wmsTables.skus.code);
    expect(skus).toHaveLength(20);

    // 20개 SKU 코드 전체를 리터럴로 적어 코드 유일성·순서·zero-padding 자릿수를 한 번에 검증한다.
    // constants.ts 의 padStart 포맷 로직을 다시 불러와 계산하면 그 로직 자체가 잘못됐을 때도
    // 테스트가 통과해버리므로, 여기서는 계산 없이 20개 문자열을 그대로 나열한다.
    const expectedSkuCodes = [
      'DEV-SKU-0001',
      'DEV-SKU-0002',
      'DEV-SKU-0003',
      'DEV-SKU-0004',
      'DEV-SKU-0005',
      'DEV-SKU-0006',
      'DEV-SKU-0007',
      'DEV-SKU-0008',
      'DEV-SKU-0009',
      'DEV-SKU-0010',
      'DEV-SKU-0011',
      'DEV-SKU-0012',
      'DEV-SKU-0013',
      'DEV-SKU-0014',
      'DEV-SKU-0015',
      'DEV-SKU-0016',
      'DEV-SKU-0017',
      'DEV-SKU-0018',
      'DEV-SKU-0019',
      'DEV-SKU-0020',
    ];
    expect(skus.map((s) => s.code)).toEqual(expectedSkuCodes);
    expect(new Set(skus.map((s) => s.code)).size).toBe(20); // 코드 유일성 (더블체크)

    // constants.ts 의 `index % 5 === 0 ? 10 : 0` 규칙을 SKU 코드 기준 리터럴로 옮겨 적는다 —
    // safetyStock 전부가 0으로 밀리는 회귀(예: 조건식이 항상 false)를 잡기 위함.
    const expectedNonZeroSafetyStockCodes = new Set(['DEV-SKU-0001', 'DEV-SKU-0006', 'DEV-SKU-0011', 'DEV-SKU-0016']);
    for (const sku of skus) {
      const expectedSafetyStock = expectedNonZeroSafetyStockCodes.has(sku.code) ? 10 : 0;
      expect(sku.safetyStock).toBe(expectedSafetyStock);
    }

    const barcodes = await db.select().from(wmsTables.skuBarcodes).orderBy(wmsTables.skuBarcodes.barcode);
    expect(barcodes).toHaveLength(20);

    // 바코드도 20개 전체를 리터럴로 적어 유일성과 zero-padding 자릿수를 한 번에 검증한다 (계산 없이 나열).
    const expectedBarcodes = [
      '88000000001',
      '88000000002',
      '88000000003',
      '88000000004',
      '88000000005',
      '88000000006',
      '88000000007',
      '88000000008',
      '88000000009',
      '88000000010',
      '88000000011',
      '88000000012',
      '88000000013',
      '88000000014',
      '88000000015',
      '88000000016',
      '88000000017',
      '88000000018',
      '88000000019',
      '88000000020',
    ];
    expect(barcodes.map((b) => b.barcode)).toEqual(expectedBarcodes);
    expect(new Set(barcodes.map((b) => b.barcode)).size).toBe(20); // 바코드 유일성 (더블체크)
  });
});
