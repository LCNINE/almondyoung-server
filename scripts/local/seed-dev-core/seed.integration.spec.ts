import { execFileSync } from 'child_process';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
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
    // 정확히 8개를 어서션한다 — apps/core/src/platform/auth/merged-scopes.ts 의 ALL_SCOPES 에서
    // 부팅 시 시딩되는 개수다(import 하지 않음: ALL_SCOPES 에서 스코프 하나가 빠지는 회귀는
    // `> 0` 로는 못 잡는다). 현재 ALL_SCOPES 는 FULFILLMENT_SCOPES 와 동일하다.
    const scopeCountRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM auth.scopes`);
    expect(scopeCountRows[0].n).toBe(8);

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

  it('재고가 원장과 이벤트 양쪽에 정합하게 들어간다', async () => {
    const ledgers = await db
      .select({
        skuId: wmsTables.stockLedgers.skuId,
        warehouseId: wmsTables.stockLedgers.warehouseId,
        locationId: wmsTables.stockLedgers.locationId,
        qty: wmsTables.stockLedgers.qty,
      })
      .from(wmsTables.stockLedgers)
      .where(eq(wmsTables.stockLedgers.stockState, 'ON_HAND'));

    // 기대값은 constants.ts/stock.ts 의 SEED_SKUS/SEED_RACK_LOCATIONS/SEED_IDS 와 배치 규칙을
    // import 하거나 재계산하지 않고 리터럴로 옮겨 적는다 — 계산 로직을 그대로 가져와 비교하면
    // 그 로직 자체가 잘못됐을 때도(예: 수량이 바뀌거나 로케이션이 밀리는 회귀) 테스트가
    // 통과해버려 회귀를 잡지 못한다.
    const BUCHEON_WAREHOUSE_ID = '019d0001-0001-7000-a000-000000000001';
    const CHINA_WAREHOUSE_ID = '019d0001-0002-7000-a000-000000000002';

    // stock.ts 배치 규칙: index 0~1 → 재고 없음.
    const ZERO_STOCK_SKU_IDS = ['019d0006-0001-7000-a000-000000000001', '019d0006-0002-7000-a000-000000000002'];

    // stock.ts 배치 규칙: index 2~13 → 랙 1곳에 50개. 단, index 2(SKU 0003)는 inbound.ts 가
    // 같은 SKU 로 실제 InboundService.receiveFromPlan 을 태워 부천/중국 RECEIVING_DEFAULT 존에도
    // 재고를 추가로 남기므로 여기 목록에서 빼고 아래 INBOUND_RECEIVED_SKU 로 따로 검증한다.
    const SINGLE_LOCATION_SKUS: Array<{ skuId: string; locationId: string; qty: number }> = [
      { skuId: '019d0006-0004-7000-a000-000000000004', locationId: '019d0005-0004-7000-a000-000000000004', qty: 50 },
      { skuId: '019d0006-0005-7000-a000-000000000005', locationId: '019d0005-0005-7000-a000-000000000005', qty: 50 },
      { skuId: '019d0006-0006-7000-a000-000000000006', locationId: '019d0005-0006-7000-a000-000000000006', qty: 50 },
      { skuId: '019d0006-0007-7000-a000-000000000007', locationId: '019d0005-0001-7000-a000-000000000001', qty: 50 },
      { skuId: '019d0006-0008-7000-a000-000000000008', locationId: '019d0005-0002-7000-a000-000000000002', qty: 50 },
      { skuId: '019d0006-0009-7000-a000-000000000009', locationId: '019d0005-0003-7000-a000-000000000003', qty: 50 },
      { skuId: '019d0006-0010-7000-a000-000000000010', locationId: '019d0005-0004-7000-a000-000000000004', qty: 50 },
      { skuId: '019d0006-0011-7000-a000-000000000011', locationId: '019d0005-0005-7000-a000-000000000005', qty: 50 },
      { skuId: '019d0006-0012-7000-a000-000000000012', locationId: '019d0005-0006-7000-a000-000000000006', qty: 50 },
      { skuId: '019d0006-0013-7000-a000-000000000013', locationId: '019d0005-0001-7000-a000-000000000001', qty: 50 },
      { skuId: '019d0006-0014-7000-a000-000000000014', locationId: '019d0005-0002-7000-a000-000000000002', qty: 50 },
    ];

    // stock.ts 배치 규칙: index 14~19 → 랙 2곳에 30 + 20개.
    const MULTI_LOCATION_SKUS: Array<{ skuId: string; placements: Array<{ locationId: string; qty: number }> }> = [
      {
        skuId: '019d0006-0015-7000-a000-000000000015',
        placements: [
          { locationId: '019d0005-0003-7000-a000-000000000003', qty: 30 },
          { locationId: '019d0005-0004-7000-a000-000000000004', qty: 20 },
        ],
      },
      {
        skuId: '019d0006-0016-7000-a000-000000000016',
        placements: [
          { locationId: '019d0005-0004-7000-a000-000000000004', qty: 30 },
          { locationId: '019d0005-0005-7000-a000-000000000005', qty: 20 },
        ],
      },
      {
        skuId: '019d0006-0017-7000-a000-000000000017',
        placements: [
          { locationId: '019d0005-0005-7000-a000-000000000005', qty: 30 },
          { locationId: '019d0005-0006-7000-a000-000000000006', qty: 20 },
        ],
      },
      {
        skuId: '019d0006-0018-7000-a000-000000000018',
        placements: [
          { locationId: '019d0005-0006-7000-a000-000000000006', qty: 30 },
          { locationId: '019d0005-0001-7000-a000-000000000001', qty: 20 },
        ],
      },
      {
        skuId: '019d0006-0019-7000-a000-000000000019',
        placements: [
          { locationId: '019d0005-0001-7000-a000-000000000001', qty: 30 },
          { locationId: '019d0005-0002-7000-a000-000000000002', qty: 20 },
        ],
      },
      {
        skuId: '019d0006-0020-7000-a000-000000000020',
        placements: [
          { locationId: '019d0005-0002-7000-a000-000000000002', qty: 30 },
          { locationId: '019d0005-0003-7000-a000-000000000003', qty: 20 },
        ],
      },
    ];

    // inbound.ts 가 실제 InboundService.receiveFromPlan 을 태워 만든 SKU 0003 재고 3행:
    //  - 부천 랙 A-01-03(기존 stock.ts 배치) 50개
    //  - 중국 RECEIVING_DEFAULT(source plan 부분입고 20/60) 20개
    //  - 부천 RECEIVING_DEFAULT(destination plan 완료입고 60/60) 60개
    // (로케이션 id 는 constants.ts SEED_IDS.locChinaReceiving/locBucheonReceiving 리터럴.)
    const INBOUND_RECEIVED_SKU_ID = '019d0006-0003-7000-a000-000000000003';
    const CHINA_RECEIVING_LOCATION_ID = '019d0002-0005-7000-a000-000000000005';
    const BUCHEON_RECEIVING_LOCATION_ID = '019d0002-0001-7000-a000-000000000001';
    const BUCHEON_RACK_A0103_LOCATION_ID = '019d0005-0003-7000-a000-000000000003';

    // 모든 원장 행이 부천 창고 소속이다 — 유일한 예외는 위 SKU 0003 의 중국 source plan
    // 부분입고 행 (중국 창고로 잘못 붙는 회귀 방지는 이 예외를 제외한 나머지 전부에 여전히 적용).
    for (const row of ledgers) {
      if (row.skuId === INBOUND_RECEIVED_SKU_ID && row.locationId === CHINA_RECEIVING_LOCATION_ID) {
        expect(row.warehouseId).toBe(CHINA_WAREHOUSE_ID);
      } else {
        expect(row.warehouseId).toBe(BUCHEON_WAREHOUSE_ID);
      }
    }

    const ledgersBySku = new Map<string, Array<{ locationId: string; qty: number }>>();
    for (const row of ledgers) {
      const rows = ledgersBySku.get(row.skuId) ?? [];
      rows.push({ locationId: row.locationId, qty: row.qty });
      ledgersBySku.set(row.skuId, rows);
    }

    // 재고 0 SKU 2건은 원장 행이 아예 없다.
    for (const skuId of ZERO_STOCK_SKU_IDS) {
      expect(ledgersBySku.get(skuId)).toBeUndefined();
    }

    // 단일 로케이션 SKU 11건: ON_HAND 행이 정확히 1개, 수량과 로케이션이 기대값과 일치한다.
    for (const expected of SINGLE_LOCATION_SKUS) {
      const rows = ledgersBySku.get(expected.skuId) ?? [];
      expect(rows).toHaveLength(1);
      expect(rows[0].locationId).toBe(expected.locationId);
      expect(rows[0].qty).toBe(expected.qty);
    }

    // SKU 0003: stock.ts 의 랙 배치 1행 + inbound.ts 의 실입고 2행 = 총 3행.
    // (로케이션, 수량) 쌍이 순서 무관하게 기대값 집합과 일치하는지 확인한다.
    const inboundReceivedRows = ledgersBySku.get(INBOUND_RECEIVED_SKU_ID) ?? [];
    expect(inboundReceivedRows).toHaveLength(3);
    const actualInboundPairs = inboundReceivedRows.map((r) => `${r.locationId}:${r.qty}`).sort();
    const expectedInboundPairs = [
      `${BUCHEON_RACK_A0103_LOCATION_ID}:50`,
      `${CHINA_RECEIVING_LOCATION_ID}:20`,
      `${BUCHEON_RECEIVING_LOCATION_ID}:60`,
    ].sort();
    expect(actualInboundPairs).toEqual(expectedInboundPairs);

    // 다중 로케이션 분산 SKU 6건: ON_HAND 행이 정확히 2개, 로케이션 2곳이 서로 다르며
    // (로케이션, 수량) 쌍이 순서 무관하게 기대값 집합과 일치한다.
    for (const expected of MULTI_LOCATION_SKUS) {
      const rows = ledgersBySku.get(expected.skuId) ?? [];
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.locationId)).size).toBe(2);
      const actualPairs = rows.map((r) => `${r.locationId}:${r.qty}`).sort();
      const expectedPairs = expected.placements.map((p) => `${p.locationId}:${p.qty}`).sort();
      expect(actualPairs).toEqual(expectedPairs);
    }

    // 전체 재고보유 SKU 수 = 20 - 2(재고 0) = 18 (SKU 0003 은 행이 3개여도 distinct SKU 로는 1건).
    expect(ledgersBySku.size).toBe(18);

    // 전체 ON_HAND 행 수 = 11(단일) + 3(SKU 0003) + 12(다중 6건×2행) = 26. 계산 없이 리터럴로 고정.
    expect(ledgers).toHaveLength(26);

    // RECEIVE 이벤트 수 == 원장 행 수 (직접 insert 로 만들지 않았다는 증거 — inbound.ts 의
    // receiveFromPlan 2회 호출도 각각 RECEIVE 이벤트 1건 + 원장 1행을 만들어 이 등식을 유지한다)
    const receiveEvents = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.transitionType, 'RECEIVE'));
    expect(Number(receiveEvents[0].n)).toBe(26);
    expect(Number(receiveEvents[0].n)).toBe(ledgers.length);
  });

  it('입고 계획이 상태별로 들어가고, PO 라인/부모플랜/품목상태가 서로 어긋나지 않는다', async () => {
    // PO/plan/plan-item 의 id 는 defaultRandom() 이라 리터럴로 못박을 수 없다 — type/skuId 같은
    // 결정론적 속성으로 찾아서 서로 연결 짓는다.
    const DEV_SKU_0001 = '019d0006-0001-7000-a000-000000000001';
    const DEV_SKU_0002 = '019d0006-0002-7000-a000-000000000002';
    const DEV_SKU_0003 = '019d0006-0003-7000-a000-000000000003';

    const orders = await db.select().from(wmsTables.purchaseOrders);
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.type).sort()).toEqual(['domestic', 'foreign']);
    const domesticPo = orders.find((o) => o.type === 'domestic');
    const foreignPo = orders.find((o) => o.type === 'foreign');
    expect(domesticPo).toBeDefined();
    expect(foreignPo).toBeDefined();

    // PO 라인 quantity 를 (poId, skuId) 기준으로 매핑 — 아래 plan item expectedQty 드리프트
    // 검증(리뷰 지적사항)에 쓴다.
    const poLines = await db.select().from(wmsTables.purchaseOrderLines);
    const poLineQtyByPoAndSku = new Map(poLines.map((l) => [`${l.poId}:${l.skuId}`, l.quantity]));
    expect(poLineQtyByPoAndSku.get(`${domesticPo!.id}:${DEV_SKU_0001}`)).toBe(40);
    expect(poLineQtyByPoAndSku.get(`${domesticPo!.id}:${DEV_SKU_0002}`)).toBe(25);
    expect(poLineQtyByPoAndSku.get(`${foreignPo!.id}:${DEV_SKU_0003}`)).toBe(60);

    const plans = await db.select().from(wmsTables.inboundPlans);
    expect(plans).toHaveLength(3);
    expect(plans.map((p) => p.status).sort()).toEqual(['confirmed', 'pending', 'receiving']);

    const domesticPlan = plans.find((p) => p.linkedPurchaseOrderId === domesticPo!.id);
    const sourcePlan = plans.find((p) => p.linkedPurchaseOrderId === foreignPo!.id && p.planType === 'source');
    const destinationPlan = plans.find(
      (p) => p.linkedPurchaseOrderId === foreignPo!.id && p.planType === 'destination',
    );
    expect(domesticPlan).toBeDefined();
    expect(sourcePlan).toBeDefined();
    expect(destinationPlan).toBeDefined();

    expect(domesticPlan!.status).toBe('pending');
    expect(sourcePlan!.status).toBe('receiving');
    expect(destinationPlan!.status).toBe('confirmed');

    // 리뷰 지적사항: destination plan 이 parent_plan_id 로 source plan 을 정확히 참조하는지
    // (직접 insert 라 값이 유실되거나 엉뚱한 plan 을 가리키는 회귀를 잡는다).
    expect(destinationPlan!.parentPlanId).toBe(sourcePlan!.id);
    expect(sourcePlan!.parentPlanId).toBeNull();
    expect(domesticPlan!.parentPlanId).toBeNull();

    const items = await db.select().from(wmsTables.inboundPlanItems);
    expect(items).toHaveLength(4); // 국내 2 + 해외 source 1 + destination 1

    const domesticItems = items.filter((i) => i.planId === domesticPlan!.id);
    const sourceItems = items.filter((i) => i.planId === sourcePlan!.id);
    const destinationItems = items.filter((i) => i.planId === destinationPlan!.id);
    expect(domesticItems).toHaveLength(2);
    expect(sourceItems).toHaveLength(1);
    expect(destinationItems).toHaveLength(1);

    // 리뷰 지적사항: plan item 수량이 PO 라인에서 드리프트하지 않았는지 (하드코딩 리터럴).
    const domesticItemBySku = new Map(domesticItems.map((i) => [i.skuId, i]));
    expect(domesticItemBySku.get(DEV_SKU_0001)?.expectedQty).toBe(40);
    expect(domesticItemBySku.get(DEV_SKU_0002)?.expectedQty).toBe(25);
    expect(sourceItems[0].skuId).toBe(DEV_SKU_0003);
    expect(sourceItems[0].expectedQty).toBe(60);
    expect(destinationItems[0].skuId).toBe(DEV_SKU_0003);
    expect(destinationItems[0].expectedQty).toBe(60);

    // 국내 plan/품목은 요구사항대로 입고를 전혀 태우지 않아 시작 상태(un-received) 그대로다
    // (재고 0 SKU 를 건드리면 품절 케이스가 깨지므로).
    for (const item of domesticItems) {
      expect(item.status).toBe('pending');
      expect(item.receivedQty).toBe(0);
    }

    // 리뷰 지적사항: item-level status 가 plan-level status 와 어긋나지 않는지.
    // destination(plan='confirmed'): receiveFromPlan 의 실제 로직(완료 시 'confirmed')과
    // 문자 그대로 일치한다.
    expect(destinationItems[0].receivedQty).toBe(60);
    expect(destinationItems[0].status).toBe('confirmed');

    // source(plan='receiving', 부분입고): inbound.service.ts 의 실제 분기는 이진
    // (완료 미만이면 'pending' / 완료면 'confirmed')이라 부분입고 상태에서도 item.status 는
    // 실제로 'pending' 이다 — plan.status='receiving' 과 문자 그대로 같지는 않지만, "아직
    // confirmed 가 아니고 receivedQty 가 0 초과·expectedQty 미만"이라는 의미로는 정확히
    // 대응한다. 이 값들은 도메인이 실제로 산출한 값 그대로이며 여기서 지어낸 게 아니다.
    expect(sourceItems[0].receivedQty).toBe(20);
    expect(sourceItems[0].status).toBe('pending');
    expect(sourceItems[0].status).not.toBe('confirmed');
    expect(sourceItems[0].receivedQty).toBeGreaterThan(0);
    expect(sourceItems[0].receivedQty).toBeLessThan(sourceItems[0].expectedQty);
  });

  it('판매주문 10건이 FO 와 draft shipment 로 변환된다', async () => {
    const orders = await db.select().from(wmsTables.salesOrders).orderBy(wmsTables.salesOrders.channelOrderId);
    expect(orders).toHaveLength(10);
    expect(orders[0].channelOrderId).toBe('DEV-ORDER-0001');

    const fulfillmentOrders = await db.select().from(wmsTables.fulfillmentOrders);
    expect(fulfillmentOrders).toHaveLength(10);

    const items = await db.select().from(wmsTables.fulfillmentOrderItems);
    expect(items).toHaveLength(10);
    // 예약이 함께 섰는지 — 직접 insert 로는 만들 수 없는 상태다.
    expect(items.every((item) => item.reservedQty > 0)).toBe(true);

    const shipments = await db.select().from(wmsTables.shipments);
    expect(shipments).toHaveLength(10);

    // 리뷰 지적사항: 위 assertion 들은 FulfillmentsService.create 가 실제로 계산하는 핵심 값 —
    // FO item 의 qty(= sales_order_line.quantity × product_variant_sku_link.quantity)와 그
    // qty 가 가리키는 SKU — 를 전혀 검증하지 않는다. quantity 가 항상 1로 나오거나 링크
    // 배수를 무시하는 회귀, 엉뚱한 SKU 를 이행하는 회귀가 있어도 위 assertion 들은 그대로
    // 통과한다. 아래에서 주문별 기대 (skuId, qty) 를 orders.ts/constants.ts 로부터 계산해
    // 오지 않고 리터럴로 직접 적어 그 계산 회귀 자체를 잡는다.
    //
    // orders.ts 의 시딩 규칙(리터럴로 옮겨 적음, import/재계산 없음):
    //   - order index i(0-based) 는 채널주문 DEV-ORDER-000(i+1) 에 대응.
    //   - sales_order_line.quantity = (i % 3) + 1 → 1, 2, 3 이 순환하며 전부 같은 값이 아니다.
    //   - 매칭 SKU = SEED_SKUS[i + 2] (재고가 있는 SKU 0003~0012), product_variant_sku_link.quantity
    //     는 이 시드의 모든 주문에서 1 이다.
    //   - 따라서 기대 FO item qty = sales_order_line.quantity × 1 = sales_order_line.quantity.
    //   - 이 시드는 재고가 넉넉해(SKU 당 최소 50개) 10건 전부 전량 예약되므로 reservedQty == qty.
    const expectedItemsByOrder: Array<{ channelOrderId: string; skuId: string; qty: number }> = [
      { channelOrderId: 'DEV-ORDER-0001', skuId: '019d0006-0003-7000-a000-000000000003', qty: 1 },
      { channelOrderId: 'DEV-ORDER-0002', skuId: '019d0006-0004-7000-a000-000000000004', qty: 2 },
      { channelOrderId: 'DEV-ORDER-0003', skuId: '019d0006-0005-7000-a000-000000000005', qty: 3 },
      { channelOrderId: 'DEV-ORDER-0004', skuId: '019d0006-0006-7000-a000-000000000006', qty: 1 },
      { channelOrderId: 'DEV-ORDER-0005', skuId: '019d0006-0007-7000-a000-000000000007', qty: 2 },
      { channelOrderId: 'DEV-ORDER-0006', skuId: '019d0006-0008-7000-a000-000000000008', qty: 3 },
      { channelOrderId: 'DEV-ORDER-0007', skuId: '019d0006-0009-7000-a000-000000000009', qty: 1 },
      { channelOrderId: 'DEV-ORDER-0008', skuId: '019d0006-0010-7000-a000-000000000010', qty: 2 },
      { channelOrderId: 'DEV-ORDER-0009', skuId: '019d0006-0011-7000-a000-000000000011', qty: 3 },
      { channelOrderId: 'DEV-ORDER-0010', skuId: '019d0006-0012-7000-a000-000000000012', qty: 1 },
    ];

    const itemsByOrder = await db
      .select({
        channelOrderId: wmsTables.salesOrders.channelOrderId,
        skuId: wmsTables.fulfillmentOrderItems.skuId,
        qty: wmsTables.fulfillmentOrderItems.qty,
        reservedQty: wmsTables.fulfillmentOrderItems.reservedQty,
      })
      .from(wmsTables.salesOrders)
      .innerJoin(wmsTables.fulfillmentOrders, eq(wmsTables.fulfillmentOrders.salesOrderId, wmsTables.salesOrders.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, wmsTables.fulfillmentOrders.id),
      )
      .orderBy(wmsTables.salesOrders.channelOrderId);
    expect(itemsByOrder).toHaveLength(10);

    for (let i = 0; i < expectedItemsByOrder.length; i += 1) {
      const expected = expectedItemsByOrder[i];
      const actual = itemsByOrder[i];
      expect(actual.channelOrderId).toBe(expected.channelOrderId);
      expect(actual.skuId).toBe(expected.skuId);
      expect(actual.qty).toBe(expected.qty);
      expect(actual.reservedQty).toBe(expected.qty); // 전량 예약
    }
  });

  it('shipment 절반은 draft, 절반은 planned 로 남는다', async () => {
    const shipments = await db.select({ status: wmsTables.shipments.status }).from(wmsTables.shipments);
    const byStatus = shipments.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(byStatus).toEqual({ draft: 5, planned: 5 });
  });
});

describeIfSeedDb('dev_core 시드 --bulk', () => {
  jest.setTimeout(600_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    execFileSync(
      'npx',
      [
        'ts-node',
        '-r',
        'tsconfig-paths/register',
        '--transpile-only',
        'scripts/local/seed-dev-core/index.ts',
        '--bulk',
      ],
      { stdio: 'inherit', env: { ...process.env, SEED_DEV_CORE_URL: SEED_URL } },
    );
    client = postgres(SEED_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('SKU 320건 · 로케이션 64건이 된다', async () => {
    const skus = await db.select({ n: sql<number>`count(*)::int` }).from(wmsTables.skus);
    expect(Number(skus[0].n)).toBe(320);

    const locations = await db.select({ n: sql<number>`count(*)::int` }).from(wmsTables.locations);
    expect(Number(locations[0].n)).toBe(64);
  });

  // 아래 리터럴은 bulk.ts 를 읽고 손으로 계산한 값이다 — bulk.ts 의 BULK_LOCATION_ID_PREFIX/
  // BULK_SKU_ID_PREFIX/bulkLocationId/bulkSkuId 를 import 해서 기대값을 다시 계산하면, 그
  // 계산 로직 자체가 잘못됐을 때도(예: bulkSkuId 가 defaultRandom() 으로 되돌아가거나 접두가
  // 어긋나는 회귀) 테스트가 그대로 통과해버려 결정론 회귀를 잡지 못한다. 이 id/코드/바코드가
  // 리셋마다 그대로인 것 자체가 이 브랜치의 목적(인쇄된 벌크 바코드·북마크된 SKU URL 생존)이다.
  it('벌크 SKU/로케이션 첫·끝 항목이 결정론적 id·code·바코드로 들어간다', async () => {
    const firstLocation = await db.select().from(wmsTables.locations).where(eq(wmsTables.locations.code, 'B-001'));
    expect(firstLocation).toHaveLength(1);
    expect(firstLocation[0].id).toBe('019d0009-0001-7000-a000-000000000001');

    const lastLocation = await db.select().from(wmsTables.locations).where(eq(wmsTables.locations.code, 'B-050'));
    expect(lastLocation).toHaveLength(1);
    expect(lastLocation[0].id).toBe('019d0009-0050-7000-a000-000000000050');

    const firstSku = await db.select().from(wmsTables.skus).where(eq(wmsTables.skus.code, 'BULK-SKU-0001'));
    expect(firstSku).toHaveLength(1);
    expect(firstSku[0].id).toBe('019d000a-0001-7000-a000-000000000001');

    const lastSku = await db.select().from(wmsTables.skus).where(eq(wmsTables.skus.code, 'BULK-SKU-0300'));
    expect(lastSku).toHaveLength(1);
    expect(lastSku[0].id).toBe('019d000a-0300-7000-a000-000000000300');

    const firstBarcode = await db
      .select()
      .from(wmsTables.skuBarcodes)
      .where(eq(wmsTables.skuBarcodes.skuId, firstSku[0].id));
    expect(firstBarcode).toHaveLength(1);
    expect(firstBarcode[0].barcode).toBe('88100000001');
    expect(firstBarcode[0].isPrimary).toBe(true);

    const lastBarcode = await db
      .select()
      .from(wmsTables.skuBarcodes)
      .where(eq(wmsTables.skuBarcodes.skuId, lastSku[0].id));
    expect(lastBarcode).toHaveLength(1);
    expect(lastBarcode[0].barcode).toBe('88100000300');
    expect(lastBarcode[0].isPrimary).toBe(true);

    // 300개 SKU 각각 바코드 1개 = 총 300건. skuBarcodes insert 가 통째로 빠지거나 일부만
    // 들어가는 회귀(개수 드리프트)를 잡는다.
    const barcodeCount = await db.select({ n: sql<number>`count(*)::int` }).from(wmsTables.skuBarcodes);
    expect(Number(barcodeCount[0].n)).toBe(320); // 기본 시드 20 + 벌크 300
  });
});
