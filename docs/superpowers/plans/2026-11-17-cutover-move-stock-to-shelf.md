# 컷오버: 위치가 하나인 SKU 재고를 선반 로케이션으로 옮기기 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** T 당일 한 번 돌리는 dry-run 기본 스크립트로, 위치 텍스트가 선반 로케이션 하나로 읽히는 SKU 의 입고기본존 재고를 MOVE 이벤트로 그 선반에 옮기고, 옮기지 않은 SKU 를 사유와 함께 남긴다.

**Architecture:** 판정은 import 없는 순수 함수(`judgeShelfMove`)로 core 의 `shelf-code-reading.ts` 옆에 두고, 스크립트와 판정 스크립트가 같이 쓴다. 스크립트의 본체(`runShelfMove`)는 drizzle DB·`MovementService`·`BatchControlledStockGuard` 를 인자로 받아, 통합 스펙이 롤백 트랜잭션을 DB 로 넘겨 검증할 수 있게 한다(`inbound-origin-protection.integration.spec.ts` 가 `makeMovementService(tx as Database)` 로 쓰는 방식).

**Tech Stack:** TypeScript · tsx · drizzle-orm(postgres-js) · jest

**Spec:** `docs/superpowers/specs/2026-11-17-cutover-move-stock-to-shelf-design.md`

## Global Constraints

- 원장은 `MovementService.moveImmediately` 로만 바꾼다. `stock_ledgers`·`stock_events` 직접 UPDATE/INSERT 금지.
- 기본은 dry-run. `--apply` 일 때만 쓴다. `--apply` 는 `--positions-since=<ISO 시각>` 없으면 거절(종료 1).
- 고쳐 읽은 규칙은 기본 꺼짐. `--include-rule=zero-pad,dash-position,custom-bin`(쉼표 목록)으로 켠다.
- 대상 로케이션: 판매 창고(`warehouses.is_sellable`)의 `locations.system_role = 'inbound_default'`, `stock_state = 'ON_HAND'`, `qty > 0`.
- 목적지: 같은 창고의 `is_active = true`·`is_system = false`·`location_type = 'standard'` 로케이션, `code` 가 고쳐 읽은 코드와 글자까지 같은 것.
- 멱등키: `cutover-1236:<warehouseId>:<skuId>:<stockVersion>` (`stockVersion` = guard `getAvailability` 가 돌려준 출발 원장 행 version).
- actor: `00000000-0000-0000-0000-000000000000`, memo: `cutover #1236`.
- 남긴 SKU 목록 CSV 기본 경로 `apps/core/tmp/cutover-1236-kept-<YYYYMMDDHHmmss>.csv`. 위치 원문이 들어가므로 커밋하지 않는다(`apps/core/tmp/` 는 `.gitignore` 의 `tmp/` 에 걸린다 — 2026-11-17 확인).
- 전체 `npm run type-check`·`npx jest` 는 PR 을 ready 로 바꾸기 직전 한 번만, `--maxWorkers=2` 로(Task 4). E2E 스택이 떠 있으면 돌리지 않는다. 그 전에는 바꾼 파일의 스펙만 돌린다.
- 코드 주석·커밋 메시지는 한국어. 커밋 끝에 `Claude-Session: https://claude.ai/code/session_01LKjrK51xEAX1NWhyEqYPJT`.

## Review Focus

1. 같은 SKU·창고에 `ON_HAND` 가 아닌 원장 행(예: `RETURNED`)이 입고기본존에 있어도 대상이 아니다 → Task 2 테스트 «ON_HAND 만 옮긴다».
2. 고친 코드와 같은 로케이션이 **비활성**이거나 **다른 판매 창고**에만 있다 → `no-location` → Task 1 테스트.
3. 한 번 `--apply` 한 뒤 같은 입력으로 다시 돌린다 → MOVE 0건, `stock_events` 늘지 않음 → Task 2 테스트.
4. 출발 행에서 guard 가 `INBOUND_ORIGIN_STOCK_INCONSISTENT` 를 던진다 → 실행이 죽지 않고 `keep: inconsistent` → Task 2 테스트.
5. SKU 하나의 `moveImmediately` 가 Nest `ConflictException` 을 던진다(예: 목적지가 실행 중 비활성됨) → 그 SKU 만 실패로 세고 다음 SKU 진행, 종료 코드 1 → Task 2 테스트.

---

