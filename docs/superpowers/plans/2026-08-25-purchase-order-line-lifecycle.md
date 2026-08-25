# 발주 라인 생명주기 구현 계획 (#724 2단계)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발주 라인을 하나씩 실제 발주 실행할 수 있게 하고, 실행된 만큼만 입고 계획·재고 파이프라인에 반영한다.

**Architecture:** `purchase_order_lines.quantity` 는 "사고 싶다"(요청)로 남기고, 실행 결과(`ordered_qty`·단가·ETA·행위자)를 같은 행의 새 컬럼에 적는다. 첫 라인 실행에서 입고 계획이 생기고, 이후 라인은 같은 계획에 아이템으로 붙는다. 발주 헤더 `status` 는 라인에서 파생되는 캐시가 된다. 발주가 입고 테이블을 직접 쓰던 경로는 `InboundService` 포트 호출로 바뀐다.

**Tech Stack:** NestJS 11, Drizzle ORM + postgres.js, PostgreSQL 16, Jest(ts-jest), class-validator

**Spec:** `docs/superpowers/specs/2026-08-25-purchase-order-line-lifecycle-design.md`

## Global Constraints

- **범위는 `apps/core` 백엔드만.** admin-web 은 별도 계획이다 (스펙 §6 의 PR 4). 이 계획이 끝나도 UI 경로는 없다.
- **마이그레이션은 additive 만.** column drop / rename / type narrow / NOT NULL 추가 금지 (CLAUDE.md, ADR-0005 §5).
- **배포 순서는 `migrate → deploy`** — expand phase 라 컨벤션 기본(`deploy → migrate`)과 **반대**다.
- **`PUT /:id/status` 는 건드리지 않는다.** admin-web 이 아직 그 드롭다운을 쓴다. `confirmed` 수동 설정 차단은 3단계.
- **Drizzle 규칙** (CLAUDE.md): `db.query.*`·`with` relations·`any`/`as` 캐스팅 금지. `trx.select().from().innerJoin().where()` + Drizzle 연산자. DB 주입은 `@InjectTypedDb<typeof inventorySchema>()`.
- **트랜잭션 전파** (ADR-0025): public 메서드는 `tx?: DbTx` 를 마지막 인자로, private 헬퍼는 `tx: DbTx` 필수. `this.dbService.run(fn, tx)` 하나만 쓴다. per-class `inTx` 헬퍼 금지.
- **예외**: 서비스는 `@app/shared` 의 `NotFoundError`/`BadRequestError`/`ConflictError` 를 던진다. `HttpException` 계열 금지.
- **Swagger**: `@ApiProperty({ type: 'object' })` 금지. 중첩 DTO 는 별도 클래스로.
- **검증 게이트**: `npm run type-check` 와 `npx jest --maxWorkers=2` 둘 다 **0 이 기준선**이다.
- **통합 스펙 실행**: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <pattern>`. 이 스펙들은 `DATABASE_URL` 이 없으면 CI 에서 skip 되므로 **로컬 실행 결과를 PR 본문에 붙인다.**

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `.../inventory/schema/inventory.schema.ts` | `po_line_status` enum, 라인 실행 컬럼, `inbound_plan_items.expected_date` | 수정 (Task 3) |
| `apps/core/drizzle/<ts>_add-purchase-order-line-lifecycle.sql` | DDL + 백필 | 생성 (Task 3) |
| `.../inbound/dto/simple-inbound.dto.ts` | `InboundPlanItemInputDto.expectedDate` | 수정 (Task 4) |
| `.../inbound/services/inbound.service.ts` | 계획 포트 — 불변식 소유, `ensurePlanForPurchaseOrder` | 수정 (Task 1, 2, 4) |
| `.../inbound/dto/purchase-order/execute-line.dto.ts` | 라인 실행 요청 DTO 2개 | 생성 (Task 5) |
| `.../inbound/services/purchase-order.service.ts` | 라인 실행, 헤더 상태 파생, 라인 수정 제약 | 수정 (Task 2, 5, 7) |
| `.../inbound/controllers/purchase-order.controller.ts` | 실행 엔드포인트 2개 | 수정 (Task 5) |
| `.../stock-projection/services/inbound-pipeline.reader.ts` | ① ETA 를 아이템 우선으로 | 수정 (Task 6) |
| `.../inbound/dto/purchase-order/purchase-order-response.dto.ts` | 응답 계약 클래스화 (항목 2) | 생성 (Task 8) |

---

### Task 1: 계획 포트가 불변식을 스스로 도출한다

발주가 아니라 **`InboundService.createInboundPlan` 이** 해외/국내 판단을 소유하게 만든다. 지금은 호출자가 `planType`/`requiresTransfer`/`destinationWarehouseId` 를 그냥 넘겨서, 수동 API(`POST /inbound/plans`)로 해외 발주에 `destination` 계획을 붙이면 `purchase-order-single-plan.integration.spec.ts` 가 막으려던 입고예정 2배·이중계상이 그대로 재현된다.

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts:639-674` (`createInboundPlan`)
- Test: `apps/core/src/modules/inventory/inbound/services/inbound-plan-port-invariant.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `InboundService.createInboundPlan(dto: CreateInboundPlanDto, tx?: DbTx)` 가 `dto.planType`/`dto.requiresTransfer`/`dto.destinationWarehouseId`/`dto.warehouseId` 를 **무시하고** 연결된 발주에서 도출한다. 반환 타입은 기존과 같은 `inbound_plans` 행.

- [ ] **Step 1: 실패하는 통합 스펙을 쓴다**

`apps/core/src/modules/inventory/inbound/services/inbound-plan-port-invariant.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx } from '../../../fulfillment/services/__support__';
import { InboundService } from './inbound.service';

