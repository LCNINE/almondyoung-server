# PR-C: 출고 위치 일치 Implementation Plan

## 실행 결과 — 2026-09-15

- [x] C1–C3: 구현, 실패 재현/회귀 검사, 독립 검토, 로컬 커밋 완료.
- [x] 실제 React→HTTP→전용 DB에서 해당 업무와 원장을 대사했다.
- [x] 최종 앱404테스트/서버172테스트, 타입 검사·빌드 통과. lint 경고와 기존 서버 lint 오류는 별도 기록했다.
- [ ] 실제 Windows·로그인·HID·네이티브 장애 복구·실물 대사.
- [ ] Push·PR·병합·배포는 별도 진행.

실제 결과와 한계는 [재고 정확성 합격 검사 기록](../../../native/warehouse-app/docs/inventory-accuracy-acceptance.md)의 “스테이션 단독 물류 운영” 절을 따른다. 아래 상세 체크리스트는 실행 전 계획 원문이다. 커밋은 작업별 기능과 검토 보완으로 묶었으며 예시 커밋 메시지와 개수는 다를 수 있다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 이 계획은 같은 작업에서 순차 실행할 수 있다. 별도 작업 생성이나 서브에이전트가 필수는 아니다.

**Goal:** 작업자가 확인한 실제 출발 위치와 시스템 피킹 위치를 일치시킨다.

**Architecture:** 기존 단순출고 전략·담당자 리스·출고 확정을 재사용하는 위치 지정 계약을 추가한다. 준비·조회·피킹을 구분하고 구형 계약의 미확인 작업을 그대로 복구한다.

**Tech Stack:** React 19, TypeScript, TanStack Query/Router, Tauri 2, Vitest, NestJS, Drizzle, PostgreSQL, Jest.

**Spec:** [스테이션 단독 물류 운영 설계](../specs/2026-09-15-station-operations-design.md)

**Repository:** `/home/pauseb/workspace/almondyoung-server`; 조사 기준 `df44cf4fb`. 실행 시작 시 최신 develop과 차이를 확인한다. 아래 파일 경로는 저장소 루트 기준이다.

## Global Constraints

- 초기 운영 대상은 Windows 스테이션이며 핸드헬드 사용을 전제하지 않는다.
- 모든 수량은 낱개 정수다. 입고·적치·이동은 1 이상, 실사 총수량은 0 이상이다.
- 발주입고와 간편입고의 출처 및 발주 잔량 처리를 유지한다.
- 입고는 기존 입고기본존 등록 후 적치 모델을 유지한다.
- 재고 변경은 기존 영속 작업 실행기, 원래 요청 본문과 키, 계정/API 범위, 서버 권한 검증을 사용한다.
- 저장 실패·결과 미확인 중 새 확정·편집·의미가 바뀌는 화면 이동을 차단한다.
- 검색은 재고를 변경하지 않는다. 이전 검색의 결과를 새 선택에 사용하지 않는다.
- 일반 화면에는 필요한 행동 안내만 표시한다. 요청·응답·키 등 기술 정보는 권한이 있는 개발자 모드에만 표시한다.
- 기존 출고·입고·실사 미확인 작업의 경로·본문·키를 새 계약으로 바꾸어 재전송하지 않는다.
- 서버의 기존 API 기본 동작을 호환 유지하고 새 계약은 서버부터 배포한다.
- 테스트 데이터 변경은 별도의 로컬 DB에서만 수행한다. 운영 데이터와 기존 테스트 DB를 초기화하지 않는다.
- 실제 Windows 설치·로그인·HID 스캔·장애 복구 검증을 모의 테스트 통과로 대체하지 않는다.


## 실행 준비

- [ ] 현재 작업 변경을 확인한 뒤 `superpowers:using-git-worktrees`에 따라 실행용 checkout을 분리한다. 이 문서만을 이유로 develop에 제품 코드를 직접 수정하지 않는다.
- [ ] 이 설계와 해당 계획을 실행 checkout의 `docs/superpowers/specs/2026-09-15-station-operations-design.md`, `docs/superpowers/plans/2026-09-15-03-outbound-locations.md`에 복사해 구현과 함께 관리한다.
- [ ] 로컬 DB가 필요한 검사에는 실행 checkout의 무시되는 `work/station-local.env`에 `STATION_TEST_DATABASE_URL`을 설정한다. localhost/127.0.0.1의 신규 `warehouse_station_20260915` DB만 허용하고 스키마를 적용한다. 실행 전 URL의 호스트·DB 이름만 출력해 확인한다. 기존 DB를 reset하지 않는다.
- [ ] 각 기능 작업은 실패 재현 → 최소 구현 → 해당 검사 통과 → 검토 → 로컬 커밋 순서로 실행한다. 버튼 문구 등 낮은 위험의 단순 편집을 위한 독립 테스트는 만들지 않는다.
- [ ] Push·PR 생성·병합·운영 배포는 사용자의 해당 지시에 따라 별도로 진행한다. 계획상 PR 명칭은 변경 묶음의 이름이다.

