# 아몬드템플릿 시안 → 와우프레스 자동 발주 설계

- 날짜: 2026-10-14
- 브랜치: `feat/almond-template-wowpress-order`
- 관련: `web/almondyoung-storefront/src/domains/almond-template/README.md` 한계 절, #1063(라인 구성 판정)

## 1. 목적

고객이 아몬드템플릿 시안을 고쳐 결제를 마치면, 그 시안의 인쇄 파일이 와우프레스 OPEN API 로 자동 발주되고,
와우프레스가 고객에게 직접 배송한 송장이 고객 주문 화면까지 돌아오게 한다.

### 성공 기준

1. 결제 완료된 아몬드템플릿 라인은 사람 손 없이 와우프레스 주문 + 인쇄 파일 전달까지 끝난다.
2. 와우프레스 확인이 안 끝난 품목은 주문 메모(`ordbody`)에 테스트 문구가 붙어 나가고, 운영자가 전화로 확인한 뒤 품목 단위로 정식 전환한다.
3. 같은 라인이 와우프레스에 두 번 주문되지 않는다.
4. 생산이 시작된 주문은 고객 취소가 막히고 고객에게 이유가 보인다. 생산 전이면 와우프레스 취소 후 정상 환불된다.
5. 와우프레스 송장이 Medusa 주문 배송 정보로 반영돼 고객이 배송 추적을 본다.
6. 사람이 손대야 하는 건(발주 실패·미지원 품목·테스트 확인 대기·취소 거절)은 어드민 한 곳에서 보인다.

## 2. 현황 (2026-10-14 확인)

- **시안 수정 후 구매 흐름은 이미 있다.** 게시 시안 → 편집기 → 미리보기 `이 시안으로 주문하기`
  (`use-design-order.ts`) → ugc `almond_designs` 에 스냅샷 저장 → 상품 페이지 `?almond_design=<id>` →
  장바구니 라인 `metadata.almond_design_id` → 어드민 CS 주문조회 `AlmondDesignPrintCard` 에서 인쇄 파일 다운로드.
- 품목 종류는 `catalog.ts` 의 `PrintKind`(pet·mini·card·window·menu·diploma·nail). 와우프레스 코드는 아직 없다.
- 인쇄 파일 링크는 ugc `GET /admin/almond-designs/:id/print-link`(관리자 스코프, 5분 S3 서명 URL)뿐이다.
- channel-adapter `MedusaOrderSource` 는 결제 게이트(무통장 입금 대기 제외)를 이미 건다 → core 가 받는
  `OrderCreated` 는 결제 완료 주문이다. 라인 `metadata.almond_design_id` 는 지금 core 로 넘어가지 않는다.
- core 의 창고 출고 제외 판정은 `resolveLineComposition`(`product-matching/line-composition/line-composition.ts`)
  한 곳이고 SQL 짝 `line-resolved.sql.ts` 와 parity 스펙이 있다. 수요 집계(`demand-series.writer.ts`)는 따로 디지털을 뺀다.
- 고객 셀프 취소 판정은 core `store-sales-orders.service.ts` (`already_processing` 등).
- core → Medusa 배송 반영 경로는 `CoreFulfillmentShipped`/`Delivered` → channel-adapter → Medusa order metadata(V1/V2 projection).

## 3. 와우프레스 OPEN API 요약 (문서 Version 2026.10.14, `wowpress.co.kr/api/document`, 로그인 필요)

2026-10-15 에 문서 원문을 다시 읽어 갱신했다. 절 번호(§6.x)는 와우프레스 문서 기준이다.

