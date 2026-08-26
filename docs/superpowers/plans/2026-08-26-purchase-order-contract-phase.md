# 발주 계약 정리 (contract phase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 라인이 진실인 발주 모델에 옛 계약 세 개(`PUT /:id/status → confirmed`, 헤더 `expected_arrival`, `inbound_plans.expected_date`)가 남아 만드는 이중 진실을 없앤다.

**Architecture:** 헤더 status 는 라인 파생 + 종결만 수동으로 좁히고, 도착예정일의 소유권을 헤더/계획에서 **라인/아이템**으로 완전히 내린다. 응답 필드는 이름·타입을 유지한 채 출처만 파생으로 바꿔 admin-web·Tauri 앱 계약을 보존한다. 판정 로직(전이 가드·ETA 파생)은 DB 없이 도는 순수 함수로 뽑아 기본 게이트가 검증하게 한다.

**Tech Stack:** NestJS · Drizzle ORM(postgres.js) · class-validator · Jest(+ DB 통합 스펙)

**Spec:** `docs/superpowers/specs/2026-08-26-purchase-order-contract-phase-design.md`

## Global Constraints

- 트랜잭션은 `this.dbService.run(async (trx) => ..., tx)` 단일 러너. 클래스별 `inTx` 헬퍼 금지 (ADR-0025)
- 공개 메서드는 `tx?: DbTx` 를 마지막 파라미터로, private 헬퍼는 `tx: DbTx` 필수
- 도메인 예외는 `@app/shared` 의 `NotFoundError` / `BadRequestError` / `ConflictError`. 서비스에서 `HttpException` 계열 금지
- drizzle enum 컬럼은 문자열 유니온이다 — **TS enum 멤버와 비교하지 말고 리터럴로 비교**한다 (`no-unsafe-enum-comparison`)
- 날짜 컬럼: `purchase_order_lines.expected_arrival` 과 `inbound_plan_items.expected_date` 는 `date` + `mode:'string'` = `'YYYY-MM-DD'`. **`new Date()` 왕복 금지** (UTC 이동으로 하루 밀린다)
- 검증 게이트는 셋 다 0 이 기준선: `npm run type-check` · `npx jest --maxWorkers=2` · `cd apps/admin-web && npx tsc --noEmit`
- 통합 스펙 실행: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>` (러너가 `drizzle-kit migrate` 를 먼저 돌린다)
- 커밋은 사용자가 요청할 때만 한다. 각 Task 의 커밋 스텝은 **요청이 있을 때** 실행한다

## File Structure

**신설**

| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/inventory/inbound/services/purchase-order-status.rules.ts` | 헤더 status 전이 판정 (순수) |
| `apps/core/src/modules/inventory/inbound/services/purchase-order-status.rules.spec.ts` | 위 단위 스펙 |
| `apps/core/src/modules/inventory/inbound/services/earliest-expected-date.ts` | 예정일 목록 → 가장 이른 날짜 (순수) |
| `apps/core/src/modules/inventory/inbound/services/earliest-expected-date.spec.ts` | 위 단위 스펙 |
| `apps/core/drizzle/<timestamp>_purchase-order-contract-phase.sql` | 백필 2 · 인덱스 3 · DROP 2 |

**수정**

| 파일 | 무엇 |
|---|---|
| `.../inbound/dto/purchase-order.dto.ts` | `UpdatePurchaseOrderStatusDto` 를 `received` 전용으로 축소 |
| `.../inbound/dto/simple-inbound.dto.ts` | `CreateInboundPlanDto.expectedDate` 제거 |
| `.../inbound/controllers/purchase-order.controller.ts` | 상태 라우트 Swagger 문구·409 |
| `.../inbound/services/purchase-order.service.ts` | 확정 블록 삭제 · 전이 가드 · 생성 팬아웃 · 응답 파생 |
| `.../inbound/services/inbound.service.ts` | 계획 ETA 쓰기 제거 · 읽는 쪽 2곳 아이템 기준 |
| `.../stock-projection/services/inbound-pipeline.reader.ts` | `COALESCE` 제거 |
| `.../inventory/schema/inventory.schema.ts` | 컬럼 2개 제거 · 인덱스 재정의 |
| `.../inbound/services/purchase-order-line-execution.integration.spec.ts` | 일괄 확정 전제 스펙 재작성 |
| `.../inbound/services/purchase-order-single-plan.integration.spec.ts` | 확정 헬퍼를 라인 실행으로 교체 |

---

### Task 1: 판정 로직을 순수 함수로 뽑는다

DB 도 Nest 도 없는 두 함수. 기본 `npx jest` 게이트가 이 판정을 검증한다 — 통합 스펙은 DB 가 없으면 통째로 skip 되므로, 규칙을 거기에만 두면 게이트가 비어 있다.

**Files:**
- Create: `apps/core/src/modules/inventory/inbound/services/purchase-order-status.rules.ts`
- Create: `apps/core/src/modules/inventory/inbound/services/purchase-order-status.rules.spec.ts`
- Create: `apps/core/src/modules/inventory/inbound/services/earliest-expected-date.ts`
- Create: `apps/core/src/modules/inventory/inbound/services/earliest-expected-date.spec.ts`

**Interfaces:**
- Consumes: `ConflictError` (`@app/shared`)
- Produces:
  - `type PurchaseOrderHeaderStatus = 'created' | 'confirmed' | 'received'`
  - `assertReceivedTransition(current: PurchaseOrderHeaderStatus): void`
  - `earliestExpectedDate(dates: (string | null)[]): Date | null`

