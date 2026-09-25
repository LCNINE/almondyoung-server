# 배송 프로필 관리 + 새 SKU 프로필 필수화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배송 프로필을 만들고 고칠 수 있게 하고(core API + admin-web 화면), 앞으로 만들어지는 physical·consignment SKU 는 프로필 없이는 만들 수 없게 한다.

**Architecture:** core 에 `inventory/delivery-profile` 모듈(Controller → Service → Reader/Manager)을 창고 모듈과 같은 모양으로 신설한다. SKU 규칙은 순수 함수 하나(`deliveryProfileViolation`)로 두고 `SkuCatalogManager.create/update` 가 트랜잭션 안에서 부른다 — 매칭의 「새 SKU」도 같은 경로를 탄다. admin-web 은 새 화면 1개 + SKU 폼 + 매칭 자동 탭에 선택기를 붙이고, 판정은 전부 `.ts` 순수 함수로 뺀다.

**Tech Stack:** NestJS 11 · drizzle-orm(postgres.js) · class-validator/class-transformer · Jest(ts-jest) · Next.js(admin-web) · TanStack Query

**Spec:** `docs/superpowers/specs/2026-09-26-delivery-profile-management-design.md`

## Global Constraints

- 마이그레이션 0건 — `delivery_profiles`·`skus.delivery_profile_id` 는 이미 있다. `schema.ts` 를 고치지 않는다
- 필수 대상 재고 유형: `physical`, `consignment` (정확히 이 둘)
- 에러 코드: `SKU_DELIVERY_PROFILE_REQUIRED`(400), `SKU_DELIVERY_PROFILE_NOT_FOUND`(400)
- 수정 규칙은 «값 변화» 기준 — 요청에 키가 있다는 것만으로 검사하지 않는다(스펙 §4.2)
- 스코프: 읽기 `INVENTORY_SCOPE.OPERATE`, 쓰기 `INVENTORY_SCOPE.MANAGE` — `inventory-scopes.ts` 매핑 변경 없음
- 저장 jsonb 키: `sender_snapshot={name,phone}`, 주소 `={postalCode,roadAddress,detailAddress}`, 반품지는 `+phone?`
- inventory 쿼리 규칙: `db.query.*`·`with` 금지, `trx.select().from()…` 만. `any` 금지
- 중첩 DTO 는 별도 클래스 + `@ValidateNested()` + `@Type(() => X)` (전역 파이프가 `whitelist: true` 라 없으면 조용히 벗겨진다)
- 트랜잭션: public 메서드는 마지막 인자 `tx?: DbTx`, `this.dbService.run(fn, tx)` 만 쓴다(ADR-0025)
- `SkuCatalogManager` 생성자 시그니처(`dbService, reader`)를 바꾸지 않는다 — 통합 스펙·시드 7곳이 직접 조립한다
- admin-web 은 컴포넌트 테스트 불가 — 판정 로직은 `.ts` 로 빼서 `npm run test:admin-web` 으로 검증
- 통합 스펙은 `describeIfDb` 가드. 스펙 안에서 `dotenv.config()` 금지
- 커밋 메시지 끝: `Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS`

## Review Focus

1. **프로필 없는 옛 SKU 의 이름만 수정** — admin-web 폼은 `stockType` 을 항상 보낸다. 400 이 나면 안 된다 → Task 2 통합 스펙 `이름만 바꾸면 옛 SKU 도 통과` + Task 1 매트릭스
2. **존재하지 않는 `deliveryProfileId`** — 지금은 FK 위반 500. 400 `SKU_DELIVERY_PROFILE_NOT_FOUND` 여야 한다 → Task 2 `없는 프로필 id 는 400`
3. **옛 모양 스냅샷(`{ address: '…' }`) 이 들어 있는 프로필 조회** — 데모 시드·픽스처 모양. 목록 API 가 죽으면 안 된다 → Task 3 매퍼 스펙 `옛 모양도 빈 문자열로 정규화`
4. **`PATCH` 로 필수 필드를 빈 문자열로 보냄** — 완전한 프로필이 불완전해지면 계획 확정이 다시 막힌다 → Task 3 DTO 스펙 `Update 도 빈 발송인 이름을 거부`
5. **매칭 자동 탭에서 프로필을 안 고르고 저장** — 서버 400 전에 화면이 막아야 한다 → Task 8 `buildMatchingLinks` 스펙 `프로필 없으면 missing-required`

---

## File Structure

core (`apps/core/src/modules/inventory/`)
- Create `sku-catalog/sku-delivery-profile.rule.ts` — 필수 판정 순수 함수
- Create `sku-catalog/sku-delivery-profile.rule.spec.ts`
- Create `sku-catalog/sku-catalog.errors.ts` — 에러 클래스 2개
- Modify `sku-catalog/services/sku-catalog.manager.ts` — create/update 에 규칙 연결
- Create `sku-catalog/services/sku-catalog.manager.delivery-profile.integration.spec.ts`
- Create `delivery-profile/dto/delivery-profile-address.dto.ts` — 중첩 DTO 3개
- Create `delivery-profile/dto/create-delivery-profile.dto.ts`, `update-delivery-profile.dto.ts`, `delivery-profile.dto.ts`(응답)
- Create `delivery-profile/dto/create-delivery-profile.dto.spec.ts`
- Create `delivery-profile/mappers/delivery-profile.mapper.ts` + `.spec.ts`
- Create `delivery-profile/services/delivery-profile.reader.ts`, `delivery-profile.manager.ts`, `delivery-profile.service.ts`
- Create `delivery-profile/services/delivery-profile.manager.integration.spec.ts`
- Create `delivery-profile/controllers/delivery-profile.controller.ts`
- Create `delivery-profile/delivery-profile.module.ts`
- Modify `inventory.module.ts` — 모듈 등록
- Modify `scripts/sellmate/import-products.ts` — 머리 주석 한 줄
- Modify `scripts/qa/seed-qa7-dev.ts` — 프로필 id 를 env 로 받게

admin-web (`apps/admin-web/src/`)
- Modify `lib/types/dto/inventory.ts` — 프로필 타입
- Create `lib/api/domains/inventory/delivery-profiles.client.ts`
- Modify `lib/services/inventory/query-keys.ts`, `queries.ts`, `mutations.ts`
- Create `features/inventory/delivery-profiles/lib/profile-form.ts` + `.spec.ts`
- Create `features/inventory/delivery-profiles/template/index.tsx`
- Create `features/inventory/delivery-profiles/components/table/index.tsx`
- Create `features/inventory/delivery-profiles/components/profile-dialog/index.tsx`
- Create `app/(admin)/inventory/delivery-profiles/page.tsx`
- Modify `lib/utils/menu.ts`
- Create `features/inventory/skus/lib/delivery-profile-requirement.ts` + `.spec.ts`
- Modify `features/inventory/skus/components/sku-form-dialog/index.tsx`
- Modify `features/order/matching/lib/build-matching-links.ts` + `.spec.ts`
- Modify `features/order/matching/components/table/InventoryMatchingDialog.tsx`

---

### Task 1: SKU 프로필 필수 규칙 (순수 함수 + 에러)

**Files:**
- Create: `apps/core/src/modules/inventory/sku-catalog/sku-delivery-profile.rule.ts`
- Create: `apps/core/src/modules/inventory/sku-catalog/sku-catalog.errors.ts`
- Test: `apps/core/src/modules/inventory/sku-catalog/sku-delivery-profile.rule.spec.ts`

**Interfaces:**
- Produces:
  - `type SkuStockType = (typeof stockTypeEnum.enumValues)[number]`
  - `requiresDeliveryProfile(stockType: SkuStockType): boolean`
  - `interface SkuProfileState { stockType: SkuStockType; deliveryProfileId: string | null }`
  - `deliveryProfileViolation(before: SkuProfileState | null, after: SkuProfileState): 'SKU_DELIVERY_PROFILE_REQUIRED' | null`
  - `class SkuDeliveryProfileRequiredError extends ApplicationException` (code `SKU_DELIVERY_PROFILE_REQUIRED`, 400)
  - `class SkuDeliveryProfileNotFoundError extends ApplicationException` (code `SKU_DELIVERY_PROFILE_NOT_FOUND`, 400)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// apps/core/src/modules/inventory/sku-catalog/sku-delivery-profile.rule.spec.ts
import { deliveryProfileViolation, requiresDeliveryProfile, type SkuProfileState } from './sku-delivery-profile.rule';
import { SkuDeliveryProfileNotFoundError, SkuDeliveryProfileRequiredError } from './sku-catalog.errors';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const s = (stockType: SkuProfileState['stockType'], deliveryProfileId: string | null): SkuProfileState => ({
  stockType,
  deliveryProfileId,
});

describe('requiresDeliveryProfile', () => {
  it.each([
    ['physical', true],
    ['consignment', true],
    ['drop_shipped', false],
    ['infinite', false],
  ] as const)('%s → %s', (stockType, expected) => {
    expect(requiresDeliveryProfile(stockType)).toBe(expected);
  });
});

describe('deliveryProfileViolation — 생성(before=null)', () => {
  it('physical·consignment 는 프로필 없으면 위반', () => {
    expect(deliveryProfileViolation(null, s('physical', null))).toBe('SKU_DELIVERY_PROFILE_REQUIRED');
    expect(deliveryProfileViolation(null, s('consignment', null))).toBe('SKU_DELIVERY_PROFILE_REQUIRED');
  });
  it('프로필이 있으면 통과', () => {
    expect(deliveryProfileViolation(null, s('physical', P1))).toBeNull();
  });
  it('drop_shipped·infinite 는 프로필 없어도 통과', () => {
    expect(deliveryProfileViolation(null, s('drop_shipped', null))).toBeNull();
    expect(deliveryProfileViolation(null, s('infinite', null))).toBeNull();
  });
});

describe('deliveryProfileViolation — 수정(값 변화 기준)', () => {
  // admin-web 수정 폼은 stockType 을 항상 보낸다. 값이 그대로면 옛 SKU 도 통과해야 한다.
  it('재고 유형·프로필이 그대로면 프로필 없는 옛 physical SKU 도 통과', () => {
    expect(deliveryProfileViolation(s('physical', null), s('physical', null))).toBeNull();
  });
  it('physical SKU 의 프로필을 지우면 위반', () => {
    expect(deliveryProfileViolation(s('physical', P1), s('physical', null))).toBe('SKU_DELIVERY_PROFILE_REQUIRED');
  });
  it('drop_shipped → physical 로 바꾸면서 프로필 없으면 위반', () => {
    expect(deliveryProfileViolation(s('drop_shipped', null), s('physical', null))).toBe(
      'SKU_DELIVERY_PROFILE_REQUIRED',
    );
  });
  it('drop_shipped → physical 로 바꾸면서 프로필을 주면 통과', () => {
    expect(deliveryProfileViolation(s('drop_shipped', null), s('physical', P1))).toBeNull();
  });
  it('프로필을 다른 것으로 바꾸는 건 통과', () => {
    expect(deliveryProfileViolation(s('physical', P1), s('physical', P2))).toBeNull();
  });
  it('physical → drop_shipped 로 바꾸며 프로필을 지우는 건 통과', () => {
    expect(deliveryProfileViolation(s('physical', P1), s('drop_shipped', null))).toBeNull();
  });
});