---

## 목적과 범위

현재 단순출고는 `pickScanned`에서 SKU 수량을 배정 위치 순서대로 나눈다. 실제 작업자가 확인한 위치를 받는 새 계약을 추가한다. 기존 API와 미확인 작업의 경로는 유지한다. 기존 discrete 방식만 지원하며 배정 재설계·재고 부족 해결·송장 발급으로 범위를 넓히지 않는다.

### Task C1: 위치별 출고 준비와 현재 작업 조회

**Files:** Create `apps/core/src/modules/fulfillment/controllers/location-outbound.controller.ts`, `dto/location-outbound.dto.ts`, `services/location-outbound.service.ts`, `services/location-outbound.service.integration.spec.ts`; Modify `services/simple-outbound.service.ts`, `fulfillment.module.ts`; Extend `reader/shipment-waybill.reader.ts` and tests; Modify `apps/core/src/modules/inventory/core/controllers/warehouse-work-context.controller.ts`, `controllers/warehouse-operation-auth.spec.ts`.

**Interfaces (new):**

```ts
interface StartLocationOutboundInput { warehouseId: string; }
interface LocationOutboundActor { id: string; roles: string[]; }
// LocationOutboundService가 제공할 메서드:
// start(shipmentId, input, actor, idempotencyKey, tx?) -> Promise<LocationOutboundState>
// getState(shipmentId, warehouseId, tx?) -> Promise<LocationOutboundState>
// scan(shipmentId, input, actor, idempotencyKey, tx?) -> Promise<LocationOutboundState>
// force(shipmentId, input, actor, idempotencyKey, authorization, tx?) -> Promise<LocationOutboundState>
interface OutboundSourceLine {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  sourceLocationCode: string;
  allocatedQty: number;
  pickedQty: number;
  remainingQty: number;
}
interface LocationOutboundState extends SimpleOutboundState {
  warehouseId: string;
  sources: OutboundSourceLine[];
}
// POST /shipments/:shipmentId/location-outbound-starts
// Body: StartLocationOutboundInput, Idempotency-Key 필수.
// GET /shipments/:shipmentId/location-outbound-state?warehouseId=UUID
// 조회는 LocationOutboundState를 반환하며 준비/담당자 지정 부수효과가 없음.
```

- [ ] 기존 `seedPickableShipment`, `inRollbackTx`, `assembleSimpleOutbound` 패턴을 사용해 시작 1회로 plan/session/claim이 생기고 같은 키 재전송에는 하나씩만 유지되는지 검사한다. 다른 warehouseId는 prepare 전에 거절한다. GET은 plan/session/claim/재고 이벤트를 만들지 않는지 검사한다.
- [ ] 새 서비스의 fixture 조립기는 기존 simple-outbound wiring의 DbService, commands, SimpleOutboundService를 공유하도록 `services/__support__/simple-outbound-wiring.ts`에 `assembleLocationOutbound(tx): LocationOutboundService`로 추가한다. 테스트에서 임의 mock inventory 구현으로 대체하지 않는다.

```ts
await inRollbackTx(db, async tx => {
  const f = await seedPickableShipment(tx);
  const service = assembleLocationOutbound(tx);
  const actor = { id: f.actorId, roles: ['logistics_worker'] };
  const key = randomUUID();
  const first = await service.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, key, tx);
  const replay = await service.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, key, tx);
  expect(replay).toEqual(first);
  expect(first.sources.some(source => source.sourceLocationId === f.locationId)).toBe(true);
});
```

