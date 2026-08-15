# 피킹 계획 층 추출 설계 스펙 — 피킹 전략 어댑터 3벌의 수명주기 통합

- 날짜: 2026-08-15
- 대상: `apps/core` (fulfillment/picking, fulfillment/services)
- 브랜치: `refactor/picking-plan-layer` (base `ba4f4d6e5` = develop)
- 상태: 설계 승인됨 (구현 전) — `/improve-codebase-architecture` → `/grilling` 산출물
- 관련: ADR-0030 (이 작업의 결정 기록), CONTEXT.md 「피킹 계획 (Picking Plan)」, ADR-0026 (반대 방향 사례 — 측정 결과 통합을 기각한 건)
- 마이그레이션: **0건**. 이벤트 계약 변경: **0건**. SST secret/env 변경: **0건**

## 1. 목표

출고작업 피킹의 **계획 층**(계획 수립·시작·잠금·유효성 판정)이 세 피킹 전략 어댑터에 손으로 복사되어 있다. 이걸 단일 함수 모듈로 올리고, 어댑터에는 방식별로 진짜 다른 것만 남긴다.

**이번 범위가 아닌 것:** `scan` / `handoff` / `completePick` / `unpickShipment` 와 tote·cart 전용 연산. 이들은 측정상 진짜로 다르다 (§2.2). 실제 토탈피킹 개통도 하지 않는다.

## 2. 현재 상태 실측

모든 수치는 `ba4f4d6e5` 에서 직접 실행한 명령의 출력이다.

### 2.1 중복은 core 전체에서 이 한 디렉터리에만 몰려 있다

클래스 멤버를 brace-matching 으로 잘라 문자열 리터럴 무시·공백 정규화 후 해시 비교. 20줄 이상만 계수.

- `apps/core/src` 비-spec 108,129 줄에서 클론 클러스터 **14개, 중복 1,221줄**
- 그중 **13개 클러스터 · 1,199줄이 `fulfillment/picking/`** 안. 나머지 1개는 22줄짜리 `getVariantPolicy` 뿐
- `fulfillment/services/*.service.ts` 11,663 메서드줄에서 바이트 동일 중복은 **24줄**뿐 — 나머지 core 는 깨끗하다

즉 이건 "core 가 중복투성이" 가 아니라 **한 곳에만 몰린 국소 문제**다.

### 2.2 diff 분포에 빈 구간이 있다 — 경계는 거기다

전략명(`discrete` / `pick_to_tote` / `aggregate_then_sort`) 정규화 후 메서드별 `diff` 라인 수:

| 메서드 | discrete↔pick_to_tote | discrete↔aggregate | 판정 |
|---|---|---|---|
| `lockAggregate` (122) | **0** | ~4 | 공유 |
| `lockSourceCapacities` (45) | **0** | ~2 | 공유 |
| `plan` (232) | **4** | 41 | 공유 |
| `start` (107) | **4** | ~3 | 공유 |
| `planStalenessReason` (105) | **2** | ~1 | 공유 |
| `assertActivePlanSession` (36) | **2** | ~3 | 공유 |
| `unpickShipment` (165) | 11 | **82** | 전략별 |
| `handoff` (97) | **39** | — | 전략별 |
| `completePick` (128) | **64** | **108** | 전략별 |
| `scan` | 완전 상이 | 완전 상이 | 전략별 |

**diff 0~4 구간과 diff 39~108 구간 사이가 비어 있다.** 이 스펙은 그 빈 구간에 경계를 긋는다.

`plan` 의 discrete↔aggregate 41줄 차이는 **의미 차이가 아니다** — `aggregate_then_sort` 만 `plannedResult()` 헬퍼를 뽑아 쓰고 나머지 둘은 같은 코드를 인라인으로 뒀으며, `.values({...})` 줄바꿈이 다르다. discrete↔pick_to_tote 의 diff 4줄은 **전부 문자열 리터럴**(`'picking.discrete.plan'` vs `'picking.pick_to_tote.plan'`)이다.

### 2.3 leverage 는 이미 마이너스다

`git log --name-only` 로 본 전략 파일 수정 이력 전수:

| 커밋 | 내용 | 수정한 전략 파일 |
|---|---|---|
| `577a21a64` | discrete 신설 | 1 / 1 |
| `d4bd18f5e` | aggregate 추가 | 2 / 2 |
| `7cf6d1b51` | pick_to_tote 추가 | 2 / 3 |
| `073e5fa96` | short pick 격리 | **3 / 3** |
| `11522f2fa` | (squash) | **3 / 3** |
| `cf0e88a2a` | 운송장 발급 경로 이관 | **3 / 3** |
| `7247dc9e7` | (squash) | **3 / 3** |

