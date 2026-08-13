# 상품 목록 페이지 크기 선택 · 필터 결과 전체 선택 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품 목록에서 페이지당 표시 개수(20/50/100)를 고르고, 필터에 걸린 결과 전체(최대 5000건)를 한 번에 선택할 수 있게 한다.

**Architecture:** core 에 `GET /masters/selection` 라우트를 새로 열어 필터에 걸린 masterId + 정책 플래그 3종만 한 번에 반환한다. 목록 조회와 선택 조회가 **같은 필터 스코프 빌더**를 공유하게 만들어 두 결과가 어긋날 수 없게 하고, 그 등가성을 통합 테스트로 못 박는다. admin-web 은 페이지 크기를 URL 파라미터 `size` 로 들고, 판정 로직은 전부 순수 함수로 뽑아 단위 테스트한다.

**Tech Stack:** NestJS + Drizzle ORM (postgres.js) / Next.js + TanStack Table + TanStack Query / Jest

**Spec:** `docs/superpowers/specs/2026-08-13-product-list-page-size-design.md`

## Global Constraints

- 페이지 크기 선택지는 **20 / 50 / 100** 뿐. 기본 20. 그 외 값은 20으로 폴백한다.
- 전체 선택 상한은 **5000건**. 서버 에러 문구는 정확히 `선택 가능한 범위를 넘었습니다. 필터를 좁혀주세요.`
- 마이그레이션 **0건**. 스키마 파일을 건드리지 않는다.
- 배포 순서는 **core → admin-web**.
- core 서비스 코드는 `any` / `as` 캐스팅 금지. `db.query.*` 와 `with` 관계 조회 금지. `trx.select().from().innerJoin().where()` 만 쓴다.
- core 예외는 `@app/shared` 의 도메인 예외(`BadRequestError` 등)를 던진다. `HttpException` 을 서비스에서 import 하지 않는다.
- admin-web 은 **컴포넌트 테스트가 불가능하다** — jest transform 이 `^.+\.(t|j)s$` 라 `.tsx` 가 대상 밖이다. 판정 로직은 반드시 `.ts` 파일의 순수 함수로 뽑아야 검증된다.
- 작업 브랜치: `feat/product-list-page-size` (worktree `.claude/worktrees/feat+product-list-page-size`). base 는 `origin/develop` = `6db578644`.
- **`npx nest build core` 는 이 레포에서 지금 깨져 있다** — `@nestjs/microservices` 의 선택적 peer(`amqp-connection-manager`·`nats`·`mqtt`·`amqplib`)와 `@fastify/view` 가 설치돼 있지 않아 webpack 이 12개 module-not-found 로 죽는다. 이 작업과 무관한 사전 상태다. core 쪽 타입 게이트는 `npm run type-check` 를 쓴다 (기준선 **159건**).

## 스펙에서 바뀐 결정 하나

스펙 §1.2 는 "`where` 빌드를 별도 함수로 추출하지 않는다"고 적었다. **이 계획은 추출한다** (Task 2). 추출하지 않으면 `getMasters` 가 목록 결과와 선택 결과 두 모양을 union 으로 반환해야 해서 호출부 타입이 더러워진다. 추출이 만드는 위험(두 경로의 필터가 갈라지는 것)은 Task 3 의 파리티 통합 테스트가 정면으로 막는다 — 그게 그 테스트의 존재 이유다.

## File Structure

**core (신규)**
- `apps/core/src/modules/catalog/core/products/dto/master-selection-response.dto.ts` — `GET /masters/selection` 응답 DTO
- `apps/core/src/modules/catalog/core/products/services/product-masters-selection.integration.spec.ts` — 목록 ↔ 선택 파리티 통합 테스트
- `apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.spec.ts` — 벌크 DTO 배열 상한 단위 테스트

**core (수정)**
- `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts` — 필터 스코프 추출 + `getMasterSelection` 추가
- `apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.ts` — `GET /masters/selection` 라우트
- `apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.ts` — `productIds` 배열 상한

**admin-web (신규)**
- `apps/admin-web/src/features/mall/products-list/components/table/products-list-page-size-model.ts` (+ `.spec.ts`) — `parsePageSize` / `hasActiveFilter` / `canSelectAll`
- `apps/admin-web/src/features/mall/products-list/components/filter-box/products-list-search-params.ts` (+ `.spec.ts`) — `buildSearchParams`
- `apps/admin-web/src/features/mall/products-list/components/table/page-size-select.tsx` — 툴바 셀렉터

**admin-web (수정)**
- `apps/admin-web/src/lib/api/domains/products/masters.client.ts` — `getSelection`
- `apps/admin-web/src/lib/types/dto/products.ts` — 선택 응답 타입
- `apps/admin-web/src/lib/services/products/queries.ts`, `query-keys.ts` — 선택 조회 훅
- `apps/admin-web/src/hooks/table/query/use-products-list-table-query.ts` — `brand` 는 이미 읽음, 변경 없음(확인만)
- `apps/admin-web/src/features/mall/products-list/components/table/index.tsx` — `PAGE_SIZE` 제거, 툴바 배선
- `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts` — `selectionFromItems`
- `apps/admin-web/src/features/mall/products-list/components/filter-box/index.tsx` — 브랜드 입력 + `buildSearchParams` 사용
- `apps/admin-web/src/features/mall/products-list/components/selected-products-modal/index.tsx` — 200행 상한

---

### Task 1: 벌크 DTO 배열 상한

지금 `productIds` 에 배열 상한이 **아예 없다**. 전체 선택을 열기 전에 먼저 막는다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.spec.ts` (create)

**Interfaces:**
- Consumes: 없음
- Produces: `MAX_BULK_PRODUCTS = 5000` (같은 파일에서 export). Task 4·9 가 문구·상한을 맞출 때 참조한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BulkUpdateDto, BulkDeleteDto, BulkRestoreDto, BulkPolicyDto, MAX_BULK_PRODUCTS } from './bulk-operations.dto';

const ID = '00000000-0000-4000-8000-000000000000';

describe.each([
  ['BulkUpdateDto', BulkUpdateDto],
  ['BulkDeleteDto', BulkDeleteDto],
  ['BulkRestoreDto', BulkRestoreDto],
  ['BulkPolicyDto', BulkPolicyDto],
])('%s productIds 상한', (_name, Dto) => {
  const validate = (productIds: string[]) =>
    validateSync(plainToInstance(Dto as never, { productIds }));

  it('빈 배열을 거부한다', () => {
    expect(validate([])).not.toHaveLength(0);
  });

  it('상한(5000)까지는 통과한다', () => {
    expect(validate(Array.from({ length: MAX_BULK_PRODUCTS }, () => ID))).toHaveLength(0);
  });

  it('상한을 넘으면 거부한다', () => {
    expect(validate(Array.from({ length: MAX_BULK_PRODUCTS + 1 }, () => ID))).not.toHaveLength(0);
  });
});

it('MAX_BULK_PRODUCTS 는 양식 다운로드 상한과 같다', () => {
  expect(MAX_BULK_PRODUCTS).toBe(5000);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.spec.ts`
Expected: FAIL — `MAX_BULK_PRODUCTS` 가 export 되지 않아 import 에서 죽는다.

- [ ] **Step 3: DTO 에 상한을 단다**

`bulk-operations.dto.ts` 의 import 줄에 `ArrayMaxSize`, `ArrayNotEmpty` 를 더하고, 네 클래스의 `productIds` 마다 아래 두 데코레이터를 `@IsArray()` 아래에 붙인다.

```ts
import { IsArray, IsString, IsOptional, IsEnum, IsInt, IsBoolean, Min, ArrayMaxSize, ArrayNotEmpty } from 'class-validator';

/** 한 번에 다룰 수 있는 상품 수. 양식 다운로드(MAX_FORM_EXPORT_PRODUCTS)와 같은 값이다. */
export const MAX_BULK_PRODUCTS = 5000;

export class BulkUpdateDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_PRODUCTS, { message: `한 번에 최대 ${MAX_BULK_PRODUCTS}개까지 선택할 수 있습니다.` })
  @IsString({ each: true })
  productIds: string[];
  // ... 나머지 필드는 그대로
}
```

