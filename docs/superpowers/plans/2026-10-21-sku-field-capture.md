# SKU 실측 작업 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 창고 작업자가 폰 브라우저(admin-web `/mobile`)에서 선반 바코드로 SKU 를 찾아 포장 크기(mm)·실물 사진(3장+)·제조사 바코드를 등록하고, 관리자가 진행 현황을 본다.

**Architecture:** core `inventory` BC 에 새 하위 모듈 `sku-field-capture`(Controller → Service → Reader/Manager)를 둔다. 새 테이블 넷(선반 위치·실물 사진·완료 기록·완료 이벤트)과 `skus` mm 컬럼 셋을 추가만 한다. 사진은 file-service 공개 컨텍스트로 presign 직행 업로드(압축 없음)하고 core 는 fileId 만 잇는다. 선반 위치는 셀메이트 백업 CSV 에서 1회 적재 스크립트로 채운다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), class-validator, Next.js(admin-web), TanStack Query, `@zxing/browser`(카메라 바코드).

**Spec:** `docs/superpowers/specs/2026-10-21-sku-field-capture-design.md` — 실행자는 계획과 함께 반드시 읽는다.

## Global Constraints

- 작업 디렉터리는 워크트리 `/home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat+sku-field-capture`, 브랜치 `feat/sku-field-capture`. **`develop` 이면 멈춘다.**
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_01QxMECy2j4fJWqEMkGAF9tt`.
- 레이어 규칙: Controller → Service(2~3줄) → Reader/Manager. Service 는 drizzle·HttpException 을 import 하지 않는다. 오류는 `@app/shared` 의 `NotFoundError`·`BadRequestError`.
- 트랜잭션: `this.dbService.run(async (trx) => …, tx)`, public 메서드는 마지막 인자 `tx?: DbTx`. `db.query.*`·`with`·`any`·`as` 캐스팅 금지(테스트 하네스 제외).
- **drizzle `sql\`\`` 템플릿에 JS `Date` 를 넣지 않는다** — 매 호출 TypeError(라이브 전례). 시각은 SQL `now()` 로.
- 새 core 라우트: GET 은 `@RequirePermission('inventory.stock.read')`, 쓰기는 `@RequirePermission('inventory.stock.operate')`, 둘 다 `@RequireScopes(INVENTORY_SCOPE.OPERATE)`. 관리자 현황만 예외(Task 3).
- 크기: 양의 정수 mm, 1 ~ 5000. 사진 최소 **3장**(core `MIN_REFERENCE_PHOTOS`, admin-web 같은 값 — 앱이 달라 상수 공유 불가).
- 바코드 상태 값 셋: `'scanned' | 'no_manufacturer' | 'none'`.
- 사진 MIME: `image/jpeg`, `image/png`, `image/webp`. 상한 26214400 B(25MB). 업로드는 `compress: false`.
- 위치 코드 정규화: 앞뒤 공백 제거 + 대문자화. 적재와 조회가 **같은 함수**를 쓴다.
- 「오늘」은 KST(`Asia/Seoul`), SQL 에서 계산.
- admin-web 은 컴포넌트 테스트가 불가능하다 — 판정은 `.ts` 순수 함수로 뽑아 테스트하고 컴포넌트는 배선만.
- 마이그는 추가만(expand) → 배포 순서 `migrate → deploy`.

## Review Focus

1. **사진 업로드는 됐는데 core 연결(attach) 호출이 실패**(창고 와이파이) — 화면엔 사진이 있는데 서버엔 없다. 완료는 서버가 센 사진 수로만 판정해야 한다 → Task 1 `complete 는 연결된 사진이 3장 미만이면 BadRequestError`.
2. **찍은 제조사 바코드가 이미 다른 SKU 소유** — 옮기지 않고 충돌로 기록, 완료는 된다 → Task 1 `다른 SKU 가 가진 바코드는 붙이지 않고 conflict 로 남긴다`.
3. **재작업 때 같은 바코드를 다시 찍음** — unique 위반으로 500 이 나면 안 된다 → Task 1 `이미 이 SKU 에 있는 바코드는 그대로 둔다`.
4. **선반 스캔 값의 공백·소문자** — 정확일치라 못 찾으면 작업자는 원인을 모른다 → Task 1 `normalizePositionCode`, Task 2 `소문자·공백 섞인 코드로도 찾는다`.
5. **다른 작업자가 재작업** — 앞 사람 누적 수가 줄면 안 된다 → Task 2 `재작업이 앞 작업자의 누적을 지우지 않는다`.

---

### Task 1: 스키마·마이그 + 쓰기 경로(Manager)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`skus` 정의 · 새 테이블 · `wmsTables` 등록)
- Create: `apps/core/drizzle/<timestamp>_add-sku-field-capture.sql` + `apps/core/drizzle/meta/*` (생성물)
- Create: `apps/core/src/modules/inventory/sku-field-capture/sku-field-capture.rules.ts`
- Create: `apps/core/src/modules/inventory/sku-field-capture/sku-field-capture.rules.spec.ts`
- Create: `apps/core/src/modules/inventory/sku-field-capture/services/sku-field-capture.manager.ts`
- Create: `apps/core/src/modules/inventory/sku-field-capture/services/sku-field-capture.manager.integration.spec.ts`