**세 전략이 공존한 이후 이 디렉터리를 건드린 커밋 4개가 전부 3파일을 함께 수정했다 (4/4, 예외 0).**

### 2.4 계획 층은 전략에 의존하지 않는다

옮길 메서드들 안에서 `this.capabilities` 는 **오직 `.name` 문자열로만** 쓰인다 (14 지점). `requiresPhysicalTote` / `supportsAggregateSourcePick` 로 분기하는 곳은 **0곳**. 즉 `strategyName: PickingStrategyName` 인자 하나면 전략과 완전히 무관해진다.

`strategy.plan` / `strategy.start` 의 호출자는 `PickingProcessService` **단 한 곳**(`picking-process.service.ts:93, 98`)이다. 나머지는 전부 port 를 거친다.

### 2.5 협력자 의존은 6개, 그중 8개 함수는 협력자가 아예 없다

옮길 14개 메서드가 `this` 에서 쓰는 협력자:

| 협력자 | 쓰는 메서드 |
|---|---|
| `commands`, `workflowGate` | `plan`, `start` |
| `sessions` | `start` |
| `invariant` | `lockAggregate` |
| `controlledStock` | `lockSourceCapacities`, `planStalenessReason` |
| `waybills` | `assertPlanningEligibility` |

`dbService` 는 **안 쓴다** (모두 `trx` 를 인자로 받음). `batches` · `audit` 도 안 쓴다.

세 전략의 생성자는 8개 의존성이 동일하고 `pick_to_tote` 만 `AuditService` 하나가 더 붙는다.

### 2.6 안전망은 이미 초록이고, 이 리팩터에 영향받지 않는다

```
npm run test:core:integration:local -- 'fulfillment/services/outbound-v2'
→ Test Suites: 6 passed, 6 total / Tests: 39 passed, 39 total / 17.8s
```

세 전략을 실 DB 로 모두 도는 `outbound-v2-warehouse-scenarios.integration.spec.ts` 포함. **통합 스펙 6개는 `spyOn` 호출이 0회**이고 public interface 로만 구동한다 — 즉 private 메서드가 사라져도 한 줄도 안 고쳐도 된다. **이게 이 리팩터의 행동 동일성 증거다.**

반면 단위 스펙은 private 메서드를 이름으로 **48회** mock 하고, 그중 **34회가 옮길 메서드**를 겨냥한다:

| spec | 옮길 메서드 mock | 남을 메서드 mock |
|---|---|---|
| `picking-strategy.contract.spec.ts` | 11 | 0 |
| `pick-to-tote.strategy.spec.ts` | 11 | 7 (tote 전용) |
| `aggregate-then-sort.strategy.spec.ts` | 12 | 7 (cart 전용) |
| `discrete-picking.strategy.spec.ts` | 0 | 0 |

기본 게이트(`npx jest`) 라인 커버리지 실측: discrete 49.4% / aggregate 51.6% / pick_to_tote 50.8% / registry 0%. 미커버 구간(`discrete:955–1327`, `tote:1303–1717`, `aggregate:1155–1625`)이 정확히 옮길 SQL 헬퍼 블록이다 — 계약 스펙이 이들을 mock 으로 걷어내기 때문.

### 2.7 곁다리로 확인된 것 둘

- **이중 창고 검사**: `PickingProcessService` 가 `registry.resolveForWarehouse()` 로 `supportedPickingStrategies.includes(name)` 를 검사한 뒤, 전략 안의 `assertWarehouseConfiguration()` 이 같은 행을 다시 읽어 같은 검사를 다른 에러코드로 한 번 더 한다. registry 검사는 `plan`(92) · `registerTote`(134) · 그 외 모든 연산(222 `withPlanStrategy`)에 걸리고, `assertWarehouseConfiguration` 은 `plan()` 에만 있다. 에러코드 `PICKING_STRATEGY_NOT_CONFIGURED` 는 **참조자 0곳** (admin-web · warehouse-app · 테스트 어디에도 없음).
- **`requestedStrategy` 실호출자 0**: `PlanPickingInput.requestedStrategy` 는 주석 스스로 "후속 정리에서 제거 대상" 이라 적고 있다. `admin-web` 의 `picking.client.ts` 는 이 필드를 보내지 않고, `warehouse-app` 은 `simple-outbound` 만 쓴다. 남은 건 DTO 필드 · `PickingProcessService.plan` 의 불일치 검증 · 그 검증을 테스트하는 통합 스펙 2건뿐.

