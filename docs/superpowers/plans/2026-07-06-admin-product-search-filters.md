# 관리자 상품목록 검색 조건 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 상품목록(`GET /masters` / `/mall/products-list`)에 카테고리·브랜드·상품유형·승인상태·등록일 범위 필터와 정렬을 추가하고, 인라인 쿼리 파싱을 검증 가능한 DTO로 교체하며, 미사용 검색 경로(`ProductSearchService`)를 제거한다.

**Architecture:** 백엔드는 실제 서빙 경로인 `ProductMastersService.getMasters()` 하나에 필터를 흡수한다(죽은 `ProductSearchService`는 삭제). 컨트롤러의 인라인 `@Query()` 객체를 `class-validator` DTO로 바꿔 전역 `ValidationPipe(whitelist+transform)`가 검증·형변환을 담당하게 한다. 프론트는 기존 제네릭 `DataTable` 필터/정렬 프레임워크에 필터 설정과 `orderBy` prop만 얹고, URL 파라미터를 `MastersQuery`로 매핑한다. 새 필터 컬럼은 모두 기존 인덱스가 있는 `product_master_versions` 컬럼이라 **스키마 마이그레이션이 없다**.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), class-validator/class-transformer, Next.js(App Router), TanStack React Query, Jest(ts-jest, node env).

## Global Constraints

- **레이어 규칙(CLAUDE.md):** Controller는 Repository 직접 호출 금지·에러→상태 매핑용 try/catch 금지. 검증·비즈니스 로직은 Reader/Manager에. 여기서는 기존 구조를 유지한 채 필터만 확장한다.
- **타입 안전:** 정당화 없는 `any`/`as` 금지. 새 코드는 명시 타입 사용. (기존 `whereConditions: any[]` 배열은 이번 범위에서 건드리지 않는다.)
- **Drizzle 쿼리 규칙:** `db.query.*`/`with` relations 금지, `trx.select().from().innerJoin().where()` 스타일 유지.
- **DB 주입:** 기존 `@InjectDb`/`DbService` 패턴 유지.
- **마이그레이션 없음:** 이 계획의 모든 필터 컬럼(`productType`, `approvalStatus`, `productCode`, `product_masters.createdAt`, `product_master_versions.createdAt/updatedAt/name`)은 이미 존재하며 대부분 인덱스가 있다. `schema.ts`를 수정하지 않는다.
- **하위호환:** 백엔드가 추가하는 쿼리 파라미터는 전부 optional·additive. 구 프론트엔드는 그대로 동작한다. 백엔드(PR 1)를 프론트(PR 2)보다 먼저 배포해도 안전하다.
- **검색 성능(ILIKE `%x%`)·trigram/ES는 이번 범위 밖**(별도 결정으로 보류).
- **정렬 파라미터명은 `sort`/`order`** (프레임워크 `DataTableOrderBy` 및 기존 Users 목록 관례). 죽은 DTO의 `sortBy`/`sortOrder` 아님.
- **테스트 규약:** 루트 jest는 `testEnvironment: node`, `testRegex: .*\.spec\.ts$`. 프론트 spec은 순수 TS 함수만 테스트하고, 모듈 대상은 **상대 경로**로 import, 타입은 `import type`(런타임 소거)로 참조한다.

## 확정된 설계 판단 (구현 전 읽을 것)

1. **`mode` 축은 그대로 유지**하고 별도 `status` 필터를 추가하지 않는다(중복 회피). 신규 필터는 `mode`와 직교한다.
2. **`q` 키워드 = `name` OR `productCode`** (둘 다 ILIKE 부분일치). 서비스의 필터 필드명은 기존 `name`을 **그대로 유지**(리네임 최소화)하되, 조건만 OR로 확장한다.
3. **"등록일"은 `product_masters.createdAt` 기준**으로 필터·정렬을 통일한다. 목록 화면의 "등록일" 컬럼이 `product_masters.createdAt`을 표시(`product-master.mapper.ts:78`)하기 때문. **기본 정렬도 현재 `product_master_versions.createdAt`(`:673`)에서 `product_masters.createdAt`으로 바뀐다** — 의도된 일관성 수정.
4. **productType·approvalStatus는 단일 선택**(백엔드 `eq()`). 멀티는 후속 확장(`inArray` + `multiple:true` + 콤마 split).
5. `product_masters.createdAt`에는 인덱스가 없지만 masters는 상품당 1행인 작은 테이블이라 이번 범위에서 인덱스를 추가하지 않는다(성능 보류 결정과 일치). 필요 시 후속 additive 마이그레이션.

## File Structure

**백엔드 (apps/core) — PR 1**

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `.../products/dto/list-product-masters-query.dto.ts` | `GET /masters` 쿼리 DTO(검증+변환) | 신규 |
| `.../products/dto/list-product-masters-query.dto.spec.ts` | DTO 변환/검증 테스트 | 신규 |
| `.../products/services/product-masters-sort.util.ts` | 정렬 키→컬럼/방향 순수 리졸버 | 신규 |
| `.../products/services/product-masters-sort.util.spec.ts` | 리졸버 테스트 | 신규 |
| `.../products/services/product-masters.service.ts` | `getMasters` 필터 타입·WHERE·ORDER 확장 | 수정 |
| `.../products/controllers/product-masters.controller.ts` | DTO 바인딩·신규 필드 매핑·Swagger | 수정 |
| `.../products/controllers/product-masters.controller.spec.ts` | 매핑 계약 테스트 갱신·추가 | 수정 |
| `.../products/products.module.ts` | 죽은 provider/export 제거 | 수정 |
| `.../products/services/product-search.service.ts` | 삭제 | 삭제 |
| `.../products/dto/product-query.dto.ts` | 삭제 | 삭제 |