| 항목 | 내용 |
|---|---|
| 서버 | **테스트 서버 없음.** 모든 호출이 운영 주문이 된다. `devshop.wowpress.co.kr`(API 샘플 쇼핑몰)도 운영 API 에 붙어 있어 주문하면 실주문이다. 시험 수단은 `cjson_order` 의 `action:'cal'`(계산만)과 입금대기 상태 취소뿐 |
| 토큰 | `GET api.wowpress.co.kr/api/login/issue` 본문 `{authUid, authPw}` → JWT, 1년 유효, refresh 없음. SNS 가입 계정은 문서 페이지에 표시되는 계정별 값을 쓴다 |
| 헤더 | `authorization: Bearer <token>` |
| 공통 응답 | `resultCode`(200/400), `errMsg`, `resultMap` |
| 가격조회 | `cjson_jobcost`(§6.4). 주문 전 필수(가격조회가 안 되는 조합은 주문 불가). 응답 `ordcost_price/dc/sup/tax/bill`, `dlvygrpno`(묶음배송그룹), `boxcnt`, `weight_*`, `exitdate`. **택배비는 없다**(`dlvcost_base: 0`) |
| 주문 | `POST /api/v1/ord/cjson_order`(§6.5) `{action:'ord'\|'cal', ordreq, dlvymcd, dlvyfr, dlvyto}`. `ordreq` 의 **바깥 원소 하나 = 와우프레스 주문 하나**, 안쪽 배열 = `[주제품, 그 부자재…]`(부자재도 같은 `ordkey`). 다른 제품을 한 요청에 여럿 넣을 수 있고 "묶음가능한 제품은 자동 묶음배송"된다. 라인 필드 `prodno`, `ordqty`, `ordcnt`, `ordtitle`, `ordbody`(주문메모), `ordkey`(사용자 주문키), `prsjob`(옵션) |
| 주문 응답 | 상위에 합계 `ordcost_*`, `dlvcost_price/dc/sup/tax/bill`, `cost_bill`. `ordinfo[]` 는 주문별(`ordnum`, `dboxno`, `prodno`, `dlvygrpno`), `dlvinfo[]` 는 배송박스별(`dboxno`, `dboxnum`, `ordcnt`, `ordcost_dlvyfree`, `dlvcost_*`). **`ordinfo` 에 `ordkey` 가 없다** — 줄↔`ordnum` 대응은 `ord_list(ordkey)` 로 확정한다(응답 순서 보장 문구 없음) |
| 배송비 조회 | `POST /api/v1/ord/cjson_dlvycost`(§6.14). 파라미터는 주문과 동일, 선불택배만. 응답 `boxcnt`, `boxcost`, `dlvy_yn`, `addcost`(제주 도선료) |
| 파일 | `POST file.wowpress.co.kr/api/v1/file/uploadurl` form-data `{ordnum, filename, fileurl}`(§6.8). **주문(ordnum)당 파일 하나**(§6.7). 파일이 없으면 접수되지 않는다. 에러처리 상태에서 같은 ordnum 으로 올리면 재접수 |
| 결제 | API 주문은 입금대기로 들어간다. 선입금이 있으면 자동 정산 후 생산 |
| 취소 | `POST /api/v1/ord/ord_cancel {ordnum}`(§6.10). **개별 주문 단위.** 입금대기·접수대기(접수 전)·에러 상태만 가능. 묶음배송된 주문을 취소하면 새 배송박스가 생기고 **남은 주문에 배송비가 부과(미납금)될 수 있다** |
| 목록 | `POST /api/v1/ord/ord_list`(§6.12) — `ordkey`·`ordnum`·`dboxnum`·기간 검색, 최대 100행. 행 = 주문 단위(`ordnum`, `ordkey`, `dboxnum`, `dlvyno`, `shipnum`, `ordstat`) |
| 상세 | `GET /api/v1/ord/order/{ordnum}`(§6.13) — 상태 `ordinfo.ordstat`/`jobstat`(주문 단위), 우리가 보낸 ordkey 는 `ordinfo.userordkey`. 택배 등 직배송이 아닌 주문은 출고완료(80)에서 끝난다(84·85 는 와우프레스 직배송만, §9.3). 배송은 **박스 단위** `ordinfo.dlvybox` `{dboxnum, dlvyname(택배사 이름), dlvystat, costdlvy, ordnum[], shipnum(송장)}`. `dlvyinvc`/`dlvycomp`/`dlvyno` 키는 **상세에 없다** |
| 묶음배송 | 같은 묶음배송 그룹(`dlvygrpno`, 명함·스티커) 제품끼리만 자동 묶음(§7.8). 책자·봉투·자석·현수막·부자재 등은 묶음 불가 → 박스·택배비 따로. 다른 요청끼리는 자동으로 묶이지 않는다(수동 `POST /api/v1/dlvy/bdle {ordnum, dboxnum}`, 접수 전만) |
| 선불택배 불가 | §7.6·§7.7 "사인제품은 선불택배불가", "대상은 현수막, 배너 제품 등". 배송 안내 페이지의 사인제품 선불 요금표와 어긋나므로 제품별 `prod_info.deliverinfo.dlvyprepay` 로 확인한다. devshop 배송방법 목록은 제품과 무관한 공통 목록이라 근거가 못 된다 |
| 배송방법 | `dlvymcd`(§9.4): 0 방문, 1 배쑝와쑝, 2 대리배송, 3 착불택배, 4 선불택배, 5 화물, 6 착불퀵, 7 선불퀵, 8 고속버스, 9 항공, 10 선박. 선불택배 택배사는 주소로 자동(`dlvyno` 109 롯데, 156 CJ). 선불택배 가능 여부는 제품상세 `deliverinfo.dlvyprepay`(§7.6) |
| 콜백 | 상태 변경 시 등록 URL 로 POST, 10초 간격 최대 10회. 주문 단위로 `dlvyno`, `dlvynum`, `dlvyinvc`, `dlvycomp` 를 준다. **이번엔 쓰지 않는다**(§8) |