**Interfaces:**
- Produces (스키마, TS 이름 → SQL 이름):
  - `skus.packageWidthMm`/`packageLengthMm`/`packageHeightMm` → `package_width_mm`/`package_length_mm`/`package_height_mm`, `integer`, nullable. 옛 `dimension_*` 는 그대로.
  - `skuShelfPositions` → `sku_shelf_positions`: `skuId uuid PK → skus.id ON DELETE CASCADE`, `positionCode varchar(64) not null`, `imageUrl text null`, `createdAt`·`updatedAt timestamptz default now()`. 인덱스 `idx_sku_shelf_positions_code(position_code)`.
  - `skuReferencePhotos` → `sku_reference_photos`: `id uuid PK defaultRandom`, `skuId uuid not null → skus.id CASCADE`, `fileId uuid not null`, `sortOrder integer not null`, `takenById uuid not null`, `takenByLabel varchar(255) not null`, `createdAt`. 인덱스 `(sku_id, sort_order)`.
  - `skuFieldCaptures` → `sku_field_captures`: `skuId uuid PK → skus.id CASCADE`, `barcodeStatus varchar(20) not null` + check `IN ('scanned','no_manufacturer','none')`, `scannedBarcode varchar(64) null`, `barcodeConflictSkuId uuid null → skus.id ON DELETE SET NULL`, `allFacesConfirmed boolean not null`, `lastWorkerId uuid not null`, `lastWorkerLabel varchar(255) not null`, `firstCompletedAt`·`lastCompletedAt timestamptz not null`.
  - `skuFieldCaptureEvents` → `sku_field_capture_events`: `id uuid PK`, `skuId → skus.id CASCADE`, `workerId uuid not null`, `workerLabel varchar(255) not null`, `completedAt timestamptz not null default now()`. 인덱스 `(worker_id, completed_at)`.
- Produces (rules.ts):
  - `export const MIN_REFERENCE_PHOTOS = 3`
  - `export const MAX_PACKAGE_MM = 5000`
  - `export const FIELD_CAPTURE_BARCODE_STATUSES = ['scanned', 'no_manufacturer', 'none'] as const`; `export type FieldCaptureBarcodeStatus = (typeof FIELD_CAPTURE_BARCODE_STATUSES)[number]`
  - `export function normalizePositionCode(raw: string): string`
  - `export type FieldCaptureActor = { workerId: string; workerLabel: string }`
  - `export function fieldCaptureActorOf(user: WarehouseActor & { email?: string; login_id?: string }): FieldCaptureActor` — id 는 기존 `authenticatedWarehouseActor`(`inventory/core/services/warehouse-operation-contract.ts`)로, label 은 `login_id ?? email ?? workerId`.
- Produces (manager):
  - `export type CompleteFieldCaptureInput = { packageWidthMm: number; packageLengthMm: number; packageHeightMm: number; barcodeStatus: FieldCaptureBarcodeStatus; scannedBarcode?: string; allFacesConfirmed: true }`
  - `class SkuFieldCaptureManager` (`@InjectTypedDb<typeof wmsSchema>()` 로 `DbService<typeof wmsSchema>`):
    - `attachPhoto(skuId: string, fileId: string, actor: FieldCaptureActor, tx?: DbTx): Promise<{ id: string }>` — sortOrder = 그 SKU 의 max+1(없으면 0).
    - `removePhoto(skuId: string, photoId: string, tx?: DbTx): Promise<void>` — 행 삭제만. file-service 는 부르지 않는다.
    - `complete(skuId: string, input: CompleteFieldCaptureInput, actor: FieldCaptureActor, tx?: DbTx): Promise<void>`

- [ ] **Step 1: 스키마를 고치고 마이그를 만든다**

위 Interfaces 대로 `inventory.schema.ts` 를 고치고 새 테이블을 `wmsTables` 에 넣는다. 그 다음:

Run: `npm run db:generate:core -- --name add-sku-field-capture`
Expected: `apps/core/drizzle/` 에 SQL 하나. 열어서 **`CREATE TABLE` 4개 + `ALTER TABLE skus ADD COLUMN` 3개 + 인덱스·check·FK 만** 있는지 본다. DROP·다른 테이블 ALTER 가 섞였으면 멈추고 보고.

- [ ] **Step 2: 규칙 함수 실패 테스트**

```ts
// sku-field-capture.rules.spec.ts
describe('normalizePositionCode', () => {
  it('앞뒤 공백을 지우고 대문자로', () => expect(normalizePositionCode('  t-01-20 \n')).toBe('T-01-20'));
  it('한글 위치는 그대로', () => expect(normalizePositionCode('케이영 창고')).toBe('케이영 창고'));
});
describe('fieldCaptureActorOf', () => {
  it('login_id 를 우선 label 로', () =>
    expect(fieldCaptureActorOf({ userId: 'u1', login_id: 'worker01', email: 'w@x.kr' })).toEqual({ workerId: 'u1', workerLabel: 'worker01' }));
  it('login_id 없으면 email', () =>
    expect(fieldCaptureActorOf({ id: 'u2', email: 'w@x.kr' })).toEqual({ workerId: 'u2', workerLabel: 'w@x.kr' }));
  it('id 가 없으면 던진다', () => expect(() => fieldCaptureActorOf({ email: 'w@x.kr' })).toThrow());
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx jest apps/core/src/modules/inventory/sku-field-capture/sku-field-capture.rules.spec.ts` · Expected: FAIL (모듈 없음)

