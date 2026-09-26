# 한진 NS형 운송장 렌더링 (core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core 에 `GET shipments/:shipmentId/waybill/label` 을 추가해, 한진 NS형 자체출력 운송장 한 장을 창고 프린터(Xprinter XP-DT108B)가 바로 찍을 수 있는 ZPL 로 돌려준다.

**Architecture:** 한진 전용 순수 함수 둘(`buildHanjinLabelData` → `renderHanjinNsLabel`)이 가로 방향 mm 단위 SVG 와 바코드 배치를 만들고, 캐리어 중립 `SvgRasterizer`(resvg, 유일한 네이티브 경계)가 SVG 를 1비트 비트맵으로, 순수 `encodeZpl` 이 90° 회전 + `^GF` 배경 + `^B2`/`^BC` 바코드로 ZPL 을 만든다. 가드는 기존 `WaybillManager.assertDispatchable` 를 재사용해 «출력 가능 ⇔ 출고 가능» 을 보장한다.

**Tech Stack:** NestJS 11, drizzle(postgres.js), jest(ts-jest), `@resvg/resvg-js` 2.6.x, 나눔고딕 TTF(OFL), ZPL II.

**Spec:** `docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md` — 실행자는 계획과 스펙을 둘 다 읽는다.

## Global Constraints

- 브랜치 `feat/913-hanjin-label-masking` 에서 작업한다. 마스킹 유틸(`carrier/hanjin/label/hanjin-label-masking.ts`)은 이미 커밋돼 있다 — 고치지 않는다.
- 203dpi = **8 dot/mm**. NS 라벨 = 가로 200mm × 세로 102mm(가로 방향). 프린터로는 90° 회전해 `^PW816` · `^LL1600`.
- 폰트 크기 표기는 **pt**(1pt = 0.3528mm). 폰트는 번들한 `NanumGothic-Regular.ttf`·`NanumGothic-Bold.ttf` 만 — 시스템 폰트 금지(`loadSystemFonts: false`).
- **검은색 요소만 그린다.** 테두리·영역 캡션·로고·개인정보 안내 문구는 한진 라벨지에 선인쇄돼 있다.
- 받는분 **성명·연락처는 모든 면에서 마스킹**한다. 받는분 원본 주소는 배달표에만. 보낸분 원본 성명·연락처는 배달표에만, 보낸분 주소는 배달표에 **미표기**.
- 서비스는 HTTP 타입을 모른다 — 도메인 에러는 `@app/shared` 의 `NotFoundError`·`ConflictError`, 설정·배포·불변식 위반은 `Error`(500). 컨트롤러는 try/catch 하지 않는다.
- `any` 금지, 근거 없는 `as` 금지 — 타입 가드를 쓴다.
- 트랜잭션은 `dbService.run(fn, tx)` (ADR-0025). 공개 메서드는 마지막 인자 `tx?: DbTx`.
- 출력일자 등 날짜는 **`Asia/Seoul` 로 명시**해 포맷한다. 런타임 TZ 에 상대적인 API 금지(jest 는 UTC 로 뜬다).
- 검증 게이트: `npm run type-check` 에러 0(로컬에서 `apps/file-service/src/upload/image-dimensions.ts` 의 `probe-image-size` 한 건만 나오면 로컬 `node_modules` 문제라 무시 — PR CI 로 판정), `npx jest --maxWorkers=2` 실패 0, `npx jest scripts/security` 통과.
- 커밋 메시지는 한국어 conventional(`feat(core): … (#913)`), 끝에 `Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS` 한 줄.

## Review Focus

1. **고객 입력에 XML 특수문자**(`<`, `&`, `"`) — 수하인 이름·배송메시지·품명은 고객 입력이다. SVG 가 깨지거나 태그가 주입되면 안 된다 → Task 5 이스케이프 테스트.
2. **아주 긴 주소·배송메시지·품명** — 선인쇄 칸을 넘으면 안 된다. 잘리되(`…`) 크래시하지 않는다 → Task 5 말줄임 테스트. 식별자(출고번호)는 자르지 않고 글자를 줄인다 → Task 5.
3. **demo 캐리어(로컬 E2E) 값** — `dom_rgn: 'D'`, 코드 `'DEMO'`, `prt_add` 에 상세주소까지 들어온다. 렌더링이 성공해야 한다 → Task 4·5 테스트.
4. **폰트에 없는 글자(이모지 등)** — 배송메시지에 이모지가 오면 그 글자만 비고 렌더링은 성공해야 한다 → Task 3 테스트.
5. **발급 후 수하인·품목이 바뀐 shipment** — 라벨이 한진 등록값과 달라지므로 409 `WAYBILL_STALE` 로 막혀야 한다 → Task 6 통합 테스트.

---

## File Structure

| 파일 | 책임 | Task |
| --- | --- | --- |
| `package.json` · `package-lock.json` | `@resvg/resvg-js` 의존성 | 1 |
| `nest-cli.json` | core `assets` — 폰트를 `dist/apps/core/assets/fonts` 로 복사 | 1 |
| `apps/core/assets/fonts/{NanumGothic-Regular.ttf,NanumGothic-Bold.ttf,OFL.txt}` | 번들 폰트 + 라이선스 | 1 |
| `apps/core/src/modules/fulfillment/waybill/label/label-model.ts` | `MonoBitmap`·`BarcodePlacement`·`LabelSpec` 타입, mm↔dot, 비트 헬퍼 | 2 |
| `…/waybill/label/zpl-encoder.ts` (+spec) | 회전·`^GF`·ACS 압축·바코드 → ZPL | 2 |
| `…/waybill/label/svg-rasterizer.ts` (+spec) | resvg 어댑터, 폰트 경로 결정 | 3 |
| `…/waybill/waybill-request.assembler.ts` (+spec) | `composeMessage`·`commodityNameOf` export | 4 |
| `…/waybill/carrier/hanjin/label/hanjin-label-data.ts` (+spec) | 운송장 행 + 발급 재료 + 설정 → `HanjinLabelData` | 4 |
| `…/waybill/label/svg-text.ts` (+spec) | XML 이스케이프·글자 폭 근사·말줄임·글자 크기 맞춤 | 5 |
| `…/waybill/carrier/hanjin/label/hanjin-ns-template.ts` (+spec) | `HanjinLabelData` → `LabelSpec`, 면별 마스킹 | 5 |
| `…/waybill/waybill.constants.ts` | `LABEL_UNAVAILABLE` 에러 코드, `LABEL_ZPL_COMPRESS` | 6 |
| `…/waybill/waybill.tokens.ts` | `WAYBILL_LABEL_CLOCK` | 6 |
| `…/waybill/waybill-label.manager.ts` (+spec, +integration spec) | 가드 + 조립 파이프라인 | 6 |
| `…/waybill/waybill-label.service.ts` | 위임 | 6 |
| `…/waybill/waybill-label.controller.ts` (+spec) | 라우트 | 6 |
| `…/waybill/dto/waybill.dto.ts` | `WaybillLabelResponseDto` | 6 |
| `…/waybill/waybill.module.ts` | provider·controller 등록 | 6 |
| `scripts/ops/hanjin-label-preview/render.ts` | 합성 데이터 미리보기 PNG | 7 |

`WaybillService` 는 건드리지 않는다 — 테스트 10곳이 `new WaybillService(manager)` 로 직접 만들어서, 생성자를 바꾸면 전부 깨진다. 라벨은 전용 service·controller 로 둔다.

경로 약칭: 이하 `W/` = `apps/core/src/modules/fulfillment/waybill/`.

---

### Task 1: 의존성·폰트·자산 배선 + arm64 alpine 선행 실험

**이 태스크가 실패하면 계획을 멈추고 사용자에게 보고한다**(스펙 §7). 대안(`@napi-rs/canvas`)으로 넘어가는 판단은 사용자가 한다.

**Files:**
- Modify: `package.json`, `package-lock.json`, `nest-cli.json`
- Create: `apps/core/assets/fonts/NanumGothic-Regular.ttf`, `apps/core/assets/fonts/NanumGothic-Bold.ttf`, `apps/core/assets/fonts/OFL.txt`
- Throwaway(커밋하지 않음): `<scratchpad>/label-spike.js`

**Interfaces:**
- Produces: 폰트 파일 경로 `apps/core/assets/fonts/NanumGothic-{Regular,Bold}.ttf`(소스), `dist/apps/core/assets/fonts/…`(빌드). 패키지 `@resvg/resvg-js` 의 `Resvg` 클래스.

- [ ] **Step 1: 폰트 내려받기**

```bash
mkdir -p apps/core/assets/fonts
for f in NanumGothic-Regular.ttf NanumGothic-Bold.ttf OFL.txt; do
  curl -sSfL -o "apps/core/assets/fonts/$f" "https://github.com/google/fonts/raw/main/ofl/nanumgothic/$f"
done
ls -l apps/core/assets/fonts
```

Expected: TTF 두 개가 각각 약 2MB, `OFL.txt` 약 4.5KB.

- [ ] **Step 2: 의존성 추가**

```bash
npm install @resvg/resvg-js@^2.6.2
git diff --stat package.json package-lock.json
grep -n '"node_modules/@resvg/resvg-js-linux-arm64-musl"' package-lock.json
```

Expected: `package.json` 의 `dependencies` 에 `"@resvg/resvg-js": "^2.6.2"`. lockfile 에 `linux-arm64-musl` 항목이 **있다**. 없으면 멈추고 보고한다(npm 이 현재 플랫폼 optional 의존성만 기록하는 함정 — 이 경우 alpine arm64 이미지에서 바이너리가 없다). lockfile diff 가 `@resvg` 외 패키지를 대량으로 바꿨다면 멈추고 보고한다.

- [ ] **Step 3: `nest-cli.json` 에 core 자산 복사 추가**

`projects.core.compilerOptions` 에 `assets` 를 더한다(선례: `user-service` 의 `"../static/**/*"`):

```json
"core": {
  "type": "application",
  "root": "apps/core",
  "entryFile": "main",
  "sourceRoot": "apps/core/src",
  "compilerOptions": {
    "tsConfigPath": "apps/core/tsconfig.app.json",
    "assets": [{ "include": "../assets/fonts/**/*", "outDir": "dist/apps/core/assets/fonts" }]
  }
}
```

- [ ] **Step 4: 로컬 빌드로 자산 복사 확인**

```bash
npx nest build core && ls -l dist/apps/core/assets/fonts
```

Expected: `NanumGothic-Regular.ttf`, `NanumGothic-Bold.ttf`, `OFL.txt` 가 `dist/apps/core/assets/fonts/` 바로 아래에 있다.

- [ ] **Step 5: 실험 스크립트 작성(버림)**

`<scratchpad>/label-spike.js` — 커밋하지 않는다:

```js
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const dir = process.argv[2];
const fontFiles = ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'].map((f) => `${dir}/${f}`);
for (const f of fontFiles) if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="10mm" viewBox="0 0 40 10">' +
  '<text x="1" y="8" font-family="NanumGothic" font-size="7">한진택배</text>' +
  '<text x="21" y="8" font-family="NanumGothic" font-size="7" font-weight="700">한진택배</text></svg>';
const render = (files) => {
  const img = new Resvg(svg, {
    background: 'white',
    fitTo: { mode: 'width', value: 320 },
    font: { loadSystemFonts: false, fontFiles: files, defaultFontFamily: 'NanumGothic' },
  }).render();
  let black = 0;
  for (let i = 0; i < img.pixels.length; i += 4) if (img.pixels[i] < 128) black++;
  return { width: img.width, height: img.height, black };
};
const withFonts = render(fontFiles);
const noFonts = render([]);
console.log(JSON.stringify({ arch: process.arch, withFonts, noFonts }));
if (withFonts.width !== 320 || withFonts.height !== 80) process.exit(1);
if (withFonts.black === 0 || noFonts.black !== 0) process.exit(2);
```

`noFonts.black === 0` 은 «한글이 찍혔다» 가 폰트 덕분이라는 대조군이다.

- [ ] **Step 6: 로컬(x64 gnu)에서 실행**

```bash
node <scratchpad>/label-spike.js "$PWD/dist/apps/core/assets/fonts"
```

Expected: `{"arch":"x64","withFonts":{"width":320,"height":80,"black":<양수>},"noFonts":{…,"black":0}}`, exit 0.

- [ ] **Step 7: arm64 에뮬레이션 확인**

```bash
ls /proc/sys/fs/binfmt_misc/ | grep -i aarch64 || echo "NO_ARM64_BINFMT"
```

