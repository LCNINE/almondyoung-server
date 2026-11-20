# 비상 출고 경로 (#1249) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 창고 앱 출고 경로가 막힌 날, 운영자 본인 토큰으로 core 라우트를 불러 아침에 송장·ZPL 라벨·피킹 리스트를 뽑고(`prepare`) 저녁에 나간 상자만 발송 처리(`dispatch`)하는 스크립트.

**Architecture:** `scripts/ops/emergency-outbound/` 의 tsx 스크립트. core 를 HTTP 로만 부른다(DB 직접 접근 없음 — 로컬 확인 스크립트만 예외). 오케스트레이션은 `CoreApi` 인터페이스에 대해 짜고, 유닛 테스트는 메모리 가짜 `CoreApi` 로 돈다. 실행 상태는 실행 폴더의 `run.json` 에 남겨 같은 `--run` 으로 이어 돈다.

**Tech Stack:** TypeScript · `npx tsx` · Node `fetch` · Jest(루트 설정, `scripts/` 가 roots 에 있다).

**Spec:** `docs/superpowers/specs/2026-11-18-emergency-outbound-1249-design.md` — 실행자는 이 계획과 함께 반드시 읽는다.

## Global Constraints

- core 는 전역 prefix 가 없다 — 경로는 `${coreUrl}/outbound-preparation` 꼴. 성공 본문은 감싸지 않은 반환값, 오류 본문은 `{ success:false, code, message, errors?, details?, requiredPermissions? }`.
- 모든 쓰기 요청에 `Idempotency-Key` — 33~126 범위 ASCII, 200자 이하. 꼴: `emergency:<run>:<단계>:<대상 id>`.
- 토큰은 **요청마다** `session.token()` 을 불러 받는다(15분 토큰, `operatorSession` 이 10분 캐시). 토큰·secret·비밀번호를 파일·로그·예외 메시지에 쓰지 않는다.
- 기본은 dry-run. `--apply` 없이는 쓰기 라우트를 하나도 부르지 않는다.
- 강제 발송 사유 고정: `앱 출고 경로 장애 — 비상 출고`.
- 낱개 피킹 방식 값은 `individual`(전략 `discrete`).
- 벌크 라우트는 한 번에 shipmentIds 100개까지 — 100개씩 나눠 부른다.
- 출력 폴더: `<cwd>/.scratch/emergency-outbound/<run>/`. run id 기본값은 KST `YYYYMMDD-HHmm`.
- 공개 레포 — 테넌트 값·도메인·실 송장번호를 코드·문서·픽스처에 쓰지 않는다(픽스처는 `acme`·가짜 번호).
- 전체 `npx jest --maxWorkers=2` 와 `npm run type-check` 는 PR 직전에 한 번만(Task 9). 그 전엔 이 폴더만 돌린다: `npx jest scripts/ops/emergency-outbound`. E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다(RAM).

## Review Focus

1. **같은 `--run` 재실행(중간에 죽음)** — 배치를 두 번 만들지 않고 `run.json` 의 batchId 로 이어 간다. → Task 4 `resumes without creating a second batch`.
2. **아침과 저녁 사이 상자가 바뀜(취소·되돌림)** — `dispatch` 가 그 상자만 거절로 보고하고 나머지를 계속한다. → Task 6 `reports a 409 and continues`.
3. **작업자가 엑셀로 연 CSV**(BOM·CRLF·따옴표·빈 줄·열 순서 그대로) — 그대로 읽힌다. → Task 5 `parses an Excel-saved csv`.
4. **대상 0개** — 배치를 만들지 않고(빈 배치 시작은 `PICKING_BATCH_EMPTY`) «대상 0»으로 끝난다. → Task 4 `does nothing when nothing is selectable`.
5. **다른 운영자가 같은 run 을 이어 돎** — 멱등 해시 불일치(`FULFILLMENT_IDEMPOTENCY_MISMATCH`)를 «같은 사람만 이어 돌 수 있다 — 새 --run 으로»로 바꿔 알린다. → Task 4 `explains an idempotency mismatch`.

---

### Task 1: core HTTP 클라이언트