- [ ] **Step 4: `sku-field-capture.rules.ts` 구현** — Interfaces 대로.

- [ ] **Step 5: 통과 확인** — 같은 명령, Expected: PASS

- [ ] **Step 6: Manager 통합 실패 테스트**

`delivery-profile.manager.integration.spec.ts` 의 틀을 따른다: `describeIfDb`(`DATABASE_URL` 가드, **스펙 안에서 dotenv 금지**), `makeDb`·`inRollbackTx`·`seedHolder`·`seedSku`(`apps/core/src/modules/fulfillment/services/__support__`), dbService 는 `run: (fn, tx) => fn(tx ?? trx)` 스텁. 공통 `actor = { workerId: randomUUID(), workerLabel: 'w1' }`, `input = { packageWidthMm: 120, packageLengthMm: 45, packageHeightMm: 30, barcodeStatus: 'no_manufacturer', allFacesConfirmed: true }`. 테스트:

- `complete 는 연결된 사진이 3장 미만이면 BadRequestError` — 사진 2장 attach 후 `complete` → `rejects.toBeInstanceOf(BadRequestError)`, `sku_field_captures` 0행.
- `complete 는 skus 의 mm 칸·완료 기록·이벤트를 한 번에 남긴다` — 사진 3장 후 complete → `skus.packageWidthMm === 120` 등 셋, capture 행 `barcodeStatus 'no_manufacturer'`, `lastWorkerLabel 'w1'`, 이벤트 1행.
- `scanned 바코드를 보조 바코드로 붙인다` — `barcodeStatus:'scanned', scannedBarcode:'8809692351771'` → `sku_barcodes` 에 `{ skuId, barcode:'8809692351771', isPrimary:false, packingUnit:null }`, capture `barcodeConflictSkuId null`.
- `다른 SKU 가 가진 바코드는 붙이지 않고 conflict 로 남긴다` — 다른 SKU B 에 그 바코드를 미리 insert → A complete 성공, `sku_barcodes` 의 그 바코드 소유자는 여전히 B, capture `barcodeConflictSkuId === B`.
- `이미 이 SKU 에 있는 바코드는 그대로 둔다` — 두 번 complete → 예외 없음, 그 바코드 행 1개, 이벤트 2행, `firstCompletedAt` 불변·`lastCompletedAt` 갱신.
- `scanned 인데 scannedBarcode 가 비면 BadRequestError`.
- `없는 SKU 는 NotFoundError` (attachPhoto·complete).
- `removePhoto 는 그 SKU 의 사진만 지운다` — 다른 SKU 의 photoId 로 부르면 `NotFoundError`.

- [ ] **Step 7: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'sku-field-capture\.manager\.integration\.spec\.ts$'`
Expected: FAIL (Manager 없음). DB 가 안 떠 있으면 `docs/local-dev.md` 대로 띄우고 마이그를 적용한 뒤 다시.

- [ ] **Step 8: `SkuFieldCaptureManager` 구현**

`complete` 순서(한 트랜잭션): SKU 존재·`is_deleted=false` 확인 → 사진 수 `>= MIN_REFERENCE_PHOTOS` → `scanned` 면 `insert(skuBarcodes).values(…).onConflictDoNothing({ target: skuBarcodes.barcode }).returning()`; 안 들어갔으면 소유자 재조회 — 자기면 그대로, 남이면 `barcodeConflictSkuId` → `skus` mm 셋 + `updatedAt` 갱신 → `sku_field_captures` upsert(`onConflictDoUpdate`, `firstCompletedAt` 은 update set 에서 뺀다, 시각은 `sql\`now()\``) → 이벤트 insert. 사전 조회 대신 `onConflictDoNothing` 을 쓰는 이유: 두 작업자가 동시에 같은 바코드를 찍어도 unique 위반으로 500 이 나지 않게.

- [ ] **Step 9: 통과 확인** — Step 7 명령, Expected: PASS 전부

