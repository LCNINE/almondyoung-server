# 피킹 custody 명령(완료·되돌림·인계)과 전진 명령은 커널 하나를 공유한다

## Status
Accepted (2026-10-19). **부분 대체:** [[0030-picking-plan-layer-extraction]] 의 «custody 층은 통합하지 않는다» 조항과 그 재검토 조건.
**유지:** 0030 의 «공유층에는 3전략 diff ≤ 4 로 측정된 것만» 규칙(계획 층 `picking/allocation/` 에 그대로 적용). 설계 스펙
`docs/superpowers/specs/2026-10-19-k1-picking-work-item-command-kernel-design.md`, 출발점은 구조 감사
`docs/order-logistics-architecture-audit-2026-10.md` §7·§8.1 의 K1.

## Context
0030 은 custody 층의 세 벌이 «측정상 수렴하면 그때 다시 검토한다»고 적었다. 그때 diff 는 64~108 로 멀었다. ADR-0041 이 계획 층을 작업 항목 배정에
흡수한 뒤 세 벌이 수렴했다(2026-10-19 develop 기준 재측정, 스크립트는 감사 문서 §10):

| 메서드 | discrete↔tote | discrete↔aggregate | tote↔aggregate |
|---|---|---|---|
| `unpickShipment` | 11 | 58 | 67 |
| `completePick` | 28 | 57 | 51 |
| `handoff` | 44 | 44 | 56 |

0030 때와 다른 점은 숫자만이 아니다. «복사 후 살짝 수정»이 아니라고 본 `completePick` 의 `BULK_CART → SORTING → PACKING` 대 `WORKER → PACKING` 차이는
**누구의 자리에 있어도 되는가**(소유자 조회)와 **무엇을 PACKING 으로 옮기는가**(출발 custody) 두 값으로 환원됐다. 나머지(순서·판정·상태 쓰기)는 세 파일이 같은
절차를 각자 들고 있을 뿐이었다. 그 비용이 드러난 사례가 #992 다 — 송장 재출력 게이트를 전진 명령 7곳에 넣은 뒤 «7곳이 다 부르나»를 보는 복사본 점검 가드
(`label-currency-gate.guard.spec.ts`)를 따로 만들어야 했다. 다음 가로지르는 규칙에는 가드가 없다. 사용자가 말한 진짜 문제는 «AI 로 작업하기에 불안한 코드»다 —
세 파일이 형제라는 사실이 코드에 없어서, 한 파일만 읽고 고친 변경이 나머지 둘과 조용히 갈라진다.

## Decision
`fulfillment/picking/work-item-command.ts` 에 커널을 둔다. 두 부분이다.

1. **전진 문 `runForwardWorkItemCommand`.** 작업 항목을 잠그고 전진시키는 7개 명령(discrete `scan`·`completePick`, tote `assignTote`·`toteScan`·`completePick`,
   aggregate `sortScan`·`completePick`)이 모두 지난다. 순서는 커널이 고정한다: `workflowGate.assertV2MutationAllowed(commandType)` → `commands.execute` →
   **선행 advisory 락**(문자열 키 목록, 순서대로. aggregate `sortScan` 은 작업 항목 잠금보다 카트 락 `aggregate-cart:{cartId}` 를 먼저 잡는다) →
   `lockAndAssertPickerClaim` → `labels.assertCurrent` → `assertActiveBatchSession` → 본문. 커널은 `lockAndAssertPickerClaim` 을 **부르기만** 한다.
2. **공통 본문 `completeWorkItemPick` · `unpickWorkItemShipment` · `handoffWorkItemPicker`.** 세 전략의 같은 이름 메서드는 정책(`PickingCustodyPolicy`)을 넘기는
   한 줄 위임이다. 판정 함수는 `work-item-custody-judgement.ts` 의 순수 함수다.

