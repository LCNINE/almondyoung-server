# 셀메이트 선반 위치 → 로케이션 마스터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매 창고에 셀메이트 선반 코드와 글자까지 같은 standard 로케이션을 만들고, 랙 끝 번호 수정(`PUT /racks/:rackId`)이 칸을 따라 늘리고 줄이게 한다.

**Architecture:** 코드 꼴·고쳐 읽기·칸 집합 계산은 import 없는 순수 함수(core 안)로 둔다. 칸을 실제로 맞추는 DB 함수 `syncRackBins` 하나를 core 서비스와 셀메이트 스크립트가 **같이** 부른다. 스크립트는 drizzle 로 core 스키마를 직접 쓴다(`scripts/local/seed-dev-core` 와 같은 방식). 판정 스크립트도 같은 고쳐 읽기 함수를 쓴다.

**Tech Stack:** NestJS 11, Drizzle ORM + postgres.js, Jest(ts-jest), tsx 스크립트.

**Spec:** `docs/superpowers/specs/2026-11-09-cutover-location-master-design.md`

## Global Constraints

- 로케이션 코드 꼴: `${열}-${랙 두 자리 0채움}-${칸}`. 자동 칸 이름은 `String(n).padStart(2,'0')` (1~99 → `01`…`99`, 100 이상 → `100`…). 자석 바코드 값과 글자까지 같아야 한다.
- 별칭 없음. 한 칸에 이름 하나.
- 스크립트는 **지우지 않는다**, 늘리기만 한다. 쓰는 테이블은 `location_columns`·`location_racks`·`locations` 셋뿐.
- 칸 삭제는 "사용 중"이 아닐 때만. 사용 중 = `locations.id` 를 가리키는 **모든** 외래키 열(카탈로그에서 읽음)에 행이 있음. "지워 보고 막히면 남기기" 금지(SET NULL 외래키 때문).
- 커스텀 칸(숫자뿐이 아닌 `bin_identifier`)은 칸 맞추기에서 건드리지 않는다.
- 공개 레포: 라이브 위치 원문(창고·거래처 이름 등)과 라이브 수치를 코드·테스트·커밋에 적지 않는다. 테스트 예시는 `A-01-01`·`O21-30-`·`CC-4-1`·`M-07-꼭대기` 같은 꼴만.
- 서비스는 `@app/shared` 도메인 예외(`NotFoundError`·`BadRequestError`), 트랜잭션은 `dbService.run(fn, tx)`.
- 검증 게이트: `npm run type-check` 0, `npx jest --maxWorkers=3` 실패 0.

## Review Focus

1. **같은 번호를 다른 자릿수로 쓴 칸이 이미 있음**(`5` 커스텀 칸 vs 자동 `05`) → 같은 번호면 새로 만들지 않아야 한다. Task 1 `planRackBinSync` 테스트가 고정.
2. **`start > end` 로 수정** → 400 이고 아무 칸도 지우지 않아야 한다. Task 3 테스트가 고정.
3. **`autoGenerateBins` 를 false 로 바꾸며 끝 번호를 줄임** → 칸을 지우지 않아야 한다(수동 랙). Task 3 테스트가 고정.
4. **스크립트 재실행 중 셀메이트 위치가 줄어듦**(가장 큰 칸이 사라짐) → 스크립트는 끝 번호를 줄이지 않아야 한다. Task 5 테스트가 고정.
5. **같은 코드의 zone 행이 이미 있음** → apply 가 실패하지 않고 그 코드만 "충돌"로 보고해야 한다. Task 5 테스트가 고정.

---

### Task 1: 로케이션 코드 꼴과 칸 집합 계산 (순수 함수)

**Files:**
- Create: `apps/core/src/modules/inventory/core/location-code.ts`
- Modify: `apps/core/src/modules/inventory/core/services/location.service.ts` (createRack 의 두 곳·addCustomBin 의 코드 조립을 `rackBinLocationCode` 로)
- Test: `apps/core/src/modules/inventory/core/location-code.spec.ts`

