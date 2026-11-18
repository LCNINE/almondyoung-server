# 드레인 중 셀메이트 상자 떼기 (#1412) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 드레인 동안 셀메이트에 넘긴 주문의 상자가 출고 준비 목록·합포장 후보에 뜨지 않게 하고, 계획 확정·합치기가 그 상자를 409 로 거절하게 한다.

**Architecture:** 상자 id 목록을 받아 «셀메이트 상자» 집합을 돌려주는 함수 하나(`loadSellmateShipmentIds`)를 fulfillment 에 둔다.
리더 둘(출고 준비·합포장 보드)은 이 함수로 상자를 빼고, 명령 둘(`ShipmentPlanningService.plan`·`ConsolidationService.consolidate`)은
잠근 뒤 이 함수로 판정해 거절한다. 경계는 `sellmate_handed_over_orders` 표다(T 에 `evening-reconcile init` 이 채운다). 마이그레이션은 없다.

**Tech Stack:** NestJS core, Drizzle ORM(postgres.js), Jest(통합 스펙은 실 postgres, rollback tx)

**Spec:** `docs/superpowers/specs/2026-11-18-cutover-drain-handed-over-orders-design.md`

## Global Constraints

- **셀메이트 줄:** 상자 라인 → FOI → FO 의 판매주문이 `sellmate_handed_over_orders` 에 있고, 그 FOI 의 판매주문 줄이 교환 줄(`sales_order_lines.exchange_return_line_id IS NOT NULL`)이 **아닌** 줄. 판매주문 줄 참조가 비었거나 uuid 꼴이 아니면 셀메이트 줄로 본다(보수적).
- **셀메이트 상자:** 셀메이트 줄이 하나라도 든 상자.
- 거절 코드 `SHIPMENT_HANDED_OVER_TO_SELLMATE`, HTTP 409(`ConflictException({ code, message })` — 두 서비스의 기존 `this.conflict` 를 쓴다).
- 일괄 결과 문구: `셀메이트가 내보내는 주문이에요`.
- core 만 고친다. 마이그레이션 없음, admin-web 안 고침.
- 테넌트 값(누구인지·slug·도메인)은 코드·커밋·이슈에 적지 않는다(공개 레포).
- DB 접근은 `trx.select().from().innerJoin().where()` 꼴. `db.query.*`·`any`·`as` 캐스팅 금지(CLAUDE.md Inventory Query Rules).
- 통합 스펙은 `describeIfDb` 가드(`DATABASE_URL` 없으면 skip)를 쓰고 스펙 안에서 `dotenv.config()` 를 부르지 않는다.
- 통합 스펙 실행: 로컬 `core` DB 는 마이그가 깨져 있으니 스크래치 DB `core_it_1243` 을 쓴다. 처음 한 번 마이그를 맞춘다:
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_it_1243 npx drizzle-kit migrate --config apps/core/drizzle.config.ts`
  이후 스펙마다 `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_it_1243 npx jest --runInBand --runTestsByPath <파일>`.
- 로컬 E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다(메모리 부족). 전체를 돌릴 땐 `--maxWorkers=2`.

## Review Focus

1. **이미 `planned` 인 셀메이트 상자** — 출고 준비 목록의 어느 분류(이어서 하기 등)에도 뜨지 않아야 한다 → Task 2 테스트.
2. **판매주문 줄 참조가 빈 FOI** — 넘긴 주문의 FO 에 속하면 셀메이트 줄로 본다 → Task 1 테스트.
3. **일괄 확정에 셀메이트 상자가 섞임** — 그 상자만 `셀메이트가 내보내는 주문이에요` 로 실패하고 나머지는 확정된다(`runPerShipment` 는 상자마다 따로 돈다) → Task 3 문구 테스트.
4. **init 전·다른 테넌트(표가 빔)** — 아무것도 가리지 않는다. 같은 상자가 표를 채우기 전엔 보이고 채운 뒤엔 사라진다 → Task 2 테스트.
5. **거절 뒤 상태 그대로** — 거절된 상자는 `draft` 로 남고 합치기 원본도 `draft` 다 → Task 3·4 테스트.

---

### Task 1: 셀메이트 상자 판정 함수

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/sellmate-handed-over-shipments.ts`
- Create: `apps/core/src/modules/fulfillment/services/__support__/sellmate-handed-over-fixtures.ts`
- Test: `apps/core/src/modules/fulfillment/services/sellmate-handed-over-shipments.integration.spec.ts`

