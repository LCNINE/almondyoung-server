# 아몬드템플릿 게시 = 템플릿 전용 판매 상품 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 어드민에서 템플릿을 게시하면 3단계 모달에서 와우프레스 옵션·가격을 고르고, 한 번의 core 요청으로 템플릿 전용 상품과 자동 발주 매핑을 만든 뒤 템플릿을 그 상품에 연결해 공개한다.

**Architecture:** core 에 `print-catalog` 영역(와우프레스 옵션·견적·게시)을 print-order 모듈 안에 더하고, 게시는 `DbService<MergedSchema>` seam 서비스가 기존 상품 생성 서비스들을 한 트랜잭션으로 묶는다. 발주 매핑은 상수에서 `print_product_specs` 테이블로 옮긴다(상수는 대체용으로 남김). ugc 는 미리보기 이미지 업로드와 템플릿-상품 연결 경로를, admin-web 은 모달을, storefront 는 템플릿 목록 기반 판단을 더한다.

**Tech Stack:** NestJS + Drizzle(postgres.js), Jest(core/ugc), Next.js 15 + React Query(admin-web, vitest/jest 기존 설정), Next.js storefront(vitest).

**Spec:** `docs/superpowers/specs/2026-11-06-almond-template-publish-product-design.md`

## Global Constraints

- 레이어: Controller → Service(2~3줄) → Reader/Manager → Repository. 서비스는 `@app/shared` 도메인 예외만 던진다.
- 트랜잭션: `dbService.run(fn, tx)` 하나. per-class `inTx` 금지. catalog 는 `DbTransaction`(`apps/core/src/modules/catalog/catalog.types.ts:44`), print-order 는 `DbTx`(`inventory.schema.ts:5039`), 둘을 쓰는 게시 서비스만 `DbService<MergedSchema>` + `tx?: AnyTx`.
- 와우프레스 바디: prsjob 원소에 `colorno0`=`colorno`, `jobqty`=총수량. awkjob 원소에 `jobqty`=총수량. 최상위 `ordqty`=총수량(문자열), `ordcnt`='1'.
- 견적이 옳다 = 최상위 `status==200` ∧ prsjob 전부 `status==200` ∧ awkjob 전부 `status==200`·`jobcostno>0` ∧ 돌려받은 `jobqty`·`colorno0`·`wsize`/`hsize` 가 보낸 값과 같음.
- 판매가 = `ceil(원가 × 배수 / 100) × 100`. 멤버십가 = `floor(판매가 × (100 − 할인%) / 100 / 100) × 100`. 할인 칩 0·5·10, 배수 칩 2·2.5·3·직접(≥1).
- 게시 막힘: 판매가(할인 시 멤버십가) ≤ 원가, 원가 견적 실패, 종류 재단 여유 ≠ `cutsize/2`, 판매 조합 0개.
- 새 HTTP 라우트는 권한 데코레이터 필수(`route-classification.spec.ts`). 새 admin 뮤테이션 훅은 `.permission` 선언(`mutation-guard.gate.spec.ts`).
- 문구: 해요체, 특수 인용부호(«» 등) 금지, 주석에 이슈 번호 금지, 설명 주석 금지(흐름 한 줄만). 스토어프론트 새 문구는 i18n ko/en/ja.
- 테스트는 바뀐 파일 스펙만 `--maxWorkers=2` 이하로 돌린다. 공개 레포라 테넌트 값을 적지 않는다.

## Review Focus

1. 같은 템플릿으로 게시를 두 번 누름(더블 클릭·재시도) → 상품이 하나만 생기고 두 번째는 `created:false` + 기존 master id. Task 6 테스트가 고정한다.
2. 게시 도중(가격 저장 뒤 매핑 저장 전) 예외 → 상품·매핑·연결표 아무것도 남지 않음. Task 6 테스트가 고정한다.
3. 어드민이 화면에서 판매가를 원가보다 낮게 고쳐 보냄(화면 검사 우회) → 서버 재견적 후 400. Task 6 테스트가 고정한다.
4. 와우프레스가 성공 응답이지만 후가공을 무시(jobcostno −1)하거나 수량을 무시(jobqty 미반영) → 그 조합은 원가 없음으로 처리하고 게시 막힘. Task 2 테스트가 고정한다.
5. 연결(③)만 실패한 상태에서 모달을 다시 열어 게시 → 상품 재생성 없이 연결만 다시 수행. Task 9 테스트가 고정한다.

