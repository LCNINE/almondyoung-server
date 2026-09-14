# Inventory Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 본 계획만으로 하위 에이전트를 자동 생성하지 않는다.

**Goal:** 접수한 실물 작업을 누락·중복 없이 반영하고, 오래된 실사 결과로 현재 재고를 덮지 않으며, 작업자에게 필요한 업무 안내만 제공한다.

**Architecture:** 업무 단위 스캔 대기열과 영속 작업 기록을 앱 공통 계층에 둔다. 서버의 기존 트랜잭션·중복 방지 서비스를 확장하고, 실사는 카운트/원장 버전 및 검토 토큰으로 적용 대상을 검증한다. 작업자 상태 표시와 개발자 진단은 분리한다.

**Tech Stack:** 현재 저장소의 TypeScript, React, TanStack Query, Tauri, NestJS, Drizzle/PostgreSQL, Vitest, Jest. 로컬 작업 저장은 WebView IndexedDB를 사용한다. 테스트용 IndexedDB 어댑터 의존성을 추가할 경우 test-only로 제한한다.

**Spec:** [재고 정확성 수정 설계](../specs/inventory-accuracy-design.md). 이 파일과 설계를 함께 읽는다.

## 실행 기록

구현과 검증의 실제 결과는 [합격 검사 기록](../../../native/warehouse-app/docs/inventory-accuracy-acceptance.md)에 남긴다. 아래는 최초 계획의 검사 목록이며, 물리 장비 검사와 운영 배포는 로컬 자동 검사와 구분한다.

## Global Constraints

- 작업자는 개발적인 요청·응답·재시도를 알 필요가 없다. 재고 정확성을 지키기 위해 필요한 행동 안내만 보여주고, 상세 정보는 기본 비활성인 개발자 모드로 분리한다.
- 정상 처리: 상품·확정 수량만 갱신. 짧은 지연에는 팝업을 띄우지 않는다.
- sending/uncertain 상태에서는 payload를 바꾸거나 새 키로 대체하지 않는다. 실패한 요청의 성공 여부부터 해결한다.
- 인증과 권한 검사는 항상 먼저 한다.
- 서버의 기존 트랜잭션·재고 부족·예약·창고 소속 검사를 유지한다.
- 미확인 작업은 진단 로그와 별도로 보존한다. 계정·API 서버가 달라지면 자동 전송하지 않는다.
- 같은 상품 두 번 스캔은 두 이벤트다. 시간 기반 중복 제거와 isPending에 의한 무음 폐기는 사용하지 않는다.
- 운영 DB에 테스트 데이터를 넣지 않는다. 저장소의 전체 lint는 autofix이므로 검증 명령으로 무심코 실행하지 않는다.
- 이 문서는 계획이며 제품 코드 구현·마이그레이션 실행·배포 승인 완료를 뜻하지 않는다.

---

## 시작 상태 및 파일 기준

- 원본 저장소: `/home/pauseb/workspace/almondyoung-server`.
- 점검 HEAD: `015bb0760`. 실행 전 HEAD와 AGENTS.md를 다시 확인한다.
- 이하 파일 경로는 원본 저장소 기준이며 `APP`는 `native/warehouse-app/src`, `INV`는 `apps/core/src/modules/inventory`의 문서상 약칭이다. 실행 시 정확한 경로로 확장한다.
- 원본 저장소는 clean 상태였고 이번 계획 작성에서 변경하지 않았다.
- 재현 테스트: 이 문서 옆 `inventory-accuracy-evidence/`의 세 파일. 원래 각 `APP/domains/{inbound,outbound,stocktaking}/ReliabilityReview.test.tsx`에 두어야 상대 import가 맞는다.
- 추가 테스트는 세 가지 안전 동작을 요구해 실패했다. 클라이언트 모의 응답을 사용했으며 실제 DB 중복 반영을 재현한 결과로 확대 해석하지 않는다.

## 구현 단위와 의존성

| 순서 | 결과물 | 해결 ID | 선행 |
|---|---|---|---|
| 1 | 스캔 순서·화면 전환 규칙 및 누락 회귀 방지 | A1, A8 | 없음 |
| 2 | 서버의 통일된 작업 식별·재생 계약 | A2, A3, A4 | 없음 |
| 3 | 재시작을 견디는 작업 기록과 실행기 | A2, A3 | 2의 계약 |
| 4 | 입고·적치·이동·조정·출고 연결 | A1, A2, A3, A7, A8 | 1, 2, 3 |
| 5 | 실사 카운트 중복 방지·버전 조건·재고 기준 | A4, A6, A8 | 2, 3 |
| 6 | 실사 검토한 결과만 원장에 적용 | A5, A6 | 5 |
| 7 | 업무 상태 안내·정확한 재조회·개발자 모드 | A7 및 사용자 합의 | 3, 4, 6 |
| 8 | DB/장비 합격 검사와 단계 배포 | 전체 | 1–7 |

