# 출고 작업 중 박스 이탈·합류·내용 변경 — 살아 있는 배정 (S1)

작성일: 2026-09-29. 브랜치: `docs/outbound-box-exit-join`.
선행 문서: `2026-07-14-outbound-consolidation-split-backorder-technical-design.md`(«7월 스펙»),
`docs/adr/0030-picking-plan-layer-extraction.md`(계획 층 경계).
대체 문서: 같은 날 커밋 `4796f0948` 의 `2026-09-29-outbound-box-exit-join-design.md`(«이전 스펙»).
이전 스펙은 라이브 호환과 «드문 경우는 단순하게»를 전제로 했다. 실운영 전이라는 조건에서 두 전제를
다시 따져 모델 자체를 바꿨다.

> **2026-09-30 부분 대체:** 합류·이탈·결품 재배정(S1-B·S1-C)과 ③ 은 `2026-09-30-outbound-allocation-before-label-design.md`
> 가 구체화했다. 그 문서가 **§6.5(배치 시작)와 D13(합류와 송장)을 대체**하고, §6.1 의 재발급·재구동 워커와 §5.2·§5.3 의
> 줄 단위 증감·§7.1 의 부분 취소는 S2 로 넘겼다. 대응표는 그 문서 §4.

짝 스펙(별도 작성 예정):

- **S2 — 주문 수정 → 출고 전파.** 이 스펙이 제공하는 박스 연산을 부른다.
- **③ — 작업 시작 선언 + 위치가 찍힌 송장.** 이 스펙의 «배치 시작»에 입구를 하나 더한다.
  → 2026-09-30 스펙이 입구를 «더하는» 대신 명시적 시작 하나로 **바꿨다**(지연 시작 제거).

## 1. 목표

출고 작업이 돌고 있어도 박스가 배치에 들어오고 빠지며, 박스 내용(SKU·수량)이 바뀔 수 있어야 한다.

1. 아직 처리 전인 박스는 고객이 주문을 취소하면 **즉시** 배치에서 빠진다
2. 급한 송장 하나를 **지금 돌고 있는** 배치에 넣을 수 있다
3. 합포장 박스에서 한 주문이 일부 바뀌면(상품 하나 제외 등) 출고 작업이 그에 맞게 대응한다

성공 기준:

1. 어떤 변경도 «영원히 대기» 상태로 남지 않는다
2. 재고 세션 보존식(§4.3 불변식 4)이 모든 명령 직후 성립한다
3. 작업자는 실물로 필요한 일만 한다 — 빼기, 넣기, 송장 다시 출력하기
4. 이미 집은 물건 중 일부만 빠지면 그 일부만 되돌린다(전부 되돌리고 다시 집지 않는다)
5. `npm run type-check` 에러 0 · `npx jest` 실패 0

## 2. 현재 구조의 뿌리 문제

2026-09-29 조사 결과(코드 확인).

1. **계획이 배치의 «고정된 집합» 사진이다.** 첫 송장 스캔 때 배치 전체의 «묶음·배정·인계»가 한꺼번에
   정해지고 바뀌지 않는다. 계획 구성원은 배치의 `queued|picking` 작업 항목과 정확히 같아야 한다
   (`picking-plan.locks.ts` 의 `assertPlanningEligibility`). 「이 박스가 이 배치에 있다」가 작업 항목과
   계획 구성원 두 곳에 적히고 둘의 일치가 강제된다 — 이 이중 기록이 경직성의 직접 원인이다.
   활성 계획에 넣을 길은 없고, 빠지는 길은 결품 은퇴 하나뿐이다.
2. **박스 내용은 초안에서만 바뀐다.** `planned` 이후 박스의 취소는 `recovery_required/CANCEL_REPLAN_PENDING`
   으로 표시만 되고, 재개 트리거는 `excludeShipment` 뒤의 한 곳뿐이다. 배치 밖 `planned` 박스, 송장만 있는 박스,
   합포장 대상 박스(초안이라도), 활성 계획 구성원은 취소가 영원히 대기한다.
3. **주문 수정은 기록만 된다.** `sales_order_amendments` 는 저장만 하고, 채널·Medusa 의 `OrderModified` 는
   core 가 의도적으로 무시한다. (S2 의 대상)
