# 가용재고 소유 모듈 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코드 6곳에 흩어진 "가용재고" 산식을 단일 모듈이 소유하게 만들고, TS 로 대체할 수 없는 SQL 집합 경로는 등가성 테스트로 고정한다.

**Architecture:** `inventory/shared/availability/` 에 Nest 프로바이더가 아닌 **순수 함수 모듈**을 둔다 (`shared/locks/reservation-invariant.ts` 와 같은 형태 — DI 순환을 피하려고 이미 채택된 패턴이다). 스칼라 호출자 3곳은 이 모듈에 위임한다. 집합 기반 SQL 호출자(뷰·야간 대사)는 SQL 로 남되, **모듈과 값이 일치하는지 검증하는 통합 테스트**를 붙여 조용한 분기를 불가능하게 만든다. 뷰의 `transit_out` 차감 항은 제거한다.

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), Jest, PostgreSQL 16

**리뷰 제안과 다른 점 (의도된 이탈):** 원 제안은 (a) 뷰가 "판매가능수량의 권위이기를 그만두게" 하고 (b) `transit_out` 을 *이름 붙은 두 번째 판독*으로 남기라고 했다. 이 계획은 둘 다 다르게 간다.

- (a) 뷰에서 권위를 빼려면 `product-sellable-quantity`·재시도 워커·발주 제안 세 곳의 **집합 SQL 을 스칼라 호출로 바꿔야 하고** 그러면 N+1 이 된다. 대신 **뷰를 모듈과 일치시키고 등가 테스트로 고정**한다. 정의는 한 곳(모듈)이 소유하고, 뷰는 그 정의의 집합 표현이 된다.
- (b) `transit_out` 을 보존하지 않고 제거한다. 조사 결과 이 항은 실제 창고간이동(`stock_journals`)을 추적하지 않고 `inbound_plan_items` 를 읽으며, 출발 창고에서만 차감한다. 즉 "이름 붙일 가치가 있는 두 번째 관점"이 아니라 **틀린 항**이다. 근거는 아래 배경 참조.

## Global Constraints

- 레이어 규약(CLAUDE.md): Controller → Service → Reader/Manager → Repository. 이 계획이 만드는 것은 Repository 아래 **leaf 순수 함수 모듈**이며 Nest 프로바이더로 등록하지 않는다.
- 트랜잭션 전파(ADR-0025): 공개 함수는 `tx?: DbTx` 를 마지막 인자로, 내부 헬퍼는 `tx: DbTx` 필수. 클래스별 `inTx` 헬퍼 금지, `DbService.run` 단일 러너만 사용. 이 모듈의 함수들은 **항상 `trx: DbTx` 를 첫 인자로 필수**로 받는다 (`reservation-invariant.ts` 와 동일).
- Inventory 쿼리 규약(CLAUDE.md): `db.query.*` 금지, `with` 관계 금지, `any`/`as` 캐스팅 금지. 단 `trx.execute(sql\`...\`)` 의 원시 결과 타이핑은 `reservation-invariant.ts:20` 과 `ledger-reconciliation.service.ts:180` 에 이미 **문서화된 캐스트**로 존재하므로 같은 형태를 따른다.
- 스키마 export 이름: `wmsTables` / `wmsSchema` / `DbTx` — `apps/core/src/modules/inventory/schema/inventory.schema.ts` 에서 import. (`inventoryTables` / `inventorySchema` 는 같은 객체의 별칭이다: `:4257-4258`)
- 가용재고 정본 정의(CLAUDE.md, ADR-0001): **가용재고 = ON_HAND 원장 합 − confirmed 예약 합**. 다른 항을 추가하지 않는다.
- 통합 테스트는 `DATABASE_URL` 이 있을 때만 실행한다(`const describeIfDb = DATABASE_URL ? describe : describe.skip`). 스펙 골격은 `apps/core/src/modules/inventory/core/services/transfer.service.integration.spec.ts:1-60` 을 그대로 따른다.
- **통합 테스트 실행은 반드시 레포 러너로 한다** — `scripts/local/test-core-integration-local.sh` 가 compose postgres(5432, 논리 DB `core`) 기동 → core 마이그레이션 → `jest --runInBand` 를 한 번에 한다. `DATABASE_URL` 을 손으로 잡거나 별도 컨테이너를 띄우지 말 것. 레시피: `docs/local-dev.md:186-206`.
- 🔴 **워크트리에서는 `COMPOSE_PROJECT_NAME=almondyoung-server` 를 반드시 붙인다:**
  ```bash
  COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <좁히는-패턴>
  ```
  붙이지 않으면 `docker compose` 가 **워크트리 디렉터리명으로 별도 프로젝트**를 만들어 5432 에 두 번째 postgres 를 띄우려다 `port is already allocated` 로 실패한다. 실패 후 찌꺼기 네트워크/볼륨이 남으면 `docker compose -p <워크트리명> down -v` 로 정리한다.
- 🔴 **예약 행(`stock_reservations`)은 손으로 INSERT 하지 않는다.** `shipment_line_id` 가 **NOT NULL + FK → `shipment_lines`** 라(`inventory.schema.ts:1445-1447`, Task 25 계약), 유효한 예약 하나를 만들려면 `fulfillment_orders → fulfillment_order_items → shipments → shipment_lines` 4단 체인이 필요하다. 대신 **기존 픽스처를 쓴다**:
  ```typescript
  import { seedPickableShipment } from '../../../fulfillment/services/__support__/logistics-fixtures';
  const fx = await seedPickableShipment(trx, 10);
  // fx: { skuId, warehouseId, locationId, shipmentLineId, qty, ... }
  // 이미 심어진 것: ON_HAND stock_ledgers qty=10  +  confirmed stock_reservations quantity=10
  ```
  수량 조합이 필요하면 시드 후 `UPDATE` 로 조정한다(예약 4로 낮추기, `status='released'` 로 바꾸기, `DEFECTIVE` 원장 행 추가 등). inventory 스펙이 fulfillment `__support__` 를 import 하는 선례는 이미 여럿 있다(`transfer.service.integration.spec.ts:1` 등).
- ⚠️ **사전 존재 실패 1건**: `apps/core/src/modules/inventory/core/services/ledger-reconciliation.integration.spec.ts` 의 `reconcileReservations 는 예약>ON_HAND grain 을 잡는다` 케이스가 `shipment_line_id` 누락으로 **develop 에서 이미 실패한다**(7건 중 1건). 이 계획이 만든 것이 아니다. Task 6 에서 같은 픽스처로 고친다.
- ⚠️ **패턴을 반드시 좁힌다.** 패턴 없이 돌리면 `*.integration.spec.ts` 전체가 매칭되어 membership/wallet 등 다른 논리 DB 를 기대하는 스펙까지 걸려 실패한다.
- ⚠️ **워크트리 경로가 `--testPathPattern` 을 오염시킨다.** 경로 부분일치이므로 브랜치/워크트리 이름에 든 단어가 패턴과 겹치면 의도보다 훨씬 많은 스펙이 잡힌다. 범위를 확실히 하려면 `--runTestsByPath` 로 파일을 직접 지정한다.
- 커밋 메시지는 한국어 본문 + conventional prefix (레포 관행: `fix:`, `feat:`, `docs:`).

