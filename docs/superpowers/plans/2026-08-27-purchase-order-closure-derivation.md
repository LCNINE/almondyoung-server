# 발주 종결 파생 구현 계획 (#724 항목 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `inbound_plan_items → inbound_plans → purchase_orders` 단방향 종결 파생을 살리고, 미달 입고를 닫는 잎 종결과 발주 취소를 사람이 쓸 수 있게 만든다.

**Architecture:** 파생 사슬 3층 중 비어 있던 2층(`inbound_plans.status`)을 채우고, 3층은 **포트 역전**으로 잇는다 — 입고가 `PurchaseOrderClosurePort` 를 통해 "계획이 닫혔다" 는 사실만 통보하고, 종결 여부는 조달이 판단한다. 호출은 `inbound → procurement` 로 흐르지만 모듈 의존은 `procurement → inbound` 한 방향을 유지한다. 사람의 쓰기는 잎(아이템)과 발주 헤더 취소 두 곳뿐이고, 파생 규칙은 하나·단방향으로 남는다.

**Tech Stack:** NestJS 11 · Drizzle ORM(postgres.js) · PostgreSQL · Jest · Next.js(admin-web) · TanStack Query

**Spec:** [`docs/superpowers/specs/2026-08-27-purchase-order-closure-derivation-design.md`](../specs/2026-08-27-purchase-order-closure-derivation-design.md)

## Global Constraints

- **계층 규약**: Controller → Service(위임만) → Manager/Reader → DB. 컨트롤러는 서비스 호출을 `try/catch` 로 감싸지 않는다.
- **도메인 예외만**: `@app/shared` 의 `NotFoundError`(404) · `BadRequestError`(400) · `ConflictError`(409). 신설 코드에 `@nestjs/common` 의 `HttpException` 계열을 쓰지 않는다. `inbound.service.ts` 에 남아 있는 기존 `NotFoundException` 줄은 **건드리지 않는다**.
- **트랜잭션**: `this.dbService.run(async (trx) => { … }, tx)`. public 메서드는 `tx?: DbTx` 를 마지막 인자로, private 헬퍼는 `tx: DbTx` 를 첫 인자로 받는다. per-class `inTx` 헬퍼를 만들지 않는다.
- **쿼리**: `trx.select().from().innerJoin().where()` 만. `db.query.*` 신규 사용 금지(기존 줄은 유지), `any`/`as` 캐스팅 금지.
- **DB 주입**: `@InjectTypedDb<typeof wmsSchema>()`. 스키마·테이블·`DbTx` 는 `apps/core/src/modules/inventory/schema/inventory.schema.ts` 에서 `wmsTables, wmsSchema, DbTx` 로 가져온다.
- **drizzle enum 은 문자열 유니온**이다. TS enum 멤버가 아니라 리터럴로 비교한다(`no-unsafe-enum-comparison`).
- 🔴 **잠금 순서 불변식: PO 행 → 라인 행.** 발주 쓰기를 추가하는 편집은 PO 행을 먼저 `.for('update')` 로 잡는다. 어기면 ABBA 교착이 `40P01` → **500** 으로 나간다.
- **마이그레이션 순서**: 이 작업은 additive 만 있으므로 **expand phase** 이고 배포 순서는 **`migrate → deploy`** 다.
- **게이트 4종, 전부 0 이 기준선**: `npm run type-check` · `cd apps/admin-web && npx tsc --noEmit` · `npx jest --maxWorkers=2` · `npm run test:core:integration:local`.
  - 루트 `type-check` 는 **admin-web 을 제외한다** — 두 번째 명령이 별도로 필요하다.
  - `npx jest` 는 워커를 제한하지 않으면 OOM 이 난다. 항상 `--maxWorkers=2`.
  - 통합 스펙의 **8 suite / 12 test 는 develop 부터 RED 인 기준선**이다. 새 실패로 오인하지 않는다.
  - 워크트리에서 통합을 돌릴 때는 `COMPOSE_PROJECT_NAME=almondyoung-server` 를 붙인다(없으면 5432 충돌로 죽는다).

---

## File Structure

**Core — 신규**

| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/inventory/shared/ports/purchase-order-closure.port.ts` | 토큰 + 인터페이스. 입고가 아는 조달의 전부 |
| `apps/core/src/modules/inventory/inbound/services/inbound-plan-closure.rules.ts` | 계획 종결 술어(순수) |
| `apps/core/src/modules/inventory/inbound/services/inbound-plan-closure.rules.spec.ts` | 위 유닛 |
| `apps/core/src/modules/inventory/inbound/dto/close-plan-item.dto.ts` | 잎 종결 요청 DTO |
| `apps/core/src/modules/inventory/procurement/services/purchase-order-closure.rules.ts` | 발주 종결 술어(순수) |
| `apps/core/src/modules/inventory/procurement/services/purchase-order-closure.rules.spec.ts` | 위 유닛 |
| `apps/core/src/modules/inventory/procurement/services/purchase-order-closure.adapter.ts` | 포트 구현. 3층 파생 소유 |
| `apps/core/src/modules/inventory/procurement/dto/purchase-order/cancel-purchase-order.dto.ts` | 취소 요청 DTO |
| `apps/core/src/modules/inventory/procurement/services/purchase-order-closure.integration.spec.ts` | 완주·잎 종결·취소 통합 |

**Core — 수정**

| 파일 | 변경 |
|---|---|
| `…/inventory/schema/inventory.schema.ts` | enum 값 2개, 컬럼 6개 |
| `…/inventory/inbound/inbound.module.ts` | 포트 배선 |
| `…/inventory/inbound/services/inbound.service.ts` | 2층 파생, 포트 호출, 잎 종결 |
| `…/inventory/inbound/controllers/inbound.controllers.ts` | 잎 종결 라우트 |
| `…/inventory/procurement/services/purchase-order.manager.ts` | 종결 가드 확장, 취소, 수동 종결 제거 |
| `…/inventory/procurement/services/purchase-order.service.ts` | 취소 위임, 수동 종결 제거 |
| `…/inventory/procurement/controllers/purchase-order.controller.ts` | 취소 라우트, 수동 종결 라우트 제거 |
| `…/inventory/procurement/dto/purchase-order.dto.ts` | `UpdatePurchaseOrderStatusDto` 제거, `CANCELLED` 추가 |
| `…/inventory/inventory-write-boundary.arch.spec.ts` | `purchaseOrders` 쓰기 경계 |
| `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` | 라우트 표 갱신 |

**Core — 삭제**: `…/procurement/services/purchase-order-status.rules.ts` + `.spec.ts`

**admin-web — 수정**: `lib/types/dto/inventory.ts` · `lib/api/domains/inventory/purchase-orders.client.ts` · `…/inbound.client.ts` · `lib/services/inventory/mutations.ts` · `features/inventory/purchase-orders/components/purchase-order-detail-drawer/index.tsx` · `features/inventory/inbound/components/pending-tab/plan-detail-drawer/index.tsx`

---

## Task 1: 스키마와 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:100`(po enum), `:112`(inbound enum), `:2081`(inboundPlanItems), purchaseOrders 정의부
- Create: `apps/core/drizzle/<timestamp>_add_purchase_order_closure_states.sql` (생성 후 백필 손으로 추가)

**Interfaces:**
- Produces: `inbound_status` 에 `'short_closed'`, `po_status` 에 `'cancelled'`. `inboundPlanItems.closedReason/closedAt/closedBy`, `purchaseOrders.cancelledReason/cancelledAt/cancelledBy`.

- [ ] **Step 1: enum 값 2개 추가**

`inventory.schema.ts` 의 두 enum 을 이렇게 만든다. 주석을 함께 넣는다 — `applied`/`receiving` 가 왜 그대로 있는지가 다음 사람의 첫 질문이다.

```ts
export const poStatusEnum = pgEnum('po_status', ['created', 'confirmed', 'received', 'cancelled']);

export const inboundStatusEnum = pgEnum('inbound_status', [
  'pending', // 입고 대기 - Initial state
  'applied', // 입고신청 - Applied for inbound  ⚠️ 코드 참조 0건. 되살리지 않는다(#724 항목 7)
  'receiving', // 입고 중 - Currently receiving  ⚠️ 코드 참조 0건. 되살리지 않는다(#724 항목 7)
  'confirmed', // 입고 완료 - Completed
  'short_closed', // 잔량 포기 — 사람이 "이만 기다린다" 고 결정한 종결. 아이템 전용.
]);
```

- [ ] **Step 2: 컬럼 6개 추가**

`inboundPlanItems` 의 `expectedDate` 아래에 넣는다:

```ts
    /** 잔량 포기 기록. status='short_closed' 인 행에서만 채워진다. */
    closedReason: text('closed_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
```

`purchaseOrders` 의 `updatedAt` 위에 넣는다:

```ts
    /** 발주 취소 기록. status='cancelled' 인 행에서만 채워진다. */
    cancelledReason: text('cancelled_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by'),
```

