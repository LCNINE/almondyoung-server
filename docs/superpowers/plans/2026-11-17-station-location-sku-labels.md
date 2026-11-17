# 스테이션 로케이션·SKU 라벨 출력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** warehouse-app 스테이션에서 TX400 으로 로케이션 라벨(50×30)과 SKU 라벨(30×10 / 50×30)을 뽑는다. 송장 출력은 그대로 둔다.

**Architecture:** core 가 라벨 ZPL 을 만든다. 송장 렌더러의 캐리어 중립 부분을 `apps/core/src/platform/label/` 로 옮겨 송장과 새 라벨이 함께 쓴다. 바이트를 만드는 새 엔드포인트 둘을 `apps/core/src/modules/inventory/labels/` 에 둔다. 앱은 «라벨 프린터» 칸을 하나 더 두고, 받은 바이트를 그 칸으로 `print_raw` 한다.

**Tech Stack:** NestJS 11 · Drizzle(postgres.js) · resvg(`SvgRasterizer`) · ZPL II · React + TanStack Router/Query · Tauri · Jest(core) · Vitest(warehouse-app)

**Spec:** `docs/superpowers/specs/2026-11-17-station-location-sku-labels-design.md`

## Global Constraints

- 송장 출력 동작은 바뀌지 않는다. 기존 송장 spec 은 고치지 않고 그대로 초록이어야 한다(import 경로만 바뀐다).
- 송장 프린터 키 `almondwms.labelPrinter` 는 이름과 값 모두 그대로 둔다. 새 라벨 프린터 키는 `almondwms.barcodeLabelPrinter` 다.
- 라벨 엔드포인트의 권한은 `@RequirePermission('inventory.stock.read')` 다. 새 권한 키는 만들지 않는다.
- 로케이션 바코드 값은 `locations.code` 그대로다. `barcode.service.ts` 의 `generateLocationBarcode`(`LOC-` 접두어)는 쓰지 않는다.
- SKU 바코드 값은 `sku_barcodes` 의 `is_primary` 행이다. 대표가 없으면 `created_at` 이 가장 이른 행, 행이 없으면 `NO_BARCODE` 다. 상품명은 `skus.name` 그대로 쓴다(`labelSkuNameOf` 를 쓰지 않는다).
- 바코드 막대 폭(모듈)은 기준 모듈에서 시작해, 라벨 폭 − 2 mm 를 넘으면 1 dot 씩 줄인다. **2 dot 가 바닥**이고, 2 dot 로도 넘으면 `BARCODE_TOO_WIDE` 다. 기준 모듈은 로케이션 3, SKU 30×10 2, SKU 50×30 3 이다.
- 한 요청의 라벨 수(장수 포함)는 최대 500, 항목 하나의 `copies` 는 1~200 이다. 넘으면 400 이다.
- 그릴 것이 없어도 에러가 아니다. `data: ''` 와 `skipped` 만 돌려준다.
- 라벨 ZPL 의 `^GF` 압축은 끈다(`LABEL_ZPL_COMPRESS = false`). 송장과 같은 이유다(TX400 실물 확인 전).
- 사용자 화면 문구는 한국어다. 작업자에게는 «라벨»(바코드 스티커·자석)과 «송장»을 섞지 않는다.
- 🔒 공개 레포다. 테넌트 값을 코드·커밋에 적지 않는다.
- 🔴 E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다. jest 는 `--maxWorkers=2` 로 돌린다.

## Review Focus

1. **아주 긴 상품명, 괄호·이모지가 든 상품명.** 두 줄 안에서 말줄임되고 바코드 금지 구역을 침범하지 않아야 한다 → Task 3.
2. **ZPL 제어문자(`^` `~`)나 ASCII 밖 글자가 든 바코드·로케이션 코드.** 500 이 아니라 그 항목만 `UNSUPPORTED_CODE` 로 건너뛰어야 한다. `>` 는 `><` 로 이스케이프된다 → Task 2, Task 4.
3. **활성 칸이 없거나 전부 한글인 랙.** `data: ''` 를 받으면 앱은 프린터로 아무것도 보내지 않고 사유를 보여 준다 → Task 4, Task 8.
4. **송장 프린터만 설정되고 라벨 프린터는 비어 있을 때.** SKU·로케이션 출력이 송장 프린터로 새지 않고 «라벨 프린터» 안내를 띄운다 → Task 6, Task 7.
5. **출력 버튼 연타.** 같은 틱에 두 번 눌러도 인쇄 작업은 하나만 간다 → Task 7, Task 8.

---

### Task 1: 렌더러 공통부를 `platform/label` 로 옮긴다