`BulkDeleteDto`·`BulkRestoreDto`·`BulkPolicyDto` 도 똑같이 `@ArrayNotEmpty()` + `@ArrayMaxSize(...)` 를 붙인다. 네 곳 전부다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.spec.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: 빌드가 깨지지 않는지 본다**

Run: `npm run type-check`
Expected: 기준선(159건) 대비 **새 에러 0건**

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.ts apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.spec.ts
git commit -m "fix(catalog): 벌크 상품 액션에 5000건 배열 상한을 건다"
```

---

### Task 2: 목록 필터 스코프 추출 (동작 무변경)

`getMasters` 안의 "어떤 상품이 걸리는가"를 정하는 부분만 private 메서드로 뽑는다. **동작은 한 톨도 바뀌지 않는다.** 이 태스크의 성공 기준은 "기존 테스트가 전부 그대로 통과"다.

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts:306-502`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export type MasterListFilters` — `getMasters` 의 인라인 filters 타입을 그대로 옮긴 이름 있는 타입
  - `private async buildMasterListScope(trx: DbTransaction, filters: MasterListFilters)` — 반환값은 `{ mode, rankedVersionsSubquery, categoryIds, whereClause }`. 반환 타입은 **명시하지 않고 추론에 맡긴다** (drizzle 서브쿼리 타입을 손으로 적으면 `any` 로 새기 쉽다).

- [ ] **Step 1: filters 인라인 타입을 이름 있는 타입으로 올린다**

`product-masters.service.ts` 의 `getMasters` 시그니처에 인라인으로 적힌 filters 객체 타입(`mode?`부터 `stock?`까지)을 파일 상단(다른 export 들 근처)으로 옮긴다.

```ts
export type MasterListFilters = {
  mode?: MasterListMode;
  categoryId?: string;
  brand?: string;
  name?: string;
  page?: number;
  limit?: number;
  deleted?: boolean;
  ids?: string[];
  status?: 'active' | 'inactive' | 'draft';
  productType?: 'regular_sale' | 'limited_edition';
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  createdBy?: string;
  supplierId?: string | string[];
  createdFrom?: string;
  createdTo?: string;
  sort?: 'createdAt' | 'name' | 'updatedAt';
  order?: 'asc' | 'desc';
  // 품절 상태 필터. soldOutState 는 후처리 계산이라 SQL 페이징과 함께 걸 수 없어
  // 별도 경로로 처리한다. all=필터 없음.
  stock?: 'all' | 'in_stock' | 'partial' | 'sold_out';
};
```

`getMasters` 시그니처는 `async getMasters(filters?: MasterListFilters, tx?: DbTransaction)` 가 된다. 반환 타입 선언은 건드리지 않는다.

- [ ] **Step 2: 스코프 빌더를 뽑는다**

`getMasters` 본문에서 아래 조각들을 **잘라내** 새 private 메서드로 옮긴다. 위치는 `getMasters` 바로 아래, `buildStockFilterCondition` 위.

옮기는 것:
- `const mode = filters?.mode ?? 'active';`
- `const deleted = filters?.deleted ?? false;`
- `const stockFilter = ...` 한 줄
- `rankedVersionStatuses` / `rankedVersionsSubquery` 블록 전체
- 카테고리 recursive CTE 블록 (`let categoryIds` ~ `categoryIds = categoryTreeResult.map(...)`)
- `whereConditions` 배열 빌드 전체 (soft delete·brand·키워드·ids·productType·status·approvalStatus·createdBy·공급처·등록일 범위·stock·모드별 버전 필터)
- `const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;`

```ts
/**
 * 목록 조회와 선택 조회가 공유하는 "어떤 상품이 걸리는가" 스코프.
 *
 * 두 경로가 같은 필터를 보게 만드는 게 이 메서드의 존재 이유다 — 갈라지면
 * 화면에 안 보이는 상품이 일괄 수정 대상에 섞인다.
 * 등가성은 product-masters-selection.integration.spec.ts 가 지킨다.
 */
private async buildMasterListScope(trx: DbTransaction, filters: MasterListFilters) {
  const mode = filters.mode ?? 'active';
  const deleted = filters.deleted ?? false;
  const stockFilter = filters.stock && filters.stock !== 'all' ? filters.stock : undefined;

  // ... (위에서 잘라낸 코드 그대로. filters?.x 는 filters.x 로 바꾼다 — 이제 non-optional 이다)

  return { mode, rankedVersionsSubquery, categoryIds, whereClause };
}
```

- [ ] **Step 3: `getMasters` 에서 호출로 바꾼다**

페이징 계산(`returnAll`/`page`/`limit`/`offset`)은 `getMasters` 에 그대로 남기고, 그 아래에 한 줄을 넣는다.

```ts
const { mode, rankedVersionsSubquery, categoryIds, whereClause } = await this.buildMasterListScope(trx, filters ?? {});
```

이후 COUNT 쿼리·DATA 쿼리 블록은 **손대지 않는다** — 같은 이름의 지역 변수를 그대로 쓴다.

- [ ] **Step 4: 타입과 빌드를 확인한다**

Run: `npm run type-check`
Expected: 기준선(159건) 대비 **새 에러 0건**. `any` 가 새로 생기지 않았는지 `buildMasterListScope` 반환값을 IDE 로 확인한다.

- [ ] **Step 5: 기존 테스트가 그대로 통과하는지 본다**

Run: `npx jest --testPathPattern='product-masters|list-product-masters'`
Expected: PASS. 실패가 하나라도 나면 잘라 붙이는 과정에서 조건을 빠뜨린 것이다 — 되돌리고 다시 옮긴다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-masters.service.ts
git commit -m "refactor(catalog): 목록 필터 스코프를 buildMasterListScope 로 뽑는다"
```

---

### Task 3: `getMasterSelection` + 파리티 통합 테스트

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts`
- Test: `apps/core/src/modules/catalog/core/products/services/product-masters-selection.integration.spec.ts` (create)

**Interfaces:**
- Consumes: `MasterListFilters`, `buildMasterListScope` (Task 2)
- Produces:
  ```ts
  export type MasterSelectionItem = {
    masterId: string;
    hideMembershipPriceForNonMembers: boolean;
    isVisibleToMembersOnly: boolean;
    isOverseas: boolean;
  };

  async getMasterSelection(
    filters: MasterListFilters,
    tx?: DbTransaction,
  ): Promise<{ items: MasterSelectionItem[]; total: number }>
  ```
  Task 4 의 컨트롤러가 이 시그니처를 그대로 부른다.

- [ ] **Step 1: 실패하는 파리티 테스트를 쓴다**

```ts
// apps/core/src/modules/catalog/core/products/services/product-masters-selection.integration.spec.ts
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
import { catalogSchema } from '../../../schema/catalog.schema';
import { ProductMastersService } from './product-masters.service';
import {
  type PimSchema,
  productMasters,
  productMasterVersions,
  productCategories,
  productMasterCategories,
  productVariants,
  productMasterVariants,
} from '../../../schema/catalog.schema';
import { productSellableQuantityProjections } from '../../../../inventory/schema/inventory.schema';

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
   * (품절 필터가 EXISTS 서브쿼리로 그 투영을 읽는다).
   */
  async function seedMaster(
    tx: DbTransaction,
    opts: {
      brand?: string;
      status?: 'active' | 'inactive' | 'draft';
      categoryId?: string;
      isOverseas?: boolean;
      supplierId?: string;
      /** product_sellable_quantity_projections.reason 에 그대로 들어간다. */
      stock?: 'MANUAL_OUT_OF_STOCK' | 'IN_STOCK';
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

    if (opts.categoryId) {
      await tx
        .insert(productMasterCategories)
        .values({ masterId, versionId: version.id, categoryId: opts.categoryId });
    }

    if (opts.stock) {
      const variantId = randomUUID();
      await tx.insert(productVariants).values({ id: variantId, isDefault: true });
      await tx.insert(productMasterVariants).values({ masterId, variantId, versionId: version.id });
      await tx.insert(productSellableQuantityProjections).values({
        variantId,
        masterId,
        versionId: version.id,
        reason: opts.stock,
        isSellable: opts.stock === 'IN_STOCK',
        calculatedAt: new Date(),
      });
    }

    return masterId;
  }

  const idsOf = (r: { data: { product: { masterId: string } }[] }) =>
    new Set(r.data.map((d) => d.product.masterId));

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
      await tx.insert(productCategories).values({ id: parentId, name: `상위-${parentId.slice(0, 8)}` });
      await tx
        .insert(productCategories)
        .values({ id: childId, name: `하위-${childId.slice(0, 8)}`, parentId });
      const inChild = await seedMaster(tx, { categoryId: childId });

      const list = await service.getMasters({ categoryId: parentId, page: 1, limit: 100 }, tx);
      const selection = await service.getMasterSelection({ categoryId: parentId }, tx);

      expect(idsOf(list)).toContain(inChild);
      expect(new Set(selection.items.map((i) => i.masterId))).toEqual(idsOf(list));
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

  it('정책 플래그를 실제 값 그대로 싣는다', async () => {
    await inRollbackTx(async (tx) => {
      const brand = `브랜드-${randomUUID().slice(0, 8)}`;
      const overseas = await seedMaster(tx, { brand, isOverseas: true });

      const selection = await service.getMasterSelection({ brand }, tx);

      expect(selection.items.find((i) => i.masterId === overseas)?.isOverseas).toBe(true);
    });
  });
});
```

> **주의 1:** 생성자 인자 순서는 구현 시점의 `ProductMastersService` 시그니처를 직접 읽어 맞춰라. 위 목록은 `(db, productPublisher, productVersionsService, productReadAssembler, pricingCalculatorService, priceCacheService, productSellableQuantity, productMatchingService)` 기준이다.
>
> **주의 2:** 스텁에 쓰는 `as never` 는 이 파일(테스트)에서만 허용된다. 서비스 코드에는 캐스팅을 넣지 마라.
>
> **주의 3:** `product_sellable_quantity_projections` 는 inventory 스키마의 테이블이라 `catalogSchema` 에 없다. drizzle 인스턴스에 `catalogSchema` 만 넘겨도 `trx.insert(테이블객체)` 는 동작한다 — `schema` 옵션은 관계형 조회(`db.query.*`)에만 쓰이고 이 스위트는 그걸 쓰지 않는다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:core:integration:local -- product-masters-selection`
Expected: FAIL — `service.getMasterSelection is not a function`

