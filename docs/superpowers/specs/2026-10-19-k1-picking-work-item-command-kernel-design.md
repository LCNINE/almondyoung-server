# K1 피킹 작업 항목 명령 커널 — 전진은 한 문으로, 공통 본문은 한 벌로

2026-10-19 develop `5117d0d77` 코드 기준. 라이브 실측 없음. 출발점은 구조 감사
`docs/order-logistics-architecture-audit-2026-10.md` §7·§8.1 의 K1 이다.

## 1. 왜

피킹 전략 세 벌(`discrete-picking`·`pick-to-tote`·`aggregate-then-sort` `.strategy.ts`, 합계 약 2,900줄)이
같은 절차를 각자 들고 있다. 가로지르는 규칙 하나를 넣으려면 세 파일 여러 곳을 같이 고쳐야 하고,
#992 는 송장 재출력 게이트(스펙 I5)를 7곳에 넣은 뒤 «7곳이 다 부르나»를 확인하는 AST 가드
(`picking/label-currency-gate.guard.spec.ts`)를 따로 만들어야 했다.

**사용자가 말한 진짜 문제는 «AI 로 작업하기에 불안한 코드»다.** 세 파일이 형제라는 사실이 코드에 없어서,
한 파일만 읽고 고친 변경이 다른 두 파일과 조용히 갈라진다. 복사본 점검 가드는 이미 알려진 규칙 하나만
지킬 뿐, 다음 규칙에는 아무 가드도 없다.

ADR-0030(2026-08-15)은 custody 층을 일부러 통합하지 않았고, «세 벌이 측정상 수렴하면 다시 검토한다»고
적었다. ADR-0041 이후 수렴했다(감사 §7.2, 이 문서 작성 시 재측정해도 같은 값):

| 메서드 | discrete↔tote | discrete↔aggregate | tote↔aggregate |
|---|---|---|---|
| `unpickShipment` | 11 | 58 | 67 |
| `completePick` | 28 | 57 | 51 |
| `handoff` | 44 | 44 | 56 |

측정 스크립트는 감사 문서 §10 에 있다.

## 2. 목표

- **G1. 작업 항목을 전진시키는 명령은 모두 한 문(커널)을 지난다.** 송장 게이트처럼 가로지르는 규칙은 그 문
  한 곳에만 넣으면 된다.
- **G2. `completePick`·`unpickShipment`·`handoff` 본문은 한 벌이다.** 전략은 본문이 아니라 정책을 넘긴다.
- **G3. 커널 밖 우회를 가드 spec 하나가 막는다.** 복사본 점검 가드는 사라진다. 이 가드는 «주인 말고는
  아무도 이걸 직접 하지 않는다» 꼴이어야 하며, 규칙이 늘어도 가드 수가 늘지 않아야 한다.

**성공 기준:** 새 가로지르는 규칙을 커널 한 곳에 넣으면 세 전략 모두에 적용되고, 전략 파일 하나를
고친 변경이 공통 절차를 깨뜨릴 수 없다.

## 3. 하지 않는 것 · 실패로 보는 것

- **실패(anti-goal): «논리적으로는 그렇게 동작해야 할 것 같은데 실제로는 아닌» 곳이 생기는 것.**
  커널이 세 전략을 똑같이 다루는 것처럼 보이는데 한 전략에서 조용히 다르게 돌면 실패다.
  그래서 동작이 바뀌는 곳은 전부 §5.4 에 이름을 붙여 적고, 그 밖에서는 동작을 바꾸지 않는다.
- **되돌림 명령 전부를 하나의 틀에 넣지 않는다.** `releaseTote`·`toteHandoff`(작업 항목 둘을 잠근다)·
  `cartHandoff`(카트 단위)·`returnCartSurplus` 는 손대지 않는다. 분기투성이 틀은 ADR-0026 이 경계한
  과추상화다.
- **`scan` 계열 본문은 합치지 않는다.** discrete `scan`, tote `assignTote`·`toteScan`, aggregate
  `sortScan`·`bulkCartScan` 본문은 전략 고유다(감사 §7.4). 이 중 작업 항목을 잠그는 넷은 K1a 의 문만 지난다.