**프론트 (apps/admin-web) — PR 2**

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `src/hooks/table/query/date-range-param.ts` | date 필터 JSON(`{$gte,$lte}`) 파서 | 신규 |
| `src/hooks/table/query/date-range-param.spec.ts` | 파서 테스트 | 신규 |
| `src/hooks/table/filters/category-filter-options.ts` | `SelectableCategory[]`→`FilterOption[]` 매핑 | 신규 |
| `src/hooks/table/filters/category-filter-options.spec.ts` | 매핑 테스트 | 신규 |
| `src/lib/types/dto/products.ts` | `MastersQuery`에 신규 필드 | 수정 |
| `src/hooks/table/query/use-products-list-table-query.ts` | 신규 URL 파라미터 읽어 매핑 | 수정 |
| `src/hooks/table/filters/use-products-list-table-filters.ts` | 카테고리/브랜드/유형/승인/등록일 필터 | 수정 |
| `src/features/mall/products-list/components/table/index.tsx` | `orderBy` prop 추가 | 수정 |

---

# PR 1 — 백엔드 (apps/core)

### Task 1: 죽은 검색 경로 제거 (`ProductSearchService` / `ProductQueryDto`)

미사용 코드를 먼저 걷어내 이후 작업 표면을 깨끗이 한다. 이 둘은 어떤 컨트롤러에도 주입되지 않으며 서로만 참조한다.

**Files:**
- Delete: `apps/core/src/modules/catalog/core/products/services/product-search.service.ts`
- Delete: `apps/core/src/modules/catalog/core/products/dto/product-query.dto.ts`
- Modify: `apps/core/src/modules/catalog/core/products/products.module.ts` (import line 8, providers line 34, exports line 46)

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (순수 삭제)

- [ ] **Step 1: 참조가 정말 없는지 확인**

Run:
```bash
grep -rn "ProductSearchService\|ProductQueryDto\|product-search.service\|product-query.dto" apps/core/src --include=*.ts | grep -v "product-search.service.ts:" | grep -v "product-query.dto.ts:"
```
Expected: `products.module.ts`의 3줄(import/providers/exports)만 출력. 그 외 참조가 있으면 이 task를 멈추고 재평가.

- [ ] **Step 2: 죽은 파일 2개 삭제**

Run:
```bash
git rm apps/core/src/modules/catalog/core/products/services/product-search.service.ts \
       apps/core/src/modules/catalog/core/products/dto/product-query.dto.ts
```

- [ ] **Step 3: 모듈에서 참조 제거**

`apps/core/src/modules/catalog/core/products/products.module.ts`에서 다음 3줄을 삭제한다.

Line 8 (import):
```ts
import { ProductSearchService } from './services/product-search.service';
```
providers 배열의 `ProductSearchService,` (line 34) 와 exports 배열의 `ProductSearchService,` (line 46) 를 각각 제거한다.

- [ ] **Step 4: 빌드로 참조 누락 없는지 확인**

Run: `npm run build:core`
Expected: 성공(에러 없음). "Cannot find module './services/product-search.service'" 류 에러가 나오면 삭제/수정 누락.

- [ ] **Step 5: 카탈로그 스펙 회귀 없음 확인**

Run: `npx jest catalog/core/products`
Expected: 기존 product-masters/variants/versions 등 스펙 PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(catalog): remove unused ProductSearchService and ProductQueryDto"
```

---

### Task 2: `ListProductMastersQueryDto` 추가

인라인 `@Query()` 객체를 대체할 검증·변환 DTO. 전역 `ValidationPipe(whitelist+transform)`가 이 DTO를 채운다.

**Files:**
- Create: `apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.ts`
- Test: `apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  ```ts
  class ListProductMastersQueryDto {
    page?: number; limit?: number;
    q?: string; name?: string;            // name = deprecated alias of q
    categoryId?: string; brand?: string;
    mode?: 'active' | 'active-or-inactive' | 'all';
    productType?: 'regular_sale' | 'limited_edition';
    approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
    createdFrom?: string; createdTo?: string;   // ISO date strings
    sort?: 'createdAt' | 'name' | 'updatedAt';
    order?: 'asc' | 'desc';
    deleted?: boolean;                    // transformed from 'true'
    ids?: string[];                       // transformed from comma string
  }
  ```

- [ ] **Step 1: 실패하는 DTO 변환 테스트 작성**

Create `apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.spec.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListProductMastersQueryDto } from './list-product-masters-query.dto';

function toDto(raw: Record<string, unknown>) {
  return plainToInstance(ListProductMastersQueryDto, raw, { enableImplicitConversion: false });
}

describe('ListProductMastersQueryDto', () => {
  it('coerces numeric strings for page/limit', () => {
    const dto = toDto({ page: '2', limit: '30' });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(30);
  });

  it("transforms deleted='true' to boolean true and anything else to false", () => {
    expect(toDto({ deleted: 'true' }).deleted).toBe(true);
    expect(toDto({ deleted: 'false' }).deleted).toBe(false);
    expect(toDto({}).deleted).toBeUndefined();
  });

  it('splits comma-separated ids into a trimmed array', () => {
    expect(toDto({ ids: 'a, b ,c' }).ids).toEqual(['a', 'b', 'c']);
  });

  it('accepts a fully valid query with the new filters', async () => {
    const dto = toDto({
      q: '립스틱', categoryId: '018f9c2e-0000-7000-8000-000000000000',
      brand: 'Almond', mode: 'all', productType: 'limited_edition',
      approvalStatus: 'pending', createdFrom: '2026-01-01', createdTo: '2026-01-31',
      sort: 'name', order: 'asc',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects invalid enum values', async () => {
    const dto = toDto({ productType: 'nonsense', approvalStatus: 'bogus', sort: 'price', order: 'up' });
    const errors = await validate(dto);
    const props = errors.map((e) => e.property).sort();
    expect(props).toEqual(['approvalStatus', 'order', 'productType', 'sort']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest list-product-masters-query.dto.spec`
Expected: FAIL — "Cannot find module './list-product-masters-query.dto'".

- [ ] **Step 3: DTO 구현**

