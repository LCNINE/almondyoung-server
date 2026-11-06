# 출고 준비 일괄 처리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 어드민 출고 준비 화면에서 완전출고 상자를 고르고 버튼 한 번을 누르면 계획 확정, 송장 발급, 배치 생성, 상자 담기까지 끝나게 한다.

**Architecture:** core 에 컨트롤러 하나(`outbound-preparation`)를 새로 둔다. 이 컨트롤러는 분류 현황 조회, 계획 확정 일괄, 배치 담기 일괄, 부분출고 나누기 일괄을 맡는다. 각 일괄은 상자마다 기존 서비스 메서드를 따로 부르고 결과를 모은다. 어드민은 순수 함수 러너가 단계 API를 차례로 부른다. 송장 발급은 기존 `waybills:batch` 를 쓴다. 러너가 일시 오류 재시도와 45초 초과로 남은 건의 재호출을 맡는다. 운송장 발급 화면은 출고 준비 화면으로 바꾼다.

**Tech Stack:** NestJS + Drizzle (core), Next.js + React Query + vitest/jest (admin-web).

**Spec:** `docs/superpowers/specs/2026-11-05-outbound-preparation-bulk-design.md`

**실행 방식:** subagent-driven-development 로 진행한다. 구현 서브에이전트는 `codex:codex-rescue` 를 쓴다. 태스크가 끝날 때마다 사용자에게 보고하고, 사용자가 검토와 커밋을 승인하면 다음 태스크로 넘어간다.

## Global Constraints

- 한 번에 처리하는 상한은 100건이다. 화면과 서버 모두 지킨다(`@ArrayMaxSize(100)`).
- 기본 피킹 방식은 `total_picking` 이다. 선택지는 `individual | total_picking | multi_order` 이고, `multi_order` 이면 `cartCapacity` 가 필요하다.
- 택배사는 `HANJIN` 하나다(`WAYBILL_LIVE_CARRIERS`).
- 자동 재시도는 최대 3회, 간격은 2000ms, 5000ms, 10000ms 이다.
- 상자별 멱등 키는 `<헤더 Idempotency-Key>:<shipmentId>` 로 만든다.
- 새 라우트 권한: 조회는 `fulfillment.shipment.read`, 쓰기는 `fulfillment.warehouse.operate`. 새 권한 키는 만들지 않는다.
- 새 테이블, 컬럼, 마이그레이션은 없다.
- 레이어 규칙: Controller → Service(2~3줄) → Reader/Manager. Service 는 `HttpException` 을 import 하지 않는다.
- 사용자 문구는 해요체로 쓰고 특수 인용부호(겹화살괄호, 낫표 등)를 쓰지 않는다. 주석에 이슈 번호를 달지 않는다.
- jest 는 항상 `--maxWorkers=2` 로 돌린다. 전체 스위트는 마지막 태스크에서만 돌린다.

## Review Focus

1. 응답을 잃은 뒤 같은 상자를 다시 보낸 경우: 계획 확정에서는 이미 `planned` 인 상자, 배치 담기에서는 이미 이 배치에 들어 있는 상자다. 둘 다 실패가 아니라 성공으로 나와야 한다. 테스트는 Task 3 과 Task 4 에 있다.
2. 운영자가 목록을 연 뒤 상자 상태가 바뀐 경우: 취소, 합치기, 다른 사람이 먼저 처리한 경우다. 확정 오류(`transient: false`)로 나오고 나머지 상자는 진행돼야 한다. 테스트는 Task 3 에 있다.
3. `waybills:batch` 가 `pending/time-budget-exceeded` 를 돌려준 경우: 러너는 같은 키로 남은 건만 다시 불러야 하고, 이 재호출은 재시도 3회에 세지 않는다. 테스트는 Task 6 에 있다.
4. 송장이 하나도 성공하지 못한 경우: 배치를 만들지 않아야 빈 배치가 남지 않는다. 테스트는 Task 6 에 있다.
5. 상자 수가 0개인 분류: 버튼을 끄고 `0장` 으로 보여 준다. 테스트는 Task 7 에 있다.

---

### Task 1: 분류 순수 함수

**Files:**
- Create: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation-classify.ts`
- Test: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation-classify.spec.ts`