- **`custodyFlow` 집행은 하지 않는다.** 각 전략의 `capabilities.custodyFlow` 는 선언만 돼 있고 전략 파일
  밖 참조가 0이다. 실제로 집행하려면 `moveCustody` 쪽까지 손대야 해서 K1 범위 밖이다. 다만 K1b 의
  정책 모양이 나중에 이 선언으로 대체될 수 있게 둔다(§5.2).
- **검수·발송의 게이트는 범위 밖이다.** `shipment-dispatch.service.ts` `lockAggregate` 의
  `this.labels.assertCurrent(workItem.id, tx)`(현재 :500)는 그대로 두고, §4.3 가드에서 예외로 명시한다.
- K2(상자 수명주기) 이후 커널은 이 작업 밖이다.

## 4. K1a — 전진 명령의 문

동작을 바꾸지 않는 단계다.

### 4.1 대상

작업 항목을 잠그고 전진시키는 명령 7개. 현재 모두 `lockAndAssertPickerClaim` 뒤에 `labels.assertCurrent` 를 부른다.

| 전략 | 메서드 |
|---|---|
| discrete | `scan`, `completePick` |
| pick-to-tote | `assignTote`, `toteScan`, `completePick` |
| aggregate-then-sort | `sortScan`, `completePick` |

7곳 모두 워크플로 게이트 이름(`assertV2MutationAllowed`)과 `commandType` 이 같은 문자열이다(확인함).

### 4.2 커널이 고정하는 순서

7곳의 앞부분은 지금 글자 그대로 같다. 커널은 이 순서를 그대로 옮겨 고정한다.

1. `workflowGate.assertV2MutationAllowed(commandType)`
2. `commands.execute({ commandType, idempotencyKey, canonicalRequest }, handler, tx)` — 이하 3~7은 handler 안
3. **선행 advisory 락 키 목록**을 순서대로 잡는다. aggregate `sortScan` 이 작업 항목 잠금보다 카트 락
   (`acquireCartLock` = `pg_advisory_xact_lock(hashtextextended('aggregate-cart:' || cartId, 0))`)을 먼저 잡기
   때문이다. 이 순서가 바뀌면 다른 카트 명령과 교착할 수 있다. **함수가 아니라 문자열 값으로 받는다.**
   락 SQL 은 지금과 같은 식이어야 한다.
4. `lockAndAssertPickerClaim(trx, workItemId, batchId, shipmentId, actorId, expectedLeaseVersion)` —
   빠지는 박스 규칙(「정한 것 11」)은 이미 이 안에 있다. **커널은 이 함수를 부르기만 하고 다시 구현하지 않는다**
   (§6 의 계약 spec 이 이 함수를 mock 하기 때문).
5. `labels.assertCurrent(workItemId, trx)`
6. `assertActiveBatchSession(trx, sessionId, batchId, strategyName)`
7. 전략 본문 `(trx, commandRequestId) => Promise<{ response, resourceType, resourceId }>`

**전략에 그대로 남는 것:** `commands.execute` 이전의 입력 검증(400 검사, 예: `sortScan` 의 `strategy`·`stage`·
`destinationCustody` 검사, `assertPositiveQuantity`), 본문 전체, 그리고 `commandType`·멱등 키·
`canonicalRequest` 의 **값 전부**. 이 셋이 한 글자라도 바뀌면 배포를 걸친 재시도의 멱등이 깨진다.

### 4.3 가드 교체

- `picking/label-currency-gate.guard.spec.ts` 를 지운다.
- 새 가드 spec 하나: «`lockAndAssertPickerClaim(` 과 `labels.assertCurrent(` 를 부르는 비-spec 파일은 커널 파일과
  `shipment-dispatch.service.ts`(검수·발송, `assertCurrent` 만) 뿐이다.» 본은
  `picking/allocation/batch-start-entry.guard.spec.ts` 의 «부르는 곳은 하나뿐이다» 꼴이다.
