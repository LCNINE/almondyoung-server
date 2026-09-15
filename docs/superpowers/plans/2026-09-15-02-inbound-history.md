# PR-B: 입고 기록과 취소 Implementation Plan

## 실행 결과 — 2026-09-15

- [x] B1–B3: 구현, 실패 재현/회귀 검사, 독립 검토, 로컬 커밋 완료.
- [x] 실제 React→HTTP→전용 DB에서 해당 업무와 원장을 대사했다.
- [x] 최종 앱404테스트/서버172테스트, 타입 검사·빌드 통과. lint 경고와 기존 서버 lint 오류는 별도 기록했다.
- [ ] 실제 Windows·로그인·HID·네이티브 장애 복구·실물 대사.
- [ ] Push·PR·병합·배포는 별도 진행.

실제 결과와 한계는 [재고 정확성 합격 검사 기록](../../../native/warehouse-app/docs/inventory-accuracy-acceptance.md)의 “스테이션 단독 물류 운영” 절을 따른다. 아래 상세 체크리스트는 실행 전 계획 원문이다. 커밋은 작업별 기능과 검토 보완으로 묶었으며 예시 커밋 메시지와 개수는 다를 수 있다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 이 계획은 같은 작업에서 순차 실행할 수 있다. 별도 작업 생성이나 서브에이전트가 필수는 아니다.

**Goal:** 입고 결과와 취소 결과를 확인하고 원래 입고 출처에 맞게 오입력을 되돌린다.

**Architecture:** 기존 receipts 조회와 direct/purchase_order 취소 API를 연결한다. 이력 조회에 취소 상태 및 표시 정보를 부가하고 기존 기본 응답의 의미는 유지한다.

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
- [ ] 이 설계와 해당 계획을 실행 checkout의 `docs/superpowers/specs/2026-09-15-station-operations-design.md`, `docs/superpowers/plans/2026-09-15-02-inbound-history.md`에 복사해 구현과 함께 관리한다.
- [ ] 로컬 DB가 필요한 검사에는 실행 checkout의 무시되는 `work/station-local.env`에 `STATION_TEST_DATABASE_URL`을 설정한다. localhost/127.0.0.1의 신규 `warehouse_station_20260915` DB만 허용하고 스키마를 적용한다. 실행 전 URL의 호스트·DB 이름만 출력해 확인한다. 기존 DB를 reset하지 않는다.
- [ ] 각 기능 작업은 실패 재현 → 최소 구현 → 해당 검사 통과 → 검토 → 로컬 커밋 순서로 실행한다. 버튼 문구 등 낮은 위험의 단순 편집을 위한 독립 테스트는 만들지 않는다.
- [ ] Push·PR 생성·병합·운영 배포는 사용자의 해당 지시에 따라 별도로 진행한다. 계획상 PR 명칭은 변경 묶음의 이름이다.

---

## 의존성과 변경 범위

PR-A의 스테이션 메뉴·SKU 선택기·입력 및 영속 처리 기반 위에 구현한다. 기존 `/inbound/receipts`는 posted만 반환하므로, 화면만 붙이면 전량 취소된 입고가 사라진다. 이를 서버 조회 계약에서 함께 해결한다.

### Task B1: 취소 상태와 작업자 표시 정보를 포함한 입고 조회

**Files:** Modify `apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.ts`, `services/inbound.service.ts`, `dto/inbound-response.dto.ts`; Create `dto/inbound-receipts-query.dto.ts`; Extend `services/inbound-receipt-history.integration.spec.ts`, `controllers/inbound.controllers.spec.ts`.

**Interfaces:** 기존 `GET /inbound/receipts`에 선택적 `status=posted|voided|all`과 `receiptId=UUID`를 추가한다. receiptId는 복구 시 정확한 회차 하나를 읽는 필터이며 반드시 선택 창고 조건과 함께 쓴다. 생략하면 기존 posted 동작을 유지한다. 기존 응답 필드는 유지하고 아래 필드를 부가한다.

```ts
interface ReceiptLineDisplayFields {
  skuCode: string;
  skuName: string;
  originLocationCode: string | null;
  canCancel: boolean;
  cancelBlockReason: null | 'ALREADY_CANCELED' | 'NOT_TODAY' | 'PUTAWAY_EXISTS'
    | 'RETURN_EXISTS' | 'INSUFFICIENT_ORIGIN_STOCK' | 'MISSING_ORIGIN_OR_EVENT';
}
// 기존 각 line의 source: 'direct' | 'purchase_order'를 그대로 사용한다.
// 응답 최상위에 serverTime: ISO 문자열을 추가한다.
```

- [ ] 기존 history fixture의 posted 2건/voided 1건을 사용한다. 기본 호출은 2건, status all은 3건, voided 필터는 1건을 반환하고 total과 items가 같은 조건인지 검사한다. SKU 필터도 기존대로 회차의 전체 라인을 포함한다.
기존 `seedHistory`와 `makeInboundService`를 사용하는 동일 테스트 파일 안에 아래 검사를 추가한다.