4. **송장은 박스 내용 버전(`manifestVersion`)에 묶인다.** 내용이 바뀌면 옛 송장은 무효, 새 번호가 필요하다
   (한진 자체출력은 같은 번호 재등록으로 품목이 갱신되지 않는다).

고정이 지켜 주던 것은 대체 장치로 지킨다.

| 고정이 주던 것 | 대체 |
| --- | --- |
| 잠금 아래 일관된 배정 | 변경마다 그 박스 몫만 잠금 아래 배정·인계. 지금 배정은 «위치 id 순 선착»이라 집합 전체를 볼 때만 얻는 최적화가 없다 |
| 초안 → 시작 시 재검증 | 배정과 인계가 한 트랜잭션이면 낡을 틈이 없다. 초안·무효화 장치가 필요 없다 |
| 복구 검증(인계 = 계획 배정) | 배정 증감을 모두 세션 이벤트로 남겨, 배정마다 이벤트 합과 대조한다 |

토탈피킹의 실물 동선(이미 지나친 위치, 카트에 실린 여분)은 모델의 결함이 아니라 물리적 사실이다.
막지 않고 표현한다(§5.4).

## 3. 결정 요약 (사용자 결정 2026-09-29)

| # | 질문 | 결정 |
| --- | --- | --- |
| D1 | 작업 중 박스 내용이 바뀌면 | 박스는 배치에 남고 **차이만** 처리한다 |
| D2 | 받을 변경의 범위 | 줄어드는 변경·늘어나는 변경·수령인 변경 전부. 주문 → 출고 전파는 **S2**(같은 논의, 별도 스펙·계획) |
| D3 | 지원 피킹 방식 | core 는 **세 방식 모두**(`discrete`·`pick_to_tote`·`aggregate_then_sort`). 현장 화면은 개별 피킹(단순출고)만 |
| D4 | 새 송장 출력 | 서버가 변경 시점에 발급. **옛 송장을 스캔하면** 무엇이 바뀌었는지 보여 주고, 그 PC 에 라벨 프린터가 있으면 새 송장을 출력. 없으면 «프린터 있는 자리에서 다시 스캔». 스캔은 아무것도 바꾸지 않는다 |
| D5 | 뺄 물건 확인 | **빼는 상품을 스캔**한다 |
| D6 | 뺀 물건의 행방 | 포장대 **되돌림 바구니**에 담고, 나중에 모아서 원래 위치에 적치한다 |
| D7 | 구조 | **계획을 작업 항목에 흡수한다**(§4) |
| D8 | 빠진 줄 | 박스 줄 수량 0 = 이 박스에서 빠진 줄 |
| D9 | 결품 | 다른 위치 재고로 **그 자리에서 재배정**, 불가하면 이탈 |
| D10 | 늘어난 몫을 못 채우면 | S1 은 아무것도 바꾸지 않고 거절한다. 대응은 S2 |
| D11 | 토탈피킹 카트 여분 | 분류 단계에서 «여분 → 되돌림 바구니»로 드러낸다 |
| D12 | 되돌림 적치 위치 | 원래 위치만 받는다 |
| D13 | 합류와 송장 | 합류에 송장 선행 조건을 두지 않는다. 서버가 발급을 보장한다 |

기각한 구조:

- **A. 계획은 남기고 구성원·배정을 살아 있게** — 이중 기록(작업 항목 ↔ 계획 구성원)이 남아 매 연산이 둘을
  함께 움직여야 한다. 재합류를 위해 «구성원 세대» 장치(이전 스펙 §4)가 다시 필요하다.
- **C. 내용이 바뀌면 박스를 새로 만든다(`superseded`)** — D1(박스는 남는다)과 어긋난다. 실물은 같은 박스인데
  작업 항목·송장·보관 기록이 모두 옮겨 가야 하고, 줄을 건너는 보관 이동이라는 새 연산이 생긴다.

**작업자 문구 원칙:** 현장 화면·안내문은 «라벨»이 아니라 **«송장»**이라고 쓴다. 코드·스펙 내부 용어는 그대로 둔다.

## 4. 데이터 모델