---

## 배경 — 왜 이 작업인가

`apps/core` 아키텍처 리뷰(2026-08-11) 제안 3. 실측으로 확인된 사실:

| 구현 | 산식 | 성격 |
|---|---|---|
| `inventory.schema.ts:982` (`stock_summary_view`) | `on_hand − reserved − transit_out` | **의미 분기** |
| `unified-reservation.service.ts:249` | `on_hand − reserved` (raw SQL) | 중복 |
| `shared/locks/reservation-invariant.ts:11` | `on_hand`, `reserved` 개별 반환 | 중복 |
| `ledger-reconciliation.service.ts:159` | `on_hand − reserved` (raw CTE) | 중복 (뷰를 명시적으로 거부) |
| `batch-controlled-stock.guard.ts:76` | `on_hand − batch_controlled` (로케이션 grain) | **다른 grain — 통합 대상 아님** |
| `barcode.service.ts:107` | `on_hand` 합 (예약 미차감) | **죽은 코드** (호출자 0) |

`transit_out` 에 대해 조사에서 추가로 드러난 것:

1. 출발 창고에서만 차감하고 도착 창고에 더하지 않는다. 판매가능수량은 전 창고를 합산하므로(`product-sellable-quantity.service.ts:139`, 창고 필터 없음), **사내 이동 계획을 잡는 것만으로 회사 전체 판매가능수량이 줄어든다.**
2. `transit_out` 은 `inbound_plan_items` 를 읽는데, 실제 창고간이동은 `stock_journals`(`sourceType: 'warehouse_transfer'`)를 쓴다. `transfer.service.ts` 에 `inboundPlan` 이라는 단어가 **0회** 등장한다 — 두 시스템은 연결돼 있지 않다. 따라서 이동이 실행돼도 `transit_out` 은 줄지 않고 **영구히** 차감된 채 남는다.
3. `IN_TRANSFER` 원장 상태는 `transferShip`/`transferReceive` 가 **한 트랜잭션 안**에서 실행되므로 잔량이 남지 않는다(`stock-event.service.ts:117-156`, 통합 스펙 `transfer.service.integration.spec.ts:18` 이 "IN_TRANSFER 잔량 0"을 성공 기준으로 명시). 즉 원장에 "운송 중"이라는 기간이 없다.

**오버셀 위험 없음 (중요):** 예약 승인은 `unified-reservation.service.ts:81` → `getAvailableStock`(`:249`)이 판정하며 **애초에 `transit_out` 을 보지 않는다.** 뷰에서 `transit_out` 을 빼는 것은 예약 승인 문턱을 전혀 건드리지 않고, storefront 표시를 예약 seam 이 실제로 허용하는 값과 일치시킬 뿐이다.

### 선행 시도의 흔적

`shared/shared.module.ts:7,25,35` 에 `StockAvailabilityService` 가 **주석 처리**된 채 남아 있다. 과거에 Nest 프로바이더로 같은 통합을 시도했다가 중단된 흔적이다. 이 계획이 순수 함수 모듈을 택한 이유가 이것이다 — `reservation-invariant.ts` 헤더 주석이 밝히듯 *"core↔store 순환을 피하려고 추출"* 한 선례가 이미 작동 중이다. Task 1 에서 이 죽은 주석도 함께 제거한다.

## 범위 밖 (명시적 제외)

- **창고간이동 custody 모델 신설.** 이동 기간 동안 재고를 작업에 묶는 모델(출고작업의 `batch_inventory_sessions` 에 해당하는 것)이 창고간이동에는 없다. 별도 설계가 필요하며 이 계획은 그 자리를 비워둘 뿐 채우지 않는다.
- **custody 오버레이의 창고 grain 확장.** `batch-controlled-stock.guard.ts` 는 `sourceLocationId` 필수(로케이션 grain)이고 가용재고는 창고 grain 이다. 숏피킹으로 예약이 해제되고 custody 가 `RETURN_PENDING` 으로 남는 구간에 "예약 가능하지만 피킹 시점에 `BATCH_CONTROLLED_STOCK` 409" 가 나는 틈이 있다. 이 계획은 그 틈을 **좁히지 않는다.** Task 1 이 만드는 모듈이 나중에 그 오버레이가 들어갈 자리가 된다.
- **`BatchControlledStockGuard` 의 `new BatchControlledStockGuard()` 기본 인자 제거** (`stock-event.store.ts:74`, `inventory-command.service.ts:23`, `location-resolution.strategy.ts:29`). 별건 정리.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `inventory/shared/availability/warehouse-availability.ts` (신설) | 창고 grain 가용재고의 **유일한 정의**. 순수 계산 함수 + 단일 statement 원자 판독. |
| `inventory/shared/availability/warehouse-availability.spec.ts` (신설) | 순수 계산 함수 단위 테스트. |
| `inventory/shared/availability/warehouse-availability.integration.spec.ts` (신설) | 판독 함수의 실 DB 검증 + **뷰·야간대사와의 등가성 고정**. |
| `inventory/shared/locks/reservation-invariant.ts` (수정) | 판독을 모듈에 위임. 불변식 술어를 모듈의 계산 함수로 표현. |
| `inventory/shared/services/unified-reservation.service.ts` (수정) | `getAvailableStock` 을 모듈 위임으로 축소. |
| `inventory/shared/services/barcode.service.ts` (수정) | 죽은 `scanSku` 삭제. |
| `inventory/schema/inventory.schema.ts` (수정) | 뷰 `available_qty` 에서 `transit_out` 항 제거. |
| `apps/core/drizzle/<ts>_drop-transit-out-from-available-qty.sql` (생성) | 뷰 재정의 마이그레이션. |
| `inventory/core/services/ledger-reconciliation.service.ts` (수정) | 낡은 주석 갱신. CTE 자체는 유지(전 카탈로그 집합 스캔이라 스칼라 함수로 대체 불가). |

---

## Task 1: 가용재고 모듈 신설

호출자를 하나도 바꾸지 않는다. 정의를 담을 자리를 먼저 만들고 테스트로 고정한다.

**Files:**
- Create: `apps/core/src/modules/inventory/shared/availability/warehouse-availability.ts`
- Create: `apps/core/src/modules/inventory/shared/availability/warehouse-availability.spec.ts`
- Create: `apps/core/src/modules/inventory/shared/availability/warehouse-availability.integration.spec.ts`
- Modify: `apps/core/src/modules/inventory/shared/shared.module.ts:7,25,35` (죽은 `StockAvailabilityService` 주석 제거)

**Interfaces:**
- Consumes: `DbTx`, `wmsTables`, `wmsSchema` from `apps/core/src/modules/inventory/schema/inventory.schema`
- Produces:
  - `interface WarehouseAvailability { onHand: number; reserved: number; available: number }`
  - `function computeAvailable(onHand: number, reserved: number): number`
  - `function violatesAvailability(onHand: number, reserved: number, removingQty: number): boolean`
  - `async function readWarehouseAvailability(trx: DbTx, skuId: string, warehouseId: string): Promise<WarehouseAvailability>`

- [ ] **Step 1: 실패하는 단위 테스트를 쓴다**

Create `apps/core/src/modules/inventory/shared/availability/warehouse-availability.spec.ts`:

```typescript
import { computeAvailable, violatesAvailability } from './warehouse-availability';

describe('computeAvailable — 가용재고 정본 정의', () => {
  it('가용 = ON_HAND 합 − confirmed 예약 합', () => {
    expect(computeAvailable(10, 4)).toBe(6);
  });

  it('예약이 ON_HAND 를 넘으면 음수를 그대로 반환한다 (clamp 는 호출자 책임)', () => {
    expect(computeAvailable(3, 5)).toBe(-2);
  });

  it('예약이 0 이면 ON_HAND 그대로', () => {
    expect(computeAvailable(7, 0)).toBe(7);
  });
});

describe('violatesAvailability — 차감 가능 여부', () => {
  it('차감 후 가용이 음수가 되면 위반', () => {
    expect(violatesAvailability(10, 6, 5)).toBe(true); // (10-5) - 6 = -1
  });

  it('차감 후 가용이 정확히 0 이면 통과', () => {
    expect(violatesAvailability(10, 6, 4)).toBe(false); // (10-4) - 6 = 0
  });

  it('예약 0 이면 ON_HAND 전량 차감이 통과', () => {
    expect(violatesAvailability(10, 0, 10)).toBe(false);
  });

  it('차감 0 은 예약이 이미 초과 상태여도 통과한다 (새 위반을 만들지 않으므로)', () => {
    expect(violatesAvailability(3, 5, 0)).toBe(true);
  });
});
```

마지막 케이스는 **현재 동작을 그대로 기술한 것**이다. `reservation-invariant.ts:31` 의 `onHandSum - removingQty < reservedSum` 은 `removingQty=0` 이고 이미 초과 상태(3 < 5)면 `true` 를 낸다. Task 2 가 동작을 바꾸지 않음을 이 케이스가 보장한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="warehouse-availability\.spec" --runInBand
```

Expected: FAIL — `Cannot find module './warehouse-availability'`

- [ ] **Step 3: 모듈을 구현한다**

Create `apps/core/src/modules/inventory/shared/availability/warehouse-availability.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { DbTx } from '../../schema/inventory.schema';

/**
 * 창고 grain 가용재고의 유일한 정의.
 *
 * 정본 규칙 (CLAUDE.md · ADR-0001): 가용재고 = ON_HAND 원장 합 − confirmed 예약 합.
 * 다른 항(이동예정·입고예정 등)을 여기에 더하거나 빼지 않는다. 다른 관점이 필요하면
 * 조용한 변형이 아니라 이름 붙은 별도 판독으로 만든다.
 *
 * Nest 프로바이더가 아니라 순수 함수 leaf 다 — core↔store DI 순환을 피하려고
 * `shared/locks/reservation-invariant.ts` 가 이미 택한 형태를 따른다.
 */
export interface WarehouseAvailability {
  onHand: number;
  reserved: number;
  available: number;
}

/** 정본 산식. 음수를 clamp 하지 않는다 — 표시용 clamp 는 호출자 책임이다. */
export function computeAvailable(onHand: number, reserved: number): number {
  return onHand - reserved;
}

/** `removingQty` 만큼 ON_HAND 를 빼면 가용이 음수가 되는가. */
export function violatesAvailability(onHand: number, reserved: number, removingQty: number): boolean {
  return computeAvailable(onHand - removingQty, reserved) < 0;
}

interface AvailabilityRow {
  on_hand: number | string;
  reserved: number | string;
}

/**
 * 창고 grain ON_HAND 원장 합·confirmed 예약 합을 **단일 statement** 로 읽는다.
 *
 * 두 값을 각각 읽으면 READ COMMITTED 에서 그 사이에 SHIP 소진이 커밋될 수 있어
 * torn read(초과예약)가 난다. 한 statement 안의 두 스칼라 서브쿼리는 같은 스냅샷을 본다.
 */
export async function readWarehouseAvailability(
  trx: DbTx,
  skuId: string,
  warehouseId: string,
): Promise<WarehouseAvailability> {
  // execute() 원시 결과 타이핑 — reservation-invariant.ts / ledger-reconciliation.service.ts 와
  // 동일한 문서화된 캐스트.
  const rows = (await trx.execute(sql`
    SELECT
      COALESCE((SELECT SUM(qty) FROM stock_ledgers
                 WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND stock_state = 'ON_HAND'), 0) AS on_hand,
      COALESCE((SELECT SUM(quantity) FROM stock_reservations
                 WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND status = 'confirmed'), 0) AS reserved
  `)) as unknown as AvailabilityRow[];

  const onHand = Number(rows[0]?.on_hand ?? 0);
  const reserved = Number(rows[0]?.reserved ?? 0);
  return { onHand, reserved, available: computeAvailable(onHand, reserved) };
}
```

- [ ] **Step 4: 단위 테스트 통과를 확인한다**

```bash
npx jest --testPathPattern="warehouse-availability\.spec" --runInBand
```

Expected: PASS (7 tests)

- [ ] **Step 5: 통합 테스트를 쓴다**

Create `apps/core/src/modules/inventory/shared/availability/warehouse-availability.integration.spec.ts`:

```typescript
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { seedPickableShipment } from '../../../fulfillment/services/__support__/logistics-fixtures';
import { readWarehouseAvailability } from './warehouse-availability';