- 옛 가드가 지키던 «되돌림 메서드는 게이트를 부르지 않는다»는 새 가드에서 저절로 성립한다(되돌림은 커널의
  전진 문을 쓰지 않으므로). 별도 항목이 필요하면 빌더가 판단한다.

### 4.4 K1a 의 동작 보존 증거

수정 없이 초록이어야 하는 것: 통합 시나리오 07·08·09(`services/outbound-v2-warehouse-scenarios.integration.spec.ts`),
`outbound-v2-recovery-scenarios.integration.spec.ts`, `simple-outbound.service.integration.spec.ts`,
세 전략 공통 계약 spec(`definePickingStrategyContract`, 세 `*.strategy.spec.ts` 끝에서 호출). 전략 생성자에 커널
의존이 추가되므로 spec 의 **fixture 생성부**는 고쳐도 되지만, 기대값(assertion)은 고치지 않는다.

## 5. K1b — 공통 본문 한 벌

### 5.1 순서: 특성 테스트가 먼저다

**지금은 되돌림 쪽에 실제 DB 테스트가 없다.**

- `unpickShipment`: 실제 DB 통합 spec 이 세 전략 모두 0개.
- 전략 `handoff`: 0개. 시나리오 07은 custody 를 옮기는 전략 `handoff` 를 건너뛰고 `batches.handoff` 를 직접 부른다.
- `completePick`: 전략마다 정상 경로 하나씩(시나리오 07·08·09).
- 공통 계약 spec 은 세 전략을 돌리지만 쿼리를 흉내 낸 가짜 모델 위에서 돌고 `lockAndAssertPickerClaim` 도 mock 이다.
  리팩터로 쿼리 모양이 바뀌면 가짜도 같이 고쳐야 하므로, 이것만으로는 «같은 테스트가 같은 동작을 증명한다»가 성립하지 않는다.

그래서 K1b 는 두 단계다.

1. **K1b-1 특성 테스트.** 지금 코드 그대로 실제 DB 통합 spec 을 채운다. **지금 코드에서 초록이어야 한다.**
   최소 범위는 §6 의 표. `describeIfDb`/`REQUIRE_*_DB=1` 가드를 따른다.
2. **K1b-2 본문 통합.** K1b-1 의 spec 을 고치지 않은 채(§5.4 D1·D3 의 기대값 변경만 예외) 세 메서드를 합친다.

### 5.2 전략이 넘기는 정책

본문은 커널이 한 벌로 가진다. 전략은 아래만 넘긴다.

| 정책 | discrete | pick-to-tote | aggregate-then-sort |
|---|---|---|---|
| **소유자 조회** — 이 박스 custody 를 지금 들고 있어도 되는 자리 | `WORKER` / 피커 id | `TOTE` / 박스에 활성 배정된 토트 ref 집합 | `SORTING` / `sorting:{workItemId}:{pickerId}`, `PACKING` / `work-item:{workItemId}` |
| **완료 때 PACKING 으로 옮길 자리** | `WORKER` 잔량 1행 | `TOTE` 잔량 전부 | `SORTING` 잔량만. 이미 `PACKING` 인 잔량은 허용(`sortScan` 이 바로 보낼 수 있음) |
| **완료 전 검사** | — | 활성 토트 배정 0이면 `TOTE_ASSIGNMENT_REQUIRED` | — |
| **인계 때 custody 가 사람을 따라가나** | 예 (`WORKER`→`WORKER`) | 아니오 (`movedQty: 0`) | 예 (`SORTING`→`SORTING`) |
| **되돌림 후처리** | — | `releaseEmptyShipmentTotes` | — |
| **에러 코드·메시지** | 지금 값 | 지금 값 | 지금 값 (예: 완료 미충족이 discrete·tote 는 `PICKING_INCOMPLETE`, aggregate 는 `PICKING_UNSORTED_REMAINDER`) |
| **`commandType`·멱등 키 접두사** | 지금 값 | 지금 값 | 지금 값 |

