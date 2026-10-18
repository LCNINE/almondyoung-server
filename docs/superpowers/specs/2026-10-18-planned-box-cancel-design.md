# 계획된 상자의 취소 — 시작된 배치 밖이면 그 자리에서 끝낸다 (#1016 30·33번)

2026-10-18 develop `e463b4a2d` 코드 기준. 라이브 실측 없음.

## 1. 왜

판매주문 취소는 상자마다 `ShipmentPlanningService.cancelOutstanding` 을 부른다. 이 함수가 즉시 끝내는 건 **막힘 없는 draft 상자뿐**이다.
`requiresDurableReplan` 의 첫 줄이 `status !== 'draft' → true` 라서(`shipment-planning.service.ts:1464`), planned 상자는
무조건 «취소 대기»(`recovery_required` + `CANCEL_REPLAN_PENDING`)로 간다. draft 상자도 활성 송장이 있으면 같은 대기로 간다.
대기를 푸는 신호는 «상자의 작업 항목이 배치에서 빠짐» 하나뿐이다(`outbound-batch-orchestrator.service.ts:412` → `resumeWaitingOperation`).
그런데 판매주문은 같은 트랜잭션에서 `cancelled` 가 되고 `SalesOrderCancelled` 가 나간다(`sales-orders.service.ts:1936-1969`).

**송장 사실 둘이 이 그림을 정한다.**

- 배치에 들어가려면 상자에 `registered`·`used` 송장이 있어야 한다(`assertEligible` → `waybills.assertDispatchable`, `outbound-batch-orchestrator.service.ts:1186`, `waybill.manager.ts:397-425`). 배치 시작도 다시 확인한다.
- 송장 출력은 **시작된 배치**의 상자만 된다(`waybill-label-content.assembler.ts:37-38` `LABEL_NOT_ALLOCATED`). 즉 시작된 배치 밖의 상자에는 **붙은 실물 송장이 없다** — 송장은 있어도 번호와 한진 접수뿐이다.

그래서 함정이 둘이다.

1. **배치 밖 planned 상자** — 빠질 배치가 없으니 영원히 대기한다. 상자와 확정 예약이 남아 재고를 붙잡는다(유령 예약). #1016 30번의 원래 내용이다.
2. **시작 전 배치 안의 상자** — 작업 항목이 대기 취소를 가리키게 되고(`markActiveWorkItemWaitingForCancellation`), 상자는
   `recovery_required` 가 된다. 배치 시작은 «안의 상자가 전부 planned»여야 하므로(`allocation.locks.ts:177-182`
   `PICKING_SHIPMENT_NOT_ELIGIBLE`) **그 배치 전체가 시작되지 않는다.** 손으로 빼는 길도 막혀 있다 — 시작 전 배치에서 빼기(`excludeShipment`,
   `:374-395`)는 송장을 건드리지 않는데, 그 뒤의 재개(`resumePendingCancellation`)는 활성 송장이 있으면 `SHIPMENT_ACTIVE_INVOICE` 로 거절한다
   (`shipment-planning.service.ts:777`, `shipment-aggregate.ts:207-219`). 운영자가 송장을 먼저 무효화해야만 풀린다.

반면 **시작된 배치**의 전량 취소(E10)는 이미 `registered` 송장을 로컬 무효화하고 상자를 내보낸다(`withdrawalTarget` → `exitWaybill`,
`box-withdrawal.service.ts:258-285`). 덜 진행된 상자가 더 진행된 상자보다 취소가 막히는 비대칭이다. 2026-09-29 출고 실배정 스펙
(`2026-09-29-outbound-live-allocation-design.md` §2·§7.1)이 이 «영원히 대기» 경우들(배치 밖 planned·송장만 있는 상자·합포장 대상)을
결함으로 적고 `CANCEL_REPLAN_PENDING` 자체를 없애려 했는데, 구현은 시작된 배치(E10)까지만 갔다.