`text` 가 그 파일의 drizzle import 목록에 없으면 추가한다.

- [ ] **Step 3: 마이그레이션 생성**

```bash
npm run db:generate:core -- --name add-purchase-order-closure-states
```

- [ ] **Step 4: 생성된 SQL 검토**

`apps/core/drizzle/<timestamp>_add_purchase_order_closure_states.sql` 을 연다. `ALTER TYPE … ADD VALUE` 2줄과 `ALTER TABLE … ADD COLUMN` 6줄만 있어야 한다. **rename 프롬프트가 떴다면 잘못 답한 것이다** — `git rm` 하고 스키마를 고쳐 다시 생성한다.

- [ ] **Step 5: 백필 2문을 파일 끝에 손으로 추가**

```sql
--> statement-breakpoint
-- 이미 전량 입고된 계획을 닫는다. 아이템이 0개인 계획은 제외한다 —
-- 계획 생성과 첫 아이템 추가 사이의 과도 상태를 종결로 오해하면 안 된다.
UPDATE "inbound_plans" p
SET "status" = 'confirmed'
WHERE p."status" = 'pending'
  AND EXISTS (SELECT 1 FROM "inbound_plan_items" i WHERE i."plan_id" = p."id")
  AND NOT EXISTS (
    SELECT 1 FROM "inbound_plan_items" i
    WHERE i."plan_id" = p."id" AND i."status" = 'pending'
  );--> statement-breakpoint
-- 그 계획에 딸린 발주를 종결한다. requested 라인이 남았으면 아직 살 것이 남았다.
UPDATE "purchase_orders" po
SET "status" = 'received'
WHERE po."status" = 'confirmed'
  AND NOT EXISTS (
    SELECT 1 FROM "purchase_order_lines" l
    WHERE l."po_id" = po."id" AND l."status" = 'requested'
  )
  AND EXISTS (
    SELECT 1 FROM "inbound_plans" p
    WHERE p."linked_purchase_order_id" = po."id" AND p."status" = 'confirmed'
  );
```

> 🔴 **`short_closed` 나 `cancelled` 를 백필에 쓰지 말 것.** `ALTER TYPE … ADD VALUE` 로 방금 추가한 값은 **같은 트랜잭션에서 사용할 수 없다**(drizzle 은 마이그레이션 파일을 트랜잭션으로 감싼다). 위 두 문은 기존 값만 쓰므로 안전하다. 새 값을 쓰는 백필이 필요해지면 마이그레이션을 둘로 쪼개야 한다.

- [ ] **Step 6: dev 에 적용**

```bash
npm run db:setup -- --stage dev --deployment lcnine-services
```

인터랙티브다. 시드 그룹 선택 프롬프트에 응답한다.

- [ ] **Step 7: 적용 확인**

dev DB 에서 확인한다. 기대: 두 enum 에 새 값이 있고, 백필이 에러 없이 끝났다.

```sql
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname IN ('po_status','inbound_status') ORDER BY t.typname, e.enumsortorder;
```

- [ ] **Step 8: 타입 게이트**

```bash
npm run type-check
```
기대: 에러 0.

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle
git commit -m "feat(inventory): 발주 종결 파생용 enum 값 2개와 기록 컬럼 6개 (#724 항목 7)"
```

> 스키마·마이그레이션·`drizzle/meta` 를 **한 커밋에** 넣는다. 쪼개면 다른 사람 체크아웃이 어긋난다.

---

## Task 2: 파생 술어 (순수 함수, TDD)

**Files:**
- Create: `apps/core/src/modules/inventory/inbound/services/inbound-plan-closure.rules.ts`
- Create: `apps/core/src/modules/inventory/inbound/services/inbound-plan-closure.rules.spec.ts`
- Create: `apps/core/src/modules/inventory/procurement/services/purchase-order-closure.rules.ts`
- Create: `apps/core/src/modules/inventory/procurement/services/purchase-order-closure.rules.spec.ts`

**Interfaces:**
- Produces:
  - `isItemClosed(status: InboundItemStatus): boolean`
  - `isPlanClosed(itemStatuses: readonly InboundItemStatus[]): boolean`
  - `type InboundItemStatus = 'pending' | 'applied' | 'receiving' | 'confirmed' | 'short_closed'`
  - `isTerminal(status: PurchaseOrderHeaderStatus): boolean`
  - `canDeriveReceived(input: { current: PurchaseOrderHeaderStatus; hasRequestedLine: boolean }): boolean`
  - `type PurchaseOrderHeaderStatus = 'created' | 'confirmed' | 'received' | 'cancelled'`

> 기존 `purchase-order-status.rules.ts` 도 `PurchaseOrderHeaderStatus` 를 export 한다(값 3개). 두 파일이 잠시 공존하고, Task 7 이 옛 파일을 지운다. 다른 파일에서 두 개를 동시에 import 하지 않는다.

- [ ] **Step 1: 계획 술어 실패 테스트를 쓴다**

`inbound-plan-closure.rules.spec.ts`:

```ts
import { isItemClosed, isPlanClosed } from './inbound-plan-closure.rules';

describe('isItemClosed', () => {
  it('confirmed 와 short_closed 만 종결이다', () => {
    expect(isItemClosed('confirmed')).toBe(true);
    expect(isItemClosed('short_closed')).toBe(true);
    expect(isItemClosed('pending')).toBe(false);
  });

  // applied/receiving 는 코드 참조 0건인 죽은 값이다. 종결로 취급하면
  // 누군가 그 값을 되살리는 순간 안 받은 계획이 조용히 닫힌다.
  it('죽은 enum 값(applied/receiving)은 종결이 아니다', () => {
    expect(isItemClosed('applied')).toBe(false);
    expect(isItemClosed('receiving')).toBe(false);
  });
});