- [ ] **Step 3: `getMasterSelection` 을 구현한다**

`getMasters` 바로 아래에 넣는다. COUNT 쿼리와 DATA 쿼리가 조인 체인을 각각 짓는 것과 같은 형태의 세 번째 형제다.

```ts
export type MasterSelectionItem = {
  masterId: string;
  hideMembershipPriceForNonMembers: boolean;
  isVisibleToMembersOnly: boolean;
  isOverseas: boolean;
};

/**
 * 필터에 걸린 상품 전량의 id + 정책 플래그. 목록의 집계(미리보기·가격·품절)는 전부 건너뛴다.
 *
 * 정책 플래그를 함께 싣는 이유: 화면의 일괄 정책 변경 모달이 선택 항목의 플래그를 세어
 * "몇 건이 바뀝니다"를 보여준다. id 만 주면 그 수가 전부 false 로 잡혀 틀린 수를 보고한다.
 * 세 플래그는 이미 조인된 product_master_versions 의 컬럼이라 쿼리가 늘지 않는다.
 *
 * page/limit 은 무시한다 — 이 메서드는 언제나 전량을 반환한다.
 */
async getMasterSelection(
  filters: MasterListFilters,
  tx?: DbTransaction,
): Promise<{ items: MasterSelectionItem[]; total: number }> {
  return this.db.run(async (trx) => {
    const { mode, rankedVersionsSubquery, categoryIds, whereClause } = await this.buildMasterListScope(trx, filters);

    const projection = {
      masterId: productMasters.id,
      hideMembershipPriceForNonMembers: productMasterVersions.hideMembershipPriceForNonMembers,
      isVisibleToMembersOnly: productMasterVersions.isVisibleToMembersOnly,
      isOverseas: productMasterVersions.isOverseas,
    };

    const baseQuery =
      mode === 'active'
        ? trx
            .select(projection)
            .from(productMasters)
            .innerJoin(productMasterVersions, eq(productMasters.id, productMasterVersions.masterId))
        : trx
            .select(projection)
            .from(productMasters)
            .innerJoin(rankedVersionsSubquery!, eq(productMasters.id, rankedVersionsSubquery!.masterId))
            .innerJoin(productMasterVersions, eq(rankedVersionsSubquery!.versionId, productMasterVersions.id));

    const withCategory =
      categoryIds && categoryIds.length > 0
        ? baseQuery.innerJoin(
            productMasterCategories,
            and(
              eq(productMasterCategories.masterId, productMasters.id),
              eq(productMasterCategories.versionId, productMasterVersions.id),
              inArray(productMasterCategories.categoryId, categoryIds),
            ),
          )
        : baseQuery;

    const items = await (whereClause ? withCategory.where(whereClause) : withCategory);

    return { items, total: items.length };
  }, tx);
}
```

`total` 을 별도 COUNT 쿼리로 다시 세지 않는다 — 전량을 이미 손에 쥐고 있으므로 `items.length` 가 정의상 같은 값이고, 쿼리가 하나 줄어든다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:core:integration:local -- product-masters-selection`
Expected: PASS (7 tests)

워크트리에서 5432 포트가 충돌하면 앞에 `COMPOSE_PROJECT_NAME=almondyoung-server` 를 붙인다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-masters.service.ts apps/core/src/modules/catalog/core/products/services/product-masters-selection.integration.spec.ts
git commit -m "feat(catalog): 필터에 걸린 상품 전량의 선택 목록을 반환한다"
```

---

### Task 4: `GET /masters/selection` 라우트

**Files:**
- Create: `apps/core/src/modules/catalog/core/products/dto/master-selection-response.dto.ts`
- Modify: `apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.ts`
- Test: `apps/core/src/modules/catalog/core/products/controllers/product-masters-selection.controller.spec.ts` (create)

**Interfaces:**
- Consumes: `getMasterSelection` (Task 3), `MAX_BULK_PRODUCTS` (Task 1)
- Produces: `GET /masters/selection` → `{ items: MasterSelectionItemDto[]; total: number }`. Task 6 의 admin-web 클라이언트가 이 모양을 그대로 받는다.

- [ ] **Step 1: 실패하는 컨트롤러 테스트를 쓴다**

```ts
// apps/core/src/modules/catalog/core/products/controllers/product-masters-selection.controller.spec.ts
import { BadRequestError } from '@app/shared';
import { ProductMastersController } from './product-masters.controller';
import { MAX_BULK_PRODUCTS } from '../../../operations/bulk/dto/bulk-operations.dto';

describe('GET /masters/selection', () => {
  const item = (masterId: string) => ({
    masterId,
    hideMembershipPriceForNonMembers: false,
    isVisibleToMembersOnly: false,
    isOverseas: false,
  });

  function build(total: number) {
    const items = Array.from({ length: Math.min(total, 3) }, (_, i) => item(`id-${i}`));
    const service = { getMasterSelection: jest.fn().mockResolvedValue({ items, total }) };
    const controller = new ProductMastersController(
      {} as never,
      service as never,
      {} as never,
    );
    return { controller, service };
  }

  it('필터를 서비스에 그대로 넘긴다', async () => {
    const { controller, service } = build(2);
    await controller.getMasterSelection({ brand: '정관장', mode: 'all' } as never);
    expect(service.getMasterSelection).toHaveBeenCalledWith(
      expect.objectContaining({ brand: '정관장', mode: 'all' }),
    );
  });

  it('상한 이하는 그대로 반환한다', async () => {
    const { controller } = build(MAX_BULK_PRODUCTS);
    await expect(controller.getMasterSelection({} as never)).resolves.toMatchObject({
      total: MAX_BULK_PRODUCTS,
    });
  });

  it('상한을 넘으면 BadRequestError 를 던진다', async () => {
    const { controller } = build(MAX_BULK_PRODUCTS + 1);
    await expect(controller.getMasterSelection({} as never)).rejects.toThrow(BadRequestError);
    await expect(controller.getMasterSelection({} as never)).rejects.toThrow(
      '선택 가능한 범위를 넘었습니다. 필터를 좁혀주세요.',
    );
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/products/controllers/product-masters-selection.controller.spec.ts`
Expected: FAIL — `controller.getMasterSelection is not a function`

