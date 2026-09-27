# 한진 NL·FS형 운송장 템플릿 설계

작성일: 2026-09-28. 이슈: #913 (부모 #910). 브랜치: `feat/913-hanjin-nl-fs-labels`.
선행 스펙: `docs/superpowers/specs/2026-09-27-hanjin-ns-label-rendering-design.md` (이하 «NS 스펙»).

## 1. 목표

지금 core 는 NS형 한 가지만 그린다. **창고에서 실제 라벨지를 확인했을 때 그게 NS 가 아니어도 그 자리에서
바로 뽑아 볼 수 있도록** NL·FS 템플릿을 더하고, 운영에서 어느 형을 쓸지 설정 하나로 고르게 한다.

성공 기준:

1. 현장 키트(`scripts/ops/hanjin-label-preview/`)가 세 형의 PNG·ZPL 을 내고, 창고 PC 에서 그 ZPL 을
   프린터로 보내는 방법이 README 에 적혀 있다
2. 로컬 역렌더 스모크(§9)에서 세 형 모두 SVG 미리보기와 같은 배치로 그려지고 바코드가 디코딩된다
3. `npm run type-check` 0 · `npx jest` 실패 0 · NS 출력은 **바이트 단위로 그대로**다

## 2. 결정

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| NL 외곽 치수 | **가로 100 × 세로 102mm** | 포털에 세로가 없다. `nl_new.jpg` 에서 외곽을 재면 583px(=100mm) × 595px → 102.1mm (사용자 결정 2026-09-28). 현장 실측이 다르면 상수 하나만 바꾼다 |
| FS 외곽 치수 | 가로 123 × 세로 100mm | 포털 `fs_new.jpg` 표기 |
| 회전 | **형이 정한다** — `LabelSpec.rotation`. NS·FS = 90°, NL = 0° | 인쇄폭 108mm. NS(200)·FS(123)는 긴 변이 폭을 넘으므로 돌려야 한다. NL 은 두 변(100·102) 모두 108 이하라 물리적으로는 어느 쪽이든 들어간다 — 100mm 폭 롤을 가정해 돌리지 않는다. 롤이 102mm 폭이면 값 하나만 바꾼다 |
| 형 선택 | **env `HANJIN_LABEL_TYPE`** (`NS`\|`NL`\|`FS`, 비면 `NS`) | 형은 한진 계약·라벨지 재고가 정하는 **설정**이지 요청마다 바뀌는 값이 아니다. 쿼리 파라미터는 warehouse-app 재빌드가 필요하고 한 창고 안에서 형이 섞일 수 있다. Core 에는 `HANJIN_*` env 가 아직 전혀 배선돼 있지 않아 개통 전 Core 재배포가 어차피 한 번 필요하다 — 거기 얹는다 (사용자 결정 2026-09-28) |
| 모르는 형 값 | **라벨 요청만** 500(`Error`) | `payType` 과 같은 설정 오류 취급. 발급·부팅은 막지 않는다(NS 스펙 §4.4 원칙) |
| 오늘의 현장 시험 | API 가 아니라 **현장 키트**(render.ts 가 만든 ZPL 파일)로 한다 | 형 선택 방식과 무관하게 세 형을 다 찍어 볼 수 있다 |

### 규격 출처