택배비(배송 안내 페이지, 부가세 별도): 명함 500매/8건 이하 2,700원·9~24건 4,200원, 스티커 500매/10건 이하 2,700원,
그 밖은 20kg 이하 1박스 기준 2,700~4,200원. 무료택배는 등급별 공급가 문턱(명함·스티커 2~5만원, 그 외 5만원)을
**배송박스 합계**로 판정한다(주문 응답 `dlvinfo.ordcost_dlvyfree`). 제주·도서산간은 무료택배 제외, 도선료 `addcost` 별도.

파일 형식 조건은 메모리 `project_wowpress_print_file_acceptance` 정리를 따른다(PET·미니배너 CMYK JPG, 현수막 1/10 JPG 700dpi, 명함 PDF 등).

## 4. 결정 사항

| # | 결정 | 이유 |
|---|---|---|
| D1 | 범위는 아몬드템플릿 전 품목. 매핑표가 있는 품목만 발주하고 없는 품목은 `unsupported` | 품목을 하나씩 열어 테스트 제출하기 위해 |
| D2 | 결제 완료 즉시 자동 발주(유예 없음) | 주문제작 상품. 구매 전 안내·동의로 보완 |
| D3 | 발주 주체는 **core** (`OrderCreated` 소비 지점) | 판매주문·취소·배송 흐름의 주인이 core |
| D4 | 품목별 `confirmed=false` 면 `ordbody` 에 테스트 메모 | 와우프레스 전화 확인 전 단계 |
| D5 | 송장은 core 크론 폴링으로 가져와 core 고객 배송조회 응답에 바로 붙인다 | 공개 콜백 엔드포인트·위조 검증 불필요, 놓침 없음 |
| D6 | 고객 취소 시 와우프레스 취소를 먼저 시도. 거절이면 우리 취소를 하지 않고 고객에게 알림 | 환불됐는데 인쇄물이 나가는 사고 차단 |
| D7 | 환불 자체는 막지 않는다. 단순변심 취소만 생산 후 불가, 하자는 교환·환불 | 전자상거래법 |
| D8 | 결제 화면에 주문제작 안내 + 확인 체크박스(필수) | 단순변심 취소 거절 근거 |
| D9 | 계정 값은 SST secret, 로컬은 `apps/core/.env` | 다른 외부 키와 같은 방식 |

## 5. 전체 흐름

