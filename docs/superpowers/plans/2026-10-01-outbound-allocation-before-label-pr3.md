# PR 3 — 되돌림 바구니 · 집은 뒤 이탈 · 전체 취소 연결 (#989) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시작된 배치의 어떤 박스든 뺄 수 있다. 이미 집은 상품은 되돌림 바구니를 거쳐 원래 로케이션으로 돌아가고, 시작된 배치 박스의 전체 취소는 영원히 대기하지 않고 이탈로 끝난다.

**Architecture:** 이탈은 목표를 0 으로 바꾸는 일이다. `BoxWithdrawalService.begin` 이 `reconcileAllocation`(PR 2)으로 집지 않은 몫을 즉시 `HAND_BACK` 하고, 남은 배정이 있으면 작업 항목을 `withdrawing`(+`exit_to`)으로 둔다. 남은 배정은 실물이 되돌림 바구니에 들어갈 때마다 `REMOVE_TO_RETURN_BIN` 한 번에 하나씩 준다(박스에서 — 세 방식 공통, 카트 여분에서 — 토탈피킹 전용). 배정 합이 0 이 되는 트랜잭션에서 `exitIfDrained` 가 작업 항목을 `excluded` 로 끝내고, `exit_to = canceled` 면 송장을 로컬 무효화하고 기다리던 취소 오퍼레이션을 완료한다. 바구니의 물건은 `PUTAWAY_RETURN` 으로 원래 로케이션에 적치되면서 세션 통제가 풀린다. warehouse-app 은 «뺄 상품» 화면, 기기별 «내 되돌림 바구니» 설정, «되돌림 적치» 화면을 얻는다.

**Tech Stack:** NestJS 11 · Drizzle ORM(postgres.js) · Jest(core) · React 19 + TanStack Query/Router + Vitest(warehouse-app, Tauri)

**Spec:** `docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md` — §1~§5 공통, §8(PR 2 가 정한 것 포함)·§10.5·§11(PR 3 행)·§12·§13·§14·§15 PR 3 절, 그리고 이 계획이 스펙 본문에 더한 «PR 3 계획이 정함». S1 스펙 `2026-09-29-outbound-live-allocation-design.md` §4.3·§5.3·§5.4·§6.3·§7.1 이 이탈·되돌림의 원래 설계다(§5.4 의 «카트 여분은 배정에서 즉시 뺀다» 는 이 계획이 대체한다 — 아래 정한 것 2). 실행자는 이 계획과 두 스펙을 **함께** 읽는다.

**트래킹:** #986 / 이 PR: #989. 선행: PR 1 #992(develop `835b53b54`), PR 2 #1001(develop `1beebf45a`). 참고 계획: `docs/superpowers/plans/2026-09-30-outbound-allocation-before-label-pr2.md`(테스트 배선·픽스처·잠금 규칙의 선례).

## Global Constraints

- core 와 warehouse-app 을 **이 PR 하나에서** 바꾸고 함께 배포한다(스펙 §15). **PR 1·PR 2 가 먼저 배포돼 있어야 한다** — 이 계획을 쓴 2026-10-01 기준 PR 2 는 머지됐고 배포는 확인되지 않았다(구현 착수 전·머지 전에 다시 확인).
- 스키마 변경은 전부 추가·완화형 + 생산자 0 인 값의 CHECK 재정의 — 배포 순서 **`migrate → deploy`**(CLAUDE.md expand phase). `RETURN_PENDING` 보관 CHECK 는 키를 바꾸지만 지금까지 그 값을 만든 코드가 없다(배포 전 확인 쿼리는 Task 17).
- 🔴 **enum 함정:** drizzle migrate 는 전 마이그를 한 트랜잭션으로 돈다. `ADD VALUE 'withdrawing'` 을 같은 실행의 CHECK·기본값·데이터에서 **값으로** 쓰면 실패한다. CHECK 는 `${t.status}::text <> 'withdrawing'` 처럼 텍스트로 비교한다(스펙 §11, `ck_outbound_batches_cart_capacity` 선례).
- 서비스 계층의 fulfillment HTTP 오류는 `ConflictException({ code, message })`(목록이 필요하면 `errors` — 전역 필터가 본문에 그대로 싣는다. `details` 는 준비 차단 전용 허용 목록이라 쓰지 않는다). 조회의 «없음» 은 `NotFoundException({ code, error: code, message })`. waybill 오류는 `ConflictError('<CODE>: …')` 메시지 접두어.
- 트랜잭션: 공개 메서드는 `tx?: DbTx` 마지막 인자 + `this.dbService.run(fn, tx)`, private 헬퍼는 `trx: DbTx` 필수(ADR-0025). `db.query.*`·`with` 금지, `any` 금지, 근거 없는 `as` 금지(테스트 배선의 `as never` 스텁은 기존 관례).
- **잠금 순서(스펙 §13 + PR 2 가 정한 전역 순서):** 구성요소(불변식 검사기 `assertFulfillmentOrders`) → 작업 항목 → **세션 → 보관 행** → SKU 가용 잠금 → 재고 원장. 이 계획의 새 경로:
  - 박스에서 되돌림: 구성요소 → 작업 항목 → 세션 → 보관
  - 카트 여분 되돌림: 카트 advisory 잠금 → 영향받는 박스들의 구성요소(불변식 검사기가 작업 항목·세션·보관까지 잡는다) → 작업 항목(id 순) → 세션 → 보관 (최종 리뷰에서 고침 — 구성요소를 먼저 잡으면 카트 → 세션 순서인 분류·일괄 담기·인계와 교착)
  - 되돌림 적치: 세션(id 순, 한 명령이 여러 세션) → 보관. 작업 항목·구성요소를 잡지 않는다
  - 전체 취소 연결: 구성요소 → 취소 오퍼레이션 행 → 작업 항목 → 세션 → 보관
- 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0(OOM 회피), `npx jest scripts/security`(IDOR 가드는 서비스 파일 줄번호 좌표 — 빨가면 가드가 알려 주는 대로 좌표를 갱신). 앱은 `cd native/warehouse-app && npx tsc -b && npx vitest run && npx oxlint`.
- 통합 스펙은 `describeIfDb` 가드, 스펙 안에서 `dotenv.config()` 금지. 실행은 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>`(`--runInBand` 고정). 로컬 `core` DB 가 다른 브랜치 마이그 잔재로 멈추면(PR 1·2 에서 겪음) **새 DB** 를 만든다: `docker compose exec -T postgres createdb -U postgres core_989` → `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_989 npx drizzle-kit migrate --config apps/core/drizzle.config.ts` → `DATABASE_URL=…/core_989 npx jest --testPathPattern=<패턴> --runInBand`. PR 2 의 `core_988` 은 커밋형 픽스처 잔재가 쌓여 쓰지 않는다.
- 작업자 문구는 «라벨»이 아니라 **«송장»**.
- 코드 좌표는 함수·파일 이름으로 적는다. 줄 번호로 찾지 말 것.
- **코드 블록은 설계를 담은 초안이다.** 이름·시그니처·오류 코드·잠금 순서·트랜잭션 경계는 그대로 지킨다. 타입 에러·import 경로 같은 기계적 차이는 주변 코드에 맞춰 고친다. 설계가 코드와 맞지 않으면 멈추고 컨트롤러에 알린다(스펙 반영이 필요할 수 있다).
- **이 계획이 정한 것** — 스펙 본문에 «PR 3 계획이 정함» 으로 이미 반영했다(이 계획과 같은 커밋). 구현하며 바뀌면 Task 17 이 «PR 3 구현이 정함» 으로 고친다:
  1. **되돌림 스캔 지점은 hook 이 아니라 명령 둘이다.** 박스에서(`POST shipments/:shipmentId/return-bin-removals` — 세 방식 공통, 박스 줄에 귀속된 보관 `WORKER`·`TOTE`·`SORTING`·`PACKING`·`PACKED` 어디서든)와 카트 여분에서(`POST picking/v2/aggregate-then-sort/cart-surplus-returns` — 토탈피킹 전략의 메서드, 카트 잠금·카트 소유 규칙이 전략에 있다). `reconcileStage` 는 늘어날 때(S2)만 필요해 PR 3 은 만들지 않는다.
  2. **카트 여분은 배정에서 즉시 빼지 않는다(S1 §5.4 대체).** 카트에 실린 미귀속 몫은 «뺄 물건» 처럼 배정에 남고, 분류대에서 여분을 바구니에 넣는 `REMOVE_TO_RETURN_BIN`(from `BULK_CART`)이 배정을 준다. 이유: 모든 배정 감소가 세션 이벤트를 가져야 복구 규칙(배정마다 이벤트 합 = 배정)이 서고, I3 공유 식(`AT_SOURCE + BULK_CART ≤ 배정 − 귀속`)을 느슨하게 만들지 않아도 된다. 대가: 토탈피킹 배치에서 카트에 실린 몫이 있는 박스는 여분이 바구니에 들어갈 때까지 `withdrawing` 이다(취소 완료도 그때).
  3. **이탈 시작:** 집지 않은 몫은 그 트랜잭션에서 `HAND_BACK`. 남은 배정이 0 이면 그 트랜잭션에서 나가고(`excluded`), 아니면 작업 항목 `withdrawing` + `exit_to` + 사유(`exclusion_reason` 에 미리 적는다) + 피커·패커 claim 해제(리스 무효). 토트 배정·`inspected_qty > 0` 은 더 막지 않는다 — 토트는 나갈 때 비었으면 풀고(`ToteLifecycleService.releaseEmptyAssignmentsForShipment`), `PACKED` 를 빼면 `inspected_qty` 도 준다. `BOX_HAS_PICKED_ITEMS` 는 사라진다. 결품 격리(`short_pick_recovery`)·발송 시도·세션 비활성은 기존 코드로 거절(`WORK_ITEM_ALLOCATED`·`WORK_ITEM_DISPATCH_EXISTS`·`PICKING_SESSION_NOT_ACTIVE`).
  4. **나가기(`exitIfDrained`):** 작업 항목의 배정 합이 0 이 되는 트랜잭션에서 `excluded`, 빈 토트 해제. `exit_to = draft` 면 박스는 PR 2 처럼 `planned` 그대로(예약·송장 유지). `exit_to = canceled` 면 활성 송장(`registered`)을 로컬 무효화하고 기다리던 취소 오퍼레이션(`waiting_operation_id`)을 **같은 트랜잭션에서** 완료한다. `draft` 로 나간 박스의 대기 오퍼레이션(합포장·옛 부분 취소) 재개는 PR 2 처럼 커밋 뒤다.
  5. **이미 빼는 중인 박스를 다시 빼면 `SHIPMENT_ALREADY_WITHDRAWING`.** 단 전체 취소가 오면 `exit_to` 를 `draft` → `canceled` 로 올린다(반대는 없다).
  6. **`PACKED` 에서 빼면 `shipment_lines.inspected_qty` 를 같은 수만큼 줄이고 `line_version` 을 올린다.** 그래서 전체 취소 완료는 `line_version` 대신 «취소 수량 = 줄 수량» 으로 줄이 그대로인지 확인한다.
  7. **되돌림 바구니:** 등록 `POST return-bins {warehouseId, barcode}`(바코드 `RB-` 접두어. 같은 창고의 활성 행이 있으면 그대로 돌려준다, 다른 창고면 `RETURN_BIN_WAREHOUSE_MISMATCH`, 폐기된 행이면 `RETURN_BIN_UNKNOWN`), 조회 `GET return-bins/:barcode?warehouseId=`(바구니 + 남은 물건: SKU·원래 로케이션·수량. 없으면 404 `RETURN_BIN_UNKNOWN`). 폐기 명령은 두지 않는다(컬럼과 거절만). 토트 등록은 `RB-` 로 시작하는 바코드를 `TOTE_BARCODE_RESERVED` 로 거절한다 — 같은 문자열이 두 종류로 등록되지 않게(S1 §6.3).
  8. **되돌림 적치:** `POST return-bins/:barcode/putaways {warehouseId, barcode, locationCode, quantity}`. 한 바구니에 여러 배치(세션)의 물건이 섞이므로 세션 id 순으로 뺀다. 그 SKU 가 바구니에 없으면 `RETURN_BIN_ITEM_NOT_FOUND`, 수량이 모자라면 `RETURN_BIN_ITEM_SHORT`, 로케이션이 원래 로케이션이 아니면 `RETURN_LOCATION_MISMATCH`(`errors` 에 원래 로케이션·수량 목록), 세션이 `active` 가 아니면 `PICKING_SESSION_NOT_ACTIVE`. 원장(`stock_events`)은 건드리지 않는다 — 그 물건은 원장상 그 로케이션을 떠난 적이 없다.
  9. **`returned_qty` 는 PR 3 에서 `RETURN_TO_SOURCE`(결품 반환 — 생산자는 PR 4 가 없앤다)와 `PUTAWAY_RETURN` 의 합이다.** 둘 다 «세션 통제가 풀려 원래 로케이션의 일반 재고로 돌아간 양» 이라 보존식은 그대로다. `PUTAWAY_RETURN` 만의 합으로 좁혀지는 것은 PR 4 에서 결품 반환 생산자가 사라질 때다.
  10. **전체 취소 연결(E10)의 조건:** 취소가 박스 전량이고, 박스의 활성 작업 항목이 시작된 배치에 있으며, 이탈을 막는 사유(결품 격리·발송 시도·세션 비활성)가 없을 때. 그 밖(부분 취소 — E11, 세션 `recovery_required` 등)은 지금처럼 `CANCEL_REPLAN_PENDING` 대기다. 취소 오퍼레이션은 `pending`(의도 `pendingIntent` 기록)으로 만들어지고 작업 항목이 `waiting_operation_id` 로 기다린다. 박스는 그동안 `planned` 다(recovery 표시 없음). 집은 게 없으면 같은 트랜잭션에서 나가며 오퍼레이션도 `completed` 다.
  11. **`SHIPMENT_WITHDRAWN` 의 범위:** 작업 항목이 `withdrawing`·`excluded` 인 박스의 전진 명령 — 피커 claim 검사(`lockAndAssertPickerClaim`, 전략 7곳 공통), 검수·발송 잠금(`ShipmentDispatchService.lockAggregate`), 단순출고 준비(`SimpleOutboundService` 의 작업 항목 적재), 송장 게이트(`LabelCurrencyGuard`). 송장 렌더는 I4 대로 `WAYBILL_LABEL_NOT_ALLOCATED`. 결품 보고는 기존 `SHORT_PICK_WORK_ITEM_STATE`.
  12. **`BOX_EXCESS_PENDING` 은 PR 3 에 생산자가 없다.** «배정 > 목표» 는 PR 3 에서 `withdrawing` 박스에서만 생기고, 그 박스의 전진 명령은 `SHIPMENT_WITHDRAWN` 이 먼저 막는다. 줄 단위 감소(S2)가 생산자다.
  13. **송장 스캔 `labelState`:** `withdrawing` 은 뺄 목록 `removals`(줄·SKU·원래 로케이션·박스에 든 몫 `boxQty`·카트에 실린 몫 `cartQty`)와 `exitTo` 를 싣는다. `withdrawn` 은 활성 작업 항목이 없고 마지막 작업 항목이 **시작된 배치에서** `excluded` 인 박스다. `canceled` 로 나간 박스는 송장이 무효라 by-waybill 이 활성 송장을 못 찾을 때 그 번호의 무효 송장으로 박스를 찾아 `withdrawn` 을 준다.
  14. **세션 이벤트 멱등 키·payload:** 되돌림 `remove-to-bin:<명령 id>:<배정 id>:<보관 grain 해시 16자>`(한 명령이 같은 배정을 두 보관에서 뺄 수 있다), payload `operationId`·`workItemId`·`allocationId`·`shipmentLineId`·`returnBinId`. 적치 `putaway-return:<명령 id>:<세션 id>`(한 명령은 세션마다 한 보관 grain), payload `operationId`·`returnBinId`.
  15. **복구 규칙:** 배정마다 `HAND_IN` 이 하나 이상 있고 `Σ HAND_IN − Σ HAND_BACK − Σ REMOVE_TO_RETURN_BIN = qty`. `RETURN_PENDING` grain 은 «바구니 ref 있음·줄 없음».
  16. **불변식:** (a) 줄 귀속 보관 집합(`LINE_ATTRIBUTED_CUSTODY`)에서 `RETURN_PENDING` 을 뺀다 — 바구니 키(줄 없음)이고 배정에서 이미 빠진 몫이라 어느 배정과도 견주지 않는다. `SETTLED` 는 남는다. (b) I2 는 `withdrawing` 을 보지 않는다(목표 0). (c) **I3 공유 식은 `excluded` 작업 항목의 배정을 세지 않는다** — PR 3·4 경계: 결품 보고(`ShipmentShortPickService.reconcileAffectedCustody`)는 박스의 배정 전부(보고하지 않은 줄 포함)를 줄 보관과 공유 풀(`AT_SOURCE`·`BULK_CART`)에서 끝까지 정산하고, 모자라면 `SHORT_PICK_CUSTODY_INSUFFICIENT` 로 전부 되돌린다. 그래서 옳은 장부에서 빈 시작된 배치의 `AT_SOURCE`·`BULK_CART` 는 0 이다. 그런데 결품으로 제외된 작업 항목의 배정 행은 줄지 않고 남아, 옛 식은 그 행을 공유 보관의 «방» 으로 세어 떠도는 `AT_SOURCE` 를 가렸다. 빈 배치에 정당하게 남는 보관은 되돌림 바구니(`RETURN_PENDING`)뿐이다.
  17. **새 거절 코드:** `SHIPMENT_ALREADY_WITHDRAWING`, `SHIPMENT_NOT_WITHDRAWING`(빼는 중이 아닌 박스에 되돌림 스캔), `REMOVAL_NOT_PENDING`(박스에 그 상품의 뺄 몫이 없거나 모자람), `CART_SURPLUS_NOT_PENDING`, `RETURN_BIN_WAREHOUSE_MISMATCH`, `RETURN_BIN_ITEM_NOT_FOUND`, `RETURN_BIN_ITEM_SHORT`, `TOTE_BARCODE_RESERVED`, `WITHDRAWAL_WAYBILL_NOT_VOIDABLE`(취소로 나가는데 활성 송장이 `registered` 가 아님). 합류 후보 조회의 `issue` 에 `SHIPMENT_WITHDRAWING`(이 배치에서 빼는 중인 박스).
  18. **배치 목록**에 `withdrawingItems`(빼는 중인 박스 수) — 배치 카드의 «빠지는 중 N».
  19. **앱:** «뺄 상품» 스캔과 «되돌림 적치» 는 화면 스캔 큐(`useWorkScanQueue`)로 보낸다 — 물리 입력을 먼저 저장하고 불확실한 실패는 재시도한다. 오프라인 작업 원장(`operationRunner` 의 `ledgerPath`)에는 넣지 않는다(재고 원장 이벤트가 아니다). «내 되돌림 바구니» 설정은 두 프로필(스테이션·핸드헬드) 모두에 둔다.
- **이 PR 에서 하지 않는 것(스펙 §15 PR 3 «아직 안 하는 것»):** 결품 재배정(PR 4 — 결품 보고는 지금처럼 박스를 제외·초안 복귀), 부분 취소(E11), 박스 내용 변경(S2), 토탈피킹·바구니 피킹의 현장 화면(D3 — core 명령만), 바구니 폐기 명령, `short_pick_recovery` 상태 제거(contract).

## Review Focus

1. **토탈피킹 — 카트에 몫이 실린 박스를 뺀 뒤 남은 박스를 계속 분류할 때.** 카트의 물건은 누구 몫인지 모른다. 기대: 분류는 남은 박스의 배정만큼만 받고, 여분 되돌림은 `min(이 카트의 BULK_CART, 빼는 박스들의 미귀속 배정)` 만 받는다. 둘을 섞어도 `AT_SOURCE + BULK_CART = Σ 미귀속 배정` 이 유지되고 복구가 healthy. → Task 9 테스트.
2. **같은 SKU 가 두 로케이션에서 배정된 박스를 뺄 때.** 바구니에 로케이션이 섞인다. 기대: 바구니 보관은 원래 로케이션을 들고(`source_location_id`), 적치는 그 로케이션만 받으며 틀리면 `RETURN_LOCATION_MISMATCH` + 원래 로케이션 목록. → Task 8·Task 10 테스트.
3. **전체 취소가 집은 박스에 오고, 작업자가 마지막 한 개를 바구니에 넣는 순간.** 기대: 그 스캔 트랜잭션에서 작업 항목 `excluded`, 송장 무효, 예약 해제, 박스 `canceled`, 취소 오퍼레이션 `completed` 가 함께 일어난다. 중간이 실패하면 스캔도 되돌아간다(반쯤 적용 없음). → Task 11 테스트.
4. **검수까지 끝난(`PACKED`) 상품을 뺄 때.** `inspected_qty` 가 따라 줄지 않으면 그 박스가 다른 배치에 다시 들어갔을 때 «이미 검수됨» 으로 계산돼 발송이 틀어진다. 기대: 뺀 만큼 `inspected_qty` 감소, 다 빼면 0, 재합류 가능. → Task 8 테스트.
5. **바구니에 여러 배치(세션)의 같은 SKU·로케이션이 섞였을 때 적치.** 기대: 세션 id 순으로 빠지고, 보관이 0 이 된 세션은 그 이벤트에서 `settled`, 적치한 만큼 일반 가용이 는다. 빈 시작된 배치의 세션은 바구니 적치가 끝나야 `settled`. → Task 10 테스트.

---

## 파일 지도

core (`apps/core/src/modules/fulfillment/` 기준, 스키마는 `apps/core/src/modules/inventory/schema/inventory.schema.ts`)

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `inventory.schema.ts` · `apps/core/drizzle/*_return-bin-withdrawal.sql` | `withdrawing`·`exit_to`, `return_bins`, `RETURN_PENDING` 바구니 키, 바구니 조회 인덱스 | 1 |
| `services/work-item-status.ts` (신규) | 활성·이탈 가능 작업 항목 상태의 단일 정의 | 1 |
| `services/batch-inventory-session.service.ts` · `services/line-attributed-custody.ts` · `picking/allocation/reconcile-allocation.ts` | `removeToReturnBin`·`putawayReturn`, 보관 grain 규칙, `returned_qty` | 2 |
| `services/batch-session-recovery.service.ts` | 새 이벤트 재생, 배정 규칙 확장 | 3 |
| `services/fulfillment-invariant.service.ts` | I2 `withdrawing`, I3 공유 식 | 4 |
| `services/return-bin.service.ts` (신규) · `controllers/return-bin.controller.ts` (신규) · `dto/return-bin.dto.ts` (신규) · `picking/pick-to-tote.strategy.ts` | 바구니 등록·조회·적치, 토트 `RB-` 예약 | 5·10 |
| `services/box-withdrawal.service.ts` (신규) · `services/box-allocation.manager.ts` · `services/withdrawal-removals.query.ts` (신규) · `services/outbound-batch-orchestrator.service.ts` · `dto/outbound-batch-v2.dto.ts` | 이탈 시작·나가기·박스에서 되돌림, 뺄 목록, `excludeShipment` 전환, 합류 후보·배치 목록 | 6·8 |
| `picking/allocation/allocation.queries.ts` · `picking/allocation/allocation.errors.ts` · `services/shipment-dispatch.service.ts` · `services/simple-outbound.service.ts` · `waybill/label-currency.guard.ts` · `waybill/waybill.reader.ts` · `waybill/waybill.types.ts` · `waybill/waybill-label-content.assembler.ts` | `SHIPMENT_WITHDRAWN`, I4 `withdrawing` | 7 |
| `picking/aggregate-then-sort.strategy.ts` · `picking/picking-strategy.interface.ts` · `services/picking-process.service.ts` · `controllers/picking-v2.controller.ts` · `dto/picking-v2.dto.ts` | 카트 여분 되돌림 | 9 |
| `services/shipment-planning.service.ts` | 전체 취소 → 이탈, 취소 완료 | 11 |
| `waybill/label/label-print-policy.ts` · `waybill/waybill-label-state.reader.ts` · `reader/shipment-waybill.reader.ts` | `labelState` `withdrawing`·`withdrawn`, `removals` | 12 |
| `services/__support__/simple-outbound-wiring.ts` · `services/__support__/simple-outbound-fixtures.ts` · 생성자를 직접 부르는 스펙들 · `fulfillment.module.ts` | 배선 | 5·6·9·11 |

warehouse-app (`native/warehouse-app/src/` 기준)

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `core/data/httpClient.ts` · `core/data/errorMessage.ts` · `domains/outbound/types.ts` · `domains/outbound/waybillLabel.ts` · `domains/outbound/labelGate.ts` · `domains/outbound/batchJoin.ts` | 새 코드·문구·타입, 송장 스캔 판정 | 13 |
| `domains/returns/returnBin.ts` (신규) · `domains/returns/returnBinApi.ts` (신규) · `domains/returns/ReturnBinSettings.tsx` (신규) · `app/routes/SettingsRoute.tsx` | 기기별 «내 되돌림 바구니» | 14 |
| `domains/outbound/batchRemove.ts` · `domains/outbound/RemoveBoxPanel.tsx` · `domains/outbound/withdraw.ts` (신규) · `domains/outbound/WithdrawBoxScreen.tsx` (신규) · `app/routes/WithdrawRoute.tsx` (신규) · `app/routeTree.tsx` · `domains/outbound/OutboundQueueScreen.tsx` | 박스 빼기 결과, 뺄 상품 화면, 배치 카드 | 15 |
| `domains/returns/returnPutaway.ts` (신규) · `domains/returns/ReturnPutawayScreen.tsx` (신규) · `app/routes/ReturnPutawayRoute.tsx` (신규) · `app/routeTree.tsx` · `profiles/station/StationHome.tsx` · `profiles/handheld/HandheldHome.tsx` | 되돌림 적치 화면 | 16 |

---
### Task 1: 스키마 — `withdrawing`·`exit_to`, `return_bins`, 바구니 키 `RETURN_PENDING`

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`outboundBatchWorkItemStatusEnum`, 새 `outboundWorkItemExitToEnum`, `outboundBatchWorkItems`, 새 `returnBins`(+ `wmsTables` 목록), `batchInventorySessionBalances`, `batchInventorySessionEvents`)
- Create: `apps/core/drizzle/<timestamp>_return-bin-withdrawal.sql` + `apps/core/drizzle/meta/*` (생성물)
- Create: `apps/core/src/modules/fulfillment/services/work-item-status.ts`
- Test: `apps/core/src/modules/fulfillment/services/work-item-status.spec.ts`, `apps/core/src/modules/fulfillment/services/withdrawal-schema.constraints.integration.spec.ts`

**Interfaces:**
- Produces: 작업 항목 상태 `'withdrawing'`, 컬럼 `wmsTables.outboundBatchWorkItems.exitTo`(`'draft' | 'canceled' | null`), `wmsTables.returnBins`(`id`·`warehouseId`·`barcode`·`registeredBy`·`retiredAt`·`createdAt`). `RETURN_PENDING` 보관·이벤트 grain = `source_location_id` 있음 · `custody_ref`(바구니 바코드) 있음 · `shipment_line_id` 없음.
- Produces (`services/work-item-status.ts`): `ACTIVE_WORK_ITEM_STATUSES`, `WITHDRAWABLE_WORK_ITEM_STATUSES`, `type WorkItemStatus`, `type WorkItemExitTo`.

- [ ] **Step 1: 실패하는 테스트 둘을 쓴다**

`services/work-item-status.spec.ts` — 활성 상태 목록이 DB 의 활성 정의(부분 유니크 `uq_outbound_work_item_active_shipment` = completed·excluded 가 아닌 전부)와 갈리지 않게 지킨다:

```ts
import { outboundBatchWorkItemStatusEnum } from '../../inventory/schema/inventory.schema';
import { ACTIVE_WORK_ITEM_STATUSES, WITHDRAWABLE_WORK_ITEM_STATUSES } from './work-item-status';

describe('작업 항목 상태 정의', () => {
  it('활성 = completed·excluded 가 아닌 모든 값 — 부분 유니크 인덱스와 같은 정의', () => {
    const active = outboundBatchWorkItemStatusEnum.enumValues.filter((s) => s !== 'completed' && s !== 'excluded');
    expect([...ACTIVE_WORK_ITEM_STATUSES].sort()).toEqual([...active].sort());
  });

  it('이탈 가능 = 활성 중 결품 격리·이탈 중이 아닌 것', () => {
    expect([...WITHDRAWABLE_WORK_ITEM_STATUSES].sort()).toEqual(['packing', 'picking', 'queued', 'ready_to_pack']);
  });
});
```

`services/withdrawal-schema.constraints.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedPickableShipment } from './__support__/logistics-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('이탈·되돌림 스키마 (PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('withdrawing 은 exit_to 가 있어야 한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      await expect(
        tx.transaction((trx) =>
          trx
            .update(wmsTables.outboundBatchWorkItems)
            .set({ status: 'withdrawing' })
            .where(eq(wmsTables.outboundBatchWorkItems.id, f.workItemId)),
        ),
      ).rejects.toThrow(/ck_outbound_work_items_withdrawing_exit/);
      const [row] = await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'withdrawing', exitTo: 'draft', exclusionReason: '고객 요청' })
        .where(eq(wmsTables.outboundBatchWorkItems.id, f.workItemId))
        .returning();
      expect(row).toMatchObject({ status: 'withdrawing', exitTo: 'draft' });
    });
  });

  it('되돌림 바구니 바코드는 RB- 로 시작하고 전역 유일하다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const barcode = `RB-${randomUUID().slice(0, 8)}`;
      await tx.insert(wmsTables.returnBins).values({ warehouseId: f.warehouseId, barcode, registeredBy: f.actorId });
      await expect(
        tx.transaction((trx) =>
          trx.insert(wmsTables.returnBins).values({ warehouseId: f.warehouseId, barcode, registeredBy: f.actorId }),
        ),
      ).rejects.toThrow(/uq_return_bins_barcode/);
      await expect(
        tx.transaction((trx) =>
          trx
            .insert(wmsTables.returnBins)
            .values({ warehouseId: f.warehouseId, barcode: `TOTE-${randomUUID().slice(0, 8)}`, registeredBy: f.actorId }),
        ),
      ).rejects.toThrow(/ck_return_bins_barcode_prefix/);
    });
  });

  it('RETURN_PENDING 보관은 바구니 ref 가 있고 줄이 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const [session] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: f.batchId, handedInQty: 3 })
        .returning();
      const base = { sessionId: session.id, skuId: f.skuId, sourceLocationId: f.locationId, qty: 1 } as const;
      await expect(
        tx.insert(wmsTables.batchInventorySessionBalances).values({ ...base, custodyType: 'RETURN_PENDING', custodyRef: 'RB-1' }),
      ).resolves.toBeDefined();
      await expect(
        tx.transaction((trx) =>
          trx.insert(wmsTables.batchInventorySessionBalances).values({
            ...base,
            custodyType: 'RETURN_PENDING',
            custodyRef: 'RB-2',
            shipmentLineId: f.shipmentLineId,
          }),
        ),
      ).rejects.toThrow(/ck_batch_inventory_session_balances_custody/);
      await expect(
        tx.transaction((trx) =>
          trx.insert(wmsTables.batchInventorySessionBalances).values({ ...base, custodyType: 'RETURN_PENDING' }),
        ),
      ).rejects.toThrow(/ck_batch_inventory_session_balances_custody/);
      // SETTLED 는 그대로 — 줄 있음·ref 없음.
      await expect(
        tx.transaction((trx) =>
          trx.insert(wmsTables.batchInventorySessionBalances).values({
            ...base,
            custodyType: 'SETTLED',
            custodyRef: 'RB-3',
            shipmentLineId: f.shipmentLineId,
          }),
        ),
      ).rejects.toThrow(/ck_batch_inventory_session_balances_custody/);
    });
  });

  it('RETURN_PENDING 이벤트 grain 도 같다(to 쪽)', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const [session] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: f.batchId, handedInQty: 1 })
        .returning();
      const event = {
        sessionId: session.id,
        eventType: 'REMOVE_TO_RETURN_BIN',
        skuId: f.skuId,
        quantity: 1,
        fromCustodyType: 'WORKER',
        fromCustodyRef: f.actorId,
        fromSourceLocationId: f.locationId,
        fromShipmentLineId: f.shipmentLineId,
        toCustodyType: 'RETURN_PENDING',
        toSourceLocationId: f.locationId,
      } as const;
      await expect(
        tx.insert(wmsTables.batchInventorySessionEvents).values({ ...event, idempotencyKey: 'k1', toCustodyRef: 'RB-1' }),
      ).resolves.toBeDefined();
      await expect(
        tx.transaction((trx) =>
          trx
            .insert(wmsTables.batchInventorySessionEvents)
            .values({ ...event, idempotencyKey: 'k2', toCustodyRef: 'RB-1', toShipmentLineId: f.shipmentLineId }),
        ),
      ).rejects.toThrow(/ck_batch_inventory_session_events_to_grain/);
    });
  });
});
```

- [ ] **Step 2: 단위 테스트가 실패하는지 본다**

Run: `npx jest apps/core/src/modules/fulfillment/services/work-item-status.spec.ts`
Expected: FAIL — `Cannot find module './work-item-status'`

- [ ] **Step 3: 스키마를 고친다** — `inventory.schema.ts`:

작업 항목 상태 enum 끝에 값을 더하고, 바로 아래 새 enum:

```ts
export const outboundBatchWorkItemStatusEnum = pgEnum('outbound_batch_work_item_status', [
  'queued',
  'picking',
  'ready_to_pack',
  'packing',
  'completed',
  'short_pick_recovery',
  'excluded',
  // 이탈 중 — 목표 0, 집은 물건을 되돌림 바구니로 빼는 동안(스펙 §8). 활성으로 센다(uq_outbound_work_item_active_shipment).
  'withdrawing',
]);
// 이탈이 끝나면 박스가 갈 곳 — draft: 배치 전 풀(planned 그대로), canceled: 전체 취소 완료(스펙 §8).
export const outboundWorkItemExitToEnum = pgEnum('outbound_work_item_exit_to', ['draft', 'canceled']);
```

`outboundBatchWorkItems` 컬럼 `recoveryReason` 아래에 `exitTo: outboundWorkItemExitToEnum('exit_to'),` 를 넣고, 제약 목록에:

```ts
    // withdrawing 은 같은 마이그레이션에서 ADD VALUE 한 값이라 텍스트로 비교한다(enum 함정, 스펙 §11).
    // 나간 뒤(excluded)에도 exit_to 는 남긴다 — 송장 스캔(withdrawn)과 감사가 읽는다.
    ckOutboundWorkItemWithdrawingExit: check(
      'ck_outbound_work_items_withdrawing_exit',
      sql`${t.status}::text <> 'withdrawing' OR ${t.exitTo} IS NOT NULL`,
    ),
```

`totes` 정의 바로 아래에 새 테이블:

```ts
/**
 * 되돌림 바구니(스펙 §8, S1 §6.3) — 이탈한 박스에서 뺀 물건을 원래 로케이션에 적치할 때까지 담는 상주 용기.
 * 토트(박스 하나에 전용 배정)와 합치지 않는다. 보관 행의 `custody_ref` 가 이 바코드다(FK 아님 — 보관은 문자열 ref 를 쓴다).
 */
export const returnBins = pgTable(
  'return_bins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    barcode: varchar('barcode', { length: 128 }).notNull(),
    registeredBy: uuid('registered_by').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqReturnBinBarcode: unique('uq_return_bins_barcode').on(t.barcode),
    idxReturnBinWarehouse: index('idx_return_bins_warehouse').on(t.warehouseId),
    ckReturnBinBarcodePrefix: check('ck_return_bins_barcode_prefix', sql`${t.barcode} LIKE 'RB-%'`),
  }),
);
```

`wmsTables` 객체의 `totes,` 다음 줄에 `returnBins,` 를 넣는다.

`batchInventorySessionBalances` 의 `ckBatchInventoryBalanceCustody` 마지막 갈래(`RETURN_PENDING`·`SETTLED` 공용)를 둘로 가른다:

```ts
        OR (${t.custodyType} = 'RETURN_PENDING' AND ${t.sourceLocationId} IS NOT NULL AND ${t.custodyRef} IS NOT NULL AND ${t.shipmentLineId} IS NULL)
        OR (${t.custodyType} = 'SETTLED' AND ${t.sourceLocationId} IS NOT NULL AND ${t.custodyRef} IS NULL AND ${t.shipmentLineId} IS NOT NULL)
```

그리고 같은 테이블 제약 목록에 바구니 조회 인덱스(바구니 하나의 물건은 여러 세션에 흩어진다):

```ts
    idxBatchInventoryBalanceReturnBin: index('idx_batch_inventory_session_balances_return_bin')
      .on(t.custodyRef)
      .where(sql`${t.custodyType} = 'RETURN_PENDING' AND ${t.qty} > 0`),