33번은 같은 자리의 고객 쪽 얼굴이다. 처음 적은 «draft 이후 403»은 `b96ac7f04` 에서 사라졌다 — 고객 셀프취소는 취소 요청 경로
(`ChannelCancelRequestManager`)를 거쳐 시스템 actor(`roles: ['master']`)로 취소한다. 지금 남은 불일치는 둘이다.

- **planned·송장 있는 상자가 있는 주문의 셀프취소가 «성공»하고 위 함정에 빠진다.** FO 가 `ready` 라 버튼이 보인다(`isPickingStarted` 는 `processing` 만 본다).
- **복구 중 상자(`recovery_required`)가 있으면 버튼은 보이는데 서버가 409 를 낸다.** 버튼 판정(`buildActionsView`, `store-sales-orders.service.ts:817-877`)과
  서버 사전 검사(`processCancelRequest`, `:918-946`)가 같은 조건을 두 벌로 들고 있고, 둘 다 복구 중 상자를 보지 않는다. 서버는 그보다 뒤인
  `cancelOutstanding` 에서 `SHIPMENT_RECOVERY_IN_PROGRESS` 로 거절한다(`shipment-planning.service.ts:580-582`).

**왜 지금:** 한진 실계약번호를 받아(2026-10-18) 셀메이트 폐기 컷오버(#923)가 가까워졌다. 컷오버 전 라이브에는 planned 상자가 없어
(2026-09-25 `delivery_profiles` 0행) 이 경로가 한 번도 돌지 않았다. 컷오버 첫날 하루 200건 안팎에 취소가 섞이면 바로 부딪힌다.

## 2. 목표

- **시작된 배치 밖**의 상자(draft·planned, 시작 전 배치 안 포함) 취소는 그 자리에서 끝난다. 송장이 `registered` 면 같은 트랜잭션에서 로컬 무효화하고,
  시작 전 배치에 들어 있으면 배치에서 뺀다. 예약도 같은 트랜잭션에서 풀린다. 배치의 나머지 상자는 그대로 시작할 수 있다.
- 그래도 대기로 가는 상자(§4.1 의 «막힘»)는 막힘이 풀리면 **리컨실러가 재개한다.**
- 고객 셀프취소 버튼은 **서버가 받을 때만** 보인다. 버튼 판정과 서버 사전 검사가 **한 함수**를 쓴다.

## 3. 하지 않는 것

- **무효화할 수 없는 송장(`pending`·`allocated`·`used`)은 건드리지 않는다.** 막힘으로 남고 대기 → 규칙 재개로 간다. `pending`·`allocated` 는 발급 중인 짧은 틈이고, `used` 는 발송 때 찍히므로(`shipment-dispatch.service.ts:836`) 발송된 상자에만 있다.
- **시작된 배치의 취소(E10 이탈, 일부 취소의 대기)는 그대로다.** 집은 물건을 되돌리는 흐름이 따로 있다.
- **`CANCEL_REPLAN_PENDING` 을 통째로 없애지 않는다.** 09-29 스펙 §7.1 의 나머지(시작된 배치의 일부 취소를 «줄만 줄이기»로)는 이 작업 밖이다.
- **배치 시작의 «전부 아니면 전무»(#986 의도)는 그대로다.** 시작을 느슨하게 하지 않고, 취소가 상자를 미리 빼서 풀게 한다.
- **18번 자동 계획은 하지 않는다.** 일부 취소된 planned 상자는 draft 로 돌아가 다시 계획해야 한다(지금 대기 → 재개가 하는 것과 같다).
- **스토어프론트는 바꾸지 않는다.** 새 거절 사유는 기존 값 `already_processing` 을 쓴다(문구·i18n 이 이미 있다).
- **운영자 화면의 409 문구(#1003)는 이 작업 밖이다.**

**이러면 실패다:** 붙은 실물 송장이 있는 상자(시작된 배치)의 송장을 무효화하는 것. 집은 물건·보관(custody)·검수 수량이 있는 상자를 즉시 취소해
재고 원장이 실물과 갈리는 것. 셀메이트가 출고한 주문(판매주문 `shipped`·`delivered`)의 상자를 규칙이 건드리는 것. 버튼이 사라졌는데 서버는 받는 것(반대 방향 불일치).

## 4. 정한 것

### 4.1 취소 갈래

`cancelOutstanding` 이 상자 하나를 받았을 때. 위에서부터 처음 맞는 줄로 간다.

| 상자 | 조건 | 결과 |
|---|---|---|
| `shipped`·`in_transit`·`delivered` | — | 지금처럼 409 `SHIPMENT_ALREADY_DISPATCHED` |
| `canceled`·`superseded` | — | 지금처럼 409 `SHIPMENT_NOT_ACTIVE` |
| `recovery_required` | — | 지금처럼 409 `SHIPMENT_RECOVERY_IN_PROGRESS` |
| 시작된 배치의 활성 작업 항목 | 전량 취소 + 이탈 가능 | 지금처럼 E10 이탈(`withdrawalTarget`) |
| 시작된 배치의 활성 작업 항목 | 그 밖(일부 취소 등) | 지금처럼 대기 |
| draft·planned (시작된 배치 밖) | **막힘 있음** | 대기(`CANCEL_REPLAN_PENDING`) — 아래 «막힘» |
| draft·planned (시작된 배치 밖) | 막힘 없음 | **새로:** ① 시작 전 배치의 작업 항목이 있으면 `excluded`(사유 = 취소 사유) ② `registered` 송장이 있으면 로컬 무효화(E10 과 같은 `waybills.void`, 사유 `canceled`) ③ planned 면 draft 로 되돌림(`plannedAt` 비움) ④ 지금의 draft 즉시 취소. 전량이면 `canceled`, 일부면 `draft` 로 남는다 |

**막힘**(시작된 배치 밖 상자에서): 무효화할 수 없는 활성 송장(`pending`·`allocated`·`used`) · 검수 수량(`inspected_qty > 0`) · 정산 안 된 보관.
뒤의 둘은 세션이 시작돼야 생기므로 시작된 배치 밖에선 나오지 않는다 — 방어선으로만 둔다. 시작 전 배치에서 빼는 조건(`assertExcludable`)도
같은 이유로 늘 통과하지만, 빼기 직전에 그대로 부른다.

**«완료된 합포장의 대상»은 막힘에서 뺀다.** 지금 `requiresDurableReplan` 은 이걸 막힘으로 보지만, 한 번 참이면 영원히 참이고 재개(`resumePendingCancellation`)는
이 조건을 보지 않는다 — 막힘이 아니라 «재개 신호가 올 때까지의 지연»이었다. 09-29 스펙 §2 가 이걸 «영원히 대기» 결함으로 적었다.
합포장된 상자도 다른 상자처럼 줄을 줄이거나 취소한다. *(내 판단)*

**송장 로컬 무효화**는 한진 쪽 접수를 취소하지 않는다(`waybills.void` 는 트랜잭션 안 로컬 처리). 시작된 배치의 E10 이 이미 같은 일을 한다 —
붙은 실물이 없으니 집화될 소포도 없다. *(내 판단, E10 선례를 따름)*

**권한:** 시작된 배치 밖 planned 상자를 즉시 취소할 때도 지금 대기 갈래와 같이 `SHIPMENT_REOPEN` 스코프를 요구한다 — planned 를 draft 로
되돌리는 일이라 권한의 뜻이 같다. 고객 셀프취소와 채널 취소는 시스템 actor 라 통과한다. *(내 판단)*

**일부 취소된 planned 상자가 draft 로 돌아가는 것**은 지금 대기 → 재개가 하는 결과와 같다(`applyPendingCancellation` 이 draft 로 되돌린 뒤 취소한다).
planned 그대로 줄만 줄이는 길은 택하지 않는다 — 줄이기(`shrinkDraftLines`)가 draft 전제로 쓰였고 예약 재계산·불변식 검사가 그 전제를 따른다. *(내 판단)*

### 4.2 재판정 규칙 — 대기 취소 재개 (#1016 30번)

§4.1 뒤에도 대기로 가는 상자가 남는다: 송장 발급 중(`pending`·`allocated`)인 상자, 시작된 배치의 일부 취소, 이 작업 전에 대기로 간 상자.
앞의 것은 송장이 `registered`·`failed` 로 굳어도 재개 신호가 없다. 25번 규칙(`resume-pending-consolidation.rule.ts`)과 같은 틀로 규칙 하나를 더한다.

- 이름 `resume-pending-cancellation`, `row = 30`, 대상 상자, 칸 `{ stage: 'cancel', states: ['CANCEL_REPLAN_PENDING'] }`
- **실행 모드로 배포한다** — #1016 «관찰 모드 규칙»의 컷오버 예외다(2026-10-18 결정). 이 규칙이 다루는 상태(planned 이후 상자의 대기 취소)는
  core 출고가 돌기 전엔 라이브에 생기지 않아 관찰해도 후보가 0이고, 컷오버 첫 주에 관찰 → 전환을 배치마다 하나씩 하면 규칙이 가장 필요할 때 사람이 푼다.
  규칙이 하는 일은 이미 요청된 취소를 끝내는 것뿐이고 기존 신호 경로와 같은 `resumePendingCancellation` 을 부른다. 안전망은 §6 통합 스펙과
  배포 전 대상 건수 확인(§5)이다. 레지스트리에 한 줄 더한다.
- **재개가 §4.1 의 «막힘 없음» 갈래와 같은 손질을 한다.** `resumePendingCancellation` 이 지금 «활성 송장 없음»을 요구하는 대신, 시작된 배치 밖이면
  시작 전 배치 작업 항목 빼기 + `registered` 송장 무효화를 한 뒤 적용한다. 그래야 손으로 뺀 경우(§1 함정 2)도 풀린다. 시작된 배치의 활성 작업 항목이
  있으면 지금처럼 기다린다(그 상자는 배치에서 빠질 때 기존 신호로 재개된다).
- `check`: 정비 모드가 아니고, 그 상자를 원본으로 하는 `pending` 취소 오퍼레이션이 있고, 위 손질 뒤 남는 막힘이 없다.
- `act`: 재개 → 완료면 `acted`, 막힘이 그새 생겼거나 이미 끝났으면 `noop`.
- 재개 가능 여부를 예외 없이 묻는 읽기 함수가 `ShipmentPlanningService` 에 필요하다 — 합포장의 `resumeReadiness` 와 같은 모양으로. `fingerprint` 는 오퍼레이션 id + 막힘 목록.
- **틀의 제외 목록을 넓히지 않는다.** 틀이 빼는 주문은 `external_shipped`(셀메이트 출고)·`return_exchange` 뿐이다(`order-reconcile.subject.ts:12`).
  채널 취소 정산 중(`cancel_settle`) 주문은 일부러 통과한다 — 셀프취소가 `settling` 취소 요청 행을 만들므로(`channel-cancel-request.manager.ts:200-217`)
  이 규칙의 주 대상이 바로 그 주문들이다.

### 4.3 25번 규칙도 실행 모드로

`resume-pending-consolidation.rule.ts` 의 `mode` 를 `'act'` 로 바꾼다 — 같은 컷오버 예외다. 2026-10-10 관찰 모드 배포 뒤 후보가 0건이었고,
합포장 대기 상자도 core 출고 전엔 생기지 않아 관찰을 이어도 증거가 생기지 않는다. «전환은 규칙마다 따로»는 누가 무엇을 움직였는지 가리려는
규칙인데, 두 규칙은 다른 복구 코드(`CONSOLIDATION_PENDING`·`CANCEL_REPLAN_PENDING`)를 보고 상자는 복구 코드를 하나만 가지므로 같은 상자를
연달아 움직이지 않는다. 이 PR 의 커밋 하나로 한다.

#1016 이 전환 조건으로 적어 둔 «관찰된 작업 하나를 손으로 재개해 `completed` 확인»(check 가 덮지 않는 재개 사전조건)은 후보가 없어 할 수 없다.
그런 사전조건에 걸리면 `act` 가 예외로 끝나고, 틀이 그 상자를 오류로 적어 물러섰다가 5회 뒤 자동 멈춤으로 정체 보드에 올린다
(`order-reconcile.state.ts` `MAX_ATTEMPTS`). 재개는 한 트랜잭션이라 반쯤 바뀐 상자는 남지 않는다.

### 4.4 셀프취소 판정 하나 (#1016 33번)

버튼 판정과 서버 사전 검사를 **순수 함수 하나**로 옮긴다. 입력은 이미 읽어 둔 사실들이고 출력은 `StoreCancelUnavailableReason | null`.

| 순서 | 사실 | 사유 |
|---|---|---|
| 1 | 판매주문 `cancelled` | `already_cancelled` |
| 2 | 출고 증거(`hasShippedEvidence`) | `already_shipped` |
| 3 | 채널 주문(`salesChannel !== 'medusa'`) | `channel_order` |
| 4 | 피킹 시작(FO `processing`) | `already_processing` |
| 5 | **새로:** 활성 상자 중 `recovery_required` 가 있음 | `already_processing` |
| 6 | 다운로드한 디지털 상품 | `digital_downloaded` |

- `timeout` 은 지금처럼 버튼도 사유도 없이 끝낸다(함수 밖).
- 순서는 지금 `buildActionsView` 의 순서를 따른다. 지금 서버는 출고 증거를 채널보다 늦게 본다 — 함수를 쓰면 서버도 위 순서가 된다. 어느 쪽이든 거절이라 결과는 같고 문구만 갈린다.
- `processCancelRequest` 는 사유를 받아 지금 문구 그대로 `BadRequestException` 을 던진다. 5번의 새 문구: «처리 중인 주문이라 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.»
- **인쇄 거절은 이 함수에 넣지 않는다.** 버튼은 지금처럼 «와우프레스가 인쇄 취소를 거절했고 인쇄 말고 취소할 상품이 없으면» 숨기고,
  서버는 지금처럼 인쇄 취소 단계에서 `PrintInProductionError`·`PrintPartialCancelAvailableError` 로 답한다 — 스토어프론트가 이 코드로 «인쇄 빼고 취소» 두 번째 요청을 한다.
- 4.1 이후로 시작된 배치 밖 상자는 셀프취소를 막지 않는다 — 그 자리에서 취소되거나(대부분), 송장 발급 중이면 대기 → 규칙 재개로 간다.
  시작된 배치의 상자는 FO 가 `processing` 이라 4번이 막는다. 그래서 5번만 더하면 버튼과 서버가 맞는다.

## 5. 배포

- **마이그 없다.** 규칙 상태는 기존 `shipment_reconcile_state`(규칙 이름은 varchar)에 쌓인다.
- 한 PR, 다른 PR 과 한 배치에 실어도 된다. 배포 순서 조건이 없다(core 한 앱, 계약 변경 없음).
- 컷오버 전 라이브에는 planned 상자가 없어 새 갈래가 돌 일이 없다.
- 두 규칙 모두 실행 모드라 «실행 모드 전환» 체크박스를 달지 않는다. 머지하는 PR 이 #1016 «남은 운영 작업»의 «25번 행 실행 모드 전환»을
  이 PR 로 체크하고, «30·25번 배포 전 대상 건수 확인» 체크박스를 단다. 30·33번 해결 칸에 머지 커밋 해시.
- **배포 전 읽기 전용 확인 — 규칙이 배포 직후 움직일 상자:** 라이브 `shipments` 의 `recovery_required` + `CANCEL_REPLAN_PENDING` 건수와
  `recovery_required` + `CONSOLIDATION_PENDING` 건수, 그리고 `shipment_operations` 의 `cancel`·`consolidate` + `pending` 건수.
  0 이 아니면 그 상자를 하나씩 보고(판매주문 상태·송장·배치) 배포를 정한다. 건수를 체크박스 줄에 적는다.

## 6. 지켜야 할 행동 (테스트)

core 통합 스펙(`describeIfDb`)으로 실제 DB 에서 본다.

1. 배치 밖 planned 상자(`registered` 송장) 전량 취소 → 송장 `voided`, 상자 `canceled`, 확정 예약 0, 오퍼레이션 `completed`, 판매주문 `cancelled`.
2. 배치 밖 planned 상자 일부 취소 → 송장 `voided`, 상자 `draft`(`plannedAt` 없음), 줄 수량 감소, 남은 몫 예약 유지.
3. 시작 전 배치의 상자 전량 취소 → 작업 항목 `excluded`, 송장 `voided`, 상자 `canceled`. **같은 배치의 다른 상자로 배치 시작이 성공한다.**
4. 합포장 대상인 planned 상자 취소 → 대기 없이 즉시 끝난다.
5. 송장 발급 중(`pending`)인 상자 취소 → 대기. 송장을 `registered` 로 바꾼 뒤 규칙이 재개 → 송장 `voided`, 상자 `canceled`, 상태 행 `acted`.
6. 이 작업 전 방식으로 대기 중인 시작 전 배치 상자(작업 항목이 대기 오퍼레이션을 가리킴)를 손으로 빼기(`excludeShipment`) → 재개가 송장을 무효화하고 취소를 끝낸다(지금은 `SHIPMENT_ACTIVE_INVOICE`).
7. 시작된 배치의 상자 일부 취소 → 지금처럼 대기, 규칙 `check` 는 거짓.
8. `SHIPMENT_REOPEN` 이 없는 운영자의 planned 상자 취소 → 403(지금과 같음).
9. 셀프취소: 복구 중 상자가 있는 주문은 `availableActions` 에 `cancel` 이 없고 사유 `already_processing`. 같은 주문에 취소 요청 → 400(409 아님), 상자·판매주문 그대로.
10. 셀프취소: planned 상자만 있는 주문은 버튼이 보이고, 요청하면 1번처럼 끝난다.
11. 판정 함수 유닛: 표의 순서대로 사유가 나온다(각 사실 하나씩 켜고 끄기).

## 7. 빌더에게 맡기는 것

- «막힘»과 «막힘 없음 손질»(빼기·무효화·되돌림)을 어디에 둘지 — 즉시 취소와 재개가 같은 것을 써야 한다. 지금 `requiresDurableReplan` 은 `cancelOutstanding` 한 곳만 쓴다.
- 시작 전 배치에서 빼는 일을 `ShipmentPlanningService` 가 어떻게 부를지 — 이미 `moduleRef` 로 서로를 부르는 관계라 순환을 만들지 않는 쪽으로.
- 송장 무효화와 작업 항목 빼기의 멱등 키·감사 로그 action 이름(E10 의 `withdrawal-exit:<operationId>:<shipmentId>` 꼴을 따르면 된다).
- 판정 함수 파일 위치(`fulfillment-phase.ts` 옆이 자연스럽다).

## 8. 곁에서 찾은 것 (이 작업 밖)

- 18번(자동 계획)이 들어오면 4.1 의 «일부 취소 → draft» 상자가 자동으로 다시 계획된다. 18번이 30번을 선행 조건으로 둔 이유가 이 작업이다.
- #1016 이 25번 전환 전에 보라고 적은 경우(채널 취소가 거절돼 «반영 대기 변경»에 남은 주문의 상자가 합포장 대기일 때)는 32번 몫이다.
  지금은 컨슈머가 그 취소를 거절해 «반영 대기 변경»이 생기지 않는다. 32번이 그 행을 만들면 «반영 대기 변경이 있는 주문의 상자를 출고에서
  보류하는가»를 정해야 하는데, 이건 합포장 재개만이 아니라 피킹·발송 전부의 질문이다. 25번 규칙이 우연히 붙잡아 두는 것에 기대지 않는다.
- 시작된 배치의 일부 취소는 여전히 상자가 배치를 떠날 때까지 대기한다. 09-29 스펙 §7.1 은 «줄만 줄이기»로 바꾸려 했다 — 남은 S1 일이다.