PACKING ref 는 세 전략 모두 `work-item:{workItemId}` 로 같다(세 파일이 각자 상수로 들고 있다). 검수·발송이 전략을
모르는 근거이므로 커널이 하나로 소유한다.

**소유자 조회는 순수 값이 될 수 없다.** tote 의 `loadActiveShipmentToteRefs` 는 배정된 토트를 DB 에서 읽고
**토트 advisory 락과 배정 행 `FOR UPDATE` 를 잡는다.** 그래서 «조회 함수 하나»로 받되, **부르는 위치는 커널이
고정한다** — 각 메서드에서 지금 부르는 자리와 같은 순서여야 락 순서가 보존된다. 조회 함수는 검사를 하지 않고
허용 자리만 돌려준다. 판정(«이 잔량이 허용 자리에 있나»)은 커널이 한다.

정책 모양은 나중에 `custodyFlow` 선언으로 대체될 수 있게 둔다(예: «완료 때 옮길 자리»는 «경로의 PACKING 직전 단계»).
지금 그 대체를 하지는 않는다.

### 5.3 통일하는 어긋남 (동작 영향 없음)

| 어긋남 | 근거 | 통일 |
|---|---|---|
| discrete `handoff` 의 인계 뒤 `PICKING_WORK_ITEM_CLOSED` 검사 | `batches.handoff` 는 `status = 'picking'` 일 때만 갱신에 성공하므로 도달 불가 | 뺀다 |
| discrete·tote 의 인라인 잔량 쿼리 vs aggregate 의 헬퍼(`loadPositiveShipmentCustody`, `loadPositiveAllocationCustody`) | 같은 쿼리. aggregate 헬퍼의 `skuId` 조건은 `shipmentLineId` 로 이미 정해진다 | 목적별 헬퍼 하나씩(D2 참고) |
| ready_to_pack 되돌림 검사: discrete·tote `balances.length !== allocations.length`, aggregate `balances.length === 0` | `uq_batch_inventory_session_balance_grain`(session·sku·source·custodyType·custodyRef·line) 유니크라 PACKING 행은 grain 당 하나 → 동치 | 하나로 |

### 5.4 이름 붙은 동작 변경

**D1. aggregate 에서 같은 작업자에게 인계하면 성공한다 (지금은 400).** 사용자 결정(2026-10-19): K1b 안에서 고친다.

- 지금: `batches.handoff` 는 자기 작업 항목을 «다른 활성 클레임» 검사에서 빼므로 같은 사람으로의 인계가 통과한다
  (admin-web 인계 대상 칸은 자유 입력). discrete 는 `oldOwnerId === targetWorkerId` 면 이동을 건너뛰어 성공하고,
  tote 는 이동이 없어 성공한다. **aggregate 만** 건너뛰기가 없어 SORTING 잔량이 있으면
  `moveCustody` 가 `BadRequestException('Source and target custody must differ')` 를 던지고 트랜잭션 전체가 롤백된다.
  코드 읽기로 추론했고 실행으로 확인하지 않았다 — K1b-1 이 확인한다.
- K1b-1: 이 경우의 **지금 동작(400)을 그대로 기록하는 테스트**를 둔다. 추론이 틀려 400 이 안 나면 여기서 드러난다.
- K1b-2: 그 테스트 하나만 기대값을 «성공, `movedQty: 0`, 리스 갱신»으로 바꾼다.

**D2. `completePick` 은 세 전략 모두 SETTLED 잔량을 뺀다.** 지금 discrete·tote 의 `completePick` 은
`custodyType <> 'SETTLED'` 로 거르고 aggregate 는 거르지 않는다. SETTLED 는 발송 정산(`settleForDispatch`)에서만 생기므로
피킹 완료 전 그 줄에 SETTLED 가 있는 상태는 사실상 도달 불가다. aggregate 기준으로는 동작 변경이라 여기 적는다.
테스트로 고정하지는 않는다(만들 수 없는 상태).

