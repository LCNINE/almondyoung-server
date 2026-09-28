# 한진 FS형 운송장 품목 줄·추가 쪽 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FS 송장이 SKU별 품목·수량을 한 쪽 4줄씩 찍고, 넘치면 같은 자리 레이아웃의 「발송 금지」 추가 쪽(바코드 없음)을 이어 붙여 한 문자열로 내보낸다.

**Architecture:** 출고 품목 줄을 SKU 로 합치고 쪽으로 나누는 것은 형 무관 순수 함수(`label/label-items.ts`). 템플릿 레지스트리는 `LabelSpec[]` 를 반환하고, 쪽마다 `^XA…^XZ` 를 만들어 이어 붙이는 일은 `label/label-document.ts` 한 곳에서 한다 — 매니저와 현장 키트가 같이 쓴다. warehouse-app 은 `data` 를 통째로 인쇄하므로 바뀌지 않는다.

**Tech Stack:** NestJS · TypeScript · Jest(ts-jest, isolatedModules) · resvg(SvgRasterizer) · ZPL

**Spec:** `docs/superpowers/specs/2026-09-28-hanjin-fs-label-item-lines-design.md`

## Global Constraints

- 적용 형은 **FS 만**. NS·NL 출력은 바이트 단위로 불변(스펙 §6)
- 모든 쪽 **4줄, 같은 자리**(스펙 §2). 쪽 표시는 쪽이 하나여도 `1/1`
- 품목 이름은 **SKU명**(`skus.name`), SKU 로 합쳐 수량 합, 이름순(`localeCompare(…, 'ko')`) 정렬·동명이면 skuId 순
- 추가 쪽: 바코드 0개, 받는분 주소·⑫·분류코드·⑬·⑮·⑭·운임Type·하단 ⑨ 없음, 「발송 금지 · 상품 확인용」(분류 띠) + 「발송 금지」(ITF 자리)
- 한진 등록 품명(`commodityNameOf`)은 그대로
- `any`·근거 없는 `as` 금지(CLAUDE.md Type Safety). 주석은 한국어, 주변 코드의 밀도를 따른다
- 스펙 파일 안에서 `dotenv.config()` 금지 · DB 통합 스펙은 기존 가드(`describeIfDb`)를 그대로 쓴다
- 커밋 메시지는 `feat(core): … (#913)` 꼴, 끝에 `Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS`
- 단위 테스트 실행은 `npx jest <경로>`. 전체는 `npx jest --maxWorkers=2`(기본 워커 수는 이 머신에서 OOM)
- `npm run type-check` 는 develop 에 **이미** `apps/file-service/src/upload/image-dimensions.ts`(`probe-image-size`) 1건이 있다 — 그 외 0 이 기준

## Review Focus

- 수량이 큰 줄(예: 1000개)이면 수량 폭이 넓어진다 — 이름이 수량을 덮지 않아야 한다 → Task 5 「큰 수량」 테스트
- SKU명에 XML 특수문자·제어문자가 섞여도 SVG 가 깨지지 않아야 한다 → Task 5 「이스케이프」 테스트
- 정확히 4줄이면 추가 쪽 없이 `1/1` 이어야 한다(경계) → Task 5 쪽 수 표 테스트
- 서로 다른 SKU 가 같은 이름이면 합치지 않고 두 줄, 순서는 입력과 무관 → Task 2 「동명」 테스트
- 터미널코드가 빈 demo 캐리어에서 여러 쪽이면 첫 쪽 ITF 하나, 추가 쪽 0 → Task 5 「demo 여러 쪽」 테스트

---

### Task 1: `ManifestLineLite.skuName`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.types.ts:15-19`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.reader.ts:60`
- Modify (fixtures): `waybill-request.assembler.spec.ts:48-49,103,138,143-145` · `waybill-label.manager.spec.ts:104` · `carrier/hanjin/hanjin-carrier.gateway.spec.ts:370` · `carrier/hanjin/label/hanjin-label-data.spec.ts:40-41` · `waybill.reader.integration.spec.ts:68` (모두 `apps/core/src/modules/fulfillment/waybill/` 아래)

**Interfaces:**
- Produces: `ManifestLineLite { productName: string; skuName: string; quantity: number; skuId: string }` — `productName` 의 의미(주문 상품명, 없으면 SKU명)는 그대로

- [ ] **Step 1: 통합 스펙 기대값을 먼저 바꾼다 (failing)**

`waybill.reader.integration.spec.ts:68`:

```ts
        expect(ctx.lines).toEqual([
          { productName: '아몬드유 30입', skuName: 'it-sku', quantity: 2, skuId: seed.skuId },
        ]);
```

(`it-sku` 는 `fulfillment/services/__support__/logistics-fixtures.ts:42` 의 `seedSku` 가 넣는 이름이다.)

- [ ] **Step 2: 타입에 필드를 더한다**

`waybill.types.ts`:

```ts
export interface ManifestLineLite {
  productName: string; // 주문 상품명(없으면 SKU명) — 한진 등록 품명이 쓴다
  skuName: string; // 창고 품목 이름 — 운송장 품목 줄이 쓴다(#913)
  quantity: number;
  skuId: string;
}
```

- [ ] **Step 3: 타입 체크로 고칠 곳을 전부 드러낸다**

Run: `npm run type-check 2>&1 | grep -v probe-image-size | grep error`
Expected: `waybill.reader.ts` 와 Files 에 적은 픽스처들에서 `Property 'skuName' is missing` 에러

- [ ] **Step 4: reader 를 고친다**

`waybill.reader.ts:60`:

```ts
      lines: rows.map((r) => ({
        productName: r.productName ?? r.skuName ?? '',
        skuName: r.skuName ?? '',
        quantity: r.quantity,
        skuId: r.skuId,
      })),
```

- [ ] **Step 5: 픽스처에 `skuName` 을 넣는다**

각 `{ productName: X, quantity: N, skuId: Y }` 리터럴에 `skuName: X` 를 더한다(값은 productName 과 같게 — 이 테스트들은 SKU명을 보지 않는다). 예:

```ts
    { productName: '아몬드유 30입', skuName: '아몬드유 30입', quantity: 2, skuId: 's1' },
```

- [ ] **Step 6: 확인**