describe('isPlanClosed', () => {
  it('전 아이템이 종결이면 닫힌다', () => {
    expect(isPlanClosed(['confirmed', 'short_closed'])).toBe(true);
  });

  it('pending 아이템이 하나라도 있으면 안 닫힌다', () => {
    expect(isPlanClosed(['confirmed', 'pending'])).toBe(false);
  });

  // 계획 생성과 첫 아이템 추가 사이의 과도 상태. 여기서 닫으면
  // 라인 실행 도중의 빈 계획이 발주를 received 로 밀어버린다.
  it('아이템이 0개인 계획은 닫지 않는다', () => {
    expect(isPlanClosed([])).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --maxWorkers=2 inbound-plan-closure.rules
```
기대: FAIL — `Cannot find module './inbound-plan-closure.rules'`.

- [ ] **Step 3: 최소 구현**

`inbound-plan-closure.rules.ts`:

```ts
/** drizzle enum 컬럼은 문자열 유니온이다. TS enum 멤버로 비교하지 않는다. */
export type InboundItemStatus = 'pending' | 'applied' | 'receiving' | 'confirmed' | 'short_closed';

/**
 * 아이템이 더 이상 입고를 기다리지 않는가.
 *
 * `applied`/`receiving` 는 inventory 전체에서 코드 참조 0건인 죽은 값이라 종결로 치지
 * 않는다 — 누군가 되살리면 안 받은 계획이 조용히 닫힌다(#724 항목 7).
 */
export function isItemClosed(status: InboundItemStatus): boolean {
  return status === 'confirmed' || status === 'short_closed';
}

/**
 * 계획이 닫히는가. 아이템이 하나도 없으면 닫지 않는다 — 계획 생성과 첫 아이템 추가
 * 사이의 과도 상태를 종결로 오해하면 라인 실행 도중에 발주가 received 로 밀린다.
 */
export function isPlanClosed(itemStatuses: readonly InboundItemStatus[]): boolean {
  return itemStatuses.length > 0 && itemStatuses.every(isItemClosed);
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --maxWorkers=2 inbound-plan-closure.rules
```
기대: PASS (5 tests).

- [ ] **Step 5: 발주 술어 실패 테스트를 쓴다**

`purchase-order-closure.rules.spec.ts`:

```ts
import { canDeriveReceived, isTerminal } from './purchase-order-closure.rules';

describe('isTerminal', () => {
  it('received 와 cancelled 는 종결이다', () => {
    expect(isTerminal('received')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
  });

  it('created 와 confirmed 는 종결이 아니다', () => {
    expect(isTerminal('created')).toBe(false);
    expect(isTerminal('confirmed')).toBe(false);
  });
});

describe('canDeriveReceived', () => {
  it('전 라인이 실행됐고 아직 종결 전이면 received 로 간다', () => {
    expect(canDeriveReceived({ current: 'confirmed', hasRequestedLine: false })).toBe(true);
  });

  it('requested 라인이 남았으면 안 간다 — 아직 살 것이 남았다', () => {
    expect(canDeriveReceived({ current: 'created', hasRequestedLine: true })).toBe(false);
  });

  // 취소된 발주에 입고가 들어와도 되살아나면 안 된다.
  it('이미 종결된 발주는 건드리지 않는다', () => {
    expect(canDeriveReceived({ current: 'cancelled', hasRequestedLine: false })).toBe(false);
    expect(canDeriveReceived({ current: 'received', hasRequestedLine: false })).toBe(false);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

```bash
npx jest --maxWorkers=2 purchase-order-closure.rules
```
기대: FAIL — 모듈 없음.

- [ ] **Step 7: 최소 구현**

`purchase-order-closure.rules.ts`:

```ts
/** drizzle enum 컬럼은 문자열 유니온이다. TS enum 멤버로 비교하지 않는다. */
export type PurchaseOrderHeaderStatus = 'created' | 'confirmed' | 'received' | 'cancelled';

/**
 * 종결 상태는 되돌아오지 않는다. 파생(`refreshHeaderStatus`)도, 라인 실행도, 입고도
 * 이 둘을 만나면 손대지 않는다. `received` 는 입고 경로가, `cancelled` 는 사람이 소유한다.
 */
export function isTerminal(status: PurchaseOrderHeaderStatus): boolean {
  return status === 'received' || status === 'cancelled';
}

/**
 * 계획이 닫힌 시점에 발주를 종결할 수 있는가 (3층 파생).
 *
 * 전 라인이 종결(`ordered`/`unavailable`)됐어야 한다 — `requested` 가 남아 있으면
 * 아직 살 것이 남은 발주다. 이미 종결된 발주는 건드리지 않는다.
 */
export function canDeriveReceived(input: {
  current: PurchaseOrderHeaderStatus;
  hasRequestedLine: boolean;
}): boolean {
  if (isTerminal(input.current)) return false;
  return !input.hasRequestedLine;
}
```

- [ ] **Step 8: 통과를 확인한다**

```bash
npx jest --maxWorkers=2 purchase-order-closure.rules
```
기대: PASS (5 tests).

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/services/inbound-plan-closure.rules.ts \
        apps/core/src/modules/inventory/inbound/services/inbound-plan-closure.rules.spec.ts \
        apps/core/src/modules/inventory/procurement/services/purchase-order-closure.rules.ts \
        apps/core/src/modules/inventory/procurement/services/purchase-order-closure.rules.spec.ts
git commit -m "feat(inventory): 종결 파생 술어를 순수 함수로 (#724 항목 7)"
```

---

## Task 3: 포트 · 어댑터 · 배선 · 쓰기 경계

**Files:**
- Create: `apps/core/src/modules/inventory/shared/ports/purchase-order-closure.port.ts`
- Create: `apps/core/src/modules/inventory/procurement/services/purchase-order-closure.adapter.ts`
- Modify: `apps/core/src/modules/inventory/inbound/inbound.module.ts`
- Modify: `apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `canDeriveReceived`
- Produces: `PURCHASE_ORDER_CLOSURE` 토큰, `PurchaseOrderClosurePort.onPlanClosed(poId: string, tx: DbTx): Promise<void>`, `PurchaseOrderClosureAdapter`

- [ ] **Step 1: 포트를 만든다**

`shared/ports/purchase-order-closure.port.ts`:

```ts
import { DbTx } from '../../schema/inventory.schema';

/**
 * 입고 → 조달의 유일한 통로. 계약이 `shared/` 에 있는 이유는 어느 쪽도 상대의 내부를
 * 가리키지 않게 하기 위해서다 (ADR-0032 · #724 항목 7 스펙 §5).
 *
 * **호출 방향과 의존 방향은 다르다.** 호출은 inbound → procurement 로 흐르지만 모듈
 * 의존은 procurement → inbound 한 방향을 유지한다. 입고는 발주 상태값이 무엇인지,
 * 종결 조건이 무엇인지 모른다 — "계획이 닫혔다" 는 사실만 통보한다.
 *
 * 이 저장소에 포트/어댑터 선례가 없다. 직접 UPDATE 대신 이 모양을 고른 결정적 이유는
 * 잠금 취득 지점을 늘리지 않기 위해서다 — PO 행 → 라인 행 불변식을 어기면 ABBA 교착이
 * 40P01 → 500 으로 나간다.
 */
export const PURCHASE_ORDER_CLOSURE = Symbol('PurchaseOrderClosurePort');

export interface PurchaseOrderClosurePort {
  /** 이 발주에 붙은 입고 계획이 닫혔다. 발주를 종결할지는 조달이 판단한다. */
  onPlanClosed(poId: string, tx: DbTx): Promise<void>;
}
```

- [ ] **Step 2: 어댑터를 만든다**

`procurement/services/purchase-order-closure.adapter.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { wmsTables, DbTx } from '../../schema/inventory.schema';
import { PurchaseOrderClosurePort } from '../../shared/ports/purchase-order-closure.port';
import { canDeriveReceived } from './purchase-order-closure.rules';

/**
 * 3층 파생(`plan → PO`)의 소유자. 입고는 사실만 넘기고 판단은 여기서 한다.
 *
 * 🔴 잠금 순서 불변식: PO 행 → 라인 행. 이 메서드는 PO 를 먼저 잡고 라인을 읽는다.
 * 호출자(입고 트랜잭션)는 이 시점에 계획·아이템만 건드린 상태이며, 라인 실행 경로가
 * 기존 아이템 행을 잠그지 않으므로(`addInboundPlanItems` 는 insert 전용) 대기
 * 사이클이 닫히지 않는다. 스펙 §9 참조.
 *
 * DbService 를 주입받지 않는다 — 항상 호출자의 트랜잭션 안에서만 돈다.
 */
@Injectable()
export class PurchaseOrderClosureAdapter implements PurchaseOrderClosurePort {
  async onPlanClosed(poId: string, tx: DbTx): Promise<void> {
    const [header] = await tx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1)
      .for('update');
    if (!header) return;

    const [requested] = await tx
      .select({ skuId: wmsTables.purchaseOrderLines.skuId })
      .from(wmsTables.purchaseOrderLines)
      .where(
        and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.status, 'requested')),
      )
      .limit(1);

    if (!canDeriveReceived({ current: header.status, hasRequestedLine: !!requested })) return;

    await tx
      .update(wmsTables.purchaseOrders)
      .set({ status: 'received', updatedAt: new Date() })
      .where(eq(wmsTables.purchaseOrders.id, poId));
  }
}
```

- [ ] **Step 3: 배선한다**

`inbound.module.ts` 전문을 이렇게 만든다:

```ts
import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SkuCatalogModule } from '../sku-catalog/sku-catalog.module';
import { SharedModule } from '../shared/shared.module';
import { PURCHASE_ORDER_CLOSURE } from '../shared/ports/purchase-order-closure.port';
import { PurchaseOrderClosureAdapter } from '../procurement/services/purchase-order-closure.adapter';
import { InboundController } from './controllers/inbound.controllers';
import { InboundService } from './services/inbound.service';
import { InboundPutawayReader } from './services/inbound-putaway.reader';

@Module({
  imports: [CoreInventoryModule, SkuCatalogModule, SharedModule],
  controllers: [InboundController],
  providers: [
    InboundService,
    InboundPutawayReader,
    // 어댑터 파일은 procurement/ 에 살지만 등록은 여기서 한다 — ProcurementModule 을
    // import 하면 모듈 순환이 생긴다(procurement 가 이미 InboundModule 을 import 한다).
    // 클래스 파일 하나만 가리키므로 순환이 아니고 forwardRef 도 필요 없다.
    { provide: PURCHASE_ORDER_CLOSURE, useClass: PurchaseOrderClosureAdapter },
  ],
  exports: [InboundService],
})
export class InboundModule {}
```

- [ ] **Step 4: 쓰기 경계를 arch spec 에 넣는다**

`inventory-write-boundary.arch.spec.ts` 를 고친다. `ALLOW_FILES` 와 `FORBIDDEN` 이 원장 전용이었으므로, 규칙이 둘이 되도록 구조를 바꾼다:

```ts
const LEDGER_ALLOW_FILES = new Set(['stock-event.store.ts']); // 유일한 정상 원장 writer

const LEDGER_FORBIDDEN = [
  /\.insert\(\s*(wmsTables\.)?stockEvents\b/,
  /\.insert\(\s*(wmsTables\.)?stockLedgers\b/,
  /\.update\(\s*(wmsTables\.)?stockLedgers\b/,
];

// 발주 헤더는 조달이 소유한다(ADR-0032 결정 4 · #724 항목 7 스펙 §5). 입고가 직접 쓰면
// received 진입 규칙이 두 모듈로 갈라지고 잠금 취득 지점이 하나 늘어난다.
const PO_FORBIDDEN = [/\.(insert|update)\(\s*(wmsTables\.)?purchaseOrders\b/];
```

`collectTsFiles` 는 `ALLOW_FILES` 를 참조하던 자리를 `LEDGER_ALLOW_FILES` 로 바꾸는 대신 **필터를 걷어내고** 각 `it` 안에서 거른다(두 규칙의 허용 파일이 다르므로). 그리고 두 번째 테스트를 더한다:

```ts
  it('procurement/ 밖에서 purchaseOrders 직접 쓰기 금지', () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(INVENTORY_ROOT)) {
      if (file.includes(`${sep}procurement${sep}`)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (PO_FORBIDDEN.some((re) => re.test(line))) violations.push(`${file}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(violations).toEqual([]);
  });
```

`sep` 는 `import { join, sep } from 'path'` 로 가져온다. 첫 번째 테스트 안에서는
`if (LEDGER_ALLOW_FILES.has(basename(file))) continue;` 로 기존 예외를 유지한다
(`basename` 도 `path` 에서 가져온다).

- [ ] **Step 5: arch spec 이 통과하는지 확인한다**

```bash
npx jest --maxWorkers=2 inventory-write-boundary
```
기대: PASS (2 tests). 실패하면 위반 파일 목록이 나오는데, **그건 이 시점에 0이어야 한다** — 아직 아무도 입고에서 발주를 쓰지 않는다.

- [ ] **Step 6: DI 가 부팅되는지 확인한다**

```bash
npm run type-check && npx jest --maxWorkers=2 apps/core/src/modules/inventory
```
기대: 타입 0, inventory 스펙에 새 실패 0.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/shared/ports \
        apps/core/src/modules/inventory/procurement/services/purchase-order-closure.adapter.ts \
        apps/core/src/modules/inventory/inbound/inbound.module.ts \
        apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts
git commit -m "feat(inventory): 발주 종결 포트와 어댑터 — 입고→조달 통로 (#724 항목 7)"
```

---

## Task 4: 입고 경로에 2층 파생을 붙인다

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (constructor, `receiveFromPlan:875` 직후)
- Modify: `apps/core/src/modules/inventory/procurement/services/purchase-order.manager.ts:388`, `:338`

**Interfaces:**
- Consumes: Task 2 `isPlanClosed`, `isTerminal` · Task 3 `PURCHASE_ORDER_CLOSURE`, `PurchaseOrderClosurePort`
- Produces: `InboundService.closePlanIfDone(tx: DbTx, planId: string, linkedPurchaseOrderId: string): Promise<void>` (private)

- [ ] **Step 1: 포트를 주입한다**

`inbound.service.ts` 의 import 에 더한다:

```ts
import { Inject } from '@nestjs/common';
import { isPlanClosed } from './inbound-plan-closure.rules';
import {
  PURCHASE_ORDER_CLOSURE,
  PurchaseOrderClosurePort,
} from '../../shared/ports/purchase-order-closure.port';
```

constructor 파라미터 목록 끝에 더한다:

```ts
    @Inject(PURCHASE_ORDER_CLOSURE)
    private readonly poClosure: PurchaseOrderClosurePort,
```

- [ ] **Step 2: 파생 헬퍼를 더한다**

`receiveFromPlan` 아래에 private 헬퍼를 넣는다:

```ts
  /**
   * 계획의 아이템이 전부 종결됐으면 계획을 닫고, 조달에 통보한다 (2층 → 3층 파생).
   *
   * 입고와 잎 종결 **둘 다** 여기로 온다 — 파생 규칙이 한 곳에 있어야 두 경로가
   * 갈라지지 않는다. 발주를 종결할지는 조달이 판단한다(#724 항목 7 스펙 §5).
   */
  private async closePlanIfDone(tx: DbTx, planId: string, linkedPurchaseOrderId: string): Promise<void> {
    const items = await tx
      .select({ status: wmsTables.inboundPlanItems.status })
      .from(wmsTables.inboundPlanItems)
      .where(eq(wmsTables.inboundPlanItems.planId, planId));

    if (!isPlanClosed(items.map((i) => i.status))) return;

    await tx
      .update(wmsTables.inboundPlans)
      .set({ status: 'confirmed', updatedAt: new Date() })
      .where(eq(wmsTables.inboundPlans.id, planId));

    await this.poClosure.onPlanClosed(linkedPurchaseOrderId, tx);
  }
```

- [ ] **Step 3: `receiveFromPlan` 에서 부른다**

아이템 상태를 갱신하는 `await tx.update(wmsTables.inboundPlanItems)…` 블록 **직후**에 한 줄을 넣는다:

```ts
      await this.closePlanIfDone(tx, item.planId, plan.linkedPurchaseOrderId);
```

`inboundWorkLogs` insert 앞이든 뒤든 상관없다 — 같은 트랜잭션이다. 읽기 편한 자리는 아이템 갱신 바로 아래다.

- [ ] **Step 4: 종결 가드를 `cancelled` 까지 넓힌다**

`purchase-order.manager.ts` 에 import 를 더한다:

```ts
import { isTerminal } from './purchase-order-closure.rules';
```

`refreshHeaderStatus`(`:388`) 의 조기 반환을 바꾼다:

```ts
    // 종결 2개(received/cancelled)는 파생의 밖에 있다. 파생이 이 둘을 되돌리면
    // 취소된 발주가 라인 실행으로 살아난다.
    if (!header || isTerminal(header.status)) return;
```

`lockPurchaseOrderForLineExecution`(`:338`) 의 거부를 바꾼다. **에러 타입은 `BadRequestError` 그대로 둔다** — 여기는 "라인 실행 거부" 이지 "종결 재시도" 가 아니라서 400 이 맞다:

```ts
    if (isTerminal(po.status)) {
      throw new BadRequestError(`Cannot execute purchase order lines with status: ${po.status}`);
    }
```

- [ ] **Step 5: `InboundService` 조립 지점 6곳을 갱신한다**

🔴 **이걸 빼먹으면 타입 게이트가 통째로 빨개진다.** 통합 스펙들이 Nest DI 를 거치지 않고
생성자를 **위치 인자**로 직접 부른다. 7번째 인자를 더한다:

```bash
grep -rn "new InboundService(" apps/core/src --include=*.ts
```

여섯 곳 전부에 `new PurchaseOrderClosureAdapter()` 를 마지막 인자로 넘긴다. 어댑터는
생성자 의존이 없는 무상태 클래스이므로 `{} as never` 대신 **진짜를 넘긴다** — 그래야
스펙이 파생을 실제로 지난다.

| 파일 | 비고 |
|---|---|
| `inbound/services/__fixtures__/inbound-harness.ts:61` | `makeInboundService` — 통합 스펙 대다수가 여기를 지난다 |
| `procurement/services/purchase-order-line-execution.integration.spec.ts:76` | `{} as never` 5개 뒤에 붙인다 |
| `procurement/services/purchase-order-single-plan.integration.spec.ts:76` | 여러 줄로 펼쳐진 호출 |
| `inbound/services/inbound-plan-port-invariant.integration.spec.ts:47` | |
| `inbound/services/inbound.service.idempotency.spec.ts:9` | |
| `core/services/inventory-idempotency.integration.spec.ts:47` | |

- [ ] **Step 6: 게이트를 돌린다**

```bash
npm run type-check && npx jest --maxWorkers=2 apps/core/src/modules/inventory
```
기대: 타입 0. 유닛 스펙에 새 실패 0.

- [ ] **Step 7: 통합으로 파생이 실제로 도는지 본다**

```bash
npm run test:core:integration:local
```
기대: 8 suite / 12 test 의 기준선 RED 외에 **새 실패 0**. 여기서 `purchase-order-line-execution.integration.spec.ts` 가 빨개지면 Task 7 이 이관할 세 테스트다 — 원인을 확인하고 기록만 해두고 넘어간다.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory apps/core/src/modules/inventory/core
git commit -m "feat(inventory): 입고가 계획을 닫고 발주 종결을 파생시킨다 (#724 항목 7)"
```

---

## Task 5: 잎 종결 라우트

**Files:**
- Create: `apps/core/src/modules/inventory/inbound/dto/close-plan-item.dto.ts`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts`
- Modify: `apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.ts`
- Modify: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts`

**Interfaces:**
- Consumes: Task 4 `closePlanIfDone`
- Produces: `InboundService.closePlanItem(planItemId: string, dto: ClosePlanItemDto, userId: string, tx?: DbTx): Promise<{ success: true }>`, 라우트 `POST /inbound/plans/:planId/items/:itemId/close`

- [ ] **Step 1: DTO 를 만든다**

`inbound/dto/close-plan-item.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 잔량을 포기하고 입고예정 아이템을 종결할 때의 사유. */
export class ClosePlanItemDto {
  @ApiProperty({ description: '더 기다리지 않기로 한 이유 (공급처 결품·선적 누락 등)', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
```

> 사유는 **필수**다. 이 라우트의 존재 이유가 "누가 왜 그만 기다렸는지" 를 남기는 것이라 선택으로 두면 목적이 사라진다. 라인 종결(`MarkLineUnavailableDto`)의 `reason?` 과 다른 것은 의도다.

- [ ] **Step 2: 서비스 메서드를 더한다**

`inbound.service.ts` 에 넣는다. import 에 `ConflictError`, `NotFoundError` 를 `@app/shared` 에서 가져온다(파일에 이미 있으면 재사용):

```ts
  /**
   * 잔량을 포기하고 아이템을 종결한다 (잎 종결).
   *
   * 사람의 쓰기는 **잎에서만** 일어난다 — 계획 헤더를 직접 닫으면 "헤더는 아이템에서
   * 파생된다" 가 깨져 파생 경로가 둘이 된다(#724 항목 7 스펙 §2.1).
   * 미달 사실은 expected_qty/received_qty 로 영구히 남고, 여기 기록이 그 판단의 출처다.
   */
  async closePlanItem(
    planItemId: string,
    dto: ClosePlanItemDto,
    userId: string,
    tx?: DbTx,
  ): Promise<{ success: true }> {
    return this.dbService.run(async (trx) => {
      const [item] = await trx
        .select({
          id: wmsTables.inboundPlanItems.id,
          planId: wmsTables.inboundPlanItems.planId,
          status: wmsTables.inboundPlanItems.status,
        })
        .from(wmsTables.inboundPlanItems)
        .where(eq(wmsTables.inboundPlanItems.id, planItemId))
        .limit(1);
      if (!item) throw new NotFoundError(`Inbound plan item not found: ${planItemId}`);

      // 재실행 금지 = 자연 멱등 (항목 9 선례). 멱등키를 따로 도입하지 않는다.
      if (item.status !== 'pending') {
        throw new ConflictError(`Inbound plan item is already closed: ${item.status}`);
      }

      const [plan] = await trx
        .select({
          id: wmsTables.inboundPlans.id,
          linkedPurchaseOrderId: wmsTables.inboundPlans.linkedPurchaseOrderId,
        })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.id, item.planId))
        .limit(1);
      if (!plan) throw new NotFoundError(`Inbound plan not found: ${item.planId}`);

      await trx
        .update(wmsTables.inboundPlanItems)
        .set({
          status: 'short_closed',
          closedReason: dto.reason,
          closedAt: new Date(),
          closedBy: userId,
        })
        .where(eq(wmsTables.inboundPlanItems.id, planItemId));

      await this.closePlanIfDone(trx, plan.id, plan.linkedPurchaseOrderId);
      return { success: true as const };
    }, tx);
  }
```

- [ ] **Step 3: 라우트를 더한다**

`inbound.controllers.ts` 파일 끝(`receiveFromPlan` 아래)에 넣는다. `User` 를 import 에 더하고(`import { RequireScopes, ScopeGuard, User } from '@app/authorization';`), 로컬 타입도 파일 상단에 선언한다(발주 컨트롤러와 같은 모양):

```ts
interface JwtPayload {
  userId: string;
  email: string;
  roles: string[];
}
```

```ts
  @Post('plans/:planId/items/:itemId/close')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '입고예정 아이템 잔량 포기 종결' })
  @ApiParam({ name: 'planId', description: '입고 계획 ID' })
  @ApiParam({ name: 'itemId', description: '입고예정 아이템 ID' })
  @ApiResponse({ status: 201, description: '아이템이 종결됨' })
  @ApiResponse({ status: 409, description: '이미 종결된 아이템' })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async closePlanItem(
    @Param('itemId') itemId: string,
    @Body() dto: ClosePlanItemDto,
    @User() user: JwtPayload,
  ) {
    return this.inboundService.closePlanItem(itemId, dto, user.userId);
  }
```

`ApiParam` 을 `@nestjs/swagger` import 에 더한다. `planId` 는 경로에 있지만 쓰지 않는다 — 아이템 id 가 이미 계획을 결정한다. 경로에 두는 것은 화면·로그에서 계획을 읽을 수 있게 하기 위해서다.

> `@Post('plans/items')`(2세그먼트)와 이 라우트(4세그먼트)는 세그먼트 수가 달라 충돌하지 않는다.

- [ ] **Step 4: 스코프 커버리지 표에 등록한다**

`apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` 에 한 줄 더한다. 주변 줄과 같은 정렬을 따른다:

```ts
  'POST /inbound/plans/:planId/items/:itemId/close':            S.MANAGE,
```

- [ ] **Step 5: 게이트를 돌린다**

```bash
npm run type-check && npx jest --maxWorkers=2 inventory-scope-coverage
```
기대: 타입 0, 커버리지 스펙 PASS. **이 스펙이 빨가면 라우트를 표에 안 넣은 것이다.**

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound apps/core/src/platform/auth/inventory-scope-coverage.spec.ts
git commit -m "feat(inventory): 입고예정 아이템 잔량 포기 종결 (#724 항목 7)"
```

---

## Task 6: 발주 취소 라우트

**Files:**
- Create: `apps/core/src/modules/inventory/procurement/dto/purchase-order/cancel-purchase-order.dto.ts`
- Modify: `apps/core/src/modules/inventory/procurement/services/purchase-order.manager.ts`
- Modify: `apps/core/src/modules/inventory/procurement/services/purchase-order.service.ts`
- Modify: `apps/core/src/modules/inventory/procurement/controllers/purchase-order.controller.ts`
- Modify: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts`

**Interfaces:**
- Consumes: Task 2 `isTerminal`
- Produces: `PurchaseOrderManager.cancelPurchaseOrder(poId, dto, userId, tx?)` → `Promise<PurchaseOrderResponse>`, 같은 이름의 서비스 위임, 라우트 `POST /purchase-orders/:id/cancel`

- [ ] **Step 1: DTO 를 만든다**

`procurement/dto/purchase-order/cancel-purchase-order.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 발주 자체를 무를 때의 사유. */
export class CancelPurchaseOrderDto {
  @ApiProperty({ description: '취소 사유 (오발주·공급처 사정 등)', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
```

- [ ] **Step 2: 매니저에 취소를 더한다**

`purchase-order.manager.ts` 의 drizzle import 에 `gt` 를 더하고(`import { eq, ne, and, gt, inArray } from 'drizzle-orm';`), `markLineUnavailable` 아래에 넣는다:

```ts
  /**
   * 발주를 취소한다. 파생이 아니라 **사람의 결정**이므로 전용 종결 경로다.
   *
   * 입고가 한 건이라도 있으면 거부한다 — 이미 받은 물건이 있는 발주는 취소가 아니라
   * 잔량 포기(잎 종결)로 닫는다(#724 항목 7 스펙 §2.1·§2.2).
   * 전 라인이 `unavailable` 인 발주도 자동으로 취소되지 않는다. 닫을지는 사람이 정한다.
   *
   * 🔴 잠금 순서: PO 행부터 잡는다. 라인은 읽지 않고 아이템만 읽는다.
   */
  async cancelPurchaseOrder(
    poId: string,
    dto: CancelPurchaseOrderDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      const [header] = await trx
        .select({ status: wmsTables.purchaseOrders.status })
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1)
        .for('update');
      if (!header) throw new NotFoundError(`Purchase order not found: ${poId}`);

      if (isTerminal(header.status)) {
        throw new ConflictError(`Purchase order is already ${header.status}; it cannot be cancelled`);
      }

      const [received] = await trx
        .select({ id: wmsTables.inboundPlanItems.id })
        .from(wmsTables.inboundPlanItems)
        .innerJoin(
          wmsTables.inboundPlans,
          eq(wmsTables.inboundPlans.id, wmsTables.inboundPlanItems.planId),
        )
        .where(
          and(
            eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId),
            gt(wmsTables.inboundPlanItems.receivedQty, 0),
          ),
        )
        .limit(1);
      if (received) {
        throw new ConflictError('Purchase order already has receipts; close the remaining items instead');
      }

      await trx
        .update(wmsTables.purchaseOrders)
        .set({
          status: 'cancelled',
          cancelledReason: dto.reason,
          cancelledAt: new Date(),
          cancelledBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.purchaseOrders.id, poId));

      return this.reader.findById(poId, trx);
    }, tx);
  }
```

import 에 `CancelPurchaseOrderDto` 를 더한다.

- [ ] **Step 3: 서비스에 위임을 더한다**

`purchase-order.service.ts` 의 `markLineUnavailable` 아래:

```ts
  cancelPurchaseOrder(
    poId: string,
    dto: CancelPurchaseOrderDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.manager.cancelPurchaseOrder(poId, dto, userId, tx);
  }
```

- [ ] **Step 4: 라우트를 더한다**

`purchase-order.controller.ts` 의 `markLineUnavailable` 아래:

```ts
  @Post(':id/cancel')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주 취소 (입고 전에만)' })
  @ApiParam({ name: 'id', description: '발주 ID' })
  @ApiResponse({ status: 200, description: '발주가 취소됨', type: PurchaseOrderResponseDto })
  @ApiResponse({ status: 409, description: '이미 종결됐거나 입고가 있는 발주' })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @HttpCode(HttpStatus.OK)
  async cancelPurchaseOrder(
    @Param('id') id: string,
    @Body() dto: CancelPurchaseOrderDto,
    @User() user: JwtPayload,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.cancelPurchaseOrder(id, dto, user.userId);
  }
```

- [ ] **Step 5: `PurchaseOrderStatus` 에 `CANCELLED` 를 더한다**

`procurement/dto/purchase-order.dto.ts:22` 의 enum 에 멤버를 더한다:

```ts
  CANCELLED = 'cancelled',
```

응답 DTO 의 `@ApiProperty({ enum: [...] })` 에 `'cancelled'` 가 빠진 자리가 있으면 함께 채운다 (`grep -n "'received'" apps/core/src/modules/inventory/procurement/dto` 로 찾는다).

- [ ] **Step 6: 스코프 커버리지 표에 등록한다**

```ts
  'POST /purchase-orders/:id/cancel':                          S.MANAGE,
```

- [ ] **Step 7: 게이트를 돌린다**

```bash
npm run type-check && npx jest --maxWorkers=2 inventory-scope-coverage purchase-order
```
기대: 타입 0. 커버리지 PASS. `purchase-order.dto.spec.ts` 가 enum 값을 세고 있으면 함께 고친다.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/procurement apps/core/src/platform/auth/inventory-scope-coverage.spec.ts
git commit -m "feat(inventory): 발주 취소 — 입고 전 종결 경로 (#724 항목 7)"
```

---

## Task 7: 수동 종결 라우트를 제거하고 시나리오를 파생으로 이관한다

**Files:**
- Delete: `apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.ts`, `…/purchase-order-status.rules.spec.ts`
- Modify: `…/procurement/controllers/purchase-order.controller.ts:236-244`
- Modify: `…/procurement/services/purchase-order.service.ts:51-58`
- Modify: `…/procurement/services/purchase-order.manager.ts:179`
- Modify: `…/procurement/dto/purchase-order.dto.ts:74-86`, `…/dto/purchase-order.dto.spec.ts`
- Modify: `…/procurement/services/purchase-order-line-execution.integration.spec.ts:589-635`
- Modify: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts:136`

**Interfaces:**
- Produces: `PUT /purchase-orders/:id/status` 없음. `UpdatePurchaseOrderStatusDto` 없음. `assertReceivedTransition` 없음.

> **왜 지우나**: 파생이 생기면 이 라우트는 기록 없는 지름길이 된다 — 계획 아이템이 아직 `pending` 인 발주를 사유 없이 `received` 로 닫을 수 있다. 제품 코드 소비자는 2026-08-27 실측 기준 **0곳**이다(admin-web·Tauri·스크립트 전부 없음).

- [ ] **Step 1: 소비자가 0인지 다시 확인한다**

```bash
grep -rn "purchase-orders/[^\"' ]*status\|updatePurchaseOrderStatus\|UpdatePurchaseOrderStatusDto" \
  --include=*.ts --include=*.tsx --include=*.rs apps native scripts | grep -v node_modules
```
기대: `apps/core` 안(컨트롤러·서비스·매니저·DTO·스펙·스코프 표)만 나온다. **admin-web 이나 native 가 나오면 멈추고 보고한다** — 계획의 전제가 깨진 것이다.

- [ ] **Step 2: 통합 스펙의 세 시나리오를 파생 경로로 다시 쓴다**

`purchase-order-line-execution.integration.spec.ts` 의 세 `it` 을 고친다. 시나리오는 살리고 진입점만 바꾼다.

```ts
  it('전 라인이 종결됐어도 입고 전에는 received 로 가지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      for (const skuId of fx.skuIds) {
        await service.orderLine(fx.poId, skuId, { orderedQty: 10 }, ACTOR, trx);
      }

      const po = await service.getPurchaseOrderById(fx.poId, trx);
      // 라인은 전부 실행됐지만 물건이 안 들어왔다. 종결은 입고가 소유한다.
      expect(po.status).toBe('confirmed');
    });
  });

  it('아직 실행 안 된 라인이 남은 발주는 confirmed 로도 가지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10 }, ACTOR, trx);

      const po = await service.getPurchaseOrderById(fx.poId, trx);
      expect(po.status).toBe('created');
    });
  });

  it('종결된 발주에는 라인을 실행할 수 없다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10 }, ACTOR, trx);
      await service.cancelPurchaseOrder(fx.poId, { reason: '오발주' }, ACTOR, trx);

      await expect(
        service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 10 }, ACTOR, trx),
      ).rejects.toThrow(/cancelled/);
    });
  });