**적용 범위는 `completePick` 하나다(빌더 리뷰 뒤 좁힘, 내 판단).** `unpickShipment`·`handoff` 는 세 전략 모두 지금
SETTLED 를 거르지 않으므로(`loadPositiveShipmentCustody` 와 같은 쿼리) 그대로 둔다. 거르게 하면 `ready_to_pack` 되돌림이
SETTLED 행을 남긴 채 성공하는 쪽으로 바뀌는데, 그 상태가 도달 불가인지는 확인하지 않았다. 그래서 잔량 조회는 목적별로
둘이다: 완료용(배정 grain 단위, SETTLED 제외)과 되돌림·인계용(박스 단위, 필터 없음 = `loadPositiveShipmentCustody`).

**D3. `unpickShipment` 의 검사 순서와 상태를 discrete·tote 방식으로 맞춘다.** 사용자 결정(2026-10-19).

- 지금 discrete·tote 는 ① 모든 잔량의 grain 검사(`GRAIN_MISMATCH`·`OVERATTRIBUTED`)를 끝낸 뒤 ② `picking` 일 때만 소유자 검사
  (`OWNER_MISMATCH`), `ready_to_pack` 일 때는 «전부 `work-item:{workItemId}` PACKING 이고 grain 마다 배정량과 같다»
  (`PICKING_PACKING_CUSTODY_INCOMPLETE`)만 본다. aggregate 는 grain 루프 안에서 잔량마다, 두 상태 모두에서 소유자를 검사한다
  (`aggregate-then-sort.strategy.ts` 의 unpick 본문).
- 통합 뒤: 세 전략 모두 ①→② 순서. `picking` 의 허용 자리는 전략의 소유자 조회(§5.2)가 정하고, `ready_to_pack` 은 커널이
  PACKING ref 하나로 판정한다. **소유자 조회는 `picking` 일 때만 부른다** — tote 의 토트 락 조회가 지금처럼 `picking` 에서만
  불려 락 순서가 보존된다.
- 받아들이는 요청과 거부하는 요청은 같다. 바뀌는 것은 **aggregate 의 깨진 상태에서 나오는 에러 코드**뿐이다.
  예: `ready_to_pack` 인데 잔량이 남의 자리에 있으면 `OWNER_MISMATCH` → `PICKING_PACKING_CUSTODY_INCOMPLETE`.
  위반이 여럿일 때 어느 코드가 먼저 나오는지도 discrete·tote 와 같아진다(grain 위반 우선).
- K1b-1: aggregate 의 이 두 경우를 지금 코드(`OWNER_MISMATCH`)로 기록한다. K1b-2: 그 두 테스트만 기대값을 바꾼다.

이 셋 외에는 동작을 바꾸지 않는다. 빌더가 통합 중 새 차이를 찾으면 §5.3 (영향 없음, 근거 필요) 또는 §5.4 (동작 변경)
에 추가하고, §5.4 에 들어가는 것은 사람에게 묻는다.

### 5.5 K1b-2 의 가드 확장 (내 판단)

§4.3 의 가드는 «전진 문»만 지킨다. G3 와 성공 기준(«전략 파일 하나를 고친 변경이 공통 절차를 깨뜨릴 수 없다»)을 K1b 까지
지키려면 K1b-2 PR 에서 가드를 넓힌다.

- **작업 항목 상태 쓰기:** `picking/` 의 비-spec 파일 중 `outboundBatchWorkItems` 를 `ready_to_pack`·`queued` 로 쓰는 곳은
  커널 파일뿐이다. 지금은 세 전략 파일에 있다.
- **PACKING 으로 옮기기:** `picking/` 에서 `custodyType: 'PACKING'` 을 목적지로 `moveCustody` 를 부르는 곳은 커널과 aggregate
  `sortScan`(전략 고유, 바로 PACKING 으로 보낼 수 있음)뿐이다.
