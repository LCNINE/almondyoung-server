# K2 상자 수명주기 커널 — 상태는 전이표 하나로, 구성 편집은 한 문으로

2026-10-19 develop `3cd4a5631` 코드 기준. 라이브 실측 없음. 출발점은 구조 감사
`docs/order-logistics-architecture-audit-2026-10.md` §4.1·§4.2·§8.1 의 K2 이고, 직전 작업 K1(ADR-0045,
`docs/superpowers/specs/2026-10-19-k1-picking-work-item-command-kernel-design.md`)의 방식을 따른다.

## 1. 왜

상자(`shipments` + `shipment_lines`)는 물류의 핵심 객체인데, 그것을 다루는 모듈이 얕다. 상자 행에 쓰는 파일이
테스트·픽스처를 빼고 12개이고, «이 전이가 합법인가, 무엇을 리셋하나, 구성을 바꾸면 무엇을 따라 올려야 하나»라는
지식이 쓰는 곳마다 흩어져 있다.

**사용자가 말한 이유는 막혔던 버그가 아니다.** 물류의 핵심 객체를 더 깊은 모듈이 다뤄야 한다는 직관이고,
K1 과 같은 «AI 로 작업하기에 불안한 코드»의 문제다. 그래서 정당화는 «호출자가 기억해야만 맞는 규칙»이
실제로 있느냐로만 한다. 있다:

1. **구성 변경과 버전 올리기가 떨어져 있다.** `services/draft-line-shrink.ts:17` 이 «박스 상태·manifestVersion·recompute
   도 호출자 몫이다»라고 적는다. 줄을 바꾼 호출자가 `manifestVersion` 을 잊으면 낡은 송장 검사가 조용히 무력해진다.
2. **`draft` 로 되돌리는 전이가 줄까지 리셋한다.** 회수(`shipment-recall.service.ts:434`)와 결품 이탈
   (`short-pick-exit.service.ts:105`)은 상태를 되돌리며 줄의 `inspectedQty` 도 지운다. 상태만 아는 모듈로는 이 리셋을
   혼자 책임질 수 없다 — 감사가 말한 «상태만» K2 가 좁은 이유다.
3. **구성은 `draft` 에서만 바꿀 수 있다.** 같은 전제 검사(draft · 작업/보관 없음 · 활성 송장 없음)를 분할 둘, 수령인
   정정 둘, 계획, 구성 수정이 각자 부른다.

## 2. 목표

- **G1. 상자 상태를 바꾸는 쓰기는 모두 한 함수를 지난다.** 그 함수가 전이표(from → to)를 보고, 직전 상태 CAS 를
  걸고, 목표 상태의 리셋 규칙을 적용한다.
- **G2. 상자 구성(줄 추가·이동·수량, 수령인, 배송 프로필)을 바꾸는 쓰기는 모두 한 문을 지난다.** 문이 잠금·전제
  검사를 하고, 끝날 때 바뀐 상자마다 `manifestVersion` 을 올리고 예약을 재계산한다. 호출자가 잊을 수 없다.
- **G3. 바깥에서 커널을 우회해 상자 상태·구성을 쓰면 가드 spec 이 빨갛다.**
- **G4. 동작 변경은 §9 의 이름 붙은 결정으로만 한다.**

## 3. 하지 않는 것 · 실패로 보는 것

**범위 밖(사용자 합의, 2026-10-19):**
- **예약** — 이미 `ShipmentReservationService` 에 모여 있다. 새는 곳만 그쪽으로 돌린다(§7).
- **검수** — `inspectedQty`·`forced` 의 전진 쪽(`shipment-dispatch.service.ts:314·387`, `box-allocation.manager.ts:637`).
  포장 진행이고 K1(피킹) 쪽 이웃이다. 리셋 쪽만 커널이 소유한다(§5.3).
- **현관 비밀번호 파기** — 2곳(`shipment-delivery-tracking.service.ts:373`, `sales-order/services/entrance-password-cleaner.ts:181`).
- **배송 추적 이벤트 해석** — 추적 서비스는 해석을 그대로 갖고, 상태 쓰기만 커널을 부른다.

**이번에 하지 않는 것(내 판단):**
- 오퍼레이션 기록(`createShipmentOperation`·`completeShipmentOperation`·before/after 스냅샷·감사 로그) 통합.
  모양이 명령마다 달라(회수·결품·합배송은 자기 형식) 하나의 틀에 넣으면 hook 투성이가 된다(ADR-0026 이 경계한 것).