**전략이 넘기는 것(`PickingCustodyPolicy`)**: 전략명(→`commandType`), 내부 `moveCustody` 멱등 키 접두사 넷, **소유자 조회**
`loadHeldSpots`(이 박스 custody 를 지금 들고 있어도 되는 자리), 완료 때 PACKING 으로 옮길 출발 custody(`WORKER`/`TOTE`/`SORTING`), tote 만의 «허용 자리가 비었음»
에러, 인계 때 custody 가 사람을 따라가는지(`handoffCustody`, tote 는 없음), 되돌림 후처리(`afterUnpick`, tote 의 `releaseEmptyShipmentTotes`), 에러 문구.
**소유자 조회는 순수 값이 아니다** — tote 의 조회는 토트 advisory 락과 배정 행 `FOR UPDATE` 를 잡는다. 그래서 조회는 허용 자리만 돌려주고 판정은 커널이 하며,
**호출 위치는 커널이 고정한다**(`unpick` 은 `picking` 상태에서만 부른다). 그래야 락 순서가 예전과 같다. PACKING ref `work-item:{workItemId}` 는 커널이 소유한다.

**커널에 넣지 않은 것**: `releaseTote`·`toteHandoff`(작업 항목 둘을 잠근다)·`cartHandoff`(카트 단위)·`returnCartSurplus`, 그리고 `scan` 계열 본문(discrete
`scan`, tote `assignTote`·`toteScan`, aggregate `sortScan`·`bulkCartScan`). 이들은 잠그는 단위나 분기가 달라 하나의 틀에 넣으면 분기투성이가 된다 — 0026 이
경계한 «본문이 전부 hook 인 과추상화»다. 작업 항목을 잠그는 scan 넷은 전진 문만 지난다. `custodyFlow` 선언의 집행도 하지 않았다(`moveCustody` 쪽까지 손대야 한다).
정책 모양은 나중에 그 선언으로 대체될 수 있게 뒀다.

**이름 붙은 동작 변경은 셋뿐이다.** `commandType`·`workflowGate` 이름·`canonicalRequest`·멱등 키(명령·`moveCustody`)·에러 코드·문구는 한 글자도 바꾸지 않았다
(배포를 걸친 재시도의 멱등 때문이다).

- **D1. aggregate 에서 같은 작업자에게 인계하면 성공한다**(예전: 400). `batches.handoff` 는 자기 항목을 «다른 활성 클레임» 검사에서 빼서 통과하고, discrete 는
  `oldOwnerId === targetWorkerId` 면 이동을 건너뛰고, tote 는 이동이 없어 성공한다. aggregate 만 건너뛰기가 없어 SORTING 잔량이 있으면 `moveCustody` 가
  `Source and target custody must differ` 로 던져 트랜잭션 전체가 롤백됐다. 이제 `movedQty: 0` + 리스 갱신으로 성공한다. 사용자 결정(2026-10-19).
- **D2. `completePick` 의 잔량 조회는 세 전략 모두 SETTLED 를 뺀다.** discrete·tote 는 이미 뺐고 aggregate 는 아니었다. SETTLED 는 발송 정산에서만 생겨 피킹
  완료 전엔 도달 불가라 관측 가능한 변화는 없다(테스트로 고정할 수 없다). 적용 범위는 `completePick` 하나다 — `unpickShipment`·`handoff` 는 SETTLED 를 거르지
  않는 박스 단위 조회(`loadPositiveShipmentCustody`)를 그대로 쓴다. 거르게 하면 `ready_to_pack` 되돌림이 SETTLED 행을 남기고 성공하는 쪽으로 바뀌는데 그 상태가
  도달 불가인지 확인하지 않았다.
- **D3. `unpickShipment` 은 세 전략 모두 grain 검사 → 소유자(`picking`)/PACKING 완결(`ready_to_pack`) 순서다.** 예전 aggregate 는 grain 루프 안에서 잔량마다, 두
  상태 모두에서 소유자를 검사했다. 받아들이는 요청과 거부하는 요청은 같고, 바뀌는 것은 **aggregate 의 깨진 상태에서 나오는 에러 코드**뿐이다(예: `ready_to_pack` 인데
  잔량이 남의 PACKING 자리에 있으면 `PICKING_CUSTODY_OWNER_MISMATCH` → `PICKING_PACKING_CUSTODY_INCOMPLETE`, 위반이 여럿이면 grain 위반이 먼저). 사용자 결정(2026-10-19).

