# '작성중인 상품'(내 draft 목록) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인 관리자가 자신이 만든 draft(임시저장) 상품 버전을 `/mall/my-drafts`에서 조회하고 골라서 편집을 이어갈 수 있게 한다.

**Architecture:** (1) 백엔드 `core`가 상품 생성 시 `draftOwnerId`를 기록하도록 고치고, (2) 소유자 필터 전용 엔드포인트 `GET /versions/my-drafts`를 추가한다. (3) admin-web에 기존 `products-list` 목록 디자인을 참고한 새 라우트를 만들어 "이어서 편집"으로 기존 편집 화면(`/mall/products-list/{masterId}?versionId={versionId}`)에 진입한다.

**Tech Stack:** NestJS + Drizzle ORM (postgres.js) · Next.js App Router + TanStack Table + TanStack Query · Jest.

## Global Constraints

- **Layer**: Controller(thin) → Service → Repository. 서비스는 `@app/shared` 도메인 예외를 던진다. 컨트롤러는 서비스 호출을 try/catch 로 감싸지 않는다(단, 기존 `createMaster`의 try/catch 는 이번 범위에서 리팩터하지 않고 유지).
- **Drizzle 쿼리 규칙(catalog)**: `trx.select().from().innerJoin().where().orderBy()` 형태. `db.query.*`/`with` 관계 로딩 금지. 정당화 없는 `any`/`as` 금지.
- **날짜 매핑**: DB `Date` → 응답 문자열은 `DateMapper.toNotNullString(date)`(not-null) / `DateMapper.toNullableString(date)`(nullable). `apps/core/src/modules/catalog/common/mappers/date.mapper.ts`.
- **Nullable 정규화**: `string ?? ''`, `number ?? 0`, `date ?? undefined`.
- **인증**: 현재 사용자 id 는 `@User() user: { userId: string }`(`@app/authorization`). `userId = JWT.sub`.
- **스키마 변경 커밋 규칙**: `schema.ts` + `drizzle/<timestamp>_*.sql` + `drizzle/meta/` 를 **한 커밋**에. `draft_owner_id` 인덱스는 순수 additive → 코드와 같은 PR 가능.
- **DB 주입**: 기존 서비스가 이미 `@InjectDb()` 로 주입받음 — 변경 없음.
- **커밋 프리픽스**: `[core]` / `[admin-web]`. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

**Backend (`apps/core`)**
- `modules/catalog/core/products/services/product-masters.service.ts` — `createMaster(ownerId, tx?)` 로 시그니처 변경, 소유자 기록.
- `modules/catalog/core/products/controllers/product-masters.controller.ts` — `createMaster` 에 `@User` 주입.
- `modules/catalog/core/products/dto/my-drafts.dto.ts` (신규) — `ListMyDraftsQueryDto`, `MyDraftListItemDto`.
- `modules/catalog/core/products/services/product-versions.service.ts` — `getMyDraftVersions(userId, filters, tx?)` 추가.
- `modules/catalog/core/products/controllers/product-versions.controller.ts` — `GET /versions/my-drafts`.
- `modules/catalog/schema/catalog.schema.ts` — `product_master_versions` 에 `draft_owner_id` 인덱스.
- `drizzle/<ts>_add-draft-owner-id-index.sql` (+ meta, 생성물)

**Frontend (`apps/admin-web`)**
- `lib/types/dto/products.ts` — `MyDraftListItem`, `MyDraftsQuery`, `MyDraftsResponse`.
- `lib/api/domains/products/versions.client.ts` — `listMyDrafts`.
- `lib/services/products/query-keys.ts` — `myDrafts` 키.
- `lib/services/products/queries.ts` — `useMyDrafts`.
- `features/mall/my-drafts/lib/draft-edit-path.ts` (신규) — 순수 URL 빌더.
- `hooks/table/query/use-my-drafts-table-query.ts` (신규)
- `hooks/table/columns/use-my-drafts-table-columns.tsx` (신규)
- `features/mall/my-drafts/components/table/index.tsx` (신규)
- `features/mall/my-drafts/template/index.tsx` (신규)
- `app/(admin)/mall/my-drafts/page.tsx` (신규)
- `lib/utils/menu.ts` — '작성중인 상품' 메뉴 항목.

---

