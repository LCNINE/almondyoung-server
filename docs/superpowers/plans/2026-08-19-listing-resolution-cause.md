# 격리 사유 라인 단위 세분화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채널 주문 라인이 왜 식별되지 않았는지를 라인 단위 사유로 기록해, 운영자가 격리 건마다 무엇을 해야 하는지 알 수 있게 한다.

**Architecture:** Core 가 `/channel-listings/resolve` 를 새로 내어 미스도 200 으로 `{ found:false, cause }` 를 준다 (옛 `/lookup` 은 미스가 HTTP 204 라 손대면 옛 어댑터가 조용히 오염된다). 어댑터는 라인별 `{ lineId, cause }` 를 모아 `order_collection_failures.affected_lines` nullable jsonb 에 넣는다. `reason` 은 그대로 두어 `uq_order_collection_failure` 의미를 보존한다.

**Tech Stack:** NestJS · Drizzle ORM (postgres-js) · Jest · TypeScript

**Spec:** `docs/superpowers/specs/2026-08-19-listing-resolution-cause-design.md`

## Global Constraints

- 사유 어휘 9종은 정확히 이 문자열이다: `listing_not_found` `listing_inactive` `channel_inactive` `variant_inactive` `no_active_version` `product_deleted` `no_embedded_ids` `no_lookup_key` `unknown`
- 어휘의 정본은 `@packages/domain-types` 하나다. 어느 앱에도 재정의하지 않는다
- `order_collection_failures.reason` 은 **바꾸지 않는다** (`channel_product_identification_failed` 유지). unique 키 `(channel, external_order_id, reason)` 의미가 바뀌면 고아 행이 생긴다
- Core 마이그레이션 0건. channel-adapter 마이그레이션 1건(additive, nullable)
- 옛 행 백필 없음
- 검증 게이트: `npm run type-check` 0 · `npx jest --maxWorkers=2` 실패 0
- TDD. 모든 태스크는 RED 확인 → 최소 구현 → GREEN → 커밋
- `npx jest` 는 OOM 나므로 항상 `--maxWorkers=2`

---

### Task 1: 사유 어휘를 `@packages/domain-types` 에 만든다

**Files:**
- Create: `packages/domain-types/listing-resolution-cause.ts`
- Create: `packages/domain-types/listing-resolution-cause.spec.ts`
- Modify: `packages/domain-types/index.ts`

**Interfaces:**
- Consumes: 없음 (최초 태스크)
- Produces:
  - `type ListingResolutionCause` — 위 9개 문자열의 유니온
  - `const LISTING_RESOLUTION_CAUSES: readonly ListingResolutionCause[]`
  - `function toListingResolutionCause(value: unknown): ListingResolutionCause` — 모르는 값은 `'unknown'`
  - `interface AffectedLine { lineId: string; cause: ListingResolutionCause }`

- [ ] **Step 1: Write the failing test**

`packages/domain-types/listing-resolution-cause.spec.ts`:

```typescript
import {
  LISTING_RESOLUTION_CAUSES,
  toListingResolutionCause,
} from './listing-resolution-cause';

/**
 * 어휘의 정본은 여기 하나다 (#674). Core 가 내고 channel-adapter 가 영속하며 화면이 렌더하므로,
 * 양쪽에 재정의하면 한쪽만 값이 늘었을 때 조용히 틀린다.
 *
 * 배포는 Core 가 먼저라, **어댑터는 자기가 모르는 값을 만날 수 있다.** 그때 타입이 거짓말하게
 * 두는 것보다 `unknown` 으로 낮춰 저장하는 편이 낫다 — 화면도 "판정 불가" 로 일관되게 읽는다.
 */
describe('ListingResolutionCause 어휘', () => {
  it('9종을 모두 가진다', () => {
    expect([...LISTING_RESOLUTION_CAUSES].sort()).toEqual(
      [
        'channel_inactive',
        'listing_inactive',
        'listing_not_found',
        'no_active_version',
        'no_embedded_ids',
        'no_lookup_key',
        'product_deleted',
        'unknown',
        'variant_inactive',
      ].sort(),
    );
  });

  it('알려진 값은 그대로 통과시킨다', () => {
    expect(toListingResolutionCause('variant_inactive')).toBe('variant_inactive');
  });

  it('모르는 값은 unknown 으로 낮춘다', () => {
    expect(toListingResolutionCause('listing_haunted')).toBe('unknown');
  });

  it('문자열이 아닌 값도 unknown 으로 낮춘다', () => {
    expect(toListingResolutionCause(null)).toBe('unknown');
    expect(toListingResolutionCause(undefined)).toBe('unknown');
    expect(toListingResolutionCause(42)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 --testPathPattern="listing-resolution-cause"`
Expected: FAIL — `Cannot find module './listing-resolution-cause'`

모듈 부재는 에러지 실패가 아니다. Step 3 에서 스텁을 먼저 만들고 어설션 단위 RED 를 다시 확인한다.

- [ ] **Step 3: 스텁을 만들어 어설션 단위 RED 를 본다**

`packages/domain-types/listing-resolution-cause.ts`:

```typescript
export const LISTING_RESOLUTION_CAUSES = [] as const;
export type ListingResolutionCause = string;
export function toListingResolutionCause(_value: unknown): ListingResolutionCause {
  return 'unknown';
}
export interface AffectedLine {
  lineId: string;
  cause: ListingResolutionCause;
}
```

Run: `npx jest --maxWorkers=2 --testPathPattern="listing-resolution-cause"`
Expected: FAIL 2건 — "9종을 모두 가진다"(빈 배열), "알려진 값은 그대로 통과시킨다"(`unknown` 반환)

- [ ] **Step 4: 최소 구현**

`packages/domain-types/listing-resolution-cause.ts` 전체를 아래로 교체:

```typescript
/**
 * 채널 주문 라인이 우리 판매상품 variant 로 해석되지 않은 이유 (#674).
 *
 * 가르는 기준은 "증상이 다른가" 가 아니라 **"운영자가 할 일이 다른가"** 다.
 *
 * | cause               | 조치                          |
 * |---------------------|-------------------------------|
 * | listing_not_found   | 리스팅을 만든다               |
 * | listing_inactive    | 리스팅을 켠다                 |
 * | channel_inactive    | 판매채널을 켠다               |
 * | variant_inactive    | 품목을 활성화한다             |
 * | no_active_version   | publish 한다                  |
 * | product_deleted     | 다른 상품으로 재매핑한다      |
 * | no_embedded_ids     | Core 를 통해 상품을 다시 만든다 |
 * | no_lookup_key       | 채널 데이터를 확인한다        |
 * | unknown             | 판정 불가 (구 Core 폴백·옛 행) |
 *
 * 전부 **Core 카탈로그 상태**에 대한 말이고 채널 특성이 아니다. 그래서 채널이 열 개가 돼도
 * 이 표는 안 늘어난다 — CONTEXT.md 의 "격리 큐는 채널 능력과 무관하게 하나다" 가 유지된다.
 */
export const LISTING_RESOLUTION_CAUSES = [
  'listing_not_found',
  'listing_inactive',
  'channel_inactive',
  'variant_inactive',
  'no_active_version',
  'product_deleted',
  'no_embedded_ids',
  'no_lookup_key',
  'unknown',
] as const;

export type ListingResolutionCause = (typeof LISTING_RESOLUTION_CAUSES)[number];

/**
 * 바깥에서 들어온 값을 어휘 안으로 좁힌다.
 *
 * 배포 순서가 Core → 어댑터라, 어댑터는 자기가 모르는 값을 받을 수 있다. 그대로 저장하면
 * 타입이 거짓말하고 화면이 렌더할 수 없는 값이 영속된다.
 */
export function toListingResolutionCause(value: unknown): ListingResolutionCause {
  return typeof value === 'string' && (LISTING_RESOLUTION_CAUSES as readonly string[]).includes(value)
    ? (value as ListingResolutionCause)
    : 'unknown';
}

/** 격리된 주문에서 식별에 실패한 라인 하나. */
export interface AffectedLine {
  lineId: string;
  cause: ListingResolutionCause;
}
```