**Files:**
- Create: `scripts/ops/emergency-outbound/core-api.ts`
- Test: `scripts/ops/emergency-outbound/core-api.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export class CoreApiError extends Error { status: number; code: string; body: unknown }
  export interface CoreApi {
    preparation(warehouseId: string, bucket: 'ready' | 'resume', offset: number): Promise<PreparationSummary>;
    plan(ids: string[], key: string): Promise<BulkShipmentResult>;
    issueWaybills(ids: string[], key: string): Promise<PreparationWaybillResult[]>;
    createBatch(warehouseId: string, name: string, key: string): Promise<{ batchId: string }>; // pickingMethod 'individual' 고정
    addToBatch(batchId: string, ids: string[], key: string): Promise<BulkShipmentResult>;
    excludeFromBatch(batchId: string, shipmentId: string, reason: string, key: string): Promise<void>; // voidWaybill 은 보내지 않는다(송장 유지)
    startBatch(batchId: string, key: string): Promise<BatchStartResult>; // BATCH_START_BLOCKED 는 CoreApiError(code, body.errors: StartBlockerView[])
    batches(warehouseId: string, status: 'created' | 'picking'): Promise<BatchListItem[]>;
    workItems(batchId: string): Promise<WorkItem[]>;
    shipment(id: string): Promise<ShipmentDetail>;
    activeWaybill(shipmentId: string): Promise<WaybillView | null>;
    label(shipmentId: string): Promise<{ trackingNo: string; data: string; pages: number; fingerprint: string }>;
    confirmLabelPrint(shipmentId: string, fingerprint: string): Promise<void>;
    locationState(shipmentId: string, warehouseId: string): Promise<LocationOutboundState>;
    locationForce(shipmentId: string, warehouseId: string, reason: string, items: ForceItem[], key: string): Promise<LocationOutboundState>;
    forceDispatch(shipmentId: string, reason: string, key: string): Promise<{ status: string; dispatchAttemptId: string | null }>;
    warehouse(id: string): Promise<{ id: string; name: string; supportedPickingStrategies: string[] }>;
  }
  export function httpCoreApi(coreUrl: string, token: () => Promise<string>): CoreApi;
  ```
  타입(`PreparationSummary`·`BulkShipmentResult`·`StartBlockerView`·`WorkItem`·`ShipmentDetail`·`LocationOutboundState` 등)은 이 파일에 core DTO 그대로의 필드로 선언한다 — 출처: `apps/core/src/modules/fulfillment/outbound-preparation/`, `dto/outbound-batch-v2.dto.ts`, `picking/allocation/allocation.types.ts`·`allocation.errors.ts`, `waybill/waybill-label.manager.ts`, `dto/location-outbound.dto.ts`, `dto/shipment-planning.dto.ts:363`. core 소스를 import 하지 않는다(스크립트가 Nest 데코레이터를 끌어오지 않게).
- 라우트: `GET outbound-preparation?warehouseId&bucket&offset` · `POST outbound-preparation/plans|waybills` · `POST outbound-batches/v2` · `POST outbound-preparation/batches/:batchId/shipments` · `DELETE outbound-batches/:batchId/shipments/:shipmentId` · `POST picking/v2/starts` · `GET outbound-batches/v2?warehouseId&status` · `GET outbound-batches/:batchId/work-items` · `GET shipments/:id` · `GET shipments/:id/waybill` · `GET shipments/:id/waybill/label` · `POST shipments/:id/waybill/label-prints` · `GET shipments/:id/location-outbound-state?warehouseId` · `POST shipments/:id/location-outbound-forces` · `POST shipments/:id/force-dispatch` · `GET inventory/warehouses/:id`.

