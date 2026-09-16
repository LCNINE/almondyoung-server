# 출고 준비 복구와 통합 인수 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미시작 draft가 재고 변경으로 오래되면 안전하게 한 번 재계획하고, 준비 차단·응답 유실·동시 실행에서도 같은 명령의 결론과 재고 원자성을 보존한다.

**Architecture:** picking 계층에서 무효화 사유를 타입으로 구분하고 simple 준비 조정에서 교체 자격을 검사한다. 예상된 준비 차단을 결과 snapshot으로 저장하고 controller에서 커밋 후 HTTP 거절로 변환한다. 기존 성공 응답과 force resolver 계약을 유지하며 native가 확정 거절 후 새 준비 의도를 명시적으로 생성한다.

**Tech Stack:** NestJS, Drizzle/PostgreSQL, Jest, React, TanStack Query, Vitest, IndexedDB.

**Spec:** [물류 앱 시연 흐름 설계 §6–8, C1–C7/E1–E2](../specs/2026-09-16-warehouse-demo-readiness-design.md)

## 실행 상태 (2026-09-16)

A/B/C-1–C-3 구현과 개별 리뷰를 완료했다. C-4 로컬 HTTP/DB·전체 gate 결과는 [통합 인수 기록](../../../native/warehouse-app/docs/warehouse-demo-readiness-acceptance.md)에 있다. 체크 표시는 각 task의 실행/RED·GREEN 기록에 근거한다. C-4 독립 리뷰·전체 branch 리뷰, 배포·실제 Windows/PDA 인수는 아직 완료 표시하지 않는다.

## Global Constraints

- Node 22와 저장소의 `corepack yarn` 명령을 사용한다. 신규 외부 의존성·DB 테이블·DB enum·영구 재고 사본을 추가하지 않는다.
- v2 작업 키·원래 요청 본문·사용자/API 범위·확정 결과 재생 계약을 유지한다. 미확인 작업을 새 키로 바꾸지 않는다.
- 입고 대기·배치 관리 재고·예약 보호, 서버 권한과 창고 범위 검증을 유지한다.
- 원장·피킹·검수·출고 변경은 호출자가 소유한 같은 트랜잭션에서 원자적으로 처리한다. GET은 조회만 한다.
- 작업자에게는 한국어 행동 안내를 제공하고, 내부 코드·잠금·DB 상태는 진단 정보로 분리한다.
- 검증은 명시적으로 지정한 전용 로컬 DB에서 수행한다. 운영 데이터 보정·운영 배포·실제 기기 인수는 자동 검사와 구분한다.

## 시작 조건과 실행 단위

기준 develop `25ef604a6`. 실행 전 현재 변경과 AGENTS.md를 확인하고 별도 구현 작업공간을 확보한다. A/B와 독립 개발할 수 있으나 E1 통합 인수는 두 계획을 합친 버전에서 실행한다. **C-1 → C-2 → C-3 → C-4** 순서다. C의 중간 커밋은 개별 배포하지 않는다.