- [ ] **Step 10: 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle apps/core/src/modules/inventory/sku-field-capture
git commit -m "feat(core): SKU 실측 작업 스키마와 쓰기 경로"
```

---

### Task 2: 읽기 경로(Reader) — 선반 조회·상세·바코드 소유자·현황

**Files:**
- Create: `apps/core/src/modules/inventory/sku-field-capture/dto/sku-field-capture.dto.ts` (응답 DTO 클래스, 중첩은 별도 클래스 — `@ApiProperty({ type: 'object' })` 금지)
- Create: `apps/core/src/modules/inventory/sku-field-capture/services/sku-field-capture.reader.ts`
- Create: `apps/core/src/modules/inventory/sku-field-capture/services/sku-field-capture.reader.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 테이블, `normalizePositionCode`, `MIN_REFERENCE_PHOTOS`.
- Produces (DTO, 시각은 ISO 문자열):
  - `FieldCaptureCompletionDto { barcodeStatus: FieldCaptureBarcodeStatus; lastWorkerLabel: string; lastCompletedAt: string }`
  - `FieldCaptureSkuSummaryDto { skuId: string; code: string; name: string; imageUrl: string | null; completion: FieldCaptureCompletionDto | null }`
  - `ShelfPositionDto { positionCode: string; skus: FieldCaptureSkuSummaryDto[] }`
  - `ReferencePhotoDto { id: string; fileId: string; sortOrder: number; takenByLabel: string; createdAt: string }`
  - `BarcodeOwnerDto { skuId: string; code: string; name: string }`
  - `FieldCaptureDetailCompletionDto extends FieldCaptureCompletionDto { scannedBarcode: string | null; barcodeConflict: BarcodeOwnerDto | null; allFacesConfirmed: boolean }`
  - `FieldCaptureDetailDto { skuId; code; name; imageUrl: string | null; positionCode: string | null; packageWidthMm: number | null; packageLengthMm: number | null; packageHeightMm: number | null; barcodes: string[]; photos: ReferencePhotoDto[]; completion: FieldCaptureDetailCompletionDto | null }`
  - `WorkerProgressDto { workerId: string; workerLabel: string; today: number; total: number }`
  - `FieldCaptureProgressDto { remainingSkus: number; completedSkus: number; stickerNeededSkus: number; barcodeConflictSkus: number; workers: WorkerProgressDto[] }`
- Produces (`class SkuFieldCaptureReader`):
  - `findByPosition(rawCode: string, tx?: DbTx): Promise<ShelfPositionDto>` — 정규화 후 정확일치. 없으면 `skus: []`(404 아님 — 화면이 「이 칸엔 등록된 상품이 없어요」를 띄운다). 삭제된 SKU 제외, 재고와 무관(spec §4).
  - `getDetail(skuId: string, tx?: DbTx): Promise<FieldCaptureDetailDto>` — 없으면 `NotFoundError`. `barcodes` 는 그 SKU 의 `sku_barcodes.barcode` 전부, 사진은 `sortOrder` 순.
  - `findBarcodeOwner(barcode: string, tx?: DbTx): Promise<BarcodeOwnerDto | null>` — trim 후 정확일치.
  - `getProgress(tx?: DbTx): Promise<FieldCaptureProgressDto>`

- [ ] **Step 1: 실패 테스트** (Task 1 과 같은 통합 틀)

- `소문자·공백 섞인 코드로도 찾는다` — `sku_shelf_positions` 에 `T-01-20` 두 SKU → `findByPosition(' t-01-20 ')` 가 둘 다, 하나를 complete 한 뒤엔 그 줄 `completion.lastWorkerLabel === 'w1'`.
- `등록 안 된 위치는 빈 목록` — `findByPosition('ZZ-99-99')` → `{ positionCode: 'ZZ-99-99', skus: [] }`.
- `상세는 사진 순서·바코드·충돌 SKU 를 담는다` — Task 1 의 conflict 상황 → `completion.barcodeConflict.skuId === B`.
- `findBarcodeOwner 는 없으면 null`.
- `남은 SKU 는 ON_HAND 재고가 있는 미완료 SKU 만 센다` — SKU 셋: 재고 있음·미완료 / 재고 있음·완료 / 재고 없음·미완료. 재고는 `receiveStock`(`__support__`, `InventoryCommandService` 배선 필요 — `logistics-wiring.ts` 의 기존 배선 함수를 쓴다)로. 기대: 이 픽스처가 만든 몫만큼 `remainingSkus` 가 1 늘고 `completedSkus` 가 1 늘어난다 — **DB 에 다른 행이 있을 수 있으니 절대값이 아니라 픽스처 전후 차이로 단언**.
- `재작업이 앞 작업자의 누적을 지우지 않는다` — w1 이 complete, w2 가 같은 SKU complete → workers 에서 w1 `total` 1, w2 `total` 1, `completedSkus` 는 1 만 증가.
- `스티커 필요는 barcodeStatus none 인 완료 SKU 수`.