```

`batchInventorySessionEvents` 의 `ckBatchInventorySessionEventFromGrain`·`ckBatchInventorySessionEventToGrain` 도 같은 방식으로 `RETURN_PENDING`·`SETTLED` 갈래를 가른다(`from…`/`to…` 컬럼 이름만 다르다):

```ts
          OR (${t.fromCustodyType} = 'RETURN_PENDING' AND ${t.fromSourceLocationId} IS NOT NULL AND ${t.fromCustodyRef} IS NOT NULL AND ${t.fromShipmentLineId} IS NULL)
          OR (${t.fromCustodyType} = 'SETTLED' AND ${t.fromSourceLocationId} IS NOT NULL AND ${t.fromCustodyRef} IS NULL AND ${t.fromShipmentLineId} IS NOT NULL)
```

```ts
          OR (${t.toCustodyType} = 'RETURN_PENDING' AND ${t.toSourceLocationId} IS NOT NULL AND ${t.toCustodyRef} IS NOT NULL AND ${t.toShipmentLineId} IS NULL)
          OR (${t.toCustodyType} = 'SETTLED' AND ${t.toSourceLocationId} IS NOT NULL AND ${t.toCustodyRef} IS NULL AND ${t.toShipmentLineId} IS NOT NULL)
```

- [ ] **Step 4: 상태 정의 모듈을 만든다** — `services/work-item-status.ts`:

```ts
import { outboundBatchWorkItemStatusEnum, outboundWorkItemExitToEnum } from '../../inventory/schema/inventory.schema';

export type WorkItemStatus = (typeof outboundBatchWorkItemStatusEnum.enumValues)[number];
export type WorkItemExitTo = (typeof outboundWorkItemExitToEnum.enumValues)[number];

/**
 * 활성 작업 항목 — 박스당 하나(`uq_outbound_work_item_active_shipment`: completed·excluded 가 아닌 전부).
 * 파일마다 목록을 따로 두면 새 상태(withdrawing)를 하나 빠뜨리는 순간 그 경로만 «작업 없음» 으로 조용히 읽는다.
 */
export const ACTIVE_WORK_ITEM_STATUSES = [
  'queued',
  'picking',
  'ready_to_pack',
  'packing',
  'short_pick_recovery',
  'withdrawing',
] as const satisfies readonly WorkItemStatus[];

/** 이탈을 시작할 수 있는 상태(스펙 §8). 결품 격리·이탈 중은 제외. */
export const WITHDRAWABLE_WORK_ITEM_STATUSES = [
  'queued',
  'picking',
  'ready_to_pack',
  'packing',
] as const satisfies readonly WorkItemStatus[];
```

- [ ] **Step 5: 마이그레이션을 만든다**

Run: `npm run db:generate:core -- --name return-bin-withdrawal`
Expected: `apps/core/drizzle/<timestamp>_return-bin-withdrawal.sql` 하나. 내용이 아래뿐인지 **눈으로** 확인한다(순서는 달라도 된다):
- `CREATE TYPE "public"."outbound_work_item_exit_to" AS ENUM('draft', 'canceled')`
- `ALTER TYPE "public"."outbound_batch_work_item_status" ADD VALUE 'withdrawing'`
- `CREATE TABLE "return_bins" (...)` + FK `warehouse_id` + `uq_return_bins_barcode` + `ck_return_bins_barcode_prefix` + `idx_return_bins_warehouse`
- `ALTER TABLE "outbound_batch_work_items" ADD COLUMN "exit_to" "outbound_work_item_exit_to"` + `ADD CONSTRAINT "ck_outbound_work_items_withdrawing_exit" CHECK ("status"::text <> 'withdrawing' OR "exit_to" IS NOT NULL)`
- `ck_batch_inventory_session_balances_custody`·`ck_batch_inventory_session_events_from_grain`·`ck_batch_inventory_session_events_to_grain` 의 DROP/ADD
- `CREATE INDEX "idx_batch_inventory_session_balances_return_bin" ... WHERE ...`

CHECK 안에 `'withdrawing'` 이 텍스트 비교(`::text`)가 아닌 채로 나오면 스키마의 `sql` 을 고치고 다시 생성한다. 다른 테이블이 섞이면 `git rm` 하고 원인(다른 브랜치 스키마)을 먼저 푼다. drizzle-kit 이 대화형 질문(이름 바뀜 추정)을 내면 «create» 를 고른다. 서브에이전트가 대화형 프롬프트를 못 넘기면 멈추고 컨트롤러에게 넘긴다(서브에이전트는 `db:generate` 를 못 돌린 적이 있다).

- [ ] **Step 6: 적용하고 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/services/work-item-status.spec.ts` → PASS 2
Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- withdrawal-schema.constraints` → PASS 4

- [ ] **Step 7: 커밋** — schema·SQL·meta 를 **한 커밋**에(CLAUDE.md).

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle \
  apps/core/src/modules/fulfillment/services/work-item-status.ts \
  apps/core/src/modules/fulfillment/services/work-item-status.spec.ts \
  apps/core/src/modules/fulfillment/services/withdrawal-schema.constraints.integration.spec.ts
git commit -m "feat(fulfillment): 이탈 중 작업 항목·되돌림 바구니 스키마 — RETURN_PENDING 은 바구니 키 (#989)"
```

---

### Task 2: 세션 — 바구니로 빼기(`REMOVE_TO_RETURN_BIN`)와 되돌림 적치(`PUTAWAY_RETURN`)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/line-attributed-custody.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/reconcile-allocation.ts` (주석만)
- Test: `apps/core/src/modules/fulfillment/services/batch-inventory-session.return-bin.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `RETURN_PENDING` grain, `wmsTables.returnBins`.
- Produces (`batch-inventory-session.service.ts`):
  - `export interface ReturnBinRef { id: string; barcode: string }`
  - `export const BOX_CUSTODY_TYPES = ['WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED'] as const` — 박스 줄에 귀속된, 아직 나가지 않은 보관
  - `export interface RemoveToReturnBinInput { sessionId; operationId; actorId; workItemId; allocationId; shipmentLineId; skuId; sourceLocationId; quantity: number; from: { custodyType: BatchInventoryCustodyType; custodyRef: string | null; shipmentLineId: string | null }; returnBin: ReturnBinRef }`
  - `export interface PutawayReturnInput { sessionId; operationId; actorId; skuId; sourceLocationId; quantity: number; returnBin: ReturnBinRef }`
  - `removeToReturnBin(input: RemoveToReturnBinInput, tx: DbTx)`, `putawayReturn(input: PutawayReturnInput, tx: DbTx)` — 둘 다 `mutate` 결과(`{ session, event, replayed }`)를 돌려준다
  - `export function removeToBinIdempotencyKey(operationId: string, allocationId: string, from: RemoveToReturnBinInput['from']): string`
- Produces (`line-attributed-custody.ts`): `LINE_ATTRIBUTED_CUSTODY` = `WORKER`·`TOTE`·`SORTING`·`PACKING`·`PACKED`·`SETTLED`(`RETURN_PENDING` 제외).
- 배정 행 감소는 이 태스크가 하지 않는다 — 호출자(`BoxAllocationManager`, Task 8·9)의 몫이다(`handBack` 과 같은 분업).

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** — `batch-inventory-session.return-bin.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('세션 — 되돌림 바구니 이벤트 (PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function pickedBox(tx: DbTx) {
    const f = await seedPickableShipment(tx, 2);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: f.batchId, actorId: f.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: f.actorId,
        quantity: 2,
        from: { skuId: f.skuId, sourceLocationId: f.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          custodyType: 'WORKER',
          custodyRef: f.actorId,
          shipmentLineId: f.shipmentLineId,
        },
      },
      tx,
    );
    const [allocation] = await tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, f.workItemId));
    const [bin] = await tx
      .insert(wmsTables.returnBins)
      .values({ warehouseId: f.warehouseId, barcode: `RB-${randomUUID().slice(0, 8)}`, registeredBy: f.actorId })
      .returning();
    return { f, wiring, sessionId: run.sessionId, allocation, bin: { id: bin.id, barcode: bin.barcode } };
  }

  const balancesOf = (tx: DbTx, sessionId: string) =>
    tx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId));

  it('박스 보관 1 을 바구니로 — 로케이션은 그대로, 줄은 떨어지고, 세션은 active', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, allocation, bin } = await pickedBox(tx);
      const operationId = randomUUID();
      await wiring.sessions.removeToReturnBin(
        {
          sessionId,
          operationId,
          actorId: f.actorId,
          workItemId: f.workItemId,
          allocationId: allocation.id,
          shipmentLineId: f.shipmentLineId,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          quantity: 1,
          from: { custodyType: 'WORKER', custodyRef: f.actorId, shipmentLineId: f.shipmentLineId },
          returnBin: bin,
        },
        tx,
      );

      const balances = await balancesOf(tx, sessionId);
      expect(balances.find((b) => b.custodyType === 'WORKER')?.qty).toBe(1);
      expect(balances.find((b) => b.custodyType === 'RETURN_PENDING')).toMatchObject({
        qty: 1,
        custodyRef: bin.barcode,
        sourceLocationId: f.locationId,
        shipmentLineId: null,
      });
      const [event] = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'REMOVE_TO_RETURN_BIN'),
          ),
        );
      expect(event.payload).toMatchObject({
        operationId,
        workItemId: f.workItemId,
        allocationId: allocation.id,
        shipmentLineId: f.shipmentLineId,
        returnBinId: bin.id,
      });
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session.status).toBe('active');
      // 바구니의 물건도 세션 통제분이다 — 아직 선반에 없다.
      const availability = await new BatchControlledStockGuard().getAvailability(
        { skuId: f.skuId, warehouseId: f.warehouseId, sourceLocationId: f.locationId },
        tx,
      );
      expect(availability.batchControlledQty).toBe(2);
    });
  });

  it('같은 명령·배정·보관으로 다시 보내면 한 번이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, allocation, bin } = await pickedBox(tx);
      const input = {
        sessionId,
        operationId: randomUUID(),
        actorId: f.actorId,
        workItemId: f.workItemId,
        allocationId: allocation.id,
        shipmentLineId: f.shipmentLineId,
        skuId: f.skuId,
        sourceLocationId: f.locationId,
        quantity: 1,
        from: { custodyType: 'WORKER' as const, custodyRef: f.actorId, shipmentLineId: f.shipmentLineId },
        returnBin: bin,
      };
      await wiring.sessions.removeToReturnBin(input, tx);
      const replay = await wiring.sessions.removeToReturnBin(input, tx);
      expect(replay.replayed).toBe(true);
      const balances = await balancesOf(tx, sessionId);
      expect(balances.find((b) => b.custodyType === 'RETURN_PENDING')?.qty).toBe(1);
    });
  });

  it('되돌림 적치는 바구니 보관을 없애고 returned_qty 에 더한다 — 다 비면 settled', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, allocation, bin } = await pickedBox(tx);
      await wiring.sessions.removeToReturnBin(
        {
          sessionId,
          operationId: randomUUID(),
          actorId: f.actorId,
          workItemId: f.workItemId,
          allocationId: allocation.id,
          shipmentLineId: f.shipmentLineId,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          quantity: 2,
          from: { custodyType: 'WORKER', custodyRef: f.actorId, shipmentLineId: f.shipmentLineId },
          returnBin: bin,
        },
        tx,
      );
      await wiring.sessions.putawayReturn(
        {
          sessionId,
          operationId: randomUUID(),
          actorId: f.actorId,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          quantity: 2,
          returnBin: bin,
        },
        tx,
      );
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session).toMatchObject({ status: 'settled', returnedQty: 2, handedInQty: 2 });
    });
  });

  it('일반 보관 이동으로는 바구니에 넣거나 뺄 수 없다 — 배정 감소 없이 바구니가 생기면 안 된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, bin } = await pickedBox(tx);
      await expect(
        wiring.sessions.moveCustody(
          {
            sessionId,
            idempotencyKey: `m-${randomUUID()}`,
            actorId: f.actorId,
            quantity: 1,
            from: {
              skuId: f.skuId,
              sourceLocationId: f.locationId,
              custodyType: 'WORKER',
              custodyRef: f.actorId,
              shipmentLineId: f.shipmentLineId,
            },
            to: { skuId: f.skuId, sourceLocationId: f.locationId, custodyType: 'RETURN_PENDING', custodyRef: bin.barcode },
          },
          tx,
        ),
      ).rejects.toThrow(/removeToReturnBin/);
    });
  });

  it('AT_SOURCE 에서는 바구니로 뺄 수 없다 — 집지 않은 몫은 HAND_BACK 이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, allocation, bin } = await pickedBox(tx);
      await expect(
        wiring.sessions.removeToReturnBin(
          {
            sessionId,
            operationId: randomUUID(),
            actorId: f.actorId,
            workItemId: f.workItemId,
            allocationId: allocation.id,
            shipmentLineId: f.shipmentLineId,
            skuId: f.skuId,
            sourceLocationId: f.locationId,
            quantity: 1,
            from: { custodyType: 'AT_SOURCE', custodyRef: null, shipmentLineId: null },
            returnBin: bin,
          },
          tx,
        ),
      ).rejects.toThrow(/box custody or a bulk cart/);
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-inventory-session.return-bin`
Expected: FAIL — `wiring.sessions.removeToReturnBin is not a function`

- [ ] **Step 3: 세션 서비스를 고친다** — `batch-inventory-session.service.ts`:

타입과 상수(파일 위쪽, `HandBackInput` 근처):

```ts
type MutationEventType =
  | 'MOVE_CUSTODY'
  | 'RETURN_TO_SOURCE'
  | 'SETTLE_FOR_DISPATCH'
  | 'APPROVE_SHORTAGE'
  | 'HAND_BACK'
  | 'REMOVE_TO_RETURN_BIN'
  | 'PUTAWAY_RETURN';

/** 박스 줄에 귀속된, 아직 나가지 않은 보관 — 이탈한 박스에서 바구니로 뺄 수 있는 곳(세 방식 공통, 스펙 §8). */
export const BOX_CUSTODY_TYPES = ['WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED'] as const satisfies readonly BatchInventoryCustodyType[];

export interface ReturnBinRef {
  id: string;
  barcode: string;
}

/** 빼는 박스의 집은 몫(또는 토탈피킹 카트 여분)을 되돌림 바구니로. 배정 행 감소는 호출자(BoxAllocationManager)의 몫이다. */
export interface RemoveToReturnBinInput {
  sessionId: string;
  operationId: string;
  actorId: string;
  workItemId: string;
  allocationId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  from: { custodyType: BatchInventoryCustodyType; custodyRef: string | null; shipmentLineId: string | null };
  returnBin: ReturnBinRef;
}

/** 바구니 → 원래 로케이션. 세션 통제가 풀려 일반 재고가 된다(원장은 그대로 — 원장상 그 물건은 그 로케이션을 떠난 적이 없다). */
export interface PutawayReturnInput {
  sessionId: string;
  operationId: string;
  actorId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  returnBin: ReturnBinRef;
}

/**
 * 한 명령이 같은 배정을 두 보관(예: WORKER 1 + PACKING 1)에서 뺄 수 있어 보관 grain 을 키에 넣는다.
 * ref 는 길 수 있으므로(bulk-cart:<배치>:<카트>:<작업자>) 해시 16자로 줄인다 — 멱등 키 컬럼은 255자다.
 */
export function removeToBinIdempotencyKey(
  operationId: string,
  allocationId: string,
  from: RemoveToReturnBinInput['from'],
): string {
  const grain = createHash('sha256')
    .update([from.custodyType, from.custodyRef ?? '', from.shipmentLineId ?? ''].join('|'))
    .digest('hex')
    .slice(0, 16);
  return `remove-to-bin:${operationId}:${allocationId}:${grain}`;
}
```

`moveCustody` 첫머리(정규화 직후)에 바구니 차단:

```ts
    if (from.custodyType === 'RETURN_PENDING' || to.custodyType === 'RETURN_PENDING') {
      throw new BadRequestException('Use removeToReturnBin / putawayReturn for RETURN_PENDING custody');
    }
```

`handBack` 아래에 두 메서드:

```ts
  /** 집은 몫(박스 보관) 또는 카트 여분(BULK_CART) → 되돌림 바구니. 멱등 키 `removeToBinIdempotencyKey`. */
  async removeToReturnBin(input: RemoveToReturnBinInput, tx: DbTx) {
    if (!tx) throw new Error('removeToReturnBin requires the caller transaction');
    const fromType = input.from.custodyType;
    if (!(BOX_CUSTODY_TYPES as readonly string[]).includes(fromType) && fromType !== 'BULK_CART') {
      throw new BadRequestException('Only box custody or a bulk cart can be removed to a return bin');
    }
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: removeToBinIdempotencyKey(input.operationId, input.allocationId, input.from),
        eventType: 'REMOVE_TO_RETURN_BIN',
        actorId: input.actorId,
        skuId: input.skuId,
        quantity: input.quantity,
        from: normalizedBucket({ skuId: input.skuId, sourceLocationId: input.sourceLocationId, ...input.from }),
        to: {
          custodyType: 'RETURN_PENDING',
          custodyRef: input.returnBin.barcode,
          sourceLocationId: input.sourceLocationId,
          shipmentLineId: null,
        },
        context: {
          operationId: input.operationId,
          workItemId: input.workItemId,
          allocationId: input.allocationId,
          shipmentLineId: input.shipmentLineId,
          returnBinId: input.returnBin.id,
        },
      },
      tx,
    );
  }

  /** 되돌림 적치. 멱등 키 `putaway-return:<명령 id>:<세션 id>` — 한 명령은 세션마다 한 보관 grain(바구니·SKU·로케이션)만 줄인다. */
  async putawayReturn(input: PutawayReturnInput, tx: DbTx) {
    if (!tx) throw new Error('putawayReturn requires the caller transaction');
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: `putaway-return:${input.operationId}:${input.sessionId}`,
        eventType: 'PUTAWAY_RETURN',
        actorId: input.actorId,
        skuId: input.skuId,
        quantity: input.quantity,
        from: {
          custodyType: 'RETURN_PENDING',
          custodyRef: input.returnBin.barcode,
          sourceLocationId: input.sourceLocationId,
          shipmentLineId: null,
        },
        to: null,
        context: { operationId: input.operationId, returnBinId: input.returnBin.id },
      },
      tx,
    );
  }
```

`mutate` 의 세션 헤더 갱신에서 `returnedQty` 를 두 이벤트로 넓힌다(스펙 §11 은 PR 3 에서 이 합이다 — 정한 것 9):

```ts
          returnedQty:
            input.eventType === 'RETURN_TO_SOURCE' || input.eventType === 'PUTAWAY_RETURN'
              ? session.returnedQty + input.quantity
              : session.returnedQty,
```

`assertBucket` 의 마지막 두 조건(`RETURN_PENDING`·`SETTLED` 공용)을 갈라 쓴다:

```ts
    if (bucket.custodyType === 'RETURN_PENDING' && (!bucket.custodyRef || bucket.shipmentLineId)) {
      throw new BadRequestException('RETURN_PENDING custody requires a return bin ref and no shipment line');
    }
    if (bucket.custodyType === 'SETTLED' && (!bucket.shipmentLineId || bucket.custodyRef)) {
      throw new BadRequestException('SETTLED custody requires a shipment line and no custody ref');
    }
```

(`assigned` 배열도 `BOX_CUSTODY_TYPES` 로 바꿔 한 정의를 쓴다.)

- [ ] **Step 4: 줄 귀속 집합과 주석을 고친다**

`line-attributed-custody.ts`:

```ts
import type { BatchInventoryCustodyType } from './batch-inventory-session.service';

/**
 * 줄에 귀속된 보관 — 어느 박스 줄의 몫인지 아는 보관(집은 몫). `AT_SOURCE`·`BULK_CART` 는 줄을 모른다.
 * 배정 변경(`BoxAllocationManager`), 불변식 I3(`FulfillmentInvariantService`), 세션 복구가 같은 정의를 쓴다.
 *
 * `RETURN_PENDING` 은 넣지 않는다(PR 3, 스펙 §13): 되돌림 바구니 키(줄 없음)이고, 바구니로 옮기는 이벤트가 그 순간
 * 배정을 같은 수만큼 줄였으므로 어느 배정과도 견주지 않는다. `SETTLED` 는 발송된 줄의 몫이라 남는다.
 */
const LINE_ATTRIBUTED: readonly BatchInventoryCustodyType[] = [
  'WORKER',
  'TOTE',
  'SORTING',
  'PACKING',
  'PACKED',
  'SETTLED',
];

export const LINE_ATTRIBUTED_CUSTODY: ReadonlySet<string> = new Set<string>(LINE_ATTRIBUTED);
```

`reconcile-allocation.ts` 의 두 주석:
- `ReconcileAllocationRow.attributedQty`: `/** 이 줄·로케이션에 귀속된 보관(WORKER·TOTE·SORTING·PACKING·PACKED·SETTLED) 합. 0 ≤ 이것 ≤ qty(I3). */`
- `ReconcilePlan.cartSurplus`: `/** 미귀속인데 AT_SOURCE 에 없다 = 토탈피킹 카트에 이미 실렸다. 배정은 그대로 두고, 분류대에서 여분을 바구니에 넣을 때 준다(PR 3 계획이 정함 — S1 §5.4 의 «즉시 뺀다» 대체). */`

- [ ] **Step 5: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-inventory-session`
Expected: 새 스펙 PASS 5, 기존 `batch-inventory-session.integration` 그대로 PASS.
Run: `npx jest apps/core/src/modules/fulfillment/services/batch-inventory-session.service.spec.ts apps/core/src/modules/fulfillment/picking/allocation/reconcile-allocation.spec.ts`
Expected: PASS (reconcile 전수 열거는 `attributedQty` 를 입력으로 받을 뿐 보관 종류를 모른다 — 바뀌지 않는다)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts \
  apps/core/src/modules/fulfillment/services/line-attributed-custody.ts \
  apps/core/src/modules/fulfillment/picking/allocation/reconcile-allocation.ts \
  apps/core/src/modules/fulfillment/services/batch-inventory-session.return-bin.integration.spec.ts
git commit -m "feat(fulfillment): 세션이 되돌림 바구니로 빼기와 되돌림 적치를 받는다 — RETURN_PENDING 은 줄 귀속에서 빠진다 (#989)"
```

---

### Task 3: 세션 복구 — 새 이벤트 재생과 «인계 − 반납 − 바구니 = 배정»

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/batch-session-recovery.service.ts` (`replay`, `validatePersistedAllocations`, `validBucket`)
- Test: `apps/core/src/modules/fulfillment/services/batch-session-recovery.return-bin.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 이벤트 모양 — `REMOVE_TO_RETURN_BIN`(from 박스 보관 또는 `BULK_CART`, to `RETURN_PENDING`, payload `operationId`·`workItemId`·`allocationId`·`shipmentLineId`·`returnBinId`), `PUTAWAY_RETURN`(from `RETURN_PENDING`, to 없음, payload `operationId`·`returnBinId`).
- Produces: 복구 규칙 — 배정마다 `Σ HAND_IN − Σ HAND_BACK − Σ REMOVE_TO_RETURN_BIN = qty`. `returnedQty` 재생에 `PUTAWAY_RETURN` 포함.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `batch-session-recovery.return-bin.integration.spec.ts`. 배정 감소는 아직 `BoxAllocationManager`(Task 8)가 없으므로 이 스펙이 호출자 몫을 직접 한다(같은 트랜잭션에서 배정 −q):

```ts
import { randomUUID } from 'crypto';
import { eq, sql as dsql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('세션 복구 — 되돌림 바구니 (PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function removedOne(tx: DbTx) {
    const f = await seedPickableShipment(tx, 2);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: f.batchId, actorId: f.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: f.actorId,
        quantity: 2,
        from: { skuId: f.skuId, sourceLocationId: f.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          custodyType: 'PACKING',
          custodyRef: `work-item:${f.workItemId}`,
          shipmentLineId: f.shipmentLineId,
        },
      },
      tx,
    );
    const [allocation] = await tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, f.workItemId));
    const [bin] = await tx
      .insert(wmsTables.returnBins)
      .values({ warehouseId: f.warehouseId, barcode: `RB-${randomUUID().slice(0, 8)}`, registeredBy: f.actorId })
      .returning();
    await wiring.sessions.removeToReturnBin(
      {
        sessionId: run.sessionId,
        operationId: randomUUID(),
        actorId: f.actorId,
        workItemId: f.workItemId,
        allocationId: allocation.id,
        shipmentLineId: f.shipmentLineId,
        skuId: f.skuId,
        sourceLocationId: f.locationId,
        quantity: 1,
        from: { custodyType: 'PACKING', custodyRef: `work-item:${f.workItemId}`, shipmentLineId: f.shipmentLineId },
        returnBin: { id: bin.id, barcode: bin.barcode },
      },
      tx,
    );
    await tx
      .update(wmsTables.pickingSourceAllocations)
      .set({ qty: dsql`${wmsTables.pickingSourceAllocations.qty} - 1` })
      .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
    return { f, wiring, sessionId: run.sessionId, allocation, bin: { id: bin.id, barcode: bin.barcode } };
  }

  it('바구니로 빼고 배정을 줄인 세션은 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId } = await removedOne(tx);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('되돌림 적치까지 해도 healthy — 적치는 returned_qty 로 재생된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, bin } = await removedOne(tx);
      await wiring.sessions.putawayReturn(
        {
          sessionId,
          operationId: randomUUID(),
          actorId: f.actorId,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          quantity: 1,
          returnBin: bin,
        },
        tx,
      );
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('이벤트 없이 배정만 줄면 그 배정이 어긋났다고 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId, allocation } = await removedOne(tx);
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 0 })
        .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
      const result = await wiring.recovery.reconcile(sessionId, tx);
      expect(result.healthy).toBe(false);
      expect(result.issues.join('\n')).toMatch(/hand-in 2 − hand-back 0 − removed 1/);
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-session-recovery.return-bin`
Expected: FAIL — 첫 테스트가 `unsupported type REMOVE_TO_RETURN_BIN`·`invalid custody grain` 으로 unhealthy

- [ ] **Step 3: 복구를 고친다** — `batch-session-recovery.service.ts`

`replay` 의 이벤트 갈래에 둘을 더한다(`MOVE_CUSTODY` 다음):

```ts
      } else if (event.eventType === 'REMOVE_TO_RETURN_BIN') {
        const boxOrCart =
          from !== null &&
          (['WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED', 'BULK_CART'] as string[]).includes(from.custodyType);
        if (!boxOrCart || !to || to.custodyType !== 'RETURN_PENDING') {
          issues.push(`REMOVE_TO_RETURN_BIN event ${event.id} has invalid sides`);
        }
        if (typeof payload.workItemId !== 'string' || typeof payload.allocationId !== 'string') {
          issues.push(`REMOVE_TO_RETURN_BIN event ${event.id} has no immutable work item/allocation identity`);
        }
      } else if (event.eventType === 'PUTAWAY_RETURN') {
        if (!from || to || from.custodyType !== 'RETURN_PENDING') {
          issues.push(`PUTAWAY_RETURN event ${event.id} has invalid sides`);
        }
        returnedQty += event.quantity;
```

`validatePersistedAllocations` 의 비-`HAND_IN` 갈래, `HAND_BACK` 검사 다음에 둘을 더한다:

```ts
        } else if (event.eventType === 'REMOVE_TO_RETURN_BIN') {
          const exactContext = {
            operationId: payload.operationId,
            workItemId: payload.workItemId,
            allocationId: payload.allocationId,
            shipmentLineId: payload.shipmentLineId,
            returnBinId: payload.returnBinId,
          };
          if (canonicalBatchSessionRequestHash(persistedContext) !== canonicalBatchSessionRequestHash(exactContext)) {
            issues.push(`REMOVE_TO_RETURN_BIN event ${event.id} context is not exact`);
          }
          canonicalRequest.context = exactContext;
          const allocation =
            typeof payload.allocationId === 'string' ? allocationById.get(payload.allocationId) : undefined;
          if (
            typeof payload.operationId !== 'string' ||
            typeof payload.returnBinId !== 'string' ||
            !allocation ||
            allocation.workItemId !== payload.workItemId ||
            allocation.shipmentLineId !== payload.shipmentLineId ||
            allocation.skuId !== event.skuId ||
            !from ||
            from.sourceLocationId !== allocation.sourceLocationId ||
            (from.shipmentLineId !== null && from.shipmentLineId !== allocation.shipmentLineId)
          ) {
            issues.push(`REMOVE_TO_RETURN_BIN event ${event.id} has invalid allocation attribution`);
          }
        } else if (event.eventType === 'PUTAWAY_RETURN') {
          const exactContext = { operationId: payload.operationId, returnBinId: payload.returnBinId };
          if (canonicalBatchSessionRequestHash(persistedContext) !== canonicalBatchSessionRequestHash(exactContext)) {
            issues.push(`PUTAWAY_RETURN event ${event.id} context is not exact`);
          }
          canonicalRequest.context = exactContext;
```

배정별 합 규칙(`movedByAllocation`)을 넓힌다:

```ts
    const movedByAllocation = (eventType: 'HAND_IN' | 'HAND_BACK' | 'REMOVE_TO_RETURN_BIN', allocationId: string) =>
      events
        .filter((event) => event.eventType === eventType && payloadOf(event.payload).allocationId === allocationId)
        .reduce((total, event) => total + event.quantity, 0);
    for (const allocation of allocations) {
      const handedIn = movedByAllocation('HAND_IN', allocation.id);
      const handedBack = movedByAllocation('HAND_BACK', allocation.id);
      const removed = movedByAllocation('REMOVE_TO_RETURN_BIN', allocation.id);
      if (handedIn === 0) issues.push(`allocation ${allocation.id} has no HAND_IN event`);
      if (handedIn - handedBack - removed !== allocation.quantity) {
        issues.push(
          `allocation ${allocation.id} quantity ${allocation.quantity} differs from ` +
            `hand-in ${handedIn} − hand-back ${handedBack} − removed ${removed}`,
        );
      }
    }
```

줄·로케이션 보관 대조(«custody exceeds persisted allocation») 는 그대로 둔다 — `REMOVE_TO_RETURN_BIN` 은 줄 보관과 배정을 같은 수만큼 줄이고, 그 루프의 합산 대상(`RETURN_TO_SOURCE`·`SETTLE_FOR_DISPATCH`·`APPROVE_SHORTAGE`)에 들지 않는다. `PUTAWAY_RETURN` 은 줄이 없어(`fromShipmentLineId` null, payload 에도 없음) 걸리지 않는다. 이 이유를 그 루프 위 주석에 한 줄 더한다.

`validBucket`:

```ts
    if (bucket.custodyType === 'RETURN_PENDING') return bucket.custodyRef !== null && bucket.shipmentLineId === null;
    if (bucket.custodyType === 'SETTLED') return bucket.custodyRef === null && bucket.shipmentLineId !== null;
```

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-session-recovery`
Expected: 새 스펙 PASS 3, 기존 `batch-session-recovery.hand-back.integration` 그대로 PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/batch-session-recovery.service.ts \
  apps/core/src/modules/fulfillment/services/batch-session-recovery.return-bin.integration.spec.ts
git commit -m "feat(fulfillment): 세션 복구가 되돌림 이벤트를 재생하고 배정마다 인계 − 반납 − 바구니 = 배정을 본다 (#989)"
```

---

### Task 4: 불변식 — I2 는 `withdrawing` 을 보지 않고, I3 공유 식은 제외된 작업 항목의 배정을 세지 않는다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts` (`FulfillmentInvariantSnapshot.allocations`, `collectFulfillmentInvariantViolations`, 배정 적재 쿼리)
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts`

**Interfaces:**
- Produces: 스냅샷 배정 행에 `workItemStatus: string`. I2 는 `completed`·`excluded`·`withdrawing` 을 건너뛴다. I3 공유 식의 «방» = `excluded` 가 아닌 작업 항목의 배정 − 줄 귀속 보관.

- [ ] **Step 1: 실패하는 단위 테스트를 쓴다** — `fulfillment-invariant.service.spec.ts`:

`validSnapshot()` 의 배정 행에 `workItemStatus: 'completed'` 를 더하고(작업 항목 `wi-1` 의 상태와 같게), `describe('배정 불변식 I1~I3 (스펙 §5)')` 안에 셋을 더한다:

```ts
  it('I2 — 이탈 중(withdrawing)은 목표가 0 이라 보지 않는다', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'withdrawing';
    snapshot.allocations[0].workItemStatus = 'withdrawing';
    snapshot.allocations[0].qty = 3;
    expect(kinds(snapshot)).not.toContain('ALLOCATION_BELOW_TARGET');
  });

  it('I3 — 제외된 작업 항목의 배정은 공유 보관의 방이 아니다(PR 3·4 경계: 결품 제외 뒤 떠도는 AT_SOURCE)', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'excluded';
    snapshot.allocations[0].workItemStatus = 'excluded';
    snapshot.allocations[0].qty = 2; // 결품 보고는 배정 행을 줄이지 않는다
    snapshot.sessionBalances = [
      {
        id: 'balance-2',
        sessionId: 'session-1',
        custodyType: 'AT_SOURCE',
        qty: 2,
        skuId: 'sku-1',
        sourceLocationId: 'loc-1',
        shipmentLineId: null,
      },
    ];
    snapshot.sessions[0] = { ...snapshot.sessions[0], handedInQty: 2, settledQty: 0, returnedQty: 0, shortageQty: 0 };
    expect(kinds(snapshot)).toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });

  it('I3 — 활성 작업 항목의 배정이 덮으면 같은 AT_SOURCE 는 위반이 아니다', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'queued';
    snapshot.allocations[0].workItemStatus = 'queued';
    snapshot.allocations[0].qty = 7;
    snapshot.sessionBalances = [
      {
        id: 'balance-2',
        sessionId: 'session-1',
        custodyType: 'AT_SOURCE',
        qty: 7,
        skuId: 'sku-1',
        sourceLocationId: 'loc-1',
        shipmentLineId: null,
      },
    ];
    snapshot.sessions[0] = { ...snapshot.sessions[0], handedInQty: 7, settledQty: 0, returnedQty: 0, shortageQty: 0 };
    expect(kinds(snapshot)).not.toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts`
Expected: FAIL — 타입 에러는 jest 가 무시하므로 «제외된 작업 항목» 테스트가 `CUSTODY_EXCEEDS_ALLOCATION` 을 못 받아 실패, `withdrawing` 테스트가 `ALLOCATION_BELOW_TARGET` 을 받아 실패

- [ ] **Step 3: 고친다** — `fulfillment-invariant.service.ts`

스냅샷 타입의 `allocations` 행에 `workItemStatus: string;` 를 더한다. 배정 적재 쿼리(`const allocations = batchIds.length ? await tx.select({...})`)의 선택 목록에 `workItemStatus: wmsTables.outboundBatchWorkItems.status,` 를 더한다(이미 작업 항목과 inner join 한다). 스냅샷의 `workItems` 는 구성요소의 박스만 싣고 배정은 배치 전체를 싣기 때문에, 상태는 배정 행이 들고 와야 한다.

I2 루프:

```ts
    // 완료·제외는 끝났고, 이탈 중은 목표가 0 이라 «배정 ≥ 목표» 가 늘 참이다(스펙 §5 I2).
    if (item.status === 'completed' || item.status === 'excluded' || item.status === 'withdrawing') continue;
```

I3 공유 식(`for (const [skuKey, sharedQty] of sharedBySku)`)의 배정 합을 제외 행 없이 계산한다:

```ts
    // PR 3·4 경계(스펙 §13): 결품 보고는 박스 배정 전부를 보관·공유 풀에서 끝까지 정산하지만 배정 행은 줄이지 않는다.
    // 그 행을 방으로 세면 빈 배치에 떠도는 AT_SOURCE 가 가려진다 — 제외된 작업 항목의 배정은 세지 않는다.
    const liveBatchAllocations = batchAllocations.filter((allocation) => allocation.workItemStatus !== 'excluded');
```

그리고 공유 식 루프 안의 `batchAllocations.filter(...)` 를 `liveBatchAllocations.filter(...)` 로 바꾼다. 줄 귀속 식(`attributedByLine` 루프)은 그대로 `batchAllocations` 를 쓴다(줄 보관은 그 줄의 배정 행 전체와 견준다 — PR 2 의 재합류 규칙).

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts` → PASS
Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- fulfillment-invariant batch-withdraw batch-join shipment-short-pick`
Expected: PASS. 결품 스펙이 빨가면(결품 제외 뒤 같은 배치의 다른 박스 명령에서 `CUSTODY_EXCEEDS_ALLOCATION`) 그 시나리오의 세션 보관을 적어 멈추고 컨트롤러에 알린다 — 정한 것 16(c) 의 «옳은 장부에서 0» 이 틀렸다는 뜻이다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts
git commit -m "feat(fulfillment): 불변식 — 이탈 중은 I2 밖, I3 공유 식은 제외된 작업 항목의 배정을 세지 않는다 (#989)"
```

---
### Task 5: 되돌림 바구니 — 등록·조회, 토트 바코드 `RB-` 예약

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/return-bin.service.ts`
- Create: `apps/core/src/modules/fulfillment/dto/return-bin.dto.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/return-bin.controller.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` (provider·controller — 컨트롤러는 `ShipmentController` 보다 **먼저**, Task 8 이 `shipments/…` 경로를 더한다)
- Modify: `apps/core/src/modules/fulfillment/picking/pick-to-tote.strategy.ts` (`requiredToteBarcode`)
- Modify: `apps/core/src/modules/fulfillment/services/__support__/simple-outbound-fixtures.ts` (`seedReturnBin`)
- Test: `apps/core/src/modules/fulfillment/services/return-bin.integration.spec.ts`, `apps/core/src/modules/fulfillment/controllers/return-bin.controller.spec.ts`, 토트 등록 스펙(아래)

**Interfaces:**
- Produces (`return-bin.service.ts`):
  - `class ReturnBinService` — 생성자 `(dbService: DbService<typeof wmsSchema>, commands: FulfillmentCommandService, workflowGate: FulfillmentWorkflowGate, sessions: BatchInventorySessionService, barcodes: BarcodeService, audit: AuditService)`
  - `register(input: { warehouseId: string; barcode: string }, actor: { id: string }, tx?: DbTx): Promise<ReturnBinDto>`
  - `lookup(barcode: string, warehouseId: string, tx?: DbTx): Promise<ReturnBinContentsDto>` — 없거나 폐기: `NotFoundException({ code: 'RETURN_BIN_UNKNOWN' })`, 다른 창고: `ConflictException({ code: 'RETURN_BIN_WAREHOUSE_MISMATCH' })`
  - `requireActive(barcode: string, warehouseId: string, trx: DbTx): Promise<ReturnBinRef>` — 명령용. 없거나 폐기: `ConflictException({ code: 'RETURN_BIN_UNKNOWN' })`, 다른 창고: `RETURN_BIN_WAREHOUSE_MISMATCH`
  - `contentsOf(bin: ReturnBinRef, trx: DbTx): Promise<ReturnBinItemDto[]>`
  - `export function normalizeReturnBinBarcode(value: string): string` — `RB-` 접두어가 아니면 `BadRequestException`
- Produces (`dto/return-bin.dto.ts`): `RegisterReturnBinDto { warehouseId; barcode }`, `ReturnBinDto { id; barcode; warehouseId }`, `ReturnBinItemDto { skuId; skuCode; skuName; sourceLocationId; locationCode; qty }`, `ReturnBinContentsDto extends ReturnBinDto { items: ReturnBinItemDto[] }`
- Produces (HTTP): `POST return-bins`, `GET return-bins/:barcode?warehouseId=` — 둘 다 `@RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)`
- Produces (fixtures): `seedReturnBin(tx, warehouseId, actorId): Promise<ReturnBinRef>`

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** — `return-bin.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('되돌림 바구니 등록·조회 (PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('등록은 멱등이다 — 같은 창고의 같은 바코드면 같은 바구니', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const { returnBins } = assembleOutbound(tx);
      const barcode = `RB-${randomUUID().slice(0, 8)}`;
      const first = await returnBins.register({ warehouseId: f.warehouseId, barcode: ` ${barcode} ` }, { id: f.actorId }, tx);
      const second = await returnBins.register({ warehouseId: f.warehouseId, barcode }, { id: f.actorId }, tx);
      expect(second).toEqual(first);
      expect(first).toMatchObject({ barcode, warehouseId: f.warehouseId });
    });
  });

  it('RB- 가 아니면 400, 다른 창고면 RETURN_BIN_WAREHOUSE_MISMATCH, 폐기됐으면 RETURN_BIN_UNKNOWN', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const other = await seedPickableShipment(tx, 1);
      const { returnBins } = assembleOutbound(tx);
      await expect(
        returnBins.register({ warehouseId: f.warehouseId, barcode: 'TOTE-1' }, { id: f.actorId }, tx),
      ).rejects.toMatchObject({ status: 400 });
      const barcode = `RB-${randomUUID().slice(0, 8)}`;
      await returnBins.register({ warehouseId: f.warehouseId, barcode }, { id: f.actorId }, tx);
      await expect(
        tx.transaction((trx) => returnBins.register({ warehouseId: other.warehouseId, barcode }, { id: f.actorId }, trx)),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_WAREHOUSE_MISMATCH' } });
      await tx.update(wmsTables.returnBins).set({ retiredAt: new Date() }).where(eq(wmsTables.returnBins.barcode, barcode));
      await expect(
        tx.transaction((trx) => returnBins.register({ warehouseId: f.warehouseId, barcode }, { id: f.actorId }, trx)),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_UNKNOWN' } });
    });
  });

  it('조회는 바구니와 남은 물건(여러 세션 합)을 준다. 없으면 404 RETURN_BIN_UNKNOWN', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const { returnBins } = assembleOutbound(tx);
      const bin = await returnBins.register(
        { warehouseId: f.warehouseId, barcode: `RB-${randomUUID().slice(0, 8)}` },
        { id: f.actorId },
        tx,
      );
      for (const qty of [1, 2]) {
        const [session] = await tx
          .insert(wmsTables.batchInventorySessions)
          .values({ batchId: f.batchId, handedInQty: qty, status: qty === 1 ? 'active' : 'settled' })
          .returning();
        await tx.insert(wmsTables.batchInventorySessionBalances).values({
          sessionId: session.id,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          custodyType: 'RETURN_PENDING',
          custodyRef: bin.barcode,
          qty,
        });
      }
      const found = await returnBins.lookup(bin.barcode, f.warehouseId, tx);
      // settled 세션의 행은 세지 않는다(그 세션은 이미 닫혔다 — 실제로는 보관이 0 이다).
      expect(found.items).toEqual([
        expect.objectContaining({ skuId: f.skuId, sourceLocationId: f.locationId, qty: 1, skuCode: f.skuCode }),
      ]);
      await expect(returnBins.lookup('RB-none', f.warehouseId, tx)).rejects.toMatchObject({
        status: 404,
        response: { code: 'RETURN_BIN_UNKNOWN' },
      });
    });
  });
});
```

토트 스펙: 토트 등록을 다루는 기존 스펙을 찾아(`grep -rln "registerTote" apps/core/src --include=*.spec.ts`) 거기에 한 케이스를 더한다 — 단위 스펙이 있으면 단위로:

```ts
  it('RB- 로 시작하는 바코드는 되돌림 바구니용이라 토트로 등록하지 않는다', async () => {
    await expect(
      strategy.registerTote({ warehouseId, toteBarcode: 'RB-0001', actor, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ response: { code: 'TOTE_BARCODE_RESERVED' } });
  });
```

(변수 이름 `strategy`·`warehouseId`·`actor` 는 그 스펙의 것을 쓴다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- return-bin.integration`
Expected: FAIL — `assembleOutbound(...).returnBins` 가 없다

- [ ] **Step 3: DTO 를 만든다** — `dto/return-bin.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class RegisterReturnBinDto {
  @IsUUID()
  warehouseId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  barcode: string;
}

export class ReturnBinDto {
  @ApiProperty() id: string;
  @ApiProperty() barcode: string;
  @ApiProperty() warehouseId: string;
}

export class ReturnBinItemDto {
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty() sourceLocationId: string;
  @ApiProperty({ description: '원래 로케이션 — 되돌림 적치는 여기만 받는다' }) locationCode: string;
  @ApiProperty() qty: number;
}

export class ReturnBinContentsDto extends ReturnBinDto {
  @ApiProperty({ type: [ReturnBinItemDto] }) items: ReturnBinItemDto[];
}
```

(Task 10 이 적치 DTO 를, Task 8 이 박스에서 빼기 DTO 를 이 파일에 더한다.)

- [ ] **Step 4: 서비스를 만든다** — `services/return-bin.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { ReturnBinContentsDto, ReturnBinDto, ReturnBinItemDto } from '../dto/return-bin.dto';
import { BatchInventorySessionService, ReturnBinRef } from './batch-inventory-session.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';

const RETURN_BIN_BARCODE = /^RB-[A-Za-z0-9._-]{1,125}$/;
const B = wmsTables.batchInventorySessionBalances;

/** 되돌림 바구니 바코드 — `RB-` 접두어로 토트·상품·로케이션과 갈린다(S1 §6.3, `ck_return_bins_barcode_prefix`). */
export function normalizeReturnBinBarcode(value: string): string {
  const barcode = value.trim();
  if (!RETURN_BIN_BARCODE.test(barcode)) {
    throw new BadRequestException('Return bin barcode must start with RB- and use letters, digits, dots, underscores or hyphens');
  }
  return barcode;
}

function binConflict(code: 'RETURN_BIN_UNKNOWN' | 'RETURN_BIN_WAREHOUSE_MISMATCH', message: string) {
  return new ConflictException({ code, message });
}

/**
 * 되돌림 바구니 — 등록·조회·되돌림 적치(스펙 §8). 바구니는 배치에 매이지 않는 상주 용기라 한 바구니에
 * 여러 배치(세션)의 물건이 섞인다. 그래서 조회·적치는 세션을 가로질러 `custody_ref = 바코드` 로 찾는다.
 */
@Injectable()
export class ReturnBinService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly sessions: BatchInventorySessionService,
    private readonly barcodes: BarcodeService,
    private readonly audit: AuditService,
  ) {}

  /** 같은 창고의 활성 바구니가 이미 있으면 그대로 돌려준다 — 여러 PC 가 같은 바구니를 «내 바구니» 로 지정할 수 있다. */
  async register(input: { warehouseId: string; barcode: string }, actor: { id: string }, tx?: DbTx): Promise<ReturnBinDto> {
    this.workflowGate.assertV2MutationAllowed('return_bin.register');
    const barcode = normalizeReturnBinBarcode(input.barcode);
    return this.dbService.run(async (trx) => {
      await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`return-bin:${barcode}`}, 0))`);
      const [existing] = await trx
        .select()
        .from(wmsTables.returnBins)
        .where(eq(wmsTables.returnBins.barcode, barcode))
        .limit(1);
      if (existing) {
        if (existing.retiredAt) throw binConflict('RETURN_BIN_UNKNOWN', `Return bin ${barcode} is retired`);
        if (existing.warehouseId !== input.warehouseId) {
          throw binConflict('RETURN_BIN_WAREHOUSE_MISMATCH', `Return bin ${barcode} belongs to another warehouse`);
        }
        return { id: existing.id, barcode: existing.barcode, warehouseId: existing.warehouseId };
      }
      const [warehouse] = await trx
        .select({ id: wmsTables.warehouses.id })
        .from(wmsTables.warehouses)
        .where(eq(wmsTables.warehouses.id, input.warehouseId))
        .limit(1);
      if (!warehouse) throw new NotFoundException(`Warehouse ${input.warehouseId} not found`);
      const [bin] = await trx
        .insert(wmsTables.returnBins)
        .values({ warehouseId: input.warehouseId, barcode, registeredBy: actor.id })
        .returning();
      await this.audit.logUserActionRequired(
        'return_bin.register',
        'fulfillment',
        `Registered return bin ${barcode}`,
        { userId: actor.id },
        { returnBinId: bin.id, warehouseId: input.warehouseId, barcode },
        trx,
      );
      return { id: bin.id, barcode: bin.barcode, warehouseId: bin.warehouseId };
    }, tx);
  }

  async lookup(barcodeInput: string, warehouseId: string, tx?: DbTx): Promise<ReturnBinContentsDto> {
    const barcode = barcodeInput.trim();
    return this.dbService.run(async (trx) => {
      const [bin] = await trx
        .select()
        .from(wmsTables.returnBins)
        .where(eq(wmsTables.returnBins.barcode, barcode))
        .limit(1);
      if (!bin || bin.retiredAt) {
        throw new NotFoundException({
          code: 'RETURN_BIN_UNKNOWN',
          error: 'RETURN_BIN_UNKNOWN',
          message: `Return bin ${barcode} is not registered`,
        });
      }
      if (bin.warehouseId !== warehouseId) {
        throw binConflict('RETURN_BIN_WAREHOUSE_MISMATCH', `Return bin ${barcode} belongs to another warehouse`);
      }
      const ref = { id: bin.id, barcode: bin.barcode };
      return { ...ref, warehouseId: bin.warehouseId, items: await this.contentsOf(ref, trx) };
    }, tx);
  }

  /** 명령용 — 오타·엉뚱한 바코드를 거절한다(스펙 §12 `RETURN_BIN_UNKNOWN`). */
  async requireActive(barcodeInput: string, warehouseId: string, trx: DbTx): Promise<ReturnBinRef> {
    const barcode = barcodeInput.trim();
    const [bin] = await trx
      .select()
      .from(wmsTables.returnBins)
      .where(eq(wmsTables.returnBins.barcode, barcode))
      .limit(1);
    if (!bin || bin.retiredAt) throw binConflict('RETURN_BIN_UNKNOWN', `Return bin ${barcode} is not registered`);
    if (bin.warehouseId !== warehouseId) {
      throw binConflict('RETURN_BIN_WAREHOUSE_MISMATCH', `Return bin ${barcode} belongs to another warehouse`);
    }
    return { id: bin.id, barcode: bin.barcode };
  }

  /** 바구니에 남은 물건 — 열린 세션(active·recovery_required)의 `RETURN_PENDING` 합을 SKU·원래 로케이션별로. */
  async contentsOf(bin: ReturnBinRef, trx: DbTx): Promise<ReturnBinItemDto[]> {
    const rows = await trx
      .select({
        skuId: B.skuId,
        skuCode: wmsTables.skus.code,
        skuName: wmsTables.skus.name,
        // RETURN_PENDING grain 은 source_location_id NOT NULL 이다(ck_batch_inventory_session_balances_custody).
        sourceLocationId: sql<string>`${B.sourceLocationId}`,
        locationCode: wmsTables.locations.code,
        qty: sql<number>`sum(${B.qty})::int`,
      })
      .from(B)
      .innerJoin(wmsTables.batchInventorySessions, eq(wmsTables.batchInventorySessions.id, B.sessionId))
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, B.skuId))
      .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, B.sourceLocationId))
      .where(
        and(
          eq(B.custodyType, 'RETURN_PENDING'),
          eq(B.custodyRef, bin.barcode),
          gt(B.qty, 0),
          inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
        ),
      )
      .groupBy(B.skuId, wmsTables.skus.code, wmsTables.skus.name, B.sourceLocationId, wmsTables.locations.code)
      .orderBy(asc(wmsTables.locations.code), asc(wmsTables.skus.name));
    return rows.map((row) => ({ ...row, qty: Number(row.qty) }));
  }
}
```

(`commands`·`sessions`·`barcodes` 는 Task 10 의 적치가 쓴다 — 지금 생성자에 넣어 두면 배선을 두 번 고치지 않는다.)

- [ ] **Step 5: 컨트롤러를 만든다** — `controllers/return-bin.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { RegisterReturnBinDto, ReturnBinContentsDto, ReturnBinDto } from '../dto/return-bin.dto';
import { ReturnBinService } from '../services/return-bin.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

