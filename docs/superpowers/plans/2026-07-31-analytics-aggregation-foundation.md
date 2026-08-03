# analytics 집계 토대 Implementation Plan (계획 1/4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** analytics 가 주문 4종·멤버십 1종 이벤트를 소비해 매출·취소·환불·결제전환·멤버십 등급 집계를 유지하도록 만든다.

**Architecture:** 기존 "컨슈머가 fact·agg 를 한 트랜잭션에서 이중 쓰기" 패턴을 그대로 확장한다. fact 서비스가 멱등 게이트(`messageId` PK)를 통과시킨 뒤 증분 seed 를 반환하고, agg 서비스들이 그 seed 를 upsert 로 적용한다. 취소·환불은 음수 증분이며, 원본 주문이 fact 에 없으면 건너뛴다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), Jest, `@app/events`(Kafka 컨슈머), `@packages/event-contracts`(zod 런타임 검증)

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-07-31-admin-statistics-design.md`
- **이벤트 계약(`packages/event-contracts/`)은 수정하지 않는다.** 4종 전부 이미 발행 중이며 소비만 추가한다.
- **멱등성 게이트 순서 불변**: `fact` insert → `claimed` 확인 → `return` → `agg` 갱신. agg 를 먼저 쓰면 재전송 시 중복 가산된다.
- 트랜잭션 전파: public 메서드는 `tx?: DbTx` 를 마지막 인자로 받고, private helper 는 `tx: DbTx` 필수. `DbTx` 는 `apps/analytics/src/db.types.ts` 에서 import.
- 금액 컬럼은 `bigint({ mode: 'number' })`. 일별 합계가 `integer` 상한(약 21억)을 넘을 수 있다.
- unique index 에 들어가는 컬럼은 **nullable 금지**. Postgres 는 NULL 을 서로 다른 값으로 취급해 중복 행이 생긴다. 등급 미상은 `'UNKNOWN'` 리터럴을 쓴다.
- 테스트는 DB 없이 도는 순수 유닛 테스트다. DI 를 mock 으로 대체하고 `as never` 로 캐스팅한다 (`order-events.consumer.spec.ts` 패턴).
- 마이그레이션 생성: `npm run db:generate:analytics -- --name <kebab-description>`. 생성된 SQL 을 검토하고 `schema.ts` + `drizzle/` 을 **한 커밋**에 담는다.
- 테스트 실행: `npx jest --testPathPattern="apps/analytics"`
- 전역 `npm test` / `npm run lint` 는 이 레포의 상시 부채라 실행하지 않는다. 변경 파일 범위로만 검증한다.

## File Structure

**수정**
- `apps/analytics/src/schema.ts` — 테이블 7항목
- `apps/analytics/src/datasets/orders/facts/order-types.ts` — seed 타입 4종
- `apps/analytics/src/datasets/orders/facts/order-facts.service.ts` — seed 확장, 취소·환불·결제 기록 메서드
- `apps/analytics/src/datasets/orders/aggregates/order-aggregates.service.ts` — 금액 반영, 음수 증분
- `apps/analytics/src/datasets/orders/ingest/order-events.consumer.ts` — 핸들러 3종 추가
- `apps/analytics/src/analytics.module.ts` — 프로바이더·컨트롤러 배선

**신규**
- `apps/analytics/src/datasets/orders/aggregates/channel-aggregates.service.ts`
- `apps/analytics/src/datasets/orders/aggregates/variant-aggregates.service.ts`
- `apps/analytics/src/datasets/orders/aggregates/customer-lifetime.service.ts`
- `apps/analytics/src/datasets/memberships/facts/membership-facts.service.ts`
- `apps/analytics/src/datasets/memberships/dimensions/membership-dimensions.service.ts`
- `apps/analytics/src/datasets/memberships/aggregates/membership-aggregates.service.ts`
- `apps/analytics/src/datasets/memberships/ingest/membership-events.consumer.ts`
- `apps/analytics/src/datasets/memberships/facts/membership-types.ts`

책임 분리는 기존 `datasets/<도메인>/{facts,aggregates,dimensions,ingest}` 관례를 그대로 따른다.

---

### Task 1: 스키마 7항목 + 마이그레이션

**Files:**
- Modify: `apps/analytics/src/schema.ts`
- Create: `apps/analytics/drizzle/<timestamp>_add-statistics-aggregates.sql` (생성됨)

**Interfaces:**
- Produces: `aggChannelDaily`, `aggVariantOrderDaily`, `aggCustomerLifetime`, `factMembershipEvents`, `dimCustomerMembership`, `aggMembershipDaily` 테이블 export. `aggProductOrderDaily` 에 `grossRevenue`/`cancelledAmount`/`refundedAmount` 컬럼 추가.

- [ ] **Step 1: `bigint` import 추가**

`apps/analytics/src/schema.ts` 최상단 import 에 `bigint` 를 넣는다.

```ts
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  bigint,
  text,
  date,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: `aggProductOrderDaily` 에 금액 컬럼 3개 추가**

`quantitySold` 아래, `createdAt` 위에 삽입한다.

```ts
    quantitySold: integer('quantity_sold').notNull().default(0),
    grossRevenue: bigint('gross_revenue', { mode: 'number' }).notNull().default(0),
    cancelledAmount: bigint('cancelled_amount', { mode: 'number' }).notNull().default(0),
    refundedAmount: bigint('refunded_amount', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
```

- [ ] **Step 3: 신규 테이블 6개 추가**

`aggUserProductPurchase` 정의 아래, `analyticsSchema` export 위에 붙인다.

```ts
export const aggChannelDaily = pgTable(
  'agg_channel_daily',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    aggDate: date('agg_date').notNull(),
    salesChannel: varchar('sales_channel', { length: 50 }).notNull(),
    ordersCount: integer('orders_count').notNull().default(0),
    paidOrdersCount: integer('paid_orders_count').notNull().default(0),
    grossRevenue: bigint('gross_revenue', { mode: 'number' }).notNull().default(0),
    cancelledAmount: bigint('cancelled_amount', { mode: 'number' }).notNull().default(0),
    refundedAmount: bigint('refunded_amount', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_agg_channel_daily').on(table.aggDate, table.salesChannel),
    index('idx_agg_channel_daily_date').on(table.aggDate),
  ],
);

export const aggVariantOrderDaily = pgTable(
  'agg_variant_order_daily',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    aggDate: date('agg_date').notNull(),
    variantId: varchar('variant_id', { length: 255 }).notNull(),
    masterId: varchar('master_id', { length: 255 }).notNull(),
    salesChannel: varchar('sales_channel', { length: 50 }).notNull(),
    quantitySold: integer('quantity_sold').notNull().default(0),
    grossRevenue: bigint('gross_revenue', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_agg_variant_order_daily').on(table.aggDate, table.variantId, table.salesChannel),
    index('idx_agg_variant_order_daily_date').on(table.aggDate),
    index('idx_agg_variant_order_daily_master').on(table.masterId),
  ],
);

export const aggCustomerLifetime = pgTable(
  'agg_customer_lifetime',
  {
    customerId: varchar('customer_id', { length: 255 }).primaryKey(),
    firstOrderAt: timestamp('first_order_at'),
    lastOrderAt: timestamp('last_order_at'),
    ordersCount: integer('orders_count').notNull().default(0),
    totalRevenue: bigint('total_revenue', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [index('idx_agg_customer_lifetime_first_order').on(table.firstOrderAt)],
);

export const factMembershipEvents = pgTable(
  'fact_membership_events',
  {
    messageId: varchar('message_id', { length: 26 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    status: varchar('status', { length: 30 }).notNull(),
    tierId: varchar('tier_id', { length: 255 }),
    planId: varchar('plan_id', { length: 255 }),
    contractId: varchar('contract_id', { length: 255 }),
    reasonCode: varchar('reason_code', { length: 100 }),
    reasonText: text('reason_text'),
    occurredAt: timestamp('occurred_at').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_fact_membership_events_user').on(table.userId),
    index('idx_fact_membership_events_occurred_at').on(table.occurredAt),
    index('idx_fact_membership_events_status').on(table.status),
    index('idx_fact_membership_events_reason').on(table.reasonCode),
  ],
);

export const dimCustomerMembership = pgTable(
  'dim_customer_membership',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: varchar('user_id', { length: 255 }).notNull(),
    tierId: varchar('tier_id', { length: 255 }).notNull().default('UNKNOWN'),
    contractId: varchar('contract_id', { length: 255 }),
    validFrom: timestamp('valid_from').notNull(),
    validTo: timestamp('valid_to'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_dim_customer_membership').on(table.userId, table.validFrom),
    index('idx_dim_customer_membership_user').on(table.userId),
    index('idx_dim_customer_membership_valid_to').on(table.validTo),
  ],
);

export const aggMembershipDaily = pgTable(
  'agg_membership_daily',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    aggDate: date('agg_date').notNull(),
    status: varchar('status', { length: 30 }).notNull(),
    tierId: varchar('tier_id', { length: 255 }).notNull().default('UNKNOWN'),
    membersCount: integer('members_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_agg_membership_daily').on(table.aggDate, table.status, table.tierId),
    index('idx_agg_membership_daily_date').on(table.aggDate),
  ],
);
```