```

`PurchaseOrderStatus` import 가 이 파일에서 더 이상 안 쓰이면 지운다.

- [ ] **Step 3: 라우트·DTO·메서드를 지운다**

- `purchase-order.controller.ts` — `@Put(':id/status')` 데코레이터 블록과 `updatePurchaseOrderStatus` 메서드 전체. `UpdatePurchaseOrderStatusDto` import 도.
- `purchase-order.service.ts` — `updatePurchaseOrderStatus` 위임과 import.
- `purchase-order.manager.ts:179` — `updatePurchaseOrderStatus` 메서드 전체와 `assertReceivedTransition` import.
- `purchase-order.dto.ts:74-86` — `UpdatePurchaseOrderStatusDto` 클래스.
- `purchase-order.dto.spec.ts` — 그 DTO 를 다루는 describe 블록.

```bash
git rm apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.ts \
       apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.spec.ts
```

`Put` 이 컨트롤러의 `@nestjs/common` import 에서 더 이상 안 쓰이면(라인 일괄 수정이 아직 `@Put` 을 쓴다면 남긴다) 정리한다.

- [ ] **Step 4: 스코프 표에서 지운다**

`inventory-scope-coverage.spec.ts:136` 의 `'PUT /purchase-orders/:id/status'` 줄을 지운다.

- [ ] **Step 5: 잔재가 없는지 확인한다**

```bash
grep -rn "assertReceivedTransition\|UpdatePurchaseOrderStatusDto\|updatePurchaseOrderStatus" apps/core/src
```
기대: 출력 없음.

- [ ] **Step 6: 게이트를 돌린다**

```bash
npm run type-check && npx jest --maxWorkers=2 apps/core/src/modules/inventory && npm run test:core:integration:local
```
기대: 타입 0, 유닛 새 실패 0, 통합은 기준선 외 새 실패 0.

- [ ] **Step 7: 커밋**

```bash
git add -A apps/core/src
git commit -m "refactor(inventory)!: 수동 종결 라우트 제거 — received 는 파생이 소유한다 (#724 항목 7)