Create `apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.ts`:
```ts
import { IsOptional, IsString, IsUUID, IsIn, IsInt, Min, IsDateString, IsArray, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ListProductMastersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;

  @IsOptional() @IsString() q?: string;

  /** @deprecated q 와 동일하게 취급되는 별칭 */
  @IsOptional() @IsString() name?: string;

  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() brand?: string;

  @IsOptional() @IsIn(['active', 'active-or-inactive', 'all'])
  mode?: 'active' | 'active-or-inactive' | 'all';

  @IsOptional() @IsIn(['regular_sale', 'limited_edition'])
  productType?: 'regular_sale' | 'limited_edition';

  @IsOptional() @IsIn(['draft', 'pending', 'approved', 'rejected'])
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';

  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;

  @IsOptional() @IsIn(['createdAt', 'name', 'updatedAt'])
  sort?: 'createdAt' | 'name' | 'updatedAt';

  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';

  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean()
  deleted?: boolean;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((v) => v.trim()).filter((v) => v.length > 0)
      : value,
  )
  @IsArray() @IsString({ each: true })
  ids?: string[];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest list-product-masters-query.dto.spec`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.ts \
        apps/core/src/modules/catalog/core/products/dto/list-product-masters-query.dto.spec.ts
git commit -m "feat(catalog): add ListProductMastersQueryDto with validation/transform"
```

---

### Task 3: `resolveMasterSort` 정렬 리졸버

정렬 키(`sort`)와 방향(`order`)을 Drizzle 컬럼/방향 함수로 매핑하는 순수 함수. 서비스가 이걸 써서 하드코딩된 `orderBy`를 대체한다.

**Files:**
- Create: `apps/core/src/modules/catalog/core/products/services/product-masters-sort.util.ts`
- Test: `apps/core/src/modules/catalog/core/products/services/product-masters-sort.util.spec.ts`

**Interfaces:**
- Consumes: `productMasters`, `productMasterVersions` (schema), `asc`/`desc` (drizzle-orm)
- Produces: `resolveMasterSort(sort?: string, order?: string): { column: PgColumn; direction: typeof asc | typeof desc }`

- [ ] **Step 1: 실패하는 리졸버 테스트 작성**

Create `apps/core/src/modules/catalog/core/products/services/product-masters-sort.util.spec.ts`:
```ts
import { asc, desc } from 'drizzle-orm';
import { productMasters, productMasterVersions } from '../../../schema/catalog.schema';
import { resolveMasterSort } from './product-masters-sort.util';