- [ ] **Step 4: `analyticsSchema` 에 6개 등록**

```ts
export const analyticsSchema = {
  factOrderEvents,
  factOrderItems,
  aggProductOrderDaily,
  aggUserProductPurchase,
  aggChannelDaily,
  aggVariantOrderDaily,
  aggCustomerLifetime,
  factMembershipEvents,
  dimCustomerMembership,
  aggMembershipDaily,
  dimProductMasters,
  dimProductVariants,
  dimProductCategories,
} as const;
```

- [ ] **Step 5: 마이그레이션 생성**

Run: `npm run db:generate:analytics -- --name add-statistics-aggregates`
Expected: `apps/analytics/drizzle/` 에 새 `.sql` 파일 생성.

- [ ] **Step 6: 생성된 SQL 검토**

생성된 파일을 열어 확인한다:
- `ALTER TABLE agg_product_order_daily ADD COLUMN` 3건 — 전부 `DEFAULT 0 NOT NULL`
- `CREATE TABLE` 6건
- **`DROP` 구문이 하나도 없어야 한다.** 있으면 `git rm` 후 `schema.ts` 를 고쳐 재생성한다.

- [ ] **Step 7: 타입 컴파일 확인**

Run: `npx tsc --noEmit -p apps/analytics/tsconfig.app.json`
Expected: 오류 없음. (해당 tsconfig 가 없으면 `npx tsc --noEmit apps/analytics/src/schema.ts --skipLibCheck --esModuleInterop --target es2021 --module commonjs --moduleResolution node`)

- [ ] **Step 8: 커밋**

```bash
git add apps/analytics/src/schema.ts apps/analytics/drizzle/
git commit -m "feat(analytics): 통계 집계용 테이블 7항목 추가

- agg_product_order_daily 에 매출/취소/환불 금액 컬럼
- agg_channel_daily, agg_variant_order_daily, agg_customer_lifetime 신규
- fact_membership_events, dim_customer_membership, agg_membership_daily 신규

전부 추가형이라 expand phase (migrate → deploy)."
```

---

### Task 2: seed 타입 확장 + OrderFactsService 가 금액·옵션·고객 seed 를 반환

**Files:**
- Modify: `apps/analytics/src/datasets/orders/facts/order-types.ts`
- Modify: `apps/analytics/src/datasets/orders/facts/order-facts.service.ts:103-125`
- Test: `apps/analytics/src/datasets/orders/facts/order-facts.service.spec.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 1 의 테이블들
- Produces:
  - `OrderAggregateSeed` 에 `revenue: number` 추가
  - `VariantAggregateSeed = { variantId, masterId, salesChannel, occurredDate, quantitySold, revenue }`
  - `ChannelAggregateSeed = { salesChannel, occurredDate, ordersCount, grossRevenue }`
  - `CustomerLifetimeSeed = { customerId, occurredAt: Date, revenue }`
  - `OrderCreatedFactResult = { claimed, seeds, variantSeeds, channelSeed, customerSeed }`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/analytics/src/datasets/orders/facts/order-facts.service.spec.ts` 파일 끝에 추가한다. 기존 파일의 mock 헬퍼 이름이 다르면 아래 자립형 테스트를 그대로 쓴다.

```ts
describe('OrderFactsService seed 확장', () => {
  const envelope = {
    messageId: '01J00000000000000000000010',
    messageType: 'OrderCreated',
    messageVersion: 1,
    messageKind: 'event',
    correlationId: '01J00000000000000000000011',
    timestamp: '2026-07-14T01:00:00.000Z',
    source: { service: 'channel-adapter', aggregateType: 'Order', aggregateId: 'order-10' },
    payload: {},
  };

  const payload = {
    orderId: 'order-10',
    externalOrderId: 'channel-order-10',
    salesChannel: 'naver',
    customerId: 'customer-10',
    currency: 'KRW',
    createdAt: '2026-07-14T01:00:00.000Z',
    items: [
      { masterId: 'master-1', variantId: 'variant-1', quantity: 2, unitPrice: 1000, totalPrice: 2000 },
      { masterId: 'master-1', variantId: 'variant-2', quantity: 1, unitPrice: 3000, totalPrice: 3000 },
    ],
  };

  function makeService(insertedItems: unknown[]) {
    const executor = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValueOnce([{ messageId: envelope.messageId }])
              .mockResolvedValueOnce(insertedItems),
          }),
        }),
      }),
    };
    const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
    return new OrderFactsService(dbService as never);
  }

  it('상품 seed 에 매출을 담는다', async () => {
    const service = makeService([
      { masterId: 'master-1', variantId: 'variant-1', quantity: 2, totalPrice: 2000 },
      { masterId: 'master-1', variantId: 'variant-2', quantity: 1, totalPrice: 3000 },
    ]);

    const result = await service.recordOrderCreated(envelope as never, payload as never);

    expect(result.seeds).toEqual([
      {
        masterId: 'master-1',
        salesChannel: 'naver',
        occurredDate: '2026-07-14',
        orderCount: 1,
        quantitySold: 3,
        revenue: 5000,
      },
    ]);
  });

  it('옵션별 seed 를 variantId 단위로 쪼갠다', async () => {
    const service = makeService([
      { masterId: 'master-1', variantId: 'variant-1', quantity: 2, totalPrice: 2000 },
      { masterId: 'master-1', variantId: 'variant-2', quantity: 1, totalPrice: 3000 },
    ]);

    const result = await service.recordOrderCreated(envelope as never, payload as never);

    expect(result.variantSeeds).toHaveLength(2);
    expect(result.variantSeeds).toContainEqual({
      variantId: 'variant-1',
      masterId: 'master-1',
      salesChannel: 'naver',
      occurredDate: '2026-07-14',
      quantitySold: 2,
      revenue: 2000,
    });
  });

  it('채널 seed 와 고객 seed 를 주문 1건 기준으로 만든다', async () => {
    const service = makeService([
      { masterId: 'master-1', variantId: 'variant-1', quantity: 2, totalPrice: 2000 },
      { masterId: 'master-1', variantId: 'variant-2', quantity: 1, totalPrice: 3000 },
    ]);

    const result = await service.recordOrderCreated(envelope as never, payload as never);

    expect(result.channelSeed).toEqual({
      salesChannel: 'naver',
      occurredDate: '2026-07-14',
      ordersCount: 1,
      grossRevenue: 5000,
    });
    expect(result.customerSeed).toEqual({
      customerId: 'customer-10',
      occurredAt: new Date('2026-07-14T01:00:00.000Z'),
      revenue: 5000,
    });
  });

  it('비회원 주문이면 고객 seed 가 null 이다', async () => {
    const service = makeService([{ masterId: 'master-1', variantId: 'variant-1', quantity: 1, totalPrice: 1000 }]);

    const result = await service.recordOrderCreated(envelope as never, { ...payload, customerId: null } as never);

    expect(result.customerSeed).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern="order-facts.service.spec" -v`
Expected: FAIL — `result.variantSeeds` 가 `undefined`, `seeds[0].revenue` 가 없음.

- [ ] **Step 3: seed 타입 정의**

`apps/analytics/src/datasets/orders/facts/order-types.ts` 를 통째로 교체한다.

```ts
export type OrderAggregateSeed = {
  masterId: string;
  salesChannel: string;
  occurredDate: string;
  orderCount: number;
  quantitySold: number;
  revenue: number;
};

export type VariantAggregateSeed = {
  variantId: string;
  masterId: string;
  salesChannel: string;
  occurredDate: string;
  quantitySold: number;
  revenue: number;
};

export type ChannelAggregateSeed = {
  salesChannel: string;
  occurredDate: string;
  ordersCount: number;
  grossRevenue: number;
};

export type CustomerLifetimeSeed = {
  customerId: string;
  occurredAt: Date;
  revenue: number;
};
```

