# 상자 상태와 구성은 커널 하나를 지난다

## Status
Accepted (2026-10-19). 설계 스펙 `docs/superpowers/specs/2026-10-19-k2-shipment-lifecycle-design.md`, 출발점은 구조 감사
`docs/order-logistics-architecture-audit-2026-10.md` §4.1·§4.2·§8.1 의 K2. K1([[0045-picking-custody-commands-share-one-kernel]])의 방식을 따른다.

## Context
상자(`shipments` + `shipment_lines`)에 쓰는 파일이 테스트·픽스처를 빼고 12개였다. «이 전이가 합법인가, 무엇을 리셋하나, 구성을 바꾸면 무엇을 따라 올려야
하나»가 쓰는 곳마다 흩어져 있었다. 호출자가 기억해야만 맞는 규칙이 실제로 있었다.

- **구성 변경과 버전 올리기가 떨어져 있었다.** `draft-line-shrink.ts` 가 «박스 상태·manifestVersion·recompute 도 호출자 몫이다»라고 적었다. 줄을 바꾼 호출자가
  `manifestVersion` 을 잊으면 낡은 송장 검사가 조용히 무력해진다.
- **`draft` 로 되돌리는 네 경로가 서로 다르게 리셋했다**(회수·결품 이탈·취소 재개·취소 손질). `recoveryCode`·`plannedAt`·`shippedAt`·`deliveredAt`·줄의
  `inspectedQty`·`forced`·두 버전을 경로마다 다른 조합으로 지웠다.
- **같은 전제 검사**(draft · 작업/보관 없음 · 활성 송장 없음)를 분할·수령인 정정·계획·구성 수정이 각자 불렀고, 합배송은 자기 여러-상자 잠금을 따로 구현했다.
- 예약 쓰기가 두 곳에서 예약 서비스 밖으로 샜다(합배송의 예약 대상 교체, `reservationVersion` 직접 증가).

사용자가 말한 이유는 막혔던 버그가 아니라 «AI 로 작업하기에 불안한 코드»다. 상자를 읽는 사람이 규칙 전부를 한 곳에서 보지 못하면 한 호출자만 고친 변경이
나머지와 조용히 갈라진다.

## Decision
`fulfillment/shipment/` 에 커널을 둔다. 두 부분과 그것을 지키는 가드다.

1. **전이 함수 `transitionShipments`**(`shipment-lifecycle.ts`). 상자 상태를 바꾸는 쓰기는 모두 이 함수를 지난다. 전이표 `SHIPMENT_TRANSITIONS`
   (`shipment-transitions.ts`)는 지금 코드에서 도출한 **14행**이다(from → to, `recovery_required` 는 코드별). 표에 없는 전이는 SQL 전에 `Error`(프로그래밍
   오류, 500)다. 함수는 `WHERE id IN (…) AND status IN (from…)` 으로 CAS 하고(호출자가 `recoveryCode`·`manifestVersion` 기대값도 더할 수 있다), 목표
   상태의 효과(`transitionEffect`)를 적용한다: 전이 시각(`plannedAt`·`shippedAt`·`deliveredAt`·`supersededAt`), 비울 칼럼, `manifestVersion` 증가, 검수 리셋.
   `recoveryCode` 는 커널이 소유하는 유니언(`RECOVERY_CODES`)이고, `recovery_required` 로 가는 전이는 코드 없이 부를 수 없으며 거기서 나가는 전이는 항상 비운다.
   `→ planned` 는 배송 프로필이 바뀔 때만 `manifestVersion` 을 올린다. 상자 생성은 `openShipment`·`insertShipment`·`insertShipmentLine`(draft 또는 묘비,
   `manifestVersion`·`reservationVersion` 1)이다.
2. **0행 정책은 셋이고 호출자가 고른다**(`StaleRowPolicy`). (a) **호출자가 지금 던지던 그 에러**(회수·결품 이탈 — 에러 코드 보존), (b) **내부 오류**
   (`'unreachable'` — 잠금으로만 보호하던 곳, 0행이 도달 불가라 CAS 를 더한 것), (c) **조용히 무시**(`'ignore'` — 배송 추적. 순서가 뒤바뀌거나 중복된 택배사
   이벤트를 흡수한다. 던지면 추적 이벤트 기록까지 롤백된다).