```ts
await inRollbackTx(db, async tx => {
  const f = await seedHistory(tx);
  const svc = makeInboundService(db);
  const all = await svc.listInboundReceipts({ warehouseId: f.warehouse.id, status: 'all' }, tx);
  expect(all.total).toBe(3);
  expect(all.items.map(item => item.id)).toContain(f.voided.id);
});
```

- [ ] 서울 00:00 직전/직후를 UTC 서버 환경으로 검사한다. 잘못된 날짜·UUID·status·음수 offset·limit 0/101을 400으로 거절한다. 기존 유효 호출과 최대 100/기본 50의 페이지 계약을 확인한다.
- [ ] Run `DATABASE_URL="$STATION_TEST_DATABASE_URL" corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/inventory/inbound/services/inbound-receipt-history.integration.spec.ts apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.spec.ts`.
- [ ] Query DTO에 skuId/warehouseId/receiptId UUID, 실제 달력 날짜 YYYY-MM-DD, status enum, limit 1..100/offset>=0을 정의한다. `getInboundHistory` 등 다른 API로 범위를 넓히지 않는다. receipts 조회의 날짜 범위만 서울 기준 `[시작일 00:00, 종료일 다음날 00:00)`로 바꾼다.

```ts
const start = new Date(`${startDate}T00:00:00+09:00`);
const endExclusive = new Date(new Date(`${endDate}T00:00:00+09:00`).getTime() + 86400000);
// gte(occurredAt, start), lt(occurredAt, endExclusive)
// status !== 'all'이면 status === (query.status ?? 'posted') 조건 적용.
```

- [ ] 회차 라인에 SKU와 원위치 표시정보를 join/batch 조회로 붙인다. canCancel은 같은 서울 날짜, 미취소/미회송/미적치, 원위치·원입고 event 존재, 원위치 ON_HAND가 라인 전량 이상이라는 현재 상태로 계산한다. 참이어도 취소 성공을 보장하는 예약은 아니다. 최종 변경 판단은 기존 취소 kernel이 잠금 안에서 다시 한다.
- [ ] 같은 조건이 direct/purchase_order에 적용됨을 기존 source guard와 같은 날 취소 테스트로 확인한다. schema migration은 필요하지 않다. 새 display 필드가 기존 DTO 변환 및 v2 응답 재생을 깨지 않도록 additive로 구현한다.
- [ ] 기존 history·cancel-source-guard·same-day-cancel 회귀를 통과시키고 로컬 커밋: `feat(inventory): expose complete inbound history`.

### Task B2: 입고내역 화면과 출처별 취소

**Files:** Create `native/warehouse-app/src/domains/inbound/InboundHistoryScreen.tsx`, `InboundHistoryScreen.test.tsx`, `receiptHistory.ts`, `receiptHistory.test.tsx`; Create `native/warehouse-app/src/app/routes/InboundHistoryRoute.tsx`; Modify `app/routeTree.tsx`, `profiles/station/StationHome.tsx`, `domains/inbound/types.ts`, `mutations.ts`, `core/data/invalidateInventory.ts`.

**Interfaces:** 새 경로 `/inbound/history`. 기본 조회는 선택 창고, 서울 기준 최근 7일, status all, limit 20/offset 0. 상품은 A의 SkuPicker로 선택하며 조회가 의미하는 날짜·상태·창고를 표시한다.

```ts
interface ReceiptHistoryParams {
  warehouseId: string;
  skuId?: string;
  startDate: string;
  endDate: string;
  status: 'all' | 'posted' | 'voided';
  limit: 20;
  offset: number;
}
// queryKey: ['inbound-receipts', warehouseId, skuId, startDate, endDate, status, offset]
// GET /inbound/receipts? URLSearchParams(params)
```

- [ ] 화면 검사: 발주/직접 입고와 취소된 입고 표시, 창고 변경/필터 변경 시 첫 페이지, 조회 실패 시 “없음”으로 오인하지 않기, 다음 페이지 실패 시 기존 페이지 유지 및 재확인. 취소 버튼은 fresh 조회의 canCancel일 때만 표시한다.
- [ ] Run `corepack yarn --cwd native/warehouse-app test src/domains/inbound/InboundHistoryScreen.test.tsx src/domains/inbound/receiptHistory.test.tsx`.
- [ ] 회차별 일시/입고 방식/총수량/상태, 라인별 상품명·코드·입고수량·적치/취소수량·원위치를 표시한다. 날짜는 Asia/Seoul로 표시한다. 신규 표시 필드가 없는 구형 서버에서는 SKU ID를 업무 이름처럼 표시하거나 취소 가능을 추정하지 않고 서버 업데이트 안내를 제공한다.
- [ ] 취소 확인에는 상품·창고·원위치·전량 수량·발주 잔량 복원이 포함되는지 표시한다. 확인 시 아래 출처 분기를 사용한다. 같은 키로 복구하는 동안 확인을 다시 시작할 수 없다.