- [ ] **Step 1: 실패하는 테스트** — `node:http` 로 띄운 가짜 서버에 대해:
  - `sends bearer and idempotency key`: `plan(['a'], 'emergency:r:plan:a')` → 서버가 받은 `authorization === 'Bearer t1'`, `idempotency-key === 'emergency:r:plan:a'`, 본문 `{ shipmentIds: ['a'] }`.
  - `asks for a token on every request`: 두 번 부르면 `token` 이 두 번 불린다.
  - `throws CoreApiError with the core code`: 서버가 409 `{ success:false, code:'BATCH_START_BLOCKED', errors:[{shipmentId:'s1', reason:'STOCK_SHORT'}] }` → `startBatch` 가 `CoreApiError` 를 던지고 `code === 'BATCH_START_BLOCKED'`, `(body as any).errors[0].shipmentId === 's1'`.
  - `returns null for no active waybill`: 빈 본문 200 → `activeWaybill` 이 `null`.
  - `never puts the token in an error message`: 500 응답의 `CoreApiError.message` 에 `t1` 이 없다.
- [ ] **Step 2:** `npx jest scripts/ops/emergency-outbound/core-api` → FAIL(모듈 없음).
- [ ] **Step 3:** `httpCoreApi` 구현. `excludeFromBatch` 본문 `{ reason }`, `createBatch` 본문 `{ warehouseId, pickingMethod: 'individual', name }`, `locationForce` 본문 `{ warehouseId, reason, items }`.
- [ ] **Step 4:** 같은 명령 → PASS.
- [ ] **Step 5:** 커밋 `[scripts] #1249 비상 출고 — core HTTP 클라이언트`.

### Task 2: 세션과 사전 확인

**Files:**
- Create: `scripts/ops/emergency-outbound/session.ts`, `scripts/ops/emergency-outbound/preflight.ts`
- Test: `scripts/ops/emergency-outbound/preflight.spec.ts`

**Interfaces:**
- Consumes: `operatorSession(stage)`(`scripts/tenancy/operator-session.ts`), `signInStaff`·`StaffClient`(`scripts/tenancy/staff-token.ts`), `stageServiceUrl`(`scripts/tenancy/isolation-check/live-config.ts`), `readEnvFile`·`REPO`(`scripts/local/create-tenant/local-ports.ts`), `CoreApi.warehouse`.
- Produces:
  ```ts
  export interface EmergencySession { coreUrl: string; usersUrl: string; token: () => Promise<string> }
  export function openSession(stage: 'local' | 'live'): Promise<EmergencySession>;
  export const REQUIRED_PERMISSIONS = ['fulfillment.shipment.read', 'fulfillment.warehouse.operate', 'fulfillment.dispatch.force'] as const;
  export function preflightProblems(input: { permissions: string[]; supportedPickingStrategies: string[] }): string[]; // 한국어 문장, 빈 배열 = 통과
  export function myPermissions(session: EmergencySession): Promise<string[]>; // GET ${usersUrl}/me/permissions → .permissions
  ```
- live: `operatorSession('live')` 의 `users`·`token`, `coreUrl = stageServiceUrl('live', 'core')`.
- local: user-service `apps/user-service/.env` 의 `OAUTH_INTERNAL_SECRET`, admin-web `.env.local` 의 `OIDC_CLIENT_ID`(없으면 `admin-web`)·`OIDC_CLIENT_SECRET`, 포트는 `scripts/local/e2e-env-map.sh` 의 표와 같게(core 3100, user-service 는 그 표의 값), `redirectUri` 는 `scripts/local/isolation-check/index.ts` 가 테넌트 1 에 쓰는 값과 같게. 아이디·비밀번호는 `operatorSession` 처럼 화면에 안 보이게 받는다 — 프롬프트 함수는 `operator-session.ts` 에서 export 해 재사용한다(복제 금지).

- [ ] **Step 1: 실패하는 테스트** (`preflightProblems` 만 — 세션은 Task 8 에서 실측):
  - `passes with all permissions and discrete`: `{ permissions: [...REQUIRED_PERMISSIONS], supportedPickingStrategies: ['discrete'] }` → `[]`.
  - `names each missing permission`: `fulfillment.dispatch.force` 빠짐 → 문장 1개, 그 키를 포함.
  - `refuses a warehouse without discrete`: `['aggregate_then_sort']` → 문장에 `낱개 피킹` 포함.