/**
 * 계획 생성 포트가 해외/국내 불변식을 스스로 지키는지 고정한다.
 *
 * 이 스펙이 존재하는 이유: 불변식이 `PurchaseOrderService.createInboundPlanFromPO`(자동
 * 경로)에만 있었다. 수동 API `POST /inbound/plans` 는 호출자가 넘긴 planType 을 그대로
 * 믿어서, 해외 발주에 destination 계획을 붙이면 입고예정이 2배로 잡히고 목적지에 재고를
 * 창조하면서 출발 창고를 안 깎는 이중계상이 났다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-plan-port-invariant
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('입고 계획 포트가 불변식을 소유한다 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db: trx,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  interface Fixture {
    poId: string;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
  }

  /** 해외 발주 = 출발 창고(중국) ≠ 목적지 창고(부천). */
  async function seedForeignPo(trx: DbTx): Promise<Fixture> {
    const suffix = randomUUID().slice(0, 8);
    const [source] = await trx.insert(wmsTables.warehouses).values({ name: `it-src-${suffix}` }).returning();
    const [dest] = await trx.insert(wmsTables.warehouses).values({ name: `it-dst-${suffix}` }).returning();
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-sup-${suffix}`, defaultWarehouseId: source.id })
      .returning();
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: supplier.id,
        status: 'created',
        auditStatus: 'approved',
        sourceWarehouseId: source.id,
        destinationWarehouseId: dest.id,
        requiresTransfer: true,
      })
      .returning();
    return { poId: po.id, sourceWarehouseId: source.id, destinationWarehouseId: dest.id };
  }

  it('해외 발주에 destination 계획을 요청해도 source 계획이 만들어진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedForeignPo(trx);
      const service = new InboundService(boundDbService(trx));

      // 호출자가 거짓말을 한다 — 최종 목적지를 입고 창고로, 타입을 destination 으로.
      const plan = await service.createInboundPlan(
        {
          expectedDate: '2026-09-01',
          warehouseId: fx.destinationWarehouseId,
          destinationWarehouseId: fx.destinationWarehouseId,
          linkedPurchaseOrderId: fx.poId,
          planType: 'destination',
          requiresTransfer: false,
        },
        trx,
      );

      expect(plan.planType).toBe('source');
      expect(plan.warehouseId).toBe(fx.sourceWarehouseId);
      expect(plan.destinationWarehouseId).toBe(fx.destinationWarehouseId);
      expect(plan.requiresTransfer).toBe(true);
    });
  });

  it('없는 발주를 가리키면 500 이 아니라 NotFoundError 다', async () => {
    await inRollbackTx(db, async (trx) => {
      const service = new InboundService(boundDbService(trx));
      await expect(
        service.createInboundPlan(
          {
            expectedDate: '2026-09-01',
            warehouseId: randomUUID(),
            linkedPurchaseOrderId: randomUUID(),
          },
          trx,
        ),
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-plan-port-invariant`
Expected: FAIL — 첫 테스트는 `planType` 이 `'destination'` 으로 나오고, 둘째는 `NotFoundError` 가 아니라 일반 `Error` 다.

> `InboundService` 의 생성자 인자가 위 스펙과 다르면(다른 의존성을 더 받으면) 그 목록에 맞춰 `new InboundService(...)` 호출을 고친다. 파일 상단 `constructor` 를 먼저 읽을 것.

- [ ] **Step 3: 포트가 발주에서 도출하도록 고친다**

`inbound.service.ts` 의 `createInboundPlan` 본문을 교체한다:

```ts
  // 입고예정 생성
  //
  // 해외/국내 판단은 **이 포트가 소유한다.** 호출자가 넘긴 planType /
  // requiresTransfer / destinationWarehouseId / warehouseId 는 무시된다 — 예전에는
  // 그대로 믿었고, 그래서 수동 API 로 해외 발주에 destination 계획을 붙이면 입고예정이
  // 2배로 잡히고 목적지에 재고를 창조하면서 출발 창고를 안 깎는 이중계상이 났다.
  // 불변식은 purchase-order-single-plan / inbound-plan-port-invariant 스펙이 고정한다.
  async createInboundPlan(dto: CreateInboundPlanDto, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const { purchaseOrders } = wmsTables;

      const [po] = await trx
        .select({
          id: purchaseOrders.id,
          sourceWarehouseId: purchaseOrders.sourceWarehouseId,
          destinationWarehouseId: purchaseOrders.destinationWarehouseId,
        })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, dto.linkedPurchaseOrderId))
        .limit(1);

      if (!po) {
        throw new NotFoundError(`Purchase order not found: ${dto.linkedPurchaseOrderId}`);
      }

      const requiresTransfer = po.sourceWarehouseId !== po.destinationWarehouseId;
      // 해외 발주는 공급사 → 출발 창고 구간만 계획으로 잡는다. 출발 → 최종 목적지는
      // transfer_orders 가 소유한다.
      const warehouseId = requiresTransfer ? po.sourceWarehouseId : po.destinationWarehouseId;

      const [plan] = await trx
        .insert(wmsTables.inboundPlans)
        .values({
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          warehouseId,
          destinationWarehouseId: po.destinationWarehouseId,
          linkedPurchaseOrderId: dto.linkedPurchaseOrderId,
          planType: requiresTransfer ? 'source' : 'destination',
          requiresTransfer,
          parentPlanId: dto.parentPlanId,
          status: 'pending',
        })
        .returning();

      return plan;
    }, tx);
  }
```

`NotFoundError` 를 `@app/shared` 에서 import 한다 (파일 상단에 이미 있으면 추가하지 않는다):

```ts
import { NotFoundError } from '@app/shared';
```

`CreateInboundPlanDto` 에서 **포트가 무시하게 된 필드들을 선택으로** 바꾼다
(`simple-inbound.dto.ts:147-180`). 기존 호출자는 계속 보내도 되고 그냥 무시된다 —
후방 호환이다.

```ts
  @ApiPropertyOptional({ description: '예정일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @ApiPropertyOptional({ description: '(무시됨) 입고 창고는 연결된 발주에서 도출한다' })
  @IsUUID()
  @IsOptional()
  warehouseId?: string;
```

`destinationWarehouseId` / `planType` / `requiresTransfer` 는 이미 선택이다. 각 필드
`@ApiProperty` 설명에 **(무시됨)** 을 붙여 Swagger 를 보는 사람이 헷갈리지 않게 한다.

`@ApiPropertyOptional` 과 `@IsOptional` 이 그 파일에 import 돼 있는지 확인하고 없으면 추가한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "inbound-plan-port-invariant|purchase-order-single-plan"`
Expected: 두 스펙 모두 PASS. `purchase-order-single-plan` 이 계속 통과해야 한다 — 자동 경로의 불변식이 그대로라는 뜻이다.

- [ ] **Step 5: 게이트를 돌린다**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 둘 다 에러/실패 0.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/services/inbound.service.ts \
        apps/core/src/modules/inventory/inbound/dto/simple-inbound.dto.ts \
        apps/core/src/modules/inventory/inbound/services/inbound-plan-port-invariant.integration.spec.ts
git commit -m "refactor(inventory): 입고 계획 포트가 해외/국내 불변식을 소유한다 (#724)

호출자가 넘긴 planType/requiresTransfer/destination 을 믿던 것을 발주에서 도출하도록
바꿨다. 수동 API 로 해외 발주에 destination 계획을 붙여 입고예정을 2배로 만들던 구멍이
닫힌다. 발주 미존재는 500 이 아니라 404 다."
```

---

### Task 2: `ensurePlanForPurchaseOrder` — 멱등한 계획 확보

라인을 하나씩 실행할 것이므로 "계획이 있으면 쓰고 없으면 만든다"가 반복 호출된다. 발주 쪽이 입고 테이블을 직접 쓰던 `createInboundPlanFromPO` 를 이 포트로 대체한다.

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (`ensurePlanForPurchaseOrder` 추가)
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts:276-360` (`createInboundPlanFromPO` 삭제, 호출부 교체)
- Modify: `apps/core/src/modules/inventory/inbound/inbound.module.ts` (필요 시 export)
- Test: `apps/core/src/modules/inventory/inbound/services/inbound-plan-port-invariant.integration.spec.ts` (Task 1 파일에 추가)

**Interfaces:**
- Consumes: `InboundService.createInboundPlan(dto, tx?)` (Task 1)
- Produces: `InboundService.ensurePlanForPurchaseOrder(poId: string, expectedDate: string | null, tx?: DbTx): Promise<{ id: string }>` — 같은 발주로 두 번 불러도 계획은 하나다.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

Task 1 의 스펙 파일 안, 마지막 `it` 뒤에 추가한다:

```ts
  it('ensurePlanForPurchaseOrder 는 멱등하다 — 두 번 불러도 계획은 하나', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedForeignPo(trx);
      const service = new InboundService(boundDbService(trx));

      const first = await service.ensurePlanForPurchaseOrder(fx.poId, '2026-09-01', trx);
      const second = await service.ensurePlanForPurchaseOrder(fx.poId, '2026-09-05', trx);

      expect(second.id).toBe(first.id);

      const plans = await trx
        .select({ id: wmsTables.inboundPlans.id })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, fx.poId));
      expect(plans).toHaveLength(1);
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-plan-port-invariant`
Expected: FAIL — `service.ensurePlanForPurchaseOrder is not a function`

- [ ] **Step 3: 포트를 구현한다**

`inbound.service.ts` 의 `createInboundPlan` 바로 아래에 추가한다:

```ts
  /**
   * 발주에 붙은 입고 계획을 확보한다. 없으면 만들고, 있으면 그대로 쓴다.
   *
   * 라인을 하나씩 발주 실행하므로 매 실행마다 불린다 — **멱등해야 한다.** 이미 계획이
   * 있으면 `expectedDate` 로 갱신하지 않는다. 예정일의 진실은 아이템이 갖고(§4),
   * 계획 날짜는 3단계까지 남는 표시용 값이다.
   */
  async ensurePlanForPurchaseOrder(
    poId: string,
    expectedDate: string | null,
    tx?: DbTx,
  ): Promise<{ id: string }> {
    return this.dbService.run(async (trx) => {
      const [existing] = await trx
        .select({ id: wmsTables.inboundPlans.id })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId))
        .limit(1);

      if (existing) return { id: existing.id };

      const plan = await this.createInboundPlan(
        { linkedPurchaseOrderId: poId, expectedDate: expectedDate ?? undefined },
        trx,
      );
      return { id: plan.id };
    }, tx);
  }
```

> 창고·타입을 안 넘기는 것이 맞다. Task 1 이후 포트가 그것들을 발주에서 도출하므로 호출자가
> 알 필요가 없다.

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-plan-port-invariant`
Expected: PASS (3 tests)

- [ ] **Step 5: `createInboundPlanFromPO` 를 포트 호출로 대체한다**

`purchase-order.service.ts` 에서 `private async createInboundPlanFromPO(...)` 메서드 **전체를 삭제**하고, 같은 파일의 호출부(`updatePurchaseOrderStatus` 안 `await this.createInboundPlanFromPO(trx, poId);`)를 아래로 바꾼다:

```ts
        const plan = await this.inboundService.ensurePlanForPurchaseOrder(
          poId,
          existingPO.expectedArrival ? existingPO.expectedArrival.toISOString().slice(0, 10) : null,
          trx,
        );
        const poLines = await trx
          .select({
            skuId: wmsTables.purchaseOrderLines.skuId,
            quantity: wmsTables.purchaseOrderLines.quantity,
          })
          .from(wmsTables.purchaseOrderLines)
          .where(eq(wmsTables.purchaseOrderLines.poId, poId));

        await this.inboundService.addInboundPlanItems(
          { planId: plan.id, items: poLines.map((l) => ({ skuId: l.skuId, expectedQty: l.quantity })) },
          trx,
        );
```