전용 로컬 DB `warehouse_demo_readiness_test`가 없으면 생성하고 기존 DB는 삭제하지 않는다. `.env`를 사용하지 않는다.

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/warehouse_demo_readiness_test
corepack yarn drizzle-kit migrate --config apps/core/drizzle.config.ts
```

## 파일과 책임 지도

| 책임                        | 파일                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 무효화 분류                 | 신규 `apps/core/src/modules/fulfillment/picking/plan/plan-invalidation.ts`; 기존 `picking-plan.locks.ts`, `picking-plan.queries.ts`, `picking-plan.ts`, `../picking-strategy.interface.ts` |
| 준비 결과/교체 정책         | 신규 `apps/core/src/modules/fulfillment/services/outbound-preparation-result.ts`, `outbound-preparation-policy.ts` 및 `.spec.ts`                                                           |
| 공통 준비/명령 실행         | 기존 `services/simple-outbound.service.ts`, `services/location-outbound.service.ts`                                                                                                        |
| HTTP 결과 변환              | 신규 `controllers/outbound-preparation-http.ts`; 기존 location/simple controllers 및 tests                                                                                                 |
| 실제 DB 재계획 회귀         | 신규 `services/outbound-preparation.integration.spec.ts`, `outbound-preparation.concurrency.integration.spec.ts`; 기존 `__support__/simple-outbound-wiring.ts`                             |
| 클라이언트 거절 상세/재준비 | 기존 native `core/data/httpClient.ts`, `core/data/errorMessage.ts`, `domains/outbound/LocationOutboundScreen.tsx`, `domains/outbound/locationOutbound.ts`와 tests                          |
| 복구 호환                   | 기존 native `core/operations/operationRunner.test.ts`, `operationResult.test.ts`; 기존 server `services/location-outbound.service.integration.spec.ts`                                     |
| HTTP 인수                   | 신규 `apps/core/src/modules/inventory/core/controllers/warehouse-demo-workflow-http.integration.spec.ts`; 기존 `inbound-workflow-http.integration.spec.ts`의 구성 패턴 참고                |
| 실행 gate/결과 문서         | 루트 `package.json`; 신규 `native/warehouse-app/docs/warehouse-demo-readiness-acceptance.md`                                                                                               |

상대 파일은 각 행의 전체 디렉터리를 기준으로 한다. 신규 policy/result/HTTP mapper는 DI service가 아니며 전역 명령 처리 계층을 만들지 않는다.

## Task C-1: 계획 무효화 사유를 타입으로 분류

**Files:** 위 plan 파일 및 `picking-plan.spec.ts`, `picking-strategy.contract.spec.ts`, `aggregate-then-sort.strategy.spec.ts`, `pick-to-tote.strategy.spec.ts`.

**Interfaces:** `plan-invalidation.ts`에서 아래 타입을 export한다. 기존 `planStalenessReason` 이름을 유지하고 반환 타입만 변경한다.

```ts
export type PlanInvalidationCode =
  | 'SOURCE_STOCK_CHANGED'
  | 'PLAN_IDENTITY_CHANGED'
  | 'PLAN_NOT_DRAFT'
  | 'SHIPMENT_SNAPSHOT_CHANGED'
  | 'ALLOCATION_INVALID'
  | 'ELIGIBILITY_CHANGED';
