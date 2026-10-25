# K3 PR 6 — 취소: 알릴 취소를 상자 후 경로로 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 넘긴 입점사 상자의 라인이 취소되면, 상자 후 취소 경로가 그 취소와 같은 트랜잭션·같은 취소 id 로 «알릴 취소» 행(`direct_ship_cancel_notices`, `supplier_id`)을 남긴다. «못 보냄»으로 보고된 라인은 행을 남기지 않는다. 옛 상자 전 경로의 holders 기반 쓰기는 지우고, 알릴 취소 읽기·내려받기·완료 표시는 입점사 id 로 한다. **동작은 휴면이다** — 직배 SKU 가 라이브 0 이다.

**Architecture:** 판매주문 취소는 그대로 `SalesOrdersService.cancel` → `hasBoxedFulfillment` → `cancelAfterBoxing` → `ShipmentPlanningService.cancelOutstanding` 로 간다(PR 4 뒤로 직배 주문에도 상자가 있다). 바뀌는 것은 셋이다. ① `cancelAfterBoxing` 이 취소 id 를 먼저 정해(상자 전 경로와 같은 ADR-0049 PR5 방식) `cancelOutstanding` 에 «취소 출처»로 넘긴다. ② `applyDraftCancellation` 이 줄을 줄인 직후 새 함수 `recordSupplierCancelNotices` 를 부른다 — 행을 쓰는 곳은 이 함수와 완료 표시 매니저 둘뿐이다(가드 spec). ③ 알릴 취소 읽기 쪽이 `holders` 대신 `suppliers` 를 조인하고 입점사 id 로 거른다.

**Tech Stack:** NestJS(core), Drizzle, Postgres, zod(컨트롤러 본문), Jest(unit + `DATABASE_URL` 통합).

**Spec:** `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` (§4.7, §7 PR 6, «PR 6 구현자에게(PR 5 가 정한 것)»). ADR `docs/adr/0050-drop-ship-is-a-supplier-shipment.md`, `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md`(PR 5 문단). 앞 계획: `2026-10-25-k3-fo-creates-supplier-shipments-pr4.md`·`2026-10-25-k3-supplier-dispatch-pr5.md` 의 «다음 PR 에 넘기는 것».

## 코드에서 확인한 것 (develop `a9b5944ae`)