### Task 1: [core] Record draft owner on product creation

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts:176-197`
- Modify: `apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.ts:64-72`
- Test: `apps/core/src/modules/catalog/core/products/services/product-masters.service.spec.ts`

**Interfaces:**
- Produces: `ProductMastersService.createMaster(ownerId: string, tx?: DbTransaction): Promise<ProductMasterVersion>` — 첫 draft 버전의 `draftOwnerId` 와 `createdBy` 를 `ownerId` 로 기록.
- Consumes: `@User()` from `@app/authorization` (이미 같은 컨트롤러의 `deleteMaster`/`hardDelete`가 사용 중).

- [ ] **Step 1: Write the failing test**

`product-masters.service.spec.ts` 파일의 기존 `makeService()` 를 재사용하는 새 describe 를 파일 하단에 추가한다:

```ts
describe('ProductMastersService.createMaster ownership', () => {
  it('records the creating user as draft owner and creator on the initial version', async () => {
    const { service } = makeService();
    const insertedValues: any[] = [];
    const tx: any = {
      insert: jest.fn(() => ({
        values: (v: any) => {
          insertedValues.push(v);
          return { returning: () => [{ id: v.id ?? 'generated-id', ...v }] };
        },
      })),
    };
    // publishVariantCreatedEvent 은 이벤트 발행이라 스텁 처리(deleteMaster 테스트의 _emit* 스텁과 동일 패턴)
    (service as any).publishVariantCreatedEvent = jest.fn().mockResolvedValue(undefined);

    await service.createMaster('user-123', tx);

    const versionValues = insertedValues.find((v) => v.status === 'draft' && 'masterId' in v);
    expect(versionValues.draftOwnerId).toBe('user-123');
    expect(versionValues.createdBy).toBe('user-123');

    const masterValues = insertedValues.find(
      (v) => 'id' in v && !('masterId' in v) && !('variantName' in v)
    );
    expect(masterValues.createdBy).toBe('user-123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern='product-masters.service.spec' -t 'ownership'`
Expected: FAIL — `createMaster` 는 현재 인자를 받지 않고 `createdBy` 가 `'00000000-0000-0000-0000-000000000000'`, `draftOwnerId` 미설정.

- [ ] **Step 3: Implement — service**

`product-masters.service.ts` 의 `createMaster` 를 수정한다.

기존:
```ts
  async createMaster(tx?: DbTransaction): Promise<ProductMasterVersion> {
    return this.db.run(async (tx) => {
      const masterId = uuidv7();
      const versionId = uuidv7();

      // 1. 마스터 메타데이터 생성
      const [master] = await tx
        .insert(productMasters)
        .values({
          id: masterId,
        })
        .returning();

      // 2. 첫 번째 버전 생성
      const versionData = {
        id: versionId,
        masterId: masterId,
        createdBy: '00000000-0000-0000-0000-000000000000',
        status: 'draft' as const,
      };
```

변경:
```ts
  async createMaster(ownerId: string, tx?: DbTransaction): Promise<ProductMasterVersion> {
    return this.db.run(async (tx) => {
      const masterId = uuidv7();
      const versionId = uuidv7();

      // 1. 마스터 메타데이터 생성
      const [master] = await tx
        .insert(productMasters)
        .values({
          id: masterId,
          createdBy: ownerId,
        })
        .returning();

      // 2. 첫 번째 버전 생성 (생성자를 draft 소유자로 기록 → '내 작성중 상품' 목록의 기준)
      const versionData = {
        id: versionId,
        masterId: masterId,
        draftOwnerId: ownerId,
        createdBy: ownerId,
        status: 'draft' as const,
      };
```

(이후 로직은 그대로 둔다.)

- [ ] **Step 4: Implement — controller**

`product-masters.controller.ts` 의 `createMaster` 를 수정한다.

기존:
```ts
  async createMaster(): Promise<ProductDto> {
    try {
      const master = await this.productMastersService.createMaster();
```

변경(파라미터만 추가, 나머지 try/catch 유지):
```ts
  async createMaster(@User() user: { userId: string }): Promise<ProductDto> {
    try {
      const master = await this.productMastersService.createMaster(user.userId);
```

`User` 는 이미 파일 상단에서 `import { Public, User } from '@app/authorization';` 로 임포트돼 있으므로 추가 임포트 불필요.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest --testPathPattern='product-masters.service.spec'`
Expected: PASS (기존 테스트 포함 전부 통과).

- [ ] **Step 6: Typecheck**

Run: `npx nest build core`
Expected: 빌드 성공 (다른 `createMaster()` 호출부 없음 — 유일 호출자는 방금 고친 컨트롤러).

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-masters.service.ts \
        apps/core/src/modules/catalog/core/products/controllers/product-masters.controller.ts \
        apps/core/src/modules/catalog/core/products/services/product-masters.service.spec.ts
git commit -m "$(cat <<'EOF'
[core] 상품 생성 시 draft 소유자(draftOwnerId) 기록

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: [core] my-drafts DTOs + getMyDraftVersions service

**Files:**
- Create: `apps/core/src/modules/catalog/core/products/dto/my-drafts.dto.ts`
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts` (drizzle import line 44; 새 메서드 추가)
- Test: `apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts`

**Interfaces:**
- Produces (DTO):
  - `class ListMyDraftsQueryDto extends PaginationQueryDto { q?: string; sort?: 'updatedAt'|'createdAt'; order?: 'asc'|'desc' }`
  - `class MyDraftListItemDto { masterId; versionId; name; thumbnail: string|null; brand: string|null; productType: string; status: 'draft'; createdAt: string; updatedAt: string }`
- Produces (service): `getMyDraftVersions(userId: string, filters?: { page?; limit?; q?; sort?; order? }, tx?: DbTransaction): Promise<{ data: MyDraftRow[]; total: number; page: number; limit: number }>` where `MyDraftRow = { masterId; versionId; name; thumbnail: string|null; brand: string|null; productType: string; createdAt: Date; updatedAt: Date }`. `total` 은 **별도 count 쿼리** 기반(rows.length 아님).
- Consumes: `productMasterVersions`, `productMasters` (이미 임포트됨), drizzle `eq/and/isNull/asc/desc` (임포트됨) + `ilike/count` (추가).

- [ ] **Step 1: Create the DTO file**

`apps/core/src/modules/catalog/core/products/dto/my-drafts.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto';

export class ListMyDraftsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '상품명 검색 키워드 (부분 일치)' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: ['updatedAt', 'createdAt'], description: '정렬 기준 (기본 updatedAt)' })
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt'])
  sort?: 'updatedAt' | 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: '정렬 방향 (기본 desc)' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class MyDraftListItemDto {
  @ApiProperty() masterId: string;
  @ApiProperty() versionId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) thumbnail: string | null;
  @ApiProperty({ type: String, nullable: true }) brand: string | null;
  @ApiProperty() productType: string;
  @ApiProperty({ enum: ['draft'] }) status: 'draft';
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
```

- [ ] **Step 2: Write the failing service test**

`product-versions.service.spec.ts` 하단에 새 describe 추가:
```ts
describe('ProductVersionsService.getMyDraftVersions', () => {
  function makeBareService() {
    return new ProductVersionsService(
      { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any,
      {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
  }

  it('returns caller drafts with a count-based total (not the page length)', async () => {
    const rows = [
      {
        masterId: 'm1', versionId: 'v1', name: 'A', thumbnail: null, brand: null,
        productType: 'regular_sale',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-06T00:00:00.000Z'),
      },
    ];
    const tx: any = {
      select: jest.fn(() => {
        const builder: any = {
          from: () => builder,
          innerJoin: () => builder,
          where: () => builder,
          orderBy: () => builder,
          limit: () => builder,
          offset: () => Promise.resolve(rows),
          // count 쿼리는 .where() 결과를 await → then 으로 [{ value }] 반환
          then: (resolve: any, reject: any) =>
            Promise.resolve([{ value: 7 }]).then(resolve, reject),
        };
        return builder;
      }),
    };

    const service = makeBareService();
    const result = await service.getMyDraftVersions('user-1', { page: 2, limit: 10 }, tx);

    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.data).toEqual(rows);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest --testPathPattern='product-versions.service.spec' -t 'getMyDraftVersions'`
Expected: FAIL — `getMyDraftVersions` 미정의.

- [ ] **Step 4: Add drizzle imports**

`product-versions.service.ts:44` 의 import 에 `ilike`, `count` 를 추가:
```ts
import { eq, and, sql, max as drizzleMax, isNull, inArray, asc, desc, ilike, count } from 'drizzle-orm';
```

- [ ] **Step 5: Implement the service method**

`product-versions.service.ts` 의 기존 `getDraftVersions` 메서드 **바로 아래**에 추가:
```ts
  async getMyDraftVersions(
    userId: string,
    filters?: {
      page?: number;
      limit?: number;
      q?: string;
      sort?: 'updatedAt' | 'createdAt';
      order?: 'asc' | 'desc';
    },
    tx?: DbTransaction,
  ): Promise<{
    data: Array<{
      masterId: string;
      versionId: string;
      name: string;
      thumbnail: string | null;
      brand: string | null;
      productType: string;
      createdAt: Date;
      updatedAt: Date;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const offset = (page - 1) * limit;

    const sortColumn =
      filters?.sort === 'createdAt' ? productMasterVersions.createdAt : productMasterVersions.updatedAt;
    const orderFn = filters?.order === 'asc' ? asc : desc;

    // and() 는 undefined 조건을 자동으로 무시한다.
    const whereClause = and(
      eq(productMasterVersions.status, 'draft'),
      eq(productMasterVersions.draftOwnerId, userId),
      isNull(productMasterVersions.deletedAt),
      isNull(productMasters.deletedAt),
      filters?.q ? ilike(productMasterVersions.name, `%${filters.q}%`) : undefined,
    );

    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          masterId: productMasterVersions.masterId,
          versionId: productMasterVersions.id,
          name: productMasterVersions.name,
          thumbnail: productMasterVersions.thumbnail,
          brand: productMasterVersions.brand,
          productType: productMasterVersions.productType,
          createdAt: productMasterVersions.createdAt,
          updatedAt: productMasterVersions.updatedAt,
        })
        .from(productMasterVersions)
        .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
        .where(whereClause)
        .orderBy(orderFn(sortColumn))
        .limit(limit)
        .offset(offset);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(productMasterVersions)
        .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
        .where(whereClause);

      return { data: rows, total: Number(total), page, limit };
    }, tx);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest --testPathPattern='product-versions.service.spec' -t 'getMyDraftVersions'`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npx nest build core`
Expected: 빌드 성공.

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/dto/my-drafts.dto.ts \
        apps/core/src/modules/catalog/core/products/services/product-versions.service.ts \
        apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts
git commit -m "$(cat <<'EOF'
[core] 내 draft 목록 조회 서비스 getMyDraftVersions 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: [core] GET /versions/my-drafts controller

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/controllers/product-versions.controller.ts`
- Test: `apps/core/src/modules/catalog/core/products/controllers/product-versions.controller.spec.ts` (신규)

**Interfaces:**
- Consumes: `ProductVersionsService.getMyDraftVersions` (Task 2), `MyDraftListItemDto`/`ListMyDraftsQueryDto` (Task 2), `DateMapper.toNotNullString`, `PaginatedResponseDto`, `ApiOkResponsePaginated`, `@User()`.
- Produces: `GET /versions/my-drafts` → `PaginatedResponseDto<MyDraftListItemDto>`.

- [ ] **Step 1: Write the failing controller test**

Create `product-versions.controller.spec.ts`:
```ts
import { ProductVersionsController } from './product-versions.controller';

describe('ProductVersionsController.getMyDrafts', () => {
  it('delegates with the authenticated user id and maps dates to ISO strings', async () => {
    const service = {
      getMyDraftVersions: jest.fn().mockResolvedValue({
        data: [
          {
            masterId: 'm1', versionId: 'v1', name: 'A', thumbnail: 't', brand: 'B',
            productType: 'regular_sale',
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            updatedAt: new Date('2026-07-06T00:00:00.000Z'),
          },
        ],
        total: 1, page: 1, limit: 20,
      }),
    };
    const controller = new ProductVersionsController(service as any);

    const res = await controller.getMyDrafts({ userId: 'user-1' }, { page: 1, limit: 20 } as any);

    expect(service.getMyDraftVersions).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(res.total).toBe(1);
    expect(res.data[0]).toEqual({
      masterId: 'm1', versionId: 'v1', name: 'A', thumbnail: 't', brand: 'B',
      productType: 'regular_sale', status: 'draft',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern='product-versions.controller.spec'`
Expected: FAIL — `getMyDrafts` 미정의.

- [ ] **Step 3: Update imports**

`product-versions.controller.ts` 상단 import 를 다음으로 교체/보강:
```ts
import { Controller, Get, Logger, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { ProductVersionsService } from '../services/product-versions.service';
import { ApiOkResponsePaginated } from '../../../common/decorators';
import { ProductVersionDto } from '../dto/entities/master-version.entity';
import { PaginationQueryDto, PaginatedResponseDto } from '../../../common/dto';
import { DateMapper } from '../../../common/mappers';
import { ListMyDraftsQueryDto, MyDraftListItemDto } from '../dto/my-drafts.dto';
```
(기존에 쓰던 `Param` 은 미사용이면 제거해도 되고 두어도 무방. lint 가 unused 를 지적하면 제거.)

- [ ] **Step 4: Add the route**

`ProductVersionsController` 클래스 안, `getDraftVersions` 아래에 추가:
```ts
  @Get('my-drafts')
  @ApiOperation({
    summary: '내 작성중(임시저장) 상품 목록',
    description: '현재 로그인 사용자가 소유한 draft 버전 목록을 조회합니다.',
  })
  @ApiOkResponsePaginated(MyDraftListItemDto, {
    description: '내 draft 목록 조회 성공',
  })
  async getMyDrafts(
    @User() user: { userId: string },
    @Query() query: ListMyDraftsQueryDto,
  ): Promise<PaginatedResponseDto<MyDraftListItemDto>> {
    const result = await this.productVersionsService.getMyDraftVersions(user.userId, {
      page: query.page,
      limit: query.limit,
      q: query.q?.trim() || undefined,
      sort: query.sort,
      order: query.order,
    });

    return {
      data: result.data.map((row) => ({
        masterId: row.masterId,
        versionId: row.versionId,
        name: row.name,
        thumbnail: row.thumbnail,
        brand: row.brand,
        productType: row.productType,
        status: 'draft' as const,
        createdAt: DateMapper.toNotNullString(row.createdAt),
        updatedAt: DateMapper.toNotNullString(row.updatedAt),
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest --testPathPattern='product-versions.controller.spec'`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx nest build core`
Expected: 빌드 성공.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/controllers/product-versions.controller.ts \
        apps/core/src/modules/catalog/core/products/controllers/product-versions.controller.spec.ts
git commit -m "$(cat <<'EOF'
[core] GET /versions/my-drafts 라우트 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: [core] draft_owner_id index + migration

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts:207-233` (productMasterVersions 인덱스 배열)
- Create (generated): `apps/core/drizzle/<timestamp>_add-draft-owner-id-index.sql` + `apps/core/drizzle/meta/*`

**Interfaces:**
- Produces: `idx_versions_draft_owner` on `product_master_versions(draft_owner_id)` — Task 2 의 owner 필터 조회 성능.

- [ ] **Step 1: Add the index to schema**

`catalog.schema.ts` 의 `productMasterVersions` 인덱스 배열(현재 `index('idx_versions_sales_dates')...` 등이 있는 곳)에 한 줄 추가:
```ts
    index('idx_versions_draft_owner').on(table.draftOwnerId),
```
(`idx_versions_supplier` 줄 근처, 다른 `index(...)` 들과 나란히 배치.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate:core -- --name add-draft-owner-id-index`
Expected: `apps/core/drizzle/` 아래 새 `<timestamp>_add-draft-owner-id-index.sql` 파일 + `drizzle/meta/` 갱신. rename 프롬프트 없음(순수 additive).

- [ ] **Step 3: Review the generated SQL**

Read the new `.sql`. 다음 한 줄만 있어야 한다(대략):
```sql
CREATE INDEX "idx_versions_draft_owner" ON "product_master_versions" USING btree ("draft_owner_id");
```
다른 테이블/컬럼에 예상치 못한 변경이 섞여 있으면 `git rm` 후 스키마를 바로잡아 재생성.

- [ ] **Step 4: Commit (schema + migration + meta together)**

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle/
git commit -m "$(cat <<'EOF'
[core] product_master_versions.draft_owner_id 인덱스 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: [admin-web] Types + API client + query hook

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/products.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/versions.client.ts`
- Modify: `apps/admin-web/src/lib/services/products/query-keys.ts`
- Modify: `apps/admin-web/src/lib/services/products/queries.ts`
- Test: `apps/admin-web/src/lib/api/domains/products/versions.client.spec.ts`

**Interfaces:**
- Produces (types): `MyDraftListItem`, `MyDraftsQuery`, `MyDraftsResponse`.
- Produces (client): `versionsClient.listMyDrafts(query?: MyDraftsQuery): Promise<MyDraftsResponse>` → `GET /versions/my-drafts`.
- Produces (hook): `useMyDrafts(query?: MyDraftsQuery)` → TanStack Query result whose `data` is `MyDraftsResponse`.
- Consumes: `client` (axios), `productQueryKeys.myDrafts`, `products.versions`.

- [ ] **Step 1: Add types**

`apps/admin-web/src/lib/types/dto/products.ts` 하단(또는 버전 관련 타입 근처)에 추가:
```ts
export interface MyDraftListItem {
  masterId: string;
  versionId: string;
  name: string;
  thumbnail: string | null;
  brand: string | null;
  productType: string;
  status: 'draft';
  createdAt: string;
  updatedAt: string;
}

export interface MyDraftsQuery {
  page?: number;
  limit?: number;
  q?: string;
  sort?: 'updatedAt' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface MyDraftsResponse {
  data: MyDraftListItem[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2: Write the failing client test**

`versions.client.spec.ts` 상단의 `jest.mock('../../client', ...)` 에 `get: jest.fn()` 을 추가한다:
```ts
jest.mock('../../client', () => ({
  client: {
    get: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));
```
그리고 새 describe 추가:
```ts
describe('versionsClient.listMyDrafts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(client.get).mockResolvedValue({
      data: { data: [], total: 0, page: 1, limit: 20 },
    });
  });

  it('lists my drafts through the versions/my-drafts endpoint with query params', async () => {
    await versionsClient.listMyDrafts({ page: 2, q: '가방', sort: 'updatedAt', order: 'desc' });

    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('/versions/my-drafts'),
      { params: { page: 2, limit: undefined, q: '가방', sort: 'updatedAt', order: 'desc' } },
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest --testPathPattern='versions.client.spec' -t 'listMyDrafts'`
Expected: FAIL — `listMyDrafts` 미정의.

- [ ] **Step 4: Implement the client method**

`versions.client.ts`:
- import 에 타입 추가:
```ts
import type {
  MasterVersionDto,
  CreateDraftVersionDto,
  MyDraftsQuery,
  MyDraftsResponse,
} from '../../../types/dto/products';
```
- `versionsClient` 객체에 메서드 추가(예: `listByMaster` 위/아래 아무 곳):
```ts
  listMyDrafts: async (query: MyDraftsQuery = {}): Promise<MyDraftsResponse> =>
    (
      await client.get(`${ALMONDYOUNG_API_BASE_URL}/versions/my-drafts`, {
        params: {
          page: query.page,
          limit: query.limit,
          q: query.q,
          sort: query.sort,
          order: query.order,
        },
      })
    ).data,
```
(axios 는 `undefined` 파라미터를 URL 에서 자동 생략한다.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest --testPathPattern='versions.client.spec'`
Expected: PASS (기존 테스트 포함).

- [ ] **Step 6: Add the query key**

`query-keys.ts` 의 `productQueryKeys` 객체에 추가(마스터 키들 근처):
```ts
  myDrafts: (query: Record<string, any>) =>
    ['product-versions', 'my-drafts', query] as const,
```

- [ ] **Step 7: Add the query hook**

`queries.ts`:
- 타입 import 목록에 `MyDraftsQuery` 추가.
- `useMastersSummary` 아래에 추가:
```ts
/**
 * 내 작성중(임시저장) 상품 목록 조회
 */
export const useMyDrafts = (query: MyDraftsQuery = {}) => {
  return useQuery({
    queryKey: productQueryKeys.myDrafts(query),
    queryFn: () => products.versions.listMyDrafts(query),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};
```

- [ ] **Step 8: Typecheck**

Run: `npm run build:admin-web`
Expected: 타입 오류 없음. (시간이 오래 걸리면 `npx tsc -p apps/admin-web/tsconfig.json --noEmit` 로 대체 가능.)

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/src/lib/types/dto/products.ts \
        apps/admin-web/src/lib/api/domains/products/versions.client.ts \
        apps/admin-web/src/lib/api/domains/products/versions.client.spec.ts \
        apps/admin-web/src/lib/services/products/query-keys.ts \
        apps/admin-web/src/lib/services/products/queries.ts
git commit -m "$(cat <<'EOF'
[admin-web] my-drafts 타입/클라이언트/쿼리 훅 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: [admin-web] Edit-path helper + table query/columns hooks

**Files:**
- Create: `apps/admin-web/src/features/mall/my-drafts/lib/draft-edit-path.ts`
- Create: `apps/admin-web/src/features/mall/my-drafts/lib/draft-edit-path.spec.ts`
- Create: `apps/admin-web/src/hooks/table/query/use-my-drafts-table-query.ts`
- Create: `apps/admin-web/src/hooks/table/columns/use-my-drafts-table-columns.tsx`

**Interfaces:**
- Produces: `buildDraftEditPath(masterId, versionId): string` → `/mall/products-list/{masterId}?versionId={versionId}`.
- Produces: `useMyDraftsTableQuery({ pageSize? }): { searchParams: MyDraftsQuery; raw }`.
- Produces: `useMyDraftsTableColumns(): ColumnDef<MyDraftListItem>[]`.
- Consumes: `MyDraftListItem`/`MyDraftsQuery` (Task 5), `useQueryParams`, `DateCell`, `Badge`, `Button`, `resolvePublicFileUrl`.

- [ ] **Step 1: Write the failing helper test**

`draft-edit-path.spec.ts`:
```ts
import { buildDraftEditPath } from './draft-edit-path';

describe('buildDraftEditPath', () => {
  it('builds the version-scoped edit path', () => {
    expect(buildDraftEditPath('m1', 'v1')).toBe('/mall/products-list/m1?versionId=v1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern='draft-edit-path.spec'`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Implement the helper**

`draft-edit-path.ts`:
```ts
/** draft 버전 편집을 이어가는 상세 화면 경로. active 버전이 없는 draft 는 versionId 로 직접 조회한다. */
export function buildDraftEditPath(masterId: string, versionId: string): string {
  return `/mall/products-list/${masterId}?versionId=${versionId}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPattern='draft-edit-path.spec'`
Expected: PASS.

- [ ] **Step 5: Implement the query hook**

`use-my-drafts-table-query.ts`:
```ts
import type { MyDraftsQuery } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';

type UseMyDraftsTableQueryProps = {
  pageSize?: number;
};

export const useMyDraftsTableQuery = ({
  pageSize = 20,
}: UseMyDraftsTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'q', 'sort', 'order']);
  const { page, q, sort, order } = queryObject;

  const searchParams: MyDraftsQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q: q?.trim() || undefined,
    sort: sort === 'updatedAt' || sort === 'createdAt' ? sort : undefined,
    order: order === 'asc' || order === 'desc' ? order : undefined,
  };

  return { searchParams, raw: queryObject };
};
```

- [ ] **Step 6: Implement the columns hook**

`use-my-drafts-table-columns.tsx`:
```tsx
'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageOff } from 'lucide-react';
import type { MyDraftListItem } from '@/lib/types/dto/products';
import { DateCell } from '@/components/table/table-cells/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { buildDraftEditPath } from '@/features/mall/my-drafts/lib/draft-edit-path';

const columnHelper = createColumnHelper<MyDraftListItem>();

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  regular_sale: '일반',
  limited_edition: '한정',
};

function DraftThumbnailCell({ thumbnail }: { thumbnail: string | null | undefined }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = resolvePublicFileUrl(thumbnail);
  const loadFailed = src !== null && failedSrc === src;

  if (!src || loadFailed) {
    return (
      <div className="mx-auto flex h-14 w-14 flex-col items-center justify-center rounded bg-muted text-muted-foreground">
        <ImageOff className="h-4 w-4" aria-hidden="true" />
        <span className="mt-0.5 text-[9px]">이미지 없음</span>
      </div>
    );
  }

  return (
    <div className="mx-auto h-14 w-14 overflow-hidden rounded bg-muted">
      <img
        src={src}
        alt="상품 이미지"
        className="h-full w-full object-cover"
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}

export function useMyDraftsTableColumns() {
  const router = useRouter();

  return useMemo(
    () => [
      columnHelper.accessor('thumbnail', {
        header: '이미지',
        cell: ({ getValue }) => <DraftThumbnailCell thumbnail={getValue()} />,
      }),
      columnHelper.accessor('name', {
        header: '상품명/브랜드',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="break-words text-sm font-medium leading-tight text-blue-800">
              {row.original.name}
            </p>
            <p className="text-xs text-muted-foreground">{row.original.brand ?? '-'}</p>
          </div>
        ),
      }),
      columnHelper.accessor('productType', {
        header: '유형',
        cell: ({ getValue }) => (
          <span className="text-sm">{PRODUCT_TYPE_LABELS[getValue()] ?? getValue()}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: () => <Badge variant="secondary">임시저장</Badge>,
      }),
      columnHelper.accessor('updatedAt', {
        header: '최종수정일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '작업',
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={(e) => {
              e.stopPropagation();
              router.push(buildDraftEditPath(row.original.masterId, row.original.versionId));
            }}
          >
            이어서 편집
          </Button>
        ),
      }),
    ],
    [router]
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit`
Expected: 오류 없음.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/features/mall/my-drafts/lib/ \
        apps/admin-web/src/hooks/table/query/use-my-drafts-table-query.ts \
        apps/admin-web/src/hooks/table/columns/use-my-drafts-table-columns.tsx
git commit -m "$(cat <<'EOF'
[admin-web] my-drafts 편집 경로 헬퍼 + 테이블 쿼리/컬럼 훅

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: [admin-web] Table + template + page + menu

**Files:**
- Create: `apps/admin-web/src/features/mall/my-drafts/components/table/index.tsx`
- Create: `apps/admin-web/src/features/mall/my-drafts/template/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/mall/my-drafts/page.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts:214` (product-management children)

**Interfaces:**
- Consumes: `useMyDrafts` (Task 5), `useMyDraftsTableQuery`/`useMyDraftsTableColumns` (Task 6), `buildDraftEditPath` (Task 6), `useDataTable`, `DataTable`, `Container`, `Header`, `RouteGuard`.
- Produces: `/mall/my-drafts` 라우트 + 메뉴 항목.

- [ ] **Step 1: Implement the table component**

`features/mall/my-drafts/components/table/index.tsx`:
```tsx
'use client';

import { useMyDrafts } from '@/lib/services/products/queries';
import { useDataTable } from '@/hooks/use-data-table';
import { useMyDraftsTableColumns } from '@/hooks/table/columns/use-my-drafts-table-columns';
import { useMyDraftsTableQuery } from '@/hooks/table/query/use-my-drafts-table-query';
import { DataTable } from '@/components/data-table';
import { buildDraftEditPath } from '../../lib/draft-edit-path';

const PAGE_SIZE = 20;

export function MyDraftsTable() {
  const { searchParams: query } = useMyDraftsTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useMyDrafts(query);
  const columns = useMyDraftsTableColumns();

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.versionId,
  });

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFetching={isFetching}
      count={data?.total ?? 0}
      pageSize={PAGE_SIZE}
      search
      orderBy={[
        { key: 'updatedAt', label: '최종수정일' },
        { key: 'createdAt', label: '등록일' },
      ]}
      navigateTo={(row) => buildDraftEditPath(row.original.masterId, row.original.versionId)}
      noRecords={{ message: '작성 중인 임시저장 상품이 없습니다.' }}
    />
  );
}
```

- [ ] **Step 2: Implement the template**

`features/mall/my-drafts/template/index.tsx`:
```tsx
'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { MyDraftsTable } from '../components/table';

export default function MyDraftsTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="작성중인 상품"
        subtitle="내가 만든 임시저장 상품을 이어서 편집할 수 있습니다."
      />
      <MyDraftsTable />
    </Container>
  );
}
```

- [ ] **Step 3: Implement the page**

`app/(admin)/mall/my-drafts/page.tsx`:
```tsx
import RouteGuard from '@/components/layout/route-guard';
import MyDraftsTemplate from '@/features/mall/my-drafts/template';