- **되돌림은 게이트를 부르지 않는다:** K1b-2 뒤에는 전진 문과 되돌림 본문이 커널 파일 하나에 같이 있으므로 파일 단위로는
  증명되지 않는다. **메서드 단위**로 본다 — 커널의 되돌림 진입 메서드 본문에 `labels.assertCurrent(` 가 없다.

### 5.6 ADR

ADR-0030 의 custody 조항(«custody 층은 통합하지 않는다»)을 부분 대체하는 ADR 을 K1b-2 와 함께 쓴다.
담을 것: 0030 의 재검토 조건이 충족됐다는 측정(§1 표), 커널이 고정하는 것과 전략이 넘기는 것(§4.2·§5.2),
되돌림 중 무엇을 커널에 넣지 않았고 왜(§3). 0030 본문에는 대체 사실만 한 줄 적는다.

## 6. 지켜야 할 행동 (K1b-1 특성 테스트 최소 범위)

실제 DB, 세 전략 각각.

| 경우 | 기대 |
|---|---|
| `unpickShipment`, 상태 `picking`, 현재 피커 | `queued`, 잔량 전부 `AT_SOURCE`, `returnedToSourceQty` = 잡힌 수량. tote 는 빈 토트 배정 해제·토트 `available` |
| `unpickShipment`, 상태 `ready_to_pack`, 이전 피커 / 관리자 | 위와 같음 |
| `unpickShipment`, 상태 `ready_to_pack`, 다른 작업자(비관리자) | `PICKING_UNPICK_FORBIDDEN` |
| `unpickShipment`, 상태 `picking`, custody 가 남의 자리에 있음 | `PICKING_CUSTODY_OWNER_MISMATCH` |
| `unpickShipment`, 상태 `ready_to_pack`, custody 가 남의 자리에 있음 | discrete·tote `PICKING_PACKING_CUSTODY_INCOMPLETE`. aggregate 는 지금 `PICKING_CUSTODY_OWNER_MISMATCH` (D3) |
| `unpickShipment`, grain 위반과 소유자 위반이 함께 있음 | discrete·tote 는 grain 위반 코드. aggregate 는 지금 잔량 순서에 따름 (D3) |
| 전략 `handoff`, 다른 작업자에게 | 새 피커·리스 갱신. discrete·aggregate 는 custody 가 새 작업자 자리로, tote 는 그대로(`movedQty: 0`) |
| 전략 `handoff`, 같은 작업자에게 | discrete·tote 성공. aggregate 는 지금 400 (D1) |
| `completePick`, 미충족 | 전략별 지금 에러 코드 |

## 7. 배포

- K1a 와 K1b 는 마이그레이션이 없다. 순서 제약도 없다(core 단독, API 응답 모양 불변).
- PR 은 K1a / K1b-1 / K1b-2 셋을 제안한다(빌더 판단으로 조정 가능). K1b-1 은 테스트만이라 언제 머지해도 된다.
- `commandType`·멱등 키가 그대로이므로 배포를 걸친 재시도도 지금처럼 멱등이다.

## 8. 빌더에게 맡기는 것

- 커널의 이름·파일 위치·시그니처. 위치는 `fulfillment/picking/` 안. Nest provider 로 할지 함수로 할지.
- 커널 본문 콜백에 `lockAndAssertPickerClaim` 의 반환값(작업 항목 행)을 넘길지. 지금 7곳은 반환값을 쓰지 않는다.
- 소유자 조회 정책의 정확한 타입. 단, §5.2 의 «조회는 허용 자리만 돌려주고 판정은 커널이 한다»는 지킨다.
- 세 전략의 unit spec(`*.strategy.spec.ts`) 중 커널로 옮겨진 공통 절차를 전략마다 반복 검증하던 부분을 커널 spec 으로
  옮길지. 공통 계약 spec(`definePickingStrategyContract`)의 기대값은 그대로 둔다.
- 새 가드 spec 의 구현 방식(문자열 매칭 vs AST).

## 9. 곁에서 찾은 것 (이 작업 밖)

- 감사 §9 의 미검증 추정(교환 검증이 취소 수량을 빼지 않음)은 여기와 무관하며 그대로 남는다.