### 4.1 개념

- **배치** — 묶음, 피킹 방식, 「시작됐는가」
- **작업 항목** — 「이 박스가 이 배치에 있는 한 번의 기간」. 배정은 작업 항목에 매단다
- **배정** — 작업 항목 × 박스 줄 × 위치 의 현재 수량. 이력은 세션 이벤트가 맡는다
- **재고 세션** — 배치의 보관 장부(기존 그대로, 계획 연결만 끊는다)

재합류는 새 작업 항목이다. 작업 항목은 이미 «박스당 활성 1개»인 이력형 테이블이라 세대 문제가 생기지 않는다.

### 4.2 스키마 변경

| 대상 | 변경 |
| --- | --- |
| `picking_plans`, `picking_plan_members` | **삭제**(PR 2, §8) |
| `outbound_batches` | 전략은 `STRATEGY_BY_PICKING_METHOD[pickingMethod]` 로 도출(컬럼 없음, ADR-0041). `started_at` 을 배치 시작 때 기록 |
| `outbound_batch_work_items` | 상태 `withdrawing` 추가. `exit_to`(`draft`\|`canceled`) 추가 — `withdrawing` 일 때만 NOT NULL(CHECK). 활성 부분 유니크 `uq_outbound_work_item_active_shipment` 는 `withdrawing` 을 활성으로 센다(기존 `NOT IN ('completed','excluded')` 그대로 성립) |
| `picking_source_allocations` | `plan_id` → **`work_item_id`**. 유니크 `(work_item_id, shipment_line_id, source_location_id)`. CHECK `qty >= 0`. 행은 지우지 않는다 |
| `shipment_lines` | CHECK `qty >= 0`(0 = 빠진 줄). `inspected_qty <= qty`, `reserved_qty <= qty` 는 유지 |
| `batch_inventory_session_balances` 보관 CHECK | `RETURN_PENDING` 의 키를 «줄»에서 **«되돌림 바구니»**로: `custody_ref`(바구니 바코드) NOT NULL, `source_location_id` NOT NULL, `shipment_line_id` NULL. 이벤트 테이블의 from/to CHECK 도 같게 |
| 세션 이벤트 `event_type` | `HAND_BACK`(집기 전 몫 반납), `REMOVE_TO_RETURN_BIN`(박스 → 바구니), `PUTAWAY_RETURN`(바구니 → 위치) 추가. 모든 이벤트 payload 에 `workItemId`·`allocationId` |
| `batch_inventory_sessions` | `handed_back_qty` 추가. `returned_qty` 는 되돌림 적치(`PUTAWAY_RETURN`) 합으로 의미를 좁힌다(지금 유일한 생산자인 결품 반환은 §5.5 로 사라진다). 보존식 CHECK 갱신(§4.3) |
| `shipments.recovery_code` | `CANCEL_REPLAN_PENDING` 생산자 제거(§7.1). 값 자체는 문자열이라 스키마 변경 없음 |

### 4.3 불변식

1. **박스당 활성 작업 항목 ≤ 1** (`withdrawing` 포함)
2. **배정 ≥ 목표.** 목표 = `withdrawing` 이면 0, 아니면 박스 줄 수량. 배정 > 목표 = «뺄 물건 남음» —
   그 박스는 포장 완료·검수·발송이 막힌다. 이 상태는 저장하지 않고 계산한다
3. **보관 ≤ 배정** — 줄에 귀속된 보관(`WORKER`·`TOTE`·`SORTING`·`PACKING`·`PACKED`)의 합이 그 줄·위치의 배정을
   넘지 않는다. 공유 보관(`AT_SOURCE`·`BULK_CART`)은 «상품 × 위치» 단위로 `AT_SOURCE ≤ Σ(배정 − 귀속 보관)`
4. **세션 보존식:** 인계 = 남은 보관 + 출고 정산 + 반납(`HAND_BACK`) + 되돌림 적치 + 부족 승인.
   되돌림 바구니 보관은 «남은 보관»에 포함된다
5. **시작 안 된 배치의 작업 항목 배정 = 0**

### 4.4 계산으로 얻는 것

