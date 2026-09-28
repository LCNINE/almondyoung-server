# 출고 작업 중 박스 이탈·합류 설계

작성일: 2026-09-29. 브랜치: `docs/outbound-box-exit-join`.
선행 문서: `2026-07-14-outbound-consolidation-split-backorder-technical-design.md`(«7월 스펙» — 작업 중 변경의 네이티브 모델),
`docs/adr/0030-picking-plan-layer-extraction.md`(계획 층 경계).
짝 스펙(별도 작성 예정): 작업 시작 선언 + 위치가 찍힌 송장(«③»).

## 1. 목표

출고 작업이 돌고 있는 중에도 박스가 유연하게 빠지고 들어와야 한다(사용자: «아주 중요»).

1. 아직 처리 전인 박스는 고객이 주문을 취소하면 **즉시** 배치에서 빠진다
2. 급한 송장 하나를 **지금 돌고 있는** 배치에 넣을 수 있다
3. 합포장 박스에서 한 주문이 일부 바뀌면(상품 하나 제외 등) 출고 작업이 그에 맞게 대응한다

요구 3 은 새 경로가 아니다. 주문 부분취소는 이미 박스 단위 `cancelOutstanding` 으로 수량과 함께 전파된다
(`sales-orders.service.ts` 의 취소 전파 루프). 따라서 **요구 3 = 이탈(①) + 합류(②)의 조합**이다.

성공 기준:

1. 피킹 스캔이 없는(`queued`) 계획 구성원 박스에 걸린 취소가 **사람 개입 없이 한 트랜잭션에서** 끝난다 —
   송장 무효화·재고 반환·구성원 은퇴·초안 복귀·취소 적용
2. 스캔이 시작된 박스에 걸린 취소는 작업자가 되돌리기를 마치면 **자동으로** 끝난다(지금은 영원히 대기한다)
3. 활성 계획이 있는 배치에 박스를 넣을 수 있고, 넣은 박스는 기존 박스와 **똑같이** 피킹·결품·이탈된다
4. 같은 박스가 같은 계획에서 몇 번이고 빠졌다 들어올 수 있다
5. 결품 처리(`short_pick`)의 동작이 바뀌지 않는다(기존 통합 스펙 회귀 0)
6. `npm run type-check` 새 에러 0 · `npx jest` 실패 0

## 2. 범위

| 포함 | 제외 |
| --- | --- |
| ① 박스 이탈 — 결품 처리의 은퇴 장치 일반화 | ③ 작업 시작 선언 + 위치 송장 — **별도 스펙**. ①②는 ③ 없이 성립한다(지금도 단순출고가 첫 스캔 때 계획을 확정한다) |
| ② 박스 합류 — 활성 계획에 구성원 덧붙이기 | ④ 주문 수정(취소 외) 전파 — **이번엔 제외**. 단 §10 의 제약을 지킨다 |
| 기존 결함 2건(§8) | 토탈피킹(`aggregate_then_sort`)·`pick_to_tote` 의 현장 화면 — 코어 계약은 전략 무관이지만 앱 화면은 단순출고만 |

**④ 제약(사용자 결정):** 이번 구조가 ④의 처리를 막거나, 방해하거나, 논리적으로 어색하게 만들면 안 된다.

## 3. 결정 요약 (사용자 결정 2026-09-29)