- [ ] Run `DATABASE_URL="$STATION_TEST_DATABASE_URL" corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/location-outbound.service.integration.spec.ts`.
- [ ] DTO에서 warehouseId UUID를 검증하고 인증 actor와 `WAREHOUSE_OPERATE`를 요구한다. 시작은 `shipment.location_outbound.start` command와 canonical `{shipmentId,warehouseId,actorId}`를 사용한다. 기존 `SimpleOutboundService.prepare`를 동일 트랜잭션 안에서 호출하고, 그 plan/session의 위치별 할당과 미정산 커스터디를 집계한다.
- [ ] SimpleOutboundService의 현재 `loadState`를 `loadState(context, tx): Promise<SimpleOutboundState>` 공개 메서드로 전환해 공유한다. prepare/plan/method/claim 조건을 새 서비스에 복사하지 않는다. source의 pickedQty는 기존 `attributedQty`와 동일하게 SETTLED 제외 합계이며 remainingQty는 allocatedQty에서 이를 뺀 값이다. shipped 상태에는 sources를 빈 배열로 반환해 정산된 출고를 다시 피킹 대기로 표시하지 않는다.
- [ ] work-context의 capabilities에 `locationOutbound: true`를 추가한다. A의 WorkCapabilities 타입도 `locationOutbound?: boolean`을 부가한다. 앱은 시작 명령을 만들기 전에 이 지원 여부를 확인한다.
- [ ] by-waybill 응답에 shipment의 warehouseId를 추가한다. 새 앱은 선택 창고와 다른 박스를 열지 않는다. 선택적 query warehouseId가 있으면 reader도 불일치를 거절한다. 기존 호출의 생략 시 동작은 유지한다. shipped 박스에는 시작 POST를 보내지 않는다.
- [ ] 동일 actor 재개·다른 actor의 유효 lease 충돌·미지원 방식·종결 박스를 검사하고 로컬 커밋: `feat(fulfillment): expose location outbound work context`.

### Task C2: 지정 위치만 피킹하는 출고와 스캔 생략

**Files:** Extend `dto/location-outbound.dto.ts`, `controllers/location-outbound.controller.ts`, `services/location-outbound.service.ts`, `services/simple-outbound.service.ts`, new integration tests. 기존 `services/simple-outbound.service.integration.spec.ts`의 두 위치 fixture를 재사용한다.

**Interfaces (new):**

```ts
interface LocationOutboundScanInput {
  warehouseId: string;
  sourceLocationId: string;
  barcode: string;
  quantity: number;
}
interface LocationOutboundConfirmInput {
  warehouseId: string;
  reason: string;
  items: Array<{ shipmentLineId: string; sourceLocationId: string; quantity: number }>;
}
// POST /shipments/:id/location-outbound-scans -> LocationOutboundState
// POST /shipments/:id/location-outbound-forces -> LocationOutboundState
// 둘 다 Idempotency-Key 필수. forces에는 DISPATCH_FORCE 권한 필요.
```

- [ ] A/B에 같은 SKU가 있는 fixture를 만든다. B에 할당된 경우 B 선택으로 B만 소비한다. A에만 할당된 경우 B 선택은 재고 변경 없이 409다. 지정 위치 잔량을 초과한 수량이 다른 위치로 넘어가지 않는지 검사한다.
- [ ] 서비스에서도 정수·양수·상한을 검증한다. warehouseId는 실제 shipment와 일치해야 하며 위치는 동일 창고의 활성 위치여야 한다. SKU/line은 해당 shipment 소속이어야 한다. command canonical에 actorId·warehouseId·sourceLocationId·barcode·quantity를 포함한다. 같은 키로 위치만 바꿔도 409가 나야 한다.
- [ ] 기존 pickScanned를 공유 가능한 위치 제한 helper로 분리한다. 구형 호출은 기존 동작을 유지하고 새 계약에서는 위치 필터를 필수로 전달한다. 기존 prepare와 settleIfFullyPicked의 담당자·전량 피킹·출고 조건을 유지한다.

```ts
// 새 계약의 allocation 조회에는 반드시 이 조건을 추가한다.
eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId)
// 해당 위치의 미피킹 합계가 quantity 미만이면 picking.scan 호출 전에 409.
// 이후 모든 피킹과 출고 확정도 하나의 트랜잭션 안에서 처리한다.
```

- [ ] 스캔 생략 확인은 각 line/위치의 실물 확인 수량을 입력받는다. 중복 line/위치는 거절한다. 현재의 모든 미피킹 할당과 입력 수량이 정확히 일치해야 하며, 바뀌었으면 409 `LOCATION_OUTBOUND_PROGRESS_CHANGED`로 거절한다. 완전히 일치할 때만 지정 위치에서 pick한 후 기존 forceDispatch를 올바른 권한 decision·사유와 함께 호출한다. 기존 forceComplete의 자동 잔량 채우기를 호출하지 않는다.
- [ ] 신규 거절 코드: `LOCATION_OUTBOUND_WAREHOUSE_MISMATCH`, `LOCATION_OUTBOUND_SOURCE_MISMATCH`, `LOCATION_OUTBOUND_OVERSCAN`, `LOCATION_OUTBOUND_PROGRESS_CHANGED`. 모두 명확히 거절된 409로 응답하고 변경을 rollback한다. force 실패 시 선행 pick도 rollback한다.
- [ ] 실제 DB에서 동일 요청 재생·본문 변경·다른 actor·응답 유실·위치 부족·강제 권한 403을 검증한다. 기존 단순출고 integration도 실행하고 로컬 커밋: `fix(fulfillment): honor actual outbound source locations`.

### Task C3: 스테이션 위치 확인과 영속 재개