- 토탈피킹 합산 목록 = 위치별 `AT_SOURCE` 잔량. 합류·이탈에 따라 저절로 바뀐다
- 배치 완료 = 모든 작업 항목 `completed|excluded`
- 세션 종료 = 줄 귀속·공유·바구니 보관이 모두 0. 세션이 배치 작업보다 늦게 닫힐 수 있다(되돌림 적치 대기).
  세션은 배치마다 하나라 다른 배치를 막지 않는다

## 5. 배정 증감 연산

### 5.1 목표에 맞춘다

| 사건 | 목표의 변화 |
| --- | --- |
| 배치 시작 | 시작 전 작업 항목(`queued`·`picking` — 인계 전 단독 picker-claim 된 항목 포함): 0 → 줄 수량 |
| 시작 후 합류 | 새 작업 항목: 0 → 줄 수량 |
| 내용 변경 | 줄 수량 차이만큼 |
| 이탈 | `withdrawing` → 0 |
| 결품 | 그 위치 배정을 부족 승인만큼 감소 → 목표는 그대로라 다른 위치에서 채움 |

규칙은 **순수 함수 `reconcileAllocation`** 하나다. 입력은 목표·현재 배정·보관 현황·위치별 가용량, 출력은
할 일 목록(인계, 반납, 카트 여분, «뺄 물건 남음», 채울 수 없음). 실행부(`BoxAllocationManager`)는 잠금 아래에서
목록을 적용만 한다. 위치 선택은 지금 `planPicking` 과 같이 위치 id 순이다(③ 이 위치 코드 순으로 바꿀 자리).

### 5.2 늘어날 때

1. 늘어난 수량의 예약이 전부 확보돼야 한다(`reservePartial` 이 전량을 채우지 못하면 실패)
2. 위치별 일반 가용재고(세션 통제분 제외)에서 배정하고 같은 트랜잭션에서 `HAND_IN`
3. 예약이나 위치 재고가 모자라면 **아무것도 바꾸지 않고** `BOX_INCREASE_UNALLOCATABLE`
4. 박스가 이미 포장 단계였다면 작업 단계를 피킹으로 되돌린다(방식별 `reconcileStage` — 개별 피킹은 피커 claim 이
   살아 있으면 `picking`, 아니면 `queued`)

### 5.3 줄어들 때

1. **집지 않은 몫부터** `HAND_BACK`(공유 `AT_SOURCE` 감소, 배정 감소). 실물 동작이 없어 즉시 끝난다
2. 이미 집은 몫은 배정이 그대로 남아 «뺄 물건 남음». `REMOVE_TO_RETURN_BIN` 한 번마다 줄 귀속 보관 1 → 바구니,
   배정 1 감소. 불변식 3 이 한순간도 깨지지 않는다
3. `withdrawing` 작업 항목은 배정이 0 이 되는 트랜잭션에서 `excluded` 로 끝나고, 박스는 `exit_to` 로 간다.
   **집지 않은 박스는 1단계만으로 끝나므로, 취소가 도착한 트랜잭션에서 즉시 빠진다**(요구 1)

### 5.4 방식별 되돌리기

| 방식 | 뺄 물건이 있는 곳 | 되돌림 스캔 지점 |
| --- | --- | --- |
| 개별 피킹 | `WORKER`·`PACKING`(그 줄 몫) | 옛(또는 현재) 송장 스캔 → 상품 스캔 |
| 바구니 피킹 | `TOTE`·`PACKING`(그 줄 몫) | 바구니·포장대에서 상품 스캔 |
| 토탈피킹 | ① `SORTING`·`PACKING`(그 줄 몫) ② `BULK_CART`(누구 몫도 아님) | ① 같음 ② 아래 |

**토탈피킹 카트 여분:** 줄일 «미귀속 몫»이 공유 `AT_SOURCE` 잔량보다 크면 그 차이는 이미 카트에 실렸다.
그 몫은 배정에서 즉시 빼고 «카트 여분»이 된다(불변식 3 의 공유 부분이 `BULK_CART` 초과분을 여분으로 계산).
분류(`sortScan`)에서 모든 박스 몫을 채우고 남는 상품은 분류 화면이 «여분 → 되돌림 바구니»로 안내하고,
`BULK_CART → RETURN_PENDING` 으로 옮긴다.