**Interfaces:**
- Produces:
  - `loadSellmateShipmentIds(trx: DbTx, shipmentIds: readonly string[]): Promise<Set<string>>` — 받은 상자 중 셀메이트 상자의 id 집합. 빈 목록이면 쿼리 없이 빈 집합.
  - 픽스처 `seedHandedOverOrder(tx: DbTx, salesOrderId: string): Promise<void>` — `sellmate_reconcile_runs` 한 행 + `sellmate_handed_over_orders` 한 행.
  - 픽스처 `markOrderLinesAsExchange(tx: DbTx, salesOrderId: string): Promise<void>` — 그 판매주문의 줄을 교환 줄 꼴로 만든다.

- [ ] **Step 1: 픽스처를 만든다**

`seedHandedOverOrder`: 회차 행은 `kind: 'apply'`, `status: 'closed'` 로 넣는다. `kind: 'init'` 은 부분 유니크 인덱스(`uq_sellmate_reconcile_runs_init`)라 스크래치 DB 에 init 이 있으면 충돌한다. `inputSha256` 은 `createHash('sha256').update(randomUUID()).digest('hex')`, `inputSnapshotAt: new Date()`. 넘긴 주문 행은 `displayId` 아무 정수, `medusaOrderId: \`order_${randomUUID()}\``.
`markOrderLinesAsExchange`: 판매주문의 줄마다 `insertCustomerReturn`(`apps/core/src/modules/sales-order/line-quantities/__support__/claim-facts.fixtures.ts`, `status: 'expected'`)으로 그 줄을 가리키는 반품 줄을 만들고, 그 판매주문 줄의 `exchangeReturnLineId` 에 반품 줄 id 를 넣는다(판정 술어만 보는 꼴이다).

- [ ] **Step 2: 실패하는 통합 스펙을 쓴다**

셋업은 `outbound-preparation.reader.integration.spec.ts` 의 `beforeAll` 과 같다(`makeDb`·`makeDbService`·`wireLogistics(dbService, 'v2')`, 상자는 `consolidationBase` + `createConsolidationSource`). 모두 `inRollbackTx` 안.

```ts
it('넘긴 판매주문의 상자만 셀메이트 상자다', async () => {
  // handed = source(), other = source(); seedHandedOverOrder(tx, handed.salesOrderId)
  expect(await loadSellmateShipmentIds(tx, [handed.shipment.id, other.shipment.id])).toEqual(new Set([handed.shipment.id]));
});
it('교환 줄만 든 상자는 셀메이트 상자가 아니다', async () => {
  // handed 를 seed 한 뒤 markOrderLinesAsExchange(tx, handed.salesOrderId)
  expect((await loadSellmateShipmentIds(tx, [handed.shipment.id])).size).toBe(0);
});
it('셀메이트 줄과 앱 줄이 섞인 상자는 셀메이트 상자다', async () => {
  // handed.line 의 shipmentId 를 other.shipment.id 로 옮긴다(reader 스펙의 extraLine 과 같은 방법)
  expect(await loadSellmateShipmentIds(tx, [other.shipment.id])).toEqual(new Set([other.shipment.id]));
});
it('판매주문 줄 참조가 빈 줄도 넘긴 주문이면 셀메이트 줄이다', async () => {
  // handed.fulfillmentOrderItemId 의 salesOrderLineId 를 null 로
  expect(await loadSellmateShipmentIds(tx, [handed.shipment.id])).toEqual(new Set([handed.shipment.id]));
});
it('빈 목록이면 빈 집합', async () => {
  expect((await loadSellmateShipmentIds(tx, [])).size).toBe(0);
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_it_1243 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/sellmate-handed-over-shipments.integration.spec.ts`
Expected: FAIL — `Cannot find module './sellmate-handed-over-shipments'`