- [ ] **Step 1: 전이 가드의 실패 테스트를 쓴다**

`purchase-order-status.rules.spec.ts`:

```typescript
import { assertReceivedTransition } from './purchase-order-status.rules';

describe('발주 종결 전이', () => {
  it('전 라인이 종결된 발주(confirmed)만 received 로 간다', () => {
    expect(() => assertReceivedTransition('confirmed')).not.toThrow();
  });

  // 아직 requested 인 라인이 남았다는 뜻이다. 발주하지 않은 물건이 입고될 수는 없다.
  it('created 는 거부한다 — 라인을 먼저 실행해야 한다', () => {
    expect(() => assertReceivedTransition('created')).toThrow(/created/);
  });

  // #735 가 심사 게이트를 걷어내며 received → confirmed 역방향이 열렸다. 같은 술어가 막는다.
  it('이미 종결된 발주는 다시 종결되지 않는다', () => {
    expect(() => assertReceivedTransition('received')).toThrow(/received/);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest purchase-order-status.rules --maxWorkers=2`
Expected: FAIL — `Cannot find module './purchase-order-status.rules'`

- [ ] **Step 3: 최소 구현**

`purchase-order-status.rules.ts`:

```typescript
import { ConflictError } from '@app/shared';

/** drizzle enum 컬럼은 문자열 유니온이다. TS enum 멤버로 비교하지 않는다. */
export type PurchaseOrderHeaderStatus = 'created' | 'confirmed' | 'received';

/**
 * 헤더 status 는 라인에서 파생된다(`refreshHeaderStatus`). 사람이 직접 쓸 수 있는 값은
 * 종결(`received`) 하나뿐이고, 그것도 전 라인이 종결(`ordered`/`unavailable`)돼
 * 헤더가 `confirmed` 로 파생된 발주에서만 가능하다.
 *
 * `created` 거부와 `received` 거부는 같은 술어의 두 얼굴이다 — 전자는 아직 발주하지
 * 않은 라인을 입고 처리하는 것을 막고, 후자는 #724 항목 3(#735)이 심사 게이트를
 * 걷어내며 열린 역방향 전이를 막는다.
 */
export function assertReceivedTransition(current: PurchaseOrderHeaderStatus): void {
  if (current === 'confirmed') return;
  throw new ConflictError(
    `Cannot mark purchase order as received from status '${current}' — every line must be executed first`,
  );
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest purchase-order-status.rules --maxWorkers=2`
Expected: PASS (3 tests)

- [ ] **Step 5: ETA 파생의 실패 테스트를 쓴다**

`earliest-expected-date.spec.ts`:

```typescript
import { earliestExpectedDate } from './earliest-expected-date';

describe('가장 이른 예정일', () => {
  it('가장 이른 날짜를 고른다', () => {
    expect(earliestExpectedDate(['2026-09-10', '2026-08-30', '2026-12-01'])?.toISOString()).toBe(
      '2026-08-30T00:00:00.000Z',
    );
  });

  it('날짜가 없는 항목은 건너뛴다', () => {
    expect(earliestExpectedDate([null, '2026-09-10'])?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('전부 비어 있으면 null 이다', () => {
    expect(earliestExpectedDate([null])).toBeNull();
    expect(earliestExpectedDate([])).toBeNull();
  });

  // 러너 TZ 가 무엇이든 달력 날짜가 밀리지 않는다. jest 는 UTC 로 뜨지만(#724 항목 13)
  // 이 성질은 TZ 와 무관하게 성립해야 한다 — 확인은 셸에서 TZ 를 바꿔 돌린다.
  it('오프셋 없는 날짜를 UTC 자정으로 올린다', () => {
    const result = earliestExpectedDate(['2026-01-01']);
    expect(result?.getUTCFullYear()).toBe(2026);
    expect(result?.getUTCMonth()).toBe(0);
    expect(result?.getUTCDate()).toBe(1);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx jest earliest-expected-date --maxWorkers=2`
Expected: FAIL — 모듈 없음

- [ ] **Step 7: 최소 구현**

`earliest-expected-date.ts`:

```typescript
/**
 * 예정일은 더 이상 헤더 컬럼이 아니다 — 발주 헤더는 **라인 ETA 중 가장 이른 날짜**,
 * 입고 계획은 **아직 안 들어온 아이템 예정일 중 가장 이른 날짜**다. 두 자리가 같은
 * 규칙이라 함수 하나를 나눠 쓴다.
 *
 * 컬럼은 `date` + `mode:'string'` 이라 `'YYYY-MM-DD'` 로 온다. 이 모양은 사전순이
 * 곧 시간순이라 문자열 비교로 최소값을 고를 수 있고, `new Date()` 왕복이 없으니
 * 러너 TZ 가 달력 하루를 밀 여지도 없다.
 *
 * 응답 타입은 `Date | null` 을 유지한다 — admin-web 목록 「도착예정일」 컬럼과
 * 물류팀 Tauri 앱 입고 대기 목록이 그렇게 읽는다.
 */
export function earliestExpectedDate(dates: (string | null)[]): Date | null {
  const present = dates.filter((date): date is string => date !== null);
  if (present.length === 0) return null;
  const earliest = present.reduce((min, date) => (date < min ? date : min));
  return new Date(`${earliest}T00:00:00.000Z`);
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx jest earliest-expected-date purchase-order-status.rules --maxWorkers=2`
Expected: PASS (7 tests)

