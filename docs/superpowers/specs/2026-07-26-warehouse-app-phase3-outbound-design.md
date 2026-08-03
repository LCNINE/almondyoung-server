# 물류 현장 앱 Phase 3 — 출고작업(단순출고 우선) 설계 스펙

- 날짜: 2026-07-26
- 대상: `native/warehouse-app` + `apps/core` (fulfillment)
- 브랜치: `docs/warehouse-app-phase3-outbound` (base `ec107e7e4`)
- 상태: 설계 승인됨 (구현 전) — 브레인스토밍 산출물
- 상위 문서: `docs/superpowers/specs/2026-07-20-warehouse-native-app-design.md` (마스터 §11 Phase 3), `docs/superpowers/specs/2026-07-22-warehouse-app-page-structure-design.md` (IA 스켈레톤)
- 관련: `docs/adr/0027-outbound-shipment-consumes-stock-ledger.md`, `docs/logistics-backend-hardening-2026-07.md` (W4)

## 1. 목표

현장에서 **출고작업을 앱으로 완결**한다(핸드헬드·스테이션 공통). 마스터 설계의 Phase 3(피킹)·Phase 4(패킹)를 **하나의 `출고작업` IA 로 통합**하고, 현장이 레거시 시스템에서 쓰던 절차를 새 원장 모델 위에서 그대로 재현하는 **단순출고 경로**를 주 경로로 만든다.

### 왜 피킹과 패킹을 합치는가

마스터 설계는 피킹(P3, 핸드헬드)과 패킹(P4, 스테이션)을 별개 Phase·별개 허브 타일로 뒀다. 그러나:

1. **백엔드 도메인 모델이 이미 "한 작업의 두 단계"** 다 — 하나의 work item 에 `pickerClaim`/`packerClaim` 이 붙고 custody 가 `PICKING → PACKING` 으로 전이한다. 두 개의 독립 작업이 아니다.
2. **현장은 두 단계를 빠르게 번갈아 수행**한다. 스테이션 프로필은 포장 검수만 하지만, 핸드헬드 작업자는 한 박스를 통으로 끝내는 경우가 많다. 담당 분리도 발생한다(피커/패커가 다름, 교대·이석).
3. 메뉴가 둘이면 **대기열이 두 군데로 쪼개져 "지금 무엇을 집을까"에 답하지 못한다.** 배치 배정형 운영에서 이게 가장 아프다.

따라서 사용자가 보는 단위는 "피킹/패킹이라는 메뉴"가 아니라 **"출고 작업 하나가 어느 단계에 있는가"** 로 바꾼다.

## 2. 현장 절차 (레거시) — 재현 대상

```
관리자: 재고 할당이 끝나 출고만 남은 송장을 한가득 뽑아 쌓아둔다
작업자: 아무거나 한 장 집어간다 → 종이 송장에 적힌 상품을 피킹
포장대: 송장 스캔 → 상품 전부 스캔(검수) → 예외 시 강제출고로 전량 처리
        → 전부 스캔되면 시스템이 자동 출고완료 → 박스 포장 → 택배사 수거 영역에 적재
교대:   피킹한 사람과 포장한 사람이 다를 수 있다 (이석 등)
```

새 시스템 도입에 맞춰 작업 방식을 어느 정도 바꿀 수는 있으나, **이 절차를 지원하는 쪽**으로 설계한다.

## 3. 백엔드 실측 — 무엇이 되고 무엇이 안 되는가

### 3.1 레거시 절차의 대부분은 이미 지원된다

| 레거시 동작 | 지원 근거 |
|---|---|
| 송장을 미리 발급해 쌓아둠 | `lockAggregate` 가 **active waybill 정확히 1건을 요구** (`shipment-dispatch.service.ts:359-371`, 없으면 409 `SHIPMENT_INVOICE_NOT_READY`) — 오히려 선발급이 전제다 |
| 전부 스캔되면 자동 출고완료 | `shipment-dispatch.service.ts:209-212` 가 `lines.every(inspectedQty === qty)` 일 때 `dispatchLocked` 자동 호출 (ADR-0027 §4) |
| 예외 시 강제출고 | `POST shipments/:id/force-dispatch` 가 미검수 수량을 `forced: true` 로 채우고 출고 (`:263-286`). `DISPATCH_FORCE` 스코프 필요 |
| 피커/패커 교대 | work item 의 picker/packer claim 분리 + `handoffs` |