- [ ] **Step 5: index 에서 내보낸다**

`packages/domain-types/index.ts` 의 export 목록에 한 줄 추가:

```typescript
export * from './listing-resolution-cause';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest --maxWorkers=2 --testPathPattern="listing-resolution-cause"`
Expected: PASS 4/4

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 7: Commit**

```bash
git add packages/domain-types/
git commit -m "feat(domain-types): 리스팅 해석 실패 사유 어휘를 정본 한 벌로 만든다 (#674)"
```

---

### Task 2: Core 진단 쿼리와 우선순위 판정

**Files:**
- Create: `apps/core/src/modules/catalog/core/channels/channel-listing-diagnosis.query.ts`
- Create: `apps/core/src/modules/catalog/core/channels/channel-listing-diagnosis.query.spec.ts`

**Interfaces:**
- Consumes: `ListingResolutionCause` (Task 1)
- Produces:
  - `interface ChannelListingDiagnosisRow { listingIsActive: boolean; channelIsActive: boolean; variantStatus: string | null; versionStatus: string | null; versionDeletedAt: Date | null; masterDeletedAt: Date | null; hasVersionLink: boolean }`
  - `function buildChannelListingDiagnosisQuery(client: DbClient, channelItemId: string, channelPredicate: SQL)`
  - `function causeFromDiagnosisRow(row: ChannelListingDiagnosisRow | undefined): ListingResolutionCause`

- [ ] **Step 1: Write the failing test**

`apps/core/src/modules/catalog/core/channels/channel-listing-diagnosis.query.spec.ts`:

```typescript
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { catalogSchema, salesChannels } from '../../schema/catalog.schema';
import { DbClient } from '../../catalog.types';
import {
  ChannelListingDiagnosisRow,
  buildChannelListingDiagnosisQuery,
  causeFromDiagnosisRow,
} from './channel-listing-diagnosis.query';

/**
 * 진단은 조회(`channel-listing-lookup.query.ts`)가 0행을 냈을 때만 돈다 (#674).
 *
 * 여기서는 DB 없이 두 가지를 지킨다.
 * 1. 진단 쿼리가 **sellable 술어를 걸지 않는다** — 걸면 진단도 0행이 되어 전부
 *    `listing_not_found` 로 오진한다.
 * 2. 진단 쿼리가 **LEFT JOIN 이다** — inner join 이면 `product_master_variants` 행이 없는
 *    리스팅이 0행을 내 역시 `listing_not_found` 로 오진한다.
 *
 * 우선순위는 순수 함수라 DB 가 필요 없다. 의미(정말 그 사유가 나오는가)는
 * `channel-listing-resolve.integration.spec.ts` 가 실 Postgres 로 본다.
 */
describe('채널 리스팅 진단 쿼리 (#674)', () => {
  const connection = postgres('postgres://spec:spec@127.0.0.1:1/none', { max: 1 });
  const client = drizzle(connection, { schema: catalogSchema }) as unknown as DbClient;

  afterAll(async () => {
    await connection.end({ timeout: 0 });
  });

  const sqlOf = () =>
    buildChannelListingDiagnosisQuery(client, 'item-1', eq(salesChannels.site, 'naver')).toSQL().sql;

  describe('쿼리 모양', () => {
    it('상태 술어를 하나도 걸지 않는다', () => {
      const sql = sqlOf();
      expect(sql).not.toContain('"product_variants"."status" = ');
      expect(sql).not.toContain('"product_master_versions"."status" = ');
      expect(sql).not.toContain('"sales_channels"."is_active" = ');
      expect(sql).not.toContain('"channel_variant_listings"."is_active" = ');
      expect(sql).not.toContain('deleted_at" is null');
    });

    it('버전 사슬을 LEFT JOIN 으로 붙인다', () => {
      const sql = sqlOf();
      expect(sql).toContain('left join "product_master_variants"');
      expect(sql).toContain('left join "product_master_versions"');
      expect(sql).toContain('left join "product_masters"');
    });

    it('리스팅과 채널로만 좁힌다', () => {
      const sql = sqlOf();
      expect(sql).toContain('"channel_variant_listings"."channel_item_id" = ');
      expect(sql).toContain('"sales_channels"."site" = ');
    });
  });

  describe('우선순위', () => {
    const healthy: ChannelListingDiagnosisRow = {
      listingIsActive: true,
      channelIsActive: true,
      variantStatus: 'active',
      versionStatus: 'active',
      versionDeletedAt: null,
      masterDeletedAt: null,
      hasVersionLink: true,
    };

    it('행이 없으면 listing_not_found', () => {
      expect(causeFromDiagnosisRow(undefined)).toBe('listing_not_found');
    });

    it('꺼진 리스팅은 listing_inactive', () => {
      expect(causeFromDiagnosisRow({ ...healthy, listingIsActive: false })).toBe('listing_inactive');
    });

    it('꺼진 채널은 channel_inactive', () => {
      expect(causeFromDiagnosisRow({ ...healthy, channelIsActive: false })).toBe('channel_inactive');
    });

    it('soft delete 된 마스터는 product_deleted', () => {
      expect(causeFromDiagnosisRow({ ...healthy, masterDeletedAt: new Date() })).toBe('product_deleted');
    });

    it('활성 아닌 버전은 no_active_version', () => {
      expect(causeFromDiagnosisRow({ ...healthy, versionStatus: 'draft' })).toBe('no_active_version');
    });

    it('어떤 버전에도 안 매달린 품목은 no_active_version', () => {
      expect(causeFromDiagnosisRow({ ...healthy, hasVersionLink: false, versionStatus: null })).toBe(
        'no_active_version',
      );
    });

    it('판매중지 품목은 variant_inactive', () => {
      expect(causeFromDiagnosisRow({ ...healthy, variantStatus: 'inactive' })).toBe('variant_inactive');
    });

    it('삭제가 판매중지보다 앞선다 — 조치가 재매핑 하나이기 때문', () => {
      expect(
        causeFromDiagnosisRow({ ...healthy, masterDeletedAt: new Date(), variantStatus: 'inactive' }),
      ).toBe('product_deleted');
    });

    it('리스팅 비활성이 채널 비활성보다 앞선다 — 더 좁은 조치가 먼저다', () => {
      expect(causeFromDiagnosisRow({ ...healthy, listingIsActive: false, channelIsActive: false })).toBe(
        'listing_inactive',
      );
    });

    it('전부 정상인데 조회가 0행이었다면 unknown', () => {
      // 여기 오면 sellable 조회와 진단이 어긋난 것이다. 사유를 지어내지 않는다.
      expect(causeFromDiagnosisRow(healthy)).toBe('unknown');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 --testPathPattern="channel-listing-diagnosis"`
Expected: FAIL — `Cannot find module './channel-listing-diagnosis.query'`

- [ ] **Step 3: 구현**

`apps/core/src/modules/catalog/core/channels/channel-listing-diagnosis.query.ts`:

```typescript
import { SQL, and, desc, eq, isNotNull } from 'drizzle-orm';
import type { ListingResolutionCause } from '@packages/domain-types';
import {
  channelVariantListings,
  productMasterVariants,
  productMasterVersions,
  productMasters,
  productVariants,
  salesChannels,
} from '../../schema/catalog.schema';
import { DbClient } from '../../catalog.types';

/** 진단 한 행. 술어를 걸지 않고 **상태를 그대로 실어 온다.** */
export interface ChannelListingDiagnosisRow {
  listingIsActive: boolean;
  channelIsActive: boolean;
  variantStatus: string | null;
  versionStatus: string | null;
  versionDeletedAt: Date | null;
  masterDeletedAt: Date | null;
  hasVersionLink: boolean;
}

/**
 * 조회가 0행을 냈을 때 **왜인지** 알아내는 쿼리 (#674).
 *
 * 두 가지가 필수다.
 * 1. **상태 술어를 하나도 걸지 않는다.** 걸면 진단도 0행이 되어 전부 `listing_not_found` 로
 *    오진한다 — 진단의 존재 이유가 사라진다.
 * 2. **버전 사슬은 LEFT JOIN 이다.** `product_master_variants` 행이 없는 품목(어떤 버전에도
 *    안 매달린 상태)이 inner join 에서 0행을 내 역시 `listing_not_found` 로 오진한다.
 *
 * 한 품목이 여러 버전에 매달릴 수 있으므로 조회와 같은 정렬로 하나를 고정한다. 어느 행을
 * 골라도 사유가 성립한다 — 성립하지 않는 행이 하나라도 있었다면 애초에 조회가 맞았을 것이다.
 */
export function buildChannelListingDiagnosisQuery(client: DbClient, channelItemId: string, channelPredicate: SQL) {
  return client
    .select({
      listingIsActive: channelVariantListings.isActive,
      channelIsActive: salesChannels.isActive,
      variantStatus: productVariants.status,
      versionStatus: productMasterVersions.status,
      versionDeletedAt: productMasterVersions.deletedAt,
      masterDeletedAt: productMasters.deletedAt,
      hasVersionLink: isNotNull(productMasterVariants.versionId),
    })
    .from(channelVariantListings)
    .innerJoin(salesChannels, eq(salesChannels.id, channelVariantListings.salesChannelId))
    .innerJoin(productVariants, eq(channelVariantListings.variantId, productVariants.id))
    .leftJoin(productMasterVariants, eq(productMasterVariants.variantId, productVariants.id))
    .leftJoin(productMasterVersions, eq(productMasterVariants.versionId, productMasterVersions.id))
    .leftJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
    .where(and(channelPredicate, eq(channelVariantListings.channelItemId, channelItemId)))
    .orderBy(desc(productMasterVersions.version), desc(productMasterVersions.createdAt))
    .limit(1);
}

/**
 * 우선순위 (여럿이 동시에 성립할 때):
 *
 * `listing_not_found` → `listing_inactive` → `channel_inactive`
 *   → `product_deleted` → `no_active_version` → `variant_inactive`
 *
 * - **삭제가 판매중지보다 앞이다**: 상품이 지워졌으면 품목 상태를 볼 의미가 없고 조치도
 *   재매핑 하나다.
 * - **리스팅 비활성이 채널 비활성보다 앞이다**: 더 좁은 조치(리스팅만 켜기)가 먼저다.
 */
export function causeFromDiagnosisRow(row: ChannelListingDiagnosisRow | undefined): ListingResolutionCause {
  if (!row) return 'listing_not_found';
  if (!row.listingIsActive) return 'listing_inactive';
  if (!row.channelIsActive) return 'channel_inactive';
  if (row.masterDeletedAt !== null || row.versionDeletedAt !== null) return 'product_deleted';
  if (!row.hasVersionLink || row.versionStatus !== 'active') return 'no_active_version';
  if (row.variantStatus !== 'active') return 'variant_inactive';
  // 여기 오면 sellable 조회와 진단이 어긋난 것이다. 사유를 지어내지 않는다.
  return 'unknown';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --maxWorkers=2 --testPathPattern="channel-listing-diagnosis"`
Expected: PASS 13/13

만약 `hasVersionLink` 어설션이 타입 에러를 내면 `isNotNull(...)` 대신
`sql<boolean>`&#96;${productMasterVariants.versionId} is not null&#96;.as('has_version_link')` 를 쓴다 (`sql` 을 drizzle-orm 에서 import).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/catalog/core/channels/channel-listing-diagnosis.query.ts \
        apps/core/src/modules/catalog/core/channels/channel-listing-diagnosis.query.spec.ts
git commit -m "feat(catalog): 리스팅 조회 실패 사유 진단 쿼리와 우선순위 (#674)"
```

---

### Task 3: Core 서비스 `resolveVariant*` 와 `/channel-listings/resolve`

**Files:**
- Modify: `apps/core/src/modules/catalog/core/channels/channel-listing.service.ts`
- Modify: `apps/core/src/modules/catalog/core/channels/channel-listing.controller.ts`
- Modify: `apps/core/src/modules/catalog/core/channels/dto/channel-listings/channel-listing-response.dto.ts`
- Create: `apps/core/src/modules/catalog/core/channels/channel-listing-resolve.integration.spec.ts`

**Interfaces:**
- Consumes: `buildChannelListingDiagnosisQuery`, `causeFromDiagnosisRow` (Task 2); `ListingResolutionCause` (Task 1)
- Produces:
  - `type ListingResolveResult = { found: true; listing: LookupVariantResult } | { found: false; cause: ListingResolutionCause }`
  - `ChannelListingService.resolveVariant(salesChannelId: string, channelItemId: string, tx?: DbTransaction): Promise<ListingResolveResult>`
  - `ChannelListingService.resolveVariantByChannelCode(channelCode: string, channelItemId: string, tx?: DbTransaction): Promise<ListingResolveResult>`
  - `GET /channel-listings/resolve` — 미스도 **200**

- [ ] **Step 1: Write the failing test**

`apps/core/src/modules/catalog/core/channels/channel-listing-resolve.integration.spec.ts`:

```typescript
// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { DbTransaction } from '../../catalog.types';
import {
  catalogSchema,
  channelVariantListings,
  productMasterVariants,
  productMasterVersions,
  productMasters,
  productVariants,
  salesChannels,
  type PimSchema,
} from '../../schema/catalog.schema';
import { ChannelListingService } from './channel-listing.service';