- [ ] **Step 4: `returning` 절에 필드 추가**

`order-facts.service.ts:103-106` 을 교체한다.

```ts
        .returning({
          masterId: factOrderItems.masterId,
          variantId: factOrderItems.variantId,
          quantity: factOrderItems.quantity,
          totalPrice: factOrderItems.totalPrice,
        });
```

- [ ] **Step 5: seed 생성 로직 교체**

`order-facts.service.ts:111-125` (`const aggregated = new Map...` 부터 `return { claimed: true, seeds: [...] };` 까지)를 교체한다.

```ts
      const byMaster = new Map<string, { quantitySold: number; revenue: number }>();
      const byVariant = new Map<string, VariantAggregateSeed>();
      let orderRevenue = 0;

      for (const item of insertedItems) {
        const quantity = item.quantity ?? 0;
        const revenue = item.totalPrice ?? 0;
        orderRevenue += revenue;

        const master = byMaster.get(item.masterId);
        if (master) {
          master.quantitySold += quantity;
          master.revenue += revenue;
        } else {
          byMaster.set(item.masterId, { quantitySold: quantity, revenue });
        }

        if (item.variantId) {
          const variant = byVariant.get(item.variantId);
          if (variant) {
            variant.quantitySold += quantity;
            variant.revenue += revenue;
          } else {
            byVariant.set(item.variantId, {
              variantId: item.variantId,
              masterId: item.masterId,
              salesChannel: payload.salesChannel,
              occurredDate,
              quantitySold: quantity,
              revenue,
            });
          }
        }
      }

      return {
        claimed: true,
        seeds: [...byMaster.entries()].map(([masterId, agg]) => ({
          masterId,
          salesChannel: payload.salesChannel,
          occurredDate,
          orderCount: 1,
          quantitySold: agg.quantitySold,
          revenue: agg.revenue,
        })),
        variantSeeds: [...byVariant.values()],
        channelSeed: {
          salesChannel: payload.salesChannel,
          occurredDate,
          ordersCount: 1,
          grossRevenue: orderRevenue,
        },
        customerSeed: payload.customerId
          ? { customerId: payload.customerId, occurredAt: occurredAt ?? new Date(), revenue: orderRevenue }
          : null,
      };
```

- [ ] **Step 6: 조기 반환 3곳과 결과 타입 수정**

`order-facts.service.ts` 상단 타입과 조기 반환들을 맞춘다.

```ts
import {
  OrderAggregateSeed,
  VariantAggregateSeed,
  ChannelAggregateSeed,
  CustomerLifetimeSeed,
} from './order-types';

export type OrderCreatedFactResult = {
  claimed: boolean;
  seeds: OrderAggregateSeed[];
  variantSeeds: VariantAggregateSeed[];
  channelSeed: ChannelAggregateSeed | null;
  customerSeed: CustomerLifetimeSeed | null;
};

const EMPTY_SEEDS = {
  seeds: [] as OrderAggregateSeed[],
  variantSeeds: [] as VariantAggregateSeed[],
  channelSeed: null,
  customerSeed: null,
};
```

세 곳의 조기 반환을 바꾼다:
- `:69` → `return { claimed: false, ...EMPTY_SEEDS };`
- `:73` → `return { claimed: true, ...EMPTY_SEEDS };`
- `:108` → `return { claimed: true, ...EMPTY_SEEDS };`

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx jest --testPathPattern="apps/analytics" -v`
Expected: PASS — 신규 4건 포함 전부 통과. 기존 `order-events.consumer.spec.ts` 도 깨지지 않아야 한다(mock 이 `seeds` 만 반환하지만 컨슈머는 아직 변경 전이라 통과).

- [ ] **Step 8: 커밋**

```bash
git add apps/analytics/src/datasets/orders/facts/
git commit -m "feat(analytics): OrderCreated seed 에 매출·옵션·고객 차원 추가

fact_order_items 의 totalPrice/variantId 를 returning 에 포함시켜
상품별 매출, 옵션별 판매, 채널 일별 매출, 고객 생애가치 seed 를 만든다.
비회원 주문(customerId null)은 고객 seed 를 생성하지 않는다."
```

---

### Task 3: OrderAggregatesService 가 매출을 반영

**Files:**
- Modify: `apps/analytics/src/datasets/orders/aggregates/order-aggregates.service.ts:36-84`
- Test: `apps/analytics/src/datasets/orders/aggregates/order-aggregates.service.spec.ts` (신규)

**Interfaces:**
- Consumes: `OrderAggregateSeed` (Task 2)
- Produces: `applyOrderCreated(seeds: OrderAggregateSeed[], tx?: DbTx): Promise<void>` — 시그니처 불변, `grossRevenue` 를 함께 upsert

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { OrderAggregatesService } from './order-aggregates.service';

describe('OrderAggregatesService', () => {
  function makeService() {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const executor = { insert: jest.fn().mockReturnValue({ values }) };
    const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
    const service = new OrderAggregatesService(dbService as never);
    return { service, values, onConflictDoUpdate };
  }

  it('같은 날짜·상품·채널 seed 를 합쳐 한 번만 upsert 한다', async () => {
    const { service, values } = makeService();

    await service.applyOrderCreated([
      { masterId: 'm1', salesChannel: 'naver', occurredDate: '2026-07-14', orderCount: 1, quantitySold: 2, revenue: 2000 },
      { masterId: 'm1', salesChannel: 'naver', occurredDate: '2026-07-14', orderCount: 1, quantitySold: 3, revenue: 3000 },
    ]);

    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ ordersCount: 2, quantitySold: 5, grossRevenue: 5000 }),
    );
  });

  it('seed 가 비면 아무것도 쓰지 않는다', async () => {
    const { service, values } = makeService();

    await service.applyOrderCreated([]);

    expect(values).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern="order-aggregates.service.spec" -v`
Expected: FAIL — `grossRevenue` 가 upsert 값에 없음.

- [ ] **Step 3: 증분 누적에 revenue 추가**

`order-aggregates.service.ts:29-57` 의 `increments` Map 처리에서 `revenue` 를 함께 누적한다.

```ts
    const increments = new Map<
      string,
      {
        aggDate: string;
        masterId: string;
        salesChannel: string;
        ordersCount: number;
        quantitySold: number;
        grossRevenue: number;
      }
    >();

    for (const seed of seeds) {
      const key = `${seed.occurredDate}|${seed.salesChannel}|${seed.masterId}`;
      const current = increments.get(key);
      if (current) {
        current.ordersCount += seed.orderCount;
        current.quantitySold += seed.quantitySold;
        current.grossRevenue += seed.revenue;
      } else {
        increments.set(key, {
          aggDate: seed.occurredDate,
          masterId: seed.masterId,
          salesChannel: seed.salesChannel,
          ordersCount: seed.orderCount,
          quantitySold: seed.quantitySold,
          grossRevenue: seed.revenue,
        });
      }
    }
```

- [ ] **Step 4: upsert 에 revenue 반영**

`:62-79` 의 insert 를 교체한다.

