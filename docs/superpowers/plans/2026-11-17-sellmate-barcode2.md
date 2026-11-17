# 셀메이트 바코드번호2 보조 바코드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 셀메이트 «현재고 전체» CSV 의 `바코드번호2` 를 core `sku_barcodes` 에 보조 바코드(`is_primary=false`)로 넣는다 — 가져오기와 일회성 백필 둘 다.

**Architecture:** 보조 바코드 배정 규칙을 순수 함수 하나(`scripts/sellmate/barcode2-plan.ts`)에 둔다. `import-products.ts` 는 대표 바코드 처리 뒤에 이 함수로 보조 바코드를 넣고, 새 `backfill-barcode2.ts` 는 이미 적재된 SKU 에 같은 함수로 보조 바코드만 넣는다(SKU·그룹·대표 바코드는 건드리지 않는다).

**Tech Stack:** TypeScript(tsx), postgres.js, drizzle-orm, jest.

**Spec:** `docs/superpowers/specs/2026-11-17-sellmate-barcode2-design.md`

## Global Constraints

- 대표 바코드 규칙은 그대로다. `바코드번호2` 는 대표가 비어 있어도 대표로 올리지 않는다.
- 다른 SKU 가 점유한 값은 넣지 않고 충돌로 보고만 한다. 이미 같은 SKU 에 달린 값(대표든 보조든)은 그대로 둔다.
- 한 실행 안에서 같은 값을 두 SKU 가 원하면 대표 바코드가 먼저 차지한다.
- `packing_unit` 은 NULL. 넣기는 `ON CONFLICT (barcode) DO NOTHING`.
- 백필은 기본 dry-run(읽기 전용 트랜잭션), `--apply` 로만 쓴다. `DRY_RUN=1` 과 `--apply` 동시 지정은 거부한다.
- 백필은 테넌트 1 core DB(`run.sh` 의 기본 `DB_NAME=core`)에만 돈다.
- 판정 스크립트(`scripts/ops/cutover-preflight`)는 바꾸지 않는다.
- 전체 `npx jest`·`npm run type-check` 는 PR 직전에 한 번만 `--maxWorkers=2` 로 돈다. 그 전엔 해당 스펙만 돌린다. E2E 스택이 떠 있으면 전체 실행 금지.
- 공개 레포다 — CSV 의 실제 상품명·바코드 값을 스펙·커밋에 옮기지 않는다. 픽스처는 가짜 값(`8800000000001` 꼴).

## Review Focus

- **A 의 `바코드번호2` 가 B 의 `바코드번호` 와 같은 CSV** — B 가 갖고 A 는 충돌. Task 1 테스트 `대표가 먼저 차지한다`.
- **백필을 두 번 돌림** — 두 번째 `--apply` 는 넣는 것 0. Task 3 통합 테스트 `두 번 돌려도 같다`.
- **`바코드번호2` 값이 이미 같은 SKU 의 대표로 core 에 있음**(다른 경로로 들어온 경우) — 그대로 두고 대표를 내리지 않는다. Task 3 통합 테스트 `대표를 내리지 않는다`.
- **`바코드번호2` 열이 없는 옛 xls 양식** — `barcode2` 가 빈 값이고 가져오기 동작은 지금과 같다. Task 2 테스트 `바코드번호2 열이 없으면 빈 값`.
- **`DRY_RUN=1` 과 `--apply` 를 함께 줌** — 거부. Task 3 은 `register-missing-barcodes.ts` 의 `parseCliArgs` 를 그대로 import 하므로 그 스펙이 지킨다(새 테스트 없음).

---

### Task 1: 보조 바코드 배정 규칙 (순수 함수)