export default function MyDraftsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MyDraftsTemplate />
      </div>
    </RouteGuard>
  );
}
```

- [ ] **Step 4: Add the menu entry**

`menu.ts` 의 product-management children 에서 '등록' 항목 바로 아래에 추가:
```ts
      { id: 'product-list', title: '목록', path: '/mall/products-list' },
      {
        id: 'product-registration',
        title: '등록',
        path: '/mall/product-registration',
      },
      { id: 'product-drafts', title: '작성중인 상품', path: '/mall/my-drafts' },
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit`
Expected: 오류 없음.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/features/mall/my-drafts/ \
        "apps/admin-web/src/app/(admin)/mall/my-drafts/page.tsx" \
        apps/admin-web/src/lib/utils/menu.ts
git commit -m "$(cat <<'EOF'
[admin-web] '작성중인 상품' 라우트/페이지/메뉴 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Final end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full affected test suites**

Run:
```bash
npx jest --testPathPattern='product-masters.service.spec|product-versions.service.spec|product-versions.controller.spec|versions.client.spec|draft-edit-path.spec'
```
Expected: 전부 PASS.

- [ ] **Step 2: Build both sides**

Run: `npx nest build core` and `npm run build:admin-web`
Expected: 둘 다 성공.

- [ ] **Step 3: Apply the migration locally**

Run: `npm run db:setup -- --stage dev --deployment lcnine-services`
Expected: Task 4 의 인덱스 마이그레이션이 적용됨(이미 적용됐으면 skip). 프롬프트에는 관례대로 응답.

- [ ] **Step 4: Manual smoke test (superpowers:verify / run 스킬 활용 가능)**

1. core + admin-web dev 서버 기동(`npm run start:main:dev`, `npm run start:admin-web:dev`).
2. 로그인 후 `/mall/product-registration` 으로 새 상품 draft 생성 → 목록으로 이탈.
3. 사이드 메뉴 상품관리 → **작성중인 상품** 진입(`/mall/my-drafts`).
   - 방금 만든 draft 가 최상단(최종수정 desc)에 뜬다.
   - 상태 뱃지 "임시저장", 썸네일/상품명/유형/최종수정일 표시.
4. "이어서 편집" 클릭 → `/mall/products-list/{masterId}?versionId={versionId}` 편집 화면 진입, 편집 지속 가능.
5. 검색창에 상품명 일부 입력 → 필터링. 정렬을 등록일/최종수정일로 토글 → 순서 변동.
6. 그 draft 를 publish → 목록에서 사라짐(`draftOwnerId` 가 null 로 비워짐).
7. (가능하면) 다른 계정으로 만든 draft 는 내 목록에 안 뜨는지 교차 확인.

- [ ] **Step 5: Verify no regression on the product list**

`/mall/products-list` 진입 → 기존 목록/필터/상세 이동 정상. 신규 상품 생성이 여전히 동작(생성 후 편집 화면 리다이렉트).

---

## Self-Review

**Spec coverage:**
- 소유자 기록 수정(POST /masters) → Task 1. ✅
- 신규 엔드포인트 GET /versions/my-drafts(owner 필터 + join + 정확한 count) → Task 2(service) + Task 3(controller). ✅
- draft_owner_id 인덱스 + 마이그레이션 → Task 4. ✅
- 프론트 라우트/피처(products-list 참고) → Task 6·7. ✅
- "이어서 편집" → `/mall/products-list/{masterId}?versionId={versionId}` → Task 6 helper + Task 7 navigateTo/action. ✅
- 메뉴 '작성중인 상품' → Task 7. ✅
- 필터 최소(검색+정렬) → Task 6 query hook + Task 7 DataTable(search + orderBy, filters 미지정). ✅
- 범위 밖(orphan 백필 없음, 상세 필터 없음) → 계획에 신규 작업 없음(의도된 제외). ✅
- 테스트: createMaster 소유자 기록(T1), getMyDraftVersions total(T2), 컨트롤러 위임+날짜 매핑(T3), 클라이언트 파라미터(T5), 편집경로 헬퍼(T6), 수동 스모크(T8). ✅

**Type consistency:** 서비스 반환 `MyDraftRow`(Date) → 컨트롤러가 `MyDraftListItemDto`(string, DateMapper)로 매핑. 프론트 `MyDraftListItem`(string) 은 컨트롤러 응답과 필드 일치. `getRowId: row => row.versionId`(버전 단위 행)로 통일. `buildDraftEditPath` 시그니처는 helper·columns·table 에서 동일하게 사용.