/**
 * 되돌림 바구니(스펙 §8). `shipments/…` 경로도 이 컨트롤러가 갖는다(Task 8) — `ShipmentController` 의 `:id` 에
 * 가려지지 않게 모듈의 controllers 배열에서 그보다 먼저 등록한다.
 */
@ApiTags('Return bins')
@Controller()
@UseGuards(ScopeGuard)
export class ReturnBinController {
  constructor(private readonly returnBins: ReturnBinService) {}

  @Post('return-bins')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: ReturnBinDto })
  register(@Body() dto: RegisterReturnBinDto, @User() user: AuthenticatedUser): Promise<ReturnBinDto> {
    return this.returnBins.register(dto, this.actor(user));
  }

  @Get('return-bins/:barcode')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: ReturnBinContentsDto })
  lookup(
    @Param('barcode') barcode: string,
    @Query('warehouseId', new ParseUUIDPipe()) warehouseId: string,
  ): Promise<ReturnBinContentsDto> {
    if (!barcode.trim()) throw new BadRequestException('barcode is required');
    return this.returnBins.lookup(barcode, warehouseId);
  }

  private actor(user: AuthenticatedUser): { id: string; roles: string[] } {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}
```

`controllers/return-bin.controller.spec.ts` — 위임과 인증만(`tote.controller.spec.ts` 의 모양):

```ts
import { UnauthorizedException } from '@nestjs/common';
import { ReturnBinController } from './return-bin.controller';

describe('ReturnBinController', () => {
  const returnBins = { register: jest.fn().mockResolvedValue({ id: 'b' }), lookup: jest.fn().mockResolvedValue({ id: 'b' }) };
  const controller = new ReturnBinController(returnBins as never);

  it('등록은 인증된 작업자 이름으로 위임한다', async () => {
    await controller.register({ warehouseId: 'w', barcode: 'RB-1' }, { userId: 'u-1', roles: [] });
    expect(returnBins.register).toHaveBeenCalledWith({ warehouseId: 'w', barcode: 'RB-1' }, { id: 'u-1', roles: [] });
  });

  it('작업자 없이는 등록하지 않는다', () => {
    expect(() => controller.register({ warehouseId: 'w', barcode: 'RB-1' }, undefined)).toThrow(UnauthorizedException);
  });

  it('조회는 바코드·창고로 위임한다', async () => {
    await controller.lookup('RB-1', 'w');
    expect(returnBins.lookup).toHaveBeenCalledWith('RB-1', 'w');
  });
});
```

- [ ] **Step 6: 토트 등록이 `RB-` 를 거절한다** — `pick-to-tote.strategy.ts` 의 `requiredToteBarcode` 끝(정규식 검사 다음):

```ts
    // RB- 는 되돌림 바구니 바코드다(return_bins CHECK). 같은 문자열이 토트로도 등록되면 스캔이 두 뜻이 된다(S1 §6.3).
    if (barcode.toUpperCase().startsWith('RB-')) {
      throw conflict('TOTE_BARCODE_RESERVED', `Tote barcode ${barcode} uses the return-bin prefix RB-`);
    }
```

- [ ] **Step 7: 배선한다**
  - `fulfillment.module.ts`: providers 에 `ReturnBinService`, controllers 에 `ReturnBinController` 를 `ShipmentController` **앞**에.
  - `services/__support__/simple-outbound-wiring.ts` 의 `assembleOutboundWithDb`: `const returnBins = new ReturnBinService(dbService, commands, workflowGate, sessions, barcodes, audit);` 를 `barcodes` 생성 뒤에 두고 반환 객체에 `returnBins` 를 더한다(`barcodes` 생성이 `simple` 바로 위에 있으면 그 줄을 `returnBins` 보다 위로 옮긴다).
  - `services/__support__/simple-outbound-fixtures.ts` 끝에:

```ts
/** 되돌림 바구니 한 개 — 픽스처의 창고에 `RB-` 바코드로 등록한다. */
export async function seedReturnBin(
  tx: DbTx,
  warehouseId: string,
  actorId: string,
): Promise<{ id: string; barcode: string }> {
  const [bin] = await tx
    .insert(wmsTables.returnBins)
    .values({ warehouseId, barcode: `RB-${randomUUID().slice(0, 8)}`, registeredBy: actorId })
    .returning();
  return { id: bin.id, barcode: bin.barcode };
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- return-bin.integration`
Expected: PASS 3
Run: `npx jest apps/core/src/modules/fulfillment/controllers/return-bin.controller.spec.ts <토트 스펙 경로>` → PASS
Run: `npx jest scripts/security` → PASS. 새 라우트 둘이 인가 감사(`route-authz-audit`)에 걸리면 가드가 요구하는 대로 목록을 갱신한다(소유권 판정 근거: 창고 작업 스코프, 사용자 소유 리소스 아님).

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/return-bin.service.ts \
  apps/core/src/modules/fulfillment/dto/return-bin.dto.ts \
  apps/core/src/modules/fulfillment/controllers/return-bin.controller.ts \
  apps/core/src/modules/fulfillment/controllers/return-bin.controller.spec.ts \
  apps/core/src/modules/fulfillment/fulfillment.module.ts \
  apps/core/src/modules/fulfillment/picking/pick-to-tote.strategy.ts \
  apps/core/src/modules/fulfillment/services/__support__ \
  apps/core/src/modules/fulfillment/services/return-bin.integration.spec.ts
git add -u apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 되돌림 바구니 등록·조회 — 토트는 RB- 바코드를 쓰지 않는다 (#989)"
```

---
### Task 6: 이탈 — 집지 않은 몫은 반납하고, 남으면 `withdrawing`, 비면 나간다

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/box-withdrawal.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/withdrawal-removals.query.ts`
- Create: `apps/core/src/modules/fulfillment/services/__support__/box-withdrawal-wiring.ts`
- Modify: `apps/core/src/modules/fulfillment/services/box-allocation.manager.ts` (`withdrawUnpicked` → `handBackUnpicked`, `decrementAllocation` 추출)
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.errors.ts` (`boxHasPickedItems` 삭제)
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts` (생성자, `excludeShipment`, `withdrawFromStartedBatch` 삭제, 대기 오퍼레이션 재개 공개, 합류 후보, 배치 목록, 상태 목록)
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` (상태 목록만 — `ACTIVE_WORK_ITEM_STATUSES` import)
- Modify: `apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts` (`withdrawingItems`, `exitTo`)
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`, `services/__support__/simple-outbound-wiring.ts`, `new OutboundBatchOrchestrator(` 를 부르는 스펙 전부
- Test: `apps/core/src/modules/fulfillment/services/batch-withdraw.integration.spec.ts`(갱신), `outbound-batch-orchestrator.integration.spec.ts`(`BOX_HAS_PICKED_ITEMS` 기대 갱신)

**Interfaces:**
- Consumes: `reconcileAllocation`(PR 2), `BoxAllocationManager.lockOpenSession`(PR 2), `ACTIVE_WORK_ITEM_STATUSES`·`WITHDRAWABLE_WORK_ITEM_STATUSES`·`WorkItemExitTo`(Task 1), `ToteLifecycleService.releaseEmptyAssignmentsForShipment`.
- Produces (`box-withdrawal.service.ts`):
  - `class BoxWithdrawalService` — 생성자 `(invariant: FulfillmentInvariantService, boxes: BoxAllocationManager, totes: ToteLifecycleService, waybills: WaybillService, audit: AuditService)`. **계획·오케스트레이터를 모른다** — 둘 다 이 서비스를 주입받으므로 거꾸로 부르면 모듈 순환이 된다. `canceled` 로 나간 박스의 취소 완료는 호출자 몫이다(Task 8·9).
  - `interface BeginWithdrawalInput { batchId; shipmentId; shipmentStatus; workItem: WorkItemRow; lines: Array<{ id; skuId }>; exitTo: WorkItemExitTo; reason: string; waitingOperationId: string | null; actorId; operationId }`
  - `type BeginWithdrawalResult = { kind: 'withdrawing' | 'exited'; workItem: WorkItemRow; handedBackQty: number }`
  - `blockerOf(input: { batchId; shipmentId; shipmentStatus; workItem }, trx): Promise<{ blocker: { code: string; message: string } } | { session: BatchInventorySessionRow }>`
  - `begin(input: BeginWithdrawalInput, trx: DbTx): Promise<BeginWithdrawalResult>`
  - `exitIfDrained(workItem: WorkItemRow, ctx: { actorId: string; operationId: string }, trx: DbTx): Promise<{ exited: boolean; workItem: WorkItemRow }>`
  - `lockComponentsOf(shipmentIds: string[], trx: DbTx): Promise<void>` — 박스들의 구성요소 잠금(불변식 검사기)
- Produces (`withdrawal-removals.query.ts`): `interface WithdrawalRemoval { shipmentLineId; skuId; skuCode; skuName; sourceLocationId; locationCode; boxQty: number; cartQty: number }`, `loadWithdrawalRemovals(trx: DbTx, workItemId: string): Promise<WithdrawalRemoval[]>`
- Produces (`box-allocation.manager.ts`): `handBackUnpicked(input: { session; workItemId; lines: Array<{ id; skuId }>; actorId; operationId }, trx): Promise<{ handedBackQty: number }>`, `private decrementAllocation(allocationId: string, qty: number, trx): Promise<void>`
- Produces (orchestrator): `resumeWaitingOperation(operationId: string, shipmentId: string, tx?: DbTx): Promise<void>`(옛 `resumeWaitingOperationIfReady`, 공개). 합류 후보 `issue = 'SHIPMENT_WITHDRAWING'`. 배치 목록 `withdrawingItems: number`.
- Produces (`__support__/box-withdrawal-wiring.ts`): `assembleBoxWithdrawal(dbService: DbService<typeof wmsSchema>): BoxWithdrawalService`

- [ ] **Step 1: 테스트를 먼저 바꾼다** — `batch-withdraw.integration.spec.ts`

`describeIfDb` 제목을 `'시작된 배치에서 이탈 (스펙 §8, PR 2·3)'` 로. 첫 테스트(«집지 않은 박스는 반납하고 excluded …»)의 `expect(result.workItem.status).toBe('excluded');` 옆에 `expect(result.workItem.exitTo).toBe('draft');` 를 더한다.

«집은 몫이 있으면 BOX_HAS_PICKED_ITEMS …» 를 아래로 **바꾼다**:

```ts
  it('집은 몫이 있으면 withdrawing — 집지 않은 몫만 반납하고, 사유·exit_to 를 적고, 뺄 목록이 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      // 둘째 박스(수량 1)를 집는다 — 반납할 몫이 없다.
      await wiring.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: second.actorId,
          quantity: 1,
          from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: second.skuId,
            sourceLocationId: second.locationId,
            custodyType: 'WORKER',
            custodyRef: second.actorId,
            shipmentLineId: second.shipmentLineId,
          },
        },
        tx,
      );

      const result = await exclude(wiring, first.batchId, second.shipmentId, tx);

      expect(result.workItem).toMatchObject({ status: 'withdrawing', exitTo: 'draft', exclusionReason: '급한 변경' });
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session.handedBackQty).toBe(0);
      expect(await loadWithdrawalRemovals(tx, second.workItemId)).toEqual([
        expect.objectContaining({ shipmentLineId: second.shipmentLineId, boxQty: 1, cartQty: 0 }),
      ]);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('일부만 집었으면 나머지는 그 자리에서 반납된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, sessionId } = await started(tx);
      // 첫 박스(수량 2) 중 1 을 집는다.
      await wiring.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: first.actorId,
          quantity: 1,
          from: { skuId: first.skuId, sourceLocationId: first.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: first.skuId,
            sourceLocationId: first.locationId,
            custodyType: 'WORKER',
            custodyRef: first.actorId,
            shipmentLineId: first.shipmentLineId,
          },
        },
        tx,
      );
      const availableBefore = (await general(tx, first)).generallyAvailableQty;

      const result = await exclude(wiring, first.batchId, first.shipmentId, tx);

      expect(result.workItem.status).toBe('withdrawing');
      const [allocation] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      expect(allocation.qty).toBe(1);
      expect((await general(tx, first)).generallyAvailableQty).toBe(availableBefore + 1);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('빼는 중인 박스를 다시 빼면 SHIPMENT_ALREADY_WITHDRAWING', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await wiring.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: second.actorId,
          quantity: 1,
          from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: second.skuId,
            sourceLocationId: second.locationId,
            custodyType: 'WORKER',
            custodyRef: second.actorId,
            shipmentLineId: second.shipmentLineId,
          },
        },
        tx,
      );
      await exclude(wiring, first.batchId, second.shipmentId, tx);
      await expect(
        tx.transaction((trx) => exclude(wiring, first.batchId, second.shipmentId, trx)),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_ALREADY_WITHDRAWING' } });
      const listed = await wiring.batches.listBatches({ warehouseId: first.warehouseId }, tx);
      expect(listed.find((batch) => batch.id === first.batchId)).toMatchObject({ status: 'picking', withdrawingItems: 1 });
      const candidates = await wiring.batches.findJoinCandidates(first.batchId, second.trackingNo, tx);
      expect(candidates.map((candidate) => candidate.issue)).toEqual(['SHIPMENT_WITHDRAWING']);
    });
  });

  it('토트가 배정돼 있어도 뺄 수 있다 — 비어 있으면 나가면서 토트를 푼다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring } = await started(tx);
      const [tote] = await tx
        .insert(wmsTables.totes)
        .values({ warehouseId: second.warehouseId, barcode: `T-${randomUUID().slice(0, 8)}`, status: 'in_use' })
        .returning();
      await tx
        .insert(wmsTables.shipmentToteAssignments)
        .values({ shipmentId: second.shipmentId, toteId: tote.id, assignedBy: second.actorId });

      const result = await exclude(wiring, first.batchId, second.shipmentId, tx);

      expect(result.workItem.status).toBe('excluded');
      const [assignment] = await tx
        .select()
        .from(wmsTables.shipmentToteAssignments)
        .where(eq(wmsTables.shipmentToteAssignments.toteId, tote.id));
      expect(assignment.releasedAt).not.toBeNull();
      const [released] = await tx.select().from(wmsTables.totes).where(eq(wmsTables.totes.id, tote.id));
      expect(released.status).toBe('available');
    });
  });
