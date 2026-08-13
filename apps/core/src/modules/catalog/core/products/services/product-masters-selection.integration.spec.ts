// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
// 매핑되는 서브패스로 requireActual 하는 것이 이 레포의 상시 우회다.
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { DbService } from '@app/db';
import { DbTransaction } from '../../../catalog.types';
import {
  catalogSchema,
  type PimSchema,
  productMasters,
  productMasterVersions,
  productCategories,
  productMasterCategories,
  productVariants,
  productMasterVariants,
} from '../../../schema/catalog.schema';
import { ProductMastersService } from './product-masters.service';
import { productSellableQuantityProjections } from '../../../../inventory/schema/inventory.schema';
import { MAX_BULK_PRODUCTS } from '../../../operations/bulk/dto/bulk-operations.dto';

/**
 * 목록(getMasters)과 선택(getMasterSelection)이 **같은 상품 집합**을 보는지 확인한다.
 * 두 경로는 buildMasterListScope 를 공유하지만, 조인 체인은 각각 따로 짓는다 —
 * 갈라지면 화면에 안 보이는 상품이 일괄 수정 대상에 섞인다. 그 사고를 막는 게 이 스위트다.
 *
 * 실행: `npm run test:core:integration:local -- product-masters-selection`
 * 격리: 각 테스트가 트랜잭션을 열어 픽스처를 넣고 항상 롤백한다. DB 에 아무것도 남지 않는다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('상품 목록 ↔ 선택 파리티 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: DbService<PimSchema>;
  let service: ProductMastersService;

  beforeAll(() => {
    // Nest DI 로 CatalogModule 을 띄우지 않는다. EventsModule.forApp 이 InventoryModule
    // 에만 등록돼 있어 ProductSellableQuantityService 의 STREAM_PUBLISHER 토큰이
    // 풀리지 않는다 (같은 이유로 product-masters-variant-preview.integration.spec.ts
    // 가 지금 깨져 있다). 선례인 form-export-snapshot.integration.spec.ts 처럼
    // db+run 만 채운 DbService 와 협력자 스텁으로 직접 조립한다.
    const connection = postgres(DATABASE_URL as string, { max: 1 });
    sql = connection;
    const drizzleDb = drizzle(connection, { schema: catalogSchema });

    db = {
      db: drizzleDb,
      run: <T>(fn: (t: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> =>
        tx ? fn(tx) : drizzleDb.transaction((t) => fn(t)),
    } as unknown as DbService<PimSchema>;

    // getMasters 가 부르는 집계 협력자 셋. 반환값은 전부 `?? 기본값` 으로 소비되므로
    // 빈 Map 이면 충분하다 — 이 스위트가 검증하는 건 **어떤 상품이 걸리는가**이지
    // 각 상품의 미리보기/가격/품절 표시가 아니다. 품절 *필터* 는 SQL 조건이라
    // 스텁의 영향을 받지 않는다.
    const emptyMap = () => Promise.resolve(new Map());
    const readAssembler = { getPrimaryImagesByVersionIds: emptyMap };
    const priceCache = { getPriceSummariesByVersionIds: emptyMap };
    const sellableQuantity = { getSoldOutStateByVersionIds: emptyMap };

    // 나머지 생성자 인자는 getMasters/getMasterSelection 어느 쪽도 건드리지 않는다.
    service = new ProductMastersService(
      db,
      {} as never, // productPublisher
      {} as never, // productVersionsService (forwardRef)
      readAssembler as never,
      {} as never, // pricingCalculatorService
      priceCache as never,
      sellableQuantity as never,
      null, // productMatchingService (@Optional)
    );
  });

  afterAll(async () => {
    await sql?.end();
  });

  /**
   * 픽스처를 넣고 검증한 뒤 항상 롤백한다. DbService.run 은 tx 인자가 없으면
   * 새 트랜잭션을 열므로, 안에서 던지면 통째로 되돌아간다.
   */
  async function inRollbackTx<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    let captured!: T;
    await expect(
      db.run(async (tx) => {
        captured = await fn(tx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
    return captured;
  }

  /**
   * 마스터 1건 + active 버전 1건. 최소 컬럼만 채운다 — 나머지는 스키마 기본값이 있다.
   * `stock` 을 주면 품목 1개와 그 품목의 판매가능수량 투영을 함께 심는다
   * (품절 필터가 EXISTS 서브쿼리로 그 투영을 읽는다). `stocks` 로 여러 개를 주면
   * 품목이 그 수만큼 생긴다 — 한 버전에 품절/정상이 섞인 partial 을 만들 때 쓴다.
   */
  async function seedMaster(
    tx: DbTransaction,
    opts: {
      brand?: string;
      status?: 'active' | 'inactive' | 'draft';
      categoryId?: string;
      /** 여러 카테고리에 동시에 매핑한다 — 카테고리 이너 조인의 팬아웃 재현용. */
      categoryIds?: string[];
      isOverseas?: boolean;
      supplierId?: string;
      /** product_sellable_quantity_projections.reason 에 그대로 들어간다. */
      stock?: 'MANUAL_OUT_OF_STOCK' | 'IN_STOCK';
      /** 품목별 재고 상태. 섞어 주면 한 버전 안에 품절/정상이 공존한다. */
      stocks?: ('MANUAL_OUT_OF_STOCK' | 'IN_STOCK')[];
    },
  ): Promise<string> {
    const masterId = randomUUID();
    await tx.insert(productMasters).values({ id: masterId, createdBy: null });
    const [version] = await tx
      .insert(productMasterVersions)
      .values({
        masterId,
        name: `파리티-${masterId.slice(0, 8)}`,
        brand: opts.brand ?? null,
        status: opts.status ?? 'active',
        isOverseas: opts.isOverseas ?? false,
        supplierId: opts.supplierId ?? null,
      })
      .returning({ id: productMasterVersions.id });

    const categoryIds = opts.categoryIds ?? (opts.categoryId ? [opts.categoryId] : []);
    for (const categoryId of categoryIds) {
      await tx.insert(productMasterCategories).values({ masterId, versionId: version.id, categoryId });
    }

    const stocks = opts.stocks ?? (opts.stock ? [opts.stock] : []);
    for (const [index, stock] of stocks.entries()) {
      const variantId = randomUUID();
      await tx.insert(productVariants).values({ id: variantId, isDefault: index === 0 });
      await tx.insert(productMasterVariants).values({ masterId, variantId, versionId: version.id });
      await tx.insert(productSellableQuantityProjections).values({
        variantId,
        masterId,
        versionId: version.id,
        reason: stock,
        isSellable: stock === 'IN_STOCK',
        calculatedAt: new Date(),
      });
    }

    return masterId;
  }

  // getMasters 의 product 는 product_masters 행 + version 이라 master id 는 `product.id` 다
  // (`masterId` 는 version 쪽 컬럼명이라 여기엔 없다).
  const idsOf = (r: { data: { product: { id: string } }[] }) => new Set(r.data.map((d) => d.product.id));

  it('브랜드 필터: 목록과 선택이 같은 집합을 본다', async () => {
    await inRollbackTx(async (tx) => {
      const brand = `브랜드-${randomUUID().slice(0, 8)}`;
      const hit = await seedMaster(tx, { brand });
      await seedMaster(tx, { brand: '다른브랜드' });

      const list = await service.getMasters({ brand, page: 1, limit: 100 }, tx);
      const selection = await service.getMasterSelection({ brand }, tx);

      expect(idsOf(list)).toEqual(new Set([hit]));
      expect(new Set(selection.items.map((i) => i.masterId))).toEqual(idsOf(list));
      expect(selection.total).toBe(list.total);
    });
  });

  it('mode=all: draft 만 있는 상품도 양쪽에 똑같이 들어온다', async () => {
    await inRollbackTx(async (tx) => {
      const brand = `브랜드-${randomUUID().slice(0, 8)}`;
      const draftOnly = await seedMaster(tx, { brand, status: 'draft' });

      const list = await service.getMasters({ brand, mode: 'all', page: 1, limit: 100 }, tx);
      const selection = await service.getMasterSelection({ brand, mode: 'all' }, tx);

      expect(idsOf(list)).toContain(draftOnly);
      expect(new Set(selection.items.map((i) => i.masterId))).toEqual(idsOf(list));
    });
  });

  it('카테고리 필터: 하위 카테고리 포함 범위가 양쪽에서 같다', async () => {
    await inRollbackTx(async (tx) => {
      const parentId = randomUUID();
      const childId = randomUUID();
      // slug 는 NOT NULL + UNIQUE 라 픽스처에서 반드시 채운다.
      await tx
        .insert(productCategories)
        .values({ id: parentId, name: `상위-${parentId.slice(0, 8)}`, slug: `parent-${parentId}` });
      await tx
        .insert(productCategories)
        .values({ id: childId, name: `하위-${childId.slice(0, 8)}`, slug: `child-${childId}`, parentId });
      const inChild = await seedMaster(tx, { categoryId: childId });

      const list = await service.getMasters({ categoryId: parentId, page: 1, limit: 100 }, tx);
      const selection = await service.getMasterSelection({ categoryId: parentId }, tx);

      expect(idsOf(list)).toContain(inChild);
      expect(new Set(selection.items.map((i) => i.masterId))).toEqual(idsOf(list));
    });
  });

  it('상·하위 카테고리에 동시 매핑된 상품도 선택에는 한 번만 담긴다', async () => {
    await inRollbackTx(async (tx) => {
      const parentId = randomUUID();
      const childId = randomUUID();
      await tx
        .insert(productCategories)
        .values({ id: parentId, name: `상위-${parentId.slice(0, 8)}`, slug: `parent-${parentId}` });
      await tx
        .insert(productCategories)
        .values({ id: childId, name: `하위-${childId.slice(0, 8)}`, slug: `child-${childId}`, parentId });
      // 상위·하위 **둘 다**에 매핑한다. 상위로 필터하면 재귀 CTE 가 두 카테고리를 모두 잡아
      // product_master_categories 이너 조인이 같은 마스터 행을 두 벌 만든다(팬아웃).
      const both = await seedMaster(tx, { categoryIds: [parentId, childId] });

      const list = await service.getMasters({ categoryId: parentId, page: 1, limit: 100 }, tx);
      const selection = await service.getMasterSelection({ categoryId: parentId }, tx);

      // 팬아웃이 실제로 일어났음을 먼저 못박는다 — 이게 2가 아니면 아래 중복 제거 단언이
      // 공허하게 통과한다. 목록의 팬아웃은 물려받은 동작이라 이 브랜치에서 고치지 않는다.
      expect(list.data).toHaveLength(2);

      // 선택은 마스터당 정확히 한 번. total 도 중복 제거 후의 수다(다음 단계의 상한 판정 근거).
      expect(selection.items.filter((i) => i.masterId === both)).toHaveLength(1);
      expect(selection.items).toHaveLength(1);
      expect(selection.total).toBe(1);

      // 그럼에도 두 경로가 보는 상품 **집합**은 여전히 같다.
      expect(new Set(selection.items.map((i) => i.masterId))).toEqual(idsOf(list));
      expect(idsOf(list)).toEqual(new Set([both]));
    });
  });

  it('페이지 경계를 넘는 결과도 선택은 전량을 준다', async () => {
    await inRollbackTx(async (tx) => {
      const brand = `브랜드-${randomUUID().slice(0, 8)}`;
      for (let i = 0; i < 25; i += 1) await seedMaster(tx, { brand });

      const page1 = await service.getMasters({ brand, page: 1, limit: 10 }, tx);
      const selection = await service.getMasterSelection({ brand }, tx);

      expect(page1.data).toHaveLength(10);
      expect(selection.items).toHaveLength(25);
      expect(selection.total).toBe(25);
    });
  });

  it('공급처 unassigned sentinel: 미지정 상품이 양쪽에 똑같이 들어온다', async () => {
    await inRollbackTx(async (tx) => {
      const brand = `브랜드-${randomUUID().slice(0, 8)}`;
      const supplierId = randomUUID();
      const unassigned = await seedMaster(tx, { brand });
      const assigned = await seedMaster(tx, { brand, supplierId });

      const filters = { brand, supplierId: ['unassigned', supplierId] };
      const list = await service.getMasters({ ...filters, page: 1, limit: 100 }, tx);
      const selection = await service.getMasterSelection(filters, tx);

      expect(idsOf(list)).toEqual(new Set([unassigned, assigned]));
      expect(new Set(selection.items.map((i) => i.masterId))).toEqual(idsOf(list));
    });
  });

  it('품절 필터: sold_out 범위가 양쪽에서 같다', async () => {
    await inRollbackTx(async (tx) => {
      const brand = `브랜드-${randomUUID().slice(0, 8)}`;
      const soldOut = await seedMaster(tx, { brand, stock: 'MANUAL_OUT_OF_STOCK' });
      await seedMaster(tx, { brand, stock: 'IN_STOCK' });

      const list = await service.getMasters({ brand, stock: 'sold_out', page: 1, limit: 100 }, tx);
      const selection = await service.getMasterSelection({ brand, stock: 'sold_out' }, tx);

      expect(idsOf(list)).toEqual(new Set([soldOut]));
      expect(new Set(selection.items.map((i) => i.masterId))).toEqual(idsOf(list));
    });
  });

  it('품절 필터: partial 범위가 양쪽에서 같다', async () => {
    await inRollbackTx(async (tx) => {
      const brand = `브랜드-${randomUUID().slice(0, 8)}`;
      // partial = 한 버전 안에 품절 품목과 품절 아닌 품목이 **둘 다** 있는 상태.
      const partial = await seedMaster(tx, { brand, stocks: ['MANUAL_OUT_OF_STOCK', 'IN_STOCK'] });
      // 경계의 반대편 둘: 전량 품절(sold_out)과 전량 정상(in_stock)은 걸리면 안 된다.
      await seedMaster(tx, { brand, stock: 'MANUAL_OUT_OF_STOCK' });
      await seedMaster(tx, { brand, stock: 'IN_STOCK' });

      const list = await service.getMasters({ brand, stock: 'partial', page: 1, limit: 100 }, tx);
      const selection = await service.getMasterSelection({ brand, stock: 'partial' }, tx);

      expect(idsOf(list)).toEqual(new Set([partial]));
      expect(new Set(selection.items.map((i) => i.masterId))).toEqual(idsOf(list));
    });
  });

  it('상한을 넘는 결과는 상한+1 에서 끊기고, 그래도 초과로 잡힌다', async () => {
    await inRollbackTx(async (tx) => {
      const brand = `브랜드-${randomUUID().slice(0, 8)}`;
      // 상한보다 확실히 많게 심는다. 한 건씩 넣으면 만 단위 왕복이라 배치로 넣는다.
      const total = MAX_BULK_PRODUCTS + 10;
      const masterIds = Array.from({ length: total }, () => randomUUID());
      const CHUNK = 1000;
      for (let i = 0; i < masterIds.length; i += CHUNK) {
        const chunk = masterIds.slice(i, i + CHUNK);
        await tx.insert(productMasters).values(chunk.map((id) => ({ id, createdBy: null })));
        await tx.insert(productMasterVersions).values(
          chunk.map((masterId) => ({
            masterId,
            name: `상한-${masterId.slice(0, 8)}`,
            brand,
            status: 'active' as const,
          })),
        );
      }

      const selection = await service.getMasterSelection({ brand }, tx);

      // LIMIT 이 실제로 걸렸다 — 전량(total)이 아니라 상한+1 에서 멈춘다.
      expect(selection.items).toHaveLength(MAX_BULK_PRODUCTS + 1);
      expect(selection.total).toBe(MAX_BULK_PRODUCTS + 1);
      // 그리고 그 수는 컨트롤러의 `total > MAX_BULK_PRODUCTS` 를 여전히 발동시킨다.
      expect(selection.total).toBeGreaterThan(MAX_BULK_PRODUCTS);
      // 잘린 행들도 마스터 단위로 서로 다르다 — 중복 제거가 상한 판정보다 먼저다.
      expect(new Set(selection.items.map((i) => i.masterId)).size).toBe(selection.items.length);
    });
  });

  it('정책 플래그를 실제 값 그대로 싣는다', async () => {
    await inRollbackTx(async (tx) => {
      const brand = `브랜드-${randomUUID().slice(0, 8)}`;
      const overseas = await seedMaster(tx, { brand, isOverseas: true });

      const selection = await service.getMasterSelection({ brand }, tx);

      expect(selection.items.find((i) => i.masterId === overseas)?.isOverseas).toBe(true);
    });
  });
});