- [ ] **Step 2:** `npx jest scripts/ops/emergency-outbound/preflight` → FAIL.
- [ ] **Step 3:** `preflight.ts`·`session.ts` 구현. `operator-session.ts` 에서 `ask` 를 export(동작 변경 없음).
- [ ] **Step 4:** PASS. `npx jest scripts/tenancy` 도 돌려 `operator-session` 변경이 아무것도 안 깼는지 본다.
- [ ] **Step 5:** 커밋 `[scripts] #1249 비상 출고 — 운영자 세션과 사전 확인`.

### Task 3: 대상 고르기(순수 함수)

**Files:**
- Create: `scripts/ops/emergency-outbound/select.ts`
- Test: `scripts/ops/emergency-outbound/select.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Route = 'location' | 'force';
  export type Target =
    | { shipmentId: string; from: 'draft' }                         // ready 버킷 → 계획 확정부터
    | { shipmentId: string; from: 'planned' }                       // resume 버킷 → 송장부터
    | { shipmentId: string; from: 'batch'; batchId: string; route: Route }; // 이미 배치 안
  export interface Skipped { shipmentId: string; reason: string; orderNos?: string[] }
  export function selectTargets(input: {
    ready: PreparationShipment[]; resume: PreparationShipment[];
    otherBuckets: { bucket: string; shipments: PreparationShipment[] }[]; // partial·unavailable·mergeable·needs_info
    batches: { batch: BatchListItem; workItems: WorkItem[] }[];
  }): { targets: Target[]; skipped: Skipped[] };
  ```
- 규칙(스펙 «① 2»): 시작된(`startedAt != null`) `individual` 배치의 `queued`·`picking` → `route:'location'`. 어느 배치든 `ready_to_pack`·`packing` → `route:'force'`. 다른 방식 배치의 `queued`·`picking` → skipped(`다른 피킹 방식 배치에서 피킹 중`). 시작 전 `individual` 배치의 `queued` → skipped(`시작 전 배치 — 앱/화면에서 시작하거나 배치에서 뺀 뒤 다시`). `completed`·`excluded`·`withdrawing`·`short_pick_recovery` → 무시(`withdrawing`·`short_pick_recovery` 는 skipped 로 보고). 버킷 `mergeable` → skipped(`합칠 수 있는 상자 — 비상 경로에서 뺌`), 나머지 버킷은 버킷 이름과 `reason` 을 사유로.

- [ ] **Step 1: 실패하는 테스트** — 위 규칙마다 한 케이스(`ready→draft`, `resume→planned`, `started individual picking→location`, `packing in total_picking→force`, `queued in total_picking→skipped`, `queued in not-started individual→skipped`, `mergeable→skipped with 합칠 수 있는`, `completed ignored`), 그리고 `a shipment never appears twice`(같은 id 가 두 곳에 나오면 배치 쪽이 이긴다).
- [ ] **Step 2:** `npx jest scripts/ops/emergency-outbound/select` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `[scripts] #1249 비상 출고 — 대상 고르기`.

### Task 4: `prepare` 오케스트레이션

**Files:**
- Create: `scripts/ops/emergency-outbound/prepare.ts`, `scripts/ops/emergency-outbound/run-state.ts`, `scripts/ops/emergency-outbound/__support__/fake-core.ts`
- Test: `scripts/ops/emergency-outbound/prepare.spec.ts`

**Interfaces:**
- Consumes: `CoreApi`, `selectTargets`, `Target`.
- Produces:
  ```ts
  export interface RunState { run: string; warehouseId: string; batchId: string | null; boxes: RunBox[]; excluded: Skipped[] }
  export interface RunBox { shipmentId: string; route: Route; batchId: string; trackingNo: string | null; printed: boolean }
  export function readRun(dir: string): RunState | null; export function writeRun(dir: string, s: RunState): void;
  export interface PrepareReport { targets: Target[]; skipped: Skipped[]; state: RunState | null } // dry-run 은 state null
  export function runPrepare(api: CoreApi, opts: { warehouseId: string; run: string; dir: string; apply: boolean; log: (line: string) => void }): Promise<PrepareReport>;
  export function idemKey(run: string, step: string, id: string): string; // `emergency:${run}:${step}:${id}`
  ```