`PurchaseOrderService` 생성자에 `InboundService` 를 주입한다:

```ts
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly transactionService: TransactionService,
    private readonly inboundService: InboundService,
  ) {}
```

> **순환 의존 주의**: `InboundService` 가 `PurchaseOrderService` 를 주입받고 있으면 Nest 가 순환으로 죽는다. `inbound.service.ts` 의 생성자를 먼저 확인할 것. 순환이면 `forwardRef` 를 쓰지 말고, 필요한 조회만 이 파일에서 직접 하도록 되돌린 뒤 계획 작성자에게 보고한다.

- [ ] **Step 6: 기존 스펙이 그대로 통과하는지 본다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "purchase-order|inbound-plan"`
Expected: 전부 PASS. `purchase-order-single-plan.integration.spec.ts` 가 핵심이다 — 자동 경로가 포트를 지나도 계획이 하나여야 한다.

이 스펙은 `new PurchaseOrderService(dbService, new TransactionService(dbService))` 로 서비스를 만든다. 생성자에 인자가 늘었으므로 `new PurchaseOrderService(dbService, new TransactionService(dbService), new InboundService(dbService))` 로 고친다.

- [ ] **Step 7: 게이트 + 커밋**

```bash
npm run type-check && npx jest --maxWorkers=2
git add -A
git commit -m "refactor(inventory): 발주가 입고 테이블 대신 포트를 쓴다 (#724)

createInboundPlanFromPO(두 번째 writer)를 삭제하고 InboundService 포트를 부른다.
라인을 하나씩 실행할 것이므로 계획 확보는 멱등해야 한다 — ensurePlanForPurchaseOrder 신설."
```

---

### Task 3: 스키마 — 라인 실행 컬럼 + 아이템 예정일 + 백필

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Create: `apps/core/drizzle/<timestamp>_add-purchase-order-line-lifecycle.sql` (생성 후 손으로 백필 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `poLineStatusEnum` (`'requested' | 'ordered' | 'unavailable'`), `purchaseOrderLines.{status, orderedQty, expectedArrival, orderedAt, orderedBy, unavailableReason}`, `inboundPlanItems.expectedDate`

- [ ] **Step 1: enum 을 선언한다**

`inventory.schema.ts` 의 `poAuditStatusEnum` 선언 바로 아래(101-106행 근처)에 추가한다:

```ts
export const poLineStatusEnum = pgEnum('po_line_status', [
  'requested', // 발주서에 적혔으나 아직 실행 안 됨
  'ordered', // 실제로 발주함 — ordered_qty/unit_price/expected_arrival 이 확정됨
  'unavailable', // 품절·단종 등으로 끝내 발주 못 함 (단방향 종결)
]);
```

- [ ] **Step 2: 라인 컬럼을 추가한다**

`purchaseOrderLines` 정의를 아래로 바꾼다. **PK 는 그대로 `(poId, skuId)` 다** — 분할 실행이 없어 surrogate id 가 불필요하고, 복합 PK 교체는 destructive 라 단계가 늘어난다.

```ts
export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    poId: uuid('po_id')
      .references(() => purchaseOrders.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    /** 요청 수량. 실행이 덮어쓰지 않는다 — 실행 결과는 orderedQty 로 간다. */
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price'), // 실제 발주 시점에 확정된다
    status: poLineStatusEnum('status').notNull().default('requested'),
    /** 실발주 수량. status='ordered' 일 때만 채워진다. 0 은 허용하지 않는다(=unavailable). */
    orderedQty: integer('ordered_qty'),
    /**
     * 라인별 도착예정일. `timestamp` 가 아니라 `date` + mode:'string' 인 것이 중요하다 —
     * 앱 경계에 Date 객체를 두면 drizzle 의 toISOString 직렬화·IsDateString 의 오프셋
     * 통과·raw sql 의 Date 바인딩이 전부 하루를 밀거나 드라이버를 터뜨린다.
     */
    expectedArrival: date('expected_arrival', { mode: 'string' }),
    orderedAt: timestamp('ordered_at', { withTimezone: true }),
    orderedBy: uuid('ordered_by'),
    unavailableReason: text('unavailable_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.poId, t.skuId),
  }),
);
```

`date` 와 `text` 가 drizzle import 목록에 없으면 파일 상단 `from 'drizzle-orm/pg-core'` 에 추가한다.

- [ ] **Step 3: 아이템 예정일을 추가한다**

`inboundPlanItems` 정의에서 `status` 아래에 한 줄 추가한다:

```ts
    /** 품목별 도착예정일. 계획 단위(inbound_plans.expected_date)로는 라인마다 다른 ETA 를 담을 수 없다. */
    expectedDate: date('expected_date', { mode: 'string' }),
```

- [ ] **Step 4: 마이그레이션을 생성한다**

Run: `npm run db:generate:core -- --name add-purchase-order-line-lifecycle`
Expected: `apps/core/drizzle/<timestamp>_add-purchase-order-line-lifecycle.sql` 생성. 내용은 `CREATE TYPE "po_line_status"`, `ALTER TABLE "purchase_order_lines" ADD COLUMN ...` 6개, `ALTER TABLE "inbound_plan_items" ADD COLUMN "expected_date" date`.

**생성된 SQL 을 읽고 확인한다**: `DROP` 이나 `ALTER COLUMN ... SET NOT NULL` 이 하나라도 있으면 잘못된 것이다 — `git rm` 하고 `schema.ts` 를 고친 뒤 다시 생성한다.

- [ ] **Step 5: 백필을 손으로 붙인다**

생성된 `.sql` 파일 **맨 끝**에 아래를 추가한다. 이 저장소는 생성된 마이그레이션에 데이터 문을 붙이는 선례가 있다 (`20260725151913_narrow-packing-unit-to-integer.sql` 참고). 구분자는 `--> statement-breakpoint` 다.

```sql
--> statement-breakpoint
-- 이미 확정/입고된 발주의 라인은 실제로 발주된 것이다. 새 모델에서 'requested' 로
-- 남으면 파이프라인이 이미 들어온 물량을 "아직 주문 안 함" 으로 읽는다.
UPDATE "purchase_order_lines" l SET "status" = 'ordered', "ordered_qty" = l."quantity"
  FROM "purchase_orders" p
 WHERE p."id" = l."po_id" AND p."status" IN ('confirmed', 'received');--> statement-breakpoint
-- 라인 ETA 는 헤더에서 물려받는다. 헤더는 naive timestamp 라 날짜 부분만 취한다.
UPDATE "purchase_order_lines" l SET "expected_arrival" = p."expected_arrival"::date
  FROM "purchase_orders" p
 WHERE p."id" = l."po_id" AND p."expected_arrival" IS NOT NULL;
```

**백필은 계획을 만들지 않는다.** 이미 확정된 발주에는 계획이 이미 있다 — 실행 경로를 타면 아이템이 두 벌 생긴다.

- [ ] **Step 6: 로컬에 적용하고 눈으로 확인한다**

**적용 전에** 백필이 무엇을 바꿀지 먼저 센다 (적용 후에는 이 숫자를 못 구한다):

```bash
PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d core -tAc "
  SELECT count(*) FILTER (WHERE p.status IN ('confirmed','received')) AS should_become_ordered,
         count(*) FILTER (WHERE p.expected_arrival IS NOT NULL)       AS should_get_eta,
         count(*)                                                     AS total_lines
    FROM purchase_order_lines l JOIN purchase_orders p ON p.id = l.po_id;"
```

세 숫자를 적어 둔다. 그다음 적용한다:

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- __nonexistent__ ; # 마이그레이션만 적용
PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d core -c "\d purchase_order_lines"
PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d core -c "\d inbound_plan_items"
```

Expected: 라인에 `status`(default `'requested'`)·`ordered_qty`·`expected_arrival`(`date`)·`ordered_at`·`ordered_by`·`unavailable_reason` 이 보이고, 아이템에 `expected_date`(`date`) 가 보인다. PK 는 여전히 `(po_id, sku_id)`.

백필 결과가 위에서 센 숫자와 맞는지 확인한다:

```bash
PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d core -tAc "
  SELECT count(*) FILTER (WHERE status = 'ordered')             AS now_ordered,
         count(*) FILTER (WHERE expected_arrival IS NOT NULL)   AS now_has_eta,
         count(*) FILTER (WHERE status = 'ordered' AND ordered_qty IS DISTINCT FROM quantity) AS mismatched
    FROM purchase_order_lines;"
```