**Files:**
- Move(`git mv`, spec 포함): `apps/core/src/modules/fulfillment/waybill/label/{label-model,svg-rasterizer,svg-text,zpl-encoder,label-document}.ts` 와 각 `.spec.ts` → `apps/core/src/platform/label/`
- Move: `apps/core/src/modules/fulfillment/waybill/label/__support__/label-invariants.ts` → `apps/core/src/platform/label/__support__/label-invariants.ts`
- Create: `apps/core/src/platform/label/svg-elements.ts`. `hanjin-label-svg.ts` 의 `TextEl`·`text`·`svgDocument`·`wrapLines` 를 옮긴다. `hanjin-label-svg.ts` 는 이 넷을 re-export 하므로 한진 템플릿의 import 는 바뀌지 않는다.
- Create: `apps/core/src/platform/label/label-renderer.module.ts`
- Modify: 위 파일들을 import 하는 곳 전부. 확인하는 명령은 `grep -rlnE "label/(label-model|svg-text|zpl-encoder|label-document|svg-rasterizer)'" apps scripts --include=*.ts` 다. `waybill.module.ts`, `waybill-label.manager(.spec).ts`, `__support__/label-fixtures.ts`, `carrier/hanjin/label/*`, `scripts/ops/hanjin-label-preview/render.ts` 가 걸린다.

**Interfaces:**
- Produces: `@Module({ providers: [{ provide: SvgRasterizer, useFactory: () => new SvgRasterizer() }], exports: [SvgRasterizer] }) export class LabelRendererModule {}`. 정적 모듈이다(Nest 11 에서 동적 모듈을 두 번 등록하면 인스턴스가 두 벌이 된다).
- Produces: `apps/core/src/platform/label/*` 의 기존 export 이름과 시그니처는 그대로다. `svg-elements.ts` 는 `TextEl`, `text`, `svgDocument`, `wrapLines` 를 export 한다.

- [ ] **Step 1: `git mv` 로 옮기고 import 경로를 고친다.** `WaybillModule` 은 `SvgRasterizer` provider 줄을 지우고 `imports` 에 `LabelRendererModule` 을 더한다.
- [ ] **Step 2: 옮긴 spec 과 송장 spec 이 그대로 통과하는지 본다.**
  Run: `npx jest apps/core/src/platform/label apps/core/src/modules/fulfillment/waybill --maxWorkers=2`
  Expected: 전부 PASS. 옮기기 전과 테스트 수가 같다.
- [ ] **Step 3: 타입을 본다.**
  Run: `npm run type-check`
  Expected: 에러 0
- [ ] **Step 4: 커밋**

```bash
git add -A apps/core/src/platform/label apps/core/src/modules/fulfillment/waybill scripts/ops/hanjin-label-preview
git commit -m "[core] 라벨 렌더러 공통부를 platform/label 로 옮긴다 (#1281)"
```

---

### Task 2: Code128 최적 부호화와 장수(`^PQ`)

**Files:**
- Create: `apps/core/src/platform/label/code128.ts`, `apps/core/src/platform/label/code128.spec.ts`
- Modify: `apps/core/src/platform/label/label-model.ts` (`BarcodeKind`, `barcodeWidthMm`)
- Modify: `apps/core/src/platform/label/zpl-encoder.ts` (`barcodeField`, `ZplOptions`, `encodeZpl`)
- Modify: `apps/core/src/platform/label/label-document.ts` (`encodeLabelRuns` 추가)
- Test: `zpl-encoder.spec.ts`, `label-model.spec.ts`, `label-document.spec.ts` 에 케이스를 더한다.

**Interfaces:**
- Produces: `export interface Code128Plan { zplData: string; modules: number }`
- Produces: `export function planCode128(data: string): Code128Plan | null`. ASCII 32~126 밖 글자가 있거나 `^`·`~` 가 있거나 빈 문자열이면 `null` 이다.
- Produces: `BarcodeKind = 'ITF' | 'CODE128' | 'CODE128_OPTIMAL'`. 기존 `'CODE128'`(subset B, 송장 터미널 코드)은 그대로 둔다.
- Produces: `ZplOptions.copies?: number` (기본 1, `^PQ{copies}`)
- Produces: `export function encodeLabelRuns(runs: readonly { spec: LabelSpec; copies: number }[], rasterizer: SvgRasterizer, compress: boolean): string`. 쪽마다 `^XA…^XZ` 를 하나씩 두고 `\n` 으로 잇는다. 빈 배열이면 `''` 다(`encodeLabelPages` 와 달리 던지지 않는다).

`planCode128` 의 부호화 규칙(ZPL `^BC` 모드 N 의 invocation code 로 낸다):
- 시작: 데이터가 숫자 4개 이상으로 시작하거나 데이터 전체가 숫자 2개면 `>;`(Start C), 아니면 `>:`(Start B).
- C 에서는 숫자 쌍을 하나씩 소비한다. 남은 숫자가 둘 미만이거나 숫자가 아닌 글자를 만나면 `>6`(Code B)로 바꾼다.
- B 에서는 이어지는 숫자가 끝까지 4개 이상이거나, 중간에서 6개 이상이면 C 로 바꾼다(`>5`). 숫자 개수가 홀수면 첫 숫자 하나를 B 로 찍고 바꾼다.
- 데이터 안의 `>` 는 `><` 로 이스케이프한다.
- `modules = 11 × (기호 수: 시작 + 데이터 기호 + 전환 기호 + 체크) + 13`