- `FakeCore implements CoreApi` — 메모리 상자·배치·송장 상태를 들고, 테스트가 막힘(`STOCK_SHORT`)·실패 코드·호출 기록을 심을 수 있다. Task 6 도 쓴다.
- `--apply` 순서(스펙 «① 4»): `plan`(draft 만) → `issueWaybills`(draft+planned) → `createBatch`(state 에 batchId 없을 때만, 이름 `비상 출고 <run>`) → `addToBatch` → `startBatch` → (`BATCH_START_BLOCKED` 면 `errors[].shipmentId` 마다 `excludeFromBatch(reason: '비상 출고 — 시작 막힘: <reason>')` 후 다시 `startBatch`, 최대 3회) → 상태 기록. 각 단계 뒤 `writeRun`. 단계 실패(`failed[]`·송장 `status !== 'registered'`)인 상자는 다음 단계에서 빼고 `excluded` 에 사유와 함께 넣는다. `batch` 출신 대상은 앞 단계를 건너뛰고 그 batchId 로 바로 `boxes` 에 든다.
- 라벨은 Task 5 가 붙인다 — 여기선 `trackingNo` 를 `activeWaybill` 로 채우기까지.

- [ ] **Step 1: 실패하는 테스트**:
  - `dry-run calls no write route`: FakeCore 의 쓰기 호출 기록이 0.
  - `runs plan → waybills → batch → add → start in order`: 호출 순서 배열이 정확히 `['plan','issueWaybills','createBatch','addToBatch','startBatch']`.
  - `drops a box whose waybill failed`: 송장 결과 `{status:'failed', code:'SHIPMENT_PROFILE_INCOMPATIBLE'}` 인 상자가 `addToBatch` 에 안 들어가고 `excluded` 에 그 코드로 있다.
  - `excludes start blockers and restarts`: 첫 `startBatch` 가 `s2` STOCK_SHORT 로 막힘 → `excludeFromBatch('b', 's2', …)` 후 두 번째 `startBatch` 성공, `boxes` 에 s2 없음.
  - `resumes without creating a second batch`: `run.json` 에 batchId 가 있으면 같은 run 재실행에서 `createBatch` 0회, 같은 멱등 키 재사용.
  - `chunks shipment ids by 100`: 대상 250개 → `plan` 호출 3회(100·100·50).
  - `does nothing when nothing is selectable`: 대상 0 → 쓰기 0, 로그에 `대상 0`.
  - `explains an idempotency mismatch`: `CoreApiError(code:'FULFILLMENT_IDEMPOTENCY_MISMATCH')` → 던진 오류 메시지에 `같은 사람만` 과 `새 --run`.
- [ ] **Step 2:** `npx jest scripts/ops/emergency-outbound/prepare` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `[scripts] #1249 비상 출고 — prepare 오케스트레이션`.

### Task 5: 산출물 — 라벨·피킹 리스트·CSV

**Files:**
- Create: `scripts/ops/emergency-outbound/outputs.ts`
- Modify: `scripts/ops/emergency-outbound/prepare.ts` (apply 끝에 산출물 단계)
- Test: `scripts/ops/emergency-outbound/outputs.spec.ts`, `prepare.spec.ts`(추가)

**Interfaces:**
- Produces:
  ```ts
  export interface PickBox { shipmentId: string; orderNos: string[]; trackingNo: string; route: Route; recipientName: string;
    lines: { skuName: string; qty: number }[]; sources: { locationCode: string; skuName: string; qty: number }[] }
  export function sortForPicking(boxes: PickBox[]): PickBox[];  // 첫 source locationCode 오름차순, force 상자는 맨 뒤
  export function renderPickList(run: string, boxes: PickBox[]): string; // A4 HTML, 모든 값 HTML 이스케이프
  export const CSV_HEADER = ['shipmentId', 'orderNo', 'trackingNo', 'route', 'batchId'] as const;
  export interface CsvRow { shipmentId: string; orderNo: string; trackingNo: string; route: Route; batchId: string } // orderNo 는 orderNos 를 ' / ' 로 이은 값
  export function toCsv(rows: CsvRow[]): string;                // UTF-8 BOM + CRLF, 엑셀에서 바로 열림
  export function parseCsv(text: string): CsvRow[];             // BOM·CRLF·따옴표·빈 줄 허용, 헤더 이름으로 열을 찾음
  ```