---

## File Structure

core `apps/core/src/modules/print-order/`
- `schema/print-order.schema.ts` — `printProductSpecs`, `printTemplateProducts` 테이블 추가
- `repositories/print-product-spec.repository.ts` — 매핑·연결표 읽기/쓰기
- `wowpress/wowpress-body.ts` — 바디 생성(`buildJobs`)·견적 판정(`judgeJobcost`) 순수 함수
- `wowpress/wowpress.client.ts` — `prodInfo`, `jobcost` 추가
- `print-catalog/print-kind-products.ts` — 종류→와우프레스 제품 표
- `print-catalog/print-options.builder.ts` — prod_info → 모달 축·제약 순수 함수
- `print-catalog/print-catalog.reader.ts` / `print-catalog.service.ts` / `print-catalog.controller.ts` / `dto/*` — 옵션·견적 조회
- `print-catalog/print-product-publisher.ts` — 게시 seam(상품+가격+매핑+연결표)
- `services/print-order-submit.manager.ts` — 매핑 테이블 우선 조회
- `services/print-order-admin.manager.ts` — 확인 완료 시 variant `confirmed`

ugc `apps/ugc-service/src/almond-template/` — 컨트롤러·매니저에 `:id/product`, `:id/preview-image`

admin-web `apps/admin-web/src/`
- `lib/api/domains/products/print-catalog.client.ts`, `almond-templates.client.ts`(추가 함수)
- `lib/services/products/{queries,mutations}.ts`(훅 추가)
- `features/mall/almond-templates/publish/publish-model.ts`(+spec) — 순수 계산
- `features/mall/almond-templates/publish/publish-dialog.tsx` 와 단계 컴포넌트 3개
- `features/mall/almond-templates/template/index.tsx` — 게시하기 → 모달

storefront `web/almondyoung-storefront/src/domains/almond-template/`
- `lib/template-product.ts`(+test) — 상품 → 템플릿 판단
- 기존 판단 지점 교체(아래 Task 11)

---

### Task 1: 매핑·연결표 테이블과 저장소, 발주 매니저가 테이블 먼저 보기

**Files:**
- Modify: `apps/core/src/modules/print-order/schema/print-order.schema.ts`
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`wmsTables` 에 두 테이블 추가, 기존 `printOrders` 옆)
- Create: `apps/core/src/modules/print-order/repositories/print-product-spec.repository.ts`
- Modify: `apps/core/src/modules/print-order/services/print-order-submit.manager.ts:137-148`
- Modify: `apps/core/src/modules/print-order/print-order.module.ts` (provider 등록)
- Create: `apps/core/drizzle/<timestamp>_add-print-product-specs.sql` (+ `meta/`)
- Test: `apps/core/src/modules/print-order/services/print-order-submit.manager.spec.ts`

**Interfaces:**
- Produces:
  - 테이블 `print_product_specs`: `variant_id uuid PK`, `prodno int`, `jobpresetno text`, `prsjob jsonb`, `awkjob jsonb`, `qty_per_unit int`, `file_format text`('jpg'|'pdf'|'eps'), `file_dpi int`, `design_product_id varchar(36)`, `design_width_mm int`, `design_height_mm int`, `confirmed bool default false`, `confirmed_at timestamptz null`, `confirmed_by text null`, `created_at`, `updated_at`.
  - 테이블 `print_template_products`: `template_id uuid PK`, `master_id uuid not null`, `created_at`.
  - `PrintProductSpecRepository.findSpec(variantId: string, tx?: DbTx): Promise<WowpressLineSpec | null>`
  - `PrintProductSpecRepository.insertSpecs(rows: { variantId: string; spec: WowpressLineSpec }[], tx: AnyTx): Promise<void>`
  - `PrintProductSpecRepository.claimTemplate(templateId: string, masterId: string, tx: AnyTx): Promise<{ claimed: true } | { claimed: false; masterId: string }>` (INSERT … ON CONFLICT DO NOTHING 후 기존 행 읽기)
  - `PrintProductSpecRepository.confirmVariant(variantId: string, actorId: string, tx?: DbTx): Promise<void>`