## 3. 설계

### 3.1 새 모듈

```
apps/core/src/modules/fulfillment/picking/plan/
  picking-plan.ts          # 진입점 planPicking / startPicking
  picking-plan.queries.ts  # trx 만 받는 순수 함수 8개
  picking-plan.errors.ts   # conflict / errorMessage / isPlanValidationError
  picking-plan.types.ts    # PickingPlanDeps, LockedAggregate, SourceCapacity 등
```

**2층 구조** (§2.5 측정이 그은 선):

```ts
// 1층 — 협력자 없음. trx 와 값만 받는다. DI 없이 테스트 가능.
export async function loadWorkItem(trx: DbTx, workItemId: string): Promise<WorkItemRow | undefined>;
export async function assertPlanMembers(trx: DbTx, planId: string, shipmentIds: string[]): Promise<void>;
export async function assertActivePlanSession(trx: DbTx, planId: string, sessionId: string, batchId: string, strategyName: PickingStrategyName): Promise<void>;
export async function lockAndAssertPickerClaim(trx: DbTx, workItemId: string, workerId: string): Promise<WorkItemRow>;
export async function loadShipmentAllocations(trx: DbTx, planId: string, shipmentId: string): Promise<PickingSourceAllocationRow[]>;
export async function loadPositiveShipmentCustody(trx: DbTx, shipmentId: string, sessionId: string): Promise<ShipmentCustodyBalance[]>;
export async function invalidateDraftPlan(trx: DbTx, planId: string, reason: string): Promise<void>;
export function assertWorkItemIdentity(item: WorkItemRow, batchId: string, shipmentId: string): void;
// + assertRecipientComplete / assertProfileComplete / requiredIds / assertPositiveQuantity / databaseNow

// 2층 — 협력자를 개별 인자로 하나씩만 받는다.
export async function lockAggregate(trx: DbTx, invariant: FulfillmentInvariantService, batchId: string, requestedShipmentIds: string[]): Promise<LockedAggregate>;
export async function lockSourceCapacities(trx: DbTx, controlledStock: BatchControlledStockGuard, aggregate: LockedAggregate): Promise<SourceCapacity[]>;
export async function planStalenessReason(trx: DbTx, controlledStock: BatchControlledStockGuard, planId: string, aggregate: LockedAggregate, strategyName: PickingStrategyName): Promise<string | null>;
export async function assertPlanningEligibility(trx: DbTx, waybills: WaybillService, aggregate: LockedAggregate, shipmentIds: string[]): Promise<void>;

// 진입점 — deps 번들
export interface PickingPlanDeps {
  commands: FulfillmentCommandService;
  workflowGate: FulfillmentWorkflowGate;
  sessions: BatchInventorySessionService;
  invariant: FulfillmentInvariantService;
  controlledStock: BatchControlledStockGuard;
  waybills: WaybillService;
}
export async function planPicking(deps: PickingPlanDeps, strategyName: PickingStrategyName, input: PlanPickingInput, trx: DbTx): Promise<PickingPlanResult>;
export async function startPicking(deps: PickingPlanDeps, strategyName: PickingStrategyName, input: StartPickingInput, trx: DbTx): Promise<PickingStartResult>;
```

`commandNamespace` 는 `strategyName` 에서 파생한다: `` `picking.${strategyName}.plan` ``. §2.2 에서 확인한 diff 4줄이 이 한 줄로 사라진다.

### 3.2 seam 재배치

`PickingStrategy` interface 에서 `plan` / `start` 를 **제거**한다:

```ts
export interface PickingStrategy {
  readonly capabilities: PickingStrategyCapabilities;
  scan(input: ScanPickingInput, tx?: DbTx): Promise<ScanPickingResult>;
  handoff(input: HandoffPickingInput, tx?: DbTx): Promise<PickingHandoffResult>;
  completePick(input: CompletePickInput, tx?: DbTx): Promise<InspectionReadyOutput>;
  unpickShipment(input: UnpickShipmentInput, tx?: DbTx): Promise<UnpickShipmentResult>;
}
```