1–4는 일반 입출고 안정화, 5–6은 실사 안정화, 7–8은 현장 투입 검증으로 각각 리뷰할 수 있다. 실사 수정 전에는 실사 원장 적용을 운영 허용 목록에서 제외한다.

## 공통 인터페이스

새 파일 `APP/core/operations/types.ts`의 계획 계약:

```ts
export type OperationStatus =
  | 'queued' | 'sending' | 'uncertain' | 'confirmed' | 'rejected';

export interface WorkContext {
  actorId: string;
  apiOrigin: string;
  warehouseId: string;
  workflowId: string;
}

export interface StoredOperation {
  id: string; // 서버 idempotency key와 동일. 재시도에서 변경 금지.
  context: WorkContext;
  sequence: number;
  kind: 'receive' | 'cancel-receipt' | 'putaway' | 'move' | 'adjust'
    | 'outbound-scan' | 'outbound-force' | 'count-scan' | 'count-set'
    | 'count-reset' | 'count-complete';
  method: 'POST' | 'PUT';
  path: string;
  bodyJson: string; // 최초 직렬화 본문 보존
  createdAt: number;
  status: OperationStatus;
  attempts: number;
  resultJson?: string;
  errorCode?: string;
}

export interface OperationStore {
  enqueue(input: Omit<StoredOperation, 'sequence' | 'status' | 'attempts'>): Promise<StoredOperation>;
  get(id: string): Promise<StoredOperation | null>;
  claimHead(context: WorkContext, ownerId: string): Promise<StoredOperation | null>;
  settle(id: string, ownerId: string,
    next: Pick<StoredOperation, 'status' | 'resultJson' | 'errorCode'>): Promise<void>;
  recover(context: WorkContext): Promise<StoredOperation[]>;
}
```

`enqueue`는 업무 sequence 부여와 레코드 삽입을 한 트랜잭션에서 처리한다. `claimHead`는 앞선 미확인 작업을 건너뛰지 않는다. IndexedDB 실행권에는 ownerId와 leaseExpiresAt를 내부 필드로 저장하고, 만료 시 동일 선두 작업만 재확인한다. API 서버·사용자가 다르면 claim을 거절한다.

`draft`는 초안 저장소 상태이며 전송 작업의 OperationStatus에 포함하지 않는다. 조회 스캔 이벤트와 재고 변경 작업은 별개로 식별한다. 조회 재시도가 새 재고 변경 작업을 생성하지 않는다.

## Task 1: 모든 스캔을 업무 순서대로 반영

**Files**

- Create: `APP/core/hardware/scan/workScanQueue.ts`, `workScanQueue.test.ts`.
- Modify: `APP/domains/inbound/QuickInboundScreen.tsx`, `PurchaseOrderReceiveScreen.tsx`, `ReceiveSheet.tsx`.
- Modify: `APP/domains/stocktaking/SessionCountScreen.tsx`.
- Test: 위 화면의 기존 `.test.tsx`와 `domains/inbound/ReliabilityReview.test.tsx`.

**Interfaces**

- Consumes: 현재 `ScanEvent`, 바코드 조회 mutation의 `mutateAsync`.
- Produces: `createWorkScanQueue<T>(consume: (event: T) => Promise<void>)` → `{ enqueue(event:T):void; drain():Promise<void>; size():number }`. 실패 이벤트는 큐 선두에 보존하고 재개/확정 거절 처리를 별도로 추가한다. 동일 eventId의 반영 여부는 Task 3 저장소에서 관리한다. `drain()`은 미해결 선두가 있으면 reject하여 화면 전환이 무기한 대기로 보이지 않게 한다. 큐 인터페이스에 `retryHead():Promise<void>`와 `rejectHead(eventId:string):void`를 포함한다. rejectHead는 미반영이 확인된 입력을 작업자가 처리했을 때만 호출한다.

- [ ] 재현 테스트를 원래 import 경로에 옮겨 현재의 2스캔→1개 실패를 확인한다.
- [ ] 대기 상태에서 상품 A·A·B를 순서대로 넣는 테스트를 추가한다. consume 실행 순서와 호출 수가 각각 A·A·B, 3인지 검증한다. deferred Promise로 첫 조회만 지연하며 시간 기반 sleep을 쓰지 않는다.

```ts
const seen: string[] = [];
let release!: () => void;
const first = new Promise<void>((resolve) => { release = resolve; });
const queue = createWorkScanQueue<string>(async (code) => {
  if (seen.length === 0) await first;
  seen.push(code);
});
queue.enqueue('A'); queue.enqueue('A'); queue.enqueue('B');
release();
await queue.drain();
expect(seen).toEqual(['A', 'A', 'B']);
```