Expected: `now_ordered` = `should_become_ordered`, `now_has_eta` = `should_get_eta`,
**`mismatched` = 0**. 하나라도 어긋나면 백필 SQL 이 틀린 것이다 — 롤백하고 고친다.

> 로컬 `core` DB 에 발주 행이 0건이면 세 숫자가 전부 0 이라 이 검증은 아무것도 말해주지
> 않는다. 그럴 때는 확정 발주 1건 + 라인 2건을 손으로 넣고 마이그레이션을 다시 돌려
> 확인한 뒤 지운다. **백필은 라이브 데이터에 실행되므로 빈 DB 통과는 근거가 아니다.**

- [ ] **Step 7: 게이트 + 커밋**

Run: `npm run type-check && npx jest --maxWorkers=2`

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle/
git commit -m "feat(inventory): 발주 라인 실행 컬럼과 아이템 예정일 (#724)

라인에 status/ordered_qty/expected_arrival/ordered_at/ordered_by/unavailable_reason,
inbound_plan_items 에 expected_date. 전부 additive 다.

expected_arrival 이 timestamp 가 아니라 date + mode:'string' 인 것이 핵심이다. 앱 경계에
Date 객체를 두면 drizzle 의 toISOString 직렬화·IsDateString 의 오프셋 통과·raw sql 의
Date 바인딩이 전부 하루를 밀거나 드라이버를 터뜨린다. 문자열이면 그 부류가 사라진다.

백필: 이미 confirmed/received 인 발주의 라인은 ordered + ordered_qty=quantity 로,
라인 ETA 는 헤더에서 물려받는다. 계획은 만들지 않는다 — 이미 있다.

배포는 migrate → deploy (expand phase 라 컨벤션 기본과 반대)."
```

---

### Task 4: `addInboundPlanItems` 가 품목 예정일을 받는다

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/dto/simple-inbound.dto.ts:187-197` (`InboundPlanItemInputDto`)
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts:678-693` (`addInboundPlanItems`)
- Test: `apps/core/src/modules/inventory/inbound/services/inbound-plan-port-invariant.integration.spec.ts`

**Interfaces:**
- Consumes: `InboundService.ensurePlanForPurchaseOrder` (Task 2), `inboundPlanItems.expectedDate` (Task 3)
- Produces: `InboundPlanItemInputDto { skuId: string; expectedQty: number; expectedDate?: string }` — `expectedDate` 는 `'YYYY-MM-DD'`

- [ ] **Step 1: 실패하는 테스트를 추가한다**

Task 1 의 스펙 파일 끝에 추가한다:

```ts
  it('아이템에 품목별 예정일을 적을 수 있다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedForeignPo(trx);
      const suffix = randomUUID().slice(0, 8);
      const [holder] = await trx.insert(wmsTables.holders).values({ name: `it-h-${suffix}` }).returning();
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: 'it-sku', code: `IT-${randomUUID().toUpperCase()}`, holderId: holder.id })
        .returning();

      const service = new InboundService(boundDbService(trx));
      const plan = await service.ensurePlanForPurchaseOrder(fx.poId, null, trx);
      await service.addInboundPlanItems(
        { planId: plan.id, items: [{ skuId: sku.id, expectedQty: 5, expectedDate: '2026-09-17' }] },
        trx,
      );

      const [item] = await trx
        .select({ expectedDate: wmsTables.inboundPlanItems.expectedDate })
        .from(wmsTables.inboundPlanItems)
        .where(eq(wmsTables.inboundPlanItems.planId, plan.id));
      expect(item.expectedDate).toBe('2026-09-17');
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-plan-port-invariant`
Expected: FAIL — 타입 에러이거나 `item.expectedDate` 가 `null`.

- [ ] **Step 3: DTO 와 서비스를 고친다**

`simple-inbound.dto.ts`:

```ts
export class InboundPlanItemInputDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '예정 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  expectedQty: number;

  @ApiPropertyOptional({ description: '품목별 도착예정일 (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expectedDate must be YYYY-MM-DD' })
  expectedDate?: string;
}
```

`Matches` 를 `class-validator` import 에 추가한다. **`@IsDateString()` 을 쓰지 않는다** — 그건 `'2026-09-17T00:00:00+09:00'` 도 통과시켜 날짜가 하루 밀리는 입력을 받아준다.

`inbound.service.ts` 의 `addInboundPlanItems` insert 에 한 줄 추가한다:

```ts
        await trx.insert(wmsTables.inboundPlanItems).values({
          planId: dto.planId,
          skuId: item.skuId,
          expectedQty: item.expectedQty,
          expectedDate: item.expectedDate ?? null,
          receivedQty: 0,
          status: 'pending',
        });
```

- [ ] **Step 4: 통과 확인 + 게이트 + 커밋**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-plan-port-invariant
npm run type-check && npx jest --maxWorkers=2
git add -A
git commit -m "feat(inventory): 입고 계획 아이템에 품목별 예정일 (#724)

라인마다 ETA 가 다른데 inbound_plans.expected_date 는 계획 단위라 담을 수 없다. 계획을
쪼개면 '해외 발주는 계획 하나' 불변식이 깨져 이중계상이 되살아나므로 아이템으로 내린다.

검증은 IsDateString 이 아니라 Matches(YYYY-MM-DD) 다 — IsDateString 은 오프셋 붙은
입력을 통과시켜 날짜가 하루 밀린다."
```

---

### Task 5: 라인 실행 — 서비스·DTO·엔드포인트

**Files:**
- Create: `apps/core/src/modules/inventory/inbound/dto/purchase-order/execute-line.dto.ts`
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts`
- Modify: `apps/core/src/modules/inventory/inbound/controllers/purchase-order.controller.ts`
- Test: `apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: `InboundService.ensurePlanForPurchaseOrder`, `InboundService.addInboundPlanItems` (Task 2, 4), `poLineStatusEnum` (Task 3)
- Produces:
  - `OrderPurchaseOrderLineDto { orderedQty: number; unitPrice?: number; expectedArrival?: string }`
  - `MarkLineUnavailableDto { reason?: string }`
  - `PurchaseOrderService.orderLine(poId: string, skuId: string, dto: OrderPurchaseOrderLineDto, userId: string, tx?: DbTx): Promise<PurchaseOrderResponse>`
  - `PurchaseOrderService.markLineUnavailable(poId: string, skuId: string, dto: MarkLineUnavailableDto, userId: string, tx?: DbTx): Promise<PurchaseOrderResponse>`

- [ ] **Step 1: 실패하는 통합 스펙을 쓴다**

`apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx } from '../../../fulfillment/services/__support__';
import { PurchaseOrderService } from './purchase-order.service';
import { InboundService } from './inbound.service';
import { TransactionService } from '../../shared/services/transaction.service';

/**
 * 발주 라인을 하나씩 실제 발주 실행하는 경로를 고정한다.
 *
 * 실무: 발주서를 만든 뒤 직원이 라인을 하나씩 실제로 산다. 그 순간 수량·단가·도착예정일이
 * 확정되고, 아예 못 사는 라인도 생긴다. 한 라인을 나눠 사는 일은 없다(단방향 종결).
 *
 * 단위 테스트로는 아무것도 안 잡힌다 — 전부 다중 테이블 상태 전이다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('발주 라인 실행 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  const ACTOR = randomUUID();

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db: trx,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function buildService(trx: DbTx): PurchaseOrderService {
    const dbService = boundDbService(trx);
    return new PurchaseOrderService(dbService, new TransactionService(dbService), new InboundService(dbService));
  }

  interface Fixture {
    poId: string;
    warehouseId: string;
    skuIds: string[];
  }

  /** 국내 발주(출발=목적지) + SKU 3개 라인, 각 요청 10개. */
  async function seedPoWithThreeLines(trx: DbTx): Promise<Fixture> {
    const suffix = randomUUID().slice(0, 8);
    const [wh] = await trx.insert(wmsTables.warehouses).values({ name: `it-wh-${suffix}` }).returning();
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-sup-${suffix}`, defaultWarehouseId: wh.id })
      .returning();
    const [holder] = await trx.insert(wmsTables.holders).values({ name: `it-h-${suffix}` }).returning();

    const skuIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: `it-sku-${i}`, code: `IT-${randomUUID().toUpperCase()}`, holderId: holder.id })
        .returning();
      skuIds.push(sku.id);
    }

    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'domestic',
        supplierId: supplier.id,
        status: 'created',
        auditStatus: 'approved',
        sourceWarehouseId: wh.id,
        destinationWarehouseId: wh.id,
        requiresTransfer: false,
      })
      .returning();

    await trx
      .insert(wmsTables.purchaseOrderLines)
      .values(skuIds.map((skuId) => ({ poId: po.id, skuId, quantity: 10 })));

    return { poId: po.id, warehouseId: wh.id, skuIds };
  }

  async function readLine(trx: DbTx, poId: string, skuId: string) {
    const [row] = await trx
      .select({
        status: wmsTables.purchaseOrderLines.status,
        quantity: wmsTables.purchaseOrderLines.quantity,
        orderedQty: wmsTables.purchaseOrderLines.orderedQty,
        unitPrice: wmsTables.purchaseOrderLines.unitPrice,
        expectedArrival: wmsTables.purchaseOrderLines.expectedArrival,
        orderedBy: wmsTables.purchaseOrderLines.orderedBy,
      })
      .from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));
    return row;
  }

  async function readHeaderStatus(trx: DbTx, poId: string): Promise<string> {
    const [row] = await trx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId));
    return row.status;
  }

  it('발주서를 만들기만 하면 계획이 없다 — 아직 아무것도 주문 안 했다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const plans = await trx
        .select({ id: wmsTables.inboundPlans.id })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, fx.poId));
      expect(plans).toHaveLength(0);
    });
  });

  it('라인 실행이 요청과 다른 수량·단가·ETA 를 기록한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await buildService(trx).orderLine(
        fx.poId,
        fx.skuIds[0],
        { orderedQty: 6, unitPrice: 1200, expectedArrival: '2026-09-17' },
        ACTOR,
        trx,
      );

      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({
        status: 'ordered',
        quantity: 10, // 요청은 그대로 남는다
        orderedQty: 6,
        unitPrice: 1200,
        expectedArrival: '2026-09-17',
        orderedBy: ACTOR,
      });
    });
  });

  it('계획은 첫 실행에서 한 번만 생기고, 이후 라인은 아이템으로 붙는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);
      await service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 10 }, ACTOR, trx);

      const plans = await trx
        .select({ id: wmsTables.inboundPlans.id })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, fx.poId));
      expect(plans).toHaveLength(1);

      const items = await trx
        .select({ skuId: wmsTables.inboundPlanItems.skuId, expectedQty: wmsTables.inboundPlanItems.expectedQty })
        .from(wmsTables.inboundPlanItems)
        .where(eq(wmsTables.inboundPlanItems.planId, plans[0].id));
      expect(items).toHaveLength(2);
      // 계획에 잡히는 것은 요청(10)이 아니라 실발주(6)다.
      expect(items.find((i) => i.skuId === fx.skuIds[0])?.expectedQty).toBe(6);
      expect(items.find((i) => i.skuId === fx.skuIds[1])?.expectedQty).toBe(10);
    });
  });

  it('발주불가 라인은 계획에 아무것도 남기지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await buildService(trx).markLineUnavailable(fx.poId, fx.skuIds[0], { reason: '품절' }, ACTOR, trx);

      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({ status: 'unavailable', orderedQty: null });
      const plans = await trx
        .select({ id: wmsTables.inboundPlans.id })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, fx.poId));
      expect(plans).toHaveLength(0);
    });
  });

  it('종결된 라인은 재실행도 번복도 안 된다 (단방향)', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      await expect(
        service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 4 }, ACTOR, trx),
      ).rejects.toMatchObject({ name: 'ConflictError' });
      await expect(
        service.markLineUnavailable(fx.poId, fx.skuIds[0], {}, ACTOR, trx),
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });
  });

  it('실발주 수량 0 은 거부된다 — unavailable 과 의미가 겹친다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await expect(
        buildService(trx).orderLine(fx.poId, fx.skuIds[0], { orderedQty: 0 }, ACTOR, trx),
      ).rejects.toMatchObject({ name: 'BadRequestError' });
    });
  });

  it('헤더 상태는 라인에서 파생된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);

      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);
      expect(await readHeaderStatus(trx, fx.poId)).toBe('created'); // 아직 requested 가 남았다

      await service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 10 }, ACTOR, trx);
      await service.markLineUnavailable(fx.poId, fx.skuIds[2], {}, ACTOR, trx);
      expect(await readHeaderStatus(trx, fx.poId)).toBe('confirmed'); // 전부 종결
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: FAIL — `service.orderLine is not a function`

- [ ] **Step 3: 요청 DTO 를 만든다**

`apps/core/src/modules/inventory/inbound/dto/purchase-order/execute-line.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class OrderPurchaseOrderLineDto {
  @ApiProperty({ description: '실제로 발주한 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  orderedQty: number;

  @ApiPropertyOptional({ description: '실제 발주 단가' })
  @IsOptional()
  @IsInt()
  @Min(0)
  unitPrice?: number;

  /**
   * `@IsDateString()` 을 쓰지 않는다 — 그건 '2026-09-17T00:00:00+09:00' 도 통과시키고,
   * 그런 값은 날짜가 하루 밀린 채 저장된다.
   */
  @ApiPropertyOptional({ description: '이 품목의 도착예정일 (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expectedArrival must be YYYY-MM-DD' })
  expectedArrival?: string;
}

export class MarkLineUnavailableDto {
  @ApiPropertyOptional({ description: '발주하지 못한 이유 (품절·단종 등)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
```

- [ ] **Step 4: 서비스에 실행 메서드를 넣는다**

`purchase-order.service.ts` 에 추가한다 (`updatePurchaseOrderLines` 근처):

```ts
  /**
   * 라인 하나를 실제로 발주했다고 기록한다.
   *
   * 실행 순간 수량·단가·도착예정일이 확정된다. 요청 수량(`quantity`)은 덮어쓰지 않는다 —
   * 요청 10 / 실발주 6 이 둘 다 남아야 "왜 4개가 비었나" 를 나중에 답할 수 있다.
   * 계획은 **첫 실행에서** 생긴다. 발주서 생성 시점이 아니다 — 아직 주문 안 했으니
   * 입고 예정도 없다.
   */
  async orderLine(
    poId: string,
    skuId: string,
    dto: OrderPurchaseOrderLineDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      const line = await this.loadRequestedLine(trx, poId, skuId);
      if (dto.orderedQty < 1) {
        // class-validator 가 이미 막지만, 서비스를 직접 부르는 경로(스펙·다른 서비스)를 위해
        // 여기서도 막는다. 0 은 unavailable 과 의미가 겹친다.
        throw new BadRequestError('orderedQty must be at least 1; use the unavailable action instead');
      }

      await trx
        .update(wmsTables.purchaseOrderLines)
        .set({
          status: 'ordered',
          orderedQty: dto.orderedQty,
          unitPrice: dto.unitPrice ?? line.unitPrice,
          expectedArrival: dto.expectedArrival ?? null,
          orderedAt: new Date(),
          orderedBy: userId,
        })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));

      const plan = await this.inboundService.ensurePlanForPurchaseOrder(poId, dto.expectedArrival ?? null, trx);
      await this.inboundService.addInboundPlanItems(
        {
          planId: plan.id,
          items: [{ skuId, expectedQty: dto.orderedQty, expectedDate: dto.expectedArrival }],
        },
        trx,
      );

      await this.refreshHeaderStatus(trx, poId);
      return this.getPurchaseOrderById(poId, trx);
    }, tx);
  }

  /** 라인을 끝내 발주하지 못했다고 종결한다. 되살릴 수 없다 — 다시 사려면 새 발주서를 만든다. */
  async markLineUnavailable(
    poId: string,
    skuId: string,
    dto: MarkLineUnavailableDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      await this.loadRequestedLine(trx, poId, skuId);

      await trx
        .update(wmsTables.purchaseOrderLines)
        .set({
          status: 'unavailable',
          unavailableReason: dto.reason ?? null,
          orderedAt: new Date(),
          orderedBy: userId,
        })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));

      await this.refreshHeaderStatus(trx, poId);
      return this.getPurchaseOrderById(poId, trx);
    }, tx);
  }

  /** 아직 실행되지 않은 라인만 내준다. 종결된 라인은 재실행도 번복도 안 된다. */
  private async loadRequestedLine(tx: DbTx, poId: string, skuId: string) {
    const [line] = await tx
      .select({
        status: wmsTables.purchaseOrderLines.status,
        unitPrice: wmsTables.purchaseOrderLines.unitPrice,
      })
      .from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)))
      .limit(1);

    if (!line) throw new NotFoundError(`Purchase order line not found: ${poId}/${skuId}`);
    if (line.status !== 'requested') {
      throw new ConflictError(`Line already ${line.status}: ${poId}/${skuId}`);
    }
    return line;
  }

  /**
   * 헤더 `status` 를 라인에서 다시 계산한다.
   *
   * 진실은 라인이고 컬럼은 캐시다. `partially_ordered` 같은 새 enum 값은 넣지 않는다 —
   * "부분" 은 라인이 이미 표현하고, enum 값 추가는 admin-web 선배포를 요구해 단계만 늘린다.
   * `received` 는 입고 경로가 소유하므로 여기서 건드리지 않는다.
   */
  private async refreshHeaderStatus(tx: DbTx, poId: string): Promise<void> {
    const [header] = await tx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1);
    if (!header || header.status === 'received') return;

    const [pending] = await tx
      .select({ skuId: wmsTables.purchaseOrderLines.skuId })
      .from(wmsTables.purchaseOrderLines)
      .where(
        and(
          eq(wmsTables.purchaseOrderLines.poId, poId),
          eq(wmsTables.purchaseOrderLines.status, 'requested'),
        ),
      )
      .limit(1);

    const next = pending ? 'created' : 'confirmed';
    if (next === header.status) return;

    await tx
      .update(wmsTables.purchaseOrders)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(wmsTables.purchaseOrders.id, poId));
  }
```