- 대기 오퍼레이션 재개 API 두 벌(K4), FO 상태 투영(K3), 상태 enum 에서 `failed` 삭제(파괴적 DB 변경이라 별도).
- `inventory.schema.ts` 를 모듈별로 쪼개는 일(감사 §3.1).

**실패로 보는 것:**
- 상자 엔티티에 모든 관심사를 붙인 넓은 모듈. 메서드가 늘어 «상자에 관한 것은 다 여기»가 되면 실패다.
- `commandType`·멱등 키·`canonicalRequest`·에러 코드·메시지가 한 글자라도 바뀌는 것(배포를 걸친 재시도의 멱등).
  같은 검사인데 호출자마다 코드가 다른 곳(`SHIPMENT_NOT_DRAFT`·`BOX_NOT_DRAFT`·`SHIPMENT_REOPEN_REQUIRED`)도
  각자 그대로 둔다.
- 검사 순서가 바뀌어 위반이 여럿일 때 나오는 에러가 달라지는 것(§9 에 없으면).

## 4. 지금 지도

다시 재는 명령(spec·`__support__` 제외):

```bash
cd apps/core/src
grep -rlE --include=*.ts '\.(update|insert|delete)\((\w+\.)?(shipments|shipmentLines)\)' . | grep -v spec.ts | grep -v __support__
```

| 갈래 | 칼럼 | 쓰는 곳 |
|---|---|---|
| 상태 | `status`, `recoveryCode`, `plannedAt`·`shippedAt`·`deliveredAt`·`supersededAt` | 6파일 13곳 + 생성 4곳 |
| 구성 | 줄 insert·`shipmentId` 이동·`qty`, `lineVersion`, `recipientSnapshot`·`entrancePassword`(정정), `shippingProfileId`, `manifestVersion` | planning(분할·취소·정정·계획), `draft-line-shrink.ts`, `draft-box/draft-box-amender.ts`, consolidation, `fulfillments.service.ts`(생성) |
| 예약 | `reservedQty`, `reservationVersion` | `shipment-reservation.service.ts` + 새는 곳 2(§7) |
| 검수 | `inspectedQty`·`forced` 전진 | dispatch, box-allocation |
| 파기 | `entrancePassword` → null | 2곳 |

잠금은 이미 둘로 정리돼 있다. `lockShipmentAggregate`(`services/shipment-aggregate.ts:58`, 낙관 로드 →
`assertFulfillmentOrders` 가 `shipments` 행까지 `FOR UPDATE` → 재로드 → 줄 서명 비교)를 planning·amender·
line-composition-edit 가 쓰고, consolidation 은 여러 상자판을 따로 구현한다(`consolidation.service.ts:808`).
dispatch 는 예약 그래프 락(`lockShipmentGraphForDispatch`)이고, 회수·결품 이탈·추적은 직전 상태 CAS 다.

## 5. 커널 A — 상태 전이

### 5.1 전이표 (지금 코드에서 도출, 전수)

| from | to | 쓰는 곳 | 지금 보호 |
|---|---|---|---|
| (생성) | `draft` | FO 생성 `fulfillments.service.ts:282`, 분할 대상 `shipment-planning.service.ts:1485`, 합배송 대상 `consolidation.service.ts:629` | — |
| (생성) | `canceled` | 묘비 `draft-line-shrink.ts:47` | — |
| `draft` | `planned` | 계획 `planning:542` | 잠금 |
| `draft`·`planned` | `recovery_required`(`CANCEL_REPLAN_PENDING`) | 취소 대기 갈래 `planning:687` | 잠금 |
| `draft`·`planned` | `recovery_required`(`CONSOLIDATION_PENDING`) | 합배송 보류 `consolidation:515` | 잠금 |
| `shipped` | `recovery_required`(`DISPATCH_RECALL_PENDING`) | 회수 검역 `shipment-recall.service.ts:252` | CAS status |
| `planned` | `draft` | 취소 손질 `revert_planned` `planning:1359`, 결품 이탈 `short-pick-exit.service.ts:85`, 이탈 취소 완료(`finishWithdrawnCancellation` → `applyPendingCancellation`) `planning:1199` | 잠금 / CAS status+manifest / 잠금 |
| `recovery_required`(`CANCEL_REPLAN_PENDING`) | `draft` | 취소 재개 `planning:1199` | 잠금 |
| `recovery_required`(`DISPATCH_RECALL_PENDING`) | `draft` | 회수 완료 `recall:438` | CAS status+code+manifest |
| `draft` | `canceled` | 전량 취소 `planning:1409` | 잠금 |
| `draft`·`planned`·`recovery_required`(`CONSOLIDATION_PENDING`) | `superseded` | 합배송 활성화 `consolidation:728` | 잠금 |
| `planned` | `shipped` | 출고 `shipment-dispatch.service.ts:838` | 그래프 락 + `assertDispatchCandidate` |
| `shipped` | `in_transit` | 추적 `shipment-delivery-tracking.service.ts:212` | CAS |
| `shipped`·`in_transit` | `delivered` | 추적 `:217` | CAS |