`PickingProcessService` 가 `PickingPlanDeps` 6개를 주입받아 `planPicking` / `startPicking` 을 직접 호출한다. `start` 는 더 이상 `withPlanStrategy` 로 전략 객체를 꺼내지 않는다 (전략 무관 코드를 부르려고 registry 를 조회하던 구조가 사라진다). 단 **창고 허용 검사는 유지**한다 — `plan` 은 배치의 `pickingMethod` 에서 전략을 파생한 뒤 `registry.resolveForWarehouse()` 로 검사하고, 그 반환 전략 객체는 버린다.

### 3.3 남는 것

| 파일 | 현재 | 이후(추산) |
|---|---|---|
| `plan/` (신규, 1벌) | — | **≈ 944** |
| `discrete-picking.strategy.ts` | 1,603 | ≈ 660 |
| `pick-to-tote.strategy.ts` | 2,269 | ≈ 1,340 |
| `aggregate-then-sort.strategy.ts` | 2,016 | ≈ 1,115 |
| **합계** | **5,888** | **≈ 4,060** |

옮기는 총량 2,832줄 → 944줄. `assertWarehouseConfiguration` 3벌(42줄)은 §3.5 로 삭제.

### 3.4 부수 효과 — 배송정보 규칙 3벌→1벌

`assertRecipientComplete`(9줄) · `assertProfileComplete`(22줄)는 세 전략에서 **바이트 동일**이며 `assertPlanningEligibility` 안에서만 호출된다. 공유층으로 자동으로 따라온다.

**범위 밖으로 남기는 것:** 같은 규칙의 나머지 2벌 — `outbound-batch-orchestrator.service.ts:1288,1298` 과 `shipment-planning.service.ts:1603` 및 `:1437`. 특히 `shipment-planning.service.ts:1437` 은 같은 에러코드 `SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE` 를 쓰면서 **발송인 이름·전화번호 검사를 빠뜨린 더 느슨한 벌**이다. 강도를 어느 쪽으로 통일할지는 `delivery_profiles` 프로덕션 실측이 선행돼야 하므로 **별도 이슈**로 뺀다.

### 3.5 이중 창고 검사 제거

`assertWarehouseConfiguration` 을 공유층에서 **삭제**하고 `registry.resolveForWarehouse()` 하나로 남긴다. 에러코드 `PICKING_STRATEGY_NOT_CONFIGURED` 는 참조자 0이므로 그대로 사라진다.

⚠️ **이건 순수 리팩터가 아니라 행동 변경이다.** 도달 순서상 registry 가 먼저 던지므로 실사용에서 이 코드가 나갈 일은 없어 보이나, **코드 읽기로만 판단했고 실행으로 확인하지 않았다.** PR 2 에서 다루고, 착수 전 통합 스펙에 "전략 미설정 창고에서 plan 거부" 케이스가 있는지 확인해 없으면 추가한다.

## 4. 옮길 대상 — 정확한 좌표

⚠️ **이 표는 `ba4f4d6e5` 에서만 유효하다.** base 가 움직이면 행 번호가 조용히 어긋난다. 착수 전에 반드시 검증한다:

```bash
git rev-parse --short HEAD    # ba4f4d6e5 가 아니면 아래 표를 재생성해야 한다

# 표의 앵커 3개가 맞는지 확인 (기대: async plan( / private async lockAggregate( / private async lockSourceCapacities( )
sed -n '99p;954p;1167p' apps/core/src/modules/fulfillment/picking/discrete-picking.strategy.ts
```

어긋났다면 brace-matching 으로 재생성한다 — 이 표는 클래스 멤버를 여는 줄부터 대응하는 닫는 중괄호까지를 잘라 만든 것이다.

실행 시 이 표대로 잘라내면 된다.