PUT /purchase-orders/:id/status 는 파생이 생기면 기록 없는 지름길이 된다.
제품 코드 소비자 0곳으로 실측 확인했다(admin-web·Tauri·스크립트 전부 없음)."
```

---

## Task 8: 종결 파생 통합 스펙

**Files:**
- Create: `apps/core/src/modules/inventory/procurement/services/purchase-order-closure.integration.spec.ts`

**Interfaces:**
- Consumes: Task 4·5·6 의 전 경로. 조립은 `inbound/services/__fixtures__/inbound-harness.ts` 의 `makeInboundService` · `inRollbackTx` 를 쓴다 (실제 `InventoryCommandService`·`StockEventStore` 가 붙은 배선이라 입고가 원장까지 실제로 돈다).

> `receiveFromPlan(dto, tx)` 은 `tx` 를 전파한다(`inbound.service.ts:901` 의 `}, tx);`).
> 롤백 트랜잭션 안에서 그대로 부를 수 있다 — `inbound.service.plan-receive.integration.spec.ts` 가 쓰는 패턴이다.

- [ ] **Step 1: 스펙 뼈대와 픽스처를 쓴다**

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { Database, inRollbackTx, makeInboundService } from '../../inbound/services/__fixtures__/inbound-harness';
import { InboundService } from '../../inbound/services/inbound.service';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderManager } from './purchase-order.manager';
import { PurchaseOrderReader } from './purchase-order.reader';

/**
 * items → plan → PO 단방향 파생을 고정한다 (#724 항목 7).
 *
 * 단위 테스트로는 아무것도 안 잡힌다 — 세 테이블에 걸친 상태 전이이고, 파생의
 * 트리거가 트랜잭션 경계를 넘어 포트로 건너간다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-closure
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('발주 종결 파생 (DB integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let inbound: InboundService;
  const ACTOR = randomUUID();

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    inbound = makeInboundService(db);
  });

  afterAll(async () => {
    await client.end();
  });

  /** 롤백 트랜잭션에 묶인 DbService 대역 — tx 미지정 호출도 trx 로 흡수한다. */
  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db: trx,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function buildPoService(trx: DbTx): PurchaseOrderService {
    const dbService = boundDbService(trx);
    const reader = new PurchaseOrderReader(dbService);
    return new PurchaseOrderService(new PurchaseOrderManager(dbService, inbound, reader), reader);
  }

  /** 라인 1개짜리 발주. 계획은 라인 실행이 만든다 — 여기서 만들지 않는다. */
  async function seedPoWithOneLine(tx: DbTx, quantity: number) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `clo-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `clo-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'clo sku', code: `CLO-${suffix}`, holderId: holder.id })
      .returning();
    const [supplier] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `clo-supplier-${suffix.slice(0, 8)}` })
      .returning();
    const [po] = await tx
      .insert(wmsTables.purchaseOrders)
      .values({
        supplierId: supplier.id,
        type: 'domestic',
        sourceWarehouseId: warehouse.id,
        destinationWarehouseId: warehouse.id,
      })
      .returning();
    await tx
      .insert(wmsTables.purchaseOrderLines)
      .values({ poId: po.id, skuId: sku.id, quantity, status: 'requested' });
    return { warehouseId: warehouse.id, poId: po.id, skuId: sku.id };
  }

  /** 라인 실행이 만든 계획 아이템의 id. 한 발주에 계획은 하나뿐이다. */
  async function planItemIdOf(tx: DbTx, poId: string): Promise<string> {
    const [row] = await tx
      .select({ id: wmsTables.inboundPlanItems.id })
      .from(wmsTables.inboundPlanItems)
      .innerJoin(wmsTables.inboundPlans, eq(wmsTables.inboundPlans.id, wmsTables.inboundPlanItems.planId))
      .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId))
      .limit(1);
    return row.id;
  }

  async function planStatusOf(tx: DbTx, poId: string): Promise<string> {
    const [row] = await tx
      .select({ status: wmsTables.inboundPlans.status })
      .from(wmsTables.inboundPlans)
      .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId))
      .limit(1);
    return row.status;
  }
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run test:core:integration:local -- purchase-order-closure
```
기대: 스펙 파일이 잡히고 테스트 0건으로 통과(아직 `it` 이 없다). 파일이 안 잡히면 경로·이름을 확인한다.