### 3.2 그러나 "피킹 건너뛰고 검수 시작"은 불가능하다

`inspectionScan` 과 `forceDispatch` **둘 다** `lockAggregate`(`shipment-dispatch.service.ts:308`)를 통과해야 하고, 거기서 네 조건을 요구한다:

| 조건 | 위치 | 실패 |
|---|---|---|
| work item 이 `ready_to_pack` 또는 `packing` | `:322-332` | 409 `SHIPMENT_WORK_ITEM_MISSING` |
| 그 배치의 active inventory session | `:333-343` | 409 `SHIPMENT_SESSION_MISSING` |
| 세션에 `HAND_IN` 이벤트 + `payload.planId` | `:344-355` | 409 `SHIPMENT_SESSION_PLAN_MISSING` |
| active waybill 1건 | `:359-371` | 409 `SHIPMENT_INVOICE_NOT_READY` |

`assertDispatchCandidate` 도 같은 상태를 재확인한다(`:482`). 그리고 `ready_to_pack` 을 세팅하는 곳은 **세 피킹 전략뿐**이다 (`discrete-picking.strategy.ts:747`, `aggregate-then-sort.strategy.ts:965`, `pick-to-tote.strategy.ts:1088`) — 다른 생산자가 없다. `HAND_IN` 도 피킹 경로에서만 발생한다.

**결론: 피킹 단계는 반드시 원장에 기록되어야 한다.** 이것은 우회할 대상이 아니다 — 재고를 어느 로케이션에서 뺐는지가 SHIP 이벤트의 근거이고(ADR-0027 §4), 그 근거가 없으면 향후 토탈피킹의 로케이션 전략도 의미를 잃는다.

### 3.3 그래서 유일한 실질 마찰: 스캔 2회

레거시는 포장대에서 상품을 **한 번** 스캔한다. 정식 경로대로면 피킹 스캔 + 검수 스캔 = **두 번**. 이것이 도입 저항의 핵심이며, 본 설계의 단순출고 경로가 해결하는 문제다.

### 3.4 strategy 패턴의 자유도 경계

`PickingStrategy`(`picking-strategy.interface.ts:341-350`)와 `picking-strategy.contract.spec.ts` 가 경계를 명시한다.

**전략이 정하는 것**: 할당 방식(`plan()` 전권, "공유 소스 과다 커밋 금지"만 계약) · 중간 custody 경로(`capabilities.custodyFlow`, custody 6종 `AT_SOURCE → WORKER | BULK_CART | TOTE | SORTING → PACKING`) · 스캔 단계의 수와 모양(`ScanPickingInput` 4종 union, 부족하면 인터페이스 확장 + 전용 컨트롤러 — `AggregateThenSortStrategy`·`PickToToteStrategy` 가 선례) · 물리 도구 요구(`requiresPhysicalTote`, `supportsAggregateSourcePick`) · 창고별 활성화(`warehouses.supported_picking_strategies`).

**전략이 못 바꾸는 것**: 종착점은 반드시 `PACKING` custody(`inspectionReadyCustody: 'PACKING'` 리터럴 타입, `InspectionReadyOutput.custodyType: 'PACKING'`, `custodyRef: work-item:<id>`) · `plan → start → scan* → completePick` + `unpickShipment` 골격 · 작업 단위 3단(배치 → plan → work item=박스) · **피킹은 경제적 재고를 건드리지 않는다**(contract spec `forbiddenEffects`: `stockLedgerWrites/reservationConsumptions/invoiceMutations/fulfillmentProgressWrites/shipmentEventsPublished` 전부 0) · 낙관락 규약(`expectedLeaseVersion` + `idempotencyKey`).

즉 **"피킹을 어떻게 하느냐"에는 자유도가 크지만 "출고작업 전체 절차"에는 거의 없다.** 자유도는 `AT_SOURCE → PACKING` 구간 안쪽에만 있고, 그 앞(배치·plan·work item 구조)과 뒤(검수 → 자동 dispatch → SHIP 원장)는 고정이다.

**따라서 단순출고는 새 피킹 전략이 아니다.** custody 흐름이 `discrete`(`AT_SOURCE→WORKER→PACKING`)와 동일하므로 새 전략을 만들 정당성이 없다. 필요한 것은 기존 `discrete` 를 자동으로 몰아주는 **유스케이스 서비스**다.

### 3.5 토탈피킹 현황 (문서 W4 정정 — 이슈 #542)