`NO_ARM64_BINFMT` 이면 **멈추고 사용자에게 요청한다** — 시스템 설정 변경이라 사용자가 직접 실행한다:
`! docker run --privileged --rm tonistiigi/binfmt --install arm64`

- [ ] **Step 8: arm64 core 이미지 빌드**

```bash
docker buildx build --platform linux/arm64 -f apps/core/Dockerfile -t core-label-spike:arm64 --load .
```

에뮬레이션이라 10~30분 걸릴 수 있다 — 백그라운드로 돌리고 기다린다. Expected: 성공. `npm ci` 단계에서 실패하면 로그의 `@resvg` 관련 줄을 보고한다.

- [ ] **Step 9: 컨테이너 안에서 실험 스크립트 실행**

```bash
docker run --rm --platform linux/arm64 -w /app \
  -v "<scratchpad>/label-spike.js:/app/label-spike.js:ro" \
  core-label-spike:arm64 node /app/label-spike.js /app/dist/apps/core/assets/fonts
```

Expected: `"arch":"arm64"`, `withFonts.black > 0`, `noFonts.black === 0`, exit 0. 이게 스펙 §7 합격 기준 1~3 이다.

- [ ] **Step 10: 이미지 정리 + 커밋**

```bash
docker image rm core-label-spike:arm64
git add package.json package-lock.json nest-cli.json apps/core/assets/fonts
git commit -F - <<'EOF'
build(core): 운송장 라벨 렌더링용 resvg 와 나눔고딕을 번들한다 (#913)

arm64 alpine(core ECS) 컨테이너에서 한글 렌더링을 실측 확인했다.
폰트는 nest-cli assets 로 dist/apps/core/assets/fonts 에 복사된다(runner 는 dist·libs 만 복사).

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS
EOF
```

---

### Task 2: 라벨 모델 + ZPL 인코더

**Files:**
- Create: `W/label/label-model.ts`, `W/label/zpl-encoder.ts`
- Test: `W/label/zpl-encoder.spec.ts`

**Interfaces:**
- Produces (`label-model.ts`):
  - `interface MonoBitmap { widthDots: number; heightDots: number; bytesPerRow: number; data: Uint8Array }` — 1 = 검정, 행 우선, MSB 가 왼쪽 픽셀, 행 끝 패딩
  - `type BarcodeKind = 'ITF' | 'CODE128'`
  - `interface BarcodePlacement { kind: BarcodeKind; data: string; xMm: number; yMm: number; heightMm: number; moduleDots: number; wideRatio?: number }` — 가로 방향 좌표, `(xMm, yMm)` 는 바코드 상자의 왼쪽 위
  - `interface LabelSpec { widthMm: number; heightMm: number; svg: string; barcodes: BarcodePlacement[] }`
  - `const DOTS_PER_MM = 8`, `mmToDots(mm: number): number`, `createBitmap(w, h): MonoBitmap`, `getBit(b, x, y): boolean`, `setBit(b, x, y): void`
- Produces (`zpl-encoder.ts`): `interface ZplOptions { compress: boolean }`, `rotateClockwise(src: MonoBitmap): MonoBitmap`, `compressAcs(hexRows: readonly string[]): string`, `encodeZpl(landscape: MonoBitmap, barcodes: readonly BarcodePlacement[], opts: ZplOptions): string`

- [ ] **Step 1: 라벨 모델 작성**

`W/label/label-model.ts`:

```ts
/**
 * 캐리어 중립 라벨 모델. 템플릿(캐리어 전용)이 LabelSpec 을 만들고, 래스터라이저가 svg 를
 * MonoBitmap 으로, ZPL 인코더가 비트맵 + 바코드를 프린터 명령으로 바꾼다(#913).
 */

/** 203dpi 프린터는 정확히 8 dot/mm 다. */
export const DOTS_PER_MM = 8;

export function mmToDots(mm: number): number {
  return Math.round(mm * DOTS_PER_MM);
}

/** 1비트 비트맵. 1 = 검정, 행 우선, 한 바이트의 MSB 가 가장 왼쪽 픽셀, 행 끝은 바이트 경계까지 패딩. */
export interface MonoBitmap {
  widthDots: number;
  heightDots: number;
  bytesPerRow: number;
  data: Uint8Array;
}

export type BarcodeKind = 'ITF' | 'CODE128';

/** 바코드 배치. 좌표는 템플릿과 같은 가로 방향 mm, (xMm, yMm) 는 바코드 상자의 왼쪽 위. */
export interface BarcodePlacement {
  kind: BarcodeKind;
  data: string;
  xMm: number;
  yMm: number;
  heightMm: number;
  /** 좁은 막대 폭(dot). */
  moduleDots: number;
  /** ITF 넓은/좁은 막대 비(2.0~3.0). CODE128 은 쓰지 않는다. */
  wideRatio?: number;
}

/** 템플릿 출력. svg 의 viewBox 는 0 0 widthMm heightMm(mm 단위, 가로 방향)이다. */
export interface LabelSpec {
  widthMm: number;
  heightMm: number;
  svg: string;
  barcodes: BarcodePlacement[];
}

export function createBitmap(widthDots: number, heightDots: number): MonoBitmap {
  const bytesPerRow = Math.ceil(widthDots / 8);
  return { widthDots, heightDots, bytesPerRow, data: new Uint8Array(bytesPerRow * heightDots) };
}

export function getBit(b: MonoBitmap, x: number, y: number): boolean {
  return (b.data[y * b.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

export function setBit(b: MonoBitmap, x: number, y: number): void {
  b.data[y * b.bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`W/label/zpl-encoder.spec.ts`:

```ts
import { createBitmap, getBit, setBit, type BarcodePlacement, type MonoBitmap } from './label-model';
import { compressAcs, encodeZpl, rotateClockwise } from './zpl-encoder';

// ZPL ACS 압축 해제기 — 테스트 전용. 압축기와 독립적으로 규격(Zebra ZPL II ^GF 압축)대로 푼다.
function decodeAcs(data: string, bytesPerRow: number): string[] {
  const rowLen = bytesPerRow * 2;
  const rows: string[] = [];
  let cur = '';
  let count = 0;
  const flush = () => {
    rows.push(cur);
    cur = '';
  };
  for (const ch of data) {
    if (ch === ':') rows.push(rows[rows.length - 1]);
    else if (ch === ',') {
      cur = cur.padEnd(rowLen, '0');
      flush();
    } else if (ch === '!') {
      cur = cur.padEnd(rowLen, 'F');
      flush();
    } else if (ch >= 'G' && ch <= 'Y') count += ch.charCodeAt(0) - 70; // G=1 … Y=19
    else if (ch >= 'g' && ch <= 'z') count += (ch.charCodeAt(0) - 102) * 20; // g=20 … z=400
    else {
      cur += ch.repeat(count || 1);
      count = 0;
      if (cur.length === rowLen) flush();
    }
  }
  return rows;
}

function hexRowsOf(b: MonoBitmap): string[] {
  const rows: string[] = [];
  for (let y = 0; y < b.heightDots; y++) {
    const row = b.data.subarray(y * b.bytesPerRow, (y + 1) * b.bytesPerRow);
    rows.push(Buffer.from(row).toString('hex').toUpperCase());
  }
  return rows;
}

// NS 라벨 크기(가로 방향) 비트맵.
const nsBitmap = () => createBitmap(1600, 816);

const ITF: BarcodePlacement = {
  kind: 'ITF',
  data: '452716978431',
  xMm: 149.1,
  yMm: 43.8,
  heightMm: 20,
  moduleDots: 3,
  wideRatio: 2.5,
};

describe('rotateClockwise', () => {
  it('가로 방향 (x, y) 를 세로 방향 (H-1-y, x) 로 옮긴다', () => {
    const src = createBitmap(3, 2); // 가로 3, 세로 2
    setBit(src, 0, 0);
    setBit(src, 2, 1);
    const dst = rotateClockwise(src);
    expect([dst.widthDots, dst.heightDots]).toEqual([2, 3]);
    expect(getBit(dst, 1, 0)).toBe(true); // (0,0) → (2-1-0, 0)
    expect(getBit(dst, 0, 2)).toBe(true); // (2,1) → (2-1-1, 2)
    expect(getBit(dst, 0, 0)).toBe(false);
  });
});