- [ ] **Step 3: 완주 시나리오를 쓴다**

`planStatusOf` 아래, `});` 앞에 넣는다:

```ts
  it('전량 입고되면 계획이 닫히고 발주가 received 로 파생된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);

      // 라인은 전부 실행됐지만 물건은 아직 안 들어왔다.
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('confirmed');

      const itemId = await planItemIdOf(trx, fx.poId);
      await inbound.receiveFromPlan({ planItemId: itemId, quantity: 10, idempotencyKey: randomUUID() }, trx);

      expect(await planStatusOf(trx, fx.poId)).toBe('confirmed');
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('received');
    });
  });
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npm run test:core:integration:local -- purchase-order-closure
```
기대: PASS 1건. 실패하면 포트가 배선되지 않았거나(Task 3) `closePlanIfDone` 호출이 빠진 것이다(Task 4).

- [ ] **Step 5: 잎 종결 시나리오를 쓴다**

```ts
  it('미달 입고를 잎 종결하면 발주가 received 로 파생되고 미달 사실은 남는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);

      const itemId = await planItemIdOf(trx, fx.poId);
      await inbound.receiveFromPlan({ planItemId: itemId, quantity: 7, idempotencyKey: randomUUID() }, trx);

      // 7/10 은 종결이 아니다.
      expect(await planStatusOf(trx, fx.poId)).toBe('pending');
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('confirmed');

      await inbound.closePlanItem(itemId, { reason: '공급처 결품' }, ACTOR, trx);

      expect(await planStatusOf(trx, fx.poId)).toBe('confirmed');
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('received');

      // 미달 사실은 지워지지 않는다 — 그게 잎 종결을 고른 이유다(스펙 §2.1).
      const [item] = await trx
        .select({
          expectedQty: wmsTables.inboundPlanItems.expectedQty,
          receivedQty: wmsTables.inboundPlanItems.receivedQty,
          status: wmsTables.inboundPlanItems.status,
          closedReason: wmsTables.inboundPlanItems.closedReason,
          closedBy: wmsTables.inboundPlanItems.closedBy,
        })
        .from(wmsTables.inboundPlanItems)
        .where(eq(wmsTables.inboundPlanItems.id, itemId))
        .limit(1);
      expect(item).toMatchObject({
        expectedQty: 10,
        receivedQty: 7,
        status: 'short_closed',
        closedReason: '공급처 결품',
        closedBy: ACTOR,
      });
    });
  });

  it('이미 종결된 아이템은 다시 종결되지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);
      const itemId = await planItemIdOf(trx, fx.poId);
      await inbound.closePlanItem(itemId, { reason: '결품' }, ACTOR, trx);

      await expect(inbound.closePlanItem(itemId, { reason: '결품' }, ACTOR, trx)).rejects.toThrow(
        /already closed/,
      );
    });
  });
```