- [ ] **Step 4: `loadSellmateShipmentIds` 를 구현한다**

두 번 읽는다. ① `shipmentLines` ⋈ `fulfillmentOrderItems` ⋈ `fulfillmentOrders` ⋈ `sellmateHandedOverOrders`(`h.salesOrderId = fo.salesOrderId`) 에서 `(shipmentId, salesOrderLineId)` 후보를 읽는다. ② 후보 중 uuid 꼴 `salesOrderLineId` 만 `salesOrderLines` 를 기본키로 찾아 `exchangeReturnLineId IS NOT NULL` 인 id 를 모은다. 출고 품목의 참조는 문자열이라 조인하면 인덱스를 못 쓴다(`outbound-preparation.reader.ts` 의 `untrustedExternalLineShipments` 와 같은 이유와 같은 `UUID` 규칙). 교환 줄이 아닌 후보가 하나라도 있는 상자가 결과다. 파일 머리 주석에 #1412·경계(넘긴 주문 집합, 시각으로 자르지 않음)·수명(#1243 이 닫으면 할 일 없음, 2단계 정리 때 뺀다)을 적는다.

- [ ] **Step 5: 통과를 확인한다**

Run: Step 3 과 같은 명령. Expected: 5 passed

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/sellmate-handed-over-shipments.ts \
  apps/core/src/modules/fulfillment/services/sellmate-handed-over-shipments.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/__support__/sellmate-handed-over-fixtures.ts
git commit -m "[core] #1412 셀메이트에 넘긴 주문의 상자를 가려내는 판정을 더한다"
```

---

### Task 2: 출고 준비 목록·합포장 보드에서 뺀다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.ts` (`summarize`, 상자 쿼리 직후)
- Modify: `apps/core/src/modules/fulfillment/services/consolidation-board.reader.ts` (`findBoard`, 상자 쿼리 직후)
- Test: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.integration.spec.ts`

**Interfaces:**
- Consumes: `loadSellmateShipmentIds`, `seedHandedOverOrder` (Task 1)
- Produces: 없음(응답 모양은 그대로)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('셀메이트 상자는 어느 분류에도 없고 합칠 상대도 되지 않는다', async () => {
  // customerId 하나로 handed = source(1, c), app = source(1, c) — 같은 받는 분이라 표를 채우기 전엔 둘 다 mergeable
  // planned = source(); status 를 'planned' 로 바꾼다(이어서 하기 분류)
  const before = await reader.summarize(base.warehouseId, undefined, tx);
  expect(idsIn(before, 'mergeable')).toEqual(expect.arrayContaining([handed.shipment.id, app.shipment.id]));
  // seedHandedOverOrder 를 handed·planned 판매주문에
  const after = await reader.summarize(base.warehouseId, undefined, tx);
  const all = after.buckets.flatMap((b) => b.shipments.map((s) => s.shipmentId));
  expect(all).not.toContain(handed.shipment.id);
  expect(all).not.toContain(planned.shipment.id);
  expect(idsIn(after, 'ready')).toContain(app.shipment.id);
  const board = await new ConsolidationBoardReader(dbService).findBoard(base.warehouseId, tx);
  expect(board.groups.flatMap((g) => g.shipments.map((s) => s.shipmentId))).not.toContain(handed.shipment.id);
});
```

`idsIn(summary, bucket)` 은 스펙 안의 작은 도우미다. `dbService` 는 `beforeAll` 에서 지역 변수로 올린다.