```ts
        await executor
          .insert(aggProductOrderDaily)
          .values({
            aggDate: increment.aggDate,
            masterId: increment.masterId,
            salesChannel: increment.salesChannel,
            ordersCount: increment.ordersCount,
            quantitySold: increment.quantitySold,
            grossRevenue: increment.grossRevenue,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aggProductOrderDaily.aggDate, aggProductOrderDaily.masterId, aggProductOrderDaily.salesChannel],
            set: {
              ordersCount: sql`${aggProductOrderDaily.ordersCount} + ${increment.ordersCount}`,
              quantitySold: sql`${aggProductOrderDaily.quantitySold} + ${increment.quantitySold}`,
              grossRevenue: sql`${aggProductOrderDaily.grossRevenue} + ${increment.grossRevenue}`,
              updatedAt: now,
            },
          });
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest --testPathPattern="apps/analytics" -v`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/analytics/src/datasets/orders/aggregates/order-aggregates.service.ts apps/analytics/src/datasets/orders/aggregates/order-aggregates.service.spec.ts
git commit -m "feat(analytics): 상품 일별 집계에 매출 반영"
```

---

### Task 4: 채널·옵션·고객 집계 서비스 3종 신규

**Files:**
- Create: `apps/analytics/src/datasets/orders/aggregates/channel-aggregates.service.ts`
- Create: `apps/analytics/src/datasets/orders/aggregates/variant-aggregates.service.ts`
- Create: `apps/analytics/src/datasets/orders/aggregates/customer-lifetime.service.ts`
- Test: `apps/analytics/src/datasets/orders/aggregates/channel-aggregates.service.spec.ts`

**Interfaces:**
- Consumes: `ChannelAggregateSeed`, `VariantAggregateSeed`, `CustomerLifetimeSeed` (Task 2)
- Produces:
  - `ChannelAggregatesService.applyOrderCreated(seed: ChannelAggregateSeed, tx?: DbTx): Promise<void>`
  - `ChannelAggregatesService.applyCancellation(occurredDate: string, salesChannel: string, amount: number, tx?: DbTx): Promise<void>`
  - `ChannelAggregatesService.applyRefund(occurredDate: string, salesChannel: string, amount: number, tx?: DbTx): Promise<void>`
  - `ChannelAggregatesService.applyPaymentCompleted(occurredDate: string, salesChannel: string, tx?: DbTx): Promise<void>`
  - `VariantAggregatesService.applyOrderCreated(seeds: VariantAggregateSeed[], tx?: DbTx): Promise<void>`
  - `CustomerLifetimeService.applyOrderCreated(seed: CustomerLifetimeSeed, tx?: DbTx): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`channel-aggregates.service.spec.ts`:

```ts
import { ChannelAggregatesService } from './channel-aggregates.service';

describe('ChannelAggregatesService', () => {
  function makeService() {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const executor = { insert: jest.fn().mockReturnValue({ values }) };
    const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
    return { service: new ChannelAggregatesService(dbService as never), values, onConflictDoUpdate };
  }

  it('주문 생성 시 매출과 주문수를 올린다', async () => {
    const { service, values } = makeService();

    await service.applyOrderCreated({
      salesChannel: 'naver',
      occurredDate: '2026-07-14',
      ordersCount: 1,
      grossRevenue: 5000,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ aggDate: '2026-07-14', salesChannel: 'naver', ordersCount: 1, grossRevenue: 5000 }),
    );
  });

  it('취소는 cancelledAmount 를 올린다 (grossRevenue 를 깎지 않는다)', async () => {
    const { service, values } = makeService();

    await service.applyCancellation('2026-07-14', 'naver', 3000);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ cancelledAmount: 3000, grossRevenue: 0, ordersCount: 0 }),
    );
  });

  it('결제 완료는 paidOrdersCount 만 올린다', async () => {
    const { service, values } = makeService();

    await service.applyPaymentCompleted('2026-07-14', 'naver');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ paidOrdersCount: 1, ordersCount: 0, grossRevenue: 0 }),
    );
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern="channel-aggregates.service.spec" -v`
Expected: FAIL — 모듈을 찾을 수 없음.

- [ ] **Step 3: ChannelAggregatesService 구현**

취소·환불은 `grossRevenue` 를 깎지 않고 별도 컬럼에 쌓는다. 순매출은 조회 시 뺄셈으로 유도하므로 총매출 원본이 보존된다.

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { analyticsSchema, aggChannelDaily } from '../../../schema';
import { DbTx } from '../../../db.types';
import { ChannelAggregateSeed } from '../facts/order-types';

type ChannelIncrement = {
  ordersCount: number;
  paidOrdersCount: number;
  grossRevenue: number;
  cancelledAmount: number;
  refundedAmount: number;
};

const ZERO: ChannelIncrement = {
  ordersCount: 0,
  paidOrdersCount: 0,
  grossRevenue: 0,
  cancelledAmount: 0,
  refundedAmount: 0,
};

