# 셀메이트 저녁 맞추기 (#1304) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 셀메이트 마켓 변화를 매일 저녁 core 원장에 ADJUST_UP/DOWN 으로 반영하고, core 가용을 셀메이트 재고 수정 CSV 로 돌려보내는 개발자용 스크립트를 만든다. 컷오버 판정 검사 3개도 함께 만든다.

**Architecture:**
- 계산·판정·짝 짓기·CSV 읽기/쓰기는 DB 없는 순수 모듈(`scripts/sellmate/reconcile/*`)로 둔다.
- DB 접근은 postgres.js 저장소 한 파일에 모은다. CLI(`scripts/sellmate/evening-reconcile.ts`)는 하위 명령 다섯 개를 그 위에 조립한다.
- 상태는 core 의 새 테이블 다섯 개에 둔다. 원장 쓰기는 기존 `applyStockDelta` 를 쓴다.

**Tech Stack:** TypeScript(tsx), postgres.js, drizzle schema/migration(core), jest.

**Spec:** `docs/superpowers/specs/2026-11-17-sellmate-evening-reconcile-design.md` (규칙 정본: `docs/cutover-phase1-core-stock-owner` 브랜치의 `docs/superpowers/specs/2026-11-11-cutover-phase1-core-stock-owner-design.md` «저녁 맞추기»)

## Global Constraints

- 모든 하위 명령은 dry-run 이 기본이고 `--apply` 일 때만 쓴다. dry-run 은 같은 트랜잭션을 끝까지 돌린 뒤 롤백하고 파일을 쓰지 않는다.
- 원장 이벤트 `reason`(출처)은 `'sellmate-reconcile'` 이다. advisory lock 키는 `'sellmate-stock-sync'` 이다(`pg_advisory_xact_lock(hashtext(...))`, sync-stock·handover 와 같다).
- 재고 grain 은 부천 창고(`stock-delta.ts` `BUCHEON_WAREHOUSE_ID`)뿐이다. 다른 창고(중국 등) 원장은 계산에 넣지 않는다.
- `excluded.ts` 품목은 양방향 모두 건드리지 않고, 짝 못 지은 품목으로 세지 않는다.
- 짝 못 지은 품목, CSV 에서 사라진 품목, SKU 가 바뀐 품목이 하나라도 있으면 `init`·`apply` 는 쓰지 않고 종료 코드 1 로 끝난다.
- 바코드는 `formula-barcodes-plan.ts` `unwrapFormula` 후 trim 한다. 셀메이트 쪽과 core `sku_barcodes` 쪽 모두 그렇다.
- 스펙 안에서 `dotenv.config()` 를 부르지 않는다. DB 스펙은 `DATABASE_URL ? describe : describe.skip` 가드를 단다.
- 공개 레포다. 픽스처에 실제 품목명·바코드·테넌트 값을 쓰지 않는다(`TEST-0001`, `8800000000001` 꼴).
- 단위 테스트는 `npx jest <경로> --maxWorkers=2` 로 대상만 돌린다. **전체 `npx jest`·`npm run type-check` 는 Task 10 에서 한 번만** 돌린다. 같은 머신에서 다른 세션이 돌고 있다.
- 통합 스펙 실행(`npm run test:core:integration:local`)은 컨테이너를 띄운다. 다른 세션의 E2E 스택이 떠 있으면(`docker ps` 에 kafka·postgres 다수) 사용자에게 먼저 묻는다.
- 문서·주석·출력 문구는 한국어로 쓴다.

## Review Focus

1. **CSV 숫자 칸 이상**(빈칸·소수·`1,234`·`N/A`): 0 으로 추정하지 않고 오류로 중단한다. 현재재고 음수는 허용하고, 미발송 음수는 오류다. → Task 3 `parseReconcileStock` 스펙.
2. **같은 옵션정보일련번호가 여러 행에** 있고 값이 다를 때: 중단한다. 값이 같으면 하나로 합친다. → Task 3.
3. **파일 이름에 스냅샷 시각이 없거나**, 직전 닫기 입력보다 이른 CSV: 거절한다. → Task 7 `runApply` 스펙.
4. **바코드가 `="8800…"` 수식이거나 앞뒤 공백**이 있을 때(core `sku_barcodes` 에도 수식형이 있다): 벗기고 같은 바코드로 짝짓는다. → Task 4 `pairItems` 스펙.
5. **SKU 재고가 부천 말고 다른 창고에도** 있을 때: 부천 원장만 센다. → Task 6 `readCoreFigures` 통합 스펙.

---

## 파일 지도

| 파일 | 책임 |
|------|------|
| `scripts/sellmate/reconcile/reconcile-math.ts` (+spec) | `S`·`initState`·`planApply` — 정본 산식 |
| `scripts/sellmate/reconcile/close-verdict.ts` (+spec) | 닫기 판정 표·확정 기준값 |
| `scripts/sellmate/reconcile/stock-csv.ts` (+spec) | 재고 현황 CSV → 품목 행, sha256, 스냅샷 시각 |
| `scripts/sellmate/reconcile/orders-csv.ts` (+spec) | 미발송 주문 목록 → 자사몰 display_id |
| `scripts/sellmate/reconcile/upload-csv.ts` (+spec) | 재고 수정 업로드 CSV 렌더·쓰기 |
| `scripts/sellmate/reconcile/pairing.ts` (+spec) | 짝 짓기, 품목 상태와 대조 |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | 테이블 5개 |
| `apps/core/drizzle/<ts>_add-sellmate-reconcile-tables.sql` | 생성 마이그 |
| `scripts/sellmate/stock-delta.ts` | ADJUST_UP 로케이션 인자 |
| `scripts/sellmate/reconcile/reconcile-store.ts` (+integration spec) | DB 읽기·쓰기 전부 |
| `scripts/sellmate/evening-reconcile.ts` (+integration spec) | CLI, 하위 명령 5개 |
| `scripts/sellmate/recalc-sellable.ts` | 함수 추출, reason 추가 |
| `scripts/sellmate/run.sh` | `WITH_MEDUSA=1` |
| `scripts/sellmate/sync-stock.ts`, `handover-stock-addback.ts` (+guard spec) | init 뒤 거절 |
| `scripts/ops/cutover-preflight/checks/reconcile.ts`, `rules.ts`, `index.ts` (+rules spec) | 판정 검사 3개 |
| `scripts/sellmate/README.md`, `scripts/sellmate/LAUNCH.md` | 실행 절차 |