describe('compressAcs', () => {
  it('압축을 풀면 원본 행과 같다', () => {
    const b = createBitmap(64, 6);
    for (let x = 0; x < 64; x++) setBit(b, x, 1); // 전부 검정
    for (let x = 0; x < 8; x++) setBit(b, x, 3); // 앞만 검정
    for (let x = 0; x < 8; x++) setBit(b, x, 4); // 3행 반복
    setBit(b, 63, 5); // 끝만 검정
    const rows = hexRowsOf(b);
    expect(decodeAcs(compressAcs(rows), b.bytesPerRow)).toEqual(rows);
  });

  it('흰 여백이 대부분인 라벨은 원본 hex 보다 훨씬 짧다', () => {
    const b = nsBitmap();
    for (let x = 100; x < 400; x++) setBit(b, x, 400);
    const rows = hexRowsOf(b);
    const packed = compressAcs(rows);
    expect(packed.length).toBeLessThan(rows.join('').length / 100);
    expect(decodeAcs(packed, b.bytesPerRow)).toEqual(rows);
  });

  it('반복 길이 400 이상도 z 를 이어 붙여 표현한다', () => {
    // 900 = 400 + 400 + 100, 100 = k(20×5)
    expect(compressAcs(['A'.repeat(900) + 'B'])).toBe('zzkAB');
  });
});
```

같은 파일에 이어서:

```ts
describe('encodeZpl', () => {
  it('90° 회전해 폭 816 · 길이 1600 으로 선언하고 ^XA 로 열어 ^XZ 로 닫는다', () => {
    const zpl = encodeZpl(nsBitmap(), [], { compress: false });
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true);
    expect(zpl).toContain('^PW816');
    expect(zpl).toContain('^LL1600');
  });

  it('비압축 ^GF 의 바이트 수는 bytesPerRow × 행 수이고 데이터는 그 두 배 hex 다', () => {
    const zpl = encodeZpl(nsBitmap(), [], { compress: false });
    const m = /\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS/.exec(zpl);
    expect(m).not.toBeNull();
    const [, total, total2, bpr, data] = m as RegExpExecArray;
    expect(Number(bpr)).toBe(102); // 816 / 8
    expect(Number(total)).toBe(102 * 1600);
    expect(total2).toBe(total);
    expect(data.length).toBe(2 * 102 * 1600);
  });

  it('압축 ^GF 를 풀면 회전한 비트맵과 같다', () => {
    const b = nsBitmap();
    for (let x = 10; x < 200; x++) setBit(b, x, 20);
    const zpl = encodeZpl(b, [], { compress: true });
    const m = /\^GFA,(\d+),(\d+),(\d+),([^^]+)\^FS/.exec(zpl) as RegExpExecArray;
    expect(decodeAcs(m[4], Number(m[3]))).toEqual(hexRowsOf(rotateClockwise(b)));
  });

  it('ITF 는 회전 좌표 ^FO(H-y-h, x) 에 ^BY3,2.5 ^B2R 로, 사람용 숫자·체크디지트 없이 놓는다', () => {
    const zpl = encodeZpl(nsBitmap(), [ITF], { compress: false });
    // x = round(149.1×8) = 1193, y = round(43.8×8) = 350, h = 160 → FO(816-350-160, 1193) = (306, 1193)
    expect(zpl).toContain('^FO306,1193^BY3,2.5^B2R,160,N,N,N^FD452716978431^FS');
  });

  it('CODE128 은 ^BCR 로 놓는다', () => {
    const code: BarcodePlacement = { kind: 'CODE128', data: '150', xMm: 4.4, yMm: 18.3, heightMm: 8, moduleDots: 2 };
    const zpl = encodeZpl(nsBitmap(), [code], { compress: false });
    // x = 35, y = 146, h = 64 → FO(816-146-64, 35) = (606, 35)
    expect(zpl).toContain('^FO606,35^BY2^BCR,64,N,N,N^FD150^FS');
  });

  it('ITF 데이터가 짝수 자리 숫자가 아니면 던진다', () => {
    expect(() => encodeZpl(nsBitmap(), [{ ...ITF, data: '12345' }], { compress: false })).toThrow(/ITF/);
    expect(() => encodeZpl(nsBitmap(), [{ ...ITF, data: 'WBL-1234' }], { compress: false })).toThrow(/ITF/);
  });

  it('CODE128 데이터가 비었거나 ZPL 제어문자(^ ~)를 담으면 던진다', () => {
    const base: BarcodePlacement = { kind: 'CODE128', data: '', xMm: 4, yMm: 18, heightMm: 8, moduleDots: 2 };
    expect(() => encodeZpl(nsBitmap(), [base], { compress: false })).toThrow(/CODE128/);
    expect(() => encodeZpl(nsBitmap(), [{ ...base, data: '1^XZ' }], { compress: false })).toThrow(/CODE128/);
  });

  it('라벨 밖에 놓인 바코드는 던진다', () => {
    expect(() => encodeZpl(nsBitmap(), [{ ...ITF, yMm: 95 }], { compress: false })).toThrow(/outside/);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/zpl-encoder.spec.ts`
Expected: FAIL — `Cannot find module './zpl-encoder'`.

- [ ] **Step 4: 구현**

`W/label/zpl-encoder.ts`:

```ts
import { createBitmap, getBit, mmToDots, setBit, type BarcodePlacement, type MonoBitmap } from './label-model';

/**
 * 가로 방향으로 그린 라벨을 ZPL 로 바꾼다(#913).
 *
 * 창고 프린터(XP-DT108B)의 인쇄폭이 108mm 라 NS(200×102mm)는 짧은 변을 폭으로 넣는다 — 그래서
 * 비트맵과 바코드 좌표를 함께 시계방향 90° 돌린다. 한글은 프린터 내장 폰트에 없어 텍스트는 전부
 * 배경 비트맵(^GF)에 들어 있고, 프린터 명령으로 그리는 것은 바코드 둘뿐이다.
 */
export interface ZplOptions {
  /** ^GF 데이터에 ZPL ACS 압축을 쓸지. 기본값은 창고 실물 출력으로 정한다(스펙 §10-3). */
  compress: boolean;
}

export function rotateClockwise(src: MonoBitmap): MonoBitmap {
  const dst = createBitmap(src.heightDots, src.widthDots);
  for (let y = 0; y < src.heightDots; y++) {
    for (let x = 0; x < src.widthDots; x++) {
      if (getBit(src, x, y)) setBit(dst, src.heightDots - 1 - y, x);
    }
  }
  return dst;
}

function hexRows(b: MonoBitmap): string[] {
  const rows: string[] = [];
  for (let y = 0; y < b.heightDots; y++) {
    const row = b.data.subarray(y * b.bytesPerRow, (y + 1) * b.bytesPerRow);
    rows.push(Buffer.from(row).toString('hex').toUpperCase());
  }
  return rows;
}

// ACS 반복 코드: G..Y = 1..19, g..y = 20..380(20 단위), z = 400. 더해서 쓴다.
function countCode(n: number): string {
  let out = '';
  let rest = n;
  while (rest >= 400) {
    out += 'z';
    rest -= 400;
  }
  if (rest >= 20) {
    out += String.fromCharCode('g'.charCodeAt(0) + Math.floor(rest / 20) - 1);
    rest %= 20;
  }
  if (rest > 0) out += String.fromCharCode('G'.charCodeAt(0) + rest - 1);
  return out;
}

function runLength(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += (j - i > 1 ? countCode(j - i) : '') + s[i];
    i = j;
  }
  return out;
}

/**
 * ZPL ACS 압축. 행 단위: 이전 행과 같으면 `:`, 끝이 0 으로 채워지면 `,`, F 로 채워지면 `!`,
 * 행 안의 반복은 반복 코드 + 문자.
 */
export function compressAcs(hexRowsIn: readonly string[]): string {
  let out = '';
  let prev: string | undefined;
  for (const row of hexRowsIn) {
    if (row === prev) {
      out += ':';
      continue;
    }
    prev = row;
    const zeroTail = /0+$/.exec(row)?.[0].length ?? 0;
    const fTail = /F+$/.exec(row)?.[0].length ?? 0;
    if (zeroTail >= 2) out += runLength(row.slice(0, row.length - zeroTail)) + ',';
    else if (fTail >= 2) out += runLength(row.slice(0, row.length - fTail)) + '!';
    else out += runLength(row);
  }
  return out;
}

function barcodeField(b: BarcodePlacement, landscapeW: number, landscapeH: number): string {
  const x = mmToDots(b.xMm);
  const y = mmToDots(b.yMm);
  const h = mmToDots(b.heightMm);
  if (x < 0 || y < 0 || x >= landscapeW || y + h > landscapeH) {
    throw new Error(`barcode ${b.kind} is outside the label: x=${x} y=${y} h=${h} on ${landscapeW}×${landscapeH}`);
  }
  // 시계방향 90°: 가로 (x, y) → 세로 (H-1-y, x). 상자 (x, y, h) 의 세로 방향 왼쪽 위는 (H-y-h, x).
  const fo = `^FO${landscapeH - y - h},${x}`;
  if (b.kind === 'ITF') {
    if (!/^(?:\d\d)+$/.test(b.data)) throw new Error(`ITF needs an even number of digits: "${b.data}"`);
    // f·g = N: 사람용 숫자는 SVG 에서 그린다. e = N: 한진 번호에 체크디지트가 이미 있다.
    return `${fo}^BY${b.moduleDots},${(b.wideRatio ?? 2.5).toFixed(1)}^B2R,${h},N,N,N^FD${b.data}^FS`;
  }
  if (!b.data || /[\^~]/.test(b.data)) {
    throw new Error(`CODE128 data is empty or contains ZPL control characters: "${b.data}"`);
  }
  return `${fo}^BY${b.moduleDots}^BCR,${h},N,N,N^FD${b.data}^FS`;
}

export function encodeZpl(landscape: MonoBitmap, barcodes: readonly BarcodePlacement[], opts: ZplOptions): string {
  const portrait = rotateClockwise(landscape);
  const total = portrait.bytesPerRow * portrait.heightDots;
  const rows = hexRows(portrait);
  const gfData = opts.compress ? compressAcs(rows) : rows.join('');
  const lines = [
    '^XA',
    `^PW${portrait.widthDots}`,
    `^LL${portrait.heightDots}`,
    '^LH0,0',
    `^FO0,0^GFA,${total},${total},${portrait.bytesPerRow},${gfData}^FS`,
    ...barcodes.map((b) => barcodeField(b, landscape.widthDots, landscape.heightDots)),
    '^PQ1',
    '^XZ',
  ];
  return lines.join('\n');
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/zpl-encoder.spec.ts`
Expected: PASS (전부).

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/label/label-model.ts apps/core/src/modules/fulfillment/waybill/label/zpl-encoder.ts apps/core/src/modules/fulfillment/waybill/label/zpl-encoder.spec.ts
git commit -F - <<'EOF'
feat(core): 운송장 라벨 비트맵을 ZPL 로 인코딩한다 (#913)

90° 회전(인쇄폭 108mm 에 NS 의 짧은 변을 맞춘다), ^GF 배경(ACS 압축 옵션), ^B2/^BC 바코드.

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS
EOF
```

---

### Task 3: SVG 래스터라이저

**Files:**
- Create: `W/label/svg-rasterizer.ts`
- Test: `W/label/svg-rasterizer.spec.ts`

**Interfaces:**
- Consumes: `MonoBitmap`, `createBitmap`, `setBit` (Task 2), 폰트 파일(Task 1)
- Produces: `LABEL_FONT_FILES`, `resolveLabelFontDir(cwd?: string, exists?: (p: string) => boolean): string`, `class SvgRasterizer { constructor(resolveFontDir?: () => string); rasterize(svg: string, widthDots: number): MonoBitmap }`

- [ ] **Step 1: 실패하는 테스트 작성**

`W/label/svg-rasterizer.spec.ts`:

```ts
import { join } from 'path';
import { getBit } from './label-model';
import { resolveLabelFontDir, SvgRasterizer } from './svg-rasterizer';

const svgOf = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="5mm" viewBox="0 0 10 5" font-family="NanumGothic">${body}</svg>`;

const blackCount = (b: { widthDots: number; heightDots: number }, has: (x: number, y: number) => boolean) => {
  let n = 0;
  for (let y = 0; y < b.heightDots; y++) for (let x = 0; x < b.widthDots; x++) if (has(x, y)) n++;
  return n;
};

describe('SvgRasterizer', () => {
  const r = new SvgRasterizer();

  it('요청한 폭(dot)으로 그리고 높이는 viewBox 비율을 따른다', () => {
    const b = r.rasterize(svgOf(''), 80);
    expect([b.widthDots, b.heightDots, b.bytesPerRow]).toEqual([80, 40, 10]);
  });

  it('검은 사각형은 1, 빈 곳은 0 이다', () => {
    const b = r.rasterize(svgOf('<rect x="0" y="0" width="5" height="5" fill="#000"/>'), 80);
    expect(getBit(b, 10, 20)).toBe(true);
    expect(getBit(b, 70, 20)).toBe(false);
  });

  it('번들 나눔고딕으로 한글을 그린다 — 굵게는 더 많이 칠한다', () => {
    const regular = r.rasterize(svgOf('<text x="0" y="4" font-size="3.5">한진</text>'), 80);
    const bold = r.rasterize(svgOf('<text x="0" y="4" font-size="3.5" font-weight="700">한진</text>'), 80);
    const n = blackCount(regular, (x, y) => getBit(regular, x, y));
    const nb = blackCount(bold, (x, y) => getBit(bold, x, y));
    expect(n).toBeGreaterThan(0);
    expect(nb).toBeGreaterThan(n);
  });

  it('폰트에 없는 글자(이모지)는 비워 두고 던지지 않는다', () => {
    expect(() => r.rasterize(svgOf('<text x="0" y="4" font-size="3.5">문앞😀</text>'), 80)).not.toThrow();
  });

  it('폰트가 없으면 찾아본 경로를 담아 던진다', () => {
    const missing = new SvgRasterizer(() => resolveLabelFontDir('/nonexistent-root'));
    expect(() => missing.rasterize(svgOf(''), 80)).toThrow(/nonexistent-root\/dist\/apps\/core\/assets\/fonts/);
  });
});

describe('resolveLabelFontDir', () => {
  it('빌드 산출물(dist)을 먼저 본다', () => {
    const exists = (p: string) => p.startsWith('/app/dist/');
    expect(resolveLabelFontDir('/app', exists)).toBe(join('/app', 'dist/apps/core/assets/fonts'));
  });

  it('dist 에 없으면 소스 경로를 쓴다(개발 모드·jest)', () => {
    const exists = (p: string) => p.startsWith('/repo/apps/');
    expect(resolveLabelFontDir('/repo', exists)).toBe(join('/repo', 'apps/core/assets/fonts'));
  });

  it('폰트 파일 하나라도 빠진 후보는 건너뛴다', () => {
    const exists = (p: string) => p.startsWith('/r/apps/') || p.endsWith('/dist/apps/core/assets/fonts/NanumGothic-Regular.ttf');
    expect(resolveLabelFontDir('/r', exists)).toBe(join('/r', 'apps/core/assets/fonts'));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/svg-rasterizer.spec.ts`
Expected: FAIL — `Cannot find module './svg-rasterizer'`.

- [ ] **Step 3: 구현**

`W/label/svg-rasterizer.ts`:

```ts
import { existsSync } from 'fs';
import { join } from 'path';
import { Resvg } from '@resvg/resvg-js';
import { createBitmap, setBit, type MonoBitmap } from './label-model';

export const LABEL_FONT_FILES = ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'] as const;

/**
 * 번들 폰트 디렉터리. 배포 이미지는 빌드 산출물(dist)에만 폰트가 있고(nest-cli assets),
 * 개발 모드·jest 는 소스 경로를 쓴다. 폰트 파일이 전부 있는 첫 후보를 고른다.
 */
export function resolveLabelFontDir(cwd: string = process.cwd(), exists: (p: string) => boolean = existsSync): string {
  const candidates = [join(cwd, 'dist/apps/core/assets/fonts'), join(cwd, 'apps/core/assets/fonts')];
  const found = candidates.find((dir) => LABEL_FONT_FILES.every((f) => exists(join(dir, f))));
  if (!found) throw new Error(`label fonts not found: looked in ${candidates.join(', ')}`);
  return found;
}

/**
 * SVG → 1비트 비트맵. resvg 를 감싸는 유일한 네이티브 경계다(#913).
 *
 * 시스템 폰트를 끄고 번들 나눔고딕만 쓰므로 어느 머신에서 돌려도 결과가 같다. 폰트가 없으면
 * 라벨 요청만 실패시킨다 — 라벨 기능 하나로 core 부팅을 막지 않는다.
 */
export class SvgRasterizer {
  private fontFiles?: string[];

  constructor(private readonly resolveFontDir: () => string = () => resolveLabelFontDir()) {}

  rasterize(svg: string, widthDots: number): MonoBitmap {
    const rendered = new Resvg(svg, {
      background: 'white',
      fitTo: { mode: 'width', value: widthDots },
      font: { loadSystemFonts: false, fontFiles: this.fonts(), defaultFontFamily: 'NanumGothic' },
    }).render();
    const { width, height, pixels } = rendered;
    const bitmap = createBitmap(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        if (luminance < 128) setBit(bitmap, x, y);
      }
    }
    return bitmap;
  }

  private fonts(): string[] {
    if (!this.fontFiles) {
      const dir = this.resolveFontDir();
      this.fontFiles = LABEL_FONT_FILES.map((f) => join(dir, f));
    }
    return this.fontFiles;
  }
}
```

`@Injectable()` 을 붙이지 않는다 — 생성자 인자가 함수라 Nest 가 주입할 수 없다. 모듈에서 `useFactory` 로 등록한다(Task 6).

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/svg-rasterizer.spec.ts`
Expected: PASS (전부). 굵게 테스트가 실패하면(`nb <= n`) Bold TTF 의 family 이름이 `NanumGothic` 이 아닌 것이다 — `fc-scan apps/core/assets/fonts/NanumGothic-Bold.ttf | grep family` 로 확인하고 보고한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/label/svg-rasterizer.ts apps/core/src/modules/fulfillment/waybill/label/svg-rasterizer.spec.ts
git commit -F - <<'EOF'
feat(core): 운송장 라벨 SVG 를 번들 나눔고딕으로 1비트 비트맵으로 그린다 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS
EOF
```

---

### Task 4: 발급 코드 공유 + `buildHanjinLabelData`

**Files:**
- Modify: `W/waybill-request.assembler.ts`, `W/waybill-request.assembler.spec.ts`
- Create: `W/carrier/hanjin/label/hanjin-label-data.ts`
- Test: `W/carrier/hanjin/label/hanjin-label-data.spec.ts`

**Interfaces:**
- Consumes: `parseRecipient(snapshot: unknown): WaybillRecipient`(기존), `IssueContext`·`WaybillRow`(기존, `W/waybill.types.ts`), `HanjinConfig`(기존)
- Produces:
  - assembler: `export function composeMessage(deliveryNote: string | undefined, entrancePassword: string | null | undefined): string | undefined`, `export function commodityNameOf(lines: readonly ManifestLineLite[]): string`
  - `interface HanjinSortFields { hubCode; terminalCode; midCode; centerCode; centerName; originTerminalCode; originTerminalName; routeRank; courierName; courierSortCode; addressSummary }` (전부 `string`)
  - `interface HanjinLabelData { trackingNo: string; trackingNoDisplay: string; sort: HanjinSortFields; regionText: string; freightText: string; recipient: { name: string; phone: string; baseAddress: string; detailAddress: string }; sender: { name: string; phone: string; baseAddress: string }; deliveryMessage: string; commodityName: string; boxType: string; custOrdNo: string; printedDate: string /* YYYY-MM-DD KST */; boxIndex: number; boxCount: number }`
  - `interface BuildHanjinLabelInput { waybill: Pick<WaybillRow, 'trackingNo' | 'custOrdNo' | 'labelData'>; ctx: IssueContext; config: HanjinConfig; now: Date }`
  - `buildHanjinLabelData(input: BuildHanjinLabelInput): HanjinLabelData`

- [ ] **Step 1: assembler 공유 함수 테스트 추가 (실패)**

`W/waybill-request.assembler.spec.ts` 의 import 에 `commodityNameOf, composeMessage` 를 더하고 파일 끝에 추가:

```ts
describe('commodityNameOf', () => {
  it('한 줄이면 상품명 그대로', () => {
    expect(commodityNameOf([{ productName: '펜', quantity: 1, skuId: 'a' }])).toBe('펜');
  });
  it('여러 줄이면 「첫 상품명 외 N건」', () => {
    expect(
      commodityNameOf([
        { productName: '펜', quantity: 1, skuId: 'a' },
        { productName: '자', quantity: 2, skuId: 'b' },
        { productName: '풀', quantity: 1, skuId: 'c' },
      ]),
    ).toBe('펜 외 2건');
  });
  it('줄이 없으면 빈 문자열', () => {
    expect(commodityNameOf([])).toBe('');
  });
});

describe('composeMessage', () => {
  it('메모와 공동현관 비번을 합친다', () => {
    expect(composeMessage('문앞', '#1234')).toBe('문앞 (공동현관 #1234)');
  });
  it('둘 다 없으면 undefined', () => {
    expect(composeMessage(undefined, null)).toBeUndefined();
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/waybill-request.assembler.spec.ts`
Expected: FAIL — `commodityNameOf` / `composeMessage` 가 export 되지 않음.

- [ ] **Step 2: assembler 수정**

`W/waybill-request.assembler.ts` — `composeMessage` 앞에 `export` 를 붙이고 주석을 갱신, `commodityNameOf` 를 추가하고 `assembleWaybillRequest` 가 그걸 쓰게 한다:

```ts
/**
 * 배송 메시지 = 메모 라벨 + 공동현관 비번. 합성 결과는 어디에도 저장하지 않는다.
 * 운송장 라벨(#913)도 이 함수를 쓴다 — 한진에 보낸 문자열과 라벨 문자열이 같은 함수에서 나와야 한다.
 */
export function composeMessage(deliveryNote: string | undefined, entrancePassword: string | null | undefined) {
  // (본문 그대로)
}

/** 품명 = 첫 상품명 + 「외 N건」. 한진 등록값과 라벨 품명이 같은 함수에서 나온다(#913). */
export function commodityNameOf(lines: readonly ManifestLineLite[]): string {
  const head = lines[0]?.productName ?? '';
  return lines.length > 1 ? `${head} 외 ${lines.length - 1}건` : head;
}
```

`assembleWaybillRequest` 안의

```ts
  const head = input.lines[0]?.productName ?? '';
  const commodityName = input.lines.length > 1 ? `${head} 외 ${input.lines.length - 1}건` : head;
```

를

```ts
  const commodityName = commodityNameOf(input.lines);
```

로 바꾼다.

Run: `npx jest apps/core/src/modules/fulfillment/waybill/waybill-request.assembler.spec.ts`
Expected: PASS (기존 테스트 포함 전부).

- [ ] **Step 3: `buildHanjinLabelData` 실패하는 테스트 작성**

`W/carrier/hanjin/label/hanjin-label-data.spec.ts`:

```ts
import type { HanjinConfig } from '../hanjin.config';
import type { IssueContext } from '../../../waybill.types';
import { buildHanjinLabelData, type BuildHanjinLabelInput } from './hanjin-label-data';

const CONFIG: HanjinConfig = {
  clientId: 'C',
  apiKey: 'A',
  secretKey: 'S',
  contractNo: 'N',
  orderBaseUrl: 'https://o',
  printBaseUrl: 'https://p',
  timeoutMs: 1000,
  sender: {
    name: '아몬드영',
    zip: '14521',
    baseAddress: '경기도 부천시 오정구 신흥로511번길 80',
    detailAddress: '1층',
    tel: '032-000-1234',
  },
  boxType: 'A',
  payType: 'CD',
};

const RECIPIENT = {
  recipientName: '김한진',
  phone: '010-1234-5678',
  postalCode: '04533',
  roadAddress: '서울특별시 중구 남대문로 63',
  detailAddress: '한진빌딩 10층',
  deliveryNote: '문앞',
};

const CTX: IssueContext = {
  shipmentId: 's1',
  status: 'planned',
  manifestVersion: 1,
  recipientSnapshot: RECIPIENT,
  lines: [
    { productName: '토익 Speaking', quantity: 1, skuId: 'k1' },
    { productName: '펜', quantity: 2, skuId: 'k2' },
  ],
  entrancePassword: '#1234',
};

const LABEL_DATA = {
  hub_cod: 'NX',
  tml_cod: '150',
  dom_mid: 'Z',
  cen_cod: '1050',
  cen_nam: '해운(집)',
  s_tml_cod: '000',
  s_tml_nam: '본사',
  grp_rnk: 'A1',
  es_nam: '권순천',
  es_cod: '888',
  prt_add: '소공동 51 한진빌딩',
  dom_rgn: '1',
};

const input = (over: Partial<BuildHanjinLabelInput> = {}): BuildHanjinLabelInput => ({
  waybill: { trackingNo: '452716978431', custOrdNo: 'AY0123456789ABCDEFGHJKMNPQRS', labelData: LABEL_DATA },
  ctx: CTX,
  config: CONFIG,
  now: new Date('2026-09-27T01:00:00Z'),
  ...over,
});

describe('buildHanjinLabelData', () => {
  it('분류필드를 labelData 에서 옮긴다', () => {
    expect(buildHanjinLabelData(input()).sort).toEqual({
      hubCode: 'NX',
      terminalCode: '150',
      midCode: 'Z',
      centerCode: '1050',
      centerName: '해운(집)',
      originTerminalCode: '000',
      originTerminalName: '본사',
      routeRank: 'A1',
      courierName: '권순천',
      courierSortCode: '888',
      addressSummary: '소공동 51 한진빌딩',
    });
  });

  it('운송장번호를 사람용 4-4-4 로도 만든다', () => {
    const d = buildHanjinLabelData(input());
    expect([d.trackingNo, d.trackingNoDisplay]).toEqual(['452716978431', '4527-1697-8431']);
  });

  it.each([
    ['1', '수도권'],
    ['2', '지방'],
    ['6', '지방'],
    ['7', '제주'],
    ['9', '도서'],
    ['D', 'D'],
  ])('⑮ 권역 %s → %s (모르는 값은 원문)', (code, text) => {
    const d = buildHanjinLabelData(input({ waybill: { ...input().waybill, labelData: { ...LABEL_DATA, dom_rgn: code } } }));
    expect(d.regionText).toBe(text);
  });

  it('⑬ CD 는 「발지신용」', () => {
    expect(buildHanjinLabelData(input()).freightText).toBe('발지신용');
  });

  it.each(['PP', 'CC', 'CT'])('⑬ %s 는 운송료 금액이 필요해 지원하지 않는다', (payType) => {
    expect(() => buildHanjinLabelData(input({ config: { ...CONFIG, payType } }))).toThrow(new RegExp(`payType ${payType}`));
  });

  it('배송메시지는 발급 때와 같은 합성(메모 + 공동현관)', () => {
    expect(buildHanjinLabelData(input()).deliveryMessage).toBe('문앞 (공동현관 #1234)');
  });

  it('배송메시지가 없으면 빈 문자열', () => {
    const ctx = { ...CTX, recipientSnapshot: { ...RECIPIENT, deliveryNote: '' }, entrancePassword: null };
    expect(buildHanjinLabelData(input({ ctx })).deliveryMessage).toBe('');
  });

  it('품명은 발급 때와 같은 규칙', () => {
    expect(buildHanjinLabelData(input()).commodityName).toBe('토익 Speaking 외 1건');
  });

  it('수하인은 원본으로, 송하인은 설정에서 — 마스킹은 템플릿의 일이다', () => {
    const d = buildHanjinLabelData(input());
    expect(d.recipient).toEqual({
      name: '김한진',
      phone: '010-1234-5678',
      baseAddress: '서울특별시 중구 남대문로 63',
      detailAddress: '한진빌딩 10층',
    });
    expect(d.sender).toEqual({ name: '아몬드영', phone: '032-000-1234', baseAddress: '경기도 부천시 오정구 신흥로511번길 80' });
  });

  it('출력일자는 런타임 TZ 와 무관하게 KST 날짜다 (UTC 15:30 = KST 다음 날 00:30)', () => {
    expect(buildHanjinLabelData(input({ now: new Date('2026-09-27T15:30:00Z') })).printedDate).toBe('2026-09-28');
  });

  it('박스 1/1, 운임Type·출고번호', () => {
    const d = buildHanjinLabelData(input());
    expect([d.boxIndex, d.boxCount, d.boxType, d.custOrdNo]).toEqual([1, 1, 'A', 'AY0123456789ABCDEFGHJKMNPQRS']);
  });

  it('labelData 의 숫자 값은 문자열로, 없는 키는 빈 문자열로', () => {
    const d = buildHanjinLabelData(input({ waybill: { ...input().waybill, labelData: { hub_cod: 12 } } }));
    expect([d.sort.hubCode, d.sort.terminalCode]).toEqual(['12', '']);
  });

  it('demo 캐리어의 가짜 값으로도 만든다', () => {
    const demo = { ...LABEL_DATA, hub_cod: 'DEMO', tml_cod: 'DEMO', dom_rgn: 'D', prt_add: '서울 종로구 세종대로 1 101' };
    const d = buildHanjinLabelData(input({ waybill: { trackingNo: '912345678901', custOrdNo: 'AYX', labelData: demo } }));
    expect([d.sort.hubCode, d.regionText, d.trackingNoDisplay]).toEqual(['DEMO', 'D', '9123-4567-8901']);
  });

  it('운송장번호·출고번호가 없으면 던진다(assertDispatchable 뒤라 불변식 위반)', () => {
    expect(() => buildHanjinLabelData(input({ waybill: { ...input().waybill, custOrdNo: null } }))).toThrow(/custOrdNo/);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.spec.ts`
Expected: FAIL — `Cannot find module './hanjin-label-data'`.

- [ ] **Step 4: 구현**

`W/carrier/hanjin/label/hanjin-label-data.ts`:

```ts
import type { HanjinConfig } from '../hanjin.config';
import type { IssueContext, WaybillRow } from '../../../waybill.types';
import { commodityNameOf, composeMessage, parseRecipient } from '../../../waybill-request.assembler';

/** print-wbl 분류필드(정본 §3.2). labelData 에 없으면 '' — demo 캐리어는 일부만 채운다. */
export interface HanjinSortFields {
  hubCode: string; // ① hub_cod
  terminalCode: string; // ② tml_cod (③ CODE128 데이터)
  midCode: string; // ④ dom_mid
  centerCode: string; // ⑤ cen_cod
  centerName: string; // ⑥ cen_nam
  originTerminalCode: string; // ⑦ s_tml_cod
  originTerminalName: string; // ⑧ s_tml_nam
  routeRank: string; // ⑩ grp_rnk
  courierName: string; // ⑪ es_nam
  courierSortCode: string; // ⑯ es_cod
  addressSummary: string; // ⑫ prt_add
}

/**
 * 템플릿이 그리는 값 전부 — **마스킹 전 원본**이다. 어느 면에 무엇을 가리는지는 면을 아는 템플릿이 정한다.
 */
export interface HanjinLabelData {
  trackingNo: string;
  trackingNoDisplay: string;
  sort: HanjinSortFields;
  regionText: string; // ⑮
  freightText: string; // ⑬
  recipient: { name: string; phone: string; baseAddress: string; detailAddress: string };
  sender: { name: string; phone: string; baseAddress: string };
  deliveryMessage: string; // ⑭
  commodityName: string;
  boxType: string; // 운임Type
  custOrdNo: string; // 출고번호
  printedDate: string; // YYYY-MM-DD, Asia/Seoul
  boxIndex: number; // shipment 하나 = 박스 하나
  boxCount: number;
}

export interface BuildHanjinLabelInput {
  waybill: Pick<WaybillRow, 'trackingNo' | 'custOrdNo' | 'labelData'>;
  ctx: IssueContext;
  config: HanjinConfig;
  now: Date;
}

// ⑮ dom_rgn (정본 §3.2): 1 수도권 / 2~6 지방 / 7 제주 / 9 도서.
const REGION_TEXT: Readonly<Record<string, string>> = {
  '1': '수도권',
  '2': '지방',
  '3': '지방',
  '4': '지방',
  '5': '지방',
  '6': '지방',
  '7': '제주',
  '9': '도서',
};

// ⑬ 운임지급 기준. 선·착불(PP/CC)은 운송료 금액을 반드시 찍어야 하는데 우리에게 출처가 없다(스펙 §4.2).
// CD 의 명칭은 포털 FS 샘플 표기를 따른다(정본 §4.2 는 「받지신용」 — 스펙 §12 열린 질문).
const FREIGHT_TEXT: Readonly<Record<string, string>> = { CD: '발지신용' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function kstDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function buildHanjinLabelData({ waybill, ctx, config, now }: BuildHanjinLabelInput): HanjinLabelData {
  const freightText = FREIGHT_TEXT[config.payType];
  if (!freightText) {
    throw new Error(
      `Hanjin label: payType ${config.payType} requires a freight amount on the label, which is unsupported (only CD)`,
    );
  }
  const { trackingNo, custOrdNo } = waybill;
  if (!trackingNo || !custOrdNo) throw new Error('Hanjin label: waybill has no trackingNo or custOrdNo');

  const raw = isRecord(waybill.labelData) ? waybill.labelData : {};
  const field = (key: string): string => {
    const v = raw[key];
    return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  };
  const rc = parseRecipient(ctx.recipientSnapshot);
  const regionCode = field('dom_rgn');

  return {
    trackingNo,
    trackingNoDisplay: /^\d{12}$/.test(trackingNo) ? trackingNo.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3') : trackingNo,
    sort: {
      hubCode: field('hub_cod'),
      terminalCode: field('tml_cod'),
      midCode: field('dom_mid'),
      centerCode: field('cen_cod'),
      centerName: field('cen_nam'),
      originTerminalCode: field('s_tml_cod'),
      originTerminalName: field('s_tml_nam'),
      routeRank: field('grp_rnk'),
      courierName: field('es_nam'),
      courierSortCode: field('es_cod'),
      addressSummary: field('prt_add'),
    },
    regionText: REGION_TEXT[regionCode] ?? regionCode,
    freightText,
    recipient: {
      name: rc.recipientName,
      phone: rc.phone,
      baseAddress: rc.roadAddress,
      detailAddress: rc.detailAddress,
    },
    sender: { name: config.sender.name, phone: config.sender.tel, baseAddress: config.sender.baseAddress },
    deliveryMessage: composeMessage(rc.deliveryNote, ctx.entrancePassword) ?? '',
    commodityName: commodityNameOf(ctx.lines),
    boxType: config.boxType,
    custOrdNo,
    printedDate: kstDate(now),
    boxIndex: 1,
    boxCount: 1,
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label apps/core/src/modules/fulfillment/waybill/waybill-request.assembler.spec.ts`
Expected: PASS (마스킹 25건 포함 전부).

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/waybill-request.assembler.ts apps/core/src/modules/fulfillment/waybill/waybill-request.assembler.spec.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.spec.ts
git commit -F - <<'EOF'
feat(core): 한진 라벨 데이터를 발급과 같은 함수로 조립한다 (#913)

배송메시지·품명은 발급 assembler 의 함수를 export 해 재사용한다 — 한진 등록값과 라벨이 갈리지 않게.
⑬ 은 CD(발지신용)만 지원한다(선·착불은 운송료 금액 출처가 없다).

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS
EOF
```

---

### Task 5: SVG 텍스트 헬퍼 + NS 템플릿

**Files:**
- Create: `W/label/svg-text.ts`, `W/carrier/hanjin/label/hanjin-ns-template.ts`
- Test: `W/label/svg-text.spec.ts`, `W/carrier/hanjin/label/hanjin-ns-template.spec.ts`

**Interfaces:**
- Consumes: `LabelSpec`·`BarcodePlacement`(Task 2), `HanjinLabelData`(Task 4), `maskName`·`maskPhone`·`maskAddress`(커밋됨)
- Produces:
  - `svg-text.ts`: `escapeXml(s: string): string`, `textWidthMm(text: string, sizePt: number): number`, `fitText(text: string, maxWidthMm: number, sizePt: number): string`, `fitSizePt(text: string, maxWidthMm: number, maxPt: number, minPt: number): number`, `PT_TO_MM = 0.3528`
  - `hanjin-ns-template.ts`: `renderHanjinNsLabel(d: HanjinLabelData): LabelSpec` — SVG 는 `<g id="left">`·`<g id="customer-copy">`·`<g id="delivery-slip">` 세 블록

- [ ] **Step 1: svg-text 실패하는 테스트**

`W/label/svg-text.spec.ts`:

```ts
import { escapeXml, fitSizePt, fitText, textWidthMm } from './svg-text';

describe('escapeXml', () => {
  it('XML 특수문자 다섯을 엔티티로 바꾼다', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  });
});

describe('textWidthMm', () => {
  it('한글은 1em, 그 외는 0.6em 으로 근사한다 (10pt = 3.528mm)', () => {
    expect(textWidthMm('한', 10)).toBeCloseTo(3.528, 3);
    expect(textWidthMm('a', 10)).toBeCloseTo(3.528 * 0.6, 3);
  });
});

describe('fitText', () => {
  it('칸에 들어가면 그대로', () => {
    expect(fitText('문앞', 50, 10)).toBe('문앞');
  });
  it('넘치면 말줄임을 붙여 칸 폭 안으로 자른다', () => {
    const long = '가'.repeat(100);
    const out = fitText(long, 30, 10);
    expect(out.endsWith('…')).toBe(true);
    expect(textWidthMm(out, 10)).toBeLessThanOrEqual(30);
  });
});

describe('fitSizePt', () => {
  it('들어가면 최대 크기', () => {
    expect(fitSizePt('AY01', 42, 10, 5)).toBe(10);
  });
  it('안 들어가면 0.5pt 씩 줄여 들어가는 가장 큰 크기', () => {
    const text = `출고번호: ${'A'.repeat(28)}`;
    const pt = fitSizePt(text, 42, 10, 5);
    expect(textWidthMm(text, pt)).toBeLessThanOrEqual(42);
    expect(textWidthMm(text, pt + 0.5)).toBeGreaterThan(42);
  });
  it('최소 크기로도 안 들어가면 최소 크기', () => {
    expect(fitSizePt('A'.repeat(500), 42, 10, 5)).toBe(5);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/svg-text.spec.ts`
Expected: FAIL — `Cannot find module './svg-text'`.

- [ ] **Step 2: svg-text 구현**

`W/label/svg-text.ts`:

```ts
/** SVG 텍스트 헬퍼. 폰트 메트릭 없이 칸 폭을 판정한다 — 라벨 칸 넘침만 막으면 되므로 근사로 충분하다. */

export const PT_TO_MM = 0.3528;

// 전각(한글 음절·자모, CJK, 전각 기호)은 1em, 나머지는 0.6em. 나눔고딕 라틴 평균보다 약간 넉넉하게 잡았다.
const WIDE = /[ᄀ-ᇿ　-鿿가-힣＀-￯]/;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function textWidthMm(text: string, sizePt: number): number {
  const em = Array.from(text).reduce((sum, ch) => sum + (WIDE.test(ch) ? 1 : 0.6), 0);
  return em * sizePt * PT_TO_MM;
}

/** 칸 폭을 넘으면 뒤를 잘라 `…` 를 붙인다. 줄바꿈하지 않는다 — 선인쇄 칸을 넘는다. */
export function fitText(text: string, maxWidthMm: number, sizePt: number): string {
  if (textWidthMm(text, sizePt) <= maxWidthMm) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && textWidthMm(`${chars.join('')}…`, sizePt) > maxWidthMm) chars.pop();
  return `${chars.join('')}…`;
}

/** 자르면 안 되는 식별자용 — 칸에 들어가는 가장 큰 크기(0.5pt 단위, 최소 minPt). */
export function fitSizePt(text: string, maxWidthMm: number, maxPt: number, minPt: number): number {
  for (let pt = maxPt; pt > minPt; pt -= 0.5) {
    if (textWidthMm(text, pt) <= maxWidthMm) return pt;
  }
  return minPt;
}
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/svg-text.spec.ts`
Expected: PASS.

- [ ] **Step 3: NS 템플릿 실패하는 테스트**

`W/carrier/hanjin/label/hanjin-ns-template.spec.ts`:

```ts
import type { HanjinLabelData } from './hanjin-label-data';
import { renderHanjinNsLabel } from './hanjin-ns-template';

const DATA: HanjinLabelData = {
  trackingNo: '452716978431',
  trackingNoDisplay: '4527-1697-8431',
  sort: {
    hubCode: 'NX',
    terminalCode: '150',
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

const block = (svg: string, id: string): string => {
  const m = new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`).exec(svg);
  if (!m) throw new Error(`block ${id} not found`);
  return m[1];
};

describe('renderHanjinNsLabel', () => {
  const spec = renderHanjinNsLabel(DATA);

  it('NS 는 가로 200mm × 세로 102mm, viewBox 도 mm', () => {
    expect([spec.widthMm, spec.heightMm]).toEqual([200, 102]);
    expect(spec.svg).toContain('viewBox="0 0 200 102"');
  });

  describe('개인정보 — 받는고객용(배달표 외)은 전부 가린다', () => {
    const copy = block(spec.svg, 'customer-copy');
    it('받는분 성명·연락처·상세주소 원본이 없다', () => {
      expect(copy).not.toContain('김한진');
      expect(copy).not.toContain('5678');
      expect(copy).not.toContain('한진빌딩 10층');
    });
    it('받는분은 마스킹 형태로 있다', () => {
      expect(copy).toContain('김*진');
      expect(copy).toContain('010-1234-****');
      expect(copy).toContain('서울특별시 중구 남대문로 63 ****');
    });
    it('보낸분도 가린다', () => {
      expect(copy).not.toContain('아몬드영');
      expect(copy).not.toContain('032-000-1234');
      expect(copy).toContain('아*드*'); // 네 글자: 2·4번째
      expect(copy).toContain('032-000-****');
      expect(copy).toContain('경기도 부천시 오정구 신흥로511번길 80 ****');
    });
  });

  describe('개인정보 — 배달표', () => {
    const slip = block(spec.svg, 'delivery-slip');
    it('받는분 주소는 원본(기본 + 상세)', () => {
      expect(slip).toContain('서울특별시 중구 남대문로 63 한진빌딩 10층');
    });
    it('받는분 성명·연락처는 여기서도 가린다', () => {
      expect(slip).not.toContain('김한진');
      expect(slip).not.toContain('010-1234-5678');
      expect(slip).toContain('김*진');
    });
    it('보낸분 성명·연락처는 원본, 주소는 미표기', () => {
      expect(slip).toContain('아몬드영');
      expect(slip).toContain('032-000-1234');
      expect(slip).not.toContain('신흥로');
    });
  });

  it('라벨 어디에도 받는분 실명·전체 전화번호가 없다', () => {
    expect(spec.svg).not.toContain('김한진');
    expect(spec.svg).not.toContain('010-1234-5678');
  });

  it('분류코드·운임·권역·출고번호를 찍는다', () => {
    for (const s of ['NX', '150', 'Z', '888', 'A1', '권순천', '1050', '해운(집)', '발지신용', '수도권', '소공동 51 한진빌딩', '2026년 09월 28일', '운임Type:A', 'AY0123456789ABCDEFGHJKMNPQRS', '4527-1697-8431', '1/1']) {
      expect(spec.svg).toContain(s);
    }
  });

  it('바코드는 ITF(운송장번호)와 CODE128(터미널코드) 둘', () => {
    expect(spec.barcodes.map((b) => [b.kind, b.data])).toEqual([
      ['CODE128', '150'],
      ['ITF', '452716978431'],
    ]);
  });

  it('터미널코드가 비면 CODE128 을 빼고 ITF 만 둔다', () => {
    const s = renderHanjinNsLabel({ ...DATA, sort: { ...DATA.sort, terminalCode: '' } });
    expect(s.barcodes.map((b) => b.kind)).toEqual(['ITF']);
  });

  it('고객 입력의 XML 특수문자를 이스케이프한다', () => {
    const s = renderHanjinNsLabel({ ...DATA, deliveryMessage: '<script>&', commodityName: 'A&B "펜"' });
    expect(s.svg).not.toContain('<script>');
    expect(s.svg).toContain('&lt;script&gt;&amp;');
    expect(s.svg).toContain('A&amp;B &quot;펜&quot;');
  });

  it('긴 배송메시지·품명·주소는 말줄임으로 자른다', () => {
    const long = '가'.repeat(200);
    const s = renderHanjinNsLabel({
      ...DATA,
      deliveryMessage: long,
      commodityName: long,
      recipient: { ...DATA.recipient, detailAddress: long },
    });
    expect(s.svg).not.toContain(long);
    expect((s.svg.match(/…/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('출고번호는 자르지 않고 글자를 줄인다', () => {
    expect(spec.svg).toContain('출고번호: AY0123456789ABCDEFGHJKMNPQRS');
  });

  it('모든 텍스트·도형 좌표가 라벨 안에 있다', () => {
    const xs = [...spec.svg.matchAll(/\bx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const ys = [...spec.svg.matchAll(/\by="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(200);
    expect(Math.max(...ys)).toBeLessThanOrEqual(102);
    for (const b of spec.barcodes) expect(b.yMm + b.heightMm).toBeLessThanOrEqual(102);
  });

  it('demo 캐리어 값으로도 그린다', () => {
    const demo = renderHanjinNsLabel({ ...DATA, regionText: 'D', sort: { ...DATA.sort, hubCode: 'DEMO', terminalCode: 'DEMO' } });
    expect(demo.svg).toContain('DEMO');
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-ns-template.spec.ts`
Expected: FAIL — `Cannot find module './hanjin-ns-template'`.

- [ ] **Step 4: NS 템플릿 구현**

좌표는 포털 NS 샘플(`https://developers.hanjin.com/files/ns_new.jpg`)에 5mm 격자를 겹쳐 잰 값이다(가로 200 × 세로 102mm, 우측 절반은 x+100). `y` 는 글자 **기준선**이다. 현물 검수(#920)에서 보정될 값이라 상수 표로 둔다.

`W/carrier/hanjin/label/hanjin-ns-template.ts`:

```ts
import type { BarcodePlacement, LabelSpec } from '../../../label/label-model';
import { escapeXml, fitSizePt, fitText, PT_TO_MM } from '../../../label/svg-text';
import type { HanjinLabelData } from './hanjin-label-data';
import { maskAddress, maskName, maskPhone } from './hanjin-label-masking';

/**
 * 한진 NS형(좌 100 + 우 100 = 200 × 102mm) 자체출력 운송장(#913).
 *
 * **검은색 요소(가변 데이터)만** 그린다 — 테두리·영역 캡션·로고·개인정보 안내 문구는 한진 라벨지에
 * 선인쇄돼 있다. 좌표는 포털 NS 샘플 실측(mm), y 는 기준선, 폰트 크기는 필드표의 pt.
 *
 * 면별 마스킹(정본 §3.3, 2026-09-27 정정):
 *   받는고객용(배달표 외) — 받는분·보낸분 전부 마스킹
 *   배달표 — 받는분 성명·연락처 마스킹 + 주소 원본 / 보낸분 성명·연락처 원본 + 주소 미표기
 */

const WIDTH_MM = 200;
const HEIGHT_MM = 102;
const R = 100; // 우측 절반 원점

interface TextEl {
  x: number;
  y: number;
  pt: number;
  text: string;
  bold?: boolean;
  anchor?: 'middle' | 'end';
}

function text(t: TextEl): string {
  const weight = t.bold ? ' font-weight="700"' : '';
  const anchor = t.anchor ? ` text-anchor="${t.anchor}"` : '';
  return `<text x="${t.x}" y="${t.y}" font-size="${(t.pt * PT_TO_MM).toFixed(2)}"${weight}${anchor}>${escapeXml(t.text)}</text>`;
}

function rect(x: number, y: number, w: number, h: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="0.4"/>`;
}

function hline(x1: number, x2: number, y: number): string {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#000" stroke-width="0.3"/>`;
}

function koreanDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

export function renderHanjinNsLabel(d: HanjinLabelData): LabelSpec {
  const s = d.sort;
  const rc = d.recipient;
  const sd = d.sender;

  // ── 좌측: 분류 + 품명 + 배송요구사항 + 권역 ─────────────────────────────
  const left = [
    text({ x: 3.8, y: 15.5, pt: 40, bold: true, text: s.hubCode }), // ①
    text({ x: 25, y: 15.5, pt: 40, bold: true, text: s.terminalCode }), // ②
    text({ x: 55, y: 15.5, pt: 40, bold: true, text: s.midCode }), // ④
    text({ x: 70.5, y: 15.5, pt: 40, bold: true, text: s.courierSortCode }), // ⑯
    text({ x: 57.8, y: 5.2, pt: 9, bold: true, text: `P. ${d.boxIndex}` }),
    text({ x: 69.5, y: 5.2, pt: 9, bold: true, text: `${d.boxIndex}/${d.boxCount}` }),
    text({ x: 42.5, y: 21.5, pt: 9, anchor: 'middle', text: s.centerCode }), // ⑤
    text({ x: 42.5, y: 25, pt: 9, anchor: 'middle', text: s.centerName }), // ⑥
    text({ x: 55.5, y: 25.5, pt: 20, bold: true, text: s.routeRank }), // ⑩
    text({ x: 77, y: 25.5, pt: 20, bold: true, text: s.courierName }), // ⑪
    text({ x: 1.5, y: 32.3, pt: 10, text: fitText(d.commodityName, 93, 10) }), // 품명
    hline(1, 96, 33.5),
    text({ x: 2, y: 89.3, pt: 9, text: fitText(d.deliveryMessage, 66, 9) }), // ⑭
    rect(70, 90.7, 27.3, 8), // ⑮ 상자
    text({ x: 83.6, y: 96.9, pt: 16, bold: true, anchor: 'middle', text: d.regionText }), // ⑮
  ];

  // ── 우측 상단: 받는고객용 = 배달표 외 → 전부 마스킹 ──────────────────────
  const customerCopy = [
    text({ x: R + 19, y: 6.6, pt: 14, bold: true, text: d.trackingNoDisplay }), // ⑨
    text({ x: R + 8.5, y: 10.5, pt: 10, text: maskName(rc.name) }),
    text({ x: R + 96, y: 10.5, pt: 10, anchor: 'end', text: maskPhone(rc.phone) }),
    text({ x: R + 8.5, y: 14.4, pt: 10, text: fitText(maskAddress(rc.baseAddress), 87, 10) }),
    text({ x: R + 8.5, y: 23.5, pt: 10, text: maskName(sd.name) }),
    text({ x: R + 96, y: 23.5, pt: 10, anchor: 'end', text: maskPhone(sd.phone) }),
    text({ x: R + 8.5, y: 27.5, pt: 10, text: fitText(maskAddress(sd.baseAddress), 87, 10) }),
  ];

  // ── 우측 하단: 배달표 ───────────────────────────────────────────────────
  const custText = `출고번호: ${d.custOrdNo}`;
  const deliverySlip = [
    text({ x: R + 6, y: 42.7, pt: 24, bold: true, text: s.routeRank }), // ⑩
    text({ x: R + 26.7, y: 42.7, pt: 22, bold: true, text: s.courierName }), // ⑪
    text({ x: R + 52.3, y: 42.7, pt: 25, bold: true, text: `${s.hubCode} ${s.terminalCode}` }), // ①②
    text({ x: R + 79.6, y: 42.7, pt: 17, text: s.centerCode }), // ⑤
    rect(R + 6.8, 43.4, 37, 6.6), // ⑬ 상자
    text({ x: R + 8.2, y: 48.8, pt: 14, bold: true, text: d.freightText }), // ⑬
    text({ x: R + 6, y: 54.3, pt: 10, text: koreanDate(d.printedDate) }),
    text({ x: R + 6, y: 59.1, pt: 10, text: `수량: ${d.boxCount}` }),
    text({ x: R + 26, y: 59.1, pt: 10, text: `운임Type:${d.boxType}` }),
    text({ x: R + 6.7, y: 63.4, pt: fitSizePt(custText, 42, 10, 5), text: custText }),
    text({ x: R + 68.8, y: 66.7, pt: 9, anchor: 'middle', text: d.trackingNoDisplay }), // ⑨ ITF 아래
    text({ x: R + 69.8, y: 71.5, pt: 9, text: `발지: ${s.originTerminalCode}` }), // ⑦
    text({ x: R + 86.7, y: 71.5, pt: 9, text: s.originTerminalName }), // ⑧
    text({ x: R + 6, y: 75.6, pt: 9, text: fitText(d.deliveryMessage, 90, 9) }), // ⑭
    text({ x: R + 8.7, y: 79.5, pt: 10, text: maskName(rc.name) }),
    text({ x: R + 96, y: 79.5, pt: 10, anchor: 'end', text: maskPhone(rc.phone) }),
    text({ x: R + 8.7, y: 84, pt: 10, text: fitText(`${rc.baseAddress} ${rc.detailAddress}`, 87, 10) }),
    text({ x: R + 8.7, y: 94.8, pt: 19, bold: true, text: fitText(s.addressSummary, 87, 19) }), // ⑫
    text({ x: R + 8.7, y: 100.3, pt: 9, text: sd.name }),
    text({ x: R + 96, y: 100.3, pt: 9, anchor: 'end', text: sd.phone }),
  ];

  const barcodes: BarcodePlacement[] = [
    ...(s.terminalCode
      ? [{ kind: 'CODE128' as const, data: s.terminalCode, xMm: 4.4, yMm: 18.3, heightMm: 8, moduleDots: 2 }] // ③
      : []),
    { kind: 'ITF', data: d.trackingNo, xMm: R + 49.1, yMm: 43.8, heightMm: 20, moduleDots: 3, wideRatio: 2.5 },
  ];

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH_MM}mm" height="${HEIGHT_MM}mm" viewBox="0 0 ${WIDTH_MM} ${HEIGHT_MM}" font-family="NanumGothic">`,
    `<g id="left">${left.join('')}</g>`,
    `<g id="customer-copy">${customerCopy.join('')}</g>`,
    `<g id="delivery-slip">${deliverySlip.join('')}</g>`,
    '</svg>',
  ].join('');

  return { widthMm: WIDTH_MM, heightMm: HEIGHT_MM, svg, barcodes };
}
```

`'CODE128' as const` 는 리터럴 좁히기이지 타입 우회가 아니다(`BarcodeKind` 유니온에 맞춘다).

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label apps/core/src/modules/fulfillment/waybill/label`
Expected: PASS (전부).

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/label/svg-text.ts apps/core/src/modules/fulfillment/waybill/label/svg-text.spec.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-ns-template.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-ns-template.spec.ts
git commit -F - <<'EOF'
feat(core): 한진 NS형 운송장 템플릿을 면별 마스킹과 함께 그린다 (#913)

검은색 요소만 그린다 — 테두리·캡션·로고는 한진 라벨지에 선인쇄돼 있다.
받는분 성명·연락처는 모든 면에서 가리고, 원본 주소는 배달표에만 둔다.

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS
EOF
```

---

### Task 6: 가드 + 파이프라인 + API

**Files:**
- Modify: `W/waybill.constants.ts`, `W/waybill.tokens.ts`, `W/dto/waybill.dto.ts`, `W/waybill.module.ts`
- Create: `W/waybill-label.manager.ts`, `W/waybill-label.service.ts`, `W/waybill-label.controller.ts`
- Test: `W/waybill-label.manager.spec.ts`, `W/waybill-label.manager.integration.spec.ts`, `W/waybill-label.controller.spec.ts`

**Interfaces:**
- Consumes: `WaybillManager.assertDispatchable(shipmentId: string, tx?: DbTx): Promise<WaybillRow>`(기존), `WaybillReader.loadIssueContext(trx: DbTx, shipmentId: string): Promise<IssueContext>`(기존), `buildHanjinLabelData`(Task 4), `renderHanjinNsLabel`(Task 5), `SvgRasterizer`(Task 3), `encodeZpl`·`mmToDots`(Task 2)
- Produces: `interface WaybillLabel { waybillId: string; trackingNo: string; format: 'zpl'; data: string }`, `assertLabelAvailable(wb: Pick<WaybillRow, 'id' | 'source' | 'carrier' | 'labelData'>): void`, `WaybillLabelManager.render(shipmentId: string, tx?: DbTx): Promise<WaybillLabel>`, `WaybillLabelService.renderLabel(shipmentId: string, tx?: DbTx): Promise<WaybillLabel>`, 라우트 `GET shipments/:shipmentId/waybill/label`

- [ ] **Step 1: 상수·토큰 추가**

`W/waybill.constants.ts` — `WAYBILL` 에 추가:

```ts
  // 운송장 라벨 ^GF 의 ZPL ACS 압축. 창고 XP-DT108B(ZPL 에뮬레이션)에서 실물 확인 전까지 끈다(#913 스펙 §10-3).
  LABEL_ZPL_COMPRESS: false,
```

`ERROR` 에 추가:

```ts
    LABEL_UNAVAILABLE: 'WAYBILL_LABEL_UNAVAILABLE',
```

`W/waybill.tokens.ts` 에 추가:

```ts
// 운송장 라벨 출력일자용 시계. 기본은 new Date() — 테스트가 고정 시각을 넣는다(#913).
export const WAYBILL_LABEL_CLOCK = Symbol('WAYBILL_LABEL_CLOCK');
```

- [ ] **Step 2: 가드 단위 테스트 (실패)**

`W/waybill-label.manager.spec.ts`:

```ts
import { ConflictError } from '@app/shared';
import { assertLabelAvailable } from './waybill-label.manager';

const base = { id: 'w1', source: 'carrier' as const, carrier: 'HANJIN' as const, labelData: { hub_cod: 'NX' } };

describe('assertLabelAvailable', () => {
  it('한진이 발급한 운송장은 통과', () => {
    expect(() => assertLabelAvailable(base)).not.toThrow();
  });

  it('수기 등록 운송장은 409 WAYBILL_LABEL_UNAVAILABLE', () => {
    const run = () => assertLabelAvailable({ ...base, source: 'manual', labelData: null });
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });

  it('한진이 아닌 캐리어는 409 WAYBILL_LABEL_UNAVAILABLE', () => {
    const run = () => assertLabelAvailable({ ...base, carrier: 'CJ' });
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });

  it('캐리어 발급인데 labelData 가 없으면 500(불변식 위반) — 도메인 에러가 아니다', () => {
    const run = () => assertLabelAvailable({ ...base, labelData: null });
    expect(run).toThrow(/labelData/);
    expect(run).not.toThrow(ConflictError);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/waybill-label.manager.spec.ts`
Expected: FAIL — `Cannot find module './waybill-label.manager'`.

- [ ] **Step 3: 매니저 구현**

`W/waybill-label.manager.ts`:

```ts
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema } from '../../inventory/schema/inventory.schema';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import { buildHanjinLabelData } from './carrier/hanjin/label/hanjin-label-data';
import { renderHanjinNsLabel } from './carrier/hanjin/label/hanjin-ns-template';
import { mmToDots } from './label/label-model';
import { SvgRasterizer } from './label/svg-rasterizer';
import { encodeZpl } from './label/zpl-encoder';
import { WAYBILL } from './waybill.constants';
import { WaybillManager } from './waybill.manager';
import { WaybillReader } from './waybill.reader';
import { HANJIN_CONFIG, WAYBILL_LABEL_CLOCK } from './waybill.tokens';
import type { WaybillRow } from './waybill.types';

export interface WaybillLabel {
  waybillId: string;
  trackingNo: string;
  format: 'zpl';
  data: string;
}

/** assertDispatchable 뒤에 거는 라벨 전용 조건(스펙 §5 의 4~6). */
export function assertLabelAvailable(wb: Pick<WaybillRow, 'id' | 'source' | 'carrier' | 'labelData'>): void {
  if (wb.source !== 'carrier') {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_UNAVAILABLE}: manual waybill ${wb.id} has no carrier label data`);
  }
  if (wb.carrier !== 'HANJIN') {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_UNAVAILABLE}: no label template for carrier ${wb.carrier}`);
  }
  if (wb.labelData === null || wb.labelData === undefined) {
    throw new Error(`waybill ${wb.id} was issued by a carrier but has no labelData`);
  }
}

/**
 * 한진 자체출력 운송장 ZPL(#913). 가드는 assertDispatchable 을 그대로 쓴다 — «출력 가능 ⇔ 출고 가능».
 * 라벨은 발급 때의 사본이 아니라 현재 shipment 로 다시 조립하는데, 매니페스트 버전·수하인 해시가
 * 같다는 게 확인됐으므로 한진 등록값과 같다.
 */
@Injectable()
export class WaybillLabelManager {
  constructor(
    private readonly waybills: WaybillManager,
    private readonly reader: WaybillReader,
    private readonly rasterizer: SvgRasterizer,
    @Inject(HANJIN_CONFIG) private readonly config: HanjinConfig,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
    @Optional() @Inject(WAYBILL_LABEL_CLOCK) private readonly now: () => Date = () => new Date(),
  ) {}

  async render(shipmentId: string, tx?: DbTx): Promise<WaybillLabel> {
    const { waybill, ctx } = await this.dbService.run(async (trx) => {
      const waybill = await this.waybills.assertDispatchable(shipmentId, trx);
      assertLabelAvailable(waybill);
      const ctx = await this.reader.loadIssueContext(trx, shipmentId);
      return { waybill, ctx };
    }, tx);

    const spec = renderHanjinNsLabel(buildHanjinLabelData({ waybill, ctx, config: this.config, now: this.now() }));
    const bitmap = this.rasterizer.rasterize(spec.svg, mmToDots(spec.widthMm));
    const data = encodeZpl(bitmap, spec.barcodes, { compress: WAYBILL.LABEL_ZPL_COMPRESS });
    return { waybillId: waybill.id, trackingNo: waybill.trackingNo ?? '', format: 'zpl', data };
  }
}
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/waybill-label.manager.spec.ts`
Expected: PASS.

- [ ] **Step 4: 서비스·DTO·컨트롤러 + 컨트롤러 테스트 (실패 먼저)**

`W/waybill-label.controller.spec.ts`:

```ts
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { WaybillLabelController } from './waybill-label.controller';

describe('WaybillLabelController', () => {
  it('label 은 shipmentId 를 서비스에 그대로 넘긴다', async () => {
    const svc = { renderLabel: jest.fn().mockResolvedValue({ waybillId: 'w1', trackingNo: 'T', format: 'zpl', data: '^XA^XZ' }) };
    const controller = new WaybillLabelController(svc as never);
    await expect(controller.label('s1')).resolves.toMatchObject({ format: 'zpl' });
    expect(svc.renderLabel).toHaveBeenCalledWith('s1');
  });

  it('창고 작업 스코프를 요구한다', () => {
    expect(Reflect.getMetadata('required_scopes', WaybillLabelController.prototype.label)).toEqual([
      FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
    ]);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/waybill-label.controller.spec.ts`
Expected: FAIL — `Cannot find module './waybill-label.controller'`.

`W/waybill-label.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { WaybillLabelManager, type WaybillLabel } from './waybill-label.manager';

@Injectable()
export class WaybillLabelService {
  constructor(private readonly labels: WaybillLabelManager) {}

  renderLabel(shipmentId: string, tx?: DbTx): Promise<WaybillLabel> {
    return this.labels.render(shipmentId, tx);
  }
}
```

`W/dto/waybill.dto.ts` 끝에 추가:

```ts
export class WaybillLabelResponseDto {
  @ApiProperty()
  waybillId: string;

  @ApiProperty()
  trackingNo: string;

  @ApiProperty({ enum: ['zpl'] })
  format: 'zpl';

  @ApiProperty({ description: '프린터에 그대로 보낼 ZPL (ASCII)' })
  data: string;
}
```

`W/waybill-label.controller.ts`:

```ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { WaybillLabelResponseDto } from './dto/waybill.dto';
import { WaybillLabelService } from './waybill-label.service';

@Controller()
@UseGuards(ScopeGuard)
export class WaybillLabelController {
  constructor(private readonly labels: WaybillLabelService) {}

  // 한진 자체출력 운송장(ZPL). 부작용 없음 — 재출력은 같은 호출을 한 번 더(#913).
  @Get('shipments/:shipmentId/waybill/label')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: WaybillLabelResponseDto })
  label(@Param('shipmentId') shipmentId: string) {
    return this.labels.renderLabel(shipmentId);
  }
}
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/waybill-label.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: 모듈 배선**

`W/waybill.module.ts` — import 추가 후 `controllers` 와 `providers` 에 등록:

```ts
import { SvgRasterizer } from './label/svg-rasterizer';
import { WaybillLabelManager } from './waybill-label.manager';
import { WaybillLabelService } from './waybill-label.service';
import { WaybillLabelController } from './waybill-label.controller';
```

```ts
  controllers: [WaybillController, WaybillLabelController],
  providers: [
    // …기존 provider 그대로…
    // 생성자 인자가 함수라 Nest 가 주입할 수 없다 — 팩토리로 만든다. 폰트는 첫 렌더 때 찾는다(#913).
    { provide: SvgRasterizer, useFactory: () => new SvgRasterizer() },
    WaybillLabelManager,
    WaybillLabelService,
  ],
```

- [ ] **Step 6: DB 통합 테스트 작성**

`W/waybill-label.manager.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb, makeDbService } from '../services/__support__';
import {
  fakeCarrierGateway,
  makeSeedDeps,
  seedPlannedShipmentForWaybill,
  WAYBILL_RECIPIENT,
  type SeedDeps,
} from './__support__/waybill-fixtures';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import { SvgRasterizer } from './label/svg-rasterizer';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillLabelManager } from './waybill-label.manager';
import { WaybillManager } from './waybill.manager';
import { WaybillReader } from './waybill.reader';
import { WaybillRepository } from './waybill.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const CONFIG: HanjinConfig = {
  clientId: 'CID',
  apiKey: 'AK',
  secretKey: 'SK',
  contractNo: 'CN',
  orderBaseUrl: 'https://o',
  printBaseUrl: 'https://p',
  timeoutMs: 15000,
  sender: { name: '보내는이', zip: '06236', baseAddress: '서울특별시 강남구 테헤란로 1', detailAddress: '10층', tel: '02-100-2000' },
  boxType: 'A',
  payType: 'CD',
};
const LABEL_DATA = { hub_cod: 'NX', tml_cod: '150', dom_mid: 'Z', cen_cod: '1050', cen_nam: '해운(집)', grp_rnk: 'A1', es_nam: '권순천', es_cod: '888', prt_add: '세종대로 1', dom_rgn: '1', s_tml_cod: '000', s_tml_nam: '본사' };
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('WaybillLabelManager.render (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let deps: SeedDeps;

  // 12자리 숫자 운송장번호를 내는 한진 흉내 게이트웨이 — 기본 fake 는 `WBL-…` 라 ITF 로 못 그린다.
  function build() {
    const trackingNo = String(100_000_000_000 + Math.floor(Math.random() * 899_999_999_999));
    const registry = new CarrierGatewayRegistry([
      fakeCarrierGateway({ allocate: () => Promise.resolve({ waybillNo: trackingNo, labelData: LABEL_DATA }) }),
    ]);
    const svc = makeDbService(db);
    const repo = new WaybillRepository(svc);
    const reader = new WaybillReader(svc);
    const waybills = new WaybillManager(
      reader,
      repo,
      new WaybillIssueMachine(repo, registry, svc),
      registry,
      new FulfillmentCommandService(svc),
      CONFIG,
      svc,
    );
    const labels = new WaybillLabelManager(waybills, reader, new SvgRasterizer(), CONFIG, svc, () => new Date('2026-09-27T01:00:00Z'));
    return { trackingNo, waybills, labels };
  }

  async function issued() {
    const b = build();
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    await b.waybills.issueForShipment(
      seed.shipmentId,
      { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion },
      `idem-${randomUUID()}`,
      actor,
    );
    return { ...b, seed };
  }

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    deps = makeSeedDeps(db);
  });
  afterAll(async () => {
    await client.end();
  });

  it('등록된 한진 운송장이면 ZPL 을 돌려준다', async () => {
    const { labels, seed, trackingNo } = await issued();
    const label = await labels.render(seed.shipmentId);
    expect(label).toMatchObject({ trackingNo, format: 'zpl' });
    expect(label.data.startsWith('^XA')).toBe(true);
    expect(label.data).toContain(`^B2R,160,N,N,N^FD${trackingNo}^FS`);
    expect(label.data).toContain('^BCR,64,N,N,N^FD150^FS');
  });

  it('운송장이 없으면 409 WAYBILL_NOT_DISPATCHABLE', async () => {
    const { labels } = build();
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    await expect(labels.render(seed.shipmentId)).rejects.toThrow(/WAYBILL_NOT_DISPATCHABLE/);
  });

  it('발급 후 수하인이 바뀌면 409 WAYBILL_STALE (라벨이 한진 등록값과 달라진다)', async () => {
    const { labels, seed } = await issued();
    await db
      .update(wmsTables.shipments)
      .set({ recipientSnapshot: { ...WAYBILL_RECIPIENT, detailAddress: 'CHANGED' } })
      .where(eq(wmsTables.shipments.id, seed.shipmentId));
    await expect(labels.render(seed.shipmentId)).rejects.toThrow(/WAYBILL_STALE/);
  });

  it('수기 등록 운송장은 409 WAYBILL_LABEL_UNAVAILABLE', async () => {
    const { waybills, labels } = build();
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    await waybills.registerManual(
      seed.shipmentId,
      { carrier: 'HANJIN', trackingNo: `M-${randomUUID().slice(0, 8)}`, expectedManifestVersion: seed.manifestVersion },
      `idem-${randomUUID()}`,
      actor,
    );
    await expect(labels.render(seed.shipmentId)).rejects.toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });

  it('없는 shipment 는 404 WAYBILL_SHIPMENT_NOT_FOUND', async () => {
    const { labels } = build();
    await expect(labels.render(randomUUID())).rejects.toThrow(/WAYBILL_SHIPMENT_NOT_FOUND/);
  });
});
```

- [ ] **Step 7: 통합 테스트 실행**

로컬 core DB 가 떠 있으면(`docs/local-dev.md`, 메모: 워크트리면 `COMPOSE_PROJECT_NAME=almondyoung-server`):

```bash
dotenv -e apps/core/.env -- npx jest apps/core/src/modules/fulfillment/waybill/waybill-label.manager.integration.spec.ts --runInBand
```

Expected: PASS 5건. DB 가 없으면 `describeIfDb` 로 skip 되는 것을 확인하고(`npx jest …integration.spec.ts` → `skipped`), **DB 로 실행하지 못했다고 보고한다** — 통과로 적지 않는다.

- [ ] **Step 8: 게이트 + 보안 스펙**

```bash
npm run type-check
npx jest scripts/security
npx jest --maxWorkers=2
```

Expected: type-check 는 `probe-image-size` 한 건 외 0. 보안 스펙 통과 — 새 라우트가 IDOR 대상 집합(`idorTarget`)에 들어가 `idor-reviewed.spec.ts` 가 `unlisted` 로 실패하면 멈추고 보고한다(기존 `GET /shipments/:shipmentId/waybill` 는 대상이 아니다). 전체 jest 실패 0.

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/waybill.constants.ts apps/core/src/modules/fulfillment/waybill/waybill.tokens.ts apps/core/src/modules/fulfillment/waybill/dto/waybill.dto.ts apps/core/src/modules/fulfillment/waybill/waybill.module.ts apps/core/src/modules/fulfillment/waybill/waybill-label.manager.ts apps/core/src/modules/fulfillment/waybill/waybill-label.manager.spec.ts apps/core/src/modules/fulfillment/waybill/waybill-label.manager.integration.spec.ts apps/core/src/modules/fulfillment/waybill/waybill-label.service.ts apps/core/src/modules/fulfillment/waybill/waybill-label.controller.ts apps/core/src/modules/fulfillment/waybill/waybill-label.controller.spec.ts
git commit -F - <<'EOF'
feat(core): 한진 운송장 라벨 조회 API 를 연다 — GET shipments/:shipmentId/waybill/label (#913)

가드는 assertDispatchable 을 그대로 쓴다: 출력 가능 ⇔ 출고 가능. 수기 등록·비한진은 409
WAYBILL_LABEL_UNAVAILABLE. labelData 의 첫 소비자다.

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS
EOF
```

---

### Task 7: 미리보기 스크립트 + 문서 갱신

**Files:**
- Create: `scripts/ops/hanjin-label-preview/render.ts`
- Modify: `docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md` (상태 줄), 이슈 #913 본문

**Interfaces:**
- Consumes: `renderHanjinNsLabel`(Task 5), `SvgRasterizer`·`resolveLabelFontDir`(Task 3), `encodeZpl`(Task 2), `@resvg/resvg-js`

- [ ] **Step 1: 미리보기 스크립트 작성**

`scripts/ops/hanjin-label-preview/render.ts` — 합성 데이터라 개인정보가 없다:

```ts
/**
 * 한진 NS 라벨 미리보기(#913). 합성 데이터로 PNG 와 ZPL 을 만든다 — 포털 샘플
 * (https://developers.hanjin.com/files/ns_new.jpg)과 나란히 놓고 위치를 비교하는 용도.
 * 창고 프린터 실물 출력(스펙 §10-3)에는 같이 나오는 .zpl 을 쓴다.
 *
 *   npx tsx scripts/ops/hanjin-label-preview/render.ts <출력 디렉터리>
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Resvg } from '@resvg/resvg-js';
import { renderHanjinNsLabel } from '../../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-ns-template';
import type { HanjinLabelData } from '../../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data';
import { mmToDots } from '../../../apps/core/src/modules/fulfillment/waybill/label/label-model';
import { LABEL_FONT_FILES, resolveLabelFontDir, SvgRasterizer } from '../../../apps/core/src/modules/fulfillment/waybill/label/svg-rasterizer';
import { encodeZpl } from '../../../apps/core/src/modules/fulfillment/waybill/label/zpl-encoder';

const SAMPLE: HanjinLabelData = {
  trackingNo: '452716978431',
  trackingNoDisplay: '4527-1697-8431',
  sort: {
    hubCode: 'NX',
    terminalCode: '150',
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
  recipient: { name: '홍길동', phone: '010-0000-0000', baseAddress: '서울특별시 중구 소공로 88', detailAddress: '테스트 주소2' },
  sender: { name: '아몬드영', phone: '010-0000-1111', baseAddress: '서울특별시 종로구 사직로 161' },
  deliveryMessage: '특이사항 없습니다.',
  commodityName: '토익 Speaking 1권',
  boxType: 'A',
  custOrdNo: 'AY0123456789ABCDEFGHJKMNPQRS',
  printedDate: '2026-09-27',
  boxIndex: 1,
  boxCount: 1,
};

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: npx tsx scripts/ops/hanjin-label-preview/render.ts <out-dir>');
mkdirSync(outDir, { recursive: true });

const spec = renderHanjinNsLabel(SAMPLE);
const fontDir = resolveLabelFontDir();
const png = new Resvg(spec.svg, {
  background: 'white',
  fitTo: { mode: 'width', value: mmToDots(spec.widthMm) },
  font: { loadSystemFonts: false, fontFiles: LABEL_FONT_FILES.map((f) => join(fontDir, f)), defaultFontFamily: 'NanumGothic' },
})
  .render()
  .asPng();
writeFileSync(join(outDir, 'hanjin-ns-preview.png'), png);

const bitmap = new SvgRasterizer().rasterize(spec.svg, mmToDots(spec.widthMm));
writeFileSync(join(outDir, 'hanjin-ns-preview.zpl'), encodeZpl(bitmap, spec.barcodes, { compress: false }));
writeFileSync(join(outDir, 'hanjin-ns-preview.compressed.zpl'), encodeZpl(bitmap, spec.barcodes, { compress: true }));
console.log(`wrote ${outDir}/hanjin-ns-preview.{png,zpl,compressed.zpl}`);
```

PNG 에는 바코드가 없다(바코드는 프린터가 그린다). 위치 비교에는 텍스트면 충분하다.

- [ ] **Step 2: 실행해 눈으로 확인**

```bash
npx tsx scripts/ops/hanjin-label-preview/render.ts <scratchpad>/label-preview
```

Expected: 세 파일 생성. PNG 를 열어 포털 NS 샘플과 비교한다 — 글자가 선인쇄 칸 위치(샘플의 보라색 칸)에 대략 맞는지, 칸을 넘는 글자가 없는지. 크게 어긋난 요소가 있으면 `hanjin-ns-template.ts` 의 좌표 상수를 고치고 Task 5 테스트를 다시 돌린다. **PNG 는 커밋하지 않는다.**

- [ ] **Step 3: 스펙 상태 줄 갱신**

`docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md` 3번째 줄을:

```
상태: core 구현 완료(브랜치 `feat/913-hanjin-label-masking`). 남은 것 — 창고 실물 출력(§10-3, 한진 라벨지 필요)·warehouse-app 배선(§11).
```

로 바꾼다.

- [ ] **Step 4: 커밋**

```bash
git add scripts/ops/hanjin-label-preview/render.ts docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md
git commit -F - <<'EOF'
chore(ops): 한진 NS 라벨 미리보기 스크립트를 추가한다 (#913)

합성 데이터로 PNG·ZPL 을 만든다 — 포털 샘플과 위치 비교, 창고 실물 출력용.

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS
EOF
```

- [ ] **Step 5: 이슈 #913 본문 갱신 (사용자 확인 후)**

이슈 본문의 「해야 할 일」 체크리스트에서 core 쪽 완료 항목(템플릿 렌더러·한글 래스터화·⑬·바코드·마스킹 유틸)을 체크하고, 남은 것(ZPL 에뮬레이션 실동작 확인·인쇄 엔트리포인트의 warehouse-app 쪽)을 남긴다. 외부에 보이는 수정이므로 **바꿀 문안을 사용자에게 먼저 보여주고** 승인 후 `gh issue edit 913 --body-file` 로 반영한다.

- [ ] **Step 6: 최종 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
npx jest scripts/security
```

Expected: 전부 초록(type-check 는 `probe-image-size` 한 건 예외). 결과를 그대로 보고한다.