- [ ] **Step 1: 실패 테스트** — `print-order-submit.manager.spec.ts` 에 `it('uses the spec table before the constant')`: repository mock `findSpec` 가 `CONFIRMED_VARIANT` 와 다른 prodno 의 spec 을 돌려주면 `wowpress.order` 의 첫 item `spec.prodno` 가 그 값이다. `it('falls back to WOWPRESS_PRODUCTS when the table has no row')`: `findSpec` → null 이면 기존 동작(상수 spec) 그대로.
- [ ] **Step 2: 실행해 실패 확인** — `npx jest apps/core/src/modules/print-order/services/print-order-submit.manager.spec.ts --maxWorkers=2` → FAIL(findSpec 없음)
- [ ] **Step 3: 구현** — 스키마 두 테이블(기존 `printOrders` 와 같은 객체 인덱스 스타일), 저장소 4메서드(행 ↔ `WowpressLineSpec` 변환), `lineSpec` 이 `await this.specs.findSpec(variantId) ?? WOWPRESS_PRODUCTS[variantId]` 를 쓴다.
- [ ] **Step 4: 마이그 생성** — `npm run db:generate:core -- --name add-print-product-specs`, 생성 SQL 이 CREATE TABLE 두 개뿐인지 확인.
- [ ] **Step 5: 테스트 통과 확인** — 같은 명령 → PASS
- [ ] **Step 6: Commit** — schema·repository·manager·spec·`drizzle/` SQL 과 `meta/` 를 한 커밋.

### Task 2: 와우프레스 바디 생성·견적 판정 순수 함수, 클라이언트 `prodInfo`/`jobcost`

**Files:**
- Create: `apps/core/src/modules/print-order/wowpress/wowpress-body.ts`
- Create: `apps/core/src/modules/print-order/wowpress/wowpress-body.spec.ts`
- Modify: `apps/core/src/modules/print-order/wowpress/wowpress.client.ts` (`withJobqty` 를 `buildJobs` 로 대체, 메서드 2개 추가)
- Modify: `apps/core/src/modules/print-order/wowpress/wowpress.types.ts`
- Test: `apps/core/src/modules/print-order/wowpress/wowpress.client.spec.ts`

**Interfaces:**
- Produces:
  - `buildJobs(spec: Pick<WowpressLineSpec,'prsjob'|'awkjob'|'qtyPerUnit'>, qty: number): { prsjob: Record<string, unknown>[]; awkjob: Record<string, unknown>[] }` — prsjob 각 원소에 `jobqty`, `colorno` 가 있으면 `colorno0` 도 같은 값. awkjob 각 원소에 `jobqty`.
  - `type JobcostVerdict = { ok: true; supply: number; bill: number } | { ok: false; reason: string }`
  - `judgeJobcost(sent: { prsjob: Record<string, unknown>[]; awkjob: Record<string, unknown>[] }, response: unknown): JobcostVerdict`
  - `WowpressClient.prodInfo(prodno: number): Promise<WowpressProdInfo>` (`GET /api/v1/std/prod_info/{prodno}` 의 `resultMap.prod_info`, 타입은 쓰는 필드만: `prodno, prodname, filetype, sizeinfo, paperinfo, colorinfo, ordqty, prsjobinfo, awkjobinfo, dlvyprepay, dlvygrpno`)
  - `WowpressClient.jobcost(spec: Pick<WowpressLineSpec,'prodno'|'prsjob'|'awkjob'|'qtyPerUnit'>, qty: number): Promise<JobcostVerdict>`
  - 기존 `quote(spec, qty)` 은 `jobcost` 를 불러 `ok:false` 면 `WowpressApiError(reason)` 를 던진다(발주 전 검증 유지).