동작을 바꾸지 않는 정리 둘: discrete `handoff` 의 인계 뒤 `PICKING_WORK_ITEM_CLOSED` 검사는 `batches.handoff` 가 `status = 'picking'` 일 때만 성공하므로 도달 불가라
뺐다. ready_to_pack 되돌림 검사 `balances.length !== allocations.length`(discrete·tote) 대 `balances.length === 0`(aggregate)은 `uq_batch_inventory_session_balance_grain`
유니크로 PACKING 행이 grain 당 하나라 동치여서 하나로 합쳤다.

## Why
- 가로지르는 규칙을 넣을 곳이 한 곳이다. 송장 게이트 같은 규칙은 커널 한 곳에만 넣으면 세 전략 모두에 적용된다.
- 복사본 점검 가드는 이미 알려진 규칙 하나만 지켰다. 이제 가드는 «주인 말고는 아무도 직접 하지 않는다» 꼴(`work-item-command.guard.spec.ts`)이라 규칙이 늘어도
  가드 수가 늘지 않는다. 가드가 지키는 것: 전진 문과 송장 게이트·피커 클레임 호출은 커널 파일뿐(검수·발송 `shipment-dispatch.service.ts` 의 `assertCurrent` 만 예외),
  작업 항목 `ready_to_pack`·`queued` 쓰기와 PACKING 목적지 `moveCustody` 는 커널과 aggregate `sortScan` 뿐, 커널의 되돌림 진입 메서드 본문에는 `labels.assertCurrent(` 가 없다.
- 되돌림을 커널에 넣고 틀 밖에 둔 것이 갈린 기준은 «같은 락 순서·판정으로 설명되나»다. 설명되는 셋은 넣었고 나머지는 구조가 달라 넣지 않았다.
- 특성 테스트가 먼저였다. 되돌림·인계에는 실제 DB 테스트가 없었으므로 K1b-1 이 지금 코드 그대로 36개를 채웠고(`picking-rollback.characterization.integration.spec.ts`),
  K1b-2 는 D1·D3 의 aggregate 행 외에는 그 기대값을 고치지 않았다.

## Consequences
- **입력 검증이 워크플로 게이트보다 먼저 돈다(통제자 판정 R6).** 예전에는 일부 전략에서 게이트(`assertV2MutationAllowed`)와 `commands.execute` 사이에 입력 검증(400)이 있었다.
  커널은 게이트를 가장 앞에 고정하므로, 그 검증은 게이트 앞으로 올라왔다. 달라지는 것은 **점검(maintenance) 모드에서 입력이 틀린 요청의 에러 우선순위**뿐이다 —
  전에는 점검 에러, 이제는 400. 점검 모드가 아니면 관측 차이가 없다.
- **가드의 알려진 한계.** 가드는 소스 텍스트·AST 를 보므로 우회가 가능하다: (1) 원시 SQL(`sql\`UPDATE … status\``)로 작업 항목 상태를 쓰는 경우, (2) 객체 스프레드
  (`{ ...base, status: 'ready_to_pack' }`)로 상태를 전달하는 경우, (3) `moveCustody` 를 구조분해해 다른 이름으로 부르는 경우. 이들은 잡지 못한다 — 막으려면 쓰기 경로
  자체를 좁혀야 하고, 가드는 실수를 잡는 그물이지 방어선이 아니다.
- 새 가로지르는 규칙은 커널 한 곳에 넣는다. 네 번째 피킹 방식은 `scan` 과 `PickingCustodyPolicy` 를 넘기면 된다.
- 0030 의 «custody 층의 세 벌이 측정상 수렴하면 다시 검토한다» 조건은 이 ADR 로 소진됐다. 정책을 더 넓게 만들고 싶어질 때(예: `custodyFlow` 집행)는 새 측정과 새 ADR 이 먼저다.
- 측정 재실행(구현 뒤): `handoff`·`completePick`·`unpickShipment` 의 세 쌍 diff 는 모두 0 이다(전략 파일에는 세 줄짜리 위임만 남는다). 같은 스크립트가 `scan` 에 내는
  큰 값은 의미가 없다 — 세 전략의 `scan` 이 구조가 달라(discrete 만 본문을 갖고 나머지는 전략 고유 명령으로 대체) 비교 대상이 아니다.
- 마이그레이션이 없다. API 응답 모양은 불변이고 core 단독 배포로 충분하다.