```
Medusa 결제 완료
 └ channel-adapter MedusaOrderSource (결제 게이트 기존)
    └ 라인 metadata.almond_design_id → 주문 이벤트 라인 필드 almondDesignId
       └ core OrderCreated
          ├ sales_order_lines.almond_design_id 저장
          ├ resolveLineComposition → { kind: 'outsourced' } → 창고 출고·재고 예약·수요 집계 제외
          └ print_orders 행 생성 (pending)            ← 같은 트랜잭션
             └ PrintOrderSubmitWorker (@CronOnce, 1분)
                1) 매핑표 조회 → 없으면 unsupported
                2) ugc 내부 print-link (HTTP, 내부키)
                3) 가격조회 → cjson_order (ordkey=라인 id, ordbody=테스트 메모?)
                4) uploadurl(ordnum, fileurl)
                → submitted / 실패 시 재시도, 상한 후 failed
             └ PrintOrderTrackingWorker (@CronOnce, 30분)
                submitted·shipped 행의 주문상세 조회 → 송장 생기면 shipped, 배송완료면 delivered
                → core 고객 배송조회 응답에 송장 포함
고객/운영자 취소
 └ submitted 라인이 있으면 ord_cancel 먼저 → 성공: cancelled 후 기존 취소 진행
                                         → 거절: 취소 중단, 고객 알림 / 운영자 보드
```

## 6. 구성 요소

### 6.1 channel-adapter

- `medusa-order.source.ts`: 라인 `metadata.almond_design_id` 가 UUID 형식이면 원어 스냅샷 라인에 담는다.
- `channel-order-source.interface.ts` / `channel-order.translator.ts`: 라인 필드 `almondDesignId?: string` 전달.
- 이벤트 계약(`@packages/event-contracts`)의 주문 라인에 선택 필드 추가. 선택 필드라 옛 소비자는 무시한다.

### 6.2 core — 판매주문

- `sales_order_lines.almond_design_id uuid NULL` (additive, expand 1 PR).
- `OrderCreated` 소비(`order-events.consumer.ts` → 판매주문 생성)에서 값 저장. 같은 트랜잭션에서
  `almondDesignId` 가 있는 라인마다 `print_orders` 행을 `pending` 으로 만든다(`sales_order_line_id` unique, 재처리 시 `ON CONFLICT DO NOTHING`).
- `line-composition.ts`: `LineForComposition` 에 `almondDesignId` 를 더하고, 디지털 판정 바로 다음에
  `if (line.almondDesignId) return { kind: 'outsourced' }`. SQL 짝 `line-resolved.sql.ts` 도 같은 규칙. parity 스펙 갱신.
  `fulfillments.service.ts:466` 의 제외 목록에 `outsourced` 추가. 화면에서 `missing` 으로 보이지 않게 한다.
- `demand-series.writer.ts` 수요 집계 SQL 에서 `almond_design_id IS NOT NULL` 라인 제외.
- `OrderModified` 로 라인이 바뀌는 경우는 이번 범위 밖(§11).

### 6.3 core — `modules/print-order` (신규)

레이어는 루트 CLAUDE.md 규칙(Controller → Service → Manager/Reader → Repository)을 따른다.

**테이블 `print_orders`** (core 스키마, 한 행 = 판매주문 라인 하나)

| 컬럼 | 설명 |
|---|---|
| `id` uuid PK | |
| `sales_order_id`, `sales_order_line_id` (unique) | |
| `almond_design_id` uuid | |
| `vendor` varchar | `'wowpress'` 고정. 나중에 업체가 늘면 쓴다 |
| `status` | `pending` · `submitting` · `submitted` · `shipped` · `delivered` · `failed` · `unsupported` · `cancelled` · `cancel_refused` |
| `test_memo` boolean | 테스트 메모를 붙여 보냈는지 |
| `vendor_order_number` | 와우프레스 `ordnum` |
| `attempt_count` int, `last_error` text, `next_attempt_at` timestamptz | 재시도 |
| `carrier`, `tracking_number`, `shipped_at`, `delivered_at` | 송장 |
| `test_confirmed_at`, `test_confirmed_by`, `test_note` | 운영자가 테스트 건 전화 확인을 마친 시각·사람·결과 메모 |
| `cancel_refused_at` | 와우프레스가 취소를 거절한 시각(보드 경과 시간) |
| `created_at`, `updated_at` | |

**품목 매핑표** `print-order/wowpress/wowpress-products.ts` (코드)

