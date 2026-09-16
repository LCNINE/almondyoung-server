# 작업별 위치 정책 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비활성 위치로 새 재고를 이동하지 못하게 하고, 비활성 위치의 기존 재고 회수와 목적에 맞는 위치 검색을 보장한다.

**Architecture:** 이동·적치의 작은 위치 정책과 트랜잭션용 위치 잠금을 공유한다. 목적지 검증은 서버에서 수행하고, 검색은 용도별 필터/캐시 키를 사용한다. 원장 수량 보호와 출발지 회수 경로는 유지한다.

**Tech Stack:** NestJS, Drizzle/PostgreSQL, Jest, React, TanStack Query, Vitest.

**Spec:** [물류 앱 시연 흐름 설계 §5, §7 B1–B5](../specs/2026-09-16-warehouse-demo-readiness-design.md)

## 실행 상태 (2026-09-16)

A/B/C-1–C-3 구현과 개별 리뷰를 완료했다. C-4 로컬 HTTP/DB·전체 gate 결과는 [통합 인수 기록](../../../native/warehouse-app/docs/warehouse-demo-readiness-acceptance.md)에 있다. 체크 표시는 각 task의 실행/RED·GREEN 기록에 근거한다. C-4 독립 리뷰·전체 branch 리뷰, 배포·실제 Windows/PDA 인수는 아직 완료 표시하지 않는다.

## Global Constraints

- Node 22와 저장소의 `corepack yarn` 명령을 사용한다. 신규 외부 의존성·DB 테이블·DB enum·영구 재고 사본을 추가하지 않는다.
- v2 작업 키·원래 요청 본문·사용자/API 범위·확정 결과 재생 계약을 유지한다. 미확인 작업을 새 키로 바꾸지 않는다.
- 입고 대기·배치 관리 재고·예약 보호, 서버 권한과 창고 범위 검증을 유지한다.
- 원장·피킹·검수·출고 변경은 호출자가 소유한 같은 트랜잭션에서 원자적으로 처리한다. GET은 조회만 한다.
- 작업자에게는 한국어 행동 안내를 제공하고, 내부 코드·잠금·DB 상태는 진단 정보로 분리한다.
- 검증은 명시적으로 지정한 전용 로컬 DB에서 수행한다. 운영 데이터 보정·운영 배포·실제 기기 인수는 자동 검사와 구분한다.

## 시작 조건과 파일 지도

기준 develop `25ef604a6`과 현재 branch 차이를 확인하고 별도 구현 작업공간을 사용한다. 계획 A와 독립 구현 가능하지만 배포 전에 native 새 거절 코드 처리가 필요하다.

전용 DB는 `warehouse_demo_readiness_test`를 사용한다. local PostgreSQL에서 **존재 여부를 조회하고 없을 때만 생성**한다. 기존 DB를 drop/reset하지 않는다. 아래 값은 로컬 테스트 전용이며 운영 `.env`를 읽지 않는다.

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/warehouse_demo_readiness_test
corepack yarn drizzle-kit migrate --config apps/core/drizzle.config.ts
```

| 책임           | 파일                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 순수 위치 정책 | 신규 `apps/core/src/modules/inventory/shared/policies/location-work-policy.ts` 및 `.spec.ts`                                                                      |
| 위치 잠금      | 신규 `apps/core/src/modules/inventory/shared/locks/location-work-lock.ts`                                                                                         |
| 이동/적치 검증 | 기존 `apps/core/src/modules/inventory/movement/services/movement.service.ts`, `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts`          |
| DB 회귀        | 신규 `apps/core/src/modules/inventory/movement/services/movement-location-policy.integration.spec.ts`, `movement-location-policy.concurrency.integration.spec.ts` |
| 검색 계약      | 기존 `apps/core/src/modules/inventory/core/dto/location-query.dto.ts`, `services/location.service.ts`, `services/location.service.spec.ts`                        |
| 목적별 검색 UI | 기존 native `domains/warehouse/useLocationSearch.ts`, `types.ts`, `domains/movement/MovementScreen.tsx`, `domains/inbound/PutawaySheet.tsx`와 해당 tests          |
| 확정 거절/안내 | 기존 native `core/data/httpClient.ts`, `errorMessage.ts`와 해당 tests                                                                                             |

## Task B-1: 서버 목적지 정책과 동시성

**Files:** 위 policy/lock/movement/kernel 및 신규 DB tests. 기존 kernel integration, movement idempotency tests도 회귀 실행한다.

**Interfaces:** 신규 helper는 아래 두 API로 제한한다. 필요한 schema 타입은 inventory/schema에서 import한다.

```ts
type LocationFacts = { id: string; warehouseId: string; isActive: boolean; isSystem: boolean };
type DestinationIssue = 'MISSING' | 'WRONG_WAREHOUSE' | 'SAME_LOCATION' | 'INACTIVE' | 'SYSTEM';
export function destinationIssue(input: {
  purpose: 'movement' | 'putaway';
  warehouseId: string;
  sourceLocationId: string;
  destination: LocationFacts | null;
}): DestinationIssue | null;
export function lockWorkLocations(tx: DbTx, ids: string[]): Promise<Map<string, Location>>;
```

`destinationIssue` 검사 순서는 존재 → 창고 → 동일 위치 → 적치의 시스템 위치 → 비활성이다. 호출자는 기존 오류 계약이 요구하는 우선순위를 유지하도록 기존 선행 검사와 매핑을 보존한다. 이동에서 INACTIVE만 신규 409 code를 사용한다.

- [x] **1. 실패 회귀를 작성한다.** 기존 `fulfillment/services/__support__`의 `makeDb`, `inRollbackTx`, `seedWarehouseWithZone`, `seedHolder`, `seedSku`, `receiveStock`, `wireLogistics`와 `ambientDbService`를 사용한다. 다음 본문을 rollback fixture 안에서 실행한다.

```ts
const f = await seedWarehouseWithZone(tx);
const { holderId } = await seedHolder(tx);
const { skuId } = await seedSku(tx, holderId);
const service = ambientDbService(tx);
const wiring = wireLogistics(service);
await receiveStock(wiring.command, tx, { ...f, skuId, quantity: 5 });
const [dest] = await tx
  .insert(wmsTables.locations)
  .values({
    warehouseId: f.warehouseId,
    code: `inactive-${randomUUID()}`,
    locationType: 'zone',
    isActive: false,
  })
  .returning();
