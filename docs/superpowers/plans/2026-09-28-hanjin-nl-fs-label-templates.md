# 한진 NL·FS형 운송장 템플릿 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core 가 한진 NS 외에 NL(100×102mm)·FS(123×100mm) 운송장도 ZPL 로 그리고, `HANJIN_LABEL_TYPE` 으로 형을 고르며, 현장 키트가 세 형을 모두 뽑게 한다.

**Architecture:** 템플릿(순수 함수 `HanjinLabelData → LabelSpec`)을 형마다 하나씩 두고 레지스트리가 env 값으로 고른다. 회전(90°/0°)은 `LabelSpec.rotation` 이 정하고 `encodeZpl` 이 따른다. SVG 헬퍼는 NS 템플릿에서 뽑아 세 템플릿이 공유한다 — NS 출력은 해시로 고정해 리팩터가 바꾸지 못하게 한다.

**Tech Stack:** NestJS core, TypeScript, jest(ts-jest, transpile-only), `@resvg/resvg-js`(기존), 번들 나눔고딕(기존).

**Spec:** `docs/superpowers/specs/2026-09-28-hanjin-nl-fs-label-templates-design.md` (선행: `docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md`)

## Global Constraints

- 저장소에 의존성 추가 금지(`package.json`·lockfile 변경 0). 역렌더 스모크 도구(zebrash·zxing-cpp)는 스크래치에서만.
- 템플릿은 **검은 요소(가변 데이터)만** 그린다 — 샘플의 보라색·컬러 요소(테두리·캡션·로고·안내문·「GENERAL」)는 선인쇄.
- 한진 포털 이미지는 저장소에 복사하지 않는다(링크만).
- NS 출력 불변: `sha256(spec.svg + JSON.stringify(spec.barcodes))` = `872607a6806741c6abcba32a1419a73b7a79d418ebd0644e79bbe8faa958da1c` (NS 스펙의 `DATA` 고정 데이터).
- 외곽: NS 200×102 rotation 90 · NL 100×102 rotation 0 · FS 123×100 rotation 90. 프린터 최대 인쇄폭 108mm(864 dot).
- `HANJIN_LABEL_TYPE` ∈ `NS`|`NL`|`FS`, 비면 `NS`, 대소문자·앞뒤 공백 무시. 모르는 값은 **라벨 요청만** `Error`(500) — 부팅·발급·`missingHanjinConfig` 는 라벨 형을 보지 않는다.
- 문구 「출고번호」 통일(값 `custOrdNo`). ⑬ 은 `freightText`.
- 면별 마스킹: 배달표 받는분 = 성명·연락처 마스킹 + 주소 원본 / 배달표 보낸분 = 성명·연락처 원본 + 주소 `maskAddress`(NS 만 미표기) / 받는고객용 받는분 = ⑫ 만(NL) / 받는고객용 보낸분 = 전부 마스킹.
- 레이어·스타일: CLAUDE.md. `any`·`as` 캐스팅 금지(테스트의 `as const` 는 허용). 테스트 보조 파일은 `__support__/` 에 둔다(저장소 관례).
- 검증 게이트: `npm run type-check` 0, `npx jest --maxWorkers=2 apps/core/src/modules/fulfillment/waybill scripts` 실패 0. 마지막 태스크 후 전체 `npx jest --maxWorkers=2` 실패 0.
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS`.

## Review Focus

1. `HANJIN_LABEL_TYPE=nl`(소문자)·`' NL '` — 사람은 NL 이 찍히길 기대한다 → Task 5 config 테스트가 대문자·trim 정규화를 고정.
2. 실제 길이 출고번호(28자)·긴 주소·긴 ⑭·긴 집배점명이 바코드 quiet zone 을 침범 → Task 2·3·4 의 금지 구역 잉크 0 테스트(`HANJIN_LABEL_LONG_FIXTURE`). NS 도 여기서 한 군데(⑥ 집배점명) 걸린다 — Task 2 가 고친다.
3. demo 캐리어처럼 터미널코드가 빈 데이터 → CODE128 없이 ITF 만, 크래시 없음 → Task 3·4 테스트.
4. 동·호수 있는 배달표 받는분 주소가 말줄임으로 잘림 → Task 3·4 의 실주소 3건 테스트.
5. 회전 설정 실수로 폭이 108mm 를 넘는 라벨(예: NS 를 rotation 0) → Task 1 인코더 가드 + Task 5 레지스트리의 «넣는 폭 ≤ 108mm» 테스트.

---

## 파일 구조

```
apps/core/src/modules/fulfillment/waybill/
  label/label-model.ts                    수정: LabelRotation, LabelSpec.rotation, PRINTER_MAX_WIDTH_MM, barcodeWidthMm, quietZoneMm
  label/label-model.spec.ts               신규
  label/zpl-encoder.ts                    수정: rotation 0/90, 인쇄폭 가드
  label/zpl-encoder.spec.ts               수정
  label/__support__/label-invariants.ts   신규: 바코드 금지 구역 잉크 계산(테스트 전용)
  carrier/hanjin/hanjin.config.ts         수정: labelType
  carrier/hanjin/hanjin.config.spec.ts    수정
  carrier/hanjin/label/
    hanjin-label-svg.ts                   신규: text/rect/hline/koreanDate/shrinkThenFit/svgDocument
    hanjin-label-svg.spec.ts              신규
    hanjin-label-data.ts(.spec.ts)        수정: sort.terminalName
    hanjin-ns-template.ts(.spec.ts)       수정: rotation 90, 헬퍼 import, ⑥ fitText, 해시 고정·금지구역 테스트
    hanjin-nl-template.ts(.spec.ts)       신규
    hanjin-fs-template.ts(.spec.ts)       신규
    hanjin-label-templates.ts(.spec.ts)   신규: 레지스트리
    __support__/hanjin-label-fixture.ts   신규: 공용 테스트 데이터
  waybill-label.manager.ts                수정: 레지스트리 + rotation
  (HanjinConfig 픽스처를 쓰는 spec 9개)   수정: labelType: 'NS'
apps/core/src/config/env.validation.ts    수정: HANJIN_LABEL_TYPE
scripts/ops/hanjin-label-preview/render.ts   수정: 세 형
scripts/ops/hanjin-label-preview/README.md   신규: 현장 키트
docs/hanjin-api-integration-reference.md     수정: §3.1
docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md  수정: §11
```

---

### Task 1: `LabelSpec.rotation` 과 인코더 회전 분기

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/label/label-model.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/label/label-model.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/label/zpl-encoder.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/label/zpl-encoder.spec.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/label/__support__/label-invariants.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-ns-template.ts` (반환에 `rotation: 90`)
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-ns-template.spec.ts` (해시 고정)
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill-label.manager.ts` (`rotation` 전달)
- Modify: `scripts/ops/hanjin-label-preview/render.ts` (`barcodeWidthMm` import, `rotation` 전달)

**Interfaces:**
- Produces:
  - `type LabelRotation = 0 | 90`
  - `interface LabelSpec { widthMm: number; heightMm: number; rotation: LabelRotation; svg: string; barcodes: BarcodePlacement[] }`
  - `const PRINTER_MAX_WIDTH_MM = 108`
  - `barcodeWidthMm(b: BarcodePlacement): number` · `quietZoneMm(b: BarcodePlacement): number`
  - `interface ZplOptions { compress: boolean; rotation: LabelRotation }` · `encodeZpl(drawn: MonoBitmap, barcodes: readonly BarcodePlacement[], opts: ZplOptions): string`
  - `__support__/label-invariants.ts`: `barcodeKeepOutsMm(spec: LabelSpec): KeepOut[]` · `inkInBarcodeKeepOuts(spec: LabelSpec): Array<{ kind: BarcodeKind; ink: number }>`

- [ ] **Step 1: NS 출력 해시를 먼저 고정한다 (특성 테스트 — 지금 바로 초록이어야 한다)**

`hanjin-ns-template.spec.ts` 맨 위 import 에 `createHash` 는 이미 있다. `describe('renderHanjinNsLabel', …)` 안 첫 `it` 앞에 추가:

```ts
  it('NS 출력은 NL·FS 추가 리팩터 전과 같다 (svg + 바코드 배치 해시 고정)', () => {
    const digest = createHash('sha256').update(spec.svg).update(JSON.stringify(spec.barcodes)).digest('hex');
    expect(digest).toBe('872607a6806741c6abcba32a1419a73b7a79d418ebd0644e79bbe8faa958da1c');
  });
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-ns-template.spec.ts -t '해시 고정'`
Expected: PASS. **FAIL 이면 멈추고 보고한다** — 고정 데이터가 계획 작성 시점과 다르다는 뜻이다.

- [ ] **Step 2: 실패하는 테스트 — label-model 의 폭·quiet zone**

`label/label-model.spec.ts` 신규:

```ts
import { barcodeWidthMm, PRINTER_MAX_WIDTH_MM, quietZoneMm, type BarcodePlacement } from './label-model';

const ITF: BarcodePlacement = { kind: 'ITF', data: '452716978431', xMm: 0, yMm: 0, heightMm: 10, moduleDots: 3, wideRatio: 2.5 };
const CODE128: BarcodePlacement = { kind: 'CODE128', data: '150', xMm: 0, yMm: 0, heightMm: 8, moduleDots: 2 };

describe('barcodeWidthMm', () => {
  it('ITF: start 4 + 자릿수 × (3 + 2×비) + stop (비+2) 모듈', () => {
    // (4 + 12 × 8 + 4.5) × 3 dot / 8 = 39.1875mm
    expect(barcodeWidthMm(ITF)).toBeCloseTo(39.1875, 6);
  });
  it('ITF 비를 안 주면 2.5', () => {
    expect(barcodeWidthMm({ ...ITF, wideRatio: undefined })).toBeCloseTo(39.1875, 6);
  });
  it('CODE128: subset B 상한 (11 × (n + 2) + 13) 모듈', () => {
    // (11 × 5 + 13) × 2 / 8 = 17mm
    expect(barcodeWidthMm(CODE128)).toBe(17);
  });
});

describe('quietZoneMm', () => {
  it('모듈 × 10', () => {
    expect(quietZoneMm(ITF)).toBe(3.75);
    expect(quietZoneMm(CODE128)).toBe(2.5);
  });
});

it('프린터 최대 인쇄폭은 108mm', () => {
  expect(PRINTER_MAX_WIDTH_MM).toBe(108);
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/label-model.spec.ts`
Expected: FAIL — `barcodeWidthMm` 등이 export 되지 않음.

- [ ] **Step 3: label-model 구현**

`label-model.ts` 의 `LabelSpec` 을 바꾸고 아래를 더한다(나머지는 그대로):

```ts
/** 창고 프린터(XP-DT108B) 최대 인쇄폭. 프린터에 넣는 방향의 가로가 이걸 넘으면 잘려 찍힌다. */
export const PRINTER_MAX_WIDTH_MM = 108;

/**
 * 프린터에 넣을 때 시계방향 회전(도). 템플릿은 늘 포털 도면 방향대로 그리고, 넣는 방향은 형이 정한다 —
 * NS(200mm)·FS(123mm)는 긴 변이 인쇄폭을 넘어 90°, NL(100mm)은 그대로 들어가 0°.
 */
export type LabelRotation = 0 | 90;
```

```ts
/** 템플릿 출력. svg 의 viewBox 는 0 0 widthMm heightMm(mm 단위, 템플릿이 그린 방향)이다. */
export interface LabelSpec {
  widthMm: number;
  heightMm: number;
  rotation: LabelRotation;
  svg: string;
  barcodes: BarcodePlacement[];
}
```