3. **구성 편집의 문 `editShipmentManifest`**(`shipment-manifest-edit.ts`). 줄 추가·이동·수량, 수령인, 배송 프로필, 새 상자를 바꾸는 쓰기는 모두 이 문을
   지난다. 순서는 문이 고정한다: 여러 상자 잠금(`lockShipmentAggregates`, `services/shipment-aggregate.ts` — 합배송의 자체 구현을 대체한다) → 허용 상태
   내부 단언 → `assertShipmentHasNoCustodyOrActiveWork` → `assertShipmentHasNoActiveWaybill` → 본문 → 끝맺음. 본문은 `ManifestWriter`(`createShipment`·
   `addLine`·`moveLine`·`setLineQty`·`reviseRecipient`·`setEntrancePassword`·`setShippingProfile`)로만 쓰며, 도구가 손댄 줄의 `lineVersion` 을 올리고 상자마다
   무엇이 바뀌었는지(송장 내용인지, 줄인지) 기록한다. 호출자의 사전 검사(버전·상태·복구 코드·합배송 여부)는 문에 들어가기 **전에** 지금 순서대로 둔다.
   `lockedAggregateOf` 는 문이 넘긴 id 정렬 잠금 결과에서 id 로 상자판을 찾는다.
4. **끝맺음 규칙.** 본문이 끝나면 **송장 내용(줄·수령인·프로필)이 바뀐 기존 상자마다 `manifestVersion` 을 정확히 한 번 올린다**(새 상자는 1). **현관
   비밀번호만 바뀐 상자는 올리지 않는다** — 주소가 그대로인데 버전이 움직이면 멀쩡한 송장이 stale 로 무효화된다(`setEntrancePassword` 는 `last_updated` 만
   찍는다). **줄이 바뀐 상자만 예약을 재계산한다** — 수령인 정정은 지금도 재계산하지 않으므로 문도 부르지 않는다. 이로써 `draft-line-shrink.ts` 의
   «호출자 몫»이 사라졌다. 버전은 모두 SQL 증가식(`col + 1`)으로 쓴다 — 메모리의 옛 값 + 1 은 같은 트랜잭션의 앞선 증가를 지운다.
5. **예약 누수 두 곳을 예약 서비스로 돌렸다.** 합배송의 «줄 여럿의 확정 예약을 새 줄 하나로 옮긴다»는 `ShipmentReservationService.retargetConfirmed`,
   `reservationVersion` 직접 증가는 `bumpReservationVersions`(둘 다 공개 메서드)다.
6. **가드 `shipment-writes.guard.spec.ts`(G3).** 커널 폴더 밖에서 `shipments`·`shipmentLines` 의 insert·delete, 그리고 허용 목록 밖의 칼럼을 `.set` 하는
   update 를 찾으면 빨갛다. 허용 목록은 파일 단위로 칼럼을 연다: 예약 서비스의 `reservedQty`·`reservationVersion`·`lineVersion`(회수 때 예약 복원), 검수의
   `inspectedQty`·`forced`·`lineVersion`(dispatch·box-allocation), 파기의 `entrancePassword`(null 로만), 모든 곳의 `lastUpdated`. 별칭 선언은 허용하되 별칭이나
   직접 import 한 테이블 식별자가 `.update/.insert/.delete` 인자로 쓰이면 같은 규칙을 적용하고 그런 별칭을 export 하면 위반이다. raw SQL(`UPDATE shipments`)은
   `public.`·따옴표·`ONLY` 형태도 잡는다.

**커널에 넣지 않은 것**: 오퍼레이션 기록(`createShipmentOperation`·`completeShipmentOperation`·before/after 스냅샷·감사 로그 — 회수·결품·합배송이 자기 형식을
가져 하나의 틀이 hook 투성이가 된다, ADR-0026 이 경계한 것), 검수 **전진**(`inspectedQty`·`forced` 를 올리는 쪽 — 포장 진행이고 K1 이웃이다. 리셋 쪽만 커널이 소유),
현관 비밀번호 **파기**(`shipment-delivery-tracking.service.ts`, `sales-order/services/entrance-password-cleaner.ts`), 배송 추적 이벤트 **해석**(서비스가 해석을
갖고 상태 쓰기만 커널을 부른다), 상태 enum 의 `failed`(쓰는 곳이 0이지만 삭제는 파괴적 DB 변경이라 ADR-0005 §5 에 따라 별도 PR), FO 항목 수량
(`canceledQty`·`qty` — «고객 취소인가 구성 변경인가»라는 업무 판단이라 호출자에 남는다).

**이름 붙은 동작 변경은 둘뿐이다**(사용자 결정, 2026-10-19). `commandType`·`workflowGate` 이름·`canonicalRequest`·멱등 키·에러 코드·문구는 한 글자도 바꾸지
않았다(배포를 걸친 재시도의 멱등). 같은 검사인데 호출자마다 코드가 다른 곳(`SHIPMENT_NOT_DRAFT`·`BOX_NOT_DRAFT`·`SHIPMENT_REOPEN_REQUIRED`,
`SHIPMENT_COMPONENT_CHANGED_RETRY`·`CONSOLIDATION_COMPONENT_CHANGED_RETRY`)도 각자 그대로다.