import 를 보강한다 (이미 있는 것은 추가하지 않는다):

```ts
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { OrderPurchaseOrderLineDto, MarkLineUnavailableDto } from '../dto/purchase-order/execute-line.dto';
```

- [ ] **Step 5: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: PASS (7 tests)

- [ ] **Step 6: 엔드포인트를 연다**

`purchase-order.controller.ts` 의 `@Put(':id/lines')` 아래에 추가한다:

```ts
  @Post(':poId/lines/:skuId/order')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주 라인 실행 (실제로 발주함)' })
  @ApiParam({ name: 'poId', description: '발주 ID' })
  @ApiParam({ name: 'skuId', description: 'SKU ID — 라인 주소' })
  @ApiResponse({ status: 409, description: '이미 종결된 라인' })
  async orderLine(
    @Param('poId') poId: string,
    @Param('skuId') skuId: string,
    @Body() dto: OrderPurchaseOrderLineDto,
    @User() user: JwtPayload,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.orderLine(poId, skuId, dto, user.userId);
  }

  @Post(':poId/lines/:skuId/unavailable')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주 라인 종결 (끝내 발주 못 함)' })
  @ApiParam({ name: 'poId', description: '발주 ID' })
  @ApiParam({ name: 'skuId', description: 'SKU ID — 라인 주소' })
  @ApiResponse({ status: 409, description: '이미 종결된 라인' })
  async markLineUnavailable(
    @Param('poId') poId: string,
    @Param('skuId') skuId: string,
    @Body() dto: MarkLineUnavailableDto,
    @User() user: JwtPayload,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.markLineUnavailable(poId, skuId, dto, user.userId);
  }
```

`execute-line.dto.ts` 의 두 DTO 를 컨트롤러 import 에 추가한다.

> **경로 순서 주의**: 이 컨트롤러에는 `@Get(':id')` 가 있다. Nest 는 선언 순서로 매칭하므로 `:poId/lines/...` 가 `:id` 보다 **뒤에 있어도** 세그먼트 수가 달라 충돌하지 않는다. 그래도 `@Put(':id/lines')` 근처에 두어 읽기 쉽게 한다.

- [ ] **Step 7: 게이트 + 커밋**

```bash
npm run type-check && npx jest --maxWorkers=2
git add -A
git commit -m "feat(inventory): 발주 라인을 하나씩 실행한다 (#724)

POST /purchase-orders/:poId/lines/:skuId/order 와 .../unavailable.

실행 순간 수량·단가·도착예정일이 확정되고, 요청 수량은 그대로 남는다 — 요청 10 /
실발주 6 이 둘 다 있어야 왜 4개가 비었는지 나중에 답할 수 있다. 계획은 첫 실행에서
생긴다. 발주서 생성 시점이 아니다.

종결은 단방향이다. 재실행·번복 모두 409 — 다시 사려면 새 발주서를 만든다. 실발주 0 은
거부하고 unavailable 로 보낸다(한 사실에 표현이 둘이면 조회하는 쪽이 언젠가 한쪽을 빠뜨린다).

헤더 status 는 라인에서 파생되는 캐시가 됐다. @User() 를 실제로 넘겨 ordered_by 를 채운다."
```

---

### Task 6: 파이프라인 ① ETA 를 아이템 우선으로

**Files:**
- Modify: `apps/core/src/modules/inventory/stock-projection/services/inbound-pipeline.reader.ts:69-97`
- Test: `apps/core/src/modules/inventory/stock-projection/services/inbound-pipeline.integration.spec.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `inboundPlanItems.expectedDate` (Task 3), 라인 실행 (Task 5)
- Produces: `InboundPipelineRow.onOrderEta` 의 의미가 "아이템 예정일 중 최소, 없으면 계획 예정일" 로 바뀐다. 타입은 `Date | null` 그대로.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

기존 `inbound-pipeline.integration.spec.ts` 의 마지막 `it` 뒤에 추가한다. 픽스처 헬퍼 이름은 그 파일의 것을 그대로 쓴다 — **먼저 파일을 읽고** 창고·SKU·계획을 만드는 헬퍼의 실제 이름과 시그니처를 확인할 것.

```ts
  it('①의 ETA 는 계획 날짜가 아니라 아이템 예정일 중 최소다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 비판매 창고(중국)로 들어오는 계획 하나에, 예정일이 다른 아이템 둘.
      const fx = await seedNonSellableInboundPlan(trx, { expectedDate: '2026-12-31' });
      await trx.insert(wmsTables.inboundPlanItems).values([
        { planId: fx.planId, skuId: fx.skuIds[0], expectedQty: 5, receivedQty: 0, status: 'pending', expectedDate: '2026-09-20' },
        { planId: fx.planId, skuId: fx.skuIds[0], expectedQty: 3, receivedQty: 0, status: 'pending', expectedDate: '2026-09-17' },
      ]);

      const rows = await reader.read(trx, { skuIds: [fx.skuIds[0]], toWarehouseId: fx.sellableWarehouseId });
      expect(rows[0].onOrderQty).toBe(8);
      expect(rows[0].onOrderEta?.toISOString().slice(0, 10)).toBe('2026-09-17');
    });
  });

  it('아이템 예정일이 없으면 계획 예정일로 떨어진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedNonSellableInboundPlan(trx, { expectedDate: '2026-12-31' });
      await trx.insert(wmsTables.inboundPlanItems).values([
        { planId: fx.planId, skuId: fx.skuIds[0], expectedQty: 4, receivedQty: 0, status: 'pending' },
      ]);

      const rows = await reader.read(trx, { skuIds: [fx.skuIds[0]], toWarehouseId: fx.sellableWarehouseId });
      expect(rows[0].onOrderEta?.toISOString().slice(0, 10)).toBe('2026-12-31');
    });
  });
```

> 그 파일에 `seedNonSellableInboundPlan` 같은 헬퍼가 없으면 **직접 만든다** — 판매 창고 1개(`is_sellable=true`)·비판매 창고 1개·SKU·발주·그 발주에 붙은 `planType='source'` 계획을 넣고 `{ planId, skuIds, sellableWarehouseId }` 를 반환한다. 창고 판매 여부 컬럼의 정확한 이름은 `sellable-warehouses.ts` 의 `inSellableWarehouse` 구현에서 확인한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-pipeline`
Expected: FAIL — 첫 테스트가 `2026-12-31` 을 돌려준다 (계획 날짜를 보고 있다).

- [ ] **Step 3: 리더를 고친다**

`inbound-pipeline.reader.ts` 의 `readOnOrder` select 에서 `eta` 계산을 바꾼다:

```ts
        // 예정일의 진실은 아이템이다 — 라인마다 ETA 가 다를 수 있는데 계획 날짜는
        // 계획 단위라 그걸 담지 못한다. 아이템 예정일이 없으면(수동 생성 계획 등)
        // 계획 날짜로 떨어진다. `date` 컬럼이라 드라이버가 'YYYY-MM-DD' 를 준다.
        eta: sql<string | null>`MIN(COALESCE(${items.expectedDate}, ${plans.expectedDate}::date))`,
```

`min` import 가 이 변경으로 안 쓰이게 되면 import 목록에서 뺀다.

반환 매핑을 바꾼다 (같은 메서드 끝):

```ts
    // 'YYYY-MM-DD' 는 UTC 자정으로 결정적으로 파싱된다 — TZ 함정이 없다.
    return new Map(
      rows.map((row) => [row.skuId, { qty: Number(row.qty), eta: row.eta ? new Date(row.eta) : null }]),
    );
```

- [ ] **Step 4: 라인 실행 → 파이프라인 end-to-end 를 고정한다**

앞의 두 테스트는 아이템을 손으로 심는다. 실제로 중요한 것은 **라인 실행이 파이프라인 ①에
정확한 수량으로 나타나는가**다 — 스펙 §7 의 1·2 항목이다. Task 5 의 스펙 파일
(`purchase-order-line-execution.integration.spec.ts`) 끝에 추가한다.