- [ ] **Step 6: 취소 시나리오를 쓴다**

```ts
  it('입고가 있는 발주는 취소되지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);
      const itemId = await planItemIdOf(trx, fx.poId);
      await inbound.receiveFromPlan({ planItemId: itemId, quantity: 3, idempotencyKey: randomUUID() }, trx);

      // 이미 받은 물건이 있는 발주는 취소가 아니라 잔량 포기로 닫는다.
      await expect(
        po.cancelPurchaseOrder(fx.poId, { reason: '오발주' }, ACTOR, trx),
      ).rejects.toThrow(/receipts/);
    });
  });

  it('입고 전 발주는 취소되고 다시 취소되지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);

      const cancelled = await po.cancelPurchaseOrder(fx.poId, { reason: '오발주' }, ACTOR, trx);
      expect(cancelled.status).toBe('cancelled');

      await expect(
        po.cancelPurchaseOrder(fx.poId, { reason: '오발주' }, ACTOR, trx),
      ).rejects.toThrow(/already cancelled/);
    });
  });

  it('취소된 발주는 입고가 들어와도 received 로 되살아나지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);
      const itemId = await planItemIdOf(trx, fx.poId);
      await po.cancelPurchaseOrder(fx.poId, { reason: '오발주' }, ACTOR, trx);

      await inbound.receiveFromPlan({ planItemId: itemId, quantity: 10, idempotencyKey: randomUUID() }, trx);

      // 계획은 닫히지만 발주는 종결 상태 그대로다 (canDeriveReceived 의 isTerminal 가드).
      expect(await planStatusOf(trx, fx.poId)).toBe('confirmed');
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('cancelled');
    });
  });
```

- [ ] **Step 7: 전부 통과하는지 확인한다**

```bash
npm run test:core:integration:local -- purchase-order-closure
```
기대: PASS 6건.

- [ ] **Step 8: 통합 전체를 돌린다**

```bash
npm run test:core:integration:local
```
기대: 기준선 8 suite / 12 test 외 새 실패 0.

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/inventory/procurement/services/purchase-order-closure.integration.spec.ts
git commit -m "test(inventory): 종결 파생 통합 — 완주·잎 종결·취소·되살아남 금지 (#724 항목 7)"
```

---

## Task 9: admin-web 계약과 배선

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:1400`
- Modify: `apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/inventory/inbound.client.ts`
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts`

**Interfaces:**
- Produces: `purchaseOrdersClient.cancel(id, data)` · `inboundClient.closePlanItem(planId, itemId, data)` · `useCancelPurchaseOrder()` · `useClosePlanItem()`
- Consumes: `lineExecutionInvalidationKeys(poId)` (기존)

- [ ] **Step 1: 타입을 넓힌다**

`lib/types/dto/inventory.ts:1400`:

```ts
export type PurchaseOrderStatus = 'created' | 'confirmed' | 'received' | 'cancelled';
```

`MarkLineUnavailableRequest` 아래에 더한다:

```ts
export interface CancelPurchaseOrderRequest {
  /** 취소 사유. 필수, 최대 500자. */
  reason: string;
}

export interface ClosePlanItemRequest {
  /** 더 기다리지 않기로 한 이유. 필수, 최대 500자. */
  reason: string;
}
```

> 이 한 줄이 `STATUS_LABELS: Record<PurchaseOrderStatus, string>` 을 컴파일 에러로 만든다. Task 10 이 라벨을 채울 때까지 `npx tsc --noEmit` 이 빨간 게 정상이다 — 그 에러가 곧 "화면이 새 상태를 모른다" 는 신호다.

- [ ] **Step 2: 클라이언트를 더한다**

`purchase-orders.client.ts` 의 `markLineUnavailable` 아래:

```ts
  cancel: async (id: string, data: CancelPurchaseOrderRequest): Promise<PurchaseOrderDto> => {
    const response = await client.post(`${BASE}/${encodeURIComponent(id)}/cancel`, data);
    return response.data;
  },