- [ ] **Step 9: 타입 게이트**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 10: 커밋 (사용자 요청 시)**

```bash
git add apps/core/src/modules/inventory/inbound/services/purchase-order-status.rules.ts \
        apps/core/src/modules/inventory/inbound/services/purchase-order-status.rules.spec.ts \
        apps/core/src/modules/inventory/inbound/services/earliest-expected-date.ts \
        apps/core/src/modules/inventory/inbound/services/earliest-expected-date.spec.ts
git commit -m "feat(inventory): 발주 전이 가드·헤더 ETA 파생을 순수 함수로 (#724 항목 9)"
```

---

### Task 2: `PUT /:id/status` 를 종결 전용으로 좁힌다

일괄 확정 경로를 삭제하고 전이 가드를 배선한다. **이 Task 가 일괄 확정 능력을 없앤다** — 사용자가 승인한 회수다(스펙 §7).

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/dto/purchase-order.dto.ts:157-172`
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts:150-265`
- Modify: `apps/core/src/modules/inventory/inbound/controllers/purchase-order.controller.ts:217-235`
- Test: `apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts`

**Interfaces:**
- Consumes: `assertReceivedTransition` (Task 1)
- Produces: `updatePurchaseOrderStatus(poId, { status: 'received' }, userId, tx?)` — 다른 값은 DTO 가 400 으로 거부

- [ ] **Step 1: 통합 스펙을 새 계약으로 바꾼다**

`purchase-order-line-execution.integration.spec.ts` 에서 **삭제**할 테스트 5개 (일괄 확정 전제가 사라졌다):

- `'심사 축이 없으므로 draft 발주도 일괄 확정된다'` (:289)
- `'일괄 확정도 라인 실행 경로를 지난다 — 라인이 ordered 가 되고 실행자가 남는다'` (:457)
- `'라인을 하나 실행한 뒤 일괄 확정해도 아이템은 라인당 하나다 (두 writer 제거)'` (:474) — 라인 재실행 409 스펙(:382)이 같은 성질을 이미 지킨다
- `'확정 요청의 새 도착예정일이 계획·아이템·라인에 모두 실린다'` (:521)
- `'이미 입고된 발주를 다시 confirmed 로 불러도 아이템이 늘지 않는다'` (:489) — 아래 새 테스트가 대체한다

`'전 라인이 발주불가면 빈 계획을 만들지 않는다'`(:578)는 **살린다.** 본문의 일괄 확정 호출을 라인 3개를 각각 `markLineUnavailable` 하는 것으로 바꾸면 같은 성질이 그대로 검증된다.

같은 파일에 **추가**할 테스트 3개:

```typescript
  it('전 라인이 종결된 발주만 received 로 간다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      for (const skuId of fx.skuIds) {
        await service.orderLine(fx.poId, skuId, { orderedQty: 10 }, ACTOR, trx);
      }

      const result = await service.updatePurchaseOrderStatus(
        fx.poId,
        { status: PurchaseOrderStatus.RECEIVED },
        ACTOR,
        trx,
      );

      expect(result.status).toBe('received');
    });
  });

  it('아직 실행 안 된 라인이 남은 발주는 종결을 거부한다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      // 라인 하나만 실행 — 헤더는 여전히 created 로 파생된다.
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10 }, ACTOR, trx);

      await expect(
        service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.RECEIVED }, ACTOR, trx),
      ).rejects.toThrow(/created/);
    });
  });

  // #735 가 심사 게이트를 걷어내며 열린 역방향 전이. 종결은 한 번뿐이다.
  it('이미 종결된 발주는 다시 종결되지 않는다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      for (const skuId of fx.skuIds) {
        await service.orderLine(fx.poId, skuId, { orderedQty: 10 }, ACTOR, trx);
      }
      await service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.RECEIVED }, ACTOR, trx);

      await expect(
        service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.RECEIVED }, ACTOR, trx),
      ).rejects.toThrow(/received/);
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: 새 테스트 3개 중 최소 2개 FAIL (지금은 `created` 에서도 `received` 가 그냥 써지고, 재종결도 통과한다)

- [ ] **Step 3: DTO 를 종결 전용으로 좁힌다**

`purchase-order.dto.ts` 의 `UpdatePurchaseOrderStatusDto` 를 통째로 교체한다:

```typescript
export class UpdatePurchaseOrderStatusDto {
  /**
   * 종결(`received`)만 받는다. `created`/`confirmed` 는 라인에서 파생되는 값이라
   * 사람이 직접 쓰지 않는다 — 라인을 실행하거나(`POST /:poId/lines/:skuId/order`)
   * 발주불가로 끊으면(`.../unavailable`) 헤더가 따라온다.
   */
  @ApiProperty({ enum: [PurchaseOrderStatus.RECEIVED], description: '발주 종결 (입고 완료)' })
  @IsIn([PurchaseOrderStatus.RECEIVED])
  status: PurchaseOrderStatus.RECEIVED;
}
```

`IsIn` 을 `class-validator` import 에 추가하고, 이 파일에서 더 안 쓰이면 `IsEnum` / `Validate` / `IsCalendarDateConstraint` import 는 남겨둔다(생성 DTO 들이 계속 쓴다).

- [ ] **Step 4: 서비스의 확정 블록을 삭제하고 가드를 배선한다**

`purchase-order.service.ts` 의 `updatePurchaseOrderStatus` 를 통째로 교체한다 (JSDoc 포함, 기존 `:150-265`):

```typescript
  /**
   * 발주를 종결한다.
   *
   * 헤더 status 는 라인에서 파생된다(`refreshHeaderStatus`). 사람이 직접 쓰는 값은
   * 종결 하나뿐이다 — 예전엔 이 자리가 `confirmed` 도 받아 "아직 실행 안 된 라인을
   * 전부 지금 발주한 것으로 친다" 는 일괄 실행을 상태 쓰기로 위장해 수행했다.
   * 두 번째 실행 경로가 곧 이중 계상 사고의 원인이었고, 라인 실행 UI(#739)가 붙은
   * 지금은 대체 경로도 있다. 일괄 실행이 다시 필요해지면 상태 쓰기가 아니라
   * `POST /:id/lines/order-all` 같은 전용 엔드포인트로 만든다.
   */
  async updatePurchaseOrderStatus(
    poId: string,
    updateDto: UpdatePurchaseOrderStatusDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      // 락 순서 불변식(PO 행 → 라인 행)을 지킨다. 여기서 라인을 잠그지는 않지만,
      // 상태 읽기와 쓰기 사이에 다른 트랜잭션이 라인을 종결시키는 것을 막는다.
      const [existingPO] = await trx
        .select({ status: wmsTables.purchaseOrders.status })
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1)
        .for('update');

      if (!existingPO) {
        throw new NotFoundError(`Purchase order not found: ${poId}`);
      }

      assertReceivedTransition(existingPO.status);

      await trx
        .update(wmsTables.purchaseOrders)
        .set({ status: 'received', updatedAt: new Date() })
        .where(eq(wmsTables.purchaseOrders.id, poId));

      this.logger.log(`Purchase order ${poId} marked received by ${userId}`);

      return this.getPurchaseOrderById(poId, trx);
    }, tx);
  }