```

«토탈피킹: AT_SOURCE 가 … 카트에 다 실렸으면 BOX_HAS_PICKED_ITEMS» 의 **뒤 절반**을 바꾼다(앞 절반 — 둘째 박스 반납 — 은 그대로):

```ts
      // 이제 AT_SOURCE 는 0 — 첫 박스 몫 2 는 카트에 실렸다. 배정은 그대로 두고 withdrawing(정한 것 2).
      const firstOut = await exclude(wiring, first.batchId, first.shipmentId, tx);
      expect(firstOut.workItem.status).toBe('withdrawing');
      expect(await loadWithdrawalRemovals(tx, first.workItemId)).toEqual([
        expect.objectContaining({ boxQty: 0, cartQty: 2 }),
      ]);
      await expect(wiring.recovery.reconcile(run.sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
```

테스트 이름도 `'토탈피킹: AT_SOURCE 가 그 박스 몫을 덮으면 반납, 카트에 실린 몫은 배정에 남아 withdrawing'` 으로.

import 에 `import { loadWithdrawalRemovals } from './withdrawal-removals.query';` 를 더한다.

`outbound-batch-orchestrator.integration.spec.ts` 의 `BOX_HAS_PICKED_ITEMS` 기대(`grep -n BOX_HAS_PICKED_ITEMS apps/core/src -r` 로 찾는다 — PR 2 본문의 «preserves reservations on exclusion and blocks exclusion when custody or dispatch exists»)는 이제 이탈이 시작된다: 기대를 `{ status: 'withdrawing', exitTo: 'draft' }` 로 바꾸고 «예약은 그대로» 단언은 유지한다. 발송 갈래(`WORK_ITEM_DISPATCH_EXISTS`)는 그대로다.

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-withdraw`
Expected: FAIL — `withdrawal-removals.query` 가 없고, 집은 박스는 아직 `BOX_HAS_PICKED_ITEMS`

- [ ] **Step 3: 뺄 목록 조회를 만든다** — `services/withdrawal-removals.query.ts`:

```ts
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BOX_CUSTODY_TYPES } from './batch-inventory-session.service';

const A = wmsTables.pickingSourceAllocations;
const B = wmsTables.batchInventorySessionBalances;

export interface WithdrawalRemoval {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  sourceLocationId: string;
  locationCode: string;
  /** 박스(작업자 손·토트·분류·포장·검수)에 든 몫 — 송장 스캔 화면에서 상품을 스캔해 바구니로. */
  boxQty: number;
  /** 토탈피킹 카트에 실린 몫 — 분류대에서 여분을 바구니로(스펙 §8, 정한 것 2). */
  cartQty: number;
}

/**
 * 빼는 박스의 뺄 목록(스펙 §10.5 `withdrawing`). 남은 배정 = 뺄 몫이다 — 집지 않은 몫은 이탈 시작 때 이미 반납됐다.
 * 그중 박스 보관이 덮는 만큼이 박스 몫, 나머지가 카트 몫. 조회 전용.
 */
export async function loadWithdrawalRemovals(trx: DbTx, workItemId: string): Promise<WithdrawalRemoval[]> {
  const rows = await trx
    .select({
      shipmentLineId: A.shipmentLineId,
      skuId: wmsTables.shipmentLines.skuId,
      skuCode: wmsTables.skus.code,
      skuName: wmsTables.skus.name,
      sourceLocationId: A.sourceLocationId,
      locationCode: wmsTables.locations.code,
      qty: A.qty,
      batchId: wmsTables.outboundBatchWorkItems.batchId,
    })
    .from(A)
    .innerJoin(wmsTables.outboundBatchWorkItems, eq(wmsTables.outboundBatchWorkItems.id, A.workItemId))
    .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, A.shipmentLineId))
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
    .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, A.sourceLocationId))
    .where(and(eq(A.workItemId, workItemId), gt(A.qty, 0)))
    .orderBy(asc(wmsTables.locations.code), asc(wmsTables.skus.name));
  if (!rows.length) return [];
  const [session] = await trx
    .select({ id: wmsTables.batchInventorySessions.id })
    .from(wmsTables.batchInventorySessions)
    .where(
      and(
        eq(wmsTables.batchInventorySessions.batchId, rows[0].batchId),
        inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
      ),
    )
    .limit(1);
  const inBox = new Map<string, number>();
  if (session) {
    const held = await trx
      .select({
        shipmentLineId: B.shipmentLineId,
        sourceLocationId: B.sourceLocationId,
        qty: sql<number>`sum(${B.qty})::int`,
      })
      .from(B)
      .where(
        and(
          eq(B.sessionId, session.id),
          inArray(B.custodyType, [...BOX_CUSTODY_TYPES]),
          inArray(
            B.shipmentLineId,
            rows.map((row) => row.shipmentLineId),
          ),
          gt(B.qty, 0),
        ),
      )
      .groupBy(B.shipmentLineId, B.sourceLocationId);
    for (const row of held) inBox.set(`${row.shipmentLineId}|${row.sourceLocationId}`, Number(row.qty));
  }
  return rows.map(({ qty, batchId: _batchId, ...row }) => {
    const boxQty = Math.min(qty, inBox.get(`${row.shipmentLineId}|${row.sourceLocationId}`) ?? 0);
    return { ...row, boxQty, cartQty: qty - boxQty };
  });
}
```

(`_batchId` 가 lint 에 걸리면 구조 분해 대신 필드를 나열한다.)

- [ ] **Step 4: 배정 실행부를 고친다** — `box-allocation.manager.ts`

`withdrawUnpicked` 를 `handBackUnpicked` 로 바꾼다. 계획 계산은 그대로 두고 **끝의 판정만** 바꾼다 — 집은 몫·카트 몫이 있어도 던지지 않고 반납만 한다(남은 배정이 곧 뺄 몫이다):

```ts
  /**
   * 이탈 시작(목표 → 0)의 반납 단계. 호출자가 구성요소·작업 항목·세션을 잠갔다. 집지 않은 몫(AT_SOURCE 가 덮는 만큼)만
   * HAND_BACK 하고 배정을 같이 줄인다 — 반납된 재고는 그 자리에서 일반 가용이 된다. 집은 몫(excess)과 카트 몫(cartSurplus)은
   * 배정에 남는다: 실물이 되돌림 바구니에 들어갈 때 REMOVE_TO_RETURN_BIN 이 준다(스펙 §8, PR 3 계획이 정함 2·3).
   */
  async handBackUnpicked(
    input: {
      session: BatchInventorySessionRow;
      workItemId: string;
      lines: Array<{ id: string; skuId: string }>;
      actorId: string;
      operationId: string;
    },
    trx: DbTx,
  ): Promise<{ handedBackQty: number }> {
    // … withdrawUnpicked 의 rows·balances·attributed·atSource·plan 계산을 그대로 …
    for (const back of plan.handBacks) {
      await this.sessions.handBack(
        {
          sessionId: input.session.id,
          operationId: input.operationId,
          actorId: input.actorId,
          workItemId: input.workItemId,
          allocationId: back.allocationId,
          shipmentLineId: back.shipmentLineId,
          skuId: back.skuId,
          sourceLocationId: back.sourceLocationId,
          quantity: back.qty,
        },
        trx,
      );
      await this.decrementAllocation(back.allocationId, back.qty, trx);
    }
    return { handedBackQty: plan.handBacks.reduce((total, back) => total + back.qty, 0) };
  }

  /** 배정 감소 CAS — 반납·되돌림이 같이 쓴다. 행은 지우지 않는다(0 허용, 스펙 §11). */
  private async decrementAllocation(allocationId: string, qty: number, trx: DbTx): Promise<void> {
    const [reduced] = await trx
      .update(wmsTables.pickingSourceAllocations)
      .set({ qty: sql`${wmsTables.pickingSourceAllocations.qty} - ${qty}` })
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.id, allocationId),
          gte(wmsTables.pickingSourceAllocations.qty, qty),
        ),
      )
      .returning({ id: wmsTables.pickingSourceAllocations.id });
    if (!reduced) {
      throw new ConflictException({
        code: 'PICKING_ALLOCATION_STALE',
        error: 'PICKING_ALLOCATION_STALE',
        message: `Allocation ${allocationId} changed`,
      });
    }
  }
```

입력의 `shipmentId` 는 더는 쓰지 않으므로 뺀다. `boxHasPickedItems` import 를 지우고, `allocation.errors.ts` 에서 `boxHasPickedItems` 와 그 `AllocationDecrement` import 를 지운다(`grep -rn boxHasPickedItems apps/core/src` 가 0 이어야 한다).

- [ ] **Step 5: 이탈 서비스를 만든다** — `services/box-withdrawal.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { databaseNow } from '../picking/allocation/allocation.queries';
import { WaybillService } from '../waybill/waybill.service';
import { BatchInventorySessionRow } from './batch-inventory-session.service';
import { BoxAllocationManager } from './box-allocation.manager';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { ToteLifecycleService } from './tote-lifecycle.service';
import { WITHDRAWABLE_WORK_ITEM_STATUSES, WorkItemExitTo } from './work-item-status';

export type WorkItemRow = typeof wmsTables.outboundBatchWorkItems.$inferSelect;
const WI = wmsTables.outboundBatchWorkItems;
const A = wmsTables.pickingSourceAllocations;

export interface BeginWithdrawalInput {
  batchId: string;
  shipmentId: string;
  shipmentStatus: string;
  /** 호출자가 FOR UPDATE 로 잠근 활성 작업 항목. */
  workItem: WorkItemRow;
  lines: Array<{ id: string; skuId: string }>;
  exitTo: WorkItemExitTo;
  reason: string;
  /** 전체 취소 연결(E10)의 취소 오퍼레이션. 운영자 빼기는 null. */
  waitingOperationId: string | null;
  actorId: string;
  /** 명령 id — 세션 이벤트 멱등 키와 나갈 때의 송장 무효화 키에 쓴다. */
  operationId: string;
}

export interface BeginWithdrawalResult {
  kind: 'withdrawing' | 'exited';
  workItem: WorkItemRow;
  handedBackQty: number;
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * 시작된 배치에서 박스가 빠지는 일의 생명주기(스펙 §8). 목표를 0 으로 두고 — 집지 않은 몫은 즉시 반납, 집은 몫과 카트 몫은
 * 되돌림 바구니로 들어갈 때 배정이 준다 — 배정 합이 0 이 되는 트랜잭션에서 나간다.
 * 호출자: 운영자 빼기(`OutboundBatchOrchestrator.excludeShipment`), 전체 취소(`ShipmentPlanningService.cancelOutstanding`),
 * 되돌림(`BoxReturnService`, 토탈피킹 전략의 카트 여분). PR 4 의 «결품 못 채움» 도 여기로 온다.
 *
 * 계획·오케스트레이터를 모른다(그 둘이 이 서비스를 주입받는다). 그래서 `canceled` 로 나간 박스의 취소 완료
 * (`ShipmentPlanningService.finishWithdrawnCancellation`)와 `draft` 로 나간 박스의 대기 오퍼레이션 재개는 호출자가 한다.
 */
@Injectable()
export class BoxWithdrawalService {
  constructor(
    private readonly invariant: FulfillmentInvariantService,
    private readonly boxes: BoxAllocationManager,
    private readonly totes: ToteLifecycleService,
    private readonly waybills: WaybillService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 이탈을 막는 사유(정한 것 3). 쓰지 않는다 — 세션만 잠근다(호출자가 구성요소·작업 항목을 이미 잡았다).
   * 전체 취소(E10)는 이걸로 이탈 갈래와 옛 대기 갈래를 가른다.
   */
  async blockerOf(
    input: { batchId: string; shipmentId: string; shipmentStatus: string; workItem: WorkItemRow },
    trx: DbTx,
  ): Promise<{ blocker: { code: string; message: string } } | { session: BatchInventorySessionRow }> {
    if (input.workItem.status === 'short_pick_recovery') {
      return {
        blocker: { code: 'WORK_ITEM_ALLOCATED', message: 'Work item is in short-pick recovery; use short-pick recovery' },
      };
    }
    const [attempt] = await trx
      .select({ id: wmsTables.dispatchAttempts.id })
      .from(wmsTables.dispatchAttempts)
      .where(
        and(eq(wmsTables.dispatchAttempts.shipmentId, input.shipmentId), ne(wmsTables.dispatchAttempts.status, 'recalled')),
      )
      .limit(1);
    if (attempt || ['shipped', 'in_transit', 'delivered'].includes(input.shipmentStatus)) {
      return {
        blocker: { code: 'WORK_ITEM_DISPATCH_EXISTS', message: 'A dispatched shipment cannot be excluded from a batch' },
      };
    }
    const session = await this.boxes.lockOpenSession(input.batchId, trx);
    if (!session || session.status !== 'active') {
      return {
        blocker: {
          code: 'PICKING_SESSION_NOT_ACTIVE',
          message: `Batch ${input.batchId} inventory session is ${session?.status ?? 'not open'}`,
        },
      };
    }
    return { session };
  }

  async begin(input: BeginWithdrawalInput, trx: DbTx): Promise<BeginWithdrawalResult> {
    const item = input.workItem;
    if (item.status === 'withdrawing') return this.escalate(input, trx);
    const checked = await this.blockerOf(input, trx);
    if ('blocker' in checked) throw conflict(checked.blocker.code, checked.blocker.message);
    if (!(WITHDRAWABLE_WORK_ITEM_STATUSES as readonly string[]).includes(item.status)) {
      throw new Error(`begin: work item ${item.id} is ${item.status}`);
    }
    this.assertWaitingSlot(item, input.waitingOperationId);
    const { handedBackQty } = await this.boxes.handBackUnpicked(
      {
        session: checked.session,
        workItemId: item.id,
        lines: input.lines,
        actorId: input.actorId,
        operationId: input.operationId,
      },
      trx,
    );
    const now = await databaseNow(trx);
    const [withdrawing] = await trx
      .update(WI)
      .set({
        status: 'withdrawing',
        exitTo: input.exitTo,
        exclusionReason: input.reason,
        waitingOperationId: input.waitingOperationId ?? item.waitingOperationId,
        pickerReleasedAt: item.status === 'picking' ? now : item.pickerReleasedAt,
        packerReleasedAt: item.status === 'packing' ? now : item.packerReleasedAt,
        leaseExpiresAt: null,
        leaseVersion: item.leaseVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(WI.id, item.id),
          eq(WI.leaseVersion, item.leaseVersion),
          inArray(WI.status, [...WITHDRAWABLE_WORK_ITEM_STATUSES]),
        ),
      )
      .returning();
    if (!withdrawing) throw conflict('WORK_ITEM_STALE_LEASE_VERSION', `Work item ${item.id} changed while withdrawing`);
    const exit = await this.exitIfDrained(withdrawing, { actorId: input.actorId, operationId: input.operationId }, trx);
    return { kind: exit.exited ? 'exited' : 'withdrawing', workItem: exit.workItem, handedBackQty };
  }

  /**
   * 나가기(정한 것 4). 배정 합이 0 이 아니면 아무것도 하지 않는다. 호출자가 구성요소·작업 항목을 잡았다.
   * (`exit_to = canceled` 의 송장 무효화는 Task 8 이 이 메서드에 더한다 — 그 전에는 canceled 로 이탈을 시작하는 호출자가 없다.)
   */
  async exitIfDrained(
    workItem: WorkItemRow,
    ctx: { actorId: string; operationId: string },
    trx: DbTx,
  ): Promise<{ exited: boolean; workItem: WorkItemRow }> {
    if (workItem.status !== 'withdrawing') throw new Error(`exitIfDrained: work item ${workItem.id} is ${workItem.status}`);
    const [row] = await trx
      .select({ qty: sql<number>`coalesce(sum(${A.qty}), 0)::int` })
      .from(A)
      .where(eq(A.workItemId, workItem.id));
    if (Number(row?.qty ?? 0) > 0) return { exited: false, workItem };
    const [excluded] = await trx
      .update(WI)
      .set({ status: 'excluded', leaseExpiresAt: null, leaseVersion: workItem.leaseVersion + 1, updatedAt: sql`now()` })
      .where(and(eq(WI.id, workItem.id), eq(WI.leaseVersion, workItem.leaseVersion), eq(WI.status, 'withdrawing')))
      .returning();
    if (!excluded) throw conflict('WORK_ITEM_STALE_LEASE_VERSION', `Work item ${workItem.id} changed while exiting`);
    const totes = await this.totes.releaseEmptyAssignmentsForShipment(
      { shipmentId: excluded.shipmentId, operationId: ctx.operationId },
      trx,
    );
    await this.audit.logUserActionRequired(
      'outbound_batch.shipment.exit',
      'fulfillment',
      `Work item ${excluded.id} left batch ${excluded.batchId}`,
      { userId: ctx.actorId },
      {
        operationId: ctx.operationId,
        shipmentId: excluded.shipmentId,
        exitTo: excluded.exitTo,
        waitingOperationId: excluded.waitingOperationId,
        releasedToteAssignmentIds: totes.releasedAssignmentIds,
      },
      trx,
    );
    return { exited: true, workItem: excluded };
  }

  /** 박스들의 구성요소를 불변식 검사기로 잠근다 — 되돌림 명령의 첫 잠금(스펙 §13 순서의 맨 앞). */
  async lockComponentsOf(shipmentIds: string[], trx: DbTx): Promise<void> {
    if (!shipmentIds.length) return;
    const rows = await trx
      .selectDistinct({ id: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds));
    if (!rows.length) throw new NotFoundException(`Shipments ${shipmentIds.join(',')} have no lines`);
    await this.invariant.assertFulfillmentOrders(
      rows.map((row) => row.id).sort(),
      trx,
    );
  }

  /** 이미 빼는 중 — 전체 취소만 draft → canceled 로 올린다(정한 것 5). */
  private async escalate(input: BeginWithdrawalInput, trx: DbTx): Promise<BeginWithdrawalResult> {
    const item = input.workItem;
    if (input.exitTo !== 'canceled' || item.exitTo !== 'draft') {
      throw conflict('SHIPMENT_ALREADY_WITHDRAWING', `Shipment ${input.shipmentId} is already leaving batch ${item.batchId}`);
    }
    this.assertWaitingSlot(item, input.waitingOperationId);
    const [updated] = await trx
      .update(WI)
      .set({ exitTo: 'canceled', waitingOperationId: input.waitingOperationId, updatedAt: sql`now()` })
      .where(and(eq(WI.id, item.id), eq(WI.status, 'withdrawing')))
      .returning();
    if (!updated) throw conflict('WORK_ITEM_STALE_LEASE_VERSION', `Work item ${item.id} changed while escalating`);
    return { kind: 'withdrawing', workItem: updated, handedBackQty: 0 };
  }

  private assertWaitingSlot(item: WorkItemRow, waitingOperationId: string | null): void {
    if (waitingOperationId && item.waitingOperationId && item.waitingOperationId !== waitingOperationId) {
      throw conflict(
        'CANCELLATION_WORK_ITEM_ALREADY_WAITING',
        `Work item ${item.id} already waits for operation ${item.waitingOperationId}`,
      );
    }
  }
}
```

- [ ] **Step 6: 오케스트레이터를 고친다** — `outbound-batch-orchestrator.service.ts`
  - 파일 상단의 로컬 `ACTIVE_WORK_ITEM_STATUSES` 를 지우고 `import { ACTIVE_WORK_ITEM_STATUSES } from './work-item-status';`. `shipment-planning.service.ts` 도 같다(로컬 상수 삭제 + import). 이것으로 `withdrawing` 이 두 서비스의 «활성» 에 들어간다 — 이탈 중인 박스는 합류·편집·취소 즉시 적용 대상이 아니다.
  - 생성자 끝에 `private readonly withdrawals: BoxWithdrawalService,` 를 더한다.
  - `excludeShipment` 의 핸들러를 아래처럼 가른다(시작 전 갈래는 지금 코드 그대로):

```ts
      async (trx, commandRequestId) => {
        const aggregate = await this.lockEligibilityAggregate(shipmentId, trx);
        const [batch] = await trx
          .select({ id: wmsTables.outboundBatches.id, startedAt: wmsTables.outboundBatches.startedAt })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, batchId))
          .limit(1);
        if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
        const [workItem] = await trx
          .select()
          .from(wmsTables.outboundBatchWorkItems)
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
              eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
              inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
            ),
          )
          .limit(1)
          .for('update');
        if (!workItem)
          throw new NotFoundException(`Active work item for shipment ${shipmentId} not found in ${batchId}`);
        if (workItem.waitingOperationId) {
          await this.assertWaitingOperationOwnership(workItem.waitingOperationId, shipmentId, trx);
        }
        const reason = dto.reason.trim();
        if (batch.startedAt) {
          // 시작된 배치 — 이탈(스펙 §8). 집은 몫이 있으면 withdrawing 으로 남고, 없으면 이 트랜잭션에서 나간다.
          const outcome = await this.withdrawals.begin(
            {
              batchId,
              shipmentId,
              shipmentStatus: aggregate.shipment.status,
              workItem,
              lines: aggregate.lines.map((line) => ({ id: line.id, skuId: line.skuId })),
              exitTo: 'draft',
              reason,
              waitingOperationId: null,
              actorId: actor.id,
              operationId: commandRequestId,
            },
            trx,
          );
          await this.auditCommand(trx, actor, 'outbound_batch.shipment.withdraw', outcome.workItem.id, {
            commandRequestId,
            batchId,
            shipmentId,
            reason,
            status: outcome.workItem.status,
            handedBackQty: outcome.handedBackQty,
          });
          const response = { operationId: commandRequestId, workItem: this.workItemResponse(outcome.workItem) };
          return { response, resourceType: 'outbound_batch_work_item', resourceId: outcome.workItem.id };
        }
        await this.assertExcludable(aggregate, trx);
        // … 지금의 excluded 갱신·감사·응답 그대로(reason 변수 사용) …
      },
```

  - 명령 뒤의 재개는 **나간 경우에만**:

```ts
    // 나간(excluded) 박스만 — 빼는 중(withdrawing)이면 아직 배치에 있다. canceled 로 나간 박스의 취소는 이미 완료돼 있어 재개가 곧 돌아온다.
    if (response.workItem.status === 'excluded' && response.workItem.waitingOperationId) {
      await this.resumeWaitingOperation(response.workItem.waitingOperationId, shipmentId, tx);
    }
```

  - `withdrawFromStartedBatch` 메서드를 지우고, `import { boxHasPickedItems, joinBlocked }` 를 `import { joinBlocked }` 로.
  - `resumeWaitingOperationIfReady` 를 `async resumeWaitingOperation(operationId: string, shipmentId: string, tx?: DbTx): Promise<void>` 로 이름을 바꿔 **공개**한다(본문 그대로). 문서 주석: `/** 박스가 배치를 떠난 뒤 그 작업 항목이 기다리던 오퍼레이션을 이어 간다. 되돌림 명령(BoxReturnService)도 draft 로 나간 박스에 대해 커밋 뒤에 부른다. */`
  - `findJoinCandidates` 의 이 배치 조회에 `status` 를 싣고 갈래를 나눈다:

```ts
        const [inThisBatch] = await trx
          .select({ id: wmsTables.outboundBatchWorkItems.id, status: wmsTables.outboundBatchWorkItems.status })
          // … 같은 from/where/limit …
        // 빼는 중인 박스는 합류 재시도가 아니다 — 그 박스에 송장을 뽑으면 I4 로 거절된다(정한 것 17).
        const issue = inThisBatch
          ? inThisBatch.status === 'withdrawing'
            ? 'SHIPMENT_WITHDRAWING'
            : 'ALREADY_IN_THIS_BATCH'
          : await this.rejectionCode(() => this.assertJoinableBox(batch, aggregate, trx, false));
```

  - `listBatches`: 작업량 맵에 `withdrawing: new Set<string>()` 를 두고, 행 루프에서 `if (item.status === 'withdrawing') workload.withdrawing.add(item.id);`, 응답에 `withdrawingItems: workload?.withdrawing.size ?? 0`.
- [ ] **Step 7: DTO** — `outbound-batch-v2.dto.ts`:
  - `OutboundBatchV2ListItemDto` 에 `@ApiProperty({ description: '빼는 중인 박스 수 — 배치 카드의 «빠지는 중 N»' }) withdrawingItems: number;`
  - `OutboundBatchWorkItemResponseDto` 에 `@ApiPropertyOptional({ enum: ['draft', 'canceled'], nullable: true, description: '이탈이 끝나면 박스가 갈 곳' }) exitTo: 'draft' | 'canceled' | null;`
- [ ] **Step 8: 배선한다**
  - `fulfillment.module.ts` providers 에 `BoxWithdrawalService`.
  - `services/__support__/box-withdrawal-wiring.ts`:

```ts
import { DbService } from '@app/db';
import { BatchControlledStockGuard } from '../../../inventory/core/services/batch-controlled-stock.guard';
import { wmsSchema } from '../../../inventory/schema/inventory.schema';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import { WaybillManager } from '../../waybill/waybill.manager';
import { WaybillReader } from '../../waybill/waybill.reader';
import { WaybillRepository } from '../../waybill/waybill.repository';
import { WaybillService } from '../../waybill/waybill.service';
import { BatchInventorySessionService } from '../batch-inventory-session.service';
import { BoxAllocationManager } from '../box-allocation.manager';
import { BoxWithdrawalService } from '../box-withdrawal.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';
import { ToteLifecycleService } from '../tote-lifecycle.service';

/**
 * 오케스트레이터·계획을 직접 조립하는 스펙용 — 실제 서비스들로 이탈 서비스를 만든다(stateless 라 인스턴스가 따로여도 된다).
 * 캐리어 호출은 이 경로에 없어 stub 이다(simple-outbound-wiring 과 같다).
 */
export function assembleBoxWithdrawal(dbService: DbService<typeof wmsSchema>): BoxWithdrawalService {
  const audit = new AuditService(dbService);
  const waybills = new WaybillService(
    new WaybillManager(
      new WaybillReader(dbService),
      new WaybillRepository(dbService),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dbService,
    ),
  );
  return new BoxWithdrawalService(
    new FulfillmentInvariantService(),
    new BoxAllocationManager(new BatchInventorySessionService(dbService, audit), new BatchControlledStockGuard()),
    new ToteLifecycleService(dbService),
    waybills,
    audit,
  );
}
```

(`WaybillManager` 생성자 인자가 simple-outbound-wiring 과 다르면 그쪽을 그대로 따른다.)
  - `simple-outbound-wiring.ts` 의 `assembleOutboundWithDb`: `const totes = new ToteLifecycleService(dbService);` 와 `const withdrawals = new BoxWithdrawalService(invariant, boxes, totes, waybills, audit);` 를 `batches` 생성 전에 두고 `new OutboundBatchOrchestrator(…, boxes, withdrawals)`. 반환 객체에 `withdrawals`·`totes` 를 더한다.
  - `new OutboundBatchOrchestrator(` 를 부르는 스펙 전부(`grep -rln "new OutboundBatchOrchestrator(" apps/core/src`): 마지막 인자에 `assembleBoxWithdrawal(dbService)` 를 더한다(그 스펙의 `dbService` 이름을 쓴다). 단위 스펙(`outbound-batch-orchestrator.service.spec.ts`)은 `{} as never`.
- [ ] **Step 9: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-withdraw outbound-batch-orchestrator batch-join join-candidates outbound-v2`
Expected: PASS(develop 부터 빨간 스위트 목록 — PR 2 본문 — 에 든 것은 제외)
Run: `npm run type-check` → 0
Run: `npx jest apps/core/src/modules/fulfillment --maxWorkers=2` → PASS

- [ ] **Step 10: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 집은 박스도 뺄 수 있다 — 집지 않은 몫은 반납하고 남은 배정은 withdrawing 으로 (#989)"
```

---
### Task 7: 빠지는 박스의 전진 명령은 `SHIPMENT_WITHDRAWN`, 송장은 그리지 않는다(I4)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.errors.ts` (`shipmentWithdrawn`)
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.queries.ts` (`lockAndAssertPickerClaim`)
- Modify: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts` (`lockAggregate`)
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts` (`loadWorkItem`)
- Modify: `apps/core/src/modules/fulfillment/waybill/label-currency.guard.ts` (`assertCurrent`)
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.types.ts` (`LabelAllocation.withdrawing`), `waybill/waybill.reader.ts` (`loadLabelAllocation`), `waybill/waybill-label-content.assembler.ts` (`assertLabelAllocated`)
- Test: `apps/core/src/modules/fulfillment/services/withdrawn-forward-commands.integration.spec.ts`, 조립 함수 단위 스펙(`grep -rln "assertLabelAllocated" apps/core/src --include=*.spec.ts`)

**Interfaces:**
- Produces: `export function shipmentWithdrawn(shipmentId: string): ConflictException` — `{ code: 'SHIPMENT_WITHDRAWN' }`. `LabelAllocation` 에 `withdrawing: boolean`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

조립 함수 단위 스펙(`assertLabelAllocated` 를 다루는 스펙)에 한 케이스:

```ts
  it('I4 — 이탈 중인 박스는 배정이 남아 있어도 그리지 않는다', () => {
    expect(() =>
      assertLabelAllocated('s-1', {
        workItemId: 'wi-1',
        batchStarted: true,
        withdrawing: true,
        lines: [{ id: 'l-1', qty: 1 }],
        rows: [{ shipmentLineId: 'l-1', locationCode: 'A-01', skuId: 'sku', skuName: '볼펜', qty: 1 }],
      }),
    ).toThrow(/WAYBILL_LABEL_NOT_ALLOCATED/);
  });
```

(그 스펙의 다른 `LabelAllocation` 리터럴에는 `withdrawing: false` 를 더한다 — type-check 가 찾아 준다.)

`withdrawn-forward-commands.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from './__support__/simple-outbound-wiring';
import { assembleLabels } from '../waybill/__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('빠지는 박스의 전진 명령 (스펙 §12 SHIPMENT_WITHDRAWN, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 둘째 박스를 집고 뺀다 — withdrawing. */
  async function withdrawing(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: second.actorId,
        quantity: 1,
        from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: second.skuId,
          sourceLocationId: second.locationId,
          custodyType: 'PACKING',
          custodyRef: `work-item:${second.workItemId}`,
          shipmentLineId: second.shipmentLineId,
        },
      },
      tx,
    );
    const out = await wiring.batches.excludeShipment(
      first.batchId,
      second.shipmentId,
      { reason: '고객 요청' },
      `x-${randomUUID()}`,
      actor,
      tx,
    );
    expect(out.workItem.status).toBe('withdrawing');
    return { first, second, wiring, sessionId: run.sessionId, workItem: out.workItem };
  }

  it('단순출고 스캔은 SHIPMENT_WITHDRAWN', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring } = await withdrawing(tx);
      await expect(
        tx.transaction((trx) =>
          wiring.simple.scan(
            second.shipmentId,
            { barcode: second.barcode, quantity: 1, actor, idempotencyKey: `sc-${randomUUID()}` },
            trx,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_WITHDRAWN' } });
    });
  });

  it('피킹 스캔(전략)은 SHIPMENT_WITHDRAWN — 옛 리스로 와도', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring, sessionId, workItem } = await withdrawing(tx);
      await expect(
        tx.transaction((trx) =>
          wiring.picking.scan(
            {
              strategy: 'discrete',
              stage: 'source',
              batchId: workItem.batchId,
              sessionId,
              workItemId: workItem.id,
              shipmentId: second.shipmentId,
              shipmentLineId: second.shipmentLineId,
              skuId: second.skuId,
              sourceLocationId: second.locationId,
              quantity: 1,
              actor,
              expectedLeaseVersion: workItem.leaseVersion,
              idempotencyKey: `p-${randomUUID()}`,
            },
            trx,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_WITHDRAWN' } });
    });
  });

  it('송장 게이트는 SHIPMENT_WITHDRAWN, 송장 렌더는 WAYBILL_LABEL_NOT_ALLOCATED', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, workItem } = await withdrawing(tx);
      const labels = assembleLabels(ambientDbService(tx));
      await expect(labels.guard.assertCurrent(workItem.id, tx)).rejects.toMatchObject({
        response: { code: 'SHIPMENT_WITHDRAWN' },
      });
      await expect(labels.assembler.current(second.shipmentId, tx)).rejects.toThrow(/WAYBILL_LABEL_NOT_ALLOCATED/);
    });
  });
});
```

(`assembleLabels(dbService)` 는 `assembler`·`states`·`guard` 를 돌려준다 — `waybill/__support__/label-fixtures.ts`.)

같은 스펙에 검수·발송 거절 케이스(`simple-outbound-wiring` 의 반환 객체에 이미 만든 `dispatch` 를 더한다 — Step 3 끝):

```ts
  it('검수·발송은 SHIPMENT_WITHDRAWN', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring } = await withdrawing(tx);
      await expect(
        tx.transaction((trx) =>
          wiring.dispatch.inspectShipmentLines(
            second.shipmentId,
            {
              entries: [{ shipmentLineId: second.shipmentLineId, quantity: 1 }],
              actor,
              idempotencyKey: `i-${randomUUID()}`,
            },
            trx,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_WITHDRAWN' } });
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- withdrawn-forward-commands`
Expected: FAIL — `SIMPLE_OUTBOUND_WORK_ITEM_MISSING`·`PICKING_STALE_CLAIM`·`LABEL_REPRINT_REQUIRED` 등 다른 코드

- [ ] **Step 3: 고친다**

`allocation.errors.ts`:

```ts
/** 빠지는(withdrawing)·빠진(excluded) 박스의 전진 명령(스펙 §12). 앱은 «빠진 박스 · 송장은 버리세요» 로 안내한다. */
export function shipmentWithdrawn(shipmentId: string): ConflictException {
  return new ConflictException({
    code: 'SHIPMENT_WITHDRAWN',
    message: `Shipment ${shipmentId} is leaving (or has left) its batch; forward work is not accepted`,
  });
}
```

`allocation.queries.ts` 의 `lockAndAssertPickerClaim` — `assertWorkItemIdentity` 바로 다음:

```ts
  // 전략 7곳이 모두 여기를 지난다 — 빠지는 박스는 리스가 살아 있어도 더 집지 않는다(정한 것 11).
  if (item.status === 'withdrawing' || item.status === 'excluded') throw shipmentWithdrawn(shipmentId);
```

`shipment-dispatch.service.ts` 의 `lockAggregate` — `if (!initialWorkItem) throw this.conflict('SHIPMENT_WORK_ITEM_MISSING', …)` 를:

```ts
    if (!initialWorkItem) {
      const [leaving] = await tx
        .select({ id: wmsTables.outboundBatchWorkItems.id })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
            eq(wmsTables.outboundBatchWorkItems.status, 'withdrawing'),
          ),
        )
        .limit(1);
      if (leaving) throw this.conflict('SHIPMENT_WITHDRAWN', `Shipment ${shipmentId} is leaving its batch`);
      throw this.conflict('SHIPMENT_WORK_ITEM_MISSING', 'Shipment has no outbound work item');
    }
```

`simple-outbound.service.ts` 의 `loadWorkItem` — `if (!workItem) { throw … SIMPLE_OUTBOUND_WORK_ITEM_MISSING }` 앞에 같은 조회를 두고 `withdrawing` 이면 `this.conflict('SHIPMENT_WITHDRAWN', …)`(이 파일의 `conflict` 는 `error` 필드도 싣는다 — 그대로 쓴다).

`label-currency.guard.ts` 의 `assertCurrent`:

```ts
    const [item] = await trx
      .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId, status: wmsTables.outboundBatchWorkItems.status })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId))
      .limit(1);
    if (!item) throw new Error(`LabelCurrencyGuard: work item ${workItemId} vanished under its own lock`);
    // 빠지는 박스에는 종이가 필요 없다 — 조립(I4)보다 먼저 사유를 분명히 한다.
    if (item.status === 'withdrawing' || item.status === 'excluded') throw shipmentWithdrawn(item.shipmentId);
```

`waybill.types.ts` 의 `LabelAllocation` 에 `/** 활성 작업 항목이 이탈 중 — I4 는 그리지 않는다. */ withdrawing: boolean;`.

`waybill.reader.ts` 의 `loadLabelAllocation`: 활성 작업 항목 조회에 `status: WI.status` 를 싣고, 반환 둘에 `withdrawing` 을 넣는다 — 작업 항목이 없으면 `withdrawing: false`, 있으면 `withdrawing: active?.status === 'withdrawing'`(출고 완료 대체 행은 `false`).

`waybill-label-content.assembler.ts` 의 `assertLabelAllocated` — 시작 여부 검사 다음:

```ts
  if (allocation.withdrawing) {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_NOT_ALLOCATED}: shipment ${shipmentId} is leaving its batch`);
  }
```

주석의 I4 설명에 «이탈 중 아님» 을 더한다(스펙 §5 I4 문구 그대로).

`services/__support__/simple-outbound-wiring.ts` 의 반환 객체에 `dispatch` 를 더한다(검수·발송 거절 테스트용).

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- withdrawn-forward-commands`
Expected: PASS 4
Run: `npx jest apps/core/src/modules/fulfillment --maxWorkers=2` → PASS (가드 스펙 `label-currency-gate.guard.spec.ts` 는 그대로다 — 진입점은 바뀌지 않았다)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 빠지는 박스의 전진 명령은 SHIPMENT_WITHDRAWN, 송장은 그리지 않는다 (#989)"
```

---

### Task 8: 전체 취소 → 이탈(E10)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` (생성자, `cancelOutstanding`, `finishWithdrawnCancellation`(신규), `resumePendingCancellation` 꼬리 추출)
- Modify: `apps/core/src/modules/fulfillment/services/box-withdrawal.service.ts` (`exitIfDrained` 의 `canceled` — 송장 무효화)
- Modify: `apps/core/src/modules/fulfillment/services/__support__/simple-outbound-wiring.ts` (`planning`), `new ShipmentPlanningService(` 를 부르는 스펙·지원 모듈 전부
- Test: `apps/core/src/modules/fulfillment/services/batch-cancel-withdraw.integration.spec.ts`

**Interfaces:**
- Consumes: `BoxWithdrawalService.blockerOf`·`begin`·`exitIfDrained`(Task 6), `ACTIVE_WORK_ITEM_STATUSES`(Task 1).
- Produces (planning):
  - 생성자 끝에 `withdrawals: BoxWithdrawalService`
  - `finishWithdrawnCancellation(operationId: string, tx: DbTx): Promise<CancelResponse>` — `canceled` 로 나간 박스의 취소 완료. 박스가 나가는 트랜잭션에서 부른다(이 서비스의 전체 취소, Task 9 의 `BoxReturnService`)
  - `cancelOutstanding` 응답 모양은 그대로(`operationStatus: 'pending' | 'completed'`)
- Produces (`BoxWithdrawalService`): `exitIfDrained` 가 `exit_to = canceled` 면 활성 송장(`registered`)을 로컬 무효화한다. 아니면 `WITHDRAWAL_WAYBILL_NOT_VOIDABLE`.
- Produces (wiring): `assembleOutbound(tx).planning`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `batch-cancel-withdraw.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { PickableShipmentFixture } from './__support__/logistics-fixtures';
import { seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('전체 취소 → 이탈 (스펙 §8 E10, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function started(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    return { first, second, wiring, sessionId: run.sessionId };
  }

  async function cancel(
    wiring: ReturnType<typeof assembleOutbound>,
    box: PickableShipmentFixture,
    tx: DbTx,
    qty?: number,
  ) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
    return wiring.planning.cancelOutstanding(
      box.shipmentId,
      {
        expectedManifestVersion: shipment.manifestVersion,
        reason: '고객 취소',
        lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: qty ?? line.qty }],
      },
      `c-${randomUUID()}`,
      actor,
      tx,
    );
  }

  const pickAll = (wiring: ReturnType<typeof assembleOutbound>, sessionId: string, box: PickableShipmentFixture, tx: DbTx) =>
    wiring.sessions.moveCustody(
      {
        sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: box.actorId,
        quantity: box.qty,
        from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: box.skuId,
          sourceLocationId: box.locationId,
          custodyType: 'WORKER',
          custodyRef: box.actorId,
          shipmentLineId: box.shipmentLineId,
        },
      },
      tx,
    );

  it('집은 게 없으면 그 트랜잭션에서 끝난다 — 반납·나가기·송장 무효·예약 해제·박스 canceled', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      const result = await cancel(wiring, second, tx);

      expect(result.operationStatus).toBe('completed');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
      expect(item).toMatchObject({ status: 'excluded', exitTo: 'canceled', waitingOperationId: result.operationId });
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment).toMatchObject({ status: 'canceled', recoveryCode: null });
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, second.waybillId));
      expect(waybill.status).toBe('voided');
      const reservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, second.shipmentLineId));
      expect(reservations.filter((reservation) => reservation.status === 'confirmed')).toEqual([]);
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      expect(operation.status).toBe('completed');
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('집은 게 있으면 pending — 박스는 planned 로 withdrawing(exit_to canceled)이 되고 취소 오퍼레이션을 기다린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring, sessionId } = await started(tx);
      await pickAll(wiring, sessionId, second, tx);
      const result = await cancel(wiring, second, tx);

      expect(result.operationStatus).toBe('pending');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
      expect(item).toMatchObject({ status: 'withdrawing', exitTo: 'canceled', waitingOperationId: result.operationId });
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment).toMatchObject({ status: 'planned', recoveryCode: null });
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, second.waybillId));
      expect(waybill.status).toBe('registered');
    });
  });

  it('운영자가 빼는 중(draft)인 박스에 전체 취소가 오면 canceled 로 올린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await pickAll(wiring, sessionId, second, tx);
      await wiring.batches.excludeShipment(first.batchId, second.shipmentId, { reason: '급한 변경' }, `x-${randomUUID()}`, actor, tx);
      const result = await cancel(wiring, second, tx);

      expect(result.operationStatus).toBe('pending');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
      expect(item).toMatchObject({ status: 'withdrawing', exitTo: 'canceled', waitingOperationId: result.operationId });
    });
  });

  it('부분 취소는 지금처럼 대기(CANCEL_REPLAN_PENDING) — E11', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring } = await started(tx);
      const result = await cancel(wiring, first, tx, 1); // 첫 박스는 수량 2
      expect(result.operationStatus).toBe('pending');
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, first.shipmentId));
      expect(shipment).toMatchObject({ status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING' });
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, first.workItemId));
      expect(item.status).toBe('queued');
    });
  });

  it('세션이 active 가 아니면 이탈하지 않고 지금처럼 대기한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring, sessionId } = await started(tx);
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'recovery_required', recoveryReason: 'test drift' })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      const result = await cancel(wiring, second, tx);
      expect(result.operationStatus).toBe('pending');
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment.recoveryCode).toBe('CANCEL_REPLAN_PENDING');
    });
  });
});
```

(`seedPickableShipment` 가 만드는 송장이 `registered` 가 아니면 — 배치 시작이 `assertDispatchable` 을 요구하므로 `registered` 여야 한다 — 픽스처를 먼저 확인한다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-cancel-withdraw`
Expected: FAIL — `wiring.planning` 이 없다

- [ ] **Step 3: 나가면서 송장을 무효화한다** — `box-withdrawal.service.ts` 의 `exitIfDrained` 에서 토트 해제 다음:

```ts
    // canceled 로 나가는 박스의 종이는 영영 쓰이지 않는다 — 로컬 무효화(캐리어 호출 없음, 결품 처리와 같다).
    // 취소 오퍼레이션의 완료는 호출자가 이어서 한다(ShipmentPlanningService.finishWithdrawnCancellation).
    if (excluded.exitTo === 'canceled') await this.voidWaybillForCanceledExit(excluded.shipmentId, ctx, trx);
```

```ts
  private async voidWaybillForCanceledExit(
    shipmentId: string,
    ctx: { actorId: string; operationId: string },
    trx: DbTx,
  ): Promise<void> {
    const active = await this.waybills.getActiveWaybill(shipmentId, trx);
    if (!active) return;
    if (active.status !== 'registered') {
      throw conflict(
        'WITHDRAWAL_WAYBILL_NOT_VOIDABLE',
        `Waybill ${active.id} is ${active.status}; resolve it before the canceled box can leave its batch`,
      );
    }
    await this.waybills.void(
      active.id,
      { reason: 'withdrawn:canceled' },
      `withdrawal-exit:${ctx.operationId}:${shipmentId}`,
      { id: ctx.actorId, roles: [] },
      trx,
    );
  }
```

메서드 주석의 «(Task 8 이 이 메서드에 더한다 …)» 괄호를 지운다.

- [ ] **Step 4: 계획 서비스를 고친다** — `shipment-planning.service.ts`

생성자 끝에 `private readonly withdrawals: BoxWithdrawalService,`.

`cancelOutstanding` 핸들러 인자 `_commandRequestId` 를 `commandRequestId` 로 바꾸고, `createOperation` 바로 다음(옛 `if (await this.requiresDurableReplan(...))` 앞)에:

```ts
        // 전체 취소 연결(E10, 스펙 §8): 시작된 배치의 박스를 전량 취소하면 대기가 아니라 이탈로 끝낸다.
        const withdrawal = await this.withdrawalTarget(aggregate, requestedLines, tx);
        if (withdrawal) {
          await this.requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_REOPEN);
          await this.recordPendingIntent(tx, operation.id, aggregate, dto, requestedLines, before);
          const outcome = await this.withdrawals.begin(
            {
              batchId: withdrawal.batchId,
              shipmentId,
              shipmentStatus: aggregate.shipment.status,
              workItem: withdrawal.workItem,
              lines: aggregate.lines.map((line) => ({ id: line.id, skuId: line.skuId })),
              exitTo: 'canceled',
              reason: dto.reason,
              waitingOperationId: operation.id,
              actorId: actor.id,
              operationId: commandRequestId,
            },
            tx,
          );
          if (outcome.kind === 'exited') {
            const response = await this.finishWithdrawnCancellation(operation.id, tx);
            return { response, resourceType: 'shipment', resourceId: shipmentId, operationId: operation.id };
          }
          await this.auditCommand(tx, actor, 'shipment.cancel_outstanding.withdrawing', operation.id, dto.reason, {
            shipmentId,
            workItemId: outcome.workItem.id,
            requestedLines,
            before,
          });
          const response = {
            operationId: operation.id,
            operationStatus: 'pending' as const,
            shipmentId,
            manifestVersion: before.manifestVersion,
          };
          return { response, resourceType: 'shipment_operation', resourceId: operation.id, operationId: operation.id };
        }
```

옛 `requiresDurableReplan` 갈래의 «오퍼레이션에 의도 기록 + 소스 멤버 INSERT» 두 쿼리를 `recordPendingIntent` 로 옮겨 두 갈래가 같이 쓴다:

```ts
  /** 대기 중인 취소의 의도(afterManifestSnapshot.pendingIntent)와 소스 멤버 — 옛 대기 갈래와 이탈 갈래가 같이 쓴다. */
  private async recordPendingIntent(
    tx: DbTx,
    operationId: string,
    aggregate: ShipmentAggregate,
    dto: CancelShipmentOutstandingDto,
    requestedLines: CancelShipmentOutstandingDto['lines'],
    before: ShipmentManifestSnapshot,
  ): Promise<void> {
    const pendingIntent: PendingCancellationIntent = {
      kind: 'cancel_outstanding',
      shipmentId: aggregate.shipment.id,
      expectedManifestVersion: dto.expectedManifestVersion,
      lines: requestedLines,
      reason: dto.reason,
      csCaseId: dto.csCaseId ?? null,
      note: dto.note ?? null,
    };
    await tx
      .update(wmsTables.shipmentOperations)
      .set({ afterManifestSnapshot: { pendingIntent } })
      .where(eq(wmsTables.shipmentOperations.id, operationId));
    await tx.insert(wmsTables.shipmentOperationMembers).values({
      operationId,
      shipmentId: aggregate.shipment.id,
      role: 'source',
      beforeManifestVersion: before.manifestVersion,
      beforeManifestSnapshot: before,
      afterManifestSnapshot: { pendingIntent },
    });
  }

  /**
   * 전체 취소 연결의 대상(정한 것 10) — 박스 전량 취소, 시작된 배치의 활성 작업 항목, 이탈을 막는 사유 없음.
   * 아니면 null — 옛 CANCEL_REPLAN_PENDING 대기(부분 취소는 E11, 세션 recovery_required 등은 운영자 몫).
   * 작업 항목을 FOR UPDATE 로 잡는다(구성요소 다음 — 스펙 §13 순서). 이미 빼는 중이면 begin 이 canceled 로 올린다.
   */
  private async withdrawalTarget(
    aggregate: ShipmentAggregate,
    requestedLines: CancelShipmentOutstandingDto['lines'],
    tx: DbTx,
  ): Promise<{ batchId: string; workItem: WorkItemRow } | null> {
    const requestedByLine = new Map(requestedLines.map((line) => [line.shipmentLineId, line.qty]));
    const whole =
      requestedLines.length === aggregate.lines.length &&
      aggregate.lines.every((line) => requestedByLine.get(line.id) === line.qty);
    if (!whole) return null;
    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, aggregate.shipment.id),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      )
      .limit(1)
      .for('update');
    if (!workItem) return null;
    const [batch] = await tx
      .select({ startedAt: wmsTables.outboundBatches.startedAt })
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, workItem.batchId))
      .limit(1);
    if (!batch?.startedAt) return null;
    if (workItem.status === 'withdrawing') return { batchId: workItem.batchId, workItem };
    const checked = await this.withdrawals.blockerOf(
      { batchId: workItem.batchId, shipmentId: aggregate.shipment.id, shipmentStatus: aggregate.shipment.status, workItem },
      tx,
    );
    return 'blocker' in checked ? null : { batchId: workItem.batchId, workItem };
  }