방식별 custody 층의 변경은 «되돌림 스캔»과 `reconcileStage` 두 hook 뿐이다. 공통 층(§5.1~5.3)은 ADR-0030 의
규칙(3방식 diff ≤ 4 로 측정된 것만 공유)을 따라 구현 계획 첫 태스크에서 측정해 기록한다.

### 5.5 결품

1. 그 위치의 없는 몫을 부족 승인(`APPROVE_SHORTAGE`, 원장 처리는 지금과 같다)으로 줄이고 배정도 줄인다
2. `reconcileAllocation` 이 다른 위치에서 다시 채운다 — 박스는 배치에 남고 작업자는 다른 위치에서 집는다
3. 채울 수 없으면 `withdrawing`(`exit_to = draft`), 부족분 예약은 지금처럼 무효(`invalidateForShortPick`)

지금의 `short_pick_recovery` 작업 항목 상태와 «은퇴 → 초안 복귀» 경로는 이 흐름으로 대체된다.

### 5.6 동시성

- 박스에 닿는 모든 연산(변경·합류·이탈·스캔·결품·되돌림)은 **작업 항목 행 잠금**에서 줄을 선다
- 잠금 순서는 기존 규칙: 박스 → 줄 → 예약 → 작업 항목 → 세션 → 보관·위치(id 순)
- 스캔이 변경보다 늦게 잠금을 얻으면 바뀐 목표를 본다. 목표를 넘는 담기는 «이 상품은 더 담지 않습니다»

## 6. 송장과 현장 흐름

### 6.1 송장은 서버가 유지한다

적용 범위: 배치 안 박스, 그리고 송장이 이미 있던 박스. 합류하거나 내용이 바뀌는 트랜잭션에서:

| 옛 송장 | 처리 |
| --- | --- |
| `registered` | 동기 무효화(택배사 호출 없음, 결품 처리와 같다) |
| `pending`·`allocated` | 사유 `manifest_changed` 로 `abandoned`. 진행 중 발급의 다음 CAS 는 조용히 실패. `allocated` 면 한진 번호 하나가 미사용으로 남는다 |
| `used` | 변경 거절 `BOX_ALREADY_DISPATCHED` |

그리고 새 `manifestVersion` 기준 `pending` 발급 행을 넣는다(기존 `issueForShipment` 의 명령 부분, 택배사는 이전
송장과 같은 택배사 — 없으면 창고 기본). 택배사 호출은 커밋 후 한 번 구동하고, **재구동 워커**가 실패·서버 사망을
메운다. 구동은 멱등이고 CAS 로 보호되므로 겹쳐 돌아도 안전하다 → `@Cron` + `// cron-overlap-safe: <근거>`
(ADR-0036 의 폴러 예외). waybill README 의 «무인 폴러» 자리다.

합류는 송장을 선행 조건으로 두지 않는다(`addShipment` 의 `assertDispatchable` 제거). 발송 시점 검증은 그대로다.

### 6.2 옛 송장 스캔 — 읽기 전용

옛 송장 번호 → 박스 → 지금 상태.

| 박스 상태 | 앱 화면 |
| --- | --- |
| 내용이 바뀜 | «이 박스는 내용이 바뀌었습니다» + 바뀐 줄 + 새 송장 출력(프린터 있음) / «송장 프린터가 있는 자리에서 이 송장을 다시 스캔하세요»(없음) / «새 송장 발급 중»(발급 전) |
| 뺄 물건 있음 | 위에 «뺄 상품» 목록 → 상품 스캔 → 되돌림 바구니 |
| 더 집을 것 있음 | «더 담을 상품»과 위치 |
| `withdrawing` | «배치에서 빠진 박스입니다(사유)» + 뺄 상품 전부. 다 빼면 «송장은 버리세요» |
| 이탈 완료 / 이미 대체된 옛 송장 | «빠진 박스입니다, 송장은 버리세요» / «옛 송장입니다, 버리세요 (새 송장 끝 4자리 ○○○○)» |