- **상자 후 취소는 입점사 draft 상자에서 막히지 않는다(읽어서 확인, 테스트로 굳힐 것).** `cancelOutstanding`(`shipment-planning.service.ts:617`) → `assessCancelReadiness`(작업 항목·활성 송장 없음 → `ready`, 손질 0) → `applyDraftCancellation`(:1426) → `shrinkDraftLines`(`draft-line-shrink.ts:22`). `warehouseIdOf` 를 부르는 `releasePartial`→`loadLineContext` 는 확정 예약을 놓을 때만 불리는데 입점사 라인은 예약 0 이라 안 불린다. 묘비 상자는 `shipmentOwnerOf` 로 입점사 주인을 물려받는다. PR 4 가 «가장 큰 휴면 위험»이라 했던 것이 실제로는 안전하다 — Task 1 의 통합 테스트가 그 증거다.
- **입점사 상자는 대기(CANCEL_REPLAN_PENDING)·이탈 갈래로 갈 길이 없다.** 배치에 못 들어가고(PR 2 가드), 수기 송장은 발송 때만 생긴다. `recovery_required` 는 되돌리기 한 트랜잭션 안에서만 보인다(PR 5 N10). 그래서 대기 재개 경로(`applyPendingCancellation`)에는 취소 id 가 없어도 된다 — 대신 fail-closed 로 막는다(N4).
- **상자 후 경로의 취소 행 id 는 지금 `recordSalesOrderCancellation` 이 정한다**(`cancelAfterBoxing`(:1798) 안, `cancelOutstanding` 호출 **뒤**). 상자 전 경로는 `randomUUID()` 를 먼저 정해 `values.id` 로 넘긴다(:1281, :1362).
- **알릴 취소 읽기·완료 표시가 `holders` 를 inner join 한다**(`direct-ship-cancel-notice.reader.ts:41`, `.manager.ts:27`) — `supplier_id` 행은 지금 목록에서 **보이지 않는다**. 공급사 상품코드도 `sku_suppliers` 아무 첫 행이다(:43).
- **옛 상자 전 쓰기(`UnboxedDemandCancellation.recordPartnerNotices`, :145)는 이제 닿을 수 없다** — `drop_ship` FO 를 만드는 코드가 없고(PR 4), 직배 주문은 상자가 있어 상자 후로 간다.
- **고객 셀프취소는 넘긴 뒤엔 막힌다**(`self-cancel-block.ts` `anyShipped` 가 직배 넘김을 포함). 알릴 취소는 관리자·채널 취소에서만 생긴다. 바꿀 것 없음.
- **`cancelOutstanding` 호출은 운영 코드 1곳(`sales-orders.service.ts`)·스펙 33곳**이다(`grep -rn "\.cancelOutstanding(" apps/core/src`).

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N1. 한 PR, Core 만, 마이그 없음.** `direct_ship_cancel_notices.supplier_id`·`ck_..._party`·`idx_..._pending_supplier` 는 PR 2 가 만들었다. `holder_id` 칸·FK 제거는 PR 8.
- **N2. 취소 출처는 `cancelOutstanding` 의 명시 인자다:** `origin: SalesOrderCancellationOrigin | null`(tx 바로 앞). **요청 해시(`canonicalRequest`)에는 넣지 않는다** — 매번 새 uuid 라 넣으면 같은 키 재전송이 `FULFILLMENT_IDEMPOTENCY_MISMATCH` 로 바뀐다. 재전송은 저장된 응답을 돌려주고 행을 다시 쓰지 않는다. DTO 칸이 아니라 인자인 이유: 스펙 33곳이 «출처 없음(`null`)»을 직접 적게 해 타입이 빠뜨림을 잡는다.
- **N3. 행 조건 = 입점사 상자(`supplier_id`) ∧ 넘김 기록(`supplier_handoff_id`) ∧ 라인 `unfulfillable_reason IS NULL` ∧ 줄인 수량 > 0.** 라인 하나당 행 하나(한 FOI 의 살아 있는 입점사 라인은 하나 — PR 5 N3). 판매주문·FO·FOI·주문 라인·SKU 는 **상자가 아니라 라인에서** 읽는다 — 되돌린 합포장 상자는 여러 주문을 담는다. 되돌린 상자는 넘김 기록을 지니므로 행이 생긴다(물건 정보가 입점사에 있다).
- **N4. fail-closed 둘(`Error`, 500):** (a) 넘긴 입점사 상자의 라인을 `origin = null` 로 줄이면 — 알릴 곳은 알지만 가리킬 취소가 없다. (b) 입점사 상자가 즉시 취소 갈래가 아닌 곳(대기·이탈)으로 가면 — 위 «확인한 것»의 불변식이 깨졌다는 뜻이다.
- **N5. 옛 상자 전 쓰기를 지운다:** `recordPartnerNotices` 와 `reduce`·`cancelOrder` 의 `orderCancellationId` 인자. 쓰기 가드의 허용 목록이 `unboxed-demand-cancellation.ts` → 새 파일로 바뀐다. 전제는 Task 0 의 «넘긴 `drop_ship` FO 0·holder 알릴 취소 0».
- **N6. 알릴 취소 API 는 입점사 id 로 찾는다.** `GET /direct-ship/cancel-notices?supplierId=`, `POST …/export/file`·`…/notified` 본문 `{ supplierId, noticeIds }`. 응답 행에 `supplierId` 를 더하고 `companyName` 은 입점사 이름으로 남긴다(옛 화면이 묶음 머리글로 쓴다). **대가: 옛 admin-web 의 내려받기·완료 버튼은 `companyName` 을 보내 400 이 된다 — PR 7 이 화면을 바꿀 때까지.** 라이브 행이 0 이고 휴면이라 실제로 누를 일이 없다. 이름으로 찾는 호환 갈래를 두지 않는 이유는 스펙 반목표(«입점사를 이름 문자열로 찾는다»)다.
- **N7. CSV 는 입점사가 받은 시트와 같은 키로 찾게 한다.** 열: `행 키(지우지 마세요)`(FOI id) · `주문번호`(`orderNoSql()`) · `상품명` · `공급사 상품코드`(그 입점사의 `sku_suppliers.supplier_sku` — 첫 행 아님) · `취소수량` · `취소구분` · `취소일시` · `취소ID`. 앞 넷의 머리글은 `SUPPLIER_SHEET_COLUMNS` 에서 읽는다(글자가 갈리지 않게). 파일 이름 `직배취소알림_<입점사 이름>_<yyyyMMddHHmm>.csv`. 고객 개인정보는 여전히 싣지 않는다.
- **N8. 발송된 입점사 라인의 취소 규칙은 그대로다** — 부분 취소는 지금처럼 409(`Boxed outstanding line quantity is short …`), 전체 취소는 남은 미발송분만 취소한다. 잘못 반영된 발송이면 먼저 되돌린다(PR 5 Task 7). 새 오류 코드를 만들지 않는다.