이 테스트는 **비판매 창고**로 들어오는 해외 발주여야 한다 — ①은 `not(inSellableWarehouse(...))`
로 좁혀지므로 판매 창고(부천) 직입고 국내 발주는 ①에 안 잡힌다(그건 이미 입고예정이다).

```ts
  it('부분 실행이 파이프라인 ①에 실발주분만큼만 나타난다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 해외 발주: 출발=중국(비판매) ≠ 목적지=부천(판매)
      const fx = await seedForeignPoWithThreeLines(trx);
      const service = buildService(trx);
      const reader = new InboundPipelineReader(boundDbService(trx), new WarehouseTransferReader(boundDbService(trx)));

      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);       // 요청 10 → 6개만
      await service.markLineUnavailable(fx.poId, fx.skuIds[1], { reason: '품절' }, ACTOR, trx);
      // fx.skuIds[2] 는 손대지 않는다 (아직 requested)

      const rows = await reader.read(trx, { skuIds: fx.skuIds, toWarehouseId: fx.sellableWarehouseId });
      const bySku = new Map(rows.map((r) => [r.skuId, r]));

      expect(bySku.get(fx.skuIds[0])?.onOrderQty).toBe(6);  // 요청 10 이 아니라 실발주 6
      expect(bySku.get(fx.skuIds[1])?.onOrderQty).toBe(0);  // 발주불가는 세지 않는다
      expect(bySku.get(fx.skuIds[2])?.onOrderQty).toBe(0);  // 아직 주문 안 함 = 안 보인다
    });
  });
```

`seedForeignPoWithThreeLines` 는 Task 5 의 `seedPoWithThreeLines` 를 복제해 창고를 둘로
나눈 것이다 — 출발 창고는 판매 불가, 목적지 창고는 판매 가능으로 만들고
`{ poId, skuIds, sellableWarehouseId }` 를 반환한다. 창고 판매 여부 컬럼의 정확한 이름은
`apps/core/src/modules/inventory/shared/availability/sellable-warehouses.ts` 의
`inSellableWarehouse` 구현에서 확인한다.

`InboundPipelineReader` 와 `WarehouseTransferReader` 를 import 한다. `WarehouseTransferReader`
의 생성자 인자가 다르면 그 파일을 읽고 맞춘다.

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: PASS

- [ ] **Step 5: 통과 확인 + 게이트 + 커밋**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "inbound-pipeline|purchase-order-line-execution"
npm run type-check && npx jest --maxWorkers=2
git add -A
git commit -m "feat(inventory): 파이프라인 ①의 ETA 를 아이템 예정일 우선으로 (#724)

라인마다 ETA 가 다를 수 있는데 계획 날짜는 계획 단위라 담지 못한다. MIN(COALESCE(
item.expected_date, plan.expected_date)) 로 아이템을 우선하고, 없으면 계획으로 떨어진다.

응답 타입은 Date | null 유지 — admin-web 이 그렇게 읽는다. date 컬럼이 주는
'YYYY-MM-DD' 는 UTC 자정으로 결정적으로 파싱되므로 TZ 함정이 없다."
```

---

### Task 7: 라인 수정은 `requested` 만, `syncInboundPlanItems` 제거

`PUT /:id/lines` 는 지금 `received` 만 막고 라인 전체를 지웠다 다시 넣는다. 그리고 `confirmed` 상태면 `syncInboundPlanItems` 가 pending 아이템만 지우고 **새 라인 전체**를 재삽입해서, 이미 입고된 수량이 pending 으로 한 벌 더 생긴다(진단 문서 ④). 라인 생명주기가 생기면 이 함수는 존재 이유가 사라진다 — 종결된 라인은 수정 대상이 아니니 재삽입할 일이 없다.

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts` (`updatePurchaseOrderLines`, `syncInboundPlanItems` 삭제)
- Test: `apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts`

**Interfaces:**
- Consumes: `poLineStatusEnum` (Task 3), `orderLine` (Task 5)
- Produces: `updatePurchaseOrderLines` 가 종결된 라인을 건드리지 않는다. `syncInboundPlanItems` 는 더 이상 존재하지 않는다.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

Task 5 의 스펙 파일 끝에 추가한다:

```ts
  it('라인 수정은 아직 실행 안 된 라인만 건드린다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      // 세 라인 전부를 수량 99 로 바꾸려 시도한다.
      await service.updatePurchaseOrderLines(
        fx.poId,
        { lines: fx.skuIds.map((skuId) => ({ skuId, quantity: 99 })) },
        trx,
      );

      // 실행된 라인은 요청 수량도 실발주 수량도 그대로다.
      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({
        status: 'ordered',
        quantity: 10,
        orderedQty: 6,
      });
      // 아직 요청 상태인 라인은 바뀐다.
      expect(await readLine(trx, fx.poId, fx.skuIds[1])).toMatchObject({ status: 'requested', quantity: 99 });
    });
  });

  it('라인 수정이 이미 붙은 계획 아이템을 늘리지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      await service.updatePurchaseOrderLines(
        fx.poId,
        { lines: fx.skuIds.map((skuId) => ({ skuId, quantity: 99 })) },
        trx,
      );

      const [plan] = await trx
        .select({ id: wmsTables.inboundPlans.id })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, fx.poId));
      const items = await trx
        .select({ skuId: wmsTables.inboundPlanItems.skuId })
        .from(wmsTables.inboundPlanItems)
        .where(eq(wmsTables.inboundPlanItems.planId, plan.id));
      expect(items).toHaveLength(1); // 실행된 라인 하나뿐. 재삽입 없음.
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: FAIL — 현재 구현은 라인을 전부 지우고 다시 넣으므로 실행된 라인의 `status`·`orderedQty` 가 날아간다.

- [ ] **Step 3: 구현을 고친다**

`updatePurchaseOrderLines` 의 3~5단계(기존 라인 삭제 → 새 라인 삽입 → sync)를 아래로 바꾼다:

```ts
      // 3. 종결된 라인(ordered/unavailable)은 건드리지 않는다. 그 라인은 이미 계획에
      //    아이템으로 붙어 있고, 요청 수량을 바꾸면 실행 기록과 어긋난다.
      const closed = await trx
        .select({ skuId: wmsTables.purchaseOrderLines.skuId })
        .from(wmsTables.purchaseOrderLines)
        .where(
          and(
            eq(wmsTables.purchaseOrderLines.poId, poId),
            ne(wmsTables.purchaseOrderLines.status, 'requested'),
          ),
        );
      const closedSkuIds = new Set(closed.map((l) => l.skuId));

      // 4. 아직 요청 상태인 라인만 갈아끼운다.
      await trx
        .delete(wmsTables.purchaseOrderLines)
        .where(
          and(
            eq(wmsTables.purchaseOrderLines.poId, poId),
            eq(wmsTables.purchaseOrderLines.status, 'requested'),
          ),
        );

      const incoming = updateDto.lines.filter((line) => !closedSkuIds.has(line.skuId));
      if (incoming.length > 0) {
        await trx.insert(wmsTables.purchaseOrderLines).values(
          incoming.map((line) => ({
            poId,
            skuId: line.skuId,
            quantity: line.quantity,
            unitPrice: line.unitPrice ?? null,
          })),
        );
      }

      // 5. 계획 아이템 재동기화는 없다. 종결된 라인만 계획에 붙어 있고 그 라인은 위에서
      //    건드리지 않았으므로 아이템도 그대로다. 예전 syncInboundPlanItems 는 pending
      //    아이템만 지우고 새 라인 전체를 재삽입해서, 이미 입고된 수량을 pending 으로
      //    한 벌 더 만들었다(진단 문서 ④).
      await this.refreshHeaderStatus(trx, poId);
```

`private async syncInboundPlanItems(...)` 메서드 **전체를 삭제**한다. `ne` 를 drizzle-orm import 에 추가한다.

`received` 를 막는 기존 2단계 가드는 그대로 둔다.

- [ ] **Step 4: 통과 확인 + 게이트 + 커밋**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "purchase-order|inbound-pipeline|inbound-plan"
npm run type-check && npx jest --maxWorkers=2
git add -A
git commit -m "fix(inventory): 라인 수정은 미실행 라인만, syncInboundPlanItems 제거 (#724)

종결된 라인은 이미 계획에 아이템으로 붙어 있어 요청 수량을 바꾸면 실행 기록과 어긋난다.
미실행 라인만 갈아끼운다.

syncInboundPlanItems 는 pending 아이템만 지우고 새 라인 전체를 재삽입해서 이미 입고된
수량을 pending 으로 한 벌 더 만들었다(진단 문서 ④). 라인 생명주기가 생기면 재동기화할
대상 자체가 없으므로 함수를 지운다."
```