- [ ] **Step 3: 응답 DTO 를 만든다**

```ts
// apps/core/src/modules/catalog/core/products/dto/master-selection-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class MasterSelectionItemDto {
  @ApiProperty({ description: '상품 마스터 ID' })
  masterId: string;

  @ApiProperty({ description: '비회원에게 멤버십가를 숨김' })
  hideMembershipPriceForNonMembers: boolean;

  @ApiProperty({ description: '멤버십 회원 전용 노출' })
  isVisibleToMembersOnly: boolean;

  @ApiProperty({ description: '해외직구 상품' })
  isOverseas: boolean;
}

export class MasterSelectionResponseDto {
  @ApiProperty({ type: [MasterSelectionItemDto] })
  items: MasterSelectionItemDto[];

  @ApiProperty({ description: '필터에 걸린 상품 수. items 길이와 항상 같다.' })
  total: number;
}
```

- [ ] **Step 4: 라우트를 단다**

`product-masters.controller.ts` 의 `@Get()` 목록 핸들러 **바로 아래**, `@Get('deleted')` 위에 넣는다. **`@Get(':id')`(현재 250줄) 보다 반드시 앞에 와야 한다** — 뒤에 두면 `selection` 이 `:id` 로 잡혀 404 가 난다.

```ts
@Get('selection')
@ApiOperation({
  summary: '필터 결과 전체 선택 목록',
  description: `
    GET /masters 와 **완전히 같은 필터**로, 걸린 상품 전량의 id 와 정책 플래그를 반환합니다.
    page/limit 은 무시하고 언제나 전량을 줍니다.

    일괄 수정 대상을 화면에서 한 번에 고르기 위한 용도이며, 결과가 ${MAX_BULK_PRODUCTS}건을
    넘으면 400 입니다.
  `,
})
@ApiResponse({ status: 200, description: '조회 성공', type: MasterSelectionResponseDto })
@ApiResponse({ status: 400, description: `결과가 ${MAX_BULK_PRODUCTS}건을 초과` })
async getMasterSelection(@Query() query: ListProductMastersQueryDto): Promise<MasterSelectionResponseDto> {
  const keyword = (query.q ?? query.name)?.trim() || undefined;

  const { items, total } = await this.productMastersService.getMasterSelection({
    categoryId: query.categoryId,
    brand: query.brand,
    name: keyword,
    mode:
      query.mode ??
      (query.status === 'inactive' ? 'active-or-inactive' : query.status === 'draft' ? 'all' : undefined),
    status: query.status,
    productType: query.productType,
    approvalStatus: query.approvalStatus,
    createdBy: query.createdBy,
    supplierId: query.supplierId,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
    stock: query.stock,
    deleted: query.deleted ?? false,
    ids: query.ids && query.ids.length > 0 ? query.ids : undefined,
  });

  if (total > MAX_BULK_PRODUCTS) {
    throw new BadRequestError('선택 가능한 범위를 넘었습니다. 필터를 좁혀주세요.');
  }

  return { items, total };
}
```

import 을 세 줄 더한다:

```ts
import { BadRequestError } from '@app/shared';
import { MasterSelectionResponseDto } from '../dto/master-selection-response.dto';
import { MAX_BULK_PRODUCTS } from '../../../operations/bulk/dto/bulk-operations.dto';
```

`sort`/`order`/`page`/`limit` 은 넘기지 않는다 — 선택 결과는 집합이라 순서가 의미 없다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/products/controllers/product-masters-selection.controller.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: 빌드와 라우트 순서를 확인한다**

Run: `npm run type-check`
Expected: 기준선(159건) 대비 **새 에러 0건**

`product-masters.controller.ts` 에서 `@Get('selection')` 의 줄 번호가 `@Get(':id')` 보다 작은지 눈으로 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/core/products/dto/master-selection-response.dto.ts apps/core/src/modules/catalog/core/products/controllers/
git commit -m "feat(catalog): GET /masters/selection 으로 필터 결과 전량을 연다"
```

---

### Task 5: admin-web 순수 판정 함수

화면에 붙기 전에 판정 로직을 전부 `.ts` 로 뽑아 테스트한다. **여기서 테스트되지 않은 판정은 앞으로도 영영 테스트되지 않는다** — `.tsx` 는 jest transform 대상이 아니다.

**Files:**
- Create: `apps/admin-web/src/features/mall/products-list/components/table/products-list-page-size-model.ts`
- Create: `apps/admin-web/src/features/mall/products-list/components/table/products-list-page-size-model.spec.ts`
- Create: `apps/admin-web/src/features/mall/products-list/components/filter-box/products-list-search-params.ts`
- Create: `apps/admin-web/src/features/mall/products-list/components/filter-box/products-list-search-params.spec.ts`
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts`
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.spec.ts`
- Modify: `apps/admin-web/src/lib/types/dto/products.ts`

**Interfaces:**
- Consumes: `SelectedProductSnapshot` (기존)
- Produces:
  - `MasterSelectionItemDto` / `MasterSelectionResponseDto` — `lib/types/dto/products.ts`. Task 6·9 가 같은 타입을 쓴다 (**여기서 한 번만 선언한다**)
  - `PAGE_SIZE_OPTIONS: readonly [20, 50, 100]`, `DEFAULT_PAGE_SIZE = 20`, `type PageSize = 20 | 50 | 100`
  - `parsePageSize(raw: string | null | undefined): PageSize`
  - `hasActiveFilter(params: URLSearchParams): boolean`
  - `canSelectAll(input: { hasFilter: boolean; total: number }): { ok: boolean; reason?: string }`
  - `MAX_SELECTABLE = 5000`
  - `buildSearchParams(input: SearchParamsInput): URLSearchParams`
  - `selectionFromItems(items: MasterSelectionItemDto[]): { rowSelection: RowSelectionState; snapshots: Record<string, SelectedProductSnapshot> }`

- [ ] **Step 1: 페이지 크기·선택 게이트 테스트를 쓴다**

```ts
// products-list-page-size-model.spec.ts
import { parsePageSize, hasActiveFilter, canSelectAll, MAX_SELECTABLE, DEFAULT_PAGE_SIZE } from './products-list-page-size-model';

describe('parsePageSize', () => {
  it.each([['20', 20], ['50', 50], ['100', 100]])('허용값 %s 를 그대로 쓴다', (raw, expected) => {
    expect(parsePageSize(raw)).toBe(expected);
  });

  it.each([null, undefined, '', 'abc', '0', '-10', '30', '200', '999', '20.5'])(
    '허용값이 아니면 기본값으로 떨어진다: %s',
    (raw) => {
      expect(parsePageSize(raw as string | null | undefined)).toBe(DEFAULT_PAGE_SIZE);
    },
  );
});

describe('hasActiveFilter', () => {
  const params = (init: Record<string, string>) => new URLSearchParams(init);

  it.each(['q', 'brand', 'categoryId', 'supplierId', 'createdBy', 'status', 'stock', 'createdAt'])(
    '%s 가 있으면 필터로 친다',
    (key) => {
      expect(hasActiveFilter(params({ [key]: 'x' }))).toBe(true);
    },
  );

  it.each(['page', 'size', 'sort', 'order', 'datePreset'])('%s 는 필터로 치지 않는다', (key) => {
    expect(hasActiveFilter(params({ [key]: 'x' }))).toBe(false);
  });

  it('아무것도 없으면 false', () => {
    expect(hasActiveFilter(params({}))).toBe(false);
  });

  it('빈 문자열 값은 필터가 아니다', () => {
    expect(hasActiveFilter(params({ q: '' }))).toBe(false);
  });
});