| 메서드 | discrete | aggregate | pick_to_tote |
|---|---|---|---|
| `plan` | 99-330 (232) | 120-322 (203) | 112-343 (232) |
| `start` | 332-438 (107) | 324-427 (104) | 345-451 (107) |
| `lockAggregate` | 954-1075 (122) | 1154-1271 (118) | 1302-1423 (122) |
| `lockSourceCapacities` | 1167-1211 (45) | 1363-1405 (43) | 1515-1559 (45) |
| `planStalenessReason` | 1213-1317 (105) | 1407-1510 (104) | 1561-1665 (105) |
| `assertActivePlanSession` | 1335-1370 (36) | 1527-1565 (39) | 1683-1718 (36) |
| `assertPlanningEligibility` | 1077-1165 (89) | 1273-1361 (89) | 1425-1513 (89) |
| `assertWarehouseConfiguration` † | 1319-1332 (14) | 1512-1525 (14) | 1667-1680 (14) |
| `lockAndAssertPickerClaim` | 1372-1397 (26) | 1567-1592 (26) | 1769-1794 (26) |
| `assertPlanMembers` | 1399-1419 (21) | 1594-1614 (21) | 1796-1816 (21) |
| `loadWorkItem` | 1421-1431 (11) | 1616-1626 (11) | 1818-1828 (11) |
| `loadShipmentAllocations` | 1478-1502 (25) | 1661-1687 (27) | 2144-2168 (25) |
| `loadPositiveShipmentCustody` | 1439-1467 (29) | 1717-1745 (29) | 1850-1878 (29) |
| `invalidateDraftPlan` | 1563-1590 (28) | 1917-1939 (23) | 2229-2256 (28) |
| `assertRecipientComplete` | 1504-1512 (9) | 1941-1949 (9) | 2170-2178 (9) |
| `assertProfileComplete` | 1514-1535 (22) | 1951-1972 (22) | 2180-2201 (22) |
| `requiredIds` | 1537-1542 (6) | 1974-1979 (6) | 2203-2208 (6) |
| `assertPositiveQuantity` | 1544-1548 (5) | 1989-1993 (5) | 2210-2214 (5) |
| `databaseNow` | 1550-1555 (6) | 1995-2000 (6) | 2216-2221 (6) |
| `isPlanValidationError` | 1557-1561 (5) | 2002-2006 (5) | 2223-2227 (5) |
| `errorMessage` | 1592-1598 (7) | 2008-2011 (4) | 2258-2264 (7) |
| `conflict` | 1600-1602 (3) | 2013-2015 (3) | 2266-2268 (3) |
| `assertWorkItemIdentity` | 1433-1437 (5) | 1628-1632 (5) | 1844-1848 (5) |
| **합계** | **958** | **916** | **958** |

† `assertWarehouseConfiguration` 은 **PR 1 에서는 다른 것들과 똑같이 옮기고, PR 2 에서 삭제한다** (§3.5). PR 1 을 순수 리팩터로 유지하기 위해서다 — 삭제는 행동 변경이라 PR 1 에 섞으면 "통합 스펙 무변경 통과" 라는 이 리팩터의 유일한 행동 동일성 증거가 오염된다.
>
> *(2026-08-15 정정: 이 각주는 원래 "옮기지 않고 삭제" 라고 적혀 있어 §3.5 와 모순됐다. PR 1 구현자가 보수적으로 해석해 옮긴 뒤 PR 2 로 미뤘고 그게 옳다. 현재 위치는 `plan/picking-plan.locks.ts:407`.)*

**정본은 `discrete` 를 쓴다.** `aggregate` 의 `plannedResult()` 추출(§2.2)은 정본에 흡수하고, `aggregate` 만 다른 `errorMessage`(4줄 vs 7줄) · `assertActivePlanSession`(39 vs 36) · `loadShipmentAllocations`(27 vs 25) · `invalidateDraftPlan`(23 vs 28)은 **옮기기 전에 3벌 diff 를 눈으로 확인하고 정본을 명시적으로 고른다.** 이 4개는 diff 가 0이 아니므로 기계적 복사 대상이 아니다.

## 5. 테스트 재구성

- **삭제**: 옮길 메서드를 겨냥한 mock **34개** (`jest.spyOn(strategy as any, 'lockAggregate')` 등). 대상 메서드가 전략에서 사라지므로 대상 자체가 없어진다.
- **신규**: 1층 순수 함수 8개 + 순수 검증 5개에 대해 `trx` fake 하나로 도는 단위 스펙. DI 없음.
- **이사**: `picking-strategy.contract.spec.ts` 의 `plan` / `start` 관련 테스트를 `plan/picking-plan.spec.ts` 로. 계약 스펙에는 `scan` / `handoff` / `completePick` / `unpickShipment` 계약만 남는다.
- **손대지 않음**: 통합 스펙 6개 (§2.6). `spyOn` 0회이므로 무변경 통과가 기대치이며, **한 줄이라도 고쳐야 한다면 그건 행동이 바뀐 신호다.**