| # | 질문 | 결정 | 근거 |
| --- | --- | --- | --- |
| Q1 | 사람 개입 없이 자동으로 빼도 되는 경계 | **피킹 스캔 0건인 박스까지** | 원장이 실물과 어긋나지 않는 가장 넓은 경계 |
| Q2 | 죽은 송장을 작업자에게 알리는 법 | **스캔 시 거절 + 배치 화면에 «빠진 박스» 목록** | 출고 입구가 송장 스캔 하나뿐 — 옛 송장으로 시작할 수 있는 작업이 없다 |
| Q3 | 단순출고에서 «시스템상 0건 ≠ 선반에 그대로» 구간 | **그대로 자동 이탈, 거절 문구가 되돌리기 위치를 알려 준다** | 원장은 원래도 손에 든 물건을 모른다. 되돌려 놓는 순간 실물이 원장을 따라잡는다. 드문 취소를 위해 모든 박스에 스캔을 더하지 않는다 |
| Q4 | 스캔이 시작된 박스의 부분 변경 | **전부 되돌리기 → 초안 → 수정 → 합류(새 송장) → 다시 피킹** | 가장 드문 조합에 재고 이월 이음새를 만들 가치가 없다. 이월(B)의 자리는 §10 에 남긴다 |
| Q5 | 부분 변경으로 빠진 박스의 복귀 | **배치 화면 «다시 넣을 박스» → 한 번 눌러 합류 + 새 송장 인쇄** | 합류는 인쇄로 완결되고 인쇄는 앱의 일이다. 급한 송장 추가와 입구를 공유한다 |
| ② | 합류 방식 | **X: 활성 계획에 구성원 덧붙이기** | 불변식 둘(배치당 열린 계획 1개, 배치당 활성 세션 1개·세션↔계획 1:1)을 지킨다. 은퇴의 거울 연산이 되어 구성원 수명주기가 대칭이 된다 |

기각한 합류 방식:

- **Y: 같은 배치에 두 번째 계획 라운드** — 두 불변식이 다 깨진다. «열린 계획 ≤ 1» 가정은 계획 층·배치·취소·합포장·
  단순출고 곳곳에 있고(도출: `grep -rn "\['draft', 'active'\]\|PICKING_PLAN_ALREADY_ACTIVE" apps/core/src/modules/fulfillment --include=*.ts | grep -v spec`),
  세션은 DB 유니크 `uq_batch_inventory_sessions_active_batch` 와 결품 검증기(«세션의 모든 HAND_IN 이 이 계획의 것»)가 1:1 을 강제한다.
  얻는 것은 «기존 계획 불변»인데 은퇴가 이미 계획을 바꾸므로 그마저 성립하지 않는다.
- **Z: 급한 박스는 한 박스짜리 새 배치** — 단순출고에선 실물 차이가 작지만 토탈피킹에선 배치가 «함께 집는 단위»라
  돌고 있는 흐름에 못 탄다. 요구 2 를 문자 그대로 충족하지 못한다. X 이전의 임시 수단으로만 쓸 수 있다.

**작업자 문구 원칙:** 현장 화면·안내문은 «라벨»이 아니라 **«송장»**이라고 쓴다(작업자가 셀메이트 시절부터 쓰던 말).
코드·스펙 내부 용어(waybill, label 렌더러)는 그대로 둔다.

## 4. 구성원 세대 모델

### 4.1 왜 필요한가

초안 부분취소(`applyDraftCancellation`)는 **같은 박스 id·같은 줄 id** 를 유지한 채 수량만 줄인다. 그래서 빠졌던 박스가
같은 계획으로 돌아오면 지금 키에서 충돌한다.

- `picking_plan_members` PK `(plan_id, shipment_id)`
- `picking_source_allocations` 유니크 `uq_picking_source_allocations_grain (plan_id, shipment_line_id, source_location_id)`

은퇴한 세대의 행은 지울 수 없다 — HAND_IN·RETURN_TO_SOURCE 이벤트가 `allocationId` 로 그 배정을 가리키고, 복구 검증기가
그걸 대조한다. 그러니 세대를 **나란히 남긴다.**

### 4.2 스키마 변경

`picking_plan_members`:

- 대리키 `id uuid` (기본값 `gen_random_uuid()`)
- 활성 구성원 부분 유니크: `(plan_id, shipment_id) WHERE retired_at IS NULL`
- 합류 원인 `joined_by_operation_id uuid`, `joined_by_operation_type shipment_operation_type` — 원래 계획으로 들어온 구성원은
  둘 다 NULL. 복합 FK `(joined_by_operation_id, joined_by_operation_type) → shipment_operations(id, type)` (은퇴 FK 와 같은 모양)