export type PlanInvalidation = { code: PlanInvalidationCode; message: string };
// planStalenessReason(...기존 인자): Promise<PlanInvalidation | null>
// PickingPlanResult/PickingStartResult의 invalidated 분기: reasonCode?: PlanInvalidationCode 추가
```

- [x] **1. RED를 추가한다.** `picking-plan.spec.ts`의 실제 staleness helper 검사에 원인별 기대값을 추가한다. 기존 조립 fixture를 사용해 각각 한 사실만 바꾼다.

```ts
expect(result).toEqual({
  code: 'SOURCE_STOCK_CHANGED',
  message: `Source ${skuId}/${sourceLocationId} changed after planning`,
});
```

`skuId/sourceLocationId`는 해당 검사에서 만들거나 기존 `IDS` fixture에서 꺼낸 실제 값이다. 표: source version/가용량 변화→SOURCE_STOCK_CHANGED; plan/strategy 불일치→PLAN_IDENTITY_CHANGED; status≠draft→PLAN_NOT_DRAFT; 멤버/manifest/reservation 변화→SHIPMENT_SNAPSHOT_CHANGED; source snapshot 모순/라인 배정 합계 오류→ALLOCATION_INVALID; 기존 계획 eligibility 예외→ELIGIBILITY_CHANGED. 정상 null은 유지한다.

- [x] **2. 실패를 확인한다.** `corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/fulfillment/picking/plan/picking-plan.spec.ts`.
- [x] **3. 반환값과 무효화 결과를 연결한다.**

```ts
return {
  code: 'SOURCE_STOCK_CHANGED',
  message: `Source ${source.skuId}/${source.sourceLocationId} changed after planning`,
};
// 무효화 DB 기록은 기존 문자열 컬럼 사용:
// invalidationReason = invalidation.message
// 응답 snapshot: reason = invalidation.message, reasonCode = invalidation.code
```

`invalidateDraftPlan`의 사유 인자를 PlanInvalidation으로 바꾸고 모든 호출부/관련 tests를 갱신한다. `isPlanValidationError`로 이미 분류하는 예외는 ELIGIBILITY_CHANGED로 매핑하되 auth/DB/예상 밖 예외를 새로 삼키지 않는다. 이전 응답 snapshot의 reasonCode 누락을 지원한다.

- [x] **4. 전략 공통 회귀를 통과시킨다.**

```bash
corepack yarn test --runInBand --testPathPattern='(picking-plan.spec|picking-strategy.contract.spec|aggregate-then-sort.strategy.spec|pick-to-tote.strategy.spec)'
corepack yarn tsc --noEmit -p apps/core/tsconfig.app.json
```

`refactor(fulfillment): classify picking plan invalidation outcomes`로 커밋한다. 이 단계는 자동 재계획 기능을 켜지 않는다.

## Task C-2: 제한적 재계획과 커밋 가능한 준비 차단 결과

**Files:** result/policy, simple/location service, HTTP mapper/controllers, 신규 DB suites, support wiring 및 영향받는 service/controller tests.

**Interfaces:** result 파일에서 spec §6.2의 `PreparationBlockReason`, `OutboundPreparationBlocked`, `OutboundPreparationResult`, `PreparedOutboundResult<T>`를 export한다. `SimpleOutboundService.prepare`는 `Promise<OutboundPreparationResult>`를 반환한다. public start/scan/force/forceComplete는 기존 상태와 marker의 union을 반환하고 모든 호출자를 타입 검사로 갱신한다. controller의 외부 성공 DTO는 유지한다.

```ts
export function canReplaceDraft(input: {
  reasonCode?: PlanInvalidationCode;
  supportedIndividual: boolean;
  shipmentSnapshotUnchanged: boolean;
  hasSession: boolean;
  hasCustody: boolean;
  hasPickHistory: boolean;
  hasInspection: boolean;
  hasOtherActiveClaim: boolean;
}): boolean;
export function isPreparationBlocked(value: unknown): value is OutboundPreparationBlocked;
// controller 전용; 트랜잭션 callback에서 호출 금지
export function unwrapPreparedOutbound<T>(value: PreparedOutboundResult<T>): T;
```

- [x] **1. 실제 재현을 정상 성공 기대값으로 바꾼다.** support wiring의 `assembleOutbound`를 export하고 `{ simple, location, picking }`을 반환하도록 보강한다. private service 필드를 강제 cast해서 테스트하지 않는다. rollback fixture에서 다음 검사를 추가한다.

```ts
const f = await seedPickableShipment(tx, 3);
const { picking, location } = assembleOutbound(tx);
const original = await picking.plan(
  {
    batchId: f.batchId,
    shipmentIds: [f.shipmentId],
    actorId: f.actorId,
    idempotencyKey: randomUUID(),
  },
  tx,
);
expect(original.state).toBe('planned');
const inventory = wireLogistics(ambientDbService(tx));
await receiveStock(inventory.command, tx, {
  skuId: f.skuId,
  warehouseId: f.warehouseId,
  locationId: f.locationId,
  quantity: 1,
});
const result = await location.start(
  f.shipmentId,
  { warehouseId: f.warehouseId },
  { id: f.actorId, roles: ['logistics_worker'] },
  randomUUID(),
  tx,
);
expect(result).toMatchObject({ shipmentId: f.shipmentId, status: 'in_progress' });
const plans = await tx.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId));
expect(plans.map((p) => p.status).sort()).toEqual(['active', 'invalidated']);
const sessions = await tx
  .select()
  .from(wmsTables.batchInventorySessions)
  .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
expect(sessions).toHaveLength(1);
```

루트의 기존 Jest aliases와 `__support__`의 makeDb/inRollbackTx를 사용한다. 신규 DB suite는 REQUIRE_WAREHOUSE_DEMO_DB=1이고 DATABASE_URL이 없으면 시작 전에 throw한다.

- [x] **2. RED를 실행한다.** `corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/outbound-preparation.integration.spec.ts`. 기존 구현에서는 SIMPLE_OUTBOUND_PLAN_INVALIDATED로 실패한다.
- [x] **3. policy/result와 준비 제어를 구현한다.** canReplaceDraft는 reasonCode=SOURCE_STOCK_CHANGED, 동일 snapshot, 대상 방식, 미실행 조건을 모두 만족할 때만 true다. DB 사실은 기존 aggregate/session/custody/picking 기록에서 잠금 안에 읽는다. 현재 잔량이 0이라는 이유만으로 실행 이력이 없다고 판단하지 않는다.

```text
prepare:
  work item / supported method / authorization / warehouse의 기존 검증
  정상 active 재개 → ready(context)
  draft plan/start → started이면 claim 후 ready(context)
  invalidated이면 canReplaceDraft로 판정
    false → blocked(review_batch)
    true → 이미 기록한 invalidated 다음에 replacement savepoint
      새 단계 key로 plan → start → claim
      成功 → ready(context)
      허용한 준비 실패 → replacement만 rollback; blocked 반환
      나머지 오류 → throw하여 외부 transaction도 rollback