```

import 에 `assertReceivedTransition` 을 더한다:

```typescript
import { assertReceivedTransition } from './purchase-order-status.rules';
```

- [ ] **Step 5: 컨트롤러 Swagger 를 계약에 맞춘다**

`purchase-order.controller.ts:217-235`:

- `@ApiOperation({ summary: '발주 종결 (입고 완료)' })`
- `@ApiResponse({ status: 409, description: '전 라인이 종결되지 않았거나 이미 종결된 발주입니다.' })` 추가
- `@User()` 주석에서 "confirmed 전이가 라인을 실행하므로" 를 "종결자를 로그에 남긴다" 로 고친다

- [ ] **Step 6: 통합 스펙 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: PASS (삭제 5 · 추가 3 반영 후 전부 초록)

- [ ] **Step 7: 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 둘 다 0

`purchase-order-single-plan.integration.spec.ts` 는 아직 빨갛다 — Task 4 가 고친다. 통합 스펙은 기본 `jest` 게이트에서 skip 되므로 이 Task 의 게이트는 초록이어야 한다.

- [ ] **Step 8: 커밋 (사용자 요청 시)**

```bash
git add apps/core/src/modules/inventory/inbound/dto/purchase-order.dto.ts \
        apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts \
        apps/core/src/modules/inventory/inbound/controllers/purchase-order.controller.ts \
        apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts
git commit -m "refactor(inventory): 발주 상태 API 를 종결 전용으로 (#724 항목 9)"
```

---

### Task 3: 헤더 도착예정일을 라인으로 내린다

생성 시점 입력을 라인에 심고, 응답은 라인 min 파생으로 바꾼다. **컬럼은 아직 지우지 않는다** — Task 5 가 지운다. 이 Task 가 끝나면 컬럼은 write-dead 가 된다.

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts` (생성 2경로 · 응답 조립 2곳)
- Test: `apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts`

**Interfaces:**
- Consumes: `earliestExpectedDate` (Task 1)
- Produces: `PurchaseOrderResponse.expectedArrival` 은 라인 min 파생. 타입 `Date | null` 그대로

- [ ] **Step 1: 실패 테스트를 쓴다**

`purchase-order-line-execution.integration.spec.ts` 에 추가한다. `'라인별 날짜가 없어도 헤더 날짜가 계획에 실린다'`(:509)와 `'오프셋이 붙은 확정 날짜도 달력 하루가 밀리지 않는다'`(:548)는 확정 경로가 사라졌으므로 **아래 두 테스트가 대체한다** — 옛 것은 지운다.

