# 중국 선적 입고 — 선적 · 상자 · 리스트 줄 모델 (#1238 · #1239)

> 상위: #1233 축 2 · 입고. 이 문서는 #1238(입고리스트 업로드)과 #1239(앱에서 상자 단위 검수)가 함께 쓰는
> 모델과 core 스키마·API 를 정한다. #1240(입고예정일·보충 제안)은 이 모델을 읽기만 한다.

## 1. 왜

중국 물량은 중국 창고에 쌓였다가 한 번에 선적돼 상자 수십 개로 온다. 중국 직원은 선적하면서 **입고리스트 엑셀**을
메신저로 보내고, 실물 상자마다 리스트와 같은 상자 이름(`L1`, `L5` …)이 하나씩 적혀 있다. 물류팀은 틈날 때 상자
하나를 들고 와 리스트를 보며 처리한다. **이 방식을 존중한다.**

지금 core 입고에는 «선적·상자» 개념이 없다(발주 입고와 간편입고뿐). 셀메이트를 끊으면(#1233) 이 물량을 받을 길이
없어진다. 컷오버 첫날 필수다.

이미 정해진 것(#1233, 사용자 결정):

- 중국 창고는 우리 밖으로 본다. 선적 도착을 **입고**로 처리하고 창고간이동(`transfer_orders`, ADR-0039 의 이동
  지시서)으로 모델링하지 않는다.
- **입고 = 검수.** 상자를 열어 세고, 리스트와 다르면 수량을 고쳐 확정한다.
- 입고리스트가 곧 입고예정이다. 도착 예정일은 올리는 사람이 넣는다.
- 읽기는 **파서 + AI 보조 + 사람 확정**이다.
- 비고에 발송 지시가 있는 상자는 «전달용»으로 표시만 하고 재고로 입고하지 않는다.

## 2. 목표 · 비목표 · 반목표

**목표**

- 입고리스트를 올리면 선적 → 상자 → 리스트 줄이 생기고, 바코드로 못 찾은 줄은 확인 화면에 남는다.
- 사람이 모든 줄을 «SKU» 또는 «자유 줄»로 정해야 선적이 확정된다.
- 앱에서 상자 하나를 열고, 그 상자의 줄마다 센 수량을 넣고 확정하면 그 상자만큼 RECEIVE 가 된다. 기존 입고 커널을
  타므로 입고기본존·적치 대기·판매가능수량 재발행이 그대로 따라온다.
- 리스트와 다른 줄은 «예정 · 실제»가 남고, 선적 단위로 모자람·남음·리스트에 없던 물건을 본다.

**비목표 (이번에 안 함)**

- 중국 창고 재고, 발주와의 연결, 이동 지시서.
- 전달용 상자의 발송 처리. 표시만 한다.
- 상품 사진. 원본 파일을 보관하므로 나중에 뽑을 수 있다(§9).
- #1240 의 입고예정 투영 구현. 이 모델은 그 질의가 가능한 모양만 보장한다(§8).
- 확정 뒤 «고친 리스트를 다시 올려 차이만 합치기».

**반목표 (기술적으로 돌아가도 실패인 것)**

- AI 가 짚은 SKU·수량이 사람 확인 없이 확정된다.
- «안 셌다»와 «0개였다»가 구별되지 않는다.
- 같은 상자가 두 번 입고된다.
- 자유 줄(우리 SKU 가 아닌 물건)이 원장에 들어간다.
- 엑셀 함정(날짜로 바뀐 옵션, 수식 수량, 끝의 줄바꿈)을 파서가 조용히 고쳐 사람이 원문을 못 본다.

## 3. 입고리스트 실물 (샘플 1건에서 본 것)

열: 박스번호 · NO · 제품명 · 이미지 · 수량 · 옵션 · 바코드 · 총수량 · 비고. 한 시트, 약 250줄, 사진이 셀에 박혀
파일이 20MB 를 넘는다. 상자 이름 열(A)과 총수량 열(H)은 **셀 병합**으로 여러 줄을 덮는다.

| 형태 | 예 | 처리 |
|---|---|---|
| 상자 하나 | `L1` | 상자 하나 |
| 상자 범위 | `L5-L9`, `LM66-LM68` | 실물 상자에 L5…L9 가 **하나씩** 적혀 온다(사용자 확인) → 상자 다섯 개로 펼친다. 예정 수량은 다섯 상자를 덮는 줄 하나에 둔다 |
| 깨진 표기 | `L86-` | 추측(`L86`)하고 확인 화면에 띄운다 |
| 같은 바코드가 다른 상자에 | L23 에 19개, L24 에 51개 | 서로 다른 리스트 줄 |
| 11자리 셀메이트 코드 | `10390520010\n` | `sku_barcodes` 로 찾는다. 끝 줄바꿈 제거, 숫자형 셀은 정수 문자열로 |
| 다른 체계 코드 | `176-23`(박스테이프), `179-26`(용기) | 미확인 → 사람이 자유 줄로 |
| 바코드 칸에 품명·메모 | `장갑`, «도착하면 ○○님께 연락바람» | 미확인 → 사람이 정함 |
| 비고의 발송 지시 | «도착하면 (다른 업체)에 발송바람» | 그 상자를 전달용 후보로 |
| 엑셀 함정 | 옵션이 날짜로(`2026-01-03`), 수량이 수식(`=199+9`), NO 가 빈 줄 | 원문을 보존하고 이슈로 표시 |
| 총수량 | `총수량:15개`, `15` | 정보용. 원문만 보관하고 판정에 안 쓴다 |

🔒 공개 레포다. 입고리스트 원본·실제 업체명·사람 이름은 커밋하지 않는다. 파서 스펙의 픽스처는 위 형태를 흉내 낸
합성 데이터로 만든다(예: «○○님께 연락바람», «acme 에 발송바람»).

## 4. 접근

| | 방법 | 대가 |
|---|---|---|
| **A (채택)** | 브라우저(admin-web)가 엑셀을 열어 **칸의 원문과 행 번호만 JSON 으로** core 에 보낸다. 판정은 전부 core 가 한다. 원본 파일은 기존 업로드(presign → S3 직접 PUT, #690)로 따로 보관한다 | 브라우저에 시트 읽기 코드가 생긴다 |
| B | 파일을 S3 에 올리고 core 가 내려받아 읽는다 | core 가 사진 포함 20MB 를 메모리에 펼친다(core 는 OOM 전력이 있다) |

A 를 고른 이유: 서버 메모리 위험이 없고, 판정이 «줄 → 결과» 순수 함수라 양식 변형을 유닛 스펙으로 고정하기 쉽다.
원본 보관으로 A 의 단점(원본이 안 남음)을 메운다.

(참고: 처음엔 «admin-web 업로드가 4.7MB 에서 끊긴다»를 B 의 걸림돌로 봤지만 #690 이 이미 해결했다. 그 벽은 프록시로
본문을 직접 보내는 호출에만 남는다 — 그래서 원본을 core 로 multipart 업로드하는 라우트는 만들지 않는다.)

AI 는 core 가 부르지 않는다. `apps/ai` 의 비채팅 엔드포인트(선례 `apps/ai/src/product-description`)가 부른 사람의
쿠키로 core 를 HTTP 로 읽고, **후보만** core 에 적는다(§7).

## 5. 모델

### 5.1 용어

- **선적**: 중국에서 한 번에 보낸 물량. 입고리스트 파일 하나 = 선적 하나. 도착 창고와 도착 예정일을 가진다.
- **상자**: 실물 상자 하나. 선적 안에서 이름(`L5`)이 하나뿐이다. 앱에서 여는 단위이자 확정 단위.
  **처분**은 `stock`(재고로 입고) 또는 `forward`(전달용 — 열면 안내만, 확정 없음).
- **리스트 줄**: 엑셀의 한 줄. 상자 하나 이상을 덮는다. 종류는 셋이다.
  - `sku` — 우리 SKU 로 정해진 줄. 확정하면 원장에 RECEIVE.
  - `free` — 자유 줄. 우리 SKU 가 아닌 물건(포장 자재, 남에게 넘길 물건). 기록만 하고 원장에 안 들어간다.
  - `unresolved` — 파서·AI 가 아직 못 정한 줄. 선적 확정을 막는다.
- **상자 집계**: 상자를 확정할 때 그 상자에 대해 남긴 «센 수량» 한 행. 리스트 줄에 묶이거나(예정 있음), 줄 없이
  SKU 만 가진다(**리스트에 없던 물건**, 예정 0).

### 5.2 테이블 (core `inventory.schema.ts`, 테넌트별 DB)

> 이름: core 의 `shipments` 는 이미 **출고 상자**다. 그래서 전부 `inbound_shipment` 접두사를 붙인다. `consignment` 는
> 3PL 위탁(축 8)과 겹쳐 쓰지 않는다. 코드 식별자도 `InboundShipment…` 로 통일한다.

**`inbound_shipments`** — 선적

| 컬럼 | 비고 |
|---|---|
| `id` uuid PK | |
| `warehouse_id` → `warehouses` | 도착 창고 |
| `status` enum `inbound_shipment_status` | `draft` → `expected` → `receiving` → `closed`, 그리고 `canceled` |
| `name` varchar | 사람이 부르는 이름(기본값 = 파일 이름) |
| `expected_arrival` `date` (mode `'string'`) | 발주 라인과 같은 이유로 `date` — Date 객체 경계 함정(`purchase_order_lines.expected_arrival` 주석) |
| `source_file_id` uuid null | file-service 파일 id. 원본 보관 |
| `source_file_name` varchar | |
| `memo` text null | |
| `created_by`, `confirmed_at/by`, `closed_at/by`, `closed_reason`, `canceled_at/by` | |
| `created_at`, `updated_at` | |

인덱스: `(warehouse_id, status)`.

**`inbound_shipment_boxes`** — 상자

| 컬럼 | 비고 |
|---|---|
| `id` uuid PK | |
| `shipment_id` → `inbound_shipments` (cascade) | |
| `label` varchar(32) | 정규화한 이름(`L5`). `unique(shipment_id, label)` |
| `sort_key` integer | 처음 나온 순서. 화면 정렬용 |
| `origin` enum `inbound_shipment_box_origin` | `list`(리스트에서 나옴) \| `added`(리스트에 없던 상자, §8.7) |
| `disposition` enum `inbound_shipment_box_disposition` | `stock` \| `forward`, 기본 `stock` |
| `forward_note` text null | 비고 원문(발송 지시) |
| `status` enum `inbound_shipment_box_status` | `open` \| `received` |
| `receipt_id` → `inbound_receipts` null | 이 상자 확정이 만든 회차(재고 줄이 없으면 null) |
| `received_at`, `received_by` | |
| `version` integer | 낙관적 잠금 보조(앱 재시도 대사용) |

CHECK: `disposition = 'forward'` 이면 `status = 'open'`(전달용은 확정되지 않는다).

**`inbound_shipment_lines`** — 리스트 줄

| 컬럼 | 비고 |
|---|---|
| `id` uuid PK | |
| `shipment_id` → `inbound_shipments` (cascade) | |
| `row_number` integer | 엑셀의 실제 행 번호. 사람이 파일에서 그 줄을 찾는다 |
| `raw` jsonb | 원문 칸 전부(박스번호·NO·제품명·수량·옵션·바코드·총수량·비고, 각 칸의 표시 문자열·원값·수식). 판정에 다시 쓰지 않는다 |
| `kind` enum `inbound_shipment_line_kind` | `sku` \| `free` \| `unresolved` |
| `sku_id` → `skus` null | |
| `expected_qty` integer null | |
| `resolution` enum `inbound_shipment_line_resolution` null | `barcode`(파서가 찾음) \| `manual`(사람이 정함). AI 후보를 사람이 고르면 `manual` |
| `resolved_by`, `resolved_at` | |
| `issues` text[] | 파서 이슈 코드(§6.3). 화면 표시용 |
| `ai_candidates` jsonb null | `[{ skuId, reason }]`. **참고용** — 어떤 판정 코드도 읽지 않는다 |

CHECK:

- `(kind = 'sku') = (sku_id IS NOT NULL)`
- `kind = 'unresolved' OR (expected_qty IS NOT NULL AND expected_qty > 0)`

인덱스: `(shipment_id, row_number)`, 부분 인덱스 `(sku_id) WHERE kind = 'sku'`(#1240 용).

**`inbound_shipment_line_boxes`** — 줄이 덮는 상자

`(line_id, box_id)` PK. 범위 줄은 여러 행, 보통 줄은 한 행. 인덱스 `(box_id)`.

**`inbound_shipment_box_counts`** — 상자 집계

| 컬럼 | 비고 |
|---|---|
| `id` uuid PK | |
| `box_id` → `inbound_shipment_boxes` | |
| `line_id` → `inbound_shipment_lines` null | null = 리스트에 없던 물건 |
| `sku_id` → `skus` null | `sku` 줄이면 그 줄의 SKU, 리스트에 없던 물건이면 스캔한 SKU, 자유 줄이면 null |
| `counted_qty` integer | `>= 0`. 0 은 «열어 봤는데 없었다» |
| `receipt_line_id` → `inbound_receipt_lines` null, unique | 원장에 들어간 경우만. 발주의 `purchase_order_receipt_lines` 와 같은 역할(문서 → 회차 라인 연결) |
| `canceled_at`, `canceled_by` | 확정 취소 시 찍는다. 행은 지우지 않는다 |
| `created_by`, `created_at` | |

CHECK: `line_id IS NOT NULL OR sku_id IS NOT NULL`(리스트에 없던 물건은 SKU 필수), 리스트에 없던 물건은
`counted_qty > 0`.

부분 unique: `(box_id, line_id) WHERE canceled_at IS NULL AND line_id IS NOT NULL` — 한 상자에서 한 줄은 한 번만 센다.

### 5.3 입고 커널 변경

- `inbound_receipt_source` enum 에 `inbound_shipment` 를 더한다. 커널의 `ArrivalOrigin` 에
  `{ source: 'inbound_shipment' }` 를 더하고, method 는 발주와 같이 `planned` 로 둔다.
- `cancelLine` 의 source 불일치 메시지에 «선적 입고는 선적에서 취소하세요»를 더한다. 그래서 `/inbound/cancel`
  (직접 입고 취소)로 선적 입고를 취소할 수 없다.
- `inbound-kernel-boundary.arch.spec.ts` 의 `DOCUMENT_MODULES` 에 새 모듈 디렉터리(`inbound-shipment`)를 더한다.
  의존은 문서 → 커널 한 방향이다.

## 6. 업로드 · 초안 · 확정 (#1238)

### 6.1 흐름

1. admin-web 이 브라우저에서 엑셀을 연다(이미 쓰는 SheetJS `xlsx`). **병합 셀을 왼쪽 위 값으로 채우고**, 머리글
   행과 데이터 행을 칸별 `{ text(표시 문자열), value(원값), formula? }` 로 만들어 보낸다. 사진은 보내지 않는다.
   이 단계는 «읽기»만 한다 — 열 이름 맞추기도 core 가 한다(양식 변형을 core 스펙으로 고정하기 위해).
2. 같은 시점에 원본 파일을 `uploadFileToFileService` 로 올린다(새 file_context, §9). 실패해도 업로드는 진행하고
   `source_file_id` 만 비운다.
3. core 가 순수 함수로 판정(§6.3)하고 **초안 선적**(`draft`)을 만든다. 상자·줄·덮기·바코드 매칭·이슈가 한 트랜잭션.
4. 확인 화면: 사람이 미확인 줄을 SKU 또는 자유 줄로 정하고, 전달용 후보 상자를 확정하고, 필요하면 «AI 로 짚기»를
   누른다(§7).
5. **확정**(`draft → expected`). 이때부터 앱에서 상자가 열리고 #1240 의 입고예정 원천이 된다.

### 6.2 확정 조건 (전부 서버가 본다)

- 처분이 `stock` 인 상자를 하나라도 덮는 줄은 `unresolved` 가 0. (전달용 상자에만 있는 줄은 정하지 않아도 된다)
- 한 줄이 덮는 상자들의 처분이 같다(전달용과 재고 상자를 같이 덮는 줄은 사람이 고친다).
- 리스트에서 나온 상자(`origin = 'list'`)는 줄을 하나 이상 가진다.

### 6.3 파서 규칙 (core 순수 함수 `parseShipmentList`)

입력은 머리글 + 행, 출력은 상자 목록 + 줄 목록(+ 이슈). DB 를 모른다. 바코드 매칭은 그다음 단계(Reader)가 한다.

- **열 찾기**: 머리글 이름으로(`박스번호`·`NO`·`제품명`·`수량`·`옵션`·`바코드`·`총수량`·`비고`, 별칭 허용). 필수 열
  (박스번호·수량·바코드)이 없으면 400. 행 상한 2,000(빈 줄 제외, `supplier-sheet.parser.ts` 선례).
- **상자 이름**: 공백·줄바꿈 제거, 대문자. `^([A-Z]+)(\d+)$` 는 상자 하나. `^([A-Z]+)(\d+)\s*[-~]\s*(\1)?(\d+)$` 는
  범위 — 같은 접두사로 펼친다(`LM66-LM68` → LM66·LM67·LM68). 끝 번호가 시작보다 작거나 범위가 50을 넘으면 이슈.
  그 밖의 꼴(`L86-`)은 숫자 부분으로 추측하고 `box_label_guess`. 비면 `box_label_missing`(미확인).
- **수량**: 정수면 그대로. 수식이면 계산 결과를 쓰고 `qty_formula`. 정수가 아니거나 비면 `null` + 미확인.
- **바코드**: 앞뒤 공백·줄바꿈 제거, `="…"` 껍데기 제거, 숫자형 원값은 정수 문자열로. 그다음
  - 바코드 꼴(숫자 8자리 이상)이면 매칭 대상.
  - `숫자-숫자` 꼴이면 `foreign_code`(미확인).
  - 한글이 섞였거나 비고와 같으면 `barcode_is_text`(미확인).
- **옵션**: 원값이 날짜면 `option_date_coerced`(표시 문자열을 보여 준다). 판정에는 안 쓴다(AI 의 단서).
- **비고**: «발송»이 들어 있으면 그 줄의 상자들을 전달용 **후보**(`forward_hint`, 사람이 확정). «연락»이 들어 있으면
  `contact_hint`(표시만).
- **총수량·NO·이미지**: 판정에 안 쓴다. 원문만 `raw` 에.
- 같은 상자 이름이 떨어진 행에 또 나오면 같은 상자다.

**바코드 매칭 (Reader)**: 정규화한 값으로 `sku_barcodes.barcode` 를 찾고, 없으면 `skus.code` 를 찾는다.
SKU 하나면 `kind = 'sku'`, `resolution = 'barcode'`. 단 그 바코드가 상자 바코드(`packing_unit > 1`)면 리스트 수량이 낱개인지 상자 수인지 알 수 없으므로 `packing_unit_barcode`(미확인, 후보로 그 SKU 를 보여 준다)로 둔다. **(Claude 판단 — 라이브 `packing_unit` 은 메모 기준 전부 NULL 이라 지금은 안 생긴다)** 없으면 `barcode_not_found`, 둘 이상이면 `barcode_ambiguous`
(미확인, 후보를 `ai_candidates` 와 별개로 화면에 보여 줄 수 있게 이슈에 남긴다). 라이브 `sku_barcodes` 에는
`="…"` 로 저장된 옛 행이 있으므로(메모 기준 2.9만 행) DB 쪽 값도 같은 정규화로 비교한다.

### 6.4 초안·확정 뒤 고치기

- 초안: 줄의 종류·SKU·예정 수량·덮는 상자, 상자의 처분·이름을 고칠 수 있다. 초안은 통째로 취소(`canceled`)하고
  다시 올릴 수 있다.
- 확정 뒤(`expected`·`receiving`): **아직 확정된 상자를 하나도 덮지 않은 줄**만 종류·SKU·예정 수량을 고칠 수 있다.
  상자 처분은 그 상자가 `open` 일 때만 바꿀 수 있다. 도착 예정일·이름·메모는 언제든.
- `expected` 이고 확정된 상자가 0이면 선적을 취소할 수 있다.

## 7. AI 보조

- `apps/ai` 에 비채팅 엔드포인트 `POST /inbound-shipment-assist/suggest { shipmentId }`(`ai.assistant.use`).
  선례: `apps/ai/src/product-description`.
- ai 는 **부른 사람의 쿠키**로 core 에서 초안의 미확인 줄을 읽고, 줄마다 제품명·옵션으로 core SKU 검색
  (`GET /skus/search/advanced`)을 불러 후보를 모은 뒤, 모델에게 후보 중에서 고르게 한다(후보 밖 SKU 를 지어내지 않게).
- 결과는 core `PUT /inventory/inbound-shipments/:id/lines/:lineId/ai-candidates` 로 **후보만** 적는다. 줄의 `kind`·
  `sku_id`·`expected_qty` 는 바꾸지 않는다. 사람이 후보를 골라야 줄이 정해진다.
- 수량은 AI 가 읽지 않는다. 수량이 비거나 이상한 줄은 사람이 원문을 보고 넣는다.

## 8. 상자 확정 (#1239)

### 8.1 앱 흐름

작업자가 상자 이름을 입력하거나 스캔한다 → 앱이 **그 창고의 열린 선적(`expected`·`receiving`) 전부**에서 그 이름을
찾는다 → 그 상자의 줄이 나온다(범위 줄은 «L5~L9 합계 1,076 중 이 상자» 로) → 줄마다 센 수량을 넣고, 리스트에 없던 물건은
바코드를 스캔해 더한다 → 상자 확정.

전달용 상자는 열면 비고만 보이고 확정 버튼이 없다.

**같은 이름의 상자가 두 선적에 있을 때 (Claude 판단, 사용자: «드물지만 대비는 해야 한다»)**

선적마다 상자 이름이 `L1` 부터 다시 시작한다. 열린 선적이 둘 이상인 일은 드물지만(선적은 비용 때문에 몰아서 한다)
불가능하지 않다. 상자 이름에만 기대지 않는다.

- 이름이 한 선적에서만 맞으면 바로 연다.
- 둘 이상에서 맞으면 고르게 한다. 후보마다 **선적 이름·도착 예정일·그 상자의 첫 품목 2~3개**를 보여 준다. 상자를
  열어 보면 내용물로 바로 구별된다. 기본 선택은 두지 않는다.
- 연 상자 화면 맨 위에 선적 이름을 늘 보여 준다.
- 업로드 확정 때 같은 창고의 열린 선적과 상자 이름이 겹치면 경고한다(막지는 않는다).
- 서버 쪽은 확정이 상자 id 로 오므로 겹침과 무관하게 정확하다. 남는 위험은 «작업자가 잘못 고름»이고, 그건 위
  미리보기와 차이(§8.5)·당일 취소(§8.3)가 받친다.
- 중국 직원에게 상자에 선적 표시를 더 적게 하는 일은 하지 않는다(지금 업무를 바꾸지 않는다).

### 8.2 확정 API

`POST /inventory/inbound-shipments/:id/boxes/:boxId/receive`

```
{ idempotencyKey, counts: [{ lineId, countedQty }], unplanned: [{ skuId, quantity }] }
```

- 잠금 순서: 선적 행 → 상자 행(`FOR UPDATE`) → 커널. 커널은 문서 행을 잠그지 않는다(ADR-0039 잠금 순서 그대로).
- 상자가 `open`·`stock` 이고 선적이 `expected`·`receiving` 이어야 한다.
- **`counts` 는 그 상자를 덮는 줄 전부를 정확히 한 번씩** 담아야 한다(0 포함). 빠지거나 남는 줄이 있으면 400.
  «안 셌다»와 «0개»를 구별하는 장치다.
- `sku` 줄의 `countedQty > 0` 과 `unplanned` 전부를 커널 `recordArrival({ source: 'inbound_shipment', reason:
  'inbound_shipment', locationId: null(입고기본존) })` 한 번으로 넣는다. 이벤트 키는 발주와 같은 꼴
  `${endpoint}:${idempotencyKey}:${index}`.
- 집계 행을 쓰고(자유 줄은 `receipt_line_id` 없이), 상자를 `received` 로, 선적을 `receiving` 으로. 재고 상자가 전부
  `received` 면 선적을 `closed` 로.
- 끝에 `productSellableQuantity.recalculateAndPublishForSkus(skuIds, tx)`.
- 멱등: `InventoryIdempotencyService.withIdempotency`. 같은 키 재시도는 같은 응답, 다른 키로 이미 확정된 상자는 409.
- 권한: `inventory.stock.operate`(작업자 역할이 이미 가진 키).

### 8.3 확정 취소

`POST /inventory/inbound-shipments/:id/boxes/:boxId/receive/cancel { idempotencyKey }` — 그 상자의 회차 라인을 전부
커널 `cancelLine(expected: { source: 'inbound_shipment' })` 으로 취소한다. 규칙은 기존 입고 취소와 같다(당일·전량,
적치가 시작된 라인은 거절). 집계 행에 `canceled_at` 을 찍고 상자를 `open` 으로, 선적 상태를 다시 계산한다
(`closed` 였으면 `receiving` 으로). 권한 `inventory.stock.operate`.

### 8.4 종결 · 다시 열기 **(Claude 판단)**

- 재고 상자가 전부 `received` 가 되면 선적은 저절로 `closed`.
- 상자가 안 왔는데 끝내야 하면 `close { reason }`(사람). 남은 `open` 상자는 그대로 두고 확정만 막는다. 그 상자들의
  줄은 «안 옴»으로 차이에 잡힌다.
- 끝낸 뒤 상자가 나타나면 `reopen`(`closed → receiving`)하고 받는다.
- 확정 취소는 `closed` 선적에서도 되고, 선적을 `receiving` 으로 되돌린다(수동 종결이었어도 같다 — 다시 끝내면 된다).

### 8.5 차이

- 줄의 실제 = 그 줄의 유효 집계(`canceled_at IS NULL`) 합. 줄이 덮는 상자가 **전부** 확정됐을 때만 «모자람·남음»을
  판정하고, 그 전엔 «진행 중 (실제/예정)».
- 리스트에 없던 물건은 상자별로 따로 보인다.
- 선적 요약: 상자 확정 수/전체, 모자람 줄·남음 줄·리스트에 없던 물건 수, 전달용 상자 수.

### 8.6 #1240 이 읽을 모양 (구현은 #1240)

SKU 의 «오는 중» = `kind = 'sku'` 이고 선적이 `expected`·`receiving` 인 줄의 `max(expected_qty − 유효 집계 합, 0)`
을 줄이 덮는 상자 중 `open` 이 하나라도 있는 줄에 대해 더한 것. 도착 예정일은 `inbound_shipments.expected_arrival`.

### 8.7 리스트에 없던 상자 **(Claude 판단)**

앱에서 상자 이름을 넣었는데 그 선적에 없으면 «리스트에 없는 상자로 받기»를 고를 수 있다
(`POST /inventory/inbound-shipments/:id/boxes { label }`, `inventory.stock.operate`, 선적이 `expected`·`receiving`
일 때). `origin = 'added'`, 줄 0개로 생기고, 확정은 `unplanned` 만으로 한다. 결정 ④(«리스트와 다른 실물은 기록으로
남긴다»)를 상자 단위로 넓힌 것이다. 선적 화면에 «리스트에 없던 상자»로 따로 보인다.

## 9. 원본 파일

file-service `default-file-contexts` 에 입고리스트 컨텍스트 하나를 더한다(xlsx MIME, 비공개, 크기 상한 50MB).
**file_contexts 는 시드다** — 배포 뒤 `db:seed:ref` 가 돌아야 업로드가 404 를 안 낸다. 사진 추출은 나중에 이 원본에서
한다.

## 10. API 목록 (core, `@RequirePermission`)

| 라우트 | 권한 | 단계 |
|---|---|---|
| `POST /inventory/inbound-shipments` (머리글+행 → 초안) | `inventory.inbound_shipment.write` | 업로드 |
| `GET /inventory/inbound-shipments?status=&warehouseId=` | `inventory.stock.read` | 공통 |
| `GET /inventory/inbound-shipments/:id` (상자·줄·집계·차이) | `inventory.stock.read` | 공통 |
| `PATCH /inventory/inbound-shipments/:id` (이름·예정일·메모) | `inventory.inbound_shipment.write` | 공통 |
| `PATCH /inventory/inbound-shipments/:id/lines/:lineId` | `inventory.inbound_shipment.write` | 초안·확정 뒤(§6.4) |
| `PATCH /inventory/inbound-shipments/:id/boxes/:boxId` (처분·이름) | `inventory.inbound_shipment.write` | 초안·확정 뒤(§6.4) |
| `PUT /inventory/inbound-shipments/:id/lines/:lineId/ai-candidates` | `inventory.inbound_shipment.write` | 업로드 |
| `POST /inventory/inbound-shipments/:id/confirm` | `inventory.inbound_shipment.write` | 업로드 |
| `POST /inventory/inbound-shipments/:id/cancel` | `inventory.inbound_shipment.write` | 공통 |
| `POST /inventory/inbound-shipments/:id/close` (사유 — 상자 분실 등) | `inventory.inbound_shipment.write` | 검수 |
| `POST /inventory/inbound-shipments/:id/reopen` | `inventory.inbound_shipment.write` | 검수 |
| `POST /inventory/inbound-shipments/:id/boxes` (리스트에 없던 상자) | `inventory.stock.operate` | 검수 |
| `GET /inventory/inbound-shipment-boxes?warehouseId=&label=` (앱이 상자 찾기 — 열린 선적 전부, 후보 여러 개 가능) | `inventory.stock.read` | 검수 |
| `GET /inventory/inbound-shipments/:id/boxes/:boxId` (상자 열기) | `inventory.stock.read` | 검수 |
| `POST /inventory/inbound-shipments/:id/boxes/:boxId/receive` | `inventory.stock.operate` | 검수 |
| `POST /inventory/inbound-shipments/:id/boxes/:boxId/receive/cancel` | `inventory.stock.operate` | 검수 |

**권한 (사용자 결정 2026-11-16):** 입고리스트는 **중국 쪽 직원**이 올리고 미확인 줄 정리·확정까지 한다(상자를 직접
싸고 바코드를 적는 사람이다). `inventory.master.write` 는 SKU·로케이션·공급처·발주까지 고치는 넓은 권한이라 주지
않고, 선적 전용 키 **`inventory.inbound_shipment.write`** 하나를 새로 만든다. 올리기·고치기·AI 후보 적기·확정·취소·
종결·다시 열기를 이 키 하나로 한다(나중에 한국 쪽 검토가 필요하면 그때 «확정»만 뗀다).

- `permission-catalog.ts` 에 추가: `requires: ['inventory.stock.read']`(같은 대상의 `.read` 가 없으므로),
  `grantOnFirstRegistration` 은 `admin`.
- 중국 쪽 직원 계정(없으면 발급)의 역할에는 배포 뒤 사람이 이 키와 `inventory.stock.read` 를 직접 준다(§11).
- 상자 확정·취소·리스트에 없던 상자는 현장 작업이라 기존 `inventory.stock.operate`(작업자 역할이 이미 가짐).

고객 개인정보는 없다.

## 11. 배포

- 마이그 하나(§5.2 의 새 enum·테이블 + `inbound_receipt_source` 값 추가). 전부 추가라 **expand: migrate → deploy**.
  `ALTER TYPE … ADD VALUE` 로 넣은 값은 같은 마이그 트랜잭션 안에서 쓸 수 없으니, 이 마이그(와 같은 배치의 다른
  대기 마이그)가 새 값을 SQL 로 쓰지 않게 한다.
- core 를 먼저, 그다음 admin-web·ai·warehouse-app. 화면이 없으면 새 라우트는 휴면이다.
- 배포 뒤 `db:seed:ref`(file_context).
- 배포 뒤 중국 쪽 직원 역할에 `inventory.inbound_shipment.write` · `inventory.stock.read` 부여(`/users/roles`). 첫 등록
  부여는 admin 뿐이다.

## 12. 작업 순서

> 이 설계 안의 순서다. 컷오버 «1단계»(#1233)와 무관하다. 나머지가 전부 core API 를 부르므로 core 가 먼저다.

① **core 모델·API** — 스키마·마이그, 파서 순수 함수 + 스펙(샘플 형태 전부), 초안·해소·확정·상자 확정·취소·차이,
   커널 source 추가, arch 스펙 갱신, 통합 스펙(`describeIfDb`). ← 이번 작업
② **admin-web 업로드·확인 화면 + ai 엔드포인트 + file_context** (#1238 마무리)
③ **warehouse-app 상자 입고 화면** (#1239 마무리). 같은 릴리스에 기존 화면이 새 `source` 를 알게 한다 — 지금
   `native/warehouse-app/src/domains/inbound/types.ts` 의 `isActionablePutaway` 는 `direct`·`purchase_order` 만 적치
   시트를 열고, `InboundHistoryScreen` 은 `purchase_order` 가 아니면 직접 입고 취소로 보내 선적 입고에서 409 가 난다.
   admin-web DTO 의 `source` 유니언도 같이. 선적 입고가 생기는 첫 화면이 ③ 이므로 그 전엔 문제가 드러나지 않는다.
④ #1240

## 13. 문서

`CONTEXT.md` 에 선적·상자·리스트 줄·자유 줄·전달용 상자·리스트에 없던 물건을 더하고, «이동 지시서» 항목에
«중국 → 부천 구간은 이동 지시서가 아니라 선적 입고로 받는다(2026-11-08 결정, 중국 창고는 우리 밖)»를 적는다.

## 14. 빌더에게 맡기는 것

- 파일·클래스 배치(Service → Reader/Manager → Repository), DTO 모양, 에러 문구.
- 머리글 별칭 목록, 이슈 코드 이름의 세부.
- 상자 열기 응답의 정렬·표시 문자열.