- [ ] **Step 2: 실패를 확인한다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_it_1243 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.integration.spec.ts -t '셀메이트 상자는'`
Expected: FAIL — `expect(all).not.toContain(handed.shipment.id)`

- [ ] **Step 3: 두 리더에서 셀메이트 상자를 뺀다**

두 곳 모두 상자 쿼리 바로 뒤에서 `loadSellmateShipmentIds(trx, ...)` 로 빼고, 그 뒤 코드(`ids`·빈 목록 조기 반환·줄 읽기)는 뺀 목록으로 돈다. 출고 준비 리더의 `mergeable` 은 `findBoard` 를 쓰므로 보드에서 빼면 상대에서도 빠진다.

- [ ] **Step 4: 통과를 확인한다**

Run: `-t` 없이 Step 2 명령. Expected: 이 파일 전부 PASS(기존 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.ts \
  apps/core/src/modules/fulfillment/services/consolidation-board.reader.ts \
  apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.integration.spec.ts
git commit -m "[core] #1412 출고 준비 목록과 합포장 보드에서 셀메이트 상자를 뺀다"
```

---

### Task 3: 계획 확정이 셀메이트 상자를 거절한다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` (`plan`, `SHIPMENT_NOT_DRAFT` 검사 바로 뒤)
- Modify: `apps/core/src/modules/fulfillment/outbound-preparation/bulk-shipment-result.ts` (`messages`)
- Test: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.integration.spec.ts` (이미 `planning` 이 배선돼 있다)
- Test: `apps/core/src/modules/fulfillment/outbound-preparation/bulk-shipment-result.spec.ts`

**Interfaces:**
- Consumes: `loadSellmateShipmentIds`, `seedHandedOverOrder` (Task 1)
- Produces: 거절 코드 `SHIPMENT_HANDED_OVER_TO_SELLMATE` (Task 4 도 같은 코드)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bulk-shipment-result.spec.ts` 의 `it.each` 표에 한 줄: `['SHIPMENT_HANDED_OVER_TO_SELLMATE', '셀메이트가 내보내는 주문이에요']`.

리더 통합 스펙에:

```ts
it('셀메이트 상자는 계획 확정을 409 로 거절하고 draft 로 남긴다', async () => {
  // 기존 «계획 확정» 테스트처럼 deliveryProfiles 스냅샷을 채운 source 하나 + seedHandedOverOrder
  await expect(planning.plan(source.shipment.id, { shippingProfileId: base.profileId,
      expectedManifestVersion: original.manifestVersion, expectedReservationVersion: original.reservationVersion },
    randomUUID(), actor, tx)).rejects.toMatchObject({
    response: expect.objectContaining({ code: 'SHIPMENT_HANDED_OVER_TO_SELLMATE' }),
  });
  // 상자를 다시 읽어 status === 'draft'
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --runTestsByPath apps/core/src/modules/fulfillment/outbound-preparation/bulk-shipment-result.spec.ts` → FAIL(문구가 `처리하지 못했어요`)
Run: 리더 통합 스펙 `-t '계획 확정을 409'` → FAIL(확정이 성공한다)

- [ ] **Step 3: 구현한다**

`plan()` 의 `SHIPMENT_NOT_DRAFT` 검사 바로 뒤에서 `private async assertNotHandedOverToSellmate(shipmentId: string, tx: DbTx): Promise<void>` 를 부른다. `loadSellmateShipmentIds(tx, [shipmentId])` 에 있으면 `this.conflict('SHIPMENT_HANDED_OVER_TO_SELLMATE', \`Shipment ${shipmentId} belongs to an order Sellmate ships\`)`. 예약 부족 같은 다른 거절보다 먼저 보이게 앞에 둔다. `messages` 에 Step 1 의 한 줄.

- [ ] **Step 4: 통과를 확인한다**

Run: Step 2 의 두 명령(리더 스펙은 `-t` 없이). Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/shipment-planning.service.ts \
  apps/core/src/modules/fulfillment/outbound-preparation/bulk-shipment-result.ts \
  apps/core/src/modules/fulfillment/outbound-preparation/bulk-shipment-result.spec.ts \
  apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.integration.spec.ts