```typescript
  it('발주서 생성의 도착예정일이 모든 라인에 심긴다', async () => {
    await inRollback(async (trx) => {
      // seedPrerequisites 의 공급사는 이 창고를 기본 창고로 갖는다 = 국내 발주(출발＝목적지).
      const { warehouseId, supplierId, skuIds } = await seedPrerequisites(trx);
      const service = buildService(trx);

      const created = await service.createPurchaseOrder(
        {
          type: PurchaseOrderType.DOMESTIC,
          supplierId,
          destinationWarehouseId: warehouseId,
          expectedArrival: '2026-11-03',
          lines: skuIds.map((skuId) => ({ skuId, quantity: 10 })),
        },
        trx,
      );

      expect(created.lines).toHaveLength(3);
      created.lines.forEach((line) => expect(line.expectedArrival).toBe('2026-11-03'));
      // 헤더 값은 이제 라인에서 파생된다.
      expect(created.expectedArrival?.toISOString()).toBe('2026-11-03T00:00:00.000Z');
    });
  });

  it('헤더 도착예정일은 라인 중 가장 이른 날짜다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);

      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10, expectedArrival: '2026-12-01' }, ACTOR, trx);
      await service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 10, expectedArrival: '2026-09-15' }, ACTOR, trx);
      const result = await service.orderLine(
        fx.poId,
        fx.skuIds[2],
        { orderedQty: 10, expectedArrival: '2026-10-20' },
        ACTOR,
        trx,
      );

      expect(result.expectedArrival?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: 두 테스트 FAIL — 생성이 라인에 ETA 를 안 심고, 헤더는 컬럼값(NULL)을 그대로 낸다

- [ ] **Step 3: 생성 2경로를 팬아웃으로 바꾼다**

`createPurchaseOrder` (`:38-70`) 의 헤더 insert 에서 `expectedArrival` 줄을 지우고, 라인 insert 에 심는다:

```typescript
      // 헤더 insert — expectedArrival 을 더 이상 쓰지 않는다.
      const [purchaseOrder] = await trx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: createDto.type,
          supplierId: createDto.supplierId,
          status: 'created',
          sourceWarehouseId: sourceWarehouseId,
          destinationWarehouseId: destinationWarehouseId,
          requiresTransfer: requiresTransfer,
        })
        .returning();

      // 생성 시점의 도착예정일은 "모든 라인의 기본 ETA" 다. 라인을 실제로 발주할 때
      // 다른 날짜를 주면 그 라인만 갱신된다(executeLineOrder 의 `dto.expectedArrival ?? line.expectedArrival`).
      // createDto.expectedArrival 은 IsCalendarDateConstraint 를 통과한 'YYYY-MM-DD' 라
      // date 컬럼에 그대로 넣는다 — new Date() 왕복은 UTC 로 하루를 민다.
      const purchaseOrderLines = await trx
        .insert(wmsTables.purchaseOrderLines)
        .values(
          createDto.lines.map((line) => ({
            poId: purchaseOrder.id,
            skuId: line.skuId,
            quantity: line.quantity,
            unitPrice: line.unitPrice || null,
            expectedArrival: createDto.expectedArrival ?? null,
          })),
        )
```

`createPurchaseOrderFromCart` (`:115-135`) 도 같은 모양으로 바꾼다 — 헤더 `expectedArrival` 줄 삭제, 라인 values 에 `expectedArrival: createDto.expectedArrival ?? null` 추가.

- [ ] **Step 4: 응답 조립 2곳을 파생으로 바꾼다**

`getPurchaseOrderById` (`:616-621`) 와 `getPurchaseOrders` (`:715-720`) 의 `expectedArrival: po.expectedArrival` 을 각각 바꾼다. 두 곳 모두 `lines` 를 이미 손에 쥐고 있다:

```typescript
        expectedArrival: earliestExpectedDate(lines.map((line) => line.expectedArrival)),
```

import 를 더한다:

```typescript
import { earliestExpectedDate } from './earliest-expected-date';
```

- [ ] **Step 5: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: PASS

- [ ] **Step 6: 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 둘 다 0

- [ ] **Step 7: 커밋 (사용자 요청 시)**

```bash
git add apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts \
        apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts
git commit -m "refactor(inventory): 발주 헤더 도착예정일을 라인 파생으로 (#724 항목 9)"
```

---

### Task 4: 계획 예정일의 소유권을 아이템으로 옮긴다

`inbound_plans.expected_date` 를 쓰는 곳을 없애고, 읽는 곳 3개를 아이템 기준으로 바꾼다. 응답 필드 이름·타입은 유지한다 — Tauri 앱과 admin-web 이 그대로 읽어야 한다.

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/dto/simple-inbound.dto.ts:149-153`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (`createInboundPlan` · `ensurePlanForPurchaseOrder` · `getInboundPending` · `listInboundPlanItems`)
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts:357` (호출부)
- Modify: `apps/core/src/modules/inventory/stock-projection/services/inbound-pipeline.reader.ts:80`
- Test: `apps/core/src/modules/inventory/inbound/services/purchase-order-single-plan.integration.spec.ts`

**Interfaces:**
- Produces: `ensurePlanForPurchaseOrder(poId: string, tx?: DbTx): Promise<{ id: string }>` — **두 번째 인자가 사라진다**
- Produces: `getInboundPending` 의 `expectedDate` 는 `MIN(pending 아이템 expectedDate)`, 타입 `Date | null` 유지
- Produces: `listInboundPlanItems` 의 `expectedDate` 는 아이템의 `'YYYY-MM-DD'` 문자열

- [ ] **Step 1: single-plan 스펙을 라인 실행 기준으로 고친다**

`purchase-order-single-plan.integration.spec.ts` 의 헬퍼를 교체한다 (`:134-142`):

```typescript
  /** 전 라인 실행 — 입고 계획 생성 경로(`InboundService.ensurePlanForPurchaseOrder` 포트)를 지나는 유일한 진입점. */
  async function orderAllLines(trx: DbTx, poId: string): Promise<void> {
    const service = buildPurchaseOrderService(trx);
    const lines = await trx
      .select({ skuId: wmsTables.purchaseOrderLines.skuId, quantity: wmsTables.purchaseOrderLines.quantity })
      .from(wmsTables.purchaseOrderLines)
      .where(eq(wmsTables.purchaseOrderLines.poId, poId));
    for (const line of lines) {
      await service.orderLine(poId, line.skuId, { orderedQty: line.quantity }, ACTOR, trx);
    }
  }