한진 포털 [운송장 출력 가이드](https://developers.hanjin.com/printwbl) 「운송장 출력 Sample」 — 2026-09-28
페이지가 실제로 보여 주는 이미지는 `nl_new.jpg`·`nl2.jpg`(NL 도면·필드표), `fs_new.jpg`·`fs2.jpg`(FS). 서버에만
남아 있는 옛 판 `fs.jpg`(2023년 샘플)는 쓰지 않는다. **한진 저작물이라 저장소에 복사하지 않는다.**

## 3. 구성 요소 변경

```
waybill/label/label-model.ts          LabelSpec.rotation 추가, barcodeWidthMm 이전(render.ts 에서)
waybill/label/zpl-encoder.ts          rotation 0/90 분기, 인쇄폭 108mm 가드
waybill/carrier/hanjin/hanjin.config.ts          labelType
waybill/carrier/hanjin/label/
  hanjin-label-svg.ts        (신규) NS 템플릿에서 뽑은 공용 SVG 헬퍼
  hanjin-ns-template.ts      헬퍼 import 로 교체, rotation: 90 — 출력 불변
  hanjin-nl-template.ts      (신규)
  hanjin-fs-template.ts      (신규)
  hanjin-label-templates.ts  (신규) 형 → 템플릿 레지스트리
  hanjin-label-data.ts       sort.terminalName(tml_nam) 추가
waybill/waybill-label.manager.ts      레지스트리 조회, spec.rotation 을 인코더에 전달
scripts/ops/hanjin-label-preview/render.ts   세 형 출력
scripts/ops/hanjin-label-preview/README.md   (신규) 현장 키트
```

### 3.1 `LabelSpec.rotation` 과 인코더

```ts
interface LabelSpec {
  widthMm: number; heightMm: number;   // 템플릿이 그린 방향 그대로
  rotation: 0 | 90;                    // 프린터에 넣을 때 시계방향 회전(도)
  svg: string;
  barcodes: BarcodePlacement[];
}

encodeZpl(bitmap, barcodes, { compress, rotation })
```

- `rotation: 90` — 지금 동작 그대로(비트맵 시계방향 회전, `^FO<H-y-h>,<x>`, `^B2R`/`^BCR`). NS 의 ZPL 은
  이 변경 전후로 **문자열이 같아야 한다** — 스펙으로 고정한다.
- `rotation: 0` — 비트맵 그대로, `^FO<x>,<y>`, `^B2N`/`^BCN`. `^PW` = 가로 dot, `^LL` = 세로 dot.
- **인쇄폭 가드**: 결과 `^PW` 가 `mmToDots(108)` = 864 를 넘으면 `Error` — 회전 값을 잘못 적으면 프린터가
  조용히 잘라 찍는 대신 테스트에서 걸린다. 상수 `PRINTER_MAX_WIDTH_MM = 108` 는 label-model 에 둔다.
- 매니저는 `encodeZpl(bitmap, spec.barcodes, { compress: WAYBILL.LABEL_ZPL_COMPRESS, rotation: spec.rotation })`.

### 3.2 공용 SVG 헬퍼 `hanjin-label-svg.ts`

NS 템플릿 파일 안의 `TextEl`·`text()`·`rect()`·`hline()`·`koreanDate()`·`shrinkThenFit()` 를 **그대로** 옮기고
NS 는 import 로 바꾼다. 세 템플릿이 같은 함수를 쓰게 해 한 벌만 고친다. SVG 머리말(`<svg … font-family=
"NanumGothic">`)과 면 블록(`<g id="…">`)을 조립하는 `svgDocument(widthMm, heightMm, blocks)` 도 같이 둔다.

### 3.3 형 레지스트리와 설정

```ts
// hanjin-label-templates.ts
export const HANJIN_LABEL_TYPES = ['NS', 'NL', 'FS'] as const;
export type HanjinLabelType = (typeof HANJIN_LABEL_TYPES)[number];
export const HANJIN_LABEL_TEMPLATES: Record<HanjinLabelType, (d: HanjinLabelData) => LabelSpec> = { NS, NL, FS };
export function renderHanjinLabel(type: string, d: HanjinLabelData): LabelSpec  // 모르는 type → Error
```

- `HanjinConfig.labelType: string` ← `env.HANJIN_LABEL_TYPE?.trim() || 'NS'`. 검증은 로드 시점이 아니라
  `renderHanjinLabel` 에서 한다 — 설정이 틀려도 부팅·발급은 살아 있고, 라벨 요청만 원인을 적은 500 이 된다.
  메시지: `Hanjin label: unknown HANJIN_LABEL_TYPE "<값>" (expected NS|NL|FS)`.
- `missingHanjinConfig` 에는 넣지 않는다 — 그 게이트는 발급 준비 여부다. 라벨 형은 발급과 무관하다.
- SST(`infra/`) 배선은 이 스펙 범위 밖이다 — `HANJIN_*` 전체 배선 때 함께 넣는다(§10).

### 3.4 `sort.terminalName` 추가

NL 샘플의 ② 터미널코드 아래 「중구」는 필드표에 번호가 없지만, 우리가 이미 저장하는 `tml_nam`(도착지
터미널명, `LABEL_FIELDS` 에 있음)으로 보인다. `HanjinSortFields.terminalName` 을 더하고 없으면 `''`.
**가정** — #920 에서 확인(§11).

## 4. NL 템플릿 (100 × 102mm, rotation 0)

위쪽이 **배달표**, 아래쪽(「운송장번호」 줄 아래)이 **받는고객용(= 배달표 외)**. 좌표는 `nl_new.jpg` 외곽 대비
비율로 잰 mm, 폰트는 `nl2.jpg` 필드표의 pt(NS 와 같은 가정). 필드표에 없는 요소(출력일자·수량·운임Type·
출고번호·품명·인물 칸)는 샘플 비율에서 잰다.

검은 요소(가변 데이터) — 샘플의 보라색 테두리·캡션(「배달표」「받는분」「특기사항」「내품명」「운송장번호」…)·
로고·「GENERAL」 등 컬러 요소는 선인쇄라 그리지 않는다:

- 분류 머리: ①(35) ②(25) + terminalName, 「출력일자 : YYYY년 MM월 DD일」, ③ CODE128(25×8mm), 「P. 1」,
  ④(35) ⑯(35), ⑤(8) ⑥(8), 「발지TML」 ⑦(8) ⑧(8)
- 배달표 인물 칸: 받는분 · 보낸분 (§4.1)
- ⑭ 배송요구사항(9) — shrinkThenFit
- ⑩(20) ⑪(20), ⑮(11, 검은 테두리 상자), ⑬(14, 검은 테두리 상자, 「발지신용」)
- ⑨ 운송장번호(ITF 위), 출력일자·「수량: N」·「운임Type:X」·「출고번호: …」, ITF
- 받는고객용: ⑨ 운송장번호 + 「P. 1」, 품명, 받는분 ⑫, 보낸분 (§4.1)

### 4.1 NL 면별 마스킹

| 면 | 인물 | 성명 | 연락처 | 주소 |
| --- | --- | --- | --- | --- |
| 배달표 | 받는분 | `maskName` | `maskPhone` | **원본** `base + detail` (shrinkThenFit) |
| | 보낸분 | 원본 | 원본 | `maskAddress(base)` |
| 받는고객용 | 받는분 | — | — | **⑫ `addressSummary` 만** |
| | 보낸분 | `maskName` | `maskPhone` | `maskAddress(base)` |

배달표 보낸분 주소: §3.3 은 「미표기 또는 마스킹」 — NS 는 미표기, NL·FS 는 **샘플대로 마스킹**해서 찍는다.

면 블록 id: `delivery-slip`, `customer-copy`. 분류 머리는 `sort-head` 블록.

## 5. FS 템플릿 (123 × 100mm, rotation 90)

라벨 **전체가 배달표 한 면**이다(샘플 좌측 「배달표」 100mm 화살표). 받는고객용 면이 없다. 좌표는 `fs_new.jpg`,
폰트는 `fs2.jpg`.

검은 요소:

- 맨 위 ⑨ 운송장번호(8)
- ①(35) ②(25) ④(35), ⑦⑧ 「발지:<코드> <이름>」(8), ⑯(35), ⑩(20), ⑪(20), ⑤(8) ⑥(8), ⑮(11, 검은 테두리 상자)
- 받는분: 성명·연락처, 전체주소, ⑫(19) — §5.1
- ③ CODE128(우측, 25×8mm), ⑬(14, 검은 테두리 상자)
- 보낸분 한 줄: `성명 / 연락처 / 주소` — §5.1
- 출력일자(`YYYY-MM-DD`) + 「Type : X」, 「출고번호 : …」
- 품명(본문 넓은 칸, 큰 글자 — 샘플 「테스트 상품」 위치)
- ⑭(9, 좌하단), ITF(우하단), 「운임Type : X」 + ⑨(8, ITF 아래)

「※ 개인정보 보호를 위하여…」 안내문과 로고는 선인쇄. 샘플 ITF 위에 겹친 회색 「테스트」는 샘플 워터마크라 그리지 않는다.

### 5.1 FS 마스킹 (전면 배달표)

| 인물 | 성명 | 연락처 | 주소 |
| --- | --- | --- | --- |
| 받는분 | `maskName` | `maskPhone` | **원본** `base + detail` (shrinkThenFit) |
| 보낸분 | 원본 | 원본 | `maskAddress(base)` |

면 블록 id: `delivery-slip` 하나(분류 머리 포함).

## 6. 세 형 공통 규칙

- 문구 「출고번호」로 통일한다(FS 샘플은 「주문번호」) — 값은 `custOrdNo`, 창고에서 부르는 이름이 출고번호다.
- ⑬ 은 `freightText`(= 「발지신용」). 샘플의 「착불 1,600원」은 선·착불 예시일 뿐.
- 박스 표기는 NS 와 같은 `boxIndex/boxCount` 데이터를 쓴다(NL 「P. 1」, FS 샘플엔 없음 — 그리지 않는다).
- 식별자(운송장번호·출고번호)는 자르지 않는다 — 칸에 안 들어가면 `fitSizePt` 로 최소 4pt 까지 줄인다.
  **ITF 앞뒤 quiet zone(모듈 × 10)을 텍스트가 침범하면 안 된다** — NS 의 출고번호 사고(#913 최종리뷰)와 같은 부류.
- 긴 자유 텍스트(주소·⑭)는 NS 와 같이 shrinkThenFit(최소 7pt), 그 외(품명·⑫)는 fitText.
- 모든 문자열 XML 이스케이프(헬퍼가 한다).

## 7. 테스트

| 대상 | 핵심 |
| --- | --- |
| `zpl-encoder` | `rotation: 0` 의 `^PW`/`^LL`/`^FO`/`^B2N`/`^BCN`; `rotation: 90` 은 기존 기대값 그대로; 폭 > 108mm 면 throw |
| NS 불변 | 고정 데이터로 만든 NS ZPL 의 sha256 을 리팩터 **전에** 떠서 스펙에 박는다 → 리팩터 후 같아야 한다 |
| `hanjin-label-templates` | 세 형 모두 등록, `rotation`·치수, 모르는 형 throw(메시지에 값) |
| `hanjin.config` | `HANJIN_LABEL_TYPE` 미설정 → `NS`, 공백 trim |
| NL 누출 | `customer-copy` 에 받는분 원본 성명·전화·기본주소·상세주소 **없음**, 받는분 ⑫ 외 주소 조각 없음, 보낸분 원본 성명·전화·주소 없음 / `delivery-slip` 에 받는분 전체주소 **있음**, 받는분 원본 성명·전화 **없음** / 보낸분 원본 주소는 **어디에도 없음** |
| FS 누출 | 받는분 원본 성명·전화 없음, 전체주소 있음 / 보낸분 원본 주소 없음, 마스킹 주소 있음 |
| 이스케이프 | 세 형 모두 `<script>` 이름이 `&lt;script&gt;` 로 |
| **공통 불변식**(세 형 반복) | 모든 바코드가 라벨 안 · 래스터화한 SVG 에서 바코드 상자 + 양쪽 quiet zone 안 잉크 0 (긴 출고번호 28자·긴 주소 데이터로) |
| `barcodeWidthMm` | ITF 는 기존 식, CODE128 은 subset B 상한 `(11×(n+2)+13) × module` dot |

`barcodeWidthMm` 는 render.ts 의 미리보기 전용 함수를 `label-model.ts` 로 옮긴 것 — 테스트와 스크립트가 같은
근사를 쓴다. CODE128 의 25mm 고정값은 상한식으로 바꾼다(작은 데이터에서 quiet zone 판정이 과하지 않게).

## 8. 현장 키트

### 8.1 `render.ts`

`npx tsx scripts/ops/hanjin-label-preview/render.ts <dir>` → `hanjin-{ns,nl,fs}-preview.{png,zpl,compressed.zpl}`
9개. PNG 는 템플릿 방향(포털 샘플과 나란히 비교용) + 바코드 위치 오버레이, ZPL 은 프린터 방향. 합성 데이터라
개인정보 없음. 출고번호는 실제 길이(28자)로 둔다.

### 8.2 `README.md` (신규)

1. **만든다** — 위 명령. 결과 폴더를 USB 등으로 창고 PC 에 옮긴다.
2. **프린터 준비** — XP-DT108B 가 ZPL 에뮬레이션으로 동작하는지(명령어 언어 설정·자동 감지). 라벨지 폭·
   길이 감지(갭 캘리브레이션).
3. **보낸다 — warehouse-app 진단 화면으로는 못 보낸다**(내장 테스트 라벨만 찍는다). Windows 에서:
   1. 프린터 속성 → 공유 → 공유 이름(예: `XP108`)
   2. 관리자 아닌 `cmd` 에서 `copy /b hanjin-nl-preview.zpl \\localhost\XP108`
   - SMB 로 들어간 작업은 RAW 로 스풀돼 드라이버 렌더링을 거치지 않는다 — warehouse-app 의 `print_raw` 와
     같은 경로다. **미검증** — 안 나오면 ①공유 이름 오타(`net view \\localhost`) ②스풀러 큐에 작업이 걸렸는지
     ③종이에 ZPL 명령 문자가 글자로 찍히면 에뮬레이션이 ZPL 이 아닌 것(2번으로)
4. **확인한다** — NS 스펙 §10-3 의 체크리스트 + 형 판정:
   - 어느 형의 선인쇄 칸에 글자가 맞아 들어가는가(= 우리 라벨지의 형)
   - NL: 롤 방향 — 글자가 옆으로 누워 나오면 `rotation` 을 90 으로
   - NL: 실측 세로 길이(102mm 가정)
   - 압축판(`*.compressed.zpl`)도 같은 결과인가
   - ITF·CODE128 스캔, 한글 판독, 출고번호 판독성
5. **결과를 적는다** — #913 에 코멘트.

## 9. 로컬 역렌더 스모크 (저장소 의존성 0)

스크래치 디렉터리에서 일회성으로(09-28 NS 스모크와 같은 방식):

1. render.ts 로 세 형 ZPL 생성
2. `zpl-renderer-js`(zebrash, 일회성 `npx`/스크래치 `npm i`)로 ZPL → PNG (203dpi)
3. 프린터 방향 PNG 를 되돌려 SVG 미리보기 PNG 와 겹쳐 배치 비교 — 육안 + 픽셀 차분
4. `zxing-cpp`(스크래치 venv `pip install zxing-cpp`)로 ITF(운송장번호 12자리)·CODE128(터미널코드) 디코딩
5. 압축판·비압축판 역렌더 픽셀 동일

합격: 세 형 모두 1~5 통과. 결과(PNG 몇 장)를 사용자에게 보인다. 저장소에는 아무것도 남기지 않는다.

## 10. 문서 정정

- **#913 본문** 「해야 할 일 → 창고 실물 출력」의 「ZPL 은 … 진단 화면에서 출력한다」 → README 방식으로.
  「선행 결정 → 라벨 타입」에 NL·FS 템플릿 존재와 `HANJIN_LABEL_TYPE` 을 적는다.
- **개통 지도 아티팩트**(https://claude.ai/artifact/2K17JzF6VXx1bo2iDZ8ekj) 의 같은 문장 정정 + NL·FS 반영.
- NS 스펙 §11 「NL/FS 템플릿」 → 이 스펙 링크.
- 정본 `docs/hanjin-api-integration-reference.md` §3.1 에 NL·FS 외곽 치수·면 구성·회전 한 줄씩(필드표는 링크).
- `HANJIN_LABEL_TYPE` 을 `apps/core/src/modules/fulfillment/waybill/README.md` 의 한진 env 목록에 추가. SST 배선은 하지 않는다 —
  `HANJIN_*` 전체 배선 때 함께(개통 지도의 해당 항목에 한 줄).

## 11. 범위 밖

SST env 배선 · 쿼리 파라미터·DB 설정에 의한 형 선택 · warehouse-app 변경(0) · 인쇄 오프셋 설정 ·
선·착불 운송료 금액 · NS 템플릿 좌표 조정 · 옛 FS 샘플(`fs.jpg`) 요소(「1/1 건수/수량」 등).

## 12. 열린 질문 (#920·현장에서 확인, 구현을 막지 않음)

- 우리 라벨지가 NS·NL·FS 중 무엇인가 — 오늘 현장 키트로 판정
- NL 실측 세로(102mm 가정)와 롤 방향(회전 0 가정)
- NL 「중구」 = `tml_nam` 인가(§3.4)
- 필드표 크기 단위 pt (NS 스펙 §12 와 같은 가정). NL 필드표의 ⑨ 좌측상단 9 는 샘플에서 더 커 보인다 —
  **표를 따른다**