- prepare 산출물 단계: 시작 성공 뒤 `boxes` 를 `sortForPicking` 순서로 돌며 `label` → `data` 를 이어 붙여 `labels.zpl`, 곧바로 `confirmLabelPrint(fingerprint)`(`LABEL_CONTENT_CHANGED` 면 `label` 다시 받아 1회 재시도) → `printed:true`. PickBox 는 `shipment(id)`(받는 분은 core 가 이미 가린 `recipientSnapshot` 의 이름 그대로)와 `locationState`(location 상자의 `sources`)로 만든다. 파일: `labels.zpl`·`pick-list.html`·`shipments.csv`.
- 「출력 확인 기록」은 실제 인쇄 전에 남는다 — 스펙상 위치 피킹이 그 기록을 요구하기 때문이다. README 에 «labels.zpl 을 반드시 찍는다»를 적는다(Task 7).

- [ ] **Step 1: 실패하는 테스트**:
  - `sorts by first location then force boxes last`.
  - `escapes html in names`: 상품명 `<b>&"` 가 이스케이프되어 나온다.
  - `round-trips csv`: `parseCsv(toCsv(rows))` 가 같다.
  - `parses an Excel-saved csv`: BOM + CRLF + 빈 줄 2개 + `"1,2"` 따옴표 필드 + 한 줄 삭제된 텍스트 → 남은 줄만 정확히.
  - `refuses a csv without the header columns`: `shipmentId` 열 없음 → 던짐, 메시지에 `shipmentId`.
  - (prepare.spec) `writes labels in picking order and confirms each print`: `labels.zpl` 이 정렬 순서로 이어 붙고 `confirmLabelPrint` 가 상자마다 1회.
- [ ] **Step 2:** `npx jest scripts/ops/emergency-outbound/outputs scripts/ops/emergency-outbound/prepare` → 새 케이스 FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `[scripts] #1249 비상 출고 — 라벨·피킹 리스트·CSV`.

### Task 6: `dispatch`

**Files:**
- Create: `scripts/ops/emergency-outbound/dispatch.ts`
- Test: `scripts/ops/emergency-outbound/dispatch.spec.ts`

**Interfaces:**
- Consumes: `CoreApi`, `parseCsv`, `readRun`, `idemKey`, `FakeCore`.
- Produces:
  ```ts
  export const FORCE_REASON = '앱 출고 경로 장애 — 비상 출고';
  export type DispatchOutcome = 'dispatched' | 'already' | 'rejected' | 'mismatch' | 'would-dispatch';
  export interface DispatchReport { rows: { shipmentId: string; route: Route; outcome: DispatchOutcome; detail?: string }[]; missing: string[] }
  export function runDispatch(api: CoreApi, opts: { csvText: string; state: RunState; apply: boolean; log: (l: string) => void }): Promise<DispatchReport>;
  ```
- 줄마다: `shipment(id)` 의 `status ∈ {shipped,in_transit,delivered}` → `already`. `activeWaybill` 의 `trackingNo !== csv.trackingNo` → `mismatch`(발송 안 함). `route==='location'`: `locationState` → `items = sources.filter(remainingQty>0)` 를 `(shipmentLineId, sourceLocationId)` 순 정렬해 `{shipmentLineId, sourceLocationId, quantity: remainingQty}` → `locationForce(..., FORCE_REASON, items, idemKey(run,'dispatch',id))`. `route==='force'`: `forceDispatch(id, FORCE_REASON, key)`. `CoreApiError` 는 `rejected`(detail=code)로 적고 다음 줄로. dry-run 은 쓰기 없이 `would-dispatch`. `missing` = `state.boxes` 에 있고 CSV 에 없는 상자. 끝에 요약 한 줄 `발송 n · 이미 n · 거절 n · 불일치 n · 빠진 상자 n`.