### Task 1: 판정 순수 함수 `judgeShelfMove`

**Files:**
- Create: `apps/core/src/modules/inventory/core/shelf-move-verdict.ts`
- Test: `apps/core/src/modules/inventory/core/shelf-move-verdict.spec.ts`

**Interfaces:**
- Consumes: `readShelfCode(normalized: string): ShelfCodeReading` (`./shelf-code-reading`)
- Produces:
```ts
export type ShelfMoveRule = 'zero-pad' | 'dash-position' | 'custom-bin';
export const SHELF_MOVE_RULES: readonly ShelfMoveRule[];
export type ShelfKeepReason =
  | 'no-position' | 'stale' | 'unreadable' | 'unconfirmed' | 'no-location' | 'elsewhere';
export type ShelfMoveInput = {
  position: { code: string; updatedAt: Date } | null;
  freshSince: Date | null;               // null 이면 stale 판정을 건너뛴다(판정 스크립트)
  locationCodes: ReadonlySet<string>;    // 그 창고의 활성 standard 비시스템 로케이션 코드
  shelvesWithStock: readonly string[];   // 이 SKU 가 이미 ON_HAND>0 인 standard 로케이션 코드
  includeRules: ReadonlySet<ShelfMoveRule>;
};
export type ShelfMoveVerdict =
  | { kind: 'move'; toCode: string; rule: 'exact' | ShelfMoveRule }
  | { kind: 'keep'; reason: ShelfKeepReason };
export function judgeShelfMove(input: ShelfMoveInput): ShelfMoveVerdict;
```
- 파일은 `./shelf-code-reading` 외 어떤 import 도 두지 않는다(scripts 의 tsx 가 상대 경로로 직접 import 한다 — `shelf-code-reading.ts` 머리 주석과 같은 이유).

- [ ] **Step 1: 실패하는 테스트 작성** — `describe('judgeShelfMove')` 아래 `it.each` 표로, 기본 입력(`position {code:'A-01-01', updatedAt: 2026-11-20T10:00Z}`, `freshSince 2026-11-20T09:00Z`, `locationCodes {'A-01-01','CC-04-01','O-21-30','M-07-꼭대기'}`, `shelvesWithStock []`, `includeRules ∅`)에서 한 가지씩 바꿔 기대값을 단다:
  - 기본 → `{kind:'move', toCode:'A-01-01', rule:'exact'}`
  - `position null` → `keep no-position`
  - `updatedAt 2026-11-19T00:00Z` → `keep stale`; 같은 입력에 `freshSince null` → `move`
  - `code '외부창고'` → `keep unreadable`; `code 'A-01-01,B-02-03'` → `keep unreadable`
  - `code 'CC-4-1'` → `keep unconfirmed`; 같은 입력에 `includeRules {'zero-pad'}` → `move CC-04-01 rule zero-pad`
  - `code 'O21-30-'` + `includeRules {'dash-position'}` → `move O-21-30`; `code 'M-07-꼭대기'` + `{'custom-bin'}` → `move M-07-꼭대기`
  - `code 'B-09-09'`(locationCodes 에 없음) → `keep no-location`
  - `shelvesWithStock ['B-01-01']` → `keep elsewhere`; `shelvesWithStock ['A-01-01']` → `move`(같은 선반이면 나뉘지 않는다)
  - 판정 순서: `position` 이 stale 이면서 unreadable 이면 `stale` (앞선 사유가 이긴다 — 순서는 no-position → stale → unreadable → unconfirmed → no-location → elsewhere)
- [ ] **Step 2: 실패 확인** — Run: `npx jest apps/core/src/modules/inventory/core/shelf-move-verdict.spec.ts` / Expected: FAIL (모듈 없음)
- [ ] **Step 3: `judgeShelfMove` 구현** — 위 순서대로 판정. `readShelfCode` 의 `exact` 는 항상 허용, `fixed` 는 `reading.rule`, `custom-bin` 은 `'custom-bin'` 이 `includeRules` 에 있어야 허용.
- [ ] **Step 4: 통과 확인** — 같은 명령 / Expected: PASS
- [ ] **Step 5: 커밋** — `git add apps/core/src/modules/inventory/core/shelf-move-verdict.*` → `git commit -m "[core] 컷오버 재고 이동 판정 순수 함수 (#1236)"`

### Task 2: 스크립트 `move-stock-to-shelf.ts`