- 몇 번을 어느 PC 에서 스캔해도 결과가 같다. 두 번 출력돼도 같은 번호의 종이다
- 새 송장을 출력한 뒤에는 새 송장을 스캔해 평소 흐름으로 이어 간다
- 작업 중 스캔이 옛 내용 기준이면 `BOX_CHANGED` → 앱이 같은 «바뀜» 화면
- 응답 판정(상태 → 화면 종류)은 순수 함수로 둔다
- 거절 사유는 앱 기존 규약(응답 code `CONFLICT`, 메시지 접두어 `CODE:`)

### 6.3 되돌림 바구니

- 바구니는 바코드가 붙은 실물이고 `RETURN_PENDING` 의 `custody_ref` 다. 각 PC 는 «내 되돌림 바구니»를 한 번
  스캔해 기억한다(라벨 프린터와 같은 기기별 설정)
- **등록 테이블 `return_bins`**(창고, 바코드, 폐기 시각)를 둔다. 되돌림 스캔은 등록·미폐기 바구니만 받는다
  (오타·엉뚱한 바코드 거절), 배치 화면·적치 화면의 «바구니별 남은 물건»도 여기서 시작한다
- **토트(`totes`, 바구니 피킹)와 합치지 않는다(2026-09-29 사용자 결정).** 토트는 박스 하나에 전용 배정되고
  비면 풀리는 용기(`shipment_tote_assignments` 가 활성 배정 1개 강제)이고, 되돌림 바구니는 누구에게도 배정되지
  않고 여러 배치의 물건이 섞이는 상주 용기다. 한 테이블에 섞으면 토트의 모든 조회·배정에 «종류=토트» 조건이
  필요해지고, 하나만 빠져도 되돌림 바구니가 박스에 배정되는 조용한 결함이 된다
- 스캔 모호성은 **바코드 접두어 `RB-`** 로 없앤다 — `return_bins` 에 CHECK(`barcode LIKE 'RB-%'`), 스캔 해석은
  접두어로 종류를 가른다. 합치지 않고도 «같은 문자열이 두 종류로 등록»되는 일이 없다
- **되돌림 적치 화면(신규):** 바구니 스캔 → «상품 · 원래 위치 · 수량» → 상품 스캔 → 위치 스캔.
  원래 위치만 받는다(`RETURN_LOCATION_MISMATCH`). 원장상 그 물건은 그 위치를 떠난 적이 없다.
  다른 곳에 두려면 적치 후 평소 재고 이동을 쓴다. 적치하면 `PUTAWAY_RETURN` — 세션 통제가 풀려 일반 가용재고가 된다

### 6.4 배치 화면(단순출고)

- «바뀐 박스 N» · «빠지는 중 N» · «되돌림 바구니에 남은 물건 N»
- **«이 배치에 넣기»:** 주문번호·송장번호로 박스를 찾아 합류. 대상은 `planned` + 예약 완전. 송장이 발급되는 대로
  그 자리에서 출력

### 6.5 배치 시작

지금처럼 단순출고의 첫 송장 스캔이 배치를 시작한다(`ensurePlan`+`start` → `ensureBatchStarted`).
③ 의 «일괄 인쇄 = 시작 선언»은 같은 시작 명령의 입구가 하나 느는 것이다.

## 7. 기존 흐름과의 경계

### 7.1 취소 — S1 에서 갈아 끼운다

`cancelOutstanding` 의 박스 쪽 처리를 내용 변경으로 바꾼다. 주문 쪽 호출 형태는 그대로다.

- 부분 취소 → 박스는 남고 줄만 준다(FOI `canceledQty` 는 같은 트랜잭션에서 반영)
- 전체 취소 → `withdrawing`(`exit_to = canceled`)
- 초안 박스는 지금처럼 초안에서 적용(작업 항목·배정 없음)

사라지는 것: `requiresDurableReplan` 분기, `CANCEL_REPLAN_PENDING`, `resumePendingCancellation`, 그리고 재개
트리거가 없어 영원히 대기하던 경우 전부. 합포장 박스의 취소도 같은 경로를 탄다. 전체 취소된 줄을 별도 박스로
옮기던 «비석 박스»는 쓰지 않는다(D8).

### 7.2 합포장