describe('에러', () => {
  it('코드와 상태', () => {
    const required = new SkuDeliveryProfileRequiredError('x');
    expect(required.getErrorCode()).toBe('SKU_DELIVERY_PROFILE_REQUIRED');
    expect(required.getHttpStatus()).toBe(400);
    const notFound = new SkuDeliveryProfileNotFoundError('x');
    expect(notFound.getErrorCode()).toBe('SKU_DELIVERY_PROFILE_NOT_FOUND');
    expect(notFound.getHttpStatus()).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/sku-catalog/sku-delivery-profile.rule.spec.ts`
Expected: FAIL — `Cannot find module './sku-delivery-profile.rule'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/sku-catalog/sku-delivery-profile.rule.ts
import { stockTypeEnum } from '../schema/inventory.schema';

export type SkuStockType = (typeof stockTypeEnum.enumValues)[number];

/**
 * 배송 프로필이 필수인 재고 유형. 우리 창고(또는 3PL)에서 실물로 출고되는 유형만이다 —
 * 계획 확정(`shipment-planning.service.ts` assertPlanProfile)이 SKU 의 프로필을 요구하기 때문.
 * drop_shipped 는 V2 출고 대상이 아니고 infinite 는 실물이 없다.
 */
export const DELIVERY_PROFILE_REQUIRED_STOCK_TYPES: readonly SkuStockType[] = ['physical', 'consignment'];

export function requiresDeliveryProfile(stockType: SkuStockType): boolean {
  return DELIVERY_PROFILE_REQUIRED_STOCK_TYPES.includes(stockType);
}

export interface SkuProfileState {
  stockType: SkuStockType;
  deliveryProfileId: string | null;
}

/**
 * 생성(before=null)은 항상, 수정은 재고 유형이나 프로필 «값»이 바뀌었을 때만 판정한다.
 * 키 존재로 판정하지 않는 이유: admin-web 수정 폼이 stockType 을 매번 보내서, 그러면 프로필 없는
 * 옛 SKU(라이브 대부분)의 이름만 고쳐도 막힌다 (스펙 §4.2).
 */
export function deliveryProfileViolation(
  before: SkuProfileState | null,
  after: SkuProfileState,
): 'SKU_DELIVERY_PROFILE_REQUIRED' | null {
  if (before) {
    const changed = before.stockType !== after.stockType || before.deliveryProfileId !== after.deliveryProfileId;
    if (!changed) return null;
  }
  return requiresDeliveryProfile(after.stockType) && !after.deliveryProfileId ? 'SKU_DELIVERY_PROFILE_REQUIRED' : null;
}
```

```ts
// apps/core/src/modules/inventory/sku-catalog/sku-catalog.errors.ts
import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '@app/shared';

/** physical·consignment SKU 에 배송 프로필이 없다. 전역 필터가 코드를 응답 `error` 로 내보낸다. */
export class SkuDeliveryProfileRequiredError extends ApplicationException {
  getErrorCode(): string {
    return 'SKU_DELIVERY_PROFILE_REQUIRED';
  }
  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}

/** 존재하지 않는 배송 프로필 id. 검사하지 않으면 FK 위반이 500 으로 샌다. */
export class SkuDeliveryProfileNotFoundError extends ApplicationException {
  getErrorCode(): string {
    return 'SKU_DELIVERY_PROFILE_NOT_FOUND';
  }
  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/sku-catalog/sku-delivery-profile.rule.spec.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/sku-catalog/sku-delivery-profile.rule.ts \
        apps/core/src/modules/inventory/sku-catalog/sku-delivery-profile.rule.spec.ts \
        apps/core/src/modules/inventory/sku-catalog/sku-catalog.errors.ts
git commit -m "feat(core): SKU 배송 프로필 필수 규칙 순수 함수 (#923)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 2: `SkuCatalogManager` 에 규칙 연결

**Files:**
- Modify: `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager.ts` (`create` 21-64행, `update` 67-111행)
- Test: `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager.delivery-profile.integration.spec.ts`
- Modify: `scripts/sellmate/import-products.ts` (머리 주석), `scripts/qa/seed-qa7-dev.ts:129`

**Interfaces:**
- Consumes: Task 1 의 `deliveryProfileViolation`, `SkuStockType`, 에러 2개
- Produces: `create`/`update` 시그니처는 그대로. 위반 시 위 에러를 던진다. update 는 대상 SKU 가 없으면 `NotFoundError`

- [ ] **Step 1: 실패하는 통합 테스트 작성**

```ts
// apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager.delivery-profile.integration.spec.ts
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder } from '../../../fulfillment/services/__support__';
import { SkuCatalogReader } from './sku-catalog.reader';
import { SkuCatalogManager } from './sku-catalog.manager';
import { SkuCatalogService } from './sku-catalog.service';
import { MatchingLinkResolver } from '../../../product-matching/services/matching-link-resolver';
import { SkuDeliveryProfileNotFoundError, SkuDeliveryProfileRequiredError } from '../sku-catalog.errors';

/**
 * 새 SKU 배송 프로필 필수화 (스펙 §4). 실행:
 * COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'sku-catalog\.manager\.delivery-profile\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const MISSING_PROFILE = '99999999-9999-4999-8999-999999999999';

describeIfDb('SkuCatalogManager × 배송 프로필 필수 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx): { manager: SkuCatalogManager; service: SkuCatalogService } {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    const reader = new SkuCatalogReader(dbService);
    const manager = new SkuCatalogManager(dbService, reader);
    return { manager, service: new SkuCatalogService(reader, manager) };
  }

  async function seedProfile(trx: DbTx): Promise<string> {
    const [row] = await trx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `it-profile-${Date.now()}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'S', phone: '02-0000-0000' },
        originAddressSnapshot: { postalCode: '14521', roadAddress: 'R', detailAddress: '' },
        returnAddressSnapshot: { postalCode: '14521', roadAddress: 'R', detailAddress: '' },
        carrierAccountRef: 'it',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    return row.id;
  }

  async function seedLegacySku(trx: DbTx, holderId: string): Promise<string> {
    // 라이브 옛 SKU 모양: physical 인데 프로필 없음 (규칙 이전에 만들어진 행)
    const [row] = await trx
      .insert(wmsTables.skus)
      .values({ name: 'legacy', code: `IT-LEGACY-${Date.now()}`, holderId, stockType: 'physical' })
      .returning();
    return row.id;
  }

  it('physical SKU 를 프로필 없이 만들면 SKU_DELIVERY_PROFILE_REQUIRED', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      await expect(build(trx).manager.create({ name: 'p', holderId }, trx)).rejects.toBeInstanceOf(
        SkuDeliveryProfileRequiredError,
      );
    });
  });

  it('프로필을 주면 만들어진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const profileId = await seedProfile(trx);
      const sku = await build(trx).manager.create({ name: 'p', holderId, deliveryProfileId: profileId }, trx);
      expect(sku.deliveryProfileId).toBe(profileId);
    });
  });

  it('drop_shipped 는 프로필 없이 만들어진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const sku = await build(trx).manager.create({ name: 'd', holderId, stockType: 'drop_shipped' }, trx);
      expect(sku.deliveryProfileId ?? null).toBeNull();
    });
  });

  it('없는 프로필 id 는 400 SKU_DELIVERY_PROFILE_NOT_FOUND (FK 500 이 아니라)', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      await expect(
        build(trx).manager.create({ name: 'p', holderId, deliveryProfileId: MISSING_PROFILE }, trx),
      ).rejects.toBeInstanceOf(SkuDeliveryProfileNotFoundError);
    });
  });

  it('이름만 바꾸면 옛 SKU 도 통과 (stockType 을 같은 값으로 함께 보내도)', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const skuId = await seedLegacySku(trx, holderId);
      const sku = await build(trx).manager.update(skuId, { name: 'renamed', stockType: 'physical' }, trx);
      expect(sku.name).toBe('renamed');
    });
  });

  it('프로필을 null 로 지우면 거부', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const profileId = await seedProfile(trx);
      const { manager } = build(trx);
      const sku = await manager.create({ name: 'p', holderId, deliveryProfileId: profileId }, trx);
      // UpdateSkuDto 타입은 string 뿐이지만 HTTP 로는 null(지움)이 들어온다 — 그 런타임 입력을 재현하는 캐스트
      await expect(
        manager.update(sku.id, { deliveryProfileId: null as unknown as string }, trx),
      ).rejects.toBeInstanceOf(SkuDeliveryProfileRequiredError);
    });
  });

  it('drop_shipped → physical 전환은 프로필이 있어야 한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const profileId = await seedProfile(trx);
      const { manager } = build(trx);
      const sku = await manager.create({ name: 'd', holderId, stockType: 'drop_shipped' }, trx);
      await expect(manager.update(sku.id, { stockType: 'physical' }, trx)).rejects.toBeInstanceOf(
        SkuDeliveryProfileRequiredError,
      );
      const ok = await manager.update(sku.id, { stockType: 'physical', deliveryProfileId: profileId }, trx);
      expect(ok.deliveryProfileId).toBe(profileId);
    });
  });

  it('옛 SKU 에 프로필을 붙이는 건 통과 (건별 백필 경로)', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const skuId = await seedLegacySku(trx, holderId);
      const profileId = await seedProfile(trx);
      const sku = await build(trx).manager.update(skuId, { deliveryProfileId: profileId }, trx);
      expect(sku.deliveryProfileId).toBe(profileId);
    });
  });

  it('매칭의 새 SKU 경로도 같은 규칙을 탄다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const resolver = new MatchingLinkResolver(build(trx).service);
      await expect(resolver.resolve([{ newSku: { name: 'm', holderId } }], trx)).rejects.toBeInstanceOf(
        SkuDeliveryProfileRequiredError,
      );
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'sku-catalog\.manager\.delivery-profile\.integration\.spec\.ts$'`
Expected: FAIL — 첫 테스트가 reject 대신 SKU 를 반환, 없는 프로필 테스트는 FK 에러(`DrizzleQueryError`)
(DB 가 없으면 `describe.skip` 이라 초록으로 보인다 — 반드시 로컬 postgres 5432 를 띄우고 돌린다)

- [ ] **Step 3: 구현** — `sku-catalog.manager.ts`

import 추가:

```ts
import { NotFoundError } from '@app/shared';
import { deliveryProfileViolation, type SkuProfileState } from '../sku-delivery-profile.rule';
import { SkuDeliveryProfileNotFoundError, SkuDeliveryProfileRequiredError } from '../sku-catalog.errors';
```

(`BadRequestError, ConflictError, NotFoundError` 를 이미 import 하고 있으면 `NotFoundError` 는 중복 추가하지 않는다.)

클래스에 private 헬퍼 2개 추가:

```ts
  /** 규칙 위반이면 던진다. 프로필 id 가 있으면 존재부터 확인한다 — 없으면 FK 위반이 500 이 된다. */
  private async assertDeliveryProfile(
    trx: DbTx,
    skuName: string,
    before: SkuProfileState | null,
    after: SkuProfileState,
  ): Promise<void> {
    if (after.deliveryProfileId && after.deliveryProfileId !== before?.deliveryProfileId) {
      const [profile] = await trx
        .select({ id: wmsTables.deliveryProfiles.id })
        .from(wmsTables.deliveryProfiles)
        .where(eq(wmsTables.deliveryProfiles.id, after.deliveryProfileId))
        .limit(1);
      if (!profile) {
        throw new SkuDeliveryProfileNotFoundError(`배송 프로필을 찾을 수 없습니다: ${after.deliveryProfileId}`);
      }
    }
    if (deliveryProfileViolation(before, after)) {
      throw new SkuDeliveryProfileRequiredError(
        `재고 유형 ${after.stockType} 인 SKU(${skuName})는 배송 프로필이 필요합니다`,
      );
    }
  }

  private async loadProfileState(trx: DbTx, skuId: string): Promise<SkuProfileState & { name: string }> {
    const [row] = await trx
      .select({
        name: wmsTables.skus.name,
        stockType: wmsTables.skus.stockType,
        deliveryProfileId: wmsTables.skus.deliveryProfileId,
      })
      .from(wmsTables.skus)
      .where(eq(wmsTables.skus.id, skuId))
      .for('update');
    if (!row) throw new NotFoundError(`SKU not found: ${skuId}`);
    return row;
  }
```

`create` 의 `.insert(wmsTables.skus)` 바로 앞(구조분해 다음 줄)에:

```ts
      await this.assertDeliveryProfile(trx, skuData.name, null, {
        // 컬럼 DEFAULT 와 같은 기본값 — 안 보내면 physical 로 들어간다
        stockType: skuData.stockType ?? 'physical',
        deliveryProfileId: skuData.deliveryProfileId ?? null,
      });
```

`update` 의 `const skuUpdatePayload = …` 바로 앞에:

```ts
      const before = await this.loadProfileState(trx, skuId);
      await this.assertDeliveryProfile(trx, updateData.name ?? before.name, before, {
        stockType: updateData.stockType ?? before.stockType,
        // undefined = 안 건드림, null = 지움
        deliveryProfileId: updateData.deliveryProfileId === undefined ? before.deliveryProfileId : updateData.deliveryProfileId,
      });
```

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'sku-catalog\.manager\.delivery-profile\.integration\.spec\.ts$'`
Expected: PASS (9 tests)

- [ ] **Step 5: 규칙을 우회하는 경로 두 곳 표시**

`scripts/sellmate/import-products.ts` 머리 JSDoc 끝에 한 줄:

```ts
 * ⚠️ 원시 SQL 로 skus 에 넣으므로 배송 프로필 필수 규칙(SkuCatalogManager, #923)을 우회한다 — 셀메이트 폐기와 함께 사라질 경로.
```

`scripts/qa/seed-qa7-dev.ts:129` 를:

```ts
        const sku = await skuCatalog.create(
          { name: spec.name, stockType: 'physical', deliveryProfileId: requireEnv('QA_DELIVERY_PROFILE_ID') } as never,
          tx,
        );
```

같은 파일에 `requireEnv` 가 없으면 파일 상단에 추가:

```ts
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} 가 필요하다 — physical SKU 는 배송 프로필 없이 만들 수 없다(#923)`);
  return value;
}
```

- [ ] **Step 6: 기존 스펙 회귀 확인 + 커밋**

Run: `npx jest apps/core/src/modules/inventory apps/core/src/modules/product-matching`
Expected: PASS (DB 없는 기본 실행 — 통합 스펙은 skip)

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'inventory/core/(controllers|services)/.*integration\.spec\.ts$'`
Expected: 이 브랜치 이전과 같은 결과(이 스펙들은 SKU 를 `create` 로 만들지 않는다 — 입고용 `findById` 조립뿐)