- [ ] **Step 1: 실패하는 테스트를 쓴다(`code128.spec.ts`).**

```ts
expect(planCode128('11198120000')).toEqual({ zplData: '>;1119812000>60', modules: 112 });
expect(planCode128('A-01-01')?.zplData).toBe('>:A-01-01');
expect(planCode128('A-01-01')?.modules).toBe(11 * (1 + 7 + 1) + 13);
expect(planCode128('8801234567890')?.modules).toBe(11 * (1 + 6 + 1 + 1 + 1) + 13);
expect(planCode128('a>b')?.zplData).toBe('>:a><b');
expect(planCode128('M-07-꼭대기')).toBeNull();
expect(planCode128('AB^C')).toBeNull();
expect(planCode128('')).toBeNull();
```

`zpl-encoder.spec.ts` 에 더할 케이스:
- `CODE128_OPTIMAL` 배치는 `^BY2^BCN,{h},N,N,N^FD>;1119812000>60^FS` 를 낸다.
- `copies: 3` 이면 `^PQ3` 를, 생략하면 `^PQ1` 을 낸다.

`label-model.spec.ts` 에 더할 케이스:
- `barcodeWidthMm({ kind: 'CODE128_OPTIMAL', data: '11198120000', moduleDots: 2, … })` 은 `28` 이다.

- [ ] **Step 2: 실패를 확인한다.**
  Run: `npx jest apps/core/src/platform/label --maxWorkers=2`
  Expected: FAIL. `planCode128` 이 없다.
- [ ] **Step 3: 구현한다.** `barcodeWidthMm` 은 `CODE128_OPTIMAL` 일 때 `planCode128(data)!.modules × moduleDots / 8` 이다. `barcodeField` 는 `planCode128` 이 `null` 이면 던진다. 템플릿이 먼저 걸러야 하는 프로그래밍 오류이기 때문이다.
- [ ] **Step 4: 통과를 확인한다.**
  Run: `npx jest apps/core/src/platform/label apps/core/src/modules/fulfillment/waybill --maxWorkers=2`
  Expected: PASS. 송장 spec 도 그대로 PASS 다.
- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/platform/label
git commit -m "[core] 라벨 Code128 을 숫자 쌍으로 접어 찍고 장수를 받는다 (#1281)"
```

---

### Task 3: 라벨 템플릿 셋

**Files:**
- Create: `apps/core/src/modules/inventory/labels/label-templates.ts`
- Create: `apps/core/src/modules/inventory/labels/label-templates.spec.ts`

**Interfaces:**
- Consumes: `LabelSpec`, `BarcodePlacement`, `DOTS_PER_MM` (`platform/label/label-model`) · `planCode128`, `barcodeWidthMm` · `svgDocument`, `text`, `wrapLines` (`platform/label/svg-elements`) · `fitSizePt`, `fitText` · `inkInBarcodeKeepOuts`(spec 에서만)
- Produces:

```ts
export type LabelSkipReason = 'UNSUPPORTED_CODE' | 'NO_BARCODE' | 'BARCODE_TOO_WIDE' | 'NOT_FOUND';
export type SkuLabelSize = '30x10' | '50x30';
export type Rendered = { ok: true; spec: LabelSpec } | { ok: false; reason: LabelSkipReason };
export const MIN_MODULE_DOTS = 2;
export function fitModuleDots(data: string, maxWidthMm: number, baseDots: number): number | null;
export function renderLocationLabel(code: string): Rendered;               // 50×30, 기준 3 dot
export function renderSkuLabel(size: SkuLabelSize, sku: { name: string; barcode: string }): Rendered;
```

배치 규칙(정확한 글자 크기·여백은 구현자가 정한다):
- **로케이션 50×30:** 위쪽에 코드 글자를 `fitSizePt(code, 46, 40, 14)` 로 크게, 가운데 정렬로 둔다. 아래쪽에 바코드(높이 10 mm)를 가로 가운데에 둔다.
- **SKU 30×10:** 위쪽에 바코드(위 여백 ≥ 0.5 mm, 높이 약 5 mm)를 가로 가운데에 둔다. 아래에 상품명 최대 두 줄(`wrapLines`, 폭 28 mm). 숫자는 찍지 않는다.
- **SKU 50×30:** 위쪽에 상품명 최대 두 줄(폭 46 mm). 아래쪽에 바코드(높이 10 mm)와 그 아래 숫자를 SVG 글자로 가운데 정렬한다.
- 모든 템플릿은 `rotation: 0` 을 낸다. 넣는 방향은 Task 9 의 실물 출력에서 정한다.
- `planCode128` 이 `null` 이면 `UNSUPPORTED_CODE`, `fitModuleDots` 가 `null` 이면 `BARCODE_TOO_WIDE` 다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**

```ts
it('fitModuleDots: 30×10 에 11자리는 2 dot, 기준 3 dot 라벨에서도 넘치면 줄인다', () => {
  expect(fitModuleDots('11198120000', 28, 2)).toBe(2);
  expect(fitModuleDots('11198120000', 48, 3)).toBe(3);
  expect(fitModuleDots('A'.repeat(35), 28, 2)).toBeNull();
});
it.each(['30x10', '50x30'] as const)('SKU %s: 크기·바코드 값·금지 구역', (size) => {
  const r = renderSkuLabel(size, { name: '캐릭터 땅콩 브러쉬', barcode: '11198120000' });
  if (!r.ok) throw new Error(r.reason);
  expect([r.spec.widthMm, r.spec.heightMm]).toEqual(size === '30x10' ? [30, 10] : [50, 30]);
  expect(r.spec.barcodes).toEqual([expect.objectContaining({ kind: 'CODE128_OPTIMAL', data: '11198120000' })]);
  expect(inkInBarcodeKeepOuts(r.spec).every((z) => z.ink === 0)).toBe(true);
});
it('아주 긴 이름·괄호·이모지는 두 줄 말줄임이고 바코드 금지 구역 밖이다', () => {
  const name = '노몬드 속눈썹 펌제 10개입 [STEP 1 연화제] 아주 아주 긴 상품명 🎀 (리필) '.repeat(3);
  for (const size of ['30x10', '50x30'] as const) {
    const r = renderSkuLabel(size, { name, barcode: '10630920004' });
    if (!r.ok) throw new Error(r.reason);
    expect((r.spec.svg.match(/<text/g) ?? []).length).toBeLessThanOrEqual(size === '30x10' ? 2 : 3);
    expect(r.spec.svg).toContain('…');
    expect(inkInBarcodeKeepOuts(r.spec).every((z) => z.ink === 0)).toBe(true);
  }
});
it('사유', () => {
  expect(renderLocationLabel('M-07-꼭대기')).toEqual({ ok: false, reason: 'UNSUPPORTED_CODE' });
  expect(renderSkuLabel('30x10', { name: 'x', barcode: 'A'.repeat(35) })).toEqual({ ok: false, reason: 'BARCODE_TOO_WIDE' });
  expect(renderSkuLabel('50x30', { name: 'x', barcode: 'A^B' })).toEqual({ ok: false, reason: 'UNSUPPORTED_CODE' });
});
it('로케이션 50×30: 값은 코드 그대로, 금지 구역 깨끗', () => {
  const r = renderLocationLabel('CC-04-01');
  if (!r.ok) throw new Error(r.reason);
  expect([r.spec.widthMm, r.spec.heightMm]).toEqual([50, 30]);
  expect(r.spec.barcodes[0]).toMatchObject({ data: 'CC-04-01', moduleDots: 3 });
  expect(inkInBarcodeKeepOuts(r.spec).every((z) => z.ink === 0)).toBe(true);
});
```

- [ ] **Step 2: 실패를 확인한다.**
  Run: `npx jest apps/core/src/modules/inventory/labels --maxWorkers=2`
  Expected: FAIL. 모듈이 없다.
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과를 확인한다.** 같은 명령으로 PASS 여야 한다.
- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/labels
git commit -m "[core] 로케이션·SKU 라벨 템플릿 (#1281)"
```

---

### Task 4: 라벨 엔드포인트

**Files:**
- Create: `apps/core/src/modules/inventory/labels/inventory-labels.module.ts`
- Create: `apps/core/src/modules/inventory/labels/inventory-labels.controller.ts`
- Create: `apps/core/src/modules/inventory/labels/inventory-labels.service.ts`
- Create: `apps/core/src/modules/inventory/labels/inventory-labels.reader.ts`
- Create: `apps/core/src/modules/inventory/labels/inventory-labels.dto.ts`
- Create: `apps/core/src/modules/inventory/labels/inventory-labels.service.spec.ts`
- Create: `apps/core/src/modules/inventory/labels/inventory-labels.reader.integration.spec.ts` (`describeIfDb`)
- Modify: `apps/core/src/modules/inventory/inventory.module.ts` (imports 에 `InventoryLabelsModule`)

**Interfaces:**
- Consumes: Task 2 `encodeLabelRuns`, Task 3 `renderLocationLabel`·`renderSkuLabel`·`LabelSkipReason`·`SkuLabelSize`, Task 1 `LabelRendererModule`.
- Produces (HTTP, `@Controller('inventory/labels')`, 둘 다 `@RequirePermission('inventory.stock.read')`·`@HttpCode(200)`):
  - `POST /inventory/labels/locations` 몸체 `LocationLabelsRequestDto { rackId?: string; locationIds?: string[] }`. 정확히 하나만 와야 하고 아니면 400 이다. `locationIds` 는 UUID 배열, 1~500개.
  - `POST /inventory/labels/skus` 몸체 `SkuLabelsRequestDto { size: '30x10' | '50x30'; items: SkuLabelItemDto[] }`. `SkuLabelItemDto { skuId: string; copies: number }` 이고, `copies` 는 정수 1~200, `items` 는 1~500개.
  - 응답 `LabelBatchDto { format: 'zpl'; data: string; labels: number; skipped: LabelSkipDto[] }`. `LabelSkipDto { ref: string; code: string | null; reason: LabelSkipReason }` 이다. `ref` 는 요청 id, `code` 는 로케이션 코드 또는 SKU 코드다. `labels` 는 그린 장수의 합(copies 포함)이다.