작업 중 박스를 기다리는 장치(`waitingOperationId`, `CONSOLIDATION_PENDING`)는 유지한다. 재개 트리거만
`excludeShipment` 에서 «이탈 완료»(§5.3-3)로 옮긴다.

### 7.3 S2 에 남기는 것

주문 수정 전파(입구 셋: 운영자 수정·채널 `OrderModified`·Medusa 주문 편집), `BOX_INCREASE_UNALLOCATABLE` 이후의
대응(이 박스를 빼서 기다릴지, 늘어난 몫을 새 박스로 보낼지), 한 주문의 차이를 어느 박스에 반영할지.
S1 이 S2 에 주는 입구는 둘이다: `amendBox(shipmentId, 목표 줄들, 수령인?)`, `withdrawBox(shipmentId, exitTo)`.

## 8. 오류·멱등·복구

### 8.1 오류 코드

| 코드 | 언제 | 결과 |
| --- | --- | --- |
| `BOX_INCREASE_UNALLOCATABLE` | 늘어난 몫의 예약·위치 재고 부족 | 무변경, 호출자 대응 |
| `BOX_ALREADY_DISPATCHED` | 송장 `used` 또는 발송 시도 존재 | 거절(회수·반품 경로) |
| `BOX_CHANGED` | 스캔이 옛 내용 기준 | 앱 «바뀜» 화면 |
| `BOX_EXCESS_PENDING` | 뺄 물건이 남았는데 포장 완료·검수·발송 | 거절 + 뺄 목록 |
| `SHIPMENT_WITHDRAWN` | 빠진 박스의 송장 스캔 | «버리세요» |
| `RETURN_LOCATION_MISMATCH` | 적치 위치 ≠ 원래 위치 | 거절 |
| `BATCH_NOT_JOINABLE` | 닫힌 배치 | 거절 |
| (기존) 카트 용량 | 바구니 피킹 카트 초과 | 거절 |

### 8.2 멱등과 원자성

- 모든 명령은 `FulfillmentCommandService` 멱등 키를 거친다. 세션 이벤트 멱등 키에 연산 id·작업 항목 id·배정 id
- 트랜잭션 밖은 택배사 호출 하나뿐이고 재구동 워커가 메운다. 그 외엔 반쯤 적용된 상태가 없다

### 8.3 복구와 불변식 검사

- `batch-session-recovery.service.ts` 의 기준: «HAND_IN 집합 = 계획 배정» → **배정마다 이벤트 합 = 현재 배정,
  보관 grain 이 그 배치의 작업 항목 배정에 속함**
- `FulfillmentInvariantService` 에 불변식 2·3·4 검사 추가

## 9. 변경 지점

| 곳 | 변경 |
| --- | --- |
| `inventory/schema/inventory.schema.ts` | §4.2, `return_bins`(§6.3) |
| `fulfillment/picking/plan/` → `fulfillment/picking/allocation/`(이름 변경) | `planPicking`·`startPicking`·초안 무효화 제거. `reconcileAllocation`(순수), 위치 가용량 잠금은 유지 |
| `fulfillment/services/box-allocation.manager.ts`(신규) | `startBatch`, `joinBatch`, `amendBox`, `withdrawBox`, `removeToReturnBin`, `putawayReturn` |
| `picking/*.strategy.ts` | 계획·구성원 검사 → 작업 항목 배정 검사. hook 둘(되돌림 스캔, `reconcileStage`). ATS `sortScan` 여분 안내 |
| `services/batch-inventory-session.service.ts` | `startSession` 의 계획 결합 제거, 새 이벤트 셋, 보존식 |
| `services/batch-session-recovery.service.ts` | §8.3 |
| `services/outbound-batch-orchestrator.service.ts` | `addShipment` → `joinBatch`, `excludeShipment` → `withdrawBox`, 배치 화면 집계 |
| `services/shipment-planning.service.ts` | §7.1. `retirePickingPlanMemberForShortPick` 제거 |
| `services/shipment-short-pick.service.ts` | §5.5 |
| `services/consolidation.service.ts` | §7.2 재개 트리거 |
| `services/simple-outbound.service.ts`·`location-outbound.service.ts` | `ensurePlan` → `ensureBatchStarted`, `BOX_CHANGED`·`BOX_EXCESS_PENDING`, 되돌림 스캔 |
| `services/shipment-dispatch.service.ts` | 계획 참조 제거, `BOX_EXCESS_PENDING` 가드 |
| `waybill/` | 변경 시 옛 송장 정리 + `pending` 행, 재구동 워커 |
| `native/warehouse-app` | §6.2~6.4, 되돌림 적치 화면, 기기별 되돌림 바구니 설정 |
| `docs/adr/` | 새 ADR «피킹 계획을 작업 항목 배정 장부로 흡수한다» — ADR-0030 부분 대체 |