**Files:**
- Create: `scripts/sellmate/move-stock-to-shelf.ts`
- Test: `scripts/sellmate/move-stock-to-shelf.spec.ts` (인자 파싱·CSV 직렬화 단위)
- Test: `scripts/sellmate/move-stock-to-shelf.integration.spec.ts` (`describeIfDb`)

**Interfaces:**
- Consumes: Task 1 의 `judgeShelfMove`·`SHELF_MOVE_RULES`·`ShelfMoveRule`; `MovementService.moveImmediately(dto: MoveBatchDto)`; `BatchControlledStockGuard.getAvailability({skuId, warehouseId, sourceLocationId}, tx)` → `{ onHandQty, stockVersion, generallyAvailableQty, ... }`
- Produces:
```ts
export type ShelfMoveOptions = {
  apply: boolean;
  positionsSince: Date | null;
  includeRules: ReadonlySet<ShelfMoveRule>;
};
export function parseShelfMoveArgs(argv: string[]): ShelfMoveOptions & { out: string };   // 잘못된 값이면 throw
export type ShelfMoveRow = {
  warehouseId: string; skuId: string; skuCode: string; positionText: string | null;
  qty: number;                // 입고기본존 ON_HAND
  outcome: 'moved' | 'would-move' | 'failed'
         | `keep:${ShelfKeepReason | 'protected' | 'allocated' | 'inconsistent'}`;
  movedQty: number; toCode: string | null; error?: string;
};
export async function runShelfMove(
  db: PostgresJsDatabase<typeof wmsSchema>,
  deps: { movement: MovementService; guard: BatchControlledStockGuard },
  opts: ShelfMoveOptions,
): Promise<ShelfMoveRow[]>;
export function keptRowsCsv(rows: ShelfMoveRow[]): string;   // 헤더: warehouse_id,sku_code,reason,qty,position_text
```

- [ ] **Step 1: 단위 테스트 작성** (`move-stock-to-shelf.spec.ts`)
  - `parseShelfMoveArgs([])` → `apply false`, `positionsSince null`, `includeRules ∅`
  - `parseShelfMoveArgs(['--apply'])` → throw `/--positions-since/`
  - `parseShelfMoveArgs(['--apply','--positions-since=2026-11-20T09:00:00+09:00','--include-rule=zero-pad,custom-bin'])` → `includeRules {'zero-pad','custom-bin'}`
  - `--include-rule=bogus` → throw; `--positions-since=어제` → throw
  - `keptRowsCsv` — `keep:*` 와 `failed` 행만, 부분 이동(`moved` 인데 `movedQty < qty`)은 `keep:protected` 로 남은 수량 `qty - movedQty` 행을 하나 더 쓴다; 쉼표·따옴표가 든 위치 텍스트는 CSV 이스케이프