```ts
if (line.source === 'purchase_order') {
  await cancelPurchaseOrder.mutateAsync({
    receiptLineId: line.id, idempotencyKey: operationId,
  });
} else {
  await cancelDirect.mutateAsync({
    lineId: line.id, quantity: line.quantity, idempotencyKey: operationId,
  });
}
```

- [ ] 실패/결과 미확인/권한 부족은 서로 구분한다. 실패하면 이력과 원장 조회를 갱신해 현재 취소 가능 상태를 다시 보여준다. 임의 수량 수정·부분 취소·적치 후 강제 역분개는 추가하지 않는다.
- [ ] `native/warehouse-app/src/core/data/invalidateInventory.ts`의 영속 재확인 완료 처리와 입고·취소·적치·발주 수령 mutation의 invalidation에 `['inbound-receipts']`를 추가한다. 서버에서 취소가 확정되면 status all 화면에 취소 상태로 남는지 확인한다. 로컬 커밋: `feat(warehouse-app): add inbound history and cancellation`.

### Task B3: 간편입고 직후 복구 연결과 취소 결과 검증

**Files:** Modify `native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx`, `confirmedPutaway.ts`, `types.ts`, `core/operations/operationResult.ts`; Extend `QuickInboundScreen.test.tsx`, `ReliabilityReview.test.tsx`, `core/operations/operationRunner.test.ts`.

**Interfaces:** 입고 직후 “입고내역”으로 이동할 때 새 `/inbound/history`를 사용한다. receiptId를 수신 시 draft에 보존하며 기존 draft에는 optional로 추가해 마이그레이션을 요구하지 않는다. FreshLine에 취소 상태를 표현할 경우 기존 saved draft의 누락 값은 미확인으로 취급한다.

- [ ] 응답을 잃은 취소의 재확인이 요청을 새 키로 보내지 않는지, 전체 취소 후 기존 간편입고 draft가 적치 버튼을 다시 열지 않는지 검사한다. 취소는 되었지만 화면 갱신 전 종료하는 경우도 포함한다.
- [ ] Run `corepack yarn --cwd native/warehouse-app test src/domains/inbound/ReliabilityReview.test.tsx src/core/operations/operationRunner.test.ts src/core/operations/operationResult.test.ts`.
- [ ] 취소 응답 validator를 강화한다. `{}`와 손상된 2xx를 성공으로 처리하지 않는다. direct는 `{success:true}`, 발주 취소는 기존 반환 필드 `poId/skuId/quantity/receiptLineId`를 검사한다.

```ts
if (path === '/inbound/cancel') {
  valid = object && row.success === true;
}
// receipt-lines/:id/cancel은 receiptLineId/poId/skuId 문자열과 quantity 정수 검사.
```

- [ ] 간편입고 재개 시 `/inbound/receipts?receiptId=저장된회차ID&warehouseId=선택창고&status=all&limit=1&offset=0`으로 현재 취소/적치 상태를 확인해 staged 라인을 동기화한다. 저장된 회차 ID가 없는 구형 draft는 staged lineId를 기준으로 기존 완료 작업 응답에서 회차 ID를 복원하며, 복원할 수 없으면 기존 대기 목록에서 확인하도록 안내하고 자동 적치를 막는다. 이력 조회는 항상 창고 범위를 고정한다. 조회 실패면 이전 미적치 스냅샷으로 적치를 허용하지 않는다. 완료된 영속 취소 기록을 먼저 반영하고, 다른 PC 변경은 fresh 조회로 확인한다.
- [ ] 원위치 재고가 다른 작업으로 줄어 취소 실패한 경우, 이미 발주입고인 경우, 서울 날짜가 넘어간 경우에 원장에 새 역분개가 없는지 DB 대사한다.
- [ ] 성공 후 보존된 취소 이력, 발주 잔량 복원, 원장 역분개 1회, 재개 시 적치 차단을 확인하고 로컬 커밋: `fix(warehouse-app): reconcile canceled inbound drafts`.

## PR-B 최종 검증

- [ ] 앱 입고 전체와 operations 회귀, 전체 앱 테스트/build/lint를 실행한다.
- [ ] B1의 실제 DB 검사와 source guard/same-day-cancel/receipt kernel 회귀를 순차 실행한다. DB가 설정되지 않아 skip되면 완료로 판정하지 않는다.
- [ ] 로컬 React→HTTP→DB에서 직접 입고 5 → 전량 취소 → 이력에 취소 표시 → 새로 정정 입고 3을 실행해 원위치 순증가가 3인지 확인한다.
- [ ] 발주 10 중 4 입고 → 4 전량 취소 → 발주 미입고 10 복원을 확인한다.
- [ ] 제품 코드가 바뀐 범위의 타입 검사 및 `git diff --check`를 실행하고 `native/warehouse-app/docs/inventory-accuracy-acceptance.md`에 결과를 기록한다.

서버 조회 계약이 늘어나므로 Core → Windows 앱 순서로 배포한다. A/B 통과 후에도 실제 PC 장비 검사와 승인된 소량 실물 대사가 필요하다.
