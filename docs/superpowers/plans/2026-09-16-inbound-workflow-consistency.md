# 입고 대기 보호와 화면 상태 일관성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 일반 이동 등의 입고 대기 반출 우회를 막고, 취소/적치 후 재개하는 모든 입고 화면이 서버의 현재 상태를 표시하게 한다.

**Architecture:** 기존 입고 커널의 누계 변경을 원장 이동과 같은 트랜잭션에서 선행하고, 공통 원장 쓰기 경계에서 남은 입고 물량을 보호한다. 입고 조회 정책과 클라이언트 복구를 공유하며, 일반 이동은 명시적인 적치 동선으로 연결한다. 발주 정산과 현장 입고의 책임은 유지한다.

**Tech Stack:** NestJS, Drizzle/PostgreSQL, Jest, React, TanStack Query/Router, Vitest, IndexedDB, Tauri.

**Spec:** `docs/superpowers/specs/2026-09-16-inbound-workflow-consistency-design.md`

## Global Constraints

- 발주는 수령 정산을 소유하고 입고 커널은 현장 작업을 소유한다. ADR-0039의 의존 방향을 유지한다.
- 원장 변경·입고 누계·업무 로그·문서 정산은 호출자 소유의 같은 PostgreSQL 트랜잭션에서 커밋한다.
- v2 작업 키·원래 요청 본문·사용자/API 범위·확정 결과 재생 계약을 유지한다. 미확인 작업을 새 키로 바꾸지 않는다.
- 재고 정본은 stock_ledgers이며 입고 처리 정본은 inbound_receipt_lines와 해당 업무 기록이다. 둘을 현재 잔량만으로 서로 역산하지 않는다.
- 서버 권한과 창고 범위 검증을 유지한다. 클라이언트 플래그로 재고 보호를 우회하지 않는다.
- 작업자 화면에는 해야 할 행동을 한국어로 안내한다. HTTP 코드·내부 상태·DB 용어는 개발자 진단에 둔다.
- 기존 데이터는 자동 추정 보정하지 않는다. 이번 데이터 도구는 읽기 전용이며 운영 보정 실행은 범위 밖이다.
- 신규 외부 의존성·재고 상태 enum·영구 재고 사본·DB 테이블은 추가하지 않는다. Node 22와 저장소의 Yarn 명령을 사용한다.

## 시작 조건과 작업 순서

문서 기준은 `d18b1a940`이다. 구현 시작 시 `git status --short`, `git log -5 --oneline`으로 변경을 확인하고 관련 AGENTS.md를 읽는다. 아래 체크박스는 2026-09-16 구현·검증 결과를 반영한다. 파일별 최종 실행 수와 한계는 인수 기록에 남긴다.

순서: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**. 각 작업은 별도 커밋/검토 단위다. Task 2의 커널 변경과 최종 가드는 함께 검토·배포한다. 중간 커밋을 개별 운영 배포하지 않는다. capability는 Task 8까지 모든 서버 계약을 확인한 후에만 true로 공개한다.

DB 테스트는 `DATABASE_URL`이 명시된 전용 로컬 DB를 사용한다. 운영 `.env`를 읽어 DB를 고르지 않는다. 로컬 Postgres의 새 `inbound_workflow_consistency_test` DB에 `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/inbound_workflow_consistency_test corepack yarn drizzle-kit migrate --config apps/core/drizzle.config.ts`로 스키마를 준비한다. 이미 존재하는 DB는 지우지 말고 다른 전용 이름을 선택한다. 통합 검사 명령 앞에 이 URL을 붙이고 skip 0을 확인한다.

## 파일과 책임 지도

| 책임                       | 파일                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 입고 보호 수량 SQL/판정    | 신규 `apps/core/src/modules/inventory/shared/availability/inbound-origin-availability.ts`                                                                   |
| 최종 ON_HAND 감소 보호     | 기존 `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts`                                                                               |
| 누계·원장·로그 원자성      | 기존 `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts`                                                                             |
| 일반 이동/출고의 자유 수량 | 기존 `apps/core/src/modules/inventory/core/services/batch-controlled-stock.guard.ts`                                                                        |
| 현재 입고 라인 상태        | 신규 `apps/core/src/modules/inventory/inbound/services/inbound-receipt-state.reader.ts`, `inbound-receipt-policy.ts`, `../dto/inbound-receipt-state.dto.ts` |
| 앱의 현재 상태/복구        | 신규 `native/warehouse-app/src/domains/inbound/receiptState.ts`, `useReceiptReconciliation.ts`                                                              |
| 이동에서 적치로 연결       | 기존 movement/putaway 화면, routeTree, location contents 조회                                                                                               |
| 기존 불일치 대사           | 신규 `scripts/inventory/audit-inbound-origin-consistency.ts`, `docs/runbooks/inbound-origin-consistency.md`                                                 |