```

(`WorkItemRow` 는 `box-withdrawal.service.ts` 에서 export 한 타입을 import 한다.)

`resumePendingCancellation` 의 꼬리 — `await this.assertNoActiveWaybill(...)` 다음의 «shipments → draft, 소스 멤버 삭제, applyDraftCancellation, 응답, 명령 요청 응답 갱신» — 를 `applyPendingCancellation` 으로 추출하고 두 곳이 부른다:

```ts
  /** 대기 중인 취소를 실제로 적용한다 — 옛 재개(CANCEL_REPLAN_PENDING)와 이탈 완료(E10)가 같은 꼬리를 쓴다. */
  private async applyPendingCancellation(
    operation: typeof wmsTables.shipmentOperations.$inferSelect,
    pending: PendingCancellationIntent,
    aggregate: ShipmentAggregate,
    selected: Array<{ request: CancelShipmentOutstandingDto['lines'][number]; line: ShipmentLineRow }>,
    tx: DbTx,
  ): Promise<CancelResponse> {
    // … resumePendingCancellation 에 있던 그대로(update shipments draft → delete source member → applyDraftCancellation →
    //    after snapshot → response → fulfillmentCommandRequests 응답 갱신) …
  }

  /**
   * 이탈로 나간 박스의 전체 취소를 끝낸다(E10). 박스가 나가는 트랜잭션에서만 부른다 — 이 서비스의 전체 취소(집은 게 없으면 즉시),
   * 되돌림 명령(`BoxReturnService`, 마지막 몫). 송장은 나가면서 이미 무효화됐다(`BoxWithdrawalService.exitIfDrained`).
   */
  async finishWithdrawnCancellation(operationId: string, tx: DbTx): Promise<CancelResponse> {
    const [operation] = await tx
      .select()
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, operationId))
      .limit(1)
      .for('update');
    if (!operation || operation.type !== 'cancel') {
      throw new NotFoundException(`Cancellation operation ${operationId} not found`);
    }
    if (operation.status !== 'pending') {
      throw this.conflict('CANCELLATION_OPERATION_NOT_PENDING', `Cancellation operation ${operationId} is ${operation.status}`);
    }
    const pending = this.pendingCancellationIntent(operation.afterManifestSnapshot);
    const aggregate = await this.lockAggregate(pending.shipmentId, tx);
    if (aggregate.shipment.status !== 'planned') {
      throw this.conflict(
        'CANCELLATION_SOURCE_STATE_CHANGED',
        `Shipment ${pending.shipmentId} is ${aggregate.shipment.status}, not the planned box that left its batch`,
      );
    }
    this.assertShipmentVersion(aggregate.shipment, pending.expectedManifestVersion);
    // 되돌림이 PACKED 에서 빼면 inspected_qty 와 line_version 이 바뀐다(정한 것 6) — 줄이 그대로인지는 버전 대신 수량으로 본다.
    const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));
    const selected = pending.lines.map((request) => {
      const line = lineById.get(request.shipmentLineId);
      if (!line || request.qty !== line.qty) {
        throw this.conflict('CANCELLATION_LINE_CHANGED', `Shipment line ${request.shipmentLineId} changed before exit`);
      }
      return { request, line };
    });
    if (selected.length !== aggregate.lines.length) {
      throw this.conflict('CANCELLATION_LINE_CHANGED', `Shipment ${pending.shipmentId} lines changed before exit`);
    }
    await this.assertNoActiveWaybill(pending.shipmentId, tx);
    await this.assertNoCustodyOrActiveWork(aggregate, tx);
    return this.applyPendingCancellation(operation, pending, aggregate, selected, tx);
  }
```

- [ ] **Step 5: 배선한다**
  - `simple-outbound-wiring.ts`: `withdrawals` 생성 뒤에

```ts
  const planning = new ShipmentPlanningService(
    dbService,
    commands,
    shipmentReservations,
    invariant,
    audit,
    { getScopesByRoles: () => Promise.resolve(new Set(['master'])) } as never,
    workflowGate,
    withdrawals,
  );
```

  를 두고 반환 객체에 `planning` 을 더한다.
  - `new ShipmentPlanningService(` 를 부르는 곳 전부(`grep -rln "new ShipmentPlanningService(" apps/core/src`): 마지막 인자에 `assembleBoxWithdrawal(<그 스펙의 dbService>)`(Task 6 의 지원 모듈). 단위 스펙(`shipment-planning.service.spec.ts`)은 `{} as never`.
- [ ] **Step 6: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-cancel-withdraw shipment-planning consolidation outbound-v2-scenarios outbound-v2-lifecycle outbound-batch-orchestrator`
Expected: 새 스펙 PASS 5. 나머지는 develop 과 같은 결과(PR 2 본문의 «develop 부터 빨간 스위트» — `shipment-planning.integration` 의 «leaves the cancellation tombstone …» 1건 포함 — 밖에서 새 실패 없음).
Run: `npm run type-check` → 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 시작된 배치 박스의 전체 취소는 대기하지 않고 이탈로 끝난다 (E10, #989)"
```

---

### Task 9: 박스에서 되돌림 바구니로 — `POST shipments/:shipmentId/return-bin-removals`

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/box-return.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/box-allocation.manager.ts` (`removeFromBox`)
- Modify: `apps/core/src/modules/fulfillment/dto/return-bin.dto.ts` (`ReturnBinRemovalDto`, `WithdrawalRemovalDto`, `ReturnBinRemovalResponseDto`)
- Modify: `apps/core/src/modules/fulfillment/controllers/return-bin.controller.ts` (라우트 + 생성자 `returns`)
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`, `services/__support__/simple-outbound-wiring.ts`
- Test: `apps/core/src/modules/fulfillment/services/return-bin-removal.integration.spec.ts`, `controllers/return-bin.controller.spec.ts`

**Interfaces:**
- Consumes: `BatchInventorySessionService.removeToReturnBin`·`BOX_CUSTODY_TYPES`(Task 2), `ReturnBinService.requireActive`(Task 5), `BoxWithdrawalService.exitIfDrained`·`lockComponentsOf`(Task 6), `loadWithdrawalRemovals`(Task 6), `ShipmentPlanningService.finishWithdrawnCancellation`(Task 8), `OutboundBatchOrchestrator.resumeWaitingOperation`(Task 6), `resolveSkuIdByBarcode`.
- Produces:
  - `BoxAllocationManager.removeFromBox(input: { session: BatchInventorySessionRow; workItemId: string; skuId: string; quantity: number; returnBin: ReturnBinRef; actorId: string; operationId: string }, trx: DbTx): Promise<number>` — 박스 보관에서 빼고 배정을 줄인다. `PACKED` 면 `inspected_qty` 도. 모자라면 아무것도 쓰기 전에 `REMOVAL_NOT_PENDING`.
  - `class BoxReturnService` — 생성자 `(commands: FulfillmentCommandService, workflowGate: FulfillmentWorkflowGate, withdrawals: BoxWithdrawalService, boxes: BoxAllocationManager, returnBins: ReturnBinService, barcodes: BarcodeService, planning: ShipmentPlanningService, batches: OutboundBatchOrchestrator)`
    - `removeToReturnBin(shipmentId: string, input: { barcode: string; returnBinBarcode: string; quantity: number }, actor: { id: string; roles: string[] }, idempotencyKey: string, tx?: DbTx): Promise<ReturnBinRemovalResponseDto>`
    - `settleExit(workItem: WorkItemRow, trx: DbTx): Promise<void>` — 나간 박스가 `canceled` 면 취소 완료(Task 10 의 카트 여분도 부른다)
    - `resumeAfterDraftExit(exits: Array<{ shipmentId: string; exitTo: string | null; waitingOperationId: string | null }>, tx?: DbTx): Promise<void>` — 커밋 뒤
  - `ReturnBinRemovalResponseDto { shipmentId; workItemId; removedQty: number; exited: boolean; exitTo: 'draft' | 'canceled' | null; waitingOperationId: string | null; removals: WithdrawalRemovalDto[] }`
  - HTTP `POST shipments/:shipmentId/return-bin-removals` + `Idempotency-Key`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `return-bin-removal.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { seedReturnBin, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('박스에서 되돌림 바구니로 (스펙 §8, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 첫 박스(수량 2)를 custody 로 전부 집고 뺀다 — withdrawing, 뺄 몫 2. */
  async function withdrawnPicked(tx: DbTx, custody: 'WORKER' | 'PACKING' | 'PACKED' = 'PACKING') {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: first.actorId,
        quantity: 2,
        from: { skuId: first.skuId, sourceLocationId: first.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: first.skuId,
          sourceLocationId: first.locationId,
          custodyType: custody === 'WORKER' ? 'WORKER' : 'PACKING',
          custodyRef: custody === 'WORKER' ? first.actorId : `work-item:${first.workItemId}`,
          shipmentLineId: first.shipmentLineId,
        },
      },
      tx,
    );
    if (custody === 'PACKED') {
      // 검수까지 끝난 모양 — PACKING → PACKED 와 inspected_qty 를 같이 올린다(검수 경로와 같다).
      await wiring.sessions.moveCustody(
        {
          sessionId: run.sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: first.actorId,
          quantity: 2,
          from: {
            skuId: first.skuId,
            sourceLocationId: first.locationId,
            custodyType: 'PACKING',
            custodyRef: `work-item:${first.workItemId}`,
            shipmentLineId: first.shipmentLineId,
          },
          to: {
            skuId: first.skuId,
            sourceLocationId: first.locationId,
            custodyType: 'PACKED',
            custodyRef: `work-item:${first.workItemId}`,
            shipmentLineId: first.shipmentLineId,
          },
        },
        tx,
      );
      await tx
        .update(wmsTables.shipmentLines)
        .set({ inspectedQty: 2 })
        .where(eq(wmsTables.shipmentLines.id, first.shipmentLineId));
    }
    await wiring.batches.excludeShipment(first.batchId, first.shipmentId, { reason: '고객 요청' }, `x-${randomUUID()}`, actor, tx);
    const bin = await seedReturnBin(tx, first.warehouseId, first.actorId);
    return { first, second, wiring, sessionId: run.sessionId, bin };
  }

  const remove = (
    wiring: ReturnType<typeof assembleOutbound>,
    shipmentId: string,
    input: { barcode: string; returnBinBarcode: string; quantity?: number },
    tx: DbTx,
    key = `r-${randomUUID()}`,
  ) => wiring.returns.removeToReturnBin(shipmentId, { quantity: 1, ...input }, actor, key, tx);

  it('상품을 스캔할 때마다 1 개씩 바구니로 — 마지막 한 개에서 excluded, 박스는 planned', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId, bin } = await withdrawnPicked(tx);
      const firstScan = await remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode }, tx);
      expect(firstScan).toMatchObject({ removedQty: 1, exited: false });
      expect(firstScan.removals).toEqual([expect.objectContaining({ boxQty: 1, cartQty: 0 })]);

      const last = await remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode }, tx);
      expect(last).toMatchObject({ removedQty: 1, exited: true, exitTo: 'draft', removals: [] });

      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, first.workItemId));
      expect(item.status).toBe('excluded');
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, first.shipmentId));
      expect(shipment.status).toBe('planned');
      const pending = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'RETURN_PENDING'),
          ),
        );
      expect(pending.map((b) => [b.custodyRef, b.qty])).toEqual([[bin.barcode, 2]]);
      // 바구니의 물건은 아직 선반에 없다 — 일반 가용으로 돌아가지 않는다.
      const availability = await new BatchControlledStockGuard().getAvailability(
        { skuId: first.skuId, warehouseId: first.warehouseId, sourceLocationId: first.locationId },
        tx,
      );
      expect(availability.batchControlledQty).toBe(3); // 바구니 2 + 둘째 박스 AT_SOURCE 1
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('검수까지 끝난(PACKED) 상품을 빼면 inspected_qty 도 준다 — 다 빼면 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, bin } = await withdrawnPicked(tx, 'PACKED');
      await remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode, quantity: 2 }, tx);
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, first.shipmentLineId));
      expect(line.inspectedQty).toBe(0);
    });
  });

  it('박스에 없는 상품이거나 뺄 몫보다 많으면 REMOVAL_NOT_PENDING 이고 아무것도 바뀌지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, bin } = await withdrawnPicked(tx, 'WORKER');
      await expect(
        tx.transaction((trx) =>
          remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode, quantity: 3 }, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'REMOVAL_NOT_PENDING' } });
      // 빼는 중이 아닌 박스
      await expect(
        tx.transaction((trx) => remove(wiring, second.shipmentId, { barcode: second.barcode, returnBinBarcode: bin.barcode }, trx)),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_NOT_WITHDRAWING' } });
      // 등록 안 된 바구니
      await expect(
        tx.transaction((trx) => remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: 'RB-none' }, trx)),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_UNKNOWN' } });
      const [allocation] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      expect(allocation.qty).toBe(2);
    });
  });

  it('같은 멱등 키로 다시 보내면 한 번만 뺀다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, bin } = await withdrawnPicked(tx);
      const key = `r-${randomUUID()}`;
      await remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode }, tx, key);
      await remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode }, tx, key);
      const [allocation] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      expect(allocation.qty).toBe(1);
    });
  });

  it('전체 취소로 빼는 박스(E10)는 마지막 몫을 넣는 스캔에서 송장 무효·예약 해제·박스 canceled·취소 완료까지 끝난다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      const wiring = assembleOutbound(tx);
      const run = await wiring.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      await wiring.sessions.moveCustody(
        {
          sessionId: run.sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: second.actorId,
          quantity: 1,
          from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: second.skuId,
            sourceLocationId: second.locationId,
            custodyType: 'PACKING',
            custodyRef: `work-item:${second.workItemId}`,
            shipmentLineId: second.shipmentLineId,
          },
        },
        tx,
      );
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, second.shipmentLineId));
      const cancellation = await wiring.planning.cancelOutstanding(
        second.shipmentId,
        {
          expectedManifestVersion: shipment.manifestVersion,
          reason: '고객 취소',
          lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: line.qty }],
        },
        `c-${randomUUID()}`,
        actor,
        tx,
      );
      expect(cancellation.operationStatus).toBe('pending');
      const bin = await seedReturnBin(tx, second.warehouseId, second.actorId);

      const last = await remove(wiring, second.shipmentId, { barcode: second.barcode, returnBinBarcode: bin.barcode }, tx);

      expect(last).toMatchObject({ exited: true, exitTo: 'canceled', waitingOperationId: cancellation.operationId });
      const [after] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(after.status).toBe('canceled');
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, second.waybillId));
      expect(waybill.status).toBe('voided');
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, cancellation.operationId));
      expect(operation.status).toBe('completed');
      const reservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, second.shipmentLineId));
      expect(reservations.filter((reservation) => reservation.status === 'confirmed')).toEqual([]);
      await expect(wiring.recovery.reconcile(run.sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('같은 SKU 가 두 로케이션에서 배정됐으면 바구니 보관도 로케이션별로 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      // 박스 수량 2 를 한 로케이션이 다 못 채우게(각 1) 두면 배정 규칙(E8)이 두 로케이션으로 나눈다.
      const first = await seedPickableShipment(tx, 2);
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 1 })
        .where(and(eq(wmsTables.stockLedgers.skuId, first.skuId), eq(wmsTables.stockLedgers.locationId, first.locationId)));
      const [other] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: first.warehouseId, code: `Z-${randomUUID().slice(0, 6)}`, locationType: 'zone' })
        .returning();
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: first.skuId,
        warehouseId: first.warehouseId,
        locationId: other.id,
        stockState: 'ON_HAND',
        qty: 1,
      });
      const wiring = assembleOutbound(tx);
      const run = await wiring.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      expect(allocations.map((allocation) => allocation.qty)).toEqual([1, 1]);
      for (const allocation of allocations) {
        await wiring.sessions.moveCustody(
          {
            sessionId: run.sessionId,
            idempotencyKey: `m-${randomUUID()}`,
            actorId: first.actorId,
            quantity: allocation.qty,
            from: { skuId: first.skuId, sourceLocationId: allocation.sourceLocationId, custodyType: 'AT_SOURCE' },
            to: {
              skuId: first.skuId,
              sourceLocationId: allocation.sourceLocationId,
              custodyType: 'WORKER',
              custodyRef: first.actorId,
              shipmentLineId: first.shipmentLineId,
            },
          },
          tx,
        );
      }
      await wiring.batches.excludeShipment(first.batchId, first.shipmentId, { reason: 'x' }, `x-${randomUUID()}`, actor, tx);
      const bin = await seedReturnBin(tx, first.warehouseId, first.actorId);
      await remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode, quantity: 2 }, tx);
      const found = await wiring.returnBins.lookup(bin.barcode, first.warehouseId, tx);
      expect(found.items.map((item) => [item.sourceLocationId, item.qty]).sort()).toEqual(
        allocations.map((allocation) => [allocation.sourceLocationId, 1]).sort(),
      );
      await expect(wiring.recovery.reconcile(run.sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });
});
```

(`seedPickableShipment` 는 `./__support__/logistics-fixtures` 에서 import 한다.)

`controllers/return-bin.controller.spec.ts` 에 위임 케이스:

```ts
  it('박스에서 빼기는 멱등 키와 함께 되돌림 서비스로 위임한다', async () => {
    const returns = { removeToReturnBin: jest.fn().mockResolvedValue({ exited: false }) };
    const controller = new ReturnBinController(returnBins as never, returns as never);
    await controller.removeFromBox('s-1', { barcode: '880', returnBinBarcode: 'RB-1', quantity: 1 }, 'key-1', {
      userId: 'u-1',
      roles: [],
    });
    expect(returns.removeToReturnBin).toHaveBeenCalledWith(
      's-1',
      { barcode: '880', returnBinBarcode: 'RB-1', quantity: 1 },
      { id: 'u-1', roles: [] },
      'key-1',
    );
  });
```

(기존 케이스의 `new ReturnBinController(returnBins as never)` 도 둘째 인자 `{} as never` 를 받게 고친다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- return-bin-removal`
Expected: FAIL — `removeToReturnBin is not a function`

- [ ] **Step 3: 배정 실행부** — `box-allocation.manager.ts` 에 더한다:

```ts
  /**
   * 빼는 박스에서 상품 하나(또는 몇 개)를 되돌림 바구니로(스펙 §8, 세 방식 공통). 호출자가 구성요소·작업 항목·세션을 잠갔다.
   * 배정 행을 로케이션 코드 역순(채운 순서의 반대, PR 2 반납과 같다)으로, 각 행 안에서는 박스 보관 종류 순서
   * (`BOX_CUSTODY_TYPES`)로 뺀다. 모자라면 쓰기 전에 거절한다. PACKED 에서 빼면 검수 수량도 같이 준다(정한 것 6).
   */
  async removeFromBox(
    input: {
      session: BatchInventorySessionRow;
      workItemId: string;
      skuId: string;
      quantity: number;
      returnBin: ReturnBinRef;
      actorId: string;
      operationId: string;
    },
    trx: DbTx,
  ): Promise<number> {
    const allocations = await trx
      .select({
        allocationId: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.pickingSourceAllocations.sourceLocationId))
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.workItemId, input.workItemId),
          eq(wmsTables.shipmentLines.skuId, input.skuId),
          gt(wmsTables.pickingSourceAllocations.qty, 0),
        ),
      )
      .orderBy(desc(wmsTables.locations.code), desc(wmsTables.pickingSourceAllocations.id));
    // 보관 행은 lockOpenSession 이 잠갔다.
    const custody = await trx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, input.session.id),
          eq(wmsTables.batchInventorySessionBalances.skuId, input.skuId),
          inArray(wmsTables.batchInventorySessionBalances.custodyType, [...BOX_CUSTODY_TYPES]),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      )
      .orderBy(asc(wmsTables.batchInventorySessionBalances.id));
    const takes: Array<{ allocation: (typeof allocations)[number]; balance: (typeof custody)[number]; qty: number }> = [];
    const taken = new Map<string, number>();
    let remaining = input.quantity;
    for (const allocation of allocations) {
      let room = allocation.qty;
      for (const type of BOX_CUSTODY_TYPES) {
        for (const balance of custody) {
          if (remaining === 0 || room === 0) break;
          if (
            balance.custodyType !== type ||
            balance.shipmentLineId !== allocation.shipmentLineId ||
            balance.sourceLocationId !== allocation.sourceLocationId
          ) {
            continue;
          }
          const qty = Math.min(remaining, room, balance.qty - (taken.get(balance.id) ?? 0));
          if (qty <= 0) continue;
          takes.push({ allocation, balance, qty });
          taken.set(balance.id, (taken.get(balance.id) ?? 0) + qty);
          remaining -= qty;
          room -= qty;
        }
      }
    }
    if (remaining > 0) {
      throw new ConflictException({
        code: 'REMOVAL_NOT_PENDING',
        message: `Only ${input.quantity - remaining} of SKU ${input.skuId} can be removed from work item ${input.workItemId}`,
      });
    }
    for (const take of takes) {
      await this.sessions.removeToReturnBin(
        {
          sessionId: input.session.id,
          operationId: input.operationId,
          actorId: input.actorId,
          workItemId: input.workItemId,
          allocationId: take.allocation.allocationId,
          shipmentLineId: take.allocation.shipmentLineId,
          skuId: input.skuId,
          sourceLocationId: take.allocation.sourceLocationId,
          quantity: take.qty,
          from: {
            custodyType: take.balance.custodyType,
            custodyRef: take.balance.custodyRef,
            shipmentLineId: take.balance.shipmentLineId,
          },
          returnBin: input.returnBin,
        },
        trx,
      );
      await this.decrementAllocation(take.allocation.allocationId, take.qty, trx);
      if (take.balance.custodyType === 'PACKED') {
        const [line] = await trx
          .update(wmsTables.shipmentLines)
          .set({
            inspectedQty: sql`${wmsTables.shipmentLines.inspectedQty} - ${take.qty}`,
            lineVersion: sql`${wmsTables.shipmentLines.lineVersion} + 1`,
          })
          .where(
            and(
              eq(wmsTables.shipmentLines.id, take.allocation.shipmentLineId),
              gte(wmsTables.shipmentLines.inspectedQty, take.qty),
            ),
          )
          .returning({ id: wmsTables.shipmentLines.id });
        if (!line) {
          throw new ConflictException({
            code: 'SHIPMENT_LINE_INSPECTION_STALE',
            message: `Line ${take.allocation.shipmentLineId} inspected quantity is below the packed custody`,
          });
        }
      }
    }
    return input.quantity;
  }
```

import 에 `desc`·`BOX_CUSTODY_TYPES`·`ReturnBinRef` 를 더한다.

- [ ] **Step 4: 명령** — `services/box-return.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, eq, notInArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { ReturnBinRemovalResponseDto } from '../dto/return-bin.dto';
import { BoxAllocationManager } from './box-allocation.manager';
import { BoxWithdrawalService, WorkItemRow } from './box-withdrawal.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { ReturnBinService } from './return-bin.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { resolveSkuIdByBarcode } from './sku-barcode-resolution';
import { loadWithdrawalRemovals } from './withdrawal-removals.query';

const WI = wmsTables.outboundBatchWorkItems;

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * 빼는 박스를 비우는 명령들(스펙 §8, 정한 것 1) — 박스에서 되돌림 바구니로. 토탈피킹 카트 여분(전략)도 나가기 정리를 여기 맡긴다.
 * 계획·오케스트레이터를 주입받는 쪽이 여기다(이탈 서비스는 그 둘을 모른다 — 순환 회피). 그래서 «canceled 로 나가면 취소 완료»,
 * «draft 로 나가면 대기 오퍼레이션 재개» 가 한 곳에 있다.
 */
@Injectable()
export class BoxReturnService {
  constructor(
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly withdrawals: BoxWithdrawalService,
    private readonly boxes: BoxAllocationManager,
    private readonly returnBins: ReturnBinService,
    private readonly barcodes: BarcodeService,
    private readonly planning: ShipmentPlanningService,
    private readonly batches: OutboundBatchOrchestrator,
  ) {}

  /** 잠금: 구성요소 → 작업 항목 → 세션 → 보관. 마지막 몫이면 같은 트랜잭션에서 나가고, canceled 면 취소까지 끝낸다. */
  async removeToReturnBin(
    shipmentId: string,
    input: { barcode: string; returnBinBarcode: string; quantity: number },
    actor: { id: string; roles: string[] },
    idempotencyKey: string,
    tx?: DbTx,
  ): Promise<ReturnBinRemovalResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.return_bin.remove');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    const barcode = input.barcode.trim();
    if (!barcode) throw new BadRequestException('barcode is required');
    const response = await this.commands.execute<ReturnBinRemovalResponseDto>(
      {
        commandType: 'shipment.return_bin.remove',
        idempotencyKey,
        canonicalRequest: {
          shipmentId,
          barcode,
          returnBinBarcode: input.returnBinBarcode.trim(),
          quantity: input.quantity,
          actorId: actor.id,
        },
      },
      async (trx, commandRequestId) => {
        await this.withdrawals.lockComponentsOf([shipmentId], trx);
        const [workItem] = await trx
          .select()
          .from(WI)
          .where(and(eq(WI.shipmentId, shipmentId), notInArray(WI.status, ['completed', 'excluded'])))
          .limit(1)
          .for('update');
        if (!workItem || workItem.status !== 'withdrawing') {
          throw conflict('SHIPMENT_NOT_WITHDRAWING', `Shipment ${shipmentId} is not leaving a batch`);
        }
        const [batch] = await trx
          .select({ warehouseId: wmsTables.outboundBatches.warehouseId })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, workItem.batchId))
          .limit(1);
        if (!batch) throw new Error(`Outbound batch ${workItem.batchId} referenced by a work item is missing`);
        const returnBin = await this.returnBins.requireActive(input.returnBinBarcode, batch.warehouseId, trx);
        const skuId = await resolveSkuIdByBarcode(this.barcodes, barcode, trx);
        if (!skuId) throw conflict('SIMPLE_OUTBOUND_BARCODE_UNKNOWN', 'Barcode does not resolve to a SKU');
        const session = await this.boxes.lockOpenSession(workItem.batchId, trx);
        if (!session || session.status !== 'active') {
          throw conflict(
            'PICKING_SESSION_NOT_ACTIVE',
            `Batch ${workItem.batchId} inventory session is ${session?.status ?? 'not open'}`,
          );
        }
        const removedQty = await this.boxes.removeFromBox(
          {
            session,
            workItemId: workItem.id,
            skuId,
            quantity: input.quantity,
            returnBin,
            actorId: actor.id,
            operationId: commandRequestId,
          },
          trx,
        );
        const exit = await this.withdrawals.exitIfDrained(workItem, { actorId: actor.id, operationId: commandRequestId }, trx);
        if (exit.exited) await this.settleExit(exit.workItem, trx);
        return {
          response: {
            shipmentId,
            workItemId: workItem.id,
            removedQty,
            exited: exit.exited,
            exitTo: exit.workItem.exitTo,
            waitingOperationId: exit.workItem.waitingOperationId,
            removals: exit.exited ? [] : await loadWithdrawalRemovals(trx, workItem.id),
          },
          resourceType: 'outbound_batch_work_item',
          resourceId: workItem.id,
        };
      },
      tx,
    );
    if (response.exited) await this.resumeAfterDraftExit([response], tx);
    return response;
  }

  /** 나간 박스의 정리 중 트랜잭션 안의 몫 — canceled 면 기다리던 전체 취소를 완료한다(정한 것 4). */
  async settleExit(workItem: WorkItemRow, trx: DbTx): Promise<void> {
    if (workItem.exitTo !== 'canceled') return;
    if (!workItem.waitingOperationId) {
      throw new Error(`Canceled exit of work item ${workItem.id} has no cancellation operation`);
    }
    await this.planning.finishWithdrawnCancellation(workItem.waitingOperationId, trx);
  }

  /** 커밋 뒤의 몫 — draft 로 나간 박스가 기다리던 오퍼레이션(합포장·옛 부분 취소)을 잇는다(PR 2 빼기와 같다). */
  async resumeAfterDraftExit(
    exits: Array<{ shipmentId: string; exitTo: string | null; waitingOperationId: string | null }>,
    tx?: DbTx,
  ): Promise<void> {
    for (const exit of exits) {
      if (exit.exitTo === 'draft' && exit.waitingOperationId) {
        await this.batches.resumeWaitingOperation(exit.waitingOperationId, exit.shipmentId, tx);
      }
    }
  }
}
```

- [ ] **Step 5: DTO·컨트롤러**

`dto/return-bin.dto.ts` 에 더한다:

```ts
export class ReturnBinRemovalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  barcode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  returnBinBarcode: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class WithdrawalRemovalDto {
  @ApiProperty() shipmentLineId: string;
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty() sourceLocationId: string;
  @ApiProperty() locationCode: string;
  @ApiProperty({ description: '박스에 든 몫 — 송장 스캔 화면에서 상품을 스캔해 바구니로' }) boxQty: number;
  @ApiProperty({ description: '토탈피킹 카트에 실린 몫 — 분류대에서 여분을 바구니로' }) cartQty: number;
}

export class ReturnBinRemovalResponseDto {
  @ApiProperty() shipmentId: string;
  @ApiProperty() workItemId: string;
  @ApiProperty() removedQty: number;
  @ApiProperty({ description: '마지막 몫이라 이 스캔으로 배치에서 나갔다' }) exited: boolean;
  @ApiProperty({ enum: ['draft', 'canceled'], nullable: true }) exitTo: 'draft' | 'canceled' | null;
  @ApiProperty({ type: String, nullable: true }) waitingOperationId: string | null;
  @ApiProperty({ type: [WithdrawalRemovalDto] }) removals: WithdrawalRemovalDto[];
}
```

`controllers/return-bin.controller.ts` — 생성자에 `private readonly returns: BoxReturnService` 를 더하고:

```ts
  @Post('shipments/:shipmentId/return-bin-removals')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ReturnBinRemovalResponseDto })
  removeFromBox(
    @Param('shipmentId', new ParseUUIDPipe()) shipmentId: string,
    @Body() dto: ReturnBinRemovalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<ReturnBinRemovalResponseDto> {
    if (!idempotencyKey?.trim()) throw new BadRequestException('Idempotency-Key is required');
    return this.returns.removeToReturnBin(shipmentId, dto, this.actor(user), idempotencyKey);
  }
```

(위임 테스트는 `ParseUUIDPipe` 를 거치지 않으므로 `'s-1'` 로 부른다.)

배선:
- `fulfillment.module.ts` providers 에 `BoxReturnService`.
- `simple-outbound-wiring.ts`: `planning` 다음에 `const returns = new BoxReturnService(commands, workflowGate, withdrawals, boxes, returnBins, barcodes, planning, batches);`, 반환 객체에 `returns`.

- [ ] **Step 6: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- return-bin-removal`
Expected: PASS 6
Run: `npx jest apps/core/src/modules/fulfillment/controllers/return-bin.controller.spec.ts` → PASS
Run: `npm run type-check` → 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 빼는 박스의 상품을 스캔해 되돌림 바구니로 — 마지막 몫에서 배치를 나간다 (#989)"
```

---

---

### Task 10: 토탈피킹 카트 여분을 되돌림 바구니로 — `POST picking/v2/aggregate-then-sort/cart-surplus-returns`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/box-allocation.manager.ts` (`removeCartShare`)
- Modify: `apps/core/src/modules/fulfillment/picking/picking-strategy.interface.ts` (`AggregateCartSurplusReturnInput`·`Result`, `AggregateThenSortStrategy.returnCartSurplus`)
- Modify: `apps/core/src/modules/fulfillment/picking/aggregate-then-sort.strategy.ts` (생성자, `returnCartSurplus`)
- Modify: `apps/core/src/modules/fulfillment/services/picking-process.service.ts` (`aggregateCartSurplusReturn`)
- Modify: `apps/core/src/modules/fulfillment/controllers/picking-v2.controller.ts`, `dto/picking-v2.dto.ts`
- Modify: `new AggregateThenSortPickingStrategy(` 를 부르는 스펙 둘, `services/__support__/simple-outbound-wiring.ts`(`aggregate` 반환)
- Test: `apps/core/src/modules/fulfillment/picking/aggregate-cart-surplus.integration.spec.ts`