```

replacement는 한 번만 시도한다. 기존 invariant→batch/plan→stock 잠금 순서를 유지한다. 선행 잠금보다 batch를 먼저 잠그는 최적화를 추가하지 않는다. 재계획 후 부족은 SOURCE_INSUFFICIENT, 두 번째 stale은 REPLAN_LIMIT_REACHED다. 신규 plan으로 시작한 경우의 부족도 같은 blocked 결과로 처리한다.

최초 plan 생성 앞에도 savepoint를 둔다. 부족을 typed result로 바꾸기 전에 해당 savepoint를 롤백해 내부 명령의 pending 기록과 부분 생성물이 남지 않게 한다. 이전 draft의 정상 무효화 결과를 받은 경우에는 그 결과를 보존하고 **그다음** replacement savepoint를 연다.

- [x] **4. 모든 준비 호출과 HTTP 경계를 갱신한다.** simple scan/force, location start/scan/force에서 blocked이면 stock/picking으로 진행하지 않고 명령 snapshot에 marker를 반환한다. 성공 snapshot은 기존 형식을 유지한다. FulfillmentCommandService의 generic execute에 모든 예외를 잡아 저장하는 기능을 추가하지 않는다.

```ts
const prepared = await this.prepare(shipmentId, actor, key, trx);
if (prepared.outcome === 'preparation_blocked') {
  return { response: prepared, resourceType: 'shipment', resourceId: shipmentId };
}
const context = prepared.context;
// 여기부터 기존 스캔/검수/출고 처리를 같은 trx에서 실행한다.
```

controller에서는 `unwrapPreparedOutbound(await service.method(...))`를 사용한다. mapper는 marker를 기존 code의 409+details로 변환한다. service에 ambient tx를 전달한 호출자는 marker를 상위까지 반환하며 중간에 unwrap하지 않는다. `rg -n '\.prepare\(|\.forceComplete\(' apps/core/src/modules/fulfillment`와 타입 검사로 모든 호출을 확인한다.

- [x] **5. 멱등/force 복구를 연결한다.** 최상위/최초 단계 키는 보존하고 replacement 두 단계만 spec의 oldPlanId 포함 키를 사용한다. force resolver는 저장된 preparation_blocked를 기존 FORCE_NOT_APPLIED 응답으로 매핑한다. 원본 snapshot은 덮어쓰지 않는다. 이미 저장된 성공/거절 snapshot의 재생도 검사한다.
- [x] **6. 부정·원자성·경합 검사를 추가한다.** 아래 각 행을 실제 DB 검사로 만든다.

| 입력/주입                                       | 확인할 상태                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| source 전체 이동, 새 위치에 충분한 수량         | 새 배정으로 시작, 옛 계획 무효화                                 |
| source 부족, 새 계획 중 실패                    | 옛 무효화+blocked만 저장, session/claim/custody 없음             |
| 멤버/manifest/reservation/송장 변경             | 자동 교체 없음, 업무 검토 안내                                   |
| draft와 실행 세션/피킹 이력 동시 존재           | 자동 초기화 없음                                                 |
| 기존 active 정상 세션                           | 같은 plan/session 재개, 재배정 없음                              |
| scan 잘못된 바코드/초과 수량, force 입력 불일치 | 준비 포함 전체 명령 롤백, 재고·피킹·송장 불변                    |
| 같은 키 두 번 / 다른 본문 / 다른 사용자         | 같은 snapshot / mismatch 거절 / 범위 침범 없음                   |
| 같은 키 및 다른 키로 동시 start                 | plan/session 중복 없음, 두 번째는 기존 작업 재개 또는 claim 충돌 |
| stock 변화↔start 양방향 별도 연결               | 현재 가용량으로 시작하거나 명시적 차단, 과다 확보 없음           |

두 연결 검사는 실제 commit/rollback 및 barrier를 사용한다. 모든 테스트를 단일 ambient rollback transaction에 넣어 동시성을 검증했다고 보고하지 않는다. unique fixture를 사용하고 생성한 데이터만 정리한다.

- [x] **7. GREEN/타입 검사를 확인하고 커밋한다.**

```bash
corepack yarn test --runInBand --testPathPattern='(outbound-preparation|location-outbound|simple-outbound|outbound-v2-recovery-scenarios|inbound-origin-planning)'
corepack yarn tsc --noEmit -p apps/core/tsconfig.app.json
```

`fix(fulfillment): recover stale outbound drafts with durable outcomes`로 커밋한다. C-1/C-2/controller 변경을 나누어 운영 배포하지 않는다.

## Task C-3: 앱 재준비와 기존 복구 호환

**Files:** native httpClient/errorMessage/locationOutbound/LocationOutboundScreen 및 각 tests, operationRunner/operationResult tests. 제품 runner의 동작 변경은 기존 resolver mapping만으로 해결되지 않는 경우로 제한한다.

**Interfaces:** ApiError에 optional `preparation?: { reasonCode: PreparationBlockReason; recovery: 'retry_preparation' | 'review_batch' }`를 추가한다. 별도 native 타입은 server의 허용 문자열 집합과 일치해야 하며 HTTP details parser는 알려진 값만 허용한다. 기존 생성자 호출은 동작을 유지한다.

- [x] **1. 차단/응답 유실 회귀를 추가한다.** 실제 work runtime fixture와 operation store를 사용한다. HTTP 409의 known code는 rejected, 5xx/응답 유실/손상된 details만 있는 unknown code는 uncertain이다.

```ts
expect(new ApiError('blocked', 409, 'SIMPLE_OUTBOUND_PLAN_INVALIDATED').outcome).toBe('rejected');
expect(new ApiError('unknown', 409, 'NEW_UNKNOWN_CODE').outcome).toBe('uncertain');
```

runtime 검사에서 첫 start 키를 기록하고 확정 거절 후 사용자의 ‘다시 준비’ 클릭은 **다른 키**, uncertain 중 재확인은 **동일 키·동일 bodyJson**임을 비교한다. 클릭 전에는 새 POST가 없어야 한다.

- [x] **2. RED 실행.**

```bash
corepack yarn --cwd native/warehouse-app test src/core/data/httpClient.test.ts src/core/data/errorMessage.test.ts src/domains/outbound/LocationOutboundScreen.runtime.test.tsx --maxWorkers=2
```

- [x] **3. 명시적 재준비를 구현한다.** start의 rejected를 store에서 확인한 뒤에만 새 startKey를 draft에 먼저 저장하고 호출한다. draft 저장 실패 시 POST하지 않는다. uncertain이면 기존 처리 내역 확인만 제공한다. retry_preparation과 review_batch를 구분해 아래 안내를 사용한다.

```text
SOURCE_INSUFFICIENT: 출고할 재고가 부족해요. 재고를 확인한 뒤 다시 준비해 주세요.
SOURCE_STOCK_CHANGED / REPLAN_LIMIT_REACHED: 재고가 변경됐어요. 현재 재고를 확인한 뒤 다시 준비해 주세요.
review_batch: 출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.
```

review_batch에서 자동 새 키/자동 재시도 루프를 만들지 않는다. 구형 서버의 details 없는 거절은 기존 안내로 처리한다. 거절된 상품 스캔을 성공으로 소비하거나 다른 source로 자동 재전송하지 않는다. 새 준비 성공 후 현재 state GET을 확인하고 source/수량을 다시 표시한다. 강제출고 확인은 이전 tuple을 재사용하지 않고 현재 tuple을 재확인한다.

- [x] **4. 복구 조합을 검사한다.** 정상/blocked 응답 유실 후 재실행, 같은 키에 부족 해소 후에도 과거 blocked 재생, 새 키의 정상 준비, force blocked+응답 유실+권한 철회→resolver rejected, 과거 성공 snapshot 재생, 계정/API 범위 불일치, GET 실패 시 오래된 화면으로 스캔 차단을 검증한다.
- [x] **5. focused 회귀와 build 후 커밋한다.**

```bash
corepack yarn --cwd native/warehouse-app test src/core/data/httpClient.test.ts src/core/data/errorMessage.test.ts src/core/operations/operationRunner.test.ts src/core/operations/operationResult.test.ts src/domains/outbound --maxWorkers=2
corepack yarn --cwd native/warehouse-app build
```

`fix(warehouse): retry preparation only after a confirmed rejection`.

## Task C-4: 실제 HTTP/DB 인수와 실행 gate

**Files:** 신규 warehouse-demo-workflow-http integration suite, 루트 package.json, 신규 acceptance 문서. A/B/C 모든 구현을 합친 버전에서 실행한다.

**Interfaces:** 기존 native createApiClient/operationRunner/operationStore와 실제 Nest ScopeGuard/DTO/GlobalExceptionFilter/서비스/DB를 연결한다. 인증 identity/역할 fixture와 Tauri→Node fetch transport만 대체한다. 실제 OIDC·Tauri 프로세스·HID를 검증했다고 주장하지 않는다.

- [x] **1. HTTP 인수 fixture를 만든다.** 기존 inbound-workflow-http suite의 실제 listen/close·unique warehouse/SKU fixture·정리 패턴을 재사용하고 LocationOutboundController와 필요한 real service wiring을 추가한다. DB URL이 없으면 REQUIRE_WAREHOUSE_DEMO_DB=1에서 즉시 실패한다. 실행 gate는 다음 명령을 package.json에 등록한다.

```json
{
  "test:warehouse-demo:integration": "REQUIRE_WAREHOUSE_DEMO_DB=1 jest --runInBand --testPathPattern='(warehouse-demo-workflow-http|outbound-preparation.*integration|movement-location-policy.*integration)'"
}
```

- [x] **2. 실재고 대사 시나리오를 작성한다.** 입고10 → A에6 적치 → A→B 2 이동 → 잔여4를 B에 적치 → 개별 송장의 상품3개 출고. 최종 입고대기0/A4/B3/출고3/전체 ON_HAND7을 확인한다. 두 무작위 위치 UUID를 정렬해 작은 UUID를 B에 배정하고, 현재 planner의 sourceLocationId 순서에 따라 B에서3을 선택하는 것을 먼저 assert한다. 이 fixture는 입고10 외에 추가 RECEIVE를 만들지 않으며 `seedPickableShipment`가 자동 생성하는 기초 재고를 중복 사용하지 않는다. 같은 시나리오의 draft 생성 시점을 이동 전으로 바꾼 변형에서는 변경된 source 배정과 총수량7을 확인한다.

실제 HTTP 수준에서 별도로 검사한다: 로그인 readiness는 A runtime suite; 비활성 도착 이동409와 원장 불변; stale draft 부족409 뒤 새 연결 SELECT에서 invalidated/blocked 커밋 확인; 같은 키 재생; 새로운 store/runner로 응답 유실 복구; force resolver·권한. 서비스 내부 rollback fixture만으로 커밋 보존을 증명하지 않는다.

- [x] **3. DB gate를 실행한다.**

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/warehouse_demo_readiness_test corepack yarn test:warehouse-demo:integration
env -u DATABASE_URL corepack yarn test:warehouse-demo:integration
```