`planning:1409` 의 일부 취소(`draft → draft`)는 전이가 아니라 구성 편집이다(§6).

**`planned → superseded` 는 막힘 없는 합배송의 즉시 경로다**(리뷰에서 찾음). `TERMINAL_OR_UNSAFE_SOURCE_STATUSES`
(`consolidation.service.ts:23`)에 `planned` 가 없고, `consolidate()`(`:329-346`)는 원본이 draft 가 아니면
`SHIPMENT_REOPEN` 권한만 요구한 뒤 막힘이 0이면 곧바로 활성화한다. 배치·송장이 아직 없는 `planned` 상자가
대기 없이 `superseded` 가 되고 `plannedAt` 이 남는다. 지금 동작이므로 전이표에 넣고 그대로 둔다(§13).

**버전을 올리는 전이:** `→ canceled`(`planning:1412`)와 `→ superseded`(`consolidation:732`, `reservationVersion` 도)는
줄을 옮기지 않는데도 지금 `manifestVersion` 을 올린다. 전이표가 전이마다 «버전을 올린다»를 들고, 이 둘과 `→ draft`(§5.3)에
켠다. 지금 동작 보존이다.

**도달 불가:** `failed` 는 상자에 쓰는 곳이 0이다. `consolidation.service.ts:23` 의 `'open'` 은 enum 에 없는
값이다(V1 잔재). 전이표에는 넣지 않고 §13 에 적는다.

### 5.2 전이 함수

모든 상태 쓰기(생성 포함)는 커널의 함수 하나를 지난다. 그 함수가 하는 일:

1. (from, to) 가 전이표에 있는지 본다. 없으면 **프로그래밍 오류**다(`Error`, 500).
2. `WHERE id = ? AND status IN (from…)` 으로 CAS 한다. 호출자가 더 걸던 조건(`recoveryCode`, `manifestVersion`)도
   그대로 받는다. 0행일 때의 처리는 세 가지이고 호출자가 고른다: **호출자가 지금 던지는 그 에러**(회수·결품 이탈, 코드 보존),
   **내부 오류**(잠금으로만 보호하던 곳 — 0행이 도달 불가다, §8), **조용히 무시**(배송 추적
   `shipment-delivery-tracking.service.ts:210-222` — 순서가 뒤바뀌거나 중복된 택배사 이벤트를 흡수한다. 던지면 추적 이벤트
   기록까지 롤백된다).
3. 목표 상태의 리셋 규칙(§5.3)과 전이별 시각(`plannedAt`·`shippedAt`·`deliveredAt`·`supersededAt`)을 쓴다.
4. `recoveryCode` 는 커널이 소유하는 유니언 타입(`CANCEL_REPLAN_PENDING`·`CONSOLIDATION_PENDING`·`DISPATCH_RECALL_PENDING`)으로
   받는다. `recovery_required` 로 가는 전이는 코드 없이는 부를 수 없고, 거기서 나가는 전이는 항상 비운다.

정확한 시그니처는 빌더 몫이다(§12).

### 5.3 재개봉(`→ draft`) 리셋 — 하나로 통일한다 (사용자 결정 2026-10-19, 세부는 §9 D1·D2)

지금 네 경로가 서로 다르게 리셋한다:

| 경로 | `recoveryCode` | `plannedAt` | `shippedAt`·`deliveredAt` | `manifestVersion` | 줄 `inspectedQty`·`forced`·`lineVersion` |
|---|---|---|---|---|---|
| 회수 완료 | 비움 | 비움 | 비움 | +1 | 0 · false · 전 줄 +1 |
| 결품 이탈 | 비움 | 비움 | — | +1 | 0 · — · 전 줄 +1 |
| 취소 재개·이탈 취소 완료 | 비움 | 비움 | — | — (뒤따르는 구성 편집이 +1) | — |
| 취소 손질 `revert_planned` | — | 비움 | — | — (뒤따르는 구성 편집이 +1) | — |

**통일 규칙:** `→ draft` 는 `recoveryCode`·`plannedAt`·`shippedAt`·`deliveredAt` 을 비우고, 줄의 검수 흔적
(`inspectedQty > 0` 또는 `forced`)을 지우며, `manifestVersion` 을 올린다. 줄 버전과 상자 버전을 어떻게 올리는지는
§9 D1·D2 가 정한다. 차이 중 동작에 영향이 없는 것은 §8, 있는 것은 §9 다.

## 6. 커널 B — 구성 편집의 문

### 6.1 대상

| 명령 | 지금 위치 | 허용 상태 |
|---|---|---|
| 분할 `split`·`splitUnreserved` | `planning:177·263` → `applySplit` | `draft` |
| 수령인 정정(운영자) | `planning:338` | `draft` |
| 수령인 정정(채널) | `planning:421` | `draft`·`planned` |
| 구성 수정 `amend` | `draft-box/draft-box-amender.ts` | `draft` |
| 취소의 줄 줄이기 | `applyDraftCancellation`(`planning:1367`) → `shrinkDraftLines` | `draft`(손질 뒤) |
| 합배송 활성화 | `consolidation:602` | 원본 `draft`·`planned`(막힘 없음) 또는 보류 중, 대상은 새 상자 |
| 상자 생성 | `fulfillments.service.ts:282` | 새 상자 |

### 6.2 문이 고정하는 것

1. **잠금.** 한 상자는 `lockShipmentAggregate`. 여러 상자는 같은 모양의 여러 상자판 하나를 커널에 두고
   consolidation 의 자체 구현(`consolidation:808`)을 그것으로 바꾼다. 줄 서명은 consolidation 의 더 넓은 것
   (`shipmentId:lineId:foiId:lineShipmentId`)을 쓴다 — 한 상자판의 서명(`lineId:shipmentId`)을 포함한다.
2. **전제 검사.** 허용 상태, `assertShipmentHasNoCustodyOrActiveWork`, `assertShipmentHasNoActiveWaybill`.
   검사 순서와 에러 코드는 호출자별로 지금 그대로다(§3).
3. **쓰기 도구.** 문 안에서만 얻을 수 있는 쓰기 도구로 줄을 넣고·옮기고·줄이고·늘리고, 새 상자(draft 또는 묘비)를
   만들고, 수령인·프로필·현관 비밀번호를 바꾼다. 도구는 손댄 줄의 `lineVersion` 을 올리고 상자마다 **무엇이 바뀌었는지**
   기록한다: 송장 내용(줄·수령인·프로필)인지, 줄인지.
4. **끝맺음.** 본문이 끝나면
   - **송장 내용이 바뀐 상자**마다 `manifestVersion` 을 정확히 한 번 올린다(새 상자는 1).
     **현관 비밀번호만 바뀐 상자는 올리지 않는다** — `resolveRecipientRevision`(`planning:131-157`)의 주석대로,
     주소가 그대로인데 버전이 움직이면 멀쩡한 송장이 stale 로 무효화되고 합배송 호환성 입력이 흔들린다. 지금 동작 보존이다.
   - **줄이 바뀐 상자**만 예약을 재계산한다. 수령인 정정은 지금 재계산하지 않으므로 문도 부르지 않는다.

   `draft-line-shrink.ts:17` 의 «호출자 몫»이 사라진다. 가드의 칼럼 허용 목록에서 `entrancePassword` 는 «커널 밖에서는
   null 로 지우는 파기만»으로 둔다.

**문에 넣지 않는 것:** 오퍼레이션 기록·감사 로그(§3), FO 항목 수량(`canceledQty`·`qty`) 쓰기 — 이건 «고객 취소인가
구성 변경인가»라는 업무 판단이라(#1063 스펙 §6.3) 호출자에 남는다. 예약 해제·이전·추가(`releasePartial`·`transfer`·
`reservePartial`)도 예약 서비스를 그대로 부른다. 문이 하는 예약 일은 끝맺음의 재계산뿐이다.