**Interfaces:**
- Produces:
```ts
export type PreparationBucket =
  | 'ready' | 'partial' | 'unavailable' | 'mergeable' | 'resume' | 'needs_info';

export interface PreparationFacts {
  status: 'draft' | 'planned';
  hasActiveWorkItem: boolean;
  lines: { qty: number; confirmedQty: number }[];
  profileIds: (string | null)[];        // 라인별 SKU deliveryProfileId
  recipientComplete: boolean;
  inConsolidationGroup: boolean;
}

export function classifyPreparation(f: PreparationFacts): PreparationBucket | null; // null = 이 화면 대상 아님
export function resolvePlanProfileId(profileIds: (string | null)[]): string | null; // 하나로 정해지면 그 id
export function isSingleItem(lines: { qty: number }[]): boolean; // 라인 1개 = 단일
```

- [ ] **Step 1: 실패하는 테스트 작성**

`describe('classifyPreparation')` 에 다음 경우를 넣는다.
- 전량 예약 + 프로필 1개 + 수령인 완전 + 그룹 아님 → `'ready'`
- 같은 조건이지만 `inConsolidationGroup: true` → `'mergeable'`
- 라인 `[{qty:2,confirmedQty:2},{qty:1,confirmedQty:0}]` → `'partial'`
- 라인 `[{qty:1,confirmedQty:1},{qty:3,confirmedQty:1}]` → `'partial'`
- 모든 라인 `confirmedQty: 0` → `'unavailable'`
- 전량 예약인데 `profileIds: ['p1','p2']`, `['p1',null]`, `[null]`, 또는 `recipientComplete: false` → `'needs_info'`
- `status: 'planned'`, `hasActiveWorkItem: false` → `'resume'`
- `status: 'planned'`, `hasActiveWorkItem: true` → `null`
- `status: 'draft'`, `hasActiveWorkItem: true` → `null`

`resolvePlanProfileId`: `['p1','p1']`는 `'p1'`, `['p1','p2']`는 `null`, `['p1',null]`는 `null`, `[]`는 `null`.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation-classify.spec.ts --maxWorkers=2`
Expected: FAIL. 모듈이 없다.

- [ ] **Step 3: 구현**

판정 순서는 이렇다. 활성 work item 이면 `null`, planned 이면 `resume`, 예약 0 이면 `unavailable`, 일부 예약이면 `partial`, 프로필이나 수령인이 비면 `needs_info`, 합칠 그룹이면 `mergeable`, 나머지는 `ready`.

- [ ] **Step 4: 통과 확인** (Step 2 와 같은 명령, PASS)

- [ ] **Step 5: 사용자 승인 후 커밋**

---

### Task 2: 현황 조회 리더와 GET 라우트

**Files:**
- Create: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.ts`
- Create: `apps/core/src/modules/fulfillment/dto/outbound-preparation.dto.ts`
- Create: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.service.ts`
- Create: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.controller.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` (controller, providers 등록)
- Test: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `classifyPreparation`, `resolvePlanProfileId`, `isSingleItem`. `ConsolidationBoardReader.findBoard(warehouseId, trx)` 의 `groups[].shipments[].shipmentId` 로 `inConsolidationGroup` 을 정한다. `loadShipmentLines(trx, ids)` (`services/consolidation-shipment-reads.ts`) 로 주문번호와 수량을 얻는다.
- Produces:
```ts
// dto/outbound-preparation.dto.ts
export class PreparationShipmentDto {
  shipmentId: string; orderNos: string[]; itemSummary: string; totalQty: number;
  single: boolean; reason: string | null;           // needs_info 사유 한국어
}
export class PreparationBucketDto {
  bucket: PreparationBucket; count: number; singleCount: number; multiCount: number;
  shipments: PreparationShipmentDto[];               // 버킷마다 최대 200, createdAt 오름차순
}
export class OutboundPreparationSummaryDto {
  warehouseId: string; buckets: PreparationBucketDto[];  // 6개 버킷 모두, 0건이어도 포함
  awaitingMatchingCount: number;                         // 전 창고
}
// reader
OutboundPreparationReader.summarize(warehouseId: string, tx?: DbTx): Promise<OutboundPreparationSummaryDto>
// route
GET /outbound-preparation?warehouseId=<uuid>  @RequirePermission('fulfillment.shipment.read')
```

