# 한진 NS형 운송장 렌더링 (core) 설계

작성일: 2026-09-27. 이슈: #913 (부모 #910). 브랜치: `feat/913-hanjin-label-masking`.
상태: core 구현 완료(브랜치 `feat/913-hanjin-label-masking`). 남은 것 — 창고 실물 출력(§10-3, 한진 라벨지 필요)·warehouse-app 배선(§11).

## 1. 목표

core 가 **한진 자체출력 운송장 한 장을 창고 라벨 프린터가 바로 찍을 수 있는 ZPL** 로 만들어 내놓는다.
`waybills.label_data` 의 첫 소비자다. 이 스펙이 끝나면 warehouse-app 이 이 API 를 불러 바이트를
`print_raw` 로 넘기기만 하면 된다 — 그 배선은 이 스펙의 범위가 아니다(§11).

성공 기준은 §10. 요약하면 «테스트·게이트 초록 + arm64 컨테이너에서 렌더링 성공 + 창고 프린터로
한진 라벨지 위에 찍어 바코드가 읽히고 글자가 칸에 들어간다».

## 2. 전제와 이미 내린 결정

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| 라벨 형 | **NS형** 임시 템플릿 | 한진 영업담당자 회신 전. NL·FS 로 바뀌면 템플릿 한 파일만 새로 쓴다(§4) |
| 렌더링 위치 | **core** | #920 검수의 반복 수정이 창고 PC 재설치 없이 나가야 한다. 마스킹 규칙을 서버 한 곳에서 강제 |
| 프린터 | Xprinter XP-DT108B, USB, 203dpi, 감열, 인쇄폭 108mm, 에뮬레이션 TSPL/**ZPL**/EPL/DPL, 내장 폰트에 한글 없음 | 본체 스티커 + 제조사 데이터시트 (#913 본문 「프린터」) |
| 명령어 언어 | **ZPL** | 업계 사실상 표준 — 추가 구매 시 선택지가 넓다. 에뮬레이션 실동작은 §10-3 에서 판정 |
| 렌더링 방식 | **하이브리드**: 텍스트·선은 배경 비트맵 한 장(`^GF`), 바코드 둘은 프린터 명령(`^B2`/`^BC`) | 레이아웃은 한 곳에서 선언적으로, 바코드 품질은 프린터가. 쓰는 명령이 4종뿐이라 에뮬레이션 위험이 작다 |
| 출력 가능 상태 | `registered`·`used` 만 | `allocated` 에서 뽑으면 한진 미등록 번호가 박스에 붙어 나간다 |
| 지불조건 | `CD` 만 지원 | 월정산 계약(사용자 진술). `PP`·`CC` 는 운송료 금액이 필요한데 출처가 없다 |
| 미리 인쇄된 양식 | **한진 공급 라벨지에 이미 있다** | 포털 샘플의 보라색 요소(테두리·영역 캡션·로고·개인정보 안내 문구)는 감열 프린터가 찍을 수 없는 색 = 선인쇄. **우리는 검은색 요소(가변 데이터)만 찍는다** |

### 규격 출처

- 정본 `docs/hanjin-api-integration-reference.md` §3 (§3.3 마스킹 표는 2026-09-27 에 정정됨)
- 한진 포털 [운송장 출력 가이드](https://developers.hanjin.com/printwbl) 「운송장 출력 Sample」 — NS 샘플
  (`/files/ns_new.jpg`) 과 필드표(`/files/ns2.jpg`). **한진 저작물이라 저장소에 복사하지 않는다.**

## 3. 데이터 흐름

```
GET shipments/:shipmentId/waybill/label           (WAREHOUSE_OPERATE)
  → WaybillController.label
  → WaybillService.renderLabel(shipmentId)        2~3줄, 흐름만
  → WaybillLabelManager.render(shipmentId, tx?)
      1. WaybillManager.assertDispatchable(shipmentId, trx)      가드 재사용 (§5)
      2. 라벨 전용 가드 (source·carrier·labelData)                (§5)
      3. WaybillReader.loadIssueContext(trx, shipmentId)          기존 재사용
      4. buildHanjinLabelData(waybill, ctx, config, now)          순수
      5. renderHanjinNsLabel(data)            → LabelSpec          순수
      6. SvgRasterizer.rasterize(spec.svg)    → MonoBitmap         네이티브 경계
      7. encodeZpl(bitmap, spec.barcodes, …)  → string             순수
  → { waybillId, trackingNo, format: 'zpl', data }
```

1·3 은 같은 트랜잭션 안에서 읽는다(`dbService.run`). 쓰기는 없다.

## 4. 구성 요소

캐리어 중립(`waybill/label/`)과 한진 전용(`waybill/carrier/hanjin/label/`)을 가른다. 네이티브 의존성은
`SvgRasterizer` 한 곳에만 있고, 나머지는 전부 순수 함수라 Docker 없이 테스트된다.

### 4.1 `carrier/hanjin/label/hanjin-label-masking.ts` — ✅ 구현됨

`maskName` · `maskPhone` · `maskAddress`. 정본 §3.3 상세 기준. 테스트 25건.

- `maskAddress` 는 **상세주소를 인자로 받지 않는다** — 받지 않으면 샐 수 없다. 기본주소 안에서도
  건물번호(또는 읍면동) 이후를 자르고, 둘 다 못 찾으면 앞 두 마디만 남긴다.
- 포털 예시 `김한진택배 → 김*한***` 는 한진 쪽 오기로 판단해 규칙 문장대로 `김*진**` 로 구현했다
  (정본 §3.3 주석). #920 때 확인.
- 연락처는 안심번호를 쓰지 않고 마지막 4자리를 가린다.

### 4.2 `carrier/hanjin/label/hanjin-label-data.ts` — `buildHanjinLabelData`

입력: 활성 운송장 행, `IssueContext`, `HanjinConfig`, `now: Date`. 출력: `HanjinLabelData` — 템플릿이
필요로 하는 값을 **마스킹 전 원본으로** 모은 평평한 객체. 마스킹은 면을 아는 템플릿의 책임이다(§4.3).

```ts
interface HanjinLabelData {
  trackingNo: string;          // 12자리 원문 (바코드용)
  trackingNoDisplay: string;   // 4-4-4 하이픈 (사람용)
  sort: {                      // labelData 에서. 없으면 '' (demo 캐리어 대비)
    hubCode: string; terminalCode: string; midCode: string;
    centerCode: string; centerName: string;
    originTerminalCode: string; originTerminalName: string;
    routeRank: string; courierName: string; courierSortCode: string;
    addressSummary: string;    // ⑫ prt_add
  };
  regionText: string;          // ⑮ dom_rgn → 텍스트
  freightText: string;         // ⑬
  recipient: { name: string; phone: string; baseAddress: string; detailAddress: string };
  sender: { name: string; phone: string; baseAddress: string };
  deliveryMessage: string;     // ⑭ — 없으면 ''
  commodityName: string;       // 품명 (「A 외 N건」)
  boxType: string;             // 운임Type
  custOrdNo: string;           // 출고번호
  printedDate: string;         // YYYY-MM-DD, Asia/Seoul
  boxIndex: 1; boxCount: 1;    // 「1/1」 — shipment 하나 = 박스 하나
}
```

규칙:

- **⑮ 권역**: `1` 수도권 · `2`~`6` 지방 · `7` 제주 · `9` 도서. **모르는 값은 원문 그대로** (demo 캐리어는 `'D'` 를 넣는다).
- **⑬ 운임지급 기준**: `config.payType === 'CD'` → `'발지신용'` (포털 FS 샘플 표기). 그 외 값은
  `Error` 를 던진다(500) — 운송료 금액이 필요한데 출처가 없고, 이는 요청이 아니라 **설정** 오류다.
  메시지에 payType 과 사유를 적는다.
- **⑭ 배송메시지**: `waybill-request.assembler.ts` 의 `composeMessage(deliveryNote, entrancePassword)` 를
  **export 해서 재사용한다** — 한진에 보낸 문자열과 라벨 문자열이 한 함수에서 나와야 한다. 공동현관
  비밀번호는 저장하지 않는 원칙이라 여기서도 다시 합성만 하고 어디에도 남기지 않는다.
- **품명**: 발급 때와 같은 규칙(첫 상품명 + 「외 N건」). assembler 의 계산을 함수로 뽑아 공유한다.
- **출력일자**: `now` 를 **`Asia/Seoul` 로 명시해서** 포맷한다. 런타임 TZ 에 상대적인 API 를 쓰지 않는다
  (jest 는 UTC 로 뜨고 개발 머신은 KST — CLAUDE.md 「jest 는 UTC 로 뜬다」).
- 수하인은 `parseRecipient(ctx.recipientSnapshot)` 로 읽는다(발급과 같은 파서).

### 4.3 `carrier/hanjin/label/hanjin-ns-template.ts` — `renderHanjinNsLabel`

`HanjinLabelData` → `LabelSpec`:

```ts
interface LabelSpec {
  widthMm: number; heightMm: number;          // NS: 200 × 102 (가로 방향)
  svg: string;                                // viewBox 가 mm 인 SVG. 검은색만
  barcodes: BarcodePlacement[];               // 가로 방향 mm 좌표
}
interface BarcodePlacement {
  kind: 'ITF' | 'CODE128';
  data: string;
  xMm: number; yMm: number; heightMm: number;
  moduleDots: number;                         // 좁은 막대 폭(dot)
}
```

- **검은색 요소만** 그린다. 테두리·영역 캡션(「받는고객용」「배달표」「받는분」…)·로고·개인정보 안내 문구는
  라벨지에 선인쇄돼 있다.
- 좌표는 포털 NS 샘플에서 **라벨 외곽(200×102mm) 대비 비율로 실측**한 mm 값을 상수로 둔다. 폰트 크기는
  필드표(ns2) 값을 **pt 로 해석**한다(1pt = 0.3528mm) — 샘플 비율과 맞지만 단위가 적혀 있지 않은
  **가정**이다(§12).
- 샘플에서 검은색으로 찍히는 요소:
  - 좌측: ①② 허브·터미널코드(40), ③ 터미널 CODE128(25×8mm, 좌우 여백 5mm), ④ 중분류(40),
    ⑤⑥ 집배점코드·명(9), ⑩ 소분류(20), ⑪ 배송사원명(20), ⑯ 배송사원분류코드(40), 박스 「1/1」, 품명,
    ⑭ 배송요구사항(9), ⑮ 권역(16, 검은 테두리 상자)
  - 우측 상단(받는고객용 = **배달표 외**): ⑨ 운송장번호(14), 받는분·보낸분 각각 성명·연락처·주소
  - 우측 하단(**배달표**): ⑩(24) ⑪(22) ①②(25) ⑤(17), ⑬ 운임(14, 검은 테두리 상자), 출력일자, 수량,
    운임Type, 출고번호, ITF + ⑨ 운송장번호(9), ⑦⑧ 발송지 터미널(9), ⑭(9), 받는분 성명·연락처·주소,
    ⑫ 주소 요약(19), 송하인 성명·연락처
- **면별 마스킹** (정정된 §3.3):

  | 면 | 인물 | 성명 | 연락처 | 주소 |
  | --- | --- | --- | --- | --- |
  | 받는고객용 (배달표 외) | 받는분 | `maskName` | `maskPhone` | `maskAddress(base)` |
  | | 보낸분 | `maskName` | `maskPhone` | `maskAddress(base)` |
  | 배달표 | 받는분 | `maskName` | `maskPhone` | **원본** `base + detail` |
  | | 보낸분 | 원본 | 원본 | **미표기** |

- SVG 에 넣는 모든 문자열은 XML 이스케이프한다 — 수하인 이름·메모는 고객 입력이다.
- 긴 텍스트는 칸 폭을 넘으면 자른다. 폭 판정은 폰트 메트릭 없이 «글자 수 × 칸별 상한» 으로 한다
  (한글 0.9em·그 외 0.6em — 나눔고딕 실측 ~0.88em 보정, 칸별 상한은 실측 상수). 줄바꿈은 하지 않는다 —
  선인쇄 칸을 넘는다. **자르면 곤란한 두 필드(배달표 받는분 전체주소, ⑭ 배송요구사항)는 말줄임 전에
  먼저 글자 크기를 최소 7pt 까지 줄이고, 그래도 안 들어가면 그 크기에서 말줄임으로 자른다** — 실제
  주소(「…현대아파트 101동 1203호」류)와 ⑭ 끝의 「(공동현관 #…)」가 곧바로 말줄임만 적용했을 때 실제로는
  들어가는데도 잘려 나갔다(#913 최종리뷰). 그 외 긴 필드(품명·수하인 요약주소 등)는 곧바로 말줄임한다.

### 4.4 `label/svg-rasterizer.ts` — `SvgRasterizer`

`@resvg/resvg-js` 를 감싸는 유일한 네이티브 경계. Nest provider.

- 입력: SVG, 출력 크기(dot). 출력: `MonoBitmap { widthDots, heightDots, bytesPerRow, data: Uint8Array }`
  — 1비트, 1 = 검정, 행 우선, 행 끝 패딩.
- resvg 옵션: `font.loadSystemFonts: false`, `font.fontFiles: [나눔고딕 Regular, Bold]`,
  `defaultFontFamily: 'NanumGothic'`, `fitTo: { mode: 'width', value: widthDots }`. 시스템 폰트를 끄므로
  **어느 머신에서도 같은 결과**가 나온다.
- RGBA → 1비트: 알파 합성 후 휘도 < 50% 를 검정으로.
- 폰트 경로: `<cwd>/dist/apps/core/assets/fonts` → 없으면 `<cwd>/apps/core/assets/fonts`. 둘 다 없으면
  **라벨 요청만** `Error`(500) — 메시지에 찾아본 경로를 적는다. **부팅은 막지 않는다**(라벨 기능 하나로
  core 전체를 죽이지 않는다). resvg 인스턴스와 폰트 버퍼는 첫 사용 때 한 번 읽어 재사용한다.

### 4.5 `label/zpl-encoder.ts` — `encodeZpl`

입력: `MonoBitmap`(가로 방향), `BarcodePlacement[]`, `{ widthMm, heightMm, rotate: true, compress: boolean }`.
출력: ZPL 문자열.

- 203dpi = **8 dot/mm**. NS 가로 1600 × 세로 816 dot.
- **90° 회전**: 인쇄폭이 108mm 라 짧은 변(102mm)을 폭으로 넣는다. 비트맵을 시계방향 90° 돌리고 바코드
  좌표도 같은 변환을 적용한다. 결과 `^PW816` · `^LL1600`.
- 구조: `^XA` `^PW` `^LL` `^LH0,0` → `^FO0,0^GFA,<total>,<total>,<bytesPerRow>,<data>^FS` →
  바코드마다 `^FO<x>,<y>^BY<module>` + `^B2R,<h>,N,N,N^FD<data>^FS` 또는 `^BCR,<h>,N,N,N^FD<data>^FS` → `^XZ`.
  사람이 읽는 숫자 줄은 프린터에 맡기지 않고(`N`) SVG 텍스트로 그린다 — 내장 폰트를 쓰지 않는다.
- ITF: 12자리 그대로(짝수 자리). **체크디지트는 한진 번호에 이미 있으므로 프린터가 덧붙이지 않는다**
  (`^B2` 의 check digit 파라미터 `N`). 모듈 폭은 샘플 실측으로 정하되 **3 dot 이상**.
- CODE128: `tml_cod`. 25mm 폭 안에 들어가는 모듈 폭.
- `compress: true` 면 `^GF` 데이터에 ZPL ACS 압축(반복 문자 `G`–`z`, 행 끝 `,`, 이전 행 반복 `:`)을 쓴다.
  **기본값은 §10-3 창고 출력에서 정한다** — 그 전까지 `false`. 설정값 하나로 둔다.
- 순수 함수 — 시간·환경·I/O 를 읽지 않는다.

### 4.6 `WaybillLabelManager` 와 배선

- `waybill/waybill-label.manager.ts`. 검증·조립은 여기, `WaybillService.renderLabel` 은 위임만.
- `WaybillManager.assertDispatchable` · `WaybillReader.loadIssueContext` · `HANJIN_CONFIG` · `SvgRasterizer`
  주입. 트랜잭션은 `dbService.run(fn, tx)` (ADR-0025).
- `now` 는 주입 가능한 시계로 받는다(테스트에서 고정).
- `waybill.module.ts` 에 `WaybillLabelManager` · `SvgRasterizer` provider 추가.

## 5. API 와 가드

`GET shipments/:shipmentId/waybill/label` · `@RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)` — 기존
`GET shipments/:shipmentId/waybill` 와 같은 계열. 부작용 없음: 재출력은 같은 호출을 한 번 더.

응답(200):

```json
{ "waybillId": "…", "trackingNo": "452716978431", "format": "zpl", "data": "^XA…^XZ" }
```

JSON 인 이유: warehouse-app `api.request` 가 JSON 클라이언트라 에러 처리를 기존 경로로 탄다. ZPL 은 ASCII 다.

가드는 **`assertDispatchable` 을 그대로 재사용한다** — «출력할 수 있다 ⇔ 출고할 수 있다» 를 코드로
보장한다. 라벨 가드를 따로 두면 언젠가 두 기준이 갈린다.

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | shipment 없음 | 404 `WAYBILL_SHIPMENT_NOT_FOUND` (기존) |
| 2 | 활성 운송장 없음 / `registered`·`used` 아님 / 운송장번호 없음 | 409 `WAYBILL_NOT_DISPATCHABLE` (기존) |
| 3 | 매니페스트 버전 또는 수하인 해시 불일치 | 409 `WAYBILL_STALE` (기존) → 현장은 재발급 |
| 4 | `source = 'manual'` | 409 `WAYBILL_LABEL_UNAVAILABLE` (신규) — 수기 등록은 `labelData` 가 없다 |
| 5 | `carrier ≠ 'HANJIN'` | 409 `WAYBILL_LABEL_UNAVAILABLE` (신규) |
| 6 | `source = 'carrier'` 인데 `labelData` 가 null | 500 (`Error`) — 데이터 불변식 위반 |
| 7 | `payType ≠ 'CD'` | 500 (`Error`) — 설정 오류 (§4.2) |
| 8 | 폰트 파일 없음 | 500 (`Error`) — 배포 오류 (§4.4) |

3 이 있어서 **라벨의 수하인·품명은 대체로 한진에 등록한 값과 같다.** 라벨은 발급 때의 사본이 아니라
현재 shipment 로 다시 조립하는데, 버전·해시가 같으면 그 값들은 같다(가드와 조립 사이의 레이스는
`assertContextMatchesWaybill` 로 한 번 더 막는다 — #913 최종리뷰). 다만 **공동현관 비밀번호(⑭ 일부)는
수하인 해시 대상이 아니라서** 예외다 — 이 값만은 한진 등록 시점이 아니라 라벨 조립 시점 최신값을
싣는다(의도된 동작: 공동현관 비밀번호는 저장하지 않고 그때그때 합성하므로 최신값이 맞다).

demo 캐리어(로컬 E2E)는 DB 의 `carrier` 가 `HANJIN` 이라 같은 템플릿을 탄다. 가짜 코드 값에도 죽지 않는다.

## 6. 폰트·의존성·배포

- `@resvg/resvg-js` 를 루트 `dependencies` 에 추가한다.
- 나눔고딕 Regular·Bold TTF 를 **OFL 라이선스 파일과 함께** `apps/core/assets/fonts/` 에 커밋한다
  (출처: Google Fonts `Nanum Gothic`).
- core 는 webpack 번들이지만 `webpack-node-externals` 라 `node_modules` 는 번들되지 않는다 — resvg 의
  `.node` 바이너리는 런타임에 `node_modules` 에서 로드된다.
- runner 이미지는 `dist`·`libs` 만 복사한다 → `nest-cli.json` 의 core 프로젝트에 `assets` 를 추가해
  `apps/core/assets/fonts/**` 를 `dist/apps/core/assets/fonts` 로 복사한다.
- core 는 ECS **arm64(Graviton) + `node:22-alpine`(musl)** 이다 → 필요한 바이너리는
  `@resvg/resvg-js-linux-arm64-musl`.

## 7. 선행 실험 (계획의 첫 태스크, 실패하면 계획 중단)

`docker buildx build --platform linux/arm64 -f apps/core/Dockerfile` 로 core 이미지를 만들고 컨테이너
안에서 합성 SVG 하나를 렌더링한다. 합격:

1. `package-lock.json` 에 `@resvg/resvg-js-linux-arm64-musl` 항목이 있다 — npm 이 현재 플랫폼의
   optional 의존성만 lockfile 에 적는 알려진 함정을 배제
2. 컨테이너 안에서 `require('@resvg/resvg-js')` 성공, 렌더 결과 크기가 기대값
3. `dist/apps/core/assets/fonts/` 에 두 TTF 가 있고, 한글 글리프가 두부(□)가 아니다 — 렌더 결과에서
   한글 한 글자 영역의 검은 픽셀 수가 0 이 아니고 두부 글리프와 다르다

실패하면 `@napi-rs/canvas` 로 같은 실험을 하고 결과로 §4.4 를 다시 쓴다.

## 8. 에러 처리 원칙

- 도메인 에러는 `@app/shared` 의 `NotFoundError` · `ConflictError` 만. 서비스는 HTTP 타입을 모른다.
- 설정·배포·데이터 불변식 위반은 `Error`(500) — 요청을 바꿔서 풀리는 문제가 아니기 때문이다.
- 컨트롤러는 try/catch 하지 않는다(전역 필터).

## 9. 테스트

| 대상 | 종류 | 핵심 |
| --- | --- | --- |
| 마스킹 | 단위 ✅ | 정본 §3.3 예시 |
| `buildHanjinLabelData` | 단위 | ⑮·⑬ 매핑, 모르는 권역코드 원문, `PP`/`CC` 거절, 배송메시지가 발급 문자열과 같음, 출력일자 KST(UTC 15:30 → 다음 날) |
| `renderHanjinNsLabel` | 단위 | **개인정보 누출 테스트**: 받는고객용 블록에 원본 이름·전화·상세주소가 **없다** / 배달표 블록에 받는분 전체 주소가 **있다** / 보낸분 주소는 배달표에 **없다**. XML 이스케이프(`<script>` 이름). 말줄임. 바코드 배치 2개 |
| `SvgRasterizer` | 단위(실제 resvg) | 출력 크기, 검은 사각형 영역 = 1, 빈 영역 = 0, 한글 글리프가 두부가 아님 |
| `encodeZpl` | 단위 | 회전 좌표 변환, `^GF` 바이트 수, ACS 압축 → 해제 = 원본(테스트 안의 해제기), `^B2`/`^BC` 파라미터, `^PW`/`^LL` |
| `WaybillLabelManager` | DB 통합(`describeIfDb`, 기존 `waybill.manager.integration.spec.ts` 관례) | 가드 1~6 순서·에러 코드, 정상 경로 ZPL 이 `^XA` 로 시작 |
| 컨트롤러 | 단위 | 스코프 데코레이터, 위임 |
| 보안 | `npx jest scripts/security` | 새 라우트가 인가 감사를 통과 |
| 미리보기 | 스크립트 | 합성 데이터로 PNG 생성 — 포털 샘플과 나란히 놓고 위치를 비교. 합성 데이터라 개인정보 없음 |

## 10. 합격 기준

1. §7 선행 실험 통과
2. `npm run type-check` 0 · `npx jest` 실패 0 · `npx jest scripts/security` 통과
3. **사람 작업 — 머지를 막지 않는다**(앱 배선 전까지 소비자가 없다). **#920 현물 검수 전에는 필수.**
   창고 XP-DT108B 로 합성 라벨을 **한진 공급 라벨지 위에** 출력해:
   - ITF·CODE128 이 스캐너로 읽힌다
   - 한글이 판독된다
   - 글자가 선인쇄 칸 안에 들어간다 — 어긋나면 **먼저 프린터 자체 보정**(Xprinter 설정 도구의 오프셋·
     용지 감지)으로 맞추고, 그걸로 안 될 때만 core 에 오프셋 설정을 추가한다
   - ACS 압축을 켰을 때도 같은 결과면 기본값을 `true` 로 바꾼다
   - 출고번호 텍스트가 ITF quiet zone 을 침범하지 않고, ITF 가 실제로 스캔된다
   - 동·호수가 있는 배달표 주소(예: 「…아파트 101동 1203호」)가 말줄임 없이 전체로 찍힌다
   선행조건: 한진 라벨지 수령.

## 11. 범위 밖

warehouse-app 배선(프린터 설정 저장·인쇄 버튼·출력 시점 — #923 출고 흐름과 함께) · NL/FS 템플릿 ·
운송료 금액(선·착불) · 배치 출력 API · 출력 감사 로그 · 출력 시 운송장 상태 변경(`used` 는 dispatch 가
찍는다) · 인쇄 오프셋 설정(§10-3 에서 필요해질 때만) · 한진 현물 검수(#920).

## 12. 열린 질문 (구현을 막지 않음, #920 에서 확인)

- 필드표 폰트 크기의 단위가 pt 인가
- `CD` 의 명칭: 정본 §4.2 는 「받지신용」, 포털 FS 샘플은 「발지신용」. 라벨에는 샘플 표기를 쓴다
- 마스킹 예시 `김한진택배 → 김*한***` 가 오기인가
- NS 라벨지의 선인쇄 레이아웃이 포털 샘플과 같은가