첫 명령은 fail/skip 0, 두 번째 명령은 DB 누락으로 exit 1이어야 한다. 후자는 의도된 gate 실패로 기록한다.

- [x] **4. 영향 범위와 빌드를 확인한다.**

```bash
corepack yarn --cwd native/warehouse-app test --maxWorkers=2
corepack yarn --cwd native/warehouse-app build
corepack yarn --cwd native/warehouse-app lint
corepack yarn type-check
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/warehouse_demo_readiness_test corepack yarn test --runInBand --testPathPattern='(inbound-origin|inbound-receipt.kernel|inbound-workflow-http|location-outbound|simple-outbound|outbound-preparation|movement-location-policy|warehouse-operation-auth|outbound-v2-authorization|picking-plan.spec|picking-strategy.contract.spec)'
```

일반 CI 전체 suite는 저장소 gate 규칙을 따른다. targeted integration에서 DB 부재로 skip한 결과를 통과로 보고하지 않는다. 새 경고/실패가 없으면 불필요한 동일 검사 반복을 하지 않는다.

- [x] **5. 인수 기록을 작성한다.** acceptance 문서에는 검증 commit, 실행 명령/시간, 파일·test 수, 실패/skip, A1–E2 매핑, 실제 HTTP 대사, 응답 유실 재생 결과, 남은 제한을 기록한다. Windows/PDA 로그인·HID 연속 A/A/B 및100스캔·포커스/Enter·재시작·Wi-Fi는 별도 unchecked 항목으로 두고 실기 검증 후에만 체크한다. 시연 범위는 개별 배치/기발급 송장/활성 일반 위치/같은 창고다.
- [ ] **6. 최종 리뷰와 커밋.** diff에서 신규 schema/우회 권한/미확인 키 교체/서비스 안 HTTP 예외 변환이 없는지 확인한다. `test(warehouse): verify demo workflow recovery over HTTP`로 수용 검사와 기록을 커밋한다.

## 배포 가능한 완료 상태

서버 정상 응답·기존 요청 키·기존 snapshot·force resolver가 호환되어야 한다. A/B/C를 합친 acceptance 기록과 실제 시연 서버/앱 버전을 대조한다. 앱·Core를 배포한 사실이나 실제 장비 인수는 이 계획 작성 또는 로컬 테스트만으로 완료 처리하지 않는다.