**Interfaces:**
- Produces (파일은 import 없음 — tsx 스크립트가 직접 import 한다):
  - `rackBinLocationCode(columnName: string, rackNumber: number, binIdentifier: string): string`
  - `autoBinIdentifier(n: number): string`
  - `isNumericBin(binIdentifier: string): boolean` — `/^\d+$/`
  - `planRackBinSync(input: { start: number; end: number; existing: { id: string; binIdentifier: string }[] }): { createBinIdentifiers: string[]; deleteCandidateIds: string[] }` — 숫자 칸만 번호(`parseInt`)로 비교한다. 범위 안인데 같은 번호의 칸이 없으면 생성, 범위 밖 숫자 칸은 삭제 후보, 커스텀 칸은 무시.

- [ ] **Step 1: 실패하는 테스트**

```ts
expect(rackBinLocationCode('A', 1, '01')).toBe('A-01-01');
expect(rackBinLocationCode('Z', 1, autoBinIdentifier(105))).toBe('Z-01-105');
expect(rackBinLocationCode('M', 7, '꼭대기')).toBe('M-07-꼭대기');
expect(autoBinIdentifier(5)).toBe('05');
expect(isNumericBin('05')).toBe(true); expect(isNumericBin('꼭대기')).toBe(false);
// 가운데 빈 칸 채우기 + 늘리기
expect(planRackBinSync({ start: 1, end: 4, existing: [{ id: 'a', binIdentifier: '01' }, { id: 'c', binIdentifier: '03' }] }))
  .toEqual({ createBinIdentifiers: ['02', '04'], deleteCandidateIds: [] });
// 줄이기: 범위 밖 숫자 칸만 후보, 커스텀 칸 무시
expect(planRackBinSync({ start: 1, end: 1, existing: [{ id: 'a', binIdentifier: '01' }, { id: 'b', binIdentifier: '02' }, { id: 'x', binIdentifier: '꼭대기' }] }))
  .toEqual({ createBinIdentifiers: [], deleteCandidateIds: ['b'] });
// Review Focus 1: 같은 번호 다른 자릿수
expect(planRackBinSync({ start: 5, end: 5, existing: [{ id: 'k', binIdentifier: '5' }] }))
  .toEqual({ createBinIdentifiers: [], deleteCandidateIds: [] });
```

- [ ] **Step 2: 실행해 실패 확인** — `npx jest apps/core/src/modules/inventory/core/location-code.spec.ts` → FAIL(모듈 없음)
- [ ] **Step 3: `location-code.ts` 구현, `LocationService` 의 코드 조립 세 곳을 `rackBinLocationCode`·`autoBinIdentifier` 로 바꾼다** (동작 변화 없음)
- [ ] **Step 4: 통과 확인** — 위 명령 + `npx jest apps/core/src/modules/inventory/core/services/location.service.spec.ts` → PASS
- [ ] **Step 5: 커밋** — `로케이션 코드 꼴과 칸 집합 계산을 순수 함수로 뺀다 (#1235)`

### Task 2: 선반 텍스트 고쳐 읽기 (순수 함수)

**Files:**
- Create: `apps/core/src/modules/inventory/core/shelf-code-reading.ts`
- Test: `apps/core/src/modules/inventory/core/shelf-code-reading.spec.ts`

**Interfaces:**
- Consumes: Task 1 `rackBinLocationCode`, `autoBinIdentifier` (상대 경로 import, 둘 다 import 없는 파일)
- Produces:
  ```ts
  export type ShelfCodeReading =
    | { kind: 'exact'; code: string; column: string; rackNumber: number; bin: string }
    | { kind: 'fixed'; code: string; column: string; rackNumber: number; bin: string; rule: 'zero-pad' | 'dash-position' }
    | { kind: 'custom-bin'; code: string; column: string; rackNumber: number; bin: string }
    | { kind: 'exception'; raw: string };
  export function readShelfCode(normalized: string): ShelfCodeReading;
  ```
  입력은 `normalizePositionCode` 를 거친 값. 규칙은 스펙 §5.1 표 그대로(검사 순서: exact → zero-pad → dash-position → custom-bin → exception). 결과 `code` 는 항상 `rackBinLocationCode` 로 만든다.