```ts
// 키: PIM variant id (= sales_order_lines.variant_id). variant 가 크기·용지·코팅 등 옵션을 이미 정한다
{ prodno, jobpresetno, prsjob: [...], awkjob: [...], qtyPerUnit, file: { format: 'jpg' | 'pdf' | 'eps', dpi }, confirmed: boolean }
```

- 품목을 열 때마다 와우프레스 제품상세 API 로 옵션 코드를 뽑아 한 줄을 더한다. 가드 스펙이 키 중복·필수 필드를 지킨다.
- `confirmed` 를 `true` 로 바꾸는 것도 이 파일 한 줄 수정이다.

**`WowpressClient`** (Repository 층, 외부 API)

- 토큰: 첫 호출 때 `WOWPRESS_AUTH_UID`/`WOWPRESS_AUTH_PW` 로 발급해 프로세스 메모리에 둔다. 401 이면 한 번 재발급.
- 메서드: `quote`, `order`, `uploadFileUrl`, `cancel`, `findByOrdkey`, `detail`. 응답 `resultCode !== '200'` 은 `errMsg` 를 담은 예외.
- 와우프레스 오류 중 "취소 불가 상태" 는 별도 예외 타입으로 구분한다(D6 분기용).

**`UgcPrintFileClient`**: ugc 신규 내부 경로 `GET /internal/almond-designs/:id/print-link?format=&dpi=` 호출, 헤더 `Authorization: Bearer ${UGC_INTERNAL_KEY}`.

**`PrintOrderSubmitWorker`** (`@CronOnce('* * * * *', { name: 'print-order-submit' })`)

1. `status='pending' AND next_attempt_at <= now()` 행을 소수 집는다.
2. 집은 행을 `submitting` 으로 바꾼 뒤(조건부 UPDATE) 외부 호출을 한다.
3. 매핑 없음 → `unsupported`. 있으면 링크 → 가격조회 → 주문 → 파일 전달.
   - `dlvyto`: 판매주문 배송지(이름·연락처·주소·우편번호, `sd/sgg/umd` 분해 포함). `dlvyfr`: 아몬드영 고정값(env).
   - `ordtitle`: `아몬드영 <판매주문 번호>`. `ordkey`: `sales_order_line_id`.
   - `ordbody`: `test_memo` 면 `테스트 시안입니다. 혹시 이 시안대로 출력이 되나요?`.
4. 성공 → `submitted` + `vendor_order_number`. 주문은 됐는데 파일 전달이 실패하면 `ordnum` 을 남긴 채 재시도에서 파일 전달만 다시 한다.
5. 실패 → `attempt_count+1`, `next_attempt_at` 지수 지연, 3회 넘으면 `failed`.

**응답 유실 복구**: 크론 시작 시 `submitting` 이 10분 넘게 남은 행은 다시 주문하지 않고 `findByOrdkey` 로 확인한다.
있으면 `ordnum` 을 채워 파일 전달 단계부터, 없으면 `pending` 으로 되돌린다. 와우프레스 문서가 중복 주문 가능성을 경고한 부분이다.

**`PrintOrderTrackingWorker`** (`@CronOnce('*/30 * * * *', { name: 'print-order-tracking' })`)

- `submitted`·`shipped` 행을 `detail(ordnum)` 로 조회.
- 송장(`ordinfo.dlvybox.shipnum`)이 처음 생기면 `shipped`. `ordstat=85`(배송완료)면 `delivered`. 택배(선불택배 `dlvymcd=4`)는 와우프레스가
  `ordstat=80`(출고완료)에서 끝나므로 보통 `shipped` 에 머문다 — 배송완료 추적은 이번 범위 밖.
  (처음 구현은 콜백 전용 키 `dlvyinvc`/`dlvyno` 를 상세에서 읽어 송장을 못 읽는다 — 2026-10-15 문서 재확인으로 발견, 묶음 발주 작업에서 고친다.)