---

### Task 1: 정본 산식 (`reconcile-math.ts`)

**Files:**
- Create: `scripts/sellmate/reconcile/reconcile-math.ts`
- Test: `scripts/sellmate/reconcile/reconcile-math.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function sellmateAvail(current: number, unshipped: number): number; // current − unshipped, 음수 그대로
  export function initState(s: number): { baseline: number; carry: number }; // { baseline: s, carry: max(0, −s) }
  export type ItemFigures = {
    s: number; baseline: number; carry: number;
    onHand: number; reservedAll: number; reservedHandedOver: number; unshipped: number;
  };
  export type ApplyResult = { delta: number; carryAfter: number; uploadAvail: number; uploadCurrent: number };
  export function planApply(f: ItemFigures): ApplyResult;
  ```

- [ ] **Step 1: 실패하는 스펙 작성** — 정본 시나리오마다 `it` 하나:
  ```ts
  it('init 음수 품목은 기준값을 음수 그대로, 같은 양을 이월로 둔다', () => {
    expect(initState(-3)).toEqual({ baseline: -3, carry: 3 });
    expect(initState(6)).toEqual({ baseline: 6, carry: 0 });
  });
  it('init 음수 품목은 변화가 없으면 다음 회에 이월이 두 배가 되지 않는다', () => {
    expect(planApply({ s: -3, baseline: -3, carry: 3, onHand: 0, reservedAll: 0, reservedHandedOver: 0, unshipped: 5 }))
      .toEqual({ delta: 0, carryAfter: 3, uploadAvail: 0, uploadCurrent: 5 });
  });
  it('드레인 중 넘긴 주문 출고는 차이 0이고 넘긴 주문 예약은 가용에서 빼지 않는다', () => {
    expect(planApply({ s: 6, baseline: 6, carry: 0, onHand: 6, reservedAll: 3, reservedHandedOver: 3, unshipped: 1 }))
      .toEqual({ delta: 0, carryAfter: 0, uploadAvail: 6, uploadCurrent: 7 });
  });
  it('마켓 주문 2개는 core 에서 2 빠진다', () => {
    expect(planApply({ s: 4, baseline: 6, carry: 0, onHand: 6, reservedAll: 0, reservedHandedOver: 0, unshipped: 6 }))
      .toEqual({ delta: -2, carryAfter: 0, uploadAvail: 4, uploadCurrent: 10 });
  });
  it('마켓 취소·반품 1개는 core 에 1 더한다', () => {
    expect(planApply({ s: 5, baseline: 4, carry: 0, onHand: 4, reservedAll: 0, reservedHandedOver: 0, unshipped: 0 }).delta).toBe(1);
  });
  it('입고로 여유가 생기면 이월부터 갚고 남는 것만 올린다', () => {
    expect(planApply({ s: 0, baseline: 0, carry: 3, onHand: 5, reservedAll: 0, reservedHandedOver: 0, unshipped: 0 }))
      .toEqual({ delta: -3, carryAfter: 0, uploadAvail: 2, uploadCurrent: 2 });
  });
  it('자사몰 확정 예약은 깎지 않는다 — 여유가 없으면 이월로 간다', () => {
    // onHand 5 = 넘긴 주문 예약 2 + T 뒤 자사몰 예약 3 → A=2, R=0
    expect(planApply({ s: 2, baseline: 4, carry: 0, onHand: 5, reservedAll: 5, reservedHandedOver: 2, unshipped: 0 }))
      .toEqual({ delta: 0, carryAfter: 2, uploadAvail: 0, uploadCurrent: 0 });
  });
  ```
- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/reconcile/reconcile-math --maxWorkers=2` → 모듈 없음으로 FAIL
- [ ] **Step 3: 구현** — 산식은 설계 문서 «계산»과 같다:
  - `A = onHand − (reservedAll − reservedHandedOver)`, `R = max(0, onHand − reservedAll)`
  - `net = (s − baseline) − carry`
  - `net ≥ 0` 이면 `delta = net`, `carryAfter = 0`. 아니면 `down = min(−net, R)`, `delta = −down`, `carryAfter = −net − down`
  - `uploadAvail = max(0, A + delta − carryAfter)`, `uploadCurrent = uploadAvail + unshipped`
  - 정수가 아닌 입력은 throw 한다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: 커밋** — `git commit -m "셀메이트 저녁 맞추기: 차이·이월·올릴 값 산식 (#1304)"` (+ Claude-Session 줄)

### Task 2: 닫기 판정 (`close-verdict.ts`)

**Files:**
- Create: `scripts/sellmate/reconcile/close-verdict.ts`
- Test: `scripts/sellmate/reconcile/close-verdict.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CloseVerdict = 'ok_new_orders' | 'ok_shipped_after' | 'ok_return_after' | 'shipped_before_upload' | 'mismatch' | 'missing';
  export type CloseInput = { uploadedCurrent: number; refUnshipped: number; now: { current: number; unshipped: number } | null };
  export function judgeClose(i: CloseInput): { verdict: CloseVerdict; correctedCurrent: number | null };
  export function isOkVerdict(v: CloseVerdict): boolean; // ok_* 셋만 true
  export type Accept = 'landed' | 'not_landed' | null;
  export function confirmedBaseline(a: { uploadedCurrent: number; refUnshipped: number; applyS: number; accept: Accept }): number;
  ```

- [ ] **Step 1: 실패하는 스펙** — 설계 문서 표 한 줄마다 `it` 하나. `Δc = now.current − uploadedCurrent`, `Δu = now.unshipped − refUnshipped`:
  - `(10, 4, {10, 6})` → `ok_new_orders`, `(10, 4, {10, 4})` → `ok_new_orders`
  - `(10, 4, {8, 2})` → `ok_shipped_after`
  - `(10, 4, {11, 4})` → `ok_return_after`
  - `(10, 4, {10, 2})` → `shipped_before_upload`, `correctedCurrent: 8`
  - `(10, 4, {7, 4})` → `mismatch`, `(10, 4, null)` → `missing`
  - 그 밖의 판정은 `correctedCurrent: null`
  - `confirmedBaseline`:
    - `{uploadedCurrent:10, refUnshipped:4, applyS:3, accept:null}` → `6`
    - `accept:'landed'` → `6`
    - `accept:'not_landed'` → `3`
  - 고친 CSV 뒤 다시 닫기: `judgeClose({uploadedCurrent: 8, refUnshipped: 2, now: {current: 8, unshipped: 2}})` → `ok_new_orders`, `confirmedBaseline` → `6`
- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/reconcile/close-verdict --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현** — 판정 순서는 위 목록 순서대로다(missing → ok_new_orders → ok_shipped_after → ok_return_after → shipped_before_upload → mismatch). `correctedCurrent = uploadedCurrent + Δu`. `confirmedBaseline` 은 `not_landed` 면 `applyS`, 아니면 `uploadedCurrent − refUnshipped`.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `"셀메이트 저녁 맞추기: 닫기 판정 표 (#1304)"`

### Task 3: CSV 읽기·쓰기 (`stock-csv.ts`, `orders-csv.ts`, `upload-csv.ts`)

**Files:**
- Create: `scripts/sellmate/reconcile/stock-csv.ts`, `orders-csv.ts`, `upload-csv.ts`
- Test: `scripts/sellmate/reconcile/csv.spec.ts`

**Interfaces:**
- Consumes: `parse.ts` `readRows`·`detectColumns`, `excluded.ts` `excludedReason`, `formula-barcodes-plan.ts` `unwrapFormula`, `clear-reservations.ts` `parseCutoff`
- Produces:
  ```ts
  // stock-csv.ts
  export type SellmateStockRow = { optionSerial: string; productSerial: string; name: string; barcode: string; current: number; unshipped: number };
  export type StockCsv = { rows: SellmateStockRow[]; excluded: Map<string, number>; excludedSerials: Set<string>; errors: string[] };
  export function parseSignedInt(raw: string): number | null;
  export function parseReconcileStock(table: string[][], file: string): StockCsv;
  export async function readStockCsv(file: string): Promise<StockCsv & { sha256: string; snapshotAt: Date }>;
  // orders-csv.ts
  export function parseOwnMallDisplayIds(table: string[][], ownMallChannel: string): { displayIds: number[]; errors: string[] };
  // upload-csv.ts
  export type UploadLine = { barcode: string; current: number };
  export function renderUploadCsv(lines: readonly UploadLine[]): string;
  export function writeUploadCsv(filePath: string, lines: readonly UploadLine[]): void;
  ```

- [ ] **Step 1: 실패하는 스펙**
  - `parseSignedInt`:
    - `'-3'→-3`, `'1,234'→1234`, `' 7 '→7`
    - `''`·`'1.5'`·`'N/A'`·`'1e3'` → `null`
  - `parseReconcileStock`:
    - 헤더 `옵션정보일련번호,상품일련번호,상품명,바코드번호(서식),현재재고,미발송주문수` 를 읽는다.
    - 바코드 `'="8800000000001" '` → `'8800000000001'`
    - 현재재고 `-2` 는 허용한다.
    - 미발송 `-1` 은 `errors` 1건이다.
    - 현재재고 `''` 는 `errors` 1건이다(0 으로 추정 금지).
    - 같은 옵션정보일련번호 두 행이 값이 같으면 `rows` 1건, 다르면 `errors` 1건이다.
    - 상품일련번호 `'13248'`(excluded) 행은 `rows` 에서 빠지고 `excludedSerials` 에 옵션정보일련번호가 들어간다.
    - 미발송 열이 없는 헤더는 throw 한다.
  - `parseOwnMallDisplayIds`:
    - 헤더 `판매처,주문번호`, 행 `[자사몰,20261120-1234]`·`[쿠팡,9000000001]`·`[자사몰,20261120-1234]` 이고 `ownMallChannel='자사몰'` 이면 `displayIds: [1234]` 다(중복 제거).
    - 자사몰 행의 주문번호가 `/^\d{8}-(\d+)$/` 에 안 맞으면 `errors` 1건이다.
  - `renderUploadCsv([{barcode:'8800000000002', current:5}, {barcode:'8800000000001', current:0}])` → `'바코드번호,재고수량\r\n8800000000001,0\r\n8800000000002,5\r\n'`(바코드 순 정렬)
- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/reconcile/csv --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현**
  - 열 후보:
    - 재고: `itemCode` 는 sync-stock 과 같다. `barcode: ['바코드번호(서식)','바코드번호']`(`COL_BARCODE` 로 덮음).
    - 주문: `channel: ['판매처','판매처명']`(`COL_CHANNEL`), `orderNo: ['주문번호','판매처주문번호']`(`COL_ORDER_NO`).
  - `readStockCsv` 의 `snapshotAt` 은 `parseCutoff(path.basename(file))` 이다. 시각을 못 읽으면 throw 한다. `sha256` 은 파일 바이트로 낸다.
  - `writeUploadCsv` 의 인코딩은 `UPLOAD_ENCODING`(기본 `euc-kr`)이다. iconv-lite 를 쓴다.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `"셀메이트 저녁 맞추기: 재고·주문 CSV 읽기, 업로드 CSV 쓰기 (#1304)"`

### Task 4: 짝 짓기와 상태 대조 (`pairing.ts`)

**Files:**
- Create: `scripts/sellmate/reconcile/pairing.ts`
- Test: `scripts/sellmate/reconcile/pairing.spec.ts`

**Interfaces:**
- Consumes: Task 3 `SellmateStockRow`
- Produces:
  ```ts
  export type UnpairedReason = 'no_core_sku' | 'core_barcode_ambiguous' | 'empty_barcode' | 'barcode_shared' | 'code_barcode_conflict' | 'sku_shared';
  export type CoreIndex = { skuIdByCode: ReadonlyMap<string, string>; skuIdsByBarcode: ReadonlyMap<string, readonly string[]> };
  export type Pair = { optionSerial: string; productSerial: string; name: string; barcode: string; skuId: string; matchedBy: 'code' | 'barcode' };
  export type Unpaired = { optionSerial: string; productSerial: string; name: string; barcode: string; skuId: string | null; reason: UnpairedReason };
  export function pairItems(rows: readonly SellmateStockRow[], core: CoreIndex): { pairs: Pair[]; unpaired: Unpaired[] };
  export type StateRow = { skuId: string; optionSerial: string; baseline: number; carry: number; frozen: boolean };
  export type StateComparison = { known: Pair[]; fresh: Pair[]; missing: StateRow[]; skuChanged: { pair: Pair; state: StateRow }[]; toFreeze: StateRow[] };
  export function compareWithState(pairs: readonly Pair[], states: readonly StateRow[], excludedSerials: ReadonlySet<string>): StateComparison;
  ```

- [ ] **Step 1: 실패하는 스펙** — 사유마다 `it` 하나:
  - code 일치 → `matchedBy:'code'`
  - code 없음 + 바코드가 core SKU 하나 → `'barcode'`
  - 둘 다 없음 → `no_core_sku`
  - 바코드가 core SKU 둘 → `core_barcode_ambiguous`
  - 바코드 빈칸(code 일치여도) → `empty_barcode`
  - 셀메이트 두 옵션이 같은 바코드 → 둘 다 `barcode_shared`
  - code 로 skuA, 바코드로 skuB → `code_barcode_conflict`
  - 두 옵션이 같은 SKU → 둘 다 `sku_shared`
  - **수식형 core 바코드**: `skuIdsByBarcode` 는 저장소가 이미 벗겨 넣는다. 스펙은 `'8800000000001'` 키로 짝지어짐을 본다(Review Focus 4).
  - `compareWithState`:
    - 상태 있는 짝 → `known`, 상태 없는 짝 → `fresh`
    - 상태가 있는데 짝도 excluded 도 아님 → `missing`
    - 같은 optionSerial 인데 skuId 다름 → `skuChanged`
    - optionSerial 이 `excludedSerials` 에 있고 상태가 frozen 아님 → `toFreeze`
    - frozen 상태인데 다시 짝이 나타나면 `fresh`(새로 시작)
- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/reconcile/pairing --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현** — 한 품목에 사유가 여럿이면 위 목록의 앞 사유 하나만 적는다. `barcode_shared`·`sku_shared` 는 CSV 전체를 본 뒤 두 번째 패스로 매긴다.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `"셀메이트 저녁 맞추기: 셀메이트 품목↔core SKU 짝 짓기 (#1304)"`

### Task 5: 상태 테이블과 마이그

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`skuShelfPositions` 뒤에 정의, `wmsTables`·`wmsSchema` 맵에 추가)
- Create: `apps/core/drizzle/<ts>_add-sellmate-reconcile-tables.sql`, `apps/core/drizzle/meta/*` (생성물)

**Interfaces:**
- Produces (테이블·칸 이름 — Task 6 의 SQL 이 쓴다):

| 테이블 | 칸 |
|--------|----|
| `sellmate_item_pairs` | `option_serial varchar(64) PK`, `product_serial varchar(64)`, `item_name text`, `barcode varchar(128)`, `sku_id uuid null → skus(restrict)`, `matched_by varchar(16) null`, `unpaired_reason varchar(32) null`, `updated_at timestamptz` |
| `sellmate_reconcile_runs` | `id uuid PK default random`, `kind varchar(16)`('init'/'apply'), `status varchar(24)`('closed'/'awaiting_close'), `input_sha256 char(64) unique`, `input_snapshot_at timestamptz`, `cutover_at timestamptz null`, `upload_file text null`, `close_input_sha256 char(64) null`, `close_snapshot_at timestamptz null`, `accepted jsonb null`, `created_at`, `closed_at null`. 부분 unique: `(kind) where kind='init'`, `(status) where status='awaiting_close'` |
| `sellmate_reconcile_items` | PK `(run_id, option_serial)`, `run_id → runs(cascade)`, `sku_id uuid`, `sellmate_current int`, `sellmate_unshipped int`, `s int`, `baseline_before int`, `carry_before int`, `delta int`, `carry_after int`, `upload_avail int null`, `uploaded_current int null`, `ref_unshipped int null`, `close_verdict varchar(32) null`, `accept varchar(16) null` |
| `sellmate_reconcile_states` | `sku_id uuid PK → skus(restrict)`, `option_serial varchar(64) unique`, `baseline int`, `carry int check(carry >= 0)`, `frozen boolean default false`, `last_run_id uuid → runs`, `updated_at` |
| `sellmate_handed_over_orders` | `sales_order_id uuid PK → sales_orders(restrict)`, `display_id int`, `medusa_order_id varchar(64)`, `run_id uuid → runs` |

- [ ] **Step 1: schema.ts 에 위 다섯 테이블을 drizzle 로 정의한다.** 파일의 기존 꼴(snake_case 이름, `timestamp(..., { withTimezone: true })`, `(t) => ({ ... })` 인덱스)을 따른다. 테이블 머리 주석에 «#1304 저녁 맞추기 전용, 앱 코드는 읽지 않는다»를 적는다.
- [ ] **Step 2: 마이그 생성** — `npm run db:generate:core -- --name add-sellmate-reconcile-tables`. 기대: 새 SQL 파일 1개에 `CREATE TABLE` 5개가 있고, 다른 테이블의 ALTER/DROP 은 0개다. 섞여 있으면 `git rm` 하고 schema 를 고친다.
- [ ] **Step 3: 커밋** — schema.ts + SQL + meta 를 **한 커밋**으로: `"core: 셀메이트 저녁 맞추기 상태 테이블 (#1304)"`. 적용 확인은 Task 6 통합 스펙이 한다(통합 러너가 마이그를 적용한다).

### Task 6: 저장소와 원장 쓰기 (`reconcile-store.ts`, `stock-delta.ts`)

**Files:**
- Modify: `scripts/sellmate/stock-delta.ts` (`StockDelta` 에 `upLocationId?: string`, 기본 `BUCHEON_RECEIVING_LOC_ID`)
- Create: `scripts/sellmate/reconcile/reconcile-store.ts`
- Test: `scripts/sellmate/reconcile/reconcile-store.integration.spec.ts`

**Interfaces:**
- Consumes: Task 4 `CoreIndex`·`Pair`·`Unpaired`·`StateRow`, Task 5 테이블
- Produces (모두 `tx: Sql` 은 postgres.js 트랜잭션):
  ```ts
  export const RECONCILE_SOURCE = 'sellmate-reconcile';
  export const STOCK_LOCK_KEY = 'sellmate-stock-sync';
  export async function lockStock(tx: Sql): Promise<void>;
  export async function reconcileTablesExist(sql: Sql): Promise<boolean>;      // to_regclass
  export async function reconcileInitExists(sql: Sql): Promise<boolean>;      // 테이블 없으면 false
  export async function handoverEventsExist(sql: Sql): Promise<boolean>;      // stock_events.reason='sellmate-handover'
  export async function loadCoreIndex(tx: Sql): Promise<CoreIndex>;           // sku_barcodes 바코드 unwrapFormula+trim
  export async function replacePairs(tx: Sql, pairs: readonly Pair[], unpaired: readonly Unpaired[]): Promise<void>;
  export async function loadStates(tx: Sql): Promise<StateRow[]>;
  export type CoreFigures = { onHand: number; reservedAll: number; reservedHandedOver: number };
  export async function readCoreFigures(tx: Sql, skuIds: readonly string[]): Promise<Map<string, CoreFigures>>;
  export async function singleRealLocation(tx: Sql, skuId: string): Promise<string | null>;
  export async function resolveMedusaOrderIds(medusa: Sql, displayIds: readonly number[]): Promise<Map<number, string>>;
  export async function resolveSalesOrders(tx: Sql, medusaOrderIds: readonly string[]): Promise<Map<string, string>>; // medusa id → sales_order_id
  export type RunRow = { id: string; kind: 'init' | 'apply'; status: 'closed' | 'awaiting_close'; inputSha256: string; inputSnapshotAt: Date; closeSnapshotAt: Date | null; cutoverAt: Date | null; uploadFile: string | null; createdAt: Date };
  export async function findRunBySha(tx: Sql, sha: string): Promise<RunRow | null>;
  export async function openRun(tx: Sql): Promise<RunRow | null>;
  export async function lastClosedRun(tx: Sql): Promise<RunRow | null>;
  export async function initRun(tx: Sql): Promise<RunRow | null>;
  export async function insertRun(tx: Sql, r: Omit<RunRow, 'id' | 'createdAt' | 'closeSnapshotAt'>): Promise<string>;
  export type RunItemRow = { optionSerial: string; skuId: string; sellmateCurrent: number; sellmateUnshipped: number; s: number; baselineBefore: number; carryBefore: number; delta: number; carryAfter: number; uploadAvail: number | null; uploadedCurrent: number | null; refUnshipped: number | null };
  export async function insertRunItems(tx: Sql, runId: string, items: readonly RunItemRow[]): Promise<void>;
  export async function loadRunItems(tx: Sql, runId: string): Promise<RunItemRow[]>;
  export async function updateRunItemClose(tx: Sql, runId: string, optionSerial: string, v: { verdict: string; accept: string | null; uploadedCurrent?: number; refUnshipped?: number }): Promise<void>;
  export async function upsertStates(tx: Sql, rows: readonly (StateRow & { lastRunId: string })[]): Promise<void>;
  export async function closeRunRow(tx: Sql, runId: string, closeSha: string, closeSnapshotAt: Date, accepted: unknown): Promise<void>;
  export async function insertHandedOver(tx: Sql, runId: string, rows: readonly { salesOrderId: string; displayId: number; medusaOrderId: string }[]): Promise<void>;
  ```

- [ ] **Step 1: 실패하는 통합 스펙** — `postgres(DATABASE_URL)` 로 `sql.begin` 안에서 시드하고, 끝에 throw 로 롤백한다. 창고·로케이션·SKU 시드 칸은 `apps/core/src/modules/fulfillment/services/__support__` 의 시드 함수를 참고한다. 케이스:
  - `readCoreFigures`:
    - 부천 ON_HAND 4(로케이션 2곳 합) + 다른 창고 ON_HAND 9 → `onHand 4`(Review Focus 5)
    - confirmed 예약 3 중 넘긴 주문 판매주문 쪽 2 → `reservedAll 3, reservedHandedOver 2`
    - `pending` 예약은 세지 않는다.
  - `singleRealLocation`:
    - 비시스템 로케이션 한 곳에만 qty>0 → 그 id
    - 두 곳 → `null`
    - 입고기본존에만 있음 → `null`
  - `applyStockDelta({ delta: 2, upLocationId })` → 그 로케이션 원장 +2, 이벤트 `to_location_id` 가 그 로케이션
  - `loadCoreIndex`: `sku_barcodes.barcode = '="8800000000001"'` 이 키 `'8800000000001'` 로 잡힌다.
  - `reconcileInitExists`: 빈 테이블 → false, init 행 삽입 → true
  - 부분 unique: init 두 번째 삽입, `awaiting_close` 두 번째 삽입 → 각각 에러
- [ ] **Step 2: 실패 확인** — `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'reconcile-store\.integration\.spec\.ts$'` → FAIL
- [ ] **Step 3: 구현**
  - 넘긴 주문 예약 조인: `stock_reservations r → shipment_lines → shipments → fulfillment_orders → sellmate_handed_over_orders h ON h.sales_order_id = fo.sales_order_id`. 칸 이름은 `inventory.schema.ts` 에서 확인한다.
  - confirmed 조건은 `warehouse-availability.ts` 와 같은 집합(`status='confirmed'`, 부천 `warehouse_id`)이다.
  - `applyStockDelta` 는 증가 분기에서만 `upLocationId ?? BUCHEON_RECEIVING_LOC_ID` 를 쓴다. 기존 호출부(sync-stock·handover)는 바꾸지 않는다.
- [ ] **Step 4: 통과 확인** → PASS. `npx jest scripts/sellmate/sync-stock scripts/sellmate/handover-stock-addback --maxWorkers=2` 도 PASS(동작 불변)
- [ ] **Step 5: 커밋** — `"셀메이트 저녁 맞추기: 상태 저장소, 증가 로케이션 지정 (#1304)"`

### Task 7: CLI (`evening-reconcile.ts`) · `run.sh` · sellable 재계산

**Files:**
- Create: `scripts/sellmate/evening-reconcile.ts`
- Modify: `scripts/sellmate/recalc-sellable.ts` (함수 추출, reason 추가), `scripts/sellmate/run.sh` (`WITH_MEDUSA=1`)
- Test: `scripts/sellmate/evening-reconcile.integration.spec.ts`, `scripts/sellmate/evening-reconcile.spec.ts`(인자 파싱)

**Interfaces:**
- Consumes: Task 1~4 순수 함수, Task 6 저장소 전부
- Produces:
  ```ts
  export type Sub = 'pair' | 'init' | 'apply' | 'close' | 'status';
  export type CliArgs = { sub: Sub; stockFile: string | null; apply: boolean; cutoverAt: Date | null; ordersFile: string | null; ownMallChannel: string | null; acceptLanded: string[]; acceptNotLanded: string[] };
  export function parseCliArgs(argv: readonly string[]): CliArgs;
  export type Deps = { core: Sql; medusa: Sql | null; outDir: string; now: Date; log: (line: string) => void };
  export type StockInput = Awaited<ReturnType<typeof readStockCsv>>;
  export type RunOutcome = { exitCode: 0 | 1; touchedSkuIds: string[]; uploadFile: string | null };
  export async function runPair(d: Deps, stock: StockInput, apply: boolean): Promise<RunOutcome>;
  export async function runInit(d: Deps, stock: StockInput, orders: { displayIds: number[] }, cutoverAt: Date, apply: boolean): Promise<RunOutcome>;
  export async function runApply(d: Deps, stock: StockInput, apply: boolean): Promise<RunOutcome>;
  export async function runClose(d: Deps, stock: StockInput, accept: { landed: string[]; notLanded: string[] }, apply: boolean): Promise<RunOutcome>;
  export async function runStatus(d: Deps): Promise<RunOutcome>;
  // recalc-sellable.ts
  export const SELLMATE_STOCK_REASONS: readonly string[]; // ['sellmate-sync','sellmate-handover','sellmate-reconcile']
  export async function recalcSellableForSkus(databaseUrl: string, skuIds: readonly string[], dryRun: boolean): Promise<number>; // 재계산한 variant 수
  ```

- [ ] **Step 1: 인자 파싱 스펙** (`evening-reconcile.spec.ts`):
  - `['apply','a.csv']` → `{sub:'apply', stockFile:'a.csv', apply:false}`
  - `--apply` → `apply:true`
  - `init` 은 `--cutover-at`·`--sellmate-orders`·`--own-mall-channel` 이 없으면 throw 한다.
  - `--cutover-at=2026-11-20T09:00` 은 offset 이 없으면 KST 다(`handover-stock-addback.ts` `parseCollectedAt` 재사용).
  - `--accept-landed=A,B` → `['A','B']`
  - 모르는 하위 명령·플래그는 throw 한다.
- [ ] **Step 2: 통합 스펙** (`evening-reconcile.integration.spec.ts`, 표는 `parseReconcileStock` 으로 만든 메모리 입력, `outDir` 는 `os.tmpdir()` 아래 임시 폴더):
  1. `runInit` dry-run → 테이블·원장 행 수 불변
  2. `runInit` apply → states `{baseline: S, carry: max(0,−S)}`, handed_over 행, run `closed`
  3. `runInit` 두 번째 → exit 1
  4. 짝 못 지은 품목이 있는 입력의 `runApply` → exit 1, 원장 불변
  5. `runApply` 마켓 주문 2 → ADJUST_DOWN 2(`reason='sellmate-reconcile'`), run `awaiting_close`, 업로드 파일 존재
  6. 같은 sha 로 `runApply` → exit 0, 원장 불변(멱등)
  7. 다른 sha 로 `runApply`(열린 회차 있음) → exit 1
  8. `runClose` 정상 → states.baseline = `uploadedCurrent − refUnshipped`, run `closed`
  9. `runClose` `shipped_before_upload` → exit 1, 고친 업로드 파일, 회차 품목의 `uploaded_current`·`ref_unshipped` 갱신, run 은 열린 채
  10. `--accept-not-landed` 로 닫기 → 그 품목 baseline = apply 의 `s`
  11. 직전 닫기 입력보다 이른 `snapshotAt` 의 `runApply` → exit 1(Review Focus 3)
  12. `sellmate-handover` 이벤트가 있으면 `runApply`·`runInit` → exit 1
  13. 새로 짝지어진 품목 → 같은 apply 에서 `freshState(S, unshipped)` = {baseline: S, carry: 셀메이트 미발송} 로 `planApply` 를 거쳐 미발송만큼 core 에서 차감, 출력에 «새 품목»
  14. 상태 있는 품목이 CSV 에서 사라지면 → exit 1
- [ ] **Step 3: 실패 확인** — `npx jest scripts/sellmate/evening-reconcile.spec --maxWorkers=2` 와 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'evening-reconcile\.integration\.spec\.ts$'` → FAIL
- [ ] **Step 4: 구현**
  - 각 `run*` 은 `core.begin` 한 트랜잭션 안에서 `lockStock` 부터 잡는다. dry-run 은 마지막에 롤백용 표지 예외를 던져 되돌리고, 파일을 쓰지 않는다.
  - 출력 첫 줄은 요약이다: `UP n품목 · DOWN n품목 · 이월 n품목 · 짝 못 지음 n품목 · 새 품목 n`. 이어서 0 이 아닌 품목 표를 찍는다.
  - `apply`:
    - `replacePairs` 를 한다.
    - 원장 delta 가 0 이 아니면 `applyStockDelta({source: RECONCILE_SOURCE, upLocationId: await singleRealLocation(...) ?? undefined})` 를 부른다.
    - 업로드 파일은 `${outDir}/sellmate-reconcile-${runId}-upload.csv` 다. 짝 지은 품목 전부(새 품목 포함, frozen 제외)를 싣는다.
    - 상태는 **apply 에서 `carry := carryAfter` 만** 쓴다(원장과 같이 커밋되므로). `baseline` 은 건드리지 않는다. 새 품목은 `freshState(S, unshipped)` = {baseline: S, carry: unshipped} 로 행을 만들어 같은 apply 의 `planApply` 에 태운다(원장 불변이 아니다). `toFreeze` 는 `frozen := true`.
    - `baseline` 은 **close 에서만** `confirmedBaseline` 으로 쓴다.
  - `close`:
    - 열린 회차가 없으면 exit 1 이다.
    - 닫기 CSV 의 `snapshotAt` 이 회차 `input_snapshot_at` 보다 이르거나 같으면 exit 1 이다.
    - ✗ 가 남으면 `${outDir}/sellmate-reconcile-${runId}-fix.csv` 를 쓰고(`shipped_before_upload` 품목만) exit 1 이다.
  - `main()`:
    - 커밋 뒤 `touchedSkuIds` 가 있으면 `recalcSellableForSkus(DATABASE_URL, …, !apply)` 를 부른다.
    - init 에는 `MEDUSA_DATABASE_URL` 이 필요하고, 없으면 exit 1 이다.
    - `outDir` 기본값은 `apps/core/tmp`.
  - `recalc-sellable.ts`:
    - 기존 `main` 의 variant 조회는 `SELLMATE_STOCK_REASONS` 를 쓴다.
    - 서비스 생성부는 `recalcSellableForSkus` 와 같이 쓰도록 함수로 뺀다.
  - `run.sh`:
    - 탐색 node 블록을 DB 이름 인자로 두 번 부를 수 있게 함수로 감싼다.
    - `WITH_MEDUSA=1` 이면 `MEDUSA_DATABASE_URL` 도 export 한다.
    - 사용 문구에 `evening-reconcile` 을 더한다.
- [ ] **Step 5: 통과 확인** → 두 명령 PASS
- [ ] **Step 6: 커밋** — `"셀메이트 저녁 맞추기: pair·init·apply·close·status 명령 (#1304)"`

### Task 8: init 뒤 옛 스크립트 거절

**Files:**
- Modify: `scripts/sellmate/sync-stock.ts`, `scripts/sellmate/handover-stock-addback.ts`
- Test: `scripts/sellmate/reconcile/guards.spec.ts`

**Interfaces:**
- Consumes: Task 6 `reconcileInitExists`
- Produces: `reconcile-store.ts` 에 `export const SYNC_REFUSAL_AFTER_INIT = '저녁 맞추기 init 이 있다 — T 이후 이 스크립트는 core 원장을 되돌리므로 돌리지 않는다 (#1304)';`

- [ ] **Step 1: 실패하는 스펙** — 두 파일의 소스를 읽어, DB 에 연결한 직후(첫 쓰기·dry-run 계획 출력보다 앞) `reconcileInitExists` 를 부르고 `SYNC_REFUSAL_AFTER_INIT` 로 exit 1 하는지 본다. 근거: `scripts/jest/no-self-loaded-env-in-specs.spec.ts` 처럼 소스를 검사하는 가드 스펙 꼴이다. main 을 띄우려면 DB 가 필요해서 이렇게 한다.
- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/reconcile/guards --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현** — DRY_RUN 이어도 거절한다(설계: 탈출구 없음). sync-stock 은 `DATABASE_URL` 없이 도는 순수 dry-run 경로가 있으면, 그 경로에서도 거절하도록 연결 뒤로 옮긴다. 연결이 없으면 판정할 수 없으므로 «DATABASE_URL 필요»로 끝낸다.
- [ ] **Step 4: 통과 확인** → PASS. `npx jest scripts/sellmate --maxWorkers=2` 도 PASS
- [ ] **Step 5: 커밋** — `"셀메이트: 저녁 맞추기 init 뒤에는 sync-stock·handover 를 거절한다 (#1304)"`

### Task 9: 컷오버 판정 검사 3개

**Files:**
- Create: `scripts/ops/cutover-preflight/checks/reconcile.ts`
- Modify: `scripts/ops/cutover-preflight/rules.ts`, `rules.spec.ts`, `index.ts`

**Interfaces:**
- Consumes: Task 5 테이블(읽기 전용 SQL), `report.ts` `Report`·`Phase`
- Produces:
  ```ts
  // rules.ts
  export type ReconcileFacts = {
    tablesExist: boolean; initCutoverAt: Date | null; adapterCutoverAt: Date | null | undefined; // undefined = adapter 못 읽음
    openRunCreatedAt: Date | null; pairRows: number; unpaired: { optionSerial: string; reason: string }[];
    carry: { optionSerial: string; skuCode: string; carry: number }[];
  };
  export type Verdict = { level: 'ok' | 'bad' | 'dayOf' | 'info'; msg: string; fix?: string };
  export function judgeReconcile(f: ReconcileFacts, now: Date): Verdict[];
  // checks/reconcile.ts
  export async function checkReconcile(core: Sql, adapter: Sql | null, r: Report): Promise<void>;
  ```

- [ ] **Step 1: 실패하는 스펙** (`rules.spec.ts` 에 추가):
  - `tablesExist:false` → `bad`, fix 에 `npm run db:migrate -- --stage live --deployment lcnine-services --yes`
  - init 없음 → `dayOf`(Report 가 phase 로 ✗ 승격). fix 에 `WITH_MEDUSA=1 bash scripts/sellmate/run.sh live evening-reconcile init <재고 CSV> --cutover-at=<T> --sellmate-orders=<주문 목록> --own-mall-channel=<판매처> --apply`
  - init T ≠ adapter T → `bad`
  - adapter T 를 못 읽음 → `info`
  - 열린 회차가 `now − 25h` → `bad`, fix 에 `… evening-reconcile close <새 재고 CSV> --apply`. `now − 2h` → `info`
  - `pairRows:0` → `bad`, fix 에 `… evening-reconcile pair <재고 CSV> --apply`
  - unpaired 2건 → `bad` 1개(건수와 사유별 수)
  - carry 1건 → `info`(실패 아님)
- [ ] **Step 2: 실패 확인** — `npx jest scripts/ops/cutover-preflight --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현**
  - `checkReconcile` 는 사실을 모아 `judgeReconcile` 에 넘기고, level 별로 `r.ok/bad/dayOf/info` 를 부른다. 섹션 제목은 `재고 1. 저녁 맞추기`.
  - unpaired·carry 는 `r.table` 로 최대 30행만 보인다.
  - `index.ts` 에서는 medusa 검사처럼 core·adapter 를 중첩 `readOnly` 로 부른다(adapter 가 없으면 `null`).
  - 파일 머리 주석의 «정본» 파일 목록에 `scripts/sellmate/evening-reconcile.ts` 를 적는다.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `"컷오버 판정: 저녁 맞추기 기준값·짝 못 지은 품목·이월 (#1304)"`

### Task 10: 실행 문서 · 전체 게이트 · PR

**Files:**
- Modify: `scripts/sellmate/README.md`(«저녁 맞추기» 절), `scripts/sellmate/LAUNCH.md`(T 당일 순서에 `pair`→마지막 sync→`init` 과 첫 저녁 `apply`→업로드→`close` 를 넣는다. 기존 당일 순서 문서가 다른 곳이면 그 파일)

- [ ] **Step 1: README 절 작성** — 다음을 적는다.
  - 하위 명령 표, 매일 절차(받기 → `apply` → 셀메이트 «재고 수정»에 업로드 → 다시 받기 → `close`)
  - 운영 규칙(맞추는 동안 셀메이트 출고·반품 입고 정지, 셀메이트에서 재고 손수정 금지)
  - «첫 live `--apply` 전 확인 4개»(설계 문서 그대로)
  - **T 전에 live `db:migrate` 필요**
- [ ] **Step 2: 전체 게이트 한 번** — 다른 세션의 E2E 스택이 떠 있는지 `docker ps` 로 먼저 본다. 떠 있으면 사용자에게 묻는다.
  - `npx jest --maxWorkers=2` → 실패 0
  - `npm run type-check` → 에러 0
- [ ] **Step 3: 커밋·푸시** — `"셀메이트 저녁 맞추기: 실행 절차 (#1304)"`, `git push`
- [ ] **Step 4: PR #1354 본문 갱신** — 「지금 상태」를 구현 완료로 바꾼다. 배포 순서(`db:migrate` 만, 앱 배포 불필요)와 첫 live 전 사람 확인 4개를 적는다. draft 는 사용자가 풀게 둔다.