- [ ] **Step 1: 실패하는 테스트** (`it.each` 표)

| 입력 | 기대 |
|---|---|
| `A-01-01` | exact, `A-01-01`, rack 1, bin `01` |
| `Z-01-105` | exact, `Z-01-105` |
| `AA-12-09` | exact, column `AA` |
| `CC-4-1` | fixed zero-pad, `CC-04-01` |
| `DD-10-1` | fixed zero-pad, `DD-10-01` |
| `O21-30-` | fixed dash-position, `O-21-30` |
| `M-07-꼭대기` | custom-bin, `M-07-꼭대기`, bin `꼭대기` |
| `N-맨뒤` · `P-02--35` · `C-1F-F28` · `D-1006` · `P-1-39 뒤` · `외부창고` · `A064GQ$` | exception, raw 그대로 |

추가 단언: exact 결과의 `code` 를 다시 `readShelfCode` 에 넣으면 같은 exact 결과(멱등). fixed 결과의 `code` 를 넣으면 exact.

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/inventory/core/shelf-code-reading.spec.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: 커밋** — `셀메이트 선반 텍스트를 로케이션 코드로 고쳐 읽는다 (#1235)`

### Task 3: 랙 끝 번호 수정이 칸을 따라 맞춘다 (`syncRackBins` + `PUT /racks/:rackId`)

**Files:**
- Create: `apps/core/src/modules/inventory/core/services/rack-bin-sync.ts`
- Modify: `apps/core/src/modules/inventory/core/services/location.service.ts` (`updateRack`)
- Modify: `apps/core/src/modules/inventory/core/dto/location-response.dto.ts` (`RackBinChangesDto` 클래스 + `LocationRackResponseDto.binChanges?`)
- Modify: `apps/core/src/modules/inventory/core/controllers/location.controller.ts` (Swagger 응답 설명만, 동작 변화 없음)
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` (`LocationRackDto` 에 `binChanges?: { created: string[]; deleted: string[]; keptInUse: string[] }`)
- Test: `apps/core/src/modules/inventory/core/services/rack-bin-sync.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `planRackBinSync`, `rackBinLocationCode`, `autoBinIdentifier`
- Produces:
  - `export type RackBinChanges = { created: string[]; deleted: string[]; keptInUse: string[] }` (로케이션 코드 목록)
  - `export async function findLocationIdsInUse(tx: DbTx, ids: string[]): Promise<Set<string>>`
  - `export async function syncRackBins(tx: DbTx, rackId: string): Promise<RackBinChanges>` — 랙·열을 읽는다(없으면 `NotFoundError`). `autoGenerateBins=false` 면 빈 결과. 랙의 칸 행을 `FOR UPDATE` 로 잠그고 → `planRackBinSync` → 생성(`locationType 'standard'`, `displayName=code`, `isActive true`) → 후보 중 `findLocationIdsInUse` 에 없는 것만 삭제.
  - `LocationService.updateRack(rackId, dto, tx?: DbTx): Promise<LocationRack & { binChanges: RackBinChanges }>` — `dbService.run` 안에서 랙 갱신 후 `syncRackBins`. 갱신 결과가 `defaultBinStart > defaultBinEnd` 면 `BadRequestError`(쓰기 전에 판정). 랙 없으면 `NotFoundError`.

`findLocationIdsInUse` 의 외래키 목록 조회(카탈로그):

```sql
select n.nspname as schema, t.relname as table, a.attname as column
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f' and c.confrelid = to_regclass('locations') and array_length(c.conkey, 1) = 1
```

각 (schema, table, column) 마다 `select distinct <column> as id from <schema>.<table> where <column> = any(${ids})` 를 `sql.identifier` 로 조립해 합집합을 만든다. 다열 외래키가 하나라도 있으면(`array_length > 1`) 던진다 — 조용히 빠뜨리지 않는다.