- [ ] 개별 mutate 콜백에서 수량을 더하는 코드를 순차 `await lookup.mutateAsync(code)` 소비자로 바꾼다. 조회 실패는 해당 입력을 확인 대상으로 남기고 뒤의 상품을 누락시키지 않는다.
- [ ] 입고 확정·위치 변경·직접 수량 정정은 `drain()` 이후에만 허용한다. 해결되지 않은 입력이 있으면 업무 안내를 표시한다. Task 3 전에는 화면 이탈을 차단해 메모리 큐가 사라지지 않도록 한다.
- [ ] 발주 입고의 `목록 선택=잔량 제안`, `스캔=실카운트`를 분리한다. 첫 스캔 1개/포장 20개, 두 번째 동일 스캔 2개/40개를 검증한다.
- [ ] 100개 연속 입력·다른 SKU·조회 오류·모달 Enter·위치 전환 테스트를 통과시키고 독립 리뷰한다.

Run (app directory): `npm test -- src/domains/inbound src/domains/stocktaking/SessionCountScreen.test.tsx src/core/hardware/scan`.

## Task 2: 서버 작업 키·본문 검증·사용자 기록 계약

**Files**

- Modify: `INV/core/controllers/inventory.controller.ts`, `INV/core/dto/inventory/adjust-stock.dto.ts`, `INV/core/services/inventory-idempotency.service.ts`.
- Modify: `INV/inbound/controllers/inbound.controllers.ts`, `INV/inbound/dto/simple-inbound.dto.ts`, `INV/movement/controllers/movement.controller.ts`, `INV/movement/dto/move-batch.dto.ts`.
- Modify: `INV/stocktaking/controllers/stocktaking.controller.ts`, `services/stocktaking.service.ts`, `dto/scan-product.dto.ts`, `dto/update-count.dto.ts`.
- Create: `INV/core/controllers/warehouse-work-context.controller.ts` (인증된 actorId와 서버 계약 버전 조회), `INV/core/services/warehouse-operation-contract.ts` (버전별 canonical 요청).
- Modify: `INV/core/inventory.module.ts`의 controller/provider 등록.
- Modify/Test: `libs/shared/src/filters/http-exception.filter.ts`와 해당 `.spec.ts`에 필요한 도메인 코드 보존을 검증한다. 응답에 `error`와 `code`를 일관되게 싣고 본문/키 원문은 작업자 메시지에 노출하지 않는다.
- Test: `INV/core/services/adjust-idempotency.integration.spec.ts`, `INV/inbound/services/inbound.service.idempotency.spec.ts`, `apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`.
- Create: `INV/stocktaking/services/stocktaking-idempotency.integration.spec.ts`, 각 변경 controller의 인증/DTO 회귀 테스트.

**Interfaces**

- Consumes: `InventoryIdempotencyService.withIdempotency(endpoint,key,requestBody,handler,tx?)`, 인증된 `@User()`.
- Produces: 앱에서 쓰는 변경 DTO의 `contractVersion: 2`, `idempotencyKey: string`; `GET /inventory/work-context` → `{ actorId: string; operationContractVersion: 2 }`.
- 신규 표준 오류: `OPERATION_PAYLOAD_MISMATCH`, `OPERATION_IN_PROGRESS`, `CLIENT_UPDATE_REQUIRED`. 기존 출고 오류는 보존하고 앱에서 대응 분류한다.

- [ ] 테스트 전용 DB에서 같은 키/같은 본문을 두 번·동시에 보내 원장 변경 1회인지 확인한다. 같은 키/다른 창고·위치·수량·부호·사용자는 적용 0건의 충돌이어야 한다. 현재 조정의 키만 비교하는 동작을 실패 케이스로 남긴다.
- [ ] API v2 조정은 높은 수준의 멱등 래퍼 안에서 `adjustUp/adjustDown(...,tx)`를 호출한다. idempotency key는 헤더와 본문이 둘 다 있을 때 일치해야 한다. 정규화된 본문과 actorId를 fingerprint에 넣는다.

```ts
// API v2 조정 경계의 실행 형태. actorId는 인증 정보에서만 얻는다.
return idempotency.withIdempotency(
  'inventory.adjust.v2', dto.idempotencyKey,
  { actorId, warehouseId: dto.warehouseId, skuId: dto.skuId,
    locationId: dto.locationId, delta: dto.delta, reason: dto.reason },
  (tx) => dto.delta > 0
    ? command.adjustUp({ ...commandInput, quantity: dto.delta }, tx)
    : command.adjustDown({ ...commandInput, quantity: -dto.delta }, tx),
);
// commandInput: skuId, warehouseId, locationId, reason, idempotencyKey.
// delta=0, 정수가 아닌 값, 안전 정수 범위 밖의 값은 이 호출 전에 DTO 검증으로 거절한다.
```