const movement = new MovementService(service, wiring.eventStore, new InventoryIdempotencyService(service));
await expect(
  movement.moveImmediately({
    warehouseId: f.warehouseId,
    idempotencyKey: randomUUID(),
    lines: [{ skuId, fromLocationId: f.locationId, toLocationId: dest.id, quantity: 5 }],
  }),
).rejects.toMatchObject({ response: { code: 'MOVEMENT_DESTINATION_INACTIVE' } });
```

호출 전후에 대상 SKU의 ledger/event, 대상 창고의 movementJobs/workLogs를 비교한다. 거절 뒤 ambient tx 안에서 상태를 조회할 때 기존 서비스의 transaction/savepoint 계약을 따른다. SQL 오류로 transaction이 중단되어 조회하지 못하는 것을 불변 검사 성공으로 간주하지 않는다.

- [x] **2. RED를 확인한다.**

```bash
corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/inventory/movement/services/movement-location-policy.integration.spec.ts
```

DB 미지정으로 skip된 결과를 성공으로 간주하지 않는다. 신규 suite는 `REQUIRE_WAREHOUSE_DEMO_DB=1`일 때 DB 미지정을 즉시 실패시킨다. C-4의 공통 인수 명령에서 이 값을 설정한다.

- [x] **3. policy와 lock을 구현한다.** policy는 spec 표의 순수 판정을 구현한다. lock은 다음 형태로 구현하고 빈 배열에는 빈 Map을 반환한다.

```ts
const uniqueIds = [...new Set(ids)].sort();
const rows = await tx
  .select()
  .from(wmsTables.locations)
  .where(inArray(wmsTables.locations.id, uniqueIds))
  .orderBy(asc(wmsTables.locations.id))
  .for('share');
