# 작업 시작 때 배정을 확정하고 송장에 로케이션을 찍는다

작성일: 2026-09-30. 조사 기준: `develop` / `c0e61974d`.

이 스펙은 두 갈래를 합친다.

- **③** — 「작업 시작 선언 + 위치가 찍힌 송장」. `2026-09-28-hanjin-fs-label-item-lines-design.md` §11 이 후속으로 미룬 것
- **S1-B·S1-C** — 출고 중 박스 합류·이탈·결품 재배정. `2026-09-29-outbound-live-allocation-design.md`(이하 **S1 스펙**)가 설계하고
  S1-A(PR #984)가 모델만 바꿔 둔 것

## 0. 이 문서를 읽는 법

구현은 PR 4개(§15)로 나뉘고, **PR 마다 별개의 세션**이 이 문서만 공유하며 작업한다.

- PR n 세션은 이 문서의 §1~§5(공통)와 §15 의 PR n 절을 읽고, 앞 PR 의 머지 커밋을 확인한 뒤
  `superpowers:writing-plans` 로 그 PR 의 구현 계획을 쓴다
- **진행 상태는 이 문서에 적지 않는다.** 트래킹 이슈와 PR 별 sub-issue 가 들고 있다. 이 문서는 설계만 담는다
- §3 의 결정은 사용자와 합의한 것이다. 기각한 안을 «더 간단해 보여서» 되살리지 말 것 — 기각 이유가 같이 적혀 있다
- 코드 좌표는 함수·파일 이름으로 적는다. 줄 번호는 적지 않는다

## 1. 배경 — 왜 지금 송장에 로케이션을 못 찍는가

요구사항(사용자, 2026-09-30): **출고 작업이 시작됐고 송장이 출력됐다면, 어느 로케이션에서 몇 개를 꺼내 어느 주문에
줄지는 이미 확정돼 있어야 한다.** 송장은 피킹 지시서이므로 품목 줄 앞에 `[A-01-01]` 식 로케이션이 찍혀야 한다.

지금 코드에서 이 요구는 성립하지 않는다. 배정이 송장 출력보다 **늦게** 일어나기 때문이다.

```
배치 일괄 송장 출력  →  (배정 없음)  →  첫 작업자 「출고 준비」  →  이때 배치 전체 배정
```

조사로 확인한 사실(2026-09-30):

| 사실 | 좌표 |
| --- | --- |
| 배정 로직은 이미 있다. 배치 시작이 대기 박스 전부를 한 트랜잭션에서 배정(`picking_source_allocations`)하고 재고 세션에 인계(`HAND_IN`)한다. 멱등이다 | `fulfillment/picking/allocation/batch-start.ts` `startBatchPicking`, ADR-0041 |
| 그런데 배치 시작은 **첫 송장 스캔의 부수효과**로만 불린다. 명시적 입구 `POST /picking/v2/starts` 는 있지만 부르는 클라이언트가 없다 | `services/simple-outbound.service.ts` `prepare`(→ `lockPreparation` → `picking.start`), `controllers/picking-v2.controller.ts` |
| 배치 일괄 인쇄는 배치를 시작하지 않는다. 송장 렌더러는 배정을 읽지 않는다 | `native/warehouse-app/src/domains/outbound/BatchLabelPrintButton.tsx`, `waybill/waybill-label.manager.ts` `render` |
| 배정된 몫은 세션이 통제하고, 이동·조정 등 모든 일반 차감 경로와 다른 배치의 배정이 그 몫을 보지 못한다 | `inventory/core/services/batch-controlled-stock.guard.ts` |
| 재고 예약은 **창고 × SKU** 단위다(로케이션 없음). 예약 가용 = 창고 `ON_HAND` 합 − 확정 예약 합 | `stock_reservations`, `inventory/shared/availability/warehouse-availability.ts` |
| 배정 가용은 **로케이션** 단위다: `ON_HAND − 세션 통제분 − 적치 대기분`. 다른 줄의 예약은 빼지 않는다 | `BatchControlledStockGuard.getAvailability`, `picking/allocation/allocation.locks.ts` `lockSourceCapacities` |
| 그래서 **전량 예약됐어도 배치 시작이 실패할 수 있다** — 입고 등록은 됐지만 적치 전(입고 기본존)인 물건은 예약은 되고 배정은 안 된다 | 위 두 산식의 차이 |
| 배정 순서는 로케이션 **UUID** 순 선착이다(사실상 무작위) | `picking/allocation/allocate-lines.ts` `allocateLines` |
| 배정 대상 로케이션을 종류로 거르는 조건은 없다(`ON_HAND` 면 어디든) | `lockSourceCapacities` |
| 송장 발급은 명시적 명령으로만 일어난다(단건·일괄). 서버가 알아서 발급·재발급하는 워커는 없다 | `waybill/waybill.controller.ts` `POST shipments/:id/waybills`, `waybill.manager.ts` |
| 시작된 배치에 박스를 넣으면 `OUTBOUND_BATCH_ALREADY_STARTED`. 시작 전 배치의 박스 제외는 배정이 없을 때만 된다 | `services/outbound-batch-orchestrator.service.ts` `addShipment`·`excludeShipment` |
| 현장 위치별 출고는 배정된 로케이션만 받는다(`LOCATION_OUTBOUND_SOURCE_MISMATCH`) — **종이가 낡아도 원장은 틀어지지 않는다** | `services/simple-outbound.service.ts` `pickScanned`(source 지정 시) |
| 송장 템플릿 입력에는 출력 시점 값(`printedDate`)과 최신 공동현관 비밀번호(수령인 해시 밖)가 들어 있다 | `waybill/carrier/hanjin/label/hanjin-label-data.ts` `buildHanjinLabelData` |
| 결품은 지금 박스를 배치에서 빼는 것으로 끝난다(`short_pick_recovery` → `excluded` → 초안 복귀). 배정을 제자리에서 바꾸는 경로는 없다 | `services/shipment-short-pick.service.ts` |

## 2. 목표와 성공 기준

1. 출력되는 모든 송장의 품목 줄에 로케이션이 찍힌다. **로케이션 없는 송장은 존재하지 않는다**
2. 그 로케이션은 송장이 유효한 동안 참이다. 배정이 바뀌면 그 박스는 재출력 전까지 작업이 막힌다
3. 작업 중에도 급한 박스를 넣고(합류), 박스를 뺄 수 있다(이탈). **다른 박스의 송장은 흔들리지 않는다**
4. 결품이 나면 다른 로케이션 재고로 그 자리에서 다시 채운다. 못 채우면 이탈한다
5. 배치 시작은 전부 아니면 전무다. 막히면 막힌 박스와 사유를 **전부** 보여 준다
6. `npm run type-check` 에러 0 · `npx jest` 실패 0

## 3. 결정 (사용자 결정 2026-09-30)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| E1 | 범위 | ③ 과 S1-B·S1-C 를 **한 스펙**으로 | ③ 만 먼저: 출력 후 급한 박스를 넣을 틈이 사라져 현장이 후퇴한다. S1-B 먼저: 재출력 규칙이 두 스펙에 갈린다 |
| E2 | 이번에 담는 사건 | 배치 시작, 합류, 이탈(집기 전·후), 결품 재배정 + 재출력 | **박스 내용 변경(`amendBox`)은 S2 로.** 부를 호출자가 S2(주문 수정 전파)뿐이다 |
| E3 | 확정의 단위 | **박스**(작업 항목). 합류·이탈·결품은 그 박스만 다시 확정한다 | 배치 단위: 추가·제외 때마다 배치 전체를 다시 찍어야 한다 |
| E4 | 배정이 바뀌면 | **송장 재출력 사유.** 새 판이 출력 확인될 때까지 그 박스의 전진 명령을 막는다. 새 종이에 판차(`2판`)를 찍는다 | 알리기만: 작업자가 넘기면 종이와 실제가 계속 어긋난다 |
| E5 | 판차·재출력 판정 | **송장 내용 지문**(§10.2). 출력 확인된 지문과 현재 지문이 다르면 재출력 필요 | 저장 카운터: 배정을 바꾸는 명령마다 +1 을 기억해야 해서 하나 빠지면 조용히 낡는다. 이벤트 시각 비교: 송장에 무관한 이벤트를 걸러야 하고 비교 대상이 그리는 입력과 따로 정의된다 |
| E6 | 시작 선언 | 배치 카드의 **별도 「작업 시작」 버튼**. 시작된 배치에서만 「송장 인쇄」가 켜진다. 인쇄는 부수효과 없는 동작 | 「시작하고 인쇄」 한 버튼: 첫 누름에만 재고 통제가 시작돼 다시 누를 때의 의미가 섞인다 |
| E7 | 시작 실패 | **시작 시점에만 검사.** 막힌 박스·SKU·수량·사유를 전부 보여 준다. 적치하고 다시 시작하거나 그 박스를 빼고 시작한다 | 배치 구성 단계 미리보기: 시작 전까지 재고가 움직여 약속이 아닌 숫자가 하나 더 생긴다. 필요하면 같은 함수를 읽기 전용으로 붙이면 된다 |
| E8 | 한 SKU 가 여러 로케이션에 있을 때 | **한 로케이션에서 줄 전량을 채울 수 있는 곳 우선, 동률·불가면 로케이션 코드 순.** 나중에 고도화할 전략은 `allocateLines` 한 곳만 바꾼다 | 코드 순 선착: 1개짜리 앞 로케이션 때문에 줄이 쪼개진다. 오래된 재고 먼저: 로케이션별 입고 시점 조회가 범위를 키운다 |
| E9 | 합류 시 송장 | **송장 발급을 선행 조건으로 둔다.** 앱의 「이 배치에 넣기」가 송장이 없으면 먼저 발급하고 합류한다 — **S1 스펙 D13 을 대체** | D13(서버가 발급 보장): 재구동 워커가 이번 범위에 들어오고, 발급이 실패하는 동안 그 박스 몫 재고가 이유 없이 묶인다. 워커는 S2(내용 변경)가 재발급을 필요로 할 때 도입 |
| E10 | 전체 취소 | 시작된 배치의 박스면 **이탈(`exit_to = canceled`)로 연결** — 지금의 영원한 대기(`CANCEL_REPLAN_PENDING`)를 없앤다 | — |
| E11 | 부분 취소 | **이번 범위 밖(S2).** 시작된 배치 박스의 부분 취소는 지금처럼 대기로 남는다(§16) | — |
| E12 | 결품을 누구 몫으로 채우나 | **작업 중인 박스 우선.** 로케이션에 일반 가용재고가 있으면 채운다. 모자람은 다음에 그 SKU 로 시작하는 주문으로 옮겨 가 그 시작에서 `STOCK_SHORT` 로 드러난다 | 여유분(창고 가용 ≥ 0)에서만: 진행 중인 박스가 빠지고 이미 집은 다른 상품까지 되돌려야 한다. 어느 쪽이든 한 주문은 모자라다 |

S1 스펙에서 그대로 따르는 결정: D1(박스는 남고 차이만), D3(core 는 세 피킹 방식 모두, 현장 화면은 개별 피킹만),
D5(빼는 상품을 스캔), D6(되돌림 바구니), D8(줄 수량 0 = 빠진 줄), D11(토탈피킹 카트 여분), D12(되돌림 적치는
원래 위치만), 토트와 되돌림 바구니를 합치지 않는다(§6.3), 작업자 문구는 «송장».

## 4. S1 스펙과의 관계

| S1 스펙 | 이 스펙에서 |
| --- | --- |
| §4 데이터 모델·불변식 1~5 | 그대로 따른다. 이 스펙은 I4·I5(§5)를 더한다 |
| §5.1 `reconcileAllocation` | 그대로. 이 스펙의 사건들(시작·합류·이탈·결품)이 호출자다 |
| §5.2 늘어날 때 | **합류(0 → 줄 수량)만** 이 스펙. 기존 박스의 증가는 S2 |
| §5.3 줄어들 때 | 이탈(→ 0)과 결품 부분만 이 스펙. 줄 단위 감소(부분 취소·내용 변경)는 S2 |
| §5.4 방식별 되돌리기 | 그대로 |
| §5.5 결품 | 그대로 + E12 |
| §6.1 송장은 서버가 유지 | **내용 변경 시 재발급·재구동 워커는 S2.** 이 스펙은 §10(지문·출력 기록·게이트)으로 «종이» 쪽을 맡는다 |
| §6.2 옛 송장 스캔 | §10.5 로 구체화(`labelState`) |
| §6.3 되돌림 바구니 | 그대로 |
| §6.4 배치 화면 | 「이 배치에 넣기」는 E9 로 수정 |
| §6.5 배치 시작 | **대체**: 지연 시작을 없애고 명시적 시작 하나만 둔다(§6) |
| §7.1 취소 | 전체 취소만(E10). 부분 취소는 S2 |
| D13 | **E9 가 대체** |

## 5. 모델과 불변식

개념(굵게 = 이 스펙이 더하는 것):

- **배치** — 묶음, 피킹 방식, 시작 여부(`started_at`)
- **작업 항목** — 박스 하나가 배치에 머무는 한 기간. 배정은 여기에 매단다. 재합류는 새 작업 항목이다
- **배정** — 작업 항목 × 박스 줄 × 로케이션의 현재 수량. 이력은 세션 이벤트가 맡는다
- **재고 세션** — 배치의 보관 장부
- **송장 내용 지문** — 지금 송장을 그리면 나올 **내용**의 해시(§10.2)
- **출력 기록** — 박스별로 출력이 확인된 지문과 판차

| # | 불변식 | 출처 |
| --- | --- | --- |
| I1 | 시작 안 된 배치의 작업 항목 배정 = 0 | S1 §4.3-5 |
| I2 | 시작된 배치의 활성 작업 항목은 배정 합 ≥ 목표(`withdrawing` 이면 0, 아니면 줄 수량). 배정 > 목표 = «뺄 물건 남음», 포장 완료·검수·발송이 막힌다 | S1 §4.3-2 |
| I3 | 배정된 몫은 세션이 통제한다. 보관 ≤ 배정, 세션 보존식 | S1 §4.3-3·4 |
| **I4** | **송장은 시작된 배치의 활성(이탈 중 아님) 작업 항목이면서 배정 합이 줄 수량을 덮은 박스만 그려진다** | 신규 |
| **I5** | **현재 지문 ≠ 마지막 출력 지문이면(한 번도 출력 안 됨 포함) 그 박스의 전진 명령(피킹 스캔·포장 완료·검수·발송)은 거절된다.** 되돌림 명령은 적용 받지 않는다 | 신규 |

원칙:

- **배치 시작 입구는 하나.** 명시적 시작 명령만 배치를 시작한다(§6)
- **모든 배정 변경은 한 함수를 지난다.** 순수 함수 `reconcileAllocation(목표, 현재 배정, 보관 현황, 로케이션별 가용량)` 이
  할 일 목록을 만들고, 실행부(`BoxAllocationManager`)가 잠금 아래에서 적용만 한다. S2 의 내용 변경은 호출자를 하나 더하는 일이다
- **종이는 지시서, 원장은 스캔 계약이 지킨다.** 재출력 게이트는 헛걸음을 막는 장치이고, 정합성은 «배정된 로케이션만 받는 스캔»이 이미 지킨다

## 6. 배치 시작

**명령:** 기존 `POST /picking/v2/starts {batchId}`(`startBatchPicking`). 멱등 — 시작된 배치에 다시 보내면 기존 세션을 돌려준다.
warehouse-app 배치 카드에 「작업 시작」 버튼을 두고, 시작된 배치에서만 「송장 인쇄」를 켠다(E6).

**선행 조건**(`assertStartEligibility`, 대부분 기존): 작업 항목이 모두 시작 전 상태, 박스가 `planned`·배치 창고, 배송 프로필 온전,
줄 전량 예약, **현재 내용 기준 송장 발급됨**(`assertDispatchable`).

**배정 규칙(E8)** — `allocateLines`(순수):

1. 줄은 줄 id 순으로 처리한다(결정적)
2. 줄 하나를 한 로케이션에서 전량 채울 수 있으면 그런 로케이션 중 **코드 순 첫째**
3. 아니면 로케이션 **코드 순**으로 나눠 채운다
4. 용량 조회(`lockSourceCapacities`)가 로케이션 코드를 싣는다(`locations.code`)

**실패 보고 — 전부 아니면 전무, 사유는 전부:**

- `allocateLines` 는 첫 부족에서 던지지 않고 **모자란 줄 전부**를 결과로 돌려준다. 하나라도 있으면 호출자가 아무것도 쓰지 않고 거절한다
- 응답: 박스 · SKU · 필요 수량 · 사유 목록

| 사유 | 판정 |
| --- | --- |
| `INBOUND_PENDING` | 일반 가용으로는 모자라고, 같은 창고의 적치 대기분까지 더하면 채워진다 |
| `STOCK_SHORT` | 적치 대기분을 더해도 모자란다 |
| `WAYBILL_NOT_READY` | 송장 미발급, 또는 내용이 바뀌어 재발급 필요 |
| 기존 사유 | 프로필·예약 불일치 등 기존 코드 그대로 |

- 적치 대기분은 `BatchControlledStockGuard.getAvailability` 가 이미 계산하는 `inboundPendingQty` 를 쓴다
- 앱은 사유별로 묶어 «적치를 끝내고 다시 시작» / «이 박스 빼고 시작»(기존 제외 명령)을 안내한다

**지연 시작 제거:** `SimpleOutboundService.prepare` 에서 `lockPreparation` → `picking.start` 분기를 삭제한다. 시작 안 된 배치면
준비 차단 표지(`preparationBlocked`)에 새 사유 `BATCH_NOT_STARTED` 를 싣는다. 앱의 사유 허용 목록
(`native/warehouse-app/src/core/data/httpClient.ts`)과 문구(`errorMessage.ts`)에 같은 PR 에서 더한다 — «배치 화면에서 작업 시작을 먼저 누르세요».

## 7. 합류 (급한 박스 추가)

**입구:** 기존 `POST outbound-batches/:batchId/shipments/:shipmentId`(`addShipment`) 하나. 배치 잠금 안에서 가른다.

- 시작 전 배치: 지금처럼 작업 항목만 만든다(I1)
- 시작 후 배치: 합류. `OUTBOUND_BATCH_ALREADY_STARTED` 거절은 사라진다
- 완료·취소된 배치: `BATCH_NOT_JOINABLE`

**합류 = 한 트랜잭션:**

1. 박스 잠금, 선행 조건 검사(§6 의 박스 단위 검사와 같다 — 송장 발급 포함, E9)
2. 작업 항목 생성
3. `reconcileAllocation`(목표 0 → 줄 수량): SKU 별 가용 잠금(`acquireStockAvailabilityLock`) 아래에서 일반 가용재고로 배정. 다른 박스 몫은 세션 통제분이라 후보가 아니다
4. 실행 중인 세션에 `HAND_IN`
5. 모자라면 **아무것도 바꾸지 않고** 거절, 사유는 §6 표

**합류 직후:** 배정은 있고 출력 기록은 없다 → I5 로 송장 출력 전에는 피킹할 수 없다. 앱은 성공 즉시 그 자리에서 출력하고,
프린터가 없으면 «프린터 있는 자리에서 출력하세요».

**앱 「이 배치에 넣기」:** 주문번호·송장번호로 박스를 찾는다 → 송장이 없으면 발급(`POST shipments/:id/waybills`) → 합류 → 출력.
작업자에게는 한 동작이다.

## 8. 이탈과 되돌림

**입구:** 기존 `DELETE outbound-batches/:batchId/shipments/:shipmentId {reason}`(`excludeShipment`) 하나. 시작 전 배치면 지금처럼
즉시 `excluded`, 시작 후면 이탈. 앱: 송장 스캔 화면·배치 카드의 「이 박스 빼기」(사유 필수).

**이탈 = 목표를 0 으로:**

1. 작업 항목 `withdrawing`, `exit_to` 결정 — 운영자 제외 `draft`(배치 전 풀로), 전체 취소 `canceled`
2. `reconcileAllocation` 이 **집지 않은 몫을 즉시 `HAND_BACK`** — 일반 재고로 돌아간다. 집은 것이 없으면 이 트랜잭션에서 `excluded`
3. 집은 몫은 배정이 남아 «뺄 물건 남음»(I2) — 포장·검수·발송이 막힌다

**집은 물건 되돌리기(S1 §5.3·§5.4·§6.3):**

- 송장 스캔 → «빠진 박스 · 뺄 상품» → 상품 스캔 1회 = `REMOVE_TO_RETURN_BIN`(줄 귀속 보관 1 → 바구니, 배정 −1). I5 를 받지 않는다
- 배정이 0 이 되는 트랜잭션에서 `excluded`, 박스는 `exit_to` 로. 앱은 «송장은 버리세요»
- 되돌림 바구니: `return_bins`(창고, 바코드 `RB-` CHECK, 폐기 시각). PC 마다 «내 바구니»를 한 번 스캔해 기억(기기별 설정)
- **되돌림 적치 화면(신규):** 바구니 스캔 → 상품 · 원래 로케이션 · 수량 → 상품 스캔 → 로케이션 스캔. 원래 로케이션만
  (`RETURN_LOCATION_MISMATCH`). 적치 = `PUTAWAY_RETURN`, 세션 통제가 풀려 일반 재고
- 세션은 바구니까지 비어야 닫힌다. 배치 작업이 끝나도 세션은 되돌림 적치를 기다릴 수 있다
- 피킹 방식별 차이는 «되돌림 스캔 지점»과 «단계 되돌리기(`reconcileStage`)» 두 hook 뿐(S1 §5.4, 토탈피킹 카트 여분 포함)

**송장:** `draft` 로 간 박스는 송장 번호가 유효하다(내용 불변). 다른 배치에 들어가면 배정이 새로 생겨 지문이 달라지므로
자동으로 재출력 대상이 된다. `canceled` 는 기존 취소 경로대로 송장을 무효화한다.

**전체 취소 연결(E10):** `shipment-planning.service.ts` 의 취소 처리에서, 시작된 배치의 박스가 전체 취소되면
`CANCEL_REPLAN_PENDING` 표시 대신 이탈(`exit_to = canceled`)을 부른다. 부분 취소 경로는 건드리지 않는다(E11).

## 9. 결품 재배정 (S1 D9 + E12)

1. 작업자가 로케이션 L 에서 줄 X 가 k 개 모자람을 보고(기존 `POST shipments/:shipmentId/short-picks`)
2. 부족 승인(`APPROVE_SHORTAGE`, 원장 처리 기존대로), L 의 배정 −k
3. `reconcileAllocation`: 목표(줄 수량) 그대로 → **다른 로케이션의 일반 가용재고로 k 를 다시 채운다**(§6 규칙, `HAND_IN`)
4. 채워지면 박스는 남는다. 지문이 바뀌어 I5 가 막고, 앱은 «송장이 바뀌었습니다 · 바뀐 줄» + 재출력(새 종이에 판차)
5. 못 채우면 이탈(`exit_to = draft`, §8), 부족분 예약은 기존대로 무효화(`invalidateForShortPick`), 집은 물건은 되돌림 바구니

E12 의 결과: 3 단계의 «일반 가용»에는 아직 배치에 안 들어간 주문의 (창고 단위) 예약분도 들어 있다. 채운 만큼 창고 가용이
음수가 될 수 있고, 그 모자람은 다음에 그 SKU 로 시작·합류하는 박스에서 `STOCK_SHORT` 로 드러난다. 판매 가능 수량이
0 으로 보이는 것은 지금 결품 처리와 같다.

사라지는 것: `short_pick_recovery` 작업 항목 상태의 생산자, «격리 → 은퇴 → 초안 복귀»(`resumePending`) 경로.
상태 값 자체의 제거는 contract 단계(§11).

## 10. 송장

### 10.1 렌더러 (`WaybillLabelManager.render`, 한 트랜잭션)

1. 지금처럼 `assertDispatchable` + `assertContextMatchesWaybill`
2. **활성 작업 항목과 배정을 읽는다**(로케이션 코드·SKU 명 조인, 수량 > 0). I4 를 어기면 `409`, 메시지 접두어
   `WAYBILL_LABEL_NOT_ALLOCATED:` (앱 파서 규약 — `native/warehouse-app/src/domains/outbound/waybillLabel.ts` 의 `WAYBILL_[A-Z_]+:`)
3. 품목 줄 = **(로케이션, SKU) 로 묶은 배정 행**, 로케이션 코드 순 → SKU 명 순. 이름 앞에 `[<로케이션 코드>]`.
   이름 칸 폭은 `fsItemNameMaxWidthMm` 에서 접두어 폭을 뺀다(`label-items.ts` 가 합치기 단위를 SKU → (로케이션, SKU) 로 바꾼다)
4. 판차가 2 이상이면 종이에 `N판` 을 찍는다(위치는 FS 템플릿 계획에서 실측으로 정한다)

### 10.2 지문

- 템플릿 입력 타입을 둘로 나눈다: **`HanjinLabelContent`**(송장 번호, 택배사 분류 필드, 수령인·배송 메시지, 품목 줄 …)와
  출력 시점 값(`printedDate`, 판차). `HanjinLabelData = HanjinLabelContent & { printedDate, revision }`
- `labelFingerprint(content: HanjinLabelContent): string` — 정규화 JSON 의 SHA-256. **내용 타입만 받으므로 날짜가 섞일 수 없다**
  (타입이 지킨다)
- 그리는 입력과 비교하는 입력이 같은 객체에서 나오므로 둘이 어긋나지 않는다
- 공동현관 비밀번호가 바뀌면 지문도 바뀐다 — 종이가 달라지므로 맞다
- NS·NL 형은 품목 줄을 그리지 않지만 지문에는 품목 줄이 들어간다. 그 형에서는 같은 종이를 한 번 더 뽑게 될 뿐 해가 없다. 운영은 FS 형

### 10.3 출력 기록

- `waybill_label_prints`: `shipment_id`, `fingerprint`, `revision`, `items_snapshot`(JSON, «바뀐 줄» 표시용), `printed_by`, `printed_at`.
  유니크 (`shipment_id`, `fingerprint`), 유니크 (`shipment_id`, `revision`)
- 렌더 응답(`WaybillLabelResponseDto`)에 `fingerprint`·`revision` 을 싣는다. 판차 = 같은 지문의 기록이 있으면 그 번호,
  없으면 최대 판차 + 1(첫 판 1). GET 이라 계산만 하고 쓰지 않는다
- 앱은 프린터 전송 성공 **뒤에만** `POST shipments/:shipmentId/waybill/label-prints {fingerprint}`
  - 서버는 현재 지문과 같을 때만 기록. 다르면 `409 LABEL_CONTENT_CHANGED` → 앱이 다시 렌더
  - 같은 지문의 동시 확인은 유니크 키로 한 행 — 같은 판차
- 알고 남기는 위험: 전송은 성공했는데 용지가 걸린 경우. 재출력 버튼으로 대응한다

### 10.4 게이트 (I5)

- `LabelCurrencyGuard.assertCurrent(workItemId, trx)`: 현재 지문 계산(§10.1 과 같은 조립 함수) → 마지막 출력 기록과 비교 →
  다르거나 없으면 `409 LABEL_REPRINT_REQUIRED`
- **전진 명령의 공통 진입점에만** 건다: 피킹 스캔(세 방식이 모두 지나는 진입), 포장 완료·검수, 발송. 정확한 진입점 목록은
  PR 1 계획이 코드에서 도출해 적고, 가드 스펙이 «전진 명령은 이 가드를 거친다»를 검사한다
- 되돌림 명령(`REMOVE_TO_RETURN_BIN`·`PUTAWAY_RETURN`)은 대상이 아니다 — 빼는 일에 종이는 필요 없고, 막으면 이탈이 끝나지 않는다
- 조립은 한 함수로 둔다: 렌더러·게이트·출력 확인이 모두 같은 «현재 내용 조립»을 부른다

### 10.5 송장 스캔 (조회 전용)

- 기존 `GET shipments/by-waybill` 응답에 `labelState` 를 더한다

| `labelState` | 뜻 | 앱 화면 |
| --- | --- | --- |
| `current` | 최신 판이 출력됨 | 평소 작업 |
| `never_printed` | 배정은 있으나 출력 기록 없음 | 출력(프린터 있음) / «프린터 있는 자리에서 출력» |
| `reprint_required` | 지문이 바뀜. 마지막 출력 스냅샷과 현재 품목 줄의 차이를 싣는다 | «송장이 바뀌었습니다 · 바뀐 줄» + 재출력 |
| `not_started` | 배치가 시작 전 | «배치 화면에서 작업 시작» |
| `withdrawing` | 이탈 중, 뺄 상품 목록 포함 | 뺄 상품 → 되돌림 바구니 |
| `withdrawn` | 이탈 완료 | «빠진 박스입니다, 송장은 버리세요» |

- 몇 번을 어느 PC 에서 스캔해도 같은 결과. 스캔은 아무것도 바꾸지 않는다
- 앱의 화면 판정(`labelState` → 화면)은 순수 함수로 두고 표 테스트
- 배치 카드에 «재출력 필요 N». 일괄 인쇄의 「실패·미인쇄만 다시」가 `never_printed`·`reprint_required` 를 대상으로 삼는다

## 11. 스키마

전부 추가형(`migrate → deploy`). 각 PR 이 자기 몫만 더한다(§15).

| 대상 | 변경 | PR |
| --- | --- | --- |
| `waybill_label_prints`(신규) | §10.3 | 1 |
| `picking_source_allocations` | CHECK `qty >= 0`. 행은 지우지 않고 0 으로 | 2 |
| 세션 이벤트 `event_type` | `HAND_BACK`. 모든 새 이벤트 payload 에 `workItemId`·`allocationId` | 2 |
| `batch_inventory_sessions` | `handed_back_qty`(기본 0), 보존식 CHECK 갱신(S1 §4.3-4) | 2 |
| `outbound_batch_work_items` | 상태 `withdrawing`, `exit_to`(`draft`\|`canceled`, `withdrawing` 일 때만 NOT NULL CHECK). 활성 부분 유니크는 `withdrawing` 을 활성으로 센다(기존 `NOT IN ('completed','excluded')` 그대로 성립) | 3 |
| 세션 이벤트 `event_type` | `REMOVE_TO_RETURN_BIN`, `PUTAWAY_RETURN` | 3 |
| `batch_inventory_session_balances` | `RETURN_PENDING` 의 키를 바구니로: `custody_ref` NOT NULL, `source_location_id` NOT NULL, `shipment_line_id` NULL(CHECK). 이벤트 테이블의 from/to CHECK 도 같게 | 3 |
| `batch_inventory_sessions` | `returned_qty` 의미를 되돌림 적치(`PUTAWAY_RETURN`) 합으로 좁힌다(S1 §4.2) | 3 |
| `return_bins`(신규) | 창고, 바코드(`LIKE 'RB-%'` CHECK), 폐기 시각 | 3 |

- 🔴 **enum 함정:** drizzle migrate 는 전 마이그를 한 트랜잭션으로 돈다. `ADD VALUE` 한 값을 같은 실행의 CHECK·기본값·데이터에
  쓰면 실패한다. CHECK 는 `::text` 캐스팅으로 쓴다(`ck_outbound_batches_cart_capacity` 선례)
- contract(별도, 이 스펙의 PR 이 아님): `short_pick_recovery` 상태 제거, S1-A 의 계획 테이블·`plan_id` 삭제(S1 §11 PR 2)

## 12. 오류 코드

| 코드 | 언제 | 결과 |
| --- | --- | --- |
| 시작·합류 실패 상세 `INBOUND_PENDING`·`STOCK_SHORT`·`WAYBILL_NOT_READY` | §6 | 무변경, 박스·SKU·수량 목록 |
| 준비 차단 사유 `BATCH_NOT_STARTED` | 시작 안 된 배치의 송장 스캔·출고 준비 | 앱 «작업 시작 먼저» |
| `WAYBILL_LABEL_NOT_ALLOCATED` | I4 위반 렌더 | 409 |
| `LABEL_CONTENT_CHANGED` | 출력 확인의 지문이 현재와 다름 | 409, 앱 재렌더 |
| `LABEL_REPRINT_REQUIRED` | I5 | 409, 앱 재출력 화면 |
| `BATCH_NOT_JOINABLE` | 완료·취소된 배치에 합류 | 거절 |
| `BOX_HAS_PICKED_ITEMS` | PR 2 에서만: 집은 몫이 있는 박스의 이탈(PR 3 이 이탈로 대체) | 거절 |
| `BOX_EXCESS_PENDING` | 뺄 물건이 남았는데 포장 완료·검수·발송 | 거절 + 뺄 목록 |
| `SHIPMENT_WITHDRAWN` | 이탈 완료 박스의 전진 명령 | 거절 |
| `RETURN_LOCATION_MISMATCH` | 되돌림 적치 위치 ≠ 원래 위치 | 거절 |
| `RETURN_BIN_UNKNOWN` | 미등록·폐기된 바구니 | 거절 |

HTTP 형식은 주변 관례를 따른다: fulfillment 는 `ConflictException({ code, message })`, waybill 은 메시지 접두어 `CODE:`.

## 13. 동시성·멱등·복구

- 박스에 닿는 모든 연산(합류·이탈·스캔·결품·되돌림·출력 확인)은 **작업 항목 행 잠금**에서 줄을 선다
- 배정을 늘리는 연산(시작·합류·결품 재배정)은 SKU 별 가용 잠금(`acquireStockAvailabilityLock`)을 거친다 — 서로, 그리고 다른 배치의 시작과 같은 재고를 두고 다투지 않는다
- 잠금 순서는 기존 규칙: 박스 → 줄 → 예약 → 작업 항목 → 세션 → 보관·위치(id 순)
- 모든 명령은 `FulfillmentCommandService` 멱등 키. 세션 이벤트 멱등 키에 연산 id·작업 항목 id·배정 id
- 트랜잭션 밖은 택배사 호출(송장 발급, 앱이 합류 전에 부름)과 프린터 전송뿐이다
- 복구(`batch-session-recovery.service.ts`): 배정마다 «이벤트 합 = 현재 배정», 보관 grain 이 그 배치의 작업 항목 배정에 속함
- `FulfillmentInvariantService` 에 I2·I3·I4 검사

## 14. 테스트

| 층 | 대상 |
| --- | --- |
| 순수 함수(기본 게이트) | `allocateLines` — E8 정책, 결정성, 모자란 줄 **전부** 보고, `INBOUND_PENDING`/`STOCK_SHORT` 구분. `reconcileAllocation` — 작은 범위(목표 0~3, 방식 3, 보관 위치 조합) **전수 열거**로 모든 출력이 불변식 I2·I3 을 지키는지(표 순회, `fast-check` 미도입). `labelFingerprint` — 결정성·민감도(품목 줄·수령인·송장 번호는 바꾸면 달라지고, 출력 시점 값은 타입상 못 들어옴). 품목 줄 묶기·정렬. 앱 `labelState` 화면 판정 |
| 가드 스펙 | `prepare` 가 배치를 시작하지 않는다. 전진 명령 진입점이 `LabelCurrencyGuard` 를 거친다 |
| 통합(`describeIfDb`, `--runInBand`) | 시작(성공·사유별 실패·전부 아니면 전무) · 합류(성공·부족 무변경·다른 박스 배정 불변) · 이탈(집기 전 즉시, 집은 뒤 되돌림) · 결품(채움·못 채움) × 세 방식. 출력 확인 경합, 게이트, 전체 취소 → 이탈. **모든 시나리오 끝에 불변식 검사기** |
| warehouse-app | 화면 판정 순수 함수. 배선은 로컬 E2E 사람 스모크 체크리스트(PR 마다) |

## 15. PR 분할과 경계 계약

각 PR 사이에 배포 한 번. PR 은 앞 PR 이 머지·배포된 develop 위에서 시작한다. **각 PR 은 core 와 warehouse-app 을 함께 바꾸고
함께 배포한다** — 앱이 core 의 새 계약을 모르면 현장이 막힌다.

### PR 1 — 시작과 송장

- **범위:** §6 전부(명시적 시작, E8 배정 규칙, 실패 사유 전부 보고, 지연 시작 제거, `BATCH_NOT_STARTED`). §10 전부(렌더러의 로케이션·I4,
  지문, `waybill_label_prints`, 출력 확인 API, I5 게이트, `labelState` 중 `current`·`never_printed`·`reprint_required`·`not_started`).
  앱: 「작업 시작」 버튼·시작 실패 화면, 인쇄 뒤 출력 확인, 재출력 화면, «재출력 필요 N», 판차 표기
- **끝나면 성립:** I1~I5. 출력되는 모든 송장에 로케이션이 찍힌다. 배치는 「작업 시작」으로만 시작된다
- **아직 안 하는 것:** 시작된 배치에 넣기는 여전히 `OUTBOUND_BATCH_ALREADY_STARTED`. 시작된 배치의 제외는 지금 동작 그대로.
  결품은 지금 동작 그대로(박스 이탈). `reconcileAllocation` 은 아직 없다 — 시작은 `allocateLines` 로 충분하다
- **다음 PR 이 기대는 것:** `allocateLines`(E8·전부 보고), 실패 사유 표, `LabelCurrencyGuard`, 현재 내용 조립 함수, `labelState`
- **배포 전 확인:** 라이브에 시작 전·후 배치가 쓰이고 있는지(현재 라이브 출고는 셀메이트 수기이고 warehouse-app 출고는 컷오버 #923 전이다 —
  배포 시점에 다시 확인). 시작된 배치의 박스가 있으면 출력 기록이 없어 I5 에 막힌다 → 재출력으로 풀린다

### PR 2 — 합류와 집기 전 이탈

- **범위:** `reconcileAllocation`(순수) + `BoxAllocationManager`. §7 전부(E9 포함). §8 중 **집은 몫이 없는 박스의 이탈**(`HAND_BACK` 으로 즉시
  `excluded`). 스키마 PR 2 행. 앱: 「이 배치에 넣기」(발급 → 합류 → 출력), 「이 박스 빼기」
- **끝나면 성립:** 시작된 배치에 박스를 넣고 뺄 수 있고, 다른 박스의 배정·지문은 변하지 않는다
- **아직 안 하는 것:** 집은 몫이 있는 박스의 이탈은 `BOX_HAS_PICKED_ITEMS` 로 거절. `withdrawing` 상태 없음. 전체 취소 연결 없음
- **다음 PR 이 기대는 것:** `reconcileAllocation`, `BoxAllocationManager` 의 합류·반납, `HAND_BACK` 이벤트

### PR 3 — 되돌림과 집은 뒤 이탈

- **범위:** §8 나머지(`withdrawing`·`exit_to`, `REMOVE_TO_RETURN_BIN`, `return_bins`, 되돌림 적치 화면, `PUTAWAY_RETURN`, 방식별 hook,
  토탈피킹 카트 여분), 전체 취소 → 이탈(E10). `labelState` 의 `withdrawing`·`withdrawn`. 스키마 PR 3 행. 앱: 뺄 상품 화면,
  기기별 되돌림 바구니 설정, 되돌림 적치 화면
- **끝나면 성립:** 어떤 박스든 뺄 수 있다. 시작된 배치 박스의 전체 취소가 영원히 대기하지 않는다. `BOX_HAS_PICKED_ITEMS` 는 사라진다
- **아직 안 하는 것:** 결품 재배정. 부분 취소(E11)
- **다음 PR 이 기대는 것:** 이탈(`exit_to = draft`)과 되돌림 흐름 전체

### PR 4 — 결품 재배정

- **범위:** §9 전부. `short_pick_recovery` 생산자 제거, `resumePending` 경로 대체. 앱: 결품 보고 뒤 «송장이 바뀌었습니다» 재출력 흐름
- **끝나면 성립:** 성공 기준 1~6 전부
- **남는 것:** §16

## 16. 범위 밖과 알고 남기는 틈

- **부분 취소·박스 내용 변경(S2):** 시작된 배치 박스의 부분 취소는 여전히 `CANCEL_REPLAN_PENDING` 대기. 내용 변경 시 송장 재발급·재구동 워커도 S2
- **배정 전략 고도화:** 동선·오래된 재고 먼저 등. `allocateLines` 한 곳만 바꾼다
- **배치 구성 단계 미리보기(E7 기각안):** 필요하면 `allocateLines` 를 읽기 전용으로 부르는 화면으로 붙인다
- **로케이션 종류 필터:** 지금 배정은 `ON_HAND` 면 어느 로케이션이든 쓴다(입고 기본존의 적치 대기가 아닌 몫 포함). 송장에 그 로케이션이 그대로 찍히므로 숨은 오류는 아니다. 막을 필요가 보이면 별건
- **용지 걸림:** 전송 성공 뒤 실물 출력 실패는 출력 확인으로 못 잡는다(§10.3)
- **E12 의 이동한 모자람:** 결품으로 채운 만큼 다음 시작에서 `STOCK_SHORT` 가 난다. 그 주문을 먼저 알리는 장치는 없다
