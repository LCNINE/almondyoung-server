# 배치 피킹방식 ↔ 피킹전략 정합성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배치의 `picking_method` 와 피킹 plan 의 `strategy` 가 어긋날 수 있는 구조를 없앤다 — plan 이 전략을 고르지 않고 배치 방식에서 파생하게 만든다.

**Architecture:** 방식↔전략 1:1 맵을 단일 출처(`picking-method.contract.ts`)로 두고, ① 배치 생성이 창고 능력으로 방식을 검증하고 ② plan 생성이 배치 방식에서 전략을 파생한다. `cart_capacity` 는 `multi_order`(pick_to_tote) 전용 배치 송장 수 상한으로 되살린다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), PostgreSQL, Jest, Next.js(admin-web), class-validator

**스펙:** `docs/superpowers/specs/2026-07-27-picking-method-strategy-alignment-design.md`
**이슈:** #543
**브랜치:** `docs/picking-method-strategy-alignment` (base `611f104e0`)

## Global Constraints

- **범위는 정합성까지.** 창고 `supported_picking_strategies` 값은 **절대 변경하지 않는다** — 그것이 곧 토탈피킹·멀티오더 개통이고, 별도 결정 사항이다.
- **CHECK 제약은 `picking_method::text <> 'multi_order'` 로 쓴다 (enum 리터럴 직접 비교 금지).** Postgres 는 새로 추가한 enum 값을 같은 트랜잭션에서 **enum 리터럴로** 쓰는 것을 거부한다(`unsafe use of new value of enum type`). 그리고 drizzle 은 **대기 중인 모든 마이그레이션 파일을 하나의 트랜잭션에 묶는다**(`drizzle-orm/pg-core/dialect.js:60` — `session.transaction()` 안에서 전체 파일을 순회) — 즉 파일을 나눠도 같은 배포에서 둘 다 처음 적용되면 같은 트랜잭션이라 실패한다. `::text` 비교는 문자열 상수라 enum 값을 해석하지 않으므로 한 트랜잭션 안에서 안전하다(로컬 실측 확인). 이 방식이면 **마이그레이션 파일을 나눌 필요가 없다.**
- **배포 순서: `migrate` → `deploy`** (ADR-0005 §5 expand phase).
- 409 는 전부 `{ code, error: code, message }` 형태로 던진다. `GlobalExceptionFilter` 는 `error` 필드만 코드로 통과시킨다.
- 통합 스펙은 `describeIfDb` 게이트라 **`DATABASE_URL` 없이 돌리면 조용히 초록**이다. 반드시 실 DB 를 주고 실행한다.
- Inventory 쿼리 규칙: `db.query.*` 금지, `trx.select().from().where()` 만. `any`/`as` 캐스팅 금지.
- 트랜잭션 전파: 공개 메서드는 `tx?: DbTx` 를 마지막 파라미터로, 내부에서는 `this.dbService.run(async (trx) => {...}, tx)`.
- 신규 method enum 값 이름은 **`multi_order`** 다. `pick_to_tote` 는 전략 이름이지 방식 이름이 아니다.

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `apps/core/src/modules/fulfillment/picking/picking-method.contract.ts` (신규) | 방식↔전략 1:1 맵 단일 출처 | 1 |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | `picking_method` enum 값 추가, `cart_capacity` CHECK | 1 |
| `apps/core/drizzle/*.sql` (신규 1건) | enum 값 추가 + CHECK 제약(`::text` 비교) | 1 |
| `apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts` | 배치 생성 DTO 계약 | 2 |
| `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts` | 배치 생성 검증, 정원 강제, 409 코드 전달 | 2, 4 |
| `apps/core/src/modules/fulfillment/dto/picking-v2.dto.ts` | `strategy` 선택 필드 강등 | 3 |
| `apps/core/src/modules/fulfillment/picking/picking-strategy.interface.ts` | `PlanPickingInput.requestedStrategy` | 3 |
| `apps/core/src/modules/fulfillment/services/picking-process.service.ts` | 배치 방식에서 전략 파생 | 3 |
| `apps/core/src/modules/fulfillment/controllers/picking-v2.controller.ts` | plan 핸들러 전달 형태 | 3 |
| `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts` | 새 `plan()` 시그니처 호출 | 3 |
| `apps/admin-web/src/lib/types/dto/fulfillment.ts` | 요청 타입 | 5, 6 |
| `apps/admin-web/.../create-batch-dialog/index.tsx` | 방식·바구니 수 입력 | 5 |
| `apps/admin-web/.../batch-detail-drawer/index.tsx` | 전략 선택 제거 | 6 |
| `apps/admin-web/.../outbound-batches` 목록 | 방식 표시 | 6 |

---

## Task 1: 방식↔전략 계약과 스키마

**Files:**
- Create: `apps/core/src/modules/fulfillment/picking/picking-method.contract.ts`
- Create: `apps/core/src/modules/fulfillment/picking/picking-method.contract.spec.ts`
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:202` (enum), `:2233-2257` (outboundBatches 테이블 정의)
- Create: `apps/core/drizzle/<timestamp>_add-multi-order-picking-method-and-cart-capacity-check.sql` (1개)

**Interfaces:**
- Consumes: `PickingMethodEnum` (`apps/core/src/modules/inventory/schema/enum-values.ts:149`), `PickingStrategyName` (`apps/core/src/modules/fulfillment/picking/picking-strategy.interface.ts:3`)
- Produces: `STRATEGY_BY_PICKING_METHOD: Record<PickingMethodEnum, PickingStrategyName>`, `strategyForPickingMethod(method: PickingMethodEnum): PickingStrategyName`

- [ ] **Step 1: 실패 테스트 작성**

`apps/core/src/modules/fulfillment/picking/picking-method.contract.spec.ts`:

```ts
import { pickingMethodValues } from '../../inventory/schema/enum-values';
import { STRATEGY_BY_PICKING_METHOD, strategyForPickingMethod } from './picking-method.contract';