```ts
/**
 * 바코드 인쇄 폭(mm) «상한». quiet zone 판정과 미리보기 테두리에 쓴다 — ZPL 은 프린터가 `^B2`/`^BC` 로
 * 직접 그리므로 출력에는 영향이 없다.
 *
 * ITF: start(좁은 4모듈) + 자릿수 × (좁은 3 + 넓은 2×비) + stop(비 + 2).
 * CODE128: subset B 기준 start·check 포함 (n + 2) 글자 × 11 + stop 13 모듈. 숫자 쌍을 subset C 로
 * 접으면 더 좁아지므로 상한이다.
 */
export function barcodeWidthMm(b: BarcodePlacement): number {
  if (b.kind === 'CODE128') return ((11 * (b.data.length + 2) + 13) * b.moduleDots) / DOTS_PER_MM;
  const ratio = b.wideRatio ?? 2.5;
  return ((4 + b.data.length * (3 + 2 * ratio) + (ratio + 2)) * b.moduleDots) / DOTS_PER_MM;
}

/** 바코드 좌우에 비워 둬야 하는 quiet zone(모듈 × 10). */
export function quietZoneMm(b: BarcodePlacement): number {
  return (10 * b.moduleDots) / DOTS_PER_MM;
}
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/label-model.spec.ts` → PASS.

- [ ] **Step 4: 실패하는 테스트 — 인코더 rotation 0 과 폭 가드**

`zpl-encoder.spec.ts`:
1. 기존 `encodeZpl(…, { compress: false })` / `{ compress: true }` 호출 **전부**에 `rotation: 90` 을 더한다(`{ compress: false, rotation: 90 }`). 기대값은 바꾸지 않는다.
2. 파일 끝에 추가:

```ts
// NL 크기(폭 100 × 길이 102mm)를 돌리지 않고 넣는 경우.
const nlBitmap = () => createBitmap(800, 816);

describe('encodeZpl — rotation 0', () => {
  it('돌리지 않고 폭 800 · 길이 816 으로 선언한다', () => {
    const zpl = encodeZpl(nlBitmap(), [], { compress: false, rotation: 0 });
    expect(zpl).toContain('^PW800');
    expect(zpl).toContain('^LL816');
  });

  it('^GF 데이터는 원본 비트맵 행 그대로다', () => {
    const b = nlBitmap();
    for (let x = 10; x < 200; x++) setBit(b, x, 20);
    const zpl = encodeZpl(b, [], { compress: false, rotation: 0 });
    const m = /\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS/.exec(zpl);
    if (!m) throw new Error('^GFA field not found in ZPL');
    expect(Number(m[3])).toBe(100); // 800 / 8
    expect(m[4]).toBe(hexRowsOf(b).join(''));
  });

  it('ITF 는 원좌표 ^FO(x, y) 에 ^B2N 으로 놓는다', () => {
    const zpl = encodeZpl(nlBitmap(), [{ ...ITF, xMm: 56, yMm: 62, heightMm: 14.5 }], { compress: false, rotation: 0 });
    // x = 448, y = 496, h = round(14.5 × 8) = 116
    expect(zpl).toContain('^FO448,496^BY3,2.5^B2N,116,N,N,N^FD452716978431^FS');
  });

  it('CODE128 은 ^BCN 으로 놓는다', () => {
    const code: BarcodePlacement = { kind: 'CODE128', data: '150', xMm: 43, yMm: 5, heightMm: 8, moduleDots: 2 };
    const zpl = encodeZpl(nlBitmap(), [code], { compress: false, rotation: 0 });
    expect(zpl).toContain('^FO344,40^BY2^BCN,64,N,N,N^FD150^FS');
  });
});

describe('encodeZpl — 인쇄폭 가드', () => {
  it('넣는 방향 폭이 864 dot(108mm)를 넘으면 던진다 — NS 를 돌리지 않으면 1600 dot', () => {
    expect(() => encodeZpl(nsBitmap(), [], { compress: false, rotation: 0 })).toThrow(/printer max is 864/);
  });
  it('864 dot 는 통과, 865 dot 는 던진다', () => {
    expect(() => encodeZpl(createBitmap(864, 100), [], { compress: false, rotation: 0 })).not.toThrow();
    expect(() => encodeZpl(createBitmap(865, 100), [], { compress: false, rotation: 0 })).toThrow(/864/);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/zpl-encoder.spec.ts`
Expected: FAIL — rotation 0 에서도 `^PW816`(회전됨), `^B2R` 등.

- [ ] **Step 5: 인코더 구현**

`zpl-encoder.ts`:
- import 에 `mmToDots` 는 이미 있다. `PRINTER_MAX_WIDTH_MM`, `type LabelRotation` 을 더한다.
- 파일 머리 주석을 바꾼다:

```ts
/**
 * 템플릿 방향으로 그린 라벨을 ZPL 로 바꾼다(#913).
 *
 * 창고 프린터(XP-DT108B)의 인쇄폭이 108mm 라 긴 변이 그보다 긴 형(NS 200mm·FS 123mm)은 짧은 변을 폭으로
 * 넣는다 — `rotation: 90` 이면 비트맵과 바코드 좌표를 함께 시계방향 90° 돌린다. NL(100mm)은 그대로 넣는다.
 * 한글은 프린터 내장 폰트에 없어 텍스트는 전부 배경 비트맵(^GF)에 들어 있고, 프린터 명령으로 그리는 것은
 * 바코드뿐이다.
 */
export interface ZplOptions {
  /** ^GF 데이터에 ZPL ACS 압축을 쓸지. 기본값은 창고 실물 출력으로 정한다(NS 스펙 §10-3). */
  compress: boolean;
  /** LabelSpec.rotation — 프린터에 넣을 때 시계방향 회전(도). */
  rotation: LabelRotation;
}
```

- `barcodeField` 를 바꾼다:

```ts
function barcodeField(b: BarcodePlacement, drawnW: number, drawnH: number, rotation: LabelRotation): string {
  const x = mmToDots(b.xMm);
  const y = mmToDots(b.yMm);
  const h = mmToDots(b.heightMm);
  if (x < 0 || y < 0 || x >= drawnW || y + h > drawnH) {
    throw new Error(`barcode ${b.kind} is outside the label: x=${x} y=${y} h=${h} on ${drawnW}×${drawnH}`);
  }
  // 시계방향 90°: 템플릿 (x, y) → 프린터 (H-1-y, x). 상자 (x, y, h) 의 프린터 쪽 왼쪽 위는 (H-y-h, x).
  const fo = rotation === 90 ? `^FO${drawnH - y - h},${x}` : `^FO${x},${y}`;
  const orientation = rotation === 90 ? 'R' : 'N';
  if (b.kind === 'ITF') {
    if (!/^(?:\d\d)+$/.test(b.data)) throw new Error(`ITF needs an even number of digits: "${b.data}"`);
    // f·g = N: 사람용 숫자는 SVG 에서 그린다. e = N: 한진 번호에 체크디지트가 이미 있다.
    return `${fo}^BY${b.moduleDots},${(b.wideRatio ?? 2.5).toFixed(1)}^B2${orientation},${h},N,N,N^FD${b.data}^FS`;
  }
  if (!b.data || /[\^~]/.test(b.data)) {
    throw new Error(`CODE128 data is empty or contains ZPL control characters: "${b.data}"`);
  }
  return `${fo}^BY${b.moduleDots}^BC${orientation},${h},N,N,N^FD${b.data}^FS`;
}
```

- `encodeZpl` 를 바꾼다:

```ts
export function encodeZpl(drawn: MonoBitmap, barcodes: readonly BarcodePlacement[], opts: ZplOptions): string {
  const printed = opts.rotation === 90 ? rotateClockwise(drawn) : drawn;
  const maxDots = mmToDots(PRINTER_MAX_WIDTH_MM);
  if (printed.widthDots > maxDots) {
    throw new Error(
      `label is ${printed.widthDots} dots wide as fed (rotation ${opts.rotation}), printer max is ${maxDots}`,
    );
  }
  const total = printed.bytesPerRow * printed.heightDots;
  const rows = hexRows(printed);
  const gfData = opts.compress ? compressAcs(rows) : rows.join('');
  const lines = [
    '^XA',
    `^PW${printed.widthDots}`,
    `^LL${printed.heightDots}`,
    '^LH0,0',
    `^FO0,0^GFA,${total},${total},${printed.bytesPerRow},${gfData}^FS`,
    ...barcodes.map((b) => barcodeField(b, drawn.widthDots, drawn.heightDots, opts.rotation)),
    '^PQ1',
    '^XZ',
  ];
  return lines.join('\n');
}
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/zpl-encoder.spec.ts` → PASS (기존 테스트 포함).

- [ ] **Step 6: 호출부 — NS 템플릿·매니저·render.ts**

`hanjin-ns-template.ts` 의 반환을 `return { widthMm: WIDTH_MM, heightMm: HEIGHT_MM, rotation: 90, svg, barcodes };` 로. 파일 머리 주석 첫 줄 뒤에 한 줄: `프린터에는 90° 돌려 넣는다(짧은 변 102mm 가 폭).`

`waybill-label.manager.ts`:

```ts
    const data = encodeZpl(bitmap, spec.barcodes, { compress: WAYBILL.LABEL_ZPL_COMPRESS, rotation: spec.rotation });
```

`scripts/ops/hanjin-label-preview/render.ts`: 로컬 `barcodeWidthMm` 함수와 그 주석을 지우고 `label-model` import 에 `barcodeWidthMm` 을 더한다(`type BarcodePlacement` import 는 더 안 쓰면 지운다). 두 `encodeZpl` 호출에 `rotation: spec.rotation` 을 더한다.

- [ ] **Step 7: 금지 구역 보조 파일**

`label/__support__/label-invariants.ts` 신규:

```ts
import { barcodeWidthMm, DOTS_PER_MM, getBit, quietZoneMm, type BarcodeKind, type LabelSpec } from '../label-model';
import { SvgRasterizer } from '../svg-rasterizer';

/** 바코드 상자 + 좌우 quiet zone (mm, 템플릿 방향). 이 안에 다른 잉크가 있으면 스캐너가 못 읽을 수 있다. */
export interface KeepOut {
  kind: BarcodeKind;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function barcodeKeepOutsMm(spec: LabelSpec): KeepOut[] {
  return spec.barcodes.map((b) => {
    const qz = quietZoneMm(b);
    return { kind: b.kind, x0: b.xMm - qz, x1: b.xMm + barcodeWidthMm(b) + qz, y0: b.yMm, y1: b.yMm + b.heightMm };
  });
}

const rasterizer = new SvgRasterizer();

/** 인쇄되는 비트맵과 같은 경로로 svg 를 그려, 각 바코드 금지 구역 안의 검은 점 수를 센다. */
export function inkInBarcodeKeepOuts(spec: LabelSpec): Array<{ kind: BarcodeKind; ink: number }> {
  const bmp = rasterizer.rasterize(spec.svg, Math.round(spec.widthMm * DOTS_PER_MM));
  return barcodeKeepOutsMm(spec).map((z) => {
    const x0 = Math.max(0, Math.floor(z.x0 * DOTS_PER_MM));
    const x1 = Math.min(bmp.widthDots, Math.ceil(z.x1 * DOTS_PER_MM));
    const y0 = Math.max(0, Math.floor(z.y0 * DOTS_PER_MM));
    const y1 = Math.min(bmp.heightDots, Math.ceil(z.y1 * DOTS_PER_MM));
    let ink = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (getBit(bmp, x, y)) ink++;
    return { kind: z.kind, ink };
  });
}
```

NS 스펙에 사용 테스트를 하나 더한다(`describe('renderHanjinNsLabel')` 안):

```ts
  it('바코드 금지 구역(바코드 + 좌우 quiet zone)은 라벨 안이고 잉크가 없다', () => {
    for (const z of barcodeKeepOutsMm(spec)) {
      expect(z.x0).toBeGreaterThanOrEqual(0);
      expect(z.x1).toBeLessThanOrEqual(spec.widthMm);
      expect(z.y1).toBeLessThanOrEqual(spec.heightMm);
    }
    expect(inkInBarcodeKeepOuts(spec)).toEqual(spec.barcodes.map((b) => ({ kind: b.kind, ink: 0 })));
  });
```

import: `import { barcodeKeepOutsMm, inkInBarcodeKeepOuts } from '../../../label/__support__/label-invariants';`