### 6.3 계획은 전이다

`plan`(`planning:542`)은 `draft → planned` 전이이면서 프로필이 바뀌면 `manifestVersion` 을 올린다. 커널 A 의
전이 함수가 «이 전이와 함께 바뀌는 구성»을 받아 같은 규칙(바뀌면 한 번 올림)을 적용한다. 문을 지나지 않는다.

## 7. 예약 누수 두 곳 (사용자 합의)

- `consolidation.service.ts:710·724` — 합배송이 `stock_reservations` 의 대상을 새 줄로 바꾸고 원본 줄
  `reservedQty` 를 0 으로 직접 쓴다. 예약 서비스에 «줄 여럿의 확정 예약을 새 줄 하나로 옮긴다» 메서드를 두고 그걸 부른다.
- `planning:1539` · `consolidation:728·739` — `reservationVersion` 을 직접 올린다. 예약 서비스의
  `bumpReservationVersions`(`shipment-reservation.service.ts`)를 부른다.

## 8. 통일하는 어긋남 (동작 영향 없음)

| 어긋남 | 근거 | 통일 |
|---|---|---|
| 결품 이탈·취소 경로가 `forced` 를 안 지움 | `forced = true` 는 `forceDispatch` 가 `→ shipped` 와 같은 트랜잭션에서만 쓴다(`dispatch:387` → `dispatchLocked` → `:838`). 회수가 지우므로 `shipped` 가 아닌 상자는 늘 false | 지운다 |
| 회수 외 경로가 `shippedAt`·`deliveredAt` 을 안 비움 | 같은 이유 — `→ shipped`·`→ delivered` 에서만 쓰고 회수가 비운다 | 비운다 |
| `revert_planned` 이 `recoveryCode` 를 안 비움 | 비-null 로 쓰는 곳은 모두 `→ recovery_required` 이고 거기서 나가는 곳은 모두 비운다 → `planned` 상자는 늘 null | 비운다 |
| 잠금으로만 보호하던 전이에 CAS 추가 | `lockShipmentAggregate` 가 `shipments` 행을 `FOR UPDATE` 로 잡은 뒤 상태를 검사했다(`fulfillment-invariant.service.ts` 의 `assertFulfillmentOrders`) | CAS, 0행은 내부 오류 |
| 취소 경로(`revert_planned`·취소 재개)가 줄 `inspectedQty` 를 안 지움 | 준비도가 검수 흔적을 막힘으로 판정한다(`cancel-readiness.ts:112` `INSPECTED_QTY`). 즉시 적용·재개는 `ready` 일 때만이다. 리뷰가 코드로 확인, 특성 테스트로 고정한다 | 지운다(no-op) |
| 결품 이탈이 지우는 `inspectedQty` | 결품 이탈은 `exitIfDrained`(`box-withdrawal.service.ts:263`)가 배정 합 0 일 때만 부르고, PACKED 를 빼는 쪽이 검수도 함께 내린다(`box-allocation.manager.ts:635-652`) → 이 시점의 줄은 이미 전부 0 이다 | 지운다(no-op). 줄 버전은 D1 |
| 취소 즉시 갈래가 `assertShipmentHasNoActiveWaybill` 을 따로 안 부름 | 손질이 `registered` 송장을 무효화하고, 무효화할 수 없는 송장은 준비도가 막는다(`cancel-readiness.ts:110` `WAYBILL_NOT_VOIDABLE`). 리뷰가 코드로 확인 | 문이 부른다. 즉시 갈래는 문을 통해 보관(custody)·작업 가드(`assertShipmentHasNoCustodyOrActiveWork`)도 이제 지나는데, 준비도가 이미 `ready` 일 때만 이 갈래에 들어오므로 막힘이 없다(준비도가 덮는다) |
| 합배송 활성화가 custody/work·waybill 가드를 안 탐 | 활성화는 자기 여러-상자 잠금만 쓰고 두 가드를 부르지 않았다 | 이제 문을 지나며 두 가드를 탄다. 합배송의 `collectBlockers` 가 더 넓은 조건이라 이미 막힌 요청만 걸려, 막히는 요청은 늘지 않는다 |