## Global Constraints

- **마이그 없음.** 새 칸·인덱스가 필요해 보이면 멈추고 사용자에게 묻는다.
- K7 커널(`sales-order/order-cancellation/order-cancellation.ts`)의 인터페이스는 바뀌지 않는다. 바뀌어야 하면 멈추고 알린다(스펙 §4.7).
- `direct_ship_cancel_notices` 쓰기는 `record-supplier-cancel-notices.ts`(생성)와 `direct-ship-cancel-notice.manager.ts`(완료 표시)만(`direct-ship-cancel-notice-writers.guard.spec.ts`).
- `cancelOutstanding` 의 운영 호출자는 `sales-orders.service.ts` 하나(`cancel-outstanding-callers.guard.spec.ts` 그대로).
- 창고 흐름 진입 함수 목록(`supplier-shipment-entry.guard.spec.ts`)은 그대로. FO·FOI status 는 투영만(`fulfillment-order-status-writes.guard.spec.ts` 그대로).
- 트랜잭션·쿼리 규칙(ADR-0025, CLAUDE.md Inventory): `tx` 전파, `db.query.*`·`with`·`any`/`as` 금지(기존 파일과 같은 문서화된 raw `execute` 캐스트만).
- 라우트 권한은 지금 그대로(`fulfillment.order.read`·`order.order.export`·`fulfillment.order.write`). CSV 라우트의 `@Res` 는 지금처럼 개인정보 없음 전제.
- 통합 테스트: 스크래치 DB `k3_pr2_it`. `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k3_pr2_it npx jest --runInBand --runTestsByPath <파일…>`. 꺼져 있으면 `docker start almondyoung-server-postgres-1`. develop 에 새 마이그가 생겼으면 먼저 `DATABASE_URL=… npx drizzle-kit migrate --config apps/core/drizzle.config.ts`.
- 기준선: 브랜치 시작 때 `k3_pr2_it` 에서 `apps/core/src/modules/fulfillment apps/core/src/modules/sales-order` 의 `*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다.
- 워크트리를 쓰면 node_modules 심볼릭 링크(루트·`apps/*`·`web/*`·`native/warehouse-app`)가 있어야 jest 매퍼가 산다.
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0(이 PC 의 admin-web attendance spec 4개는 ICU 환경 실패 — 비교만), 통합 기준선 외 실패 0.

## Review Focus

- **되돌린 합포장 상자에서 한 주문만 취소** — 다른 주문의 라인은 수량·상자 그대로, 알릴 취소는 취소한 주문의 라인만, 행의 `sales_order_id` 는 그 주문. Task 1 케이스.
- **창고분·입점사분이 섞인 주문의 전체 취소** — 창고 상자는 지금처럼 예약 해제·canceled, 입점사 넘긴 상자 라인만 행이 생기고 창고 라인은 행 0. Task 1 케이스.
- **같은 Idempotency-Key 로 취소 재전송** — 판매주문은 저장된 결과를 돌려주고 알릴 취소 행 수가 늘지 않는다. Task 1 케이스.
- **넘긴 라인의 일부 수량만 부분 취소** — 행 `canceled_qty` = 취소분, K6 `forwarded`(`readLineQuantities`) = 남은 수량, 상자는 draft 로 남는다. Task 1 케이스.
- **한 상자에 «못 보냄» 라인과 보통 라인이 섞인 채 전체 취소** — 보통 라인만 행이 생긴다. Task 1 케이스.

---

## 배포

- **Core 만, 마이그 없음, 휴면.** 배포 순서 제약 없음. admin-web(PR 7)과 같은 배치에 실어도, 앞서 나가도 된다(N6 의 400 은 행 0 이라 보이지 않는다).
- Core 롤백(PR 5 로): 입점사 알릴 취소 행이 0 인 동안 안전하다. 생긴 뒤에 롤백하면 옛 읽기가 `holders` inner join 이라 그 행이 목록에서 사라진다(지워지지는 않는다).

---

### Task 0: 착수 전 라이브 실측 (사용자 터널)

**Files:** 없음(결과는 PR 본문에).

- [ ] **Step 1: 사용자에게 터널을 부탁한다** — `npx sst tunnel --stage live`. 터널은 사용자가 띄운다.
- [ ] **Step 2: 읽기 전용으로 잰다**

```sql
SELECT count(*) FILTER (WHERE holder_id IS NOT NULL) AS holder_notices,
       count(*) FILTER (WHERE supplier_id IS NOT NULL) AS supplier_notices
  FROM direct_ship_cancel_notices;
SELECT count(*) AS open_forwarded_drop_ship_fo FROM fulfillment_orders
 WHERE fulfillment_mode = 'drop_ship' AND direct_ship_status = 'forwarded'
   AND status NOT IN ('canceled', 'completed', 'shipped');
SELECT count(*) AS supplier_shipments FROM shipments WHERE supplier_id IS NOT NULL;
```

Expected: 넷 다 0. 하나라도 0 이 아니면 **멈추고 사용자에게 보고한다** — N5·N6·롤백 절의 전제다.

### Task 1: 넘긴 입점사 상자 라인 취소가 알릴 취소를 남긴다

**Files:**
- Create: `apps/core/src/modules/fulfillment/direct-ship-cancel-notice/record-supplier-cancel-notices.ts`
- Modify: `apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice.types.ts` — `SalesOrderCancellationOrigin`
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` — `cancelOutstanding`(:617) 인자, N4(b) 가드(`assessCancelReadiness` 바로 뒤: 입점사 상자인데 `readiness.kind !== 'ready'` 이거나 `readiness.steps.length > 0` 이면 `Error`), `applyDraftCancellation`(:1426)이 `origin` 을 받아 `shrinkDraftLines` 뒤에 새 함수 호출. `applyPendingCancellation`(:1243)은 `null` 을 넘긴다
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` — `cancelAfterBoxing`(:1798): `const orderCancellationId = randomUUID()` 를 계획 직후에 정하고 `cancelOutstanding(…, { orderCancellationId, scope }, tx)`, `cancellationValues.id = orderCancellationId`
- Modify: `cancelOutstanding` 스펙 호출 33곳 — `actor` 뒤에 `null`
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/direct-ship-cancel-notice-writers.guard.spec.ts` — 기대 목록에 새 파일을 **더한다**(옛 파일은 Task 2 가 뺀다 — 커밋마다 초록)
- Create: `apps/core/src/modules/sales-order/cancellation-record/__support__/supplier-cancellation-scenarios.ts`
- Test: `apps/core/src/modules/sales-order/services/sales-orders.supplier-cancel-notice.integration.spec.ts`, `apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts`(케이스 둘 추가)

**Interfaces:**
- Produces:
  - `export type SalesOrderCancellationOrigin = { orderCancellationId: string; scope: 'full' | 'partial' }`(types 파일)
  - `export async function recordSupplierCancelNotices(tx: DbTx, input: { origin: SalesOrderCancellationOrigin | null; shipment: ShipmentRow; canceled: ReadonlyArray<{ line: ShipmentLineRow; qty: number }> }): Promise<number>` — N3 조건을 거른 행을 한 번에 insert 하고 넣은 수를 돌려준다. 조건을 지난 행이 있는데 `origin === null` 이면 `Error`(메시지에 상자 id). `canceled` 의 `line` 은 줄이기 **전** 값(사유 칸 판정용)
  - `ShipmentPlanningService.cancelOutstanding(shipmentId: string, dto: CancelShipmentOutstandingDto, idempotencyKey: string, actor: ShipmentPlanningActor, origin: SalesOrderCancellationOrigin | null, tx?: DbTx)`
  - 시드: `seedSupplierCancellableOrder(tx, w: ReturnType<typeof wireCancellation>, input: { warehouseQty?: number; supplierLines: Array<{ supplierKey: string; quantity: number }> }): Promise<{ salesOrderId: string; lineIds: string[]; foId: string; supplierIds: Record<string, string>; warehouseId: string }>` — 직배 공급사·`drop_shipped` SKU·매칭·판매주문을 만들고 **실제 FO 생성**(`logistics.fulfillments.create`)으로 상자를 만든다. 본보기는 `fulfillment/services/fulfillments.supplier-shipments.integration.spec.ts` 의 `seedDirectSupplier`·`seedDropShippedSku`·`orderOf`(옮겨 쓰고 그 스펙도 새 시드를 import 해도 된다). 넘김은 `SupplierHandoffService.handOff`, 못 보냄은 `reportUnfulfillable`, 합포장·발송·되돌리기는 `mergeSupplierShipments`·`shipSupplierShipment`·`recallSupplierShipment`(배선 본보기 `supplier-shipment/supplier-recall.integration.spec.ts`)

- [ ] **Step 1: 판매주문 통합 spec** — 각 케이스는 `salesOrders.cancel(…)` 한 번 뒤 `direct_ship_cancel_notices` 행과 상자·FOI 를 본다:
  - `넘긴 입점사 상자 전체 취소 — 행 하나, order_cancellation_id = sales_order_cancellations.id, supplier_id = 상자 입점사, holder_id NULL, scope 'full', canceled_qty = 라인 수량` · 상자 `canceled`
  - `넘기지 않은 입점사 상자 취소 — 행 0`
  - `부분 취소 2/5 — 행 canceled_qty 2, scope 'partial', 상자 draft·라인 qty 3, readLineQuantities 의 forwarded 3`
  - `못 보냄 라인 + 보통 라인 한 상자 전체 취소 — 보통 라인만 행`
  - `창고분 + 입점사 A(넘김) + 입점사 B(넘기지 않음) 전체 취소 — 행은 A 라인만, 창고 상자 canceled·확정 예약 0`
  - `되돌린 합포장 상자(주문 둘)에서 주문 1 만 취소 — 주문 2 라인 qty 그대로, 행은 주문 1 라인만·sales_order_id = 주문 1`
  - `되돌린 단일 상자 취소 — 넘김 기록이 남아 행이 생긴다`
  - `발송된 입점사 라인 부분 취소 — 409, 행 0, FOI canceled_qty 그대로`
  - `같은 Idempotency-Key 재전송 — 두 번째 호출 뒤 행 수 그대로`
- [ ] **Step 2: 출고 통합 spec 두 케이스**(`shipment-planning.integration.spec.ts`, 기존 `op.seedDirectSupplier`·`op.seedHandoff`·`op.seedBox` 사용):
  - `handed-off supplier box canceled without origin throws` — `cancelOutstanding(…, null, tx)` 가 `/supplier .* without .*cancellation/i` 류 `Error`(메시지에 상자 id), 상자·라인 그대로
  - `supplier box never needs settle steps` — 입점사 draft 상자에 시작 전 배치의 활성 작업 항목을 직접 insert 해(운영 경로로는 못 만든다) 준비도에 손질이 생기면 `Error`, 상자 상태·작업 항목 그대로
- [ ] **Step 3: 실패 확인** — 위 두 파일 실행 → 새 케이스 FAIL(행 0, 인자 개수 타입 에러는 Step 4 에서 정리)
- [ ] **Step 4: 구현** — 위 Interfaces 대로. 스펙 33곳은 `null` 을 넣는 기계적 수정
- [ ] **Step 5: 통과** — 두 파일 PASS, `npx jest apps/core/src/modules/fulfillment/services/shipment-planning.service.spec.ts apps/core/src/modules/fulfillment/services/cancel-outstanding-callers.guard.spec.ts` PASS, `npx jest apps/core/src/modules/fulfillment/unboxed-demand/direct-ship-cancel-notice-writers.guard.spec.ts` PASS, `npm run type-check` 에러 0
- [ ] **Step 6: Commit** — `git commit -m "K3 PR6 — 넘긴 입점사 상자 라인 취소는 같은 취소 id 로 알릴 취소를 남긴다(못 보냄 라인 제외)"`

### Task 2: 옛 상자 전 알릴 취소 쓰기를 지운다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.ts` — `recordPartnerNotices`(:145-187)·호출 둘·`reduce`/`cancelOrder` 의 `orderCancellationId` 인자 삭제, 클래스 주석에서 알릴 취소 언급 삭제
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` — `cancelOrder(id, trx)`·`reduce(salesOrderId, reductions, trx)` 호출(:1311, :2319), `applyUnboxedDemandReductions` 의 인자. 상자 전 경로의 `orderCancellationId` 는 취소 행 id 로 그대로 쓴다(주석의 «넘긴 직배의 대기 행이 이 취소를 가리킨다» 문장만 삭제)
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/direct-ship-cancel-notice-writers.guard.spec.ts` — 기대 목록에서 `unboxed-demand-cancellation.ts` 를 뺀다(남는 것 `manager.ts`·`record-supplier-cancel-notices.ts`), 머리 주석을 «생성은 상자 후 출고 명령(`applyDraftCancellation`)이 FOI 를 줄이는 같은 tx 에서»로
- Delete: `apps/core/src/modules/sales-order/services/sales-orders.drop-ship-cancel-notice.integration.spec.ts`(옛 `drop_ship` FO 시나리오 — Task 1 의 spec 이 대체)
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.integration.spec.ts` — 알릴 취소 케이스 삭제, 나머지 호출의 인자 정리

- [ ] **Step 1: 가드 spec 을 먼저 고친다** → 실행: `npx jest apps/core/src/modules/fulfillment/unboxed-demand/direct-ship-cancel-notice-writers.guard.spec.ts` FAIL(옛 파일이 아직 쓴다)
- [ ] **Step 2: 지운다 → 통과** — 가드 PASS, `grep -rn "recordPartnerNotices\|holderId: fo.ownerId" apps/core/src` 0줄, 상자 전 취소 통합 spec(`grep -rlE "cancelBeforeBoxing|unboxedDemand" apps/core/src --include=*.integration.spec.ts`) 기준선과 같음, `npm run type-check` 에러 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR6 — 옛 상자 전 알릴 취소(holders) 쓰기를 지운다, 쓰는 곳은 상자 후 출고 명령 하나"`

### Task 3: 알릴 취소 읽기·내려받기·완료 표시를 입점사 id 로

**Files:**
- Modify: `apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice.reader.ts` — `holders` → `suppliers` inner join(`n.supplier_id`), `sku_suppliers` 는 `(sku_id, supplier_id)` 로 정확히 조인(`DISTINCT ON` 제거), FOI id·주문번호(`orderNoSql()`) 선택. `listOpen(filter: { supplierId?: string; noticeIds?: string[] })`, `listOpenSelected(supplierId, noticeIds)`
- Modify: `.manager.ts` — `markNotified(supplierId: string, noticeIds, notifiedBy)`: 잠근 행의 `supplier_id` 가 전부 같아야 한다(아니면 지금 문구 그대로 `BadRequestError`)
- Modify: `.service.ts` — 인자 이름 `supplierId`, 파일 이름은 행의 입점사 이름(N7). 행이 없으면 reader 가 이미 던진다
- Modify: `.types.ts` — `DirectShipCancelNotice` 에 `supplierId: string`, `fulfillmentOrderItemId: string`, `orderNo: string` 추가, `companyName` 은 입점사 이름
- Modify: `direct-ship-cancel-notice-csv.ts` — N7 열
- Modify: `apps/core/src/modules/fulfillment/controllers/direct-ship.controller.ts:40-48, 396-428` — 쿼리 `supplierId`(uuid 아니면 400), 두 zod 본문 `{ supplierId: z.string().uuid(), noticeIds }`, `@ApiQuery` 이름
- Test: `direct-ship-cancel-notice.integration.spec.ts`, `direct-ship-cancel-notice-csv.spec.ts`

- [ ] **Step 1: spec** —
  - 통합: 입점사 A 행 둘·B 행 하나(Task 1 의 실제 취소로 만든다) → `listOpen({ supplierId: A })` 둘(오래된 순), `listOpen({})` 셋, 각 행 `supplierId`·`companyName`(A 이름)·`orderNo`·`fulfillmentOrderItemId`; SKU 에 다른 공급사 연결이 먼저 있어도 `supplierSku` 는 A 의 코드; `markNotified(A, [A행, B행])` → `BadRequestError`, 아무 행도 안 바뀜; `markNotified(A, [A행 둘])` → `{ notified: 2 }`, 다시 부르면 `{ notified: 0 }`
  - CSV: 머리글 8개가 N7 순서이고 앞 넷이 `SUPPLIER_SHEET_COLUMNS` 의 `rowKey`·`orderNo`·`productName`·`supplierSku` 머리글과 같다; 셀 따옴표 이스케이프 그대로; 고객 이름·연락처·주소 칸 없음
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — 두 spec PASS, `npx jest apps/core/src/modules/fulfillment/controllers scripts/security libs/authorization` PASS(라우트·권한 게이트), `grep -rn "companyName" apps/core/src/modules/fulfillment/direct-ship-cancel-notice` 이 응답 칸(`companyName`) 외 0줄, `npm run type-check` 에러 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR6 — 알릴 취소는 입점사 id 로 찾고, CSV 는 입점사가 받은 시트의 행 키·주문번호로"`

### Task 4: ADR·설계 문서·게이트·PR

**Files:**
- Modify: `docs/adr/0050-drop-ship-is-a-supplier-shipment.md` — Decision 에 13번: «넘긴 입점사 상자 라인의 취소는 상자 후 출고 명령(`applyDraftCancellation` → `recordSupplierCancelNotices`)이 FOI 취소와 같은 트랜잭션에 알릴 취소를 쓴다. 취소 id 는 판매주문이 먼저 정해 넘긴다. «못 보냄» 라인은 남기지 않는다. 알릴 취소는 입점사 id 로 찾는다». :39 의 «PR 6 이 고친다» 문장을 «PR 6 이 고쳤다»로
- Modify: `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md:43` — 문단 끝에 한 문장: «K3 PR 6(ADR-0050 13번)부터 이 행은 상자 후 경로가 쓴다 — 직배 주문도 상자가 있다. 상자 전 경로의 쓰기는 지웠다.»(원문은 남긴다 — 당시 결정의 기록)
- Modify: 설계 문서 §7 아래 «PR 7 구현자에게»에 PR 6 몫 두 줄(아래 «다음 PR»), «PR 8 구현자에게»에 한 줄
- Modify: `docs/order-logistics-architecture-audit-2026-10.md` §8.1 K3 — 한 줄: 알릴 취소가 상자 후 경로로(PR 6)

- [ ] **Step 1: 문서를 쓴다**
- [ ] **Step 2: 검증 게이트** — `npm run type-check && npx jest` → 에러 0, 실패 0(환경 실패 4개 제외). 통합 `k3_pr2_it` 기준선 외 실패 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR6 — ADR-0050 에 상자 후 알릴 취소, ADR-0049 PR5 문단에 이관 한 줄"`
- [ ] **Step 4: PR** — 본문에 Task 0 실측값, «마이그 없음·Core 만·휴면», N1~N8, 롤백 절, N6 의 «옛 화면 버튼 400(행 0)». 머지·배포는 사용자가 정한다

---

## 다음 PR 에 넘기는 것

- **PR 7(admin-web):** 「알릴 취소」 탭은 행의 `supplierId` 로 묶고 내려받기·완료에 `{ supplierId, noticeIds }` 를 보낸다 — 옛 `companyName` 본문은 400 이다(N6). 머리글은 `companyName`(입점사 이름) 그대로 써도 된다. CSV 는 서버가 만든다(개인정보 없음).
- **PR 7:** 「못 보냄」 화면에서 취소로 가는 링크 — 못 보냄 라인의 취소는 알릴 취소를 남기지 않는다고 문구로 알려도 된다(입점사가 먼저 알려 온 것).
- **PR 8(contract):** `direct_ship_cancel_notices.holder_id` 칸·FK·`ck_..._party` 를 `supplier_id NOT NULL` 로 좁힌다(`deploy → migrate`, 스크래치 DB 먼저). `UnboxedDemandCancellation` 주석·`seedFo({ dropShip })` 픽스처의 옛 직배 갈래도 함께.
