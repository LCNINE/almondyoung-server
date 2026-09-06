# 매칭 「자동 SKU 구성 매칭」 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 어드민 매칭 다이얼로그의 「자동 SKU 구성 매칭」 탭이 존재하지 않는 `POST /inventory-matching` 대신 기존 `resolve`/`upsert` 를 부르게 하고, SKU 생성·링크·상태전이를 한 트랜잭션에 넣는다.

**Architecture:** `resolve` 와 `upsert` 의 링크 항목을 공유 타입 `MatchingLinkInputDto`(= `skuId` **또는** `newSku: CreateSkuDto`)로 넓힌다. 두 서비스는 각자의 `dbService.run` 안에서 `MatchingLinkResolver` 를 불러 `newSku` 를 실제 SKU 로 만든 뒤 매핑을 얻는다. `newSku` 가 payload 에 있을 때만 `inventory.manage` 를 요구하는 가드를 두 라우트에 붙인다.

**Tech Stack:** NestJS 11 · Drizzle ORM · class-validator/class-transformer · Jest(ts-jest, transpile-only) · Next.js(admin-web) · TanStack Query · sonner

**Spec:** `docs/superpowers/specs/2026-09-06-matching-auto-sku-composition-design.md`

## Global Constraints

- **DB 마이그레이션 0건.** `apps/core/src/modules/inventory/schema/inventory.schema.ts` 를 수정하지 않는다. `drizzle/` 아래 파일을 만들지 않는다.
- **트랜잭션 규칙(ADR-0025):** 공개 메서드는 `tx?: DbTx` 를 마지막 인자로 받고 `this.dbService.run(fn, tx)` 로 실행한다. per-class `inTx` 헬퍼를 만들지 않는다. `asTx(tx as unknown)` 류 캐스팅 금지.
- **inventory 쿼리 규칙:** 새로 쓰는 쿼리는 `trx.select().from().where()` 형태. `db.query.*`, `with` 관계, `any`/`as` 캐스팅 금지.
- **에러:** 컨트롤러 경계 입력 검증만 Nest 예외. 서비스는 `@app/shared` 의 도메인 예외 또는 기존 파일이 이미 쓰는 Nest 예외를 따른다(`product-matching` 계열은 기존대로 `BadRequestException`/`NotFoundException` 을 쓴다 — 파일 안 일관성 유지).
- **검증 게이트는 0 이 정상:** `npm run type-check` 0, `npx jest --maxWorkers=2` 실패 0, `cd apps/admin-web && npx tsc --noEmit` 0.
- **admin-web 은 `.tsx` 테스트가 불가하다** (`package.json:154` 의 `test:admin-web` 이 `^.+\.(t|j)s$` 만 transform). 판정 로직은 `.ts` 로 뺀다.
- **브랜치:** `fix/matching-auto-sku-composition` (base `f5afc8166`). 스펙 커밋 `4e966243f` 이 이미 올라가 있다.
- **SKU 코드 생성은 순차여야 한다.** `SkuCatalogManager.generateSkuCode`(`sku-catalog.manager.ts:268`)가 `select max(code)` 로 다음 코드를 만들므로, 한 트랜잭션 안에서 여러 SKU 를 만들 때 **`Promise.all` 금지, `for` 루프로 순차 생성**한다. 병렬로 만들면 같은 코드가 나오고 `skus.code` unique 제약에 걸린다.

---

## File Structure

**core — 신규**

| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/product-matching/dto/matching-link-input.dto.ts` | 링크 항목 계약 + `skuId`/`newSku` 배타 검증 |
| `apps/core/src/modules/product-matching/dto/matching-link-input.dto.spec.ts` | 위 배타 규칙 |
| `apps/core/src/modules/product-matching/services/matching-link-resolver.ts` | `MatchingLinkInputDto[]` → `SkuQuantityMapping[]` (필요하면 SKU 생성) |
| `apps/core/src/modules/product-matching/services/matching-link-resolver.spec.ts` | 순서 보존 · `source` 강제 · 수량 정규화 |
| `apps/core/src/modules/product-matching/guards/new-sku-scope.guard.ts` | `newSku` 가 있을 때만 `inventory.manage` 요구 |
| `apps/core/src/modules/product-matching/guards/new-sku-scope.guard.spec.ts` | 통과/거부 경로 |

**core — 수정**

| 파일 | 무엇을 |
|---|---|
| `dto/resolve-matching.dto.ts` | `links?: MatchingLinkInputDto[]` 추가, 옛 둘에 `deprecated` |
| `dto/upsert-matching.dto.ts` | `MatchingLinkDto` → `MatchingLinkInputDto` 재사용 |
| `strategies/matching-strategy.interface.ts` | `validate(..., tx?)` |
| `strategies/variant-matching.strategy.ts` | `validate` 가 tx 로 읽는다 · `select()` 로 전환 |
| `services/product-matching.service.ts` | `resolveMatchingPending` 이 `links` 를 받는다 · `createNewSkuForMatching` 삭제 |
| `services/product-sku-mapping.service.ts` | `upsert` 가 `links[].newSku` 를 받는다 |
| `controllers/product-matching.controller.ts` | `@UseGuards(NewSkuScopeGuard)` on `PATCH :id/resolve` |
| `controllers/product-sku-mapping.controller.ts` | `@UseGuards(NewSkuScopeGuard)` on `PUT :variantId` |
| `product-matching.module.ts` | `MatchingLinkResolver` 등록 |
| 기존 spec 2개 | 생성자 인자 추가 · `select` 큐 보정 |

**core — 삭제**: `apps/core/src/modules/inventory/core/dto/product-matching/` (5 파일)

**admin-web — 신규**

| 파일 | 책임 |
|---|---|
| `src/features/order/matching/lib/build-matching-links.ts` | auto 탭 상태 → `links[]` 판정 (순수) |
| `src/features/order/matching/lib/build-matching-links.spec.ts` | 위 판정 |

**admin-web — 수정**: `lib/types/dto/matching.ts` · `lib/types/dto/inventory.ts` · `lib/api/domains/inventory/index.ts` · `lib/services/inventory/{queries,mutations,query-keys}.ts` · `features/order/matching/components/table/InventoryMatchingDialog.tsx`

---

## Task 1: 링크 항목 계약 (`MatchingLinkInputDto`)

**Files:**
- Create: `apps/core/src/modules/product-matching/dto/matching-link-input.dto.ts`
- Test: `apps/core/src/modules/product-matching/dto/matching-link-input.dto.spec.ts`

**Interfaces:**
- Consumes: `CreateSkuDto` from `apps/core/src/modules/inventory/sku-catalog/dto/create-sku.dto.ts`
- Produces: `class MatchingLinkInputDto { skuId?: string; newSku?: CreateSkuDto; quantity?: number }` — Task 2·4·5·6 이 쓴다.

**왜 커스텀 constraint 인가:** `@IsOptional()` 은 값이 `undefined` 면 그 프로퍼티의 **모든** 검증기를 건너뛴다. 그래서 「둘 다 없음」을 `skuId` 위의 데코레이터로는 잡을 수 없다. 배타성·UUID 형식을 **한 검증기 안에서** 판정하고, `@IsOptional`/`@ValidateIf` 를 `skuId` 에 붙이지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/product-matching/dto/matching-link-input.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MatchingLinkInputDto } from './matching-link-input.dto';

const SKU_ID = '44444444-4444-4444-4444-444444444444';

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(MatchingLinkInputDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('MatchingLinkInputDto', () => {
  it('accepts a reference to an existing SKU', async () => {
    expect(await errorsFor({ skuId: SKU_ID, quantity: 2 })).toEqual([]);
  });

  it('accepts a new SKU definition', async () => {
    expect(await errorsFor({ newSku: { name: 'S / 검정' } })).toEqual([]);
  });

  it('rejects a link that carries both skuId and newSku', async () => {
    expect(await errorsFor({ skuId: SKU_ID, newSku: { name: 'S / 검정' } })).toContain('skuId');
  });

  it('rejects a link that carries neither', async () => {
    expect(await errorsFor({ quantity: 3 })).toContain('skuId');
  });

  it('rejects a malformed skuId', async () => {
    expect(await errorsFor({ skuId: 'not-a-uuid' })).toContain('skuId');
  });

  it('rejects a newSku without a name', async () => {
    expect(await errorsFor({ newSku: { optionKey: 'S' } })).toContain('newSku');
  });

  it('rejects quantity below 1', async () => {
    expect(await errorsFor({ skuId: SKU_ID, quantity: 0 })).toContain('quantity');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/dto/matching-link-input.dto.spec.ts`
Expected: FAIL — `Cannot find module './matching-link-input.dto'`

- [ ] **Step 3: DTO 를 구현한다**

`apps/core/src/modules/product-matching/dto/matching-link-input.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Min,
  ValidateIf,
  ValidateNested,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  isUUID,
} from 'class-validator';
import { CreateSkuDto } from '../../inventory/sku-catalog/dto/create-sku.dto';

/**
 * skuId 와 newSku 는 정확히 하나여야 한다.
 *
 * `@IsOptional()` 은 값이 undefined 면 그 프로퍼티의 검증기를 전부 건너뛰므로
 * 「둘 다 없음」을 데코레이터 조합으로는 잡을 수 없다. 배타성과 UUID 형식을
 * 한 검증기 안에서 함께 판정한다.
 */
@ValidatorConstraint({ name: 'matchingSkuRef', async: false })
export class MatchingSkuRefConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const link = args.object as MatchingLinkInputDto;
    const hasSkuId = link.skuId !== undefined && link.skuId !== null;
    const hasNewSku = link.newSku !== undefined && link.newSku !== null;

    if (hasSkuId === hasNewSku) return false;
    if (hasSkuId && !isUUID(link.skuId)) return false;
    return true;
  }

  defaultMessage(): string {
    return 'link 항목은 skuId(UUID) 또는 newSku 중 정확히 하나를 가져야 합니다.';
  }
}

export class MatchingLinkInputDto {
  @ApiProperty({ description: '기존 재고상품 ID. newSku 와 배타.', required: false })
  @Validate(MatchingSkuRefConstraint)
  skuId?: string;

  @ApiProperty({
    description: '새로 만들 재고상품 정의. skuId 와 배타. inventory.manage 권한이 필요하다.',
    type: CreateSkuDto,
    required: false,
  })
  @ValidateIf((link: MatchingLinkInputDto) => link.newSku !== undefined && link.newSku !== null)
  @ValidateNested()
  @Type(() => CreateSkuDto)
  newSku?: CreateSkuDto;

  @ApiProperty({ description: '구성 수량', minimum: 1, default: 1, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/dto/matching-link-input.dto.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/product-matching/dto/matching-link-input.dto.ts \
        apps/core/src/modules/product-matching/dto/matching-link-input.dto.spec.ts
git commit -m "feat(matching): 링크 항목 계약 — skuId 또는 newSku 배타 (#791)"
```