/**
 * 가용재고 정본 판독의 실 DB 검증. rollback 전용 트랜잭션.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-availability.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('readWarehouseAvailability (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  const inRollback = async (fn: (trx: DbTx) => Promise<void>) => {
    await db
      .transaction(async (t) => {
        await fn(t as unknown as DbTx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  };

  /**
   * ON_HAND 원장 + confirmed 예약을 심고 grain 을 돌려준다.
   *
   * 예약을 손으로 INSERT 하지 않는 이유: `stock_reservations.shipment_line_id` 가
   * NOT NULL + FK → `shipment_lines` 라(Task 25 계약) 유효한 예약 하나에
   * fulfillment_orders → items → shipments → shipment_lines 4단 체인이 필요하다.
   * `seedPickableShipment` 이 그 체인 + ON_HAND 원장 + confirmed 예약을 한 번에 만든다.
   */
  const seed = async (
    trx: DbTx,
    opts: { onHand: number; reserved: number },
  ): Promise<{ skuId: string; warehouseId: string; locationId: string }> => {
    const fx = await seedPickableShipment(trx, opts.onHand);
    // 픽스처는 예약 = ON_HAND 로 심는다. 원하는 예약 수량으로 낮추거나(0 이면 삭제) 맞춘다.
    if (opts.reserved === 0) {
      await trx
        .delete(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fx.shipmentLineId));
    } else if (opts.reserved !== opts.onHand) {
      await trx
        .update(wmsTables.stockReservations)
        .set({ quantity: opts.reserved })
        .where(eq(wmsTables.stockReservations.shipmentLineId, fx.shipmentLineId));
    }
    return { skuId: fx.skuId, warehouseId: fx.warehouseId, locationId: fx.locationId };
  };

  it('ON_HAND 합 − confirmed 예약 합을 반환한다', async () => {
    await inRollback(async (trx) => {
      const { skuId, warehouseId } = await seed(trx, { onHand: 10, reserved: 4 });
      const result = await readWarehouseAvailability(trx, skuId, warehouseId);
      expect(result).toEqual({ onHand: 10, reserved: 4, available: 6 });
    });
  });

  it('원장도 예약도 없으면 0 을 반환한다 (null 이 아니라)', async () => {
    await inRollback(async (trx) => {
      const result = await readWarehouseAvailability(trx, randomUUID(), randomUUID());
      expect(result).toEqual({ onHand: 0, reserved: 0, available: 0 });
    });
  });

  it('released 예약은 차감하지 않는다', async () => {
    await inRollback(async (trx) => {
      const { skuId, warehouseId } = await seed(trx, { onHand: 10, reserved: 4 });
      await trx
        .update(wmsTables.stockReservations)
        .set({ status: 'released' })
        .where(eq(wmsTables.stockReservations.skuId, skuId));
      const result = await readWarehouseAvailability(trx, skuId, warehouseId);
      expect(result.available).toBe(10);
    });
  });

  it('ON_HAND 가 아닌 원장 상태는 합산하지 않는다', async () => {
    await inRollback(async (trx) => {
      const { skuId, warehouseId, locationId } = await seed(trx, { onHand: 10, reserved: 0 });
      await trx.insert(wmsTables.stockLedgers).values({
        skuId,
        warehouseId,
        locationId,
        stockState: 'DEFECTIVE',
        qty: 99,
      });
      const result = await readWarehouseAvailability(trx, skuId, warehouseId);
      expect(result.onHand).toBe(10);
    });
  });
});
```

> **주의:** `seedPickableShipment` 의 반환 필드 이름을 실제 시그니처에서 확인하고 맞춘다
> (`apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.ts` 의
> `PickableShipmentFixture`). 픽스처가 만드는 것: warehouse · holder · deliveryProfile · sku ·
> location · **ON_HAND `stock_ledgers` qty** · **confirmed `stock_reservations` quantity** ·
> batch · work item · waybill. 전부 rollback 트랜잭션 안이라 DB 에 남지 않는다.

- [ ] **Step 6: 통합 테스트를 돌린다**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-availability.integration
```

러너가 compose postgres 기동과 마이그레이션까지 처리한다.

Expected: PASS (4 tests). NOT NULL 위반이 나면 Step 5 주의사항대로 `seed()` 를 고치고 다시 돌린다.

- [ ] **Step 7: 죽은 `StockAvailabilityService` 주석을 제거한다**

`apps/core/src/modules/inventory/shared/shared.module.ts` 에서 세 줄을 삭제한다:

```typescript
// import { StockAvailabilityService } from './services/stock-availability.service';   ← 삭제 (line 7)
    // StockAvailabilityService,                                                       ← 삭제 (providers, line 25)
    // StockAvailabilityService,                                                       ← 삭제 (exports, line 35)
```

이제 그 자리를 이 모듈이 채웠으므로 주석은 오해만 남긴다.

- [ ] **Step 8: 타입체크 후 커밋**

```bash
npx nest build core
```

Expected: 성공 (에러 0)

```bash
git add apps/core/src/modules/inventory/shared/availability/ \
        apps/core/src/modules/inventory/shared/shared.module.ts
git commit -m "feat(inventory): 가용재고 정본 정의를 소유할 모듈 신설

창고 grain 가용재고 = ON_HAND 원장 합 − confirmed 예약 합 (ADR-0001).
호출자는 아직 바꾸지 않는다 — 정의를 담을 자리를 먼저 만들고 테스트로 고정.
중단된 StockAvailabilityService 주석은 이 모듈이 대체하므로 제거."
```

---

## Task 2: `reservation-invariant` 를 모듈에 위임

**Files:**
- Modify: `apps/core/src/modules/inventory/shared/locks/reservation-invariant.ts` (전면)
- Modify: `apps/core/src/modules/inventory/shared/locks/reservation-invariant.spec.ts` (전면)

**Interfaces:**
- Consumes: `readWarehouseAvailability`, `violatesAvailability` (Task 1)
- Produces: 기존 export 이름 3개를 **그대로 유지**한다 — `readWarehouseReservationBalance`, `violatesReservationInvariant`, `assertReservationInvariant`. 호출처 5곳(`stock-event.store.ts:600`, `inventory-command.service.ts:325,566`, `stocktaking.service.ts:550`)을 건드리지 않기 위해서다.

- [ ] **Step 1: 기존 spec 을 모듈 위임 확인용으로 다시 쓴다**

Replace `apps/core/src/modules/inventory/shared/locks/reservation-invariant.spec.ts` 전체:

```typescript
import { violatesReservationInvariant } from './reservation-invariant';

// 이 술어는 이제 availability 모듈의 violatesAvailability 를 그대로 노출한다.
// 아래 케이스는 위임 전 동작을 그대로 기술한 것 — 위임이 동작을 바꾸지 않음을 고정한다.
describe('violatesReservationInvariant', () => {
  it('차감 후 ON_HAND 가 예약보다 적으면 위반', () => {
    expect(violatesReservationInvariant(10, 6, 5)).toBe(true); // 10-5=5 < 6
  });
  it('차감 후 ON_HAND 가 예약과 같으면 통과', () => {
    expect(violatesReservationInvariant(10, 6, 4)).toBe(false); // 10-4=6 >= 6
  });
  it('예약 0 이면 항상 통과', () => {
    expect(violatesReservationInvariant(10, 0, 10)).toBe(false);
  });
  it('차감 0 이어도 이미 초과 상태면 위반으로 본다', () => {
    expect(violatesReservationInvariant(3, 5, 0)).toBe(true);
  });
});
```

- [ ] **Step 2: 새 케이스가 실패하는지 확인한다**

```bash
npx jest --testPathPattern="reservation-invariant\.spec" --runInBand
```

Expected: PASS (4 tests) — 네 번째 케이스는 기존 구현으로도 통과한다. 이 단계는 **기존 동작을 고정하는 것**이 목적이므로 통과가 정상이다. 만약 실패하면 기존 동작을 잘못 읽은 것이니 Step 3 을 진행하지 말고 멈춘다.

- [ ] **Step 3: 위임으로 다시 쓴다**

Replace `apps/core/src/modules/inventory/shared/locks/reservation-invariant.ts` 전체:

```typescript
import { ConflictException } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { readWarehouseAvailability, violatesAvailability } from '../availability/warehouse-availability';

/**
 * 예약 불변식 — 가용재고 정의는 availability 모듈이 소유한다. 여기는 그 정의를
 * "ON_HAND 를 뺄 수 있는가"라는 질문으로 감싸는 얇은 층이다.
 *
 * export 이름은 호출처 5곳(stock-event.store · inventory-command · stocktaking)을
 * 건드리지 않으려고 유지한다.
 */

/** 창고 grain ON_HAND 원장 합·confirmed 예약 합 (단일 statement 원자 읽기 — torn read 방지). */
export async function readWarehouseReservationBalance(
  trx: DbTx,
  skuId: string,
  warehouseId: string,
): Promise<{ onHand: number; reserved: number }> {
  const { onHand, reserved } = await readWarehouseAvailability(trx, skuId, warehouseId);
  return { onHand, reserved };
}

/** 차감/이동 후 창고 ON_HAND 합이 confirmed 예약 합보다 적어지면 true. */
export function violatesReservationInvariant(onHandSum: number, reservedSum: number, removingQty: number): boolean {
  return violatesAvailability(onHandSum, reservedSum, removingQty);
}

/** 락 획득 후 호출. 창고 합산 예약 불변식 위반 시 409(ConflictException). */
export async function assertReservationInvariant(
  trx: DbTx,
  skuId: string,
  warehouseId: string,
  removingQty: number,
): Promise<void> {
  const { onHand, reserved } = await readWarehouseReservationBalance(trx, skuId, warehouseId);
  if (violatesReservationInvariant(onHand, reserved, removingQty)) {
    throw new ConflictException(
      `예약된 재고는 감소/이동할 수 없습니다. 창고 ON_HAND ${onHand} − ${removingQty} < 예약 ${reserved}`,
    );
  }
}
```