**Interfaces:**
- Consumes: `removeToReturnBin`(Task 2, from `BULK_CART`), `ReturnBinService.requireActive`(Task 5), `BoxWithdrawalService.lockComponentsOf`·`exitIfDrained`(Task 6), `BoxReturnService.settleExit`·`resumeAfterDraftExit`(Task 9).
- Produces:
  - `BoxAllocationManager.removeCartShare(input: { session: BatchInventorySessionRow; workItemIds: string[]; cartRef: string; skuId: string; sourceLocationId: string; quantity: number; returnBin: ReturnBinRef; actorId: string; operationId: string }, trx: DbTx): Promise<Array<{ workItemId: string; qty: number }>>` — 받을 수 있는 양 = `min(이 카트의 BULK_CART, 빼는 박스들의 미귀속 배정)`, 넘으면 쓰기 전에 `CART_SURPLUS_NOT_PENDING`. 배정은 작업 항목 id 순으로 준다.
  - `interface AggregateCartSurplusReturnInput { batchId; sessionId; cartId; skuId; sourceLocationId; quantity: number; returnBinBarcode: string; actor: PickingActor; idempotencyKey: string }`
  - `interface AggregateCartSurplusReturnResult { operationId; sessionId; cartRef; skuId; sourceLocationId; quantity: number; exited: Array<{ workItemId: string; shipmentId: string; exitTo: string | null; waitingOperationId: string | null }> }`
  - `AggregateThenSortPickingStrategy` 생성자 끝에 `boxes: BoxAllocationManager, withdrawals: BoxWithdrawalService, returnBins: ReturnBinService, returns: BoxReturnService`
  - 잠금: 카트 advisory 잠금 → 영향받는 박스들의 구성요소(세션·보관 포함) → 작업 항목(id 순) → 세션 → 보관

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `picking/aggregate-cart-surplus.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { startBatchPicking } from './allocation/batch-start';
import { inRollbackTx, makeDb } from '../services/__support__';
import { assertFulfillmentInvariantsFor } from '../services/__support__/logistics-assertions';
import { seedReturnBin, seedTwoBoxBatch } from '../services/__support__/simple-outbound-fixtures';
import { assembleOutbound } from '../services/__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('토탈피킹 카트 여분 되돌림 (스펙 §8, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스 둘(첫 2 + 둘째 1)을 전부 카트에 싣고 첫 박스를 뺀다 — 첫 박스 몫 2 가 카트 여분이다. */
  async function cartLoaded(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    await tx
      .update(wmsTables.outboundBatches)
      .set({ pickingMethod: 'total_picking' })
      .where(eq(wmsTables.outboundBatches.id, first.batchId));
    const wiring = assembleOutbound(tx);
    const run = await startBatchPicking(
      wiring.startDeps,
      'aggregate_then_sort',
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.aggregate.bulkCartScan(
      {
        strategy: 'aggregate_then_sort',
        stage: 'bulk_collect',
        batchId: first.batchId,
        sessionId: run.sessionId,
        skuId: first.skuId,
        sourceLocationId: first.locationId,
        quantity: 3,
        cartId: 'CART-1',
        actor,
        idempotencyKey: `b-${randomUUID()}`,
      },
      tx,
    );
    const out = await wiring.batches.excludeShipment(
      first.batchId,
      first.shipmentId,
      { reason: '고객 요청' },
      `x-${randomUUID()}`,
      actor,
      tx,
    );
    expect(out.workItem.status).toBe('withdrawing');
    const bin = await seedReturnBin(tx, first.warehouseId, first.actorId);
    return { first, second, wiring, sessionId: run.sessionId, bin };
  }

  const returnSurplus = (
    wiring: ReturnType<typeof assembleOutbound>,
    input: { batchId: string; sessionId: string; skuId: string; sourceLocationId: string; quantity: number; returnBinBarcode: string },
    tx: DbTx,
  ) =>
    wiring.aggregate.returnCartSurplus(
      { ...input, cartId: 'CART-1', actor, idempotencyKey: `cs-${randomUUID()}` },
      tx,
    );

  it('빼는 박스 몫만큼만 받는다 — 넘으면 CART_SURPLUS_NOT_PENDING', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, sessionId, bin } = await cartLoaded(tx);
      await expect(
        tx.transaction((trx) =>
          returnSurplus(
            wiring,
            {
              batchId: first.batchId,
              sessionId,
              skuId: first.skuId,
              sourceLocationId: first.locationId,
              quantity: 3,
              returnBinBarcode: bin.barcode,
            },
            trx,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'CART_SURPLUS_NOT_PENDING' } });
    });
  });

  it('여분 2 를 바구니에 넣으면 그 박스가 나가고, 카트에는 남는 박스 몫 1 만 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId, bin } = await cartLoaded(tx);
      const result = await returnSurplus(
        wiring,
        {
          batchId: first.batchId,
          sessionId,
          skuId: first.skuId,
          sourceLocationId: first.locationId,
          quantity: 2,
          returnBinBarcode: bin.barcode,
        },
        tx,
      );

      expect(result.exited).toEqual([expect.objectContaining({ workItemId: first.workItemId, exitTo: 'draft' })]);
      const balances = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionBalances.skuId, first.skuId),
          ),
        );
      expect(balances.filter((b) => b.custodyType === 'BULK_CART').reduce((t, b) => t + b.qty, 0)).toBe(1);
      expect(balances.find((b) => b.custodyType === 'RETURN_PENDING')).toMatchObject({ qty: 2, custodyRef: bin.barcode });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- aggregate-cart-surplus`
Expected: FAIL — `wiring.aggregate` 가 없다

- [ ] **Step 3: 배정 실행부** — `box-allocation.manager.ts`:

```ts
  /**
   * 토탈피킹 카트 여분을 되돌림 바구니로(정한 것 2). 카트의 물건은 누구 몫인지 모른다 — 빼는 박스들의 «미귀속 배정»
   * (배정 − 그 줄·로케이션의 박스 보관)이 카트에서 내릴 수 있는 양이다. 호출자가 구성요소·카트·작업 항목·세션을 잠갔다.
   * 내린 뒤에도 AT_SOURCE + BULK_CART = Σ 미귀속 배정 이라 남는 박스의 분류는 그대로 채워진다.
   */
  async removeCartShare(
    input: {
      session: BatchInventorySessionRow;
      workItemIds: string[];
      cartRef: string;
      skuId: string;
      sourceLocationId: string;
      quantity: number;
      returnBin: ReturnBinRef;
      actorId: string;
      operationId: string;
    },
    trx: DbTx,
  ): Promise<Array<{ workItemId: string; qty: number }>> {
    if (!input.workItemIds.length) {
      throw new ConflictException({ code: 'CART_SURPLUS_NOT_PENDING', message: 'No leaving box holds this SKU on a cart' });
    }
    const allocations = await trx
      .select({
        allocationId: wmsTables.pickingSourceAllocations.id,
        workItemId: wmsTables.pickingSourceAllocations.workItemId,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          inArray(wmsTables.pickingSourceAllocations.workItemId, input.workItemIds),
          eq(wmsTables.shipmentLines.skuId, input.skuId),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId),
          gt(wmsTables.pickingSourceAllocations.qty, 0),
        ),
      )
      .orderBy(asc(wmsTables.pickingSourceAllocations.workItemId), asc(wmsTables.pickingSourceAllocations.id));
    // 보관 행은 lockOpenSession 이 잠갔다.
    const balances = await trx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, input.session.id),
          eq(wmsTables.batchInventorySessionBalances.skuId, input.skuId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, input.sourceLocationId),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      );
    const cartQty = balances
      .filter((b) => b.custodyType === 'BULK_CART' && b.custodyRef === input.cartRef && b.shipmentLineId === null)
      .reduce((total, b) => total + b.qty, 0);
    const inBox = new Map<string, number>();
    for (const b of balances) {
      if (b.shipmentLineId && (BOX_CUSTODY_TYPES as readonly string[]).includes(b.custodyType)) {
        inBox.set(b.shipmentLineId, (inBox.get(b.shipmentLineId) ?? 0) + b.qty);
      }
    }
    // 빼는 작업 항목마다 (줄, 로케이션) 배정 행은 하나다(uq_picking_source_allocations_work_item_grain).
    const shares = allocations
      .map((a) => ({ ...a, unpicked: a.qty - Math.min(a.qty, inBox.get(a.shipmentLineId) ?? 0) }))
      .filter((a) => a.unpicked > 0);
    const available = Math.min(
      cartQty,
      shares.reduce((total, a) => total + a.unpicked, 0),
    );
    if (input.quantity > available) {
      throw new ConflictException({
        code: 'CART_SURPLUS_NOT_PENDING',
        message: `Cart ${input.cartRef} can return at most ${available} of SKU ${input.skuId} for leaving boxes`,
      });
    }
    const moved = new Map<string, number>();
    let remaining = input.quantity;
    for (const share of shares) {
      if (remaining === 0) break;
      const qty = Math.min(remaining, share.unpicked);
      // 배정 행의 workItemId 는 inArray(workItemIds) 로 골랐으니 null 이 아니다.
      const workItemId = share.workItemId!;
      await this.sessions.removeToReturnBin(
        {
          sessionId: input.session.id,
          operationId: input.operationId,
          actorId: input.actorId,
          workItemId,
          allocationId: share.allocationId,
          shipmentLineId: share.shipmentLineId,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: qty,
          from: { custodyType: 'BULK_CART', custodyRef: input.cartRef, shipmentLineId: null },
          returnBin: input.returnBin,
        },
        trx,
      );
      await this.decrementAllocation(share.allocationId, qty, trx);
      moved.set(workItemId, (moved.get(workItemId) ?? 0) + qty);
      remaining -= qty;
    }
    return [...moved].map(([workItemId, qty]) => ({ workItemId, qty }));
  }
```

- [ ] **Step 4: 전략 메서드** — `picking-strategy.interface.ts` 에 입력·결과 타입을 더하고 `AggregateThenSortStrategy` 에 `returnCartSurplus(input: AggregateCartSurplusReturnInput, tx?: DbTx): Promise<AggregateCartSurplusReturnResult>;`.

`aggregate-then-sort.strategy.ts` — 생성자 끝에 `private readonly boxes: BoxAllocationManager, private readonly withdrawals: BoxWithdrawalService, private readonly returnBins: ReturnBinService, private readonly returns: BoxReturnService,` 를 더하고:

```ts
  /**
   * 분류대에서 남는 상품 → 되돌림 바구니(S1 §5.4 D11, 스펙 §8 정한 것 1·2). 카트 규칙(잠금·ref·소유)이 이 전략에 있어
   * 되돌림 스캔 지점 중 카트 쪽은 여기다. 여분을 다 내린 박스는 같은 트랜잭션에서 나간다.
   */
  async returnCartSurplus(
    input: AggregateCartSurplusReturnInput,
    tx?: DbTx,
  ): Promise<AggregateCartSurplusReturnResult> {
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.cart_surplus_return');
    assertPositiveQuantity(input.quantity);
    const cartId = this.requiredCartId(input.cartId);
    const cartRef = this.bulkCartRef(input.batchId, cartId, input.actor.id);
    const response = await this.commands.execute<AggregateCartSurplusReturnResult>(
      {
        commandType: 'picking.aggregate_then_sort.cart_surplus_return',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          batchId: input.batchId,
          sessionId: input.sessionId,
          cartId,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: input.quantity,
          returnBinBarcode: input.returnBinBarcode.trim(),
          actorId: input.actor.id,
        },
      },
      async (trx, commandRequestId) => {
        // 영향받는 박스 — 잠그지 않은 읽기로 고르고, 잠근 뒤 다시 거른다(작업 항목 FOR UPDATE 의 status 조건).
        const candidates = await trx
          .selectDistinct({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
          .from(wmsTables.pickingSourceAllocations)
          .innerJoin(
            wmsTables.outboundBatchWorkItems,
            eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
          )
          .innerJoin(
            wmsTables.shipmentLines,
            eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
          )
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.batchId, input.batchId),
              eq(wmsTables.outboundBatchWorkItems.status, 'withdrawing'),
              eq(wmsTables.shipmentLines.skuId, input.skuId),
              eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId),
              gt(wmsTables.pickingSourceAllocations.qty, 0),
            ),
          );
        const shipmentIds = candidates.map((row) => row.shipmentId).sort();
        await this.withdrawals.lockComponentsOf(shipmentIds, trx);
        await this.acquireCartLock(cartId, trx);
        const workItems = shipmentIds.length
          ? await trx
              .select()
              .from(wmsTables.outboundBatchWorkItems)
              .where(
                and(
                  eq(wmsTables.outboundBatchWorkItems.batchId, input.batchId),
                  eq(wmsTables.outboundBatchWorkItems.status, 'withdrawing'),
                  inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds),
                ),
              )
              .orderBy(asc(wmsTables.outboundBatchWorkItems.id))
              .for('update')
          : [];
        await assertActiveBatchSession(trx, input.sessionId, input.batchId, this.capabilities.name);
        await this.assertCartOwnedBy(input.sessionId, input.batchId, cartId, input.actor.id, trx, true);
        const [batch] = await trx
          .select({ warehouseId: wmsTables.outboundBatches.warehouseId })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, input.batchId))
          .limit(1);
        if (!batch) throw new Error(`Outbound batch ${input.batchId} not found under an active session`);
        const returnBin = await this.returnBins.requireActive(input.returnBinBarcode, batch.warehouseId, trx);
        const session = await this.boxes.lockOpenSession(input.batchId, trx);
        if (!session || session.id !== input.sessionId || session.status !== 'active') {
          throw conflict('PICKING_SESSION_NOT_ACTIVE', `Batch ${input.batchId} inventory session is not active`);
        }
        const moved = await this.boxes.removeCartShare(
          {
            session,
            workItemIds: workItems.map((item) => item.id),
            cartRef,
            skuId: input.skuId,
            sourceLocationId: input.sourceLocationId,
            quantity: input.quantity,
            returnBin,
            actorId: input.actor.id,
            operationId: commandRequestId,
          },
          trx,
        );
        const exited: AggregateCartSurplusReturnResult['exited'] = [];
        for (const item of workItems.filter((candidate) => moved.some((m) => m.workItemId === candidate.id))) {
          const exit = await this.withdrawals.exitIfDrained(item, { actorId: input.actor.id, operationId: commandRequestId }, trx);
          if (!exit.exited) continue;
          await this.returns.settleExit(exit.workItem, trx);
          exited.push({
            workItemId: item.id,
            shipmentId: item.shipmentId,
            exitTo: exit.workItem.exitTo,
            waitingOperationId: exit.workItem.waitingOperationId,
          });
        }
        const response: AggregateCartSurplusReturnResult = {
          operationId: commandRequestId,
          sessionId: input.sessionId,
          cartRef,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: input.quantity,
          exited,
        };
        return { response, resourceType: 'batch_inventory_session', resourceId: input.sessionId };
      },
      tx,
    );
    await this.returns.resumeAfterDraftExit(response.exited, tx);
    return response;
  }
```

`picking-process.service.ts`:

```ts
  async aggregateCartSurplusReturn(
    input: AggregateCartSurplusReturnInput,
    tx?: DbTx,
  ): Promise<AggregateCartSurplusReturnResult> {
    return this.withAggregateThenSortStrategy(input.batchId, (strategy, trx) => strategy.returnCartSurplus(input, trx), tx);
  }
```

`dto/picking-v2.dto.ts`:

```ts
export class AggregateCartSurplusReturnDto {
  @IsUUID()
  batchId: string;

  @IsUUID()
  sessionId: string;

  @IsString()
  @Matches(PHYSICAL_CART_ID)
  cartId: string;

  @IsUUID()
  skuId: string;

  @IsUUID()
  sourceLocationId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  returnBinBarcode: string;
}
```

`controllers/picking-v2.controller.ts` 의 `PickingV2Controller` 에(다른 라우트와 같은 모양):

```ts
  @Post('cart-surplus-returns')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Cart surplus of leaving boxes moved into a return bin' })
  cartSurplusReturn(
    @Body() dto: AggregateCartSurplusReturnDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.aggregateCartSurplusReturn({
      ...dto,
      actor: this.actor(user),
      idempotencyKey: idempotencyKey ?? '',
    });
  }
```

- [ ] **Step 5: 배선한다**
  - `simple-outbound-wiring.ts`: `returns` 다음에 `const aggregate = new AggregateThenSortPickingStrategy(commands, workflowGate, sessions, batches, labelGuard, boxes, withdrawals, returnBins, returns);` 를 두고 반환 객체에 `aggregate` 를 더한다(`labelGuard` 가 위에서 정의돼 있어야 한다 — 없으면 순서를 옮긴다).
  - `new AggregateThenSortPickingStrategy(` 를 부르는 스펙 둘(`grep -rln "new AggregateThenSortPickingStrategy(" apps/core/src`): 끝에 인자 넷. 그 스펙이 카트 여분을 쓰지 않으면 `{} as never` 넷으로 둔다.
- [ ] **Step 6: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- aggregate-cart-surplus outbound-v2-warehouse outbound-v2-recovery`
Expected: 새 스펙 PASS 2, 나머지 그대로
Run: `npm run type-check` → 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 토탈피킹 카트 여분을 되돌림 바구니로 — 빼는 박스 몫만큼만 받고 다 내린 박스는 나간다 (#989)"
```

---

### Task 11: 되돌림 적치 — `POST return-bins/:barcode/putaways`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/return-bin.service.ts` (`putaway`)
- Modify: `apps/core/src/modules/fulfillment/dto/return-bin.dto.ts` (`ReturnBinPutawayDto`, `ReturnBinPutawayResponseDto`)
- Modify: `apps/core/src/modules/fulfillment/controllers/return-bin.controller.ts`
- Test: `apps/core/src/modules/fulfillment/services/return-bin-putaway.integration.spec.ts`, `controllers/return-bin.controller.spec.ts`

**Interfaces:**
- Consumes: `BatchInventorySessionService.putawayReturn`(Task 2), `ReturnBinService.requireActive`·`contentsOf`(Task 5), `resolveSkuIdByBarcode`.
- Produces:
  - `ReturnBinService.putaway(returnBinBarcode: string, input: { warehouseId: string; barcode: string; locationCode: string; quantity: number }, actor: { id: string }, idempotencyKey: string, tx?: DbTx): Promise<ReturnBinPutawayResponseDto>`
  - `ReturnBinPutawayResponseDto { returnBin: ReturnBinDto; putAwayQty: number; items: ReturnBinItemDto[] }` — `items` 는 적치 뒤 바구니에 남은 물건
  - 거절: `RETURN_BIN_UNKNOWN`·`RETURN_BIN_WAREHOUSE_MISMATCH`(바구니), `SIMPLE_OUTBOUND_BARCODE_UNKNOWN`(바코드), `RETURN_BIN_ITEM_NOT_FOUND`, `RETURN_LOCATION_MISMATCH`(`errors: Array<{ locationCode: string; qty: number }>`), `RETURN_BIN_ITEM_SHORT`, `PICKING_SESSION_NOT_ACTIVE`
  - 잠금: 세션(id 순) → 보관. 작업 항목·구성요소는 잡지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `return-bin-putaway.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { PickableShipmentFixture, seedPickableShipment } from './__support__/logistics-fixtures';
import { seedBoxOverSameStock, seedReturnBin } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('되돌림 적치 (스펙 §8, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스 하나뿐인 배치를 시작하고, 전부 집고, 빼고, 바구니에 넣는다 — 배치는 파생 canceled, 세션은 바구니 때문에 active. */
  async function intoBin(tx: DbTx, wiring: ReturnType<typeof assembleOutbound>, box: PickableShipmentFixture, bin: { barcode: string }) {
    const run = await wiring.picking.start(
      { batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: box.actorId,
        quantity: box.qty,
        from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: box.skuId,
          sourceLocationId: box.locationId,
          custodyType: 'WORKER',
          custodyRef: box.actorId,
          shipmentLineId: box.shipmentLineId,
        },
      },
      tx,
    );
    await wiring.batches.excludeShipment(box.batchId, box.shipmentId, { reason: 'x' }, `x-${randomUUID()}`, actor, tx);
    await wiring.returns.removeToReturnBin(
      box.shipmentId,
      { barcode: box.barcode, returnBinBarcode: bin.barcode, quantity: box.qty },
      actor,
      `r-${randomUUID()}`,
      tx,
    );
    return run.sessionId;
  }

  const sessionOf = async (tx: DbTx, id: string) =>
    (await tx.select().from(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.id, id)))[0];

  it('두 배치의 물건이 섞인 바구니 — 세션 id 순으로 빠지고, 비는 세션은 settled, 적치한 만큼 일반 가용이 는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const a = await seedPickableShipment(tx, 2);
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 10 })
        .where(and(eq(wmsTables.stockLedgers.skuId, a.skuId), eq(wmsTables.stockLedgers.locationId, a.locationId)));
      const b = await seedBoxOverSameStock(tx, a, 1); // 자기 배치에 든다
      const wiring = assembleOutbound(tx);
      const bin = await seedReturnBin(tx, a.warehouseId, a.actorId);
      const sessionA = await intoBin(tx, wiring, a, bin);
      const sessionB = await intoBin(tx, wiring, b, bin);
      // 빈 시작된 배치의 세션은 바구니 때문에 아직 active 다(스펙 §8 — 세션은 바구니까지 비어야 닫힌다).
      expect((await sessionOf(tx, sessionA)).status).toBe('active');
      const listed = await wiring.batches.listBatches({ warehouseId: a.warehouseId }, tx);
      expect(listed.find((batch) => batch.id === a.batchId)?.status).toBe('canceled');
      const guard = new BatchControlledStockGuard();
      const before = await guard.getAvailability(
        { skuId: a.skuId, warehouseId: a.warehouseId, sourceLocationId: a.locationId },
        tx,
      );

      const [location] = await tx.select().from(wmsTables.locations).where(eq(wmsTables.locations.id, a.locationId));
      const result = await wiring.returnBins.putaway(
        bin.barcode,
        { warehouseId: a.warehouseId, barcode: a.barcode, locationCode: location.code, quantity: 3 },
        { id: a.actorId },
        `p-${randomUUID()}`,
        tx,
      );

      expect(result).toMatchObject({ putAwayQty: 3, items: [] });
      expect((await sessionOf(tx, sessionA)).status).toBe('settled');
      expect((await sessionOf(tx, sessionB)).status).toBe('settled');
      expect((await sessionOf(tx, sessionA)).returnedQty).toBe(2);
      const after = await guard.getAvailability(
        { skuId: a.skuId, warehouseId: a.warehouseId, sourceLocationId: a.locationId },
        tx,
      );
      expect(after.generallyAvailableQty).toBe(before.generallyAvailableQty + 3);
      await expect(wiring.recovery.reconcile(sessionA, tx)).resolves.toMatchObject({ healthy: true });
      await expect(wiring.recovery.reconcile(sessionB, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('원래 로케이션이 아니면 RETURN_LOCATION_MISMATCH 와 원래 로케이션 목록, 바구니에 없으면 RETURN_BIN_ITEM_NOT_FOUND, 많으면 RETURN_BIN_ITEM_SHORT', async () => {
    await inRollbackTx(db, async (tx) => {
      const a = await seedPickableShipment(tx, 2);
      const wiring = assembleOutbound(tx);
      const bin = await seedReturnBin(tx, a.warehouseId, a.actorId);
      await intoBin(tx, wiring, a, bin);
      const [location] = await tx.select().from(wmsTables.locations).where(eq(wmsTables.locations.id, a.locationId));
      const put = (input: { barcode: string; locationCode: string; quantity: number }, trx: DbTx) =>
        wiring.returnBins.putaway(bin.barcode, { warehouseId: a.warehouseId, ...input }, { id: a.actorId }, `p-${randomUUID()}`, trx);

      await expect(
        tx.transaction((trx) => put({ barcode: a.barcode, locationCode: 'NOT-HERE', quantity: 1 }, trx)),
      ).rejects.toMatchObject({
        response: { code: 'RETURN_LOCATION_MISMATCH', errors: [{ locationCode: location.code, qty: 2 }] },
      });
      const other = await seedPickableShipment(tx, 1);
      await expect(
        tx.transaction((trx) => put({ barcode: other.barcode, locationCode: location.code, quantity: 1 }, trx)),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_ITEM_NOT_FOUND' } });
      await expect(
        tx.transaction((trx) => put({ barcode: a.barcode, locationCode: location.code, quantity: 3 }, trx)),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_ITEM_SHORT' } });
    });
  });
});
```

컨트롤러 스펙에 위임 케이스(`putaway('RB-1', { warehouseId, barcode, locationCode, quantity }, 'key', user)` → `returnBins.putaway('RB-1', {...}, { id, roles }, 'key')`).

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- return-bin-putaway`
Expected: FAIL — `putaway is not a function`

- [ ] **Step 3: 서비스** — `return-bin.service.ts` 에 더한다(import: `resolveSkuIdByBarcode`, `ReturnBinPutawayResponseDto`):

```ts
  /**
   * 되돌림 적치(정한 것 8). 원래 로케이션만 받는다(S1 D12) — 원장상 그 물건은 그 로케이션을 떠난 적이 없으니 원장은 건드리지 않고
   * 세션 통제만 푼다. 한 바구니에 여러 배치의 물건이 섞이므로 세션 id 순으로 뺀다(잠금도 그 순서 — 작업 항목은 잡지 않는다).
   */
  async putaway(
    returnBinBarcode: string,
    input: { warehouseId: string; barcode: string; locationCode: string; quantity: number },
    actor: { id: string },
    idempotencyKey: string,
    tx?: DbTx,
  ): Promise<ReturnBinPutawayResponseDto> {
    this.workflowGate.assertV2MutationAllowed('return_bin.putaway');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    const barcode = input.barcode.trim();
    const locationCode = input.locationCode.trim();
    if (!barcode || !locationCode) throw new BadRequestException('barcode and locationCode are required');
    return this.commands.execute<ReturnBinPutawayResponseDto>(
      {
        commandType: 'return_bin.putaway',
        idempotencyKey,
        canonicalRequest: {
          returnBinBarcode: returnBinBarcode.trim(),
          warehouseId: input.warehouseId,
          barcode,
          locationCode,
          quantity: input.quantity,
          actorId: actor.id,
        },
      },
      async (trx, commandRequestId) => {
        const bin = await this.requireActive(returnBinBarcode, input.warehouseId, trx);
        const skuId = await resolveSkuIdByBarcode(this.barcodes, barcode, trx);
        if (!skuId) {
          throw new ConflictException({ code: 'SIMPLE_OUTBOUND_BARCODE_UNKNOWN', message: 'Barcode does not resolve to a SKU' });
        }
        const pending = await trx
          .select({
            sessionId: B.sessionId,
            sessionStatus: wmsTables.batchInventorySessions.status,
            sourceLocationId: sql<string>`${B.sourceLocationId}`,
            locationCode: wmsTables.locations.code,
            qty: B.qty,
          })
          .from(B)
          .innerJoin(wmsTables.batchInventorySessions, eq(wmsTables.batchInventorySessions.id, B.sessionId))
          .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, B.sourceLocationId))
          .where(
            and(
              eq(B.custodyType, 'RETURN_PENDING'),
              eq(B.custodyRef, bin.barcode),
              eq(B.skuId, skuId),
              gt(B.qty, 0),
              inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
            ),
          )
          .orderBy(asc(B.sessionId), asc(B.id));
        if (!pending.length) {
          throw new ConflictException({ code: 'RETURN_BIN_ITEM_NOT_FOUND', message: `Return bin ${bin.barcode} holds no ${barcode}` });
        }
        const atLocation = pending.filter((row) => row.locationCode === locationCode);
        if (!atLocation.length) {
          const expected = new Map<string, number>();
          for (const row of pending) expected.set(row.locationCode, (expected.get(row.locationCode) ?? 0) + row.qty);
          throw new ConflictException({
            code: 'RETURN_LOCATION_MISMATCH',
            message: `${barcode} in return bin ${bin.barcode} belongs to ${[...expected.keys()].join(', ')}`,
            errors: [...expected].map(([code, qty]) => ({ locationCode: code, qty })),
          });
        }
        const available = atLocation.reduce((total, row) => total + row.qty, 0);
        if (input.quantity > available) {
          throw new ConflictException({
            code: 'RETURN_BIN_ITEM_SHORT',
            message: `Return bin ${bin.barcode} holds only ${available} of ${barcode} for ${locationCode}`,
          });
        }
        let remaining = input.quantity;
        for (const row of atLocation) {
          if (remaining === 0) break;
          if (row.sessionStatus !== 'active') {
            throw new ConflictException({
              code: 'PICKING_SESSION_NOT_ACTIVE',
              message: `Inventory session ${row.sessionId} is ${row.sessionStatus}`,
            });
          }
          const qty = Math.min(remaining, row.qty);
          await this.sessions.putawayReturn(
            {
              sessionId: row.sessionId,
              operationId: commandRequestId,
              actorId: actor.id,
              skuId,
              sourceLocationId: row.sourceLocationId,
              quantity: qty,
              returnBin: bin,
            },
            trx,
          );
          remaining -= qty;
        }
        await this.audit.logUserActionRequired(
          'return_bin.putaway',
          'fulfillment',
          `Put away ${input.quantity} of ${barcode} from return bin ${bin.barcode} to ${locationCode}`,
          { userId: actor.id },
          { commandRequestId, returnBinId: bin.id, skuId, locationCode, quantity: input.quantity },
          trx,
        );
        const response: ReturnBinPutawayResponseDto = {
          returnBin: { ...bin, warehouseId: input.warehouseId },
          putAwayQty: input.quantity,
          items: await this.contentsOf(bin, trx),
        };
        return { response, resourceType: 'return_bin', resourceId: bin.id };
      },
      tx,
    );
  }
```

`dto/return-bin.dto.ts`:

```ts
export class ReturnBinPutawayDto {
  @IsUUID()
  warehouseId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  barcode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  locationCode: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class ReturnBinPutawayResponseDto {
  @ApiProperty({ type: ReturnBinDto }) returnBin: ReturnBinDto;
  @ApiProperty() putAwayQty: number;
  @ApiProperty({ type: [ReturnBinItemDto], description: '적치 뒤 바구니에 남은 물건' }) items: ReturnBinItemDto[];
}
```

`controllers/return-bin.controller.ts`:

```ts
  @Post('return-bins/:barcode/putaways')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ReturnBinPutawayResponseDto })
  putaway(
    @Param('barcode') barcode: string,
    @Body() dto: ReturnBinPutawayDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<ReturnBinPutawayResponseDto> {
    if (!idempotencyKey?.trim()) throw new BadRequestException('Idempotency-Key is required');
    return this.returnBins.putaway(barcode, dto, this.actor(user), idempotencyKey);
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- return-bin`
Expected: `return-bin.integration`·`return-bin-removal`·`return-bin-putaway` 모두 PASS
Run: `npx jest apps/core/src/modules/fulfillment/controllers/return-bin.controller.spec.ts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 되돌림 바구니의 물건을 원래 로케이션에 적치 — 세션 통제가 풀려 일반 재고로 (#989)"
```

---

### Task 12: 송장 스캔 — `labelState` `withdrawing`(뺄 목록)·`withdrawn`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/label/label-print-policy.ts` (`LabelState`)
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill-label-state.reader.ts` (`forShipment`, `forBatch`)
- Modify: `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.ts` (`ShipmentByWaybillResult.removals`·`exitTo`, 무효 송장 폴백)
- Test: `apps/core/src/modules/fulfillment/reader/by-waybill.withdrawal.integration.spec.ts`

**Interfaces:**
- Consumes: `loadWithdrawalRemovals`(Task 6).
- Produces:
  - `LabelState` = 기존 + `'withdrawing' | 'withdrawn'`
  - `ShipmentByWaybillResult` 에 `removals: WithdrawalRemoval[]`(withdrawing 일 때만, 그 밖엔 `[]`), `exitTo: 'draft' | 'canceled' | null`(활성 작업 항목의 값)
  - `withdrawn` = 활성 작업 항목이 없고 마지막 작업 항목이 **시작된 배치에서** `excluded`. 이때 `batchId`·`workItemId` 는 `null` 이다(«이 배치에 있다» 로 읽히면 앱의 「박스 빼기」 가 다시 빼려 한다)
  - 활성 송장이 없을 때: 그 번호의 무효 송장이 가리키는 박스가 `canceled` 이고 마지막 작업 항목이 `exit_to = canceled` 로 나갔으면 `withdrawn` 결과(송장 상태 `voided`). 아니면 지금처럼 404

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `reader/by-waybill.withdrawal.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentWaybillReader } from './shipment-waybill.reader';
import { inRollbackTx, makeDb } from '../services/__support__';
import { seedReturnBin, seedTwoBoxBatch } from '../services/__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from '../services/__support__/simple-outbound-wiring';
import { assembleLabels } from '../waybill/__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('송장 스캔 — 빠지는·빠진 박스 (스펙 §10.5, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const readerFor = (tx: DbTx) => {
    const dbService = ambientDbService(tx);
    return new ShipmentWaybillReader(dbService, assembleLabels(dbService).states);
  };

  async function pickedAndWithdrawn(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: second.actorId,
        quantity: 1,
        from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: second.skuId,
          sourceLocationId: second.locationId,
          custodyType: 'WORKER',
          custodyRef: second.actorId,
          shipmentLineId: second.shipmentLineId,
        },
      },
      tx,
    );
    await wiring.batches.excludeShipment(first.batchId, second.shipmentId, { reason: 'x' }, `x-${randomUUID()}`, actor, tx);
    return { first, second, wiring, sessionId: run.sessionId };
  }

  it('빼는 중이면 withdrawing + 뺄 목록 + exitTo', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second } = await pickedAndWithdrawn(tx);
      const found = await readerFor(tx).byTrackingNo(second.trackingNo);
      expect(found).toMatchObject({
        labelState: 'withdrawing',
        workItemStatus: 'withdrawing',
        exitTo: 'draft',
        removals: [expect.objectContaining({ shipmentLineId: second.shipmentLineId, boxQty: 1, cartQty: 0 })],
      });
    });
  });

  it('다 빼서 나갔으면 withdrawn — 배치·작업 항목은 null', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring } = await pickedAndWithdrawn(tx);
      const bin = await seedReturnBin(tx, second.warehouseId, second.actorId);
      await wiring.returns.removeToReturnBin(
        second.shipmentId,
        { barcode: second.barcode, returnBinBarcode: bin.barcode, quantity: 1 },
        actor,
        `r-${randomUUID()}`,
        tx,
      );
      const found = await readerFor(tx).byTrackingNo(second.trackingNo);
      expect(found).toMatchObject({ labelState: 'withdrawn', batchId: null, workItemId: null, removals: [] });
    });
  });

  it('전체 취소로 나가 송장이 무효여도 그 번호로 withdrawn 을 준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      const wiring = assembleOutbound(tx);
      await wiring.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, second.shipmentLineId));
      await wiring.planning.cancelOutstanding(
        second.shipmentId,
        {
          expectedManifestVersion: shipment.manifestVersion,
          reason: '고객 취소',
          lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: line.qty }],
        },
        `c-${randomUUID()}`,
        actor,
        tx,
      );
      const found = await readerFor(tx).byTrackingNo(second.trackingNo);
      expect(found).toMatchObject({ labelState: 'withdrawn', shipmentStatus: 'canceled', waybillStatus: 'voided' });
    });
  });

  it('시작 전 배치에서 제외된 박스는 withdrawn 이 아니다(null)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring } = await (async () => {
        const seeded = await seedTwoBoxBatch(tx, 1, 10);
        return { ...seeded, wiring: assembleOutbound(tx) };
      })();
      await wiring.batches.excludeShipment(first.batchId, second.shipmentId, { reason: 'x' }, `x-${randomUUID()}`, actor, tx);
      const found = await readerFor(tx).byTrackingNo(second.trackingNo);
      expect(found.labelState).toBeNull();
    });
  });
});
```

(`assembleLabels(dbService).states` 가 `WaybillLabelStateReader` 다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- by-waybill.withdrawal`
Expected: FAIL — withdrawing 박스는 조립 실패로 `unavailable`(LABEL_NOT_ALLOCATED), 나간 박스는 `null`, 무효 송장은 404

- [ ] **Step 3: 상태 판정을 고친다**

`label-print-policy.ts`:

```ts
export type LabelState =
  | 'current'
  | 'never_printed'
  | 'reprint_required'
  | 'not_started'
  | 'external'
  | 'unavailable'
  // 스펙 §10.5 — 이탈 중(뺄 상품 → 되돌림 바구니), 이탈 완료(«빠진 박스입니다, 송장은 버리세요»).
  | 'withdrawing'
  | 'withdrawn';
```

`waybill-label-state.reader.ts`:

```ts
const WITHDRAWING: LabelStateView = { state: 'withdrawing', changes: [], issue: null };
const WITHDRAWN: LabelStateView = { state: 'withdrawn', changes: [], issue: null };

  async forShipment(shipmentId: string, tx?: DbTx): Promise<LabelStateView | null> {
    return this.dbService.run(async (trx) => {
      const [item] = await trx
        .select({ status: WI.status, batchStartedAt: wmsTables.outboundBatches.startedAt })
        .from(WI)
        .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, WI.batchId))
        .where(and(eq(WI.shipmentId, shipmentId), notInArray(WI.status, ['completed', 'excluded'])))
        .limit(1);
      // 빠지는 박스에는 그릴 종이가 없다(I4) — 조립하지 않고 상태만.
      if (item?.status === 'withdrawing') return WITHDRAWING;
      if (item) return this.stateOf(trx, shipmentId, item.batchStartedAt !== null);
      // 활성 작업 항목이 없다 — 마지막이 시작된 배치에서 빠졌으면 withdrawn(시작 전 제외는 종이가 나간 적이 없다).
      const [last] = await trx
        .select({ status: WI.status, batchStartedAt: wmsTables.outboundBatches.startedAt })
        .from(WI)
        .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, WI.batchId))
        .where(eq(WI.shipmentId, shipmentId))
        .orderBy(desc(WI.createdAt), desc(WI.id))
        .limit(1);
      return last?.status === 'excluded' && last.batchStartedAt ? WITHDRAWN : null;
    }, tx);
  }
```