- [ ] **Step 1: 실패 테스트** — `wowpress-body.spec.ts`:
  - `buildJobs({prsjob:[{colorno:256,jobno:3110}],awkjob:[{jobno:23010}],qtyPerUnit:500}, 2)` → prsjob `[{colorno:256,colorno0:256,jobno:3110,jobqty:1000}]`, awkjob `[{jobno:23010,jobqty:1000}]`.
  - `judgeJobcost`: 정상 응답(최상위 status 200, ordcost_sup 4100, ordcost_bill 4510, prsjob echo jobqty 500·colorno0 256, awkjob status 200·jobcostno 12) → `{ok:true,supply:4100,bill:4510}`.
  - awkjob `jobcostno:-1` → `ok:false`. 최상위 status 900 → `ok:false`. prsjob echo `jobqty` 가 보낸 값과 다름 → `ok:false`. echo `colorno0` 다름 → `ok:false`. 보낸 `wsize` 와 echo 다름 → `ok:false`.
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/print-order/wowpress/wowpress-body.spec.ts --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현** — 두 함수, 클라이언트 두 메서드(기존 `call` 재사용, `quote` 는 `jobcost` 위로).
- [ ] **Step 4: 통과 확인** — `wowpress-body.spec.ts` 와 `wowpress.client.spec.ts` → PASS (기존 jobqty 기대값 유지)
- [ ] **Step 5: Commit**

### Task 3: 종류→와우프레스 제품 표와 옵션 축 빌더

**Files:**
- Create: `apps/core/src/modules/print-order/print-catalog/print-kind-products.ts`
- Create: `apps/core/src/modules/print-order/print-catalog/print-options.builder.ts`
- Create: `apps/core/src/modules/print-order/print-catalog/print-options.builder.spec.ts`
- Create fixture: `apps/core/src/modules/print-order/print-catalog/__fixtures__/prod-info-40073.json`, `prod-info-40106.json` (2026-11-06 조회본에서 필요한 필드만)

**Interfaces:**
- Produces:
  - `type PrintKind = 'card'|'bizcard'|'nail'|'pet'|'mini'|'window'|'menu'`
  - `PRINT_KIND_PRODUCTS: Record<PrintKind, { prodno: number; sizeno: number; wsize?: number; hsize?: number; bleedMm: number; fileFormat: 'jpg'|'pdf'|'eps'; fileDpi: number }[]>` — card·bizcard `{40073, sizeno 5458, bleed 1, pdf 300}`, nail `{40073, 7071, 90, 90, bleed 1, pdf 300}`, pet `{40106, 5670, bleed 0, jpg 150}`, mini `{40162, 5668|5669, bleed 1.5, jpg 300}`, window `{40115, 5666, w/h 600|800|1000, bleed 0, jpg 700}`, menu `{40164, A4 5678/A3 5677/A5 5679, bleed 0, jpg 300}`. `bleedMm` 은 스토어프론트 `PRINT_SPECS` 와 같은 값(어긋나면 게시 막힘 판단에 쓴다).
  - `type PrintOptionAxes = { prodno: number; prodname: string; cutsizeHalfMm: number; papers: {paperno:number; label:string}[]; colors: {colorno:number; label:string; jobno:number}[]; quantities: {key:string; values:number[]}[]; requiredAwk: {group:string; options:{jobno:number; label:string}[]; defaultJobno:number}[]; forbiddenAwk: {jobno:number; reason:string}[] }`
  - `buildPrintOptions(prodInfo: WowpressProdInfo, product: { sizeno: number; wsize?: number; hsize?: number }): PrintOptionAxes`