## Task 1: 입고 보호 수량의 공통 정의

**Files — Create:**

- `apps/core/src/modules/inventory/shared/availability/inbound-origin-availability.ts`
- `apps/core/src/modules/inventory/shared/availability/inbound-origin-availability.integration.spec.ts`

**Interfaces:**

```ts
export interface InboundOriginKey {
  skuId: string;
  warehouseId: string;
  sourceLocationId: string;
}
export interface InboundOriginAvailability {
  onHandQty: number;
  pendingQty: number;
  invalidReceipt: boolean;
}
export function readInboundOriginAvailability(tx: DbTx, input: InboundOriginKey): Promise<InboundOriginAvailability>;
export function assertInboundOriginRemovalAllowed(
  tx: DbTx,
  input: InboundOriginKey & { quantity: number },
): Promise<void>;
```

호출자가 stock availability lock을 보유해야 하는 assert와, 읽기 전용 조회에 사용할 read를 구분한다. helper는 서비스 DI나 입고 라인 잠금을 만들지 않는다. 일반 선반의 pendingQty는 0이다.

- [x] 기존 `inbound/services/__fixtures__/inbound-harness.ts`의 `makeInboundService`, `inRollbackTx`와 putaway reader spec의 창고/SKU/일반 zone fixture를 이용해 테스트를 작성한다. 다음 표를 데이터 케이스로 고정한다.

```ts
it.each([
  { quantity: 10, putaway: 6, canceled: 0, returned: 0, expected: 4 },
  { quantity: 10, putaway: 0, canceled: 10, returned: 0, expected: 0 },
  { quantity: 10, putaway: 0, canceled: 0, returned: 3, expected: 7 },
])('미처리 입고를 누계에서 계산한다: %j', async (c) => {
  // spec의 beforeEach에서 실제 회차/라인을 만들고 이 테스트의 tx/line/key를 보관한다.
  await tx
    .update(wmsTables.inboundReceiptLines)
    .set({
      quantity: c.quantity,
      putawayFromOriginQty: c.putaway,
      canceledQty: c.canceled,
      returnedQty: c.returned,
    })
    .where(eq(wmsTables.inboundReceiptLines.id, line.id));
  expect((await readInboundOriginAvailability(tx, key)).pendingQty).toBe(c.expected);
});
```

- [x] `corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/inventory/shared/availability/inbound-origin-availability.integration.spec.ts`를 실행해 신규 함수/동작 부재로 실패함을 확인한다.
- [x] 같은 SQL에서 posted·system origin 조건, 여러 라인 합산, 누락 원장=0, 잘못된 누계/원위치 판정을 구현한다. pending을 onHand로 clamp하지 않는다.

```ts
const current = await readInboundOriginAvailability(tx, input);
if (current.invalidReceipt || current.onHandQty < current.pendingQty)
  throw new ConflictException({ code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' });
if (current.onHandQty - input.quantity < current.pendingQty)
  throw new ConflictException({ code: 'INBOUND_ORIGIN_STOCK_PROTECTED' });
```

- [x] 같은 SKU의 두 입고 합산, 취소 회차 제외, 다른 창고/위치 제외, 일반 선반 직접입고 제외, 원장0/누락, 입고 없는 회수 재고를 검사한다. 위 명령 통과·skip 0 확인 후 `feat(inventory): define protected inbound origin quantity`로 커밋한다.

## Task 2: 커널 누계와 최종 재고 가드를 원자적으로 연결

**Files — Modify:**

- `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts`
- `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts`
- `apps/core/src/modules/inventory/core/services/batch-controlled-stock.guard.ts`
- `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts`
- `apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts`

**Files — Create:**

- `apps/core/src/modules/inventory/core/services/inbound-origin-protection.integration.spec.ts`
- `apps/core/src/modules/inventory/core/services/inbound-origin-protection.concurrency.integration.spec.ts`

**Interfaces:** Task 1의 read/assert를 사용한다. `BatchControlledStockAvailability`에 `inboundPendingQty: number`를 추가하고 `generallyAvailableQty = max(0, onHandQty - batchControlledQty - inboundPendingQty)`로 계산한다. 기존 getAvailability/assertRemovalAllowed 호출 계약을 유지한다. pending이 원인인 거절과 custody만 원인인 기존 거절 코드를 구분하고 보호 합계가 원장을 초과하면 불일치로 반환한다. 외부 DTO에 예외 옵션을 추가하지 않는다.