```

`confirmPurchaseOrder(trx, poId)` 호출부를 `orderAllLines(trx, poId)` 로 바꾼다 (`:144`, `:165` 테스트 본문).

`'같은 발주를 두 번 확정해도 계획 아이템은 중복되지 않는다 (재시도/더블클릭)'`(:187) 은 두 번째 확정을 **라인 재실행 409** 로 바꿔 같은 성질을 지킨다:

```typescript
  it('같은 라인을 두 번 실행해도 계획 아이템은 중복되지 않는다 (재시도/더블클릭)', async () => {
    await inRollback(async (trx) => {
      const { poId, skuId, quantity } = await seedCrossWarehousePurchaseOrder(trx);
      const service = buildPurchaseOrderService(trx);

      await service.orderLine(poId, skuId, { orderedQty: quantity }, ACTOR, trx);
      // 재확인 — 같은 요청이 한 번 더 들어온다. 단방향 종결이라 거부된다.
      await expect(service.orderLine(poId, skuId, { orderedQty: quantity }, ACTOR, trx)).rejects.toThrow();

      const items = await trx
        .select({ expectedQty: wmsTables.inboundPlanItems.expectedQty })
        .from(wmsTables.inboundPlanItems)
        .innerJoin(wmsTables.inboundPlans, eq(wmsTables.inboundPlanItems.planId, wmsTables.inboundPlans.id))
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId));

      expect(items).toHaveLength(1);
      expect(items.reduce((sum, i) => sum + i.expectedQty, 0)).toBe(quantity);
    });
  });
```

`'확정 요청에 새 expectedArrival 이 실리면 계획 예정일이 그 값을 따른다'`(:208) 은 **삭제한다** — 확정 요청도 계획 예정일 컬럼도 사라진다. 대체 성질(아이템이 예정일을 갖는다)은 line-execution 스펙 `'라인 실행이 요청과 다른 수량·단가·ETA 를 기록한다'`(:326)가 이미 지킨다.

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-single-plan`
Expected: 컴파일 통과, `orderAllLines` 로 바꾼 테스트들은 PASS (아직 코드 변경 전이므로 계획 seed 경로만 살아있다)

- [ ] **Step 3: 계획 생성에서 예정일을 뗀다**

`simple-inbound.dto.ts` 의 `CreateInboundPlanDto` 에서 `expectedDate` 필드와 그 `@IsOptional()` / `@IsDateString()` / `@ApiPropertyOptional` 을 지운다. `IsDateString` 이 이 파일에서 더 안 쓰이면 import 도 지운다.

`inbound.service.ts` 의 `createInboundPlan` insert (`:695`) 에서 `expectedDate` 줄을 지운다:

```typescript
      const [plan] = await trx
        .insert(wmsTables.inboundPlans)
        .values({
          warehouseId,
          destinationWarehouseId: po.destinationWarehouseId,
          linkedPurchaseOrderId: dto.linkedPurchaseOrderId,
          planType: requiresTransfer ? 'source' : 'destination',
          requiresTransfer,
```

`ensurePlanForPurchaseOrder` (`:717-775`) 에서 두 번째 파라미터와 seed 로직을 지운다:

```typescript
  /**
   * 발주에 붙은 입고 계획을 확보한다. 없으면 만들고, 있으면 그대로 쓴다.
   *
   * 라인을 하나씩 발주 실행하므로 매 실행마다 불린다 — **멱등해야 한다.**
   * 예정일은 넘기지 않는다: 계획은 날짜를 갖지 않고, 진실은 아이템이 소유한다.
   */
  async ensurePlanForPurchaseOrder(poId: string, tx?: DbTx): Promise<{ id: string }> {
```

본문에서 `expectedArrival` 를 select 하던 것과 `seedExpectedDate` 계산을 지우고, 생성 호출을 줄인다:

```typescript
      const [po] = await trx
        .select({ id: wmsTables.purchaseOrders.id })
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1)
        .for('update');
      ...
      const plan = await this.createInboundPlan({ linkedPurchaseOrderId: poId }, trx);
      return { id: plan.id };
```

`purchase-order.service.ts:357` 의 호출부에서 인자를 뺀다:

```typescript
    const plan = await this.inboundService.ensurePlanForPurchaseOrder(poId, tx);
```

- [ ] **Step 4: `getInboundPending` 을 아이템 파생으로 바꾼다**

`inbound.service.ts:336` 의 plan select 에서 `expectedDate: inboundPlans.expectedDate` 를 지운다.

`:383-395` 의 items select 에 아이템 예정일을 더한다:

```typescript
          expectedQty: inboundPlanItems.expectedQty,
          receivedQty: inboundPlanItems.receivedQty,
          expectedDate: inboundPlanItems.expectedDate,
```

`:415-424` 의 조합부에서 계획 값 대신 파생을 쓴다:

```typescript
      const inboundPending = plansData.map((plan) => {
        const planItems = itemsData.filter((item) => item.planId === plan.planId);
        const parentPlan = plan.parentPlanId ? parentPlansMap.get(plan.parentPlanId) : null;

        return {
          planId: plan.planId,
          planType: plan.planType,
          warehouseId: plan.warehouseId,
          // 계획은 날짜를 갖지 않는다. 아직 안 들어온 아이템 중 가장 이른 예정일이
          // 그 계획의 예정일이다. 응답 타입(Date | null)은 그대로 — Tauri 앱과
          // admin-web 입고 대기 목록이 이 필드를 읽는다.
          expectedDate: earliestExpectedDate(planItems.map((item) => item.expectedDate)),
```

import 를 더한다:

```typescript
import { earliestExpectedDate } from './earliest-expected-date';
```