`docs/logistics-backend-hardening-2026-07.md` W4 는 "토탈피킹 미구현 / `picking-process.service.ts:89,177,257` throw" 로 적혀 있으나 **라인 참조가 낡았다.** 현재 `aggregate-then-sort.strategy.ts` 는 2,016줄 완전 구현이고 `fulfillment.module.ts:147-153` 에 DI 등록되어 전용 컨트롤러 3종(`picking/v2/aggregate-then-sort/{bulk-cart-scans,sort-scans,cart-handoffs}`)이 라이브다. `picking-process.service.ts` 는 전부 전략에 위임하며 throw 는 registry 미주입 방어용뿐이다.

토탈피킹 실행을 막는 것은 두 가지뿐이다:
1. 창고의 `warehouses.supported_picking_strategies` 에 `aggregate_then_sort` 포함 (`picking-strategy.registry.ts:42-52`, 없으면 409)
2. plan 생성 시 `strategy` 명시 (`POST picking/v2/plans` 가 `dto.strategy` 를 받음)

**정합성 공백**: 배치 생성은 `pickingMethod: 'individual'` 만 허용(`outbound-batch-orchestrator.service.ts:80` 409, DTO `outbound-batch-v2.dto.ts:16` 이 리터럴 타입)인데, 정작 두 전략 모두 `batch.pickingMethod` 를 참조하지 않는다(참조 0건). 즉 `individual` 로 기록된 배치 위에 `aggregate_then_sort` plan 을 올리는 것이 기술적으로 가능해 배치 라벨과 실제 수행 방식이 어긋날 수 있다. **본 Phase 범위 밖 — 이슈 #543 으로 분리.**

토탈피킹은 가까이 도입 예정이므로 **IA 는 이를 수용할 수 있게 설계하되 구현은 후속**으로 둔다(§5.3, §8).

## 4. core 변경 3건 (스키마 변경·마이그레이션 0건)

### 4.1 운송장번호 → shipment 조회 (신규)

종이 송장 스캔의 진입점. 현재 역방향 조회가 없다 — `GET shipments/:shipmentId/waybill` 은 정방향뿐이고, `GET fulfillments` 목록 필터에 `trackingNo` 가 없고, work item DTO 에도 없다(`EligibleShipmentResponseDto` 에만 존재). `waybills.tracking_no` 인덱스는 이미 있다(`inventory.schema.ts:2402`).

반환에는 앱이 화면을 그릴 최소 정보를 담는다: `shipmentId`, `trackingNo`, `carrier`, 배치/work item 소속 여부와 상태, 라인별 `{ shipmentLineId, skuId, skuName, barcode, qty, pickedQty, inspectedQty }`, 수취인 마스킹 표기.

### 4.2 단순출고 복합 스캔 (신규)

`POST /shipments/:shipmentId/simple-outbound-scans` + `Idempotency-Key`, body `{ barcode, quantity }`. 한 트랜잭션에서:

```
1. shipment → 배치 work item 확인 (없으면 409 — 관리자가 배치에 넣지 않았다는 뜻)
2. plan 없으면 배치 전체 shipmentIds 로 plan 생성 + start   (재호출 시 기존 plan 재사용)
3. picker claim 없으면 이 작업자로 claim                    (leaseVersion 을 클라이언트가 몰라도 됨)
4. barcode → shipment line 해석                            (검수의 resolveInspectionLine 재사용)
5. discrete 피킹 스캔 — sourceLocationId 는 plan allocation 에서 주입 (로케이션 스캔 불필요)
6. 박스 전 라인 피킹 완료 시 → completePick (HAND_IN + ready_to_pack)
7. 이어서 검수 스캔 replay → 전 라인 검수 완료 시 기존 자동 dispatch 발동
반환: 라인별 { qty, pickedQty, inspectedQty } + 박스 상태 + 출고완료 여부
```

작업자 체감은 스캔마다 진행이 오르고(3/5) **마지막 스캔에서 출고완료**다. 앞 스캔들은 피킹만 기록되고 마지막 스캔에서 완료+검수+dispatch 가 함께 일어나지만, 각 스캔이 원자적 1요청이라 중간 상태가 노출되지 않는다.