- [x] 원래 재현을 정상 기대값으로 바꾸어 일반 이동이 거절되는 검사를 추가한다. 실제 MovementService를 구성하고 db/run만 기존 테스트 adapter를 사용한다. 가드는 mock하지 않는다.

```ts
const before = await tx.select().from(wmsTables.stockEvents);
await expect(
  movement.moveImmediately({
    warehouseId: warehouse.id,
    idempotencyKey: randomUUID(),
    lines: [{ skuId: sku.id, fromLocationId: origin.id, toLocationId: shelf.id, quantity: 6 }],
  }),
).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_PROTECTED' } });
expect(await tx.select().from(wmsTables.stockEvents)).toEqual(before);
```

- [x] 신규 protection spec을 단독 실행해 현재는 이동이 성공하여 실패함을 확인한다.
- [x] applyProjection의 stock lock 취득 후 ON_HAND의 실제 출발 grain 순감소에 Task 1 assert를 적용한다. 같은 grain의 상쇄는 제외한다. 새 이벤트·reverseEvent·직접 호출 모두 통과시키고 기존 성공 재생의 early return은 유지한다.
- [x] kernel의 putaway/cancelLine/returnLine에서 변경 전 정합성을 확인하고 누계 갱신을 원장 변경 앞으로 옮긴다. 원래 누계에서 검증한 값을 한 번만 저장한다.

```ts
await tx
  .update(wmsTables.inboundReceiptLines)
  .set({ putawayFromOriginQty: line.putawayFromOriginQty + input.quantity })
  .where(eq(wmsTables.inboundReceiptLines.id, line.id));
const moveResult = await this.command.moveInternal(moveInput, tx);
// 기존 PUTAWAY 로그도 같은 tx로 기록한다. 예외를 잡아 부분 commit하지 않는다.
```

- [x] 적치는 동일/시스템 목적지를 거절한다. 취소는 원래 RECEIVE 이벤트 행을 stock lock보다 먼저 잠근다. 최종 가드는 입고 행을 FOR UPDATE로 읽지 않는다. 발주/입고의 기존 잠금 순서를 유지한다.
- [x] 원장 거절, 업무 로그 insert 실패, 발주 정산 실패를 주입하고 원장·누계·이력·발주 잔량 전체가 불변인지 확인한다.
- [x] 일반 MOVE, adjustDown, 실사 감소, transferShip, ship, RECEIVE 역분개, ON_HAND→다른 상태, 직접 createEvent를 검사한다. 일반 선반 MOVE와 직접입고 취소는 유지한다. 새 불변식과 충돌하는 기존 테스트는 과거 데이터 주입과 앞으로 허용할 동작을 구분해 변경한다.
- [x] 독립 연결 두 개와 deferred barrier로 이동↔적치, 이동↔신규 입고, 취소↔원래 이벤트 역분개를 양쪽 시작 순서로 실행한다. barrier 해제 전 미완료도 확인하고 최종 수량/누계/로그 건수를 검증한다. 각 테스트는 finally로 연결을 닫는다.
- [x] 아래 명령 통과와 skip 0을 확인하고 `feat(inventory): protect pending receipts at the stock write boundary`로 커밋한다.

```bash
corepack yarn test --runInBand --runTestsByPath \
  apps/core/src/modules/inventory/core/services/inbound-origin-protection.integration.spec.ts \
  apps/core/src/modules/inventory/core/services/inbound-origin-protection.concurrency.integration.spec.ts \
  apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts \
  apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.integration.spec.ts \
  apps/core/src/modules/inventory/core/services/batch-controlled-stock.guard.integration.spec.ts
```

## Task 3: 출고 계획·세션·이동 표시의 가용수량 일치

**Files — Modify:**

- `apps/core/src/modules/fulfillment/picking/plan/picking-plan.locks.ts`
- `apps/core/src/modules/fulfillment/picking/plan/picking-plan.ts`
- `apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts`
- `apps/core/src/modules/inventory/stock-projection/services/stock-projection.reader.ts`
- `apps/core/src/modules/inventory/stock-projection/services/stock-projection.service.ts`
- `apps/core/src/modules/inventory/stock-projection/controllers/stock-projection.controller.ts`
- `apps/core/src/modules/inventory/stock-projection/dto/location-contents.dto.ts`

**Files — Create:** `apps/core/src/modules/fulfillment/services/inbound-origin-planning.integration.spec.ts`.