describe('canSelectAll', () => {
  it('필터가 없으면 막고 이유를 준다', () => {
    expect(canSelectAll({ hasFilter: false, total: 10 })).toEqual({
      ok: false,
      reason: '필터를 먼저 걸어주세요.',
    });
  });

  it('결과가 0건이면 막는다', () => {
    expect(canSelectAll({ hasFilter: true, total: 0 })).toEqual({
      ok: false,
      reason: '선택할 상품이 없습니다.',
    });
  });

  it('상한 이하면 허용한다', () => {
    expect(canSelectAll({ hasFilter: true, total: MAX_SELECTABLE })).toEqual({ ok: true });
  });

  it('상한을 넘으면 막고 좁히라고 한다', () => {
    expect(canSelectAll({ hasFilter: true, total: MAX_SELECTABLE + 1 })).toEqual({
      ok: false,
      reason: '5,000건을 넘습니다. 필터를 좁혀주세요.',
    });
  });

  it('필터가 없으면서 0건이면 필터 사유를 우선한다', () => {
    expect(canSelectAll({ hasFilter: false, total: 0 }).reason).toBe('필터를 먼저 걸어주세요.');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- products-list-page-size-model`
Expected: FAIL — 모듈을 찾을 수 없다

- [ ] **Step 3: 구현한다**

```ts
// products-list-page-size-model.ts
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;

/** 한 번에 선택할 수 있는 상품 수. core 의 MAX_BULK_PRODUCTS 와 같은 값이어야 한다. */
export const MAX_SELECTABLE = 5000;

/** URL 의 size 파라미터. 허용값이 아니면 기본값으로 떨어진다 — 손으로 고친 URL 로 목록이 깨지지 않게. */
export function parsePageSize(raw: string | null | undefined): PageSize {
  const parsed = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed) ? (parsed as PageSize) : DEFAULT_PAGE_SIZE;
}

/**
 * '전체 선택' 을 열어도 되는 상태인지 판정하는 데 쓰는 "필터가 걸렸는가".
 * page/size/sort/order 는 보기 설정이지 필터가 아니다. datePreset 은 createdAt 과
 * 항상 같이 실리는 표시용 값이라 단독으로는 필터가 아니다.
 */
const FILTER_KEYS = ['q', 'brand', 'categoryId', 'supplierId', 'createdBy', 'status', 'stock', 'createdAt'] as const;

export function hasActiveFilter(params: URLSearchParams): boolean {
  return FILTER_KEYS.some((key) => (params.get(key) ?? '').length > 0);
}

export function canSelectAll(input: { hasFilter: boolean; total: number }): { ok: boolean; reason?: string } {
  if (!input.hasFilter) return { ok: false, reason: '필터를 먼저 걸어주세요.' };
  if (input.total <= 0) return { ok: false, reason: '선택할 상품이 없습니다.' };
  if (input.total > MAX_SELECTABLE) {
    return { ok: false, reason: `${MAX_SELECTABLE.toLocaleString()}건을 넘습니다. 필터를 좁혀주세요.` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- products-list-page-size-model`
Expected: PASS

- [ ] **Step 5: `buildSearchParams` 테스트를 쓴다**

`handleSearch` 는 지금 URL 파라미터를 매번 새로 짓고 `sort`/`order` 만 살린다. `size` 를 보존하지 않으면 검색할 때마다 20으로 돌아간다.

```ts
// products-list-search-params.spec.ts
import { buildSearchParams } from './products-list-search-params';

const base = {
  q: '',
  categoryId: '',
  supplierIds: [] as string[],
  createdBy: '',
  brand: '',
  status: undefined as string | undefined,
  stock: undefined as string | undefined,
  createdAt: undefined as string | undefined,
  datePreset: 'all',
};

describe('buildSearchParams', () => {
  it('page 를 항상 1로 되돌린다', () => {
    expect(buildSearchParams(base, {}).get('page')).toBe('1');
  });

  it('size 를 보존한다 — 검색해도 표시 개수가 유지돼야 한다', () => {
    expect(buildSearchParams(base, { size: '100' }).get('size')).toBe('100');
  });

  it('sort/order 도 보존한다', () => {
    const params = buildSearchParams(base, { sort: 'name', order: 'asc' });
    expect(params.get('sort')).toBe('name');
    expect(params.get('order')).toBe('asc');
  });

  it('보존값이 없으면 키 자체를 넣지 않는다', () => {
    const params = buildSearchParams(base, {});
    expect(params.has('size')).toBe(false);
    expect(params.has('sort')).toBe(false);
  });

  it('브랜드는 공백을 다듬어 싣는다', () => {
    expect(buildSearchParams({ ...base, brand: '  정관장 ' }, {}).get('brand')).toBe('정관장');
  });

  it('브랜드가 공백뿐이면 싣지 않는다', () => {
    expect(buildSearchParams({ ...base, brand: '   ' }, {}).has('brand')).toBe(false);
  });

  it('공급처는 콤마로 묶는다', () => {
    expect(buildSearchParams({ ...base, supplierIds: ['a', 'b'] }, {}).get('supplierId')).toBe('a,b');
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm run test:admin-web -- products-list-search-params`
Expected: FAIL — 모듈을 찾을 수 없다

- [ ] **Step 7: `buildSearchParams` 를 구현한다**

```ts
// products-list-search-params.ts

/** 필터 박스가 만들어내는 값들. 날짜는 이미 문자열로 환산된 뒤 들어온다. */
export type SearchParamsInput = {
  q: string;
  categoryId: string;
  supplierIds: string[];
  createdBy: string;
  brand: string;
  status?: string;
  stock?: string;
  /** createdAt 파라미터로 실릴 JSON 문자열. 범위가 없으면 undefined. */
  createdAt?: string;
  datePreset: string;
};

/** 검색해도 살아남아야 하는 값들 — 필터가 아니라 보기 설정이다. */
export type PreservedParams = {
  size?: string | null;
  sort?: string | null;
  order?: string | null;
};

export function buildSearchParams(input: SearchParamsInput, preserved: PreservedParams): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', '1');

  if (input.q.trim()) params.set('q', input.q.trim());
  if (input.brand.trim()) params.set('brand', input.brand.trim());
  if (input.categoryId) params.set('categoryId', input.categoryId);
  if (input.supplierIds.length > 0) params.set('supplierId', input.supplierIds.join(','));
  if (input.createdBy) params.set('createdBy', input.createdBy);
  if (input.status) params.set('status', input.status);
  if (input.stock) params.set('stock', input.stock);
  if (input.createdAt) params.set('createdAt', input.createdAt);
  if (input.datePreset !== 'all') params.set('datePreset', input.datePreset);

  // 정렬과 표시 개수는 필터와 독립이므로 검색해도 유지한다.
  if (preserved.size) params.set('size', preserved.size);
  if (preserved.sort) params.set('sort', preserved.sort);
  if (preserved.order) params.set('order', preserved.order);

  return params;
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npm run test:admin-web -- products-list-search-params`
Expected: PASS

- [ ] **Step 9: 응답 타입을 선언하고 `selectionFromItems` 테스트를 쓴다**

먼저 `apps/admin-web/src/lib/types/dto/products.ts` 의 `MastersQuery` 선언 아래에 응답 타입을 넣는다. **이 두 타입은 여기서만 선언한다** — Task 6·9 가 같은 것을 import 한다.

```ts
/** GET /masters/selection — 필터에 걸린 상품 전량. 이름·썸네일은 없다. */
export interface MasterSelectionItemDto {
  masterId: string;
  hideMembershipPriceForNonMembers: boolean;
  isVisibleToMembersOnly: boolean;
  isOverseas: boolean;
}

export interface MasterSelectionResponseDto {
  items: MasterSelectionItemDto[];
  total: number;
}
```

그 다음 `products-list-selection-model.spec.ts` 끝에 붙인다.

```ts
import { selectionFromItems } from './products-list-selection-model';

describe('selectionFromItems', () => {
  const items = [
    { masterId: 'a', hideMembershipPriceForNonMembers: true, isVisibleToMembersOnly: false, isOverseas: false },
    { masterId: 'b', hideMembershipPriceForNonMembers: false, isVisibleToMembersOnly: true, isOverseas: true },
  ];

  it('모든 id 를 선택 상태로 만든다', () => {
    expect(selectionFromItems(items).rowSelection).toEqual({ a: true, b: true });
  });

  it('정책 플래그를 스냅샷에 그대로 옮긴다 — 일괄 정책 모달의 영향 건수가 여기 달렸다', () => {
    const { snapshots } = selectionFromItems(items);
    expect(snapshots.b.isVisibleToMembersOnly).toBe(true);
    expect(snapshots.b.isOverseas).toBe(true);
    expect(snapshots.a.hideMembershipPriceForNonMembers).toBe(true);
  });

  it('이름과 썸네일은 비운다 — 서버가 주지 않는다', () => {
    const { snapshots } = selectionFromItems(items);
    expect(snapshots.a.name).toBe('');
    expect(snapshots.a.thumbnail).toBeNull();
  });

  it('빈 배열이면 빈 선택을 준다', () => {
    expect(selectionFromItems([])).toEqual({ rowSelection: {}, snapshots: {} });
  });
});
```

- [ ] **Step 10: 실패를 확인하고 구현한다**

Run: `npm run test:admin-web -- products-list-selection-model`
Expected: FAIL — `selectionFromItems` 가 없다

`products-list-selection-model.ts` 끝에 추가한다.

파일 상단에 `import type { MasterSelectionItemDto } from '@/lib/types/dto/products';` 를 더한다.

```ts
/**
 * 전체 선택 응답을 테이블 선택 상태 + 스냅샷으로 바꾼다.
 *
 * 이름·썸네일이 비어 있는 건 의도다 — 서버가 주지 않고, 그래야 선택 목록 모달이
 * 5000행을 이미지째 그리려 들지 않는다. 정책 플래그는 실제 값이라야 한다.
 */
export function selectionFromItems(items: MasterSelectionItemDto[]): {
  rowSelection: RowSelectionState;
  snapshots: Record<string, SelectedProductSnapshot>;
} {
  const rowSelection: RowSelectionState = {};
  const snapshots: Record<string, SelectedProductSnapshot> = {};

  for (const item of items) {
    rowSelection[item.masterId] = true;
    snapshots[item.masterId] = {
      masterId: item.masterId,
      name: '',
      thumbnail: null,
      hideMembershipPriceForNonMembers: item.hideMembershipPriceForNonMembers,
      isVisibleToMembersOnly: item.isVisibleToMembersOnly,
      isOverseas: item.isOverseas,
    };
  }

  return { rowSelection, snapshots };
}
```

- [ ] **Step 11: 전부 통과하는지 확인한다**

Run: `npm run test:admin-web -- 'products-list'`
Expected: PASS (기존 선택/필터 스펙 포함 전부)

- [ ] **Step 12: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-list/components/table/ apps/admin-web/src/features/mall/products-list/components/filter-box/
git commit -m "feat(admin-web): 페이지 크기·전체 선택 판정 함수와 테스트"
```

---

### Task 6: 선택 조회 API 클라이언트와 훅

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/products/masters.client.ts`
- Modify: `apps/admin-web/src/lib/services/products/mutations.ts`

**Interfaces:**
- Consumes: `GET /masters/selection` (Task 4), `MasterSelectionResponseDto` (Task 5)
- Produces:
  - `mastersClient.getSelection(query: MastersQuery): Promise<MasterSelectionResponseDto>`
  - `useMasterSelection()` — `useMutation` 훅. `mutateAsync(query)` 가 `{ items, total }` 를 준다.

버튼을 누를 때만 도는 일회성 조회라 `useQuery` 가 아니라 `useMutation` 을 쓴다. `useQuery` 로 두면 필터가 바뀔 때마다 5000건을 미리 당겨온다.

- [ ] **Step 1: 클라이언트 메서드를 더한다**

`masters.client.ts` 의 `getListSummary` 바로 아래에 넣고, 파일 상단 타입 import 에 `MasterSelectionResponseDto` 를 더한다 (타입 자체는 Task 5 에서 이미 선언했다).

```ts
  /**
   * 필터에 걸린 상품 전량의 id + 정책 플래그.
   * page/limit 은 서버가 무시하므로 보내지 않는다.
   */
  getSelection: async (query: MastersQuery = {}): Promise<MasterSelectionResponseDto> => {
    const { page: _page, limit: _limit, ...filters } = query;
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters/selection?${buildQueryString(
        filters as Record<string, unknown>
      )}`
    );
    return response.data;
  },
```

- [ ] **Step 2: 훅을 더한다**

> **2026-08-13 수정**: 원래 이 스텝은 `query-keys.ts` 에 `mastersSelection` 키를 더하고 훅을 `queries.ts` 에 두라고 했다. 둘 다 틀렸다 — `useMutation` 은 쿼리 키를 쓰지 않으므로 그 키는 죽은 코드고, 이 도메인의 뮤테이션 훅 19개는 전부 `mutations.ts` 에 산다(`queries.ts` 헤더는 "PIM API 쿼리 훅"이다). 아래가 수정된 스텝이다.

`mutations.ts` 끝에 훅을 더한다. 쿼리 키는 만들지 않는다.

```ts
/**
 * 필터 결과 전체 선택. 버튼을 누른 순간에만 도는 일회성 조회라 useQuery 가 아니라
 * useMutation 이다 — useQuery 로 두면 필터가 바뀔 때마다 최대 5000건을 미리 당겨온다.
 */
export const useMasterSelection = () => {
  return useMutation({
    mutationFn: (query: MastersQuery) => products.masters.getSelection(query),
  });
};
```

- [ ] **Step 3: 타입 체크**

Run: `npm run type-check`
Expected: 기준선(159건) 대비 **새 에러 0건**. 기존 에러 수가 늘었다면 이 태스크가 원인이다.

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/lib/
git commit -m "feat(admin-web): 필터 결과 전체 선택 조회 클라이언트와 훅"
```

---

### Task 7: 페이지 크기 셀렉터 배선

**Files:**
- Create: `apps/admin-web/src/features/mall/products-list/components/table/page-size-select.tsx`
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx`
- Modify: `apps/admin-web/src/hooks/table/query/use-products-list-table-query.ts`

**Interfaces:**
- Consumes: `parsePageSize`, `PAGE_SIZE_OPTIONS` (Task 5)
- Produces: `<PageSizeSelect />` — props 없음. URL 을 직접 읽고 쓴다.

- [ ] **Step 1: 셀렉터 컴포넌트를 만든다**

```tsx
// page-size-select.tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FormSelect } from '@/components/common/form';
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE, parsePageSize } from './products-list-page-size-model';

const OPTIONS = PAGE_SIZE_OPTIONS.map((size) => ({
  value: String(size),
  label: `${size}개씩`,
}));

export function PageSizeSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = parsePageSize(searchParams.get('size'));

  const handleChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const size = parsePageSize(next);
    if (size === DEFAULT_PAGE_SIZE) {
      params.delete('size');
    } else {
      params.set('size', String(size));
    }
    // 표시 개수가 바뀌면 기존 page 번호는 범위 밖일 수 있다. 1쪽으로 되돌린다.
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="w-28">
      <FormSelect options={OPTIONS} value={String(current)} onValueChange={handleChange} />
    </div>
  );
}
```

- [ ] **Step 2: 쿼리 훅이 `size` 를 읽게 한다**

> **주의: 이 훅에는 호출부가 둘이다.** 상품 목록 말고 `features/mall/bulk/components/table/index.tsx:18` 도 `useProductsListTableQuery({ pageSize: PAGE_SIZE })` 로 부른다. **prop 을 지우면 그 화면이 깨진다.** prop 은 남기고 "URL 에 `size` 가 있으면 그게 이긴다"로만 바꾼다. 일괄 화면은 자기 URL 에 `size` 가 없으므로 지금과 똑같이 20 으로 돈다.

`use-products-list-table-query.ts` 의 `useQueryParams([...])` 배열에 `'size'` 를 더하고(구조 분해에도 추가), 아래처럼 바꾼다.

```ts
import { parsePageSize, DEFAULT_PAGE_SIZE } from '@/features/mall/products-list/components/table/products-list-page-size-model';

type UseProductsListTableQueryProps = {
  /** URL 에 size 가 없을 때 쓰는 기본값. URL 값이 있으면 그게 이긴다. */
  pageSize?: number;
};

export const useProductsListTableQuery = ({
  pageSize: fallbackPageSize = DEFAULT_PAGE_SIZE,
}: UseProductsListTableQueryProps = {}) => {
  // ... useQueryParams 에서 size 를 읽은 뒤

  const pageSize = size ? parsePageSize(size) : fallbackPageSize;

  const searchParams: MastersQuery = {
    limit: pageSize,
    // ... 나머지 그대로
  };

  return { searchParams, pageSize, raw: queryObject };
};
```

- [ ] **Step 3: 테이블에서 `PAGE_SIZE` 상수를 없앤다**

`table/index.tsx` 에서:
- `const PAGE_SIZE = 20;` 줄을 지운다
- `const { searchParams: query, pageSize } = useProductsListTableQuery();` 로 바꾼다
- `useProductsListTableColumns`·`useDataTable`·`DataTable` 에 넘기던 `PAGE_SIZE` 를 전부 `pageSize` 로 바꾼다 (4곳)
- 툴바의 "총 N건" 바로 뒤에 `<PageSizeSelect />` 를 넣는다

```tsx
<span className="mr-1 text-sm font-medium">
  총 {totalCount.toLocaleString()}건
</span>
<PageSizeSelect />
```

- [ ] **Step 4: 타입 체크와 빌드**

Run: `npm run type-check`
Expected: 새 에러 0건

Run: `npm run build:admin-web`
Expected: 빌드 성공

- [ ] **Step 5: 눈으로 확인한다**

`npm run start:admin-web:dev` 로 띄우고 `/mall/products-list` 에서:
1. 셀렉터가 "20개씩" 으로 시작하는지
2. 100 으로 바꾸면 URL 에 `size=100` 이 붙고 행이 100개로 늘어나는지
3. 5페이지로 이동한 뒤 100 으로 바꾸면 1페이지로 돌아가는지
4. 다시 20 으로 바꾸면 URL 에서 `size` 가 **사라지는지**
5. `/mall/bulk` 화면이 그대로 20행으로 도는지 (훅을 공유하는 다른 호출부다)

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-list/components/table/ apps/admin-web/src/hooks/table/query/use-products-list-table-query.ts
git commit -m "feat(admin-web): 상품 목록 페이지당 표시 개수를 고를 수 있게 한다"
```

---

### Task 8: 브랜드 필터 입력

**Files:**
- Modify: `apps/admin-web/src/features/mall/products-list/components/filter-box/index.tsx`

**Interfaces:**
- Consumes: `buildSearchParams` (Task 5)
- Produces: URL 파라미터 `brand`. `useProductsListTableQuery` 는 이미 이 값을 읽어 서버로 넘기므로 조회 쪽 변경은 없다.

- [ ] **Step 1: `FilterState` 에 brand 를 더한다**

```ts
type FilterState = {
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  categoryId: string;
  supplierIds: string[];
  createdBy: string;
  classification: Classification;
  q: string;
  brand: string;
};
```

초기 상태(`useState` 안)에도 한 줄 더한다.

```ts
brand: searchParams.get('brand') ?? '',
```

리셋(`handleReset`)의 초기값 객체에도 `brand: ''` 를 더한다.

- [ ] **Step 2: `handleSearch` 를 `buildSearchParams` 로 바꾼다**

지금의 파라미터 조립 코드를 통째로 아래로 교체한다. 날짜 환산은 호출 전에 끝낸다.

```ts
const handleSearch = () => {
  let from = filters.dateFrom;
  let to = filters.dateTo;
  if (filters.datePreset !== 'all' && filters.datePreset !== 'custom') {
    const range = computeDateRange(filters.datePreset);
    if (range) {
      from = range.from;
      to = range.to;
    }
  }

  const { status, stock } = classificationToParams(filters.classification);

  const params = buildSearchParams(
    {
      q: filters.q,
      brand: filters.brand,
      categoryId: filters.categoryId === ALL ? '' : filters.categoryId,
      supplierIds: filters.supplierIds,
      createdBy: filters.createdBy === ALL ? '' : filters.createdBy,
      status,
      stock,
      createdAt:
        from || to
          ? JSON.stringify({ ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) })
          : undefined,
      datePreset: filters.datePreset,
    },
    {
      size: searchParams.get('size'),
      sort: searchParams.get('sort'),
      order: searchParams.get('order'),
    },
  );

  router.replace(`${pathname}?${params.toString()}`);
};
```

- [ ] **Step 3: 초기화도 표시 개수를 살린다**

`handleReset` 의 `router.replace(pathname)` 을 바꾼다. 표시 개수는 필터가 아니라 보기 설정이라 초기화에서 살아남아야 한다.

```ts
const size = searchParams.get('size');
router.replace(size ? `${pathname}?size=${size}` : pathname);
```

- [ ] **Step 4: 입력을 화면에 단다**

`검색항목` FilterRow 의 상품명 입력 옆에 넣는다.

```tsx
<FilterRow label="검색항목">
  <div className="w-[520px] max-w-full">
    <FormInput
      className="bg-white"
      placeholder="상품명 / 품번코드 검색"
      value={filters.q}
      onChange={(e) => patch({ q: e.target.value })}
      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
    />
  </div>
  {/* 서버가 부분 일치(ilike)로 받는다 — '정관' 만 쳐도 '정관장' 이 걸린다. */}
  <div className="w-56">
    <FormInput
      className="bg-white"
      placeholder="브랜드"
      value={filters.brand}
      onChange={(e) => patch({ brand: e.target.value })}
      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
    />
  </div>
</FilterRow>
```

import 에 `buildSearchParams` 를 더한다.

- [ ] **Step 5: 타입 체크와 빌드**

Run: `npm run type-check && npm run build:admin-web`
Expected: 새 에러 0건, 빌드 성공

- [ ] **Step 6: 눈으로 확인한다**

1. 브랜드에 실제 브랜드 일부를 넣고 검색 → 결과가 줄어들고 URL 에 `brand=` 가 붙는지
2. 표시 개수를 100 으로 둔 채 검색 → **`size=100` 이 유지되는지** (이게 이 태스크의 핵심 회귀 지점이다)
3. 초기화 → 브랜드가 비워지고 `size` 는 남는지

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-list/components/filter-box/
git commit -m "feat(admin-web): 상품 목록에 브랜드 필터를 더한다"
```

---

### Task 9: 전체 선택 버튼과 선택 목록 모달 상한

**Files:**
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx`
- Modify: `apps/admin-web/src/features/mall/products-list/components/selected-products-modal/index.tsx`

**Interfaces:**
- Consumes: `canSelectAll`·`hasActiveFilter`·`selectionFromItems` (Task 5), `useMasterSelection` (Task 6)
- Produces: 없음 (최종 배선)

- [ ] **Step 1: 선택 목록 모달에 렌더 상한을 건다**

`<ul>` 이 가상화 없이 항목마다 `<img>` 를 그린다. 5000행이 들어오면 탭이 멎는다.

```tsx
/** 가상화가 없는 목록이라 상한을 둔다. 넘는 만큼은 건수로만 알린다. */
const PREVIEW_LIMIT = 200;

// items.map(...) 을 shown.map(...) 으로 바꾸고, 위에 두 줄을 둔다
const shown = items.slice(0, PREVIEW_LIMIT);
const hidden = items.length - shown.length;
```

`DialogTitle` 을 `선택한 상품 {count}개` 로 바꾼다 (`items.length` 가 아니라 `count` — 전체 선택 직후 스냅샷 반영이 한 틱 늦어도 제목이 흔들리지 않는다).

목록 아래에 남은 건수를 붙인다.

```tsx
{hidden > 0 && (
  <p className="pt-2 text-sm text-center text-muted-foreground">
    이 외 {hidden.toLocaleString()}건은 목록에 표시하지 않습니다.
  </p>
)}
```

이름이 빈 항목은 `ShortId` 만 보이게 한다.

```tsx
<div className="flex flex-col flex-1 min-w-0 gap-0.5">
  {item.name && (
    <span className="text-sm truncate" title={item.name}>
      {item.name}
    </span>
  )}
  <ShortId value={item.masterId} />
</div>
```

- [ ] **Step 2: 테이블에 전체 선택 버튼을 배선한다**

먼저 import 를 더한다. `useSearchParams` 는 이 파일에 아직 없다 (`useRouter` 만 있다).

```tsx
import { useRouter, useSearchParams } from 'next/navigation';
import { canSelectAll, hasActiveFilter } from './products-list-page-size-model';
import { selectionFromItems } from './products-list-selection-model';
import { useMasterSelection } from '@/lib/services/products/queries';
```

컴포넌트 본문 상단(`totalCount` 계산 아래)에 추가한다.

```tsx
const searchParams = useSearchParams();
const masterSelection = useMasterSelection();
const selectAllGate = canSelectAll({
  hasFilter: hasActiveFilter(searchParams),
  total: totalCount,
});
```

툴바의 `<SelectedProductsModal ... />` 바로 뒤에 버튼을 넣는다.

```tsx
<Button
  size="sm"
  variant="outline"
  disabled={!selectAllGate.ok || masterSelection.isPending}
  title={selectAllGate.reason}
  onClick={() => {
    masterSelection.mutate(query, {
      onSuccess: (res) => {
        const { rowSelection: next, snapshots } = selectionFromItems(res.items);
        table.setRowSelection(next);
        setSelectedItems(snapshots);
        toast.success(`${res.total.toLocaleString()}건을 선택했습니다.`);
      },
      onError: (error) =>
        toast.error(parseServerError(error, '전체 선택에 실패했습니다.').message),
    });
  }}
>
  {masterSelection.isPending
    ? '선택하는 중…'
    : `필터 결과 전체 선택${selectAllGate.ok ? ` (${totalCount.toLocaleString()})` : ''}`}
</Button>
```

`query` 를 그대로 넘기는 게 중요하다 — 화면이 보고 있는 것과 **같은 필터 객체**여야 목록과 선택이 어긋나지 않는다.

- [ ] **Step 3: 스냅샷 재조정과 충돌하지 않는지 확인한다**

`useEffect` 안의 `reconcileSelectedSnapshots` 는 `prev[id]` 를 유지하므로, 전체 선택으로 심은 스냅샷은 현재 페이지에 없는 항목도 살아남는다. 현재 페이지에 있는 항목은 실제 행 데이터로 덮어써져 이름·썸네일이 채워진다 — **의도된 동작이다**. 코드 변경 없음. 확인만 한다.

- [ ] **Step 4: 타입 체크와 빌드**

Run: `npm run type-check && npm run build:admin-web`
Expected: 새 에러 0건, 빌드 성공

- [ ] **Step 5: 전체 시나리오를 손으로 확인한다**

core 를 로컬에서 띄운 상태로 `/mall/products-list` 에서:

1. 필터 없음 → 버튼이 비활성이고 마우스를 올리면 "필터를 먼저 걸어주세요"
2. 브랜드 필터를 걸어 수십 건으로 좁힘 → 버튼에 건수가 뜨고 활성
3. 누르면 → 토스트에 건수, 헤더 체크박스가 전부 체크, "N개 선택됨" 이 총 건수와 일치
4. 2페이지로 이동 → 선택이 유지되고 그 페이지 행도 체크돼 있음
5. "N개 선택됨" 모달 → 현재 페이지 행은 이름·썸네일이 보이고, 나머지는 ShortId 만
6. **운영 노출 정책 변경** 모달 → "N건이 바뀝니다" 수가 그럴듯한지 (전부 0이거나 전부 전체 건수면 플래그가 안 실린 것이다)
7. 양식 다운로드 → 접수되는지
8. 필터를 지워 전체(5000 초과)로 만들고 → 버튼이 비활성이고 "5,000건을 넘습니다"

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-list/components/
git commit -m "feat(admin-web): 필터 결과 전체 선택 버튼과 선택 목록 상한"
```

---

## 마무리 확인

- [ ] `npm run build:admin-web` 성공
- [ ] `npm run type-check` — 기준선 159건 대비 새 에러 0건
- [ ] `npm run test:admin-web -- 'products-list'` 전부 통과
- [ ] `npx jest --testPathPattern='product-masters|bulk-operations'` 전부 통과
- [ ] `npm run test:core:integration:local -- product-masters-selection` 전부 통과
- [ ] Task 9 Step 5 의 8개 시나리오를 실제로 눌러봤다

## 배포

**core 를 먼저 배포하고, 완료된 뒤 admin-web 을 배포한다.** 마이그레이션은 없다.

순서를 어기면 `GET /masters/selection` 이 404 라 전체 선택 버튼만 실패한다 — 나머지 화면은 멀쩡하지만, 그 상태로 MD 에게 알리면 안 된다.

## 남은 위험

5000건 벌크 상태변경/삭제가 한 트랜잭션에서 어떻게 도는지는 이 작업에서 측정하지 않는다. 상한을 5000으로 여는 이상 별개 문제이고, 지금 코드에는 상한이 아예 없어 이미 노출돼 있던 위험이다. 실제 성능·타임아웃 측정은 후속 과제다.

---

## 사람이 브라우저에서 확인해야 할 것 (아직 0회)

이 브랜치는 **브라우저 검증이 한 번도 되지 않았다.** admin-web 은 `.tsx` 를 테스트할 수 없어(jest transform 이 `^.+\.(t|j)s$`) 판정 로직만 `.ts` 로 뽑아 단위 테스트했고, 화면 배선은 전부 미검증이다. 배포 전에 아래를 순서대로 눌러본다.

### P0 — 데이터 안전. 이것부터 한다

1. 결과가 **20건 이하**가 되게 필터를 걸고 → `필터 결과 전체 선택` → `선택 삭제`. 확인 모달의 건수가 맞는지, 목록에 ShortId 가 읽히는지(빈 줄이 아니어야 한다), 토스트 건수가 맞는지, 실제로 상품이 사라지는지.
2. 같은 흐름을 **200~500건**에서 반복하고 **요청 시간을 재라.** 벌크 삭제는 상품 하나당 트랜잭션 하나라 5000건이면 수 분이 걸릴 수 있고, 브라우저가 먼저 포기해도 서버는 계속 지운다.
3. 1번에서 지운 것을 `/mall/bulk` 에서 복구해라. 모달이 "되돌릴 수 있습니다"라고 약속하니 그게 참인지 확인한다.
4. 필터 A 로 전체 선택 → 필터를 B 로 바꾼다 → 툴바에 경고 배지가 뜨는지, **그리고 삭제 확인 모달 안에도 경고가 보이는지.**

### P1 — 기능 자체

5. 페이지 크기: 첫 라벨이 `20개씩` / 100 선택 시 재조회·100행·URL 에 `size=100`·1페이지로 복귀 / 5페이지에서 100 선택 시 1페이지 / 다시 20 선택 시 URL 에서 `size` 가 사라짐.
6. 브랜드 필터: 일부만 입력해도 결과가 줄고 URL 에 `brand=` 가 붙는다 / **표시 개수 100 을 둔 채 검색해도 `size=100` 이 유지된다** / 초기화가 브랜드만 비우고 `size` 는 남긴다.
7. 게이트 상태: 필터 없음 → 비활성 + `필터를 먼저 걸어주세요`(그 사유 텍스트가 첫 로드마다 상시 노출되는데, 그게 거슬리는지도 같이 판단한다) / 결과 0건 → 비활성.

### P2 — 테스트가 못 덮는 이음매

8. 상품이 상위·하위 카테고리에 **둘 다** 매핑된 카테고리로 필터하고, `총 N건` 과 전체 선택 후 토스트 건수를 비교한다. 두 수는 다를 수 있다 — 목록의 수는 조인 팬아웃으로 부풀고, 선택의 수가 실제 상품 수다. 버튼 라벨도 부푼 수를 보여준다.
9. 1페이지에서 3개 선택 → 2페이지에서 2개 선택 → `선택한 상품` 모달에 5개가 이름·썸네일과 함께 나오고, X 로 하나 빼면 지연 없이 반영되는지.
10. `/mall/bulk` 화면이 여전히 20행으로 돌고 그 외에 달라진 게 없는지.

## 배포

**core → admin-web 순서. 마이그레이션 0건.** 순서를 어기면 `GET /masters/selection` 이 404 라 전체 선택 버튼만 실패하고 나머지 화면은 멀쩡하다.

## 후속 과제

- 5000건 벌크 삭제/상태변경의 실제 소요 시간 측정. 지금은 상품당 트랜잭션 하나이고 게이트웨이 타임아웃을 넘길 수 있다.
- 목록 쿼리의 카테고리 조인 팬아웃 — `총 N건` 과 버튼 라벨이 부푼 수를 보여주는 원인. 이 브랜치는 선택 쪽만 중복 제거했다.
- 파리티 통합 스펙은 `DATABASE_URL` 이 없으면 통째로 skip 된다. 그 스펙이 `buildMasterListScope` 추출의 유일한 안전망인데 평범한 `npm test` 로는 돌지 않는다.
- `hasActiveFilter` 는 URL 값을 그대로 읽어 `status=xyz` 같은 잘못된 값도 필터로 친다(서버는 버린다). 상한이 막아주긴 한다.