- 택배사: 상세의 `dlvybox.dlvyname`(이름) 또는 `dboxnum` 의 가운데 값(`4-156-…`)으로 판정한다. 109=롯데택배(`LOTTE`), 156=CJ대한통운(`CJ`). 그 밖의 값은 `carrier=null` 로 두고 송장만 보인다.
- **반영 경로:** 고객 배송조회는 core `/store/orders/by-channel-order/:id/tracking`(`store-sales-orders.service.ts`)이 만든다.
  이 응답의 `shipments[]` 에 `print_orders` 의 송장을 한 항목씩(`fulfillmentOrderId` 자리에 `print_orders.id`) 덧붙이고,
  주문 액션 판정의 출고 증거에도 포함한다. Kafka 배송 이벤트·channel-adapter·Medusa metadata 는 건드리지 않는다
  (V2 배송 이벤트 계약은 창고 FO·SKU·박스 id 를 필수로 요구해 외주 라인을 억지로 넣으면 가짜 id 가 생긴다).
- `delivered` 가 된 행은 더 조회하지 않는다. 조회 중 송장이 사라진 응답은 마지막 송장을 유지한다(택배는 보통 출고완료에서 끝나 역행이 드물다).

**취소** `PrintOrderCancellation.cancelLines(salesOrderId, lineIds)` — 판매주문 취소 경로(고객 셀프·운영자) 앞단에서 부른다.

| print_orders 상태 | 동작 |
|---|---|
| 없음 / `pending` / `unsupported` / `failed`(ordnum 없음) | `cancelled` 로 바꾸고 통과 |
| `submitting` | 거절(잠시 후 다시 시도 안내). 응답 유실 복구가 끝나야 판단 가능 |
| `submitted`(또는 ordnum 있는 `failed`) | `ord_cancel` → 성공: `cancelled` 후 통과 / 취소 불가: `cancel_refused` 후 **취소 중단** |
| `shipped` · `delivered` | 기존 출고 후 규칙(취소 불가, 반품) |
| `cancelled` | 통과(재시도 안전) |

- 고객 셀프 취소: 중단 시 `BadRequestError('PRINT_IN_PRODUCTION')` 계열로 응답하고, 이후 주문 액션 조회의
  `cancelUnavailableReason` 은 `already_processing` 이 된다(`store-sales-orders.service.ts` 판정에 print_orders 조건 추가).
- 운영자 취소: 같은 함수를 지난다. 거절 건은 기존 차단 사유 목록이 아니라 `와우프레스 발주` 어드민 페이지(§6.5)의 `취소 확인 필요` 탭에 보인다.
- 외부 취소 중복을 막기 위해 취소도 `cancelling` 상태로 먼저 선점한 프로세스만 와우프레스 취소를 부른다. 주문상세 `ordstat=90` 이면 이미 취소된 것으로 본다.
  운영자는 `와우프레스 발주` 페이지(§6.5)에서 전화 결과에 따라 `취소 완료함`(이어서 취소) 또는
  `생산 진행으로 처리`(취소 철회 + 고객 알림) 중 하나로 마무리한다.
- `OrderCancelled` 이벤트(채널에서 이미 취소된 경우)가 오면 같은 함수를 부르되, 중단할 수 없으므로 `cancel_refused` 를 남겨 보드에 띄운다.

**어드민 API** (`admin:...` 스코프, 기존 core 어드민 가드)

- `GET /admin/print-orders/summary` — 탭별 처리할 건수(사이드바 배지·상단 카드)
- `GET /admin/print-orders?tab=&q=` — 목록
- `GET /admin/print-orders/by-line/:lineId` — 주문 화면 카드용
- `POST /admin/print-orders/:id/retry` — `failed`·`unsupported` → `pending` (attempt 초기화)
- `POST /admin/print-orders/:id/confirm-test` `{ note }` — 테스트 건 전화 확인 완료
- `POST /admin/print-orders/:id/resolve-cancel` `{ outcome: 'cancelled' | 'proceed' }` — 취소 거절 건 마무리.
  `cancelled` 면 `cancelled` 로 바꾸고 운영자 취소(`adminCancelRequest`)를 이어서 부른다. `proceed` 면 `submitted` 로 되돌린다.
  거절 시점에 우리 취소 요청은 만들지 않았으므로 철회할 것이 없고, 고객은 취소를 누른 순간 알림창으로 이미 안내받았다.