**Interfaces:** Task 2의 getAvailability가 반환하는 자유 수량을 기존 lockSourceCapacities와 세션 취득에 사용한다. location contents item에는 inboundPendingQty와 generallyMovableQty를 추가한다. 기존 quantity, 출고 응답, 경제적 예약/판매가능수량은 변경하지 않는다.

- [x] 입고10·선반0의 출고 계획이 입고 대기를 할당하지 않는 검사와, 적치6 후 선반의6만 후보가 되는 검사를 먼저 작성한다. locationContents 예시는 적치 전 상태, allocations 예시는 적치 후 상태를 각각 읽는다.

```ts
expect(allocations.every((a) => a.sourceLocationId !== inboundOrigin.id)).toBe(true);
expect(allocations.reduce((sum, a) => sum + a.qty, 0)).toBe(6);
expect(locationContents.items[0]).toMatchObject({
  quantity: 10,
  inboundPendingQty: 10,
  generallyMovableQty: 0,
});
```

- [x] 추가 spec을 실행하여 부족한 표시/계획 재검증을 확인한다.
- [x] 기존 계획 재사용과 세션 취득 모두 현재 자유 수량을 검증한다. stockVersion이 같아도 입고 상태가 달라진 fixture를 포함해 version 일치만으로 과거 할당을 수용하지 않는다. 기존 PICKING_SOURCE_INSUFFICIENT 등의 도메인 거절을 유지한다.
- [x] location contents는 같은 가용수량 계산을 사용한다. 많은 SKU는 집계 조회하여 행마다 무제한으로 DB를 조회하지 않는다.
- [x] 입고 대기10·custody2·원장12의 자유0, 자유재고2의 세션 취득, 기존 세션과 대기의 중복, 적치↔세션 취득 경합을 독립 연결로 검사한다. 마지막 출고도 입고 대기를 침범하지 않아야 한다.
- [x] `corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/inbound-origin-planning.integration.spec.ts apps/core/src/modules/fulfillment/services/location-outbound.service.integration.spec.ts apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`를 통과시키고 `fix(fulfillment): exclude pending receipts from source capacity`로 커밋한다.

## Task 4: 공통 입고 상태와 원위치 후보 API

**Files — Create:**

- `apps/core/src/modules/inventory/inbound/services/inbound-receipt-policy.spec.ts`
- `apps/core/src/modules/inventory/inbound/services/inbound-receipt-policy.ts`
- `apps/core/src/modules/inventory/inbound/services/inbound-receipt-state.reader.ts`
- `apps/core/src/modules/inventory/inbound/dto/inbound-receipt-state.dto.ts`
- `apps/core/src/modules/inventory/inbound/services/inbound-receipt-state.integration.spec.ts`

**Files — Modify:**

- `apps/core/src/modules/inventory/inbound/services/inbound.service.ts`
- `apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.ts`
- `apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.ts`
- `apps/core/src/modules/inventory/inbound/dto/putaway-pending.dto.ts`
- `apps/core/src/modules/inventory/inbound/inbound.module.ts`
- `apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.spec.ts`
- `apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.integration.spec.ts`

**Interfaces:** 스펙 §5.1의 ReceiptLineState/ReceiptActionBlockReason을 DTO로 정의한다. reader는 `getLineState({ lineId, warehouseId }, tx?)`를 공개한다. 공통 policy는 DB 사실을 입력받아 작업 가능 여부를 반환하는 순수 함수다. 기존 history 이유 enum은 mapper로 유지한다. 스펙 §5.1의 판정 우선순위 표 전체를 순수 정책 테스트의 케이스로 사용한다.

- [x] 취소된 lineId 조회와 receiptId 없는 기존 PO 초안 조회를 먼저 검사한다.

```ts
expect(await reader.getLineState({ lineId, warehouseId })).toMatchObject({
  source: 'purchase_order',
  canceledQty: 3,
  pendingQty: 0,
  canCancel: false,
  canPutaway: false,
  putawayBlockReason: 'CANCELED',
});
```

- [x] 신규 spec을 실행하여 API/reader 부재로 실패함을 확인한다.
- [x] 기존 inbound.service.ts의 cancelBlockReason을 공통 policy로 이동한다. 시스템 원위치 대기·custody·잘못된 원위치·당일 판정·부분 적치/회송을 같은 스냅샷의 사실에서 판정한다. 권한이 있는 창고와 실제 라인 창고를 비교하는 controller를 추가한다.
- [x] history와 pending reader에 공통 policy를 적용한다. 원장0/누락의 미처리 행을 LEFT JOIN으로 보존하고 불가 이유를 반환한다. 원위치 필터는 LIMIT 전과 cursor scope에 적용한다.
- [x] controller의 범위/UUID/권한 거절, 다른 창고 라인, 취소된 라인, 여러 입고, 201건, 원위치 cursor 혼용, 기존 응답 호환성을 검사한다. 취소·적치 중 조회가 서로 다른 시점의 누계/원장을 섞지 않는지 검증한다.
- [x] 신규 state spec과 기존 controller/history/pending spec을 --runTestsByPath로 실행한다. `feat(inbound): expose authoritative receipt line state`로 커밋한다.