- **D1. 재개봉(`→ draft`) 때 줄 버전은 «검수 흔적을 지운 줄»만 오른다**(`inspected_qty > 0 OR forced`). 결품 이탈의 줄 버전 올림이 통째로 사라진다(그 시점의 줄은
  이미 전부 검수 0). 회수는 전 줄이 검수돼 있어 지금과 같고, 취소 경로는 지금처럼 안 올린다. 위험: 결품 이탈 전 화면의 줄 버전이 그대로 맞게 되나, 분할·취소는
  `expectedManifestVersion` 도 검사하고 재개봉이 그걸 올리므로(D2) 낡은 화면은 여전히 막힌다.
- **D2. 재개봉은 언제나 `manifestVersion` 을 올린다.** `planned`·대기 상자를 취소하면 **+1 대신 +2**(재개봉 +1, 구성 편집 +1) 오른다. 응답·오퍼레이션 스냅샷의
  숫자가 달라진다. 대기 의도의 `expectedManifestVersion` 은 재개봉 전에 검사하므로 영향이 없다. 「재개봉은 송장을 낡게 만든다」를 한 규칙으로 둔 것이다.

동작을 바꾸지 않는 통일(근거는 설계 §8): 결품 이탈·취소 경로가 `forced` 를 안 지우던 것, 회수 외 경로가 `shippedAt`·`deliveredAt` 을 안 비우던 것,
`revert_planned` 이 `recoveryCode` 를 안 비우던 것(모두 그 상태에서 값이 항상 비어 있다), 잠금으로만 보호하던 전이에 CAS 를 더한 것, 취소 경로가 `inspectedQty` 를
안 지우던 것(준비도가 `ready` 일 때만 적용). 취소 즉시 갈래는 이제 문을 통해 `assertShipmentHasNoCustodyOrActiveWork` 와 `assertShipmentHasNoActiveWaybill` 을
모두 지난다 — 둘 다 준비도(`ready`)가 이미 덮는 조건이라 막히는 요청이 늘지 않는다.

## Why
- 규칙이 한 곳이다. 재개봉 리셋·버전 증가·전제 검사 순서가 호출자마다 복사되던 것이 전이표와 문에 한 번 적힌다. 구성을 바꾼 호출자가 `manifestVersion` 을 잊을 수 없다.
- 가드가 «주인 말고는 아무도 직접 쓰지 않는다» 꼴이라 규칙이 늘어도 가드 수가 늘지 않는다(K1 과 같다).
- 상자 엔티티에 모든 관심사를 붙인 넓은 모듈을 만들지 않았다. 전이의 합법성과 구성의 일관성만 넣고, «언제 취소하나» 같은 업무 판단은 호출자에 남겼다.

## Consequences
- 새 상자 상태·새 전이는 전이표 한 행과 `transitionEffect` 한 곳을 고친다. 새 구성 쓰기는 `ManifestWriter` 에 도구를 더한다.
- **취소 재개·이탈 취소 완료는 재개봉 앞의 호출자 가드(송장 → 보관)를 그대로 두고, 재개봉 뒤 문이 같은 가드를 다시 확인한다.** 위반이 여럿일 때 나오는 에러
  우선순위를 보존하려는 의도적 중복이다.
- **회수의 `lineVersion` 은 여전히 +2** 다(예약 복원 +1, 재개봉 검수 리셋 +1). 그래서 예약 서비스의 `lineVersion` 쓰기가 가드 허용 목록에 남는다.
- **가드의 알려진 한계.** 가드는 AST 를 보므로 우회가 가능하다(매개변수로 테이블을 받는 헬퍼, `wmsTables['shipments']` 대괄호 접근, 스코프를 무시한 이름 매칭,
  템플릿 보간·`sql.raw` 로 만든 SQL, 구조분해한 tx 의 별칭 호출). 전체 목록은 가드 파일 머리 주석이 정본이다. 가드는 실수를 잡는 그물이지 방어선이 아니다.
- 곁에서 찾았으나 이 작업 밖인 것: 막힘 없는 `planned` 상자가 합배송에서 대기 없이 곧바로 `superseded` 가 되고 `plannedAt` 이 남는다(지금 동작이라 전이표에
  넣고 보존), 회수는 `shipped` 만 받는다(`in_transit` 불가), `CONSOLIDATION_PENDING` 에서 나가는 길은 재개뿐, `consolidation.service.ts` 의 `'open'` 은 enum 에 없는 V1 잔재.
- 마이그레이션이 없다. API 응답 모양은 불변(D2 의 버전 숫자 제외)이고 core 단독 배포로 충분하다.