- 은퇴 CHECK `ck_picking_plan_member_retirement` 의 `retired_by_operation_type = 'short_pick'` →
  **`IN ('short_pick', 'cancel')`**
- 합류 CHECK: 두 컬럼이 함께 NULL 이거나 함께 NOT NULL. **값(`'join'`)은 CHECK 에 적지 않는다**(§11.2 enum 함정)

`picking_source_allocations`:

- `member_id uuid → picking_plan_members(id)`
- 유니크 단위 `(member_id, shipment_line_id, source_location_id)`

`shipment_operation_type` enum 에 `'join'` 추가.

### 4.3 불변식 (유지)

- 배치당 열린(`draft|active`) 계획 ≤ 1
- 배치당 활성 세션 ≤ 1, 세션의 모든 HAND_IN 은 한 계획의 것
- 한 박스의 활성 구성원 ≤ 1 (부분 유니크가 강제)
- 한 박스의 활성 작업 항목 ≤ 1 (기존)

### 4.4 🔴 배정 읽기 감사 — 이 설계의 가장 큰 위험

세대가 생기면 한 `(plan, line, location)` 에 배정 행이 여러 벌 생긴다. **배정을 읽는 모든 곳은 둘 중 하나로 분류해야 한다.**

- **활성 세대만 읽는다** — 피킹·검수·결품·출고 판정 등 «지금 이 박스에 무엇을 집어야 하나»를 묻는 곳.
  `member_id` 를 활성 구성원으로 조인한다.
- **전 세대를 읽는다** — 복구 검증기·HAND_IN 총량 대조처럼 «원장 이벤트와 배정이 맞는가»를 묻는 곳. 이유를 주석으로 단다.

대상 도출: `grep -rn "pickingSourceAllocations" apps/core/src --include=*.ts | grep -v spec`.
구현 계획은 이 목록의 **각 읽기마다** 분류와 근거를 적는다. 분류 누락은 합류한 박스의 수량을 두 배로 세는 조용한 결함이 된다.

## 5. 이탈 흐름 (①)

### 5.1 입구

`cancelOutstanding` 의 `requiresDurableReplan` 분기(지금은 박스를 `recovery_required` 로 묶고 끝)를
**`ShipmentExitManager.exit(shipmentId, triggeringOperation, tx)`** 로 바꾼다.

`triggeringOperation` 은 «박스 내용을 바꾸는 작업»이다 — 지금은 `cancel` 하나. 매니저는 작업 유형을 분기하지 않고,
은퇴 뒤 적용할 **대기 의도(`pendingIntent`)** 만 들고 간다. 대기 의도의 형태는 지금 `cancelOutstanding` 이 operation 에
남기는 `{ kind: 'cancel_outstanding', … }` 를 그대로 쓴다.

### 5.2 판정 표

판정은 순수 함수 `classifyExit(state) → E0|E1|E2|E3|E4` 로 뽑는다. 입력은 박스 상태·활성 송장 상태·활성 작업 항목 상태·
활성 계획 구성원 여부. 박스·작업 항목 행 잠금 아래에서 상태를 읽는다.