- [ ] **Step 5: `listInboundPlanItems` 를 아이템 기준으로 바꾼다**

`inbound.service.ts:780-807` 을 통째로 교체한다:

```typescript
  // 입고예정 아이템 조회(헤더 무시, 아이템 테이블 직접 조회)
  async listInboundPlanItems(query: ListPlanItemsQueryDto, tx?: DbTx) {
    const { startDate, endDate, warehouseId, skuId } = query;
    const rows = await this.db
      .select({
        planItemId: wmsTables.inboundPlanItems.id,
        planId: wmsTables.inboundPlanItems.planId,
        // 예정일은 아이템이 소유한다. 예전엔 이 자리가 계획 헤더의 값을 냈는데,
        // 계획 날짜는 첫 생성에서 고정되고 갱신되지 않아 아이템과 갈라졌다 —
        // "헤더 무시, 아이템 기준" 이라는 이 API 의 요약과도 어긋났다.
        expectedDate: wmsTables.inboundPlanItems.expectedDate,
        warehouseId: wmsTables.inboundPlans.warehouseId,
        skuId: wmsTables.inboundPlanItems.skuId,
        expectedQty: wmsTables.inboundPlanItems.expectedQty,
        receivedQty: wmsTables.inboundPlanItems.receivedQty,
        status: wmsTables.inboundPlanItems.status,
      })
      .from(wmsTables.inboundPlanItems)
      .leftJoin(wmsTables.inboundPlans, eq(wmsTables.inboundPlans.id, wmsTables.inboundPlanItems.planId))
      .where(
        and(
          warehouseId ? eq(wmsTables.inboundPlans.warehouseId, warehouseId) : undefined,
          skuId ? eq(wmsTables.inboundPlanItems.skuId, skuId) : undefined,
          // date 컬럼끼리는 'YYYY-MM-DD' 문자열 비교로 끝난다. 예전 코드의
          // `new Date(startDate)` / `setHours(23,59,59,999)` 는 러너 TZ 에 따라
          // 경계 하루가 들쭉날쭉했다(#724 발견 ⑪ 과 같은 계열).
          startDate ? gte(wmsTables.inboundPlanItems.expectedDate, startDate) : undefined,
          endDate ? lte(wmsTables.inboundPlanItems.expectedDate, endDate) : undefined,
        ),
      )
      .orderBy(desc(wmsTables.inboundPlanItems.expectedDate));
    return { total: rows.length, items: rows };
  }
```

- [ ] **Step 6: 파이프라인 리더의 COALESCE 를 지운다**

`inbound-pipeline.reader.ts:80`:

```typescript
        eta: sql<string | null>`MIN(${items.expectedDate})`,
```

이 리더가 `plans` 를 다른 목적(창고·상태 조인)으로도 쓰는지 확인하고, `expectedDate` 참조만 사라졌는지 본다.

- [ ] **Step 7: 통합 스펙 전체를 돌린다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "purchase-order|inbound"`
Expected: PASS

- [ ] **Step 8: 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 둘 다 0

- [ ] **Step 9: 커밋 (사용자 요청 시)**

```bash
git add apps/core/src/modules/inventory/inbound apps/core/src/modules/inventory/stock-projection
git commit -m "refactor(inventory): 입고 계획 예정일을 아이템 소유로 (#724 항목 9)"
```

---

### Task 5: 스키마에서 두 컬럼을 지우고 마이그레이션을 만든다

여기까지 오면 두 컬럼은 write-dead 이고 읽는 코드도 없다. **백필 → 인덱스 → DROP** 순서를 지킨다.

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:1869` (헤더 컬럼) · `:2045` (계획 컬럼) · `:2070-2071` (인덱스) · `:2097-2098` (아이템 인덱스)
- Create: `apps/core/drizzle/<timestamp>_purchase-order-contract-phase.sql`

**Interfaces:**
- Produces: `purchase_orders` 와 `inbound_plans` 에서 예정일 컬럼이 사라진 스키마

- [ ] **Step 1: 스키마를 고친다**

`purchaseOrders` 에서 지운다:

```typescript
  expectedArrival: timestamp('expected_arrival', { mode: 'date' }),
```

`inboundPlans` 에서 지운다:

```typescript
    expectedDate: timestamp('expected_date', { mode: 'date' }),
```

`inboundPlans` 인덱스 2개를 교체한다 — `idx_inbound_plans_wh_date` 는 창고 접두를 `idx_inbound_plans_warehouse_type_status` 가 이미 덮으므로 **삭제**하고, destination 쪽은 단일 컬럼으로 남긴다:

```typescript
  (t) => [
    index('idx_inbound_plans_destination').on(t.destinationWarehouseId),
    index('idx_inbound_plans_warehouse_type_status').on(t.warehouseId, t.planType, t.status),
```

`inboundPlanItems` 에 기간 필터용 인덱스를 더한다:

```typescript
  (t) => ({
    idxInboundPlanItemsPlan: index('idx_inbound_plan_items_plan').on(t.planId),
    idxInboundPlanItemsSku: index('idx_inbound_plan_items_sku').on(t.skuId),
    idxInboundPlanItemsExpectedDate: index('idx_inbound_plan_items_expected_date').on(t.expectedDate),
  }),
```

- [ ] **Step 2: 마이그레이션을 생성한다**

Run: `npm run db:generate:core -- --name purchase-order-contract-phase`
Expected: `apps/core/drizzle/<timestamp>_purchase-order-contract-phase.sql` 생성. **rename 프롬프트가 뜨면 전부 "지우고 새로 만들기" 를 고른다** — 이 작업에 rename 은 없다