## Task 5: 앱의 공통 복구 및 확정 거절 처리

**Files — Create:**

- `native/warehouse-app/src/domains/inbound/receiptState.ts`
- `native/warehouse-app/src/domains/inbound/useReceiptReconciliation.ts`
- `native/warehouse-app/src/domains/inbound/receiptState.test.tsx`
- `native/warehouse-app/src/domains/inbound/useReceiptReconciliation.test.tsx`

**Files — Modify:**

- `native/warehouse-app/src/core/data/httpClient.ts`, `errorMessage.ts`
- `native/warehouse-app/src/core/operations/OperationContext.tsx`, `operationRunner.test.ts`
- `native/warehouse-app/src/domains/inbound/receiptHistory.ts`
- `apps/admin-web/src/lib/api/domains/inventory/stocktaking-operation.ts`
- `apps/admin-web/src/lib/api/domains/inventory/stocktaking.client.spec.ts`

**Interfaces:**

```ts
// receiptState.ts: 서버 DTO를 검증하고 범위를 대조한다.
export function useReceiptLineState(lineId: string | null, warehouseId: string | null);
// useReceiptReconciliation.ts: 단일 라인 작업 선택/재개의 공통 관문.
export function useReceiptReconciliation(input: {
  lineId: string | null;
  warehouseId: string | null;
  expectedSource: 'direct' | 'purchase_order';
}): {
  state: ReceiptLineState | null;
  ready: boolean;
  error: Error | null;
  refresh: () => Promise<ReceiptLineState>;
};
```

`refresh`는 미확인 작업 결과 확인 후 강제로 현재 상태를 읽으며 실패 시 reject한다. 대상 변경이나 더 최신 요청에 의해 폐기된 응답도 작업 허가로 반환하지 않는다. 화면이 재확인 Promise를 무시하고 기존 state로 제출하지 않게 한다.

- [x] fake IndexedDB와 지연 가능한 API를 연결해 이전 GET이 취소 후 GET보다 늦게 도착하는 검사, 미확인 요청의 성공 응답 유실 검사, scope 변경 검사를 먼저 작성한다.

```ts
expect(new ApiError('rejected', 409, 'INBOUND_ORIGIN_STOCK_PROTECTED').outcome).toBe('rejected');
expect(new ApiError('unknown', 409, 'UNRECOGNIZED_CODE').outcome).toBe('uncertain');
expect(new ApiError('forbidden', 403, 'INBOUND_ORIGIN_STOCK_PROTECTED').outcome).toBe('uncertain');
```

- [x] 새 hook 테스트와 기존 operationRunner 테스트를 실행하여 실패를 확인한다.
- [x] 알려진 세 코드만 확정 미반영에 추가하고 한국어 안내를 매핑한다. admin-web은 실제 CustomError envelope를 사용한다. 출고·실사·입고 모든 알 수 없는 오류를 409라는 이유로 해제하지 않는다.
- [x] `scope + warehouseId + lineId` query key, 응답 구조 검증, 요청 세대, 작업 알림 후 invalidation을 구현한다. pending 작업이 있으면 원래 키로 확인한 후 읽는다. 이미 확정된 과거 입고 응답을 현재 상태로 apply하지 않는다.
- [x] 손상된 2xx·404·권한 실패·저장 실패·재로그인·구형 capability·취소 확정 뒤 현재 조회 실패를 검증한다. 재시도 버튼으로 복구 가능하고 입력이 남아 있어야 한다.
- [x] `corepack yarn --cwd native/warehouse-app test src/domains/inbound/receiptState.test.tsx src/domains/inbound/useReceiptReconciliation.test.tsx src/core/operations/operationRunner.test.ts` 및 admin stocktaking client spec을 통과시킨다. `fix(warehouse): reconcile receipt actions with current server state`로 커밋한다.

## Task 6: 입고 화면 공통화와 이동에서 적치로 연결

**Files — Modify:**