- [ ] 실사 증가/직접 정정/완료에 같은 래퍼를 적용한다. 멱등 재생이 세션 상태 검사보다 먼저 실행되도록 한다. 완료 후 응답 유실→재시도는 원래 결과를 반환해야 한다.
- [ ] 이동·입고 작업자의 기록은 서버 사용자 ID로 채운다. 기존 v1의 저장 본문 hash와 충돌하지 않도록 v2 endpoint namespace를 사용한다. v1 저장 기록 자체를 수정하지 않는다.
- [ ] work-context는 `inventory.operate` 권한으로 보호한다. 앱에서는 actorId를 입력받거나 토큰 내용을 임의 해석해 권한을 판단하지 않는다.
- [ ] 서버는 전환 기간 v1/v2를 구분한다. Task 8에서 모든 호출자 전환을 확인한 뒤 정확성 보장이 필요한 v1 변경을 `CLIENT_UPDATE_REQUIRED`로 막는다. 같은 키를 v1/v2 사이에 자동 이동시키지 않는다.
- [ ] 재고 부족·예약·창고 소속·권한 회귀 테스트를 실행하고 결과를 기록한다. 배포 전 기존 저장 키 재생과 admin-web 호환성을 확인한다.

## Task 3: 영속 작업 기록과 안전한 재시도 실행기

**Files**

- Create: `APP/core/operations/types.ts`, `operationStore.ts`, `operationStore.test.ts`, `operationRunner.ts`, `operationRunner.test.ts`, `OperationProvider.tsx`, `OperationProvider.test.tsx`.
- Create: `APP/core/operations/draftStore.ts`, `draftStore.test.ts`.
- Modify: `APP/core/data/httpClient.ts`, `httpClient.test.ts`, `APP/main.tsx`, `APP/app/Bootstrap.tsx`, `APP/core/auth/session.ts`.

**Interfaces**

- Consumes: 앞의 `OperationStore`, Task 2 work-context 및 v2 계약.
- Produces: `runNext(context:WorkContext):Promise<void>`, `retryOperation(id:string):Promise<void>`, `restoreWork(context:WorkContext):Promise<void>`를 OperationProvider에서 사용한다.
- HTTP 오류 타입은 `{status?:number; code?:string; outcome:'rejected'|'uncertain'; retryable:boolean}`를 제공한다. 오류 원문은 작업자 문구에 직접 전달하지 않는다.
- `draftStore`는 업무 초안과 반영한 스캔 eventId를 함께 원자 저장한다. 전체 작업 성공 여부를 localStorage preference로 보관하지 않는다.

- [ ] store 트랜잭션 실패 시 transport 호출 0회, 앱 재시작 시 sending→uncertain, 계정/서버 불일치 시 전송 0회 테스트를 먼저 작성한다.
- [ ] `enqueue→claimHead→전송→결과 저장` 순서를 구현한다. 결과 저장 전에 접수/완료로 간주하지 않는다. StrictMode와 두 provider가 있어도 서로 다른 후속 작업이 선두를 추월하지 않게 한다.
- [ ] bodyJson은 전송 직전에 재구성하지 않고 최초 문자열을 쓴다. httpClient에 저장 본문 전송 옵션을 추가하고 JSON 이중 인코딩을 검사한다.
- [ ] 응답 유실 재시도에 같은 ID·본문 사용, 최대 재시도 후 선두 보존, 29일 경과 재전송 금지, 로그아웃 보존을 구현한다.
- [ ] 도메인 409 일괄 재시도를 제거한다. 알려진 처리 중 응답만 동일 작업으로 재시도하고, 해시 불일치는 결과 확인 대상으로 남긴다. 401/403은 로그인/권한 회복 후 원래 작업을 확인하며 키를 바꾸지 않는다.
- [ ] 서버 성공→기기 결과 저장 실패에서 다음 재개가 같은 키를 재생하는지 검증한다. 결과 저장 성공→화면 재조회 실패에서는 작업 재전송 없이 재조회만 하는지 검증한다.

Acceptance assertions:

```ts
expect(sentRequests.map((r) => r.idempotencyKey)).toEqual([operation.id, operation.id]);
expect(new Set(sentRequests.map((r) => r.bodyJson)).size).toBe(1);
expect(serverLedgerApplications).toBe(1);
expect((await store.get(operation.id))?.status).toBe('confirmed');
```

이 assertions는 테스트에서 첫 호출을 실제 처리한 뒤 응답만 버리는 상태ful fake transport와 독립 메모리/IndexedDB adapter 모두에 적용한다. 이후 실제 DB에서는 같은 시나리오를 Task 8로 재검증한다.