- [ ] **Step 3: 백필을 파일 맨 앞에 덧붙인다**

생성된 SQL 파일을 열어 **모든 DROP 보다 앞에** 두 문장을 넣는다 (2단계 파일 `20260825010019_add-purchase-order-line-lifecycle.sql` 과 같은 관행):

```sql
-- 계획 날짜를 아이템으로 내린다. 아이템이 예정일을 안 가진 행(2단계 이전에 만들어진
-- 계획, 수동 생성 계획)이 컬럼과 함께 날짜를 통째로 잃지 않게 한다.
UPDATE "inbound_plan_items" i SET "expected_date" = p."expected_date"::date
  FROM "inbound_plans" p
 WHERE p."id" = i."plan_id" AND i."expected_date" IS NULL AND p."expected_date" IS NOT NULL;--> statement-breakpoint
-- 헤더 ETA 를 라인으로 내린다. 2단계 백필과 같은 문장이고 멱등하다 — 그 이후
-- 생성된 발주(헤더에만 날짜가 있는 행)를 받아낸다.
UPDATE "purchase_order_lines" l SET "expected_arrival" = p."expected_arrival"::date
  FROM "purchase_orders" p
 WHERE p."id" = l."po_id" AND l."expected_arrival" IS NULL AND p."expected_arrival" IS NOT NULL;--> statement-breakpoint
```

그 뒤로 drizzle 이 생성한 인덱스 DROP/CREATE 와 `DROP COLUMN` 2개가 오는지 확인한다. 순서가 뒤섞여 있으면 **백필이 맨 앞**이 되도록 손으로 옮긴다 (아직 적용 전 파일이라 편집해도 된다).

- [ ] **Step 4: 로컬 DB 에 적용하고 통합 스펙을 돌린다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "purchase-order|inbound"`
Expected: 러너가 `drizzle-kit migrate` 로 새 마이그레이션을 적용한 뒤 전부 PASS

- [ ] **Step 5: 컬럼이 정말 사라졌는지 확인한다**

```bash
docker compose exec -T postgres psql -U postgres -d core -c \
  "SELECT table_name, column_name FROM information_schema.columns
    WHERE (table_name='purchase_orders' AND column_name='expected_arrival')
       OR (table_name='inbound_plans' AND column_name='expected_date');"
```

Expected: 0 행

- [ ] **Step 6: 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 둘 다 0

- [ ] **Step 7: 커밋 (사용자 요청 시)**

스키마와 마이그레이션은 **한 커밋에** 넣는다 — 쪼개면 다른 사람 체크아웃이 어긋난다.

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle
git commit -m "feat(inventory)!: 발주 헤더·계획 예정일 컬럼 제거 (#724 항목 9)"
```

---

### Task 6: 전체 게이트와 문서 갱신

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-purchase-order-contract-phase-design.md` (구현 중 달라진 것이 있으면)
- Modify: GitHub 이슈 #724 현황판

- [ ] **Step 1: 세 게이트를 전부 돌린다**

```bash
npm run type-check
npx jest --maxWorkers=2
cd apps/admin-web && npx tsc --noEmit; cd -
```

Expected: 셋 다 0. admin-web 은 이 작업에서 코드 변경이 없지만, 응답 계약을 건드렸으므로 타입이 정말 안 깨졌는지 이 게이트로 증명한다.

- [ ] **Step 2: 통합 스펙 전체를 돌린다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local`
Expected: 이 작업이 만든 실패 0. `docs` 의 "develop 부터 RED" 목록에 있던 것은 그대로 빨갈 수 있다 — **새 실패와 구분해서 보고한다**

- [ ] **Step 3: admin-web 실동작을 눈으로 한 번 본다**

`npm run start:main:dev` 와 `npm run start:admin-web:dev` 를 띄우고 발주 목록에서 확인한다:

1. 발주서를 도착예정일과 함께 생성 → 목록 「도착예정일」 컬럼에 그 날짜가 보인다
2. 드로어에서 라인 하나를 다른 날짜로 실행 → 헤더 날짜가 둘 중 이른 쪽으로 바뀐다
3. 입고 대기 목록에 그 계획이 뜨고 예정일이 채워져 있다

- [ ] **Step 4: 이슈 #724 를 갱신한다**

현황판에서:
- 항목 9 를 🟩 로, 커밋/PR 번호 기입
- "합의한 3단계" 표의 3단계 행을 🟩 로
- "다음 작업 → 2. 코드 — 권장 순서" 에서 `9의 3단계` 줄을 취소선 처리하고 다음 순번(항목 6 재주문 제안)을 `← 지금 여기` 로
- 의존 관계 절에 **항목 7 이 `received` 자동 전이를 이어받는다**고 적는다
- 회수된 능력(일괄 확정)을 사용자 승인과 함께 남긴다

- [ ] **Step 5: 커밋 (사용자 요청 시)**

```bash
git add docs/superpowers
git commit -m "docs: 발주 계약 정리 스펙·계획 (#724 항목 9)"
```

## 배포 (사람 몫)

이 PR 은 **contract phase** 라 `deploy → migrate` 순서다. expand 와 반대다:

1. `sst deploy` — 새 코드가 뜬다. 두 컬럼을 아무도 읽지 않는다
2. `npm run db:migrate -- --stage live --deployment lcnine-services --yes` — 백필과 DROP

순서를 뒤집으면 옛 태스크가 `DROP COLUMN` 을 만나 죽는다.