**Files:**
- Create: `scripts/sellmate/barcode2-plan.ts`
- Test: `scripts/sellmate/barcode2-plan.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Barcode2Want { skuId: string; primary: string; secondary: string } // 빈 문자열 = 없음
  export interface Barcode2Plan {
    insert: { skuId: string; barcode: string }[];
    alreadyOk: number;
    conflicts: { skuId: string; barcode: string; ownerSkuId: string }[];
  }
  export function planSecondaryBarcodes(
    wants: readonly Barcode2Want[],
    taken: ReadonlyMap<string, string>, // 바코드 값 → 소유 SKU id (DB 현재 상태)
  ): Barcode2Plan;
  ```
  알고리즘(두 번 훑기): ① `primary` 가 비지 않았고 `taken` 에 없으면 `claimed` 에 `primary → skuId` 를 적는다(먼저 온 쪽). ② `secondary` 가 비었거나 같은 행의 `primary` 와 같으면 건너뛴다. 소유자 = `taken.get ?? claimed.get`. 소유자가 같은 SKU 면 `alreadyOk++`, 다른 SKU 면 충돌, 없으면 `claimed` 에 적고 `insert`. `taken` 은 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `barcode2-plan.spec.ts`, `describe('planSecondaryBarcodes')`:
  - `빈 값과 대표와 같은 값은 건너뛴다`: wants `[{s1, 'P1', ''}, {s2, 'P2', 'P2'}]`, taken 빈 맵 → `{ insert: [], alreadyOk: 0, conflicts: [] }`.
  - `core 에 없는 값은 넣는다`: `[{s1, 'P1', 'S1'}]` → `insert: [{ skuId: 's1', barcode: 'S1' }]`.
  - `대표가 비어도 보조로만 넣는다`: `[{s1, '', 'S1'}]` → insert 에 `S1` 하나.
  - `이미 같은 SKU 에 있으면 그대로 둔다`: taken `{S1→s1}` → `alreadyOk: 1`, insert 0.
  - `다른 SKU 가 점유하면 충돌로만 남긴다`: taken `{S1→s9}` → `conflicts: [{ skuId: 's1', barcode: 'S1', ownerSkuId: 's9' }]`.
  - `대표가 먼저 차지한다`: wants `[{s1, 'P1', 'X'}, {s2, 'X', ''}]`(s1 이 앞), taken 빈 맵 → insert 0, `conflicts: [{ skuId: 's1', barcode: 'X', ownerSkuId: 's2' }]`.
  - `같은 보조 값을 두 SKU 가 원하면 먼저 온 쪽`: `[{s1,'P1','S'},{s2,'P2','S'}]` → insert `[{s1,'S'}]`, conflicts `[{s2,'S',ownerSkuId:'s1'}]`.

- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/barcode2-plan.spec.ts` → 모듈 없음으로 FAIL.

- [ ] **Step 3: `planSecondaryBarcodes` 구현** — 위 Interfaces 의 알고리즘. 파일 머리 주석에 #1356 과 «대표 규칙은 그대로» 한 줄.

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS 7.

- [ ] **Step 5: 커밋** — `[scripts] 셀메이트 바코드번호2 보조 바코드 배정 규칙 (#1356)` (끝에 `Claude-Session:` 줄).

---

### Task 2: 가져오기가 바코드번호2 를 보조로 넣는다

**Files:**
- Modify: `scripts/sellmate/import-products.ts` (`COLUMN_CANDIDATES`·`OVERRIDES` 49–70, `ParsedItem` 77–88, `parseFile` 133–146, `Sku`·`buildPlan` 149–216, 바코드 단계 361–425, 머리 주석 환경변수 목록)
- Test: `scripts/sellmate/import-products.spec.ts`

**Interfaces:**
- Consumes: Task 1 `planSecondaryBarcodes`, `Barcode2Want`.
- Produces: `ParsedItem.barcode2: string`, `Sku.barcode2: string` (빈 문자열 = 없음). Task 3 이 `parseFile`·`dedupeByItemCode` 로 CSV 를 읽고 `ParsedItem.barcode`·`barcode2`·`itemCode` 를 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `import-products.spec.ts` 에 새 헤더 상수 `HEADER2 = [...HEADER, '바코드번호2']` 를 두고:
  - `바코드번호2 를 따로 읽고 수식 꼴은 벗긴다`: 행 `['P1','100','상품1','I1','', '="B1"', '="S1"']` → `items[0]` 이 `{ barcode: 'B1', barcode2: 'S1' }`.
  - `바코드번호2 열이 없으면 빈 값`: 기존 `HEADER` 로 파싱 → `items[0].barcode2 === ''`.
  - `buildPlan 이 barcode2 를 SKU 로 넘긴다`: 단독 상품 하나와 옵션 상품 둘 → 모든 `skus[i].barcode2` 가 입력값과 같다.

- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/import-products.spec.ts` → 새 세 개 FAIL.

- [ ] **Step 3: 파싱·계획 구현** — `COLUMN_CANDIDATES.barcode2 = ['바코드번호2']`, `OVERRIDES.barcode2 = process.env.COL_BARCODE2`, `parseFile` 에서 `barcode2: unwrapFormula(get(row, cols.barcode2))`, `buildPlan` 의 세 `skus.push` 에 `barcode2: it.barcode2`. 머리 주석 환경변수 줄에 `COL_BARCODE2` 추가. `barcode` 후보 목록은 바꾸지 않는다.

- [ ] **Step 4: 통과 확인** — 같은 명령 → 전부 PASS.

- [ ] **Step 5: 바코드 단계에 보조 바코드 넣기** — 대표 바코드 INSERT(`:397-400`) 바로 뒤, 같은 트랜잭션에서:
  1. `wants: Barcode2Want[]` = `skus` 중 `skuIdByCode` 에 있는 것 → `{ skuId, primary: s.barcode, secondary: s.barcode2 }`.
  2. `ownerByBarcode` 에 없는 `secondary` 값들의 소유자를 기존 패턴(`SELECT barcode, sku_id FROM sku_barcodes WHERE barcode IN …`, `chunk`)으로 더 읽어 같은 맵에 넣는다. 이 맵은 이미 이번 실행의 대표 배정을 담고 있으므로 그대로 `taken` 으로 넘긴다.
  3. `planSecondaryBarcodes(wants, ownerByBarcode)` 의 `insert` 를 `INSERT INTO sku_barcodes (sku_id, barcode, is_primary, updated_at) … is_primary=false … ON CONFLICT (barcode) DO NOTHING` 으로 chunk 삽입.
  4. `Summary` 에 `secondaryInserted`·`secondaryAlreadyOk`·`secondaryConflicts`(Task 1 의 conflict 모양) 를 더하고, 출력에 `✔ sku_barcodes 보조(바코드번호2): 신규 N개 / 기존 유지 M개` 와 충돌 목록(앞 20개, 기존 충돌 출력과 같은 꼴, 제목에 «보조»)을 더한다. `ROLLBACK=1` 경로도 같은 수치를 찍는다.
  DRY_RUN 분기 샘플 출력 줄에 `barcode2=${s.barcode2 || '(없음)'}` 를 더한다.

- [ ] **Step 6: 수동 확인 (DB 없이)** — `DRY_RUN=1 npx tsx scripts/sellmate/import-products.ts /home/pauseb/다운로드/01_현재고_전체_20261016.csv` → 열 매핑에 `barcode2 → [7] "바코드번호2"`, 샘플에 `barcode2=` 가 찍힌다. (DB 반영 경로는 Task 3 통합 테스트와 같은 규칙 함수를 쓰므로 여기서 따로 돌리지 않는다.)

- [ ] **Step 7: 커밋** — `[scripts] 셀메이트 가져오기가 바코드번호2 를 보조 바코드로 넣는다 (#1356)`.

---

### Task 3: 이미 적재된 SKU 백필 스크립트

**Files:**
- Create: `scripts/sellmate/backfill-barcode2.ts`
- Test: `scripts/sellmate/backfill-barcode2.integration.spec.ts`
- Modify: `scripts/sellmate/README.md` (`## 바코드 없는 SKU 에 SKU 코드 등록` 절 바로 앞에 새 절), `scripts/sellmate/run.sh` 머리 사용 예 한 줄

**Interfaces:**
- Consumes: Task 1 `planSecondaryBarcodes`; Task 2 `parseFile`, `dedupeByItemCode`, `ParsedItem`; `readRows`(`./parse`); `parseCliArgs`(`./register-missing-barcodes`); `wmsTables`, `wmsSchema`, `DbTx`(`apps/core/src/modules/inventory/schema/inventory.schema`).
- Produces:
  ```ts
  export interface Barcode2Backfill {
    plan: Barcode2Plan;
    notInCore: string[];          // 보조 후보가 있는데 skus.code 로 못 찾은 옵션정보일련번호
    stock: Map<string, number>;   // skuId → stock_ledgers.qty 합 (insert·conflicts 의 SKU 만)
  }
  export async function readBarcode2Backfill(tx: DbTx, items: readonly ParsedItem[]): Promise<Barcode2Backfill>;
  export async function applyBarcode2Backfill(tx: DbTx, plan: Barcode2Plan): Promise<number>; // 실제로 들어간 행 수
  ```

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** — `build-location-master.integration.spec.ts` 의 틀(`DATABASE_URL` 있을 때만 `describe`, `makeDb`·`inRollbackTx`, 실행 명령 주석)을 따른다. SKU 는 `logistics-fixtures.ts` 의 holder 시드 + `seedSku` 로 만들고, `ParsedItem` 은 `itemCode: skuCode` 로 직접 만든다(파일 안 거침). 바코드 값은 테스트마다 `randomUUID` 접미로 유일하게. `describeIfDb('backfill-barcode2 (DB integration)')`:
  - `없는 보조 값만 is_primary=false 로 넣는다`: SKU A(대표 `PA` 를 미리 `is_primary=true` 로 넣음), item `{A, barcode:'PA', barcode2:'SA'}` → `applyBarcode2Backfill` 반환 1, A 의 행이 `[{PA,true},{SA,false}]`, `packing_unit` NULL.
  - `대표를 내리지 않는다`: A 의 대표가 `SA` 인 상태에서 item `{A,'PA','SA'}` → `plan.alreadyOk === 1`, insert 0, `SA` 는 여전히 `is_primary=true`.
  - `다른 SKU 가 점유한 값은 넣지 않는다`: B 가 `SA` 를 가진 상태 → `plan.conflicts` 에 `{ skuId: A, barcode: 'SA', ownerSkuId: B }`, A 에 행 추가 없음.
  - `core 에 없는 SKU 는 따로 센다`: `itemCode: 'NOPE-…'`, barcode2 있음 → `notInCore` 에 그 코드, plan 비어 있음.
  - `두 번 돌려도 같다`: 첫 apply 뒤 다시 `readBarcode2Backfill` → `plan.insert` 길이 0, `alreadyOk` 1.

- [ ] **Step 2: 실패 확인** — `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'backfill-barcode2\.integration\.spec\.ts$'` → 모듈 없음으로 FAIL. (로컬 `core` DB 마이그가 깨져 있으면 스크래치 DB 에 마이그를 적용해 `DATABASE_URL` 로 넘긴다.)

- [ ] **Step 3: 구현** — `readBarcode2Backfill`: 보조 후보(`barcode2` 가 비지 않고 `barcode` 와 다른 item)의 `itemCode` 로 `skus` 를 chunk(1000) 조회 → 못 찾은 것은 `notInCore`. 찾은 item 전부(대표 선점을 위해 후보 아닌 것도)로 `wants` 를 만들고, `wants` 의 대표·보조 값 전체로 `sku_barcodes` 소유자를 chunk 조회해 `taken` 을 만든다. `planSecondaryBarcodes` 후 insert·conflicts 의 SKU 에 대해 `stock_ledgers.qty` 합을 `register-missing-barcodes.ts` 의 `readPlan` 과 같은 방식으로 읽는다. drizzle 쿼리 빌더만 쓴다(원시 SQL·`as` 금지). `applyBarcode2Backfill`: chunk insert `isPrimary: false`, `.onConflictDoNothing({ target: wmsTables.skuBarcodes.barcode })`, `.returning({ id })` 길이 합.
  `main()`: 인자 = CSV 경로(없으면 사용법 출력 후 exit 1), `DATABASE_URL` 필수, `parseCliArgs`. `readRows` → `parseFile(rows, file, true)` → `dedupeByItemCode`. dry-run 은 `accessMode: 'read only'` 트랜잭션에서 읽고 출력만, `--apply` 는 같은 읽기 후 apply 하고 넣은 수를 출력. 출력(앞 10개 목록은 충돌·notInCore 만):
  ```
  📄 바코드번호2 후보 N행 (대표와 다른 값)
     core 에 넣을 것 N  (재고 있는 SKU N)
     이미 같은 SKU N
     다른 SKU 가 점유(충돌, 넣지 않음) N  (재고 있는 SKU N)
     core 에 SKU 없음 N
  ```
  머리 주석: 목적(#1356), «register-missing-barcodes 보다 먼저», `--apply` 전 최신 «현재고 전체» 를 다시 받을 것, 실행 예 `DRY_RUN=1 bash scripts/sellmate/run.sh live backfill-barcode2 <csv>` / `bash scripts/sellmate/run.sh live backfill-barcode2 <csv> --apply`.

- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS 5. 이어 `npx jest scripts/sellmate` → 실패 0(통합 스펙은 skip).

- [ ] **Step 5: README·run.sh** — README 새 절 `## 바코드번호2 백필 (\`backfill-barcode2.ts\`, #1356)`: 무엇을 넣고 무엇을 건드리지 않는지, dry-run/`--apply` 명령, 순서(이 백필 → `register-missing-barcodes`), `--apply` 직전 CSV 재다운로드, 완료 신호(다시 돌린 dry-run 의 «core 에 넣을 것» 0). `register-missing-barcodes` 절의 «#1356 백필 뒤» 문구와 맞춘다. run.sh 사용 예에 `DRY_RUN=1 bash scripts/sellmate/run.sh live backfill-barcode2 <현재고 CSV>` 한 줄.

- [ ] **Step 6: 커밋** — `[scripts] 셀메이트 바코드번호2 백필 스크립트 (#1356)`.

---

### Task 4: PR 직전 검증과 PR 정리

- [ ] **Step 1: E2E 스택 확인** — `docker ps --format '{{.Names}}' | grep -i -E 'kafka|e2e'` 와 `ss -ltn | grep -E ':9092|:3000'` 로 E2E 스택이 떠 있지 않은지 본다. 떠 있으면 멈추고 사용자에게 묻는다.
- [ ] **Step 2: 워크트리 하위 node_modules 링크** — `apps/admin-web`·`apps/wallet-web`·`native/warehouse-app` 의 `node_modules` 가 없으면 메인 체크아웃의 것을 심볼릭 링크한다.
- [ ] **Step 3: 전체 게이트 한 번씩** — `npm run type-check` → 에러 0. `npx jest --maxWorkers=2` → 실패 0(근태 스펙 ICU 처럼 로컬 환경 탓으로 develop 에서도 빨간 것은 develop 에서 같은 스펙을 돌려 확인하고 PR 본문에 적는다).
- [ ] **Step 4: PR 본문 갱신·ready** — PR #1371 본문을 실제 변경·검증 결과·운영 순서(dry-run → 최신 CSV 로 `--apply` → 다시 dry-run 0 확인 → `register-missing-barcodes`)로 고치고 `Refs #1356` 유지. 사용자 확인 뒤 `gh pr ready 1371`.