| 판정 | 조건 | 처리 | 트랜잭션 |
| --- | --- | --- | --- |
| E0 | `planned`, 활성 작업 항목 없음, 송장 `registered` | 송장 무효화 → 초안 → 대기 의도 적용 | 즉시 1회 |
| E1 | 작업 항목 `queued`, 활성 계획 구성원 아님 | 작업 항목 `excluded`(기존 `excludeShipment` 과 같은 전이) → 송장 무효화 → 초안 → 대기 의도 적용 | 즉시 1회 |
| E2 | 작업 항목 `queued`, 활성 계획 구성원 | **반환**(이 구성원 배정의 세션 잔량 → 원래 위치, `returnToSource`) → **은퇴** → 작업 항목 `excluded` → 송장 무효화 → 초안 → 대기 의도 적용 | 즉시 1회 |
| E3 | 작업 항목 `picking` / `ready_to_pack` / `packing` | 지금처럼 박스 `recovery_required`(`CANCEL_REPLAN_PENDING`), 작업 항목 `waitingOperationId` = 이 작업. 작업자 되돌리기가 잔량을 0 으로 만들면 `finalizeIfReturned` 가 E2 의 «은퇴» 이후를 잇는다 | 2회 |
| E4 | 송장 `used` 또는 박스 `shipped|in_transit|delivered`, 또는 출고 시도 존재 | 거절 — 지금과 같다(회수·반품 경로) | — |

- «스캔 0건» = **작업 항목 `queued`**. 단순출고는 송장을 스캔하는 순간 피커 claim 으로 `picking` 이 되므로 Q1 경계와 정확히 같다.
- 송장 무효화는 결품 처리와 같이 `registered` 를 트랜잭션 안에서 동기로 한다(택배사 HTTP 없음). 한진 자체출력 `S` 는
  취소가 안 되고 같은 번호 재등록으로 품목이 갱신되지 않으므로, 내용이 바뀐 박스는 **반드시 새 송장**이다(합류가 발급한다).
- 은퇴는 결품 처리의 `retirePickingPlanMemberForShortPick` 을 `retirePlanMember(member, operation)` 로 일반화해 공유한다.
  허용 작업 유형 목록은 코드 상수 하나(`PLAN_MEMBER_RETIRING_OPERATION_TYPES`)로 두고 스키마 CHECK 와 가드 스펙으로 맞춘다.
  결품 처리의 흐름(부족 승인·반환·예약 무효화)은 건드리지 않는다.
- 예약: 이탈은 재고가 «없는» 게 아니라 «필요 없어진» 것이라 `invalidateForShortPick` 을 쓰지 않는다. 대기 의도 적용이
  이미 부르는 `reservations.recompute` 가 해제한다.

### 5.3 E3 의 두 걸음

1. 취소 도착: E3 표시(지금 코드 그대로)
2. 작업자 되돌리기: 단순출고용 **코어 래퍼** `POST simple-outbound/:shipmentId/return` 를 새로 둔다. 앱은 내부 버전 7개를
   모르므로(결품 신고가 앱에서 막혔던 것과 같은 이유) 래퍼가 작업 항목·계획·세션을 찾아 전략별 `unpickShipment` 를 부른다.
   작업자는 되돌리기 목록을 보고 **«되돌려 놓았습니다» 한 번**으로 확정한다(단순출고의 «스캔 최소화» 원칙과 같다).
3. 같은 트랜잭션 끝에서 `finalizeIfReturned(shipmentId)`: 이 박스 배정의 세션 잔량이 0 이고 작업 항목이 이 작업을
   기다리면 → 은퇴 → 작업 항목 `excluded` → 송장 무효화 → 초안 → **대기 의도 디스패처**(`kind` 로 분기, 지금은
   `cancel_outstanding` → 기존 `resumePendingCancellation` 본문)

### 5.4 동시성

- 취소와 포장대 스캔이 같은 박스를 다투면 작업 항목 행 잠금을 먼저 잡은 쪽이 이긴다.
  취소가 먼저면 스캔은 «빠진 박스» 거절, 스캔(claim)이 먼저면 취소는 E3.
- 잠금 순서는 기존 규칙: 박스 집계 → 작업 항목 → 계획 → 구성원 → 세션 → 세션 잔량(id 순).

## 6. 합류 흐름 (②)

### 6.1 입구와 대상

배치 화면의 **«이 배치에 넣기»** 하나. 대상 두 종류, 흐름은 같다.