- [ ] **Step 1: 실패하는 테스트**:
  - `dry-run dispatches nothing`.
  - `sends every remaining source exactly once`: sources 3개 중 remaining>0 인 2개만, 정렬된 순서와 수량 그대로 `locationForce` 에.
  - `routes packing boxes to force-dispatch`.
  - `skips an already shipped box` → `already`, 쓰기 0.
  - `refuses a tracking number mismatch` → `mismatch`, 쓰기 0.
  - `reports a 409 and continues`: 첫 줄 `SIMPLE_OUTBOUND_PLAN_INVALIDATED` → `rejected`, 둘째 줄은 `dispatched`.
  - `lists boxes deleted from the csv as missing`.
  - `second apply run is all already`: 같은 FakeCore 로 두 번 → 두 번째 전부 `already`.
- [ ] **Step 2:** `npx jest scripts/ops/emergency-outbound/dispatch` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `[scripts] #1249 비상 출고 — dispatch`.

### Task 7: CLI 와 런북 README

**Files:**
- Create: `scripts/ops/emergency-outbound/index.ts`, `scripts/ops/emergency-outbound/args.ts`, `scripts/ops/emergency-outbound/README.md`
- Test: `scripts/ops/emergency-outbound/args.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Command =
    | { cmd: 'prepare'; stage: 'local' | 'live'; warehouseId: string; run: string; apply: boolean }
    | { cmd: 'dispatch'; stage: 'local' | 'live'; run: string; csv: string; apply: boolean };
  export function parseArgs(argv: string[], now: Date): Command; // 잘못된 인자는 사용법 문장과 함께 던짐
  ```