**구현 중 더한 것(2026-10-19):**
- 취소 재개·이탈 취소 완료는 재개봉 앞의 호출자 가드(송장 → 보관 순)를 그대로 두고, 재개봉 뒤 문이 같은 가드를 다시 확인한다. 위반이 여럿일 때 나오는 에러 우선순위를 보존하려고 일부러 중복으로 뒀다.
- 회수의 `lineVersion` 은 여전히 +2 다(예약 복원 +1, 재개봉 검수 리셋 +1). 예약 서비스의 복원이 줄 버전을 올리는 것은 가드 허용 목록에 `lineVersion`(`shipment-reservation.service.ts`)으로 남았다.
- 구성 편집의 쓰기 도구 `setEntrancePassword` 는 `last_updated` 를 찍고(옛 동작 보존) 어떤 버전도 올리지 않는다.
- 가드는 별칭 선언을 허용하되, 별칭이나 직접 import 한 `shipments`·`shipmentLines` 식별자가 `.update/.insert/.delete` 인자로 쓰이면 같은 칼럼 규칙을 적용하고, 그런 별칭을 export 하면 위반이다. raw SQL 은 `public.`·따옴표·`ONLY` 형태도 잡는다. 한계는 가드 파일 머리 주석이 정본이다.
- 잠금 `lockShipmentAggregates`(여러 상자)는 `services/shipment-aggregate.ts` 에, 문이 넘긴 정렬된 잠금 결과에서 id 로 찾는 `lockedAggregateOf` 는 `shipment/shipment-manifest-edit.ts` 에 있다. `ShipmentReservationService` 는 `bumpReservationVersions`·`retargetConfirmed` 를 공개 메서드로 얻었다(§7).

## 9. 이름 붙은 동작 변경 (사용자 결정, 2026-10-19)

K1 과 같은 방식이다: 먼저 **지금 동작을 그대로 기록하는 테스트**를 두고, 통합 단계에서 그 테스트의 기대값만 바꾼다.

**D1. 재개봉 때 줄 버전은 «검수 흔적을 지운 줄»만 오른다.** 사용자 결정(2026-10-19).
- 지금: 회수·결품 이탈은 전 줄 `lineVersion + 1`, 취소 경로는 안 올린다.
- 바뀌는 것: **결품 이탈의 줄 버전 올림이 통째로 사라진다.** 결품 이탈 시점의 줄은 이미 전부 검수 0 이라(§8) 지울 흔적이
  없기 때문이다. 회수는 전 줄이 검수돼 있어(`inspectedQty = qty`) 지금과 같고, 취소 경로도 지금과 같다(안 올림).
  재개봉에서 줄 버전이 오르는 경로는 회수 하나만 남는다.
- 위험: 결품 이탈 전 화면을 들고 있던 클라이언트의 줄 버전이 그대로 맞게 된다. 다만 분할·취소는 `expectedManifestVersion`
  도 검사하고 재개봉이 그걸 올리므로(D2) 낡은 화면은 여전히 막힌다.
- 근거: 이 저장소에서 줄 버전은 «그 행이 바뀌었다»는 뜻이다(분할·줄이기는 손댄 줄만 올린다).
- 대안: 재개봉은 전 줄을 올린다(회수 방식). 그러면 결품 이탈은 지금과 같고, 취소 경로에서 전 줄 버전이 새로 오른다.

**D2. 재개봉은 언제나 `manifestVersion` 을 올린다.** 사용자 결정(2026-10-19).
- 지금: 회수·결품 이탈만 재개봉에서 올리고, 취소 경로는 뒤따르는 줄 줄이기에서 한 번 올린다.
- 바뀌는 것: `planned`·대기 상자를 취소하면 **+1 대신 +2** 오른다(재개봉 +1, 구성 편집 +1). 응답·오퍼레이션 스냅샷의
  숫자가 달라진다. 대기 의도의 `expectedManifestVersion` 은 재개봉 전에 검사하므로 영향이 없다.