Run: `npm run type-check 2>&1 | grep -v probe-image-size | grep -c error` → Expected: `0`
Run: `npx jest apps/core/src/modules/fulfillment/waybill` → Expected: PASS (통합 스펙은 DB 없으면 skip)

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/fulfillment/waybill
git commit -m "feat(core): 출고 품목 줄에 SKU명을 싣는다 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 2: `label-items.ts` — SKU 합치기·쪽 나누기

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/label/label-items.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/label/label-items.spec.ts`

**Interfaces:**
- Consumes: `ManifestLineLite` (Task 1)
- Produces:
  - `interface LabelItem { name: string; quantity: number }`
  - `labelItemsOf(lines: readonly Pick<ManifestLineLite, 'skuId' | 'skuName' | 'quantity'>[]): LabelItem[]`
  - `paginate<T>(items: readonly T[], perPage: number): T[][]` — 늘 1쪽 이상, `perPage < 1` 이면 throw

- [ ] **Step 1: 실패하는 테스트**

```ts
import { labelItemsOf, paginate } from './label-items';

describe('labelItemsOf', () => {
  it('같은 SKU 는 한 줄로 합치고 수량을 더한다', () => {
    expect(
      labelItemsOf([
        { skuId: 'a', skuName: '볼펜', quantity: 1 },
        { skuId: 'b', skuName: '공책', quantity: 2 },
        { skuId: 'a', skuName: '볼펜', quantity: 3 },
      ]),
    ).toEqual([
      { name: '공책', quantity: 2 },
      { name: '볼펜', quantity: 4 },
    ]);
  });

  it('한글 이름순이고 입력 순서에 흔들리지 않는다', () => {
    const lines = [
      { skuId: '1', skuName: '하마', quantity: 1 },
      { skuId: '2', skuName: '가위', quantity: 1 },
      { skuId: '3', skuName: '나비', quantity: 1 },
    ];
    expect(labelItemsOf(lines).map((i) => i.name)).toEqual(['가위', '나비', '하마']);
    expect(labelItemsOf([...lines].reverse())).toEqual(labelItemsOf(lines));
  });

  it('동명의 다른 SKU 는 합치지 않고 skuId 순 두 줄', () => {
    const lines = [
      { skuId: 'b', skuName: '펜', quantity: 1 },
      { skuId: 'a', skuName: '펜', quantity: 2 },
    ];
    expect(labelItemsOf(lines)).toEqual([
      { name: '펜', quantity: 2 },
      { name: '펜', quantity: 1 },
    ]);
    expect(labelItemsOf([...lines].reverse())).toEqual(labelItemsOf(lines));
  });

  it('빈 목록은 빈 목록', () => {
    expect(labelItemsOf([])).toEqual([]);
  });
});