대상 상자: `warehouseId` 일치, `supplierId IS NULL`, `status IN ('draft','planned')`. confirmed 예약 수량은 `stock_reservations` 에서 `status='confirmed'`, `targetType='SHIPMENT_LINE'` 으로 라인별로 합친다. 쿼리는 Inventory Query Rules 를 따른다(`select().from().innerJoin().where()`, `db.query` 금지). `needs_info` 사유 문구는 `배송 프로필이 상품마다 달라요`, `배송 프로필이 없는 상품이 있어요`, `수령인 정보가 비어 있어요` 셋이다. 수령인 완전성은 기존 `assertRecipientComplete` 와 같은 판정을 쓴다. `ShipmentPlanningService` 의 private 판정을 순수 함수로 꺼내 둘이 같이 쓴다.

- [ ] **Step 1: 실패하는 통합 테스트 작성** (`describeIfDb` 가드, 스펙 안에서 `dotenv.config()` 금지)

픽스처: 한 창고에 ready 2, partial 1, unavailable 1, 같은 수령인 draft 2(mergeable), planned 활성 work item 없음 1(resume), planned 활성 work item 있음 1, 프로필 갈림 1(needs_info), 다른 창고 ready 1, `awaiting_matching` backlog 2 를 둔다.
단언:
- ready count 는 2 다.
- partial, unavailable, resume, needs_info 는 각 1 이다.
- mergeable 은 2 다.
- 다른 창고 상자와 활성 work item 상자는 어느 버킷에도 없다.
- `awaitingMatchingCount` 는 2 다.
- needs_info 의 reason 은 `배송 프로필이 상품마다 달라요` 다.

- [ ] **Step 2: 실패 확인**

Run: `dotenv -e apps/core/.env -- npx jest apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.reader.integration.spec.ts --maxWorkers=2 --runInBand`
Expected: FAIL.

- [ ] **Step 3: 리더, DTO, 서비스(`summarize` 위임), 컨트롤러, 모듈 등록 구현**

- [ ] **Step 4: 통과 확인** (Step 2 명령, PASS)

추가로 `npx jest libs/authorization --maxWorkers=2 -t route-classification` 를 돌린다. Expected: PASS.

- [ ] **Step 5: 사용자 승인 후 커밋**

---

### Task 3: 계획 확정 일괄

