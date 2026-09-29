# 한진 FS형 운송장 품목 줄·추가 쪽 설계

작성일: 2026-09-28. 이슈: #913 (부모 #910). 브랜치: `feat/913-fs-label-item-lines`.
선행 스펙: `2026-09-27-hanjin-ns-label-rendering-design.md`(«NS 스펙»), `2026-09-28-hanjin-nl-fs-label-templates-design.md`(«NL·FS 스펙»).

## 1. 목표

셀메이트 송장은 **피킹 지시서**였다 — 작업자가 송장을 들고 품목과 수량을 보고 물건을 모은다. 지금 core 의 FS
송장은 품명 한 줄(「첫 상품명 외 N건」)뿐이라 그 역할을 못 한다. 셀메이트 수준으로 **송장만 보고 박스에 무엇이
몇 개 들어가는지 알 수 있게** 한다.

성공 기준:

1. FS 송장의 품목 영역에 SKU별 이름·수량이 한 쪽에 4줄씩 찍힌다
2. 품목이 4줄을 넘으면 같은 출고의 추가 쪽이 이어서 나오고, 추가 쪽은 한눈에 「발송 금지」로 보이며 바코드가 없다
3. warehouse-app 은 **변경·재배포 없이** 여러 쪽을 인쇄한다(일괄·재출력 모두)
4. 창고 FS 라벨지 실물 출력에서 품목 줄·쪽 표시·발송 금지 표시가 선인쇄 칸을 밟지 않는다(PR #977 과 같은 스캔 대조)
5. `npm run type-check` 는 이 변경이 새 에러를 만들지 않는다(develop 의 `probe-image-size` 1건은 기존) · `npx jest` 실패 0

## 2. 결정 (사용자 결정 2026-09-28)

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| 품목 줄 이름 | **SKU명**(`skus.name`) | 라벨이 피킹 지시서라 «집을 물건»이 구별돼야 한다. 주문 상품명은 자사몰 주문이면 Medusa `title` 이라 옵션명이 빠진다(`medusa-order.source.ts:126`) |
| 품목 줄 단위 | 출고 품목 줄을 **SKU 로 합친다**(수량 합) | 같은 SKU 가 주문 줄 여러 개로 나뉘어도 집는 동작은 하나다. `shipment_lines` 는 (출고, FOI) 당 한 줄이지 SKU 당이 아니라(`uq_shipment_lines_shipment_foi`) 판매상품 둘이 한 SKU 에 매칭된 경우·세트 구성품을 단품으로도 산 경우·같은 상품이 주문 줄 둘로 온 경우·합포장에서 겹치는 경우에 같은 SKU 가 여러 줄이 된다(스키마상 가능한 경우 — 세트·합포장이 실제로 한 상자로 오는지는 미확인). 잃는 것은 판매상품 단위 구분이다 — 현장에 판매상품 단위 대조가 없다(사용자 확인) |
| 한 쪽의 줄 수 | **모든 쪽 4줄, 같은 자리** | 선인쇄 디자인이 모든 쪽에 같다 — 추가 쪽만 다른 칸에 품목을 찍으면 작업자가 헷갈리고 시각적으로 어색하다. 셀메이트와 같다 |
| 추가 쪽의 용도 | 피킹·검수용, **끝나면 버린다**(박스에 붙이지도 넣지도 않는다) | → 짝 맞추기 정보만 남기고 분류코드·주소·바코드는 뺀다. 잘못 붙어도 터미널이 읽을 것이 없고, 버려지는 종이의 개인정보가 줄어든다 |
| 여러 쪽 전달 | 쪽마다 `^XA…^XZ` 를 **이어 붙인 한 문자열** | 앱은 `data` 를 통째로 `print_raw` 한다(`waybillLabel.ts` `printOneLabel`) — 앱이 쪽을 몰라도 된다 |
| 적용 형 | **FS 만** | 창고 라벨지가 FS 다(PR #977 실물 확인). NS·NL 은 실물로 검증할 수 없다 |
| 한진 등록 품명 | 그대로(주문 상품명 + 「외 N건」) | 한진에 등록되는 값은 이 변경과 무관하다 |
| 위치 코드 | **이 스펙 밖** — 후속 스펙(§11) | 피킹 계획을 배치 시작 선언 시점에 확정하는 흐름 변경이 필요하다 |

## 3. 구성 요소 변경

```
waybill/waybill.types.ts                    ManifestLineLite.skuName 추가
waybill/waybill.reader.ts                   loadIssueContext 가 skuName 을 싣는다(이미 select 중)
waybill/label/label-items.ts                (신규) SKU 합치기·정렬·쪽 나누기 — 형 무관 순수 함수
waybill/carrier/hanjin/label/
  hanjin-label-data.ts      HanjinLabelData.items 추가
  hanjin-label-templates.ts 템플릿 시그니처 (d) => LabelSpec[]
  hanjin-fs-template.ts     품목 영역·쪽 표시·추가 쪽
  hanjin-ns-template.ts     [spec] 로 감싸기만 — 출력 불변
  hanjin-nl-template.ts     [spec] 로 감싸기만 — 출력 불변
waybill/waybill-label.manager.ts            쪽마다 래스터화·인코딩 후 이어 붙임, pages 반환
scripts/ops/hanjin-label-preview/render.ts  품목 7줄 견본(2쪽) 추가
docs/hanjin-api-integration-reference.md    신용 계약 확정 반영(§10)
```

## 4. 데이터

### 4.1 `ManifestLineLite.skuName`

`loadIssueContext` 는 이미 `skus.name` 을 select 한다(`productName ?? skuName` 폴백에 쓴다). 그 값을 별도 필드로
싣는다. `productName` 의 의미(주문 상품명, 없으면 SKU명)는 그대로 — 한진 등록 품명이 쓰기 때문이다.

### 4.2 `label-items.ts` (형 무관)

```ts
export interface LabelItem { name: string; quantity: number }

/** SKU 별로 합치고 이름순(ko) 정렬. 동명이면 skuId 순 — 출력이 입력 순서에 흔들리지 않게. */
export function labelItemsOf(lines: readonly { skuId: string; skuName: string; quantity: number }[]): LabelItem[];

/** n 줄씩 쪽으로 나눈다. 빈 목록도 한 쪽(빈 쪽)을 낸다 — 쪽 수는 늘 1 이상. */
export function paginate<T>(items: readonly T[], perPage: number): T[][];
```

- `loadIssueContext` 가 줄 0개면 이미 던지므로 빈 목록은 방어용이다
- `HanjinLabelData.items: LabelItem[]` 에 담는다. 쪽 나누기는 템플릿의 일이다(한 쪽 줄 수는 형의 레이아웃이 정한다)

### 4.3 합계

- **「총 N건」** = 품목 줄 수(합친 뒤 SKU 수)
- **「M개」** = 수량 합

셀메이트 송장에서 `[총:13 개]` 가 품목 수량 합과 일치함을 확인했다(2026-09-28 사진).

## 5. FS 레이아웃

좌표는 **초기값**이다. 실물 출력 스캔으로 선인쇄 가로선(실측 y 7.4–8.0 · 24.3–24.6 · 44.4–44.9 · 52.0–52.5mm)과
「※ 개인정보 보호…」 선인쇄 문구(실측 y ≈81.7–83.1mm, x ≈4–73mm)를 대조해 확정한다(§9).

### 5.1 모든 쪽 공통

| 요소 | 위치(초기값) | 내용 |
| --- | --- | --- |
| ⑨ 운송장번호(좌상단) | 지금과 같음(x 15.3, y 6.8) | 짝 맞추기의 핵심 단서 — 모든 쪽에서 가리지 않는다 |
| 받는분 성명·연락처 | 지금과 같음(y 27.7) | 마스킹 그대로 |
| 보낸분 줄 · 출력일자/출고번호 줄 | 지금과 같음(y 48.3 · 51.5) | |
| **품목 영역** | 기준선 y 57.0 · 62.2 · 67.4 · 72.6, 11pt | 왼쪽 x 4.5 에 SKU명, 오른쪽 x 119 에 수량(끝 정렬). 이름 칸은 수량 앞 3mm 에서 멈춘다 — 넘치면 `shrinkThenFit`(최소 8pt) 후 말줄임 |
| **쪽 표시** | x 4.5, y 80.6, 9pt | `1/2 · 총 7건 13개`. 쪽이 하나여도 `1/1` — 「2쪽이 있어야 하나」를 헷갈리지 않게 |

지금의 품명 한 줄(`commodityName`, y 56.8 12pt bold)은 품목 영역으로 **대체**된다.

### 5.2 첫 쪽에만 (지금과 같음)

① ② ④ ⑦⑧ ⑯ ⑩ ⑪ ⑤ ⑥ ⑮ 상자 · 받는분 주소(기본+상세) · ⑫ · ⑬ 상자 · ⑭ 배송메시지 · 운임Type · 하단 ⑨ ·
**바코드 둘**(③ CODE128, ⑨ ITF).

### 5.3 추가 쪽에서 첫 쪽 전용 요소 대신

| 자리 | 내용 |
| --- | --- |
| 분류코드 띠(① ~ ⑥, y 8.0–24.3) | **「발송 금지 · 상품 확인용」** 굵게, x 5 부터 `fitSizePt`(최대 28pt·최소 18pt) |
| ITF 자리(x 76–119, y 80.5–92.5) | **「발송 금지」** 굵게, `fitSizePt`(최대 28pt) |

두 곳에 두는 이유: 찢은 조각이 어느 쪽으로 놓여도 눈에 띄게. 셀메이트는 ⑨ 위에 겹쳐 찍었지만 우리는 ⑨ 를
가리지 않는다 — 짝 맞추기 단서이기 때문이다.

추가 쪽에는 **바코드가 0개**이고 받는분 주소·⑫·분류코드·⑬·⑮·⑭·운임Type·하단 ⑨ 가 없다.

## 6. 템플릿·인코딩·API

- 레지스트리 시그니처: `(d: HanjinLabelData) => LabelSpec[]` (빈 배열 금지). NS·NL 은 `[spec]` 로 감싼다 —
  **NS·NL 출력 바이트는 불변**. NS 는 기존 해시 테스트(`hanjin-ns-template.spec.ts`)가 지키고, NL 은 해시 테스트가
  없으므로 **변경 전에** 현재 출력의 해시를 박는 테스트를 먼저 더한다
- `WaybillLabelManager.render`: 쪽마다 `rasterize` → `encodeZpl` 후 `'\n'` 으로 이어 붙인다. `encodeZpl` 은
  바꾸지 않는다(한 쪽 = 한 `^XA…^XZ`)
- 응답 `WaybillLabel` 에 **`pages: number`** 추가(additive). warehouse-app 은 이 필드를 읽지 않는다 — 앱의
  「보냄 N」은 계속 출고 건수다(장수가 아님). 장수 대조가 필요해지면 그때 앱에서 쓴다

## 7. 오류·경계

- 품목 수에 상한을 두지 않는다. 쪽이 많아지면 래스터화 시간이 쪽 수에 비례해 늘 뿐이다(배치 인쇄는 이미 순차)
- SKU명이 비면(`skus.name` 은 NOT NULL 이라 실제로는 없음) 빈 문자열로 찍는다 — 던지지 않는다
- 수량은 정수 그대로(단위 없음). 합계 문구에만 「개」

## 8. 테스트

- `label-items.spec.ts`: SKU 합치기(같은 SKU 두 줄 → 한 줄 수량 합) · 정렬 안정성(입력 순서 무관) ·
  `paginate` 경계 0 · 1 · 4 · 5 · 8 · 9 줄 → 쪽 수 1 · 1 · 1 · 2 · 2 · 3
- `hanjin-fs-template.spec.ts`
  - 줄 수별 쪽 수, 각 쪽의 품목이 제 자리 순서대로
  - 첫 쪽만 바코드 2개, 추가 쪽 바코드 0개
  - 추가 쪽에 받는분 주소·⑫·hubCode 텍스트가 없고 「발송 금지」가 있다
  - 모든 쪽에 `trackingNoDisplay` 와 `n/N` 이 있다
  - 긴 SKU명이 수량 칸을 침범하지 않는다(`textWidthMm` 로 판정)
  - 기존 불변식(`label-invariants.ts`: 바코드 보호 영역 잉크 0)을 **쪽마다** 적용
- `hanjin-label-templates.spec.ts`: 세 형 모두 1쪽 이상, NS·NL 은 항상 1쪽
- `hanjin-nl-template.spec.ts`: 변경 전 출력 해시 고정(§6) — NS 의 기존 해시 테스트와 같은 방식
- `waybill-label.manager.spec.ts`: 2쪽이면 `^XA` 2개·`^XZ` 2개, `pages: 2`
- `waybill.reader` 통합 스펙이 있으면 `skuName` 을 싣는지 확인(가드 규칙대로 DB 없으면 skip)

## 9. 현장 검증

`render.ts` 에 품목 7줄 견본(FS 2쪽)을 더해 `hanjin-fs-items-preview.{png,zpl}` 를 낸다. 개발 PC(리눅스) 의
CUPS raw 큐로 실물 출력 → 스캔 → 선인쇄 선과 대조해 §5 좌표를 확정한다(PR #977 과 같은 절차, 현장 키트
README 에 7줄 견본 한 줄 추가).

## 10. 문서 정정

`docs/hanjin-api-integration-reference.md` §4.2 의 「월 정산 계약이면 `CD` 하나로 확정된다」를 **확정 사실**로
고친다: 우리 계약은 신용(월 정산) — 2026-09-28 사내 확인. 이슈 #910·#913 본문은 이미 반영했다.

## 11. 범위 밖 — 후속 스펙: 품목 줄의 위치 코드

라벨이 피킹 지시서이려면 품목 줄 앞에 `[AA-11-01]` 식 위치 코드가 필요하다. 출고 품목 줄 → 위치를 저장한
곳은 `picking_source_allocations`(계획 단위, 한 줄 → 여러 위치 가능) 뿐인데, 계획은 **배치당 하나**이고 첫 작업자가
운송장을 스캔할 때(`SimpleOutboundService.ensurePlan`) 만들어진다 — 배치 일괄 인쇄보다 늦다. 게다가 draft 계획은
재고 변경으로 무효화·재계획될 수 있다.

후속 스펙의 뼈대: **배치 작업 시작 선언 = 피킹 계획(과 출처 위치) 확정**. 그 선언이 어느 화면의 어느 동작인지,
확정된 계획이 무효화될 수 있는지와 그때 이미 찍은 라벨을 어떻게 다룰지를 정한다. 이 스펙의 품목 줄은 이름 앞에
접두어를 붙일 수 있게 이름 칸 폭을 계산식으로 두어 그 스펙이 레이아웃을 다시 짜지 않게 한다. 정렬도 그때
위치 순으로 바꾼다. 컷오버(#923)를 기다릴 필요는 없다 — 운영 데이터로 확인하는 것만 컷오버 뒤다.

그 밖: 배치 순번(`[5/39]`) 은 넣지 않는다(앱이 순번을 core 에 넘겨야 해서 앱 변경이 따른다).

## 12. 열린 질문 (구현을 막지 않음)

- §5 좌표의 실물 확정(§9)
- 11pt 한 줄에 들어가는 SKU명 길이 — 실제 SKU명 분포는 운영 데이터로 확인(말줄임이 잦으면 크기를 조정)