- [ ] **Step 2: 실패 확인** — Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'sku-field-capture\.reader\.integration\.spec\.ts$'` · Expected: FAIL

- [ ] **Step 3: DTO + `SkuFieldCaptureReader` 구현**

집계는 전부 SQL 에서 끝낸다. `remainingSkus`: 삭제 안 된 SKU 중 `stock_ledgers` 의 `stock_state='ON_HAND'` `qty` 합(모든 창고) > 0 이고 `sku_field_captures` 행이 없는 수. 작업자별: `sku_field_capture_events` 를 `worker_id` 로 묶어 `total = count(distinct sku_id)`, `today = count(distinct sku_id) filter (where (completed_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)`, label 은 그 작업자의 가장 최근 이벤트 것. `total` 내림차순.

- [ ] **Step 4: 통과 확인** — Step 2 명령, Expected: PASS

- [ ] **Step 5: 커밋** — `git commit -m "feat(core): SKU 실측 작업 조회·현황"`

---

### Task 3: HTTP 표면 — Controller·요청 DTO·Service·모듈 배선

**Files:**
- Create: `apps/core/src/modules/inventory/sku-field-capture/dto/complete-field-capture.dto.ts` (+ `.spec.ts`)
- Create: `apps/core/src/modules/inventory/sku-field-capture/dto/attach-reference-photo.dto.ts`
- Create: `apps/core/src/modules/inventory/sku-field-capture/services/sku-field-capture.service.ts`
- Create: `apps/core/src/modules/inventory/sku-field-capture/controllers/sku-field-capture.controller.ts`
- Create: `apps/core/src/modules/inventory/sku-field-capture/sku-field-capture.module.ts`
- Modify: `apps/core/src/modules/inventory/inventory.module.ts` (imports 에 `SkuFieldCaptureModule`)

**Interfaces:**
- Consumes: Task 1 Manager·rules, Task 2 Reader·DTO.
- Produces (라우트, 접두 `inventory/sku-field-capture`, `@UseGuards(ScopeGuard)`):

| verb | path | 권한 | 응답 |
|---|---|---|---|
| GET | `positions/:positionCode` | stock.read | `ShelfPositionDto` |
| GET | `skus/:skuId` | stock.read | `FieldCaptureDetailDto` |
| GET | `barcodes/:barcode/owner` | stock.read | `{ owner: BarcodeOwnerDto \| null }` |
| POST | `skus/:skuId/photos` | stock.operate | `FieldCaptureDetailDto` |
| DELETE | `skus/:skuId/photos/:photoId` | stock.operate | `FieldCaptureDetailDto` |
| PUT | `skus/:skuId/capture` | stock.operate | `FieldCaptureDetailDto` |
| GET | `progress` | **`inventory.master.read`** | `FieldCaptureProgressDto` |

  - 위 6개는 `@RequireScopes(INVENTORY_SCOPE.OPERATE)`. `progress` 의 스코프는 **다른 `inventory.master.read` GET 라우트(예: suppliers 컨트롤러)와 같은 것**을 쓴다 — 작업자(`logistics_worker`)에겐 403 이어야 한다.
  - `:skuId`·`:photoId` 는 `ParseUUIDPipe`. 쓰기 라우트는 `@User()` 로 받은 사용자를 `fieldCaptureActorOf` 로.
  - 쓰기 응답이 상세 전체인 이유: 폰 화면이 응답 하나로 다시 그린다(왕복 절약).
- Produces (요청 DTO):
  - `AttachReferencePhotoDto { fileId: string }` — `@IsUUID()`.
  - `CompleteFieldCaptureDto` — `packageWidthMm`/`packageLengthMm`/`packageHeightMm`: `@IsInt() @Min(1) @Max(MAX_PACKAGE_MM)`; `barcodeStatus`: `@IsIn(FIELD_CAPTURE_BARCODE_STATUSES)`; `scannedBarcode?`: `@ValidateIf(o => o.barcodeStatus === 'scanned') @IsString() @IsNotEmpty() @MaxLength(64)`; `allFacesConfirmed`: `@IsIn([true])`.
- `SkuFieldCaptureService` 는 Reader/Manager 위임만(쓰기 메서드는 manager 호출 뒤 `reader.getDetail`).

- [ ] **Step 1: DTO 실패 테스트** (`complete-field-capture.dto.spec.ts`, `plainToInstance` + `validate`)

- `정상 입력은 오류 0` — `{ packageWidthMm: 120, packageLengthMm: 45, packageHeightMm: 30, barcodeStatus: 'none', allFacesConfirmed: true }`.
- `소수 mm 는 거부` — `packageWidthMm: 12.5` → 오류 1+.
- `0 과 5001 은 거부`.
- `scanned 인데 바코드가 없으면 거부`, `scanned 가 아니면 바코드 없어도 통과`.
- `allFacesConfirmed false 는 거부`.
- `모르는 barcodeStatus 는 거부` — `'unknown'`.

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/inventory/sku-field-capture/dto` · FAIL

- [ ] **Step 3: DTO·Service·Controller·Module 구현 + `inventory.module.ts` 배선**

- [ ] **Step 4: 통과 + 보안 가드 확인**

Run: `npx jest apps/core/src/modules/inventory/sku-field-capture/dto scripts/security apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts`
Expected: PASS 전부. `route-classification` 이 빨가면 권한 데코레이터가 빠졌거나 GET 에 쓰기 권한을 단 것이다.

- [ ] **Step 5: 타입 확인** — Run: `npm run type-check` · Expected: 에러 0

- [ ] **Step 6: 커밋** — `git commit -m "feat(core): SKU 실측 작업 API"`

---

### Task 4: 사진 file context + 선반 위치 적재 스크립트

**Files:**
- Modify: `apps/file-service/src/database/default-file-contexts.ts` (새 항목)
- Create: `scripts/sellmate/load-shelf-positions.ts`
- Create: `scripts/sellmate/load-shelf-positions.spec.ts`
- Modify: `scripts/sellmate/README.md` (실행법 한 절)

**Interfaces:**
- Produces (file context): `{ id: 'sku-reference-photo', name: 'SKU Reference Photo', description: 'SKU 실물 사진(실측 작업)', allowPublic: true, allowPrivate: false, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxFileSize: 26214400, pathPrefix: 'inventory/sku-reference-photos', isActive: true }`
- Produces (script):
  - `export type ShelfPositionRow = { skuCode: string; positionCode: string; imageUrl: string | null }`
  - `export function buildShelfPositionRows(rows: string[][]): { rows: ShelfPositionRow[]; skippedNoPosition: number; duplicateCodes: string[] }` — 헤더는 `detectColumns`(`scripts/sellmate/parse.ts`)로 `옵션정보일련번호`·`상품위치`·`대표이미지주소`. 위치는 `normalizePositionCode`(Task 1, 상대경로 import). 빈 위치 행은 건너뛰고 센다. 같은 SKU 코드가 두 번 나오면 마지막 값, 코드는 `duplicateCodes` 에.
  - 실행: `DRY_RUN=1 npx tsx scripts/sellmate/load-shelf-positions.ts <csv>` → 통계만. `DATABASE_URL=… npx tsx …` → 한 트랜잭션으로 `skus.code` 와 조인해 `sku_shelf_positions` upsert(`ON CONFLICT (sku_id) DO UPDATE`), **매칭 안 된 SKU 코드 수를 출력**. 파일 읽기는 `readRows`(utf-8 실패 시 euc-kr, `="…"` 벗김).

- [ ] **Step 1: 실패 테스트** (`load-shelf-positions.spec.ts`, DB 없음)

```ts
const HEADER = ['옵션정보일련번호', '상품위치', '대표이미지주소'];
it('위치를 정규화하고 빈 위치는 건너뛴다', () => {
  const out = buildShelfPositionRows([HEADER, ['92663', ' t-01-20 ', 'https://x/a.jpg'], ['92662', '', ''], ['92661', 'P-01-06', '']]);
  expect(out.rows).toEqual([
    { skuCode: '92663', positionCode: 'T-01-20', imageUrl: 'https://x/a.jpg' },
    { skuCode: '92661', positionCode: 'P-01-06', imageUrl: null },
  ]);
  expect(out.skippedNoPosition).toBe(1);
});
it('같은 SKU 가 두 번이면 마지막 값과 중복 보고', () => {
  const out = buildShelfPositionRows([HEADER, ['1', 'A-01-01', ''], ['1', 'A-01-02', '']]);
  expect(out.rows).toEqual([{ skuCode: '1', positionCode: 'A-01-02', imageUrl: null }]);
  expect(out.duplicateCodes).toEqual(['1']);
});
it('필수 헤더가 없으면 던진다', () => expect(() => buildShelfPositionRows([['상품명'], ['x']])).toThrow());
```

- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/load-shelf-positions.spec.ts` · FAIL

- [ ] **Step 3: 스크립트 + file context 구현**

- [ ] **Step 4: 통과 + 실데이터 DRY_RUN**

Run: `npx jest scripts/sellmate/load-shelf-positions.spec.ts apps/file-service` 그리고 `DRY_RUN=1 npx tsx scripts/sellmate/load-shelf-positions.ts /home/pauseb/다운로드/01_현재고_전체_20261016.csv`
Expected: 테스트 PASS. DRY_RUN 은 위치 있는 행 **약 7,531**, 건너뜀 **약 26,389** 근처(2026-10-21 실측: 위치 있음 7,531 / 전체 33,920). 크게 다르면 인코딩·헤더 감지를 의심하고 보고.

- [ ] **Step 5: 커밋** — `git commit -m "feat: 실측 사진 file context, 셀메이트 선반 위치 적재 스크립트"`

---

### Task 5: admin-web 판정 모델 + API 클라이언트

**Files:**
- Create: `apps/admin-web/src/features/inventory/sku-field-capture/field-capture-model.ts`
- Create: `apps/admin-web/src/features/inventory/sku-field-capture/field-capture-model.spec.ts`
- Create: `apps/admin-web/src/lib/api/domains/inventory/sku-field-capture.client.ts`
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` (Task 2 응답 DTO 를 같은 이름의 TS 타입으로 + `FieldCaptureBarcodeStatus` 유니온 + 요청 타입 `CompleteFieldCaptureRequest`(= core `CompleteFieldCaptureDto` 모양))
- Modify: `apps/admin-web/src/lib/api/domains/inventory/index.ts` (export)

**Interfaces:**
- Consumes: Task 3 라우트·DTO.
- Produces (model):
  - `export const MIN_REFERENCE_PHOTOS = 3`
  - `export const REFERENCE_PHOTO_CONTEXT_ID = 'sku-reference-photo'`
  - `export const REFERENCE_PHOTO_MAX_BYTES = 26214400`
  - `export function parseMm(input: string): number | null` — 앞뒤 공백 허용, 1~5000 정수만, 그 외 `null`.
  - `export function photoRejectionReason(file: { type: string; size: number }): string | null` — 허용 MIME 밖이면 HEIC 안내 포함 문구, 상한 초과면 크기 문구.
  - `export type CaptureDraft = { widthMm: string; lengthMm: string; heightMm: string; barcodeStatus: FieldCaptureBarcodeStatus | null; scannedBarcode: string; photoCount: number; allFacesConfirmed: boolean }`
  - `export function missingRequirements(d: CaptureDraft): string[]` — 화면에 그대로 띄우는 한국어 문구 목록. 빈 배열 = 완료 가능.
  - `export function toCompleteRequest(d: CaptureDraft): CompleteFieldCaptureRequest` — `missingRequirements` 가 비었을 때만 부른다(아니면 던짐).
  - `export function completedByText(c: { lastWorkerLabel: string; lastCompletedAt: string }): string` — `'worker01 님이 10-21 14:05 에 완료함'` 꼴, **KST**.
- Produces (client `skuFieldCaptureClient`, 기존 `delivery-profiles.client.ts` 모양): `getPosition(code)`, `getDetail(skuId)`, `getBarcodeOwner(barcode)`, `attachPhoto(skuId, fileId)`, `removePhoto(skuId, photoId)`, `complete(skuId, body)`, `getProgress()`. 경로 세그먼트는 `encodeURIComponent`.

- [ ] **Step 1: 실패 테스트** (`field-capture-model.spec.ts`)

- `parseMm`: `'120'`→120, `' 45 '`→45, `'12.5'`·`'12cm'`·`'0'`·`'5001'`·`''`→null.
- `photoRejectionReason`: `{type:'image/jpeg',size:8e6}`→null; `{type:'image/heic',size:1}`→문구에 `'HEIC'` 포함; `{type:'image/jpeg',size:26214401}`→not null.
- `missingRequirements`: 다 찬 draft → `[]`; `photoCount: 2` → `'사진을 1장 더 찍어 주세요'` 포함; `barcodeStatus: null` → `'바코드 칸에서 하나를 골라 주세요'` 포함; `barcodeStatus:'scanned', scannedBarcode:''` → 바코드 문구; `allFacesConfirmed:false` → `'여섯 면이 다 나왔는지 확인해 주세요'` 포함; `widthMm:'abc'` → `'가로를 mm 정수로 입력해 주세요'` 포함.
- `toCompleteRequest`: 다 찬 draft → `{ packageWidthMm:120, packageLengthMm:45, packageHeightMm:30, barcodeStatus:'none', allFacesConfirmed:true }` (none 이면 `scannedBarcode` 키 없음).
- `completedByText({ lastWorkerLabel:'worker01', lastCompletedAt:'2026-10-21T05:05:00.000Z' })` → `'worker01 님이 10-21 14:05 에 완료함'`.

- [ ] **Step 2: 실패 확인** — `npm run test:admin-web -- field-capture-model` · FAIL

- [ ] **Step 3: model·types·client 구현**

- [ ] **Step 4: 통과 확인** — 같은 명령 · PASS, 그리고 `(cd apps/admin-web && npm run type-check)` 에러 0 (CI 는 admin-web tsc 를 안 돌린다 — 여기서 직접).

- [ ] **Step 5: 커밋** — `git commit -m "feat(admin-web): 실측 작업 판정 모델과 API 클라이언트"`

---

### Task 6: admin-web 작업자 화면(`/mobile/sku-field-capture`) + 카메라 스캔

**Files:**
- Modify: `apps/admin-web/package.json`, `apps/admin-web/package-lock.json` (`@zxing/browser` — 설치 시점의 정확한 버전으로 고정, 2주 이상 된 버전)
- Create: `apps/admin-web/src/features/inventory/sku-field-capture/components/barcode-scan-input.tsx`
- Create: `apps/admin-web/src/features/inventory/sku-field-capture/components/reference-photo-field.tsx`
- Create: `apps/admin-web/src/app/mobile/sku-field-capture/page.tsx` (① 시작 + ② 선반 목록)
- Create: `apps/admin-web/src/app/mobile/sku-field-capture/[skuId]/page.tsx` (③ 상품 작업)
- Modify: `apps/admin-web/src/components/mobile/bottom-navigation.tsx` (「실측」 항목)

**Interfaces:**
- Consumes: Task 5 model·client, `uploadFileToFileService`(`src/lib/api/domains/files/upload.client.ts`) — **`{ contextId: REFERENCE_PHOTO_CONTEXT_ID, isPublic: true, compress: false }`**, 공개 URL 은 `src/lib/utils/file-url.ts`.
- Produces: `BarcodeScanInput({ label, onScan(value: string) })` — 카메라 버튼(`@zxing/browser` 연속 디코드, 첫 결과에서 멈춤)과 **텍스트 입력칸(엔터=제출)을 함께** 둔다. 텍스트 칸이 블루투스 스캐너·수동 입력·카메라 불가 환경의 대체 경로다. 값은 그대로 넘기고 정규화는 서버가 한다.

화면 동작(spec §5, 목업 `.superpowers/brainstorm/*/content/flow-v2.html`):
- ① 「선반 바코드 찍기」(BarcodeScanInput) · 「이름·코드로 찾기」(기존 `GET /inventory/skus?name=`·`code=` 클라이언트 재사용).
- ② `getPosition` 결과 목록: 셀메이트 이미지(로드 실패 시 자리표시), 이름, 코드, 완료면 `completedByText`. 빈 목록이면 「이 칸엔 등록된 상품이 없어요 — 이름·코드로 찾아 주세요」. **완료된 SKU 를 누르면 `completedByText` 를 보여 주고 「다시 작업할까요?」 확인 후 진입.**
- ③ 바코드 칸: 제조사 바코드 스캔 시 `getBarcodeOwner` 로 미리 확인, 남의 것이면 「이 바코드는 ○○(코드) 상품에 이미 붙어 있어요. 이 상품엔 붙이지 않고 기록만 남겨요」 경고(완료는 막지 않음). 라디오 둘(「제조사 바코드 없음 · 자체 스티커 있음」, 「바코드 아예 없음 (스티커 필요)」). 크기 세 칸(`inputMode="numeric"`). 사진: `<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment">` → `photoRejectionReason` → 업로드 → `attachPhoto` → 응답 상세로 다시 그림. 사진마다 지우기. 「여섯 면…」 체크. 완료 버튼은 `missingRequirements` 가 빌 때만 활성, 비어 있지 않으면 그 문구를 버튼 위에. 완료 성공 → ① 로(스캔 대기).
- 쿼리키는 `['sku-field-capture', 'position', code]`, `['sku-field-capture', 'detail', skuId]` — **값이 `undefined` 인 키로 무효화하지 말 것**(조용히 무효가 되는 전례).

- [ ] **Step 1: 의존성 설치** — `npm install --prefix apps/admin-web --save-exact @zxing/browser` · Expected: `package.json` 에 정확한 버전, lock 갱신. 루트·storefront lock 은 건드리지 않는다.
- [ ] **Step 2: 컴포넌트·페이지 구현** (판정은 전부 Task 5 model 호출, 컴포넌트에 조건 로직을 새로 만들지 않는다)
- [ ] **Step 3: 타입·테스트** — `(cd apps/admin-web && npm run type-check)` 에러 0, `npm run test:admin-web` PASS
- [ ] **Step 4: 로컬 배선 확인 (브라우저)** — 로컬 E2E 환경(`npm run start:all:local`)에서 PC 브라우저로 `/mobile/sku-field-capture` → 텍스트 칸에 Task 4 로 적재한 위치 코드 입력 → 목록 → 상품 → 사진 3장(PC 파일 선택) → 「바코드 아예 없음」 → 크기 → 완료 → ① 복귀, 같은 위치 재조회 시 완료 표시. **로그인은 사용자가 직접 한다**(브라우저 로그인 자동화 불가). 카메라는 HTTPS 가 필요해 여기선 확인하지 않는다(Task 8).
- [ ] **Step 5: 커밋** — `git commit -m "feat(admin-web): 실측 작업 모바일 화면과 카메라 바코드 스캔"`

---

### Task 7: admin-web 관리자 현황(`/inventory/sku-field-capture`)

**Files:**
- Create: `apps/admin-web/src/app/(admin)/inventory/sku-field-capture/page.tsx`
- Modify: `apps/admin-web/src/lib/auth/screen-access.ts` — `'/inventory/sku-field-capture': any('inventory.master.read')`
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (재고 메뉴에 「실측 작업 현황」)

**Interfaces:**
- Consumes: `skuFieldCaptureClient.getProgress()`.
- 화면: 숫자 칸 넷(남은 SKU·완료·스티커 필요·바코드 충돌), 작업자 표(작업자·오늘·누적). 60초 간격 자동 새로고침. 숫자는 서버 값을 그대로 쓴다(클라이언트에서 세지 않는다).

- [ ] **Step 1: 구현**
- [ ] **Step 2: 화면 권한 가드** — `npm run test:admin-web -- screen-access` · PASS (새 경로가 표에 없으면 `screen-access.gate.spec` 이 잡는다)
- [ ] **Step 3: 타입** — `(cd apps/admin-web && npm run type-check)` 에러 0
- [ ] **Step 4: 커밋** — `git commit -m "feat(admin-web): 실측 작업 관리자 현황"`

---

### Task 8: 전체 게이트 + 배포 메모

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-sku-field-capture-design.md` §10 (실제 이름으로 갱신: 마이그 파일명, 스크립트 명령)

- [ ] **Step 1: 검증 게이트** — `npm run type-check` 에러 0 · `npx jest --maxWorkers=2` 실패 0 · `npm run test:admin-web` 실패 0 · Task 1·2 통합 스펙 재실행 PASS.
- [ ] **Step 2: 배포 체크리스트 갱신** — spec §10 의 각 줄을 실제 명령으로: `db:migrate`(migrate→deploy), file-service `db:seed:ref`, `load-shelf-positions.ts`(DRY_RUN 먼저), `logistics_worker` 역할·부여·`landingPath=/mobile/sku-field-capture`, 실기 스모크(iPhone·Android: 카메라 선반 스캔, 원본 크기 그대로 올라갔는지 file-service 메타데이터로, 12자리 UPC 상품이 있으면 핸드 스캐너 값과 같은지, iPhone 사진이 JPEG 로 오는지).
- [ ] **Step 3: 커밋** — `git commit -m "docs: 실측 작업 배포 체크리스트"`