> 에러 메시지 문구는 **글자 그대로 유지**한다. 운영 로그·프론트 문자열 매칭이 있을 수 있다.

- [ ] **Step 4: 단위 테스트와 기존 통합 테스트를 돌린다**

```bash
npx jest --testPathPattern="reservation-invariant" --runInBand
```

Expected: PASS

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- unified-reservation.service.(lock|lifecycle).integration
```

Expected: PASS — 예약 생애주기·락 통합 스펙이 불변식 경로를 실제로 태운다.

- [ ] **Step 5: 커밋**

```bash
npx nest build core
git add apps/core/src/modules/inventory/shared/locks/reservation-invariant.ts \
        apps/core/src/modules/inventory/shared/locks/reservation-invariant.spec.ts
git commit -m "refactor(inventory): 예약 불변식 판독을 availability 모듈에 위임

산식 중복 1벌 제거. export 이름과 에러 문구는 유지 — 호출처 5곳 무변경."
```

---

## Task 3: `unified-reservation.getAvailableStock` 을 모듈에 위임

**Files:**
- Modify: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts:249-263`

**Interfaces:**
- Consumes: `readWarehouseAvailability` (Task 1)
- Produces: 없음 (private 메서드 내부 교체)

- [ ] **Step 1: 현재 동작을 고정하는 통합 테스트를 확인한다**

새 테스트를 쓰지 않는다. `unified-reservation.service.lifecycle.integration.spec.ts` 와 `.lock.integration.spec.ts` 가 이미 이 경로를 태운다. 먼저 초록인지 확인한다:

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- unified-reservation.service..*.integration
```

Expected: PASS. **여기서 실패하면 Task 3 을 진행하지 않는다** — 기준선이 없으면 위임의 안전성을 증명할 수 없다.

- [ ] **Step 2: private 메서드를 위임으로 교체한다**

`apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts:249-263` 의 `getAvailableStock` 본문 전체를 다음으로 바꾼다:

```typescript
  private async getAvailableStock(skuId: string, warehouseId: string, tx?: DbTx): Promise<number> {
    const db = tx ?? this.db.db;
    // 산식·단일 statement 원자성은 availability 모듈이 소유한다.
    const { available } = await readWarehouseAvailability(db as DbTx, skuId, warehouseId);
    return available;
  }
```

파일 상단 import 에 추가:

```typescript
import { readWarehouseAvailability } from '../availability/warehouse-availability';
```

> `db as DbTx` 캐스팅이 필요한 이유: 기존 코드가 `tx ?? this.db.db` 로 트랜잭션과 베이스
> 커넥션을 같은 변수에 담고 있다. `readWarehouseAvailability` 는 `DbTx` 를 받으므로 좁히기가
> 필요하다. **범위 밖 리팩터링을 하지 말 것** — 이 함수의 tx 전파 형태를 바꾸는 것은 별건이다.
> 캐스팅 위 주석으로 사유를 남긴다:
>
> ```typescript
> // 기존 시그니처 유지를 위한 좁히기 — 이 메서드의 tx 전파 형태 변경은 별건(ADR-0025).
> ```

- [ ] **Step 3: 통합 테스트를 다시 돌린다**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- unified-reservation.service..*.integration
```

Expected: PASS — Step 1 과 동일한 결과

- [ ] **Step 4: 커밋**

```bash
npx nest build core
git add apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts
git commit -m "refactor(inventory): 예약 승인 가용 판독을 availability 모듈에 위임

산식 중복 1벌 제거. 예약 승인 문턱은 불변."
```

---

## Task 4: 죽은 `barcode.scanSku` 삭제

`scanSku` 는 예약을 차감하지 않은 ON_HAND 합을 `availableQty` 라는 이름으로 반환한다. **호출자가 0곳**이므로 라이브 버그가 아니라 죽은 코드다. 고치는 게 아니라 지운다.

**Files:**
- Modify: `apps/core/src/modules/inventory/shared/services/barcode.service.ts:76-120` (메서드 삭제)

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 정말 죽었는지 다시 확인한다**

```bash
grep -rn "scanSku\|SkuScanResult" --include=*.ts apps/ | grep -v node_modules
```

Expected: `barcode.service.ts` 안의 선언만 나온다. **다른 파일이 하나라도 나오면 이 Task 를 건너뛰고 보고한다.**

- [ ] **Step 2: 메서드와 전용 타입을 삭제한다**

`apps/core/src/modules/inventory/shared/services/barcode.service.ts` 에서:
- `async scanSku(...)` 메서드 전체 (`:76` 부터 닫는 `}` 까지) 삭제
- `SkuScanResult` 인터페이스/타입 선언 삭제 (Step 1 에서 이 파일 안에만 있음을 확인했다)
- 삭제 후 쓰이지 않게 된 import 제거 (`nest build core` 가 잡아준다)

- [ ] **Step 3: 빌드로 미사용 참조가 없는지 확인한다**

```bash
npx nest build core
```

Expected: 성공 (에러 0)

```bash
npx jest --testPathPattern="barcode" --runInBand
```

Expected: PASS 또는 "no tests found" — 둘 다 정상

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/inventory/shared/services/barcode.service.ts
git commit -m "fix(inventory): 죽은 barcode.scanSku 삭제

예약을 차감하지 않은 ON_HAND 합을 availableQty 로 반환하던 메서드.
호출자 0곳이라 라이브 영향은 없었으나, 가용재고 산식의 잘못된 7번째 변형으로
되살아날 위험이 있어 제거한다."
```

---

## Task 5: 뷰 `available_qty` 에서 `transit_out` 제거

이 Task 만이 **라이브 동작을 바꾼다.** 마이그레이션 1건이 나온다.

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:982` (뷰 정의)
- Create: `apps/core/drizzle/<timestamp>_drop-transit-out-from-available-qty.sql` (생성됨)
- Create: `apps/core/src/modules/inventory/shared/availability/view-parity.integration.spec.ts`

**Interfaces:**
- Consumes: `readWarehouseAvailability` (Task 1)
- Produces: 없음 — 뷰의 컬럼 목록은 그대로다. `available_qty` 의 **값**만 바뀐다.

- [ ] **Step 1: 뷰와 모듈이 어긋나는 것을 증명하는 테스트를 쓴다**

Create `apps/core/src/modules/inventory/shared/availability/view-parity.integration.spec.ts`:

```typescript
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { readWarehouseAvailability } from './warehouse-availability';

/**
 * stock_summary_view.available_qty 가 가용재고 정본 정의와 일치하는지 고정한다.
 *
 * 이 스펙이 존재하는 이유: 뷰는 오래 `on_hand − reserved − transit_out` 이었고,
 * transit_out 은 (a) 출발 창고에서만 빼고 도착 창고에 더하지 않아 사내 이동만으로
 * 전사 판매가능수량을 줄였으며 (b) inbound_plan_items 를 읽는데 실제 창고간이동은
 * stock_journals 를 써서 이동이 끝나도 줄지 않았다. 그 항을 제거한 뒤,
 * 아무도 다시 넣지 못하게 이 테스트가 막는다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <이 파일의 패턴>
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stock_summary_view ↔ availability 모듈 등가 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  const inRollback = async (fn: (trx: DbTx) => Promise<void>) => {
    await db
      .transaction(async (t) => {
        await fn(t as unknown as DbTx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  };

  const readView = async (trx: DbTx, skuId: string, warehouseId: string): Promise<number> => {
    const rows = (await trx.execute(sql`
      SELECT available_qty FROM stock_summary_view
       WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId}
    `)) as unknown as { available_qty: number | string }[];
    return Number(rows[0]?.available_qty ?? 0);
  };

  it('이전 예정(pending 창고간 inbound plan)이 있어도 뷰와 모듈이 일치한다', async () => {
    await inRollback(async (trx) => {
      const skuId = randomUUID();
      const sourceWarehouseId = randomUUID();
      const destWarehouseId = randomUUID();
      const planId = randomUUID();

      await trx.execute(sql`
        INSERT INTO warehouses (id, name, code)
        VALUES (${sourceWarehouseId}, ${'IT-SRC'}, ${`IT-S-${sourceWarehouseId.slice(0, 6)}`}),
               (${destWarehouseId}, ${'IT-DST'}, ${`IT-D-${destWarehouseId.slice(0, 6)}`})
      `);
      await trx.execute(sql`
        INSERT INTO skus (id, name, code) VALUES (${skuId}, ${'IT-SKU'}, ${`IT-${skuId.slice(0, 8)}`})
      `);
      await trx.execute(sql`
        INSERT INTO stock_ledgers (sku_id, warehouse_id, stock_state, qty)
        VALUES (${skuId}, ${sourceWarehouseId}, 'ON_HAND', ${10})
      `);
      // 출발 창고 → 도착 창고 이전 예정 4개 (이것이 옛 transit_out 항을 만들던 데이터)
      await trx.execute(sql`
        INSERT INTO inbound_plans (id, warehouse_id, destination_warehouse_id, requires_transfer)
        VALUES (${planId}, ${sourceWarehouseId}, ${destWarehouseId}, true)
      `);
      await trx.execute(sql`
        INSERT INTO inbound_plan_items (plan_id, sku_id, expected_qty, received_qty, status)
        VALUES (${planId}, ${skuId}, ${4}, ${0}, 'pending')
      `);

      const fromModule = await readWarehouseAvailability(trx, skuId, sourceWarehouseId);
      const fromView = await readView(trx, skuId, sourceWarehouseId);

      expect(fromModule.available).toBe(10);
      expect(fromView).toBe(10); // 이전 예정은 가용에서 빼지 않는다
    });
  });

  it('예약이 있으면 뷰와 모듈이 같은 값을 낸다', async () => {
    await inRollback(async (trx) => {
      const skuId = randomUUID();
      const warehouseId = randomUUID();

      await trx.execute(sql`
        INSERT INTO warehouses (id, name, code)
        VALUES (${warehouseId}, ${'IT-WH'}, ${`IT-${warehouseId.slice(0, 8)}`})
      `);
      await trx.execute(sql`
        INSERT INTO skus (id, name, code) VALUES (${skuId}, ${'IT-SKU'}, ${`IT-${skuId.slice(0, 8)}`})
      `);
      await trx.execute(sql`
        INSERT INTO stock_ledgers (sku_id, warehouse_id, stock_state, qty)
        VALUES (${skuId}, ${warehouseId}, 'ON_HAND', ${10})
      `);
      await trx.execute(sql`
        INSERT INTO stock_reservations (sku_id, warehouse_id, quantity, status, target_type)
        VALUES (${skuId}, ${warehouseId}, ${3}, 'confirmed', 'SHIPMENT_LINE')
      `);

      const fromModule = await readWarehouseAvailability(trx, skuId, warehouseId);
      const fromView = await readView(trx, skuId, warehouseId);

      expect(fromView).toBe(fromModule.available);
      expect(fromView).toBe(7);
    });
  });
});
```

> `inbound_plans` / `inbound_plan_items` 의 INSERT 컬럼도 Task 1 Step 5 와 같은 방식으로
> 스키마의 NOT NULL 컬럼을 확인해 보완한다.

- [ ] **Step 2: 첫 번째 테스트가 실패하는지 확인한다**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- view-parity.integration
```

Expected: 첫 테스트 FAIL — `expect(fromView).toBe(10)` 이 `6` 을 받는다 (10 − 0 − 4). 두 번째 테스트는 PASS.

**이 실패가 `transit_out` 버그의 재현이다.** 실패 출력을 확인하고 넘어간다.

- [ ] **Step 3: 뷰 정의에서 `transit_out` 항을 뺀다**

`apps/core/src/modules/inventory/schema/inventory.schema.ts:982` 한 줄을 바꾼다:

```sql
-- 변경 전
COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) - COALESCE(transit_out.qty, 0) as available_qty,