**Files:**
- Create: `apps/core/src/modules/fulfillment/outbound-preparation/bulk-shipment-result.ts`
- Create: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.manager.ts`
- Modify: `outbound-preparation.service.ts`, `outbound-preparation.controller.ts`, `dto/outbound-preparation.dto.ts`
- Test: `apps/core/src/modules/fulfillment/outbound-preparation/bulk-shipment-result.spec.ts`
- Test: `apps/core/src/modules/fulfillment/outbound-preparation/outbound-preparation.manager.spec.ts`

**Interfaces:**
- Consumes: `ShipmentPlanningService.plan(shipmentId, { shippingProfileId, expectedManifestVersion, expectedReservationVersion }, idempotencyKey, actor)`. Task 1 `resolvePlanProfileId`.
- Produces:
```ts
// bulk-shipment-result.ts
export interface BulkShipmentFailure { shipmentId: string; code: string; message: string; transient: boolean }
export interface BulkShipmentResult { succeeded: string[]; failed: BulkShipmentFailure[] }
export function isTransientError(e: unknown): boolean;
export async function runPerShipment(
  shipmentIds: string[],
  run: (shipmentId: string) => Promise<'done' | 'already'>,
): Promise<BulkShipmentResult>;  // 순차 실행, 'done'/'already' 모두 succeeded
// dto
export class BulkShipmentIdsDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('4',{each:true}) shipmentIds: string[] }
// manager
OutboundPreparationManager.planMany(shipmentIds: string[], idempotencyKey: string, actor: ShipmentPlanningActor): Promise<BulkShipmentResult>
// route
POST /outbound-preparation/plans  body BulkShipmentIdsDto, header Idempotency-Key  @RequirePermission('fulfillment.warehouse.operate')
```

`isTransientError` 규칙: Nest `HttpException` 의 status 가 400~499 이면 `false`, 단 `FULFILLMENT_COMMAND_IN_PROGRESS` 코드는 `true` 다. 그 밖(5xx, 일반 `Error`, DB 오류)은 `true` 다. `code` 는 응답 객체의 `code` 를 쓰고 없으면 `'UNKNOWN'` 이다. `message` 는 코드별 한국어 문구다. 아래 문구를 쓰고 표에 없는 코드는 `처리하지 못했어요` 로 둔다.

| code | message |
|---|---|
| `SHIPMENT_NOT_DRAFT` | 상자 상태가 바뀌었어요 |
| `SHIPMENT_NOT_FULLY_RESERVED` | 재고 예약이 모자라요 |
| `SHIPMENT_PROFILE_INCOMPATIBLE` | 배송 프로필을 정할 수 없어요 |
| `SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE` | 배송 프로필 설정이 비어 있어요 |
| `SHIPMENT_ACTIVE_WORK_ITEM` | 이미 다른 배치에 들어 있어요 |

`planMany` 는 상자마다 다음을 한다. 상자를 읽어 `planned` 이면 `'already'` 를 낸다. 아니면 SKU 프로필로 `resolvePlanProfileId` 를 부른다. `null` 이면 `ConflictException({code:'SHIPMENT_PROFILE_INCOMPATIBLE'})` 를 던진다. 그 뒤 현재 `manifestVersion`, `reservationVersion` 을 넣어 `plan` 을 부르고 `'done'` 을 낸다.

- [ ] **Step 1: 실패하는 테스트 작성**

`bulk-shipment-result.spec.ts`:
- `runPerShipment(['a','b','c'])` 에서 b 가 `ConflictException({code:'SHIPMENT_NOT_DRAFT'})` 를 던지면 `succeeded` 는 `['a','c']`, `failed` 는 `[{shipmentId:'b',code:'SHIPMENT_NOT_DRAFT',message:'상자 상태가 바뀌었어요',transient:false}]` 다.
- 일반 `Error('boom')` 은 `transient: true`, `code: 'UNKNOWN'` 이다.
- `ConflictException({code:'FULFILLMENT_COMMAND_IN_PROGRESS'})` 는 `transient: true` 다.

`outbound-preparation.manager.spec.ts` (`plan` 과 리더를 가짜로 주입):
- planned 상자는 `plan` 을 부르지 않고 succeeded 로 나온다.
- draft 상자는 `plan` 이 `{shippingProfileId:'p1', expectedManifestVersion:3, expectedReservationVersion:7}` 과 키 `'k:s1'` 로 불린다.
- 프로필이 갈리는 상자는 `plan` 을 부르지 않고 `SHIPMENT_PROFILE_INCOMPATIBLE`, `transient:false` 로 실패한다.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/outbound-preparation --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: 구현** (`bulk-shipment-result.ts`, manager, service 위임, 라우트, DTO)

- [ ] **Step 4: 통과 확인** (Step 2 명령, PASS)

- [ ] **Step 5: 사용자 승인 후 커밋**

---

### Task 4: 배치 담기 일괄과 부분출고 나누기 일괄

**Files:**
- Modify: `outbound-preparation.manager.ts`, `outbound-preparation.service.ts`, `outbound-preparation.controller.ts`, `dto/outbound-preparation.dto.ts`
- Test: `outbound-preparation.manager.spec.ts` (케이스 추가)

**Interfaces:**
- Consumes: Task 3 `runPerShipment`, `BulkShipmentIdsDto`. `OutboundBatchOrchestrator.addShipment(batchId, shipmentId, idempotencyKey, actor)`. `ShipmentPlanningService.splitUnreserved(shipmentId, { reason, expectedManifestVersion }, idempotencyKey, actor)`.
- Produces:
```ts
OutboundPreparationManager.addManyToBatch(batchId: string, shipmentIds: string[], idempotencyKey: string, actor): Promise<BulkShipmentResult>
OutboundPreparationManager.splitManyUnreserved(shipmentIds: string[], idempotencyKey: string, actor): Promise<BulkShipmentResult>
POST /outbound-preparation/batches/:batchId/shipments  body BulkShipmentIdsDto
POST /outbound-preparation/unreserved-splits           body BulkShipmentIdsDto
```

`addManyToBatch` 는 상자마다 이 배치에 활성 work item(`ACTIVE_WORK_ITEM_STATUSES`, `withdrawing` 제외)이 이미 있는지 본다. 있으면 `'already'` 다. 없으면 `addShipment` 를 부른다. `splitManyUnreserved` 는 `reason: '출고 준비: 있는 것만 먼저 보내기'` 와 현재 `manifestVersion` 을 넣어 부른다.

- [ ] **Step 1: 실패하는 테스트 추가**
  - 이미 이 배치에 있는 상자는 `addShipment` 를 부르지 않고 succeeded 로 나온다.
  - 다른 상자는 키 `'k:s2'` 로 `addShipment` 가 불린다.
  - `addShipment` 가 `ConflictException({code:'SHIPMENT_ACTIVE_WORK_ITEM'})` 이면 `transient:false` 이고 message 는 `이미 다른 배치에 들어 있어요` 다.
  - `splitManyUnreserved` 는 위 reason 과 현재 manifestVersion 으로 부른다.
- [ ] **Step 2: 실패 확인** (`npx jest apps/core/src/modules/fulfillment/outbound-preparation --maxWorkers=2`, FAIL)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**

  route-classification 스펙도 다시 돌린다(Task 2 Step 4 명령). Expected: PASS.
- [ ] **Step 5: 사용자 승인 후 커밋**

---

### Task 5: 어드민 API 클라이언트와 훅

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/orders/outbound-preparation.client.ts`
- Modify: `apps/admin-web/src/lib/services/orders/queries.ts`, `mutations.ts`, `index.ts`
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` (응답 타입)
- Test: `apps/admin-web/src/lib/api/domains/orders/outbound-preparation.client.spec.ts`

**Interfaces:**
- Consumes: Task 2~4 라우트. 기존 `createIdempotentCommand`, `waybills.client` 의 `batch`, `outbound-batches.client` 의 `createV2`.
- Produces:
```ts
outboundPreparationClient.summary(warehouseId: string): Promise<OutboundPreparationSummary>
outboundPreparationClient.planMany(cmd: IdempotentCommand<{ shipmentIds: string[] }>): Promise<BulkShipmentResult>
outboundPreparationClient.addManyToBatch(batchId: string, cmd: IdempotentCommand<{ shipmentIds: string[] }>): Promise<BulkShipmentResult>
outboundPreparationClient.splitManyUnreserved(cmd: IdempotentCommand<{ shipmentIds: string[] }>): Promise<BulkShipmentResult>
useOutboundPreparationSummary(warehouseId: string)            // query key ['outbound-preparation', warehouseId]
useSplitUnreservedMany()  ; useSplitUnreservedMany.permission = ['fulfillment.warehouse.operate']
useRunOutboundPreparation(); useRunOutboundPreparation.permission = ['fulfillment.warehouse.operate']  // Task 6 러너를 감싼다
```

- [ ] **Step 1: 실패하는 테스트 작성**
  - 각 메서드가 `/core/outbound-preparation...` 경로와 `Idempotency-Key` 헤더로 부르는지 확인한다(`waybills.client.spec.ts` 와 같은 방식).
- [ ] **Step 2: 실패 확인** (`npm run test:admin-web -- outbound-preparation.client`, FAIL)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**

  추가로 `npm run test:admin-web -- mutation-guard.gate medusa-coverage` 를 돌린다. Expected: PASS.
- [ ] **Step 5: 사용자 승인 후 커밋**

---

### Task 6: 출고 준비 러너 (순수 함수)

**Files:**
- Create: `apps/admin-web/src/features/order/outbound-preparation/run-outbound-preparation.ts`
- Test: `apps/admin-web/src/features/order/outbound-preparation/run-outbound-preparation.spec.ts`

**Interfaces:**
- Consumes: Task 5 클라이언트 함수(의존성으로 주입).
- Produces:
```ts
export const RETRY_DELAYS_MS = [2000, 5000, 10000] as const;
export type PreparationStage = 'plan' | 'waybill' | 'batch' | 'join';
export interface PreparationFailure { shipmentId: string; stage: PreparationStage; message: string }
export interface PreparationProgress {
  stage: PreparationStage; retrying: boolean;
  planned: number; waybilled: number; joined: number; total: number;
  batchId: string | null; batchName: string | null; failures: PreparationFailure[];
}
export interface PreparationDeps {
  planMany(ids: string[], key: string): Promise<BulkShipmentResult>;
  issueWaybills(ids: string[], key: string): Promise<BatchResultItem[]>;   // carrier 'HANJIN'
  createBatch(input: { warehouseId: string; pickingMethod: PickingMethod; cartCapacity?: number; name: string }): Promise<{ id: string }>;
  addManyToBatch(batchId: string, ids: string[], key: string): Promise<BulkShipmentResult>;
  sleep(ms: number): Promise<void>;
  newKey(): string;
}
export interface PreparationInput {
  warehouseId: string; shipmentIds: string[]; pickingMethod: PickingMethod; cartCapacity?: number;
  existingBatchId?: string;   // 다시 시도 때 같은 배치에 담는다
  now: Date;
}
export async function runOutboundPreparation(
  deps: PreparationDeps, input: PreparationInput, onProgress: (p: PreparationProgress) => void,
): Promise<PreparationProgress>;
export function batchNameFor(now: Date, pickingMethod: PickingMethod): string; // 'MM/DD 토탈피킹 HH:mm', 개별피킹, 멀티오더
```

단계마다 규칙은 같다. 단계별로 키를 하나 만들고 재시도할 때도 그 키를 다시 쓴다. 이 단계의 남은 상자로 부른 뒤 `transient: true` 실패, 네트워크나 5xx 예외, 송장의 `pending` 결과는 다시 부를 대상으로 남긴다. `RETRY_DELAYS_MS` 순서로 기다리며 최대 3회 다시 부른다. 송장의 `reason: 'time-budget-exceeded'` 는 기다리지 않고 바로 다시 부르고 재시도 횟수에 세지 않는다. 남은 실패는 `failures` 에 넣고, 그 상자는 다음 단계로 넘기지 않는다. 송장이 `registered | used` 인 상자가 0개이면 배치를 만들지 않는다. `existingBatchId` 가 있으면 배치를 만들지 않고 그 배치에 담는다.

- [ ] **Step 1: 실패하는 테스트 작성** (가짜 deps, `sleep` 은 호출 기록만 남김)
  - 성공 경로: 3건 → `planned 3, waybilled 3, joined 3`, `createBatch` 1회, 이름 `11/05 토탈피킹 09:30` (now = 2026-11-05T09:30 KST 를 UTC 로 넣고 `Asia/Seoul` 로 포맷)
  - 계획에서 1건 `transient:false` → 그 상자는 송장에 넘기지 않음, `failures[0].stage === 'plan'`
  - 계획에서 1건 `transient:true` 가 두 번 나온 뒤 성공 → `sleep` 호출이 `[2000, 5000]`, 두 번 모두 같은 키
  - 송장 `time-budget-exceeded` 1건 → `sleep` 없이 같은 키로 그 1건만 재호출
  - 송장 전부 `failed` → `createBatch` 호출 없음, `batchId === null`
  - `existingBatchId: 'b1'` → `createBatch` 없이 `addManyToBatch('b1', …)`
  - 4번째 transient 실패 → 재시도 3회 후 `failures` 에 남음
- [ ] **Step 2: 실패 확인** (`npm run test:admin-web -- run-outbound-preparation`, FAIL)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 사용자 승인 후 커밋**

---

### Task 7: 출고 준비 화면

**Files:**
- Create: `apps/admin-web/src/features/order/outbound-preparation/template/OutboundPreparationTemplate.tsx`
- Create: `apps/admin-web/src/features/order/outbound-preparation/components/bucket-table.tsx`
- Create: `apps/admin-web/src/features/order/outbound-preparation/components/bucket-list.tsx`
- Create: `apps/admin-web/src/features/order/outbound-preparation/components/prepare-dialog.tsx`
- Modify: `apps/admin-web/src/app/(admin)/order/waybill-issue/page.tsx` (새 템플릿 렌더)
- Modify: `apps/admin-web/src/lib/utils/menu.ts:224` (메뉴 이름 `출고 준비`)
- Modify: `apps/admin-web/src/lib/auth/screen-access.ts:77` (`any('fulfillment.order.read')` 유지, 확인만)
- Delete: `features/order/waybill-issue/template/WaybillIssueTemplate.tsx`, `WaybillIssueTemplate.render.spec.tsx`, `merge-warning.tsx`, `merge-warning.render.spec.tsx`, 그리고 `waybill-issue-model.ts` 에서 쓰이지 않게 된 export 와 해당 테스트
- Test: `apps/admin-web/src/features/order/outbound-preparation/template/OutboundPreparationTemplate.render.spec.tsx`

**Interfaces:**
- Consumes: Task 5 훅, Task 6 `runOutboundPreparation`, `RETRY_DELAYS_MS`. 기존 `ConsolidationSheet`(합치기), `useWarehouses`, `defaultWarehouseId`, `Can`.

화면 규칙(spec §3, 시안 `outbound-prep-story-v2`):
- 상단에 창고 선택과 피킹 방식 선택(기본 토탈피킹, 멀티오더면 카트 용량 입력)을 둔다.
- 분류표 줄 순서는 완전출고, 부분출고, 출고불가, 미매칭, 합칠 주문 있음, 이어서 처리, 정보 부족이다. 줄마다 `N장`, 완전출고는 `단일 a / 합포 b` 를 보여 준다.
- [내역보기]를 누르면 표 아래에 목록이 열린다. 처음엔 전부 체크돼 있다. 100건을 넘으면 앞 100건만 체크하고 `한 번에 100건까지 처리해요` 를 보여 준다.
- [출고 준비]: 확인 창 문구는 `완전출고 N건을 출고 준비할까요?` / `계획 확정 → 한진 송장 발급 → 배치 생성까지 한 번에 해요.` 다. 이어서 처리 줄에서는 같은 버튼 문구가 `이어서 출고 준비` 다.
- 진행 창 줄: `계획 확정 a / n`, `송장 발급 b / n`, `배치 "<이름>" 생성, c건 담음`. 재시도 중에는 `재시도 중이에요` 를 보여 준다. 실패 줄은 주문번호, 사유, [다시 시도]다. [다시 시도]는 그 상자만 `existingBatchId` 로 러너를 다시 부른다. 끝나면 [배치로 가기]로 `/order/outbound-batches?batchId=<id>` 에 간다.
- 부분출고 [있는 것만 먼저 보내기]: 체크한 상자로 `useSplitUnreservedMany` 를 부르고 결과를 토스트로 알린다(`n건을 나눴어요`, 실패 있으면 `m건은 나누지 못했어요`).
- 합칠 주문 있음: 줄마다 [합치기]가 기존 `ConsolidationSheet` 를 연다.
- 미매칭: [매칭하러 가기]로 기존 매칭 화면에 간다.
- 0건 줄은 버튼을 끈다.
- 쓰기 버튼은 `Can run={useRunOutboundPreparation}`, `Can run={useSplitUnreservedMany}` 로 감싼다.

- [ ] **Step 1: 실패하는 렌더 테스트 작성**
  - 요약 픽스처(ready 35 단일 7 합포 28, partial 33, 미매칭 12, 합칠 주문 4, resume 3, needs_info 2, unavailable 0)에서 `35장`, `단일 7 / 합포 28` 이 보인다.
  - 출고불가 줄의 [내역보기]는 꺼져 있다.
  - [출고 준비]를 누르면 확인 창에 `완전출고 35건을 출고 준비할까요?` 가 나온다.
  - [시작]을 누르면 가짜 러너가 받은 `shipmentIds` 가 35개이고 `pickingMethod === 'total_picking'` 이다.
  - 러너가 실패 1건을 돌려주면 [다시 시도]가 보인다. 누르면 그 상자 하나와 `existingBatchId` 로 다시 부른다.
  - 권한이 없으면 [출고 준비]가 보이지 않는다.
- [ ] **Step 2: 실패 확인** (`npm run test:admin-web -- OutboundPreparationTemplate`, FAIL)
- [ ] **Step 3: 구현, 옛 템플릿 삭제, 메뉴 이름 변경**
- [ ] **Step 4: 통과 확인**

  추가로 `npm run test:admin-web -- screen-access.gate pii-screens.gate mutation-guard.gate` 를 돌린다. Expected: PASS.
- [ ] **Step 5: 사용자 승인 후 커밋**

---

### Task 8: 전체 게이트와 로컬 확인

- [ ] **Step 1:** `npm run type-check`. Expected: 에러 0.
- [ ] **Step 2:** `npx jest --maxWorkers=2`. Expected: 실패 0.
- [ ] **Step 3:** `npm run test:admin-web`. Expected: 실패 0.
- [ ] **Step 4:** 로컬에서 core 와 admin-web 을 띄워 확인한다(`npm run start:main:dev`, `npm run start:admin-web:dev`). 출고 준비 화면에서 데모 상자로 출고 준비를 실행한다. 송장은 로컬 demo gateway 로 발급된다. 배치가 생기고 상자가 담기는지 본다. 결과는 사용자에게 보고한다.
- [ ] **Step 5:** 배포 메모를 PR 본문 초안에 남긴다. 대상은 Core 와 AdminWeb 이고 마이그레이션은 없다. Core 를 먼저 배포한다.