describe('picking method contract', () => {
  it('maps every picking method to exactly one strategy', () => {
    expect(STRATEGY_BY_PICKING_METHOD).toEqual({
      individual: 'discrete',
      total_picking: 'aggregate_then_sort',
      multi_order: 'pick_to_tote',
    });
  });

  it('covers every enum value declared in the schema', () => {
    for (const method of pickingMethodValues) {
      expect(strategyForPickingMethod(method)).toBeDefined();
    }
    expect(Object.keys(STRATEGY_BY_PICKING_METHOD).sort()).toEqual([...pickingMethodValues].sort());
  });

  it('never maps two methods to the same strategy', () => {
    const strategies = Object.values(STRATEGY_BY_PICKING_METHOD);
    expect(new Set(strategies).size).toBe(strategies.length);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx jest --testPathPattern=picking-method.contract`
Expected: FAIL — `Cannot find module './picking-method.contract'`

- [ ] **Step 3: enum 에 `multi_order` 추가**

`apps/core/src/modules/inventory/schema/inventory.schema.ts:202`:

```ts
export const pickingMethodEnum = pgEnum('picking_method', ['individual', 'total_picking', 'multi_order']);
```

- [ ] **Step 4: 계약 파일 작성**

`apps/core/src/modules/fulfillment/picking/picking-method.contract.ts`:

```ts
import type { PickingMethodEnum } from '../../inventory/schema/enum-values';
import type { PickingStrategyName } from './picking-strategy.interface';

/**
 * 배치의 피킹 "방식"(현장 용어)과 코드 "전략"의 1:1 대응. 두 축이 어긋나는 것을
 * 막는 단일 출처다 — plan 은 전략을 고르지 않고 이 맵으로 배치 방식에서 파생한다.
 *
 * `satisfies Record<PickingMethodEnum, ...>` 가 핵심이다. picking_method enum 에
 * 값이 추가되면 이 맵을 갱신하지 않는 한 컴파일이 깨진다.
 */
export const STRATEGY_BY_PICKING_METHOD = {
  individual: 'discrete',
  total_picking: 'aggregate_then_sort',
  multi_order: 'pick_to_tote',
} as const satisfies Record<PickingMethodEnum, PickingStrategyName>;

export function strategyForPickingMethod(method: PickingMethodEnum): PickingStrategyName {
  return STRATEGY_BY_PICKING_METHOD[method];
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest --testPathPattern=picking-method.contract`
Expected: PASS (3 tests)

- [ ] **Step 6: `cart_capacity` CHECK 제약을 스키마에 추가 (`::text` 비교)**

`apps/core/src/modules/inventory/schema/inventory.schema.ts` 의 `outboundBatches` 두 번째 인자(현재 `idxWarehouseStatus`/`idxBatchNumber` 만 있음)에 추가한다. `check`·`sql` 은 이 파일에서 이미 import 되어 있다:

```ts
  (t) => ({
    idxWarehouseStatus: index('idx_outbound_batches_warehouse_status').on(t.warehouseId, t.status),
    idxBatchNumber: index('idx_outbound_batches_number').on(t.batchNumber),
    // multi_order(pick_to_tote) 배치는 카트 바구니 수 = 담을 수 있는 송장 수 상한이다.
    // `::text` 캐스팅은 필수다. enum 리터럴로 직접 비교하면, 같은 마이그레이션 트랜잭션에서
    // ADD VALUE 된 'multi_order' 를 쓰는 셈이라 Postgres 가 거부한다
    // (unsafe use of new value of enum type). drizzle 은 대기 중인 마이그레이션 파일
    // 전부를 하나의 트랜잭션에 묶으므로(pg-core/dialect.js:60) 파일을 나눠도 해결되지 않는다.
    ckCartCapacity: check(
      'ck_outbound_batches_cart_capacity',
      sql`${t.pickingMethod}::text <> 'multi_order' OR (${t.cartCapacity} IS NOT NULL AND ${t.cartCapacity} >= 1)`,
    ),
  }),
```

`cart_capacity` 주석도 정정한다(`:2242`):

```ts
    // multi_order(pick_to_tote) 전용 — 카트에 달린 바구니 수 = 배치 송장 수 상한.
    // aggregate_then_sort 의 큰 카트에는 바구니가 없다(부피·무게가 상한이라 정형화 불가).
    cartCapacity: integer('cart_capacity'),
```

- [ ] **Step 7: 마이그레이션 1개 생성**

Run: `npm run db:generate:core -- --name add-multi-order-picking-method-and-cart-capacity-check`

생성된 `apps/core/drizzle/<timestamp>_*.sql` **한 파일**에 두 문장이 모두 들어 있어야 한다:

```sql
ALTER TYPE "public"."picking_method" ADD VALUE 'multi_order';--> statement-breakpoint
ALTER TABLE "outbound_batches" ADD CONSTRAINT "ck_outbound_batches_cart_capacity" CHECK ("picking_method"::text <> 'multi_order' OR ("cart_capacity" IS NOT NULL AND "cart_capacity" >= 1));
```

CHECK 에 `::text` 가 **없으면** 배포가 깨진다 — 스키마를 고치고 생성된 파일을 `git rm` 한 뒤 다시 생성한다(마이그레이션 SQL 을 손으로 고치지 않는다).

- [ ] **Step 8: 한 트랜잭션에서 적용되는지 실증**

이 태스크의 핵심 검증이다. 두 문장이 **한 트랜잭션 안에서** 통과하는 것을 실제로 확인한다:

Run:
```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d postgres \
  -c "DROP DATABASE IF EXISTS migrate_probe;" -c "CREATE DATABASE migrate_probe;"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/migrate_probe \
  npx drizzle-kit migrate --config apps/core/drizzle.config.ts
PGPASSWORD=postgres psql -h localhost -U postgres -d postgres -c "DROP DATABASE migrate_probe;"
```

Expected: 빈 DB 에 전체 마이그레이션이 처음부터 끝까지 한 번에 적용되고 오류가 없다. 이것이 **신규 배포 경로 그대로**다. `unsafe use of new value of enum type` 이 나오면 `::text` 가 빠진 것이다.

- [ ] **Step 8b: 로컬 dev DB 에 적용**

Task 2 부터의 통합 테스트가 `multi_order` enum 값과 CHECK 제약을 실제로 쓴다. 적용하지 않으면 그 테스트들이 "enum 값 없음" 으로 깨진다. drizzle 마이그레이션 저널과 어긋나지 않게 **drizzle-kit 으로** 적용한다(psql 로 SQL 을 직접 실행하지 말 것 — 저널이 어긋나 이후 `db:migrate` 가 깨진다):

Run:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core \
  npx drizzle-kit migrate --config apps/core/drizzle.config.ts
```

Expected: 새 마이그레이션 1건이 적용되고 나머지는 이미 적용됨으로 건너뛴다.

검증:
```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d core -tAc \
  "select unnest(enum_range(null::picking_method));"
```
Expected: `individual`, `total_picking`, `multi_order` 세 줄

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/fulfillment/picking/picking-method.contract.ts \
        apps/core/src/modules/fulfillment/picking/picking-method.contract.spec.ts \
        apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle
git commit -m "feat(core): 피킹 방식↔전략 1:1 계약과 multi_order enum 값 추가"
```

---

## Task 2: 배치 생성 — 창고 능력 검사와 `cartCapacity` 계약

**Files:**
- Modify: `apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts:10-27`
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts:72-122` (createBatch), `:1330-1332` (conflict 헬퍼)
- Test: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.spec.ts` (트랜잭션 진입 전 검증), `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.integration.spec.ts` (창고 능력 검사)

**Interfaces:**
- Consumes: `STRATEGY_BY_PICKING_METHOD` (Task 1)
- Produces: `CreateOutboundBatchV2Dto { warehouseId, pickingMethod: PickingMethodEnum, cartCapacity?: number, name?, scheduledPickingAt? }`, 409 `OUTBOUND_BATCH_METHOD_NOT_SUPPORTED`

- [ ] **Step 1: 트랜잭션 진입 전 검증 실패 테스트 작성**

`outbound-batch-orchestrator.service.spec.ts` 파일 끝에 추가한다. 이 검증은 `commands.execute` 호출 **이전**에 일어나므로 DB 가 필요 없다:

```ts
describe('createBatch picking method contract', () => {
  const actor = { id: UUIDS.actor, roles: ['master'] };
  const makeOrchestrator = () => {
    const commands = { execute: jest.fn() };
    const workflowGate = { assertV2MutationAllowed: jest.fn() };
    const orchestrator = new OutboundBatchOrchestrator(
      {} as never, commands as never, {} as never, {} as never,
      {} as never, {} as never, workflowGate as never, {} as never,
    );
    return { orchestrator, commands };
  };

  it('rejects a multi_order batch without cartCapacity before touching the database', async () => {
    const { orchestrator, commands } = makeOrchestrator();
    await expect(
      orchestrator.createBatch(
        { warehouseId: UUIDS.batch, pickingMethod: 'multi_order' } as never,
        'key-1',
        actor,
      ),
    ).rejects.toThrow(/cartCapacity is required/);
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('rejects cartCapacity on a method that has no baskets', async () => {
    const { orchestrator, commands } = makeOrchestrator();
    await expect(
      orchestrator.createBatch(
        { warehouseId: UUIDS.batch, pickingMethod: 'individual', cartCapacity: 24 } as never,
        'key-2',
        actor,
      ),
    ).rejects.toThrow(/cartCapacity is only allowed/);
    expect(commands.execute).not.toHaveBeenCalled();
  });
});
```

> 생성자 인자 순서는 `outbound-batch-orchestrator.service.ts:62-70` 과 일치해야 한다: `dbService, commands, invariant, waybills, audit, workflowGate, moduleRef` — 실제 파일을 열어 인자 개수와 위치를 확인하고 `{} as never` 자리를 맞춘다.

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx jest --testPathPattern=outbound-batch-orchestrator.service.spec -t "picking method contract"`
Expected: FAIL — 현재는 `pickingMethod !== 'individual'` 게이트가 먼저 409 를 던지므로 메시지가 다르다

- [ ] **Step 3: DTO 계약 확장**

`apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts`:

```ts
import { pickingMethodValues, type PickingMethodEnum } from '../../inventory/schema/enum-values';

export class CreateOutboundBatchV2Dto {
  @IsUUID()
  warehouseId: string;

  @ApiProperty({ enum: pickingMethodValues })
  @IsIn(pickingMethodValues)
  pickingMethod: PickingMethodEnum;

  /** multi_order 전용 — 카트 바구니 수 = 이 배치에 담을 수 있는 송장 수 상한. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  cartCapacity?: number;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  scheduledPickingAt?: Date;
}
```

`Max` 를 `class-validator` import 목록에 추가한다.

- [ ] **Step 4: `createBatch` 교체**

`outbound-batch-orchestrator.service.ts:79-84` 의 하드코딩 게이트를 지우고 아래로 바꾼다:

```ts
    this.workflowGate.assertV2MutationAllowed('outbound_batch.create');
    const requiredStrategy = STRATEGY_BY_PICKING_METHOD[dto.pickingMethod];
    if (dto.pickingMethod === 'multi_order') {
      if (dto.cartCapacity === undefined || dto.cartCapacity === null) {
        throw new BadRequestException('cartCapacity is required for multi_order batches');
      }
    } else if (dto.cartCapacity !== undefined && dto.cartCapacity !== null) {
      throw new BadRequestException(
        `cartCapacity is only allowed for multi_order batches (got ${dto.pickingMethod})`,
      );
    }
```

트랜잭션 안의 창고 조회(`:93-97`)를 확장하고 능력 검사를 추가한다:

```ts
        const [warehouse] = await trx
          .select({
            id: wmsTables.warehouses.id,
            supportedPickingStrategies: wmsTables.warehouses.supportedPickingStrategies,
          })
          .from(wmsTables.warehouses)
          .where(eq(wmsTables.warehouses.id, dto.warehouseId))
          .limit(1);
        if (!warehouse) throw new NotFoundException(`Warehouse ${dto.warehouseId} not found`);
        if (!warehouse.supportedPickingStrategies?.includes(requiredStrategy)) {
          throw this.conflict(
            'OUTBOUND_BATCH_METHOD_NOT_SUPPORTED',
            `Warehouse ${dto.warehouseId} does not support ${requiredStrategy}, required by picking method ${dto.pickingMethod}`,
          );
        }
```

insert 에 `cartCapacity` 를 싣는다(`:104-112` 의 `.values({...})`):

```ts
            pickingMethod: dto.pickingMethod,
            cartCapacity: dto.cartCapacity ?? null,
```

감사 payload(`:113-117`)에도 추가한다:

```ts
          pickingMethod: batch.pickingMethod,
          cartCapacity: batch.cartCapacity,
```

`STRATEGY_BY_PICKING_METHOD` 를 import 한다.

응답에도 실어야 admin-web 이 표시할 수 있다. 상세 매퍼(`:552`)와 목록 매퍼(`:634`)의 `pickingMethod: batch.pickingMethod,` 바로 아래에 각각 추가한다:

```ts
        cartCapacity: batch.cartCapacity,
```

응답 DTO 두 곳(`outbound-batch-v2.dto.ts` 의 `OutboundBatchV2DetailDto:124`, `OutboundBatchV2ListItemDto:186`)에 필드를 선언한다. 방식 타입도 함께 좁힌다:

```ts
  pickingMethod: PickingMethodEnum;
  @ApiPropertyOptional({ nullable: true })
  cartCapacity: number | null;
```

- [ ] **Step 5: 409 코드 전달 수정**

`outbound-batch-orchestrator.service.ts:1330`:

```ts
  private conflict(code: string, message: string): ConflictException {
    // GlobalExceptionFilter 는 `error` 필드만 코드로 통과시킨다. 빠뜨리면 클라이언트가
    // 전부 'CONFLICT' 로 받는다 (simple-outbound.service.ts:655 와 동일 형태).
    return new ConflictException({ code, error: code, message });
  }
```

- [ ] **Step 6: 단위 테스트 통과 확인**

Run: `npx jest --testPathPattern=outbound-batch-orchestrator.service.spec`
Expected: PASS (기존 케이스 포함 전량)

- [ ] **Step 7: 공통 픽스처의 창고 설정 기본값 채우기 ⚠️ 블라스트 반경**

`seedWarehouseWithZone`(`__support__/logistics-fixtures.ts:9-19`)은 창고를 `supportedPickingStrategies` **없이(NULL)** 만든다. 새 검사가 붙으면 이 픽스처로 만든 창고에서는 `individual` 배치조차 만들 수 없어 **12개 스펙 파일이 무더기로 깨진다.** 기본값을 채운다:

```ts
export async function seedWarehouseWithZone(tx: DbTx): Promise<{ warehouseId: string; locationId: string }> {
  const [wh] = await tx
    .insert(wmsTables.warehouses)
    // 배치 생성이 창고 능력을 검사하므로 기본 창고는 discrete 를 지원해야 한다.
    // 다른 전략이 필요한 스펙은 이 값을 자기가 덮어쓴다(outbound-v2-warehouse-scenarios 등).
    .values({ name: `it-wh-${randomUUID().slice(0, 8)}`, supportedPickingStrategies: ['discrete'] })
    .returning();
```

- [ ] **Step 8: 방식이 어긋난 기존 시나리오 호출부 정정**

`outbound-v2-warehouse-scenarios.integration.spec.ts` 는 창고가 특정 전략 **하나만** 지원하도록 world 를 만들면서 배치는 항상 `individual` 로 만든다. 새 검사에서 이 조합은 409 다. 헬퍼에 인자를 추가하고 호출부를 맞춘다.

`createBatchWithShipments`(`:404-422`) 시그니처:

```ts
  async function createBatchWithShipments(
    services: ReturnType<typeof makeServices>,
    world: WarehouseWorld,
    actor: Actor,
    pickingMethod: 'individual' | 'total_picking' | 'multi_order' = 'individual',
    cartCapacity?: number,
  ) {
    const batch = await services.batches.createBatch(
      { warehouseId: world.warehouseId, pickingMethod, cartCapacity, name: `Release batch ${randomUUID()}` },
      `release-batch-${randomUUID()}`,
      actor,
    );
```

호출부 4곳을 world 의 전략에 맞춘다:

| 줄 | world 전략 | 바꿀 호출 |
|---|---|---|
| `:875` | 기본(3종 전부), 이후 `totePick` 사용 | `createBatchWithShipments(services, successWorld, manager, 'multi_order', 4)` |
| `:991` | `['discrete']` | 변경 없음 (`'individual'`) |
| `:1057` | `['aggregate_then_sort']` | `createBatchWithShipments(services, world, manager, 'total_picking')` |
| `:1105` | `['pick_to_tote']` | `createBatchWithShipments(services, world, manager, 'multi_order', 4)` |
| `:1147` | `['aggregate_then_sort']` | `createBatchWithShipments(services, world, manager, 'total_picking')` |

`:875` 의 `cartCapacity` 를 **4로 넉넉히** 두는 이유가 있다. 그 테스트는 배치에 송장 1건을 담은 뒤 두 번째 송장 추가가 `WAYBILL_NOT_DISPATCHABLE` 로 거부되는 것을 단언한다. Task 4 의 정원 검사는 적격성 검사보다 **앞서** 실행되므로, 정원을 1로 두면 기대한 것과 다른 에러(`OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED`)가 나와 테스트가 깨진다.

- [ ] **Step 9: 창고 능력 검사 통합 테스트 작성**

`outbound-batch-orchestrator.integration.spec.ts` 에 추가한다. 이 파일에는 `committedFixture()`(`:243`)와 `createBatch(warehouseId)`(`:247`) 헬퍼가 이미 있다:

```ts
  it('rejects a batch whose picking method is not supported by the warehouse', async () => {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));

    await expect(
      services.batches.createBatch(
        { warehouseId: warehouse.warehouseId, pickingMethod: 'total_picking', name: 'unsupported' },
        `batch-create-${randomUUID()}`,
        master,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'OUTBOUND_BATCH_METHOD_NOT_SUPPORTED' }),
    });
  });

  it('creates a multi_order batch once the warehouse supports pick_to_tote', async () => {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    await db
      .update(wmsTables.warehouses)
      .set({ supportedPickingStrategies: ['pick_to_tote'] })
      .where(eq(wmsTables.warehouses.id, warehouse.warehouseId));

    const created = await services.batches.createBatch(
      { warehouseId: warehouse.warehouseId, pickingMethod: 'multi_order', cartCapacity: 24, name: 'tote batch' },
      `batch-create-${randomUUID()}`,
      master,
    );
    expect(created.batchId).toBeDefined();
  });
```

첫 테스트가 성립하는 이유: Step 7 의 기본값이 `['discrete']` 뿐이라 `total_picking` 이 요구하는 `aggregate_then_sort` 를 지원하지 않는다.

- [ ] **Step 10: 통합 테스트 실행 (실 DB 필요)**

Run: `DATABASE_URL=<dev core DB URL> npx jest --testPathPattern="outbound-batch-orchestrator.integration|outbound-v2-warehouse-scenarios"`
Expected: 두 스위트 전량 PASS. `DATABASE_URL` 을 주지 않으면 `describeIfDb` 가 통째로 skip 되어 **거짓 초록**이 된다 — 반드시 준다.

- [ ] **Step 11: 커밋**

```bash
git add apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts \
        apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts \
        apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.spec.ts \
        apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.integration.spec.ts \
        apps/core/src/modules/fulfillment/services/outbound-v2-warehouse-scenarios.integration.spec.ts \
        apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.ts
git commit -m "feat(core): 배치 생성이 창고 능력으로 피킹 방식을 검증하고 409 코드를 전달"
```

---

## Task 3: plan 생성이 배치 방식에서 전략을 파생

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/picking-strategy.interface.ts:18-23` (`PlanPickingInput`)
- Modify: `apps/core/src/modules/fulfillment/dto/picking-v2.dto.ts:17-28`
- Modify: `apps/core/src/modules/fulfillment/services/picking-process.service.ts:73-83`
- Modify: `apps/core/src/modules/fulfillment/controllers/picking-v2.controller.ts:95-109`
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts:573-582`
- Test/Modify: `apps/core/src/modules/fulfillment/services/outbound-v2-warehouse-scenarios.integration.spec.ts` — 이 파일이 `PickingProcessService` 를 직접 조립하고(`:188`) 세 전략의 `plan()` 을 모두 호출하는 유일한 통합 스펙이다

**Interfaces:**
- Consumes: `STRATEGY_BY_PICKING_METHOD` (Task 1)
- Produces: `PickingProcessService.plan(input: PlanPickingInput, tx?: DbTx)` — 전략 인자가 사라진다. `PlanPickingInput.requestedStrategy?: PickingStrategyName`. 409 `PICKING_STRATEGY_BATCH_METHOD_MISMATCH`

- [ ] **Step 1: 핵심 회귀 테스트 작성**

**첫 테스트는 현재 코드에서 통과해버린다** — 그것이 #543 그 자체이고, 그래서 진짜 RED 다. `outbound-v2-warehouse-scenarios.integration.spec.ts` 의 `describeIfDb` 블록 안에 추가한다. 이 파일은 `inRollbackTx(db, async (tx) => {...})` 안에서 `makeServices(tx)` 로 서비스를 조립하는 패턴을 쓴다(`:1050` 근처 참고):

```ts
    it('refuses a strategy that contradicts the batch picking method', async () => {
      await inRollbackTx(db, async (tx) => {
        // 창고는 두 전략을 모두 지원하지만 배치는 individual 이다.
        const world = await seedWorld(tx, [2], ['discrete', 'aggregate_then_sort']);
        await seedRegisteredWaybills(tx, world);
        const services = makeServices(tx);
        const manager = { id: randomUUID(), roles: ['master'] };
        const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
        const { batch } = await createBatchWithShipments(services, world, manager);

        await expect(
          services.picking.plan({
            batchId: batch.batchId,
            shipmentIds: [world.shipments[0].shipment.id],
            actorId: worker.id,
            idempotencyKey: `mismatch-plan-${randomUUID()}`,
            requestedStrategy: 'aggregate_then_sort',
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ error: 'PICKING_STRATEGY_BATCH_METHOD_MISMATCH' }),
        });
      });
    });

    it('derives the strategy from the batch when the request omits it', async () => {
      await inRollbackTx(db, async (tx) => {
        const world = await seedWorld(tx, [2], ['discrete']);
        await seedRegisteredWaybills(tx, world);
        const services = makeServices(tx);
        const manager = { id: randomUUID(), roles: ['master'] };
        const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
        const { batch } = await createBatchWithShipments(services, world, manager);

        const planned = await services.picking.plan({
          batchId: batch.batchId,
          shipmentIds: [world.shipments[0].shipment.id],
          actorId: worker.id,
          idempotencyKey: `derived-plan-${randomUUID()}`,
        });

        expect(planned.state).toBe('planned');
        const [row] = await tx
          .select({ strategy: wmsTables.pickingPlans.strategy })
          .from(wmsTables.pickingPlans)
          .where(eq(wmsTables.pickingPlans.batchId, batch.batchId))
          .limit(1);
        expect(row.strategy).toBe('discrete');
      });
    });

    it('applies the same derivation to a replanned batch', async () => {
      await inRollbackTx(db, async (tx) => {
        const world = await seedWorld(tx, [2], ['discrete', 'aggregate_then_sort']);
        await seedRegisteredWaybills(tx, world);
        const services = makeServices(tx);
        const manager = { id: randomUUID(), roles: ['master'] };
        const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
        const { batch } = await createBatchWithShipments(services, world, manager);
        const shipmentIds = [world.shipments[0].shipment.id];

        await services.picking.plan({
          batchId: batch.batchId,
          shipmentIds,
          actorId: worker.id,
          idempotencyKey: `replan-first-${randomUUID()}`,
        });

        // 재plan 도 같은 경로를 타므로 배치 방식과 어긋나는 전략은 여전히 막힌다.
        await expect(
          services.picking.plan({
            batchId: batch.batchId,
            shipmentIds,
            actorId: worker.id,
            idempotencyKey: `replan-second-${randomUUID()}`,
            requestedStrategy: 'aggregate_then_sort',
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ error: 'PICKING_STRATEGY_BATCH_METHOD_MISMATCH' }),
        });
      });
    });
```

> `seedWorld`·`seedRegisteredWaybills`·`makeServices`·`createBatchWithShipments` 는 모두 이 스펙 파일이 이미 갖고 있는 헬퍼다. 새로 만들지 말 것.

- [ ] **Step 2: 실행해서 실패 확인**

Run: `DATABASE_URL=<dev core DB URL> npx jest --testPathPattern=outbound-v2-warehouse-scenarios -t "contradicts the batch picking method"`
Expected: FAIL — `plan()` 이 아직 첫 인자로 전략 이름을 요구하므로 타입 오류이거나, 인자를 맞춰도 **409 없이 성공**한다

- [ ] **Step 3: `PlanPickingInput` 에 요청 전략 추가**

`picking-strategy.interface.ts`:

```ts
export interface PlanPickingInput {
  batchId: string;
  shipmentIds: string[];
  actorId: string;
  idempotencyKey: string;
  /**
   * 호출자가 보낸 전략(선택). 실제 전략은 배치의 pickingMethod 에서 파생되며,
   * 이 값이 있으면 파생값과 일치하는지만 검증한다. 외부 호출자 완충용이고
   * 후속 정리에서 제거 대상이다.
   */
  requestedStrategy?: PickingStrategyName;
}
```

- [ ] **Step 4: DTO 의 `strategy` 를 선택 필드로 강등**

`picking-v2.dto.ts`:

```ts
export class PlanPickingV2Dto {
  /** @deprecated 배치의 pickingMethod 에서 파생된다. 보내면 일치 검증만 한다. */
  @IsOptional()
  @IsIn(['discrete', 'aggregate_then_sort', 'pick_to_tote'])
  strategy?: 'discrete' | 'aggregate_then_sort' | 'pick_to_tote';

  @IsUUID()
  batchId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  shipmentIds: string[];
}
```

`IsOptional` 을 import 목록에 추가한다.

- [ ] **Step 5: `PickingProcessService.plan` 교체**

`picking-process.service.ts:73-83` 를 통째로 바꾼다:

```ts
  async plan(input: PlanPickingInput, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select({
          warehouseId: wmsTables.outboundBatches.warehouseId,
          pickingMethod: wmsTables.outboundBatches.pickingMethod,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${input.batchId} not found`);
      const derived = STRATEGY_BY_PICKING_METHOD[batch.pickingMethod];
      if (input.requestedStrategy && input.requestedStrategy !== derived) {
        throw new ConflictException({
          code: 'PICKING_STRATEGY_BATCH_METHOD_MISMATCH',
          error: 'PICKING_STRATEGY_BATCH_METHOD_MISMATCH',
          message: `Batch ${input.batchId} is ${batch.pickingMethod}; strategy ${input.requestedStrategy} is not allowed`,
        });
      }
      const strategy = await this.requiredRegistry().resolveForWarehouse(derived, batch.warehouseId, trx);
      return strategy.plan(input, trx);
    }, tx);
  }
```

`STRATEGY_BY_PICKING_METHOD` 를 import 한다. `ConflictException` 은 이미 import 되어 있다.

- [ ] **Step 6: 컨트롤러 전달 형태 수정**

`picking-v2.controller.ts:102-109`:

```ts
    return this.picking.plan({
      batchId: dto.batchId,
      shipmentIds: dto.shipmentIds,
      actorId: this.actor(user).id,
      idempotencyKey: this.idempotencyKey(idempotencyKey),
      requestedStrategy: dto.strategy,
    });
```

- [ ] **Step 7: 단순출고 호출부 수정**

`simple-outbound.service.ts:573-582`:

```ts
    const planned = await this.picking.plan(
      {
        batchId,
        shipmentIds: members.map((member) => member.shipmentId),
        actorId: actor.id,
        idempotencyKey: `simple:${idempotencyKey}:plan`,
      },
      tx,
    );
```

단순출고는 `individual` 배치만 다루므로 파생 결과가 기존 `'discrete'` 와 동일하다.

- [ ] **Step 7b: 기존 스펙의 `plan()` 호출부 3곳 정정**

`outbound-v2-warehouse-scenarios.integration.spec.ts` 의 세 피킹 헬퍼가 전략을 첫 인자로 넘긴다. 인자를 없앤다(배치 방식은 Task 2 Step 8 에서 이미 맞춰 뒀으므로 파생 결과가 같다):

| 줄 | 현재 | 바꿀 것 |
|---|---|---|
| `:660` | `services.picking.plan('discrete', {` | `services.picking.plan({` |
| `:720` | `services.picking.plan('aggregate_then_sort', {` | `services.picking.plan({` |
| `:795` | `services.picking.plan('pick_to_tote', {` | `services.picking.plan({` |

Run: `grep -rn "picking.plan(" apps/core/src --include=*.ts` — 남은 호출부가 없는지 확인한다.

- [ ] **Step 8: 테스트 통과 확인**

Run: `DATABASE_URL=<dev core DB URL> npx jest --testPathPattern="outbound-v2-warehouse-scenarios|simple-outbound"`
Expected: PASS — 신규 3건 + 세 전략 시나리오 + 단순출고 회귀 전량

- [ ] **Step 9: fulfillment 전체 회귀**

Run: `DATABASE_URL=<dev core DB URL> npx jest --testPathPattern=modules/fulfillment`
Expected: PASS. `plan()` 시그니처를 바꿨으므로 다른 호출부가 남아 있으면 여기서 드러난다

- [ ] **Step 10: 커밋**

```bash
git add apps/core/src/modules/fulfillment/picking/picking-strategy.interface.ts \
        apps/core/src/modules/fulfillment/dto/picking-v2.dto.ts \
        apps/core/src/modules/fulfillment/services/picking-process.service.ts \
        apps/core/src/modules/fulfillment/controllers/picking-v2.controller.ts \
        apps/core/src/modules/fulfillment/services/simple-outbound.service.ts \
        apps/core/src/modules/fulfillment/services/outbound-v2-warehouse-scenarios.integration.spec.ts
git commit -m "feat(core): plan 이 배치 방식에서 전략을 파생 — 두 축 정합성 공백 제거"
```

---

## Task 4: 바구니 정원 강제 (송장 추가)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts:124-175` (`addShipment`)
- Test: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.integration.spec.ts`

**Interfaces:**
- Consumes: `lockOpenBatch(batchId, trx): Promise<BatchRow>` (`:735`) — 반환 행에 `pickingMethod`·`cartCapacity` 가 이미 포함된다(`select()` 전체 선택)
- Produces: 409 `OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED`

- [ ] **Step 1: 실패 테스트 작성**

`outbound-batch-orchestrator.integration.spec.ts` 에 추가한다:

이 파일의 기존 헬퍼 `committedFixture({ warehouse })`(`:243`)가 배치에 담을 수 있는 송장을 만들고 `.shipment.id` 로 노출한다. 배치는 `multi_order` 로 직접 만든다(파일의 `createBatch` 헬퍼는 `individual` 하드코딩이라 쓰지 않는다):

```ts
  async function multiOrderBatch(cartCapacity: number) {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    await db
      .update(wmsTables.warehouses)
      .set({ supportedPickingStrategies: ['pick_to_tote'] })
      .where(eq(wmsTables.warehouses.id, warehouse.warehouseId));
    const batch = await services.batches.createBatch(
      {
        warehouseId: warehouse.warehouseId,
        pickingMethod: 'multi_order',
        cartCapacity,
        name: `Tote batch ${randomUUID()}`,
      },
      `batch-create-${randomUUID()}`,
      master,
    );
    return { warehouse, batchId: batch.batchId };
  }

  it('refuses to add a shipment beyond the cart basket capacity', async () => {
    const { warehouse, batchId } = await multiOrderBatch(1);
    const first = await committedFixture({ warehouse });
    const second = await committedFixture({ warehouse });

    await services.batches.addShipment(batchId, first.shipment.id, `cap-add-${randomUUID()}`, master);

    await expect(
      services.batches.addShipment(batchId, second.shipment.id, `cap-over-${randomUUID()}`, master),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED' }),
    });
  });

  it('frees a basket slot when a shipment is excluded', async () => {
    const { warehouse, batchId } = await multiOrderBatch(1);
    const first = await committedFixture({ warehouse });
    const second = await committedFixture({ warehouse });

    await services.batches.addShipment(batchId, first.shipment.id, `slot-add-${randomUUID()}`, master);
    await services.batches.excludeShipment(
      batchId,
      first.shipment.id,
      { reason: 'capacity test' },
      `slot-exclude-${randomUUID()}`,
      master,
    );

    await expect(
      services.batches.addShipment(batchId, second.shipment.id, `slot-readd-${randomUUID()}`, master),
    ).resolves.toBeDefined();
  });
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `DATABASE_URL=<dev core DB URL> npx jest --testPathPattern=outbound-batch-orchestrator.integration -t "basket capacity"`
Expected: FAIL — 두 번째 추가가 성공해버린다

- [ ] **Step 3: 정원 검사 구현**

`addShipment` 의 `const batch = await this.lockOpenBatch(batchId, trx);` 바로 다음에 넣는다. `assertEligible` 보다 앞이어야 불필요한 검증 비용을 피한다:

```ts
        const batch = await this.lockOpenBatch(batchId, trx);
        await this.assertCartCapacity(batch, trx);
        const eligible = await this.assertEligible(batch, aggregate, trx);
```

**에러 우선순위에 주의한다.** 정원 검사를 적격성 검사보다 앞에 두면, 배치가 가득 찬 상태에서는 송장이 부적격이어도 `OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED` 가 먼저 나온다. 이게 의도한 순서다(배치가 가득 찬 것이 더 상위 사실이고, 값비싼 적격성 조회를 아낀다). Task 2 Step 8 에서 `:875` 의 `cartCapacity` 를 4로 넉넉히 잡은 이유가 이것이다.

private 헬퍼를 클래스에 추가한다(`lockOpenBatch` 근처):

```ts
  /**
   * multi_order(pick_to_tote) 배치는 카트에 달린 바구니 하나가 송장 하나다.
   * 정원을 넘겨 짠 배치는 현장에 나간 뒤에는 고칠 수 없으므로 여기서 막는다.
   */
  private async assertCartCapacity(batch: BatchRow, tx: DbTx): Promise<void> {
    if (batch.pickingMethod !== 'multi_order' || batch.cartCapacity === null) return;
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.batchId, batch.id),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      );
    if ((row?.count ?? 0) >= batch.cartCapacity) {
      throw this.conflict(
        'OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED',
        `Batch ${batch.id} already holds ${row?.count ?? 0} shipments for ${batch.cartCapacity} cart baskets`,
      );
    }
  }
```

`sql` 이 이 파일에 import 되어 있는지 확인하고 없으면 `drizzle-orm` 에서 추가한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `DATABASE_URL=<dev core DB URL> npx jest --testPathPattern=outbound-batch-orchestrator.integration`
Expected: PASS (신규 2건 + 기존 전량)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts \
        apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.integration.spec.ts
git commit -m "feat(core): multi_order 배치의 바구니 정원을 송장 추가 시점에 강제"
```

---

## Task 5: admin-web — 배치 생성에서 방식·바구니 수 선택

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts:899-904` (`CreateOutboundBatchV2Request`)
- Create: `apps/admin-web/src/features/order/outbound-batches/picking-method.ts`
- Modify: `apps/admin-web/src/features/order/outbound-batches/components/create-batch-dialog/index.tsx`

**Interfaces:**
- Consumes: `PickingStrategyName` (`apps/admin-web/src/lib/types/dto/fulfillment.ts`), `useWarehouses()` (`@/lib/services/inventory/queries`)
- Produces: `PickingMethod` 타입, `STRATEGY_BY_PICKING_METHOD`, `PICKING_METHOD_LABELS`, `methodsForStrategies(supported: PickingStrategyName[]): PickingMethod[]`

- [ ] **Step 1: 프론트 계약 파일 작성**

`apps/admin-web/src/features/order/outbound-batches/picking-method.ts`:

```ts
import type { PickingStrategyName } from '@/lib/types/dto/fulfillment';

export type PickingMethod = 'individual' | 'total_picking' | 'multi_order';

/** core 의 picking-method.contract.ts 와 같은 1:1 대응. 값이 바뀌면 함께 고친다. */
export const STRATEGY_BY_PICKING_METHOD: Record<PickingMethod, PickingStrategyName> = {
  individual: 'discrete',
  total_picking: 'aggregate_then_sort',
  multi_order: 'pick_to_tote',
};

export const PICKING_METHOD_LABELS: Record<PickingMethod, string> = {
  individual: '개별 피킹',
  total_picking: '토탈 피킹 (합산 후 분류)',
  multi_order: '멀티오더 피킹 (바구니 카트)',
};

/** 창고가 지원하는 전략으로부터 고를 수 있는 방식만 역파생한다. */
export function methodsForStrategies(supported: PickingStrategyName[]): PickingMethod[] {
  return (Object.keys(STRATEGY_BY_PICKING_METHOD) as PickingMethod[]).filter((method) =>
    supported.includes(STRATEGY_BY_PICKING_METHOD[method])
  );
}
```

- [ ] **Step 2: 요청 타입 확장**

`apps/admin-web/src/lib/types/dto/fulfillment.ts`:

```ts
export interface CreateOutboundBatchV2Request {
  warehouseId: string;
  pickingMethod: 'individual' | 'total_picking' | 'multi_order';
  cartCapacity?: number;
  name?: string;
  scheduledPickingAt?: string;
}
```

- [ ] **Step 3: 생성 다이얼로그에 방식·바구니 수 입력 추가**

`create-batch-dialog/index.tsx`. 상태와 파생값을 추가한다:

```tsx
  const [pickingMethod, setPickingMethod] = useState<PickingMethod | ''>('');
  const [cartCapacity, setCartCapacity] = useState('');

  const selectedWarehouse = warehouses.find((item) => item.id === warehouseId);
  const availableMethods = methodsForStrategies(
    selectedWarehouse?.supportedPickingStrategies ?? []
  );
```

> `useWarehouses()` 가 돌려주는 항목에 `supportedPickingStrategies` 가 실제로 있는지 확인한다(`apps/core/.../warehouse.dto.ts:22` 는 내려준다). 없으면 `apps/admin-web/src/lib/types` 의 창고 타입에 필드를 추가한다.

`submit` 의 payload:

```tsx
    const payload: CreateOutboundBatchV2Request = {
      warehouseId,
      pickingMethod: pickingMethod as PickingMethod,
      cartCapacity:
        pickingMethod === 'multi_order' ? Number(cartCapacity) : undefined,
      name: name.trim() || undefined,
      scheduledPickingAt: scheduledPickingAt
        ? new Date(scheduledPickingAt).toISOString()
        : undefined,
    };
```

성공 시 초기화에 두 상태를 추가한다:

```tsx
      setPickingMethod('');
      setCartCapacity('');
```

창고 `<Select>` 바로 아래에 방식 선택을 넣고, 기존 안내 문구(`피킹 전략은 배치 생성 뒤 …`)를 **삭제**한다:

```tsx
          <div className="space-y-1.5">
            <Label>피킹 방식</Label>
            <Select
              value={pickingMethod}
              onValueChange={(value) => setPickingMethod(value as PickingMethod)}
              disabled={!warehouseId}
            >
              <SelectTrigger>
                <SelectValue placeholder="방식 선택" />
              </SelectTrigger>
              <SelectContent>
                {availableMethods.map((method) => (
                  <SelectItem key={method} value={method}>
                    {PICKING_METHOD_LABELS[method]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {warehouseId && availableMethods.length === 0 && (
              <p className="text-sm text-destructive">
                이 창고가 지원하는 피킹 전략이 없습니다. 배치를 만들 수 없습니다.
              </p>
            )}
          </div>
          {pickingMethod === 'multi_order' && (
            <div className="space-y-1.5">
              <Label>카트 바구니 수</Label>
              <Input
                type="number"
                min={1}
                value={cartCapacity}
                onChange={(event) => setCartCapacity(event.target.value)}
                placeholder="24"
              />
              <p className="text-xs text-muted-foreground">
                바구니 하나가 송장 하나입니다. 이 배치에 담을 수 있는 송장 수 상한이
                됩니다.
              </p>
            </div>
          )}
```

생성 버튼의 `disabled` 조건을 바꾼다:

```tsx
            disabled={
              !warehouseId ||
              !pickingMethod ||
              (pickingMethod === 'multi_order' && Number(cartCapacity) < 1) ||
              mutation.isPending
            }
```

import 를 추가한다:

```tsx
import {
  methodsForStrategies,
  PICKING_METHOD_LABELS,
  type PickingMethod,
} from '../../picking-method';
```

- [ ] **Step 4: 타입 체크**

Run: `cd apps/admin-web && npx tsc --noEmit 2>&1 | grep -E "outbound-batches|picking-method|dto/fulfillment"`
Expected: 출력 없음. **레포 전역 `tsc` 에는 기존 debt 가 있으므로 변경 파일로 스코프를 좁혀 판단한다.**

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/order/outbound-batches/picking-method.ts \
        apps/admin-web/src/features/order/outbound-batches/components/create-batch-dialog/index.tsx \
        apps/admin-web/src/lib/types/dto/fulfillment.ts
git commit -m "feat(admin-web): 배치 생성에서 피킹 방식과 바구니 수를 선택"
```

---

## Task 6: admin-web — 드로어 전략 선택 제거와 방식 표시

**Files:**
- Modify: `apps/admin-web/src/features/order/outbound-batches/components/batch-detail-drawer/index.tsx:55-59, 71, 136-186`
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts:1067-1071` (`CreatePickingPlanRequest`)
- Modify: 배치 목록 컴포넌트 (`apps/admin-web/src/features/order/outbound-batches/` 아래 목록 테이블)

**Interfaces:**
- Consumes: `PICKING_METHOD_LABELS`, `PickingMethod` (Task 5), `useCreatePickingPlan` (`@/lib/services/orders`)
- Produces: 없음 (UI 종단)

- [ ] **Step 1: plan 요청 타입에서 `strategy` 제거하고 방식 타입을 좁힌다**

`apps/admin-web/src/lib/types/dto/fulfillment.ts`:

```ts
export interface CreatePickingPlanRequest {
  batchId: string;
  shipmentIds: string[];
}
```

같은 파일에서 응답 타입의 `pickingMethod: string` 두 곳(`OutboundBatchV2`, `OutboundBatchV2ListItem`)을 좁힌다. 이래야 표시할 때 `as` 캐스팅이 필요 없다:

```ts
  pickingMethod: 'individual' | 'total_picking' | 'multi_order';
```

`multi_order` 배치는 바구니 수도 내려오므로 두 타입에 함께 추가한다:

```ts
  cartCapacity: number | null;
```

> core 응답 DTO(`outbound-batch-v2.dto.ts` 의 `OutboundBatchV2DetailDto`·`OutboundBatchV2ListItemDto`)에도 `cartCapacity` 필드가 있어야 한다. Task 2 에서 매퍼(`orchestrator.ts:552`, `:634`)에 넣지 않았다면 여기서 함께 추가한다.

- [ ] **Step 2: 드로어에서 전략 선택 UI 제거**

`batch-detail-drawer/index.tsx` 에서:

- `const [strategy, setStrategy] = useState<PickingStrategyName | ''>('');` 삭제
- `const supportedStrategies = batch?.warehouse?.supportedPickingStrategies ?? [];` 삭제
- "창고 지원 전략" `<Select>` 블록(`:140-158`) 전체 삭제
- "계획 생성" 버튼의 조건과 payload 를 아래로 교체:

```tsx
                  <Button
                    disabled={shipmentIds.length === 0 || createPlan.isPending}
                    onClick={() =>
                      command(
                        'plan',
                        { batchId, shipmentIds },
                        (data, idempotencyKey) =>
                          createPlan.mutateAsync({ data, idempotencyKey })
                      )
                    }
                  >
                    {retry.hasPending('plan') ? '원래 명령 재시도' : '계획 생성'}
                  </Button>
```

- `supportedStrategies.length === 0` 안내 문구(`:183-188`)를 배치 방식 표시로 교체:

```tsx
              <p className="text-sm text-muted-foreground">
                이 배치는 <b>{PICKING_METHOD_LABELS[batch.pickingMethod]}</b> 방식입니다.
                {batch.cartCapacity !== null && ` 바구니 ${batch.cartCapacity}개.`}
                {' '}전략은 방식에서 자동으로 결정됩니다.
              </p>
```

- `STRATEGY_LABELS` 는 `batch.pickingPlan.strategy` 표시(`:194`)에 여전히 쓰이므로 **남긴다**.
- import 를 추가한다: `import { PICKING_METHOD_LABELS } from '../../picking-method';`
- 쓰이지 않게 된 import(`PickingStrategyName`, `Select` 계열 중 다른 곳에서 안 쓰는 것)를 정리한다.

- [ ] **Step 3: 배치 목록에 방식 열 추가**

`apps/admin-web/src/features/order/outbound-batches/components/table/index.tsx` 에서 배치 번호 열과 상태 열 사이에 방식 열을 넣는다. 항목 타입은 `OutboundBatchV2ListItem` 이고 Step 1 에서 `pickingMethod` 를 좁혔으므로 캐스팅이 필요 없다:

```tsx
<TableCell>{PICKING_METHOD_LABELS[batch.pickingMethod]}</TableCell>
```

헤더에도 같은 위치에 넣는다:

```tsx
<TableHead>피킹 방식</TableHead>
```

파일이 shadcn `<Table>` 이 아니라 DataTable 컬럼 정의를 쓰고 있으면, 기존 컬럼 정의 형태를 그대로 따라 `accessorKey: 'pickingMethod'` 컬럼을 추가하고 `cell` 에서 위 라벨을 렌더한다.

- [ ] **Step 4: 타입 체크와 빌드**

Run: `cd apps/admin-web && npx tsc --noEmit 2>&1 | grep -E "outbound-batches|dto/fulfillment"`
Expected: 출력 없음

Run: `npm run build:admin-web`
Expected: 성공

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/order/outbound-batches \
        apps/admin-web/src/lib/types/dto/fulfillment.ts
git commit -m "feat(admin-web): 전략 선택을 배치 생성으로 옮기고 목록·상세에 방식 표시"
```

---

## Task 7: 전체 검증과 문서 갱신

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md` (W4 항목)

- [ ] **Step 1: core 빌드**

Run: `npx nest build core`
Expected: 오류 0

- [ ] **Step 2: fulfillment 전량 (실 DB)**

Run: `DATABASE_URL=<dev core DB URL> npx jest --testPathPattern=modules/fulfillment`
Expected: 전량 PASS. 스킵된 스위트가 있으면 `DATABASE_URL` 이 안 먹은 것이므로 다시 확인한다

- [ ] **Step 3: lint (변경 파일 스코프)**

Run: `npx eslint apps/core/src/modules/fulfillment apps/core/src/modules/inventory/schema/inventory.schema.ts`
Expected: 신규 error 0. **레포 전역 `npm run lint` 는 상시 debt 가 있으므로 변경 파일 기준으로 판단한다**

- [ ] **Step 4: 현황판 W4 갱신 (#542)**

`docs/logistics-backend-hardening-2026-07.md` 의 W4 행을 교체한다. 기존 서술("토탈피킹 미구현", `picking-process.service.ts:89,177,257` throw)은 낡았다:

```markdown
| W4 | ⬜ | 토탈피킹 비활성 (구현은 완료) | `aggregate-then-sort.strategy.ts` 2,016줄 구현·`fulfillment.module.ts:147-153` DI 등록·전용 컨트롤러 3종 라이브. 막는 것은 창고 `supported_picking_strategies` 설정 하나뿐 — 배치 생성 게이트는 2026-07-27 정합성 작업에서 창고 능력 검사로 교체됨(#543). 개통 = 창고 설정 변경 + 현장 흐름 검증 |
```

- [ ] **Step 5: 커밋**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "docs: 하드닝 현황판 W4 정정 — 토탈피킹은 구현 완료·창고 설정으로 비활성 (#542)"
```

---

## 검증 기록

**실행일: 2026-07-28**

`describeIfDb` 게이트 함정 확인 — `DATABASE_URL` 없이 돌리면 이 브랜치가 추가/변경한 핵심 통합 케이스가 전부 skip 대상이 되어 거짓 초록이 난다. 두 조건을 모두 실행해 skip 0 을 직접 확인했다.

**DATABASE_URL 없이:**

```
npx jest --testPathPattern=modules/fulfillment
```

```
Test Suites: 23 skipped, 49 passed, 49 of 72 total
Tests:       170 skipped, 382 passed, 552 total
```

**DATABASE_URL 주고:**

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --testPathPattern=modules/fulfillment
```

```
Test Suites: 72 passed, 72 total
Tests:       552 passed, 552 total
```

skip 0 확인. `DATABASE_URL` 을 빠뜨리면 23 개 스위트(170 개 테스트)가 조용히 skip 되어 실패해야 할 케이스가 통과한 것처럼 보인다 — 이번 검증은 그 함정을 실측으로 재확인한 것이며, 태스크별 체크박스는 각 스텝을 직접 밟은 것이 아니므로 일괄 체크하지 않는다.

---

## 배포 체크리스트 (구현 후, 사용자 직접)

- [ ] **배포 전 실측 (필수)**: `SELECT id, name, supported_picking_strategies FROM warehouses;`
  - **NULL 이거나 빈 배열인 창고** → 배포 후 **배치 생성 자체가 409 로 막힌다.** 지금은 배치를 만들 수 있고 plan 단계에서야 막히지만, 새 코드는 생성 시점에 창고 능력을 본다. 출고에 실제로 쓰는 창고는 배포 전에 `supported_picking_strategies = '{discrete}'` 로 채워 둔다
  - 이미 `aggregate_then_sort` 나 `pick_to_tote` 가 켜진 창고가 있으면 배치 생성 옵션이 갑자기 늘어난다 → 개통 여부를 먼저 판단한다
- [ ] `npm run db:migrate -- --stage <stage> --deployment lcnine-services --yes` (마이그 1건)
- [ ] `sst deploy` (core → admin-web)
- [ ] 순서를 뒤집지 말 것 — expand phase 이므로 **`migrate` → `deploy`**. 뒤집으면 새 코드가 `multi_order` enum 값을 못 찾는다
- [ ] 신규 secret·플래그 0
- [ ] 창고 `supported_picking_strategies` 는 **건드리지 않는다** (개통은 별도 결정)