```

import 목록에 `CancelPurchaseOrderRequest` 를 더한다.

`inbound.client.ts` 에 더한다(그 파일의 `BASE` 상수를 그대로 쓴다):

```ts
  closePlanItem: async (
    planId: string,
    itemId: string,
    data: ClosePlanItemRequest
  ): Promise<{ success: true }> => {
    const response = await client.post(
      `${BASE}/plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}/close`,
      data
    );
    return response.data;
  },
```

- [ ] **Step 3: 뮤테이션을 더한다**

`mutations.ts` 의 `useMarkLineUnavailable` 아래. **`onSettled` 를 쓴다** — 409 로 실패해도 무효화해야 옛 화면 위에서 무한 재시도가 안 생긴다(기존 라인 실행 뮤테이션과 같은 이유):

```ts
export const useCancelPurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, data }: { poId: string; data: CancelPurchaseOrderRequest }) =>
      purchaseOrdersClient.cancel(poId, data),
    onSettled: (_res, _err, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useClosePlanItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, itemId, data }: { planId: string; itemId: string; data: ClosePlanItemRequest }) =>
      inboundClient.closePlanItem(planId, itemId, data),
    // 잎 종결은 발주 헤더까지 파생으로 밀 수 있다 — 입고 키만 무효화하면
    // 발주 목록이 옛 상태를 보여준다. 라인 실행과 같은 키 묶음을 쓴다.
    onSettled: (_res, _err, { planId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(planId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
```

> `lineExecutionInvalidationKeys` 의 인자는 현재 쓰이지 않고 `[purchaseOrdersRoot, inbounds]` 를 돌려준다 — 잎 종결에 필요한 두 키가 정확히 그것이다. **`inventoryQueryKeys.purchaseOrders()` 를 무효화 필터로 쓰지 않는다** — 인자 없이 부르면 `['purchase-orders', undefined]` 가 되어 위치별 비교에서 조용히 안 걸린다.

- [ ] **Step 4: 타입 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
```
기대: `STATUS_LABELS` 의 `cancelled` 누락 에러 **1건만** 남는다. 다른 에러가 있으면 고친다.

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib
git commit -m "feat(admin-web): 발주 취소·잔량 포기 계약과 뮤테이션 (#724 항목 7)"
```

---

## Task 10: admin-web 버튼 둘

**Files:**
- Modify: `apps/admin-web/src/features/inventory/purchase-orders/components/purchase-order-detail-drawer/index.tsx:20-23`(라벨), 하단(버튼)
- Modify: `apps/admin-web/src/features/inventory/inbound/components/pending-tab/plan-detail-drawer/index.tsx:112`(아이템 행)

**Interfaces:**
- Consumes: Task 9 `useCancelPurchaseOrder`, `useClosePlanItem`

- [ ] **Step 1: 상태 라벨을 채운다**

`purchase-order-detail-drawer/index.tsx`:

```ts
const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  created: '생성됨',
  confirmed: '확정됨',
  received: '입고완료',
  cancelled: '취소됨',
};
```

- [ ] **Step 2: 취소 버튼을 단다**

같은 파일. `canEditLines` 옆에 조건을 더한다:

```tsx
  // 입고가 시작된 발주는 취소가 아니라 잔량 포기로 닫는다 — core 가 409 로 막지만
  // 버튼을 숨겨 그 409 를 사용자가 만나지 않게 한다.
  const canCancel = po.status === 'created' || po.status === 'confirmed';
```

「라인 수정」 버튼 옆에 사유를 받는 다이얼로그를 띄우는 버튼을 둔다. 사유는 필수이므로 빈 문자열이면 제출을 막는다. 성공하면 토스트, 실패하면 `error.message` 를 그대로 보여준다(409 문구가 원인을 담고 있다).

```tsx
  {canCancel && (
    <Button size="sm" variant="destructive" onClick={() => setCancelOpen(true)}>
      발주 취소
    </Button>
  )}
```

다이얼로그는 이 폴더에 이미 있는 `PurchaseOrderFormDialog` 의 모양을 따르되, 입력은 사유 하나(`Textarea`)뿐이다.

- [ ] **Step 3: 잔량 포기 버튼을 단다**

`plan-detail-drawer/index.tsx:112` 의 `row.items.map` 안, 「입고」 버튼 옆에 둔다. `planItemIdMap` 이 이미 `planItemId` 를 들고 있다:

```tsx
  {item.pendingQty > 0 && (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setClosingItem({ mapKey, skuName: item.skuName })}
      disabled={!hasPlanItemId}
    >
      잔량 포기
    </Button>
  )}
```

사유 다이얼로그에서 확인하면 `closeMutation.mutateAsync({ planId: row.planId, itemId: planItemIdMap.get(mapKey)!, data: { reason } })` 를 부른다. `planItemId` 가 없으면 버튼이 `disabled` 이므로 `!` 가 안전하지만, 기존 `handleReceive` 처럼 방어 토스트를 두는 편이 그 파일의 결과 맞다.

- [ ] **Step 4: 타입 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
```
기대: 에러 0.

- [ ] **Step 5: 브라우저로 확인한다**

dev core 를 띄우고 admin-web 을 연다. **admin-web 은 컴포넌트 테스트가 불가능하므로(렌더러 없음·`.tsx` 가 jest transform 밖) 화면 확인이 유일한 검증이다.**

- `/inventory/purchase-orders` → 발주 상세 → 「발주 취소」 → 사유 입력 → 상태가 `취소됨` 으로 바뀌고 목록에도 반영된다
- 입고가 있는 발주에서는 버튼이 안 보인다
- `/inventory/inbound` 대기 탭 → 계획 상세 → 「잔량 포기」 → 사유 입력 → 그 계획이 목록에서 사라지고 발주가 `입고완료` 로 바뀐다

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features
git commit -m "feat(admin-web): 발주 취소·잔량 포기 버튼 (#724 항목 7)"
```

---

## Task 11: 전체 게이트와 dev 스모크

- [ ] **Step 1: 게이트 4종을 순서대로 돌린다**

```bash
npm run type-check
cd apps/admin-web && npx tsc --noEmit && cd ../..
npx jest --maxWorkers=2
npm run test:core:integration:local
```

넷 다 0 이 기준선이다. 통합만 예외 — 8 suite / 12 test 는 develop 부터 RED 다.

- [ ] **Step 2: dev 스모크 8항목**

dev DB 에서 돈다. 라이브가 아닌 이유는 발주 삭제 라우트가 없어 첫 발주를 되돌릴 수 없기 때문이다.

1. 발주 생성 → 라인 전부 실행 → 상태가 `확정됨` 에 머문다 (입고 전에는 종결 아님)
2. 계획 아이템 전량 입고 → 발주가 `입고완료` 로 **자동** 바뀐다
3. 그 계획이 입고 대기 목록에서 사라진다 (유령 행 소멸)
4. 종결된 발주에 라인 실행을 시도하면 400
5. 미달 입고(10 중 7) → 계획이 안 닫힌다
6. 그 아이템 「잔량 포기」 → 계획이 닫히고 발주가 `입고완료`, `예정 10 / 입고 7` 이 그대로 남아 있다
7. 입고 전 발주 「발주 취소」 → `취소됨`, 두 번째 취소는 409
8. 입고가 있는 발주는 취소 버튼이 안 보이고, API 직접 호출은 409

- [ ] **Step 3: 결과를 이슈에 남긴다**

`gh issue comment 724` 로 스모크 결과 전문과 게이트 출력을 붙인다. 현황판의 항목 7 을 🟩 로, 작업 순서 4 를 완료로 갱신한다. **남는 것은 순서 5(라이브 개통)뿐**이다.

- [ ] **Step 4: PR 을 연다**

본문에 반드시 넣는다:

- 게이트 4종 결과 (통합은 기준선 대비)
- dev 스모크 8항목 결과
- ⚠️ **배포 순서: `migrate → deploy`** (expand phase)
- ⚠️ **파괴적 변경**: `PUT /purchase-orders/:id/status` 제거. 제품 코드 소비자 0곳 실측 근거
- 마이그레이션 1건(enum 2 · 컬럼 6 · 백필 2문)

---

## 배포 메모

- **순서는 `migrate → deploy`.** additive 만 있으므로 expand phase 다. 옛 태스크는 새 enum 값과 nullable 컬럼을 무시한다.
- **core ↔ admin-web 사이에는 배포 순서 제약이 없다.** 새 enum 값은 사람이 버튼을 눌러야 데이터에 생기고 그 버튼은 배포 후에야 존재하므로, 옛 admin-web 이 모르는 값을 볼 창이 구조적으로 없다. `received` 는 이미 있던 값이라 자동 파생이 시작돼도 화면이 안 깨진다. (SST 한 스택이라 어차피 두 앱 사이 순서는 `--target` 없이는 만들 수 없다.)
- **라이브 영향**: `purchase_orders` 라이브 행은 0이므로 백필은 no-op 이다. 배포 후 첫 발주가 곧 개통(닫는 조건 3)이다.
- **이벤트 계약 0건 · secret/env 0건.**