## Task 4: 입고·적치·이동·조정·출고 화면을 공통 작업에 연결

**Files**

- Modify: `APP/domains/inbound/QuickInboundScreen.tsx`, `PurchaseOrderReceiveScreen.tsx`, `PutawaySheet.tsx`, `PutawayQueueScreen.tsx`, `mutations.ts`.
- Modify: `APP/domains/movement/MovementScreen.tsx`, `useMoveStock.ts`.
- Modify: `APP/domains/inventory/AdjustStockScreen.tsx`, `useAdjustStock.ts`.
- Modify: `APP/domains/outbound/SimpleOutboundScreen.tsx`, `OutboundQueueScreen.tsx`, `mutations.ts`, `lastBox.ts`.
- Modify: `APP/app/warehouse-context.tsx`, `APP/app/routes/AuthedLayout.tsx` (미확정 업무와 창고/계정 전환 동선).
- Test: 각 화면/mutation의 기존 `.test.tsx` 및 `domains/outbound/ReliabilityReview.test.tsx`.

**Interfaces**

- Consumes: Task 1 스캔 소비자, Task 3 OperationProvider/초안 저장.
- Produces: 재고 변경은 화면의 `crypto.randomUUID()` 호출과 일회성 mutate 성공 콜백 대신 저장 작업을 통해 실행된다. 입력 전 상태는 draft, 제출 후에는 고정된 StoredOperation이다.

- [ ] 출고 응답 유실, 간편입고 등록 직전 늦은 조회, 이동/조정 실패 후 수량 편집, 적치 시트 닫기/다시 열기, 발주 입고 앱 재시작 테스트를 추가한다.
- [ ] 생성/수정 가능한 draft와 이미 전송한 작업을 분리한다. 수량 편집 때문에 새 키를 만드는 기존 effect를 제거한다. uncertain 해결 전 새 작업이 전송되지 않아야 한다.
- [ ] 출고의 연속 스캔은 송장별 sequence를 따른다. 앞선 스캔 결과 불명이나 강제출고 확인 중에는 후속 스캔의 처리를 멈춘다. 동일 상품 정상 2스캔의 ID는 두 개, 같은 스캔 재시도의 ID는 하나다.
- [ ] 작업 결과는 ID 기준으로 화면에 한 번 반영한다. putawayDoneQty에 응답 재생마다 더하지 않는다. 확정 후 최신 입고/적치/송장 상태를 읽어 맞춘다.
- [ ] 입력 중 창고 변경은 초안을 새 창고에 그대로 이식하지 않는다. 미확정 업무가 있으면 완료/결과 확인 뒤 변경하도록 안내한다. 다른 계정에서는 이전 사용자의 작업을 실행하지 않는다.
- [ ] “실패 후 값을 바꾸면 새 키”를 무조건 기대하는 기존 테스트를 고친다. 서버가 미반영을 확정한 거절이면 편집 가능, 응답 유실이면 결과 확인 전 편집 불가로 나눈다.
- [ ] 위 도메인 테스트와 빌드를 통과시키고, 입력→전송 payload→화면 결과가 같은 작업인지 리뷰한다.

Run (app directory): `npm test -- src/domains/inbound src/domains/movement src/domains/inventory src/domains/outbound src/core/operations`; `npm run build`.

## Task 5: 실사 카운트에 버전과 재고 기준을 추가

**Files**

- Modify: `INV/schema/inventory.schema.ts`의 stocktakingSessions/stocktakingLines.
- Migration: `apps/core/drizzle/`에 `npm run db:generate:core -- --name=stocktaking-count-baseline`로 생성되는 SQL/메타를 함께 리뷰한다. 생성기가 부여하는 시각 접두사는 미리 추측하지 않는다.
- Modify: `INV/stocktaking/services/stocktaking.service.ts`, `dto/scan-product.dto.ts`, `dto/update-count.dto.ts`, `dto/session-detail.dto.ts`, `controllers/stocktaking.controller.ts`.
- Create: `INV/stocktaking/dto/reset-count.dto.ts`, `services/stocktaking-count-version.integration.spec.ts`.
- Modify: `APP/domains/stocktaking/types.ts`, `mutations.ts`, `SessionCountScreen.tsx` 및 테스트.
- Modify: `apps/admin-web/src/lib/api/domains/inventory/stocktaking.client.ts` 및 연결된 호출 타입/훅.

**Interfaces**