- `native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx`
- `native/warehouse-app/src/domains/inbound/PurchaseOrderReceiveScreen.tsx`
- `native/warehouse-app/src/domains/inbound/InboundHistoryScreen.tsx`
- `native/warehouse-app/src/domains/inbound/PutawaySheet.tsx`, `PutawayQueueScreen.tsx`, `PutawayScanResults.tsx`
- `native/warehouse-app/src/domains/inbound/queries.ts`, `types.ts`
- `native/warehouse-app/src/domains/movement/MovementScreen.tsx`, `types.ts`
- `native/warehouse-app/src/app/routeTree.tsx`, `routes/PutawayRoute.tsx`
- `apps/admin-web/src/features/inventory/movement/components/move-dialog/index.tsx`

**Tests — Modify/Create:**

- `native/warehouse-app/src/domains/inbound/PurchaseOrderReceiveScreen.runtime.test.tsx`
- `native/warehouse-app/src/domains/inbound/ReliabilityReview.test.tsx`
- `native/warehouse-app/src/domains/movement/MovementScreen.test.tsx`
- `native/warehouse-app/src/domains/inbound/PutawayQueueScreen.test.tsx`, `PutawaySheet.test.tsx`
- 신규 `native/warehouse-app/src/domains/inbound/InboundWorkflow.runtime.test.tsx`

**Interfaces:** Task 4 DTO와 Task 5 hook을 사용한다. `/putaway` search는 `{ skuId?: string; originLocationId?: string }`, 이동 진입은 둘을 함께 전달한다. 현재 창고에 속하는지 서버가 재검증한다. 기존 PO draft의 fresh lineId는 유지하고 서버 상태를 별도로 표시한다.

- [x] 취소 확정 operation과 이전 fresh 초안을 실제 저장소에 넣어 재개하는 회귀를 정상 기대값으로 작성한다.

```ts
expect(await screen.findByText('취소됨')).toBeInTheDocument();
expect(screen.queryByRole('button', { name: '적치하기' })).not.toBeInTheDocument();
expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
```

- [x] 이동 위치 contents가 quantity10/inboundPending10/generallyMovable0일 때 일반 이동을 제출할 수 없고 적치 후보로 넘어가는 테스트를 작성한다. 기존 재현이 실패함을 확인한다.
- [x] 단일 fresh PO는 Task 5 hook을 사용한다. 간편입고 staged 목록은 회차 단위 조회를 유지하며 공통 policy 필드를 사용하고, 선택한 적치/취소 대상은 상세로 재검증한다. 로컬 confirmedPutaway 합계만으로 작업을 허가하던 경로를 제거한다. 단, 기존 미확인 작업/스캔 복구는 보존한다.
- [x] PutawaySheet는 표시된 수량을 자동 덮어쓰지 않는다. 제출 직전 refresh 결과가 달라지면 변경된 잔량을 안내하고 사용자가 다시 확인하게 한다. 원위치 ID를 필수로 전달해 같은 위치를 후보에서 제외한다.
- [x] 이동 화면에서 다음처럼 의도를 분리한다. admin-web 이동 거절도 동일한 원인을 설명하고 적치 경로를 안내한다.

```tsx
{
  item.inboundPendingQty > 0 && (
    <Link to="/putaway" search={{ skuId: item.skuId, originLocationId: source.id }}>
      적치하기
    </Link>
  );
}
<Button disabled={item.generallyMovableQty <= 0} onClick={() => openSheet(item)}>
  이동
</Button>;
```

- [x] 후보 조회에 originLocationId와 전체 기간을 적용한다. 여러 라인 선택·더 보기·다른 창고 전환·직접 링크·404·구형 서버·조회 응답 역전·키보드/HID Enter 중복을 검사한다. 선택 없이 POST 0회를 확인한다.
- [x] 입고내역 취소 → PO 재개, 별도 적치 화면 처리 → PO 재개, 다른 기기의 부분 적치 → 입력 보존을 실제 provider/runner fixture로 검증한다. 오류 문구와 버튼만 mock하는 검사로 대체하지 않는다.
- [x] `corepack yarn --cwd native/warehouse-app test src/domains/inbound src/domains/movement src/core/operations` 및 build를 통과시킨다. UI 변경 화면을 캡처하고 `feat(warehouse): route pending inbound stock through putaway`로 커밋한다.

## Task 7: 기존 불일치 감사와 운영 절차

**Files — Create:**

- `scripts/inventory/audit-inbound-origin-consistency.ts`
- `scripts/inventory/audit-inbound-origin-consistency.integration.spec.ts`
- `docs/runbooks/inbound-origin-consistency.md`

**Interfaces:** CLI는 `--warehouse-id <uuid> --output <absolute-json-path>`와 명시 DATABASE_URL을 받는다. 보고서는 다음 형태다.