- [ ] **Step 1: 실패 테스트** — 40073 fixture + sizeno 5458: papers 에 22904·22907·22908, colors 에 255(jobno 3110)·256(jobno 3110), quantities 에 500·1000·2000 포함, `cutsizeHalfMm` 1. sizeno 10732: `forbiddenAwk` 에 박 11538 이 있다. 40106 fixture: `requiredAwk` 두 그룹(코팅·아일렛), 각 `defaultJobno` 가 옵션 중 첫 값. `cutsizeHalfMm` 0.
- [ ] **Step 2: 실패 확인** — `npx jest .../print-options.builder.spec.ts --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현** — radio 그룹 = 필수(기본값 첫 옵션), `rst_awkjob` 크기 범위를 벗어나면 forbidden, 수량은 ordqty 배열 중 sizeno·paperno·colorno 조건이 맞는 목록.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit**

### Task 4: 옵션·견적 조회 API

**Files:**
- Create: `apps/core/src/modules/print-order/print-catalog/print-catalog.reader.ts`
- Create: `apps/core/src/modules/print-order/print-catalog/print-catalog.service.ts`
- Create: `apps/core/src/modules/print-order/print-catalog/print-catalog.controller.ts`
- Create: `apps/core/src/modules/print-order/print-catalog/dto/print-catalog.dto.ts`
- Modify: `apps/core/src/modules/print-order/print-order-admin.module.ts` (controller·providers)
- Test: `apps/core/src/modules/print-order/print-catalog/print-catalog.reader.spec.ts`

**Interfaces:**
- Consumes: Task 2 `prodInfo`, `jobcost`, `buildJobs`; Task 3 `PRINT_KIND_PRODUCTS`, `buildPrintOptions`.
- Produces:
  - `GET /admin/print-catalog/:kind/options?width=&height=` (`@RequirePermission('marketing.almond_template.write')`) → `PrintOptionAxes & { bleedMatches: boolean }` (크기에 맞는 PRINT_KIND_PRODUCTS 원소를 고름, 없으면 400 `BadRequestError`).
  - `POST /admin/print-catalog/:kind/quotes` body `{ width:number; height:number; combos: PrintCombo[] }` → `{ key: string; verdict: JobcostVerdict }[]`
  - `type PrintCombo = { key: string; paperno: number; colorno: number; qty: number; awk: number[] }`
  - `PrintCatalogReader.toSpec(kind: PrintKind, size:{width:number;height:number}, combo: PrintCombo): WowpressLineSpec` (게시에서도 쓴다; `qtyPerUnit = combo.qty`, `confirmed:false`, `design` 은 호출부가 채운다)

- [ ] **Step 1: 실패 테스트** — reader spec: `toSpec('bizcard', {width:90,height:50}, {key:'k',paperno:22904,colorno:256,qty:500,awk:[]})` → `prodno 40073`, prsjob `[{covercd:0,sizeno:5458,paperno:22904,colorno:256,jobno:3110}]`(jobqty 는 buildJobs 가 붙이므로 없음), `qtyPerUnit 500`, `file {pdf,300}`. `quotes` 는 조합마다 `jobcost` 를 한 번씩 순차 호출하고 결과를 key 로 돌려준다(client mock 호출 횟수·순서 단언).
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 조합은 순차 호출(와우프레스 부하), 한 조합 실패가 다른 조합을 막지 않는다.
- [ ] **Step 4: 통과 확인** + `npx jest libs/authorization --maxWorkers=2 -t route-classification` 로 새 라우트 분류 통과
- [ ] **Step 5: Commit**

### Task 5: 확인 완료가 variant 매핑을 확정

**Files:**
- Modify: `apps/core/src/modules/print-order/services/print-order-admin.manager.ts:71`
- Modify: `apps/core/src/modules/print-order/repositories/print-order.repository.ts` (라인 variantId 읽기, 이미 `findLineContext` 가 있으면 재사용)
- Test: `apps/core/src/modules/print-order/services/print-order-admin.manager.spec.ts`

**Interfaces:**
- Consumes: Task 1 `confirmVariant`.
- Produces: `confirmTest(id, actorId, note)` 가 같은 tx 에서 print_orders 행 표시 + 그 라인 variant 의 `confirmVariant` 호출. 테이블에 행이 없으면(상수 variant) 아무것도 안 한다.

- [ ] **Step 1: 실패 테스트** — `it('confirms the variant spec with the test')`: confirmTest 후 `specs.confirmVariant` 가 라인 variantId·actorId 로 한 번 불린다.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit**

### Task 6: 게시 seam — 상품·가격·매핑·연결표를 한 트랜잭션으로

**Files:**
- Create: `apps/core/src/modules/print-order/print-catalog/print-product-publisher.ts`
- Create: `apps/core/src/modules/print-order/print-catalog/print-product-publisher.spec.ts`
- Modify: `print-catalog.controller.ts`, `print-catalog.service.ts`, `dto/print-catalog.dto.ts`, `print-order-admin.module.ts` (ProductsModule·PricingModule import)

**Interfaces:**
- Consumes: `ProductMastersService.createMaster(ownerId, tx)`, `.updateVersion(versionId, data, userId, tx)`, `BulkSessionComboResolver.resolveExisting(masterId, versionId, tx)`, `PricingService.replaceVersionRules(versionId, dto, tx)`, `ProductVersionsService.publishVersion(versionId, userId, tx)` (선례 `BulkDraftApplier.applyCreate`), Task 1 `insertSpecs`·`claimTemplate`, Task 4 `toSpec`·`quotes`.
- Produces:
  - `POST /admin/print-catalog/publish` (`@RequirePermission('catalog.product.write')` + 핸들러에서 `PermissionCheckpoints.check` 로 `catalog.price.write`, `marketing.almond_template.write`)
  - body `PublishPrintProductDto { templateId: uuid; kind: PrintKind; width: number; height: number; name: string; description: string; thumbnailFileId: uuid; combos: (PrintCombo & { price: number; memberPrice: number | null; optionLabels: { paper: string; side: string; qty: string } })[] }`
  - 응답 `{ masterId: string; created: boolean }`. 이미 게시한 템플릿이면 아무것도 만들지 않고 `{ masterId: 기존, created: false }` (멱등, 200).
  - `PrintProductPublisher.publish(dto, userId, tx?: AnyTx): Promise<{ masterId: string; created: boolean }>`
  - 옵션 그룹: `용지`, `면`, `수량` 세 개(값은 고른 조합에 나온 것만). 조합 → variant 는 세 optionValueId 정렬 키로 찾는다.
  - 가격 룰: order 1 `all_variants` override = 최저 판매가, 이어서 variant 마다 `variants` override(판매가), memberPrice 가 있으면 `membership_price` 레이어에 같은 방식.
  - 매핑: variant 마다 `toSpec(...)` + `design = { productId: masterId, widthMm: width, heightMm: height }`.

- [ ] **Step 1: 실패 테스트** (`print-product-publisher.spec.ts`, 서비스 mock):
  - `publishes master, options, prices, specs and claims the template in one transaction`: 모든 하위 호출이 같은 tx 객체를 받는다. `replaceVersionRules` 첫 룰이 `{order:1, scopeType:'all_variants', operationType:'override', operationValue: 최저가}`. `insertSpecs` 행 수 = 조합 수, 각 `spec.design.productId === masterId`.
  - `returns the existing master when the template was already published`: `claimTemplate` → `{claimed:false, masterId:'m-1'}` 이면 `{masterId:'m-1', created:false}` 이고 `createMaster` 미호출.
  - `rejects a price at or below the quoted cost`: 재견적 supply 4100, price 4100 → `BadRequestError`, `createMaster` 미호출.
  - `rejects when a member price is at or below cost`: memberPrice 4000, supply 4100 → `BadRequestError`.
  - `leaves nothing when spec insert fails`: `insertSpecs` throw → publish 가 throw (실제 롤백은 run 이 보장; 테스트는 run 콜백 안에서 예외가 전파되는지 단언).
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 순서: 재견적 검증(트랜잭션 밖) → `run` 안에서 claimTemplate → createMaster → updateVersion(name, description, thumbnailFileId, optionDiff add 세 그룹) → resolveExisting → replaceVersionRules → insertSpecs → publishVersion.
- [ ] **Step 4: 통과 확인** → PASS, `route-classification` 통과
- [ ] **Step 5: Commit**

### Task 7: ugc 미리보기 이미지와 템플릿-상품 연결

**Files:**
- Modify: `apps/ugc-service/src/almond-template/controllers/admin-almond-templates.controller.ts`
- Modify: `apps/ugc-service/src/almond-template/services/almond-templates.service.ts`, `almond-template.manager.ts`
- Create: `apps/ugc-service/src/almond-template/dto/link-almond-template-product.dto.ts`
- Test: `apps/ugc-service/src/almond-template/services/almond-template.manager.spec.ts`(없으면 생성), `controllers/admin-almond-templates.controller.spec.ts`

**Interfaces:**
- Produces:
  - `PUT /admin/almond-templates/:id/product` body `{ productId: string }` (`marketing.almond_template.write`) → `AdminAlmondTemplateSummaryResponseDto`
  - `AlmondTemplateManager.linkProduct(id: string, productId: string, userId: string, tx?: UgcTx)` — `product_id` 와 `design.productId` 를 같이 바꾸고 `status='published'`. 이미 같은 값이면 그대로 반환. unique 충돌은 `ConflictError`.
  - `POST /admin/almond-templates/:id/preview-image` (`marketing.almond_template.write`) → `{ fileId: string }` — 기존 미리보기 JPG 생성과 file-service 업로드 경로를 재사용(인쇄 파일 업로드 코드와 같은 클라이언트).

- [ ] **Step 1: 실패 테스트** — `linkProduct` 후 행의 `productId` 와 `design.productId` 가 새 값, status published. 같은 값으로 두 번 → 두 번째도 성공·값 동일. 컨트롤러 spec: 두 라우트 권한 메타데이터가 `marketing.almond_template.write`.
- [ ] **Step 2: 실패 확인** — `npx jest apps/ugc-service/src/almond-template --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit**