- `stocktakingSessions.revision`: 정수, 기본 1. 카운트/정정/라인 추가/재시작에서 증가.
- `stocktakingLines.revision`: 정수, 기본 1. `countBaselineVersion`: nullable integer. 신규 카운트 시작 시 원장 version, 행 부재 시 0.
- scan-product v2: 기존 필드 + idempotencyKey, contractVersion. 응답에 lineRevision, sessionRevision 추가.
- update-count v2: countedQuantity, notes?, expectedRevision, idempotencyKey, contractVersion.
- reset-count: `POST /stocktaking/lines/:id/reset-count` with expectedRevision, idempotencyKey, contractVersion. 카운트를 다시 세기 시작한다. 완료된 세션에는 실행 불가.

- [ ] DB 재현을 먼저 추가한다: 동일 키 2회 스캔=1 증가, 두 키=2 증가, 다른 작업자가 증가시킨 후 오래된 expectedRevision 정정=409/변경 0.
- [ ] 첫 카운트 시작 때 원장 version을 기록한다. 후속 스캔은 동일 baseline을 검증한다. 원장 변경 뒤 후속 스캔/미리보기/완료는 `STOCKTAKING_RECOUNT_REQUIRED`로 거절한다.
- [ ] 세션 잠금→정해진 순서의 재고 가용성 잠금→라인 갱신 순서를 고정한다. 스캔/정정/리셋/완료가 같은 순서를 사용해 교착을 막는다. 다른 원장 작업의 잠금과 호환되는지 DB 병행 테스트로 확인한다.
- [ ] 이전 데이터의 baseline은 현재 version으로 임의 채우지 않는다. 진행 중 세션의 null baseline은 다시 세기를 요구한다. 완료된 세션과 기존 재고는 변경하지 않는다.
- [ ] `countedQuantity=null`과 `0`을 구분한다. 0은 명시적으로 센 결과, null은 미카운트다. 리셋은 countedQuantity=null로 돌아가고 새 baseline을 취한다.
- [ ] 클라이언트 실사 대기열을 공통 작업 저장소에 연결한다. 위치 변경·수동 정정·다시 세기는 미확인 스캔을 건너뛰지 않는다.
- [ ] admin-web도 동일 계약을 보내도록 수정한다. 완료 API만 새로 보호하면서 다른 앱에서 버전 없는 카운트가 계속 들어오게 두지 않는다.

## Task 6: 실사 미리보기와 완료를 동일 상태에 묶기

**Files**

- Modify: `INV/stocktaking/services/stocktaking.service.ts`, `dto/adjustment-preview.dto.ts`, `controllers/stocktaking.controller.ts`.
- Create: `INV/stocktaking/dto/complete-session.dto.ts`, `services/stocktaking-preview-token.ts`, `services/stocktaking-preview-token.integration.spec.ts`.
- Modify: `INV/stocktaking/services/stocktaking-complete.integration.spec.ts`.
- Modify: `APP/domains/stocktaking/VarianceReviewScreen.tsx`, `types.ts`, `mutations.ts` 및 테스트.
- Modify: `apps/admin-web/src/lib/api/domains/inventory/stocktaking.client.ts`, `apps/admin-web/src/lib/services/inventory/mutations.ts` 및 해당 미리보기/완료 화면.

**Interfaces**

```ts
interface ReviewedCount {
  lineId: string;
  lineRevision: number;
  baselineVersion: number;
  currentLedgerVersion: number;
  countedQuantity: number;
  currentOnHand: number;
}
interface ReviewedPreview {
  sessionRevision: number;
  previewToken: string; // 정렬한 전체 ReviewedCount + 세션 ID/revision의 SHA-256
  preview: Array<{ lineId: string; delta: number }>;
}
interface CompleteCountInput {
  contractVersion: 2;
  idempotencyKey: string;
  previewToken: string;
}
```

- [ ] 기존 미리보기 −1→카운트 +3에서도 완료가 열리는 재현 테스트를 추가한다. 데이터 변경/조회 불확실 시 미리보기 승인 상태와 완료 버튼이 닫혀야 한다.
- [ ] 서버 통합 테스트: 미리보기 후 다른 사용자 카운트, 재고 이동, 원장 version만 바뀌는 수량 왕복, 미카운트 라인 추가는 완료 거절·원장 변경 0건이어야 한다.
- [ ] 미리보기에서 세션 범위의 전체 라인을 포함해 토큰을 계산한다. variance!=0 필터만으로 완료 자격을 판단하지 않는다. null 카운트/기준 version 불명/현재 version 변화는 거절한다.
- [ ] 완료 트랜잭션에서 같은 잠금으로 상태를 읽고 토큰을 비교한 뒤 기존 adjustUp/Down과 세션 종결을 원자 수행한다. 현재 재고만 다시 읽어 과거 카운트로 맞추지 않는다.
- [ ] 차이 0건도 빈 preview+토큰을 서버에서 확보한 뒤 완료한다. 작업자에게 불필요한 미리보기 클릭은 강제하지 않고 내부 조회로 수행한다.
- [ ] 완료 이후 같은 작업 재시도는 저장 결과를 재생한다. 다른 키의 완료는 세션 종결 상태를 반환/거절하되 원장을 다시 변경하지 않는다.
- [ ] “실사 후 정상 출고 3개” 시나리오를 검증한다. 오래된 카운트를 적용해 3개를 다시 만들어내는 대신 다시 세기를 요구해야 한다.