@Injectable()
export class ChannelAggregatesService {
  private readonly logger = new Logger(ChannelAggregatesService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async applyOrderCreated(seed: ChannelAggregateSeed, tx?: DbTx): Promise<void> {
    await this.upsert(seed.occurredDate, seed.salesChannel, {
      ...ZERO,
      ordersCount: seed.ordersCount,
      grossRevenue: seed.grossRevenue,
    }, tx);
  }

  async applyCancellation(occurredDate: string, salesChannel: string, amount: number, tx?: DbTx): Promise<void> {
    await this.upsert(occurredDate, salesChannel, { ...ZERO, cancelledAmount: amount }, tx);
  }

  async applyRefund(occurredDate: string, salesChannel: string, amount: number, tx?: DbTx): Promise<void> {
    await this.upsert(occurredDate, salesChannel, { ...ZERO, refundedAmount: amount }, tx);
  }

  async applyPaymentCompleted(occurredDate: string, salesChannel: string, tx?: DbTx): Promise<void> {
    await this.upsert(occurredDate, salesChannel, { ...ZERO, paidOrdersCount: 1 }, tx);
  }

  private async upsert(
    aggDate: string,
    salesChannel: string,
    increment: ChannelIncrement,
    tx?: DbTx,
  ): Promise<void> {
    const run = async (executor: DbTx) => {
      const now = new Date();
      await executor
        .insert(aggChannelDaily)
        .values({ aggDate, salesChannel, ...increment, updatedAt: now })
        .onConflictDoUpdate({
          target: [aggChannelDaily.aggDate, aggChannelDaily.salesChannel],
          set: {
            ordersCount: sql`${aggChannelDaily.ordersCount} + ${increment.ordersCount}`,
            paidOrdersCount: sql`${aggChannelDaily.paidOrdersCount} + ${increment.paidOrdersCount}`,
            grossRevenue: sql`${aggChannelDaily.grossRevenue} + ${increment.grossRevenue}`,
            cancelledAmount: sql`${aggChannelDaily.cancelledAmount} + ${increment.cancelledAmount}`,
            refundedAmount: sql`${aggChannelDaily.refundedAmount} + ${increment.refundedAmount}`,
            updatedAt: now,
          },
        });
    };

    await (tx ? run(tx) : this.db.transaction(run));
  }
}
```

- [ ] **Step 4: VariantAggregatesService 구현**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { analyticsSchema, aggVariantOrderDaily } from '../../../schema';
import { DbTx } from '../../../db.types';
import { VariantAggregateSeed } from '../facts/order-types';

@Injectable()
export class VariantAggregatesService {
  private readonly logger = new Logger(VariantAggregatesService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async applyOrderCreated(seeds: VariantAggregateSeed[], tx?: DbTx): Promise<void> {
    if (seeds.length === 0) {
      return;
    }

    const run = async (executor: DbTx) => {
      const now = new Date();
      for (const seed of seeds) {
        await executor
          .insert(aggVariantOrderDaily)
          .values({
            aggDate: seed.occurredDate,
            variantId: seed.variantId,
            masterId: seed.masterId,
            salesChannel: seed.salesChannel,
            quantitySold: seed.quantitySold,
            grossRevenue: seed.revenue,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aggVariantOrderDaily.aggDate, aggVariantOrderDaily.variantId, aggVariantOrderDaily.salesChannel],
            set: {
              quantitySold: sql`${aggVariantOrderDaily.quantitySold} + ${seed.quantitySold}`,
              grossRevenue: sql`${aggVariantOrderDaily.grossRevenue} + ${seed.revenue}`,
              updatedAt: now,
            },
          });
      }
      this.logger.debug(`Variant aggregates updated: ${seeds.length} rows`);
    };

    await (tx ? run(tx) : this.db.transaction(run));
  }
}
```

- [ ] **Step 5: CustomerLifetimeService 구현**

`firstOrderAt` 은 `LEAST` 로, `lastOrderAt` 은 `GREATEST` 로 갱신해 이벤트 순서가 뒤집혀도 값이 망가지지 않게 한다.

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { analyticsSchema, aggCustomerLifetime } from '../../../schema';
import { DbTx } from '../../../db.types';
import { CustomerLifetimeSeed } from '../facts/order-types';

@Injectable()
export class CustomerLifetimeService {
  private readonly logger = new Logger(CustomerLifetimeService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async applyOrderCreated(seed: CustomerLifetimeSeed, tx?: DbTx): Promise<void> {
    const run = async (executor: DbTx) => {
      const now = new Date();
      await executor
        .insert(aggCustomerLifetime)
        .values({
          customerId: seed.customerId,
          firstOrderAt: seed.occurredAt,
          lastOrderAt: seed.occurredAt,
          ordersCount: 1,
          totalRevenue: seed.revenue,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: aggCustomerLifetime.customerId,
          set: {
            firstOrderAt: sql`LEAST(${aggCustomerLifetime.firstOrderAt}, ${seed.occurredAt})`,
            lastOrderAt: sql`GREATEST(${aggCustomerLifetime.lastOrderAt}, ${seed.occurredAt})`,
            ordersCount: sql`${aggCustomerLifetime.ordersCount} + 1`,
            totalRevenue: sql`${aggCustomerLifetime.totalRevenue} + ${seed.revenue}`,
            updatedAt: now,
          },
        });
    };

    await (tx ? run(tx) : this.db.transaction(run));
  }
}
```

- [ ] **Step 6: `onOrderCreated` 가 신규 집계 3종을 호출하도록 확장**

Task 2 가 만든 seed 를 실제로 소비하는 지점이다. **이 스텝을 빠뜨리면 신규 테이블 3개가 영원히 빈 채로 남는다.**

`order-events.consumer.ts` 의 생성자에 3개를 주입한다.

```ts
  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
    private readonly orderFactsService: OrderFactsService,
    private readonly orderAggregatesService: OrderAggregatesService,
    private readonly userPurchaseAggregatesService: UserPurchaseAggregatesService,
    private readonly channelAggregatesService: ChannelAggregatesService,
    private readonly variantAggregatesService: VariantAggregatesService,
    private readonly customerLifetimeService: CustomerLifetimeService,
  ) {}
```

`onOrderCreated` 의 트랜잭션 본문에 3줄을 추가한다 (`claimed` 확인 이후).

```ts
      await this.orderAggregatesService.applyOrderCreated(result.seeds, tx);
      await this.userPurchaseAggregatesService.applyOrderCreated(
        payload.customerId,
        payload.items,
        new Date(payload.createdAt),
        tx,
      );
      await this.variantAggregatesService.applyOrderCreated(result.variantSeeds, tx);
      if (result.channelSeed) {
        await this.channelAggregatesService.applyOrderCreated(result.channelSeed, tx);
      }
      if (result.customerSeed) {
        await this.customerLifetimeService.applyOrderCreated(result.customerSeed, tx);
      }
```

- [ ] **Step 7: 기존 컨슈머 테스트 갱신**

`order-events.consumer.spec.ts` 의 `makeConsumer` 가 생성자 인자 3개를 더 받아야 한다.
mock 반환값에도 신규 seed 필드를 넣는다.

```ts
    const orderFactsService = {
      recordOrderCreated: jest.fn().mockResolvedValue({
        claimed,
        seeds: claimed
          ? [
              {
                masterId: 'master-1',
                salesChannel: 'naver',
                occurredDate: '2026-07-14',
                orderCount: 1,
                quantitySold: 1,
                revenue: 1000,
              },
            ]
          : [],
        variantSeeds: [],
        channelSeed: claimed
          ? { salesChannel: 'naver', occurredDate: '2026-07-14', ordersCount: 1, grossRevenue: 1000 }
          : null,
        customerSeed: null,
      }),
    };
    const orderAggregatesService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const userPurchaseAggregatesService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const channelAggregatesService = {
      applyOrderCreated: jest.fn().mockResolvedValue(undefined),
      applyCancellation: jest.fn().mockResolvedValue(undefined),
      applyRefund: jest.fn().mockResolvedValue(undefined),
      applyPaymentCompleted: jest.fn().mockResolvedValue(undefined),
    };
    const variantAggregatesService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const customerLifetimeService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const consumer = new OrderEventsConsumer(
      dbService as never,
      orderFactsService as never,
      orderAggregatesService as never,
      userPurchaseAggregatesService as never,
      channelAggregatesService as never,
      variantAggregatesService as never,
      customerLifetimeService as never,
    );
    return {
      consumer,
      tx,
      orderFactsService,
      orderAggregatesService,
      userPurchaseAggregatesService,
      channelAggregatesService,
      variantAggregatesService,
      customerLifetimeService,
    };
```

기존 테스트 `'skips every aggregate when the messageId was already claimed'` 에 단언을 추가한다.

```ts
    expect(channelAggregatesService.applyOrderCreated).not.toHaveBeenCalled();
    expect(variantAggregatesService.applyOrderCreated).not.toHaveBeenCalled();
    expect(customerLifetimeService.applyOrderCreated).not.toHaveBeenCalled();
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npx jest --testPathPattern="apps/analytics" -v`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/analytics/src/datasets/orders/
git commit -m "feat(analytics): 채널·옵션·고객 집계 서비스 추가

취소/환불은 grossRevenue 를 깎지 않고 별도 컬럼에 쌓는다 —
순매출은 조회 시 뺄셈으로 유도해 총매출 원본을 보존한다.
고객 생애값은 LEAST/GREATEST 로 갱신해 이벤트 순서 역전에 견딘다."
```

---

### Task 5: OrderCancelled 소비 — 원본 조회 + 고아 방어

**Files:**
- Modify: `apps/analytics/src/datasets/orders/facts/order-facts.service.ts`
- Modify: `apps/analytics/src/datasets/orders/ingest/order-events.consumer.ts`
- Test: `apps/analytics/src/datasets/orders/facts/order-cancellation.spec.ts` (신규)

**Interfaces:**
- Consumes: `ChannelAggregatesService.applyCancellation` (Task 4)
- Produces: `OrderFactsService.recordOrderCancelled(envelope, payload, tx?): Promise<OrderCancelledFactResult>`
  - `OrderCancelledFactResult = { claimed: boolean; orphan: boolean; salesChannel: string | null; occurredDate: string; masterAmounts: Array<{ masterId: string; amount: number }>; totalAmount: number }`

**배경:** `OrderCancelledPayload` 에는 주문 금액이 없다(`orders.stream.ts:112`). 차감액을 알려면 `fact_order_items` 에서 원본을 조회해야 하며, 원본이 없으면 차감 자체가 불가능하므로 건너뛴다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { OrderFactsService } from './order-facts.service';

const envelope = {
  messageId: '01J00000000000000000000020',
  messageType: 'OrderCancelled',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: '01J00000000000000000000021',
  timestamp: '2026-07-15T01:00:00.000Z',
  source: { service: 'channel-adapter', aggregateType: 'Order', aggregateId: 'order-20' },
  payload: {},
};

const payload = {
  orderId: 'order-20',
  reason: 'CUSTOMER_REQUEST',
  cancelledBy: 'admin',
  cancelledAt: '2026-07-15T01:00:00.000Z',
  refundRequired: false,
};

function makeService(originalRows: unknown[], claimed = true) {
  const executor = {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue(claimed ? [{ messageId: envelope.messageId }] : []),
        }),
      }),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(originalRows),
      }),
    }),
  };
  const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
  return new OrderFactsService(dbService as never);
}