- [ ] **Step 8: 검증**

Run: `npx jest --maxWorkers=2 apps/core/src/modules/fulfillment/waybill` → PASS (해시 테스트 포함)
Run: `npm run type-check` → 에러 0
Run: `npx tsx scripts/ops/hanjin-label-preview/render.ts /tmp/nsprev && head -c 60 /tmp/nsprev/hanjin-ns-preview.zpl` → `^XA\n^PW816\n^LL1600…`

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/modules/fulfillment/waybill scripts/ops/hanjin-label-preview/render.ts
git commit -m "feat(core): 라벨 회전을 LabelSpec 이 정하고 인쇄폭 108mm 를 넘으면 거절한다 (#913)"
```

---

### Task 2: 공용 SVG 헬퍼·공용 픽스처·`terminalName`, NS 금지 구역 수정

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-svg.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-svg.spec.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/__support__/hanjin-label-fixture.ts`
- Modify: `…/carrier/hanjin/label/hanjin-ns-template.ts`, `hanjin-ns-template.spec.ts`
- Modify: `…/carrier/hanjin/label/hanjin-label-data.ts`, `hanjin-label-data.spec.ts`
- Modify: `scripts/ops/hanjin-label-preview/render.ts` (`SAMPLE.sort.terminalName`)

**Interfaces:**
- Consumes: Task 1 의 `LabelSpec`, `barcodeKeepOutsMm`, `inkInBarcodeKeepOuts`
- Produces:
  - `hanjin-label-svg.ts`: `interface TextEl { x: number; y: number; pt: number; text: string; bold?: boolean; anchor?: 'middle' | 'end' }`, `text(t: TextEl): string`, `rect(x, y, w, h): string`, `hline(x1, x2, y): string`, `koreanDate(ymd: string): string`, `shrinkThenFit(t: string, maxWidthMm: number, basePt: number): { pt: number; text: string }`, `wrapLines(t: string, maxWidthMm: number, pt: number, maxLines: number): string[]`, `svgDocument(widthMm: number, heightMm: number, blocks: ReadonlyArray<readonly [string, readonly string[]]>): string`
  - `HanjinSortFields.terminalName: string` (← `tml_nam`)
  - `__support__/hanjin-label-fixture.ts`: `HANJIN_LABEL_FIXTURE: HanjinLabelData`, `HANJIN_LABEL_LONG_FIXTURE: HanjinLabelData`

- [ ] **Step 1: 실패하는 테스트 — 헬퍼**

`hanjin-label-svg.spec.ts`:

```ts
import { textWidthMm } from '../../../label/svg-text';
import { koreanDate, rect, shrinkThenFit, svgDocument, text, wrapLines } from './hanjin-label-svg';

describe('hanjin-label-svg', () => {
  it('text: pt → mm 글자 크기, 굵기·정렬, 이스케이프', () => {
    expect(text({ x: 1, y: 2, pt: 10, text: 'A<B', bold: true, anchor: 'end' })).toBe(
      '<text x="1" y="2" font-size="3.53" font-weight="700" text-anchor="end">A&lt;B</text>',
    );
  });
  it('rect: 테두리만 0.4mm', () => {
    expect(rect(1, 2, 3, 4)).toBe(
      '<rect x="1" y="2" width="3" height="4" fill="none" stroke="#000" stroke-width="0.4"/>',
    );
  });
  it('koreanDate', () => {
    expect(koreanDate('2026-09-28')).toBe('2026년 09월 28일');
  });
  it('shrinkThenFit: 들어가면 원래 크기, 넘치면 먼저 줄이고 그래도 넘치면 자른다(최소 7pt)', () => {
    expect(shrinkThenFit('가나다', 50, 10)).toEqual({ pt: 10, text: '가나다' });
    const shrunk = shrinkThenFit('가'.repeat(15), 40, 10);
    expect(shrunk.pt).toBeLessThan(10);
    expect(shrunk.text).toBe('가'.repeat(15));
    const cut = shrinkThenFit('가'.repeat(100), 40, 10);
    expect(cut.pt).toBe(7);
    expect(cut.text.endsWith('…')).toBe(true);
  });
  describe('wrapLines — 좁은 칸에서 자르면 곤란한 자유 텍스트(FS ⑭)를 여러 줄로', () => {
    it('한 줄에 들어가면 그대로 한 줄', () => {
      expect(wrapLines('문앞에 두세요', 60, 9, 2)).toEqual(['문앞에 두세요']);
    });
    it('넘치면 칸 안에서 마지막 공백에서 끊는다 — 글자를 잃지 않는다', () => {
      const msg = '부재 시 경비실에 맡겨 주세요. 파손 주의 (공동현관 #1234)';
      const lines = wrapLines(msg, 62.95, 9, 2); // FS ⑭ 칸 폭
      expect(lines).toEqual(['부재 시 경비실에 맡겨 주세요. 파손 주의', '(공동현관 #1234)']);
      for (const l of lines) expect(textWidthMm(l, 9)).toBeLessThanOrEqual(62.95);
    });
    it('공백이 없으면 글자 단위로 끊는다', () => {
      // 9pt 한글 한 자 ≈ 3.02mm → 30mm 칸에 9자. 15자는 9 + 6.
      const lines = wrapLines('가'.repeat(15), 30, 9, 2);
      expect(lines).toEqual(['가'.repeat(9), '가'.repeat(6)]);
    });
    it('maxLines 를 넘치는 나머지는 마지막 줄에서 말줄임', () => {
      const lines = wrapLines('가'.repeat(100), 30, 9, 2);
      expect(lines).toHaveLength(2);
      expect(lines[1].endsWith('…')).toBe(true);
      for (const l of lines) expect(textWidthMm(l, 9)).toBeLessThanOrEqual(30);
    });
    it('빈 문자열은 빈 한 줄', () => {
      expect(wrapLines('', 30, 9, 2)).toEqual(['']);
    });
  });

  it('svgDocument: mm viewBox·나눔고딕, 블록은 순서대로 <g id>', () => {
    expect(svgDocument(100, 102, [['a', ['<x/>']], ['b', ['<y/>', '<z/>']]])).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="102mm" viewBox="0 0 100 102" font-family="NanumGothic">' +
        '<g id="a"><x/></g><g id="b"><y/><z/></g></svg>',
    );
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-svg.spec.ts` → FAIL (모듈 없음).

- [ ] **Step 2: 헬퍼 구현 — NS 에서 그대로 옮긴다**

`hanjin-label-svg.ts` 신규. `TextEl`·`text`·`rect`·`hline`·`koreanDate`·`shrinkThenFit` 는 `hanjin-ns-template.ts` 의 본문을 **한 글자도 바꾸지 않고** 옮기고 `export` 를 붙인다(`shrinkThenFit` 위 주석도 함께). 추가:

```ts
/** 라벨 SVG 문서. viewBox 는 mm, 글꼴은 번들 나눔고딕. 면 블록은 `<g id>` 로 나눠 테스트가 면별로 검사한다. */
export function svgDocument(
  widthMm: number,
  heightMm: number,
  blocks: ReadonlyArray<readonly [string, readonly string[]]>,
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}" font-family="NanumGothic">`,
    ...blocks.map(([id, els]) => `<g id="${id}">${els.join('')}</g>`),
    '</svg>',
  ].join('');
}
```

```ts
/**
 * 좁은 칸의 자유 텍스트를 최대 maxLines 줄로 나눈다 — 줄마다 칸 폭 안에서 마지막 공백에서 끊고(없으면
 * 글자 단위), 그래도 남는 것은 마지막 줄에서 말줄임. FS ⑭ 가 ITF 옆 63mm 칸이라 한 줄로는 공동현관
 * 비밀번호가 잘려서 생겼다(계획 작성 때 시제품 실측).
 */
export function wrapLines(t: string, maxWidthMm: number, pt: number, maxLines: number): string[] {
  const lines: string[] = [];
  let rest = t.trim();
  while (lines.length < maxLines - 1 && textWidthMm(rest, pt) > maxWidthMm) {
    const chars = Array.from(rest);
    let n = chars.length;
    while (n > 1 && textWidthMm(chars.slice(0, n).join(''), pt) > maxWidthMm) n--;
    const space = chars.slice(0, n).lastIndexOf(' ');
    const cut = space > 0 ? space : n;
    lines.push(chars.slice(0, cut).join('').trimEnd());
    rest = chars.slice(cut).join('').trimStart();
  }
  lines.push(fitText(rest, maxWidthMm, pt));
  return lines;
}
```

import 는 `import { escapeXml, fitSizePt, fitText, PT_TO_MM, textWidthMm } from '../../../label/svg-text';`.

파일 머리 주석: `/** 한진 운송장 템플릿(NS·NL·FS) 공용 SVG 조각(#913). 좌표·크기는 mm, 글자 크기는 pt. */`

`hanjin-ns-template.ts`: 옮긴 정의를 지우고 `import { hline, koreanDate, rect, shrinkThenFit, svgDocument, text } from './hanjin-label-svg';` 로 바꾼다. `escapeXml`·`PT_TO_MM` import 는 안 쓰게 되면 지운다. `svg` 조립을 다음으로 바꾼다:

```ts
  const svg = svgDocument(WIDTH_MM, HEIGHT_MM, [
    ['left', left],
    ['customer-copy', customerCopy],
    ['delivery-slip', deliverySlip],
  ]);
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label` → 헬퍼 스펙 PASS, **NS 해시 테스트 PASS**(바뀌면 옮기다 뭔가 달라진 것 — 되돌려 다시 옮긴다).

- [ ] **Step 3: 실패하는 테스트 — `terminalName`**

`hanjin-label-data.spec.ts`: `LABEL_DATA` 에 `tml_nam: '중구',` 를 더하고, 「분류필드를 labelData 에서 옮긴다」의 기대 객체에 `terminalName: '중구',` 를 `terminalCode` 다음 줄에 더한다. 「labelData 의 숫자 값은 문자열로, 없는 키는 빈 문자열로」 테스트에 한 줄 더:

```ts
    expect(d.sort.terminalName).toBe('');
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.spec.ts` → FAIL.

- [ ] **Step 4: `terminalName` 구현**

`hanjin-label-data.ts` 의 `HanjinSortFields` 에 `terminalCode` 다음:

```ts
  terminalName: string; // tml_nam — NL 샘플 ② 아래 「중구」(필드표 번호 없음, #920 에서 확인)
```

`buildHanjinLabelData` 의 `sort` 에 `terminalCode` 다음: `terminalName: field('tml_nam'),`

`render.ts` 의 `SAMPLE.sort` 에 `terminalName: '중구',` (terminalCode 다음).

- [ ] **Step 5: 공용 픽스처와 NS 스펙 전환**

`carrier/hanjin/label/__support__/hanjin-label-fixture.ts` 신규:

```ts
import type { HanjinLabelData } from '../hanjin-label-data';

/** 한진 라벨 템플릿 테스트 공용 데이터. 받는분·보낸분 원본 값은 누출 테스트가 «없어야 할 문자열»로 쓴다. */
export const HANJIN_LABEL_FIXTURE: HanjinLabelData = {
  trackingNo: '452716978431',
  trackingNoDisplay: '4527-1697-8431',
  sort: {
    hubCode: 'NX',
    terminalCode: '150',
    terminalName: '중구',
    midCode: 'Z',
    centerCode: '1050',
    centerName: '해운(집)',
    originTerminalCode: '000',
    originTerminalName: '본사',
    routeRank: 'A1',
    courierName: '권순천',
    courierSortCode: '888',
    addressSummary: '소공동 51 한진빌딩',
  },
  regionText: '수도권',
  freightText: '발지신용',
  recipient: {
    name: '김한진',
    phone: '010-1234-5678',
    baseAddress: '서울특별시 중구 남대문로 63',
    detailAddress: '한진빌딩 10층',
  },
  sender: { name: '아몬드영', phone: '032-000-1234', baseAddress: '경기도 부천시 오정구 신흥로511번길 80' },
  deliveryMessage: '문앞 (공동현관 #1234)',
  commodityName: '토익 Speaking 외 1건',
  boxType: 'A',
  custOrdNo: 'AY0123456789ABCDEFGHJKMNPQRS',
  printedDate: '2026-09-28',
  boxIndex: 1,
  boxCount: 1,
};