### Task 8: admin-web 클라이언트와 훅

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/products/print-catalog.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/almond-templates.client.ts`
- Modify: `apps/admin-web/src/lib/services/products/queries.ts`, `mutations.ts`
- Create DTO types: `apps/admin-web/src/lib/types/dto/print-catalog.ts`

**Interfaces:**
- Produces:
  - `printCatalogClient.options(kind, width, height)`, `.quotes(kind, body)`, `.publish(body)` (BASE `${ALMONDYOUNG_API_BASE_URL}/admin/print-catalog`)
  - `almondTemplatesClient.linkProduct(id, productId)`, `.previewImage(id)`
  - 훅: `usePrintOptions(kind, width, height)`, `usePrintQuotes()`(mutation), `usePublishPrintProduct()` with `.permission = { allOf: [['catalog.product.write'], ['catalog.price.write'], ['marketing.almond_template.write']] }`, `useLinkAlmondTemplateProduct()` with `.permission = ['marketing.almond_template.write']`

- [ ] **Step 1: 구현** — 클라이언트 함수와 훅을 `.permission` 선언과 함께 추가(기존 `useUpdateAlmondTemplateStatus` 와 같은 모양).
- [ ] **Step 2: 게이트 통과 확인** — `npm run test:admin-web -- mutation-guard screen-access` → PASS
- [ ] **Step 3: Commit**

### Task 9: 게시 모달(시안 그대로)

**Files:**
- Create: `apps/admin-web/src/features/mall/almond-templates/publish/publish-model.ts`
- Create: `apps/admin-web/src/features/mall/almond-templates/publish/publish-model.spec.ts`
- Create: `apps/admin-web/src/features/mall/almond-templates/publish/publish-dialog.tsx`, `step-product.tsx`, `step-options.tsx`, `step-confirm.tsx`
- Modify: `apps/admin-web/src/features/mall/almond-templates/template/index.tsx:97-107, 314-324`

**Interfaces:**
- Consumes: Task 8 훅, Task 4 `PrintOptionAxes`, `JobcostVerdict`.
- Produces (`publish-model.ts`):
  - `combos(picked: { papers:number[]; colors:number[]; qtys:number[] }): PrintCombo[]` (forbidden 은 축 단계에서 이미 빠짐)
  - `priceFor(cost: number, times: number): number`, `memberPriceFor(price: number, discountPct: 0|5|10): number`
  - `applyTimes(prices: Record<string,number>, edited: Set<string>, costs: Record<string,number>, times: number): Record<string,number>` (edited 는 유지)
  - `blockers(rows: {key:string; cost:number|null; price:number; memberPrice:number|null; on:boolean}[], bleedMatches: boolean): string[]` (빈 배열이면 게시 가능)
  - 임시 저장 키 `almond-publish-draft:<templateId>` (localStorage, try/catch)

- [ ] **Step 1: 실패 테스트** (`publish-model.spec.ts`):
  - `priceFor(3100, 2.5) === 7800`, `memberPriceFor(7800, 10) === 7000`, `memberPriceFor(7800, 0) === 7800`
  - `applyTimes` 가 edited 키 값을 바꾸지 않는다
  - `blockers`: cost null → 견적 실패 문구, price ≤ cost → 원가 이하 문구, memberPrice ≤ cost → 멤버십가 문구, `bleedMatches:false` → 재단 여유 문구, on 인 행 0개 → 조합 없음 문구
- [ ] **Step 2: 실패 확인** — `npm run test:admin-web -- publish-model` → FAIL
- [ ] **Step 3: 구현** — 모델 함수, 3단계 컴포넌트(시안 `아몬드템플릿 게시 모달 시안` 과 같은 문구·칩: 배수 2/2.5/3/직접, 할인 없음/5%/10%). 게시하기 클릭 순서: `previewImage` → `publish` → `linkProduct`. publish 가 `created:false` 여도 받은 masterId 로 `linkProduct` 를 수행한다. `linkProduct` 실패 시 "게시 마무리 다시 시도" 버튼(같은 masterId 로 linkProduct 재호출). 초안 템플릿의 게시하기만 모달을 연다. 게시 내리기는 기존 status 토글.
- [ ] **Step 4: 통과 확인** — `npm run test:admin-web -- publish-model` → PASS, 수동으로 `npm run start:admin-web:dev` 에서 모달 3단계 확인
- [ ] **Step 5: Commit**

### Task 10: 22개 variant 매핑 옮기기 스크립트

**Files:**
- Create: `scripts/ops/print-product-specs/migrate-constant-specs.ts`
- Create: `scripts/ops/print-product-specs/README.md` (실행법 3줄)

**Interfaces:**
- Consumes: `WOWPRESS_PRODUCTS`, Task 1 테이블.
- Produces: `--stage <stage> --tenant <slug> [--dry-run]` 로 상수 행을 `print_product_specs` 에 `ON CONFLICT DO NOTHING` 삽입하고 삽입 수를 출력. `confirmed` 는 상수 값 그대로.

- [ ] **Step 1: 로컬 실행** — `npx tsx scripts/ops/print-product-specs/migrate-constant-specs.ts --stage local --dry-run` → `would insert 22`
- [ ] **Step 2: Commit** (라이브 삽입은 배포 때)

### Task 11: 스토어프론트 템플릿 상품 판단

**Files:**
- Create: `web/almondyoung-storefront/src/domains/almond-template/lib/template-product.ts`
- Create: `web/almondyoung-storefront/src/domains/almond-template/lib/template-product.test.ts`
- Modify: `domains/products/product-details/components/product-actions/index.tsx:104-105,318-325`
- Modify: `domains/products/product-details/templates/index.tsx:58-61`
- Modify: `app/[countryCode]/(main)/almond-template/edit/page.tsx:25`, `app/[countryCode]/(main)/almond-template/page.tsx:44`
- Modify: `domains/almond-template/lib/gallery-filter.ts:58,82`

**Interfaces:**
- Produces:
  - `type TemplateProduct = { productId: string; kind: PrintKind; title: string }`
  - `templateProductOf(productId: string, templates: { productId: string; kind?: string | null; title: string }[]): TemplateProduct | undefined` — `PRINT_PRODUCTS[productId]` 가 있으면 그것, 없으면 공개 템플릿 중 `productId` 가 같은 첫 템플릿의 `templateKind`.
  - 서버 컴포넌트에서 `listAlmondTemplates()`(기존 공개 목록, 캐시 태그 그대로)로 templates 를 받아 넘긴다.

- [ ] **Step 1: 실패 테스트** — 기존 6종 productId → PRINT_PRODUCTS 값. 새 productId + 공개 템플릿 `{productId:'new', kind:'bizcard'}` → `{kind:'bizcard'}`. 둘 다 없으면 undefined. `filterTemplates` 가 PRINT_PRODUCTS 에 없는 productId 라도 kind 가 있으면 남긴다(검색어는 템플릿 제목만으로).
- [ ] **Step 2: 실패 확인** — `cd web/almondyoung-storefront && npx vitest run src/domains/almond-template/lib --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현** — 판단 지점 다섯 곳이 `templateProductOf` 하나를 쓰게 바꾼다.
- [ ] **Step 4: 통과 확인** → PASS, `npx tsc --noEmit -p .` 에서 바꾼 파일 에러 0(기존 46개는 그대로)
- [ ] **Step 5: Commit**

---

## 배포 (계획 밖, 사람이 순서대로)

1. core 마이그 적용(`db:migrate -- --deployment lcnine-services`)
2. core, ugc(BundleA→B) 배포 → `migrate-constant-specs.ts --stage live` 실행
3. admin-web, storefront 배포
4. 새 템플릿 하나를 게시해 상품·매핑·연결 확인, 첫 주문은 테스트 확인대기 → 전화 확인 → 확인 완료
5. 다음 PR 에서 `WOWPRESS_PRODUCTS` 상수와 대체 조회 제거(contract)