- [ ] **Step 2: 실패 확인** — Run: `npx jest scripts/sellmate/move-stock-to-shelf.spec.ts` / Expected: FAIL
- [ ] **Step 3: 통합 테스트 작성** (`move-stock-to-shelf.integration.spec.ts`) — 머리 주석에 실행 명령(`COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'move-stock-to-shelf\.integration\.spec\.ts$'`). `makeDb`·`inRollbackTx`(`apps/core/src/modules/fulfillment/services/__support__`)로 각 테스트를 롤백 트랜잭션에서 돌리고, `buildWiring(tx as Database)`(`apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts`)의 `guard` 와 `makeMovementService(tx as Database)` 를 넘긴다. 시드: `seedWarehouseWithZone` → `buildWiring(...).location.ensureSystemLocations(warehouseId, tx)` 로 입고기본존 → standard 로케이션 행 직접 insert → `seedHolder`/`seedSku` → `receiveStock(buildWiring(...).command, tx, { skuId, warehouseId, locationId: 입고기본존, quantity })` → `sku_shelf_positions` insert. 확인은 `onHandAt(tx, skuId, locationId)`(`logistics-assertions.ts`). 테스트:
  - «옮긴다»: 위치 `A-01-01` 인 SKU 10개 → `apply` 후 입고기본존 0, `A-01-01` 10(`onHandAt`), `stock_events` 에 `transition_type='MOVE'` 1건, 행 `outcome 'moved'`
  - «dry-run 은 쓰지 않는다»: `apply false` → 행 `would-move`, 원장 그대로
  - «다시 돌려도 0건»: 두 번째 `apply` → 대상 행 없음(또는 `moved` 0), MOVE 이벤트 1건 그대로
  - «ON_HAND 만 옮긴다»: 입고기본존에 `RETURNED` 행만 있는 SKU 는 결과에 없다
  - «적치 대기분은 남긴다»: `InboundService` 로 입고 대기 3개를 만든 SKU(10개 중) → `movedQty 7`, CSV 에 `keep:protected` 3
  - «배정 걸린 SKU 는 남긴다»: `picking_source_allocations`(source = 입고기본존, `outbound_batch_work_items.status='picking'`) → `keep:allocated`
  - «다른 선반 재고»: 같은 SKU 가 `B-01-01` 에 재고 → `keep:elsewhere`
  - «낡은 위치»: `positionsSince` 보다 앞선 `updated_at` → `keep:stale`
  - «guard 불일치»: `inbound-origin-protection.integration.spec.ts` 의 «Historical corruption fixture»(그 파일 319행 부근) 방식으로 ON_HAND < 입고 대기 상태를 만든 SKU → `keep:inconsistent`, 실행 계속
  - «한 SKU 실패는 다음으로»: 두 SKU 중 하나의 목적지를 `moveImmediately` 직전에 비활성으로(목적지 `is_active=false` 로 시드하되 판정 입력의 `locationCodes` 는 활성만 보므로, 이 테스트는 `deps.movement` 를 첫 호출에 `ConflictException` 을 던지는 래퍼로 감싼다) → 첫 행 `failed`, 둘째 `moved`
  - «피킹 배정이 선반을 고른다»: 옮긴 뒤 `lockSkuCapacities(tx, guard, warehouseId, [skuId])`(`apps/core/src/modules/fulfillment/picking/allocation/allocation.locks.ts:277`)의 후보에 `A-01-01` 이 있고 입고기본존은 없다 — 반환 모양은 그 파일을 따른다
- [ ] **Step 4: 실패 확인** — Run: 위 통합 명령 / Expected: FAIL (모듈 없음)
- [ ] **Step 5: 구현** — `runShelfMove`:
  - 대상 읽기(읽기 쿼리 1~2개): 판매 창고마다 입고기본존 원장 행 + `skus.code` + `sku_shelf_positions`(left) + 그 창고의 활성 standard 로케이션 코드·id 맵 + SKU 별 다른 standard 로케이션 ON_HAND 코드 + 활성 배정 여부(`picking_source_allocations` ⨝ `shipment_lines.sku_id` ⨝ `outbound_batch_work_items.status NOT IN ('excluded','completed')`, `source_location_id` = 입고기본존).
  - SKU 마다: `judgeShelfMove` → keep 이면 행. move 면 배정 걸림 → `keep:allocated`. 아니면 `db.transaction(tx => guard.getAvailability(..., tx))`(lock 없음)로 가용 → `INBOUND_ORIGIN_STOCK_INCONSISTENT` 코드의 `ConflictException` 은 `keep:inconsistent`; `generallyAvailableQty === 0` 은 `keep:protected`. dry-run 은 `would-move`. apply 는 `moveImmediately({ warehouseId, actorId: SYSTEM_ACTOR, memo: 'cutover #1236', idempotencyKey, lines: [{ skuId, fromLocationId, toLocationId, quantity: generallyAvailableQty }] })`.
  - SKU 단위 catch 는 `HttpException`(Nest)·`ApplicationException`(`@app/shared`, `libs/shared/src/filters/domain-exceptions.ts`)만 `failed` + `error` 메시지로 받는다. 그 밖의 오류(DB 연결 끊김 등)는 다시 던져 실행을 멈춘다.
  - CLI `main()`(`require.main === module`): `close-sellmate-csv-inbound.ts` 와 같은 방식으로 `DbService` 를 prototype 으로 세우고, `BatchControlledStockGuard`·`ProductSellableQuantityService`(outbox 는 `outboxPublisherFor(INVENTORY_STREAM, …)`)·`StockEventStore`·`InventoryIdempotencyService`·`MovementService` 를 조립. 요약 출력: `moved`/`would-move` SKU·수량, 사유별 keep SKU·수량, `failed` 수, 규칙별 `unconfirmed` 수(켜면 몇 SKU 가 더 옮겨지는지). `keptRowsCsv` 를 `out` 에 쓴다. `failed > 0` 이면 `process.exit(1)`.
  - 머리 주석: 무엇·왜(설계 §1), «T 당일만 — 며칠 뒤 다시 돌리면 묶이지 않은 앱 입고분을 쓸어 간다», 실행 예: `bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=<load-shelf-positions 직전 시각>` → 숫자 확인 → 같은 명령 + `--apply`.