## Task 7: 필요한 업무 안내와 개발자 모드 분리

**Files**

- Create: `APP/core/operations/workStatus.ts`, `workStatus.test.ts`, `APP/core/design/WorkStatusNotice.tsx`, `WorkStatusNotice.test.tsx`.
- Create: `APP/core/data/invalidateInventory.ts`, `invalidateInventory.test.ts`.
- Create: `APP/core/diagnostics/operationDiagnostics.ts`, `operationDiagnostics.test.ts`, `DeveloperModeProvider.tsx`.
- Modify: `APP/core/data/errorMessage.ts`, 관련 업무 mutations, `APP/profiles/shared/DiagnosticsScreen.tsx`, station/handheld 홈, 설정 및 diagnostics route guard.
- Create: `INV/core/controllers/warehouse-diagnostics-access.controller.ts`; Modify: `INV/core/inventory.module.ts`.

**Interfaces**

- `workStatus(operation, now)` → `{tone:'none'|'waiting'|'success'|'action'; message:string|null; blocksWork:boolean}`.
- `invalidateInventory(qc, kind)`는 위치 재고·SKU 창고 재고·요약과 작업별 입고예정/적치/출고배치/실사 query key를 중앙 관리한다.
- `GET /inventory/diagnostics-access`: `inventory.manage`를 서버에서 검사, 성공 204. 허용되어도 개발자 모드 기본 false. 별도 새 역할/권한 부여는 하지 않는다.

- [ ] 일반 작업자의 화면/접근성 텍스트에 UUID·HTTP 코드·idempotency·재시도 횟수가 노출되지 않는 테스트를 추가한다.
- [ ] 짧은 정상 지연은 조용히 처리한다. 1.5초 경과 시 한 줄 상태, uncertain이면 즉시 필요한 행동 안내를 표시한다. 요청마다 toast를 만들지 않는다.
- [ ] 성공음/완료 표시를 confirmed 이후에만 실행한다. 결과 재생·앱 재개에서 동일 완료음을 반복하지 않는다. 입력 미접수와 완료를 같은 소리로 알리지 않는다.
- [ ] 업무 상태에서 uncertain이 해소되기 전에는 낡은 수량을 확정 수량으로 제시하지 않는다. 캐시 갱신 자체는 성공 여부 판정에 사용하지 않는다.
- [ ] 개발자 모드는 서버 권한 확인 후 명시적으로 켠 동안만 나타난다. 로그아웃 시 닫고, 권한 확인 실패 시 닫는다. 기존 진단 메뉴가 일반 홈에 상시 노출되지 않게 한다.
- [ ] 진단은 24시간/1,000건의 `{operationId,kind,status,attempts,elapsedMs,errorCode}`만 기록한다. 원문 본문·상품 바코드·송장번호·토큰·쿠키·수취인 정보는 저장하지 않는다. 로그 정리는 미확인 작업 삭제와 분리한다.
- [ ] 재조회 실패 상황에서도 이미 확정한 입고/출고를 실패로 바꾸지 않는지 검사한다.

## Task 8: 실행 검증과 배포 순서

**Files**

- Create: `INV/core/services/warehouse-accuracy.integration.spec.ts` (업무 간 수량 불변식 및 응답 유실 시나리오).
- Create: `native/warehouse-app/docs/inventory-accuracy-acceptance.md` (장비 결과 기록).
- Modify: 필요에 따라 해당 테스트 전용 fixture. 운영 시드/마이그레이션을 검사 명목으로 실행하지 않는다.

- [ ] 실행 환경을 확인하고 테스트 전용 PostgreSQL을 마련한다. DB 환경변수가 없어 skip된 테스트는 미검증으로 기록한다. root AGENTS.md대로 Yarn을 사용하며, 미설치 환경에서는 실행자가 설치/사용 가능한 패키지 매니저를 명시한다.
- [ ] 각 task의 실패 테스트가 수정 전 예상 이유로 실패하고 수정 후 통과하는지 확인한다. UI 모의 서버 테스트만으로 DB 원장 불변식 통과를 선언하지 않는다.
- [ ] 아래 행렬을 실제 테스트 DB로 실행한다. fault injection은 트랜잭션 커밋 후 응답만 끊는 경우와 커밋 전 롤백을 각각 구분한다.