describe('resolveMasterSort', () => {
  it("defaults to product_masters.createdAt DESC (matches the '등록일' column)", () => {
    const { column, direction } = resolveMasterSort(undefined, undefined);
    expect(column).toBe(productMasters.createdAt);
    expect(direction).toBe(desc);
  });

  it('maps name/updatedAt to version columns', () => {
    expect(resolveMasterSort('name', 'asc').column).toBe(productMasterVersions.name);
    expect(resolveMasterSort('updatedAt', 'desc').column).toBe(productMasterVersions.updatedAt);
  });

  it('maps order asc/desc to the drizzle direction fn', () => {
    expect(resolveMasterSort('createdAt', 'asc').direction).toBe(asc);
    expect(resolveMasterSort('createdAt', 'desc').direction).toBe(desc);
  });

  it('falls back to createdAt column for unknown sort keys', () => {
    expect(resolveMasterSort('bogus', 'asc').column).toBe(productMasters.createdAt);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest product-masters-sort.util.spec`
Expected: FAIL — "Cannot find module './product-masters-sort.util'".

- [ ] **Step 3: 리졸버 구현**

Create `apps/core/src/modules/catalog/core/products/services/product-masters-sort.util.ts`:
```ts
import { asc, desc } from 'drizzle-orm';
import { productMasters, productMasterVersions } from '../../../schema/catalog.schema';

/**
 * 정렬 키/방향을 Drizzle 컬럼과 방향 함수로 변환한다.
 * - createdAt(기본): product_masters.createdAt — 목록 '등록일' 컬럼과 동일 (product-master.mapper.ts:78)
 * - name/updatedAt: product_master_versions 컬럼
 */
export function resolveMasterSort(sort?: string, order?: string) {
  const column =
    sort === 'name'
      ? productMasterVersions.name
      : sort === 'updatedAt'
        ? productMasterVersions.updatedAt
        : productMasters.createdAt;

  const direction = order === 'asc' ? asc : desc;

  return { column, direction };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest product-masters-sort.util.spec`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-masters-sort.util.ts \
        apps/core/src/modules/catalog/core/products/services/product-masters-sort.util.spec.ts
git commit -m "feat(catalog): add resolveMasterSort helper for product list sorting"
```

---

### Task 4: `ProductMastersService.getMasters` 필터·정렬 확장

`filters` 타입에 신규 필드를 더하고, 키워드 OR·신규 WHERE·동적 ORDER BY를 적용한다. 이 메서드의 쿼리 체인은 목 테스트가 취약하므로(랭킹 서브쿼리·재귀 CTE·count/data/배치 4쿼리) **신규 유닛 테스트를 추가하지 않는다** — 정렬 로직은 Task 3에서, 파라미터 흐름은 Task 5(컨트롤러 계약)에서, 실제 필터링은 Task 11(E2E)에서 검증한다. 이 task의 게이트는 타입체크 + 기존 스펙 회귀 없음이다.

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts`
  - line 48 (drizzle imports), 486-496 (filters 타입), 592-600 (brand/name 블록), 673 (orderBy)

**Interfaces:**
- Consumes: `resolveMasterSort` (Task 3), `ListProductMastersQueryDto` 필드 이름과 동일한 filters 키
- Produces: 확장된 `getMasters(filters?)` — filters에 `productType?`, `approvalStatus?`, `createdFrom?`, `createdTo?`, `sort?`, `order?` 추가 (모두 optional). 반환 shape 불변(`{ data, total, page, limit }`).

- [ ] **Step 1: drizzle 연산자 import 보강 (line 48)**

기존:
```ts
import { eq, and, ilike, count, asc, desc, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
```
→ `or`, `gte`, `lte` 추가:
```ts
import { eq, and, or, ilike, count, asc, desc, gte, lte, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
```

- [ ] **Step 2: `resolveMasterSort` import 추가**

파일 상단 import 블록(예: line 49 `ProductVersionsService` import 부근)에 추가:
```ts
import { resolveMasterSort } from './product-masters-sort.util';
```

- [ ] **Step 3: `filters` 파라미터 타입 확장 (486-496)**

기존 filters 객체 타입에 신규 optional 필드를 추가한다. 최종 형태:
```ts
async getMasters(
  filters?: {
    mode?: MasterListMode;
    categoryId?: string;
    brand?: string;
    name?: string;
    page?: number;
    limit?: number;
    deleted?: boolean;
    ids?: string[];
    productType?: 'regular_sale' | 'limited_edition';
    approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
    createdFrom?: string;
    createdTo?: string;
    sort?: 'createdAt' | 'name' | 'updatedAt';
    order?: 'asc' | 'desc';
  },
  tx?: DbTransaction,
): Promise<{ /* 기존 반환 타입 그대로 */
```

- [ ] **Step 4: 키워드(name) 블록을 name+productCode OR 로 확장 (597-600)**

기존:
```ts
      // name 검색 필터
      if (filters?.name) {
        whereConditions.push(ilike(productMasterVersions.name, `%${filters.name}%`));
      }
```
→
```ts
      // 키워드 검색: 상품명 + 품번코드 부분 일치 (대소문자 무시)
      if (filters?.name) {
        whereConditions.push(
          or(
            ilike(productMasterVersions.name, `%${filters.name}%`),
            ilike(productMasterVersions.productCode, `%${filters.name}%`),
          ),
        );
      }
```

- [ ] **Step 5: 신규 WHERE 조건 추가**

Step 4 블록 바로 다음(ids 필터 push 부근, line 605 이후)에 추가:
```ts
      // 상품 유형 필터
      if (filters?.productType) {
        whereConditions.push(eq(productMasterVersions.productType, filters.productType));
      }

      // 승인 상태 필터
      if (filters?.approvalStatus) {
        whereConditions.push(eq(productMasterVersions.approvalStatus, filters.approvalStatus));
      }

      // 등록일 범위 필터 — 화면 '등록일' 컬럼과 동일하게 product_masters.createdAt 기준
      if (filters?.createdFrom) {
        whereConditions.push(gte(productMasters.createdAt, new Date(filters.createdFrom)));
      }
      if (filters?.createdTo) {
        whereConditions.push(lte(productMasters.createdAt, new Date(filters.createdTo)));
      }
```

- [ ] **Step 6: 하드코딩 ORDER BY 를 동적화 (673)**

기존:
```ts
      const orderedQuery = filteredDataQuery.orderBy(desc(productMasterVersions.createdAt));
```
→
```ts
      const { column: sortColumn, direction: sortDirection } = resolveMasterSort(filters?.sort, filters?.order);
      // 안정 페이지네이션을 위해 master id 를 2차 정렬키로 고정
      const orderedQuery = filteredDataQuery.orderBy(sortDirection(sortColumn), desc(productMasters.id));
```

- [ ] **Step 7: 타입체크(빌드)**

Run: `npm run build:core`
Expected: 성공. 실패 시 흔한 원인: `or`/`gte`/`lte` import 누락(Step 1), filters 타입 필드 누락(Step 3).

- [ ] **Step 8: 서비스 스펙 회귀 없음 확인**

Run: `npx jest product-masters.service.spec`
Expected: 기존 delete/hardDelete 테스트 PASS (getMasters 변경이 이들에 영향 없음).

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-masters.service.ts
git commit -m "feat(catalog): add productType/approvalStatus/createdAt filters and dynamic sort to getMasters"
```

---

### Task 5: 컨트롤러를 DTO에 바인딩하고 신규 필드 매핑

인라인 `@Query()` 객체와 수동 파싱을 DTO로 교체한다. `page/limit/deleted/ids` 형변환은 이제 DTO가 담당하므로 컨트롤러는 필드 전달만 한다.

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.ts` (96-149 Swagger, 150-188 handler)
- Test: `apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.spec.ts`

**Interfaces:**
- Consumes: `ListProductMastersQueryDto` (Task 2), 확장된 `getMasters` filters (Task 4)
- Produces: 서비스에 넘기는 filters 객체 —
  ```ts
  { page, limit, categoryId, brand, name /* = q ?? name */, mode,
    productType, approvalStatus, createdFrom, createdTo, sort, order,
    deleted, ids }
  ```

- [ ] **Step 1: 기존 컨트롤러 테스트를 새 계약으로 갱신 + 신규 케이스 추가 (실패 유도)**

`apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.spec.ts`의 기존 `it('maps q query parameter ...')` 테스트를 아래로 교체하고, 새 테스트를 추가한다. (DTO 변환 후 컨트롤러가 받는 값은 이미 number/boolean/array 이므로 입력을 그 형태로 준다.)
```ts
  it('maps q to the keyword(name) filter and forwards typed fields', async () => {
    const { controller, productMastersService } = makeController();

    await controller.getMasters({ page: 2, limit: 20, q: '립스틱' } as any);

    expect(productMastersService.getMasters).toHaveBeenCalledWith({
      page: 2,
      limit: 20,
      categoryId: undefined,
      brand: undefined,
      name: '립스틱',
      mode: undefined,
      productType: undefined,
      approvalStatus: undefined,
      createdFrom: undefined,
      createdTo: undefined,
      sort: undefined,
      order: undefined,
      deleted: false,
      ids: undefined,
    });
  });

  it('forwards the new filter and sort fields to the service', async () => {
    const { controller, productMastersService } = makeController();

    await controller.getMasters({
      productType: 'limited_edition',
      approvalStatus: 'pending',
      createdFrom: '2026-01-01',
      createdTo: '2026-01-31',
      sort: 'name',
      order: 'asc',
      deleted: true,
      ids: ['id-1', 'id-2'],
    } as any);

    expect(productMastersService.getMasters).toHaveBeenCalledWith(
      expect.objectContaining({
        productType: 'limited_edition',
        approvalStatus: 'pending',
        createdFrom: '2026-01-01',
        createdTo: '2026-01-31',
        sort: 'name',
        order: 'asc',
        deleted: true,
        ids: ['id-1', 'id-2'],
      }),
    );
  });

  it('falls back to the name alias when q is absent', async () => {
    const { controller, productMastersService } = makeController();
    await controller.getMasters({ name: '토너' } as any);
    expect(productMastersService.getMasters).toHaveBeenCalledWith(
      expect.objectContaining({ name: '토너' }),
    );
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest product-masters.controller.spec`
Expected: FAIL — 현재 컨트롤러는 신규 필드를 전달하지 않고, `page:'2'`가 아니라 `page:2`를 받는 매핑도 아직 없음.

- [ ] **Step 3: 핸들러를 DTO로 교체 (150-188)**

기존 `getMasters(@Query() query: { page?: string; ... })` 블록 전체(150-188)를 아래로 교체:
```ts
  async getMasters(
    @Query() query: ListProductMastersQueryDto,
  ): Promise<PaginatedResponseDto<ProductSummaryDto>> {
    const keyword = (query.q ?? query.name)?.trim() || undefined;

    const filters = {
      page: query.page,
      limit: query.limit,
      categoryId: query.categoryId,
      brand: query.brand,
      name: keyword,
      mode: query.mode,
      productType: query.productType,
      approvalStatus: query.approvalStatus,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
      sort: query.sort,
      order: query.order,
      deleted: query.deleted ?? false,
      ids: query.ids && query.ids.length > 0 ? query.ids : undefined,
    };

    const result = await this.productMastersService.getMasters(filters);

    return {
      data: result.data.map((item) =>
        ProductMasterMapper.toProductSummary({ ...item.product, ...item.aggregate }),
      ),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }
```

- [ ] **Step 4: DTO import 추가**

컨트롤러 상단 import에 추가:
```ts
import { ListProductMastersQueryDto } from '../dto/list-product-masters-query.dto';
```

- [ ] **Step 5: Swagger `@ApiQuery` 보강 (96-149)**

기존 `@ApiQuery` 블록들(page/limit/categoryId/brand/q/mode/deleted/ids) 뒤, `@ApiOkResponsePaginated` 앞에 신규 파라미터 문서를 추가:
```ts
  @ApiQuery({ name: 'productType', required: false, enum: ['regular_sale', 'limited_edition'], description: '상품 유형' })
  @ApiQuery({ name: 'approvalStatus', required: false, enum: ['draft', 'pending', 'approved', 'rejected'], description: '승인 상태' })
  @ApiQuery({ name: 'createdFrom', required: false, type: String, description: '등록일 시작(ISO). product_masters.createdAt 기준' })
  @ApiQuery({ name: 'createdTo', required: false, type: String, description: '등록일 종료(ISO)' })
  @ApiQuery({ name: 'sort', required: false, enum: ['createdAt', 'name', 'updatedAt'], description: '정렬 기준 (기본 createdAt)' })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'], description: '정렬 방향 (기본 desc)' })
```

- [ ] **Step 6: 통과 확인**

Run: `npx jest product-masters.controller.spec`
Expected: PASS (3 tests).

- [ ] **Step 7: `forbidNonWhitelisted` 확인(하위호환 안전장치)**

Run: `grep -n "forbidNonWhitelisted\|whitelist\|transform" apps/core/src/main.ts`
Expected: `whitelist: true, transform: true` 확인. 만약 `forbidNonWhitelisted: true`도 켜져 있다면, 프론트 `MastersQuery`가 언젠가 보낼 수 있는 미정의 파라미터(`search`, `pricingStrategy`, `status`)에 400이 날 수 있으므로 — 이 경우에만 DTO에 해당 optional 필드(`@IsOptional() @IsString() search?`, 등)를 추가한다. `forbidNonWhitelisted`가 없으면(=whitelist가 조용히 무시) 조치 불필요.

- [ ] **Step 8: 전체 빌드 확인**

Run: `npm run build:core`
Expected: 성공.

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.ts \
        apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.spec.ts
git commit -m "feat(catalog): bind GET /masters to ListProductMastersQueryDto and forward new filters"
```

---

# PR 2 — 프론트엔드 (apps/admin-web)

### Task 6: `parseDateRangeParam` — date 필터 JSON 파서

프레임워크의 `date` 필터는 단일 URL 파라미터에 JSON `{"$gte":ISO,"$lte":ISO}`를 기록한다. 이를 `{from, to}`로 파싱하는 순수 함수.

**Files:**
- Create: `apps/admin-web/src/hooks/table/query/date-range-param.ts`
- Test: `apps/admin-web/src/hooks/table/query/date-range-param.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `parseDateRangeParam(raw?: string): { from?: string; to?: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/admin-web/src/hooks/table/query/date-range-param.spec.ts`:
```ts
import { parseDateRangeParam } from './date-range-param';

describe('parseDateRangeParam', () => {
  it('returns empty object for undefined/empty input', () => {
    expect(parseDateRangeParam(undefined)).toEqual({});
    expect(parseDateRangeParam('')).toEqual({});
  });

  it('extracts $gte/$lte into from/to', () => {
    const raw = JSON.stringify({ $gte: '2026-01-01T00:00:00.000Z', $lte: '2026-01-31T00:00:00.000Z' });
    expect(parseDateRangeParam(raw)).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
    });
  });

  it('tolerates a partial range', () => {
    expect(parseDateRangeParam(JSON.stringify({ $gte: '2026-01-01T00:00:00.000Z' }))).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: undefined,
    });
  });

  it('returns empty object on malformed JSON', () => {
    expect(parseDateRangeParam('not-json')).toEqual({});
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest date-range-param.spec`
Expected: FAIL — "Cannot find module './date-range-param'".

- [ ] **Step 3: 구현**

Create `apps/admin-web/src/hooks/table/query/date-range-param.ts`:
```ts
/**
 * DataTable `date` 필터가 URL 파라미터에 기록한 JSON(`{$gte,$lte}`)을 파싱한다.
 * 잘못된 값이면 조용히 빈 객체를 반환한다.
 */
export function parseDateRangeParam(raw?: string): { from?: string; to?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { $gte?: string; $lte?: string };
    return { from: parsed.$gte, to: parsed.$lte };
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest date-range-param.spec`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/hooks/table/query/date-range-param.ts \
        apps/admin-web/src/hooks/table/query/date-range-param.spec.ts
git commit -m "feat(admin-web): add parseDateRangeParam for date-range filter params"
```

---

### Task 7: `toCategoryFilterOptions` — 카테고리 트리→필터 옵션

기존 `flattenCategoryTree`가 만든 `SelectableCategory[]`를 `select` 필터가 먹는 `FilterOption[]`(`{label: pathLabel, value: id}`)로 매핑하는 순수 함수.

**Files:**
- Create: `apps/admin-web/src/hooks/table/filters/category-filter-options.ts`
- Test: `apps/admin-web/src/hooks/table/filters/category-filter-options.spec.ts`

**Interfaces:**
- Consumes: `SelectableCategory` 타입(`.../general/basic-information-model`), `FilterOption` 타입(`.../data-table-filter/types`) — 둘 다 `import type`로만
- Produces: `toCategoryFilterOptions(categories: SelectableCategory[]): FilterOption[]`

- [ ] **Step 1: 실패하는 테스트 작성** (타입 import 없이 순수 객체로)

Create `apps/admin-web/src/hooks/table/filters/category-filter-options.spec.ts`:
```ts
import { toCategoryFilterOptions } from './category-filter-options';

describe('toCategoryFilterOptions', () => {
  it('maps pathLabel to label and id to value', () => {
    const result = toCategoryFilterOptions([
      { id: 'c1', name: '스킨케어', pathLabel: '스킨케어', depth: 0, parentId: null, isActive: true },
      { id: 'c2', name: '토너', pathLabel: '스킨케어 / 토너', depth: 1, parentId: 'c1', isActive: true },
    ]);
    expect(result).toEqual([
      { label: '스킨케어', value: 'c1' },
      { label: '스킨케어 / 토너', value: 'c2' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(toCategoryFilterOptions([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest category-filter-options.spec`
Expected: FAIL — "Cannot find module './category-filter-options'".

- [ ] **Step 3: 구현** (런타임 import 없음 — 타입만)

Create `apps/admin-web/src/hooks/table/filters/category-filter-options.ts`:
```ts
import type { SelectableCategory } from '@/features/mall/products-detail/components/general/basic-information-model';
import type { FilterOption } from '@/components/data-table/data-table-filter/types';

/** 평탄화된 카테고리 목록을 select 필터 옵션으로 변환한다. label 은 전체 경로(pathLabel). */
export function toCategoryFilterOptions(categories: SelectableCategory[]): FilterOption[] {
  return categories.map((category) => ({ label: category.pathLabel, value: category.id }));
}
```
> `import type`은 ts-jest에서 런타임 코드로 남지 않으므로(erased) node 환경 spec에서 `@/` 경로가 문제되지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest category-filter-options.spec`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/hooks/table/filters/category-filter-options.ts \
        apps/admin-web/src/hooks/table/filters/category-filter-options.spec.ts
git commit -m "feat(admin-web): add toCategoryFilterOptions mapping helper"
```

---

### Task 8: `MastersQuery` 타입 확장 + 쿼리 훅 매핑

신규 URL 파라미터를 읽어 `MastersQuery`로 매핑한다. `createdAt`(date 필터의 JSON)은 `parseDateRangeParam`으로 `createdFrom`/`createdTo`로 변환한다.

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/products.ts` (123-135, `MastersQuery`)
- Modify: `apps/admin-web/src/hooks/table/query/use-products-list-table-query.ts` (전체)

**Interfaces:**
- Consumes: `parseDateRangeParam` (Task 6)
- Produces: 확장된 `MastersQuery` (아래) 와, 이를 채우는 `useProductsListTableQuery`
  ```ts
  interface MastersQuery {
    // 기존: q, search, pricingStrategy, brand, categoryId, status, mode, limit, page
    productType?: 'regular_sale' | 'limited_edition';
    approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
    createdFrom?: string; createdTo?: string;
    sort?: 'createdAt' | 'name' | 'updatedAt';
    order?: 'asc' | 'desc';
  }
  ```

- [ ] **Step 1: `MastersQuery`에 신규 필드 추가**

`apps/admin-web/src/lib/types/dto/products.ts`의 `MastersQuery`(123-135)에서 `mode` 아래, `limit` 위에 삽입:
```ts
  productType?: 'regular_sale' | 'limited_edition';
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  /** 등록일 범위 시작(ISO). product_masters.createdAt 기준 */
  createdFrom?: string;
  createdTo?: string;
  sort?: 'createdAt' | 'name' | 'updatedAt';
  order?: 'asc' | 'desc';
```

- [ ] **Step 2: 쿼리 훅을 신규 파라미터까지 읽도록 교체**

`apps/admin-web/src/hooks/table/query/use-products-list-table-query.ts` 전체를 아래로 교체:
```ts
import type { MastersQuery } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';
import { parseDateRangeParam } from './date-range-param';

type UseProductsListTableQueryProps = {
  pageSize?: number;
};

export const useProductsListTableQuery = ({
  pageSize = 20,
}: UseProductsListTableQueryProps = {}) => {
  const queryObject = useQueryParams([
    'page', 'q', 'categoryId', 'brand', 'mode',
    'productType', 'approvalStatus', 'createdAt', 'sort', 'order',
  ]);

  const { page, q, categoryId, brand, mode, productType, approvalStatus, createdAt, sort, order } =
    queryObject;

  const { from: createdFrom, to: createdTo } = parseDateRangeParam(createdAt);

  const searchParams: MastersQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q: q?.trim() || undefined,
    categoryId,
    brand,
    mode: mode === 'active-or-inactive' || mode === 'all' ? mode : undefined,
    productType:
      productType === 'regular_sale' || productType === 'limited_edition' ? productType : undefined,
    approvalStatus:
      approvalStatus === 'draft' ||
      approvalStatus === 'pending' ||
      approvalStatus === 'approved' ||
      approvalStatus === 'rejected'
        ? approvalStatus
        : undefined,
    createdFrom,
    createdTo,
    sort: sort === 'createdAt' || sort === 'name' || sort === 'updatedAt' ? sort : undefined,
    order: order === 'asc' || order === 'desc' ? order : undefined,
  };

  return { searchParams, raw: queryObject };
};
```
> 왜 인라인 유니온 좁히기인가: `useQueryParams`는 `string | undefined`를 주므로 `as` 캐스팅 대신 값 검사로 안전하게 좁힌다(타입 안전 규칙 준수).

- [ ] **Step 3: 타입체크(프론트 빌드)**

Run: `npm run build:admin-web`
Expected: 성공. `MastersQuery`에 없는 속성 대입 에러가 나오면 Step 1 누락.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/lib/types/dto/products.ts \
        apps/admin-web/src/hooks/table/query/use-products-list-table-query.ts
git commit -m "feat(admin-web): map category/type/approval/date/sort params into MastersQuery"
```

---

### Task 9: 필터 UI 추가 (카테고리·브랜드·상품유형·승인상태·등록일)

정적이던 필터 훅을 카테고리 트리 로딩까지 하도록 확장한다. 프레임워크가 각 `Filter` 설정을 자동 렌더한다.

**Files:**
- Modify: `apps/admin-web/src/hooks/table/filters/use-products-list-table-filters.ts` (전체)

**Interfaces:**
- Consumes: `useCategoryTree` (`@/lib/services/products/queries`), `flattenCategoryTree` (`.../general/basic-information-model`), `toCategoryFilterOptions` (Task 7)
- Produces: 확장된 `useProductsListTableFilters(): Filter[]` — key 순서 `mode, categoryId, brand, productType, approvalStatus, createdAt`

- [ ] **Step 1: 필터 훅 전체 교체**

`apps/admin-web/src/hooks/table/filters/use-products-list-table-filters.ts` 전체를 아래로 교체:
```ts
import { useMemo } from 'react';
import type { Filter } from '@/components/data-table';
import { useCategoryTree } from '@/lib/services/products/queries';
import { flattenCategoryTree } from '@/features/mall/products-detail/components/general/basic-information-model';
import { toCategoryFilterOptions } from './category-filter-options';

export function useProductsListTableFilters(): Filter[] {
  const { data: categoryTree } = useCategoryTree({ includeInactive: true });

  const categoryOptions = useMemo(
    () => toCategoryFilterOptions(flattenCategoryTree(categoryTree?.categories ?? [])),
    [categoryTree?.categories],
  );

  return [
    // GET /masters 는 status 필터 대신 mode 를 노출한다.
    {
      key: 'mode',
      label: '판매 상태',
      type: 'select',
      options: [
        { label: '판매중', value: 'active' },
        { label: '판매중단 포함', value: 'active-or-inactive' },
        { label: '작성중(임시) 포함', value: 'all' },
      ],
    },
    {
      key: 'categoryId',
      label: '카테고리',
      type: 'select',
      searchable: true,
      options: categoryOptions,
    },
    {
      key: 'brand',
      label: '브랜드',
      type: 'string',
    },
    {
      key: 'productType',
      label: '상품 유형',
      type: 'select',
      options: [
        { label: '정상판매', value: 'regular_sale' },
        { label: '한정판', value: 'limited_edition' },
      ],
    },
    {
      key: 'approvalStatus',
      label: '승인 상태',
      type: 'select',
      options: [
        { label: '임시저장', value: 'draft' },
        { label: '승인대기', value: 'pending' },
        { label: '승인완료', value: 'approved' },
        { label: '반려', value: 'rejected' },
      ],
    },
    {
      key: 'createdAt',
      label: '등록일',
      type: 'date',
    },
  ];
}
```
> `flattenCategoryTree(categoryTree?.categories ?? [])` 는 상품 편집 폼(`general/index.tsx:98-104`)과 동일한 사용 패턴이라 타입이 맞는다.

- [ ] **Step 2: 타입체크(프론트 빌드)**

Run: `npm run build:admin-web`
Expected: 성공.

- [ ] **Step 3: 관련 프론트 스펙 회귀 없음 확인**

Run: `npx jest apps/admin-web`
Expected: 기존 admin-web 스펙 + Task 6·7 신규 스펙 PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/hooks/table/filters/use-products-list-table-filters.ts
git commit -m "feat(admin-web): add category/brand/type/approval/created filters to product list"
```

---

### Task 10: 정렬 UI (`orderBy` prop) 추가

`ProductsListTable`이 `DataTable`에 `orderBy`를 넘겨 정렬 컨트롤을 렌더하게 한다. 프레임워크가 `sort`/`order` URL 파라미터를 쓰고, Task 8의 쿼리 훅이 이를 읽는다.

**Files:**
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx` (82-97, `<DataTable>` props)

**Interfaces:**
- Consumes: `DataTable`의 `orderBy?: { key: string; label: string }[]` prop
- Produces: 없음 (UI 배선). `sort` 키는 백엔드 DTO enum(`createdAt|name|updatedAt`)과 일치해야 한다.

- [ ] **Step 1: `<DataTable>`에 `orderBy` prop 추가**

`table/index.tsx`의 `<DataTable ... filters={filters} search ...>`에서 `search` 다음 줄에 추가:
```tsx
        orderBy={[
          { key: 'createdAt', label: '등록일' },
          { key: 'name', label: '상품명' },
          { key: 'updatedAt', label: '수정일' },
        ]}
```

- [ ] **Step 2: 타입체크(프론트 빌드)**

Run: `npm run build:admin-web`
Expected: 성공. `orderBy` prop 타입 불일치가 나오면 각 항목이 `{key,label}` 형태인지 확인.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/src/features/mall/products-list/components/table/index.tsx
git commit -m "feat(admin-web): enable sort controls on product list table"
```

---

### Task 11: 엔드투엔드 검증 (백엔드 API + 관리자 UI)

유닛 테스트가 닿지 않는 실제 필터링/정렬 동작을 실행으로 확인한다.

**Files:** 없음 (검증 전용)

**Interfaces:**
- Consumes: 실행 중인 core 서버 + admin-web dev 서버 (또는 core만 curl)

- [ ] **Step 1: 전체 빌드 + 관련 스펙 최종 통과**

Run:
```bash
npm run build:core && npm run build:admin-web && npx jest catalog/core/products date-range-param category-filter-options
```
Expected: 빌드 성공 + 전 스펙 PASS.

- [ ] **Step 2: core 서버 기동**

Run(백그라운드): `npm run start:main:dev`
서버가 `PORT`에서 뜰 때까지 대기(로그에 Nest 애플리케이션 시작 확인).

- [ ] **Step 3: 신규 필터 파라미터 스모크 (curl)**

각 명령이 200 + `{ data, total, page, limit }` shape를 반환하고 필터가 반영되는지 확인. `<PORT>`/인증 헤더는 로컬 설정에 맞춘다.
```bash
# 키워드(name+productCode) — 품번코드로 검색해도 매칭되는지
curl -s "http://localhost:<PORT>/masters?q=<품번코드일부>&limit=5" | jq '.total, (.data[0] | {name, masterId})'

# 상품 유형 필터
curl -s "http://localhost:<PORT>/masters?productType=limited_edition&mode=all&limit=5" | jq '.total'

# 승인 상태 필터 (승인 파이프라인 확인 — mode=all 과 함께)
curl -s "http://localhost:<PORT>/masters?approvalStatus=pending&mode=all&limit=5" | jq '.total'

# 등록일 범위
curl -s "http://localhost:<PORT>/masters?createdFrom=2026-01-01&createdTo=2026-12-31&limit=5" | jq '.total'

# 정렬 (이름 오름차순)
curl -s "http://localhost:<PORT>/masters?sort=name&order=asc&limit=5" | jq '[.data[].name]'

# 잘못된 enum 은 400 (ValidationPipe)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:<PORT>/masters?productType=bogus"
```
Expected: 앞 5개는 200·필터 반영; 마지막은 `400`.

- [ ] **Step 4: 관리자 UI 확인**

Run(백그라운드): `npm run start:admin-web:dev` → 브라우저에서 `/mall/products-list` 접속.
확인 체크리스트:
  - "필터 추가" 드롭다운에 **카테고리·브랜드·상품 유형·승인 상태·등록일**이 보인다.
  - 카테고리 필터는 검색 가능한 셀렉트이고, 옵션 라벨이 전체 경로(`상위 / 하위`)로 나온다.
  - 각 필터 선택 시 URL 파라미터가 갱신되고 목록이 필터링된다(페이지는 1로 리셋).
  - 등록일 필터는 from/to 범위 달력이며 선택 시 목록이 좁혀진다.
  - 정렬 컨트롤에 등록일/상품명/수정일이 있고, 방향 토글이 동작한다.
  - 결과 없음일 때 "상품 데이터가 없습니다." 표시.

- [ ] **Step 5: 서버 종료**

기동한 백그라운드 프로세스를 정리한다.

- [ ] **Step 6: (선택) verify 스킬로 마무리**

가능하면 `verify` 스킬로 위 흐름을 한 번 더 구동해 회귀가 없는지 확인한다.

---

## Self-Review

**1. Spec coverage** — 범위(선행 리팩터 + Tier 0~1, 죽은 서비스 흡수 후 삭제, 성능 보류) 대비:
- DTO 전환 → Task 2, 5 ✓
- 죽은 `ProductSearchService`/`ProductQueryDto` 삭제 → Task 1 ✓
- 카테고리 필터 → Task 7, 9 ✓ / 브랜드(free-text) → Task 9 ✓
- 상품유형·승인상태 → Task 4(WHERE), 5(매핑), 9(UI) ✓
- 등록일 범위 → Task 4(WHERE, master.createdAt), 6(파서), 9(UI) ✓
- 정렬 → Task 3(리졸버), 4(ORDER), 8(쿼리), 10(UI) ✓
- 키워드 name+productCode 확장 → Task 4 ✓
- 성능/trigram/ES → 의도적으로 범위 밖(Global Constraints 명시) ✓
- 마이그레이션 → 불필요(모든 컬럼·인덱스 기존 존재) ✓

**2. Placeholder scan** — TBD/TODO/"적절히 처리" 없음. 모든 코드 스텝에 실제 코드 포함. Task 4는 신규 유닛 테스트를 두지 않는 이유(쿼리 체인 목 취약)를 명시하고 타입체크+회귀+E2E로 대체 — placeholder 아님.

**3. Type consistency** — filters 키·enum 문자열 일관 확인:
- 백엔드 filters 필드명 `name`(키워드)로 통일, 컨트롤러 매핑(`name: q ?? name`) ↔ 서비스 사용 일치.
- enum 값 `regular_sale|limited_edition`, `draft|pending|approved|rejected`, `active|active-or-inactive|all`, `createdAt|name|updatedAt`, `asc|desc` — DTO(Task 2)·서비스 타입(Task 4)·`MastersQuery`(Task 8)·필터 옵션(Task 9)·orderBy 키(Task 10)·리졸버(Task 3) 전부 동일.
- `sort`/`order` 파라미터명이 프레임워크(`DataTableOrderBy`)·쿼리 훅·백엔드 DTO에서 모두 동일(`sortBy`/`sortOrder` 혼용 없음).
- 정렬 리졸버 반환 `{column, direction}` ↔ 서비스 사용 `sortDirection(sortColumn)` 일치.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-06-admin-product-search-filters.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