describe('OrderFactsService.recordOrderCancelled', () => {
  it('원본이 없으면 orphan 으로 표시하고 차감액을 만들지 않는다', async () => {
    const service = makeService([]);

    const result = await service.recordOrderCancelled(envelope as never, payload as never);

    expect(result.orphan).toBe(true);
    expect(result.totalAmount).toBe(0);
    expect(result.masterAmounts).toEqual([]);
  });

  it('원본 라인 금액을 상품별로 합쳐 차감액을 만든다', async () => {
    const service = makeService([
      { masterId: 'm1', salesChannel: 'naver', totalPrice: 2000 },
      { masterId: 'm1', salesChannel: 'naver', totalPrice: 1000 },
      { masterId: 'm2', salesChannel: 'naver', totalPrice: 500 },
    ]);

    const result = await service.recordOrderCancelled(envelope as never, payload as never);

    expect(result.orphan).toBe(false);
    expect(result.salesChannel).toBe('naver');
    expect(result.totalAmount).toBe(3500);
    expect(result.masterAmounts).toContainEqual({ masterId: 'm1', amount: 3000 });
    expect(result.masterAmounts).toContainEqual({ masterId: 'm2', amount: 500 });
  });

  it('중복 메시지면 claimed=false 이고 조회하지 않는다', async () => {
    const service = makeService([{ masterId: 'm1', salesChannel: 'naver', totalPrice: 2000 }], false);

    const result = await service.recordOrderCancelled(envelope as never, payload as never);

    expect(result.claimed).toBe(false);
    expect(result.totalAmount).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern="order-cancellation.spec" -v`
Expected: FAIL — `recordOrderCancelled` 가 함수가 아님.

- [ ] **Step 3: `recordOrderCancelled` 구현**

`order-facts.service.ts` 에 추가한다. import 에 `eq`, `or` 와 `OrderCancelledPayload` 를 더한다.

```ts
import { eq, or } from 'drizzle-orm';
import { OrderCancelledPayload } from '@packages/event-contracts/streams/orders.stream';

export type OrderCancelledFactResult = {
  claimed: boolean;
  orphan: boolean;
  salesChannel: string | null;
  occurredDate: string;
  masterAmounts: Array<{ masterId: string; amount: number }>;
  totalAmount: number;
};
```

```ts
  async recordOrderCancelled(
    envelope: DomainEvent<OrderCancelledPayload>,
    payload: OrderCancelledPayload,
    tx?: DbTx,
  ): Promise<OrderCancelledFactResult> {
    const occurredAt = payload.cancelledAt ? new Date(payload.cancelledAt) : new Date();
    const occurredDate = this.toDateOnly(occurredAt);
    const empty: OrderCancelledFactResult = {
      claimed: false,
      orphan: false,
      salesChannel: null,
      occurredDate,
      masterAmounts: [],
      totalAmount: 0,
    };

    return this.inTx(async (executor) => {
      const claimedEvents = await executor
        .insert(factOrderEvents)
        .values({
          messageId: envelope.messageId,
          messageType: envelope.messageType,
          messageVersion: envelope.messageVersion,
          messageKind: envelope.messageKind,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId,
          aggregateType: envelope.source.aggregateType,
          aggregateId: envelope.source.aggregateId,
          sourceService: envelope.source.service,
          orderId: payload.orderId,
          occurredAt,
          payload: envelope.payload,
          metadata: envelope.metadata ?? null,
        })
        .onConflictDoNothing({ target: factOrderEvents.messageId })
        .returning({ messageId: factOrderEvents.messageId });

      if (claimedEvents.length === 0) {
        this.logger.debug(`Duplicate OrderCancelled skipped: ${envelope.messageId}`);
        return empty;
      }

      const originals = await executor
        .select({
          masterId: factOrderItems.masterId,
          salesChannel: factOrderItems.salesChannel,
          totalPrice: factOrderItems.totalPrice,
        })
        .from(factOrderItems)
        .where(or(eq(factOrderItems.orderKey, payload.orderId), eq(factOrderItems.orderId, payload.orderId)));

      if (originals.length === 0) {
        this.logger.warn(`백필 범위 밖 주문의 취소 — 건너뜀: ${payload.orderId}`);
        return { ...empty, claimed: true, orphan: true };
      }

      const byMaster = new Map<string, number>();
      let totalAmount = 0;
      for (const row of originals) {
        const amount = row.totalPrice ?? 0;
        totalAmount += amount;
        byMaster.set(row.masterId, (byMaster.get(row.masterId) ?? 0) + amount);
      }

      return {
        claimed: true,
        orphan: false,
        salesChannel: originals[0].salesChannel,
        occurredDate,
        masterAmounts: [...byMaster.entries()].map(([masterId, amount]) => ({ masterId, amount })),
        totalAmount,
      };
    }, tx);
  }
```

- [ ] **Step 4: 상품 집계에 취소 반영 메서드 추가**

`order-aggregates.service.ts` 에 추가한다.

```ts
  async applyCancellation(
    occurredDate: string,
    salesChannel: string,
    masterAmounts: Array<{ masterId: string; amount: number }>,
    tx?: DbTx,
  ): Promise<void> {
    if (masterAmounts.length === 0) {
      return;
    }

    await this.inTx(async (executor) => {
      const now = new Date();
      for (const { masterId, amount } of masterAmounts) {
        await executor
          .insert(aggProductOrderDaily)
          .values({
            aggDate: occurredDate,
            masterId,
            salesChannel,
            ordersCount: 0,
            quantitySold: 0,
            cancelledAmount: amount,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aggProductOrderDaily.aggDate, aggProductOrderDaily.masterId, aggProductOrderDaily.salesChannel],
            set: {
              cancelledAmount: sql`${aggProductOrderDaily.cancelledAmount} + ${amount}`,
              updatedAt: now,
            },
          });
      }
    }, tx);
  }
```

- [ ] **Step 5: 컨슈머 핸들러 추가**

`order-events.consumer.ts` 에 추가한다. `ChannelAggregatesService` 는 Task 4 Step 6 에서 이미 주입했으므로 생성자는 그대로 둔다.

```ts
  @OnEvent('orders.events.v1', 'OrderCancelled')
  async onOrderCancelled(
    @EventEnvelope() envelope: DomainEvent<OrderCancelledPayload>,
    @EventPayload() payload: OrderCancelledPayload,
  ) {
    this.logger.log(`OrderCancelled received: ${payload.orderId}`);
    await this.inTx(async (tx) => {
      const result = await this.orderFactsService.recordOrderCancelled(envelope, payload, tx);
      if (!result.claimed || result.orphan || !result.salesChannel) {
        return;
      }
      await this.orderAggregatesService.applyCancellation(
        result.occurredDate,
        result.salesChannel,
        result.masterAmounts,
        tx,
      );
      await this.channelAggregatesService.applyCancellation(
        result.occurredDate,
        result.salesChannel,
        result.totalAmount,
        tx,
      );
    });
  }
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx jest --testPathPattern="apps/analytics" -v`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/analytics/src/datasets/orders/
git commit -m "feat(analytics): OrderCancelled 소비 — 원본 조회 기반 취소 차감

OrderCancelledPayload 에 금액이 없어 fact_order_items 에서 원본을 조회한다.
원본이 없으면(백필 범위 밖) 차감액을 알 수 없으므로 건너뛰고 경고 로깅한다 —
그대로 음수 증분을 더하면 해당 날짜 매출이 마이너스로 내려앉는다."
```

---

### Task 6: OrderRefundCreated + OrderPaymentCompleted 소비

**Files:**
- Modify: `apps/analytics/src/datasets/orders/facts/order-facts.service.ts`
- Modify: `apps/analytics/src/datasets/orders/ingest/order-events.consumer.ts`
- Test: `apps/analytics/src/datasets/orders/facts/order-refund-payment.spec.ts` (신규)

**Interfaces:**
- Produces: `OrderFactsService.recordSimpleOrderEvent(envelope, orderId, occurredAt, tx?): Promise<{ claimed: boolean; orphan: boolean; salesChannel: string | null; occurredDate: string }>`

**배경:** 환불(`amount` 보유)과 결제완료(`amount` 보유)는 페이로드에 금액이 있으므로 원본 조회는 **채널 판정용**으로만 필요하다. 두 이벤트가 같은 형태라 메서드를 공유한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { OrderFactsService } from './order-facts.service';

const envelope = {
  messageId: '01J00000000000000000000030',
  messageType: 'OrderRefundCreated',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: '01J00000000000000000000031',
  timestamp: '2026-07-16T01:00:00.000Z',
  source: { service: 'wallet', aggregateType: 'Order', aggregateId: 'order-30' },
  payload: {},
};

function makeService(originalRows: unknown[], claimed = true) {
  const executor = {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue(claimed ? [{ messageId: envelope.messageId }] : []),
        }),
      }),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(originalRows) }),
    }),
  };
  const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
  return new OrderFactsService(dbService as never);
}