---

## Task 2: `MatchingLinkResolver`

**Files:**
- Create: `apps/core/src/modules/product-matching/services/matching-link-resolver.ts`
- Test: `apps/core/src/modules/product-matching/services/matching-link-resolver.spec.ts`
- Modify: `apps/core/src/modules/product-matching/product-matching.module.ts`

**Interfaces:**
- Consumes: `MatchingLinkInputDto` (Task 1) · `SkuCatalogService.create(dto: CreateSkuDto, tx?: DbTx): Promise<SkuResponseDto>` · `SkuQuantityMapping { skuId: string; quantity: number }` from `../strategies/matching-strategy.interface`
- Produces: `class MatchingLinkResolver { resolve(links: MatchingLinkInputDto[], trx: DbTx): Promise<SkuQuantityMapping[]> }` — Task 4·5 가 주입해 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/product-matching/services/matching-link-resolver.spec.ts`:

```ts
import { MatchingLinkResolver } from './matching-link-resolver';
import { SkuCreationSource } from '../../inventory/sku-catalog/dto/create-sku.dto';

const EXISTING = '44444444-4444-4444-4444-444444444444';

function makeResolver() {
  let seq = 0;
  const order: string[] = [];
  const skuCatalogService = {
    create: jest.fn(async (dto: { name: string }) => {
      order.push(dto.name);
      seq += 1;
      return { id: `created-${seq}` };
    }),
  };
  return { resolver: new MatchingLinkResolver(skuCatalogService as never), skuCatalogService, order };
}