- [ ] **Step 1: 실패하는 통합 테스트** (`describeIfDb`, `makeDb`·`inRollbackTx`·`seedWarehouseWithZone`·`seedHolder`·`seedSku` 사용, 열·랙·칸은 `trx` 로 직접 insert 하는 스펙 내부 헬퍼 `seedRack(trx, warehouseId, { column: 'A', rack: 1, bins: ['01','02','03'], auto: true })`). `LocationService` 는 `run: (fn, tx) => fn(tx ?? trx)` 인 dbService 로 만든다(`warehouse.manager.integration.spec.ts` 의 `buildManager` 와 같은 방식).
  - `늘리면 빠진 칸이 생긴다`: bins 01·03, end 3→5 → `created` = `['A-01-02','A-01-04','A-01-05']`, 칸 행 5개
  - `줄이면 안 쓰는 칸만 지운다`: bins 01~05, 03 은 `stock_events.to_location_id` 만, 04 는 `stock_ledgers` 행(qty 0)만 가리킴. end 5→1 → `deleted` = `['A-01-02','A-01-05']`, `keptInUse` = `['A-01-03','A-01-04']`, 그 `stock_events` 행의 `to_location_id` 가 그대로(NULL 아님)
  - `커스텀 칸은 건드리지 않는다`: bins 01·`꼭대기`, end 1 유지·start 1 → `꼭대기` 행 존재, `deleted` 빈 배열
  - Review Focus 2: `start > end 면 400 이고 아무것도 안 바뀐다` → `BadRequestError`, 칸 수·랙 행 그대로
  - Review Focus 3: `autoGenerateBins=false 로 줄이면 칸을 지우지 않는다` → `binChanges` 셋 다 빈 배열, 칸 수 그대로
  - `findLocationIdsInUse 는 카탈로그의 모든 외래키를 본다`: `skus.primary_location_id` 로만 가리킨 칸이 결과에 든다
- [ ] **Step 2: 실패 확인** — `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'rack-bin-sync\.integration\.spec\.ts$'` → FAIL
- [ ] **Step 3: `rack-bin-sync.ts` 구현, `updateRack` 연결, 응답 DTO(`RackBinChangesDto` 는 별도 클래스, `type: 'object'` 금지)·admin-web 타입 추가**
- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS. `npx jest apps/core/src/modules/inventory/core` → PASS
- [ ] **Step 5: 커밋** — `랙 끝 번호를 바꾸면 칸이 따라 늘고, 안 쓰는 칸만 줄어든다 (#1235)`

### Task 4: 선반 코드 → 로케이션 마스터 계획 (순수 함수)

**Files:**
- Create: `scripts/sellmate/location-master-plan.ts`
- Test: `scripts/sellmate/location-master-plan.spec.ts`

**Interfaces:**
- Consumes: Task 2 `readShelfCode`, `ShelfCodeReading`
- Produces:
  ```ts
  export type RackPlan = { column: string; rackNumber: number; binEnd: number | null; customBins: string[] };
  // binEnd null = 숫자 칸 없음 → auto_generate_bins=false 로 만든다
  export type LocationMasterPlan = {
    columns: string[];                                   // 정렬
    racks: RackPlan[];                                   // column, rackNumber 순
    missingRackNumbers: { column: string; rackNumbers: number[] }[]; // 1..최대 중 데이터에 없는 번호 (보고용)
    fixed: { raw: string; code: string; rule: 'zero-pad' | 'dash-position'; skuCount: number }[];
    customBins: { raw: string; code: string; skuCount: number }[];
    exceptions: { raw: string; skuCount: number }[];
  };
  export function planLocationMaster(rows: { positionCode: string; skuCount: number }[]): LocationMasterPlan;
  ```
  `rows` 는 `sku_shelf_positions` 의 고유 코드별 SKU 수. 랙은 데이터에 나온 것만, `binEnd` = 그 랙 숫자 칸의 최대 번호.