```bash
git add apps/core/src/modules/inventory/sku-catalog scripts/sellmate/import-products.ts scripts/qa/seed-qa7-dev.ts
git commit -m "feat(core): physical·consignment SKU 생성·전환에 배송 프로필을 요구한다 (#923)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 3: 배송 프로필 DTO + 매퍼

**Files:**
- Create: `apps/core/src/modules/inventory/delivery-profile/dto/delivery-profile-address.dto.ts`
- Create: `apps/core/src/modules/inventory/delivery-profile/dto/create-delivery-profile.dto.ts`
- Create: `apps/core/src/modules/inventory/delivery-profile/dto/update-delivery-profile.dto.ts`
- Create: `apps/core/src/modules/inventory/delivery-profile/dto/delivery-profile.dto.ts`
- Create: `apps/core/src/modules/inventory/delivery-profile/mappers/delivery-profile.mapper.ts`
- Test: `apps/core/src/modules/inventory/delivery-profile/dto/create-delivery-profile.dto.spec.ts`
- Test: `apps/core/src/modules/inventory/delivery-profile/mappers/delivery-profile.mapper.spec.ts`

**Interfaces:**
- Produces:
  - `DeliveryProfileSenderDto { name: string; phone: string }`
  - `DeliveryProfileAddressDto { postalCode: string; roadAddress: string; detailAddress: string }`
  - `DeliveryProfileReturnAddressDto extends DeliveryProfileAddressDto { phone?: string }`
  - `CreateDeliveryProfileDto { name; sourceType; avgDeliveryDays?; sender; originAddress; returnAddress; carrierAccountRef; supportedFulfillmentModes }`
  - `UpdateDeliveryProfileDto = PartialType(CreateDeliveryProfileDto)`
  - `DeliveryProfileDto` (응답, `skuCount?: number`)
  - `DeliveryProfileMapper.toDto(row: DeliveryProfile, skuCount?: number): DeliveryProfileDto`
  - `DeliveryProfileMapper.toColumns(dto: Partial<CreateDeliveryProfileDto>)` — DTO → 테이블 컬럼(보낸 필드만)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// apps/core/src/modules/inventory/delivery-profile/dto/create-delivery-profile.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDeliveryProfileDto } from './create-delivery-profile.dto';
import { UpdateDeliveryProfileDto } from './update-delivery-profile.dto';

const valid = {
  name: '부천 자사 출고',
  sourceType: 'in_house',
  sender: { name: '엘씨나인', phone: '1877-7184' },
  originAddress: { postalCode: '14521', roadAddress: '경기도 부천시 평천로832번길 42', detailAddress: '4층' },
  returnAddress: { postalCode: '14521', roadAddress: '경기도 부천시 평천로832번길 42', detailAddress: '4층' },
  carrierAccountRef: 'HANJIN',
  supportedFulfillmentModes: ['in_house'],
};

async function errorsOf(cls: typeof CreateDeliveryProfileDto | typeof UpdateDeliveryProfileDto, body: object) {
  const errors = await validate(plainToInstance(cls, body), { whitelist: true });
  return errors.map((e) => e.property);
}

describe('CreateDeliveryProfileDto', () => {
  it('완전한 입력을 받는다', async () => {
    expect(await errorsOf(CreateDeliveryProfileDto, valid)).toEqual([]);
  });
  it('detailAddress 는 빈 문자열을 허용한다', async () => {
    expect(
      await errorsOf(CreateDeliveryProfileDto, { ...valid, originAddress: { ...valid.originAddress, detailAddress: '' } }),
    ).toEqual([]);
  });
  it.each(['name', 'sourceType', 'sender', 'originAddress', 'returnAddress', 'carrierAccountRef', 'supportedFulfillmentModes'])(
    '%s 가 없으면 거부',
    async (key) => {
      const body: Record<string, unknown> = { ...valid };
      delete body[key];
      expect(await errorsOf(CreateDeliveryProfileDto, body)).toContain(key);
    },
  );
  it('공백뿐인 발송인 이름·전화·계약번호를 거부', async () => {
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, sender: { name: '  ', phone: '1' } })).toContain('sender');
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, sender: { name: 'a', phone: ' ' } })).toContain('sender');
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, carrierAccountRef: '   ' })).toContain('carrierAccountRef');
  });
  it('주소 postalCode·roadAddress 가 비면 거부', async () => {
    expect(
      await errorsOf(CreateDeliveryProfileDto, { ...valid, originAddress: { ...valid.originAddress, roadAddress: '' } }),
    ).toContain('originAddress');
  });
  it('이행 방식은 1개 이상·중복 없음·enum 값만', async () => {
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, supportedFulfillmentModes: [] })).toContain(
      'supportedFulfillmentModes',
    );
    expect(
      await errorsOf(CreateDeliveryProfileDto, { ...valid, supportedFulfillmentModes: ['in_house', 'in_house'] }),
    ).toContain('supportedFulfillmentModes');
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, supportedFulfillmentModes: ['courier'] })).toContain(
      'supportedFulfillmentModes',
    );
  });
  it('잘못된 sourceType 을 거부', async () => {
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, sourceType: 'partner' })).toContain('sourceType');
  });
});

describe('UpdateDeliveryProfileDto', () => {
  it('빈 객체를 받는다', async () => {
    expect(await errorsOf(UpdateDeliveryProfileDto, {})).toEqual([]);
  });
  // 완전한 프로필을 PATCH 로 불완전하게 만들면 계획 확정이 다시 막힌다
  it('보낸 중첩 객체는 통째로 검증한다 — 빈 발송인 이름을 거부', async () => {
    expect(await errorsOf(UpdateDeliveryProfileDto, { sender: { name: '', phone: '1' } })).toContain('sender');
  });
  it('빈 계약번호를 거부', async () => {
    expect(await errorsOf(UpdateDeliveryProfileDto, { carrierAccountRef: '' })).toContain('carrierAccountRef');
  });
});
```

```ts
// apps/core/src/modules/inventory/delivery-profile/mappers/delivery-profile.mapper.spec.ts
import type { DeliveryProfile } from '../../schema/inventory.schema';
import { DeliveryProfileMapper } from './delivery-profile.mapper';

function row(overrides: Partial<DeliveryProfile> = {}): DeliveryProfile {
  return {
    id: 'p1',
    name: 'n',
    sourceType: 'in_house',
    avgDeliveryDays: null,
    senderSnapshot: { name: 'S', phone: '02' },
    originAddressSnapshot: { postalCode: '1', roadAddress: 'R', detailAddress: 'D' },
    returnAddressSnapshot: { postalCode: '2', roadAddress: 'R2', detailAddress: '', phone: '010' },
    carrierAccountRef: 'C',
    supportedFulfillmentModes: ['in_house'],
    handlingFlags: null,
    createdAt: new Date('2026-09-26T00:00:00Z'),
    updatedAt: new Date('2026-09-26T00:00:00Z'),
    ...overrides,
  };
}

describe('DeliveryProfileMapper.toDto', () => {
  it('jsonb 스냅샷을 구조화 필드로 낸다', () => {
    const dto = DeliveryProfileMapper.toDto(row(), 3);
    expect(dto.sender).toEqual({ name: 'S', phone: '02' });
    expect(dto.originAddress).toEqual({ postalCode: '1', roadAddress: 'R', detailAddress: 'D' });
    expect(dto.returnAddress).toEqual({ postalCode: '2', roadAddress: 'R2', detailAddress: '', phone: '010' });
    expect(dto.skuCount).toBe(3);
    expect(dto.createdAt).toBe('2026-09-26T00:00:00.000Z');
  });
  // 데모 시드·픽스처의 옛 모양. 목록 API 가 죽으면 안 된다.
  it('옛 모양 스냅샷도 빈 문자열로 정규화한다', () => {
    const dto = DeliveryProfileMapper.toDto(
      row({ originAddressSnapshot: { address: 'Origin' }, returnAddressSnapshot: null, senderSnapshot: null, supportedFulfillmentModes: null }),
    );
    expect(dto.originAddress).toEqual({ postalCode: '', roadAddress: '', detailAddress: '' });
    expect(dto.returnAddress).toEqual({ postalCode: '', roadAddress: '', detailAddress: '' });
    expect(dto.sender).toEqual({ name: '', phone: '' });
    expect(dto.supportedFulfillmentModes).toEqual([]);
    expect(dto.skuCount).toBeUndefined();
  });
});

describe('DeliveryProfileMapper.toColumns', () => {
  it('DTO 를 테이블 컬럼으로 옮기고, 보내지 않은 필드는 만들지 않는다', () => {
    expect(DeliveryProfileMapper.toColumns({ name: 'x', sender: { name: 'a', phone: 'b' } })).toEqual({
      name: 'x',
      senderSnapshot: { name: 'a', phone: 'b' },
    });
  });
  it('반품지 phone 이 비면 저장하지 않는다', () => {
    expect(
      DeliveryProfileMapper.toColumns({ returnAddress: { postalCode: '1', roadAddress: 'R', detailAddress: '', phone: '' } }),
    ).toEqual({ returnAddressSnapshot: { postalCode: '1', roadAddress: 'R', detailAddress: '' } });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/delivery-profile`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/delivery-profile/dto/delivery-profile-address.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** 공백뿐인 값 거부 — `@IsNotEmpty` 는 ' ' 를 통과시킨다. 하류(assertProfileComplete)는 trim 후 판정한다. */