describe('OrderFactsService.recordSimpleOrderEvent', () => {
  it('원본에서 채널을 찾아 반환한다', async () => {
    const service = makeService([{ salesChannel: 'coupang' }]);

    const result = await service.recordSimpleOrderEvent(
      envelope as never,
      'order-30',
      new Date('2026-07-16T01:00:00.000Z'),
    );

    expect(result.claimed).toBe(true);
    expect(result.orphan).toBe(false);
    expect(result.salesChannel).toBe('coupang');
    expect(result.occurredDate).toBe('2026-07-16');
  });

  it('원본이 없으면 orphan 이다', async () => {
    const service = makeService([]);

    const result = await service.recordSimpleOrderEvent(
      envelope as never,
      'order-30',
      new Date('2026-07-16T01:00:00.000Z'),
    );

    expect(result.orphan).toBe(true);
    expect(result.salesChannel).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern="order-refund-payment.spec" -v`
Expected: FAIL — `recordSimpleOrderEvent` 가 함수가 아님.

- [ ] **Step 3: `recordSimpleOrderEvent` 구현**

`order-facts.service.ts` 에 추가한다.

```ts
export type SimpleOrderEventResult = {
  claimed: boolean;
  orphan: boolean;
  salesChannel: string | null;
  occurredDate: string;
};

  async recordSimpleOrderEvent(
    envelope: DomainEvent<unknown>,
    orderId: string,
    occurredAt: Date,
    tx?: DbTx,
  ): Promise<SimpleOrderEventResult> {
    const occurredDate = this.toDateOnly(occurredAt);

    return this.inTx(async (executor) => {
      const claimedEvents = await executor
        .insert(factOrderEvents)
        .values({
          messageId: envelope.messageId,
          messageType: envelope.messageType,
          messageVersion: envelope.messageVersion,
          messageKind: envelope.messageKind,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId,
          aggregateType: envelope.source.aggregateType,
          aggregateId: envelope.source.aggregateId,
          sourceService: envelope.source.service,
          orderId,
          occurredAt,
          payload: envelope.payload,
          metadata: envelope.metadata ?? null,
        })
        .onConflictDoNothing({ target: factOrderEvents.messageId })
        .returning({ messageId: factOrderEvents.messageId });

      if (claimedEvents.length === 0) {
        this.logger.debug(`Duplicate ${envelope.messageType} skipped: ${envelope.messageId}`);
        return { claimed: false, orphan: false, salesChannel: null, occurredDate };
      }

      const originals = await executor
        .select({ salesChannel: factOrderItems.salesChannel })
        .from(factOrderItems)
        .where(or(eq(factOrderItems.orderKey, orderId), eq(factOrderItems.orderId, orderId)));

      if (originals.length === 0) {
        this.logger.warn(`백필 범위 밖 주문의 ${envelope.messageType} — 건너뜀: ${orderId}`);
        return { claimed: true, orphan: true, salesChannel: null, occurredDate };
      }

      return { claimed: true, orphan: false, salesChannel: originals[0].salesChannel, occurredDate };
    }, tx);
  }
```

- [ ] **Step 4: 컨슈머 핸들러 2개 추가**

```ts
  @OnEvent('orders.events.v1', 'OrderRefundCreated')
  async onOrderRefundCreated(
    @EventEnvelope() envelope: DomainEvent<OrderRefundCreatedPayload>,
    @EventPayload() payload: OrderRefundCreatedPayload,
  ) {
    this.logger.log(`OrderRefundCreated received: ${payload.orderId}`);
    await this.inTx(async (tx) => {
      const result = await this.orderFactsService.recordSimpleOrderEvent(
        envelope,
        payload.orderId,
        new Date(payload.createdAt),
        tx,
      );
      if (!result.claimed || result.orphan || !result.salesChannel) {
        return;
      }
      await this.channelAggregatesService.applyRefund(
        result.occurredDate,
        result.salesChannel,
        payload.amount,
        tx,
      );
    });
  }

  @OnEvent('orders.events.v1', 'OrderPaymentCompleted')
  async onOrderPaymentCompleted(
    @EventEnvelope() envelope: DomainEvent<OrderPaymentCompletedPayload>,
    @EventPayload() payload: OrderPaymentCompletedPayload,
  ) {
    this.logger.log(`OrderPaymentCompleted received: ${payload.orderId}`);
    await this.inTx(async (tx) => {
      const result = await this.orderFactsService.recordSimpleOrderEvent(
        envelope,
        payload.orderId,
        new Date(payload.capturedAt),
        tx,
      );
      if (!result.claimed || result.orphan || !result.salesChannel) {
        return;
      }
      await this.channelAggregatesService.applyPaymentCompleted(result.occurredDate, result.salesChannel, tx);
    });
  }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest --testPathPattern="apps/analytics" -v`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/analytics/src/datasets/orders/
git commit -m "feat(analytics): OrderRefundCreated·OrderPaymentCompleted 소비

두 이벤트는 페이로드에 금액이 있어 원본 조회는 채널 판정용으로만 쓴다.
형태가 같아 recordSimpleOrderEvent 로 공유한다."
```

---

### Task 7: 멤버십 이벤트 소비 — fact + SCD Type 2 dim

**Files:**
- Create: `apps/analytics/src/datasets/memberships/facts/membership-types.ts`
- Create: `apps/analytics/src/datasets/memberships/facts/membership-facts.service.ts`
- Create: `apps/analytics/src/datasets/memberships/dimensions/membership-dimensions.service.ts`
- Create: `apps/analytics/src/datasets/memberships/ingest/membership-events.consumer.ts`
- Test: `apps/analytics/src/datasets/memberships/dimensions/membership-dimensions.service.spec.ts`

**Interfaces:**
- Produces:
  - `MembershipFactResult = { claimed: boolean; userId: string; status: string; tierId: string; occurredAt: Date }`
  - `MembershipFactsService.recordStatusChanged(envelope, payload, tx?): Promise<MembershipFactResult>`
  - `MembershipDimensionsService.applyStatusChanged(result: MembershipFactResult, tx?): Promise<void>`

**활성 판정:** `ACTIVE`·`RESUMED` 는 구간을 열고, `PAUSED`·`CANCELLED`·`RECURRING_CANCELLED`·`EXPIRED` 는 열린 구간을 닫는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { MembershipDimensionsService } from './membership-dimensions.service';

describe('MembershipDimensionsService', () => {
  function makeService() {
    const update = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
    });
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoNothing });
    const insert = jest.fn().mockReturnValue({ values });
    const executor = { insert, update };
    const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
    return { service: new MembershipDimensionsService(dbService as never), insert, update, values };
  }

  it('ACTIVE 는 새 구간을 연다', async () => {
    const { service, insert, values } = makeService();

    await service.applyStatusChanged({
      claimed: true,
      userId: 'user-1',
      status: 'ACTIVE',
      tierId: 'tier-1',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tierId: 'tier-1',
        validFrom: new Date('2026-07-01T00:00:00.000Z'),
        validTo: null,
      }),
    );
  });

  it('CANCELLED 는 열린 구간을 닫고 새 구간을 열지 않는다', async () => {
    const { service, insert, update } = makeService();

    await service.applyStatusChanged({
      claimed: true,
      userId: 'user-1',
      status: 'CANCELLED',
      tierId: 'tier-1',
      occurredAt: new Date('2026-07-20T00:00:00.000Z'),
    });

    expect(update).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('tierId 가 없으면 UNKNOWN 으로 채운다', async () => {
    const { service, values } = makeService();

    await service.applyStatusChanged({
      claimed: true,
      userId: 'user-2',
      status: 'ACTIVE',
      tierId: 'UNKNOWN',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ tierId: 'UNKNOWN' }));
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern="membership-dimensions.service.spec" -v`
Expected: FAIL — 모듈을 찾을 수 없음.

- [ ] **Step 3: 타입 정의**

`membership-types.ts`:

```ts
export type MembershipFactResult = {
  claimed: boolean;
  userId: string;
  status: string;
  tierId: string;
  occurredAt: Date;
};

export const MEMBERSHIP_OPENING_STATUSES = ['ACTIVE', 'RESUMED'] as const;

export function opensInterval(status: string): boolean {
  return (MEMBERSHIP_OPENING_STATUSES as readonly string[]).includes(status);
}
```

- [ ] **Step 4: MembershipFactsService 구현**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { DomainEvent } from '@packages/event-contracts/types';
import { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { analyticsSchema, factMembershipEvents } from '../../../schema';
import { DbTx } from '../../../db.types';
import { MembershipFactResult } from './membership-types';

@Injectable()
export class MembershipFactsService {
  private readonly logger = new Logger(MembershipFactsService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async recordStatusChanged(
    envelope: DomainEvent<MembershipStatusChangedPayload>,
    payload: MembershipStatusChangedPayload,
    tx?: DbTx,
  ): Promise<MembershipFactResult> {
    const occurredAt = new Date(payload.occurredAt);
    const tierId = payload.tierId ?? 'UNKNOWN';

    return this.inTx(async (executor) => {
      const claimed = await executor
        .insert(factMembershipEvents)
        .values({
          messageId: envelope.messageId,
          userId: payload.userId,
          status: payload.status,
          tierId: payload.tierId ?? null,
          planId: payload.planId ?? null,
          contractId: payload.contractId ?? null,
          reasonCode: payload.reasonCode ?? null,
          reasonText: payload.reasonText ?? null,
          occurredAt,
          payload: envelope.payload,
        })
        .onConflictDoNothing({ target: factMembershipEvents.messageId })
        .returning({ messageId: factMembershipEvents.messageId });

      if (claimed.length === 0) {
        this.logger.debug(`Duplicate MembershipStatusChanged skipped: ${envelope.messageId}`);
        return { claimed: false, userId: payload.userId, status: payload.status, tierId, occurredAt };
      }

      return { claimed: true, userId: payload.userId, status: payload.status, tierId, occurredAt };
    }, tx);
  }
}
```

- [ ] **Step 5: MembershipDimensionsService 구현**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { analyticsSchema, dimCustomerMembership } from '../../../schema';
import { DbTx } from '../../../db.types';
import { MembershipFactResult, opensInterval } from '../facts/membership-types';

@Injectable()
export class MembershipDimensionsService {
  private readonly logger = new Logger(MembershipDimensionsService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async applyStatusChanged(result: MembershipFactResult, tx?: DbTx): Promise<void> {
    const run = async (executor: DbTx) => {
      const now = new Date();

      // 열린 구간을 먼저 닫는다 — 상태가 무엇이든 이전 구간은 이 시점에 끝난다.
      await executor
        .update(dimCustomerMembership)
        .set({ validTo: result.occurredAt, updatedAt: now })
        .where(and(eq(dimCustomerMembership.userId, result.userId), isNull(dimCustomerMembership.validTo)));

      if (!opensInterval(result.status)) {
        return;
      }

      await executor
        .insert(dimCustomerMembership)
        .values({
          userId: result.userId,
          tierId: result.tierId,
          validFrom: result.occurredAt,
          validTo: null,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [dimCustomerMembership.userId, dimCustomerMembership.validFrom],
        });
    };

    await (tx ? run(tx) : this.db.transaction(run));
  }
}
```

- [ ] **Step 6: 컨슈머 구현**

```ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { EventPayload, EventEnvelope, OnEvent } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { DbService } from '@app/db';
import { analyticsSchema } from '../../../schema';
import { DbTx } from '../../../db.types';
import { MembershipFactsService } from '../facts/membership-facts.service';
import { MembershipDimensionsService } from '../dimensions/membership-dimensions.service';

@Controller()
@UseInterceptors(EventTypeGuard)
export class MembershipEventsConsumer {
  private readonly logger = new Logger(MembershipEventsConsumer.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
    private readonly membershipFactsService: MembershipFactsService,
    private readonly membershipDimensionsService: MembershipDimensionsService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  @OnEvent('membership.events.v1', 'MembershipStatusChanged')
  async onMembershipStatusChanged(
    @EventEnvelope() envelope: DomainEvent<MembershipStatusChangedPayload>,
    @EventPayload() payload: MembershipStatusChangedPayload,
  ) {
    this.logger.log(`MembershipStatusChanged received: ${payload.userId} → ${payload.status}`);
    await this.inTx(async (tx) => {
      const result = await this.membershipFactsService.recordStatusChanged(envelope, payload, tx);
      if (!result.claimed) {
        return;
      }
      await this.membershipDimensionsService.applyStatusChanged(result, tx);
    });
  }
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx jest --testPathPattern="apps/analytics" -v`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add apps/analytics/src/datasets/memberships/
git commit -m "feat(analytics): 멤버십 이벤트 소비 — fact + SCD Type 2 구간

ACTIVE/RESUMED 는 구간을 열고 나머지 4종은 열린 구간을 닫는다.
tierId 가 optional 이라 미상은 'UNKNOWN' 으로 채운다 —
unique index 에 NULL 이 들어가면 Postgres 가 중복 행을 허용한다."
```

---

### Task 8: 모듈 배선 + 컨슈머 토픽 등록

**Files:**
- Modify: `apps/analytics/src/analytics.module.ts`
- Modify: `apps/analytics/src/main.ts` (필요 시 — 아래 Step 2 확인 결과에 따름)

**Interfaces:**
- Consumes: Task 3~7 의 모든 서비스·컨슈머

- [ ] **Step 1: 프로바이더·컨트롤러 등록**

`analytics.module.ts` 를 수정한다.

```ts
import { ChannelAggregatesService } from './datasets/orders/aggregates/channel-aggregates.service';
import { VariantAggregatesService } from './datasets/orders/aggregates/variant-aggregates.service';
import { CustomerLifetimeService } from './datasets/orders/aggregates/customer-lifetime.service';
import { MembershipFactsService } from './datasets/memberships/facts/membership-facts.service';
import { MembershipDimensionsService } from './datasets/memberships/dimensions/membership-dimensions.service';
import { MembershipEventsConsumer } from './datasets/memberships/ingest/membership-events.consumer';
```

`controllers` 배열에 `MembershipEventsConsumer` 를 추가하고, `providers` 배열에 5개 서비스를 추가한다.

- [ ] **Step 2: `MEMBERSHIP_STREAM` 구독 등록**

**이 스텝을 빠뜨리면 멤버십 컨슈머가 조용히 아무것도 받지 않는다.** 예외도 로그도 없이 무동작이라 발견이 늦다.

`analytics.module.ts:34` 의 `streams` 배열에 추가한다.

```ts
import { MEMBERSHIP_STREAM } from '@packages/event-contracts/streams/membership.stream';

    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM, PRODUCT_STREAM, MEMBERSHIP_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'analytics-consumer',
      enableAutoDLQ: true,
    }),
```

`main.ts:72` 의 로그 문자열도 갱신한다.

```ts
    logger.log('Kafka consumer connected (orders.events.v1, products.events.v1, membership.events.v1).');
```

- [ ] **Step 3: 앱 부팅 확인**

Run: `npx nest build analytics`
Expected: 빌드 성공. (webpack module-not-found 계열 기존 부채가 나오면 신규 파일과 무관한지 확인)

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `npx jest --testPathPattern="apps/analytics" -v`
Expected: PASS — Task 2~7 의 모든 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add apps/analytics/src/analytics.module.ts apps/analytics/src/main.ts
git commit -m "feat(analytics): 신규 집계 서비스·멤버십 컨슈머 모듈 배선"
```

---

## 계획 1 완료 조건

- `npx jest --testPathPattern="apps/analytics"` 전부 통과
- `npx nest build analytics` 성공
- 마이그레이션 SQL 에 `DROP` 구문 없음
- 커밋 8개 (Task 당 1개)

## 배포 시 주의

이 계획의 결과물은 **`migrate → deploy` 순서**로 나간다 (expand phase). 스키마가 먼저
적용되어야 새 코드가 뜬다. 반대로 하면 신규 컬럼을 읽는 코드가 없는 컬럼을 만난다.

배포 직후 확인:
- DLQ 에 `OrderCancelled`·`OrderRefundCreated`·`OrderPaymentCompleted`·`MembershipStatusChanged` 유입이 없는지.
  이 4종은 지금까지 analytics 가 소비한 적이 없어 zod 런타임 검증이 여기서 처음 돈다.
- "백필 범위 밖 주문의 취소 — 건너뜀" 경고 건수. 백필(계획 2) 전이므로 다수 발생이 정상이다.

## 이 계획이 의도적으로 남기는 것

**`agg_membership_daily` 는 테이블만 만들고 채우지 않는다.** 이 테이블은 periodic snapshot
fact 라 "그날 활성 회원 몇 명"을 날짜별로 찍는 물건이고, 이벤트 도착 시 증분하는 방식으로는
만들 수 없다 — 아무 일도 일어나지 않은 날에도 행이 필요하기 때문이다.

일별 스케줄러가 `dim_customer_membership` 의 열린 구간을 세어 기록하는 형태가 되며,
**`dim` 이 백필로 채워진 뒤에야 의미 있는 수치가 나오므로 계획 3 으로 미룬다.**
계획 1 종료 시점에 이 테이블이 비어 있는 것은 정상이다.

## 다음 계획

- **계획 2**: 백필 스크립트 (`scripts/analytics-backfill/`) — 주문·멤버십 원본을 합성 이벤트로 재생
- **계획 3**: 조회 API + `agg_membership_daily` 일별 스케줄러 + admin-web 프록시 + 관리자 RBAC
- **계획 4**: admin-web 통계 화면 3탭