- [ ] **Step 1: 실패하는 테스트**
  - `['A-01-01','A-01-07','A-03-02']` → racks `A/1 binEnd 7`, `A/3 binEnd 2`, missingRackNumbers `[{ column:'A', rackNumbers:[2] }]`
  - `['Z-01-05','Z-01-105']` → `Z/1 binEnd 105`
  - `['M-07-03','M-07-꼭대기']` → `M/7 binEnd 3, customBins ['꼭대기']`
  - `['G-04-바닥']` 단독 → `G/4 binEnd null, customBins ['바닥']`
  - `['CC-4-1','CC-04-01']` → 랙 `CC/4 binEnd 1` 하나, `fixed` 에 `CC-4-1 → CC-04-01 zero-pad` (skuCount 합산 안 함, 원문별)
  - `['외부창고']` → racks 비어 있음, `exceptions [{ raw:'외부창고', skuCount }]`
- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/location-master-plan.spec.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: 커밋** — `선반 코드로 로케이션 마스터 계획을 세운다 (#1235)`

### Task 5: 적용 스크립트 (dry-run 기본, 늘리기만)

**Files:**
- Create: `scripts/sellmate/build-location-master.ts` (CLI `main` + `applyLocationMaster`)
- Modify: `scripts/sellmate/README.md` (실행 절 하나)
- Test: `scripts/sellmate/build-location-master.integration.spec.ts`

**Interfaces:**
- Consumes: Task 3 `syncRackBins`, Task 4 `planLocationMaster`/`LocationMasterPlan`, Task 1 `rackBinLocationCode`, `normalizePositionCode`, 판정 스크립트의 `connect`/`linkedResource` (`scripts/ops/cutover-preflight/db.ts`)
- Produces:
  ```ts
  export type ApplyReport = {
    columnsCreated: string[]; racksCreated: string[]; racksExtended: { rack: string; from: number; to: number }[];
    binsCreated: number; conflicts: { code: string; reason: string }[];
  };
  export async function applyLocationMaster(tx: DbTx, warehouseId: string, plan: LocationMasterPlan): Promise<ApplyReport>;
  ```
  - 열: 없으면 만든다. 랙: 없으면 `defaultBinStart 1`, `defaultBinEnd = binEnd ?? 1`, `autoGenerateBins = binEnd !== null` 로 만든다. 있고 `defaultBinEnd < binEnd` 면 끝 번호만 올린다. **작거나 같으면 그대로**(줄이지 않음). 그다음 `syncRackBins(tx, rackId)` 로 칸을 만든다. 커스텀 칸은 코드가 없으면 만든다.
  - **스크립트 경로에서 `syncRackBins` 결과의 `deleted` 는 항상 비어 있어야 한다.** 끝 번호를 줄이지 않으니 그렇다. 비어 있지 않으면 던져서 트랜잭션을 되돌린다.
  - 충돌: 칸을 만들기 전에 같은 `(warehouse_id, code)` 의 행이 다른 랙에 있거나 standard 가 아니면, 그 랙을 건너뛰고 `conflicts` 에 적는다. 이미 있는 랙이 `autoGenerateBins=false`(사람이 만든 수동 랙)인데 계획에 숫자 칸이 있으면, 자동 생성을 켜지 않고 그 랙을 `conflicts`(`수동 랙`)로 보고한다.
  - 연결: `connect()` 가 준 postgres.js 클라이언트를 `drizzle(sql, { schema: wmsSchema })` 로 감싸 `DbTx` 를 얻는다(`makeDb` 와 같은 방식).
  - CLI: `DATABASE_URL` 또는 `sst shell` 의 `Db` + `CORE_DB_NAME`(기본 `core`). 창고는 `is_sellable` 창고가 정확히 하나면 그것, 아니면 `--warehouse-id` 필수. 기본은 dry-run: 한 트랜잭션에서 `applyLocationMaster` 를 돌리고 보고한 뒤 **롤백**한다(그래서 dry-run 수치가 apply 와 같다). `--apply` 면 커밋. 출력: 계획의 fixed·customBins·exceptions·missingRackNumbers + ApplyReport + "선반 텍스트 중 로케이션으로 이어지는 SKU 비율". 원문 목록은 콘솔에만 찍고 파일로 남기지 않는다.