**설계 근거 — 왜 앱 오케스트레이션이 아닌가**: 앱에서 몰아주면 박스 하나(상품 5종)에 `plan+start+claim(3) + 피킹스캔(5) + completePick(1) + 검수스캔(5)` = 14 요청이 되어 핸드헬드 무선 환경에서 부분 실패가 실질적으로 발생하고, 중간 상태(`ready_to_pack`)에서 앱이 죽으면 재개 로직이 필요하다. 무엇보다 **앱이 core 내부 상태기계 순서(claim → plan → start → HAND_IN 이후에야 검수)를 재현해야 하는 결합**이 생긴다. 복합 엔드포인트는 스캔 1회 = 요청 1회 = 1 트랜잭션이며, idempotency-key 하나로 재시도가 안전하고, admin-web 도 같은 경로를 쓸 수 있다. 전략 계약을 깨지 않는다 — 기존 전략을 조합하는 유스케이스 서비스일 뿐이다.

**멱등성**: 기존 `FulfillmentCommandService.execute` 규약을 따른다(`commandType: 'shipment.simple_outbound.scan'`, canonicalRequest 에 `shipmentId`/`barcode`/`quantity`/`actorId`). 동일 키 재요청은 같은 결과를 돌려주고 이중 계상하지 않는다.

### 4.3 단순출고 강제출고 (신규)

레거시의 "예외적인 경우 모두 스캔한 것으로 처리"는 기존 `force-dispatch` 만으로는 불가능하다 — 그것은 work item 이 `ready_to_pack` 이어야 하는데, 미피킹 라인이 남아 있으면 `completePick` 자체가 되지 않는다. 따라서 미피킹 라인을 allocation 로케이션 기준으로 강제 피킹 → `completePick` → `force-dispatch` 까지 묶는 경로가 필요하다. `DISPATCH_FORCE` 스코프와 `reason` 을 그대로 요구한다.

**강제출고와 재고부족(short-pick)은 다른 사건이다.** 전자는 "물건은 맞는데 스캔을 생략", 후자는 "물건이 실제로 없음"(`POST shipments/:id/short-picks`, `reopen` 스코프). 없는 재고를 강제출고로 처리하면 원장이 거짓이 되므로 절대 대체하지 않는다.

**부족신고는 플랜 A 범위 밖이다 (2026-07-26 플랜 작성 중 정정).** `ReportShipmentShortPickDto`(`dto/shipment-short-pick.dto.ts:41-71`)가 `workItemId`·`expectedWorkItemLeaseVersion`·`planId`·`expectedPlanVersion`·`sessionId`·`expectedSessionVersion`·`expectedManifestVersion` 를 요구하는데, 단순출고는 이 내부 버전값을 **의도적으로 클라이언트에게 숨긴다**(§4.2). 앱이 채울 수 없으므로 core 에 버전을 내부 해결하는 래퍼(`POST /shipments/:id/simple-outbound-shortages`)가 필요하고, 그것은 4번째 core 변경이 된다 → 플랜 B 로 이관. 그 사이 현장은 해당 박스를 두고 다음 송장으로 넘어가며 관리자가 admin-web 에서 처리한다.

## 5. 앱 IA

### 5.1 허브

두 프로필 모두 `출고작업` 타일 하나. `profiles/handheld/HandheldHome.tsx` 의 피킹 타일과 `profiles/station/StationHome.tsx` 의 패킹 타일을 이 하나로 대체한다. 조회 타일(`/inventory`, `/shipments`)은 기존대로 양쪽 공통.

### 5.2 라우트 (`app/routeTree.tsx`)

```
/outbound                          출고작업 — [송장 스캔] 주 버튼 + 진행중 복구 카드 + 오늘 배치 요약
/outbound/simple/$shipmentId       단순출고 박스 작업                    ← 주 경로 (플랜 A)
/outbound/$batchId                 배치 작업 — work item 목록            ← 보조 경로 (플랜 B)
/outbound/$batchId/pick/$itemId    배치 피킹 스캔 (로케이션→상품)        ← 보조 경로 (플랜 B)
/outbound/$batchId/pack/$itemId    스테이션 패킹 — Phase 4 스텁 (자리만)
/picking, /packing                 → /outbound 리다이렉트 (기존 링크·딥링크 보존)
```

라우트는 기존 컨벤션대로 플랫하게 두고 프로필 가드는 걸지 않는다(마스터 §5: 프로필 = 디렉터리 + 허브 링크).