return new Map(rows.map((row) => [row.id, row]));
```

MovementService는 모든 SKU의 기존 stock lock을 취득한 뒤 위치들을 잠그고 재검증한다. putaway는 회차/라인 잠금 후 stock lock → 위치 잠금 → 목적지 판정 → 입고 누계/원장 변경 순서로 처리한다. 업무 오류의 기존 우선순위와 메시지를 보존한다. stock lock 취득 전 위치 잠금은 남기지 않는다.

- [x] **4. 필수 사례를 추가한다.** 비활성 출발→활성 목적지 성공, 부분 수량, 여러 라인 중 하나가 무효이면 전체 불변, 동일 위치/다른 창고/없는 위치 거절, 시스템 위치 자유 재고 이동의 기존 허용, 입고 대기 보호, 적치의 시스템/비활성 위치 거절, 성공 후 비활성화→같은 키 성공 재생을 검사한다.
- [x] **5. 두 연결의 경합 검사를 추가한다.** 독립 연결에서 (a) 비활성화 UPDATE를 미커밋 상태로 유지해 이동을 기다리게 한 뒤 커밋→409, (b) 이동의 위치 share lock을 유지해 UPDATE를 기다리게 한 뒤 이동 커밋→UPDATE 완료를 실행한다. 적치도 양방향을 검사한다. 실제 이동/적치 서비스를 호출하고 필요하면 test wiring의 위치 잠금 직후 barrier를 주입한다. 제품 API에 대기 플래그를 추가하지 않는다. timeout을 늘려 통과시키지 않는다.
- [x] **6. GREEN과 기존 회귀를 확인하고 커밋한다.**

```bash
corepack yarn test --runInBand --testPathPattern='(movement-location-policy|movement.service.idempotency|inbound-receipt.kernel|inbound-origin-protection)'
corepack yarn tsc --noEmit -p apps/core/tsconfig.app.json
```

`fix(inventory): enforce active movement destinations under lock`으로 커밋한다. 이 server 변경은 B-2의 client 거절 분류를 먼저 배포한 뒤 적용한다.

## Task B-2: 검색 후보와 확정 거절 계약을 맞춘다

**Files:** 검색 DTO/service와 tests, native search/types/movement/putaway/error files 및 tests.

**Interfaces:**

```ts
type LocationSearchPurpose = 'lookup' | 'movement-source' | 'movement-destination' | 'putaway-destination';
// useLocationSearch의 기존 2인자 호출은 lookup으로 유지한다.
type LocationItem = { id: string; code: string; displayName: string; isActive: boolean; isSystem: boolean };
```

- [x] **1. 서버·클라이언트 RED를 작성한다.** query DTO의 `isSystem=false/true/미지정` 파싱, service의 items/total 일치를 검사한다. hook test에서는 mock API 요청 path를 비교한다.

```ts
expect(new URL(`http://test${request.path}`).searchParams.get('isActive')).toBe('true');
expect(new URL(`http://test${request.path}`).searchParams.get('isSystem')).toBe('false');
```

위 기대값은 putaway-destination이다. movement-destination에는 isSystem이 없어야 하며 source/lookup에는 두 필터 모두 없어야 한다. query 호출 인자는 기존 `useLocationSearch.test.tsx`의 api mock으로 캡처한다.

- [x] **2. focused 실행으로 실패를 확인한다.**

```bash
corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/inventory/core/services/location.service.spec.ts
corepack yarn --cwd native/warehouse-app test src/domains/warehouse/useLocationSearch.test.tsx src/domains/movement/MovementScreen.test.tsx src/domains/inbound/PutawaySheet.test.tsx --maxWorkers=2
```

- [x] **3. 목적별 필터와 캐시를 구현한다.**

```ts
const queryKey = ['location-search', warehouseId, term, purpose];
const qs = new URLSearchParams({ search: term, limit: '20' });
if (purpose === 'movement-destination' || purpose === 'putaway-destination') qs.set('isActive', 'true');
if (purpose === 'putaway-destination') qs.set('isSystem', 'false');
```

서버 DTO에 검증되는 optional isSystem 필터를 추가하고 items/count 조건 모두에 반영한다. hook의 default는 lookup이다. 새 창고/purpose에 이전 후보를 노출하지 않도록 placeholderData 조건을 제한한다. MovementScreen은 source/destination purpose를 각각 전달하고 PutawaySheet는 putaway-destination을 전달한다. 클릭/완전일치 스캔/lastDest 재사용 모두 목적지 속성을 검사한다. 속성이 누락된 후보를 임의 활성으로 간주하지 않는다. fixture의 LocationItem 속성도 실제 계약에 맞게 갱신한다.

- [x] **4. 확정 거절과 입력 보존을 구현한다.**

```ts
new ApiError('inactive destination', 409, 'MOVEMENT_DESTINATION_INACTIVE').outcome === 'rejected';
// errorMessage: '사용 중지된 위치예요. 다른 도착 위치를 선택해 주세요.'
```

정확한 code만 allowlist에 추가하고 모든 409를 확정 거절로 확대하지 않는다. 서버가 거절하면 수량·상품·출발지·사유는 보존하고 목적지 재선택을 안내한다. 응답 유실이면 입력을 바꾸지 않고 기존 operation 복구를 유지한다.

- [x] **5. 회귀를 통과시킨다.** 비활성/system 후보 자동선택 방지, 선택 뒤 비활성화 409, source 검색의 비활성 재고 조회, 창고 전환·응답 역전, 구형 서버의 unfiltered 결과와 누락 속성을 검사한다.

```bash
corepack yarn --cwd native/warehouse-app test src/domains/warehouse src/domains/movement src/domains/inbound/PutawaySheet.test.tsx src/domains/inventory/AdjustStockScreen.test.tsx src/domains/stocktaking/SessionCountScreen.test.tsx src/core/data/httpClient.test.ts src/core/data/errorMessage.test.ts --maxWorkers=2
corepack yarn --cwd native/warehouse-app build
corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/inventory/core/services/location.service.spec.ts
```

`fix(warehouse): select locations by work purpose`로 해당 파일들을 커밋한다.

## 종료와 적용 순서

B1–B5 실제 검사 결과를 기록한다. client의 `MOVEMENT_DESTINATION_INACTIVE` 확정 거절 처리를 먼저 제공한 뒤 server를 적용한다. 새 검색 필터가 없어도 서버 검증이 최종 경계를 지키며, 새 앱의 후보 속성 검사는 오래된 검색 응답에서 잘못된 자동선택을 막는다. 기존 비활성 위치 재고를 자동 수정하지 않는다.

다음은 [출고 준비 계획](2026-09-16-warehouse-outbound-preparation.md)이다.