/**
 * 진단이 **정말 그 사유를 내는지**는 실 DB 로만 확인된다 (#674). 계약 스펙은 쿼리 모양만 본다.
 *
 * 실행: `npm run test:core:integration:local -- channel-listing-resolve`
 * 격리: 각 테스트가 트랜잭션을 열어 픽스처를 넣고 항상 롤백한다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('리스팅 해석 실패 사유 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: DbService<PimSchema>;
  let service: ChannelListingService;

  beforeAll(() => {
    const connection = postgres(DATABASE_URL as string, { max: 1 });
    sql = connection;
    const drizzleDb = drizzle(connection, { schema: catalogSchema });
    db = {
      db: drizzleDb,
      run: <T>(fn: (t: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> =>
        tx ? fn(tx) : drizzleDb.transaction((t) => fn(t)),
    } as unknown as DbService<PimSchema>;
    service = new ChannelListingService(db, {} as never);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 0 });
  });

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

  /** 마스터 1 + 버전 1 + 품목 1 + 리스팅 1. opts 로 한 축씩 망가뜨린다. */
  async function seed(
    tx: DbTransaction,
    opts: {
      versionStatus?: 'active' | 'inactive' | 'draft';
      versionDeleted?: boolean;
      masterDeleted?: boolean;
      listingActive?: boolean;
      channelActive?: boolean;
      variantStatus?: 'active' | 'inactive';
      linkVersion?: boolean;
    } = {},
  ) {
    const masterId = randomUUID();
    const variantId = randomUUID();
    const channelItemId = `item-${masterId.slice(0, 8)}`;

    await tx.insert(productMasters).values({
      id: masterId,
      createdBy: null,
      ...(opts.masterDeleted ? { deletedAt: new Date() } : {}),
    });
    const [version] = await tx
      .insert(productMasterVersions)
      .values({
        masterId,
        name: `해석-${masterId.slice(0, 8)}`,
        status: opts.versionStatus ?? 'active',
        ...(opts.versionDeleted ? { deletedAt: new Date() } : {}),
      })
      .returning({ id: productMasterVersions.id });

    await tx
      .insert(productVariants)
      .values({ id: variantId, isDefault: true, status: opts.variantStatus ?? 'active' });

    if (opts.linkVersion !== false) {
      await tx.insert(productMasterVariants).values({ masterId, variantId, versionId: version.id });
    }

    const site = `spec-${masterId.slice(0, 8)}`;
    const [channel] = await tx
      .insert(salesChannels)
      .values({ site, name: '스펙 채널', isActive: opts.channelActive ?? true })
      .returning({ id: salesChannels.id });

    await tx.insert(channelVariantListings).values({
      variantId,
      salesChannelId: channel.id,
      channelItemId,
      isActive: opts.listingActive ?? true,
    });

    return { site, channelItemId, variantId };
  }

  it('정상이면 found: true 와 매핑을 준다', async () => {
    const out = await inRollbackTx(async (tx) => {
      const { site, channelItemId, variantId } = await seed(tx);
      return { result: await service.resolveVariantByChannelCode(site, channelItemId, tx), variantId };
    });
    expect(out.result.found).toBe(true);
    if (out.result.found) expect(out.result.listing.variantId).toBe(out.variantId);
  });

  it('매핑이 없으면 listing_not_found', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site } = await seed(tx);
      return service.resolveVariantByChannelCode(site, 'item-does-not-exist', tx);
    });
    expect(result).toEqual({ found: false, cause: 'listing_not_found' });
  });

  it('꺼진 리스팅은 listing_inactive', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { listingActive: false });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'listing_inactive' });
  });

  it('꺼진 채널은 channel_inactive', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { channelActive: false });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'channel_inactive' });
  });

  it('판매중지 품목은 variant_inactive', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { variantStatus: 'inactive' });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'variant_inactive' });
  });

  it('draft 버전만 있으면 no_active_version', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { versionStatus: 'draft' });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'no_active_version' });
  });

  it('어떤 버전에도 안 매달린 품목은 no_active_version', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { linkVersion: false });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'no_active_version' });
  });

  it('soft delete 된 마스터는 product_deleted', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { masterDeleted: true });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'product_deleted' });
  });

  it('삭제와 판매중지가 겹치면 product_deleted 가 이긴다', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { masterDeleted: true, variantStatus: 'inactive' });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'product_deleted' });
  });

  it('판매채널 ID 진입점도 같은 사유를 낸다', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { variantStatus: 'inactive' });
      const [channel] = await tx
        .select({ id: salesChannels.id })
        .from(salesChannels)
        .where(eq(salesChannels.site, site))
        .limit(1);
      return service.resolveVariant(channel.id, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'variant_inactive' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:core:integration:local -- channel-listing-resolve`
Expected: FAIL — `service.resolveVariantByChannelCode is not a function`

- [ ] **Step 3: 서비스에 두 메서드를 더한다**

`channel-listing.service.ts` 상단 import 에 추가:

```typescript
import type { ListingResolutionCause } from '@packages/domain-types';
import {
  ChannelListingDiagnosisRow,
  buildChannelListingDiagnosisQuery,
  causeFromDiagnosisRow,
} from './channel-listing-diagnosis.query';
```

`LookupVariantResult` 인터페이스 바로 아래에 타입 추가:

```typescript
/**
 * 해석 결과 (#674). 미스도 **본문을 가진 값**이다 — 옛 `/lookup` 의 `null`/204 와 다르다.
 */
export type ListingResolveResult =
  | { found: true; listing: LookupVariantResult }
  | { found: false; cause: ListingResolutionCause };
```

`lookupVariantByChannelCode` 아래에 세 메서드 추가:

```typescript
  /**
   * 판매채널 ID 진입점의 해석 (#674).
   */
  async resolveVariant(
    salesChannelId: string,
    channelItemId: string,
    tx?: DbTransaction,
  ): Promise<ListingResolveResult> {
    return this.resolveWith(eq(channelVariantListings.salesChannelId, salesChannelId), channelItemId, tx);
  }

  /**
   * 채널 코드(site) 진입점의 해석. **주문 수집이 실제로 타는 경로다.**
   */
  async resolveVariantByChannelCode(
    channelCode: string,
    channelItemId: string,
    tx?: DbTransaction,
  ): Promise<ListingResolveResult> {
    return this.resolveWith(eq(salesChannels.site, channelCode), channelItemId, tx);
  }

  /**
   * 진단은 **미스 경로에서만** 돈다 — 성공 경로의 비용은 그대로다.
   */
  private async resolveWith(
    channelPredicate: SQL,
    channelItemId: string,
    tx?: DbTransaction,
  ): Promise<ListingResolveResult> {
    const client = this.getClient(tx);

    const found = await buildChannelListingLookupQuery(client, channelItemId, channelPredicate);
    if (found[0]) {
      return { found: true, listing: found[0] };
    }

    const diagnosis = await buildChannelListingDiagnosisQuery(client, channelItemId, channelPredicate);
    return { found: false, cause: causeFromDiagnosisRow(diagnosis[0] as ChannelListingDiagnosisRow | undefined) };
  }
```

`SQL` 타입이 아직 import 되어 있지 않으면 `import { SQL, and, eq, ... } from 'drizzle-orm'` 에 더한다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:core:integration:local -- channel-listing-resolve`
Expected: PASS 10/10

- [ ] **Step 5: 응답 DTO 를 만든다**

`dto/channel-listings/channel-listing-response.dto.ts` 끝에 추가:

```typescript
export class ResolveChannelListingResponseDto {
  @ApiProperty({ description: '매핑 해석 성공 여부' })
  found: boolean;

  @ApiProperty({ description: '해석된 매핑 (found=true 일 때만)', required: false, type: LookupChannelListingResponseDto })
  listing?: LookupChannelListingResponseDto;

  @ApiProperty({
    description: '해석 실패 사유 (found=false 일 때만). 어휘 정본은 @packages/domain-types',
    required: false,
    enum: LISTING_RESOLUTION_CAUSES,
  })
  cause?: ListingResolutionCause;
}
```

같은 파일 상단에 import 추가:

```typescript
import { LISTING_RESOLUTION_CAUSES, type ListingResolutionCause } from '@packages/domain-types';
```

`dto/channel-listings/index.ts` (또는 그 폴더의 배럴 파일) 이 `export *` 라면 추가 작업 없음. 명시 목록이면 `ResolveChannelListingResponseDto` 를 더한다.

- [ ] **Step 6: 컨트롤러에 엔드포인트를 더한다**

`channel-listing.controller.ts` 의 `lookup` 핸들러 **바로 아래**에 추가:

```typescript
  @Get('resolve')
  @Public()
  @ApiOperation({
    summary: '채널 상품 ID로 Variant 해석 (사유 포함)',
    description:
      '`/lookup` 과 같은 조회에 **실패 사유**를 붙여 돌려준다. 미스도 204 가 아니라 200 이며 ' +
      '`{ found: false, cause }` 본문을 갖는다. `/lookup` 은 미스가 204 라 같은 경로를 200 으로 ' +
      '바꾸면 옛 클라이언트가 본문을 매핑으로 오독한다 — 그래서 경로를 나눴다 (#674).',
  })
  @ApiQuery({ name: 'salesChannelId', required: false, description: '판매 채널 ID (UUID)' })
  @ApiQuery({ name: 'channelCode', required: false, description: '채널 코드 (site). salesChannelId 대신 사용 가능' })
  @ApiQuery({ name: 'channelItemId', required: true, description: '채널에서의 상품 ID' })
  @ApiResponse({ status: 200, description: '해석 결과 (성공·실패 모두)', type: ResolveChannelListingResponseDto })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async resolve(
    @Query('salesChannelId') salesChannelId?: string,
    @Query('channelCode') channelCode?: string,
    @Query('channelItemId') channelItemId?: string,
  ): Promise<ResolveChannelListingResponseDto> {
    if (!channelItemId) {
      throw new BadRequestException('channelItemId is required');
    }
    if (!salesChannelId && !channelCode) {
      throw new BadRequestException('Either salesChannelId or channelCode is required');
    }

    const result = salesChannelId
      ? await this.channelListingService.resolveVariant(salesChannelId, channelItemId)
      : await this.channelListingService.resolveVariantByChannelCode(channelCode!, channelItemId);

    return result.found ? { found: true, listing: result.listing } : { found: false, cause: result.cause };
  }
```

컨트롤러 상단 import 목록의 `./dto` 블록에 `ResolveChannelListingResponseDto` 를 더한다.

⚠️ **`@Get('resolve')` 는 `@Get(':id')` 류의 와일드카드 라우트보다 먼저 선언되어야 한다.** 이 컨트롤러의 `lookup` 이 이미 그 위치에 있으므로 바로 아래에 두면 안전하다.

- [ ] **Step 7: 게이트**

Run: `npm run type-check`
Expected: 에러 0

Run: `npx jest --maxWorkers=2 --testPathPattern="channel-listing"`
Expected: 실패 0

Run: `npm run test:core:integration:local -- channel-listing`
Expected: 실패 0 (기존 19 + 신규 10)

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/modules/catalog/core/channels/
git commit -m "feat(catalog): /channel-listings/resolve 로 해석 실패 사유를 준다 (#674)"
```

---

### Task 4: 어댑터 클라이언트 `/resolve` + 404 폴백

**Files:**
- Modify: `apps/channel-adapter/src/services/clients/channel-listing.client.ts`
- Create: `apps/channel-adapter/src/services/clients/channel-listing-resolve.client.spec.ts`

**Interfaces:**
- Consumes: `GET /channel-listings/resolve` (Task 3); `ListingResolutionCause`, `toListingResolutionCause` (Task 1)
- Produces:
  - `type ListingResolveResult = { found: true; listing: LookupVariantResult } | { found: false; cause: ListingResolutionCause }` — Core 쪽 동명 타입과 **의도적으로 같은 이름**이다. 두 서비스가 HTTP 로만 묶여 있어 타입을 공유하지 않지만(이 저장소는 `LookupVariantResult` 도 같은 방식으로 양쪽에 둔다), 이름까지 갈리면 대응 관계가 안 보인다
  - `ChannelListingClient.resolveByChannelCode(channelCode: string, channelItemId: string): Promise<ListingResolveResult>`

- [ ] **Step 1: Write the failing test**

`apps/channel-adapter/src/services/clients/channel-listing-resolve.client.spec.ts`:

```typescript
import { of, throwError } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { ChannelListingClient } from './channel-listing.client';

/**
 * 배포 순서는 Core → 어댑터지만, **Core 를 롤백하면 순서가 뒤집힌다.** 그때
 * `/resolve` 는 404 다. 폴백이 없으면 그 순간 모든 라인 해석이 예외가 되어 수집이 통째로
 * 멈춘다 — 사유를 얻으려다 수집을 잃는 것은 명백한 퇴행이다 (#674).
 */
describe('ChannelListingClient.resolveByChannelCode (#674)', () => {
  const listing = {
    masterId: 'm1',
    versionId: 'v1',
    productName: '상품',
    variantId: 'var1',
    variantCode: null,
    variantName: null,
    isActive: true,
  };

  function clientWith(get: jest.Mock): ChannelListingClient {
    const http = { get } as unknown as HttpService;
    const config = { get: () => 'http://core.test' } as unknown as ConfigService;
    return new ChannelListingClient(http, config);
  }

  it('성공하면 found: true 와 매핑을 준다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { found: true, listing } }));
    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');
    expect(result).toEqual({ found: true, listing });
  });

  it('실패 사유를 그대로 전달한다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { found: false, cause: 'variant_inactive' } }));
    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');
    expect(result).toEqual({ found: false, cause: 'variant_inactive' });
  });

  it('모르는 사유는 unknown 으로 낮춘다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { found: false, cause: 'from_the_future' } }));
    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');
    expect(result).toEqual({ found: false, cause: 'unknown' });
  });

  it('/resolve 가 404 면 /lookup 으로 폴백한다 — 매핑이 있으면 found: true', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })))
      .mockReturnValueOnce(of({ status: 200, data: listing }));

    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');

    expect(result).toEqual({ found: true, listing });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][0]).toContain('/channel-listings/resolve');
    expect(get.mock.calls[1][0]).toContain('/channel-listings/lookup');
  });

  it('폴백에서 매핑이 없으면 사유를 지어내지 않고 unknown 이다', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })))
      .mockReturnValueOnce(of({ status: 204, data: null }));

    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');

    expect(result).toEqual({ found: false, cause: 'unknown' });
  });

  it('404 가 아닌 오류는 삼키지 않는다', async () => {
    const get = jest.fn().mockReturnValue(throwError(() => ({ response: { status: 500 }, message: 'boom' })));
    await expect(clientWith(get).resolveByChannelCode('naver', 'item-1')).rejects.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 --testPathPattern="channel-listing-resolve.client"`
Expected: FAIL — `client.resolveByChannelCode is not a function`

- [ ] **Step 3: 구현**

`channel-listing.client.ts` 상단 import 에 추가:

```typescript
import { type ListingResolutionCause, toListingResolutionCause } from '@packages/domain-types';
```

`LookupVariantResult` 인터페이스 아래에 추가:

```typescript
/** Core `/channel-listings/resolve` 의 응답 (#674). Core 쪽 동명 타입과 짝이다. */
export type ListingResolveResult =
  | { found: true; listing: LookupVariantResult }
  | { found: false; cause: ListingResolutionCause };
```

`lookupByChannelCode` 메서드 **아래**에 추가:

```typescript
  /**
   * 채널 코드 + 채널 상품 ID 로 Variant 를 **사유와 함께** 해석한다 (#674).
   *
   * Core 가 아직 `/resolve` 를 모르면(배포 순서가 뒤집혔거나 롤백됐으면) 404 가 온다. 그때
   * 옛 `/lookup` 으로 폴백한다 — 사유를 얻으려다 수집을 통째로 멈추는 건 명백한 퇴행이다.
   * 폴백 경로에서는 사유를 알 길이 없으므로 지어내지 않고 `unknown` 이다.
   *
   * 폴백 제거는 Core 배포가 안정된 뒤 후속 PR.
   */
  async resolveByChannelCode(channelCode: string, channelItemId: string): Promise<ListingResolveResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ found: boolean; listing?: LookupVariantResult; cause?: unknown }>(
          `${this.pimBaseUrl}/channel-listings/resolve`,
          { params: { channelCode, channelItemId }, timeout: 5000 },
        ),
      );

      const body = response.data;
      if (body?.found && body.listing) {
        return { found: true, listing: body.listing };
      }
      return { found: false, cause: toListingResolutionCause(body?.cause) };
    } catch (error: any) {
      if (error.response?.status !== 404) {
        this.logger.error(`❌ 채널 매핑 해석 실패: ${channelCode}/${channelItemId}`, error.message);
        throw error;
      }

      this.logger.warn(`/resolve 가 없어 /lookup 으로 폴백한다 (Core 가 구버전): ${channelCode}/${channelItemId}`);
      const listing = await this.lookupByChannelCode(channelCode, channelItemId);
      return listing ? { found: true, listing } : { found: false, cause: 'unknown' };
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 --testPathPattern="channel-listing-resolve.client"`
Expected: PASS 6/6

- [ ] **Step 5: Commit**

```bash
git add apps/channel-adapter/src/services/clients/
git commit -m "feat(channel-adapter): /resolve 로 사유를 받고 404 는 /lookup 으로 폴백한다 (#674)"
```

---

### Task 5: 어댑터 전파 — resolver 유니온과 translator 수집

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/channel-line-identity.resolver.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts`
- Create: `apps/channel-adapter/src/services/order-collection/channel-line-identity-cause.spec.ts`

**Interfaces:**
- Consumes: `ChannelListingClient.resolveByChannelCode` (Task 4); `AffectedLine`, `ListingResolutionCause` (Task 1)
- Produces:
  - `type LineResolution = { identified: true; identity: ResolvedLineIdentity } | { identified: false; cause: ListingResolutionCause }`
  - `ChannelLineIdentityResolver.resolve(channel, line): Promise<LineResolution>` — **반환 타입이 바뀐다**
  - `OrderCollectionFailureItem.affectedLines?: AffectedLine[]`

- [ ] **Step 1: Write the failing test**

`apps/channel-adapter/src/services/order-collection/channel-line-identity-cause.spec.ts`:

```typescript
import { ChannelLineIdentityResolver } from './channel-line-identity.resolver';
import type { ChannelListingClient } from '../clients/channel-listing.client';
import type { ChannelOrderLineSnapshot } from './channel-order-source.interface';

/**
 * 해석 실패는 예외가 아니라 **사유를 실은 값**이다 (#674). 전에는 `null` 이라 호출자가
 * "왜" 를 알 수 없었고, 격리 행에는 사유가 한 종류뿐이라 운영자도 알 수 없었다.
 */
describe('ChannelLineIdentityResolver 사유 (#674)', () => {
  function line(overrides: Partial<ChannelOrderLineSnapshot> = {}): ChannelOrderLineSnapshot {
    return { channelOrderItemId: 'L1', quantity: 1, unitPrice: 1000, ...overrides } as ChannelOrderLineSnapshot;
  }

  function resolverWith(resolveByChannelCode: jest.Mock): ChannelLineIdentityResolver {
    return new ChannelLineIdentityResolver({ resolveByChannelCode } as unknown as ChannelListingClient);
  }

  it('embedded 채널에서 식별자 3종이 없으면 no_embedded_ids', async () => {
    const resolver = resolverWith(jest.fn());
    const result = await resolver.resolve('medusa', line({ embeddedVariantId: 'v1' }));
    expect(result).toEqual({ identified: false, cause: 'no_embedded_ids' });
  });

  it('embedded 채널에서 식별자 3종이 다 있으면 식별된다', async () => {
    const resolver = resolverWith(jest.fn());
    const result = await resolver.resolve(
      'medusa',
      line({ embeddedVariantId: 'v1', embeddedMasterId: 'm1', embeddedVersionId: 'ver1' }),
    );
    expect(result.identified).toBe(true);
  });

  it('리스팅 채널에서 조회 키가 없으면 no_lookup_key — Core 를 부르지 않는다', async () => {
    const resolveByChannelCode = jest.fn();
    const resolver = resolverWith(resolveByChannelCode);
    const result = await resolver.resolve('naver', line({ channelOrderItemId: '', channelProductId: '' }));
    expect(result).toEqual({ identified: false, cause: 'no_lookup_key' });
    expect(resolveByChannelCode).not.toHaveBeenCalled();
  });

  it('Core 가 준 사유를 그대로 올린다', async () => {
    const resolveByChannelCode = jest.fn().mockResolvedValue({ found: false, cause: 'variant_inactive' });
    const resolver = resolverWith(resolveByChannelCode);
    const result = await resolver.resolve('naver', line({ channelProductId: 'P1' }));
    expect(result).toEqual({ identified: false, cause: 'variant_inactive' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 --testPathPattern="channel-line-identity-cause"`
Expected: FAIL — `resolve` 가 `ResolvedLineIdentity | null` 을 돌려주므로 `toEqual({identified:...})` 불일치

- [ ] **Step 3: resolver 를 유니온으로 바꾼다**

`channel-line-identity.resolver.ts`:

상단 import 에 추가:

```typescript
import type { ListingResolutionCause } from '@packages/domain-types';
```

`ResolvedLineIdentity` 인터페이스 아래에 추가:

```typescript
/**
 * **판별 유니온이다.** 전에는 실패가 `null` 이라 "왜" 가 사라졌다 — 이 파일의
 * `OrderLifecycleEventItem` 주석이 말하는 것과 같은 실패 모드다(계약이 잡아 줄 것을
 * 호출부의 추측으로 덮기).
 */
export type LineResolution =
  | { identified: true; identity: ResolvedLineIdentity }
  | { identified: false; cause: ListingResolutionCause };
```

`resolve` 를 아래로 교체:

```typescript
  async resolve(channel: SalesChannel, line: ChannelOrderLineSnapshot): Promise<LineResolution> {
    const capabilities = getChannelCapabilities(channel);
    if (!capabilities || capabilities.integration !== 'api') {
      this.logger.warn(`No order-collection capability registered for channel ${channel}`);
      return { identified: false, cause: 'unknown' };
    }

    if (capabilities.lineIdentity === 'embedded') {
      return this.fromEmbedded(line);
    }
    return this.fromChannelListing(channel, line);
  }
```

`fromEmbedded` 를 아래로 교체:

```typescript
  private fromEmbedded(line: ChannelOrderLineSnapshot): LineResolution {
    const variantId = nonEmpty(line.embeddedVariantId);
    const masterId = nonEmpty(line.embeddedMasterId);
    const versionId = nonEmpty(line.embeddedVersionId);
    if (!variantId || !masterId || !versionId) {
      return { identified: false, cause: 'no_embedded_ids' };
    }
    return { identified: true, identity: { variantId, masterId, versionId } };
  }
```

`fromChannelListing` 를 아래로 교체:

```typescript
  private async fromChannelListing(
    channel: SalesChannel,
    line: ChannelOrderLineSnapshot,
  ): Promise<LineResolution> {
    const lookupId = nonEmpty(line.channelProductId) ?? nonEmpty(line.channelOrderItemId);
    if (!lookupId) {
      return { identified: false, cause: 'no_lookup_key' };
    }

    const resolution = await this.channelListingClient.resolveByChannelCode(channel, lookupId);
    if (!resolution.found) {
      return { identified: false, cause: resolution.cause };
    }

    return {
      identified: true,
      identity: {
        variantId: resolution.listing.variantId,
        masterId: resolution.listing.masterId,
        versionId: resolution.listing.versionId,
        productName: nonEmpty(resolution.listing.productName),
      },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 --testPathPattern="channel-line-identity-cause"`
Expected: PASS 4/4

- [ ] **Step 5: 실패 항목 계약에 `affectedLines` 를 더한다**

`channel-order-provider.interface.ts` 상단 import 에 추가:

```typescript
import type { AffectedLine } from '@packages/domain-types';
```

`OrderCollectionFailureItem` 을 아래로 교체:

```typescript
export interface OrderCollectionFailureItem {
  externalOrderId: string;
  sourceUpdatedAt: string;
  reason: OrderCollectionFailureReason;
  affectedLineIds: string[];
  /**
   * 라인별 실패 사유 (#674). `channel_product_identification_failed` 에서만 채워진다 —
   * `collected_order_modification_not_accepted` 는 식별 문제가 아니라 사유가 없다.
   *
   * `reason` 을 쪼개지 않고 여기 담는 이유: 사유는 **라인 단위**인데 `reason` 은 주문당 한
   * 칸이라, 거기 넣으면 라인이 여럿일 때 나머지 사유가 유실된다. 또 `reason` 은
   * `uq_order_collection_failure` 의 일부라 값이 바뀌면 같은 주문에 행이 하나 더 생긴다.
   */
  affectedLines?: AffectedLine[];
  rawOrder: Record<string, unknown>;
}
```

- [ ] **Step 6: translator 가 사유를 모으게 한다**

`channel-order.translator.ts` 의 `translate` 안에서, `identities` 계산부터 격리 반환까지를 아래로 교체:

```typescript
    const resolutions = await Promise.all(
      snapshot.lines.map((line) => this.identityResolver.resolve(channel, line)),
    );

    // 유료 주문 라인이 미식별이면 조용히 넘기지 않고 격리한다 (CONTEXT §채널 상품 식별 실패).
    // 이미 종결된 스냅샷(취소/환불 관측)은 판매주문을 만들지 않으므로 식별을 요구하지 않는다.
    const unidentified = snapshot.lines.flatMap((line, index) => {
      const resolution = resolutions[index];
      return resolution.identified ? [] : [{ lineId: line.channelOrderItemId, cause: resolution.cause }];
    });

    if (eligibleForOrderCreation && unidentified.length > 0) {
      return {
        outcome: {
          kind: 'failure',
          failure: {
            externalOrderId: snapshot.externalOrderId,
            sourceUpdatedAt: snapshot.sourceUpdatedAt,
            reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
            affectedLineIds: unidentified.map((line) => line.lineId),
            affectedLines: unidentified,
            rawOrder: snapshot.raw,
          } satisfies OrderCollectionFailureItem,
        },
        lifecycle,
      };
    }

    const items = snapshot.lines.map((line, index) => {
      const resolution = resolutions[index];
      return this.buildOrderItem(line, resolution.identified ? resolution.identity : null);
    });
```

`buildOrderItem` 의 두 번째 매개변수 타입이 `ResolvedLineIdentity | null` 인지 확인한다. 아니면 그렇게 맞춘다.

- [ ] **Step 7: 게이트**

Run: `npm run type-check`
Expected: 에러 0. 에러가 나면 대부분 `resolve()` 의 옛 `null` 비교가 남은 곳이다 — 전부 유니온으로 고친다.

Run: `npx jest --maxWorkers=2 --testPathPattern="channel-order|channel-line-identity"`
Expected: 실패 0. 기존 translator 스펙이 `resolve` 목을 `null`/객체로 두고 있으면 유니온 모양으로 고친다.

- [ ] **Step 8: Commit**

```bash
git add apps/channel-adapter/src/services/order-collection/
git commit -m "feat(channel-adapter): 라인 해석 실패를 사유 실은 유니온으로 올린다 (#674)"
```

---

### Task 6: 저장 — 마이그레이션과 `recordFailure`

**Files:**
- Modify: `apps/channel-adapter/src/schema.ts:218-255`
- Create: `apps/channel-adapter/drizzle/<timestamp>_add-affected-lines.sql` (생성됨)
- Modify: `apps/channel-adapter/src/services/order-collection/order-collection-failure.service.ts`
- Create: `apps/channel-adapter/src/services/order-collection/order-collection-failure-cause.integration.spec.ts`

**Interfaces:**
- Consumes: `OrderCollectionFailureItem.affectedLines` (Task 5); `AffectedLine` (Task 1)
- Produces: `order_collection_failures.affected_lines` jsonb nullable

- [ ] **Step 1: Write the failing test**

`apps/channel-adapter/src/services/order-collection/order-collection-failure-cause.integration.spec.ts`:

```typescript
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { OrderCollectionFailureService } from './order-collection-failure.service';
import { CHANNEL_PRODUCT_IDENTIFICATION_FAILED } from './channel-order-provider.interface';
import { orderCollectionFailures } from '../../schema';

/**
 * 사유는 **폴링마다 달라진다** — 매핑을 만들면 `listing_not_found` → `variant_inactive` 로
 * 바뀐다. 그때 행이 하나로 유지되는지가 이 설계의 핵심이다 (#674).
 *
 * `reason` 을 쪼갰다면 `uq_order_collection_failure` 가 `(channel, external_order_id, reason)`
 * 이므로 같은 주문에 행이 두 개 생기고 옛 행이 `quarantined` 로 영원히 남았을 것이다. 그
 * 사실은 실 Postgres 로만 증명된다.
 *
 * 실행:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
 *   npx jest --runInBand apps/channel-adapter/src/services/order-collection/order-collection-failure-cause.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('격리 사유 갱신 (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: ReturnType<typeof postgres>;
  let service: OrderCollectionFailureService;
  let db: ReturnType<typeof drizzle>;
  const channels: string[] = [];

  const newChannel = () => {
    const channel = `spec-${Math.random().toString(36).slice(2, 10)}`;
    channels.push(channel);
    return channel;
  };

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    service = new OrderCollectionFailureService({ db } as never);
  });

  afterAll(async () => {
    for (const channel of channels) {
      await db.delete(orderCollectionFailures).where(eq(orderCollectionFailures.channel, channel));
    }
    await client.end({ timeout: 0 });
  });

  function failure(lines: { lineId: string; cause: string }[]) {
    return {
      externalOrderId: 'ORDER-1',
      sourceUpdatedAt: new Date().toISOString(),
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: lines.map((line) => line.lineId),
      affectedLines: lines,
      rawOrder: { hello: 'world' },
    } as never;
  }

  it('사유를 그대로 저장한다', async () => {
    const channel = newChannel();
    const record = await service.recordFailure(channel, failure([{ lineId: 'L1', cause: 'listing_not_found' }]));
    expect(record.affectedLines).toEqual([{ lineId: 'L1', cause: 'listing_not_found' }]);
  });

  it('사유가 바뀌어도 행은 하나로 유지되고 갱신된다', async () => {
    const channel = newChannel();
    await service.recordFailure(channel, failure([{ lineId: 'L1', cause: 'listing_not_found' }]));
    await service.recordFailure(channel, failure([{ lineId: 'L1', cause: 'variant_inactive' }]));

    const rows = await db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(eq(orderCollectionFailures.channel, channel), eq(orderCollectionFailures.externalOrderId, 'ORDER-1')),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].affectedLines).toEqual([{ lineId: 'L1', cause: 'variant_inactive' }]);
  });

  it('목록 조회에도 사유가 실린다 — 화면(#640)이 읽을 자리다', async () => {
    const channel = newChannel();
    await service.recordFailure(channel, failure([{ lineId: 'L1', cause: 'no_active_version' }]));

    const listed = await service.list({ channel });

    expect(listed).toHaveLength(1);
    expect(listed[0].affectedLines).toEqual([{ lineId: 'L1', cause: 'no_active_version' }]);
  });

  it('사유가 없는 실패는 null 로 남는다', async () => {
    const channel = newChannel();
    const record = await service.recordFailure(channel, {
      externalOrderId: 'ORDER-1',
      sourceUpdatedAt: new Date().toISOString(),
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: ['L1'],
      rawOrder: {},
    } as never);
    expect(record.affectedLines).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
  npx jest --runInBand apps/channel-adapter/src/services/order-collection/order-collection-failure-cause.integration.spec.ts
```

Expected: FAIL — `affectedLines` 가 스키마에 없다 (타입/컬럼 에러)

- [ ] **Step 3: 스키마에 컬럼을 더한다**

`apps/channel-adapter/src/schema.ts` 상단 import 에 추가:

```typescript
import type { AffectedLine } from '@packages/domain-types';
```

`orderCollectionFailures` 의 `affectedLineIds` **바로 아래**에 추가:

```typescript
    /**
     * 라인별 실패 사유 (#674). nullable 이다 — 옛 행과
     * `collected_order_modification_not_accepted` 행은 사유를 모르는 게 사실이므로
     * 지어내지 않는다. `affected_line_ids` 는 두 사유가 함께 쓰므로 그대로 둔다(rename 아님).
     */
    affectedLines: jsonb('affected_lines').$type<AffectedLine[]>(),
```

- [ ] **Step 4: 마이그레이션 생성**

```bash
npm run db:generate:channel-adapter -- --name add-affected-lines
```

생성된 `apps/channel-adapter/drizzle/<timestamp>_add-affected-lines.sql` 을 열어 **`ADD COLUMN` 한 줄뿐인지** 확인한다. `DROP` / `NOT NULL` 이 섞여 있으면 스키마 편집이 잘못된 것이다 — 파일을 `git rm` 하고 스키마를 고친 뒤 다시 생성한다.

파일 맨 위에 주석을 붙인다:

```sql
-- 격리 사유를 라인 단위로 담는다 (#674).
--
-- nullable 인 이유: 옛 행과 `collected_order_modification_not_accepted` 행은 사유를 모른다.
-- 백필하지 않는다 — 사후에 사유를 만들어내는 것보다 "판정 불가" 가 정직하다.
--
-- additive 이므로 **`migrate` 가 `deploy` 앞이다** (ADR-0005 §5 expand phase). 새 컬럼을
-- 읽고 쓰는 코드가 컬럼보다 먼저 뜨면 깨진다.
```

- [ ] **Step 5: 로컬 DB 에 적용**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
  npx drizzle-kit migrate --config apps/channel-adapter/drizzle.config.ts
```

- [ ] **Step 6: `recordFailure` 가 쓰고 갱신하게 한다**

`order-collection-failure.service.ts` 의 `values` 객체에서 `affectedLineIds` 아래에 추가:

```typescript
      affectedLines: failure.affectedLines ?? null,
```

같은 파일 `onConflictDoUpdate` 의 `set` 객체에서 `affectedLineIds` 아래에 추가:

```typescript
            affectedLines: values.affectedLines,
```

⚠️ **`set` 에 넣는 것이 이 태스크의 핵심이다.** 빠뜨리면 첫 폴링의 사유가 굳어, 매핑을 만든 뒤에도 화면이 `listing_not_found` 를 계속 보여준다.

- [ ] **Step 7: Run test to verify it passes**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
  npx jest --runInBand apps/channel-adapter/src/services/order-collection/order-collection-failure-cause.integration.spec.ts
```

Expected: PASS 4/4

- [ ] **Step 8: 게이트**

Run: `npm run type-check`
Expected: 에러 0

Run: `npx jest --maxWorkers=2`
Expected: 실패 0

- [ ] **Step 9: Commit**

```bash
git add apps/channel-adapter/src/schema.ts \
        apps/channel-adapter/drizzle/ \
        apps/channel-adapter/src/services/order-collection/
git commit -m "feat(channel-adapter): 격리 행에 라인별 사유를 적재한다 (#674)"
```

---

### Task 7: CONTEXT.md 를 사유별 조치표로 고친다

**Files:**
- Modify: `CONTEXT.md:230-236`

**Interfaces:**
- Consumes: Task 1 의 어휘
- Produces: 없음 (문서)

- [ ] **Step 1: 현재 문장을 확인한다**

Run: `sed -n '230,236p' CONTEXT.md`

`- **격리 큐는 채널 능력과 무관하게 하나다.** …` 로 시작하는 줄에 *"해소 수단도 하나다 — 리스팅을 만들면 격리된 주문이 재처리된다."* 가 들어 있다.

- [ ] **Step 2: 그 줄을 교체한다**

해당 한 줄을 아래 두 줄로 바꾼다:

```markdown
- **격리 큐는 채널 능력과 무관하게 하나다.** Medusa 의 식별 실패(metadata·리스팅 둘 다 없음)와 네이버·쿠팡의 미매핑([[채널 리스팅]] 없음)은 같은 운영 문제이므로 같은 큐·같은 화면에서 해소한다.
- **해소 수단은 하나가 아니다.** 리스팅 조회가 버전·품목·채널 세 축을 보므로(#670) 조치가 갈린다 — 격리 행의 `affected_lines[].cause` 가 라인마다 무엇을 해야 하는지 말한다: `listing_not_found`→리스팅 생성 · `listing_inactive`→리스팅 활성화 · `channel_inactive`→채널 활성화 · `variant_inactive`→품목 활성화 · `no_active_version`→publish · `product_deleted`→다른 상품으로 재매핑 · `no_embedded_ids`→Core 를 통해 상품 재생성 · `no_lookup_key`→채널 데이터 확인 · `unknown`→판정 불가. 어휘 정본은 `@packages/domain-types` 다 (#674).
```

- [ ] **Step 3: Commit**

```bash
git add CONTEXT.md
git commit -m "docs(context): 격리 해소 수단이 하나가 아님을 적는다 (#670, #674)"
```

---

## 알려진 한계 (구현하지 않는다)

- **판매채널 행 자체가 없을 때** `listing_not_found` 로 보고된다. 실제 조치는 "채널을 먼저 만든다" 라 미묘하게 다르지만, `site` 어휘가 4종으로 닫혀 있고 채널 생성은 리스팅 생성의 선행이라 실무상 같은 흐름이다. 별도 cause 는 스펙 승인 범위 밖이다
- 옛 격리 행 백필 없음 (`affected_lines = null` → 화면에서 "판정 불가")
- 사유 필터 API 없음. 필요해지면 `affected_lines` 에 GIN 인덱스 + `@>` containment
- `/lookup` 삭제, 폴백 제거, auto-replay 정책, 사유별 알림, 격리 큐 화면(#640)

## 배포 순서

```
1) channel-adapter migrate   — additive nullable 컬럼 (expand: migrate → deploy)
2) Core deploy               — /channel-listings/resolve 신설
3) channel-adapter deploy    — /resolve 사용 + 컬럼 기록
```

2·3 이 뒤집혀도 Task 4 의 404 폴백이 받는다. **1 은 3 보다 반드시 앞.**

라이브 영향 없음 — 네이버·쿠팡 리스팅 0행이고 Medusa 는 `embedded` 라 이 조회를 타지 않는다. 실효는 #643 개통 시점.