**단순출고는 양 프로필 공통 주 경로다.** 레거시 절차의 "포장대"가 곧 스테이션(Windows)이고, 상품 스캔·검수가 실제로 거기서 일어난다. 핸드헬드는 종이 송장을 들고 돌아다니며 같은 화면을 쓸 수 있다. 따라서 프로필 차이는 **입력 방식과 레이아웃뿐**이다 — 스테이션은 넓은 화면 + USB 스캐너/키보드 입력, 핸드헬드는 한 손 조작 + 하드웨어 스캔 이벤트. 화면 로직은 하나를 공유하고 `profiles/*` 에는 레이아웃 차이만 둔다.

### 5.3 대기열의 행은 "작업 단위" (플랜 B 에서 도입)

배치 목록이 링크가 되는 시점(플랜 B)에 행 타입을 처음부터 일반화한다:

```ts
type QueueRow =
  | { kind: 'pick';          batchId: string; workItemId: string; ... }  // 개별피킹
  | { kind: 'pack';          batchId: string; workItemId: string; ... }  // Phase 4
  | { kind: 'batch_collect'; batchId: string; ... }                      // 토탈피킹 1단계 — 후속
  | { kind: 'sort';          batchId: string; workItemId: string; ... }  // 토탈피킹 2단계 — 후속
```

행 생성을 **`deriveQueueRows(batch)` 한 함수에 격리**한다. 배치의 `pickingMethod` 와 `pickingPlan.strategy` 를 보고 kind 를 결정하는 지점이 여기 한 곳뿐이므로, 토탈피킹 도입은 이 함수의 분기 + 집품/분류 화면 추가로 끝나고 다른 화면은 손대지 않는다.

토탈피킹의 작업 단위가 다르다는 점이 이 일반화의 이유다 — 1단계 집품은 **배치 × SKU 단위**(카트), 2단계 분류는 **박스 단위**다. 박스 단위 행만 있으면 1단계를 표현할 수 없다.

### 5.4 배치는 관리자가 만든다

앱이 shipment 당 배치를 자동 생성하면 배치가 물량만큼 폭증하고, "하루 종일 열린 배치에 계속 편입"은 `PICKING_PLAN_ALREADY_ACTIVE`(`discrete-picking.strategy.ts:127-128`) 때문에 현재 plan 모델과 충돌한다(plan 은 `shipmentIds` 를 받아 한 번 생성되며 active 이후 멤버십 변경 불가).

아침에 admin-web 에서 "오늘 물량 배치 생성 + 운송장 일괄 발급"(이미 있는 `/order/waybill-issue` 큐)을 수행하면, 작업자는 종이 송장을 아무거나 집어오는 레거시 습관을 그대로 유지한다 — **배치는 작업자에게 보이지 않는 배경**이다.

## 6. 화면 동작

### 6.1 `/outbound` — 출고작업 진입

- **[송장 스캔]** 주 버튼(양 프로필 최상단). 하드웨어 스캔 이벤트 또는 수동 입력 → §4.1 조회 → 성공 시 `/outbound/simple/$shipmentId`
- **진행중 복구 카드**: 교차 배치 work item 조회 API 가 없으므로 기존 `core/data/devicePrefs` 에 마지막 작업 컨텍스트를 저장해 최상단에 복귀 카드로 띄운다
- **오늘 배치 요약**: `GET outbound-batches/v2?warehouseId=&status=` (`warehouse-context` 의 현재 창고). `status` 가 단일 값이므로 `created`/`picking` 2회 호출 또는 무필터+클라이언트 필터 — 플랜에서 실측해 정한다. 플랜 A 에서는 진행률 표시만(비링크), 플랜 B 에서 링크가 된다

### 6.2 `/outbound/simple/$shipmentId` — 단순출고 박스 작업

- 상단: 운송장번호·택배사, 수취인 마스킹, 라인별 진행(`SKU · 3/5`)
- 본문: 스캔 대기. 상품 스캔 → §4.2 호출 → 응답의 라인 진행으로 갱신. 수량 입력이 필요하면 기존 `NumberPad`
- 전량 완료 → "출고완료" 큰 확인 + **[다음 송장 스캔]** (Phase 2 연속 적치와 같은 연속 작업 패턴)
- 하단 예외 액션: **[강제출고]**(§4.3, 확인 다이얼로그 + 사유 기록). **[재고 부족 신고]는 플랜 B** — §4.3 의 계약 제약 참조

### 6.3 에러·예외