- **다시 넣을 박스** — 이 배치에서 `excluded` 된 작업 항목의 박스 중, 지금 `draft|planned` 이고 남은 수량이 있는 것.
  도출 함수는 순수 함수로 둔다.
- **급한 송장** — 작업자가 주문번호·송장번호로 찾은 박스

### 6.2 단계

송장 채번은 한진 HTTP 라 트랜잭션에 못 넣는다 — 그래서 단계를 나눈다. 앱의 한 번 누름에 멱등 키 하나, 단계 키는
`nestedCommandKey` 로 `{key}:plan` · `{key}:issue` · `{key}:join`.

1. **계획 완료로** — 박스가 `draft` 면 기존 `POST shipments/:id/plan`. 이미 `planned` 면 건너뛴다
2. **송장 발급** — 기존 `issueForShipment`. 활성 송장이 있으면 건너뛴다
3. **합류 트랜잭션** `OutboundBatchOrchestrator.joinBatch(batchId, shipmentId)`
   - 배치에 활성 계획이 없으면 → 기존 `addShipment` 와 같다(작업 항목 `queued`), 끝
   - 활성 계획이 있으면 한 트랜잭션에서: `join` 작업 기록 → 작업 항목 `queued` → **새 세대 구성원** →
     이 박스 몫만 재고 배정(`lockSourceCapacities`, id 순 잠금) → 활성 세션에 HAND_IN(멱등 키 `join:{operationId}:{allocationId}`) →
     계획 `version + 1`
4. **앱이 송장 인쇄** — 기존 건별 재출력 API. 선언 전 배치(§10.2)는 인쇄하지 않고 안내만 한다

계획 쪽 연산(구성원 추가·배정·HAND_IN)은 전략 무관이므로 `fulfillment/picking/plan/` 에 **`joinPlan`** 으로 두고
`planPicking` 과 **같은 배정 함수**를 쓴다. ADR-0030 규칙(«공유층에는 3전략 diff ≤ 4 로 측정된 것만»)에 따라
구현 계획 첫 태스크에서 측정해 기록한다.

### 6.3 실패

| 실패 지점 | 결과 | 복구 |
| --- | --- | --- |
| 1·2 | 박스는 원래 자리 | 재시도 |
| 3 재고 부족 | 409, **부분 합류 없음**. 박스는 송장 있는 `planned` 로 배치 밖 — 다음 배치 대상 | 재시도 시 1·2 는 건너뜀 |
| 3 배치 `completed|canceled` | 거절. «다시 넣을 박스»는 일반 대기열로 떨어진다(Q5 의 B 가 부분집합) | 다음 배치 |
| 3 카트 용량 | 기존 `assertCartCapacity` 그대로 | — |
| 4 인쇄 | 합류는 끝난 상태 | 배치 화면 건별 재출력 |

합류한 박스는 같은 계획·같은 세션의 구성원이라 단순출고 스캔·결품·이탈이 **수정 없이** 적용된다. 다시 빠지는 것도 된다.

## 7. 작업자 화면 (warehouse-app, 단순출고)

문구는 초안이고 구현 계획에서 다듬는다. **«송장»** 원칙을 지킨다.

| 상황 | 화면 |
| --- | --- |
| 빠진 박스의 송장 스캔 | 거절: «배치에서 빠진 박스입니다(사유: 주문 취소). 들고 온 상품은 아래 위치로 되돌리고 송장은 버리세요» + 위치·SKU·수량 목록(은퇴한 세대의 배정에서) |
| 작업 중 박스에 취소 도착(E3) | 다음 스캔을 서버가 «되돌리기 필요»로 거절 → 되돌리기 화면(스캔했던 상품·원래 위치) → «되돌려 놓았습니다» |
| 배치 화면 | «빠진 박스 N건»(송장번호 끝 4자리) · «다시 넣을 박스» 목록 · «이 배치에 넣기» |
| 합류 성공 | «넣었습니다. 새 송장이 인쇄됩니다» · 재합류면 «옛 송장은 버리세요» |
| 합류 재고 부족 | «재고가 부족해 이 배치에 넣을 수 없습니다» |