### 6.4 ugc-service

- `controllers/internal-almond-designs.controller.ts` 신규, `@UgcInternalAuth()`.
  `GET /internal/almond-designs/:id/print-link` — 기존 `printLink` 로직 재사용.
  기존 로직은 고객/관리자 accessToken 으로 file-service 업로드를 하므로, 내부 경로는 file-service 내부키 업로드로 바꾼 분기가 필요하다(계획 단계에서 file-service 내부 업로드 경로 유무 확인).

### 6.5 admin-web — `주문 > 와우프레스 발주` 페이지 (`/order/print-orders`)

정체 보드(창고 출고 단계)와 섞지 않고 별도 페이지로 둔다.

```
와우프레스 발주                                    마지막 갱신 14:32 · 송장 조회 30분마다
┌───────────────┬───────────────┬───────────────┬───────────────┬──────────┐
│ 취소 확인 필요 │ 테스트 확인대기 │ 발주 실패      │ 미지원 품목    │ 전체      │
│      2  (빨강) │      5         │      1        │      0        │   128    │
└───────────────┴───────────────┴───────────────┴───────────────┴──────────┘
 행: 우리 주문 · 고객(이름·연락처) · 와우프레스 주문번호(복사) · 품목·크기 · 시각(경과) · 조치
 하단: 와우프레스 파일상담 전화번호·운영시간
```

| 탭 | 대상 | 조치 |
|---|---|---|
| 취소 확인 필요 | `cancel_refused` | **취소 완료함**(전화로 와우프레스 취소 성공 → `cancelled`, 우리 취소·환불 진행) / **생산 진행으로 처리**(취소 불가 확정 → `submitted` 로 되돌림) |
| 테스트 확인대기 | `test_memo AND test_confirmed_at IS NULL` | **확인 완료**(결과 메모 입력: 출력 가능 / 수정 필요) |
| 발주 실패 | `failed` | **재전송**, 실패 사유 펼침 |
| 미지원 품목 | `unsupported` | 매핑 추가 안내 + **재전송** |
| 전체 | 모든 행 | 상태 필터, 주문번호 검색, 송장 클릭 시 배송 조회 |

- 상단 카드 숫자는 사람이 처리할 건수이며 처리하면 빠진다.
- 사이드바 `와우프레스 발주` 메뉴에 처리할 건수 배지(`quarantine-menu-badge.tsx` 와 같은 방식). `취소 확인 필요` 가 1건 이상이면 빨강.
- CS 주문조회·고객 상세의 `AlmondDesignPrintCard` 에 와우프레스 주문번호·상태·송장과 이 페이지 링크.

### 6.6 storefront

- 상품 페이지 주문 버튼 위(`hasAlmondTemplate` 상품)와 결제 화면 `order-summary.tsx` 에 안내:

  > **주문제작 상품 안내**
  > 고객님이 만드신 시안 그대로 인쇄되는 주문제작 상품입니다.
  > 결제 후 바로 제작 접수되며, 제작이 시작된 뒤에는 단순 변심에 의한 취소·환불이 어렵습니다.
  > 문구 오타, 사진, 크기를 결제 전에 한 번 더 확인해 주세요.

- 결제 화면: 장바구니에 `almond_design_id` 라인이 있으면 `위 내용을 확인했습니다` 체크박스가 체크돼야 결제 버튼이 활성화된다.
  체크 사실은 cart metadata `custom_order_notice_agreed_at` 로 남긴다(분쟁 근거).
- 취소 거절 알림창:

  > 주문하신 인쇄물이 이미 제작에 들어가 취소할 수 없습니다. 인쇄 상태에 문제가 있으면 상품을 받으신 뒤 교환·환불을 신청해 주세요.

- i18n: ko/en/ja 메시지에 키 추가.

### 6.7 설정