| 상황 | 처리 |
|---|---|
| 배치에 없는 송장 (409 `SHIPMENT_WORK_ITEM_MISSING`) | "이 송장은 오늘 배치에 없습니다 — 관리자에게 문의" |
| 운송장 미발급/무효 (409 `SHIPMENT_INVOICE_NOT_READY`) | "운송장이 준비되지 않았습니다" |
| 라인 초과 스캔 (409 `SHIPMENT_LINE_OVER_INSPECTED`) | "이 상품은 이미 필요한 수량을 다 채웠습니다" |
| 알 수 없는 바코드 | "이 송장에 없는 상품입니다" (박스 오배치 경고) |
| 낙관락 충돌 (409) | 앱이 조회를 리페치해 최신 진행으로 갱신 후 재시도 안내. 복합 엔드포인트가 claim/leaseVersion 을 내부 처리하므로 앱은 리페치만 |
| 스코프 부족 (403) | **앱은 스코프를 모른다** — 세션(`core/auth/session.ts`)이 JWT 클레임을 노출하지 않으므로 버튼을 숨길 수 없다. 노출한 뒤 403 을 "강제출고 권한이 없어요. 관리자에게 요청해 주세요."로 안내한다 (2026-07-26 정정) |
| 리스 만료 (`leaseExpiresAt` 경과, claim `expired`) | 플랜 B 배치 경로에서만 노출 — 재claim 안내 |

모든 서버 메시지는 기존 `core/data/errorMessage` 를 통해 현장 친화 한글로 매핑한다.

## 7. 데이터 계층

기존 규약(`docs/superpowers/specs/2026-07-22-warehouse-app-page-structure-design.md` §7)을 그대로 따른다: 화면 → `domains/outbound/use*.ts` → TanStack Query → `useApiClient()` → `httpClient`(Bearer 고정).

- 신규 `domains/outbound/`: `useShipmentByWaybill.ts`, `useSimpleOutboundScan.ts`, `useForceSimpleOutbound.ts`, `useShortPick.ts`, `useOutboundBatches.ts`, `types.ts`
- **타입 위험**: `OutboundBatchV2DetailDto` 의 `pickingPlan.members`/`allocations` 와 `inventorySession.balances` 가 `Array<Record<string, unknown>>` 로 선언돼 있어(`outbound-batch-v2.dto.ts:145-165`) OpenAPI 로 필드를 얻을 수 없다. 플랜 A 는 이 필드들을 쓰지 않으므로 영향이 없고, **플랜 B 착수 시 core DTO 를 먼저 타입화**한다(앱에서 손 선언해 추측하지 않는다).
- 모든 mutation 은 `Idempotency-Key` 를 붙인다. 키 생성·재시도는 한 곳(`useIdempotentMutation` 헬퍼)에 둔다.

## 8. 범위

### 플랜 A — 단순출고 (이번)

1. core: §4.1 운송장 조회
2. core: §4.2 단순출고 복합 스캔
3. core: §4.3 단순출고 강제출고
4. 앱: 허브 타일 통합 + `/outbound` + `/picking`·`/packing` 리다이렉트
5. 앱: `/outbound/simple/$shipmentId` 전 동작 + 예외 처리

플랜 A 만으로 **현장에서 출고를 완결**할 수 있다(운송장은 admin-web 에서 선발급). 배치 기반 작업자는 그동안 admin-web 을 쓴다.

### 플랜 B — 배치 기반 정식 경로 (후속)

`/outbound/$batchId`, `/outbound/$batchId/pick/$itemId`, `deriveQueueRows`, claim/leaseVersion/리스 만료 UI, 단축(short-pick) 정식 흐름, core DTO 타입화.

### 비목표

- **토탈피킹 라이브화** — core 선행 필요(배치 생성 게이트 정리, 창고 `supported_picking_strategies` 설정, 배치↔전략 정합성 검증). IA 수용만 준비(§5.3)
- **`pick_to_tote`** 전략 일체(토트 등록·배정·릴리스)
- **Phase 4** 스테이션 패킹 화면 + 운송장 발급·ZPL 라벨 인쇄 워크플로우 (`/outbound/$batchId/pack/$itemId` 는 스텁)
- 배치 생성·운송장 발급의 앱 내 수행 (admin-web 담당)
- 오프라인 큐잉 (마스터 설계 기존 비목표)

## 9. 검증