| 시나리오 | 합격 기준 |
|---|---|
| 간편입고 동일 SKU 100스캔/다른 SKU 혼합 | 접수 이벤트 수와 입고 수량 일치, 미해결 조회가 있으면 확정 불가 |
| 입고 +10의 응답 유실 및 재시작 | 입고 +10 한 번, 발주 누계 및 적치 대기 일치 |
| 적치/이동 4개 동시 재시도 | 출발 −4, 도착 +4 한 번, 창고 합계 불변 |
| 조정 −2 응답 유실 후 편집 시도 | 원래 결과 확인 전 추가 전송 0회 |
| 출고 2개 중 첫 스캔 응답 유실 | 같은 키 재확인 시 1/2, 별도 두 번째 상품 이벤트 이후 2/2 |
| 두 작업자 같은 출고 박스 | 기존 담당자/리스 보호 유지, 중복 차감 0 |
| 같은 실사 스캔 키 두 번 / 다른 두 키 | 각각 +1 / +2 |
| 정정 화면을 연 사이 다른 카운트 | 오래된 revision은 거절, 최신 카운트 보존 |
| 실사 미리보기 후 카운트/원장 변화 | 완료 트랜잭션의 재고 쓰기 0건, 재검토/재실사 안내 |
| 저장소 실패·응답 손상·계정 변경 | 성공 오표시/다른 사용자 자동 전송/미확인 작업 삭제 0 |

- [ ] 앱 전체 테스트/빌드를 실행한다: app에서 `npm test`, `npm run build`. 세 재현 테스트도 제품 회귀 테스트로 포함해 모두 통과해야 한다.
- [ ] root에서 대상 Jest 통합 테스트를 `--runInBand`로 실행한다. 정확한 DB/환경과 passed/failed/skipped 수를 보고한다. 예약/가용재고·원장 이벤트 검증을 함께 실행한다.
검증 명령 예시(실행 시 테스트 전용 DB URL을 별도 지정하며 기존 DATABASE_URL을 묵시적으로 쓰지 않는다):

```bash
DATABASE_URL="${WAREHOUSE_TEST_DATABASE_URL:?테스트 전용 DB URL 필수}" yarn jest --runInBand \
  apps/core/src/modules/inventory/core/services/adjust-idempotency.integration.spec.ts \
  apps/core/src/modules/inventory/stocktaking/services/stocktaking-idempotency.integration.spec.ts \
  apps/core/src/modules/inventory/stocktaking/services/stocktaking-count-version.integration.spec.ts \
  apps/core/src/modules/inventory/stocktaking/services/stocktaking-preview-token.integration.spec.ts \
  apps/core/src/modules/inventory/stocktaking/services/stocktaking-complete.integration.spec.ts \
  apps/core/src/modules/inventory/core/services/warehouse-accuracy.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts
```

- [ ] Android PDA와 Windows에서 실제 HID 스캔, WebView 강제 종료 후 복구, Wi-Fi 단절, 입력 창 포커스, 수동 수량과 Enter를 검증한다. 네이티브 저장소 검증 전에는 재시작 보존이 현장 검증됐다고 주장하지 않는다.
- [ ] 서버 additive 계약/DB 확장 → admin-web/새 warehouse-app → 계정/기기별 시험 운영 → v1 미보호 변경 차단 순서로 배포한다. feature 활성화는 `operationContractVersion=2` 확인 후 수행한다.
- [ ] 기존 작업 키는 계약 버전을 넘겨 재전송하지 않는다. 전환 시 기존 미확인 작업을 먼저 대사하고, baseline 없는 진행 중 실사는 다시 세기를 요구한다.
- [ ] 문제 발생 시 새 재고 변경을 중단하고 미확인 작업을 보존한다. 예전 불안전 클라이언트로 자동 복귀하지 않으며, 스키마 확장은 유지하고 작업을 대사한 뒤 재개한다.

## 계획 자체 검토

- A1→1/4, A2→2/3/4, A3→2/3/4, A4→2/5, A5→6, A6→5/6, A7→7, A8→1/4/5로 연결했다.
- 작업자 최소 안내/개발자 모드→7; 재시작·계정·보존기간·호환성→2/3/8.
- 데이터가 바뀌면 키만 회전하자는 과거 제안은 결과 불명 상황에 적용하지 않는다. 원래 작업을 해결한 뒤 새로운 작업으로 분리한다.
- 실사 baseline version 변화와 미리보기 승인 변화는 다른 검증이다. 새 미리보기를 받는 것만으로 오래된 실카운트를 유효하게 만들지 않는다.
- 실행은 Task 1의 재현 테스트 이관부터 시작하며, 제품 코드 수정 전 사용자가 합의한 범위를 유지한다.