/** 칸 폭·바코드 quiet zone 을 괴롭히는 최악 데이터 — 자유 텍스트를 전부 칸보다 길게. 코드류는 규격 길이 그대로. */
export const HANJIN_LABEL_LONG_FIXTURE: HanjinLabelData = {
  ...HANJIN_LABEL_FIXTURE,
  sort: {
    ...HANJIN_LABEL_FIXTURE.sort,
    terminalName: '가'.repeat(20),
    centerName: '가'.repeat(20),
    originTerminalName: '가'.repeat(20),
    courierName: '가'.repeat(20),
    addressSummary: '가'.repeat(60),
  },
  recipient: { ...HANJIN_LABEL_FIXTURE.recipient, detailAddress: '가'.repeat(80) },
  deliveryMessage: '가'.repeat(100),
  commodityName: '가'.repeat(100),
};
```

`hanjin-ns-template.spec.ts`: 로컬 `const DATA: HanjinLabelData = {…};` 를 지우고
`import { HANJIN_LABEL_FIXTURE as DATA, HANJIN_LABEL_LONG_FIXTURE } from './__support__/hanjin-label-fixture';` 로 바꾼다(더 안 쓰는 `HanjinLabelData` type import 는 지운다). 값이 같으므로(터미널명만 추가, NS 는 안 씀) 해시 테스트는 그대로 PASS 해야 한다.

- [ ] **Step 6: 실패하는 테스트 — NS 도 긴 데이터에서 금지 구역이 비어야 한다**

Task 1 Step 7 의 NS 금지 구역 테스트를 `it.each` 로 바꾼다:

```ts
  it.each([
    ['기본', DATA],
    ['긴 데이터', HANJIN_LABEL_LONG_FIXTURE],
  ])('%s: 바코드 금지 구역(바코드 + 좌우 quiet zone)은 라벨 안이고 잉크가 없다', (_, data) => {
    const s = renderHanjinNsLabel(data);
    for (const z of barcodeKeepOutsMm(s)) {
      expect(z.x0).toBeGreaterThanOrEqual(0);
      expect(z.x1).toBeLessThanOrEqual(s.widthMm);
      expect(z.y1).toBeLessThanOrEqual(s.heightMm);
    }
    expect(inkInBarcodeKeepOuts(s)).toEqual(s.barcodes.map((b) => ({ kind: b.kind, ink: 0 })));
  });
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-ns-template.spec.ts -t '긴 데이터'`
Expected: FAIL — CODE128 금지 구역에 잉크(계획 작성 시 실측 418 dot). 원인: ⑥ 집배점명(x 42.5 가운데 정렬, 기준선 25)이 길면 왼쪽으로 퍼져 ③ 터미널 바코드(x 4.4~21.4, y 18.3~26.3)의 quiet zone 을 덮는다.

- [ ] **Step 7: NS ⑥ 을 칸 안에 가둔다**

`hanjin-ns-template.ts` 좌측 블록의 ⑥ 줄을 바꾼다:

```ts
    // ⑥ 가운데 정렬이라 길면 양쪽으로 퍼진다 — 왼쪽 끝이 ③ CODE128 quiet zone(x 23.9) 앞에서 멈추게 폭 36mm.
    text({ x: 42.5, y: 25, pt: 9, anchor: 'middle', text: fitText(s.centerName, 36, 9) }), // ⑥
```

(`fitText` import 는 이미 있다.) 실제 집배점명(「해운(집)」)은 36mm 안이라 NS 해시는 그대로다.

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label` → PASS (해시 포함)

- [ ] **Step 8: 검증·커밋**

Run: `npm run type-check` → 0 · `npx jest --maxWorkers=2 apps/core/src/modules/fulfillment/waybill` → PASS

```bash
git add apps/core/src/modules/fulfillment/waybill scripts/ops/hanjin-label-preview/render.ts
git commit -m "refactor(core): 한진 라벨 SVG 헬퍼를 템플릿 공용으로 뽑고 도착지 터미널명을 싣는다 (#913)"
```

---

### Task 3: NL 템플릿 (100 × 102mm, rotation 0)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-nl-template.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-nl-template.spec.ts`

**Interfaces:**
- Consumes: `hanjin-label-svg.ts` 전부, `HANJIN_LABEL_FIXTURE`·`HANJIN_LABEL_LONG_FIXTURE`, `barcodeKeepOutsMm`·`inkInBarcodeKeepOuts`, `maskName`/`maskPhone`/`maskAddress`, `fitSizePt`/`fitText`
- Produces: `renderHanjinNlLabel(d: HanjinLabelData): LabelSpec` (rotation 0), `NL_ITF_X_MM`, `NL_ITF_QUIET_ZONE_MM`, `NL_CUST_ORD_NO_X_MM`, `NL_CUST_ORD_NO_MAX_WIDTH_MM`

좌표 출처: 포털 `https://developers.hanjin.com/files/nl_new.jpg` 를 외곽(가로 583px = 100mm, 세로 595px = 102mm) 비율로 잰 mm. 폰트는 `nl2.jpg` 필드표 pt — 표 크기가 우리 폰트 폭으로 칸을 넘는 ④⑯ 은 `fitSizePt` 로 칸에 맞춘다. 면: 위 = 배달표, 「운송장번호」 줄부터 아래 = 받는고객용. 계획 작성 때 스크래치 시제품으로 금지 구역 잉크 0 을 확인했다.

- [ ] **Step 1: 실패하는 테스트**

`hanjin-nl-template.spec.ts`:

```ts
import { barcodeKeepOutsMm, inkInBarcodeKeepOuts } from '../../../label/__support__/label-invariants';
import { HANJIN_LABEL_FIXTURE as DATA, HANJIN_LABEL_LONG_FIXTURE as LONG } from './__support__/hanjin-label-fixture';
import {
  NL_CUST_ORD_NO_MAX_WIDTH_MM,
  NL_CUST_ORD_NO_X_MM,
  NL_ITF_QUIET_ZONE_MM,
  NL_ITF_X_MM,
  renderHanjinNlLabel,
} from './hanjin-nl-template';

const block = (svg: string, id: string): string => {
  const m = new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`).exec(svg);
  if (!m) throw new Error(`block ${id} not found`);
  return m[1];
};