`forBatch` 는 작업 항목 조회에 `status: WI.status` 를 싣고, 루프에서 `item.status === 'withdrawing'` 이면 `...WITHDRAWING` 을 쓴다(조립하지 않는다).

- [ ] **Step 4: 송장 스캔 결과를 고친다** — `shipment-waybill.reader.ts`
  - `ShipmentByWaybillResult` 에 `/** 이탈 중이면 뺄 목록(스펙 §10.5 withdrawing). 그 밖엔 []. */ removals: WithdrawalRemoval[];` 와 `/** 활성 작업 항목의 exit_to — 이탈 중일 때만 값이 있다. */ exitTo: 'draft' | 'canceled' | null;`
  - 활성 작업 항목 조회에 `exitTo: wmsTables.outboundBatchWorkItems.exitTo` 를 싣는다.
  - `const label = workItem ? await this.labelStates.forShipment(...) : null;` 를 `const label = await this.labelStates.forShipment(waybill.shipmentId, trx);` 로 — 나간 박스도 `withdrawn` 을 받는다.
  - 반환에 `removals: workItem?.status === 'withdrawing' ? await loadWithdrawalRemovals(trx, workItem.id) : []`, `exitTo: workItem?.exitTo ?? null`.
  - 줄 조회(`lines` + `skus` 조인)를 `private async loadLines(trx: DbTx, shipmentId: string)` 로 뽑는다(폴백이 같이 쓴다).
  - 활성 송장이 없을 때(`if (!waybill) throw new NotFoundException(...)`)를 폴백으로:

```ts
      if (!waybill) {
        const withdrawn = await this.canceledWithdrawal(trx, normalized, warehouseId);
        if (withdrawn) return withdrawn;
        throw new NotFoundException(`Waybill not found for tracking number ${normalized}`);
      }
```

```ts
  /**
   * 전체 취소로 나간 박스는 송장이 무효라 활성 송장으로는 못 찾는다. 작업자가 든 종이를 다시 스캔하면 «빠진 박스 · 송장은
   * 버리세요» 를 보여야 한다(스펙 §10.5 withdrawn, 정한 것 13) — 그 번호의 가장 최근 무효 송장으로 박스를 찾는다.
   */
  private async canceledWithdrawal(
    trx: DbTx,
    trackingNo: string,
    warehouseId?: string,
  ): Promise<ShipmentByWaybillResult | null> {
    const [waybill] = await trx
      .select({
        shipmentId: wmsTables.waybills.shipmentId,
        trackingNo: wmsTables.waybills.trackingNo,
        carrier: wmsTables.waybills.carrier,
        status: wmsTables.waybills.status,
      })
      .from(wmsTables.waybills)
      .where(and(eq(wmsTables.waybills.trackingNo, trackingNo), eq(wmsTables.waybills.status, 'voided')))
      .orderBy(desc(wmsTables.waybills.voidedAt))
      .limit(1);
    if (!waybill) return null;
    const [shipment] = await trx
      .select({
        warehouseId: wmsTables.shipments.warehouseId,
        status: wmsTables.shipments.status,
        recipientSnapshot: wmsTables.shipments.recipientSnapshot,
      })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, waybill.shipmentId))
      .limit(1);
    if (!shipment || shipment.status !== 'canceled') return null;
    if (warehouseId !== undefined && warehouseId !== shipment.warehouseId) return null;
    const [last] = await trx
      .select({ status: wmsTables.outboundBatchWorkItems.status, exitTo: wmsTables.outboundBatchWorkItems.exitTo })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, waybill.shipmentId))
      .orderBy(desc(wmsTables.outboundBatchWorkItems.createdAt), desc(wmsTables.outboundBatchWorkItems.id))
      .limit(1);
    if (last?.status !== 'excluded' || last.exitTo !== 'canceled') return null;
    const lines = await this.loadLines(trx, waybill.shipmentId);
    return {
      shipmentId: waybill.shipmentId,
      warehouseId: shipment.warehouseId,
      trackingNo: waybill.trackingNo ?? trackingNo,
      carrier: waybill.carrier,
      waybillStatus: waybill.status,
      shipmentStatus: shipment.status,
      batchId: null,
      workItemId: null,
      workItemStatus: null,
      recipientMasked: maskName(readRecipientName(shipment.recipientSnapshot)),
      lines: lines.map((line) => ({ ...line, pickedQty: 0 })),
      labelState: 'withdrawn',
      labelChanges: [],
      labelIssue: null,
      removals: [],
      exitTo: 'canceled',
    };
  }
```

(`waybills.status` 가 enum 이면 `'voided'` 리터럴 그대로, `voidedAt` 컬럼이 없으면 `createdAt` 으로 정렬한다.)

- [ ] **Step 5: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- by-waybill waybill-label-state simple-outbound`
Expected: 새 스펙 PASS 4, 기존 by-waybill·라벨 상태 스펙 그대로(기존 `toEqual` 로 결과 전체를 비교하는 스펙이 있으면 `removals: []`·`exitTo: null` 을 더한다)
Run: `npm run type-check` → 0

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 송장 스캔이 빠지는 박스는 뺄 목록을, 빠진 박스는 withdrawn 을 준다 (#989)"
```

---
### Task 13: 앱 — 새 거절 코드·문구·타입, 빠진 박스(`withdrawn`) 안내

**Files:**
- Modify: `native/warehouse-app/src/core/data/httpClient.ts` (+ `httpClient.test.ts`)
- Modify: `native/warehouse-app/src/core/data/errorMessage.ts` (+ `errorMessage.test.ts`)
- Modify: `native/warehouse-app/src/domains/outbound/types.ts`, `domains/outbound/waybillLabel.ts`, `domains/outbound/labelGate.ts` (+ `labelGate.test.ts`), `domains/outbound/batchJoin.ts`, `domains/outbound/OutboundQueueScreen.tsx` (+ `OutboundQueueScreen.test.tsx`), `domains/outbound/batchRemove.test.ts`
- `ShipmentByWaybill` 리터럴을 만드는 테스트 전부(`npx tsc -b` 가 찾아 준다)

**Interfaces:**
- Produces (`types.ts`):
  - `interface WithdrawalRemoval { shipmentLineId: string; skuId: string; skuCode: string; skuName: string; sourceLocationId: string; locationCode: string; boxQty: number; cartQty: number }`
  - `ShipmentByWaybill` 에 `removals: WithdrawalRemoval[]`, `exitTo: 'draft' | 'canceled' | null`
  - `OutboundBatchSummary` 에 `withdrawingItems: number`
- Produces (`waybillLabel.ts`): `LabelState` 에 `'withdrawing' | 'withdrawn'`. `printableShipmentIds` 는 `withdrawing` 도 뺀다.
- Produces (`errorMessage.ts`): `ErrorContext` 에 `'returns'`, `export const SHIPMENT_WITHDRAWN_MESSAGE = '빠진 박스예요. 송장은 버려 주세요.'`
- Produces (`labelGate.ts`): `withdrawn` → `{ kind: 'blocked', message: SHIPMENT_WITHDRAWN_MESSAGE }`(`withdrawing` 은 Task 15)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`httpClient.test.ts` — «(#988)» 목록에서 `'BOX_HAS_PICKED_ITEMS'` 를 지우고(서버에서 사라진 코드다), 새 목록:

```ts
  it.each([
    'SHIPMENT_WITHDRAWN',
    'SHIPMENT_ALREADY_WITHDRAWING',
    'SHIPMENT_NOT_WITHDRAWING',
    'REMOVAL_NOT_PENDING',
    'RETURN_BIN_UNKNOWN',
    'RETURN_BIN_WAREHOUSE_MISMATCH',
    'RETURN_BIN_ITEM_NOT_FOUND',
    'RETURN_BIN_ITEM_SHORT',
    'RETURN_LOCATION_MISMATCH',
  ])('%s 409 는 확정 거절 (#989)', (code) => {
    expect(new ConflictError('m', code).outcome).toBe('rejected');
  });

  it('등록 안 된 바구니 조회(404 RETURN_BIN_UNKNOWN)도 확정 거절 — 다시 보내도 같다', () => {
    expect(new ApiError('GET /return-bins/RB-x → 404', 404, 'RETURN_BIN_UNKNOWN').outcome).toBe('rejected');
  });
```

`errorMessage.test.ts` — «합류·이탈 거절 문구 (#988)» 표에서 `BOX_HAS_PICKED_ITEMS` 행을 지우고:

```ts
describe('이탈·되돌림 문구 (#989)', () => {
  it.each([
    ['SHIPMENT_WITHDRAWN', '빠진 박스예요. 송장은 버려 주세요.'],
    ['SHIPMENT_ALREADY_WITHDRAWING', '이미 빼는 중인 박스예요. 송장을 스캔해 뺄 상품을 되돌림 바구니에 넣어 주세요.'],
    ['SHIPMENT_NOT_WITHDRAWING', '빼는 중인 박스가 아니에요. 송장을 다시 스캔해 주세요.'],
    ['REMOVAL_NOT_PENDING', '이 상품은 이 박스에서 뺄 게 없어요.'],
  ])('출고 %s', (code, text) => {
    expect(errorMessage(new ConflictError('m', code), 'outbound')).toBe(text);
  });

  it.each([
    ['RETURN_BIN_UNKNOWN', '등록되지 않았거나 폐기된 되돌림 바구니예요. 설정에서 바구니를 확인해 주세요.'],
    ['RETURN_BIN_WAREHOUSE_MISMATCH', '다른 창고의 되돌림 바구니예요.'],
    ['RETURN_BIN_ITEM_NOT_FOUND', '이 바구니에 없는 상품이에요.'],
    ['RETURN_BIN_ITEM_SHORT', '바구니에 남은 수량보다 많아요.'],
    ['RETURN_LOCATION_MISMATCH', '원래 로케이션이 아니에요. 화면에 보이는 로케이션에 넣어 주세요.'],
  ])('되돌림 %s — 출고·되돌림 화면 둘 다', (code, text) => {
    expect(errorMessage(new ConflictError('m', code), 'returns')).toBe(text);
    expect(errorMessage(new ConflictError('m', code), 'outbound')).toBe(text);
  });
});
```

`labelGate.test.ts` 의 표에 행 하나:

```ts
    ['withdrawn', true, { kind: 'blocked', message: '빠진 박스예요. 송장은 버려 주세요.' }],
```

`batchRemove.test.ts` 의 «집은 몫이 있으면 거절 문구» 케이스를 지운다(그 코드는 사라졌다 — 새 동작 테스트는 Task 15).

`OutboundQueueScreen.test.tsx` — 가짜 API 에 `T-WITHDRAWN`(작업 항목 없음 + `labelState: 'withdrawn'`)을 더하고(`T-NOWORKITEM` 과 같은 모양 + `labelState: 'withdrawn'`, `removals: []`, `exitTo: null`), 첫 화면에 `<ScanButton code="T-WITHDRAWN" />` 를 더한 뒤:

```ts
    it('빠진 박스의 송장이면 «버려 주세요» — 오늘 배치에 없다고 하지 않는다', async () => {
      const user = userEvent.setup();
      renderScreen([], undefined, undefined, 'w-1', false);
      await screen.findByText('OB-1');
      await user.click(screen.getByRole('button', { name: '스캔:T-WITHDRAWN' }));
      expect(await screen.findByText('빠진 박스예요. 송장은 버려 주세요.')).toBeInTheDocument();
      expect(screen.queryByText(/오늘 배치에 없어요/)).toBeNull();
    });
```

(`describe('송장 상태(labelState)로 화면을 가른다')` 안에 둔다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/core/data src/domains/outbound/labelGate.test.ts src/domains/outbound/OutboundQueueScreen.test.tsx`
Expected: FAIL — 새 코드가 `uncertain`, 문구 없음, `withdrawn` 이 `open`, 빠진 박스가 «오늘 배치에 없어요»

- [ ] **Step 3: 고친다**

`httpClient.ts` 의 확정 거절 목록: `'BOX_HAS_PICKED_ITEMS',` 를 지우고 `'BATCH_JOIN_BLOCKED',` 다음에

```ts
        'SHIPMENT_WITHDRAWN',
        'SHIPMENT_ALREADY_WITHDRAWING',
        'SHIPMENT_NOT_WITHDRAWING',
        'REMOVAL_NOT_PENDING',
        'RETURN_BIN_UNKNOWN',
        'RETURN_BIN_WAREHOUSE_MISMATCH',
        'RETURN_BIN_ITEM_NOT_FOUND',
        'RETURN_BIN_ITEM_SHORT',
        'RETURN_LOCATION_MISMATCH',
```

`errorMessage.ts`:
- `ErrorContext` 에 `| 'returns'`, `CONTEXTUAL` 에 `returns: { 404: '등록되지 않은 되돌림 바구니예요.' },`
- `export const SHIPMENT_WITHDRAWN_MESSAGE = '빠진 박스예요. 송장은 버려 주세요.';`
- `OUTBOUND_CONFLICT_MESSAGES`: `BOX_HAS_PICKED_ITEMS` 를 지우고

```ts
  SHIPMENT_WITHDRAWN: SHIPMENT_WITHDRAWN_MESSAGE,
  SHIPMENT_ALREADY_WITHDRAWING:
    '이미 빼는 중인 박스예요. 송장을 스캔해 뺄 상품을 되돌림 바구니에 넣어 주세요.',
  SHIPMENT_NOT_WITHDRAWING: '빼는 중인 박스가 아니에요. 송장을 다시 스캔해 주세요.',
  REMOVAL_NOT_PENDING: '이 상품은 이 박스에서 뺄 게 없어요.',
```

- 새 표와 조회(출고 표 조회 바로 다음, `ConflictError` 일반 문구보다 앞):

```ts
/** 되돌림 바구니 — «뺄 상품»(출고)과 «되돌림 적치»·설정(returns) 화면이 같은 문구를 쓴다. */
const RETURN_CONFLICT_MESSAGES: Record<string, string> = {
  RETURN_BIN_UNKNOWN: '등록되지 않았거나 폐기된 되돌림 바구니예요. 설정에서 바구니를 확인해 주세요.',
  RETURN_BIN_WAREHOUSE_MISMATCH: '다른 창고의 되돌림 바구니예요.',
  RETURN_BIN_ITEM_NOT_FOUND: '이 바구니에 없는 상품이에요.',
  RETURN_BIN_ITEM_SHORT: '바구니에 남은 수량보다 많아요.',
  RETURN_LOCATION_MISMATCH: '원래 로케이션이 아니에요. 화면에 보이는 로케이션에 넣어 주세요.',
};
```

```ts
  if (
    error instanceof ApiError &&
    (context === 'outbound' || context === 'returns') &&
    error.code &&
    RETURN_CONFLICT_MESSAGES[error.code]
  )
    return RETURN_CONFLICT_MESSAGES[error.code];
```

`types.ts` — Interfaces 절의 세 변경. `waybillLabel.ts`:

```ts
export type LabelState =
  | 'current'
  | 'never_printed'
  | 'reprint_required'
  | 'not_started'
  | 'external'
  | 'unavailable'
  | 'withdrawing'
  | 'withdrawn';
```

그리고 `// 이미 출고됐거나(completed) 배치에서 빠졌거나(excluded) 빠지는 중인(withdrawing) 박스는 송장이 필요 없다(I4).` + `const NOT_PRINTABLE = new Set(['completed', 'excluded', 'withdrawing']);`

`labelGate.ts` 의 `switch` 에(`not_started` 다음):

```ts
    case 'withdrawn':
      return { kind: 'blocked', message: SHIPMENT_WITHDRAWN_MESSAGE };
```

`batchJoin.ts` 의 `ISSUE_TEXT` 에 `SHIPMENT_WITHDRAWING: '빼는 중인 박스예요. 뺄 상품을 바구니에 다 넣은 뒤 다시 넣어 주세요.',`

`OutboundQueueScreen.tsx` 의 `open()`: `labelGateOf` 판정을 `found.workItemId === null` 검사 **앞**으로 옮긴다 — 빠진 박스는 작업 항목이 없지만 «오늘 배치에 없어요» 가 아니라 «버려 주세요» 다:

```ts
      const gate = labelGateOf(found, labelPrinting);
      if (gate.kind === 'blocked') {
        setNotice(gate.message);
        return;
      }
      if (found.workItemId === null) {
        setNotice('이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요');
        return;
      }
      if (gate.kind === 'print') {
        // … 그대로 …
      }
```

(`labelState` 가 `null` 이면 `open` 이라 작업 항목 검사로 그대로 간다.) `ShipmentByWaybill` 리터럴을 만드는 테스트(예: `batchRemove.test.ts` 의 `found()`, `OutboundQueueScreen.test.tsx` 의 가짜 응답)에 `removals: []`, `exitTo: null` 을 더한다. 배치 목록 가짜 응답에는 `withdrawingItems: 0`.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd native/warehouse-app && npx tsc -b && npx vitest run && npx oxlint`
Expected: 0 · 전부 PASS · 에러 0

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src
git commit -m "feat(warehouse-app): 이탈·되돌림 거절 코드를 확정 거절로 받고, 빠진 박스 송장은 «버려 주세요» (#989)"
```

---

### Task 14: 앱 — 기기별 «내 되돌림 바구니»

**Files:**
- Create: `native/warehouse-app/src/domains/returns/returnBin.ts` (+ `returnBin.test.ts`)
- Create: `native/warehouse-app/src/domains/returns/returnBinApi.ts`
- Create: `native/warehouse-app/src/domains/returns/ReturnBinSettings.tsx` (+ `ReturnBinSettings.test.tsx`)
- Modify: `native/warehouse-app/src/app/routes/SettingsRoute.tsx`

**Interfaces:**
- Produces (`returnBin.ts`):
  - `export const RETURN_BIN_KEY = 'almondwms.returnBin'`
  - `isReturnBinCode(code: string): boolean` — `RB-` 접두어(서버 `ck_return_bins_barcode_prefix`)
  - `readReturnBin(prefs: DevicePrefs, warehouseId: string | null): string | null` — 저장된 바구니가 **이 창고의 것**일 때만
  - `writeReturnBin(prefs: DevicePrefs, value: { warehouseId: string; barcode: string } | null): void`
- Produces (`returnBinApi.ts`):
  - `interface ReturnBinItem { skuId; skuCode; skuName; sourceLocationId; locationCode; qty: number }`, `interface ReturnBinContents { id; barcode; warehouseId; items: ReturnBinItem[] }`
  - `fetchReturnBin(api: ApiClient, barcode: string, warehouseId: string): Promise<ReturnBinContents>` — `GET /return-bins/:barcode?warehouseId=`
  - `registerReturnBin(api: ApiClient, input: { warehouseId: string; barcode: string }): Promise<{ id: string; barcode: string; warehouseId: string }>` — `POST /return-bins`
  - `isUnknownReturnBin(error: unknown): boolean` — `ApiError` 이고 `code === 'RETURN_BIN_UNKNOWN'`
- Produces: `ReturnBinSettings({ prefs? }: { prefs?: DevicePrefs })` — 설정 화면의 절(두 프로필 모두)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`returnBin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { isReturnBinCode, readReturnBin, RETURN_BIN_KEY, writeReturnBin } from './returnBin';

describe('내 되돌림 바구니', () => {
  it.each([
    ['RB-001', true],
    [' RB-A.1 ', true],
    ['rb-001', false],
    ['TOTE-1', false],
    ['RB-', false],
  ])('%s 는 바구니 바코드인가 → %s', (code, expected) => {
    expect(isReturnBinCode(code)).toBe(expected);
  });

  it('이 창고의 바구니만 돌려준다 — 창고를 바꾸면 다시 지정해야 한다', () => {
    const prefs = createMemoryPrefs();
    writeReturnBin(prefs, { warehouseId: 'w-1', barcode: 'RB-001' });
    expect(readReturnBin(prefs, 'w-1')).toBe('RB-001');
    expect(readReturnBin(prefs, 'w-2')).toBeNull();
    writeReturnBin(prefs, null);
    expect(prefs.get(RETURN_BIN_KEY)).toBeNull();
  });

  it('깨진 값은 없는 것으로 본다', () => {
    const prefs = createMemoryPrefs({ [RETURN_BIN_KEY]: '{not json' });
    expect(readReturnBin(prefs, 'w-1')).toBeNull();
  });
});
```

`ReturnBinSettings.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { readReturnBin } from './returnBin';
import { ReturnBinSettings } from './ReturnBinSettings';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function mount(opts: { request: (o: { method?: string; path: string; body?: unknown }) => Promise<unknown> }) {
  const client: ApiClient = { request: opts.request as unknown as ApiClient['request'] };
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'wh', name: '창고' }) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <WarehouseProvider prefs={prefs}>
        <QueryClientProvider client={new QueryClient()}>
          <ApiClientProvider client={client}>
            <ScanProvider>{children}</ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </WarehouseProvider>
    </SessionProvider>
  );
  render(<ReturnBinSettings prefs={prefs} />, { wrapper });
  return { user: userEvent.setup(), prefs };
}

describe('ReturnBinSettings', () => {
  it('등록된 바구니면 바로 이 기기의 바구니로 지정한다', async () => {
    const { user, prefs } = mount({
      request: async (o) => {
        if (o.path === '/return-bins/RB-001?warehouseId=wh') return { id: 'b', barcode: 'RB-001', warehouseId: 'wh', items: [] };
        throw new Error(`unexpected ${o.path}`);
      },
    });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'RB-001');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    expect(await screen.findByRole('status')).toHaveTextContent('RB-001 을 이 기기의 되돌림 바구니로 지정했어요.');
    expect(readReturnBin(prefs, 'wh')).toBe('RB-001');
  });

  it('등록되지 않은 바구니면 등록 버튼을 보이고, 누르면 등록한 뒤 지정한다', async () => {
    const calls: string[] = [];
    const { user, prefs } = mount({
      request: async (o) => {
        calls.push(`${o.method ?? 'GET'} ${o.path}`);
        if (o.method === 'POST' && o.path === '/return-bins') return { id: 'b', barcode: 'RB-NEW', warehouseId: 'wh' };
        throw new ApiError('GET /return-bins/RB-NEW → 404', 404, 'RETURN_BIN_UNKNOWN');
      },
    });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'RB-NEW');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    await user.click(await screen.findByRole('button', { name: '새 바구니로 등록' }));
    expect(await screen.findByRole('status')).toHaveTextContent('RB-NEW 을 등록하고 이 기기의 되돌림 바구니로 지정했어요.');
    expect(calls).toContain('POST /return-bins');
    expect(readReturnBin(prefs, 'wh')).toBe('RB-NEW');
  });

  it('RB- 가 아니면 보내지 않는다', async () => {
    const { user } = mount({ request: async () => { throw new Error('should not call'); } });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'TOTE-1');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('되돌림 바구니 바코드는 RB- 로 시작해요.');
  });
});
```


- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/returns`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`returnBin.ts`:

```ts
import type { DevicePrefs } from '../../core/data/devicePrefs';

export const RETURN_BIN_KEY = 'almondwms.returnBin';
const RETURN_BIN_CODE = /^RB-[A-Za-z0-9._-]{1,125}$/;

/** 되돌림 바구니 바코드 — `RB-` 접두어(서버 `ck_return_bins_barcode_prefix`). 토트·상품·로케이션과 섞이지 않는다. */
export function isReturnBinCode(code: string): boolean {
  return RETURN_BIN_CODE.test(code.trim());
}

/**
 * 이 기기(PC)의 «내 되돌림 바구니»(스펙 §8 — 라벨 프린터처럼 기기별 설정). 바구니는 창고에 매이므로 창고와 같이 적고,
 * 지금 창고의 것일 때만 돌려준다 — 창고를 바꾼 PC 가 다른 창고의 바구니로 빼면 서버가 거절한다.
 */
export function readReturnBin(prefs: DevicePrefs, warehouseId: string | null): string | null {
  const raw = prefs.get(RETURN_BIN_KEY);
  if (!raw || !warehouseId) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'warehouseId' in value &&
      'barcode' in value &&
      value.warehouseId === warehouseId &&
      typeof value.barcode === 'string' &&
      isReturnBinCode(value.barcode)
    )
      return value.barcode;
  } catch {
    // 깨진 값은 없는 것으로 본다.
  }
  return null;
}

export function writeReturnBin(prefs: DevicePrefs, value: { warehouseId: string; barcode: string } | null): void {
  if (!value) prefs.remove(RETURN_BIN_KEY);
  else prefs.set(RETURN_BIN_KEY, JSON.stringify({ warehouseId: value.warehouseId, barcode: value.barcode.trim() }));
}
```

`returnBinApi.ts`:

```ts
import { ApiError, type ApiClient } from '../../core/data/httpClient';

export interface ReturnBinItem {
  skuId: string;
  skuCode: string;
  skuName: string;
  sourceLocationId: string;
  /** 원래 로케이션 — 되돌림 적치는 여기만 받는다. */
  locationCode: string;
  qty: number;
}

export interface ReturnBinContents {
  id: string;
  barcode: string;
  warehouseId: string;
  items: ReturnBinItem[];
}

export function fetchReturnBin(api: ApiClient, barcode: string, warehouseId: string): Promise<ReturnBinContents> {
  const qs = new URLSearchParams({ warehouseId });
  return api.request<ReturnBinContents>({ path: `/return-bins/${encodeURIComponent(barcode.trim())}?${qs.toString()}` });
}

export function registerReturnBin(
  api: ApiClient,
  input: { warehouseId: string; barcode: string },
): Promise<{ id: string; barcode: string; warehouseId: string }> {
  return api.request({ method: 'POST', path: '/return-bins', body: { warehouseId: input.warehouseId, barcode: input.barcode.trim() } });
}

export function isUnknownReturnBin(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'RETURN_BIN_UNKNOWN';
}
```

`ReturnBinSettings.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { isReturnBinCode, readReturnBin, writeReturnBin } from './returnBin';
import { fetchReturnBin, isUnknownReturnBin, registerReturnBin } from './returnBinApi';

type Status = { kind: 'ok' | 'error'; text: string };

/** 설정 화면의 «내 되돌림 바구니» — 이 기기에서 뺀 상품이 들어갈 바구니. 등록은 명시적으로 한 번 더 누른다(오타 방지). */
export function ReturnBinSettings({ prefs = localStoragePrefs }: { prefs?: DevicePrefs }) {
  const api = useApiClient();
  const { warehouseId } = useWarehouse();
  const [current, setCurrent] = useState(() => readReturnBin(prefs, warehouseId));
  const [code, setCode] = useState('');
  const [unknown, setUnknown] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const guarded = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      setStatus({ kind: 'error', text: errorMessage(error, 'returns') });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const assign = () =>
    guarded(async () => {
      const barcode = code.trim();
      setUnknown(null);
      if (!warehouseId) return;
      if (!isReturnBinCode(barcode)) {
        setStatus({ kind: 'error', text: '되돌림 바구니 바코드는 RB- 로 시작해요.' });
        return;
      }
      try {
        await fetchReturnBin(api, barcode, warehouseId);
      } catch (error) {
        if (!isUnknownReturnBin(error)) throw error;
        setUnknown(barcode);
        setStatus({ kind: 'error', text: `${barcode} 은 등록되지 않은 바구니예요.` });
        return;
      }
      writeReturnBin(prefs, { warehouseId, barcode });
      setCurrent(barcode);
      setCode('');
      setStatus({ kind: 'ok', text: `${barcode} 을 이 기기의 되돌림 바구니로 지정했어요.` });
    });

  const register = () =>
    guarded(async () => {
      if (!warehouseId || !unknown) return;
      const bin = await registerReturnBin(api, { warehouseId, barcode: unknown });
      writeReturnBin(prefs, { warehouseId, barcode: bin.barcode });
      setCurrent(bin.barcode);
      setUnknown(null);
      setCode('');
      setStatus({ kind: 'ok', text: `${bin.barcode} 을 등록하고 이 기기의 되돌림 바구니로 지정했어요.` });
    });

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">내 되돌림 바구니</h2>
      <p className="text-xs text-gray-500">
        박스에서 뺀 상품을 담는 바구니예요. 바구니의 바코드(RB-…)를 한 번 스캔해 두면 이 기기에서 뺀 상품이 그 바구니로 기록돼요.
      </p>
      <p className="text-sm">{current ? `지금 바구니: ${current}` : '지정한 바구니가 없어요.'}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void assign();
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          aria-label="되돌림 바구니 바코드"
          placeholder="RB-…"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" disabled={busy || !code.trim()}>
          이 기기의 바구니로 지정
        </Button>
      </form>
      {unknown && (
        <Button type="button" disabled={busy} onClick={() => void register()}>
          새 바구니로 등록
        </Button>
      )}
      {current && (
        <Button
          type="button"
          className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          onClick={() => {
            writeReturnBin(prefs, null);
            setCurrent(null);
            setStatus({ kind: 'ok', text: '되돌림 바구니 지정을 풀었어요.' });
          }}
        >
          지정 풀기
        </Button>
      )}
      {status && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className="text-sm">
          {status.text}
        </p>
      )}
    </section>
  );
}
```

(스캐너로 바코드를 받는 게 편하면 `useScanner((event) => setCode(event.code))` 를 더한다 — 설정 화면의 다른 절이 스캔을 쓰지 않으면 넣지 않는다.)

`SettingsRoute.tsx`: `{isStationDevice() && <LabelPrinterSettings />}` 다음에 `<ReturnBinSettings />`(두 프로필 모두 — 정한 것 19).

- [ ] **Step 4: 통과를 확인한다**

Run: `cd native/warehouse-app && npx tsc -b && npx vitest run && npx oxlint`
Expected: 0 · 전부 PASS · 에러 0 (설정 화면을 그리는 라우터 테스트가 있으면 새 절이 `useApiClient` 공급자를 요구하는지 확인한다 — 요구하면 그 테스트의 래퍼에 이미 있다)

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src
git commit -m "feat(warehouse-app): 설정에서 이 기기의 되돌림 바구니를 지정하고, 없으면 등록한다 (#989)"
```

---

### Task 15: 앱 — 「박스 빼기」 결과, «뺄 상품» 화면, 배치 카드

**Files:**
- Modify: `native/warehouse-app/src/domains/outbound/batchRemove.ts` (+ `batchRemove.test.ts`), `domains/outbound/RemoveBoxPanel.tsx`
- Create: `native/warehouse-app/src/domains/outbound/withdraw.ts` (+ `withdraw.test.ts`)
- Create: `native/warehouse-app/src/domains/outbound/WithdrawBoxScreen.tsx` (+ `WithdrawBoxScreen.test.tsx`)
- Create: `native/warehouse-app/src/app/routes/WithdrawRoute.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx`, `domains/outbound/labelGate.ts` (+ test), `domains/outbound/OutboundQueueScreen.tsx` (+ test)