- Reader:
  - `locationsForLabels(input: { rackId: string } | { locationIds: string[] }, tx?: DbTx): Promise<{ id: string; code: string }[]>`. 활성이고 `is_system = false` 인 행만 `code` 오름차순으로 돌려준다.
  - `skusForLabels(skuIds: string[], tx?: DbTx): Promise<{ id: string; code: string; name: string; barcode: string | null }[]>`. 바코드는 `is_primary DESC, created_at ASC` 의 첫 행이다.

- [ ] **Step 1: 서비스 단위 테스트를 쓴다(reader 를 가짜로 두고 실제 렌더러 사용).**
  - 랙 응답의 순서가 그대로 쪽 순서다.
  - 한글 코드는 `skipped: [{ ref, code: 'M-07-꼭대기', reason: 'UNSUPPORTED_CODE' }]` 로 빠진다.
  - 요청했는데 reader 가 돌려주지 않은 id 는 `NOT_FOUND` 다.
  - `barcode: null` 은 `NO_BARCODE` 다.
  - `copies` 합이 501 이면 `BadRequestError` 이고, 렌더 전에 거른다.
  - 전부 건너뛰면 `{ data: '', labels: 0 }` 이다.
  - `copies: 3` 은 그 쪽에 `^PQ3` 를 낸다.
- [ ] **Step 2: 실패를 확인한다.**
  Run: `npx jest apps/core/src/modules/inventory/labels --maxWorkers=2`
  Expected: FAIL
- [ ] **Step 3: reader 통합 테스트를 쓴다(`describeIfDb`).** 같은 SKU 에 `is_primary=false` 행(먼저 생성)과 `is_primary=true` 행을 두면 대표가 고른다. 대표가 없으면 가장 이른 행이 고른다. 시스템·비활성 로케이션은 빠진다. **왕복:** 고른 바코드로 `resolveSkuIdByBarcode(barcodes, value, tx)` 와 `SkuCatalogReader` 의 `barcode` 필터(앱의 `GET /inventory/skus?barcode=`) 둘 다 같은 SKU id 를 돌려준다.
- [ ] **Step 4: 구현한다.** Controller → Service(2~3줄) → Reader(쿼리)와 렌더러 순서다. 상한 검사와 사유를 모으는 일은 서비스가 부르는 순수 함수 `buildLabelBatch` 에 둔다(같은 파일 또는 `inventory-labels.batch.ts`). 압축 상수 `LABEL_ZPL_COMPRESS = false` 는 이 모듈에 둔다.
- [ ] **Step 5: 통과를 확인한다.**
  Run: `npx jest apps/core/src/modules/inventory/labels libs/authorization --maxWorkers=2`
  Expected: PASS. `route-classification.spec.ts` 도 초록이다.
  Run(로컬 DB 가 있을 때): `npm run test:core:integration:local -- inventory-labels`
  Expected: PASS
- [ ] **Step 6: 타입·커밋**
  Run: `npm run type-check` → 에러 0

```bash
git add apps/core/src/modules/inventory
git commit -m "[core] 로케이션·SKU 라벨 ZPL 엔드포인트 (#1281)"
```

---

### Task 5: 바코드 없는 SKU 에 SKU 코드를 등록하는 스크립트