거절 사유 전달은 앱 기존 규약(응답 code 는 `CONFLICT`, 메시지 접두어 `CODE:` 파싱 — #913 결정)을 따른다.
새 코드: `SHIPMENT_EXITED`, `SHIPMENT_EXIT_RETURN_REQUIRED`, `BATCH_JOIN_STOCK_SHORT`.

## 8. 함께 닫는 기존 결함

1. **배치 밖 `planned` + 송장 박스에 걸린 취소를 재개시키는 곳이 없다** → E0 가 즉시 처리한다
2. **`recovery_required` 박스를 피킹 스캔이 막지 않는다**(출고에서야 막힘) → 단순출고 `prepare`/`scan` 과 전략 스캔 입구에서
   박스 상태를 확인해 `SHIPMENT_EXIT_RETURN_REQUIRED` 또는 `SHIPMENT_EXITED` 로 거절한다. 되돌리기 래퍼만 예외

## 9. 변경 지점

| 곳 | 변경 |
| --- | --- |
| `inventory/schema/inventory.schema.ts` | §4.2 |
| `fulfillment/services/shipment-exit.manager.ts` (신규) | `exit`, `finalizeIfReturned`, 대기 의도 디스패처 |
| `fulfillment/services/shipment-exit.classify.ts` (신규) | `classifyExit` 순수 함수 |
| `fulfillment/services/shipment-planning.service.ts` | `cancelOutstanding` 의 durable 분기 → `exit`. `retirePickingPlanMemberForShortPick` → `retirePlanMember`(결품 호출부는 이름만 바뀜) |
| `fulfillment/services/shipment-short-pick.service.ts` | 은퇴 호출을 일반화된 함수로 |
| `fulfillment/picking/plan/` | `joinPlan` + 배정 함수 공유 |
| `fulfillment/services/outbound-batch-orchestrator.service.ts` | `joinBatch`, «빠진 박스»·«다시 넣을 박스» 조회 |
| `fulfillment/services/simple-outbound.service.ts` | 되돌리기 래퍼, 스캔 입구 상태 거절(§8-2), 되돌리기 끝의 `finalizeIfReturned` |
| §4.4 목록의 모든 배정 읽기 | 세대 분류 |
| `native/warehouse-app` | §7 |

## 10. 앞으로의 여지

### 10.1 ④ 주문 수정 전파

- 이탈 입구는 «내용 변경 작업»을 받는다 → ④는 작업 유형 `'amend'` 추가 + `PLAN_MEMBER_RETIRING_OPERATION_TYPES` 와 CHECK 에 한 값
- E3 의 둘째 걸음은 `pendingIntent.kind` 디스패처 → ④는 새 `kind` 하나
- ④의 흐름은 «이탈 → 초안에서 수정 → 합류» — 새 출고 경로가 필요 없다
- Q4 의 B(손에 든 물건을 새 세대로 이월)는 «반환 → 은퇴» 사이에 «이월» 단계를 끼우는 자리로 남는다

### 10.2 ③ 작업 시작 선언

- 합류의 배정은 `planPicking` 과 같은 함수 → ③이 배정 순서를 위치 코드 순으로 바꾸면 합류에도 적용된다
- ③은 «계획이 없으면 송장 API 409» 규칙을 둔다 → **선언 전 배치에 합류한 박스는 건별 인쇄를 하지 않는다**
  («넣었습니다. 일괄 인쇄 때 함께 나옵니다»). 이 스펙은 «인쇄 여부는 합류 응답의 `planActive` 로 앱이 판단한다»까지만 정한다
- ③ 이후엔 인쇄된 배치의 `queued` 박스가 전부 계획 구성원이 되므로 E2 가 주 경로, E1 은 선언 전에만 — 판정 표는 그대로

## 11. 마이그레이션·배포

### 11.1 순서 — expand, `migrate → deploy`

**PR 1 (expand, 이 스펙의 구현):** 대리키 `id`(기본값), PK 를 `(plan_id, shipment_id)` → `id` 로 교체, 활성 부분 유니크,
`member_id` NULL 허용 + 코드가 쓰기(기존 행 백필), 새 유니크 `(member_id, shipment_line_id, source_location_id)`,
옛 유니크 `uq_picking_source_allocations_grain` 삭제, `joined_by_*`, 은퇴 CHECK 확장, enum `'join'`.

옛 task 가 새 스키마에서 안전한 근거: 제약을 **푸는** 변경뿐이다 — 옛 코드는 `'cancel'` 로 은퇴시키지 않고, `id` 는 기본값이 채우고,
두 옛 제약에 `ON CONFLICT` 로 기대는 곳이 없다(도출: `grep -rn "onConflict" apps/core/src/modules/fulfillment --include=*.ts | grep -v spec`,
2026-09-29 실측 — 걸리는 것은 세션 잔량·명령·합포장 테이블뿐). 옛 task 가 롤링 중 `member_id` NULL 로 쓴 배정은 새 유니크를 피해 가지만
(NULLS DISTINCT) 옛 코드는 재합류를 하지 않으므로 중복이 생기지 않는다. 스키마 통합 스펙
(`outbound-v2-schema.integration.spec.ts`)의 제약 이름 목록은 함께 고친다.

**PR 2 (contract, 배포 한 번 뒤):** 롤링 잔여 NULL 백필 후 `member_id NOT NULL`.

PR 1 착수 전에 라이브 `picking_plan_members`·`picking_source_allocations` 행 수를 실측한다(백필 규모 판단).

배포: core(`migrate → sst deploy`) → warehouse-app 릴리스. 옛 앱은 새 거절 코드를 몰라도 일반 409 문구를 띄운다.
기능 플래그는 두지 않는다 — 지금 동작이 «영원히 대기»라 새 동작이 모든 경우에 낫다.

### 11.2 🔴 enum 함정

drizzle migrate 는 전 마이그를 한 트랜잭션으로 돈다 → `ALTER TYPE … ADD VALUE 'join'` 과 같은 실행 안에서 `'join'` 을
CHECK·기본값·데이터에 쓰면 실패한다. 합류 CHECK 는 NULL 동반만 검사하고 값은 코드가 보장한다.

## 12. 테스트

| 층 | 대상 |
| --- | --- |
| 순수 함수(기본 게이트) | `classifyExit` 경계 전부 · 되돌리기 위치 목록 · «다시 넣을 박스» 도출 · 대기 의도 디스패처 분기 |
| 가드 스펙 | `PLAN_MEMBER_RETIRING_OPERATION_TYPES` ↔ 스키마 CHECK 일치 |
| 통합(`describeIfDb`, `--runInBand`) | E0·E1·E2 즉시 이탈 · E3 두 걸음 · 활성 계획 유무별 합류 · **같은 계획 재합류** · 재고 부족 시 부분 합류 없음 · 취소 vs 스캔 두 트랜잭션 경합 · 합류한 박스의 결품·재이탈 · 결품 처리 회귀 · 복구 검증기가 여러 세대를 통과 |
| warehouse-app | 문구·목록 순수 함수. 화면 배선은 로컬 E2E 사람 스모크 체크리스트 |

## 13. 구현 전에 확인할 것

1. 라이브 `picking_plan_members`·`picking_source_allocations` 행 수(§11.1)
2. `joinPlan` 의 3전략 diff 측정(ADR-0030)
3. §4.4 배정 읽기 분류 전수
4. 단순출고 외 전략 스캔 입구 목록(§8-2 거절을 넣을 곳)