---

### Task 8: 응답 계약 DTO 화 (진단 문서 ⑤ = 항목 2)

`PurchaseOrderResponse` 는 bare interface 라 Swagger 스키마가 없고 컨트롤러가 `type: 'object'` 로 때운다 — CLAUDE.md 가 금지한 형태다. `auditStatus` 는 응답에 아예 빠져 있어서 admin-web 이 심사 버튼을 그리지 못한다. 라인 상태를 응답에 실어야 하니 어차피 이 계약을 건드려야 하고, 두 번 건드리면 admin-web 이 두 번 따라와야 한다.

**Files:**
- Create: `apps/core/src/modules/inventory/inbound/dto/purchase-order/purchase-order-response.dto.ts`
- Modify: `apps/core/src/modules/inventory/inbound/dto/purchase-order.dto.ts` (interface 제거, 재수출)
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts:420-530` (응답 조립에 필드 추가)
- Modify: `apps/core/src/modules/inventory/inbound/controllers/purchase-order.controller.ts` (`type: 'object'` → DTO 클래스)
- Test: `apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts`

**Interfaces:**
- Consumes: 라인 실행 (Task 5)
- Produces: `PurchaseOrderResponseDto` 클래스 (`auditStatus`, 라인별 `status`/`orderedQty`/`expectedArrival` 포함). 이름 `PurchaseOrderResponse` 는 별칭으로 유지해 기존 import 를 안 깬다.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

Task 5 의 스펙 파일 끝에 추가한다:

```ts
  it('응답이 심사 상태와 라인 실행 정보를 싣는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const response = await buildService(trx).orderLine(
        fx.poId,
        fx.skuIds[0],
        { orderedQty: 6, expectedArrival: '2026-09-17' },
        ACTOR,
        trx,
      );

      expect(response.auditStatus).toBe('approved');
      const executed = response.lines.find((l) => l.skuId === fx.skuIds[0]);
      expect(executed).toMatchObject({
        status: 'ordered',
        quantity: 10,
        orderedQty: 6,
        expectedArrival: '2026-09-17',
      });
      const untouched = response.lines.find((l) => l.skuId === fx.skuIds[1]);
      expect(untouched).toMatchObject({ status: 'requested', orderedQty: null });
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: FAIL — `response.auditStatus` 가 `undefined`.

- [ ] **Step 3: 응답 DTO 클래스를 만든다**

`apps/core/src/modules/inventory/inbound/dto/purchase-order/purchase-order-response.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PurchaseOrderStatus, PurchaseOrderType } from '../purchase-order.dto';

export type PurchaseOrderAuditStatus = 'draft' | 'pending_audit' | 'approved' | 'rejected';
export type PurchaseOrderLineStatus = 'requested' | 'ordered' | 'unavailable';

export class PurchaseOrderLineSkuDto {
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) barcode: string | null;
}

export class PurchaseOrderLineDto {
  @ApiProperty() skuId: string;

  @ApiProperty({ description: '요청 수량 — 실행이 덮어쓰지 않는다' })
  quantity: number;

  @ApiProperty({ enum: ['requested', 'ordered', 'unavailable'] })
  status: PurchaseOrderLineStatus;

  @ApiPropertyOptional({ description: '실제로 발주한 수량', nullable: true })
  orderedQty: number | null;

  @ApiPropertyOptional({ nullable: true }) unitPrice: number | null;

  @ApiPropertyOptional({ description: '이 품목의 도착예정일 (YYYY-MM-DD)', nullable: true })
  expectedArrival: string | null;

  @ApiPropertyOptional({ nullable: true }) orderedAt: Date | null;
  @ApiPropertyOptional({ nullable: true }) orderedBy: string | null;
  @ApiPropertyOptional({ nullable: true }) unavailableReason: string | null;

  @ApiPropertyOptional({ type: PurchaseOrderLineSkuDto })
  sku?: PurchaseOrderLineSkuDto;
}

export class PurchaseOrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['domestic', 'foreign'] }) type: PurchaseOrderType;
  @ApiPropertyOptional({ nullable: true }) supplierId: string | null;
  @ApiPropertyOptional({ nullable: true }) expectedArrival: Date | null;
  @ApiProperty({ enum: ['created', 'confirmed', 'received'] }) status: PurchaseOrderStatus;

  @ApiProperty({
    enum: ['draft', 'pending_audit', 'approved', 'rejected'],
    description: '심사 상태 — 예전 응답에서 통째로 빠져 있어 프론트가 심사 버튼을 못 그렸다',
  })
  auditStatus: PurchaseOrderAuditStatus;

  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  @ApiProperty({ type: [PurchaseOrderLineDto] })
  lines: PurchaseOrderLineDto[];
}
```

`purchase-order.dto.ts` 에서 `export interface PurchaseOrderResponse { ... }` 블록을 지우고 아래로 대체한다:

```ts
export { PurchaseOrderResponseDto } from './purchase-order/purchase-order-response.dto';
export type { PurchaseOrderResponseDto as PurchaseOrderResponse } from './purchase-order/purchase-order-response.dto';
```

> 기존 `supplier?: SupplierResponseDto` 필드를 쓰는 곳이 있으면 `PurchaseOrderResponseDto` 에도 같은 필드를 `@ApiPropertyOptional({ type: SupplierResponseDto })` 로 추가한다. `grep -rn "\.supplier" apps/core/src/modules/inventory/inbound` 로 먼저 확인할 것.

- [ ] **Step 4: 서비스 응답 조립에 필드를 넣는다**

`purchase-order.service.ts` 의 `getPurchaseOrderById` / 목록 조회에서 응답을 만드는 객체 리터럴(약 420-530행)에 `auditStatus` 를 추가하고, 라인 매핑에 실행 필드를 추가한다. select 절에도 그 컬럼들을 넣어야 한다:

```ts
        auditStatus: po.auditStatus,
        lines: lines.map((line) => ({
          skuId: line.skuId,
          quantity: line.quantity,
          status: line.status,
          orderedQty: line.orderedQty,
          unitPrice: line.unitPrice,
          expectedArrival: line.expectedArrival,
          orderedAt: line.orderedAt,
          orderedBy: line.orderedBy,
          unavailableReason: line.unavailableReason,
          sku: line.skuName ? { name: line.skuName, barcode: line.skuBarcode ?? null } : undefined,
        })),
```

- [ ] **Step 5: 컨트롤러의 `type: 'object'` 를 없앤다**

`purchase-order.controller.ts` 의 `@ApiResponse({ ..., type: 'object' })` 와 `type: [Object]` 를 전부 `type: PurchaseOrderResponseDto` / `type: [PurchaseOrderResponseDto]` 로 바꾼다.

Run: `grep -n "type: 'object'\|type: \[Object\]" apps/core/src/modules/inventory/inbound/controllers/purchase-order.controller.ts`
Expected: 아무것도 안 나와야 한다.

- [ ] **Step 6: 통과 확인 + 게이트 + 커밋**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order
npm run type-check && npx jest --maxWorkers=2
git add -A
git commit -m "feat(inventory): 발주 응답을 DTO 클래스로, auditStatus·라인 상태 포함 (#724)

bare interface 라 Swagger 스키마가 없었고 컨트롤러가 type:'object' 로 때웠다(CLAUDE.md
금지 형태). auditStatus 는 응답에 아예 없어서 프론트가 심사 버튼을 못 그렸다.

라인 상태를 실어야 하니 어차피 계약을 건드려야 했다 — 두 번 건드리면 admin-web 이 두 번
따라와야 하므로 항목 2 를 여기 합쳤다."
```

---

## 마무리 — PR 로 자르기

이 계획의 8개 태스크는 스펙 §6 의 PR 3개에 대응한다:

| PR | 태스크 | 마이그 | 배포 |
|---|---|---|---|
| 1 | Task 1, 2 | 0 | 순서 무관 |
| 2 | Task 3 | **있음** | **migrate → deploy** |
| 3 | Task 4~8 | 0 | PR 2 배포 후 |

**PR 2 와 3 사이에 배포가 끝나야 한다** (CLAUDE.md — 한 deploy 에 두 phase 가 묶이면 컨벤션이 무력화된다).

admin-web(스펙 §6 의 PR 4)은 **이 계획 범위 밖**이다. core PR 3 배포 후 별도 계획으로 쓴다. 그때까지 라인 실행 UI 경로는 없다 — API 만 열린다.

## PR 본문에 붙일 것

통합 스펙은 CI 에서 skip 되므로(`DATABASE_URL` 없음) **CI 는 이 작업을 검증하지 못한다.** 각 PR 본문에 아래 실행 결과를 붙인다:

```
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "purchase-order|inbound-plan|inbound-pipeline"
```