**Files:**
- Create: `scripts/sellmate/register-missing-barcodes.ts`
- Create: `scripts/sellmate/register-missing-barcodes.spec.ts`
- Modify: `scripts/sellmate/README.md` (한 절. 실행 순서는 #1356 백필 뒤)

**Interfaces:**
- Produces: `export function planMissingBarcodes(rows: { skuId: string; code: string }[], taken: ReadonlyMap<string, string>): { insert: { skuId: string; barcode: string }[]; conflicts: { skuId: string; barcode: string; ownerSkuId: string }[] }`. `taken` 은 바코드 값에서 소유 SKU id 로 가는 맵이다.
- 대상은 `sku_barcodes` 행이 하나도 없는 SKU 다. 넣는 행은 `{ barcode: code, is_primary: true }` 다.
- 실행 방식(dry-run 기본, `--apply`, 연결)은 `scripts/sellmate/clean-formula-barcodes.ts` 와 같은 꼴로 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 빈 맵이면 전부 insert 다. 다른 SKU 가 그 값을 쓰면 conflicts 로 가고 insert 에서 빠진다. 같은 코드가 두 번 들어오면 첫 행만 insert 한다.
- [ ] **Step 2: 실패를 확인한다.** Run: `npx jest scripts/sellmate/register-missing-barcodes --maxWorkers=2` → FAIL
- [ ] **Step 3: 구현한다.** 한 트랜잭션에서 `INSERT … ON CONFLICT (barcode) DO NOTHING` 으로 넣고, 넣은 수와 충돌 목록을 출력한다.
- [ ] **Step 4: 통과를 확인한다.** 같은 명령 → PASS
- [ ] **Step 5: 커밋**

```bash
git add scripts/sellmate
git commit -m "[scripts] 바코드 없는 SKU 에 SKU 코드를 대표 바코드로 등록한다 (#1281)"
```

---

### Task 6: 앱 — 프린터 칸 둘

**Files:**
- Modify: `native/warehouse-app/src/core/hardware/print/labelPrinter.ts`
- Modify: `native/warehouse-app/src/core/hardware/print/printerStatus.ts`
- Rename+Modify: `LabelPrinterSettings.tsx` → `PrinterSettings.tsx` (+ test)
- Modify: `native/warehouse-app/src/core/hardware/print/zpl.ts` (`renderTestLabel50x30` 추가)
- Modify: `native/warehouse-app/src/app/routes/SettingsRoute.tsx`
- Modify: `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.tsx`

**Interfaces:**
- Produces (`labelPrinter.ts`):

```ts
export type PrinterSlot = 'waybill' | 'label';
export const LABEL_PRINTER_KEY = 'almondwms.labelPrinter';            // 송장 칸. 이름·값 그대로
export const BARCODE_LABEL_PRINTER_KEY = 'almondwms.barcodeLabelPrinter';
export function readPrinter(prefs: DevicePrefs, slot: PrinterSlot): string | null;
export function writePrinter(prefs: DevicePrefs, slot: PrinterSlot, name: string): void;
export const NO_LABEL_PRINTER_MESSAGE = '이 PC 에 라벨 프린터가 설정되지 않았어요. 설정에서 지정해 주세요.';
export const NO_PRINTER_MESSAGE = '이 PC 에 송장 프린터가 설정되지 않았어요. 설정에서 지정해 주세요.';
export function makePrintRaw(slot: PrinterSlot): PrintRaw;
export const printRaw: PrintRaw;        // = makePrintRaw('waybill'). 기존 호출부 그대로
export const printRawLabel: PrintRaw;   // = makePrintRaw('label')
// readLabelPrinter / writeLabelPrinter 는 송장 칸 래퍼로 남긴다(기존 호출부 그대로)
```

- Produces (`printerStatus.ts`): `reportPrintOutcome(ok, slot = 'waybill')`, `resetPrintOutcome(slot = 'waybill')`, `lastPrintFailed(slot = 'waybill')`. 상태바는 지금처럼 송장 칸만 본다.
- Produces: `PrinterSettings({ slot, prefs?, print? })`. 제목은 «송장 프린터» / «라벨 프린터» 다. 라벨 칸의 테스트 인쇄는 `renderTestLabel50x30()` 이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다(vitest).**
  - `writePrinter(prefs,'label','TX400')` 는 `almondwms.barcodeLabelPrinter = 'spooler://TX400'` 를 저장하고 `almondwms.labelPrinter` 는 건드리지 않는다.
  - 기존 `almondwms.labelPrinter` 값은 송장 칸 입력에 그대로 보인다.
  - 라벨 칸 실패(`printRawLabel` reject)는 `lastPrintFailed('waybill')` 를 바꾸지 않는다.
  - 설정 화면에 두 절이 있고, 각 테스트 인쇄가 자기 칸 대상으로만 간다.
  - 진단 화면의 테스트 인쇄가 `prompt` 없이 저장된 칸 값으로 간다. 칸이 비었으면 그 칸의 «설정되지 않았어요» 문구를 보여 준다.
- [ ] **Step 2: 실패를 확인한다.**
  Run: `(cd native/warehouse-app && npx vitest run src/core/hardware/print src/app/routes src/profiles/shared)`
  Expected: FAIL
- [ ] **Step 3: 구현한다.** 송장 쪽 호출부(`printWaybill`, `BatchLabelPrintButton`, `ReprintLabelButton`, `InspectionScreen`, `JoinBoxPanel`, `StatusBar`)는 바꾸지 않는다.
- [ ] **Step 4: 통과·타입을 확인한다.**
  Run: `(cd native/warehouse-app && npx tsc -b && npx vitest run)`
  Expected: PASS. 기존 송장 테스트 전부 포함이다.
- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src
git commit -m "[warehouse-app] 송장 프린터와 따로 라벨 프린터 칸을 둔다 (#1281)"
```

---

### Task 7: 앱 — SKU 라벨 출력

**Files:**
- Create: `native/warehouse-app/src/domains/labels/labelApi.ts`
- Create: `native/warehouse-app/src/domains/labels/usePrintLabels.ts` (+ test)
- Create: `native/warehouse-app/src/domains/labels/SkuLabelPrintPanel.tsx` (+ test)
- Modify: `native/warehouse-app/src/domains/inventory/SkuDetailScreen.tsx` (SKU 정보 아래에 패널)

**Interfaces:**
- Consumes: Task 6 `readPrinter`, `printRawLabel`, `NO_LABEL_PRINTER_MESSAGE`, `PrinterError`. HTTP 는 Task 4 의 두 엔드포인트다.
- Produces:

```ts
export type SkuLabelSize = '30x10' | '50x30';
export interface LabelBatch { format: 'zpl'; data: string; labels: number; skipped: { ref: string; code: string | null; reason: 'UNSUPPORTED_CODE' | 'NO_BARCODE' | 'BARCODE_TOO_WIDE' | 'NOT_FOUND' }[] }
export function fetchSkuLabels(api: ApiClient, body: { size: SkuLabelSize; items: { skuId: string; copies: number }[] }): Promise<LabelBatch>;
export function fetchLocationLabels(api: ApiClient, body: { rackId: string } | { locationIds: string[] }): Promise<LabelBatch>;
export const SKIP_REASON_TEXT: Record<LabelBatch['skipped'][number]['reason'], string>;
// UNSUPPORTED_CODE '이 값은 아직 바코드로 찍을 수 없어요' · NO_BARCODE '등록된 바코드가 없어요'
// BARCODE_TOO_WIDE '바코드가 길어 이 크기에 안 들어가요. 3×5 를 쓰세요' · NOT_FOUND '찾을 수 없어요'
export function usePrintLabels(): { run: (fetch: () => Promise<LabelBatch>) => Promise<PrintResult>; busy: boolean };
export type PrintResult = { kind: 'sent'; labels: number; skipped: LabelBatch['skipped'] } | { kind: 'nothing'; skipped: LabelBatch['skipped'] } | { kind: 'no-printer' } | { kind: 'printer-error'; detail: string };
export const SKU_LABEL_SIZE_KEY = 'almondwms.skuLabelSize';
```

- `usePrintLabels.run` 순서:
  1. 라벨 칸이 비었으면 `no-printer` 다. 서버를 부르지 않는다.
  2. 연타는 ref 로 막는다.
  3. `data === ''` 면 `nothing` 이다. 프린터로 보내지 않는다.
  4. 그 밖에는 `printRawLabel(target, data)` 로 보낸다.
- 패널:
  - 크기 토글(1×3 / 3×5)은 마지막 값을 `SKU_LABEL_SIZE_KEY` 에 기억한다. 기본은 3×5 다.
  - 장수 입력은 1~200 이고 기본 1 이다.
  - 찍힐 바코드 값(`useSkuDetail` 의 대표 바코드)을 보여 준다.
  - «라벨 출력» 버튼을 둔다.
  - 결과 문구는 `sent` 면 `라벨 {n}장을 보냈어요`, `no-printer` 면 `NO_LABEL_PRINTER_MESSAGE` 다. `nothing` 이나 `skipped` 가 있으면 사유 문구를 보여 준다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - 라벨 칸이 비고 송장 칸만 있으면 `fetchSkuLabels` 도 송장 프린터도 불리지 않고 `NO_LABEL_PRINTER_MESSAGE` 가 보인다.
  - 같은 틱에 두 번 누르면 `printRawLabel` 이 한 번만 불린다.
  - `data: ''` + `NO_BARCODE` 면 인쇄가 불리지 않고 «등록된 바코드가 없어요» 가 보인다.
  - 크기를 1×3 으로 바꾸면 요청 `size` 가 `'30x10'` 이 되고, 다시 열어도 1×3 이다.
  - 장수 3 이면 요청이 `items: [{ skuId, copies: 3 }]` 이다.
- [ ] **Step 2: 실패를 확인한다.**
  Run: `(cd native/warehouse-app && npx vitest run src/domains/labels src/domains/inventory)`
  Expected: FAIL
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과·타입을 확인한다.**
  Run: `(cd native/warehouse-app && npx tsc -b && npx vitest run src/domains/labels src/domains/inventory)`
  Expected: PASS
- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src
git commit -m "[warehouse-app] SKU 상세에서 SKU 라벨을 크기·장수를 골라 뽑는다 (#1281)"
```

---

### Task 8: 앱 — 로케이션 라벨 화면

**Files:**
- Create: `native/warehouse-app/src/domains/labels/LocationLabelScreen.tsx` (+ test)
- Create: `native/warehouse-app/src/domains/labels/useRacks.ts` (`GET /locations/warehouses/:id/racks?isActive=true`)
- Modify: `native/warehouse-app/src/app/routeTree.tsx` (`/putaway/location-labels`)
- Modify: `native/warehouse-app/src/station/tabs.ts`. `StationPath` 에 경로를 더하고, F4 `sections` 에 `{ label: '로케이션 라벨', to: '/putaway/location-labels' }` 를 더한다.

**Interfaces:**
- Consumes: Task 7 `fetchLocationLabels`, `usePrintLabels`, `SKIP_REASON_TEXT` · `WarehousePicker` · `useLocationSearch(warehouseId, term, 'lookup')`
- Produces: `useRacks(warehouseId: string | null)` → `{ id: string; columnName: string; rackNumber: number }[]`. 표시는 `{열}-{랙 두 자리}` 다. 응답 DTO 의 `column.columnName` 과 `rackNumber` 를 쓴다.

화면 구성:
- 창고를 고른다.
- **랙으로 뽑기:** 랙 목록에서 하나를 고르고 «랙 전체 출력»을 누른다.
- **칸으로 뽑기:** 스캔·입력으로 코드를 찾아 «담기»를 누르면 담은 칸 목록에 들어간다. 중복은 무시하고, 지울 수 있다. 그다음 «담은 칸 출력»을 누른다.
- 결과로 보낸 장수와 건너뛴 칸·사유를 보여 준다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - 랙을 골라 출력하면 요청이 `{ rackId }` 다.
  - 응답이 `data: ''` 와 `UNSUPPORTED_CODE` 하나면 프린터가 불리지 않고 `M-07-꼭대기 — 이 값은 아직 바코드로 찍을 수 없어요` 가 보인다.
  - 같은 칸을 두 번 담아도 목록에 하나다.
  - 담은 칸으로 출력하면 요청이 `{ locationIds: [...] }` 이고 순서는 담은 순서다.
  - F4 하위 탭에 «로케이션 라벨»이 보이고, `activeTabOf('/putaway/location-labels')?.key === 'F4'` 다.
  - 연타해도 인쇄는 한 번이다.
- [ ] **Step 2: 실패를 확인한다.**
  Run: `(cd native/warehouse-app && npx vitest run src/domains/labels src/station)`
  Expected: FAIL
- [ ] **Step 3: 구현한다.** 이 화면에서 쓰는 단축키가 기존 스테이션 키와 겹치지 않게 한다. 확인은 `actions.ts` 의 중복 검사로 한다.
- [ ] **Step 4: 전체 앱 게이트를 돌린다.**
  Run: `(cd native/warehouse-app && npx tsc -b && npx vitest run)`
  Expected: PASS
- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src
git commit -m "[warehouse-app] 적치·이동 탭에 로케이션 라벨 화면을 둔다 (#1281)"
```

---

### Task 9: 로컬 스모크 · 런북 · 실물 확인(사용자와)

**Files:**
- Modify: `scripts/ops/hanjin-label-preview/README.md` 또는 해당 런북. «TX400 롤을 바꾸면 갭 센서를 보정한다», «라벨 ZPL 을 파일로 받아 확인하는 법»을 한 절로 적는다.

- [ ] **Step 1: 로컬 스모크를 돌린다(저장소에 넣지 않는다).** 스크래치 폴더에 `zpl-renderer-js` 와 `zxing-cpp`(venv)를 둔다. 세 템플릿(로케이션 `CC-04-01`, SKU 30×10·50×30 `11198120000` + 긴 한글 이름)의 ZPL 을 역렌더하고 디코드한다.
  Expected: 디코드 값이 바코드 값과 같다. 30×10 의 바코드 폭은 약 28 mm 다. 한글 이름이 보인다.
- [ ] **Step 2: 전체 게이트를 돌린다.** E2E 스택이 꺼져 있을 때만 돈다.
  Run: `npm run type-check && npx jest --maxWorkers=2`
  Expected: 에러 0, 실패 0
- [ ] **Step 3: 런북 커밋**

```bash
git add scripts/ops docs
git commit -m "[docs] TX400 라벨 출력 확인·롤 교체 절차 (#1281)"
```

- [ ] **Step 4: 실물 확인(사용자와 함께, 머지 전).** 각 줄은 사용자가 결과를 알려 줘야 끝난다.
  1. TX400 설정을 건드리지 않은 채 라벨 칸 테스트 인쇄가 나오는지 본다. 그 뒤 셀메이트 스티커도 그대로 나오는지 본다. ZPL 이 안 먹으면 여기서 멈추고 사용자와 다시 정한다.
  2. 11자리 SKU 라벨을 30×10 에서 뽑아 바코드 폭이 약 28 mm 인지 본다. invocation code 가 안 먹으면 글자 `>;` 가 찍히거나 폭이 39 mm 쯤이 된다.
  3. 1×3 과 3×5 SKU 라벨을 창고 리더기로 입고 화면(`GET /inventory/skus?barcode=`)과 출고 검수에서 스캔해 SKU 가 잡히는지 본다.
  4. 로케이션 라벨을 적치 화면에서 스캔해 목적지로 잡히는지 본다.
  5. 3×5 롤의 넣는 방향을 본다. 50 mm 가 롤 폭이 아니면 템플릿 `rotation` 을 90 또는 270 으로 정하는 커밋을 더한다.
  6. 같은 PC 에서 송장이 Xprinter 로 그대로 나오는지 본다.

## 배포 순서 (PR 본문에 옮긴다)

- 마이그레이션은 없다.
- core 를 먼저 배포하고 warehouse-app 을 배포한다.
- Task 5 스크립트는 #1356 백필 뒤에 live 에서 dry-run → `--apply` 순서로 돌린다. 재고가 있는 대상 SKU 는 T 전에 라벨을 붙인다.