- **core 통합(실DB)**: 단순출고 정상 흐름 / 부분 스캔 후 재개 / 동일 idempotency-key 재요청이 이중 계상하지 않음 / 배치 미소속 409 / 운송장 미발급 409 / 초과 스캔 409 / 강제출고 정상·스코프 403 / 검수 완료 시 SHIP 원장 1회·예약 소진 확인. 기존 `outbound-v2-scenarios.integration.spec.ts` 패턴을 재사용한다
- **core 회귀**: fulfillment 통합 스펙 전량 그린 유지. `picking-strategy.contract.spec.ts` 의 `forbiddenEffects` 불변식이 깨지지 않는지 확인 — 단순출고는 전략 밖에서 dispatch 를 호출하므로 **전략 계약 위반이 아니다**(피킹 단계 자체는 여전히 원장을 쓰지 않는다)
- **앱 Vitest**: fake plugin-http 트랜스포트로 송장 조회 성공/실패, 스캔 진행 갱신, 완료 전이, 에러 메시지 매핑, 스코프 없는 계정에서 예외 버튼 미노출
- **린트**: 변경 파일 스코프로 oxlint 신규 error 0 (repo 상시 debt 는 스코프 밖)
- **기기 스모크**: Android 핸드헬드에서 하드웨어 스캐너 → 스캔 → 출고완료까지 1회 이상 수동 확인

## 10. 배포

- **마이그레이션 0건** (스키마 변경 없음)
- **순서: core 선배포 → 앱 배포.** 앱이 신규 엔드포인트 3개에 의존하므로 역순은 불가
- `FULFILLMENT_WORKFLOW_MODE=v2` 필요 (이미 라이브)

## 11. 실측·확인 필요 항목 (플랜 착수 시)

1. 현장 작업자 계정(OIDC `warehouse` 역할)에 `DISPATCH_FORCE`·`reopen` 스코프가 있는지 — 없으면 강제출고·부족신고가 403
2. `GET outbound-batches/v2` 의 `status` 파라미터가 단일 값인지, 다중 상태 조회 방법
3. `resolveInspectionLine` 의 바코드 해석 규칙이 피킹 스캔 입력(`shipmentLineId`+`skuId`+`sourceLocationId`)으로 그대로 이어지는지
4. dev 창고의 `supported_picking_strategies` 현재 값 (`discrete` 포함 여부 — 없으면 단순출고도 409)

## 12. 결정 로그

| 결정 | 선택 | 근거 |
|---|---|---|
| 피킹/패킹 IA | `출고작업` 단일 타일 + 단계 기반 | 백엔드가 이미 한 work item 의 두 단계로 모델링(picker/packer claim, custody 전이). 메뉴 2개는 대기열을 쪼개 "지금 뭘 집을까"에 답 못 함 |
| 이번 구현 범위 | 피킹 전 구간 + 단순출고 완결 | 패킹 화면·인쇄(Phase 4)는 분리 유지. 단순출고는 검수·dispatch 까지 포함해 그 자체로 출고 완결 |
| 레거시 절차 지원 | 단순출고를 **주 경로**로 | 현장이 실제로 그렇게 일한다. 정식 2단계는 보조(플랜 B) |
| 스캔 2회 문제 | 포장대 1회 스캔 = core 가 피킹+검수 replay | 원장 전이는 온전히 남기고 작업자 스캔은 1회 유지 |
| 몰아주기 위치 | **core 복합 엔드포인트** | 스캔 1회 = 요청 1회 = 1 트랜잭션. 부분 실패 상태를 원천 차단하고 앱이 core 상태기계를 재현하는 결합을 없앰 |
| 단순출고를 새 전략으로? | 아니오 | custody 흐름이 `discrete` 와 동일 → 새 전략의 정당성 없음. 유스케이스 서비스로 |
| 강제출고 | 전용 경로 신설(강제 피킹 → completePick → force-dispatch) | 기존 `force-dispatch` 는 `ready_to_pack` 을 요구해 미피킹 박스에 쓸 수 없음 |
| 배치 생성 주체 | 관리자(admin-web) | 앱 자동 생성은 배치 폭증. "열린 배치에 계속 편입"은 `PICKING_PLAN_ALREADY_ACTIVE` 와 충돌 |
| 토탈피킹 | IA 수용 + 구현 후속 | 전략은 구현·등록 완료. 막는 건 배치 생성 게이트·창고 설정 — core 선행 작업 |
| 플랜 분할 | A(단순출고) → B(배치 정식) | A 만으로 현장 출고 완결 가능 → 배포해 피드백 후 B |