- [ ] **Step 1: 실패하는 통합 테스트** (`describeIfDb`, rollback tx)
  - `빈 창고에 계획대로 만든다`: plan(`A-01-01`,`A-01-03`,`M-07-꼭대기`,`M-07-02`) → 칸 `A-01-01..03`, `M-07-01..02`, `M-07-꼭대기` 존재
  - `두 번 돌리면 변화가 없다`: 두 번째 `ApplyReport` 의 모든 배열 비어 있음, `binsCreated 0`
  - `위치가 늘면 그 랙만 늘린다`: 첫 실행 `A-01-03` → 두 번째 계획에 `A-01-06` 추가 → `racksExtended [{ rack:'A-01', from:3, to:6 }]`
  - Review Focus 4: `위치가 줄어도 줄이지 않는다`: 첫 실행 `A-01-06` → 두 번째 `A-01-02` 만 → 칸 6개 그대로, `racksExtended` 비어 있음
  - Review Focus 5: `같은 코드의 zone 이 있으면 충돌로 보고하고 나머지는 계속한다`: zone `B-01-01` 미리 insert, plan `B-01-01`·`A-01-01` → `conflicts` 에 `B-01-01`, `A-01-01` 생성됨
- [ ] **Step 2: 실패 확인** — `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'build-location-master\.integration\.spec\.ts$'` → FAIL
- [ ] **Step 3: 구현 + README 절**
- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS. 로컬 core DB 에서 `DATABASE_URL=… npx tsx scripts/sellmate/build-location-master.ts` 가 dry-run 보고를 찍고 끝나는지(행 변화 0) 확인
- [ ] **Step 5: 커밋** — `셀메이트 선반 위치로 로케이션 마스터를 만드는 스크립트 (#1235)`

### Task 6: 판정 스크립트가 고쳐 읽은 코드로 잰다

**Files:**
- Modify: `scripts/ops/cutover-preflight/rules.ts` (함수 추가)
- Modify: `scripts/ops/cutover-preflight/checks/location.ts` ("로케이션 3")
- Test: `scripts/ops/cutover-preflight/rules.spec.ts`

**Interfaces:**
- Consumes: Task 2 `readShelfCode`, `normalizePositionCode`
- Produces: `export function shelfCodeLinks(shelfCodes: string[], locationCodes: string[]): { linked: number; unlinked: string[]; exceptions: string[] }` — `exception` 은 `exceptions` 로만, 나머지는 고쳐 읽은 `code` 가 `locationCodes` 에 있으면 `linked`, 없으면 `unlinked`(원문).

"로케이션 3"은 선반 고유 코드와 판매 창고 `locations.code` 를 읽어 `shelfCodeLinks` 에 넘긴다. `unlinked` 가 있으면 ✗(고치는 곳: `#1235 build-location-master.ts --apply`), `exceptions` 는 `r.info` 로 "사람이 정할 선반 텍스트 N개"만 센다(✗ 아님). 라이브 원문은 출력하지 않고 개수만.

- [ ] **Step 1: 실패하는 테스트** — `shelfCodeLinks(['CC-4-1','A-01-01','A-01-02','외부창고'], ['CC-04-01','A-01-01'])` → `{ linked: 2, unlinked: ['A-01-02'], exceptions: ['외부창고'] }`
- [ ] **Step 2: 실패 확인** — `npx jest scripts/ops/cutover-preflight/rules.spec.ts` → FAIL
- [ ] **Step 3: 구현 + `checks/location.ts` 연결**
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. 그리고 `npm run type-check` → 0, `npx jest --maxWorkers=3` → 실패 0
- [ ] **Step 5: 커밋** — `컷오버 판정이 선반 텍스트를 고쳐 읽은 코드로 로케이션과 잇는다 (#1235)`

---

## 실행 뒤 (사람·배포, 이 계획의 코드 밖)

- 현장 확인 세 가지(스펙 §7)를 본 뒤 규칙을 켜고 끈다.
- 라이브 dry-run 출력을 사용자와 함께 보고 `--apply`.
- core 배포(Task 3, 마이그 없음). 판정 스크립트 로케이션 1·3 초록 확인, 스테이션에서 자석 하나 스캔.