git commit -m "[core] #1412 셀메이트 상자의 계획 확정을 거절한다"
```

---

### Task 4: 합치기가 셀메이트 상자를 거절한다

합포장 후보는 보드 말고도 `consolidation-candidates`·`consolidation-options` 두 경로가 더 있다(상자 상세 화면). 세 곳을 다 고치는 대신 합치기 명령 한 곳에서 막는다. 안 막으면 T 뒤 주문과 섞인 상자가 생기고, 그 상자는 `plan()` 이 거절해 T 뒤 주문까지 묶인다.

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/consolidation.service.ts` (`consolidate`, `assertExpectedVersions` 바로 뒤)
- Test: `apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts`

**Interfaces:**
- Consumes: `loadSellmateShipmentIds`, `seedHandedOverOrder` (Task 1), 코드 `SHIPMENT_HANDED_OVER_TO_SELLMATE` (Task 3)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('셀메이트 상자가 끼면 합치기를 409 로 거절하고 원본은 draft 로 남긴다', async () => {
  // 'supersedes two FO shipments…' 테스트처럼 first·second + seedHandedOverOrder(tx, first.salesOrderId)
  await expect(consolidation.consolidate(dto, `consolidate-${randomUUID()}`, actor, tx)).rejects.toMatchObject({
    response: expect.objectContaining({ code: 'SHIPMENT_HANDED_OVER_TO_SELLMATE' }),
  });
  // first·second 를 다시 읽어 둘 다 status === 'draft'
});
```

`createOrderShipment` 가 돌려주는 값에 `salesOrderId` 가 있다(`createConsolidationSource`).

- [ ] **Step 2: 실패를 확인한다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_it_1243 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts -t '셀메이트 상자가 끼면'`
Expected: FAIL — 합치기가 `completed` 로 끝난다

- [ ] **Step 3: 구현한다**

`assertExpectedVersions` 뒤에서 `loadSellmateShipmentIds(trx, aggregates.map((a) => a.shipment.id))` 가 비어 있지 않으면 `this.conflict('SHIPMENT_HANDED_OVER_TO_SELLMATE', \`Sellmate ships: ${[...ids].join(',')}\`)`.

- [ ] **Step 4: 통과를 확인한다**

Run: `-t` 없이 Step 2 명령. Expected: 이 파일 전부 PASS

- [ ] **Step 5: 게이트**

Run: `npm run type-check` → 에러 0
Run: `npx jest --maxWorkers=2 apps/core/src/modules/fulfillment` → 실패 0(통합 스펙은 `DATABASE_URL` 없이 skip)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/consolidation.service.ts \
  apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts
git commit -m "[core] #1412 셀메이트 상자가 낀 합치기를 거절한다"
```

---

### Task 5: 런북 줄을 이슈에 더한다 (머지 뒤)

코드가 아니라 이슈 본문을 고친다. PR 이 머지된 뒤에 한다.

- [ ] **Step 1: #1251 «할 일»에 두 줄을 더한다** (`gh issue view 1251 --json body` → 고쳐서 `gh issue edit 1251 --body-file`)

  - 출고 준비 화면은 `evening-reconcile init --apply` 가 끝난 뒤에 연다. init 전에는 표가 비어 있어 셀메이트 상자가 가려지지 않는다(#1412).
  - init 직후 이미 확정됐거나 배치 작업에 든 셀메이트 상자가 0건인지 센다. 0 이 아니면 그 상자를 배치에서 빼고 사람이 본다:

```sql
SELECT s.status, count(DISTINCT s.id)
  FROM shipments s
  JOIN shipment_lines sl ON sl.shipment_id = s.id
  JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
  JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
  JOIN sellmate_handed_over_orders h ON h.sales_order_id = fo.sales_order_id
 WHERE s.status = 'planned'
    OR EXISTS (SELECT 1 FROM outbound_batch_work_items w
                WHERE w.shipment_id = s.id AND w.status NOT IN ('excluded', 'completed'))
 GROUP BY s.status;
```

- [ ] **Step 2: #1233 당일 순서 2번 끝에 «출고 준비 화면은 init 뒤에 연다(#1412)»를 더한다**

- [ ] **Step 3: #1412 를 PR 머지로 닫고, 배포가 core 한 번(마이그 없음, T 전)이라고 PR 본문에 적는다**