```ts
interface InboundOriginAuditReport {
  version: 1;
  warehouseId: string;
  checkedAt: string;
  candidates: Array<{
    skuId: string;
    originLocationId: string;
    onHandQty: number;
    pendingQty: number;
    batchControlledQty: number;
    lineIds: string[];
    eventIds: string[];
    reasons: Array<'INSUFFICIENT_ORIGIN' | 'POSSIBLE_BYPASS' | 'INVALID_RECEIPT'>;
  }>;
}
```

- [x] 전용 DB fixture에 과거 10입고/일반 이동10/새 입고1 상태를 주입한다. 새 보호를 우회하는 제품 API를 만들지 말고 테스트 SQL로 과거 데이터를 준비한다. 보고서 후보와 DB 변경0을 기대하는 검사를 먼저 작성한다.
- [x] 새 spec을 실행해 도구 부재로 실패함을 확인한다.
- [x] read-only transaction을 DB 수준에서 강제하고 모든 후보/근거 ID를 출력한다. 미처리 기간의 일반 반출 이벤트를 후보로 남기되 확정된 귀속이라고 단정하지 않는다. 기존 보고서 파일은 덮어쓰지 않고 출력 충돌은 exit1로 처리한다.

```ts
// postgres-js의 begin options로 DB가 쓰기를 거절하도록 한다.
await client.begin('isolation level repeatable read read only', async (tx) => {
  // Task 1과 같은 합산식으로 읽고 일반 반출 이벤트를 연결한다.
  // UPDATE/INSERT/DELETE 및 counter 보정은 이 도구에 없다.
});
process.exitCode = report.candidates.length ? 2 : 0;
```

- [x] 정상/원장부족/원장누락/반출 뒤 보충되어 총량이 맞는 경우/여러 입고/다른 창고/잘못된 CLI/출력 실패를 검증한다. 테스트 전후 테이블 수량과 주요 행을 대조한다.
- [x] runbook에 대상 창고 중지→감사→실물 대사→미확인 작업 보존→Core/앱 전환→재검사 순서를 적는다. 미해결 후보가 있는 창고는 시험 운영에 넣지 않는다. 자동 FIFO/누계 보정 SQL은 제공하지 않는다.
- [x] `corepack yarn test --runInBand --runTestsByPath scripts/inventory/audit-inbound-origin-consistency.integration.spec.ts` 통과 후 `feat(inventory): audit legacy inbound origin inconsistencies`로 커밋한다.

## Task 8: 계약 공개와 전체 인수 검증

**Files — Modify:**

- `apps/core/src/modules/inventory/core/controllers/warehouse-work-context.controller.ts`
- `apps/core/src/modules/inventory/core/controllers/warehouse-operation-auth.spec.ts`
- `native/warehouse-app/docs/inventory-accuracy-acceptance.md`
- `docs/adr/0039-document-owns-receipt-settlement-kernel-does-arrival.md`
- 이 계획의 체크박스/검증 기록

**Interfaces:** `capabilities.inboundWorkflowConsistency: true`. 서버 변경이 모두 작동하는 상태에서만 공개한다. 아직 구현하지 않은 기능을 지원한다고 반환하지 않는다.

- [x] controller 계약 테스트에 capability와 실제 이동 거절/현재 상태 endpoint 연결을 추가한다. 단순 상수 존재만으로 합격하지 않는다.
- [x] Core와 native 앱의 오류 계약을 실제 로컬 HTTP로 연결한다. 새 거절이 영구 미확인으로 남지 않는지, 취소 응답 유실 후 원래 키를 확인하고 현재 상태로 재개하는지 대사한다.
- [x] 다음 명령을 실행하고 파일별 실행 수·실패·skip·제약을 인수 기록에 남긴다. 서버는 전용 DATABASE_URL을 필수로 지정한다.

```bash
corepack yarn --cwd native/warehouse-app test
corepack yarn --cwd native/warehouse-app build
corepack yarn --cwd native/warehouse-app lint
corepack yarn tsc --noEmit -p apps/core/tsconfig.app.json
corepack yarn test --runInBand --testPathPattern='(inbound-origin|inbound-receipt-state|inbound-putaway.reader|inbound-receipt-history|inbound-receipt.kernel|purchase-order-receiving|location-outbound|simple-outbound|batch-controlled-stock.guard|stocktaking-complete|stocktaking-count-version|warehouse-operation-auth|stocktaking.client)'
```