- 근거: 「재개봉은 송장을 낡게 만든다」를 한 규칙으로 둔다. 숫자가 더 많이 오르는 쪽은 낡음 판정에서 보수적이다.
- 대안: 재개봉은 올리지 않고 구성·수령인·프로필이 바뀔 때만 올린다. 그러면 회수·결품 이탈에서 +1 이 사라진다.
  송장 재출력 게이트(#992)가 이 숫자를 보므로 위험하다고 본다.

빌더가 통합 중 새 차이를 찾으면 §8(근거 필수) 또는 §9 에 더한다. §9 에 들어가는 것은 사람에게 묻는다.

## 10. 진행

1. **특성 테스트.** 재개봉 네 경로의 리셋 결과, §9 후보의 지금 동작, §8 추론 두 개(취소 경로의 `inspectedQty`,
   즉시 갈래의 활성 송장)를 통합 테스트로 기록한다. 로컬 공유 `core` DB 는 마이그 이력이 깨져 있어
   `test:core:integration:local` 이 죽는다 — K1 처럼 임시 DB 를 만들어 drizzle migrate 뒤 `--runInBand` 로 돌린다.
2. **커널 A.** 전이표·전이 함수를 두고 13곳 + 생성 4곳을 옮긴다.
3. **커널 B.** 문·쓰기 도구를 두고 §6.1 을 옮긴다. consolidation 의 잠금을 커널 여러 상자판으로 바꾼다.
4. **예약 누수(§7).**
5. **§9 기대값 변경**과 가드 spec.
6. **ADR.** 다음 번호로 «상자 상태·구성은 커널 하나를 지난다»를 쓴다. 감사 문서 §8.1 의 K2 항목을
   «상태 + 구성»으로 고친다(원본을 고친다).

**가드 spec(G3):** 커널 폴더 밖에서
- `shipments` 의 insert·delete, `.set` 에 `status`·`recoveryCode`·전이 시각·`manifestVersion`·`recipientSnapshot`·
  `shippingProfileId` 가 들어간 update
- `shipmentLines` 의 insert·delete, `.set` 에 `shipmentId`·`qty` 가 들어간 update

를 찾으면 빨갛다. 허용 목록은 칼럼 단위로 둔다: 예약 서비스의 `reservedQty`·`reservationVersion`, 검수의
`inspectedQty`·`forced`·`lineVersion`(dispatch·box-allocation), 파기의 `entrancePassword`, 모든 곳의 `lastUpdated`.
raw SQL(`UPDATE shipments`)도 잡는다. K1 의 `picking/work-item-command.guard.spec.ts` 가 본이다.

**PR:** K1 처럼 한 PR 로 squash-merge 한다(내 판단). 중간 커밋이 옛 가드 때문에 빨개질 수 있다.

## 11. 배포

마이그레이션 없음, core 하나. 에러 코드·멱등 키를 바꾸지 않으므로 배포를 걸친 재시도도 지금처럼 멱등이다.
바깥에서 보이는 차이는 §9 의 버전 숫자뿐이다. 묶음 배포에 실려도 순서 제약이 없다.

## 12. 빌더에게 맡기는 것

- 전이 함수·문·쓰기 도구의 정확한 시그니처와 파일 배치(제안: `fulfillment/shipment/` 폴더. `services/shipment-aggregate.ts`
  의 잠금·로드는 그리로 옮겨도 된다).
- 에러 코드를 보존하는 방식(호출자가 에러를 넘기거나, 커널이 결과를 돌려주고 호출자가 던지거나).
- `lockShipmentAggregate` 의 여러 상자판이 한 상자판을 대체할지, 둘을 둘지.
- 가드 spec 의 구현(AST 또는 정규식). K1 가드의 방식을 따르면 된다.

## 13. 곁에서 찾은 것 (이 작업 밖)

- `failed` 상태는 상자에 쓰는 곳이 0이다. enum 정리는 파괴적 변경이라 별도 PR(ADR-0005 §5).
- `consolidation.service.ts:23` 의 `'open'` 은 enum 에 없는 V1 잔재다.
- 막힘 없는 `planned` 상자는 합배송에서 대기 없이 곧바로 `superseded` 가 되고 `plannedAt` 이 남는다(§5.1). 지금 동작이라 보존했다.
- 회수는 `shipped` 상자만 받는다(CAS `status = 'shipped'`). `in_transit` 상자는 회수할 수 없다. 의도인지 확인 안 함.
- `CONSOLIDATION_PENDING` 에서 나가는 길은 재개(→ `superseded`)뿐이다. 합배송을 포기하는 경로가 없다.
- `recoveryCode` 문자열이 `order-progress.thresholds.ts`·`order-progress.judge-sql.ts`·리컨실러 규칙에도 적혀 있다.
  커널의 유니언 타입을 그쪽이 import 하게 할 수 있지만 SQL 문자열은 남는다.