const NOT_BLANK = /\S/;

export class DeliveryProfileSenderDto {
  @ApiProperty({ description: '발송인 이름' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '발송인 전화번호' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(30)
  phone: string;
}

export class DeliveryProfileAddressDto {
  @ApiProperty({ description: '우편번호' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(10)
  postalCode: string;

  @ApiProperty({ description: '도로명 주소' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(255)
  roadAddress: string;

  @ApiProperty({ description: '상세 주소 (빈 문자열 허용)' })
  @IsString()
  @MaxLength(255)
  detailAddress: string;
}

export class DeliveryProfileReturnAddressDto extends DeliveryProfileAddressDto {
  @ApiProperty({ description: '반품지 연락처', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export { NOT_BLANK };
```

```ts
// apps/core/src/modules/inventory/delivery-profile/dto/create-delivery-profile.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { fulfillmentModeEnum, sourceTypeEnum } from '../../schema/inventory.schema';
import {
  DeliveryProfileAddressDto,
  DeliveryProfileReturnAddressDto,
  DeliveryProfileSenderDto,
  NOT_BLANK,
} from './delivery-profile-address.dto';

export type DeliveryProfileSourceType = (typeof sourceTypeEnum.enumValues)[number];
export type FulfillmentMode = (typeof fulfillmentModeEnum.enumValues)[number];

/**
 * 생성은 «완전한» 프로필만 받는다 — 계획 확정(assertPlanProfile)·배치 편입(assertProfileComplete)이
 * 요구하는 필드를 전부 필수로 둔다. 불완전한 프로필은 만들어 봐야 계획 확정에서 다시 막힌다.
 */
export class CreateDeliveryProfileDto {
  @ApiProperty({ description: '프로필 이름' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(128)
  name: string;

  @ApiProperty({ description: '원천 유형', enum: sourceTypeEnum.enumValues })
  @IsIn(sourceTypeEnum.enumValues)
  sourceType: DeliveryProfileSourceType;

  @ApiProperty({ description: '평균 배송일', required: false, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  avgDeliveryDays?: number;

  @ApiProperty({ description: '발송인', type: DeliveryProfileSenderDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryProfileSenderDto)
  sender: DeliveryProfileSenderDto;

  @ApiProperty({ description: '출고지', type: DeliveryProfileAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryProfileAddressDto)
  originAddress: DeliveryProfileAddressDto;

  @ApiProperty({ description: '반품지', type: DeliveryProfileReturnAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryProfileReturnAddressDto)
  returnAddress: DeliveryProfileReturnAddressDto;

  @ApiProperty({ description: '택배 계약번호(carrier_account_ref)' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(255)
  carrierAccountRef: string;

  @ApiProperty({ description: '지원 이행 방식', enum: fulfillmentModeEnum.enumValues, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(fulfillmentModeEnum.enumValues, { each: true })
  supportedFulfillmentModes: FulfillmentMode[];
}
```

```ts
// apps/core/src/modules/inventory/delivery-profile/dto/update-delivery-profile.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateDeliveryProfileDto } from './create-delivery-profile.dto';

/** 부분 수정. 중첩 객체는 보낼 때 통째로 보낸다 — 보낸 객체는 생성과 같은 규칙으로 전부 검증된다. */
export class UpdateDeliveryProfileDto extends PartialType(CreateDeliveryProfileDto) {}
```

```ts
// apps/core/src/modules/inventory/delivery-profile/dto/delivery-profile.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { fulfillmentModeEnum, sourceTypeEnum } from '../../schema/inventory.schema';
import {
  DeliveryProfileAddressDto,
  DeliveryProfileReturnAddressDto,
  DeliveryProfileSenderDto,
} from './delivery-profile-address.dto';
import type { DeliveryProfileSourceType, FulfillmentMode } from './create-delivery-profile.dto';

export class DeliveryProfileDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: sourceTypeEnum.enumValues }) sourceType: DeliveryProfileSourceType;
  @ApiProperty({ nullable: true }) avgDeliveryDays: number | null;
  @ApiProperty({ type: DeliveryProfileSenderDto }) sender: DeliveryProfileSenderDto;
  @ApiProperty({ type: DeliveryProfileAddressDto }) originAddress: DeliveryProfileAddressDto;
  @ApiProperty({ type: DeliveryProfileReturnAddressDto }) returnAddress: DeliveryProfileReturnAddressDto;
  @ApiProperty({ nullable: true }) carrierAccountRef: string | null;
  @ApiProperty({ enum: fulfillmentModeEnum.enumValues, isArray: true }) supportedFulfillmentModes: FulfillmentMode[];
  @ApiProperty({ required: false, description: '연결된(삭제되지 않은) SKU 수. 목록에서만 채운다' }) skuCount?: number;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
```

```ts
// apps/core/src/modules/inventory/delivery-profile/mappers/delivery-profile.mapper.ts
import type { DeliveryProfile } from '../../schema/inventory.schema';
import type { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import type { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import type { DeliveryProfileReturnAddressDto } from '../dto/delivery-profile-address.dto';

type NewColumns = Partial<Omit<DeliveryProfile, 'id' | 'createdAt' | 'updatedAt' | 'handlingFlags'>>;

/** jsonb 는 옛 모양(`{ address }`)·null 일 수 있다 — 모르는 키는 빈 문자열로. */
function text(source: unknown, key: string): string {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return '';
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export class DeliveryProfileMapper {
  static toDto(row: DeliveryProfile, skuCount?: number): DeliveryProfileDto {
    const returnPhone = text(row.returnAddressSnapshot, 'phone');
    return {
      id: row.id,
      name: row.name,
      sourceType: row.sourceType,
      avgDeliveryDays: row.avgDeliveryDays,
      sender: { name: text(row.senderSnapshot, 'name'), phone: text(row.senderSnapshot, 'phone') },
      originAddress: {
        postalCode: text(row.originAddressSnapshot, 'postalCode'),
        roadAddress: text(row.originAddressSnapshot, 'roadAddress'),
        detailAddress: text(row.originAddressSnapshot, 'detailAddress'),
      },
      returnAddress: {
        postalCode: text(row.returnAddressSnapshot, 'postalCode'),
        roadAddress: text(row.returnAddressSnapshot, 'roadAddress'),
        detailAddress: text(row.returnAddressSnapshot, 'detailAddress'),
        ...(returnPhone ? { phone: returnPhone } : {}),
      },
      carrierAccountRef: row.carrierAccountRef,
      supportedFulfillmentModes: row.supportedFulfillmentModes ?? [],
      ...(skuCount !== undefined ? { skuCount } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 보낸 필드만 컬럼으로 옮긴다 — PATCH 가 안 보낸 필드를 null 로 덮지 않게. */
  static toColumns(dto: Partial<CreateDeliveryProfileDto>): NewColumns {
    const columns: NewColumns = {};
    if (dto.name !== undefined) columns.name = dto.name.trim();
    if (dto.sourceType !== undefined) columns.sourceType = dto.sourceType;
    if (dto.avgDeliveryDays !== undefined) columns.avgDeliveryDays = dto.avgDeliveryDays;
    if (dto.sender !== undefined) columns.senderSnapshot = { name: dto.sender.name, phone: dto.sender.phone };
    if (dto.originAddress !== undefined) {
      const { postalCode, roadAddress, detailAddress } = dto.originAddress;
      columns.originAddressSnapshot = { postalCode, roadAddress, detailAddress };
    }
    if (dto.returnAddress !== undefined) columns.returnAddressSnapshot = returnSnapshot(dto.returnAddress);
    if (dto.carrierAccountRef !== undefined) columns.carrierAccountRef = dto.carrierAccountRef.trim();
    if (dto.supportedFulfillmentModes !== undefined) columns.supportedFulfillmentModes = dto.supportedFulfillmentModes;
    return columns;
  }
}

function returnSnapshot(address: DeliveryProfileReturnAddressDto): Record<string, string> {
  const { postalCode, roadAddress, detailAddress, phone } = address;
  return { postalCode, roadAddress, detailAddress, ...(phone?.trim() ? { phone } : {}) };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/delivery-profile`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/delivery-profile
git commit -m "feat(core): 배송 프로필 DTO·매퍼 (#923)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 4: 배송 프로필 API (Reader/Manager/Service/Controller/Module)

**Files:**
- Create: `apps/core/src/modules/inventory/delivery-profile/services/delivery-profile.reader.ts`
- Create: `apps/core/src/modules/inventory/delivery-profile/services/delivery-profile.manager.ts`
- Create: `apps/core/src/modules/inventory/delivery-profile/services/delivery-profile.service.ts`
- Create: `apps/core/src/modules/inventory/delivery-profile/controllers/delivery-profile.controller.ts`
- Create: `apps/core/src/modules/inventory/delivery-profile/delivery-profile.module.ts`
- Modify: `apps/core/src/modules/inventory/inventory.module.ts` (imports 배열 두 곳 — 29행 근처 `WarehouseModule` 다음, 45행 근처 exports 의 `WarehouseModule` 다음)
- Test: `apps/core/src/modules/inventory/delivery-profile/services/delivery-profile.manager.integration.spec.ts`

**Interfaces:**
- Consumes: Task 3 DTO·매퍼
- Produces (HTTP): `GET /inventory/delivery-profiles` → `DeliveryProfileDto[]`(skuCount 포함, 이름순) · `GET /:id` → `DeliveryProfileDto` · `POST` → 201 `DeliveryProfileDto` · `PATCH /:id` → `DeliveryProfileDto`

- [ ] **Step 1: 실패하는 통합 테스트 작성**

```ts
// apps/core/src/modules/inventory/delivery-profile/services/delivery-profile.manager.integration.spec.ts
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku } from '../../../fulfillment/services/__support__';
import { assertProfileComplete } from '../../../fulfillment/picking/plan/picking-plan.queries';
import { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import { DeliveryProfileReader } from './delivery-profile.reader';
import { DeliveryProfileManager } from './delivery-profile.manager';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'delivery-profile\.manager\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const input: CreateDeliveryProfileDto = {
  name: `it-부천-${Date.now()}`,
  sourceType: 'in_house',
  sender: { name: '엘씨나인', phone: '1877-7184' },
  originAddress: { postalCode: '14521', roadAddress: '부천시 평천로832번길 42', detailAddress: '4층' },
  returnAddress: { postalCode: '14521', roadAddress: '부천시 평천로832번길 42', detailAddress: '4층' },
  carrierAccountRef: 'HANJIN',
  supportedFulfillmentModes: ['in_house'],
};

describeIfDb('DeliveryProfileManager (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx): { reader: DeliveryProfileReader; manager: DeliveryProfileManager } {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    const reader = new DeliveryProfileReader(dbService);
    return { reader, manager: new DeliveryProfileManager(dbService, reader) };
  }

  // 이 API 로 만든 프로필은 계획 확정·배치 편입의 완전성 검사를 통과해야 한다 — 그게 이 기능의 목적이다.
  it('생성 결과가 assertProfileComplete 를 통과한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const created = await build(trx).manager.create(input, trx);
      const [row] = await trx
        .select()
        .from(wmsTables.deliveryProfiles)
        .where(eq(wmsTables.deliveryProfiles.id, created.id));
      expect(() => assertProfileComplete(row)).not.toThrow();
      expect(row.senderSnapshot).toEqual({ name: '엘씨나인', phone: '1877-7184' });
    });
  });

  it('목록은 삭제되지 않은 연결 SKU 수를 센다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const created = await manager.create(input, trx);
      const { holderId } = await seedHolder(trx);
      const a = await seedSku(trx, holderId);
      const b = await seedSku(trx, holderId);
      await trx.update(wmsTables.skus).set({ deliveryProfileId: created.id }).where(eq(wmsTables.skus.id, a.skuId));
      await trx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: created.id, isDeleted: true })
        .where(eq(wmsTables.skus.id, b.skuId));
      const listed = (await reader.findAll(trx)).find((p) => p.id === created.id);
      expect(listed?.skuCount).toBe(1);
    });
  });

  it('PATCH 는 보낸 필드만 바꾼다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { manager } = build(trx);
      const created = await manager.create(input, trx);
      const updated = await manager.update(created.id, { sender: { name: '3PL 센터', phone: '02-1111-2222' } }, trx);
      expect(updated.sender).toEqual({ name: '3PL 센터', phone: '02-1111-2222' });
      expect(updated.originAddress).toEqual(input.originAddress);
      expect(updated.carrierAccountRef).toBe('HANJIN');
    });
  });

  it('없는 id 조회·수정은 NotFoundError', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const missing = '99999999-9999-4999-8999-999999999999';
      await expect(reader.findOne(missing, trx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(manager.update(missing, { name: 'x' }, trx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'delivery-profile\.manager\.integration\.spec\.ts$'`
Expected: FAIL — `Cannot find module './delivery-profile.reader'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/delivery-profile/services/delivery-profile.reader.ts
import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import type { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import { DeliveryProfileMapper } from '../mappers/delivery-profile.mapper';

@Injectable()
export class DeliveryProfileReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async findAll(tx?: DbTx): Promise<DeliveryProfileDto[]> {
    const p = wmsTables.deliveryProfiles;
    const s = wmsTables.skus;
    const rows = await this.dbService.run(
      (trx) =>
        trx
          .select({ profile: p, skuCount: sql<number>`count(${s.id})::int` })
          .from(p)
          .leftJoin(s, and(eq(s.deliveryProfileId, p.id), eq(s.isDeleted, false)))
          .groupBy(p.id)
          .orderBy(asc(p.name)),
      tx,
    );
    return rows.map((r) => DeliveryProfileMapper.toDto(r.profile, r.skuCount));
  }

  async findOne(id: string, tx?: DbTx): Promise<DeliveryProfileDto> {
    const [row] = await this.dbService.run(
      (trx) => trx.select().from(wmsTables.deliveryProfiles).where(eq(wmsTables.deliveryProfiles.id, id)).limit(1),
      tx,
    );
    if (!row) throw new NotFoundError(`배송 프로필을 찾을 수 없습니다: ${id}`);
    return DeliveryProfileMapper.toDto(row);
  }
}
```

```ts
// apps/core/src/modules/inventory/delivery-profile/services/delivery-profile.manager.ts
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import { UpdateDeliveryProfileDto } from '../dto/update-delivery-profile.dto';
import type { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import { DeliveryProfileMapper } from '../mappers/delivery-profile.mapper';
import { DeliveryProfileReader } from './delivery-profile.reader';

@Injectable()
export class DeliveryProfileManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: DeliveryProfileReader,
  ) {}

  async create(dto: CreateDeliveryProfileDto, tx?: DbTx): Promise<DeliveryProfileDto> {
    return this.dbService.run(async (trx) => {
      const columns = DeliveryProfileMapper.toColumns(dto);
      const [row] = await trx
        .insert(wmsTables.deliveryProfiles)
        .values({ ...columns, name: dto.name.trim(), sourceType: dto.sourceType })
        .returning();
      if (!row) throw new Error('delivery_profiles insert returned no row');
      return DeliveryProfileMapper.toDto(row);
    }, tx);
  }

  async update(id: string, dto: UpdateDeliveryProfileDto, tx?: DbTx): Promise<DeliveryProfileDto> {
    return this.dbService.run(async (trx) => {
      const columns = DeliveryProfileMapper.toColumns(dto);
      const [row] = await trx
        .update(wmsTables.deliveryProfiles)
        .set({ ...columns, updatedAt: sql`now()` })
        .where(eq(wmsTables.deliveryProfiles.id, id))
        .returning();
      if (!row) throw new NotFoundError(`배송 프로필을 찾을 수 없습니다: ${id}`);
      return DeliveryProfileMapper.toDto(row);
    }, tx);
  }
}
```

```ts
// apps/core/src/modules/inventory/delivery-profile/services/delivery-profile.service.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import { UpdateDeliveryProfileDto } from '../dto/update-delivery-profile.dto';
import { DeliveryProfileReader } from './delivery-profile.reader';
import { DeliveryProfileManager } from './delivery-profile.manager';

@Injectable()
export class DeliveryProfileService {
  constructor(
    private readonly reader: DeliveryProfileReader,
    private readonly manager: DeliveryProfileManager,
  ) {}

  findAll(tx?: DbTx) {
    return this.reader.findAll(tx);
  }

  findOne(id: string, tx?: DbTx) {
    return this.reader.findOne(id, tx);
  }

  create(dto: CreateDeliveryProfileDto, tx?: DbTx) {
    return this.manager.create(dto, tx);
  }

  update(id: string, dto: UpdateDeliveryProfileDto, tx?: DbTx) {
    return this.manager.update(id, dto, tx);
  }
}
```

```ts
// apps/core/src/modules/inventory/delivery-profile/controllers/delivery-profile.controller.ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import { UpdateDeliveryProfileDto } from '../dto/update-delivery-profile.dto';
import { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import { DeliveryProfileService } from '../services/delivery-profile.service';

@ApiTags('Inventory')
@Controller('inventory/delivery-profiles')
@UseGuards(ScopeGuard)
export class DeliveryProfileController {
  constructor(private readonly service: DeliveryProfileService) {}

  @Get()
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '배송 프로필 목록 (연결 SKU 수 포함)' })
  @ApiResponse({ status: 200, type: DeliveryProfileDto, isArray: true })
  findAll(): Promise<DeliveryProfileDto[]> {
    return this.service.findAll();
  }

  @Get(':id')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '배송 프로필 조회' })
  @ApiResponse({ status: 404, description: '배송 프로필을 찾을 수 없습니다.' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DeliveryProfileDto> {
    return this.service.findOne(id);
  }

  @Post()
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '배송 프로필 생성 — 계획 확정이 요구하는 필드를 전부 받는다' })
  @ApiResponse({ status: 201, type: DeliveryProfileDto })
  create(@Body() dto: CreateDeliveryProfileDto): Promise<DeliveryProfileDto> {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '배송 프로필 수정 — 중첩 객체는 통째로 보낸다' })
  @ApiResponse({ status: 404, description: '배송 프로필을 찾을 수 없습니다.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeliveryProfileDto): Promise<DeliveryProfileDto> {
    return this.service.update(id, dto);
  }
}
```

```ts
// apps/core/src/modules/inventory/delivery-profile/delivery-profile.module.ts
import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { DeliveryProfileController } from './controllers/delivery-profile.controller';
import { DeliveryProfileService } from './services/delivery-profile.service';
import { DeliveryProfileReader } from './services/delivery-profile.reader';
import { DeliveryProfileManager } from './services/delivery-profile.manager';

@Module({
  imports: [SharedModule],
  controllers: [DeliveryProfileController],
  providers: [DeliveryProfileService, DeliveryProfileReader, DeliveryProfileManager],
  exports: [DeliveryProfileService],
})
export class DeliveryProfileModule {}
```

`inventory.module.ts`: `import { DeliveryProfileModule } from './delivery-profile/delivery-profile.module';` 를 추가하고 imports·exports 배열의 `WarehouseModule,` 바로 다음 줄에 각각 `DeliveryProfileModule,` 을 넣는다.

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'delivery-profile\.manager\.integration\.spec\.ts$'`
Expected: PASS (4 tests)

Run: `npx jest apps/core/src/platform/auth` — 스코프 바인딩 가드 스펙이 새 컨트롤러(`*.controller.ts`)의 `@RequireScopes` + `ScopeGuard` 를 받아들이는지
Expected: PASS

Run: `npx nest build core`
Expected: 에러 0 (DI 조립 확인)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/delivery-profile apps/core/src/modules/inventory/inventory.module.ts
git commit -m "feat(core): 배송 프로필 목록·조회·생성·수정 API (#923)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 5: admin-web 데이터 계층 + 프로필 폼 순수 함수

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` (파일 끝에 추가)
- Create: `apps/admin-web/src/lib/api/domains/inventory/delivery-profiles.client.ts`
- Modify: `apps/admin-web/src/lib/services/inventory/query-keys.ts` (42행 `warehouses` 근처)
- Modify: `apps/admin-web/src/lib/services/inventory/queries.ts` (창고 쿼리 다음)
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts` (`useUpdateWarehouse` 다음)
- Create: `apps/admin-web/src/features/inventory/delivery-profiles/lib/profile-form.ts`
- Test: `apps/admin-web/src/features/inventory/delivery-profiles/lib/profile-form.spec.ts`

**Interfaces:**
- Produces:
  - 타입 `DeliveryProfileDto`, `CreateDeliveryProfileDto`, `UpdateDeliveryProfileDto`, `FulfillmentMode`, `DeliveryProfileSourceType`
  - `deliveryProfilesClient.{list, create, update}`
  - `inventoryQueryKeys.deliveryProfiles` (상수 배열 `['delivery-profiles']`)
  - `useDeliveryProfiles()`, `useCreateDeliveryProfile()`, `useUpdateDeliveryProfile()`
  - `ProfileFormState`, `emptyProfileForm()`, `formFromProfile(p)`, `validateProfileForm(s)`, `toCreatePayload(s)`, `toUpdatePayload(before, s)`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// apps/admin-web/src/features/inventory/delivery-profiles/lib/profile-form.spec.ts
import type { DeliveryProfileDto } from '@/lib/types/dto/inventory';
import {
  emptyProfileForm,
  formFromProfile,
  toCreatePayload,
  toUpdatePayload,
  validateProfileForm,
  type ProfileFormState,
} from './profile-form';

function filled(overrides: Partial<ProfileFormState> = {}): ProfileFormState {
  return {
    ...emptyProfileForm(),
    name: '부천 자사 출고',
    senderName: '엘씨나인',
    senderPhone: '1877-7184',
    originPostalCode: '14521',
    originRoadAddress: '부천시 평천로832번길 42',
    originDetailAddress: '4층',
    returnPostalCode: '14521',
    returnRoadAddress: '부천시 평천로832번길 42',
    returnDetailAddress: '',
    carrierAccountRef: 'HANJIN',
    ...overrides,
  };
}

const profile: DeliveryProfileDto = {
  id: 'p1',
  name: '부천 자사 출고',
  sourceType: 'in_house',
  avgDeliveryDays: null,
  sender: { name: '엘씨나인', phone: '1877-7184' },
  originAddress: { postalCode: '14521', roadAddress: '부천시 평천로832번길 42', detailAddress: '4층' },
  returnAddress: { postalCode: '14521', roadAddress: '부천시 평천로832번길 42', detailAddress: '' },
  carrierAccountRef: 'HANJIN',
  supportedFulfillmentModes: ['in_house'],
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
};

describe('emptyProfileForm', () => {
  it('자사 출고·in_house 를 기본값으로 둔다', () => {
    expect(emptyProfileForm().sourceType).toBe('in_house');
    expect(emptyProfileForm().modes).toEqual(['in_house']);
  });
});

describe('validateProfileForm', () => {
  it('완전하면 오류 없음', () => {
    expect(validateProfileForm(filled())).toEqual({});
  });
  it('필수 필드가 공백이면 오류', () => {
    const errors = validateProfileForm(filled({ senderName: '  ', originRoadAddress: '', carrierAccountRef: ' ' }));
    expect(Object.keys(errors).sort()).toEqual(['carrierAccountRef', 'originRoadAddress', 'senderName']);
  });
  it('이행 방식이 없으면 오류', () => {
    expect(validateProfileForm(filled({ modes: [] }))).toHaveProperty('modes');
  });
  it('평균 배송일은 비우거나 0 이상 정수', () => {
    expect(validateProfileForm(filled({ avgDeliveryDays: '' }))).toEqual({});
    expect(validateProfileForm(filled({ avgDeliveryDays: '2' }))).toEqual({});
    expect(validateProfileForm(filled({ avgDeliveryDays: '-1' }))).toHaveProperty('avgDeliveryDays');
    expect(validateProfileForm(filled({ avgDeliveryDays: '1.5' }))).toHaveProperty('avgDeliveryDays');
  });
});

describe('toCreatePayload', () => {
  it('구조화 필드로 조립하고 공백을 다듬는다', () => {
    const payload = toCreatePayload(filled({ name: ' 부천 ', returnPhone: '' }));
    expect(payload.name).toBe('부천');
    expect(payload.sender).toEqual({ name: '엘씨나인', phone: '1877-7184' });
    expect(payload.returnAddress).toEqual({ postalCode: '14521', roadAddress: '부천시 평천로832번길 42', detailAddress: '' });
    expect(payload.supportedFulfillmentModes).toEqual(['in_house']);
    expect(payload).not.toHaveProperty('avgDeliveryDays');
  });
  it('반품지 연락처·평균 배송일은 값이 있을 때만', () => {
    const payload = toCreatePayload(filled({ returnPhone: '010-1', avgDeliveryDays: '2' }));
    expect(payload.returnAddress.phone).toBe('010-1');
    expect(payload.avgDeliveryDays).toBe(2);
  });
});

describe('toUpdatePayload', () => {
  it('바뀐 게 없으면 빈 객체', () => {
    expect(toUpdatePayload(profile, formFromProfile(profile))).toEqual({});
  });
  it('중첩 객체는 한 필드만 바뀌어도 통째로 보낸다', () => {
    const payload = toUpdatePayload(profile, { ...formFromProfile(profile), senderPhone: '02-9' });
    expect(payload).toEqual({ sender: { name: '엘씨나인', phone: '02-9' } });
  });
  it('이름·계약번호·이행 방식 변경', () => {
    const payload = toUpdatePayload(profile, {
      ...formFromProfile(profile),
      name: '새 이름',
      carrierAccountRef: 'X',
      modes: ['in_house', '3pl'],
    });
    expect(payload).toEqual({ name: '새 이름', carrierAccountRef: 'X', supportedFulfillmentModes: ['in_house', '3pl'] });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- features/inventory/delivery-profiles`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`lib/types/dto/inventory.ts` 끝에:

```ts
export type DeliveryProfileSourceType = 'direct' | 'in_house' | 'overseas';
export type FulfillmentMode = 'in_house' | '3pl' | 'drop_ship';

export interface DeliveryProfileAddress {
  postalCode: string;
  roadAddress: string;
  detailAddress: string;
}

export interface DeliveryProfileDto {
  id: string;
  name: string;
  sourceType: DeliveryProfileSourceType;
  avgDeliveryDays: number | null;
  sender: { name: string; phone: string };
  originAddress: DeliveryProfileAddress;
  returnAddress: DeliveryProfileAddress & { phone?: string };
  carrierAccountRef: string | null;
  supportedFulfillmentModes: FulfillmentMode[];
  skuCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeliveryProfileDto {
  name: string;
  sourceType: DeliveryProfileSourceType;
  avgDeliveryDays?: number;
  sender: { name: string; phone: string };
  originAddress: DeliveryProfileAddress;
  returnAddress: DeliveryProfileAddress & { phone?: string };
  carrierAccountRef: string;
  supportedFulfillmentModes: FulfillmentMode[];
}

export type UpdateDeliveryProfileDto = Partial<CreateDeliveryProfileDto>;
```

```ts
// apps/admin-web/src/lib/api/domains/inventory/delivery-profiles.client.ts
'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateDeliveryProfileDto,
  DeliveryProfileDto,
  UpdateDeliveryProfileDto,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/delivery-profiles`;

export const deliveryProfilesClient = {
  list: async (): Promise<DeliveryProfileDto[]> => (await client.get(BASE)).data,
  create: async (data: CreateDeliveryProfileDto): Promise<DeliveryProfileDto> => (await client.post(BASE, data)).data,
  update: async (id: string, data: UpdateDeliveryProfileDto): Promise<DeliveryProfileDto> =>
    (await client.patch(`${BASE}/${encodeURIComponent(id)}`, data)).data,
};
```

`query-keys.ts` 의 `warehouses: ['warehouses'] as const,` 다음 줄:

```ts
  // 인자 없는 팩토리로 만들면 invalidate 가 undefined 키를 받아 조용히 무효가 된다 — 상수 배열로 둔다
  deliveryProfiles: ['delivery-profiles'] as const,
```

`queries.ts` — import 에 `import { deliveryProfilesClient } from '../../api/domains/inventory/delivery-profiles.client';` 추가, `useWarehouse` 다음:

```ts
export const useDeliveryProfiles = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.deliveryProfiles,
    queryFn: () => deliveryProfilesClient.list(),
    staleTime: 60 * 1000,
  });
};
```

`mutations.ts` — import 에 `deliveryProfilesClient` 와 타입 `CreateDeliveryProfileDto, UpdateDeliveryProfileDto` 추가, `useUpdateWarehouse` 다음:

```ts
export const useCreateDeliveryProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDeliveryProfileDto) => deliveryProfilesClient.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.deliveryProfiles }),
  });
};

export const useUpdateDeliveryProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDeliveryProfileDto }) =>
      deliveryProfilesClient.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.deliveryProfiles }),
  });
};
```

`lib/services/inventory/index.ts` 가 `queries`·`mutations` 를 `export *` 하는지 확인한다(`grep -n "export" lib/services/inventory/index.ts`). 하지 않으면 두 훅 이름을 export 목록에 더한다.

```ts
// apps/admin-web/src/features/inventory/delivery-profiles/lib/profile-form.ts
import type {
  CreateDeliveryProfileDto,
  DeliveryProfileDto,
  DeliveryProfileSourceType,
  FulfillmentMode,
  UpdateDeliveryProfileDto,
} from '@/lib/types/dto/inventory';

export type ProfileFormState = {
  name: string;
  sourceType: DeliveryProfileSourceType;
  avgDeliveryDays: string;
  senderName: string;
  senderPhone: string;
  originPostalCode: string;
  originRoadAddress: string;
  originDetailAddress: string;
  returnPostalCode: string;
  returnRoadAddress: string;
  returnDetailAddress: string;
  returnPhone: string;
  carrierAccountRef: string;
  modes: FulfillmentMode[];
};

export type ProfileFormErrors = Partial<Record<keyof ProfileFormState, string>>;

export function emptyProfileForm(): ProfileFormState {
  return {
    name: '',
    sourceType: 'in_house',
    avgDeliveryDays: '',
    senderName: '',
    senderPhone: '',
    originPostalCode: '',
    originRoadAddress: '',
    originDetailAddress: '',
    returnPostalCode: '',
    returnRoadAddress: '',
    returnDetailAddress: '',
    returnPhone: '',
    carrierAccountRef: '',
    modes: ['in_house'],
  };
}

export function formFromProfile(p: DeliveryProfileDto): ProfileFormState {
  return {
    name: p.name,
    sourceType: p.sourceType,
    avgDeliveryDays: p.avgDeliveryDays === null ? '' : String(p.avgDeliveryDays),
    senderName: p.sender.name,
    senderPhone: p.sender.phone,
    originPostalCode: p.originAddress.postalCode,
    originRoadAddress: p.originAddress.roadAddress,
    originDetailAddress: p.originAddress.detailAddress,
    returnPostalCode: p.returnAddress.postalCode,
    returnRoadAddress: p.returnAddress.roadAddress,
    returnDetailAddress: p.returnAddress.detailAddress,
    returnPhone: p.returnAddress.phone ?? '',
    carrierAccountRef: p.carrierAccountRef ?? '',
    modes: p.supportedFulfillmentModes,
  };
}

// core DTO 의 필수 규칙과 같다(공백만 있는 값 거부). 서버가 최종 판정자이고 이건 헛걸음 방지용이다.
const REQUIRED: Array<keyof ProfileFormState> = [
  'name',
  'senderName',
  'senderPhone',
  'originPostalCode',
  'originRoadAddress',
  'returnPostalCode',
  'returnRoadAddress',
  'carrierAccountRef',
];

export function validateProfileForm(s: ProfileFormState): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  for (const key of REQUIRED) {
    const value = s[key];
    if (typeof value === 'string' && !value.trim()) errors[key] = '필수 항목입니다.';
  }
  if (s.modes.length === 0) errors.modes = '이행 방식을 하나 이상 고르세요.';
  if (s.avgDeliveryDays.trim() && !/^\d+$/.test(s.avgDeliveryDays.trim())) {
    errors.avgDeliveryDays = '0 이상의 정수로 입력하세요.';
  }
  return errors;
}

function sender(s: ProfileFormState) {
  return { name: s.senderName.trim(), phone: s.senderPhone.trim() };
}
function origin(s: ProfileFormState) {
  return {
    postalCode: s.originPostalCode.trim(),
    roadAddress: s.originRoadAddress.trim(),
    detailAddress: s.originDetailAddress.trim(),
  };
}
function returnAddress(s: ProfileFormState) {
  return {
    postalCode: s.returnPostalCode.trim(),
    roadAddress: s.returnRoadAddress.trim(),
    detailAddress: s.returnDetailAddress.trim(),
    ...(s.returnPhone.trim() ? { phone: s.returnPhone.trim() } : {}),
  };
}

export function toCreatePayload(s: ProfileFormState): CreateDeliveryProfileDto {
  return {
    name: s.name.trim(),
    sourceType: s.sourceType,
    ...(s.avgDeliveryDays.trim() ? { avgDeliveryDays: Number(s.avgDeliveryDays.trim()) } : {}),
    sender: sender(s),
    originAddress: origin(s),
    returnAddress: returnAddress(s),
    carrierAccountRef: s.carrierAccountRef.trim(),
    supportedFulfillmentModes: s.modes,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 바뀐 필드만. 중첩 객체는 한 칸만 바뀌어도 통째로 보낸다(core PATCH 계약). */
export function toUpdatePayload(before: DeliveryProfileDto, s: ProfileFormState): UpdateDeliveryProfileDto {
  const next = toCreatePayload(s);
  const beforeForm = toCreatePayload(formFromProfile(before));
  const payload: UpdateDeliveryProfileDto = {};
  if (next.name !== beforeForm.name) payload.name = next.name;
  if (next.sourceType !== beforeForm.sourceType) payload.sourceType = next.sourceType;
  if (next.avgDeliveryDays !== beforeForm.avgDeliveryDays && next.avgDeliveryDays !== undefined) {
    payload.avgDeliveryDays = next.avgDeliveryDays;
  }
  if (!same(next.sender, beforeForm.sender)) payload.sender = next.sender;
  if (!same(next.originAddress, beforeForm.originAddress)) payload.originAddress = next.originAddress;
  if (!same(next.returnAddress, beforeForm.returnAddress)) payload.returnAddress = next.returnAddress;
  if (next.carrierAccountRef !== beforeForm.carrierAccountRef) payload.carrierAccountRef = next.carrierAccountRef;
  if (!same(next.supportedFulfillmentModes, beforeForm.supportedFulfillmentModes)) {
    payload.supportedFulfillmentModes = next.supportedFulfillmentModes;
  }
  return payload;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:admin-web -- features/inventory/delivery-profiles`
Expected: PASS

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib apps/admin-web/src/features/inventory/delivery-profiles/lib
git commit -m "feat(admin-web): 배송 프로필 API 클라이언트·훅·폼 변환 (#923)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 6: admin-web 배송 프로필 화면

**Files:**
- Create: `apps/admin-web/src/app/(admin)/inventory/delivery-profiles/page.tsx`
- Create: `apps/admin-web/src/features/inventory/delivery-profiles/template/index.tsx`
- Create: `apps/admin-web/src/features/inventory/delivery-profiles/components/table/index.tsx`
- Create: `apps/admin-web/src/features/inventory/delivery-profiles/components/profile-dialog/index.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (340-344행 `inventory-warehouses` 항목 다음)

**Interfaces:**
- Consumes: Task 5 의 훅·`profile-form.ts`
- Produces: 라우트 `/inventory/delivery-profiles` — Task 7·8 의 「먼저 등록」 링크가 가리킨다

- [ ] **Step 1: 라우트·템플릿**

```tsx
// apps/admin-web/src/app/(admin)/inventory/delivery-profiles/page.tsx
import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import DeliveryProfilesTemplate from '@/features/inventory/delivery-profiles/template';

export default function Page() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <DeliveryProfilesTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
```

```tsx
// apps/admin-web/src/features/inventory/delivery-profiles/template/index.tsx
'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { DeliveryProfilesTable } from '../components/table';

export default function DeliveryProfilesTemplate() {
  return (
    <Container>
      <Header
        title="배송 프로필"
        subtitle="발송인·출고지·반품지·택배 계약번호 묶음입니다. 사입·위탁 SKU 는 프로필이 있어야 만들 수 있고, 출고 계획 확정은 상자의 모든 SKU 가 같은 프로필이기를 요구합니다."
      />
      <DeliveryProfilesTable />
    </Container>
  );
}
```

- [ ] **Step 2: 표**

```tsx
// apps/admin-web/src/features/inventory/delivery-profiles/components/table/index.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDeliveryProfiles } from '@/lib/services/inventory';
import type { DeliveryProfileDto, DeliveryProfileSourceType, FulfillmentMode } from '@/lib/types/dto/inventory';
import { ProfileDialog } from '../profile-dialog';

export const SOURCE_TYPE_LABELS: Record<DeliveryProfileSourceType, string> = {
  in_house: '자사 창고',
  direct: '직배송',
  overseas: '해외',
};

export const FULFILLMENT_MODE_LABELS: Record<FulfillmentMode, string> = {
  in_house: '자사 출고',
  '3pl': '3PL',
  drop_ship: '위탁 직배송',
};

export function DeliveryProfilesTable() {
  const { data: profiles = [], isLoading } = useDeliveryProfiles();
  // null = 닫힘, 'new' = 생성, 객체 = 수정
  const [editing, setEditing] = useState<DeliveryProfileDto | 'new' | null>(null);

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setEditing('new')}>
          새 프로필
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>원천</TableHead>
            <TableHead>발송인</TableHead>
            <TableHead>출고지</TableHead>
            <TableHead>택배 계약번호</TableHead>
            <TableHead>이행 방식</TableHead>
            <TableHead className="text-right">사용 SKU</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={8}>불러오는 중...</TableCell>
            </TableRow>
          )}
          {!isLoading && profiles.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                등록된 배송 프로필이 없습니다 — 사입·위탁 SKU 생성과 매칭 「자동」 탭이 막혀 있습니다.
              </TableCell>
            </TableRow>
          )}
          {profiles.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell>{SOURCE_TYPE_LABELS[p.sourceType] ?? p.sourceType}</TableCell>
              <TableCell>
                {p.sender.name || '-'} <span className="text-muted-foreground text-xs">{p.sender.phone}</span>
              </TableCell>
              <TableCell>{p.originAddress.roadAddress || '-'}</TableCell>
              <TableCell>{p.carrierAccountRef || '-'}</TableCell>
              <TableCell>{p.supportedFulfillmentModes.map((m) => FULFILLMENT_MODE_LABELS[m] ?? m).join(', ')}</TableCell>
              <TableCell className="text-right">{p.skuCount ?? 0}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                  수정
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ProfileDialog
        open={editing !== null}
        profile={editing === 'new' ? null : editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}
```

- [ ] **Step 3: 다이얼로그**

```tsx
// apps/admin-web/src/features/inventory/delivery-profiles/components/profile-dialog/index.tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/common/form/form-field';
import { FormInput } from '@/components/common/form/form-input';
import { FormSelect } from '@/components/common/form/form-select';
import { FormSection } from '@/components/common/form/form-section';
import { useCreateDeliveryProfile, useUpdateDeliveryProfile } from '@/lib/services/inventory';
import type { DeliveryProfileDto, FulfillmentMode } from '@/lib/types/dto/inventory';
import {
  emptyProfileForm,
  formFromProfile,
  toCreatePayload,
  toUpdatePayload,
  validateProfileForm,
  type ProfileFormErrors,
  type ProfileFormState,
} from '../../lib/profile-form';
import { FULFILLMENT_MODE_LABELS, SOURCE_TYPE_LABELS } from '../table';

type Props = { open: boolean; profile: DeliveryProfileDto | null; onOpenChange: (open: boolean) => void };

const SOURCE_OPTIONS = Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const MODES = Object.keys(FULFILLMENT_MODE_LABELS) as FulfillmentMode[];

export function ProfileDialog({ open, profile, onOpenChange }: Props) {
  const isEdit = !!profile;
  const [form, setForm] = useState<ProfileFormState>(emptyProfileForm());
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const create = useCreateDeliveryProfile();
  const update = useUpdateDeliveryProfile();

  useEffect(() => {
    if (open) {
      setForm(profile ? formFromProfile(profile) : emptyProfileForm());
      setErrors({});
    }
  }, [open, profile]);

  const set =
    <K extends keyof ProfileFormState>(key: K) =>
    (value: ProfileFormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const toggleMode = (mode: FulfillmentMode, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      modes: checked ? [...prev.modes.filter((m) => m !== mode), mode] : prev.modes.filter((m) => m !== mode),
    }));

  const input = (key: keyof ProfileFormState, label: string, required = true, placeholder?: string) => (
    <FormField label={label} required={required} errorMessage={errors[key]}>
      <FormInput
        value={String(form[key])}
        onChange={(e) => set(key)(e.target.value as never)}
        placeholder={placeholder}
        error={!!errors[key]}
      />
    </FormField>
  );

  const handleSubmit = async () => {
    const next = validateProfileForm(form);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    try {
      if (profile) {
        const data = toUpdatePayload(profile, form);
        if (Object.keys(data).length > 0) await update.mutateAsync({ id: profile.id, data });
        toast.success('배송 프로필이 수정되었습니다.');
      } else {
        await create.mutateAsync(toCreatePayload(form));
        toast.success('배송 프로필이 생성되었습니다.');
      }
      onOpenChange(false);
    } catch (e: unknown) {
      const message =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '저장하지 못했습니다.';
      toast.error(message);
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '배송 프로필 수정' : '배송 프로필 생성'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormSection title="기본">
            {input('name', '이름', true, '예: 부천 자사 출고')}
            <FormField label="원천" required>
              <FormSelect value={form.sourceType} onValueChange={(v) => set('sourceType')(v as ProfileFormState['sourceType'])} options={SOURCE_OPTIONS} />
            </FormField>
            {input('avgDeliveryDays', '평균 배송일', false, '선택')}
            {input('carrierAccountRef', '택배 계약번호')}
            <FormField label="이행 방식" required errorMessage={errors.modes}>
              <div className="flex gap-4">
                {MODES.map((mode) => (
                  <label key={mode} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.modes.includes(mode)} onCheckedChange={(c) => toggleMode(mode, c === true)} />
                    {FULFILLMENT_MODE_LABELS[mode]}
                  </label>
                ))}
              </div>
            </FormField>
          </FormSection>
          <FormSection title="발송인 (3PL 이면 그 센터 정보)">
            {input('senderName', '이름')}
            {input('senderPhone', '전화번호')}
          </FormSection>
          <FormSection title="출고지">
            {input('originPostalCode', '우편번호')}
            {input('originRoadAddress', '도로명 주소')}
            {input('originDetailAddress', '상세 주소', false)}
          </FormSection>
          <FormSection title="반품지">
            {input('returnPostalCode', '우편번호')}
            {input('returnRoadAddress', '도로명 주소')}
            {input('returnDetailAddress', '상세 주소', false)}
            {input('returnPhone', '연락처', false)}
          </FormSection>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '저장 중…' : isEdit ? '저장' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`@/components/ui/checkbox` 가 없으면(`ls apps/admin-web/src/components/ui/checkbox.tsx`) 같은 자리에 `<input type="checkbox" checked={…} onChange={(e) => toggleMode(mode, e.target.checked)} />` 을 쓴다.

- [ ] **Step 4: 메뉴**

`lib/utils/menu.ts` 의 `inventory-warehouses` 항목(340-344행) 다음에:

```ts
      {
        id: 'inventory-delivery-profiles',
        title: '배송 프로필',
        path: '/inventory/delivery-profiles',
      },
```

- [ ] **Step 5: 타입 확인 + 커밋**

Run: `cd apps/admin-web && npx tsc --noEmit && npx eslint src/features/inventory/delivery-profiles "src/app/(admin)/inventory/delivery-profiles"`
Expected: 에러 0

```bash
git add apps/admin-web/src/app "apps/admin-web/src/features/inventory/delivery-profiles" apps/admin-web/src/lib/utils/menu.ts
git commit -m "feat(admin-web): 배송 프로필 목록·생성·수정 화면 (#923)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 7: admin-web SKU 폼에 프로필 선택

**Files:**
- Create: `apps/admin-web/src/features/inventory/skus/lib/delivery-profile-requirement.ts`
- Test: `apps/admin-web/src/features/inventory/skus/lib/delivery-profile-requirement.spec.ts`
- Modify: `apps/admin-web/src/features/inventory/skus/components/sku-form-dialog/index.tsx`

**Interfaces:**
- Consumes: `useDeliveryProfiles()` (Task 5)
- Produces:
  - `requiresDeliveryProfile(stockType: string): boolean`
  - `deliveryProfileMissing(input: { original: { stockType: string; deliveryProfileId: string } | null; stockType: string; deliveryProfileId: string }): boolean` — `''` 는 「없음」

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// apps/admin-web/src/features/inventory/skus/lib/delivery-profile-requirement.spec.ts
import { deliveryProfileMissing, requiresDeliveryProfile } from './delivery-profile-requirement';

describe('requiresDeliveryProfile', () => {
  it('사입·위탁만 필수', () => {
    expect(requiresDeliveryProfile('physical')).toBe(true);
    expect(requiresDeliveryProfile('consignment')).toBe(true);
    expect(requiresDeliveryProfile('drop_shipped')).toBe(false);
    expect(requiresDeliveryProfile('infinite')).toBe(false);
  });
});

// core 규칙(sku-delivery-profile.rule.ts)과 같은 모양이어야 한다 — 서버가 최종 판정자.
describe('deliveryProfileMissing', () => {
  it('생성: 사입인데 프로필 없으면 true', () => {
    expect(deliveryProfileMissing({ original: null, stockType: 'physical', deliveryProfileId: '' })).toBe(true);
    expect(deliveryProfileMissing({ original: null, stockType: 'physical', deliveryProfileId: 'p1' })).toBe(false);
    expect(deliveryProfileMissing({ original: null, stockType: 'drop_shipped', deliveryProfileId: '' })).toBe(false);
  });
  it('수정: 아무것도 안 바꾸면 옛 SKU 도 false', () => {
    const original = { stockType: 'physical', deliveryProfileId: '' };
    expect(deliveryProfileMissing({ original, stockType: 'physical', deliveryProfileId: '' })).toBe(false);
  });
  it('수정: 직배 → 사입 전환에 프로필 없으면 true', () => {
    const original = { stockType: 'drop_shipped', deliveryProfileId: '' };
    expect(deliveryProfileMissing({ original, stockType: 'physical', deliveryProfileId: '' })).toBe(true);
  });
  it('수정: 사입 SKU 의 프로필을 지우면 true', () => {
    const original = { stockType: 'physical', deliveryProfileId: 'p1' };
    expect(deliveryProfileMissing({ original, stockType: 'physical', deliveryProfileId: '' })).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- features/inventory/skus/lib`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// apps/admin-web/src/features/inventory/skus/lib/delivery-profile-requirement.ts
// core 의 sku-delivery-profile.rule.ts 와 같은 판정이다. 서버가 최종 판정자이고 이건 헛걸음 방지용.

export function requiresDeliveryProfile(stockType: string): boolean {
  return stockType === 'physical' || stockType === 'consignment';
}

type ProfileState = { stockType: string; deliveryProfileId: string };

/** '' 은 「프로필 없음」. 수정은 재고 유형이나 프로필이 원래와 달라졌을 때만 판정한다. */
export function deliveryProfileMissing(input: ProfileState & { original: ProfileState | null }): boolean {
  const { original, stockType, deliveryProfileId } = input;
  if (original && original.stockType === stockType && original.deliveryProfileId === deliveryProfileId) {
    return false;
  }
  return requiresDeliveryProfile(stockType) && !deliveryProfileId;
}
```

`sku-form-dialog/index.tsx` 변경:

0. `lib/types/dto/inventory.ts:152` `CreateSkuDto` 의 `deliveryProfileId?: string;` 을 `deliveryProfileId?: string | null;` 로 넓힌다
   (core `UpdateSkuDto` 는 null 을 «지움»으로 받는다 — `@IsOptional` 이 null 을 통과시킨다).

1. import 추가:

```tsx
import { useDeliveryProfiles } from '@/lib/services/inventory';
import { deliveryProfileMissing, requiresDeliveryProfile } from '../../lib/delivery-profile-requirement';
```

2. `FormState` 에 `deliveryProfileId: string;`, `DEFAULT_FORM` 에 `deliveryProfileId: '',`, `formFromSku` 에 `deliveryProfileId: sku.deliveryProfileId ?? '',` 를 더한다.

3. 컴포넌트 안(`useSkuGroups` 다음):

```tsx
  const { data: profiles = [] } = useDeliveryProfiles();
  const original = sku ? { stockType: sku.stockType, deliveryProfileId: sku.deliveryProfileId ?? '' } : null;
```

4. `validate` 의 이름 검사 다음 줄:

```tsx
    if (deliveryProfileMissing({ original, stockType: form.stockType, deliveryProfileId: form.deliveryProfileId })) {
      next.deliveryProfileId = '사입·위탁 SKU 는 배송 프로필이 필요합니다.';
    }
```

5. `payload` 조립을:

```tsx
    const profileChanged = form.deliveryProfileId !== (original?.deliveryProfileId ?? '');
    const payload: CreateSkuDto = {
      name: form.name.trim(),
      businessProductName: form.businessProductName || undefined,
      stockType: form.stockType as CreateSkuDto['stockType'],
      skuGroupId: form.groupId || undefined,
      // 수정에선 바뀌었을 때만 보낸다('' → null 은 지움). 생성에선 고른 값만.
      ...(isEdit
        ? profileChanged
          ? { deliveryProfileId: form.deliveryProfileId || null }
          : {}
        : form.deliveryProfileId
          ? { deliveryProfileId: form.deliveryProfileId }
          : {}),
    };
```

6. 「재고 정책」 섹션의 재고 유형 `FormField` 다음:

```tsx
            <FormField
              label="배송 프로필"
              required={requiresDeliveryProfile(form.stockType)}
              errorMessage={errors.deliveryProfileId}
            >
              {profiles.length === 0 ? (
                <p className="text-sm text-destructive">
                  배송 프로필이 없습니다 —{' '}
                  <Link href="/inventory/delivery-profiles" className="underline">
                    먼저 등록하세요
                  </Link>
                  .
                </p>
              ) : (
                <FormSelect
                  value={form.deliveryProfileId}
                  onValueChange={set('deliveryProfileId')}
                  options={[
                    { value: '', label: '선택 안 함' },
                    ...profiles.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  placeholder="배송 프로필 선택"
                />
              )}
            </FormField>
```

(`FormSelect` 가 빈 문자열 value 를 옵션으로 받는지 `components/common/form/form-select.tsx` 에서 확인한다. Radix Select 는 `value=""` 아이템을 금지하므로, 그렇다면 `'__none__'` 센티널을 쓰고 `set` 에서 `''` 로 바꾼다.)

- [ ] **Step 4: 통과 확인**

Run: `npm run test:admin-web -- features/inventory/skus/lib && (cd apps/admin-web && npx tsc --noEmit)`
Expected: PASS, 타입 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/inventory/skus
git commit -m "feat(admin-web): SKU 폼에 배송 프로필 선택 — 사입·위탁 필수 (#923)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 8: 매칭 「자동」 탭에 프로필 선택

**Files:**
- Modify: `apps/admin-web/src/features/order/matching/lib/build-matching-links.ts`
- Test: `apps/admin-web/src/features/order/matching/lib/build-matching-links.spec.ts`
- Modify: `apps/admin-web/src/features/order/matching/components/table/InventoryMatchingDialog.tsx` (상태 96-97행, 상태 조립 113-124행, 리셋 182-183행, 재고소유 필드 586-607행 다음)

**Interfaces:**
- Consumes: `useDeliveryProfiles()` (Task 5)
- Produces: `AutoTabState.deliveryProfileId: string`, 각 `newSku` 에 `deliveryProfileId`

- [ ] **Step 1: 실패하는 테스트 추가**

`build-matching-links.spec.ts` — `state()` 기본값에 `deliveryProfileId: PROFILE,` 추가(`const PROFILE = '33333333-3333-3333-3333-333333333333';`), `describe('buildMatchingLinks'` 안에:

```ts
  it('각 newSku 에 배송 프로필을 싣는다', () => {
    const result = buildMatchingLinks(state());
    expect(result.ok && result.links[0].newSku?.deliveryProfileId).toBe(PROFILE);
  });

  // 자동 탭이 만드는 SKU 는 stockType 을 안 보내 physical 이므로 서버가 항상 프로필을 요구한다.
  it('프로필이 없으면 missing-required', () => {
    expect(buildMatchingLinks(state({ deliveryProfileId: '' }))).toEqual({ ok: false, reason: 'missing-required' });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- features/order/matching/lib/build-matching-links`
Expected: FAIL (타입 필드 없음 / deliveryProfileId undefined)

- [ ] **Step 3: 구현**

`build-matching-links.ts`:
- `AutoTabState` 에 `supplierId: string;` 다음 줄 `deliveryProfileId: string;`
- `BUILD_FAILURE_MESSAGES['missing-required']` 를 `'공급처·재고소유·배송 프로필을 선택해주세요.'` 로
- `if (!state.supplierId || !state.holderId)` 를 `if (!state.supplierId || !state.holderId || !state.deliveryProfileId)` 로
- `newSku` 객체의 `supplierIds: [state.supplierId],` 다음 줄에 `deliveryProfileId: state.deliveryProfileId,`

`InventoryMatchingDialog.tsx`:
- import 에 `useDeliveryProfiles` 추가(같은 `@/lib/services/inventory` import 문에), `import Link from 'next/link';` 가 없으면 추가
- `const [holderId, setHolderId] = useState('');` 다음 줄 `const [deliveryProfileId, setDeliveryProfileId] = useState('');`
- `autoTabState` 객체에 `deliveryProfileId,` 추가
- 리셋 블록 `setHolderId('');` 다음 줄 `setDeliveryProfileId('');`
- `const { data: holdersResponse } = useHolders();` 다음 줄 `const { data: deliveryProfiles = [] } = useDeliveryProfiles();`
- 「재고소유」 `FormField` 닫는 태그 다음:

```tsx
                <FormField label="배송 프로필" required>
                  {deliveryProfiles.length === 0 ? (
                    <p className="text-sm text-destructive">
                      배송 프로필이 없습니다 —{' '}
                      <Link href="/inventory/delivery-profiles" className="underline" target="_blank">
                        먼저 등록하세요
                      </Link>
                      .
                    </p>
                  ) : (
                    <FormSelect
                      options={deliveryProfiles.map((p) => ({ value: p.id, label: p.name }))}
                      value={deliveryProfileId}
                      onValueChange={setDeliveryProfileId}
                      placeholder="배송 프로필 선택"
                    />
                  )}
                </FormField>
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:admin-web -- features/order/matching && (cd apps/admin-web && npx tsc --noEmit)`
Expected: PASS, 타입 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/order/matching
git commit -m "feat(admin-web): 매칭 자동 탭에 배송 프로필 선택 — 새 SKU 에 싣는다 (#923)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 9: 전체 게이트 · 브라우저 스모크 · PR

**Files:** 없음(검증·PR)

- [ ] **Step 1: 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
(cd apps/admin-web && npx tsc --noEmit)
npm run test:admin-web
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- '(delivery-profile|sku-catalog)'
npx eslint apps/core/src/modules/inventory/delivery-profile apps/core/src/modules/inventory/sku-catalog
```

Expected: 전부 0 실패. 워크트리에서 `type-check` 가 `@tauri-apps/plugin-http`·`probe-image-size` 로만 실패하면 워크트리 `node_modules` 링크 문제다(이 변경과 무관) — PR CI 결과로 판정한다.

- [ ] **Step 2: 브라우저 스모크 (CI 는 `.tsx` 배선을 안 본다)**

로컬 core(`npm run start:main:dev`, `dev_core`) + admin-web(`npm run start:admin-web:dev`). 브라우저 로그인은 사람이 한다.

1. `/inventory/delivery-profiles` — 빈 상태 문구 → 「새 프로필」 → 필수 비우고 저장 시 필드 오류 → 채워 생성 → 표에 한 행, 사용 SKU 0
2. 같은 행 「수정」 → 발송인 전화만 바꿔 저장 → 반영
3. `/inventory/skus` → 생성: 재고 유형 사입 + 프로필 미선택 → 폼 오류 / 프로필 선택 후 생성 성공 → 프로필 목록의 사용 SKU 1
4. 프로필 없는 옛 SKU(시드에 있으면) 이름만 수정 → 성공
5. 주문 매칭 자동 탭 → 프로필 미선택이면 저장 비활성 / 선택 후 저장 → 새 SKU 에 프로필이 붙음(SKU 목록에서 확인)
6. 프로필을 0개로 둔 DB 에서 SKU 폼·매칭 자동 탭에 「먼저 등록하세요」 링크가 뜨는지

- [ ] **Step 3: PR**

PR 본문에 반드시:
- 마이그레이션 0 · 한 SST 스택이라 배포 순서 없음
- **배포 직후 사람 작업: `/inventory/delivery-profiles` 에서 프로필 1개 생성** — 그 전까지 사입·위탁 SKU 생성과 매칭 자동 탭이 400. 매칭 작업자에게 미리 공지
- 범위 밖: 기존 SKU 백필(보류), 한진 요청이 프로필 발송인을 읽게 하기, 프로필 삭제, `import-products.ts`
- `scripts/qa/seed-qa7-dev.ts` 는 이제 `QA_DELIVERY_PROFILE_ID` 가 필요
- 스모크 결과(Step 2)
- `Refs #923` 과 세션 링크 한 줄

그 다음 #923 본문 §H 의 「배송 프로필 생성 경로(설계 완료, 구현 중)」 를 PR 번호로 바꾼다.