**커버리지 기대치를 정직하게 적는다.** 기본 게이트는 지금 ~50% 에서 크게 오르지 않는다 — `plan` / `start` 본문(339줄)은 여전히 DB 게이트 뒤에서만 검증된다. 이 리팩터가 커버리지에 주는 실제 효과는 **덮이지 않는 코드가 3벌에서 1벌로 주는 것**이다.

## 6. PR / 커밋 분할

### PR 1 — 순수 리팩터

| # | 커밋 |
|---|---|
| 1 | ADR-0030 + CONTEXT.md 「피킹 계획」 |
| 2 | `plan/` 모듈 신설 (discrete 를 정본으로, 3벌 diff 확인 후) |
| 3 | 세 전략에서 옮긴 메서드 제거 + `PickingStrategy` interface 에서 `plan`/`start` 제거 |
| 4 | `PickingProcessService` 재배선 (`PickingPlanDeps` 주입, `withPlanStrategy` 정리) |
| 5 | 테스트 재구성 (§5) |

커밋 2~5 사이에는 **초록 지점이 없다** — 함수를 옮기는 순간 interface 도 34개 mock 도 같이 깨진다. 중간 초록을 만들려면 코드를 두 번 옮겨야 하고 그게 더 위험하다. **초록 판정은 PR 단위로 한다.**

### PR 2 — 행동 변경 (커밋 3개, 각각 독립 revert 가능)

**base 는 `develop` 이며, PR 1 이 머지된 뒤에 딴다.** PR 2 의 두 대상은 모두 PR 1 이 만든 `plan/` 파일 안에 있어 PR 1 없이는 시작할 수 없다. 저장소가 squash-merge 관행이므로 stacked 브랜치로 만들면 머지 후 rebase 충돌 여지가 크다 — PR 2 가 작으니(삭제 2건) 기다리는 편이 싸다.

| # | 커밋 | 성격 |
|---|---|---|
| 0 | **선행: "전략 미설정 창고에서 plan 거부" 통합 케이스 추가** | 테스트 추가 — 커밋 2 의 안전망 |
| 1 | `requestedStrategy` 제거 (interface 필드 · `picking-process.service.ts` 불일치 검증 · `picking-v2.controller.ts` · 관련 스펙) | **API 계약 변경** — 실호출자 0으로 측정됐으나 미지의 외부 호출자 가능성 |
| 2 | `assertWarehouseConfiguration` 삭제 (§3.5) | **행동 변경** — 실행 미확인 |

**커밋 0 은 선택이 아니라 필수다.** 2026-08-15 실측 결과 이 케이스는 **존재하지 않는다** — 기존 통합 스펙은 전부 `supportedPickingStrategies` 를 *설정해서 켜는* 쪽이고, `outbound-batch-orchestrator.integration.spec.ts:337,352` 는 배치 생성 단계이지 plan 단계가 아니다. 즉 지금 `assertWarehouseConfiguration` 을 지우면 **무엇이 깨지는지 알려줄 테스트가 없다.**

3개 PR 로 나누어 배포를 끼우지 않는다. CLAUDE.md 의 expand-contract 규율은 destructive schema 변경에 대한 것이고, 이번은 마이그레이션 0건 · 이벤트 계약 변경 0건이다.

## 7. 검증 게이트

| PR | 게이트 |
|---|---|
| 1 | `npm run type-check` → 0 · `npx jest` → 실패 0 · `npm run test:core:integration:local -- 'fulfillment/services/outbound-v2'` → **6 suite / 39 test** |
| 2 | 위 + §3.5 용 "전략 미설정 창고에서 plan 거부" 통합 케이스 확인/추가 |

## 8. 착수 순서 주의

**이 리팩터는 토탈피킹 개통보다 먼저 끝나야 한다.** §2.3 이 보여주듯 지금 전략 파일을 건드리는 모든 변경은 3파일을 함께 고친다 — 개통 전 실험을 지금 하면 그 실험을 3번 반복하게 된다. 통합 후에는 실험이 `scan`/custody 층(전략별로 남는 부분) 1파일 수정이 된다.

## 9. 재검토 트리거

**공유층에는 3전략 diff ≤ 4 로 측정된 것만 들어간다.** 새 로직을 `plan/` 에 넣기 전 그 측정을 다시 한다. 이 규칙이 없으면 함수 모듈이 자석처럼 custody 로직까지 끌어당긴다 — ADR-0026 이 경계한 "본문이 전부 hook 인 과추상화" 의 함수판이다. 자세한 근거는 ADR-0030.
