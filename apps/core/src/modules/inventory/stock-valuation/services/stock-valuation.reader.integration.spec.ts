jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { StockValuationReader } from './stock-valuation.reader';

/**
 * 재고 금액의 원가 판정 5종(valued·costMissing·costConflict·multiMaster·unmatched)을 실 Postgres 로
 * 고정한다. 판정 규칙 자체는 순수 함수(classifySkuCost)가 유닛 스펙으로 잡고 있지만,
 * **원가 후보를 어떻게 모아 오는지**(원장 → 링크 → 매칭 → variant → active 버전)는 SQL 이라
 * 여기서만 확인된다. 금액을 못 매기는 몫을 0 으로 뭉개지 않고 사유별로 나누는 것이 이 화면의
 * 약속이므로, 버킷이 조용히 섞이면 "묶인 돈"이 틀린다.
 *
 * 각 테스트는 트랜잭션 안에서 픽스처를 넣고 항상 롤백한다 — DB 에 아무것도 남지 않는다.
 *
 * 실행: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest stock-valuation.reader.integration`
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WH = (n: number) => uuid('aaaaaaaa', n);
const LOC = (n: number) => uuid('bbbbbbbb', n);
const MASTER = (n: number) => uuid('cccccccc', n);
const VERSION = (n: number) => uuid('dddddddd', n);
const VARIANT = (n: number) => uuid('eeeeeeee', n);
const MATCHING = (n: number) => uuid('ffffffff', n);
const SKU = (n: number) => uuid('99999999', n);
const HOLDER = uuid('88888888', 1);

describeIfDb('재고 금액 원가 판정 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  let conn: postgres.Sql;

  beforeAll(() => {
    conn = postgres(DATABASE_URL as string, { max: 1 });
  });

  afterAll(async () => {
    await conn.end();
  });

  /**
   * 픽스처 — SKU 하나가 판정 하나를 대표한다.
   *   S1 valued(단위 1,000) · S2 costMissing · S3 multiMaster · S4 costConflict · S5 unmatched
   *   S6 은 잔량 0 이라 아예 안 잡혀야 한다.
   */
  async function withFixture<T>(run: (reader: StockValuationReader, trx: unknown) => Promise<T>): Promise<T> {
    const db = drizzle(conn);
    let result!: T;
    try {
      await db.transaction(async (trx) => {
        await trx.execute(sql`insert into holders (id, name) values (${HOLDER}, 'fx')`);
        await trx.execute(sql`
          insert into warehouses (id, name, is_sellable)
          values (${WH(1)}, '판매창고', true), (${WH(2)}, '보관창고', false)`);
        await trx.execute(sql`
          insert into locations (id, warehouse_id, code, location_type)
          values (${LOC(1)}, ${WH(1)}, 'A', 'zone'), (${LOC(2)}, ${WH(2)}, 'B', 'zone')`);

        // 마스터당 active 버전은 하나뿐(unique_master_active_version)
        for (const [n, supply] of [
          [1, 1000],
          [2, 2000],
          [3, null],
        ] as Array<[number, number | null]>) {
          await trx.execute(sql`insert into product_masters (id) values (${MASTER(n)})`);
          await trx.execute(sql`
            insert into product_master_versions (id, master_id, name, supply_price, status)
            values (${VERSION(n)}, ${MASTER(n)}, ${'상품' + n}, ${supply}, 'active')`);
        }

        // V1·V4 → M1, V2 → M2, V3 → M3
        for (const [variant, master] of [
          [1, 1],
          [2, 2],
          [3, 3],
          [4, 1],
        ]) {
          await trx.execute(sql`insert into product_variants (id) values (${VARIANT(variant)})`);
          await trx.execute(sql`
            insert into product_master_variants (id, master_id, variant_id, version_id)
            values (${uuid('77777777', variant)}, ${MASTER(master)}, ${VARIANT(variant)}, ${VERSION(master)})`);
          await trx.execute(sql`
            insert into product_matchings (id, variant_id, master_id)
            values (${MATCHING(variant)}, ${VARIANT(variant)}, ${MASTER(master)})`);
        }

        for (let n = 1; n <= 6; n++) {
          await trx.execute(sql`
            insert into skus (id, holder_id, name, code) values (${SKU(n)}, ${HOLDER}, ${'sku' + n}, ${'C' + n})`);
        }

        // S1→V1(1) · S2→V3(1) · S3→V1(1)+V2(1) · S4→V1(1)+V4(2, 같은 M1 이라 단위원가 500 → 상충)
        for (const [skuN, matchingN, qty] of [
          [1, 1, 1],
          [2, 3, 1],
          [3, 1, 1],
          [3, 2, 1],
          [4, 1, 1],
          [4, 4, 2],
        ]) {
          await trx.execute(sql`
            insert into product_variant_sku_links (product_matching_id, sku_id, quantity)
            values (${MATCHING(matchingN)}, ${SKU(skuN)}, ${qty})`);
        }

        for (const [skuN, whN, locN, state, qty] of [
          [1, 1, 1, 'ON_HAND', 10],
          [1, 1, 1, 'DEFECTIVE', 2],
          [2, 1, 1, 'ON_HAND', 5],
          [3, 1, 1, 'ON_HAND', 3],
          [4, 2, 2, 'ON_HAND', 4],
          [5, 1, 1, 'ON_HAND', 7],
          [6, 1, 1, 'ON_HAND', 0], // 잔량 0 — 집계에서 통째로 빠져야 한다
        ] as Array<[number, number, number, string, number]>) {
          await trx.execute(sql`
            insert into stock_ledgers (sku_id, warehouse_id, location_id, stock_state, qty)
            values (${SKU(skuN)}, ${WH(whN)}, ${LOC(locN)}, ${sql.raw(`'${state}'`)}::stock_state, ${qty})`);
        }

        const reader = new StockValuationReader({
          db: trx,
          run: <R>(fn: (t: unknown) => Promise<R>) => fn(trx),
        } as never);

        result = await run(reader, trx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    return result;
  }

  it('금액은 판정된 SKU 몫만 더하고, 판정 불가는 사유별로 나눠 센다', async () => {
    const summary = await withFixture((reader, trx) => reader.getSummary(trx as never));

    // S1 만 valued — ON_HAND 10 × 1,000
    expect(summary.onHandValue).toBe(10_000);
    // 잔량 0 인 S6 은 빠지고 S1~S5 만 남는다
    expect(summary.onHandQuantity).toBe(29);
    expect(summary.stockedSkuCount).toBe(5);

    expect(summary.costMissing).toEqual({ skuCount: 1, onHandQuantity: 5 });
    expect(summary.multiMaster).toEqual({ skuCount: 1, onHandQuantity: 3 });
    expect(summary.costConflict).toEqual({ skuCount: 1, onHandQuantity: 4 });
    expect(summary.unmatched).toEqual({ skuCount: 1, onHandQuantity: 7 });
  });

  it('상태별·창고별 집계에서 금액을 못 매긴 수량을 따로 남긴다', async () => {
    const summary = await withFixture((reader, trx) => reader.getSummary(trx as never));

    const onHand = summary.states.find((state) => state.state === 'ON_HAND');
    expect(onHand).toEqual({ state: 'ON_HAND', quantity: 29, value: 10_000, uncostedQuantity: 19 });
    // 불량 재고에도 원가는 붙는다 — 판정은 SKU 단위이지 상태 단위가 아니다
    expect(summary.states.find((state) => state.state === 'DEFECTIVE')).toEqual({
      state: 'DEFECTIVE',
      quantity: 2,
      value: 2_000,
      uncostedQuantity: 0,
    });

    const sellable = summary.warehouses.find((warehouse) => warehouse.warehouseName === '판매창고');
    expect(sellable).toMatchObject({ isSellable: true, onHandQuantity: 25, onHandValue: 10_000, uncostedQuantity: 15 });
    const storage = summary.warehouses.find((warehouse) => warehouse.warehouseName === '보관창고');
    expect(storage).toMatchObject({ isSellable: false, onHandQuantity: 4, onHandValue: 0, uncostedQuantity: 4 });
  });

  it('상품별 금액은 귀속 가능한 SKU 만 더하고, 걸쳐 있는 SKU 는 귀속 불가로 따로 표시한다', async () => {
    const products = await withFixture((reader, trx) =>
      reader.getProducts({ page: 1, limit: 50, sort: 'value', order: 'desc' } as never, trx as never),
    );
    const byMaster = new Map(products.data.map((row) => [row.masterId, row]));

    // M1: S1(valued 10개=10,000) + S4(costConflict 4개, 금액 없음) — 둘 다 귀속은 된다
    expect(byMaster.get(MASTER(1))).toMatchObject({
      onHandValue: 10_000,
      onHandQuantity: 14,
      skuCount: 2,
      hasUncostedSku: true,
    });

    // S3 는 M1·M2 에 걸쳐 있어 금액을 어느 쪽에도 못 붙인다 — 수량만 별도 필드로 남는다
    expect(byMaster.get(MASTER(1))?.unattributedSkuCount).toBe(1);
    expect(byMaster.get(MASTER(1))?.unattributedQuantity).toBe(3);
    expect(byMaster.get(MASTER(2))).toMatchObject({
      onHandValue: 0,
      onHandQuantity: 0,
      unattributedSkuCount: 1,
      unattributedQuantity: 3,
    });

    // M3 는 공급가가 없어 금액이 0 이지만 재고가 있다는 사실은 남는다
    expect(byMaster.get(MASTER(3))).toMatchObject({ onHandValue: 0, onHandQuantity: 5, hasUncostedSku: true });

    // 상품을 특정할 수 없는 S5(unmatched)는 상품별 표에 뜨지 않는다 — 요약 버킷에서만 보인다
    expect(products.data.every((row) => row.onHandQuantity + row.unattributedQuantity > 0)).toBe(true);
  });
});