- 사용: `npx tsx scripts/ops/emergency-outbound/index.ts prepare --stage live --warehouse <id> [--run <id>] [--apply]`, `… dispatch --stage live --run <id> [--csv <path>] [--apply]`(csv 기본값 `<run 폴더>/shipments.csv`). `--stage` 필수(기본값 없음). index 는 `openSession` → `myPermissions`+`warehouse` → `preflightProblems` 가 비어 있지 않으면 출력하고 exit 1 → `runPrepare`/`runDispatch` → 요약 출력. dispatch 는 `run.json` 의 warehouseId 를 쓴다.
- README = 런북 절차(스펙 «런북(#1251)에 넣을 절차»): 언제 쓰나 · 사전 준비(송장 프린터 Windows 공유 이름 정하기와 `copy /b` 시험 출력, 운영자 권한 3개, 창고 낱개 피킹 — 모두 dry-run 이 확인) · 아침 명령 · 스테이션 출력(`copy /b labels.zpl \\localhost\<공유 이름>`, 반드시 찍기) · 피킹 리스트로 꺼내기·포장·인계 · 저녁: 못 나간 줄 지우기(일부만 담긴 상자도) → dispatch dry-run → `--apply` · 실패 시(중간에 죽음 → 같은 `--run` 재실행·같은 사람만, 송장 멈춤 → #914/#1241 화면, 한진 API 장애 → 기다림, 시작 막힘으로 빠진 상자 → 다음 날 정식 경로).

- [ ] **Step 1: 실패하는 테스트**: `requires --stage`, `defaults run to KST yyyyMMdd-HHmm`(now=2026-11-18T23:30Z → `20261119-0830`), `defaults csv to the run folder`, `rejects an unknown command`.
- [ ] **Step 2:** `npx jest scripts/ops/emergency-outbound/args` → FAIL.
- [ ] **Step 3:** 구현 + README.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `[scripts] #1249 비상 출고 — CLI 와 런북 절차`.

### Task 8: 로컬 끝까지 확인

> 2026-11-18 갱신: `fake-hanjin.ts` 는 #1440 의 `scripts/local/hanjin-stub.ts`(start-all 이 띄운다)로 대체돼 지웠다. 실측 절차의 정본은 README «로컬 확인».

**Files:**
- Create: `scripts/ops/emergency-outbound/local/fake-hanjin.ts`, `scripts/ops/emergency-outbound/local/compare.ts`
- Test: `scripts/ops/emergency-outbound/local/compare.spec.ts`

**Interfaces:**
- `fake-hanjin.ts`: `127.0.0.1:4599` 에서 core 한진 게이트웨이(`apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts`)가 부르는 주문 등록·송장 출력 경로에 성공 응답(송장번호는 요청마다 다른 가짜 12자리, 분류 필드는 `scripts/local/seed-dev-core/outbound.ts` 의 `DEV_HANJIN_SORT_FIELDS` 꼴)을 준다. core 는 `HANJIN_ORDER_BASE_URL=http://127.0.0.1:4599 HANJIN_PRINT_BASE_URL=http://127.0.0.1:4599 npm run start:all:local` 로 띄운다(셸 값이 .env 를 이긴다) — 로컬에서 실제 한진을 부르지 않는다.
- `compare.ts`: `export function shapeOf(rows: ShipmentFacts): ComparableShape` 와 CLI `--normal <id,…> --emergency <id,…>`. 로컬 core DB(`apps/core/.env` 의 `DATABASE_URL`, localhost 아니면 거절)와 Medusa(로컬 admin API 또는 DB)에서 상자마다 모은다: SHIP 원장 이벤트(종류·SKU별 수량·from 위치 유무 — 정식 발송 통합 스펙이 SHIP 을 찾는 조인을 그대로 따른다), FOI `shipped_qty`, 상자 `status`, outbox 이벤트 종류 집합(`outbox_events`), Medusa 주문의 fulfillment 수·송장번호·shipped 여부. id·시각·작업자·`forced` 표시는 비교에서 뺀다. 출력: 상자별 shape 와 «정식 대비 다른 칸» 목록 — 비어 있어야 통과.

- [ ] **Step 1: 실패하는 테스트** (`shapeOf` 만): `ignores ids, timestamps and actor`, `differs when a SHIP row is missing`, `differs when Medusa has no tracking number`.
- [ ] **Step 2:** `npx jest scripts/ops/emergency-outbound/local` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS. 커밋 `[scripts] #1249 비상 출고 — 로컬 확인 도구`.
- [ ] **Step 5: 실측** (사람 손이 필요한 곳은 사용자에게 요청 — 브라우저 로그인·결제는 사용자가 직접):
  1. `npm run bootstrap:e2e:local` → fake-hanjin 띄우기 → 위 명령으로 `start:all:local` → `npm run preflight:e2e:local` 초록.
  2. 자사몰 주문 5건(`docs/local-e2e-environment.md` §7~§8-B: 스토어프론트 결제 → 수집 게이트). core 에 상자 5개가 `draft`/ready 로 보일 때까지.
  3. 상자 2개는 정식 경로(어드민 출고 준비 → 창고 앱 배치 피킹·검수)로 발송. 1개는 정식 배치에서 피킹까지 끝내 `ready_to_pack` 으로 둔다(force 갈래).
  4. `sellmate_handed_over_orders` 에 남은 주문 하나를 넣어 그 상자가 `prepare` dry-run 대상에서 빠지는지 본다(확인 뒤 행 삭제).
  5. `prepare --stage local` dry-run → `--apply` → 산출물 3개 확인(ZPL 은 내용만).
  6. `shipments.csv` 에서 한 줄 지우고 `dispatch` dry-run → `--apply` → 다시 `--apply`(전부 `already`) → 지운 상자가 `missing` 이고 발송 안 됨.
  7. `compare --normal <정식 2> --emergency <비상 location·force>` → 다른 칸 0.
  8. 출력 전부를 `.scratch/emergency-outbound/evidence-<날짜>.md` 에 붙여 둔다(PR Evidence 의 원본).

### Task 9: 게이트와 PR

- [ ] **Step 1:** E2E 스택을 내린다(`start:all:local` 종료). 워크트리 앱별 node_modules 링크 확인(admin-web·wallet-web·warehouse-app).
- [ ] **Step 2:** `npm run type-check` → 에러 0.
- [ ] **Step 3:** `npx jest --maxWorkers=2` → 실패 0(로컬 전용으로 알려진 빨강이 나오면 develop 에서도 같은지 확인해 PR 에 적는다).
- [ ] **Step 4:** PR #1434 본문 갱신 — Evidence(Task 8 출력 요약), «런북(#1251)에 넣을 절차»를 README 요약으로 채움, 할 일 체크.
- [ ] **Step 5:** push.