**Interfaces:**
- Consumes: `readReturnBin`(Task 14), `WithdrawalRemoval`·`LabelState`(Task 13).
- Produces:
  - `RemoveOutcome = { kind: 'removed' | 'withdrawing' | 'blocked'; message: string }`
  - `withdraw.ts`: `interface RemovalResult { removedQty: number; exited: boolean; exitTo: 'draft' | 'canceled' | null; removals: WithdrawalRemoval[] }`, `removeToReturnBin(api: ApiClient, input: { shipmentId: string; barcode: string; returnBinBarcode: string; idempotencyKey: string }): Promise<RemovalResult>`, `withdrawalRows(removals: WithdrawalRemoval[]): Array<{ key: string; label: string; qty: number; onCart: boolean }>`
  - `LabelGateDecision` 에 `{ kind: 'withdraw' }` — `labelState === 'withdrawing'`
  - 경로 `/outbound/withdraw/$shipmentId`(`state.shipment` 로 by-waybill 결과를 받는다 — 단순출고와 같다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`batchRemove.test.ts` 에:

```ts
  it('담은 상품이 있으면 빼는 중 — 송장을 스캔해 바구니로 빼라고 안내한다', async () => {
    const { api } = fakeApi((o) =>
      o.method === 'DELETE' ? { operationId: 'op', workItem: { id: 'wi-1', status: 'withdrawing' } } : found(),
    );
    const outcome = await removeBoxFromBatch({ api, newKey: () => 'k' }, { batchId: 'b-1', warehouseId: 'wh', trackingNo: '1', reason: 'x' });
    expect(outcome).toEqual({
      kind: 'withdrawing',
      message: '담은 상품이 있어 빼는 중이에요. 이 송장을 스캔해 뺄 상품을 되돌림 바구니에 넣어 주세요.',
    });
  });
```

`labelGate.test.ts` 표에 `['withdrawing', false, { kind: 'withdraw' }],`.

`withdraw.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../../core/data/httpClient';
import { removeToReturnBin, withdrawalRows } from './withdraw';

describe('뺄 상품', () => {
  it('상품 스캔 한 번 = 하나를 바구니로 — 멱등 키와 함께 보낸다', async () => {
    const calls: unknown[] = [];
    const api = {
      request: async (o: unknown) => {
        calls.push(o);
        return { removedQty: 1, exited: false, exitTo: 'draft', removals: [] };
      },
    } as unknown as ApiClient;
    await removeToReturnBin(api, { shipmentId: 's-1', barcode: '880', returnBinBarcode: 'RB-1', idempotencyKey: 'k-1' });
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/shipments/s-1/return-bin-removals',
        body: { barcode: '880', returnBinBarcode: 'RB-1', quantity: 1 },
        idempotencyKey: 'k-1',
      },
    ]);
  });

  it('줄은 [로케이션] 상품명, 카트 몫은 따로 표시한다', () => {
    const base = { shipmentLineId: 'l', skuId: 's', skuCode: 'C', skuName: '볼펜', sourceLocationId: 'loc', locationCode: 'A-01' };
    expect(withdrawalRows([{ ...base, boxQty: 2, cartQty: 1 }])).toEqual([
      { key: 'l|loc|box', label: '[A-01] 볼펜', qty: 2, onCart: false },
      { key: 'l|loc|cart', label: '[A-01] 볼펜', qty: 1, onCart: true },
    ]);
  });
});
```

`WithdrawBoxScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import { writeReturnBin } from '../returns/returnBin';
import type { ShipmentByWaybill } from './types';
import { WithdrawBoxScreen } from './WithdrawBoxScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const shipment: ShipmentByWaybill = {
  shipmentId: 's-1',
  trackingNo: 'T-1',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'withdrawing',
  recipientMasked: '홍길**',
  lines: [],
  labelState: 'withdrawing',
  labelChanges: [],
  labelIssue: null,
  exitTo: 'draft',
  removals: [
    { shipmentLineId: 'l', skuId: 's', skuCode: 'C', skuName: '볼펜', sourceLocationId: 'loc', locationCode: 'A-01', boxQty: 1, cartQty: 0 },
  ],
};

function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: Date.now() })}>
      스캔:{code}
    </button>
  );
}

function prefsWith(bin: string | null): DevicePrefs {
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'wh', name: '창고' }) });
  if (bin) writeReturnBin(prefs, { warehouseId: 'wh', barcode: bin });
  return prefs;
}

function mount(opts: { prefs: DevicePrefs; request: (o: unknown) => Promise<unknown> }) {
  const client: ApiClient = { request: opts.request as unknown as ApiClient['request'] };
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="880" />
        <WithdrawBoxScreen shipmentId="s-1" shipment={shipment} prefs={opts.prefs} />
      </>
    ),
  });
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: () => <p>설정</p> });
  const outboundRoute = createRoute({ getParentRoute: () => rootRoute, path: '/outbound', component: () => <p>출고</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screenRoute, settingsRoute, outboundRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <WarehouseProvider prefs={opts.prefs}>
        <QueryClientProvider client={new QueryClient()}>
          <ApiClientProvider client={client}>
            <ScanProvider>{children}</ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </WarehouseProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
  return { user: userEvent.setup() };
}

describe('WithdrawBoxScreen', () => {
  it('바구니를 지정하지 않았으면 스캔을 받지 않고 설정으로 안내한다', async () => {
    mount({ prefs: prefsWith(null), request: async () => { throw new Error('should not call'); } });
    expect(await screen.findByRole('alert')).toHaveTextContent('설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요.');
  });

  it('뺄 상품을 [로케이션] 상품명으로 보이고, 스캔하면 바구니로 빼고, 마지막이면 «송장은 버려 주세요»', async () => {
    const calls: unknown[] = [];
    const { user } = mount({
      prefs: prefsWith('RB-1'),
      request: async (o) => {
        calls.push(o);
        return { removedQty: 1, exited: true, exitTo: 'draft', removals: [] };
      },
    });
    expect(await screen.findByText('[A-01] 볼펜')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(await screen.findByRole('status')).toHaveTextContent('다 뺐어요. 이 박스의 송장은 버려 주세요.');
    expect(calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/shipments/s-1/return-bin-removals',
        body: { barcode: '880', returnBinBarcode: 'RB-1', quantity: 1 },
      }),
    ]);
  });
});
```

(`ScanProvider`·`useScanBus`·`WorkArea` 가 요구하는 공급자(작업 런타임 등)가 더 있으면 `OutboundQueueScreen.test.tsx` 의 `renderScreen` 이 감싸는 것을 그대로 따른다 — 그 파일이 이 화면과 같은 `WorkArea kind="outbound"` 를 그린다. `useScanBus().emit` 의 인자 모양도 그 파일의 `ScanButton` 을 따른다.)

`OutboundQueueScreen.test.tsx`: `/outbound/withdraw/$shipmentId` 목표 경로(컴포넌트 `() => <p>뺄상품화면</p>`)를 라우터에 더하고, `describe('송장 상태(labelState)로 화면을 가른다')` 에:

```ts
    it('빼는 중인 박스의 송장이면 뺄 상품 화면으로 간다', async () => {
      const user = userEvent.setup();
      renderScreen([], undefined, undefined, 'w-1', false, { labelState: 'withdrawing' });
      await screen.findByText('OB-1');
      await user.click(screen.getByRole('button', { name: '스캔:T-1' }));
      expect(await screen.findByText('뺄상품화면')).toBeInTheDocument();
    });

    it('배치 카드에 빠지는 중인 박스 수를 보인다', async () => {
      renderScreen([], undefined, {
        picking: [{ id: 'b-1', batchNumber: 'OB-1', name: '', status: 'picking', totalItems: 3, totalQty: 7, startedAt: '2026-09-30T00:00:00.000Z', withdrawingItems: 1 }],
        created: [],
      });
      expect(await screen.findByText('빠지는 중 1')).toBeInTheDocument();
    });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`batchRemove.ts`:

```ts
export type RemoveOutcome = { kind: 'removed' | 'withdrawing' | 'blocked'; message: string };
```

`DELETE` 응답을 받아 가른다:

```ts
    const result = await deps.api.request<{ workItem?: { status?: string } }>({
      method: 'DELETE',
      path: `/outbound-batches/${input.batchId}/shipments/${found.shipmentId}`,
      body: { reason: input.reason.trim() },
      idempotencyKey: deps.newKey(),
    });
    // 담은 상품이 있으면 서버는 박스를 «빼는 중» 으로 둔다 — 상품이 바구니에 다 들어가야 빠진다(스펙 §8).
    if (result?.workItem?.status === 'withdrawing') {
      return {
        kind: 'withdrawing',
        message: '담은 상품이 있어 빼는 중이에요. 이 송장을 스캔해 뺄 상품을 되돌림 바구니에 넣어 주세요.',
      };
    }
    return { kind: 'removed', message: '박스를 뺐어요. 이 박스의 송장은 버려 주세요.' };
```

주석 «PR 2 = 집기 전만» 을 «담은 상품이 있으면 빼는 중으로 남는다(PR 3)» 로. `RemoveBoxPanel.tsx`: 안내 문구를 `아직 담지 않은 상품은 바로 빠져요. 담은 상품이 있으면 송장을 스캔해 되돌림 바구니로 빼요.` 로, 결과 `<p role={outcome.kind === 'blocked' ? 'alert' : 'status'}>`, 목록 무효화는 `removed`·`withdrawing` 둘 다.

`withdraw.ts`:

```ts
import type { ApiClient } from '../../core/data/httpClient';
import type { WithdrawalRemoval } from './types';

export interface RemovalResult {
  removedQty: number;
  exited: boolean;
  exitTo: 'draft' | 'canceled' | null;
  removals: WithdrawalRemoval[];
}

/** 빼는 박스에서 상품 하나를 되돌림 바구니로(스펙 §8). 스캔 한 번 = 하나 — 멱등 키는 스캔 큐의 사건 id 다. */
export function removeToReturnBin(
  api: ApiClient,
  input: { shipmentId: string; barcode: string; returnBinBarcode: string; idempotencyKey: string },
): Promise<RemovalResult> {
  return api.request<RemovalResult>({
    method: 'POST',
    path: `/shipments/${input.shipmentId}/return-bin-removals`,
    body: { barcode: input.barcode, returnBinBarcode: input.returnBinBarcode, quantity: 1 },
    idempotencyKey: input.idempotencyKey,
  });
}

/** 화면 줄 — 박스 몫과 카트 몫(토탈피킹, 분류대에서 뺀다)을 따로. */
export function withdrawalRows(
  removals: WithdrawalRemoval[],
): Array<{ key: string; label: string; qty: number; onCart: boolean }> {
  return removals.flatMap((removal) => {
    const label = `[${removal.locationCode}] ${removal.skuName}`;
    const base = `${removal.shipmentLineId}|${removal.sourceLocationId}`;
    return [
      ...(removal.boxQty > 0 ? [{ key: `${base}|box`, label, qty: removal.boxQty, onCart: false }] : []),
      ...(removal.cartQty > 0 ? [{ key: `${base}|cart`, label, qty: removal.cartQty, onCart: true }] : []),
    ];
  });
}
```

`WithdrawBoxScreen.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { SCAN_STORAGE_MESSAGE, useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { readReturnBin } from '../returns/returnBin';
import type { ShipmentByWaybill, WithdrawalRemoval } from './types';
import { removeToReturnBin, withdrawalRows } from './withdraw';

function WithdrawBoxContent({
  shipmentId,
  shipment,
  prefs = localStoragePrefs,
}: {
  shipmentId: string;
  shipment: ShipmentByWaybill | null;
  prefs?: DevicePrefs;
}) {
  const api = useApiClient();
  const { warehouseId } = useWarehouse();
  const bin = readReturnBin(prefs, warehouseId);
  const [removals, setRemovals] = useState<WithdrawalRemoval[]>(shipment?.removals ?? []);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useWorkScanQueue<{ barcode: string; returnBinBarcode: string }>(
    async (input, id) => {
      if (doneRef.current) return;
      try {
        const result = await removeToReturnBin(api, { shipmentId, ...input, idempotencyKey: id });
        setNotice(null);
        setRemovals(result.removals);
        if (result.exited) {
          doneRef.current = true;
          setDone(true);
        }
      } catch (error) {
        setNotice(errorMessage(error, 'outbound'));
        if (!(error instanceof ApiError && error.outcome === 'rejected')) throw error;
      }
    },
    `withdraw:${shipmentId}`,
  );
  const accept = (barcode: string) => {
    if (!bin || doneRef.current) return;
    queue.enqueue({ barcode, returnBinBarcode: bin });
  };
  useScanner((event) => accept(event.code));

  if (!shipment) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="박스 빼기" backTo="/outbound" />
        <p role="alert">송장 정보를 잃었어요. 송장을 다시 스캔해 주세요.</p>
      </div>
    );
  }
  const rows = withdrawalRows(removals);
  return (
    <div className="space-y-4">
      <ScreenHeader title="박스 빼기" backTo="/outbound" />
      <section className="rounded border px-3 py-2">
        <p className="font-medium">
          {shipment.carrier} {shipment.trackingNo}
        </p>
        <p className="text-sm text-neutral-500">배치에서 빠지는 박스예요. 뺄 상품을 스캔해 되돌림 바구니에 넣어 주세요.</p>
        {bin && <p className="text-sm">바구니: {bin}</p>}
      </section>
      {!bin && (
        <p role="alert">
          설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요. <Link to="/settings">설정 열기</Link>
        </p>
      )}
      {done ? (
        <p role="status">다 뺐어요. 이 박스의 송장은 버려 주세요.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between rounded border px-3 py-2">
              <span>
                {row.label}
                {row.onCart && <span className="block text-xs text-neutral-500">카트에 실린 몫 — 분류대에서 빼요</span>}
              </span>
              <span className="text-lg font-semibold">{row.qty}개</span>
            </li>
          ))}
        </ul>
      )}
      {notice !== null && <p role="alert">{notice}</p>}
      {queue.saveError !== undefined && <p role="alert">{SCAN_STORAGE_MESSAGE}</p>}
      {!done && bin && <BarcodeInput label="상품 바코드" onSubmit={accept} />}
      {done && (
        <Link to="/outbound">
          <Button>출고작업으로</Button>
        </Link>
      )}
    </div>
  );
}

export function WithdrawBoxScreen(props: Parameters<typeof WithdrawBoxContent>[0]) {
  return (
    <WorkArea kind="outbound">
      <WithdrawBoxContent {...props} />
    </WorkArea>
  );
}
```

(`useWorkScanQueue` 의 반환에서 저장 오류를 노출하는 필드 이름은 `SimpleOutboundScreen` 이 쓰는 이름을 따른다.)

`WithdrawRoute.tsx`:

```tsx
import { useParams, useRouterState } from '@tanstack/react-router';
import { WithdrawBoxScreen } from '../../domains/outbound/WithdrawBoxScreen';

export function WithdrawRoute() {
  const { shipmentId } = useParams({ strict: false });
  // 큐 화면이 조회 결과(뺄 목록 포함)를 넘긴다. 딥링크·새로고침이면 없으므로 화면이 재스캔을 안내한다.
  const shipment = useRouterState({ select: (s) => s.location.state.shipment });
  return <WithdrawBoxScreen shipmentId={shipmentId ?? ''} shipment={shipment ?? null} />;
}
```

`routeTree.tsx`: `outboundSimpleRoute` 다음에

```tsx
const outboundWithdrawRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/outbound/withdraw/$shipmentId',
  component: WithdrawRoute,
});
```

그리고 `authedRoute.addChildren([...])` 에 `outboundWithdrawRoute`.

`labelGate.ts`: 결정 타입에 `| { kind: 'withdraw' }`, `case 'withdrawing': return { kind: 'withdraw' };`.

`OutboundQueueScreen.tsx` 의 `open()`: `gate.kind === 'print'` 갈래 앞에

```ts
      if (gate.kind === 'withdraw') {
        setManual('');
        await navigate({
          to: '/outbound/withdraw/$shipmentId',
          params: { shipmentId: found.shipmentId },
          state: { shipment: found },
        });
        return;
      }
```

배치 카드의 `{batch.totalItems}박스 · {batch.totalQty}개` 다음 줄에:

```tsx
              {batch.withdrawingItems > 0 && (
                <p className="text-sm text-amber-700">빠지는 중 {batch.withdrawingItems}</p>
              )}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd native/warehouse-app && npx tsc -b && npx vitest run && npx oxlint`
Expected: 0 · 전부 PASS · 에러 0

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src
git commit -m "feat(warehouse-app): 빼는 박스의 송장을 스캔하면 뺄 상품 화면 — 상품을 스캔해 되돌림 바구니로 (#989)"
```

---

### Task 16: 앱 — «되돌림 적치» 화면

**Files:**
- Create: `native/warehouse-app/src/domains/returns/returnPutaway.ts` (+ `returnPutaway.test.ts`)
- Create: `native/warehouse-app/src/domains/returns/ReturnPutawayScreen.tsx` (+ `ReturnPutawayScreen.test.tsx`)
- Create: `native/warehouse-app/src/app/routes/ReturnPutawayRoute.tsx`
- Modify: `native/warehouse-app/src/domains/returns/returnBinApi.ts` (`putawayReturn`), `app/routeTree.tsx`, `profiles/station/StationHome.tsx`, `profiles/handheld/HandheldHome.tsx` (+ 타일을 세는 라우터 테스트)

**Interfaces:**
- Consumes: `fetchReturnBin`·`ReturnBinContents`(Task 14), `useSkuByBarcode`(재고 도메인).
- Produces:
  - `putawayReturn(api: ApiClient, input: { binBarcode: string; warehouseId: string; productBarcode: string; locationCode: string; idempotencyKey: string }): Promise<{ putAwayQty: number; items: ReturnBinItem[] }>` — `POST /return-bins/:barcode/putaways`, 수량 1
  - `returnPutaway.ts`: `type PutawayStep = { kind: 'bin' } | { kind: 'product'; bin: ReturnBinContents } | { kind: 'location'; bin: ReturnBinContents; productBarcode: string; target: { skuName: string; locations: Array<{ locationCode: string; qty: number }> } }`, `pickTarget(bin: ReturnBinContents, skuIds: string[]): PutawayStep['target' ...] | null`(아래), `afterPutaway(bin: ReturnBinContents, items: ReturnBinItem[]): PutawayStep`
  - 경로 `/returns/putaway`, 타일 «되돌림 적치»(두 프로필)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`returnPutaway.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { afterPutaway, pickTarget } from './returnPutaway';

const bin = {
  id: 'b',
  barcode: 'RB-1',
  warehouseId: 'wh',
  items: [
    { skuId: 's-1', skuCode: 'C1', skuName: '볼펜', sourceLocationId: 'l-1', locationCode: 'A-01', qty: 2 },
    { skuId: 's-1', skuCode: 'C1', skuName: '볼펜', sourceLocationId: 'l-2', locationCode: 'B-02', qty: 1 },
    { skuId: 's-2', skuCode: 'C2', skuName: '노트', sourceLocationId: 'l-1', locationCode: 'A-01', qty: 1 },
  ],
};

describe('되돌림 적치 판정', () => {
  it('스캔한 상품의 원래 로케이션을 모두 보여 준다(같은 상품이 두 로케이션에서 왔을 수 있다)', () => {
    expect(pickTarget(bin, ['s-1'])).toEqual({
      skuName: '볼펜',
      locations: [
        { locationCode: 'A-01', qty: 2 },
        { locationCode: 'B-02', qty: 1 },
      ],
    });
  });

  it('바구니에 없는 상품이면 null', () => {
    expect(pickTarget(bin, ['s-9'])).toBeNull();
  });

  it('적치 뒤 바구니가 비면 다음 바구니를 받고, 남으면 다음 상품을 받는다', () => {
    expect(afterPutaway(bin, [])).toEqual({ kind: 'bin' });
    expect(afterPutaway(bin, [bin.items[2]])).toEqual({ kind: 'product', bin: { ...bin, items: [bin.items[2]] } });
  });
});
```

`ReturnPutawayScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import { ReturnPutawayScreen } from './ReturnPutawayScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const BIN = {
  id: 'b',
  barcode: 'RB-1',
  warehouseId: 'wh',
  items: [{ skuId: 's-1', skuCode: 'C1', skuName: '볼펜', sourceLocationId: 'l-1', locationCode: 'A-01', qty: 1 }],
};

function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: Date.now() })}>
      스캔:{code}
    </button>
  );
}

type Request = { method?: string; path: string; body?: unknown };

function mount(request: (o: Request) => Promise<unknown>) {
  const client: ApiClient = { request: request as unknown as ApiClient['request'] };
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'wh', name: '창고' }) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <WarehouseProvider prefs={prefs}>
        <QueryClientProvider client={new QueryClient()}>
          <ApiClientProvider client={client}>
            <ScanProvider>{children}</ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </WarehouseProvider>
    </SessionProvider>
  );
  render(
    <>
      <ScanButton code="RB-1" />
      <ScanButton code="880" />
      <ScanButton code="A-01" />
      <ScanButton code="Z-99" />
      <ReturnPutawayScreen />
    </>,
    { wrapper },
  );
  return { user: userEvent.setup() };
}

const lookups = (o: Request): unknown => {
  if (o.path === '/return-bins/RB-1?warehouseId=wh') return BIN;
  if (o.path.startsWith('/inventory/skus?barcode=880')) return [{ id: 's-1', code: 'C1', name: '볼펜' }];
  return undefined;
};

describe('ReturnPutawayScreen', () => {
  it('바구니 → 상품 → 로케이션을 스캔하면 원래 로케이션에 적치한다', async () => {
    const calls: Request[] = [];
    const { user } = mount(async (o) => {
      calls.push(o);
      if (o.method === 'POST' && o.path === '/return-bins/RB-1/putaways') return { putAwayQty: 1, items: [] };
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await user.click(screen.getByRole('button', { name: '스캔:RB-1' }));
    expect(await screen.findByText('[A-01] 볼펜 1개')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(await screen.findByText('A-01 에 넣어 주세요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '스캔:A-01' }));
    expect(await screen.findByRole('status')).toHaveTextContent('바구니가 비었어요. 다음 바구니를 스캔해 주세요.');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      warehouseId: 'wh',
      barcode: '880',
      locationCode: 'A-01',
      quantity: 1,
    });
  });

  it('다른 로케이션을 스캔하면 서버 거절 문구를 보이고 같은 상품을 계속 기다린다', async () => {
    const { user } = mount(async (o) => {
      if (o.method === 'POST') throw new ConflictError('m', 'RETURN_LOCATION_MISMATCH');
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await user.click(screen.getByRole('button', { name: '스캔:RB-1' }));
    await screen.findByText('[A-01] 볼펜 1개');
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    await screen.findByText('A-01 에 넣어 주세요');
    await user.click(screen.getByRole('button', { name: '스캔:Z-99' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('원래 로케이션이 아니에요. 화면에 보이는 로케이션에 넣어 주세요.');
    expect(screen.getByText('A-01 에 넣어 주세요')).toBeInTheDocument();
  });

  it('바구니에 없는 상품이면 알려 주고 상품을 다시 기다린다', async () => {
    const { user } = mount(async (o) => {
      if (o.path.startsWith('/inventory/skus?barcode=880')) return [{ id: 's-9', code: 'X', name: '다른 상품' }];
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await user.click(screen.getByRole('button', { name: '스캔:RB-1' }));
    await screen.findByText('[A-01] 볼펜 1개');
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이 바구니에 없는 상품이에요.');
  });
});
```

(`useWorkScanQueue` 가 작업 런타임 공급자를 요구하면 `OutboundQueueScreen.test.tsx` 가 감싸는 공급자를 더한다. `useScanBus().emit` 의 인자 모양은 그 파일의 `ScanButton` 을 따른다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/returns`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`returnBinApi.ts` 에:

```ts
/** 되돌림 적치 한 개(스펙 §8). 원래 로케이션이 아니면 서버가 RETURN_LOCATION_MISMATCH 로 거절한다. */
export function putawayReturn(
  api: ApiClient,
  input: { binBarcode: string; warehouseId: string; productBarcode: string; locationCode: string; idempotencyKey: string },
): Promise<{ putAwayQty: number; items: ReturnBinItem[] }> {
  return api.request({
    method: 'POST',
    path: `/return-bins/${encodeURIComponent(input.binBarcode)}/putaways`,
    body: { warehouseId: input.warehouseId, barcode: input.productBarcode, locationCode: input.locationCode, quantity: 1 },
    idempotencyKey: input.idempotencyKey,
  });
}
```

`returnPutaway.ts`:

```ts
import type { ReturnBinContents, ReturnBinItem } from './returnBinApi';

export interface PutawayTarget {
  skuName: string;
  locations: Array<{ locationCode: string; qty: number }>;
}

/** 화면은 셋 중 하나를 기다린다 — 바구니, 상품, 로케이션. 스캔은 지금 단계의 것으로만 읽는다(접두어 분류 없음). */
export type PutawayStep =
  | { kind: 'bin' }
  | { kind: 'product'; bin: ReturnBinContents }
  | { kind: 'location'; bin: ReturnBinContents; productBarcode: string; target: PutawayTarget };

/** 스캔한 상품(바코드 → SKU 후보)의 원래 로케이션들. 바구니에 없으면 null. */
export function pickTarget(bin: ReturnBinContents, skuIds: string[]): PutawayTarget | null {
  const items = bin.items.filter((item) => skuIds.includes(item.skuId));
  if (!items.length) return null;
  return {
    skuName: items[0].skuName,
    locations: items.map((item) => ({ locationCode: item.locationCode, qty: item.qty })),
  };
}

/** 적치 뒤 — 바구니가 비었으면 다음 바구니, 아니면 같은 바구니의 다음 상품. */
export function afterPutaway(bin: ReturnBinContents, items: ReturnBinItem[]): PutawayStep {
  return items.length ? { kind: 'product', bin: { ...bin, items } } : { kind: 'bin' };
}
```

`ReturnPutawayScreen.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { SCAN_STORAGE_MESSAGE, useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { afterPutaway, pickTarget, type PutawayStep } from './returnPutaway';
import { fetchReturnBin, putawayReturn } from './returnBinApi';

/** 되돌림 바구니 → 원래 로케이션(스펙 §8). 바구니 스캔 → 상품·원래 로케이션·수량 → 상품 스캔 → 로케이션 스캔. */
export function ReturnPutawayScreen() {
  const api = useApiClient();
  const { warehouseId, isSet } = useWarehouse();
  const sku = useSkuByBarcode();
  const [step, setStep] = useState<PutawayStep>({ kind: 'bin' });
  const stepRef = useRef(step);
  stepRef.current = step;
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const busy = useRef(false);

  const queue = useWorkScanQueue<{ binBarcode: string; productBarcode: string; locationCode: string }>(
    async (input, id) => {
      const current = stepRef.current;
      if (!warehouseId || current.kind !== 'location') return;
      try {
        const result = await putawayReturn(api, { ...input, warehouseId, idempotencyKey: id });
        const next = afterPutaway(current.bin, result.items);
        setStep(next);
        setNotice({
          kind: 'ok',
          text: next.kind === 'bin' ? '바구니가 비었어요. 다음 바구니를 스캔해 주세요.' : '넣었어요. 다음 상품을 스캔해 주세요.',
        });
      } catch (error) {
        setNotice({ kind: 'error', text: errorMessage(error, 'returns') });
        if (!(error instanceof ApiError && error.outcome === 'rejected')) throw error;
      }
    },
    'return-putaway',
  );

  const accept = async (code: string) => {
    if (!warehouseId || busy.current) return;
    const current = stepRef.current;
    busy.current = true;
    try {
      if (current.kind === 'bin') {
        const bin = await fetchReturnBin(api, code, warehouseId);
        setStep(bin.items.length ? { kind: 'product', bin } : { kind: 'bin' });
        setNotice(bin.items.length ? null : { kind: 'ok', text: '빈 바구니예요.' });
      } else if (current.kind === 'product') {
        const found = await sku.mutateAsync(code);
        const target = pickTarget(current.bin, found.map((item) => item.id));
        if (!target) {
          setNotice({ kind: 'error', text: '이 바구니에 없는 상품이에요.' });
          return;
        }
        setStep({ kind: 'location', bin: current.bin, productBarcode: code, target });
        setNotice(null);
      } else {
        queue.enqueue({ binBarcode: current.bin.barcode, productBarcode: current.productBarcode, locationCode: code });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'returns') });
    } finally {
      busy.current = false;
    }
  };
  useScanner((event) => void accept(event.code));

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="되돌림 적치" backTo="/" />
        <WarehousePicker />
      </div>
    );
  }
  const prompt =
    step.kind === 'bin' ? '되돌림 바구니를 스캔해 주세요.' : step.kind === 'product' ? '넣을 상품을 스캔해 주세요.' : '로케이션을 스캔해 주세요.';
  return (
    <div className="space-y-4">
      <ScreenHeader title="되돌림 적치" backTo="/" />
      <p className="text-sm text-neutral-500">{prompt}</p>
      {step.kind !== 'bin' && (
        <section className="space-y-1">
          <p className="font-medium">바구니 {step.bin.barcode}</p>
          <ul className="space-y-1">
            {step.bin.items.map((item) => (
              <li key={`${item.skuId}|${item.sourceLocationId}`} className="rounded border px-3 py-2">
                [{item.locationCode}] {item.skuName} {item.qty}개
              </li>
            ))}
          </ul>
        </section>
      )}
      {step.kind === 'location' && (
        <section role="region" aria-label="넣을 곳" className="rounded border border-blue-300 px-3 py-2">
          <p className="font-medium">{step.target.skuName}</p>
          {step.target.locations.map((location) => (
            <p key={location.locationCode}>{location.locationCode} 에 넣어 주세요</p>
          ))}
        </section>
      )}
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      {queue.saveError !== undefined && <p role="alert">{SCAN_STORAGE_MESSAGE}</p>}
      <BarcodeInput
        label={step.kind === 'bin' ? '바구니 바코드' : step.kind === 'product' ? '상품 바코드' : '로케이션 코드'}
        onSubmit={(code) => void accept(code)}
      />
    </div>
  );
}
```

(여러 로케이션이 후보면 작업자가 그중 하나를 스캔하고 서버가 판정한다. `useWorkScanQueue` 의 저장 오류 필드 이름은 Task 15 와 같게.)

`ReturnPutawayRoute.tsx`: `export function ReturnPutawayRoute() { return <ReturnPutawayScreen />; }`. `routeTree.tsx`: `/returns/putaway` 경로(`putawayRoute` 다음) + `addChildren`. `StationHome.tsx`·`HandheldHome.tsx`: 「적치」 타일 다음에

```tsx
        <Link to="/returns/putaway">
          <HubTile icon={Undo2} label="되돌림 적치" />
        </Link>
```

(`lucide-react` 에서 `Undo2` import.) 타일 목록을 정확히 비교하는 라우터 테스트(`router.test.tsx`·`router.handheld.test.tsx`)가 있으면 «되돌림 적치» 를 더한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd native/warehouse-app && npx tsc -b && npx vitest run && npx oxlint`
Expected: 0 · 전부 PASS · 에러 0

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src
git commit -m "feat(warehouse-app): 되돌림 적치 화면 — 바구니·상품·원래 로케이션을 스캔해 선반으로 (#989)"
```

---

### Task 17: 마무리 — 게이트, 스펙 반영, 스모크 체크리스트, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md` — **진행 상태는 적지 않는다**(스펙 §0). 구현하며 이 계획과 달라진 것만 «PR 3 구현이 정함» 으로 넣고, 계획이 정한 것(이미 반영)이 바뀌었으면 그 문장을 고친다
- Modify: `docs/local-e2e-environment.md` 또는 시드 — 로컬 E2E 에 되돌림 바구니 하나(`RB-LOCAL-1`)를 등록하는 방법을 적는다(앱 설정 화면에서 등록할 수 있으면 문서 한 줄로 충분)

- [ ] **Step 1: 전체 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
npx jest scripts/security
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local
cd native/warehouse-app && npx tsc -b && npx vitest run && npx oxlint
```

Expected: type-check 0, jest 실패 0, 통합 실패 0(develop 부터 붉던 스위트는 develop 워크트리·새 DB 에서 같은 명령으로 대조해 «이 PR 이 만든 것 아님» 을 PR 본문에 목록으로), 앱 전부 초록.

- [ ] **Step 2: 남은 참조를 확인한다**

```bash
grep -rn "BOX_HAS_PICKED_ITEMS\|boxHasPickedItems\|withdrawUnpicked" apps/core/src native/warehouse-app/src apps/admin-web/src   # 0건
grep -rn "RETURN_PENDING" apps/core/src --include=*.ts | grep -v "\.spec\." # 바구니 키로만 쓰인다
grep -rn "'queued', 'picking', 'ready_to_pack', 'packing', 'short_pick_recovery'" apps/core/src  # 0건 — work-item-status.ts 로 모였다
```

- [ ] **Step 3: 스펙을 고친다** — 구현하며 정한 것이 있으면 §8·§10.5·§12·§13·§16 의 «PR 3 계획이 정함» 옆에 «PR 3 구현이 정함» 으로. 없으면 이 단계는 비운다.

- [ ] **Step 4: 커밋 + PR**

```bash
git add docs
git commit -m "docs(fulfillment): PR 3 구현이 정한 이탈·되돌림 계약을 스펙에 반영 (#989)"
```

PR 본문(한국어)에 반드시 넣는다:
- `Closes #989`, 트래킹 #986
- **배포 순서:** PR 1·PR 2 배포가 먼저(확인: ECS 태스크 정의 `registeredAt` 또는 새 라우트의 무인증 401). 그 뒤 `db:migrate`(core, `return-bin-withdrawal`) → `sst deploy`(core) + warehouse-app 릴리스. 추가·완화형(expand) — **`migrate → deploy`**
- **배포 전 확인(라이브, `sst shell` 에서 psql) — 세 값 모두 0 이어야 한다.** 첫 둘이 0 이 아니면 마이그레이션의 CHECK 재정의가 실패한다:

```sql
SELECT
  (SELECT count(*) FROM batch_inventory_session_balances WHERE custody_type = 'RETURN_PENDING') AS return_pending_balances,
  (SELECT count(*) FROM batch_inventory_session_events
    WHERE from_custody_type = 'RETURN_PENDING' OR to_custody_type = 'RETURN_PENDING') AS return_pending_events,
  (SELECT count(*) FROM totes WHERE upper(barcode) LIKE 'RB-%') AS totes_with_return_bin_prefix;
```

- **되돌리기 위험:** 바구니로 한 번이라도 뺀(`REMOVE_TO_RETURN_BIN`) 세션이 있으면 PR 3 이전 코드의 복구·보관 검사는 새 이벤트와 바구니 키 `RETURN_PENDING` 을 모른다 — 그 세션들에서 실패한다. 롤링 배포 중 옛·새 태스크가 겹치는 동안도 같다(PR 2 의 `HAND_BACK` 과 같은 성질)
- **새 거절 코드**(정한 것 17)와 **없어진 코드** `BOX_HAS_PICKED_ITEMS`. admin-web 영향: `grep -rn "BOX_HAS_PICKED_ITEMS\|OUTBOUND_BATCH_CLOSED" apps/admin-web` 결과를 적는다
- **지우거나 바꾼 테스트(리뷰어 판정용):** `batch-withdraw.integration` 의 `BOX_HAS_PICKED_ITEMS` 두 케이스(→ withdrawing), `outbound-batch-orchestrator.integration` 의 보관 갈래 기대(→ withdrawing), 앱 `batchRemove.test` 의 거절 케이스(→ 빼는 중), 생성자 인자만 더한 스펙 목록
- **알고 남기는 것:**
  - 토탈피킹 카트 여분이 있는 박스는 분류대에서 여분을 바구니에 넣을 때까지 `withdrawing`(정한 것 2). 토탈피킹·바구니 피킹의 현장 화면은 없다(D3) — core 명령만
  - 세션이 `recovery_required` 인 배치의 박스 전체 취소, 부분 취소(E11)는 지금처럼 `CANCEL_REPLAN_PENDING` 대기
  - 결품 보고는 PR 3 에서 바뀌지 않는다(박스 제외·초안 복귀, `RETURN_TO_SOURCE`). 결품 재배정과 결품의 되돌림 바구니 연결은 PR 4. PR 3·4 경계의 떠도는 `AT_SOURCE` 는 I3 공유 식이 이제 드러낸다(정한 것 16c) — 드러나면 결품 경로의 장부 이상이다
  - 바구니 폐기 명령은 없다
  - 주기 대조 게이지(`FulfillmentReconciliationService`)는 여전히 I1~I3 을 0 으로 보고한다(PR 2 부터)
- **로컬 E2E 사람 스모크 체크리스트**(브라우저·앱 로그인은 사람이): `bootstrap:e2e:local` → `start:all:local` → `preflight:e2e:local`
  1. 설정 → «내 되돌림 바구니» 에 `RB-LOCAL-1` 입력 → «등록되지 않은 바구니» → 「새 바구니로 등록」 → 지정됨
  2. 시작된 배치의 박스 하나를 상품 1개까지 스캔한 뒤 「박스 빼기」(사유) → «담은 상품이 있어 빼는 중이에요 …», 배치 카드에 «빠지는 중 1»
  3. 그 박스 송장을 스캔 → «박스 빼기» 화면에 `[로케이션] 상품명 1개`, 바구니 `RB-LOCAL-1` 표시
  4. 상품을 스캔 → «다 뺐어요. 이 박스의 송장은 버려 주세요.», 배치 카드의 «빠지는 중» 이 사라진다
  5. 같은 송장을 다시 스캔 → «빠진 박스예요. 송장은 버려 주세요.»
  6. 관리자 화면에서 그 박스가 배치 전 목록(planned)으로 돌아와 있다. 재고 화면의 가용 수량은 아직 그대로다(바구니에 있다)
  7. 홈 → «되돌림 적치» → `RB-LOCAL-1` 스캔 → `[로케이션] 상품 1개` → 상품 스캔 → «… 에 넣어 주세요» → **다른** 로케이션 스캔 → «원래 로케이션이 아니에요 …» → 원래 로케이션 스캔 → «바구니가 비었어요 …». 재고 화면의 가용 수량이 1 늘었다
  8. 다른 박스(상품 1개 스캔)의 주문을 관리자 화면에서 **전체 취소** → 그 박스 송장을 스캔하면 «박스 빼기» 화면 → 상품 스캔 → «다 뺐어요 …». 관리자 화면에서 주문·박스가 취소 완료, 송장 무효
  9. 아직 스캔 안 한 박스의 주문을 전체 취소 → 그 자리에서 취소 완료(배치 카드 박스 수 −1), 그 송장을 스캔하면 «빠진 박스예요 …»
  10. «박스 빼기» 화면에서 박스에 없는 상품을 스캔 → «이 상품은 이 박스에서 뺄 게 없어요.»
  11. 설정에서 바구니 지정을 풀고 빼는 박스 송장을 스캔 → «설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요.»

---

## Self-Review 기록

- **스펙 커버리지(§15 PR 3 범위):** `withdrawing`·`exit_to`(T1 스키마, T6 시작·나가기) / `REMOVE_TO_RETURN_BIN`(T2 세션, T9 박스, T10 카트) / `return_bins`(T1, T5 등록·조회) / 되돌림 적치 화면·`PUTAWAY_RETURN`(T2, T11, T16) / 방식별 hook — 박스 공통 명령 + 카트 여분 전략 메서드(T9·T10, 정한 것 1) / 토탈피킹 카트 여분(T10) / 전체 취소 → 이탈 E10(T8) / `labelState` `withdrawing`·`withdrawn`(T12, 앱 T13·T15) / 스키마 PR 3 행 — 상태·`exit_to`·이벤트 두 종·`RETURN_PENDING` 바구니 키·`returned_qty` 의미(T1·T2, 정한 것 9)·`return_bins`(T1) / 앱 — 뺄 상품 화면(T15), 기기별 바구니(T14), 되돌림 적치(T16) / «`BOX_HAS_PICKED_ITEMS` 는 사라진다»(T6·T13) / §12 `SHIPMENT_WITHDRAWN`(T7)·`RETURN_LOCATION_MISMATCH`(T11)·`RETURN_BIN_UNKNOWN`(T5·T9·T11) / §13 작업 항목 잠금에서 줄 서기·멱등 키·복구(T3)·불변식(T4) / §14 통합 «이탈(집기 전 즉시, 집은 뒤 되돌림) × 방식» — 개별(T6·T9), 토트(T6), 토탈피킹(T6·T10), 전체 취소 → 이탈(T8·T9), 모든 시나리오 끝 검사기·복구.
- **사용자가 짚은 PR 2 의 남긴 것:** ① I3 줄 귀속 집합의 `RETURN_PENDING` — T2 가 집합에서 빼고(바구니 키), T3·T4 가 같은 기준으로 대조, 스펙 §13 반영(정한 것 16a). ② 결품 제외로 빈 시작된 배치의 `AT_SOURCE` — 결품 보고가 박스 배정 전부를 정산함을 코드로 확인(옳은 장부에서는 0), 옛 I3 공유 식이 제외된 작업 항목의 남은 배정 행을 방으로 세어 가리던 것을 T4 가 고친다(정한 것 16c). 빈 배치에 정당하게 남는 보관은 바구니뿐이고, 그 세션은 적치가 끝나야 닫힌다(T11 테스트).
- **범위 밖으로 둔 것:** 결품 재배정(PR 4), 부분 취소(E11), `BOX_EXCESS_PENDING`(정한 것 12 — S2), `reconcileStage`(S2), 바구니 폐기 명령, 토탈피킹·바구니 피킹 현장 화면(D3).
- **타입 이름 일관성:** `ACTIVE_WORK_ITEM_STATUSES`·`WITHDRAWABLE_WORK_ITEM_STATUSES`·`WorkItemExitTo` / `BOX_CUSTODY_TYPES`·`ReturnBinRef`·`RemoveToReturnBinInput`·`PutawayReturnInput`·`removeToBinIdempotencyKey` / `handBackUnpicked`·`removeFromBox`·`removeCartShare`·`decrementAllocation` / `BoxWithdrawalService{blockerOf,begin,exitIfDrained,lockComponentsOf}` / `BoxReturnService{removeToReturnBin,settleExit,resumeAfterDraftExit}` / `ReturnBinService{register,lookup,requireActive,contentsOf,putaway}` / `ShipmentPlanningService.finishWithdrawnCancellation` / `OutboundBatchOrchestrator.resumeWaitingOperation` / `WithdrawalRemoval{boxQty,cartQty}` / 앱 `readReturnBin`·`writeReturnBin`·`isReturnBinCode`·`fetchReturnBin`·`registerReturnBin`·`putawayReturn`·`removeToReturnBin`·`withdrawalRows`·`pickTarget`·`afterPutaway`·`PutawayStep`.
- **순환 의존:** 이탈 서비스는 계획·오케스트레이터를 모른다(둘이 이탈 서비스를 주입받는다). 취소 완료·대기 재개는 계획 자신(E10 즉시)과 `BoxReturnService`(되돌림)가 한다 — `BoxReturnService` 를 주입받는 쪽은 컨트롤러와 토탈피킹 전략뿐이다.