계획 테이블 참조 도출: `grep -rln "pickingPlans\b\|pickingPlanMembers" apps/core/src --include=*.ts | grep -v spec`.

## 10. 테스트

| 층 | 대상 |
| --- | --- |
| 순수 함수(기본 게이트) | `reconcileAllocation` — 작은 범위(목표 0~3, 방식 3, 보관 위치 조합)를 **전수 열거**해 모든 출력이 불변식 2·3·4 를 지키는지(`fast-check` 미도입, 표 순회). 옛 송장 스캔 화면 판정. `reconcileStage` |
| 가드 스펙 | `apps/core/src`(스키마·스키마 제약 스펙 제외)와 `scripts/` 에 피킹 계획 테이블(`picking_plans`·`picking_plan_members`)·`allocations.plan_id` 참조 0건. 배정 읽기가 `work_item_id` 기준인지는 가드가 아니라 통합 스펙이 본다. PR 2 는 스키마 예외를 지우고 이름 패턴을 넓힌다 |
| 통합(`describeIfDb`, `--runInBand`) | 세 방식 × {시작 전·후 합류, 부분·전체 취소, 증가, 결품 재배정·이탈, 토탈피킹 카트 여분, 되돌림 적치}. 경합(변경 vs 스캔, 변경 vs 결품). 송장 재구동(모의 게이트웨이 실패 → 재시도). **모든 시나리오 끝에 불변식 검사기** |
| warehouse-app | 화면 판정 순수 함수. 배선은 로컬 E2E 사람 스모크 체크리스트 |

## 11. 배포 (ADR-0005 expand-contract)

core 는 라이브라 옛 태스크와 새 스키마가 겹친다. 규약을 지키는 비용이 작아 그대로 따른다.

- **PR 1 (expand, `migrate → deploy`):** §4.2 의 추가·완화 전부. `picking_source_allocations.plan_id` NULL 허용.
  새 코드는 계획 테이블을 읽지도 쓰지도 않는다
- **PR 2 (contract, 배포 한 번 뒤, `deploy → migrate`):** 계획 테이블 둘과 `plan_id` 삭제,
  `work_item_id NOT NULL`

🔴 **enum 함정:** drizzle migrate 는 전 마이그를 한 트랜잭션으로 돈다. `ADD VALUE` 한 값(`withdrawing` 등)을 같은
실행의 CHECK·기본값·데이터에 쓰면 실패한다. CHECK 는 `::text` 캐스팅으로 쓴다(`ck_outbound_batches_cart_capacity` 선례).

기능 플래그는 두지 않는다 — 지금 동작이 «영원히 대기»라 새 동작이 모든 경우에 낫다.
배포: core → warehouse-app 릴리스. 옛 앱은 새 거절 코드를 몰라도 일반 409 문구를 띄운다.

## 12. 구현 전에 확인할 것

1. 라이브 `outbound_batches`·`picking_plans`·`batch_inventory_sessions`·`picking_source_allocations` 행 수.
   0 이 아니면 진행 중 배치를 닫는 절차를 PR 1 전에 정한다
2. 공통 층의 3방식 diff 측정(ADR-0030 규칙)
3. `approveShortage` 의 원장 처리(§5.5-1 이 «지금과 같다»고 전제)
4. 기존 토트 바코드 중 `RB-` 로 시작하는 것이 있는지(있으면 접두어를 바꾼다)
5. 자동 재발급의 택배사 결정 — 이전 송장이 없는 합류 박스에 쓸 «창고 기본 택배사» 설정이 있는지. 없으면 설정을 추가하거나 합류 요청이 택배사를 받는다