describe('MatchingLinkResolver', () => {
  const trx = { marker: 'tx' } as never;

  it('passes an existing SKU reference through with its quantity', async () => {
    const { resolver, skuCatalogService } = makeResolver();

    const result = await resolver.resolve([{ skuId: EXISTING, quantity: 2 }], trx);

    expect(result).toEqual([{ skuId: EXISTING, quantity: 2 }]);
    expect(skuCatalogService.create).not.toHaveBeenCalled();
  });

  it('creates a SKU on the caller transaction and returns its id', async () => {
    const { resolver, skuCatalogService } = makeResolver();

    const result = await resolver.resolve([{ newSku: { name: 'S / 검정' } as never, quantity: 3 }], trx);

    expect(result).toEqual([{ skuId: 'created-1', quantity: 3 }]);
    expect(skuCatalogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'S / 검정', source: SkuCreationSource.AUTO_MATCHING }),
      trx,
    );
  });

  it('forces source=auto_matching even when the caller supplies another', async () => {
    const { resolver, skuCatalogService } = makeResolver();

    await resolver.resolve([{ newSku: { name: 'X', source: SkuCreationSource.MANUAL_ENTRY } as never }], trx);

    expect(skuCatalogService.create.mock.calls[0][0].source).toBe(SkuCreationSource.AUTO_MATCHING);
  });

  it('preserves input order and creates sequentially', async () => {
    const { resolver, order } = makeResolver();

    const result = await resolver.resolve(
      [
        { newSku: { name: 'a' } as never },
        { skuId: EXISTING, quantity: 5 },
        { newSku: { name: 'b' } as never },
      ],
      trx,
    );

    expect(result).toEqual([
      { skuId: 'created-1', quantity: 1 },
      { skuId: EXISTING, quantity: 5 },
      { skuId: 'created-2', quantity: 1 },
    ]);
    expect(order).toEqual(['a', 'b']);
  });

  it('defaults and normalizes quantity', async () => {
    const { resolver } = makeResolver();

    const result = await resolver.resolve(
      [{ skuId: EXISTING }, { skuId: EXISTING, quantity: 2.7 }, { skuId: EXISTING, quantity: 0 }],
      trx,
    );

    expect(result.map((m) => m.quantity)).toEqual([1, 2, 1]);
  });

  it('returns an empty list for no links', async () => {
    const { resolver } = makeResolver();
    expect(await resolver.resolve([], trx)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/services/matching-link-resolver.spec.ts`
Expected: FAIL — `Cannot find module './matching-link-resolver'`

- [ ] **Step 3: 리졸버를 구현한다**

`apps/core/src/modules/product-matching/services/matching-link-resolver.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { SkuCatalogService } from '../../inventory/sku-catalog/services/sku-catalog.service';
import { SkuCreationSource } from '../../inventory/sku-catalog/dto/create-sku.dto';
import { MatchingLinkInputDto } from '../dto/matching-link-input.dto';
import { SkuQuantityMapping } from '../strategies/matching-strategy.interface';

/**
 * 매칭 링크 입력을 SKU 매핑으로 바꾼다. `newSku` 가 오면 호출자의 트랜잭션 위에서
 * 실제 SKU 를 만든다 — 그래서 생성·링크·상태전이가 한 트랜잭션에 들어가고
 * 중간 실패 시 고아 SKU 가 남지 않는다.
 */
@Injectable()
export class MatchingLinkResolver {
  constructor(private readonly skuCatalogService: SkuCatalogService) {}

  async resolve(links: MatchingLinkInputDto[], trx: DbTx): Promise<SkuQuantityMapping[]> {
    const mappings: SkuQuantityMapping[] = [];

    // 순차 생성이어야 한다. SkuCatalogManager.generateSkuCode 가 max(code) 를 읽어
    // 다음 코드를 만들므로 병렬로 만들면 같은 코드가 나와 unique 제약에 걸린다.
    for (const link of links) {
      const quantity = this.normalizeQuantity(link.quantity);

      if (link.skuId) {
        mappings.push({ skuId: link.skuId, quantity });
        continue;
      }

      if (!link.newSku) {
        throw new BadRequestException('link 항목은 skuId 또는 newSku 중 정확히 하나를 가져야 합니다.');
      }

      const created = await this.skuCatalogService.create(
        { ...link.newSku, source: SkuCreationSource.AUTO_MATCHING },
        trx,
      );
      mappings.push({ skuId: created.id, quantity });
    }

    return mappings;
  }

  private normalizeQuantity(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) return 1;
    const truncated = Math.trunc(value);
    return truncated < 1 ? 1 : truncated;
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/services/matching-link-resolver.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 모듈에 등록한다**

`apps/core/src/modules/product-matching/product-matching.module.ts` — import 를 추가하고 `providers` 에 넣는다. `SkuCatalogModule` 은 이미 `imports` 에 있으므로 배선 추가는 없다.

```ts
import { MatchingLinkResolver } from './services/matching-link-resolver';
```

```ts
  providers: [ProductMatchingService, ProductSkuMappingService, MatchingLinkResolver],
```

- [ ] **Step 6: 타입체크**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/product-matching/services/matching-link-resolver.ts \
        apps/core/src/modules/product-matching/services/matching-link-resolver.spec.ts \
        apps/core/src/modules/product-matching/product-matching.module.ts
git commit -m "feat(matching): MatchingLinkResolver — newSku 를 호출자 트랜잭션에서 만든다 (#791)"
```

---

## Task 3: `validate()` 가 트랜잭션을 본다

**Files:**
- Modify: `apps/core/src/modules/product-matching/strategies/matching-strategy.interface.ts:32`
- Modify: `apps/core/src/modules/product-matching/strategies/variant-matching.strategy.ts:50-66`
- Test: `apps/core/src/modules/product-matching/strategies/variant-matching.strategy.spec.ts` (신규)

**Interfaces:**
- Produces: `MatchingStrategy.validate(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<boolean>` — Task 4 가 `tx` 를 넘긴다.

**왜:** `VariantMatchingStrategy.validate` 는 `this.db` 로 SKU 존재를 확인한다(`:56`). `resolveMatchingPending` 의 트랜잭션 **안에서** 불리지만 읽기는 트랜잭션 밖으로 나가므로, 같은 tx 에서 방금 만든 SKU 가 보이지 않는다 → 무조건 400. `VoidMatchingStrategy` 는 `mappings.length` 만 보므로 **수정하지 않는다** (TS 는 추상 시그니처보다 파라미터가 적은 구현을 허용한다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/product-matching/strategies/variant-matching.strategy.spec.ts`:

```ts
import { VariantMatchingStrategy } from './variant-matching.strategy';
import { MatchingContext } from './matching-strategy.interface';

const CONTEXT: MatchingContext = {
  variantId: '22222222-2222-2222-2222-222222222222',
  productMatchingId: '11111111-1111-1111-1111-111111111111',
};
const SKU_A = '44444444-4444-4444-4444-444444444444';
const SKU_B = '55555555-5555-5555-5555-555555555555';

function makeReader(rows: Array<{ id: string }>) {
  const builder: Record<string, unknown> = {};
  builder.from = jest.fn(() => builder);
  builder.where = jest.fn(() => builder);
  builder.then = jest.fn((resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve));
  return { select: jest.fn(() => builder) };
}

describe('VariantMatchingStrategy.validate', () => {
  it('reads through the supplied transaction, not the ambient db', async () => {
    const ambient = makeReader([]); // tx 밖에서는 아직 안 보이는 상태
    const trx = makeReader([{ id: SKU_A }]);
    const strategy = new VariantMatchingStrategy({ db: ambient } as never);

    const result = await strategy.validate(CONTEXT, [{ skuId: SKU_A, quantity: 1 }], trx as never);

    expect(result).toBe(true);
    expect(trx.select).toHaveBeenCalled();
    expect(ambient.select).not.toHaveBeenCalled();
  });

  it('falls back to the ambient db when no transaction is given', async () => {
    const ambient = makeReader([{ id: SKU_A }]);
    const strategy = new VariantMatchingStrategy({ db: ambient } as never);

    expect(await strategy.validate(CONTEXT, [{ skuId: SKU_A, quantity: 1 }])).toBe(true);
    expect(ambient.select).toHaveBeenCalled();
  });

  it('rejects when one of the mapped SKUs does not exist', async () => {
    const trx = makeReader([{ id: SKU_A }]);
    const strategy = new VariantMatchingStrategy({ db: makeReader([]) } as never);

    const result = await strategy.validate(
      CONTEXT,
      [
        { skuId: SKU_A, quantity: 1 },
        { skuId: SKU_B, quantity: 1 },
      ],
      trx as never,
    );

    expect(result).toBe(false);
  });

  it('rejects an empty mapping list without querying', async () => {
    const trx = makeReader([]);
    const strategy = new VariantMatchingStrategy({ db: makeReader([]) } as never);

    expect(await strategy.validate(CONTEXT, [], trx as never)).toBe(false);
    expect(trx.select).not.toHaveBeenCalled();
  });

  it('queries once for duplicated SKU ids', async () => {
    const trx = makeReader([{ id: SKU_A }]);
    const strategy = new VariantMatchingStrategy({ db: makeReader([]) } as never);

    const result = await strategy.validate(
      CONTEXT,
      [
        { skuId: SKU_A, quantity: 1 },
        { skuId: SKU_A, quantity: 2 },
      ],
      trx as never,
    );

    expect(result).toBe(true);
    expect(trx.select).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/strategies/variant-matching.strategy.spec.ts`
Expected: FAIL — 첫 테스트가 `trx.select` 미호출로 실패한다 (현재 구현은 `this.db.query.skus.findFirst` 를 쓴다)

- [ ] **Step 3: 추상 시그니처를 넓힌다**

`matching-strategy.interface.ts` — `validate` 줄을 바꾼다:

```ts
  abstract validate(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<boolean>;
```

- [ ] **Step 4: `VariantMatchingStrategy.validate` 를 고친다**

`variant-matching.strategy.ts` — import 에 `inArray` 를 더하고(`import { eq, inArray } from 'drizzle-orm';`) `validate` 전체를 교체한다:

```ts
  async validate(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<boolean> {
    if (mappings.length === 0) {
      return false;
    }

    // tx 를 받으면 반드시 그것으로 읽는다 — 같은 트랜잭션에서 방금 만든 SKU 는
    // 커밋 전이라 트랜잭션 밖에서는 보이지 않는다 (#791).
    const db = tx ?? this.db;
    const skuIds = [...new Set(mappings.map((mapping) => mapping.skuId))];

    const rows = await db.select({ id: wmsTables.skus.id }).from(wmsTables.skus).where(inArray(wmsTables.skus.id, skuIds));

    return rows.length === skuIds.length;
  }
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/strategies/variant-matching.strategy.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: 타입체크**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/product-matching/strategies/
git commit -m "fix(matching): validate 가 호출자 트랜잭션으로 SKU 존재를 확인하게 (#791)"
```

---

## Task 4: `resolve` 가 `links` 를 받는다

**Files:**
- Modify: `apps/core/src/modules/product-matching/dto/resolve-matching.dto.ts`
- Modify: `apps/core/src/modules/product-matching/services/product-matching.service.ts:63-71` (생성자), `:856-949` (`resolveMatchingPending`)
- Test: `apps/core/src/modules/product-matching/services/product-matching.service.spec.ts` (기존 확장)

**Interfaces:**
- Consumes: `MatchingLinkInputDto` (Task 1) · `MatchingLinkResolver.resolve` (Task 2) · `MatchingStrategy.validate(..., tx?)` (Task 3)
- Produces: `ResolveMatchingDto.links?: MatchingLinkInputDto[]` — Task 6·8 이 참조한다. `ProductMatchingService` 생성자의 **8번째** 인자가 `MatchingLinkResolver` 다.

**우선순위 규칙:** `links` 가 오면 그것만 본다. 없으면 `skuMappings` → `skuIds` 순으로 폴백(현행 동작 유지).

- [ ] **Step 1: DTO 에 `links` 를 더한다**

`resolve-matching.dto.ts` 상단 import 에:

```ts
import { MatchingLinkInputDto } from './matching-link-input.dto';
```

`ResolveMatchingDto` 안에서 `skuIds` 의 `@ApiProperty` 를 `deprecated: true` 로 바꾸고, `skuMappings` 도 마찬가지로 한 뒤, 그 아래에 새 필드를 넣는다:

```ts
  @ApiProperty({
    description:
      '매칭 링크 목록. 각 항목은 기존 재고상품(skuId) 또는 새로 만들 재고상품(newSku) 중 하나다. ' +
      'newSku 를 쓰려면 inventory.manage 권한이 필요하다. skuIds/skuMappings 보다 우선한다.',
    type: [MatchingLinkInputDto],
    required: false,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchingLinkInputDto)
  @IsOptional()
  links?: MatchingLinkInputDto[];
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`product-matching.service.spec.ts` 의 `makeService` 를 고친다 — `linkResolver` 목을 만들고 8번째 인자로 넘기고 반환에 포함한다:

```ts
    const linkResolver = {
      resolve: jest.fn(async (links: Array<{ skuId?: string; newSku?: unknown; quantity?: number }>) =>
        links.map((link, index) => ({
          skuId: link.skuId ?? `created-${index + 1}`,
          quantity: link.quantity ?? 1,
        })),
      ),
    };

    const service = new ProductMatchingService(
      dbService as never,
      {} as never,
      stockEventService as never,
      warehouseService as never,
      productSellableQuantity as never,
      fulfillmentBacklog as never,
      auditService as never,
      linkResolver as never,
    );

    return {
      service,
      productSellableQuantity,
      fulfillmentBacklog,
      stockEventService,
      warehouseService,
      dbService,
      auditService,
      linkResolver,
    };
```

기존 두 테스트의 `select` 큐를 보정한다 — Task 3 이후 `validate` 가 `trx.select()` 를 한 번 더 쓰기 때문이다. `:199` 와 `:231` 의 `const tx = makeTx([[matching]]);` 를 각각 다음으로 바꾼다:

```ts
    const tx = makeTx([[matching], [{ id: '44444444-4444-4444-4444-444444444444' }]]);
```

그리고 같은 파일 끝에 새 describe 를 더한다:

```ts
// makeService · makeTx · matching 은 Step 2 앞부분에서 파일 최상위로 끌어올린 것을 그대로 쓴다.
describe('ProductMatchingService links input', () => {
  const EXISTING_SKU = '44444444-4444-4444-4444-444444444444';

  it('resolves links by creating new SKUs on the same transaction', async () => {
    const { service, linkResolver } = makeService();
    const tx = makeTx([[matching], [{ id: EXISTING_SKU }, { id: 'created-2' }]]);

    await service.resolveMatchingPending(
      matching.id,
      {
        strategy: 'variant',
        links: [
          { skuId: EXISTING_SKU, quantity: 2 },
          { newSku: { name: 'S / 검정' } as never },
        ],
      } as ResolveMatchingDto,
      tx as never,
    );

    expect(linkResolver.resolve).toHaveBeenCalledWith(
      [{ skuId: EXISTING_SKU, quantity: 2 }, { newSku: { name: 'S / 검정' } }],
      tx,
    );
    expect(tx.inserts[0]).toMatchObject({ productMatchingId: matching.id, skuId: EXISTING_SKU, quantity: 2 });
    expect(tx.inserts[1]).toMatchObject({ productMatchingId: matching.id, skuId: 'created-2', quantity: 1 });
    expect(tx.updates[0]).toMatchObject({ status: 'matched', strategy: 'variant', isResolved: true });
  });

  it('prefers links over the deprecated skuMappings input', async () => {
    const { service, linkResolver } = makeService();
    const tx = makeTx([[matching], [{ id: EXISTING_SKU }]]);

    await service.resolveMatchingPending(
      matching.id,
      {
        strategy: 'variant',
        links: [{ skuId: EXISTING_SKU, quantity: 3 }],
        skuMappings: [{ skuId: '99999999-9999-9999-9999-999999999999', quantity: 1 }],
      } as ResolveMatchingDto,
      tx as never,
    );

    expect(linkResolver.resolve).toHaveBeenCalledTimes(1);
    expect(tx.inserts[0]).toMatchObject({ skuId: EXISTING_SKU, quantity: 3 });
  });

  it('rejects links together with the void strategy', async () => {
    const { service } = makeService();
    const tx = makeTx([[matching]]);

    await expect(
      service.resolveMatchingPending(
        matching.id,
        { strategy: 'void', links: [{ skuId: EXISTING_SKU }] } as ResolveMatchingDto,
        tx as never,
      ),
    ).rejects.toThrow('void strategy does not accept SKU mappings.');
  });

  it('does not call the resolver when no links are supplied', async () => {
    const { service, linkResolver } = makeService();
    const tx = makeTx([[matching], [{ id: EXISTING_SKU }]]);

    await service.resolveMatchingPending(
      matching.id,
      { strategy: 'variant', skuMappings: [{ skuId: EXISTING_SKU, quantity: 1 }] } as ResolveMatchingDto,
      tx as never,
    );

    expect(linkResolver.resolve).not.toHaveBeenCalled();
  });
});
```

> `makeService` 와 `makeTx` 는 기존 describe 블록 안의 지역 함수다. 새 describe 에서 쓰려면 **두 함수를 파일 최상위(첫 describe 밖)로 끌어올린다.** `matching` 상수도 함께 최상위로 올리고, 기존 describe 안의 중복 선언을 지운다.

- [ ] **Step 3: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/services/product-matching.service.spec.ts`
Expected: FAIL — `links` 를 아무도 읽지 않아 `매칭할 SKU 정보를 제공하거나…` 로 거부된다

- [ ] **Step 4: 서비스를 구현한다**

`product-matching.service.ts` — import 를 더한다:

```ts
import { MatchingLinkResolver } from './matching-link-resolver';
```

생성자 마지막에 인자를 더한다:

```ts
    private readonly auditService: AuditService,
    private readonly linkResolver: MatchingLinkResolver,
  ) {
```

`resolveMatchingPending`(`:856`)의 구조 분해와 `hasSkuMappings` 를 바꾼다:

```ts
    const {
      skuIds,
      skuMappings,
      links,
      ignore,
      resolveAsVoid,
      strategy = 'variant',
      stockPolicy,
      isGift = false,
    } = resolveDto;
    const hasLinks = Boolean(links && links.length > 0);
    const hasSkuMappings =
      hasLinks || Boolean((skuIds && skuIds.length > 0) || (skuMappings && skuMappings.length > 0));
```

`else if (hasSkuMappings)` 블록 안의 매핑 결정부(`:889-903`)를 교체한다:

```ts
        let mappings: SkuQuantityMapping[];

        if (links && links.length > 0) {
          // newSku 가 있으면 여기서 이 트랜잭션 위에 SKU 가 만들어진다.
          mappings = await this.linkResolver.resolve(links, trx);
        } else if (skuMappings && skuMappings.length > 0) {
          mappings = skuMappings.map((mapping) => ({
            skuId: mapping.skuId,
            quantity: mapping.quantity || 1,
          }));
        } else if (skuIds && skuIds.length > 0) {
          mappings = skuIds.map((skuId) => ({
            skuId,
            quantity: 1,
          }));
        } else {
          throw new BadRequestException('SKU 매핑 정보가 없습니다.');
        }
```

`validate` 호출(`:911`)에 트랜잭션을 넘긴다:

```ts
        const isValid = await matchingStrategy.validate(context, mappings, trx);
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/services/product-matching.service.spec.ts`
Expected: PASS (기존 전부 + 새 4개)

- [ ] **Step 6: 타입체크**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/product-matching/dto/resolve-matching.dto.ts \
        apps/core/src/modules/product-matching/services/product-matching.service.ts \
        apps/core/src/modules/product-matching/services/product-matching.service.spec.ts
git commit -m "feat(matching): resolve 가 links 를 받는다 — 한 트랜잭션에서 SKU 생성까지 (#791)"
```

---

## Task 5: `upsert` 가 `links[].newSku` 를 받는다

**Files:**
- Modify: `apps/core/src/modules/product-matching/dto/upsert-matching.dto.ts`
- Modify: `apps/core/src/modules/product-matching/services/product-sku-mapping.service.ts:29-34` (생성자), `:294-408` (`upsert`)
- Test: `apps/core/src/modules/product-matching/services/product-sku-mapping.service.spec.ts` (기존 확장)

**Interfaces:**
- Consumes: `MatchingLinkInputDto` (Task 1) · `MatchingLinkResolver.resolve` (Task 2)
- Produces: `UpsertMatchingDto.links: MatchingLinkInputDto[]` — Task 8 이 참조한다. `ProductSkuMappingService` 생성자의 **4번째** 인자가 `MatchingLinkResolver` 다.

**타입 주의:** 이 서비스는 ADR-0025 cross-BC seam 이라 `DbService<MergedSchema>` / `AnyTx` 로 선언돼 있다. `run` 안의 `trx` 는 `MergedTx` 이고 `MatchingLinkResolver.resolve` 는 `DbTx` 를 받는다. **같은 파일이 이미 `upsertSalesVariantPolicy(trx: DbTx, …)` 에 `trx` 를 그대로 넘기고 있으므로 캐스팅 없이 통과할 것으로 본다.** Step 5 의 `type-check` 에서 안 되면 `TxFor<MergedSchema>` 를 한 지점에서만 좁히고(`resolve(links, trx as DbTx)`) 그 줄에 이유를 주석으로 남긴다 — `as unknown` 을 끼우지 않는다.

- [ ] **Step 1: DTO 를 넓힌다**

`upsert-matching.dto.ts` — `MatchingLinkDto` 클래스를 지우고 `MatchingLinkInputDto` 를 재사용한다. import 를 더하고:

```ts
import { MatchingLinkInputDto } from './matching-link-input.dto';
```

`MatchingLinkDto` 클래스 선언 전체를 지운 뒤, 하위 호환을 위해 별칭을 남긴다:

```ts
/** @deprecated `MatchingLinkInputDto` 를 직접 쓴다. 이름만 남긴 별칭. */
export { MatchingLinkInputDto as MatchingLinkDto } from './matching-link-input.dto';
```

`UpsertMatchingDto.links` 를 바꾼다:

```ts
  @ApiProperty({
    description:
      '매칭 링크 목록. 각 항목은 기존 재고상품(skuId) 또는 새로 만들 재고상품(newSku) 중 하나다. ' +
      'newSku 를 쓰려면 inventory.manage 권한이 필요하다.',
    type: [MatchingLinkInputDto],
    default: [],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchingLinkInputDto)
  links: MatchingLinkInputDto[] = [];
```

쓰이지 않게 된 import(`IsInt`, `IsPositive`, `IsUUID` 중 다른 곳에서 안 쓰는 것)를 지운다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`product-sku-mapping.service.spec.ts` 의 `createService`(`:44`)를 고치고, 파일 안의 **6곳 전부**(`grep -c "new ProductSkuMappingService"` → 6)에 4번째 인자를 더한다. 헬퍼를 하나 두고 인라인 생성들도 그것을 쓰게 바꾼다:

```ts
function makeLinkResolver() {
  return {
    resolve: jest.fn(async (links: Array<{ skuId?: string; quantity?: number }>) =>
      links.map((link, index) => ({ skuId: link.skuId ?? `created-${index + 1}`, quantity: link.quantity ?? 1 })),
    ),
  };
}

function createService(
  dbService: any,
  productSellableQuantity: any,
  fulfillmentBacklog?: any,
  linkResolver: any = makeLinkResolver(),
) {
  return new ProductSkuMappingService(
    dbService as any,
    productSellableQuantity as any,
    (fulfillmentBacklog ?? { wakeBacklogsWaitingForVariant: jest.fn() }) as any,
    linkResolver as any,
  );
}
```

이 파일의 목은 테스트마다 인라인으로 만들어져 있다(6곳). **공통 헬퍼로 추출하지 않는다** — 모양이 조금씩 달라 추출이 기존 테스트를 깨뜨릴 위험이 있다. 대신 **`:390-513` 의 `registers SKU 구성 matching and wakes only variant-related fulfillment backlog` 테스트를 통째로 복제**해 아래처럼 고친다:

```ts
  it('creates new SKUs through the resolver on the upsert transaction', async () => {
    // ── 여기부터 :390 테스트의 변수 선언·tx 목·dbService 목을 그대로 복제한다 ──
    //    (variantId / matchingId / inserts / updates / matching / tx / dbService /
    //     productSellableQuantity / fulfillmentBacklog)
    const existingSku = 'sku-1';
    const linkResolver = makeLinkResolver();

    const service = new ProductSkuMappingService(
      dbService as any,
      productSellableQuantity as any,
      fulfillmentBacklog as any,
      linkResolver as any,
    );

    await service.upsert(variantId, {
      links: [{ skuId: existingSku, quantity: 2 }, { newSku: { name: 'S / 검정' } }],
    } as any);

    // 리졸버가 upsert 의 트랜잭션을 그대로 받았다
    expect(linkResolver.resolve).toHaveBeenCalledWith(
      [{ skuId: existingSku, quantity: 2 }, { newSku: { name: 'S / 검정' } }],
      tx,
    );

    // 리졸버가 돌려준 매핑이 그대로 링크로 들어간다
    expect(inserts.find((entry) => entry.table === wmsTables.productVariantSkuLinks)?.values).toEqual([
      { productMatchingId: matchingId, skuId: existingSku, quantity: 2 },
      { productMatchingId: matchingId, skuId: 'created-2', quantity: 1 },
    ]);
  });
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/services/product-sku-mapping.service.spec.ts`
Expected: FAIL — `linkResolver.resolve` 미호출 (현재는 `dto.links.map` 으로 직접 insert 한다)

- [ ] **Step 4: 서비스를 구현한다**

`product-sku-mapping.service.ts` — import 를 더한다:

```ts
import { MatchingLinkResolver } from './matching-link-resolver';
```

생성자 마지막에:

```ts
    private readonly fulfillmentBacklog: FulfillmentOrderCreationBacklogService,
    private readonly linkResolver: MatchingLinkResolver,
  ) {}
```

`upsert` 안에서 링크를 삽입하는 블록(`:374-383`)을 교체한다:

```ts
        if (Array.isArray(dto.links) && dto.links.length > 0) {
          // newSku 가 있으면 여기서 이 트랜잭션 위에 SKU 가 만들어진다.
          const mappings = await this.linkResolver.resolve(dto.links, trx);
          await trx.insert(wmsTables.productVariantSkuLinks).values(
            mappings.map((mapping) => ({
              productMatchingId: matchingId,
              skuId: mapping.skuId,
              quantity: mapping.quantity,
            })),
          );
        }
```

- [ ] **Step 5: 통과와 타입을 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/services/product-sku-mapping.service.spec.ts && npm run type-check`
Expected: 테스트 PASS, 타입 에러 0

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/product-matching/dto/upsert-matching.dto.ts \
        apps/core/src/modules/product-matching/services/product-sku-mapping.service.ts \
        apps/core/src/modules/product-matching/services/product-sku-mapping.service.spec.ts
git commit -m "feat(matching): upsert 도 links[].newSku 를 받는다 (#791)"
```

---

## Task 6: `NewSkuScopeGuard`

**Files:**
- Create: `apps/core/src/modules/product-matching/guards/new-sku-scope.guard.ts`
- Test: `apps/core/src/modules/product-matching/guards/new-sku-scope.guard.spec.ts`
- Modify: `apps/core/src/modules/product-matching/controllers/product-matching.controller.ts:109`
- Modify: `apps/core/src/modules/product-matching/controllers/product-sku-mapping.controller.ts:69`

**Interfaces:**
- Consumes: `AuthorizationService.getScopesByRoles(roleNames: string[]): Promise<Set<string>>` from `@app/authorization` · `INVENTORY_SCOPE.MANAGE` from `apps/core/src/platform/auth/inventory-scopes.ts`
- Produces: `class NewSkuScopeGuard implements CanActivate` · `function bodyRequestsNewSku(body: unknown): boolean`

**왜 `@RequireScopes` 가 아닌가:** 그 데코레이터를 붙이면 `AdminRealmGuard` 가 「정책이 이미 명시됨」으로 보고 직원 역할 검사를 건너뛴다(`libs/authorization/src/guards/admin-realm.guard.ts:47`). 스코프를 얻으면서 역할 검사를 잃는 교환이 된다. 커스텀 가드는 메타데이터를 남기지 않아 `AdminRealmGuard` 가 그대로 지키고, `scope-guard-binding.spec.ts` 도 건드리지 않는다. `AuthorizationModule` 은 `@Global()` 이라 모듈 import 추가는 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/product-matching/guards/new-sku-scope.guard.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { NewSkuScopeGuard, bodyRequestsNewSku } from './new-sku-scope.guard';

function makeContext(body: unknown, roles?: string[]) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ body, user: roles ? { roles } : undefined }) }),
  } as never;
}

describe('bodyRequestsNewSku', () => {
  it('is false for a body without links', () => {
    expect(bodyRequestsNewSku({ skuMappings: [{ skuId: 'x' }] })).toBe(false);
    expect(bodyRequestsNewSku(undefined)).toBe(false);
    expect(bodyRequestsNewSku('links')).toBe(false);
  });

  it('is false when every link references an existing SKU', () => {
    expect(bodyRequestsNewSku({ links: [{ skuId: 'a' }, { skuId: 'b' }] })).toBe(false);
  });

  it('is true when any link carries newSku', () => {
    expect(bodyRequestsNewSku({ links: [{ skuId: 'a' }, { newSku: { name: 'x' } }] })).toBe(true);
  });
});

describe('NewSkuScopeGuard', () => {
  it('lets a request without newSku through untouched', async () => {
    const authService = { getScopesByRoles: jest.fn() };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(guard.canActivate(makeContext({ links: [{ skuId: 'a' }] }, ['admin']))).resolves.toBe(true);
    expect(authService.getScopesByRoles).not.toHaveBeenCalled();
  });

  it('allows newSku when the role set grants inventory.manage', async () => {
    const authService = { getScopesByRoles: jest.fn().mockResolvedValue(new Set(['inventory.manage'])) };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['admin'])),
    ).resolves.toBe(true);
    expect(authService.getScopesByRoles).toHaveBeenCalledWith(['admin']);
  });

  it('allows master without consulting the scope table', async () => {
    const authService = { getScopesByRoles: jest.fn() };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['master'])),
    ).resolves.toBe(true);
    expect(authService.getScopesByRoles).not.toHaveBeenCalled();
  });

  it('rejects newSku when the role set lacks inventory.manage', async () => {
    const authService = { getScopesByRoles: jest.fn().mockResolvedValue(new Set(['inventory.operate'])) };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['staff'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects newSku when the request carries no roles', async () => {
    const authService = { getScopesByRoles: jest.fn() };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the scope lookup fails', async () => {
    const authService = { getScopesByRoles: jest.fn().mockRejectedValue(new Error('db down')) };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['staff'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/guards/new-sku-scope.guard.spec.ts`
Expected: FAIL — `Cannot find module './new-sku-scope.guard'`

- [ ] **Step 3: 가드를 구현한다**

`apps/core/src/modules/product-matching/guards/new-sku-scope.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuthorizationService } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../platform/auth/inventory-scopes';

/** payload 의 links 중 하나라도 새 재고상품 생성을 요구하는가. */
export function bodyRequestsNewSku(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const links = (body as { links?: unknown }).links;
  if (!Array.isArray(links)) return false;
  return links.some(
    (link) => !!link && typeof link === 'object' && (link as { newSku?: unknown }).newSku !== undefined,
  );
}

/**
 * 매칭 해소는 지금까지 AdminRealmGuard 만으로 지켜졌다. 거기에 「새 재고상품을 만든다」는
 * 능력이 얹히므로, 그 능력에만 `inventory.manage` 를 요구한다 —
 * `POST /inventory/skus` 가 요구하는 것과 같은 스코프다.
 *
 * 라우트 전체에 `@RequireScopes` 를 붙이지 않는 이유: (a) 지금 매칭만 하던 계정이 403 이 되고
 * (b) AdminRealmGuard 가 그 메타데이터를 보고 직원 역할 검사를 건너뛴다
 * (`admin-realm.guard.ts:47`). 단조 안전하지 않다.
 */
@Injectable()
export class NewSkuScopeGuard implements CanActivate {
  private readonly logger = new Logger(NewSkuScopeGuard.name);

  constructor(private readonly authService: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ body?: unknown; user?: { roles?: unknown } }>();

    if (!bodyRequestsNewSku(request.body)) {
      return true;
    }

    const roles = request.user?.roles;
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new ForbiddenException('새 재고상품을 만들려면 inventory.manage 권한이 필요합니다.');
    }

    const roleNames = roles.filter((role): role is string => typeof role === 'string');
    if (roleNames.includes('master')) {
      return true;
    }

    let scopes: Set<string>;
    try {
      scopes = await this.authService.getScopesByRoles(roleNames);
    } catch (error) {
      this.logger.error('Failed to fetch role-scope mappings from DB', error);
      throw new ForbiddenException('새 재고상품을 만들려면 inventory.manage 권한이 필요합니다.');
    }

    if (scopes.has('master') || scopes.has(INVENTORY_SCOPE.MANAGE)) {
      return true;
    }

    throw new ForbiddenException('새 재고상품을 만들려면 inventory.manage 권한이 필요합니다.');
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/guards/new-sku-scope.guard.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 두 라우트에 붙인다**

`product-matching.controller.ts` — import 를 더하고(`import { UseGuards } from '@nestjs/common';` 는 기존 import 목록에 `UseGuards` 를 추가하는 형태), `@Patch(':id/resolve')` 바로 아래에 붙인다:

```ts
import { NewSkuScopeGuard } from '../guards/new-sku-scope.guard';
```

```ts
  @Patch(':id/resolve')
  @UseGuards(NewSkuScopeGuard)
  @ApiOperation({ summary: '매칭 대기 해소 (SKU 구성 매칭 또는 void 전략)' })
  @ApiResponse({ status: 403, description: 'newSku 를 쓰려면 inventory.manage 권한이 필요합니다.' })
```

`product-sku-mapping.controller.ts` — 같은 import 를 더하고 `@Put(':variantId')` 아래에:

```ts
  @Put(':variantId')
  @UseGuards(NewSkuScopeGuard)
  async upsert(@Param('variantId') variantId: string, @Body() dto: UpsertMatchingDto) {
```

- [ ] **Step 6: 게이트를 돌린다**

Run: `npm run type-check && npx jest --maxWorkers=2 apps/core/src/modules/product-matching apps/core/src/platform/auth`
Expected: 타입 0, 테스트 실패 0 (`scope-guard-binding.spec.ts` 포함 — `@RequireScopes` 를 안 썼으므로 걸리지 않아야 한다)

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/product-matching/guards/ \
        apps/core/src/modules/product-matching/controllers/
git commit -m "fix(matching): newSku 가 있을 때만 inventory.manage 를 요구한다 (#791)"
```

---

## Task 7: core 죽은 코드 삭제

**Files:**
- Delete: `apps/core/src/modules/inventory/core/dto/product-matching/` (5 파일)
- Modify: `apps/core/src/modules/product-matching/services/product-matching.service.ts:1167-1212` (`createNewSkuForMatching` 삭제)

**Interfaces:** 없음 — 순수 삭제다.

**근거:** 두 대상 모두 전 저장소 grep 결과 참조 0곳. `createNewSkuForMatching` 은 매칭용 SKU 생성의 미완성 조상이고, Task 2 의 리졸버가 그 자리를 대체한다. 그것이 하던 「기본 창고에 수량 0 원장 심기」는 계승하지 않는다 — 정본인 `POST /inventory/skus` 도 원장을 심지 않고, 재고를 여는 것은 입고다(ADR-0028).

- [ ] **Step 1: 참조가 정말 0인지 확인한다**

```bash
grep -rn "createNewSkuForMatching" --include=*.ts apps libs
grep -rn "inventory/core/dto/product-matching" --include=*.ts apps libs
```
Expected: 둘 다 출력 없음 (`product-matching.service.ts` 안의 선언 자체는 제외)

- [ ] **Step 2: 삭제한다**

```bash
git rm -r apps/core/src/modules/inventory/core/dto/product-matching
```

`product-matching.service.ts` 에서 `async createNewSkuForMatching(` 부터 그 메서드의 닫는 `}` 까지 지운다. 그 결과 쓰이지 않게 되는 import 도 지운다 — 삭제 후 `SkuCreationSource`·`stockEventService`·`warehouseService` 가 파일 안 다른 곳에서 쓰이는지 확인하고, 안 쓰이면 import/생성자 인자까지 지운다.

> **주의:** 생성자 인자를 지우면 Task 4 에서 고친 spec 의 인자 순서가 어긋난다. 지운다면 spec 도 같이 고친다. 다른 곳에서 여전히 쓰이면 그대로 둔다 — 먼저 `grep -n "stockEventService\.\|warehouseService\.\|SkuCreationSource" apps/core/src/modules/product-matching/services/product-matching.service.ts` 로 확인한다.

- [ ] **Step 3: 게이트를 돌린다**

Run: `npm run type-check && npx jest --maxWorkers=2 apps/core/src/modules/product-matching`
Expected: 타입 0, 테스트 실패 0

- [ ] **Step 4: 커밋**

```bash
git add -A apps/core/src/modules
git commit -m "refactor(matching): 참조 0인 DTO 사본 5개와 createNewSkuForMatching 삭제 (#791)"
```

---

## Task 8: admin-web 계약 타입 정리

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/matching.ts:47-55` (`ResolveMatchingDto`), `:266-271` (`UpsertMatchingDto`)
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:1063-1119` (죽은 3개 삭제)
- Modify: `apps/admin-web/src/lib/api/domains/inventory/index.ts:52-72, 89-94, 111-117`
- Modify: `apps/admin-web/src/lib/services/inventory/queries.ts:10, 279-294`
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts:9, 217-225`
- Modify: `apps/admin-web/src/lib/services/inventory/query-keys.ts:74-75`

**Interfaces:**
- Produces: `MatchingLinkInputDto` · `CreateSkuInputDto` in `lib/types/dto/matching.ts` — Task 9·10 이 쓴다.

- [ ] **Step 1: 링크 타입을 더한다**

`apps/admin-web/src/lib/types/dto/matching.ts` 의 `SkuMappingDto` 바로 아래에 넣는다:

```ts
/** core 의 CreateSkuDto 중 매칭 화면이 채우는 부분집합 */
export interface CreateSkuInputDto {
  name: string;
  holderId?: string;
  supplierIds?: string[];
  businessProductName?: string;
  importDeclarationNumber?: string;
  optionKey?: string;
  productDescription?: string;
  moq?: number;
  memo2?: string;
  memo3?: string;
}

/** 매칭 링크 한 항목. skuId 와 newSku 는 배타다. */
export interface MatchingLinkInputDto {
  skuId?: string;
  newSku?: CreateSkuInputDto;
  quantity?: number;
}
```

`ResolveMatchingDto` 에 필드를 더한다:

```ts
export interface ResolveMatchingDto {
  /** @deprecated links 를 쓴다 */
  skuIds?: string[];
  /** @deprecated links 를 쓴다 */
  skuMappings?: SkuMappingDto[];
  links?: MatchingLinkInputDto[];
  ignore?: boolean;
  resolveAsVoid?: boolean;
  strategy?: MatchingStrategy;
  stockPolicy: StockPolicyDto;
  isGift: boolean;
}
```

`UpsertMatchingDto.links` 를 넓힌다:

```ts
export interface UpsertMatchingDto {
  masterId?: string | null;
  links?: MatchingLinkInputDto[];
  policy?: Partial<StockPolicyDto>;
}
```

- [ ] **Step 2: 죽은 타입·클라이언트·훅을 지운다**

`lib/types/dto/inventory.ts` — `InventoryOptionDto`(`:1064`), `CreateInventoryMatchingDto`(`:1072`), `InventoryMatchingResponseDto`(`:1100`) 세 인터페이스를 지운다.

`lib/api/domains/inventory/index.ts` — `inventoryMatchingApi` 상수 전체(`:53-72`)를 지우고, `import type` 목록에서 `InventoryOptionDto`·`CreateInventoryMatchingDto`·`InventoryMatchingResponseDto` 를 지운다. `inventory.inventoryMatching` 객체와 `inventoryMatchingClient` 객체에서 `matchings: inventoryMatchingApi,` 줄을 지운다.

`lib/services/inventory/queries.ts` — `useInventoryMatchings`·`useInventoryMatching` 두 훅과 `inventoryMatchingClient` import 를 지운다.

`lib/services/inventory/mutations.ts` — `useCreateInventoryMatching` 훅과 `inventoryMatchingClient` import 를 지운다.

`lib/services/inventory/query-keys.ts` — `inventoryMatchings`·`inventoryMatching` 두 줄(`:74-75`)을 지운다.

- [ ] **Step 3: 남은 참조가 없는지 확인한다**

```bash
grep -rn "inventoryMatchingClient\|CreateInventoryMatchingDto\|InventoryMatchingResponseDto\|InventoryOptionDto\|useCreateInventoryMatching\|useInventoryMatching" apps/admin-web/src
```
Expected: `InventoryMatchingDialog.tsx` 의 `useCreateInventoryMatching` 만 남는다 (Task 10 에서 지운다)

- [ ] **Step 4: 타입체크**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: `InventoryMatchingDialog.tsx` 의 `useCreateInventoryMatching` 미해결 에러만 남는다 — Task 10 이 닫는다. 그 외 에러 0.

> 이 상태로 커밋하면 admin-web 타입체크가 빨간 채로 남는다. **Task 8·9·10 은 한 커밋으로 묶는다.** 여기서는 커밋하지 말고 Task 9 로 넘어간다.

---

## Task 9: `buildMatchingLinks` — auto 탭 판정 (순수)

**Files:**
- Create: `apps/admin-web/src/features/order/matching/lib/build-matching-links.ts`
- Test: `apps/admin-web/src/features/order/matching/lib/build-matching-links.spec.ts`

**Interfaces:**
- Consumes: `MatchingLinkInputDto` (Task 8)
- Produces: `buildMatchingLinks(state: AutoTabState): BuildResult` · `normalizeQuantity(value: number): number` · `BUILD_FAILURE_MESSAGES` — Task 10 이 쓴다.

**왜 별도 파일인가:** `test:admin-web`(`package.json:154`)이 `^.+\.(t|j)s$` 만 transform 하므로 `.tsx` 는 테스트할 수 없다. 루트 jest 는 `^@/(.*)$ → apps/admin-web/src/$1` 를 매핑하므로(`package.json:360`) 이 spec 은 `npx jest` 에도 잡힌다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin-web/src/features/order/matching/lib/build-matching-links.spec.ts`:

```ts
import { buildMatchingLinks, normalizeQuantity, type AutoTabState } from './build-matching-links';

const HOLDER = '11111111-1111-1111-1111-111111111111';
const SUPPLIER = '22222222-2222-2222-2222-222222222222';

function state(overrides: Partial<AutoTabState> = {}): AutoTabState {
  return {
    holderId: HOLDER,
    supplierId: SUPPLIER,
    businessProductName: '사입 상품명',
    importDeclarationNumber: '',
    optionKey: '',
    productDescription: '',
    moq: '',
    memo2: '',
    memo3: '',
    optionRows: [{ id: 'r1', name: 'S / 검정', quantity: 1 }],
    ...overrides,
  };
}

describe('normalizeQuantity', () => {
  it('floors to at least 1 and truncates fractions', () => {
    expect(normalizeQuantity(0)).toBe(1);
    expect(normalizeQuantity(-3)).toBe(1);
    expect(normalizeQuantity(2.7)).toBe(2);
    expect(normalizeQuantity(Number.NaN)).toBe(1);
    expect(normalizeQuantity(5)).toBe(5);
  });
});

describe('buildMatchingLinks', () => {
  it('builds one newSku link per filled option row', () => {
    const result = buildMatchingLinks(
      state({
        optionRows: [
          { id: 'r1', name: 'S / 검정', quantity: 2 },
          { id: 'r2', name: 'M / 검정', quantity: 1 },
        ],
      }),
    );

    expect(result).toEqual({
      ok: true,
      links: [
        {
          quantity: 2,
          newSku: { name: 'S / 검정', holderId: HOLDER, supplierIds: [SUPPLIER], businessProductName: '사입 상품명' },
        },
        {
          quantity: 1,
          newSku: { name: 'M / 검정', holderId: HOLDER, supplierIds: [SUPPLIER], businessProductName: '사입 상품명' },
        },
      ],
    });
  });

  it('drops rows whose name is blank', () => {
    const result = buildMatchingLinks(
      state({
        optionRows: [
          { id: 'r1', name: '  ', quantity: 1 },
          { id: 'r2', name: 'M', quantity: 1 },
          { id: 'r3', name: '', quantity: 1 },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.links).toHaveLength(1);
    expect(result.ok && result.links[0].newSku?.name).toBe('M');
  });

  it('trims option names', () => {
    const result = buildMatchingLinks(state({ optionRows: [{ id: 'r1', name: '  S  ', quantity: 1 }] }));
    expect(result.ok && result.links[0].newSku?.name).toBe('S');
  });

  it('omits blank optional fields rather than sending empty strings', () => {
    const result = buildMatchingLinks(state({ businessProductName: '   ', memo2: '' }));
    expect(result.ok && result.links[0].newSku).toEqual({
      name: 'S / 검정',
      holderId: HOLDER,
      supplierIds: [SUPPLIER],
    });
  });

  it('carries the optional fields that core can store', () => {
    const result = buildMatchingLinks(
      state({
        importDeclarationNumber: 'IMP-1',
        optionKey: 'S/검정',
        productDescription: '설명',
        moq: '10',
        memo2: '메모2',
        memo3: '메모3',
      }),
    );

    expect(result.ok && result.links[0].newSku).toMatchObject({
      importDeclarationNumber: 'IMP-1',
      optionKey: 'S/검정',
      productDescription: '설명',
      moq: 10,
      memo2: '메모2',
      memo3: '메모3',
    });
  });

  it('drops a non-numeric or non-positive moq', () => {
    for (const moq of ['abc', '0', '-4', '']) {
      const result = buildMatchingLinks(state({ moq }));
      expect(result.ok).toBe(true);
      expect(result.ok && 'moq' in (result.links[0].newSku ?? {})).toBe(false);
    }
  });

  it('reports missing-required when supplier or holder is unset', () => {
    expect(buildMatchingLinks(state({ supplierId: '' }))).toEqual({ ok: false, reason: 'missing-required' });
    expect(buildMatchingLinks(state({ holderId: '' }))).toEqual({ ok: false, reason: 'missing-required' });
  });

  it('reports no-options when every row is blank', () => {
    expect(buildMatchingLinks(state({ optionRows: [{ id: 'r1', name: ' ', quantity: 1 }] }))).toEqual({
      ok: false,
      reason: 'no-options',
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/admin-web/src/features/order/matching/lib/build-matching-links.spec.ts`
Expected: FAIL — `Cannot find module './build-matching-links'`

- [ ] **Step 3: 구현한다**

`apps/admin-web/src/features/order/matching/lib/build-matching-links.ts`:

```ts
import type { MatchingLinkInputDto } from '@/lib/types/dto/matching';

export type AutoTabOptionRow = {
  id: string;
  name: string;
  quantity: number;
};

export type AutoTabState = {
  holderId: string;
  supplierId: string;
  businessProductName: string;
  importDeclarationNumber: string;
  optionKey: string;
  productDescription: string;
  moq: string;
  memo2: string;
  memo3: string;
  optionRows: AutoTabOptionRow[];
};

export type BuildFailureReason = 'missing-required' | 'no-options';

export type BuildResult =
  | { ok: true; links: MatchingLinkInputDto[] }
  | { ok: false; reason: BuildFailureReason };

export const BUILD_FAILURE_MESSAGES: Record<BuildFailureReason, string> = {
  'missing-required': '공급처와 재고소유를 선택해주세요.',
  'no-options': '최소 1개 이상의 옵션명을 입력해주세요.',
};

export function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const truncated = Math.trunc(value);
  return truncated < 1 ? 1 : truncated;
}

/** 빈 문자열은 아예 보내지 않는다 — core 에서 '' 로 덮어쓰는 것을 막는다. */
function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalPositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * auto 탭 상태를 매칭 링크로 바꾼다. 옵션 행 하나가 새 재고상품 하나가 되고,
 * 그것들이 이 판매상품 variant 의 구성품으로 링크된다.
 */
export function buildMatchingLinks(state: AutoTabState): BuildResult {
  if (!state.supplierId || !state.holderId) {
    return { ok: false, reason: 'missing-required' };
  }

  const rows = state.optionRows.filter((row) => row.name.trim().length > 0);
  if (rows.length === 0) {
    return { ok: false, reason: 'no-options' };
  }

  const shared = {
    holderId: state.holderId,
    supplierIds: [state.supplierId],
    businessProductName: optionalText(state.businessProductName),
    importDeclarationNumber: optionalText(state.importDeclarationNumber),
    optionKey: optionalText(state.optionKey),
    productDescription: optionalText(state.productDescription),
    moq: optionalPositiveInt(state.moq),
    memo2: optionalText(state.memo2),
    memo3: optionalText(state.memo3),
  };

  const links = rows.map((row) => {
    const newSku: Record<string, unknown> = { name: row.name.trim() };
    for (const [key, value] of Object.entries(shared)) {
      if (value !== undefined) newSku[key] = value;
    }
    return {
      quantity: normalizeQuantity(row.quantity),
      newSku,
    } as MatchingLinkInputDto;
  });

  return { ok: true, links };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/admin-web/src/features/order/matching/lib/build-matching-links.spec.ts`
Expected: PASS (10 tests)

---

## Task 10: 다이얼로그 — 한 번만 부른다

**Files:**
- Modify: `apps/admin-web/src/features/order/matching/components/table/InventoryMatchingDialog.tsx`

**Interfaces:**
- Consumes: `buildMatchingLinks`·`BUILD_FAILURE_MESSAGES`·`normalizeQuantity`·`AutoTabOptionRow` (Task 9) · `MatchingLinkInputDto` (Task 8) · `useResolveMatching`·`useUpsertVariantMatching`·`useChangeMatchingStrategy` (기존)

**변경 목록** — 이 파일에서 정확히 이것들을 한다:

1. **import**: `useCreateInventoryMatching` 과 `useWarehouses` 를 지운다. `PRODUCT_TYPES`(`@/lib/mock/data/inventory`) import 를 지운다. `toast` 를 `sonner` 에서 더한다. Task 9 의 모듈을 더한다.
2. **지역 `OptionRow` 타입 선언(`:47-52`)을 지우고** Task 9 의 `AutoTabOptionRow` 를 import 해서 그 자리에 쓴다 (`image`·`price` 없이 `quantity` 가 있다).
3. **상태 삭제**: `productType`·`warehouseId`·`importCertificate`·`usage`·`costPrice`·`memo1`·`memo4`·`showSupplierCreate`·`showHolderCreate`.
   **상태 이름 변경** — 선언·setter·읽는 곳(JSX 포함)을 **전부** 같이 바꾼다:

   | 지금 | 바꿀 이름 |
   |---|---|
   | `citizenProductName` / `setCitizenProductName` | `businessProductName` / `setBusinessProductName` |
   | `importDeclaration` / `setImportDeclaration` | `importDeclarationNumber` / `setImportDeclarationNumber` |
   | `optionDetail` / `setOptionDetail` | `optionKey` / `setOptionKey` |
   | `stockOwnerId` / `setStockOwnerId` | `holderId` / `setHolderId` |

   `setStockOwnerId` 는 `handleHolderSelect`(`:389`)·`handleHolderCreate`(`:401`)·`isFormValid`(`:94`) 에서도 불린다 — 빠뜨리면 타입체크가 잡는다.
4. **핸들러 삭제**: `handleCreateSupplier`(`:326`)·`handleCreateHolder`(`:343`)·`handleApplyRepresentativeCost`·`handleImageUpload`.
5. **`alert()` 10곳 → `toast.error` / `toast.success`.**
6. **`isFormValid`** 의 auto 분기를 `!!(supplierId && holderId && optionRows.some((r) => r.name.trim()))` 로 바꾼다.
7. **`onSave`** 를 아래처럼 바꾼다.
8. **JSX**: 「상품 구분」·「물류처」·「수입상고필증」·「용도」·「원가」·「메모1」·「메모4」 `FormField` 를 지운다. 「사입상품명」 라벨은 유지하되 상태 이름만 바뀐다. 옵션 테이블에서 「옵션이미지」·「원가」 칼럼을 지우고 **「수량」 칼럼**을 더한다.

- [ ] **Step 1: `onSave` 를 한 호출로 바꾼다**

```tsx
  /** 저장 */
  const onSave = async () => {
    if (!line) return;
    if (!line.matchingId) {
      toast.error('매칭 레코드가 없습니다. 관리자에게 문의하세요.');
      return;
    }
    const matchingId = line.matchingId;

    try {
      const stockPolicy = {
        preStockSellable: true,
        alwaysSellableZeroStock: false,
      };

      /** 매칭 링크를 저장한다. 상태에 따라 뒷단이 갈리지만 payload 모양은 같다. */
      const saveSkuComposition = async (links: MatchingLinkInputDto[]) => {
        if (line.matchingStatus && line.matchingStatus !== 'pending') {
          await upsertVariantMatching.mutateAsync({
            variantId: line.variantId,
            data: { links, policy: stockPolicy },
          });
          return;
        }

        await resolveMatching.mutateAsync({
          id: matchingId,
          data: {
            ignore: false,
            strategy: 'variant',
            stockPolicy,
            links,
            isGift: false,
          },
        });
      };

      if (activeTab === 'auto') {
        // 새 재고상품을 만들고 이 판매상품에 링크한다 — 한 트랜잭션, 한 호출.
        const built = buildMatchingLinks({
          holderId,
          supplierId,
          businessProductName,
          importDeclarationNumber,
          optionKey,
          productDescription,
          moq,
          memo2,
          memo3,
          optionRows,
        });

        if (!built.ok) {
          toast.error(BUILD_FAILURE_MESSAGES[built.reason]);
          return;
        }

        await saveSkuComposition(built.links);
      } else if (activeTab === 'manual') {
        if (linkedSkus.length === 0) {
          toast.error('최소 1개 이상의 재고를 연결해주세요.');
          return;
        }

        await saveSkuComposition(
          linkedSkus.map((s) => ({ skuId: s.skuId, quantity: s.quantity }))
        );
      } else if (activeTab === 'none') {
        if (line.matchingStatus === 'matched') {
          await changeMatchingStrategy.mutateAsync({
            id: matchingId,
            data: { strategy: 'void' },
          });
          toast.success('재고상품 비매칭으로 저장했습니다.');
          onClose();
          return;
        }

        await resolveMatching.mutateAsync({
          id: matchingId,
          data: {
            ignore: false,
            resolveAsVoid: true,
            strategy: 'void',
            stockPolicy,
            isGift: false,
          },
        });
      }

      toast.success('상품매칭을 저장했습니다.');
      onClose();
    } catch (e) {
      console.error('상품등록/매칭 저장 실패:', e);
      toast.error('상품등록/매칭 저장에 실패했습니다. 다시 시도해주세요.');
    }
  };
```

- [ ] **Step 2: 옵션 테이블에 수량 칼럼을 넣는다**

`<thead>` 를 바꾼다:

```tsx
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium w-16">번호</th>
                        <th className="px-4 py-2 text-left text-xs font-medium">옵션상세명칭</th>
                        <th className="px-4 py-2 text-right text-xs font-medium w-32">수량</th>
                      </tr>
                    </thead>
```

`<tbody>` 의 각 행을 바꾼다:

```tsx
                      {optionRows.map((row, idx) => (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="px-4 py-2 text-center text-sm">{idx + 1}</td>
                          <td className="px-4 py-2">
                            <FormInput
                              value={row.name}
                              onChange={(e) => updateOptionRow(row.id, 'name', e.target.value)}
                              placeholder="옵션명을 입력하세요"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <FormNumberInput
                              value={String(row.quantity)}
                              onChange={(e) =>
                                updateOptionRow(
                                  row.id,
                                  'quantity',
                                  normalizeQuantity(Number(e.target.value))
                                )
                              }
                              suffix="개"
                              className="text-right"
                            />
                          </td>
                        </tr>
                      ))}
```

`updateOptionRow` 의 시그니처는 `(id: string, field: keyof AutoTabOptionRow, value: string | number)` 로 바꾼다 (`any` 금지).

- [ ] **Step 3: 프리필 Effect 를 새 상태에 맞춘다**

Effect 1(`:174-220`) 에서 지워진 상태의 리셋 줄(`setProductType`·`setWarehouseId`·`setImportCertificate`·`setUsage`·`setCostPrice`·`setMemo1`·`setMemo4`)을 지우고, 이름이 바뀐 것들과 옵션 행 초기값을 바꾼다:

```tsx
    setBusinessProductName(baseName);
    setSupplierId('');
    setHolderId('');
    setImportDeclarationNumber('');
    setOptionKey('');
    setProductDescription('');
    setMoq('');
    setMemo2('');
    setMemo3('');
    setOptionRows([
      { id: crypto.randomUUID(), name: baseName, quantity: 1 },
      { id: crypto.randomUUID(), name: '', quantity: 1 },
      { id: crypto.randomUUID(), name: '', quantity: 1 },
      { id: crypto.randomUUID(), name: '', quantity: 1 },
    ]);
```

`const basePrice = line.unitPrice ?? 0;`(`:178`) 도 더는 쓰이지 않으므로 지운다.

Effect 2(`:222-259`) 에서 `setCitizenProductName(masterName)` 를 바꾸고, 가격을 다루는 블록 전체(`if (richPrice != null) { … }` 와 `const richPrice = …`)를 지운다:

```tsx
    if (masterName) {
      setBusinessProductName(masterName);
      setSkuSearch(masterName);
    }

    const firstRowName = optionLabel || masterName || '';
    if (firstRowName) {
      setOptionRows((prev) => {
        const next = [...prev];
        if (next[0]) next[0] = { ...next[0], name: firstRowName };
        return next;
      });
    }
```

`isSaving`(`:262-266`) 에서 `createInventoryMatching.isPending` 항을 지운다.

- [ ] **Step 4: 나머지 `alert` 를 toast 로 바꾼다**

`handleAddSku` 의 `alert('이미 매칭된 재고상품입니다.')` → `toast.error(...)`. `handleSupplierCreate`·`handleHolderCreate` 안의 4개 → `toast.success` / `toast.error`.

- [ ] **Step 5: 타입체크와 테스트**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

Run: `npx jest apps/admin-web`
Expected: 실패 0

- [ ] **Step 6: 남은 참조가 없는지 확인한다**

```bash
grep -rn "inventory-matching\|useCreateInventoryMatching\|window.prompt\|prompt(\|alert(" apps/admin-web/src/features/order/matching apps/admin-web/src/lib/api/domains/inventory
```
Expected: 출력 없음

- [ ] **Step 7: Task 8·9·10 을 한 커밋으로**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): 자동 SKU 구성 매칭을 한 호출로 — 죽은 클라이언트 제거, 수량 입력 신설 (#791)"
```

---

## Task 11: 전체 게이트 · 문서 · 이슈

**Files:**
- Modify: `docs/local-e2e-environment.md:557-577` (§8-D 벽 ②)

- [ ] **Step 1: 전체 게이트를 돌린다**

```bash
npm run type-check
npx jest --maxWorkers=2
cd apps/admin-web && npx tsc --noEmit
```
Expected: 셋 다 0. 하나라도 빨가면 여기서 멈추고 고친다 — CLAUDE.md 기준 「빨간 건 이 PR 이 만든 것」이다.

- [ ] **Step 2: 린트**

```bash
npm run lint
```
Expected: 에러 0 (auto-fix 로 바뀐 파일이 있으면 같이 커밋한다)

- [ ] **Step 3: §8-D 벽 ② 를 갱신한다**

`docs/local-e2e-environment.md` 의 「⛔ 벽 ②(규명 완료 · 이슈로 이관)」 절 제목과 본문을 바꾼다. `curl` 로 404 를 보이던 블록을 지우고 아래로 대체한다 (아래 4-백틱 블록의 **안쪽 내용만** 붙여넣는다):

````markdown
### 🟢 (해결) 벽 ② — `POST /inventory-matching` 은 애초에 없었고, 이제 필요 없다

라우트가 「사라진」 게 아니라 **처음부터 백엔드가 없었다.** 프론트가 PIM/WMS 분리 시절에
먼저 만들어졌고 그 뒤 core 통합이 반영되지 않았다. 2026-09-06 에 **기존 `resolve`/`upsert` 를
넓혀** 해결했다(이슈 [#791](https://github.com/LCNINE/almondyoung-server/issues/791)).

auto 탭은 이제 SKU 생성과 매칭을 **한 호출**로 한다:

```jsonc
PATCH /matchings/:id/resolve      // 매칭이 pending 일 때
PUT   /matchings/:variantId       // 이미 matched 일 때
{ "links": [ { "newSku": { "name": "S / 검정", "holderId": "…", "supplierIds": ["…"] }, "quantity": 1 } ] }
```

⚠️ **`newSku` 를 쓰려면 `inventory.manage` 스코프가 필요하다.** 없으면 403 이다 —
`POST /inventory/skus` 와 같은 기준이다. `admin`/`master` 는 보유한다.

⚠️ 화면에서 「상품 구분 · 용도 · 수입상고필증 · 원가 · 메모1 · 메모4 · 물류처」가 사라졌다.
core 에 대응 컬럼이 없어 받아도 버려지던 것들이다. 원가는 발주 도메인이,
창고는 입고 단계가 정한다.

⚠️ 같은 화면의 `GET /variants/:id` **400 은 별개이고, 라우트 부재가 아니다.** core 에 라우트는 있고
(`product-variants.controller.ts:147`) `versionId` 또는 `masterId` 중 하나가 **필수 쿼리**인데
호출자가 안 보내서 나는 400 이다.
````

`docs/local-e2e-environment.md` 안의 「⛔ 남은 벽 둘」·§10 복붙 프롬프트에서 이 항목을 참조하는 줄도 「하나」로 고친다 (`grep -n "남은 벽\|남은 칸" docs/local-e2e-environment.md` 로 찾는다).

- [ ] **Step 4: 커밋하고 푸시한다**

```bash
git add docs/local-e2e-environment.md
git commit -m "docs(e2e): §8-D 벽 ② 해결 반영 — links[].newSku 로 한 호출 (#791)"
git push -u origin fix/matching-auto-sku-composition
```

- [ ] **Step 5: PR 을 연다**

```bash
gh pr create --base develop --title "fix(matching): 「자동 SKU 구성 매칭」을 기존 resolve/upsert 로 복구 (#791)" --body "$(cat <<'BODY'
## 무엇을

어드민 매칭 다이얼로그의 auto 탭이 부르던 `POST /inventory-matching` 은 core 에 **한 번도 없었다.**
새 엔드포인트 대신 기존 `resolve`/`upsert` 의 링크 항목을 「기존 SKU 참조 또는 새로 만들 SKU 정의」로
넓혀, SKU 생성·링크·상태전이를 **한 트랜잭션**에 넣었다.

- 설계: `docs/superpowers/specs/2026-09-06-matching-auto-sku-composition-design.md`
- 계획: `docs/superpowers/plans/2026-09-06-matching-auto-sku-composition.md`

## 조사 중 나온 것 (이슈 본문에 없던 것)

- **뒷단이 둘이다** — `resolve`(pending) / `upsert`(matched). 둘 다 넓혀야 기능이 완성된다.
- 🔴 **`VariantMatchingStrategy.validate` 가 트랜잭션 밖을 읽었다.** 안 고치면 같은 tx 에서 만든 SKU 가
  안 보여 100% 400 이다. 회귀 방지 스펙을 붙였다.
- 🔴 **`matchings/*` 는 #716 스코프 커버리지 사각지대.** `POST /inventory/skus` 는 `inventory.manage` 를
  요구하는데 매칭 라우트는 표시가 없다. 그대로 얹으면 스코프 우회가 되므로,
  **`newSku` 가 payload 에 있을 때만** 그 스코프를 요구하는 가드를 뒀다.
- `createNewSkuForMatching` 은 호출자 0곳 → 삭제.
- 문서 §8-D 의 「prompt 라 자동화가 못 지난다」는 오진이었다 — 그 핸들러는 참조 0곳이고, 진범은 `alert()` 였다.

## 화면 변화

| 남음 | 사라짐 |
|---|---|
| 사입상품명 · 공급처 · 재고소유 · 수입신고필증 · 옵션상세명칭 · 상품설명 · MOQ · 메모2 · 메모3 | 원가 · 상품 구분 · 용도 · 수입상고필증 · 메모1 · 메모4 · 물류처 · 옵션 이미지 |
| **옵션행 「수량」 신설** | |

사라진 것들은 core 에 대응 컬럼이 0건이라 받아도 버려지던 값이다.

## 배포

- **마이그레이션 0건.**
- DTO 는 추가·완화만 하므로 옛 admin-web 이 안 깨진다. 권장 순서 `core → admin-web`.

## 검증

- `npm run type-check` 0
- `npx jest --maxWorkers=2` 실패 0
- `cd apps/admin-web && npx tsc --noEmit` 0

Closes #791

https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
BODY
)"
```

- [ ] **Step 6: 이슈에 결론을 남긴다**

```bash
gh issue comment 791 --body "PR 을 열었다. 남은 결정 3건은 다음으로 확정: (1) resolve/upsert 를 공유 link 타입으로 둘 다 넓힌다 (2) 갈 곳 없는 필드는 화면에서 뺀다 — core 모델을 넓히지 않는다 (3) 「물류처」는 삭제하고 창고는 입고에서 정한다. 조사 중 추가로 나온 것: validate 가 트랜잭션 밖을 읽고 있어 그대로 두면 100% 400 이었고, matchings/* 가 #716 스코프 커버리지 사각지대라 newSku 조건부 가드를 뒀다. matchings 15개 라우트 전체의 스코프 판정은 별도 이슈로 남긴다."
```

---

## 후속으로 남기는 것 (이 PR 아님)

1. **`matchings/*` 15개 라우트의 스코프 판정** — `inventory-scope-coverage.spec.ts` 는 `modules/inventory` 전용이다. 범위를 넓히면 전 라우트에 스코프 배정이 필요하다. 새 이슈로.
2. **`seed-core-local.ts` 에 공급처·재고소유 시드** — 새 DB 는 `suppliers` 0행이라 auto 탭 필수값을 못 채운다 (`docs/local-e2e-environment.md` §8-D 벽 ①).
3. **옵션 이미지 업로드** — 배관(`upload.client.ts`·`image-compress.ts`)은 있으나 SKU 이미지를 올리는 화면이 아직 하나도 없다.