describe('paginate', () => {
  it.each([
    [0, 1],
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
  ])('%d 줄 → %d 쪽 (한 쪽 4줄)', (n, pages) => {
    expect(paginate(Array.from({ length: n }, (_, i) => i), 4)).toHaveLength(pages);
  });

  it('순서를 지키며 앞 쪽부터 채운다', () => {
    expect(paginate([1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  });

  it('빈 목록도 빈 쪽 하나', () => {
    expect(paginate([], 4)).toEqual([[]]);
  });

  it('한 쪽 줄 수가 1 미만이면 던진다', () => {
    expect(() => paginate([1], 0)).toThrow(/perPage/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/label-items.spec.ts`
Expected: FAIL — `Cannot find module './label-items'`

- [ ] **Step 3: 구현**

```ts
import type { ManifestLineLite } from '../waybill.types';

/** 운송장 품목 줄 한 줄(#913). 이름은 SKU명 — 라벨이 피킹 지시서라 «집을 물건»이 구별돼야 한다. */
export interface LabelItem {
  name: string;
  quantity: number;
}

/**
 * 출고 품목 줄을 SKU 로 합쳐 이름순으로 늘어놓는다. shipment_lines 는 (출고, FOI) 당 한 줄이라 같은 SKU 가
 * 여러 줄일 수 있다 — 집는 동작은 하나이므로 합친다(스펙 §2). 동명이면 skuId 순 — 입력 순서에 흔들리지 않게.
 */
export function labelItemsOf(lines: readonly Pick<ManifestLineLite, 'skuId' | 'skuName' | 'quantity'>[]): LabelItem[] {
  const bySku = new Map<string, { skuId: string; name: string; quantity: number }>();
  for (const line of lines) {
    const prev = bySku.get(line.skuId);
    if (prev) prev.quantity += line.quantity;
    else bySku.set(line.skuId, { skuId: line.skuId, name: line.skuName, quantity: line.quantity });
  }
  return [...bySku.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'ko') || (a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0))
    .map(({ name, quantity }) => ({ name, quantity }));
}

/** perPage 개씩 쪽으로 나눈다. 빈 목록도 한 쪽 — 라벨은 늘 1장 이상이다. */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  if (perPage < 1) throw new Error(`paginate: perPage must be >= 1, got ${perPage}`);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/label-items.spec.ts` → Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/waybill/label/label-items.ts apps/core/src/modules/fulfillment/waybill/label/label-items.spec.ts
git commit -m "feat(core): 운송장 품목 줄을 SKU 로 합치고 쪽으로 나눈다 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 3: `HanjinLabelData.items`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.ts:22-38,124`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/__support__/hanjin-label-fixture.ts`
- Modify: `scripts/ops/hanjin-label-preview/render.ts` (`SAMPLE`)
- Test: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.spec.ts`

**Interfaces:**
- Consumes: `labelItemsOf`, `LabelItem` (Task 2)
- Produces: `HanjinLabelData.items: LabelItem[]` (SKU 합침·정렬 끝난 값). `commodityName` 은 남는다 — NS·NL 이 쓴다

- [ ] **Step 1: 실패하는 테스트**

`hanjin-label-data.spec.ts` 의 `CTX.lines` 를 SKU명이 주문 상품명과 다르게 바꾼다:

```ts
  lines: [
    { productName: '토익 Speaking', skuName: '토익 스피킹 교재', quantity: 1, skuId: 'k1' },
    { productName: '펜', skuName: '볼펜 흑색', quantity: 2, skuId: 'k2' },
  ],
```

그리고 `describe('buildHanjinLabelData')` 안에 추가:

```ts
  it('품목 줄은 SKU명·수량, 이름순 — 한진 등록 품명(주문 상품명)과 별개다', () => {
    const d = buildHanjinLabelData(input());
    expect(d.items).toEqual([
      { name: '볼펜 흑색', quantity: 2 },
      { name: '토익 스피킹 교재', quantity: 1 },
    ]);
    expect(d.commodityName).toBe('토익 Speaking 외 1건');
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.spec.ts`
Expected: FAIL — `d.items` 가 `undefined`

- [ ] **Step 3: 구현**

`hanjin-label-data.ts` — import 와 인터페이스:

```ts
import { labelItemsOf, type LabelItem } from '../../../label/label-items';
```

```ts
  commodityName: string; // 한진 등록 품명과 같은 값 — NS·NL 이 찍는다
  items: LabelItem[]; // SKU별 품목 줄 — FS 가 찍는다(#913 품목 줄 스펙)
```

`buildHanjinLabelData` 반환부(`commodityName: commodityNameOf(ctx.lines),` 다음 줄):

```ts
    items: labelItemsOf(ctx.lines),
```

- [ ] **Step 4: 픽스처·현장 키트 견본**

`__support__/hanjin-label-fixture.ts` — `HANJIN_LABEL_FIXTURE` 의 `commodityName` 다음에:

```ts
  items: [
    { name: '토익 Speaking', quantity: 1 },
    { name: '펜', quantity: 2 },
  ],
```

`HANJIN_LABEL_LONG_FIXTURE` 의 `commodityName` 다음에:

```ts
  items: [{ name: '가'.repeat(100), quantity: 1 }],
```

`scripts/ops/hanjin-label-preview/render.ts` 의 `SAMPLE` — `commodityName` 다음에:

```ts
  items: [{ name: '토익 Speaking 1권', quantity: 1 }],
```

- [ ] **Step 5: 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill` → Expected: PASS
Run: `npm run type-check 2>&1 | grep -v probe-image-size | grep -c error` → Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/fulfillment/waybill scripts/ops/hanjin-label-preview/render.ts
git commit -m "feat(core): 한진 라벨 데이터에 SKU별 품목 줄을 싣는다 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 4: 여러 쪽 배관 — 레지스트리 `LabelSpec[]`·이어 붙이기·`pages`

이 태스크는 **출력을 바꾸지 않는다**(모든 형이 아직 1쪽). FS 가 실제로 여러 쪽을 내는 건 Task 5.

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/label/label-document.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/label/label-document.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-templates.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-templates.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-nl-template.spec.ts` (해시 고정)
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill-label.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill-label.manager.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/dto/*.ts` 의 `WaybillLabelResponseDto`(grep 으로 파일 확인: `grep -ln WaybillLabelResponseDto apps/core/src/modules/fulfillment/waybill/dto/`)
- Modify: `scripts/ops/hanjin-label-preview/render.ts`

**Interfaces:**
- Consumes: `LabelSpec`, `encodeZpl`, `SvgRasterizer`, `mmToDots`
- Produces:
  - `encodeLabelPages(pages: readonly LabelSpec[], rasterizer: SvgRasterizer, compress: boolean): string` — 쪽마다 `^XA…^XZ`, `'\n'` 로 이음, 빈 배열이면 throw
  - `type HanjinLabelTemplate = (d: HanjinLabelData) => LabelSpec[]`
  - `renderHanjinLabel(type: string, d: HanjinLabelData): LabelSpec[]`
  - `WaybillLabel { waybillId; trackingNo; format: 'zpl'; data: string; pages: number }`

- [ ] **Step 1: NL 출력 해시를 먼저 고정한다(리팩터 전 기준선)**

`hanjin-nl-template.spec.ts` 상단에 `import { createHash } from 'crypto';` 를 더하고, `describe('renderHanjinNlLabel', …)`
맨 앞(`const spec = …` 다음)에 일부러 틀린 값으로 테스트를 넣는다:

```ts
  it('NL 출력은 여러 쪽 배관 리팩터 전과 같다 (svg + 바코드 배치 해시 고정)', () => {
    const digest = createHash('sha256').update(spec.svg).update(JSON.stringify(spec.barcodes)).digest('hex');
    expect(digest).toBe('0'.repeat(64));
  });
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-nl-template.spec.ts -t 해시`
Expected: FAIL — `Received: "<64자리 hex>"`. 그 값을 `'0'.repeat(64)` 자리에 문자열 리터럴로 그대로 옮긴다
(NS 의 `hanjin-ns-template.spec.ts:58-59` 와 같은 모양). **이 단계는 아직 아무 코드도 바꾸지 않은 상태에서** 해야 한다.

Run: 같은 명령 → Expected: PASS

- [ ] **Step 2: `label-document` 실패 테스트**

```ts
import type { LabelSpec } from './label-model';
import { SvgRasterizer } from './svg-rasterizer';
import { encodeLabelPages } from './label-document';

const page = (w: number): LabelSpec => ({
  widthMm: w,
  heightMm: 10,
  rotation: 0,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="10mm" viewBox="0 0 ${w} 10"></svg>`,
  barcodes: [],
});

describe('encodeLabelPages', () => {
  const rasterizer = new SvgRasterizer();

  it('쪽마다 ^XA…^XZ 하나를 순서대로 이어 붙인다', () => {
    const data = encodeLabelPages([page(10), page(20)], rasterizer, false);
    expect(data.match(/\^XA/g)).toHaveLength(2);
    expect(data.match(/\^XZ/g)).toHaveLength(2);
    expect(data.indexOf('^PW80')).toBeLessThan(data.indexOf('^PW160')); // 10mm·20mm = 80·160 dot
  });

  it('한 쪽이면 encodeZpl 한 번과 같다(^XA 하나)', () => {
    expect(encodeLabelPages([page(10)], rasterizer, true).match(/\^XA/g)).toHaveLength(1);
  });

  it('쪽이 없으면 던진다', () => {
    expect(() => encodeLabelPages([], rasterizer, false)).toThrow(/no pages/);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/label-document.spec.ts` → Expected: FAIL — module not found

- [ ] **Step 3: `label-document.ts` 구현**

```ts
import { mmToDots, type LabelSpec } from './label-model';
import type { SvgRasterizer } from './svg-rasterizer';
import { encodeZpl } from './zpl-encoder';

/**
 * 여러 쪽 라벨을 프린터로 보낼 한 문자열로 만든다(#913 품목 줄 스펙 §6). 쪽마다 ^XA…^XZ 하나 —
 * warehouse-app 은 이 문자열을 통째로 print_raw 하므로 쪽을 몰라도 된다. 매니저와 현장 키트가 같이 쓴다.
 */
export function encodeLabelPages(pages: readonly LabelSpec[], rasterizer: SvgRasterizer, compress: boolean): string {
  if (pages.length === 0) throw new Error('label has no pages');
  return pages
    .map((spec) =>
      encodeZpl(rasterizer.rasterize(spec.svg, mmToDots(spec.widthMm)), spec.barcodes, {
        compress,
        rotation: spec.rotation,
      }),
    )
    .join('\n');
}
```

Run: 같은 명령 → Expected: PASS

- [ ] **Step 4: 레지스트리 시그니처**

`hanjin-label-templates.ts` 에서 레지스트리와 `renderHanjinLabel` 을 바꾼다:

```ts
/** 형 하나 = 쪽 목록(1쪽 이상). 여러 쪽은 FS 품목 줄 스펙(2026-09-28)의 추가 쪽 — NS·NL 은 늘 1쪽이다. */
export type HanjinLabelTemplate = (d: HanjinLabelData) => LabelSpec[];

export const HANJIN_LABEL_TEMPLATES: Readonly<Record<HanjinLabelType, HanjinLabelTemplate>> = {
  NS: (d) => [renderHanjinNsLabel(d)],
  NL: (d) => [renderHanjinNlLabel(d)],
  FS: (d) => [renderHanjinFsLabel(d)],
};
```

```ts
export function renderHanjinLabel(type: string, d: HanjinLabelData): LabelSpec[] {
```

(본문은 그대로 — `HANJIN_LABEL_TEMPLATES[type](d)` 가 이제 배열을 돌려준다.)

`hanjin-label-templates.spec.ts` — 기존 두 곳의 `const spec = renderHanjinLabel(type, DATA);` 를 `const [spec] = renderHanjinLabel(type, DATA);` 로 바꾸고 테스트 하나 추가:

```ts
  it.each(HANJIN_LABEL_TYPES)('%s: 1쪽 이상이고, 기본 데이터(품목 2줄)는 1쪽', (type) => {
    expect(renderHanjinLabel(type, DATA)).toHaveLength(1);
  });
```

- [ ] **Step 5: 매니저·DTO**

`waybill-label.manager.ts` — import 에서 `mmToDots`·`encodeZpl` 을 빼고 `encodeLabelPages` 를 넣는다:

```ts
import { encodeLabelPages } from './label/label-document';
```

```ts
export interface WaybillLabel {
  waybillId: string;
  trackingNo: string;
  format: 'zpl';
  /** 쪽마다 ^XA…^XZ 를 이어 붙인 문자열 — 앱은 통째로 인쇄한다. */
  data: string;
  pages: number;
}
```

`render` 의 끝부분:

```ts
    const pages = renderHanjinLabel(
      this.config.labelType,
      buildHanjinLabelData({ waybill, ctx, config: this.config, now: this.now() }),
    );
    const data = encodeLabelPages(pages, this.rasterizer, WAYBILL.LABEL_ZPL_COMPRESS);
    return { waybillId: waybill.id, trackingNo: waybill.trackingNo ?? '', format: 'zpl', data, pages: pages.length };
```

`WaybillLabelResponseDto` 에 추가:

```ts
  @ApiProperty({ description: '쪽 수 — data 안의 ^XA…^XZ 개수. 품목이 4줄을 넘는 FS 는 2 이상' })
  pages: number;
```

`waybill-label.manager.spec.ts` 의 `describe('WaybillLabelManager.render — labelType 배선')` 에 추가:

```ts
  it('품목이 한 쪽에 들어가면 pages 1, ^XA 하나', async () => {
    const label = await buildManager('NS').render('s1');
    expect(label.pages).toBe(1);
    expect(label.data.match(/\^XA/g)).toHaveLength(1);
  });
```

- [ ] **Step 6: 현장 키트가 쪽 목록을 다룬다**

`scripts/ops/hanjin-label-preview/render.ts` — import 에 `encodeLabelPages` 와 `HanjinLabelType` 을 더하고(`encodeZpl` import 는 뺀다), 파일 끝의 `for (const type of HANJIN_LABEL_TYPES) { … }` 를 통째로 바꾼다:

```ts
import { encodeLabelPages } from '../../../apps/core/src/modules/fulfillment/waybill/label/label-document';
```

```ts
import {
  HANJIN_LABEL_TEMPLATES,
  HANJIN_LABEL_TYPES,
  type HanjinLabelType,
} from '../../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-templates';
```

```ts
const SAMPLES: Array<[name: string, type: HanjinLabelType, data: HanjinLabelData]> = HANJIN_LABEL_TYPES.map(
  (type): [string, HanjinLabelType, HanjinLabelData] => [`hanjin-${type.toLowerCase()}-preview`, type, SAMPLE],
);

for (const [name, type, data] of SAMPLES) {
  const pages = HANJIN_LABEL_TEMPLATES[type](data);
  pages.forEach((spec, i) => {
    const png = new Resvg(withBarcodeOverlay(spec), {
      background: 'white',
      fitTo: { mode: 'width', value: mmToDots(spec.widthMm) },
      font: {
        loadSystemFonts: false,
        fontFiles: LABEL_FONT_FILES.map((f) => join(fontDir, f)),
        defaultFontFamily: 'NanumGothic',
      },
    })
      .render()
      .asPng();
    writeFileSync(join(outDir, `${name}${pages.length > 1 ? `-p${i + 1}` : ''}.png`), png);
  });

  writeFileSync(join(outDir, `${name}.zpl`), encodeLabelPages(pages, rasterizer, false));
  writeFileSync(join(outDir, `${name}.compressed.zpl`), encodeLabelPages(pages, rasterizer, true));
  const [first] = pages;
  console.log(
    `wrote ${outDir}/${name}.{png,zpl,compressed.zpl}  (${first.widthMm}×${first.heightMm}mm, rotation ${first.rotation}, ${pages.length} page(s))`,
  );
}
```

- [ ] **Step 7: 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill` → Expected: PASS (NS 해시·NL 해시 둘 다 그대로)
Run: `npm run type-check 2>&1 | grep -v probe-image-size | grep -c error` → Expected: `0`
Run: `npx tsx scripts/ops/hanjin-label-preview/render.ts /tmp/kit-t4` → Expected: 세 줄 모두 `1 page(s)`

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/modules/fulfillment/waybill scripts/ops/hanjin-label-preview/render.ts
git commit -m "refactor(core): 한진 라벨을 쪽 목록으로 다루고 이어 붙여 내보낸다 (#913)

출력은 그대로다(모든 형 1쪽). NL 출력 해시를 먼저 고정했다.

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 5: FS 품목 영역·쪽 표시·추가 쪽

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-templates.ts` (`FS: renderHanjinFsLabel`)
- Test: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.spec.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/waybill-label.manager.spec.ts`

**Interfaces:**
- Consumes: `paginate`, `LabelItem` (Task 2), `HanjinLabelData.items` (Task 3), `HanjinLabelTemplate` (Task 4)
- Produces:
  - `renderHanjinFsLabel(d: HanjinLabelData): LabelSpec[]`
  - `FS_ITEMS_PER_PAGE = 4`, `FS_ITEM_X_MM = 4.5`, `FS_ITEM_QTY_X_MM = 119`, `FS_ITEM_QTY_GAP_MM = 3`, `FS_ITEM_PT = 11`
  - `fsItemNameMaxWidthMm(qty: string): number` — 후속 위치 코드 스펙이 접두어 폭을 여기서 뺀다
  - 추가 쪽 svg 블록 id `continuation`(첫 쪽은 기존 `delivery-slip`)

- [ ] **Step 1: 기존 FS 테스트를 첫 쪽 기준으로 옮긴다**

`hanjin-fs-template.spec.ts` 에서 호출을 한꺼번에 바꾼 뒤 헬퍼를 둔다:

```bash
sed -i 's/renderHanjinFsLabel(/fs1(/g' apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.spec.ts
```

그리고 import 아래(`const block = …` 위)에:

```ts
/** 첫 쪽 — 기존 단일 쪽 테스트는 전부 첫 쪽의 성질이다. */
const fs1 = (d: HanjinLabelData): LabelSpec => {
  const [first] = renderHanjinFsLabel(d);
  return first;
};
```

import 에 `import type { LabelSpec } from '../../../label/label-model';` 와 `import type { HanjinLabelData } from './hanjin-label-data';` 를 더한다.

기존 테스트 세 곳을 품목 줄 기준으로 고친다:
- 「분류코드·운임·권역·출고번호를 찍는다」 목록의 `'토익 Speaking 외 1건'` 을 `'토익 Speaking'` 과 `'펜'` 두 항목으로 바꾼다
- 「고객 입력의 XML 특수문자…」 의 `commodityName: 'A&B "펜"'` 을 `items: [{ name: 'A&B "펜"', quantity: 1 }]` 로 바꾼다
- 「긴 자유 텍스트는 말줄임으로 자른다」 는 그대로 둔다(LONG 픽스처의 품목 이름이 100자라 말줄임이 유지된다)

- [ ] **Step 2: 새 실패 테스트**

`hanjin-fs-template.spec.ts` 끝에 추가(`textWidthMm`·`PT_TO_MM` import: `import { PT_TO_MM, textWidthMm } from '../../../label/svg-text';` — 이미 `textWidthMm` 을 import 하고 있으면 `PT_TO_MM` 만 더한다):

```ts
describe('renderHanjinFsLabel — 품목 줄·추가 쪽', () => {
  const ITEMS = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `품목${i + 1}`, quantity: i + 1 }));
  const pagesOf = (n: number) => renderHanjinFsLabel({ ...DATA, items: ITEMS(n) });
  const namesOn = (page: LabelSpec) =>
    [...page.svg.matchAll(/<text x="4.5" y="(?:57|62.2|67.4|72.6)"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

  it.each([
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
  ])('품목 %d 줄 → %d 쪽', (n, pages) => {
    expect(pagesOf(n)).toHaveLength(pages);
  });

  it('모든 쪽 같은 자리에 4줄씩, 순서대로', () => {
    expect(pagesOf(9).map(namesOn)).toEqual([
      ['품목1', '품목2', '품목3', '품목4'],
      ['품목5', '품목6', '품목7', '품목8'],
      ['품목9'],
    ]);
  });

  it('수량은 오른쪽 끝(x 119)에 끝 정렬로 찍는다', () => {
    const [first] = pagesOf(1);
    expect(first.svg).toMatch(/<text x="119" y="57" [^>]*text-anchor="end">1<\/text>/);
  });

  it('쪽 표시: n/N · 총 건수·수량 합 — 정확히 4줄이면 1/1', () => {
    expect(pagesOf(9).map((p) => /(\d+\/\d+ · 총 \d+건 \d+개)/.exec(p.svg)?.[1])).toEqual([
      '1/3 · 총 9건 45개',
      '2/3 · 총 9건 45개',
      '3/3 · 총 9건 45개',
    ]);
    const four = pagesOf(4);
    expect(four).toHaveLength(1);
    expect(four[0].svg).toContain('1/1 · 총 4건 10개');
  });

  it('바코드는 첫 쪽에만 — 추가 쪽은 0개', () => {
    expect(pagesOf(5).map((p) => p.barcodes.length)).toEqual([2, 0]);
  });

  it('demo 캐리어(터미널코드 빈 값) 여러 쪽: 첫 쪽 ITF 하나, 추가 쪽 0', () => {
    const pages = renderHanjinFsLabel({ ...DATA, sort: { ...DATA.sort, terminalCode: '' }, items: ITEMS(5) });
    expect(pages.map((p) => p.barcodes.map((b) => b.kind))).toEqual([['ITF'], []]);
  });

  it('추가 쪽은 「발송 금지」 두 곳 + 짝 맞추기 정보만, 첫 쪽 전용 요소는 없다', () => {
    const [first, second] = pagesOf(5);
    expect(first.svg).not.toContain('발송 금지');
    expect(second.svg).toContain('<g id="continuation">');
    expect(second.svg).toContain('발송 금지 · 상품 확인용');
    expect(second.svg).toMatch(/>발송 금지<\/text>/);
    for (const kept of ['4527-1697-8431', '김*진', '010-1234-****', '출고번호: AY0123456789ABCDEFGHJKMNPQRS']) {
      expect(second.svg).toContain(kept);
    }
    for (const gone of ['남대문로 63', '소공동 51 한진빌딩', '>NX</text>', '발지신용', '수도권', '운임Type', '문앞', '<rect']) {
      expect(second.svg).not.toContain(gone);
    }
  });

  it('큰 수량이어도 이름이 수량 칸을 덮지 않는다', () => {
    const [page] = renderHanjinFsLabel({ ...DATA, items: [{ name: '가'.repeat(60), quantity: 1000 }] });
    const m = /<text x="4.5" y="57" font-size="([\d.]+)">([^<]*)<\/text>/.exec(page.svg);
    if (!m) throw new Error('item name element not found');
    const nameWidthMm = textWidthMm(m[2], Number(m[1]) / PT_TO_MM);
    expect(4.5 + nameWidthMm).toBeLessThanOrEqual(119 - textWidthMm('1000', 11) - 3 + 0.05);
    expect(m[2].endsWith('…')).toBe(true);
  });

  it('SKU명의 XML 특수문자는 이스케이프하고 금지 제어문자는 뺀다', () => {
    const [page] = renderHanjinFsLabel({ ...DATA, items: [{ name: '<b>&"펜"\u000B', quantity: 1 }] });
    expect(page.svg).not.toContain('<b>');
    expect(page.svg).not.toContain('\u000B');
    expect(page.svg).toContain('&lt;b&gt;&amp;&quot;펜&quot;');
  });

  it.each([
    ['기본 9줄', { ...DATA, items: ITEMS(9) }],
    ['긴 데이터 5줄', { ...LONG, items: Array.from({ length: 5 }, () => ({ name: '가'.repeat(100), quantity: 9999 })) }],
  ])('%s: 모든 쪽의 바코드 금지 구역에 잉크가 없고 좌표가 라벨 안이다', (_, data) => {
    for (const page of renderHanjinFsLabel(data)) {
      expect(inkInBarcodeKeepOuts(page)).toEqual(page.barcodes.map((b) => ({ kind: b.kind, ink: 0 })));
      const xs = [...page.svg.matchAll(/\bx="([\d.]+)"/g)].map((m) => Number(m[1]));
      const ys = [...page.svg.matchAll(/\by="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(Math.max(...xs)).toBeLessThanOrEqual(123);
      expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    }
  });
});
```

`waybill-label.manager.spec.ts` — `buildManager` 가 컨텍스트를 받게 한다:

```ts
  function buildManager(labelType: string, ctx: IssueContext = CTX): WaybillLabelManager {
```

(본문의 `loadIssueContext: jest.fn().mockResolvedValue(CTX)` 를 `mockResolvedValue(ctx)` 로.) 그리고 테스트 추가:

```ts
  it('FS 품목 5줄이면 2쪽 — ^XA 두 개, pages 2', async () => {
    const lines = ['가', '나', '다', '라', '마'].map((n, i) => ({
      productName: n,
      skuName: n,
      quantity: 1,
      skuId: `k${i}`,
    }));
    const label = await buildManager('FS', { ...CTX, lines }).render('s1');
    expect(label.pages).toBe(2);
    expect(label.data.match(/\^XA/g)).toHaveLength(2);
    expect(label.data.match(/\^B2R/g)).toHaveLength(1); // ITF 는 첫 쪽에만
  });
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.spec.ts apps/core/src/modules/fulfillment/waybill/waybill-label.manager.spec.ts`
Expected: FAIL — `renderHanjinFsLabel(...)` 가 배열이 아니다 / 품목 줄 없음

- [ ] **Step 3: FS 템플릿 구현**

`hanjin-fs-template.ts` — import 에 더한다:

```ts
import { paginate, type LabelItem } from '../../../label/label-items';
import { fitSizePt, fitText, textWidthMm } from '../../../label/svg-text';
```

(기존 `import { fitSizePt, fitText } from '../../../label/svg-text';` 를 위 줄로 바꾼다.)

`FS_CUST_ORD_NO_MAX_WIDTH_MM` 선언 아래에 상수·헬퍼를 둔다:

```ts
/**
 * 품목 영역(스펙 2026-09-28 품목 줄 §5.1) — 모든 쪽 같은 자리 4줄. 셀메이트 송장처럼 이 송장이 피킹 지시서다.
 * 좌표는 창고 FS 라벨지 실물 출력으로 확정하기 전 초기값(스펙 §9).
 */
export const FS_ITEMS_PER_PAGE = 4;
export const FS_ITEM_X_MM = 4.5;
export const FS_ITEM_QTY_X_MM = 119;
export const FS_ITEM_QTY_GAP_MM = 3;
export const FS_ITEM_PT = 11;
const FS_ITEM_MIN_PT = 8;
const FS_ITEM_FIRST_BASELINE_MM = 57;
const FS_ITEM_PITCH_MM = 5.2;
/** 쪽 표시 — 선인쇄 「※ 개인정보 보호…」(실측 y ≈81.7mm) 바로 위. */
const FS_PAGE_MARK_Y_MM = 80.6;

const STOP_BANNER = '발송 금지 · 상품 확인용';
const STOP_MARK = '발송 금지';

/** 품목 이름 칸 폭 — 수량 앞 FS_ITEM_QTY_GAP_MM 에서 멈춘다. 위치 코드 접두어가 붙으면 그 폭을 여기서 뺀다. */
export function fsItemNameMaxWidthMm(qty: string): number {
  return FS_ITEM_QTY_X_MM - textWidthMm(qty, FS_ITEM_PT) - FS_ITEM_QTY_GAP_MM - FS_ITEM_X_MM;
}

function itemElements(items: readonly LabelItem[]): string[] {
  return items.flatMap((item, i) => {
    // 부동소수 꼬리(72.60000000000001)가 svg 좌표에 새지 않게 0.1mm 로 반올림한다.
    const y = Math.round((FS_ITEM_FIRST_BASELINE_MM + i * FS_ITEM_PITCH_MM) * 10) / 10;
    const qty = String(item.quantity);
    const maxWidth = fsItemNameMaxWidthMm(qty);
    const pt = fitSizePt(item.name, maxWidth, FS_ITEM_PT, FS_ITEM_MIN_PT);
    return [
      text({ x: FS_ITEM_X_MM, y, pt, text: fitText(item.name, maxWidth, pt) }),
      text({ x: FS_ITEM_QTY_X_MM, y, pt: FS_ITEM_PT, bold: true, anchor: 'end', text: qty }),
    ];
  });
}
```

`renderHanjinFsLabel` 을 셋으로 나눈다. 기존 함수 본문(`const s = d.sort;` 부터 `return { … }` 까지)을 아래로 **통째로** 바꾼다. 첫 쪽 요소와 좌표는 기존과 같고, 기존 품명 줄(`// 품명`)만 품목 영역으로 대체된다:

```ts
/**
 * 품목이 4줄을 넘으면 같은 자리 레이아웃의 추가 쪽을 잇는다. 추가 쪽은 피킹·검수용이고 끝나면 버린다(사용자
 * 결정) — 짝 맞추기 정보(⑨·받는분 성명·보낸분·출고번호)만 남기고 바코드·주소·분류코드를 뺀다.
 */
export function renderHanjinFsLabel(d: HanjinLabelData): LabelSpec[] {
  const pages = paginate(d.items, FS_ITEMS_PER_PAGE);
  const qtySum = d.items.reduce((n, item) => n + item.quantity, 0);
  return pages.map((items, i) => {
    const shared = [
      ...sharedElements(d),
      ...itemElements(items),
      text({
        x: FS_ITEM_X_MM,
        y: FS_PAGE_MARK_Y_MM,
        pt: 9,
        text: `${i + 1}/${pages.length} · 총 ${d.items.length}건 ${qtySum}개`,
      }),
    ];
    return i === 0 ? firstPage(d, shared) : continuationPage(shared);
  });
}

/** 모든 쪽 같은 자리 — 찢은 뒤 첫 쪽과 짝을 맞추는 단서. */
function sharedElements(d: HanjinLabelData): string[] {
  const rc = d.recipient;
  const sd = d.sender;
  const senderLine = shrinkThenFit(`${sd.name} / ${sd.phone} / ${maskAddress(sd.baseAddress)}`, 111, 9);
  const custText = `출고번호: ${d.custOrdNo}`;
  return [
    // 선인쇄 가로선(실측 y 7.4–8.0 · 24.3–24.6 · 44.4–44.9 · 52.0–52.5mm)을 글자가 밟지 않게 잡았다 —
    // 2026-09-28 창고 FS 라벨지 실물 출력 스캔으로 ⑨·⑪·보낸분 줄을 옮겼다.
    text({ x: 15.3, y: 6.8, pt: 8, bold: true, text: d.trackingNoDisplay }), // ⑨ 좌측상단
    // 성명(x 7.8)이 길면 고정 x=35.1 의 연락처를 침범한다(#913 최종리뷰 F5) — 연락처 앞에서 멈춘다.
    text({ x: RECIPIENT_X_MM, y: 27.7, pt: 10, text: fitText(maskName(rc.name), 35.1 - RECIPIENT_X_MM - 1, 10) }),
    text({ x: 35.1, y: 27.7, pt: 10, text: maskPhone(rc.phone) }),
    text({ x: RECIPIENT_X_MM, y: 48.3, pt: senderLine.pt, text: senderLine.text }),
    text({ x: RECIPIENT_X_MM, y: 51.5, pt: 8, text: `${d.printedDate} Type : ${d.boxType}` }),
    text({
      x: 119,
      y: 51.5,
      pt: fitSizePt(custText, FS_CUST_ORD_NO_MAX_WIDTH_MM, 10, 4),
      anchor: 'end',
      text: custText,
    }),
  ];
}

function firstPage(d: HanjinLabelData, shared: readonly string[]): LabelSpec {
  const s = d.sort;
  const rc = d.recipient;
  const address = shrinkThenFit(`${rc.baseAddress} ${rc.detailAddress}`, RECIPIENT_MAX_WIDTH_MM, 10);
  const messageLines = wrapLines(d.deliveryMessage, MESSAGE_MAX_WIDTH_MM, 9, 2); // ⑭
  const messageY = messageLines.length === 1 ? [93.7] : [89.5, 93.7];

  const own = [
    // ── 분류 ──
    text({ x: 5, y: 19.4, pt: 35, bold: true, text: s.hubCode }), // ①
    text({ x: 24.5, y: 19.4, pt: 25, bold: true, text: s.terminalCode }), // ②
    text({ x: 42.5, y: 19.4, pt: fitSizePt(s.midCode, 9.5, 35, 20), bold: true, text: s.midCode }), // ④
    text({ x: 5.8, y: 22.6, pt: 8, text: fitText(`발지:${s.originTerminalCode} ${s.originTerminalName}`, 35, 8) }), // ⑦⑧
    text({ x: 57.8, y: 13.5, pt: fitSizePt(s.courierSortCode, 18, 20, 12), bold: true, text: s.courierSortCode }), // ⑯
    text({ x: 78, y: 13.5, pt: 20, bold: true, text: s.routeRank }), // ⑩
    text({ x: 52.8, y: 23, pt: 20, bold: true, text: fitText(s.courierName, 24, 20) }), // ⑪
    text({ x: 78, y: 19.4, pt: 8, text: s.centerCode }), // ⑤
    text({ x: 78, y: 23.1, pt: 8, text: fitText(s.centerName, 19, 8) }), // ⑥
    rect(98.5, 17, 20.5, 6.4), // ⑮ 상자
    text({ x: 108.75, y: 22, pt: 11, bold: true, anchor: 'middle', text: d.regionText }), // ⑮
    // ── 받는분 주소 ──
    text({ x: RECIPIENT_X_MM, y: 31.3, pt: address.pt, text: address.text }),
    text({
      x: RECIPIENT_X_MM,
      y: 39.4,
      pt: 19,
      bold: true,
      text: fitText(s.addressSummary, RECIPIENT_MAX_WIDTH_MM, 19),
    }), // ⑫
    rect(91.5, 36.7, 27.3, 6.4), // ⑬ 상자
    text({ x: 105.15, y: 41.8, pt: 14, bold: true, anchor: 'middle', text: d.freightText }), // ⑬
    // ── 하단 ──
    ...messageLines.map((line, i) => text({ x: MESSAGE_X_MM, y: messageY[i], pt: 9, text: line })), // ⑭
    text({ x: 74.5, y: 95.5, pt: 8, text: `운임Type : ${d.boxType}` }),
    text({ x: 119, y: 95.5, pt: 8, bold: true, anchor: 'end', text: d.trackingNoDisplay }), // ⑨ 좌측하단
  ];

  const barcodes: BarcodePlacement[] = [
    ...(s.terminalCode
      ? [
          {
            kind: 'CODE128' as const,
            data: s.terminalCode,
            xMm: CODE128_X_MM,
            yMm: 27,
            heightMm: 8,
            moduleDots: CODE128_MODULE_DOTS,
          },
        ] // ③
      : []),
    {
      kind: 'ITF',
      data: d.trackingNo,
      xMm: FS_ITF_X_MM,
      yMm: 80.5,
      heightMm: 12,
      moduleDots: ITF_MODULE_DOTS,
      wideRatio: 2.5,
    },
  ];

  return {
    widthMm: WIDTH_MM,
    heightMm: HEIGHT_MM,
    // 창고 FS 라벨지는 90° 로 넣으면 선인쇄와 위아래가 뒤집혀 나온다(2026-09-28 실물 출력).
    rotation: 270,
    svg: svgDocument(WIDTH_MM, HEIGHT_MM, [['delivery-slip', [...shared, ...own]]]),
    barcodes,
  };
}

/**
 * 추가 쪽: 분류 띠와 ITF 자리 두 곳에 「발송 금지」 — 찢은 조각이 어느 쪽으로 놓여도 보이게. ⑨ 는 가리지 않는다
 * (셀메이트는 ⑨ 위에 겹쳐 찍었지만 그게 짝 맞추기 단서다). 바코드 0 — 잘못 붙어도 터미널이 읽을 것이 없다.
 */
function continuationPage(shared: readonly string[]): LabelSpec {
  const marks = [
    text({ x: 5, y: 19.4, pt: fitSizePt(STOP_BANNER, 113, 28, 18), bold: true, text: STOP_BANNER }),
    text({ x: 97.5, y: 89.5, pt: fitSizePt(STOP_MARK, 43, 28, 18), bold: true, anchor: 'middle', text: STOP_MARK }),
  ];
  return {
    widthMm: WIDTH_MM,
    heightMm: HEIGHT_MM,
    rotation: 270,
    svg: svgDocument(WIDTH_MM, HEIGHT_MM, [['continuation', [...shared, ...marks]]]),
    barcodes: [],
  };
}
```

`hanjin-label-templates.ts` 의 FS 한 줄:

```ts
  FS: renderHanjinFsLabel,
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill` → Expected: PASS (NS·NL 해시 그대로)
Run: `npm run type-check 2>&1 | grep -v probe-image-size | grep -c error` → Expected: `0`

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/waybill
git commit -m "feat(core): 한진 FS 운송장에 품목 줄을 찍고 4줄을 넘으면 발송 금지 추가 쪽을 잇는다 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 6: 현장 키트 7줄 견본 · 연동 문서 정정

**Files:**
- Modify: `scripts/ops/hanjin-label-preview/render.ts` (`SAMPLES`)
- Modify: `scripts/ops/hanjin-label-preview/README.md` (§1 표 아래, §4 체크리스트)
- Modify: `docs/hanjin-api-integration-reference.md:274`

- [ ] **Step 1: 7줄 견본**

`render.ts` 의 `SAMPLES` 선언 끝에 FS 7줄 견본을 더한다:

```ts
const SEVEN_ITEMS: HanjinLabelData['items'] = [
  { name: '노몬드 대용량 전처리제 1000ml', quantity: 1 },
  { name: '노몬드 긴 마이크로 브러쉬', quantity: 1 },
  { name: '실리콘 아이패치 블랙', quantity: 2 },
  { name: '롤리킹 펌제 1제2제', quantity: 4 },
  { name: '하이드로겔 아이패치 무지 50개입', quantity: 1 },
  { name: '베르사 펌글루 5ml', quantity: 2 },
  { name: '노몬드 크림리무버', quantity: 2 },
];

const SAMPLES: Array<[name: string, type: HanjinLabelType, data: HanjinLabelData]> = [
  ...HANJIN_LABEL_TYPES.map(
    (type): [string, HanjinLabelType, HanjinLabelData] => [`hanjin-${type.toLowerCase()}-preview`, type, SAMPLE],
  ),
  // 품목 7줄 = FS 2쪽(4 + 3). 추가 쪽의 「발송 금지」 와 품목 칸을 실물로 대조한다.
  ['hanjin-fs-items-preview', 'FS', { ...SAMPLE, items: SEVEN_ITEMS }],
];
```

(Task 4 의 `SAMPLES` 선언을 이것으로 바꾼다.)

Run: `npx tsx scripts/ops/hanjin-label-preview/render.ts /tmp/kit-t6`
Expected: 마지막 줄 `hanjin-fs-items-preview … 2 page(s)`, 파일 `hanjin-fs-items-preview-p1.png`·`-p2.png`·`.zpl`·`.compressed.zpl`

- [ ] **Step 2: README**

§1 의 「`hanjin-{ns,nl,fs}-preview.{png,zpl,compressed.zpl}` 9개가 나온다.」 를 다음으로 바꾼다:

```markdown
`hanjin-{ns,nl,fs}-preview.{png,zpl,compressed.zpl}` 9개와 FS 품목 7줄 견본
`hanjin-fs-items-preview{-p1.png,-p2.png,.zpl,.compressed.zpl}`(2쪽)이 나온다.
```

§4 체크리스트 끝에 추가:

```markdown
- [ ] FS 품목 7줄 견본: 두 쪽 모두 품목이 같은 칸에 찍히고, 2쪽의 「발송 금지」 두 곳과 쪽 표시(`2/2 · 총 7건 13개`)가 선인쇄를 밟지 않는다
```

- [ ] **Step 3: 연동 문서**

`docs/hanjin-api-integration-reference.md:274` 의 `형태다(금액 표시 의무 없음). **월 정산 계약이면 `CD` 하나로 확정된다** — `CT` 는 이 배송구분에서 거절되므로.` 를 다음으로 바꾼다:

```markdown
> 형태다(금액 표시 의무 없음). **월 정산 계약이면 `CD` 하나로 확정된다** — `CT` 는 이 배송구분에서 거절되므로.
> **우리 계약은 신용(월 정산)이다(2026-09-28 사내 확인) → `CD` 확정, 라벨 ⑬ 에 운송료 금액을 찍지 않는다.**
```

- [ ] **Step 4: Commit**

```bash
git add scripts/ops/hanjin-label-preview docs/hanjin-api-integration-reference.md
git commit -m "docs(waybill): 현장 키트에 FS 품목 7줄 견본을 더하고 신용 계약 확정을 반영한다 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 7: 실물 출력으로 좌표 확정 (사람과 함께)

프린터·라벨지·스캔은 사람이 한다. 이 태스크는 서브에이전트가 아니라 **세션 주인이 사용자와 같이** 한다.

**Files:**
- Modify (필요 시): `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.ts` 의 `FS_ITEM_FIRST_BASELINE_MM`·`FS_ITEM_PITCH_MM`·`FS_PAGE_MARK_Y_MM`·`continuationPage` 좌표
- Modify (좌표가 바뀌면): Task 5 테스트의 `namesOn` 정규식 y 값 · 「수량은 오른쪽 끝」 의 `y="57"`

- [ ] **Step 1: 출력**

```bash
npx tsx scripts/ops/hanjin-label-preview/render.ts <scratchpad>/kit-items
lp -d XP108 -o raw <scratchpad>/kit-items/hanjin-fs-items-preview.compressed.zpl
```

(`XP108` 은 개발 PC 의 CUPS raw 큐 — 없으면 `lpadmin -p XP108 -E -v "$(lpinfo -v | grep -o 'usb://Xprinter[^ ]*')" -m raw`.)

- [ ] **Step 2: 사용자가 두 쪽을 스캔해 올린다 → 선인쇄 가로선·「※ 개인정보…」 문구와 글자 위아래 끝을 잰다**

PR #977 때와 같은 방법: 스캔에서 남색(선인쇄) 가로선 행과 검은 글자 행을 찾아, 두 바코드(첫 쪽 ITF x 76 / y 80.5–92.5, CODE128 y 27–35)를 기준점으로 px → mm 로 옮긴다. 추가 쪽은 바코드가 없으므로 첫 쪽에서 얻은 변환을 그대로 쓴다(같은 프린터·같은 라벨지).

- [ ] **Step 3: 밟는 곳이 있으면 상수를 옮기고 테스트의 좌표를 맞춘 뒤 재출력 → 사용자 확인**

- [ ] **Step 4: Commit (바뀐 게 있을 때만)**

```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label
git commit -m "fix(core): FS 품목 줄·발송 금지 좌표를 실물 출력으로 맞춘다 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 8: 게이트

- [ ] **Step 1:** Run: `npm run type-check 2>&1 | grep error` → Expected: `probe-image-size` 1건만
- [ ] **Step 2:** Run: `npx jest --maxWorkers=2` → Expected: 실패 0
- [ ] **Step 3:** Run: `npx tsx scripts/ops/hanjin-label-preview/render.ts /tmp/kit-final` → Expected: 4줄 출력, 마지막만 `2 page(s)`