- [ ] **Step 6: 통과 확인** — 단위·통합 명령 둘 다 / Expected: PASS
- [ ] **Step 7: 커밋** — `[scripts] 컷오버: 위치가 하나인 SKU 재고를 선반으로 옮기는 스크립트 (#1236)`

### Task 3: 판정 스크립트 «로케이션 2» 를 같은 판정으로

**Files:**
- Modify: `scripts/ops/cutover-preflight/checks/location.ts` («로케이션 2» 의 single/multi 두 쿼리, 34~55행 부근)
- Modify: `scripts/ops/cutover-preflight/rules.ts` (집계 함수 추가)
- Test: `scripts/ops/cutover-preflight/rules.spec.ts`

**Interfaces:**
- Consumes: Task 1 `judgeShelfMove` (`freshSince: null`, `includeRules: ∅`)
- Produces: `export function shelfMoveSummary(verdicts: ShelfMoveVerdict[], verdictsAllRules: ShelfMoveVerdict[]): { move: number; byReason: Record<ShelfKeepReason, number>; unlockedByRules: number }` — `unlockedByRules` = 규칙을 다 켜면 `move` 가 되는 SKU 수.

- [ ] **Step 1: 실패하는 테스트** — `rules.spec.ts` 에 `shelfMoveSummary`: move 2·no-position 1·unconfirmed 1(규칙 켜면 move) 입력 → `{ move: 2, byReason: { 'no-position': 1, unconfirmed: 1, … 나머지 0 }, unlockedByRules: 1 }`
- [ ] **Step 2: 실패 확인** — `npx jest scripts/ops/cutover-preflight/rules.spec.ts` / FAIL
- [ ] **Step 3: 구현** — `shelfMoveSummary` 추가. `location.ts` «로케이션 2»: 입고기본존(`system_role='inbound_default'`) ON_HAND>0 행만 읽고 SKU 마다 `judgeShelfMove` 두 번(규칙 ∅ / 규칙 전부). `move > 0` 이면 `r.cutoverAt` 이 없을 때 `r.dayOf('위치가 하나인 SKU N개(M개)가 입고기본존에 있다', 'bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=… 후 --apply (#1236)')`, `r.cutoverAt` 이 있으면 `r.info(…)` 로 낮춘다. 사유별 수·`unlockedByRules` 는 `r.info`. 옛 «둘 이상» 쿼리는 지운다.
- [ ] **Step 4: 통과 확인** — 같은 명령 / PASS. 타입은 Task 4 의 전체 type-check 가 본다.
- [ ] **Step 5: 커밋** — `[scripts] 컷오버 판정: «로케이션 2» 를 재고 이동 판정과 같은 함수로 센다 (#1236)`

### Task 4: PR 직전 검증과 문서

**Files:**
- Modify: `scripts/sellmate/README.md` (스크립트 목록에 한 줄, 있으면)
- PR #1410 본문, #1236 이슈 본문(실행 시점 한 줄 — 이미 있으면 그대로)

- [ ] **Step 1: E2E 스택이 떠 있지 않은지 확인** — `docker ps --format '{{.Names}}' | grep -E 'kafka|postgres'` 와 `ss -ltn | grep -E ':(3000|9000|9092)\b'` 로 앱 프로세스가 없음을 본다. 떠 있으면 멈추고 사용자에게 묻는다.
- [ ] **Step 2: 전체 type-check** — Run: `npm run type-check` / Expected: 에러 0
- [ ] **Step 3: 전체 jest** — Run: `npx jest --maxWorkers=2` / Expected: 실패 0 (워크트리 앱별 node_modules 링크 함정은 메모리 «워크트리 앱별 node_modules» 참고)
- [ ] **Step 4: README 한 줄 + 커밋 + push**
- [ ] **Step 5: 라이브 dry-run 은 사용자에게 터널을 부탁한 뒤** `bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=<지금>` (읽기 전용) — 사유별 숫자를 PR 본문 Evidence 에 붙인다. `--apply` 는 T 당일에만.