| 키 | 위치 | 비고 |
|---|---|---|
| `WOWPRESS_AUTH_UID`, `WOWPRESS_AUTH_PW` | core SST secret / `apps/core/.env` | 커밋 금지 |
| `WOWPRESS_SENDER_*` (이름·연락처·주소) | core env | `dlvyfr` |
| `UGC_SERVICE_URL`, `UGC_INTERNAL_KEY` | core | ugc 쪽 기존 내부키와 같은 값 |
| `PRINT_ORDER_SUBMIT_ENABLED` | core | 기본 `false`. 켜기 전엔 행만 쌓이고 전송하지 않는다(배포와 개시를 분리) |

## 7. 오류 처리 요약

- 외부 호출 전 `submitting` 선점 → 크론 겹침·재처리로 이중 주문하지 않는다(`@CronOnce` + 조건부 UPDATE 이중 방어).
- 응답 유실은 `ordkey` 조회로 복구(§6.3).
- 매핑 없음은 재시도하지 않는다(`unsupported`). 매핑을 더한 뒤 보드에서 재전송.
- 파일 링크는 5분 서명 URL. 동기 `uploadurl` 이라 응답 전에 받아 간다. 비동기(`uploadasyc`)는 쓰지 않는다.
- 와우프레스 장애 중 들어온 주문은 `pending` 에 쌓였다가 복구 후 나간다. 데이터 유실 없음.

## 8. 하지 않는 것

- 와우프레스 상태 콜백(D5). 30분 지연이 문제가 되면 붙인다.
- 와우프레스 API 카드결제(빌링키). 정산은 선입금으로 운영한다.
- 유예 시간 후 발주(D2).
- `OrderModified` 로 인쇄 라인 수량·옵션이 바뀌는 경우의 재발주. 이번엔 보드에 띄우지도 않는다 — 발생 시 이슈로 연다.
- 품목 매핑표 내용 자체. 품목별로 와우프레스 제품상세를 보고 채우는 일은 출시 절차(§10)다.

## 9. 테스트

- `WowpressClient`: HTTP 를 가짜로 바꿔 요청 본문(`ordbody` 테스트 메모·`ordkey`·`dlvyto`)과 응답·오류 매핑 확인.
- 발주 manager: 성공, 미지원, 재시도 상한, 파일 전달만 실패, 응답 유실 후 `ordkey` 복구.
- 취소: 상태표 §6.3 의 모든 행 + `resolve-cancel` 두 결과(이어서 취소 / 철회·알림).
- 요약 API: 탭별 건수가 처리 후 줄어드는지.
- 라인 구성: `outsourced` 판정 + SQL parity 통합 스펙 + FO 미생성.
- 송장 폴러: 송장 첫 등장·배송완료·상태 역행.
- storefront: 체크박스 없이는 결제 버튼 비활성.
- **실제 와우프레스 호출은 어떤 자동 테스트에서도 하지 않는다.** 테스트 서버가 없어 부르면 실주문이다.
- jest 는 `--maxWorkers` 4 이하로 돌린다.

## 10. 배포·개시 순서

모두 additive 라 expand 순서(`migrate → deploy`)를 따른다.

1. core 마이그레이션(`sales_order_lines.almond_design_id`, `print_orders`) 적용.
2. ugc(내부 경로) → core(`PRINT_ORDER_SUBMIT_ENABLED=false`) → channel-adapter(필드 전달) → admin-web·storefront 배포.
3. 품목 하나의 매핑표를 넣고 `confirmed=false` 로 배포, `PRINT_ORDER_SUBMIT_ENABLED=true`.
4. 와우프레스 선입금 0 상태에서 그 품목을 실제로 주문 → 입금대기로 들어간 주문을 와우프레스에 전화 확인.
5. 확인되면 `confirmed=true`. 다음 품목으로 3번부터 반복.

## 11. 남은 확인 사항

- 와우프레스 Q&A 2026-10-13 문의(실주문 전 파일 검수 가능 여부) 답변 대기.
- 가격조회 API 의 정확한 경로·본문(문서 6.4)과 `prsjob` 구조 — 계획 첫 태스크에서 문서 원문으로 확정.
- file-service 내부키 업로드 경로 유무(§6.4).
- 택배사 코드표(문서 9.4)와 우리 택배사 이름 매핑.