**Files:** Modify `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx`, `SimpleOutboundScreen.tsx`, `mutations.ts`, `queries.ts`, `types.ts`, `lastBox.ts`; Create `OutboundSourcePicker.tsx`, `locationOutbound.ts` and tests; Modify `core/operations/operationRunner.ts`, `operationResult.ts`, `core/data/httpClient.ts`, `errorMessage.ts` and tests.

**Consumes:** C1/C2 API. 새 요청의 원본 body/key는 기존 영속 실행기에 보존한다. **Produces:** 창고와 위치를 확인한 뒤 상품을 스캔/명시 확인하는 화면.

- [ ] 화면 검사: 박스의 warehouseId가 다르면 진입을 막는다. 준비 결과 확인 전 상품을 접수하지 않는다. SKU별 예정 위치/잔량을 표시하고 위치 미선택 상태에서는 상품 요청을 보내지 않는다.
- [ ] 스캔 입력을 `{barcode, quantity, sourceLocationId, warehouseId}`로 저장해 접수 당시 위치를 고정한다. 앞선 입력이 대기 중이면 위치 변경을 막는다. 기존 수량 지정·포장 단위 정책을 그대로 유지한다.

```ts
scanQueue.enqueue({
  barcode: event.code,
  quantity: scanQuantity,
  warehouseId: work.warehouseId,
  sourceLocationId: selectedSource.id,
});
```

- [ ] 위치 후보는 최신 state의 sources에서 고른다. 위치 바코드 입력은 명시적 “위치 선택” 모드에서 받아 상품 입력과 구분한다. 다른 위치에만 할당되어 있으면 해당 위치를 안내하며 자동 재할당하지 않는다.
- [ ] 새 변경 endpoint 3개(start/scans/forces)를 operationRunner의 보호 대상에 넣고 shipment resource로 묶는다. state GET은 변경으로 저장하지 않는다. operationResult에서 warehouseId·sources 식별자·수량·상태를 검사한다. C2의 거절 코드를 ApiError의 확정 거절과 작업자 행동 안내에 등록한다.
- [ ] lastBox에는 optional 계약 종류를 추가한다. 기존 저장 데이터는 구형으로 처리한다. 구형 simple-outbound의 미확인 요청은 기존 endpoint에 원래 body/key로 재확인하며, 완료 확인 전 새 계약을 시작하지 않는다. 새 박스부터 위치 지정 계약을 사용한다. 저장소를 일괄 변환하지 않는다.
- [ ] 새 서버 지원 여부가 false/누락이면 시작 POST와 영속 시작 작업 생성을 막고 업데이트 안내를 표시한다. 지원 확인 후에도 실제 변경 응답이 유실되거나 손상되면 원본 키로 재확인한다. 확정 거절된 404와 결과 미확인을 혼동하지 않는다. 위치 없는 구형 API로 자동 fallback하지 않는다.
- [ ] 스캔 생략에는 사유와 위치별 잔량 확인을 요구하고 C2 forces에만 보낸다. 다른 작업자의 처리로 잔량이 바뀌면 최신 내역을 다시 확인하게 한다.
- [ ] Run `corepack yarn --cwd native/warehouse-app test src/domains/outbound src/core/operations src/core/data`. 중간 재개와 마지막 1개 응답 유실에 중복 출고가 없는지 확인하고 로컬 커밋: `feat(warehouse-app): confirm outbound source locations`.

## PR-C 최종 검증과 도입 조건

- [ ] 두 위치·두 SKU·부분 피킹·두 작업자·수동 위치 변경을 포함하는 실제 DB 검사로 다른 위치 영향 0, 총량 일치, 담당자 lease 유지를 확인한다.
- [ ] 로컬 React→HTTP→DB에서 선택 위치만 소비하는지 검증한다. 실물은 시험 운영에서 별도로 대사한다.
- [ ] 전체 앱 test/build/lint, 변경 Core 타입 검사, 기존 fulfillment 라우트 순서/단순출고/권한 회귀와 `git diff --check`를 실행한다.
- [ ] Core부터 배포하고 새 준비·조회·스캔·강제 확인 계약을 검증한 다음 Windows 앱을 배포한다. 기존 앱은 기존 API를 사용할 수 있으므로 전 PC 업데이트 전에는 환경 전체의 위치 일치를 보장한다고 보고하지 않는다.
- [ ] 실제 Windows 로그인/HID/통신 단절/재로그인/강제 종료/동일 박스 담당자 충돌을 검사한다. 미확인 작업 삭제를 복구 방법으로 삼지 않는다.

기존 API의 즉시 차단은 이 PR에 포함하지 않는다. 구형 앱 사용 중단과 남은 작업 대사 후 별도로 승인된 전환 절차를 적용한다.