- [x] A1~A12를 아래 대응표로 점검한다. 수정한 마지막 상태에서 필요한 검사를 다시 실행한다. 알려진 과거 테스트 수를 이번 결과로 복사하지 않는다.
- [ ] Windows/PDA에서 정상 경로, 취소→재개, HID 연속 입력, 네이티브 재시작을 확인한다. 기기가 없으면 해당 항목을 미검증으로 기록하고 현장 인수 완료로 표시하지 않는다.
- [x] ADR-0039에 원장 반출 보호/누계 선행 갱신/잠금 순서를 추기한다. `git diff --check`, 실제 변경 검토 후 `docs(warehouse): record inbound consistency acceptance`로 커밋한다. 운영 배포와 기존 데이터 보정은 별도 작업이다.

## 스펙 대응표

| 합격 기준  | 구현/검증 작업  |
| ---------- | --------------- |
| A1, A2, A3 | Task 1, 2, 6, 8 |
| A4, A5, A6 | Task 1, 2, 8    |
| A7         | Task 2, 3, 8    |
| A8         | Task 2, 3       |
| A9, A10    | Task 4, 5, 6, 8 |
| A11        | Task 4, 6, 8    |
| A12        | Task 4, 7, 8    |

## 계획 자체의 검토 기록

- 상세 스펙의 범위·계약·잠금·오류 분류·기존 데이터 처리·배포 순서를 작업에 대응시켰다.
- 구현 중 제품 코드를 바꾸기 전에 테스트 fixture의 입고/일반 재고 구분을 확인한다. 이전에 허용하던 우회 시나리오가 실패하는 것을 무조건 회귀로 취급하지 않는다.
- Task 1–8 구현과 로컬 검증을 완료했다. 운영 DB 보정·배포 및 Windows/PDA 현장 인수는 수행하지 않았다.

## 최종 실행 기록 — 2026-09-16

- Native 전체: 89 files / 611 tests, 실패·skip·unhandled error 0 (`--maxWorkers=2`). Build 및 Core tsc 통과. Native lint는 오류0/기존 경고22개이며 새 경고5개를 해소했다.
- 필수 서버 패턴에 감사·실제 HTTP·변경한 controller/policy/idempotency/admin 메시지 검사를 포함한 최종 실행: 29 files / 429 tests, 실패·skip0. 파일별 수치와 실행 명령은 [자동 검사 상세](../../../native/warehouse-app/docs/evidence/inbound-consistency/automated-results.md)에 기록했다.
- 첫 전체 앱 실행에서 발견한 테스트 준비 시점 문제2개와 첫 전체 서버 실행의 기존 migration journal 고정 개수 기대값 오류를 수정하고 전체 재검증했다. timeout·skip으로 우회하지 않았다.
- Task 3의 기존 계획 재사용/세션 취득 경로는 이미 current generallyAvailableQty를 소비해 별도 제품 변경 없이 실제 DB 회귀로 확인했다. 캡처는 실제 컴포넌트+읽기 전용 API fixture로 남겼고, 실제 Core+native HTTP 대사는 별도 PostgreSQL 검사로 수행했다.
- A1–A12 로컬 검증과 screenshot/HTTP/장비 범위 구분은 [인수 기록](../../../native/warehouse-app/docs/inventory-accuracy-acceptance.md#2026-09-16-입고-대기-보호와-현재-상태-일관성)에 있다. Windows/PDA 기기 항목은 미검증으로 남긴다. 운영 배포·기존 데이터 보정은 실행하지 않았다.


### 최종 전체 검토 수정 — 기준 `746d06211`

- [x] 회수의 immutable 재생 수량도 기존 잠금 안에서 generallyAvailableQty 이하인지 검사한다. 원장12/입고대기10/free2에서 누락된 balance10 재생 거절과2 재생 허용을 실제 DB로 검사한다.
- [x] 이력의 원본 정수 사실과 비음수 목록 메타데이터를 분리하고 음수 사실은 엄격한 차단 정책으로만 보존한다. parser·입고내역·Quick 복원에서 진단 행과 정상 이웃을 함께 검사한다.
- [x] 적치 커널이 공통 정책을 잠금 안에서 다시 검사한다. 선반/원래 RECEIVE 없음/voided/부분취소 HTTP 거절의 누계·원장·이벤트·업무로그 불변과 오래된 정상 잔여의 부분회송/적치를 검사한다.
- [x] 후보 목록에 Asia/Seoul 날짜·시각을 표시하고 회귀와 실제 컴포넌트 캡처를 갱신한다.
- [x] 마지막 코드 변경 후 native611개/서버429개 전체를 재검증하고 build/lint/Core tsc를 실행한다. 커널 경계5개는 별도 통과했다. 새 스키마/의존성/이벤트 잠금/운영 데이터 보정은 없다.