describe('renderHanjinNlLabel', () => {
  const spec = renderHanjinNlLabel(DATA);

  it('NL 은 가로 100 × 세로 102mm 이고 돌리지 않는다(폭 100mm 가 인쇄폭 108mm 안)', () => {
    expect([spec.widthMm, spec.heightMm, spec.rotation]).toEqual([100, 102, 0]);
    expect(spec.svg).toContain('viewBox="0 0 100 102"');
  });

  it('면 블록은 분류 머리 · 배달표 · 받는고객용 순서', () => {
    expect([...spec.svg.matchAll(/<g id="([^"]+)">/g)].map((m) => m[1])).toEqual([
      'sort-head',
      'delivery-slip',
      'customer-copy',
    ]);
  });

  describe('개인정보 — 배달표', () => {
    const slip = block(spec.svg, 'delivery-slip');
    it('받는분 주소는 원본(기본 + 상세)', () => {
      expect(slip).toContain('서울특별시 중구 남대문로 63 한진빌딩 10층');
    });
    it('받는분 성명·연락처는 가린다', () => {
      expect(slip).not.toContain('김한진');
      expect(slip).not.toContain('010-1234-5678');
      expect(slip).toContain('김*진');
      expect(slip).toContain('010-1234-****');
    });
    it('보낸분 성명·연락처는 원본, 주소는 마스킹(샘플대로 — NS 는 미표기)', () => {
      expect(slip).toContain('아몬드영');
      expect(slip).toContain('032-000-1234');
      expect(slip).toContain('경기도 부천시 오정구 신흥로511번길 80 ****');
    });
  });

  describe('개인정보 — 받는고객용(배달표 외)', () => {
    const copy = block(spec.svg, 'customer-copy');
    it('받는분은 ⑫ 약칭주소만 — 성명·연락처·실제 주소가 없다', () => {
      expect(copy).toContain('소공동 51 한진빌딩');
      for (const s of ['김한진', '김*진', '010-1234', '남대문로', '한진빌딩 10층']) expect(copy).not.toContain(s);
    });
    it('보낸분은 전부 가린다', () => {
      expect(copy).not.toContain('아몬드영');
      expect(copy).not.toContain('032-000-1234');
      expect(copy).toContain('아*드*');
      expect(copy).toContain('032-000-****');
      expect(copy).toContain('경기도 부천시 오정구 신흥로511번길 80 ****');
    });
  });

  it('분류 머리에는 어느 개인정보도 없다', () => {
    const head = block(spec.svg, 'sort-head');
    for (const s of ['김한진', '김*진', '010-1234', '남대문로', '아몬드영', '032-000', '신흥로']) {
      expect(head).not.toContain(s);
    }
  });

  it('라벨 어디에도 받는분 실명·전체 전화번호가 없다', () => {
    expect(spec.svg).not.toContain('김한진');
    expect(spec.svg).not.toContain('010-1234-5678');
  });

  describe('배달표 받는분 주소는 동·호수까지 전체가 찍힌다', () => {
    const cases: Array<[string, string, string]> = [
      ['경기도 부천시 원미구 길주로 17', '현대아파트 101동 1203호', '101동 1203호'],
      ['부산광역시 해운대구 우동 1411', '센텀아파트 101동 1001호', '101동 1001호'],
      ['경기도 성남시 분당구 판교역로 235', '에이치스퀘어 N동 8층 801호', 'N동 8층 801호'],
    ];
    it.each(cases)('%s %s → "%s"', (baseAddress, detailAddress, tail) => {
      const s = renderHanjinNlLabel({ ...DATA, recipient: { ...DATA.recipient, baseAddress, detailAddress } });
      expect(block(s.svg, 'delivery-slip')).toContain(tail);
    });
  });

  it('긴 ⑭ 도 공동현관 비밀번호까지 찍힌다', () => {
    const s = renderHanjinNlLabel({
      ...DATA,
      deliveryMessage: '부재 시 경비실에 맡겨 주세요. 파손 주의 부탁드립니다 (공동현관 #1234)',
    });
    expect(block(s.svg, 'delivery-slip')).toContain('공동현관 #1234');
  });

  it('분류코드·터미널명·운임·권역·출고번호를 찍는다', () => {
    for (const s of [
      'NX',
      '150',
      '중구',
      'Z',
      '888',
      'A1',
      '권순천',
      '1050',
      '해운(집)',
      '발지TML 000 본사',
      '발지신용',
      '수도권',
      '소공동 51 한진빌딩',
      '출력일자 :',
      '2026년 09월 28일',
      '수량: 1',
      '운임Type:A',
      '출고번호: AY0123456789ABCDEFGHJKMNPQRS',
      '4527-1697-8431',
      'P. 1',
      '토익 Speaking 외 1건',
    ]) {
      expect(spec.svg).toContain(s);
    }
  });

  it('바코드는 CODE128(터미널코드)과 ITF(운송장번호) 둘', () => {
    expect(spec.barcodes.map((b) => [b.kind, b.data])).toEqual([
      ['CODE128', '150'],
      ['ITF', '452716978431'],
    ]);
  });

  it('터미널코드가 비면(demo 캐리어) CODE128 을 빼고 ITF 만 둔다', () => {
    const s = renderHanjinNlLabel({ ...DATA, sort: { ...DATA.sort, terminalCode: '' } });
    expect(s.barcodes.map((b) => b.kind)).toEqual(['ITF']);
  });

  it('고객 입력의 XML 특수문자를 이스케이프하고 금지 제어문자는 뺀다', () => {
    const s = renderHanjinNlLabel({ ...DATA, deliveryMessage: '<script>&\u000B', commodityName: 'A&B "펜"' });
    expect(s.svg).not.toContain('<script>');
    expect(s.svg).not.toContain('\u000B');
    expect(s.svg).toContain('&lt;script&gt;&amp;');
    expect(s.svg).toContain('A&amp;B &quot;펜&quot;');
  });

  it('출고번호 칸은 ITF quiet zone 앞에서 끝난다', () => {
    expect(NL_CUST_ORD_NO_X_MM + NL_CUST_ORD_NO_MAX_WIDTH_MM).toBeCloseTo(NL_ITF_X_MM - NL_ITF_QUIET_ZONE_MM, 9);
  });

  it.each([
    ['기본', DATA],
    ['긴 데이터', LONG],
  ])('%s: 바코드 금지 구역(바코드 + 좌우 quiet zone)은 라벨 안이고 잉크가 없다', (_, data) => {
    const s = renderHanjinNlLabel(data);
    for (const z of barcodeKeepOutsMm(s)) {
      expect(z.x0).toBeGreaterThanOrEqual(0);
      expect(z.x1).toBeLessThanOrEqual(s.widthMm);
      expect(z.y1).toBeLessThanOrEqual(s.heightMm);
    }
    expect(inkInBarcodeKeepOuts(s)).toEqual(s.barcodes.map((b) => ({ kind: b.kind, ink: 0 })));
  });

  it('긴 자유 텍스트는 말줄임으로 자른다', () => {
    const s = renderHanjinNlLabel(LONG);
    expect(s.svg).not.toContain('가'.repeat(100));
    expect((s.svg.match(/…/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('모든 텍스트·도형 좌표가 라벨 안에 있다', () => {
    const xs = [...spec.svg.matchAll(/\bx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const ys = [...spec.svg.matchAll(/\by="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(100);
    expect(Math.max(...ys)).toBeLessThanOrEqual(102);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-nl-template.spec.ts` → FAIL (모듈 없음).

- [ ] **Step 2: 구현**

`hanjin-nl-template.ts`:

```ts
import { DOTS_PER_MM, type BarcodePlacement, type LabelSpec } from '../../../label/label-model';
import { fitSizePt, fitText } from '../../../label/svg-text';
import type { HanjinLabelData } from './hanjin-label-data';
import { maskAddress, maskName, maskPhone } from './hanjin-label-masking';
import { koreanDate, rect, shrinkThenFit, svgDocument, text } from './hanjin-label-svg';

/**
 * 한진 NL형(가로 100 × 세로 102mm) 자체출력 운송장(#913).
 *
 * 폭이 100mm 라 프린터(인쇄폭 108mm)에 돌리지 않고 넣는다. 세로 102mm 는 포털에 없어 샘플 외곽 비율로
 * 잡았다(2026-09-28 결정 — 현장 실측이 다르면 HEIGHT_MM 하나만 고친다).
 *
 * **검은색 요소만** 그린다 — 테두리·캡션(「배달표」「받는분」「특기사항」「내품명」「운송장번호」)·로고·
 * 「GENERAL」 은 라벨지에 선인쇄. 좌표는 포털 NL 샘플(nl_new.jpg) 실측 mm, y 는 기준선, 글자 크기는
 * 필드표(nl2.jpg)의 pt. ④⑯ 은 표 크기(35)로는 우리 폰트 폭이 칸을 넘어 칸에 맞춰 줄인다.
 *
 * 면별 마스킹(정본 §3.3):
 *   배달표(위) — 받는분 성명·연락처 마스킹 + 주소 원본 / 보낸분 성명·연락처 원본 + 주소 마스킹
 *   받는고객용(아래, 배달표 외) — 받는분은 ⑫ 약칭주소만 / 보낸분 전부 마스킹
 */

const WIDTH_MM = 100;
const HEIGHT_MM = 102;

const ITF_MODULE_DOTS = 3;
export const NL_ITF_X_MM = 56;
export const NL_ITF_QUIET_ZONE_MM = (10 * ITF_MODULE_DOTS) / DOTS_PER_MM;

/** 출고번호 줄은 ITF 와 같은 높이라 quiet zone 앞에서 멈춘다. 식별자라 자르지 않고 최소 4pt 까지 줄인다. */
export const NL_CUST_ORD_NO_X_MM = 5.1;
export const NL_CUST_ORD_NO_MAX_WIDTH_MM = NL_ITF_X_MM - NL_ITF_QUIET_ZONE_MM - NL_CUST_ORD_NO_X_MM;

export function renderHanjinNlLabel(d: HanjinLabelData): LabelSpec {
  const s = d.sort;
  const rc = d.recipient;
  const sd = d.sender;

  const slipAddress = shrinkThenFit(`${rc.baseAddress} ${rc.detailAddress}`, 89.5, 9); // 배달표 받는분 주소(원본)
  const message = shrinkThenFit(d.deliveryMessage, 84, 9); // ⑭
  const custText = `출고번호: ${d.custOrdNo}`;

  // ── 분류 머리 ───────────────────────────────────────────────────────────
  const sortHead = [
    text({ x: 3.5, y: 14.7, pt: 35, bold: true, text: s.hubCode }), // ①
    text({ x: 23, y: 9.9, pt: 25, bold: true, text: s.terminalCode }), // ②
    text({ x: 31, y: 14.2, pt: 10, bold: true, anchor: 'middle', text: fitText(s.terminalName, 15, 10) }), // 터미널명
    text({ x: 4.5, y: 17.8, pt: 9, bold: true, text: '출력일자 :' }),
    text({ x: 19.5, y: 17.8, pt: 7, bold: true, text: koreanDate(d.printedDate) }),
    text({ x: 61, y: 4.3, pt: 9, bold: true, text: `P. ${d.boxIndex}` }),
    text({ x: 69.5, y: 12.9, pt: fitSizePt(s.midCode, 9.5, 35, 20), bold: true, text: s.midCode }), // ④
    text({ x: 80, y: 12.9, pt: fitSizePt(s.courierSortCode, 19, 35, 20), bold: true, text: s.courierSortCode }), // ⑯
    text({ x: 43.4, y: 17.8, pt: 8, text: s.centerCode }), // ⑤
    text({ x: 55.2, y: 17.8, pt: 8, text: fitText(s.centerName, 14, 8) }), // ⑥
    text({ x: 70, y: 17.8, pt: 8, text: fitText(`발지TML ${s.originTerminalCode} ${s.originTerminalName}`, 29, 8) }), // ⑦⑧
  ];

  // ── 배달표 ─────────────────────────────────────────────────────────────
  const deliverySlip = [
    text({ x: 8.2, y: 22.2, pt: 9, bold: true, text: maskName(rc.name) }),
    text({ x: 98, y: 22.2, pt: 9, bold: true, anchor: 'end', text: maskPhone(rc.phone) }),
    text({ x: 8.2, y: 25.2, pt: slipAddress.pt, text: slipAddress.text }),
    text({ x: 8.2, y: 31.8, pt: 9, bold: true, text: sd.name }),
    text({ x: 98, y: 31.8, pt: 9, bold: true, anchor: 'end', text: sd.phone }),
    text({ x: 8.2, y: 34.8, pt: 9, text: fitText(maskAddress(sd.baseAddress), 89.5, 9) }),
    text({ x: 13.4, y: 41.7, pt: message.pt, text: message.text }), // ⑭
    text({ x: 5.3, y: 48.5, pt: 20, bold: true, text: s.routeRank }), // ⑩
    text({ x: 21, y: 48.5, pt: 20, bold: true, text: fitText(s.courierName, 47, 20) }), // ⑪
    rect(68.7, 43, 16.7, 6.6), // ⑮ 상자
    text({ x: 77.05, y: 47.9, pt: 11, bold: true, anchor: 'middle', text: d.regionText }), // ⑮
    rect(5.1, 50.1, 38.6, 6.2), // ⑬ 상자
    text({ x: 7, y: 55, pt: 14, bold: true, text: d.freightText }), // ⑬
    text({ x: 57.6, y: 60.7, pt: 9, bold: true, text: d.trackingNoDisplay }), // ⑨ 좌측상단(ITF 위)
    text({ x: 5.1, y: 61.4, pt: 10, text: koreanDate(d.printedDate) }),
    text({ x: 5.1, y: 64.6, pt: 10, text: `수량: ${d.boxCount}` }),
    text({ x: 24.2, y: 64.6, pt: 10, text: `운임Type:${d.boxType}` }),
    text({
      x: NL_CUST_ORD_NO_X_MM,
      y: 67.8,
      pt: fitSizePt(custText, NL_CUST_ORD_NO_MAX_WIDTH_MM, 10, 4),
      text: custText,
    }),
  ];

  // ── 받는고객용(배달표 외) ────────────────────────────────────────────────
  const customerCopy = [
    text({ x: 15.3, y: 74.7, pt: 9.5, bold: true, text: d.trackingNoDisplay }), // ⑨ 좌측하단
    text({ x: 44.2, y: 74.7, pt: 9.5, bold: true, text: `P. ${d.boxIndex}` }),
    text({ x: 15.3, y: 79.6, pt: 10, text: fitText(d.commodityName, 82.5, 10) }), // 품명
    text({ x: 8.2, y: 86, pt: 16, bold: true, text: fitText(s.addressSummary, 89.5, 16) }), // ⑫
    text({ x: 8.2, y: 93.1, pt: 9, bold: true, text: maskName(sd.name) }),
    text({ x: 98, y: 93.1, pt: 9, bold: true, anchor: 'end', text: maskPhone(sd.phone) }),
    text({ x: 8.2, y: 96.7, pt: 9, text: fitText(maskAddress(sd.baseAddress), 89.5, 9) }),
  ];

  const barcodes: BarcodePlacement[] = [
    ...(s.terminalCode
      ? [{ kind: 'CODE128' as const, data: s.terminalCode, xMm: 43, yMm: 5, heightMm: 8, moduleDots: 2 }] // ③
      : []),
    {
      kind: 'ITF',
      data: d.trackingNo,
      xMm: NL_ITF_X_MM,
      yMm: 62,
      heightMm: 14.5,
      moduleDots: ITF_MODULE_DOTS,
      wideRatio: 2.5,
    },
  ];

  return {
    widthMm: WIDTH_MM,
    heightMm: HEIGHT_MM,
    rotation: 0,
    svg: svgDocument(WIDTH_MM, HEIGHT_MM, [
      ['sort-head', sortHead],
      ['delivery-slip', deliverySlip],
      ['customer-copy', customerCopy],
    ]),
    barcodes,
  };
}
```

- [ ] **Step 3: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-nl-template.spec.ts` → PASS.
금지 구역 테스트가 실패하면 **좌표를 움직이지 말고 실패 메시지(어느 바코드·잉크 수)와 함께 보고한다** — 좌표는 샘플 실측이라 어긋나면 원인이 다른 데 있다.

- [ ] **Step 4: 눈으로 확인 (커밋하지 않는 산출물)**

```bash
npx tsx -e "
const { writeFileSync } = require('fs');
const { join } = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { renderHanjinNlLabel } = require('./apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-nl-template');
const { HANJIN_LABEL_FIXTURE } = require('./apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/__support__/hanjin-label-fixture');
const { LABEL_FONT_FILES, resolveLabelFontDir } = require('./apps/core/src/modules/fulfillment/waybill/label/svg-rasterizer');
const s = renderHanjinNlLabel(HANJIN_LABEL_FIXTURE);
const dir = resolveLabelFontDir();
writeFileSync('/tmp/nl-check.png', new Resvg(s.svg, { background: 'white', fitTo: { mode: 'width', value: 800 }, font: { loadSystemFonts: false, fontFiles: LABEL_FONT_FILES.map((f) => join(dir, f)), defaultFontFamily: 'NanumGothic' } }).render().asPng());
"
```

`/tmp/nl-check.png` 를 열어 글자끼리 겹치는 곳이 없는지 본다(포털 `nl_new.jpg` 와 배치 비교). 겹치면 보고한다.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-nl-template.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-nl-template.spec.ts
git commit -m "feat(core): 한진 NL형 운송장 템플릿 (#913)"
```

---

### Task 4: FS 템플릿 (123 × 100mm, rotation 90)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.spec.ts`

**Interfaces:**
- Consumes: Task 3 과 같음
- Produces: `renderHanjinFsLabel(d: HanjinLabelData): LabelSpec` (rotation 90), `FS_ITF_X_MM`, `FS_ITF_QUIET_ZONE_MM`, `FS_CUST_ORD_NO_MAX_WIDTH_MM`

좌표 출처: 포털 `fs_new.jpg`(2025년 판 — 서버에만 남은 옛 `fs.jpg` 는 쓰지 않는다) 외곽(410.5px = 123mm, 327px = 100mm) 비율, 폰트 `fs2.jpg`. **라벨 전체가 배달표 한 면**이라 받는고객용이 없다. ⑯ 은 표 35pt 면 ⑨ 아래 선인쇄 선을 넘어 샘플 크기(20pt)로 둔다. 샘플과 두 군데 다르다(계획 작성 때 시제품 실측): ① 샘플은 보낸분 줄 오른쪽에 출력일자를 두는데, 그러면 보낸분 줄(성명 / 연락처 / 마스킹 주소)이 7pt 로도 안 들어가 잘린다 → 출력일자를 한 줄 아래 출고번호 줄 왼쪽으로 옮긴다. ② ⑭ 는 ITF 옆 63mm 칸이라 한 줄이면 공동현관 비밀번호가 잘린다 → 최대 두 줄(`wrapLines`).

- [ ] **Step 1: 실패하는 테스트**

`hanjin-fs-template.spec.ts`:

```ts
import { barcodeKeepOutsMm, inkInBarcodeKeepOuts } from '../../../label/__support__/label-invariants';
import { HANJIN_LABEL_FIXTURE as DATA, HANJIN_LABEL_LONG_FIXTURE as LONG } from './__support__/hanjin-label-fixture';
import { renderHanjinFsLabel } from './hanjin-fs-template';

const block = (svg: string, id: string): string => {
  const m = new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`).exec(svg);
  if (!m) throw new Error(`block ${id} not found`);
  return m[1];
};

describe('renderHanjinFsLabel', () => {
  const spec = renderHanjinFsLabel(DATA);

  it('FS 는 가로 123 × 세로 100mm, 90° 돌려 짧은 변(100mm)을 폭으로 넣는다', () => {
    expect([spec.widthMm, spec.heightMm, spec.rotation]).toEqual([123, 100, 90]);
    expect(spec.svg).toContain('viewBox="0 0 123 100"');
  });

  it('라벨 전체가 배달표 한 면이다', () => {
    expect([...spec.svg.matchAll(/<g id="([^"]+)">/g)].map((m) => m[1])).toEqual(['delivery-slip']);
  });

  describe('개인정보 — 배달표', () => {
    const slip = block(spec.svg, 'delivery-slip');
    it('받는분 주소는 원본(기본 + 상세)', () => {
      expect(slip).toContain('서울특별시 중구 남대문로 63 한진빌딩 10층');
    });
    it('받는분 성명·연락처는 가린다', () => {
      expect(slip).not.toContain('김한진');
      expect(slip).not.toContain('010-1234-5678');
      expect(slip).toContain('김*진');
      expect(slip).toContain('010-1234-****');
    });
    it('보낸분 성명·연락처는 원본, 주소는 마스킹', () => {
      expect(slip).toContain('아몬드영 / 032-000-1234 / 경기도 부천시 오정구 신흥로511번길 80 ****');
    });
  });

  describe('배달표 받는분 주소는 동·호수까지 전체가 찍힌다', () => {
    const cases: Array<[string, string, string]> = [
      ['경기도 부천시 원미구 길주로 17', '현대아파트 101동 1203호', '101동 1203호'],
      ['부산광역시 해운대구 우동 1411', '센텀아파트 101동 1001호', '101동 1001호'],
      ['경기도 성남시 분당구 판교역로 235', '에이치스퀘어 N동 8층 801호', 'N동 8층 801호'],
    ];
    it.each(cases)('%s %s → "%s"', (baseAddress, detailAddress, tail) => {
      const s = renderHanjinFsLabel({ ...DATA, recipient: { ...DATA.recipient, baseAddress, detailAddress } });
      expect(s.svg).toContain(tail);
    });
  });

  it('긴 ⑭ 는 두 줄로 나눠 공동현관 비밀번호까지 잃지 않는다', () => {
    const msg = '부재 시 경비실에 맡겨 주세요. 파손 주의 (공동현관 #1234)';
    const s = renderHanjinFsLabel({ ...DATA, deliveryMessage: msg });
    const lines = [...s.svg.matchAll(/<text x="8.8" [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe(msg);
  });

  it('짧은 ⑭ 는 샘플 자리(기준선 93.7) 한 줄', () => {
    expect(spec.svg).toContain('<text x="8.8" y="93.7" font-size="3.18">문앞 (공동현관 #1234)</text>');
  });

  it('분류코드·운임·권역·출고번호를 찍는다', () => {
    for (const s of [
      'NX',
      '150',
      'Z',
      '888',
      'A1',
      '권순천',
      '1050',
      '해운(집)',
      '발지:000 본사',
      '발지신용',
      '수도권',
      '소공동 51 한진빌딩',
      '2026-09-28 Type : A',
      '운임Type : A',
      '출고번호: AY0123456789ABCDEFGHJKMNPQRS',
      '4527-1697-8431',
      '토익 Speaking 외 1건',
    ]) {
      expect(spec.svg).toContain(s);
    }
  });

  it('바코드는 CODE128(터미널코드)과 ITF(운송장번호) 둘', () => {
    expect(spec.barcodes.map((b) => [b.kind, b.data])).toEqual([
      ['CODE128', '150'],
      ['ITF', '452716978431'],
    ]);
  });

  it('터미널코드가 비면(demo 캐리어) CODE128 을 빼고 ITF 만 둔다', () => {
    const s = renderHanjinFsLabel({ ...DATA, sort: { ...DATA.sort, terminalCode: '' } });
    expect(s.barcodes.map((b) => b.kind)).toEqual(['ITF']);
  });

  it('고객 입력의 XML 특수문자를 이스케이프하고 금지 제어문자는 뺀다', () => {
    const s = renderHanjinFsLabel({ ...DATA, deliveryMessage: '<script>&\u000B', commodityName: 'A&B "펜"' });
    expect(s.svg).not.toContain('<script>');
    expect(s.svg).not.toContain('\u000B');
    expect(s.svg).toContain('&lt;script&gt;&amp;');
    expect(s.svg).toContain('A&amp;B &quot;펜&quot;');
  });

  it.each([
    ['기본', DATA],
    ['긴 데이터', LONG],
  ])('%s: 바코드 금지 구역(바코드 + 좌우 quiet zone)은 라벨 안이고 잉크가 없다', (_, data) => {
    const s = renderHanjinFsLabel(data);
    for (const z of barcodeKeepOutsMm(s)) {
      expect(z.x0).toBeGreaterThanOrEqual(0);
      expect(z.x1).toBeLessThanOrEqual(s.widthMm);
      expect(z.y1).toBeLessThanOrEqual(s.heightMm);
    }
    expect(inkInBarcodeKeepOuts(s)).toEqual(s.barcodes.map((b) => ({ kind: b.kind, ink: 0 })));
  });

  it('긴 자유 텍스트는 말줄임으로 자른다', () => {
    const s = renderHanjinFsLabel(LONG);
    expect(s.svg).not.toContain('가'.repeat(100));
    expect((s.svg.match(/…/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('모든 텍스트·도형 좌표가 라벨 안에 있다', () => {
    const xs = [...spec.svg.matchAll(/\bx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const ys = [...spec.svg.matchAll(/\by="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(123);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.spec.ts` → FAIL (모듈 없음).

- [ ] **Step 2: 구현**

`hanjin-fs-template.ts`:

```ts
import { DOTS_PER_MM, type BarcodePlacement, type LabelSpec } from '../../../label/label-model';
import { fitSizePt, fitText } from '../../../label/svg-text';
import type { HanjinLabelData } from './hanjin-label-data';
import { maskAddress, maskName, maskPhone } from './hanjin-label-masking';
import { rect, shrinkThenFit, svgDocument, text, wrapLines } from './hanjin-label-svg';

/**
 * 한진 FS형(가로 123 × 세로 100mm) 자체출력 운송장(#913).
 *
 * 가로 123mm 가 인쇄폭(108mm)을 넘어 90° 돌려 짧은 변(100mm)을 폭으로 넣는다. **라벨 전체가 배달표 한 면**
 * 이라 받는고객용이 없다(포털 샘플 좌측 「배달표」 100mm 표시).
 *
 * **검은색 요소만** 그린다 — 테두리·캡션·로고·「※ 개인정보 보호를…」 안내문은 선인쇄. 좌표는 포털 FS 샘플
 * (fs_new.jpg) 실측 mm, y 는 기준선, 글자 크기는 필드표(fs2.jpg)의 pt. ⑯ 은 표 35pt 면 ⑨ 아래 선인쇄 선을
 * 넘어 샘플 크기(20pt)로 둔다. 샘플 ITF 위의 회색 「테스트」는 워터마크라 그리지 않는다.
 *
 * 샘플과 다른 곳 둘: 출력일자는 샘플의 보낸분 줄 오른쪽이 아니라 출고번호 줄 왼쪽에 둔다(보낸분 줄이
 * 7pt 로도 안 들어가 잘렸다). ⑭ 는 ITF 옆 좁은 칸이라 최대 두 줄로 나눈다.
 *
 * 마스킹(정본 §3.3 배달표): 받는분 성명·연락처 마스킹 + 주소 원본 / 보낸분 성명·연락처 원본 + 주소 마스킹.
 */

const WIDTH_MM = 123;
const HEIGHT_MM = 100;

const ITF_MODULE_DOTS = 3;
export const FS_ITF_X_MM = 76;
export const FS_ITF_QUIET_ZONE_MM = (10 * ITF_MODULE_DOTS) / DOTS_PER_MM;

const CODE128_MODULE_DOTS = 2;
const CODE128_X_MM = 94;
const CODE128_QUIET_ZONE_MM = (10 * CODE128_MODULE_DOTS) / DOTS_PER_MM;

/** 받는분 칸(주소·⑫)은 ③ 터미널 바코드의 quiet zone 앞에서 멈춘다. */
const RECIPIENT_X_MM = 7.8;
const RECIPIENT_MAX_WIDTH_MM = CODE128_X_MM - CODE128_QUIET_ZONE_MM - RECIPIENT_X_MM - 0.5;

/** ⑭ 는 ITF 와 같은 높이라 quiet zone 앞에서 멈춘다. */
const MESSAGE_X_MM = 8.8;
const MESSAGE_MAX_WIDTH_MM = FS_ITF_X_MM - FS_ITF_QUIET_ZONE_MM - MESSAGE_X_MM - 0.5;

/** 출고번호는 오른쪽 끝(x 119)에 붙이고 같은 줄 왼쪽의 출력일자(~x 40) 앞에서 멈춘다. 식별자라 자르지 않고 최소 4pt 까지 줄인다. */
export const FS_CUST_ORD_NO_MAX_WIDTH_MM = 75;

export function renderHanjinFsLabel(d: HanjinLabelData): LabelSpec {
  const s = d.sort;
  const rc = d.recipient;
  const sd = d.sender;

  const address = shrinkThenFit(`${rc.baseAddress} ${rc.detailAddress}`, RECIPIENT_MAX_WIDTH_MM, 10);
  const messageLines = wrapLines(d.deliveryMessage, MESSAGE_MAX_WIDTH_MM, 9, 2); // ⑭
  const messageY = messageLines.length === 1 ? [93.7] : [89.5, 93.7];
  const senderLine = shrinkThenFit(`${sd.name} / ${sd.phone} / ${maskAddress(sd.baseAddress)}`, 111, 9);
  const custText = `출고번호: ${d.custOrdNo}`;

  const slip = [
    // ── 머리: 운송장번호 + 분류 ──
    text({ x: 15.3, y: 7.3, pt: 8, bold: true, text: d.trackingNoDisplay }), // ⑨ 좌측상단
    text({ x: 5, y: 19.4, pt: 35, bold: true, text: s.hubCode }), // ①
    text({ x: 24.5, y: 19.4, pt: 25, bold: true, text: s.terminalCode }), // ②
    text({ x: 42.5, y: 19.4, pt: fitSizePt(s.midCode, 9.5, 35, 20), bold: true, text: s.midCode }), // ④
    text({ x: 5.8, y: 22.6, pt: 8, text: fitText(`발지:${s.originTerminalCode} ${s.originTerminalName}`, 35, 8) }), // ⑦⑧
    text({ x: 57.8, y: 13.5, pt: fitSizePt(s.courierSortCode, 18, 20, 12), bold: true, text: s.courierSortCode }), // ⑯
    text({ x: 78, y: 13.5, pt: 20, bold: true, text: s.routeRank }), // ⑩
    text({ x: 52.8, y: 23.9, pt: 20, bold: true, text: fitText(s.courierName, 24, 20) }), // ⑪
    text({ x: 78, y: 19.4, pt: 8, text: s.centerCode }), // ⑤
    text({ x: 78, y: 23.1, pt: 8, text: fitText(s.centerName, 19, 8) }), // ⑥
    rect(98.5, 17, 20.5, 6.4), // ⑮ 상자
    text({ x: 108.75, y: 22, pt: 11, bold: true, anchor: 'middle', text: d.regionText }), // ⑮
    // ── 받는분 ──
    text({ x: RECIPIENT_X_MM, y: 27.7, pt: 10, text: maskName(rc.name) }),
    text({ x: 35.1, y: 27.7, pt: 10, text: maskPhone(rc.phone) }),
    text({ x: RECIPIENT_X_MM, y: 31.3, pt: address.pt, text: address.text }),
    text({ x: RECIPIENT_X_MM, y: 39.4, pt: 19, bold: true, text: fitText(s.addressSummary, RECIPIENT_MAX_WIDTH_MM, 19) }), // ⑫
    rect(91.5, 36.7, 27.3, 6.4), // ⑬ 상자
    text({ x: 105.15, y: 41.8, pt: 14, bold: true, anchor: 'middle', text: d.freightText }), // ⑬
    // ── 보낸분 · 출력일자 · 출고번호 ──
    text({ x: RECIPIENT_X_MM, y: 47.4, pt: senderLine.pt, text: senderLine.text }),
    text({ x: RECIPIENT_X_MM, y: 51.2, pt: 8, text: `${d.printedDate} Type : ${d.boxType}` }),
    text({
      x: 119,
      y: 51.2,
      pt: fitSizePt(custText, FS_CUST_ORD_NO_MAX_WIDTH_MM, 10, 4),
      anchor: 'end',
      text: custText,
    }),
    // ── 본문 · 하단 ──
    text({ x: 4.5, y: 56.8, pt: 12, bold: true, text: fitText(d.commodityName, 114, 12) }), // 품명
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
    rotation: 90,
    svg: svgDocument(WIDTH_MM, HEIGHT_MM, [['delivery-slip', slip]]),
    barcodes,
  };
}
```

- [ ] **Step 3: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.spec.ts` → PASS.
금지 구역 테스트가 실패하면 좌표를 움직이지 말고 실패 메시지와 함께 보고한다.

- [ ] **Step 4: 눈으로 확인** — Task 3 Step 4 의 명령에서 `hanjin-nl-template`→`hanjin-fs-template`, `renderHanjinNlLabel`→`renderHanjinFsLabel`, `value: 800`→`value: 984`, `/tmp/nl-check.png`→`/tmp/fs-check.png` 로 바꿔 실행하고, 포털 `fs_new.jpg` 와 배치를 비교한다. 겹치면 보고한다.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.spec.ts
git commit -m "feat(core): 한진 FS형 운송장 템플릿 (#913)"
```

---

### Task 5: 형 레지스트리 · `HANJIN_LABEL_TYPE` · 매니저 배선

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-templates.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-templates.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config.ts`, `hanjin.config.spec.ts`
- Modify: `apps/core/src/config/env.validation.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill-label.manager.ts`
- Modify (픽스처에 `labelType: 'NS'`): `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.integration.spec.ts`, `…/services/outbound-v2-lifecycle-scenarios.integration.spec.ts`, `…/services/outbound-v2-warehouse-scenarios.integration.spec.ts`, `…/waybill/waybill-label.manager.integration.spec.ts`, `…/waybill/waybill.manager.integration.spec.ts`, `…/waybill/waybill-request.assembler.spec.ts`, `…/waybill/carrier/hanjin/hanjin-api.client.spec.ts`, `…/waybill/carrier/hanjin/hanjin-carrier.gateway.spec.ts`(두 곳), `…/waybill/carrier/hanjin/label/hanjin-label-data.spec.ts` — 목록은 `npm run type-check` 가 정본이다

**Interfaces:**
- Consumes: `renderHanjinNsLabel`, `renderHanjinNlLabel`, `renderHanjinFsLabel`, `PRINTER_MAX_WIDTH_MM`
- Produces:
  - `HANJIN_LABEL_TYPES = ['NS', 'NL', 'FS'] as const` · `type HanjinLabelType`
  - `HANJIN_LABEL_TEMPLATES: Readonly<Record<HanjinLabelType, (d: HanjinLabelData) => LabelSpec>>`
  - `renderHanjinLabel(type: string, d: HanjinLabelData): LabelSpec`
  - `HanjinConfig.labelType: string`

- [ ] **Step 1: 실패하는 테스트 — 레지스트리**

`hanjin-label-templates.spec.ts`:

```ts
import { PRINTER_MAX_WIDTH_MM } from '../../../label/label-model';
import { HANJIN_LABEL_FIXTURE as DATA } from './__support__/hanjin-label-fixture';
import { HANJIN_LABEL_TEMPLATES, HANJIN_LABEL_TYPES, renderHanjinLabel } from './hanjin-label-templates';

describe('hanjin-label-templates', () => {
  it('세 형이 모두 등록돼 있다', () => {
    expect([...HANJIN_LABEL_TYPES]).toEqual(['NS', 'NL', 'FS']);
    expect(Object.keys(HANJIN_LABEL_TEMPLATES).sort()).toEqual(['FS', 'NL', 'NS']);
  });

  it.each([
    ['NS', 200, 102, 90],
    ['NL', 100, 102, 0],
    ['FS', 123, 100, 90],
  ] as const)('%s: %d × %dmm, rotation %d', (type, w, h, rotation) => {
    const spec = renderHanjinLabel(type, DATA);
    expect([spec.widthMm, spec.heightMm, spec.rotation]).toEqual([w, h, rotation]);
  });

  it.each(HANJIN_LABEL_TYPES)('%s: 프린터에 넣는 방향의 폭이 108mm 이하다', (type) => {
    const spec = renderHanjinLabel(type, DATA);
    const fedWidthMm = spec.rotation === 90 ? spec.heightMm : spec.widthMm;
    expect(fedWidthMm).toBeLessThanOrEqual(PRINTER_MAX_WIDTH_MM);
  });

  it('모르는 형은 설정 오류로 던진다 — 값과 허용값을 메시지에 적는다', () => {
    expect(() => renderHanjinLabel('XX', DATA)).toThrow('unknown HANJIN_LABEL_TYPE "XX" (expected NS|NL|FS)');
  });

  it('Object.prototype 의 키(constructor 등)도 모르는 형이다', () => {
    expect(() => renderHanjinLabel('constructor', DATA)).toThrow(/unknown HANJIN_LABEL_TYPE/);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-templates.spec.ts` → FAIL.

- [ ] **Step 2: 레지스트리 구현**

`hanjin-label-templates.ts`:

```ts
import type { LabelSpec } from '../../../label/label-model';
import type { HanjinLabelData } from './hanjin-label-data';
import { renderHanjinFsLabel } from './hanjin-fs-template';
import { renderHanjinNlLabel } from './hanjin-nl-template';
import { renderHanjinNsLabel } from './hanjin-ns-template';

/**
 * 한진 운송장 형 → 템플릿(#913). 어느 형을 쓸지는 한진 계약·라벨지가 정하는 설정이라 env
 * `HANJIN_LABEL_TYPE` 으로 고른다(스펙 2026-09-28 §2).
 */
export const HANJIN_LABEL_TYPES = ['NS', 'NL', 'FS'] as const;
export type HanjinLabelType = (typeof HANJIN_LABEL_TYPES)[number];

export const HANJIN_LABEL_TEMPLATES: Readonly<Record<HanjinLabelType, (d: HanjinLabelData) => LabelSpec>> = {
  NS: renderHanjinNsLabel,
  NL: renderHanjinNlLabel,
  FS: renderHanjinFsLabel,
};

function isHanjinLabelType(v: string): v is HanjinLabelType {
  return (HANJIN_LABEL_TYPES as readonly string[]).includes(v);
}

/**
 * 설정값으로 템플릿을 골라 그린다. 모르는 값은 설정 오류라 `Error`(500) — 요청을 바꿔서 풀리는 문제가
 * 아니다. 검증을 부팅이 아니라 여기서 하는 건 라벨 설정 하나로 core 기동·발급을 막지 않기 위해서다.
 */
export function renderHanjinLabel(type: string, d: HanjinLabelData): LabelSpec {
  if (!isHanjinLabelType(type)) {
    throw new Error(`Hanjin label: unknown HANJIN_LABEL_TYPE "${type}" (expected ${HANJIN_LABEL_TYPES.join('|')})`);
  }
  return HANJIN_LABEL_TEMPLATES[type](d);
}
```

Run: 같은 명령 → PASS.

- [ ] **Step 3: 실패하는 테스트 — config**

`hanjin.config.spec.ts` 의 `describe('hanjin.config', …)` 안 끝에 추가:

```ts
  describe('labelType (HANJIN_LABEL_TYPE)', () => {
    it('없으면 NS', () => {
      expect(configWith().labelType).toBe('NS');
    });
    it('공백뿐이면 NS', () => {
      expect(configWith({ HANJIN_LABEL_TYPE: '  ' }).labelType).toBe('NS');
    });
    it('앞뒤 공백을 걷고 대문자로 맞춘다', () => {
      expect(configWith({ HANJIN_LABEL_TYPE: ' nl ' }).labelType).toBe('NL');
    });
    it('모르는 값도 로드는 한다 — 발급 게이트는 라벨 형을 보지 않는다(검증은 라벨 렌더 때)', () => {
      const c = configWith({ HANJIN_LABEL_TYPE: 'XX' });
      expect(c.labelType).toBe('XX');
      expect(isHanjinConfigured(c)).toBe(true);
      expect(missingHanjinConfig(c)).toEqual([]);
    });
  });
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config.spec.ts` → FAIL.

- [ ] **Step 4: config 구현**

`hanjin.config.ts`: `HanjinConfig` 의 `payType: string;` 다음에

```ts
  /** 운송장 형(NS|NL|FS). 검증은 라벨 렌더 때(hanjin-label-templates) — 발급과 무관하다. */
  labelType: string;
```

`loadHanjinConfig` 반환의 `payType` 다음에

```ts
    labelType: env.HANJIN_LABEL_TYPE?.trim().toUpperCase() || 'NS',
```

`missingHanjinConfig` 는 건드리지 않는다.

`apps/core/src/config/env.validation.ts` 의 `HANJIN_PAY_TYPE: z.string().optional(),` 다음 줄:

```ts
    // 운송장 형 NS|NL|FS(기본 NS). 모르는 값이어도 부팅은 한다 — 라벨 요청만 500(hanjin-label-templates).
    HANJIN_LABEL_TYPE: z.string().optional(),
```

Run: `npm run type-check` → `labelType` 이 없는 `HanjinConfig` 픽스처 에러가 난다. 에러가 가리키는 **모든** 객체 리터럴에 `payType: …,` 다음 줄로 `labelType: 'NS',` 를 넣는다. 다시 돌려 0.

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config.spec.ts` → PASS.

- [ ] **Step 5: 매니저 배선**

`waybill-label.manager.ts`:
- `import { renderHanjinNsLabel } from './carrier/hanjin/label/hanjin-ns-template';` → `import { renderHanjinLabel } from './carrier/hanjin/label/hanjin-label-templates';`
- `render` 안:

```ts
    const spec = renderHanjinLabel(
      this.config.labelType,
      buildHanjinLabelData({ waybill, ctx, config: this.config, now: this.now() }),
    );
```

- 클래스 주석 첫 줄을 `한진 자체출력 운송장 ZPL(#913). 형(NS·NL·FS)은 HANJIN_LABEL_TYPE 이 정한다.` 로.

- [ ] **Step 6: 검증·커밋**

Run: `npm run type-check` → 0
Run: `npx jest --maxWorkers=2 apps/core/src/modules/fulfillment` → PASS (DB 통합 스펙은 기본 skip)

```bash
git add apps/core/src
git commit -m "feat(core): HANJIN_LABEL_TYPE 으로 한진 운송장 형(NS·NL·FS)을 고른다 (#913)"
```

---

### Task 6: 현장 키트 · 저장소 문서 정정

**Files:**
- Modify: `scripts/ops/hanjin-label-preview/render.ts`
- Create: `scripts/ops/hanjin-label-preview/README.md`
- Modify: `docs/hanjin-api-integration-reference.md` (§3.1 표)
- Modify: `docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md` (§11)

**Interfaces:**
- Consumes: `HANJIN_LABEL_TYPES`, `HANJIN_LABEL_TEMPLATES`, `barcodeWidthMm`, `encodeZpl(…, { compress, rotation })`

- [ ] **Step 1: render.ts 를 세 형으로**

파일 머리 주석을 바꾼다:

```ts
/**
 * 한진 운송장 미리보기·현장 키트(#913). 합성 데이터로 NS·NL·FS 세 형의 PNG 와 ZPL 을 만든다.
 * PNG 는 포털 샘플(https://developers.hanjin.com/printwbl 「운송장 출력 Sample」)과 나란히 놓고 위치를
 * 비교하는 용도(템플릿 방향, 빨간 테두리 = 바코드 자리), ZPL 은 창고 프린터로 보내는 용도(프린터 방향).
 * 창고에서 보내는 법은 같은 폴더 README.md.
 *
 *   npx tsx scripts/ops/hanjin-label-preview/render.ts <출력 디렉터리>
 */
```

import 를 정리한다: `renderHanjinNsLabel` import 를 지우고
`import { HANJIN_LABEL_TEMPLATES, HANJIN_LABEL_TYPES } from '../../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-templates';` 를 더한다.
`withBarcodeOverlay`·`SAMPLE`·`outDir` 처리까지는 그대로 두고, 그 아래(`const spec = renderHanjinNsLabel(SAMPLE);` 부터 끝까지)를 다음으로 바꾼다:

```ts
const fontDir = resolveLabelFontDir();
const rasterizer = new SvgRasterizer();

for (const type of HANJIN_LABEL_TYPES) {
  const spec = HANJIN_LABEL_TEMPLATES[type](SAMPLE);
  const name = `hanjin-${type.toLowerCase()}-preview`;

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
  writeFileSync(join(outDir, `${name}.png`), png);

  const bitmap = rasterizer.rasterize(spec.svg, mmToDots(spec.widthMm));
  const zpl = (compress: boolean) => encodeZpl(bitmap, spec.barcodes, { compress, rotation: spec.rotation });
  writeFileSync(join(outDir, `${name}.zpl`), zpl(false));
  writeFileSync(join(outDir, `${name}.compressed.zpl`), zpl(true));
  console.log(`wrote ${outDir}/${name}.{png,zpl,compressed.zpl}  (${spec.widthMm}×${spec.heightMm}mm, rotation ${spec.rotation})`);
}
```

Run: `npx tsx scripts/ops/hanjin-label-preview/render.ts /tmp/kit && ls /tmp/kit`
Expected: 9개 파일(`hanjin-{ns,nl,fs}-preview.{png,zpl,compressed.zpl}`). `head -3 /tmp/kit/hanjin-nl-preview.zpl` → `^XA` `^PW800` `^LL816`. FS → `^PW800` `^LL984`. NS → `^PW816` `^LL1600`.

- [ ] **Step 2: README (현장 키트)**

`scripts/ops/hanjin-label-preview/README.md` 신규 — 아래 내용 그대로:

````markdown
# 한진 운송장 현장 키트 (#913)

한진 라벨지 위에 NS·NL·FS 세 형을 찍어 보고 **우리 라벨지가 어느 형인지**, 글자가 선인쇄 칸에 맞는지,
바코드가 읽히는지 판정한다. 합성 데이터라 개인정보는 없다.

## 1. 만든다 (개발 PC)

```bash
npx tsx scripts/ops/hanjin-label-preview/render.ts ./hanjin-kit
```

`hanjin-{ns,nl,fs}-preview.{png,zpl,compressed.zpl}` 9개가 나온다.

| 형 | 라벨 | 프린터에 넣는 방향 |
| --- | --- | --- |
| NS | 가로 200 × 세로 102mm | 90° 돌려 폭 102mm |
| NL | 가로 100 × 세로 102mm(샘플 비율 추정) | 그대로 폭 100mm |
| FS | 가로 123 × 세로 100mm | 90° 돌려 폭 100mm |

PNG 는 포털 [운송장 출력 Sample](https://developers.hanjin.com/printwbl) 과 나란히 놓고 보는 미리보기다
(빨간 테두리 = 바코드 자리). 폴더를 USB 등으로 창고 PC 에 옮긴다.

## 2. 프린터 준비 (창고 PC · XP-DT108B)

- 프린터가 **ZPL 로 동작**해야 한다(이 모델은 TSPL/ZPL/EPL/DPL 에뮬레이션). 명령어 언어 설정이
  자동 감지가 아니면 Xprinter 설정 도구에서 ZPL 로.
- 라벨지를 넣고 갭(용지 길이) 캘리브레이션을 한다.

## 3. 보낸다

⚠️ **warehouse-app 진단 화면으로는 이 파일을 못 보낸다** — 진단 화면은 앱에 내장된 테스트 라벨만 찍고
파일을 보내는 기능이 없다.

Windows 에서 프린터를 공유하고 파일을 공유 경로로 그대로 복사한다:

1. 설정 → 프린터 → XP-DT108B → 프린터 속성 → **공유** → 「이 프린터 공유」, 공유 이름 `XP108`
2. 키트 폴더에서 `cmd` 를 열고:

   ```bat
   copy /b hanjin-nl-preview.zpl \\localhost\XP108
   ```

SMB 공유로 들어간 작업은 RAW 로 스풀돼 드라이버 렌더링을 거치지 않는다 — warehouse-app 이 실제 인쇄에
쓰는 경로(Windows 스풀러 RAW)와 같다. **2026-09-28 기준 이 방법은 창고에서 아직 검증되지 않았다.**

안 나올 때:

| 증상 | 볼 것 |
| --- | --- |
| `copy` 가 경로를 못 찾음 | 공유 이름 오타 — `net view \\localhost` 로 확인 |
| 아무것도 안 나옴 | 프린터 대기열(스풀러)에 작업이 걸려 있는지. 오류 상태면 지우고 프린터 전원 재시작 |
| `^XA^PW…` 같은 글자가 종이에 찍힘 | 프린터가 ZPL 이 아니다 → 2번 |
| 반쯤만 나오고 잘림 | 용지 길이 감지 — 캘리브레이션 다시 |

## 4. 확인한다

형마다 `.zpl` 을 한 장씩 찍어 라벨지 선인쇄 칸과 대본다.

- [ ] **어느 형의 칸에 글자가 맞아 들어가는가** — 이게 우리 라벨지의 형이다
- [ ] NL: 글자가 옆으로 누워 나오면 롤이 102mm 폭으로 감긴 것 → NL 을 90° 돌려야 한다(core `rotation`)
- [ ] NL: 라벨 실측 세로 길이 — 102mm 로 가정했다
- [ ] ITF(운송장번호)·CODE128(도착지 터미널) 이 스캐너로 읽힌다
- [ ] 한글이 판독된다 · 출고번호(작은 글자)가 읽힌다
- [ ] 배달표 받는분 주소가 동·호수까지 찍힌다
- [ ] `*.compressed.zpl` 도 같은 결과다(같으면 core 압축 기본값을 켠다)
- [ ] 칸이 전체적으로 한쪽으로 밀리면 먼저 프린터 자체 오프셋으로 맞춘다

## 5. 결과를 남긴다

#913 에 코멘트: 라벨지 형, 사진(개인정보 없음 — 합성 데이터), 위 체크리스트 결과.
형이 NS 가 아니면 운영 Core 에 `HANJIN_LABEL_TYPE=NL`(또는 `FS`)을 넣어야 한다 — `HANJIN_*` env 배선과
함께 배포한다.
````

- [ ] **Step 3: 정본 §3.1**

`docs/hanjin-api-integration-reference.md` §3.1 표의 `| NS형 규격 | … |` 행 다음에 두 행을 더한다:

```markdown
| NL형 규격 | 가로 100mm × 세로 **미기재**(샘플 비율 ≈ 102mm). 위 = 배달표, 아래 = 받는고객용(받는분은 ⑫ 약칭주소만) |
| FS형 규격 | 가로 123mm × 세로 100mm. **전체가 배달표 한 면**(받는고객용 없음) |
```

표 아래 문단 끝에 한 줄: `NL·FS 의 필드별 폰트 크기는 NS(§3.2)와 다르다 — 포털 「운송장 출력 Sample」의 형별 필드표를 본다(복사하지 않음). 우리 템플릿: \`apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-{ns,nl,fs}-template.ts\`, 형 선택은 \`HANJIN_LABEL_TYPE\`.`

- [ ] **Step 4: NS 스펙 §11**

`docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md` §11 의 `NL/FS 템플릿 ·` 을 지우고 §11 끝에 한 줄: `NL·FS 템플릿과 형 선택은 \`docs/superpowers/specs/2026-09-28-hanjin-nl-fs-label-templates-design.md\` 로 구현됐다.` 상단 `상태:` 줄은 건드리지 않는다.

- [ ] **Step 5: 검증·커밋**

Run: `npm run type-check` → 0 · `npx tsx scripts/ops/hanjin-label-preview/render.ts /tmp/kit` → 9개

```bash
git add scripts/ops/hanjin-label-preview docs/hanjin-api-integration-reference.md docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md
git commit -m "docs(core): 한진 운송장 현장 키트가 세 형을 뽑고 창고 PC 전송법을 적는다 (#913)"
```

---

## 컨트롤러 마무리 (서브에이전트 아님)

1. 전체 게이트: `npm run type-check` 0 · `npx jest --maxWorkers=2` 실패 0 · `npx jest scripts/security` 통과.
2. **로컬 역렌더 스모크**(스펙 §9) — 스크래치에서 일회성으로: render.ts → `zpl-renderer-js`(zebrash)로 ZPL → PNG → 템플릿 방향으로 되돌려 SVG 미리보기와 차분 · `zxing-cpp` 로 ITF 12자리·CODE128 디코딩 · 압축/비압축 픽셀 동일. 결과 PNG 를 사용자에게 보인다.
3. 전 브랜치 리뷰(최상위 모델).
4. 외부 문서 정정(스펙 §10): #913 본문(「진단 화면에서 출력」 → README, 라벨 타입 절에 NL·FS·`HANJIN_LABEL_TYPE`), 개통 지도 아티팩트(read → 수정 → 같은 URL 로 재게시).
5. PR (develop 대상).