-- 변경 후
COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) as available_qty,
```

**`transit_out` 서브쿼리와 `transfer_pending_qty` 컬럼(`:987`)은 그대로 둔다.** 표시용 정보로서는 유효하고, 컬럼을 없애면 destructive 변경이 되어 expand-contract 분할이 필요해진다(ADR-0005 §5). 이 Task 는 `available_qty` 의 **값**만 바꾼다.

`:982` 바로 위에 주석을 추가한다:

```sql
-- 가용재고 = ON_HAND 합 − confirmed 예약 합 (ADR-0001).
-- transit_out 을 다시 빼지 말 것: 출발 창고에서만 빠지고 도착 창고에 더해지지 않아
-- 사내 이동만으로 전사 판매가능수량이 줄고, inbound_plan_items 기반이라 실제 이동
-- (stock_journals)이 끝나도 줄지 않는다. 등가성은 view-parity.integration.spec.ts 가 고정한다.
```

- [ ] **Step 4: 마이그레이션을 생성하고 SQL 을 검토한다**

```bash
npm run db:generate:core -- --name drop-transit-out-from-available-qty
```

생성된 `apps/core/drizzle/<timestamp>_drop-transit-out-from-available-qty.sql` 을 연다.

**drizzle-kit 이 뷰 변경을 감지하지 못해 빈 파일이거나 뷰 문이 없을 수 있다.** 그런 경우 이 마이그레이션은 **아직 어디에도 적용되지 않았으므로** 직접 SQL 을 작성해 넣는다 (CLAUDE.md 의 "이미 적용된 마이그레이션을 손대지 말라"는 규칙은 미적용 파일에는 해당하지 않는다):

```sql
DROP VIEW IF EXISTS stock_summary_view;
CREATE VIEW stock_summary_view AS
-- inventory.schema.ts 의 stockSummary 정의와 글자 그대로 같은 SELECT 를 붙여넣는다
```

붙여넣을 SELECT 는 `inventory.schema.ts` 의 `pgView('stock_summary_view', {...}).as(sql\`...\`)` 안 내용이다. **schema.ts 와 마이그레이션 SQL 이 한 글자도 다르지 않아야 한다** — 다르면 Step 5 의 등가 테스트가 잡아준다.

- [ ] **Step 5: 마이그레이션을 적용하고 테스트를 다시 돌린다**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- view-parity.integration
```

러너가 jest 전에 `drizzle-kit migrate` 를 돌리므로 새 마이그레이션이 자동 적용된다.

Expected: PASS (2 tests)

> ⚠️ 로컬 `core` DB 는 재사용되는 실 DB 다(throwaway 아님). 뷰 재정의는 `DROP VIEW` → `CREATE VIEW`
> 이므로 되돌리려면 마이그레이션을 되돌려야 한다. 이 Task 를 되감아야 하면
> `docker compose down -v && docker compose up -d && npm run db:migrate:local` 로 초기화한다.

- [ ] **Step 6: 뷰를 읽는 다른 경로의 회귀를 확인한다**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- (product-sellable-quantity|logistics|fulfillment).*integration
```

Expected: PASS. 실패가 나면 **`transit_out` 을 되돌리지 말고** 실패 내용을 보고한다 — 어떤 스펙이 옛 산식을 전제하고 있었다는 뜻이고, 그 전제 자체가 검토 대상이다.

- [ ] **Step 7: 커밋 (schema + migration 한 커밋)**

```bash
npx nest build core
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle/ \
        apps/core/src/modules/inventory/shared/availability/view-parity.integration.spec.ts
git commit -m "fix(inventory): stock_summary_view.available_qty 에서 transit_out 차감 제거

transit_out 은 (1) 출발 창고에서만 빠지고 도착 창고에 더해지지 않아 사내 이동만으로
전사 판매가능수량이 줄었고, (2) inbound_plan_items 를 읽는데 실제 창고간이동은
stock_journals 를 써서 이동이 끝나도 줄지 않았다.

예약 승인은 unified-reservation 이 자체 산식으로 판정하며 애초에 transit_out 을
보지 않았다 — 따라서 승인 문턱은 불변이고 오버셀 위험은 없다. storefront 표시가
예약 seam 이 실제로 허용하는 값과 일치하게 된다.

transfer_pending_qty 표시 컬럼은 유지(ADR-0005 §5 destructive 회피)."
```

---

## Task 6: 야간 대사 CTE 를 등가 테스트로 고정

`ledger-reconciliation.reconcileReservations` 의 CTE 는 전 카탈로그 집합 스캔이라 (sku, warehouse) 단위 스칼라 함수로 대체할 수 없다. 중복은 남기되, **조용히 갈라지는 것은 막는다.**

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts:150-151` (주석)
- Create: `apps/core/src/modules/inventory/shared/availability/reconciliation-parity.integration.spec.ts`

**Interfaces:**
- Consumes: `readWarehouseAvailability` (Task 1), `LedgerReconciliationService.reconcileReservations`
- Produces: 없음

- [ ] **Step 1: 등가 테스트를 쓴다**

Create `apps/core/src/modules/inventory/shared/availability/reconciliation-parity.integration.spec.ts`:

```typescript
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { readWarehouseAvailability } from './warehouse-availability';
import { LedgerReconciliationService } from '../../core/services/ledger-reconciliation.service';

/**
 * 야간 대사의 CTE 와 availability 모듈이 같은 결론을 내는지 고정한다.
 *
 * CTE 는 전 카탈로그 집합 스캔이라 (sku,warehouse) 스칼라 함수로 대체할 수 없다.
 * 따라서 중복 자체는 남기고, 두 산식이 갈라지는 것만 이 테스트가 막는다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <이 파일의 패턴>
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('야간 대사 CTE ↔ availability 모듈 등가 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  const inRollback = async (fn: (trx: DbTx) => Promise<void>) => {
    await db
      .transaction(async (t) => {
        await fn(t as unknown as DbTx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  };

  const buildService = (trx: DbTx): LedgerReconciliationService => {
    // ADR-0025 단일 러너 최소 대역: spec 은 항상 rollback tx 를 전파한다.
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    return new LedgerReconciliationService(dbService, { setReservationDrift: () => undefined } as never);
  };

  const seedOverReserved = async (trx: DbTx): Promise<{ skuId: string; warehouseId: string }> => {
    const skuId = randomUUID();
    const warehouseId = randomUUID();
    await trx.execute(sql`
      INSERT INTO warehouses (id, name, code)
      VALUES (${warehouseId}, ${'IT-WH'}, ${`IT-${warehouseId.slice(0, 8)}`})
    `);
    await trx.execute(sql`
      INSERT INTO skus (id, name, code) VALUES (${skuId}, ${'IT-SKU'}, ${`IT-${skuId.slice(0, 8)}`})
    `);
    await trx.execute(sql`
      INSERT INTO stock_ledgers (sku_id, warehouse_id, stock_state, qty)
      VALUES (${skuId}, ${warehouseId}, 'ON_HAND', ${2})
    `);
    await trx.execute(sql`
      INSERT INTO stock_reservations (sku_id, warehouse_id, quantity, status, target_type)
      VALUES (${skuId}, ${warehouseId}, ${5}, 'confirmed', 'SHIPMENT_LINE')
    `);
    return { skuId, warehouseId };
  };

  it('모듈이 음수 가용을 보는 grain 을 대사도 drift 로 잡는다', async () => {
    await inRollback(async (trx) => {
      const { skuId, warehouseId } = await seedOverReserved(trx);

      const fromModule = await readWarehouseAvailability(trx, skuId, warehouseId);
      expect(fromModule.available).toBe(-3);

      const report = await buildService(trx).reconcileReservations({ skuId, warehouseId }, trx);

      expect(report.totalDriftGrains).toBe(1);
      expect(report.drifts[0]).toMatchObject({
        skuId,
        warehouseId,
        onHandQty: fromModule.onHand,
        reservedQty: fromModule.reserved,
        shortfall: -fromModule.available,
      });
    });
  });

  it('모듈 가용이 0 이상이면 대사는 아무것도 잡지 않는다', async () => {
    await inRollback(async (trx) => {
      const skuId = randomUUID();
      const warehouseId = randomUUID();
      await trx.execute(sql`
        INSERT INTO warehouses (id, name, code)
        VALUES (${warehouseId}, ${'IT-WH'}, ${`IT-${warehouseId.slice(0, 8)}`})
      `);
      await trx.execute(sql`
        INSERT INTO skus (id, name, code) VALUES (${skuId}, ${'IT-SKU'}, ${`IT-${skuId.slice(0, 8)}`})
      `);
      await trx.execute(sql`
        INSERT INTO stock_ledgers (sku_id, warehouse_id, stock_state, qty)
        VALUES (${skuId}, ${warehouseId}, 'ON_HAND', ${5})
      `);
      await trx.execute(sql`
        INSERT INTO stock_reservations (sku_id, warehouse_id, quantity, status, target_type)
        VALUES (${skuId}, ${warehouseId}, ${5}, 'confirmed', 'SHIPMENT_LINE')
      `);

      const fromModule = await readWarehouseAvailability(trx, skuId, warehouseId);
      expect(fromModule.available).toBe(0);

      const report = await buildService(trx).reconcileReservations({ skuId, warehouseId }, trx);
      expect(report.totalDriftGrains).toBe(0);
    });
  });
});
```

> `LedgerReconciliationService` 의 생성자 인자 개수·순서를 실제 파일에서 확인하고
> `buildService` 를 맞춘다. 메트릭 대역의 메서드 이름도 실제 것으로 바꾼다
> (`ledger-reconciliation.service.ts` 의 `this.metrics.` 호출을 보고 결정).

- [ ] **Step 2: 테스트를 돌린다**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- reconciliation-parity.integration
```

Expected: PASS (2 tests). 생성자 대역이 안 맞으면 Step 1 주의사항대로 고치고 다시 돌린다.

- [ ] **Step 3: 낡은 주석을 갱신한다**

`ledger-reconciliation.service.ts:150-151` 의 주석을 바꾼다:

```typescript
  /**
   * (sku,warehouse) 예약 불변식 대사 — ON_HAND 원장 합 < confirmed 예약 합 grain 만 반환.
   *
   * 전 카탈로그 집합 스캔이라 (sku,warehouse) 스칼라 판독인 availability 모듈로
   * 대체하지 않는다. 두 산식이 같은 결론을 내는지는
   * shared/availability/reconciliation-parity.integration.spec.ts 가 고정한다.
   */
```

기존의 *"raw 합 직접 집계(뷰 availableQty 의 transit_out 반영 금지 → 거짓 경보 방지)"* 는 Task 5 로 근거가 사라졌으므로 지운다.

- [ ] **Step 4: 커밋**

```bash
npx nest build core
git add apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts \
        apps/core/src/modules/inventory/shared/availability/reconciliation-parity.integration.spec.ts
git commit -m "test(inventory): 야간 대사 CTE 와 availability 모듈의 등가를 고정

집합 스캔이라 스칼라 모듈로 대체 불가 — 중복은 남기되 조용한 분기를 막는다.
transit_out 회피를 근거로 들던 낡은 주석 제거(Task 5 로 근거 소멸)."
```

---

## 마무리: 전체 검증

- [ ] **Step 1: 전체 단위 테스트**

```bash
npx jest --testPathPattern="apps/core/src/modules/inventory" --runInBand
```

Expected: PASS

- [ ] **Step 2: 전체 통합 테스트**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/(inventory|fulfillment).*integration
```

Expected: PASS

- [ ] **Step 3: 빌드 · 타입체크 · 린트**

```bash
npx nest build core
npm run type-check
npm run lint
```

Expected: `nest build core` 에러 0.

`npm run type-check` 는 **기존 부채가 남아 있어 0 이 아니다.** 절대 수치를 외워서 비교하지 말고, 작업 시작 전 `git stash && npm run type-check 2>&1 | tail -1` 로 기준선을 직접 재고 그 값과 비교한다. 이 작업이 **늘리지 않았는지**만 확인하면 된다. (`tail` 로 자른 출력에 개수를 매기지 말 것 — 과거 그 착각으로 오보한 적이 있다.)

- [ ] **Step 4: 산식이 정말 줄었는지 센다**

```bash
grep -rn "stock_state = 'ON_HAND'" --include=*.ts apps/core/src/modules/inventory | grep -i "reserv" 
```

Expected: `warehouse-availability.ts` 와 `ledger-reconciliation.service.ts` 두 곳만. 다른 파일이 나오면 놓친 산식이다.

---

## 배포 노트

**마이그레이션 1건** (Task 5). `apps/core/drizzle/<ts>_drop-transit-out-from-available-qty.sql`.

**순서: `migrate → deploy`.**

- 뷰의 **컬럼 목록은 그대로**이므로 옛 task 가 새 뷰를 만나도 깨지지 않는다 (`available_qty` 값만 커진다). expand phase 규칙(CLAUDE.md: "expand 는 migrate → deploy")이 적용된다.
- 반대 순서로 하면 새 코드(등가 테스트 전제)가 옛 뷰를 만난다 — 런타임에 깨지진 않지만 무의미한 창이 생긴다.

**적용 명령** (AWS `dev` stage 는 폐기됐으므로 live 기준):

```bash
npm run db:migrate -- --stage live --deployment lcnine-services --yes
```

그 다음 `sst deploy`.

**배포 후 관측 항목:**

1. **판매가능수량 상승.** `transit_out > 0` 이던 SKU 의 storefront 노출 수량이 오른다. 상승분 = 그 SKU 의 pending 창고간 inbound plan 잔량. 이건 의도된 변화다.
2. **오버셀 없음 확인.** 예약 승인은 `unified-reservation` 이 자체 산식으로 하며 transit_out 을 본 적이 없다. 배포 후 `ledger-reconciliation` 야간 대사(`0 3 * * *`)의 `totalDriftGrains` 가 0 을 유지하는지 확인한다. 올라가면 이 전제가 틀린 것이므로 즉시 보고.
3. **예약 재시도 워커.** `fulfillment-order-reservation-retry.worker.ts:84` 가 `available_qty > 0` 로 후보를 고른다. 후보 수가 늘 수 있다 — 정상이다(전에는 transit_out 때문에 부당하게 탈락하던 라인들).
4. **발주 제안.** `purchase-order.service.ts:822` 의 `available_qty < 10` 조건에 걸리는 SKU 가 준다 — 정상이다(전에는 부풀려진 부족분이었다).

**롤백:** 뷰를 되돌리는 역마이그레이션은 만들지 않는다. 문제가 생기면 원인을 먼저 규명한다 — `transit_out` 복원은 위 4가지 결함을 되살리는 것이라 롤백이 아니라 회귀다.

---

## 후속 (별건)

1. **창고간이동 custody 모델.** 이동 기간 동안 재고를 작업에 묶는 모델이 없다. 출고작업의 `batch_inventory_sessions` 에 해당하는 것. 두 갈래 — (a) `transferShip`/`transferReceive` 를 트랜잭션 분리해 `IN_TRANSFER` 를 존속시키거나, (b) 세션 오버레이 방식. 설계 논의 필요.
2. **custody 오버레이의 창고 grain 확장.** 숏피킹으로 예약이 해제되고 custody 가 `RETURN_PENDING` 인 구간에 "예약은 되지만 피킹 때 409" 인 틈이 있다. Task 1 의 모듈이 이 오버레이가 들어갈 자리다.
3. **갇힌 batch 세션 탐지.** `recovery_required` 세션의 체류 시간을 보는 크론이 없다. 야간 대사의 `SESSION_CONSERVATION` 은 수량 보존만 보고 체류 시간을 보지 않아, 완벽히 보존된 채 영원히 열린 세션은 통과한다.
4. **`new BatchControlledStockGuard()` 기본 인자 제거** (3곳). 프로바이더 등록 누락이 조용히 통과하는 구조.
