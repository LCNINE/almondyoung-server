# 와우프레스 묶음 발주 + 인쇄물 배송비 그룹 설계

- 날짜: 2026-10-15
- 브랜치: `feat/almond-template-wowpress-order` (#1068 위에 얹는다)
- 선행 설계: `docs/superpowers/specs/2026-10-14-almond-template-wowpress-order-design.md` (§3 와우프레스 API 요약은 2026-10-15 문서 2026.10.14 기준으로 갱신됨)
- 후속: #1075 (`cjson_dlvycost` 로 고객 배송비 실시간 계산)

## 1. 목적

지금은 판매주문 인쇄 줄 하나마다 `cjson_order` 를 따로 불러, 줄마다 와우프레스 택배비가 나간다. 고객에게는 인쇄물 택배비를
받지 않는다. 이 작업은

1. 같은 판매주문의 인쇄 줄을 와우프레스 요청 한 번으로 묶어, 묶음배송 그룹이 같은 제품(명함·스티커)이 한 박스·한 택배비로 나가게 하고
2. 와우프레스가 실제로 청구한 박스 택배비를 줄에 남겨 나중에 고객 배송비와 비교할 수 있게 하고
3. 고객에게 인쇄물 배송비를 배송비 그룹 4개(§7)로 받는다(설정, 코드 변경 없음). 디플로마는 와우프레스 발주 범위 밖이다.

같이 고친다: 주문상세 송장 파싱 결함(콜백 전용 키 `dlvyinvc`/`dlvyno` 를 읽어 송장을 못 읽음).

### 성공 기준

1. 한 판매주문의 발주 가능한 새 인쇄 줄 N개가 `cjson_order` 1회로 나간다(`ordreq` 원소 N개, 원소마다 `ordkey` = 줄 id).
2. 줄마다 자기 `ordnum` 이 저장되고 파일이 그 `ordnum` 으로 전달된다. 줄↔`ordnum` 대응이 틀릴 수 없다.
3. 묶음 중 일부 줄이 미지원·시안 주인 불일치·링크 실패여도 나머지 줄은 발주된다.
4. 줄마다 와우프레스 배송박스 번호와 그 박스의 청구 택배비가 남는다.
5. 송장이 주문상세 `dlvybox.shipnum` 에서 읽혀 고객 배송조회에 뜨고, 같은 송장(박스)은 한 건으로 보인다.
6. 같은 줄이 두 번 주문되지 않는다는 기존 보장(주문권·응답 유실 복구)은 그대로다.

## 2. 와우프레스 사실 (문서 2026.10.14)

- `ordreq` 바깥 원소 하나 = 와우프레스 주문 하나. 응답 `ordinfo[]` 에 원소마다 `ordnum` 이 따로, 묶인 주문은 같은 `dboxno`.
- 응답 `ordinfo` 에 `ordkey` 가 없고 응답 순서 보장 문구도 없다. → 원소가 둘 이상이면 줄↔`ordnum` 은 `ord_list(ordkey)` 로 확정한다.
- `dlvinfo[]` 는 배송박스별: `dboxno`, `dboxnum`, `dlvcost_bill`(청구 택배비, 무료택배면 0).
- 파일은 `ordnum` 당 하나, 취소는 `ordnum` 단위. 묶음 주문 일부 취소 시 남은 주문에 택배비 미납금이 생길 수 있다.
- 주문상세 송장은 `resultMap.ordinfo.dlvybox` `{dboxnum, dlvyname, shipnum, ordnum[]}`. `dboxnum` 형식은 `<dlvymcd>-<dlvyno>-<dboxno>`(샘플 기준 추정).
- `ord_list` 행: `ordnum`, `ordkey`, `dboxnum`, `dlvyno`, `shipnum`, `ordstat`.

## 3. 결정

| # | 결정 | 이유 |
|---|---|---|
| B1 | `print_orders` 는 줄당 1행 그대로. 묶음 테이블을 만들지 않는다 | `ordnum`·파일·취소가 줄 단위로 유지되므로 그룹 표가 얻는 게 없다 |
| B2 | 묶음은 같은 판매주문 + 이번 차례에 새로 주문할 줄(`order_attempted_at IS NULL`, `vendor_order_number IS NULL`)만 | 응답 유실 복구·파일만 재전달 중인 줄을 다시 주문 요청에 넣지 않기 위해 |
| B3 | 원소가 하나면 응답 `ordnum` 을 그대로 쓰고, 둘 이상이면 줄마다 `ord_list(ordkey)` 로 확정 | 응답에 ordkey 가 없다. 하나일 때는 모호하지 않다 |
| B4 | 대응 확정에 실패한 줄은 기존 "주문은 보냈는데 번호 없음" 경로(`deferLookup` → 다음 차례 `confirmSentOrder`)로 넘긴다 | 새 복구 경로를 만들지 않는다 |
| B5 | 실제 택배비는 줄에 `vendor_box_number`(dboxnum), `vendor_shipping_fee`(그 박스의 `dlvcost_bill`)로 남긴다. 택배비는 발주 응답을 받은 줄에만 남고, 응답 유실 복구(`ord_list`)로 번호를 찾은 줄은 박스 번호만 남는다 — 합산은 박스별로 한 번(같은 박스 줄 중 값이 있는 것, 박스별 max) | 비교 조사용. 박스 표를 따로 두지 않는다 |
| B6 | 나중에 따로 재시도되는 줄(실패 후 재전송)은 혼자 발주된다(별도 박스) | 이미 나간 박스에 붙이는 `dlvy/bdle` 은 접수 전만 가능하고 이번 범위 밖 |
| B7 | 취소 로직은 바꾸지 않는다. 묶음 일부 취소 시 택배비 미납금 가능성을 README 와 어드민 인쇄 주문 화면 취소 안내에 적는다 | 와우프레스 취소가 원래 `ordnum` 단위다 |
| B8 | 고객 배송비는 배송비 그룹 4개(§7, 디플로마 제외). 실시간 계산은 #1075 | 첫 실주문 전 API 를 결제 경로에 넣지 않는다 |

## 4. 발주 흐름

### 4.1 선점 (`PrintOrderSubmitWorker` + `PrintOrderRepository`)

- 기존: `claimDue(1)` 로 한 행씩.
- 변경: `claimDue(1)` 로 집은 행의 `sales_order_id` 를 기준으로, 같은 판매주문의 `pending` + `next_attempt_at <= now` 행을 같은 트랜잭션에서
  `FOR UPDATE SKIP LOCKED` 로 함께 `submitting` 으로 바꾼다(같은 `submitting_at`). 새 메서드 `claimDueBatch(now)` → `PrintOrderRow[]`(같은 판매주문).
- 워커 루프 한 바퀴 = 한 판매주문. `CLAIM_LIMIT` 은 판매주문 수 기준이 된다.
- stale 복구(`staleSubmitting` → `recoverStale`)는 행 단위 그대로.
- `print_orders(sales_order_id)` 인덱스를 추가한다(묶음 선점·`forSalesOrder`·`hasPrintSentToVendor` 가 이 키로 조회).

### 4.2 제출 (`PrintOrderSubmitManager.submitBatch(rows)`)

1. **이어가기 줄 분리:** `orderAttemptedAt !== null || vendorOrderNumber !== null` 인 줄은 지금의 `submit(row)` 로 하나씩 처리한다(번호 확인·파일 재전달).
2. **새 줄 준비:** 남은 줄을 병렬로 준비한다(묶음 준비 시간이 줄 수에 비례해 stale 기준을 넘지 않게). 줄마다 기존 순서 그대로 — 줄 컨텍스트, 매핑(`WOWPRESS_PRODUCTS`, 없으면 그 줄만 `unsupported`), 시안 주인 대조(불일치면 그 줄만 `failed`),
   인쇄 링크 발급, `quote`. 어느 단계든 실패한 줄은 기존 `fail()` 로 그 줄만 재시도 대기.
3. **주문권:** 준비된 줄마다 `takeOrderRight` 를 건다. 실패한 줄은 빠진다(기존 `LostOwnership` 의미).
4. **주문:** 주문권을 얻은 줄이 하나 이상이면 `wowpress.order({ items, receiver, ordtitle })` 한 번. 원소마다 `spec`, `qty`, `ordbody`(줄별 테스트 메모), `ordkey`(줄 id).
   배송지·`ordtitle` 은 판매주문 공통.
5. **대응 확정:** B3. 응답의 `ordinfo`·`dlvinfo` 로 각 `ordnum` 의 `dboxnum`·박스 택배비를 찾는다(`ordinfo.dboxno` → `dlvinfo.dboxno`).
   `ord_list` 행의 `dboxnum` 도 받아 둔다(응답에서 못 찾으면 이것으로).
6. **줄별 마무리:** `recordReceivedOrdnum`(기존 중복 의심 판정 그대로) → 박스 번호·택배비 저장 → 파일 전달 → `submitted`. 줄 하나의 실패가 다른 줄을 막지 않는다.
7. **예외:** `order()` 자체가 실패하면 주문권을 얻은 모든 줄이 "보냈는데 번호 없음" 상태다 → 줄마다 기존 `deferLookup`/`markUnconfirmed`.

### 4.3 와우프레스 클라이언트

- `order(input)`: 입력을 `{ items: WowpressOrderItem[], ordtitle, receiver }` 로, `ordreq` 를 `items.map(i => [line(i)])` 로.
  반환 `{ orders: { ordnum, dboxno|null, prodno|null }[], boxes: { dboxno, dboxnum|null, shippingFee|null }[] }`. `ordinfo` 가 비었거나 원소 수가 items 와 다르면 `WowpressApiError`.
- `quote` 의 `ordreq` 모양은 그대로(단일).
- `findByOrdkey`: 반환에 `dboxnum`(있으면) 추가. 여러 `ordnum` 이면 예외인 규칙은 그대로(줄마다 ordkey 가 다르므로 여전히 정상은 하나).
- `detail(ordnum)`: `ordstat`/`jobstat` 은 `ordinfo` 에서, 송장은 `ordinfo.dlvybox.shipnum`, 택배사는 `dboxnum` 가운데 값(109/156) → 없으면 `dlvyname` 문자열(롯데/CJ 포함 여부).
  반환 `{ ordstat, jobstat, carrierCode: number|null, trackingNumber: string|null, boxNumber: string|null }`.

### 4.4 송장·배송조회

- `PrintOrderTrackingManager.refresh` 는 새 `detail` 반환으로 바꾼다. 상태 전이 규칙은 그대로. `vendor_box_number` 가 비어 있으면 채운다.
- 고객 배송조회 `buildPrintShipments`(`store-sales-orders.service.ts`): 같은 `trackingNumber` 의 행은 한 건으로 합친다. `fulfillmentOrderId` 는 그 묶음의 첫 행 id.
  송장 없는 행 세기(`untrackedPrints`)는 그대로 줄 단위.

## 5. 스키마 (expand, nullable 추가만)

`print_orders`:

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `vendor_box_number` | `varchar(32)` null | 와우프레스 배송박스 번호 `dboxnum` |
| `vendor_shipping_fee` | `integer` null | 발주 응답의 그 박스 `dlvcost_bill`(원, 부가세 포함 청구가). 응답에서 못 읽으면 null |

인덱스 `ix_print_orders_sales_order (sales_order_id)`. 마이그레이션은 `npm run db:generate:core -- --name add-print-order-vendor-box` 로 생성만 하고 로컬 적용은 하지 않는다.
배포 순서는 expand 규칙대로 migrate → deploy.

## 6. 운영 문구

- README `print-order`: 묶음 발주, 박스 택배비 컬럼, 묶음 일부 취소 시 미납금 가능성, 송장 위치.
- 어드민 인쇄 주문 화면의 취소 확인 안내에 한 줄: "같은 주문의 다른 인쇄물과 함께 발주된 경우, 와우프레스가 남은 인쇄물에 택배비를 다시 청구할 수 있습니다."

## 7. 고객 배송비 — 배송비 그룹 4개 (어드민 설정)

2026-10-15 devshop 실측(제품별 `dlvygrpno`·`dlvcost_base`)으로 2개에서 4개로 나눴다. 디플로마는 와우프레스에 대응 제품이 없어 와우프레스 발주 범위에서 뺀다. 판매는 기존대로 두고 운영자가 처리한다(배송비 그룹도 기존 그대로).

| 그룹 코드(예) | 이름 | 대상 `PrintKind` | 와우프레스 제품 | 정책 | 기본 | 근거 |
|---|---|---|---|---|---|---|
| `print-card` | 인쇄물(명함류) | `card`, `nail` | 일반명함 40073(네일팁은 90×90 비규격) | `flat` | 3,000원 | 묶음그룹 1, 여러 종이 한 박스 |
| `print-mini` | 인쇄물(미니배너) | `mini` | 미니 투명배너 40162 + 거치대 40119 | `flat` | 3,000원 | 묶음그룹 18, 같은 종류끼리 한 박스 |
| `print-sign` | 인쇄물(배너·현수막) | `pet`, `window` | PET배너 40106, 일반현수막 40115 | `per_quantity` | 3,000원 | 묶음그룹 없음, 주문마다 박스 |
| `print-board` | 인쇄물(보드·메뉴판) | `menu` | 포맥스보드 40164 | `per_quantity` | 4,700원 | 택배비 4,200원(부가세 포함 4,620원) |

제주·산간 3,000원, 도서 5,000원을 지역 추가비로 둔다(와우프레스 제품 페이지 출고/배송 안내).

**미확인 — 사인제품 선불택배:** 와우프레스 문서 §7.6·§7.7 은 "현수막, 배너 제품 등"·"사인제품은 선불택배불가"라고 적고, 배송 안내 페이지는
사인제품 선불택배 요금표를 싣는다. `prod_info` 의 `deliverinfo.dlvyprepay` 로 확정하기 전까지 `print-mini`·`print-sign`·`print-board` 는 설정만 하고
해당 상품 판매를 열지 않는다. 불가로 확정되면 이 세 그룹과 발주 `dlvymcd` 를 다시 설계한다.

절차: 어드민 `몰 > 배송비 그룹` 에서 네 그룹 생성 → 상품 일괄 정책 지정으로 `web/almondyoung-storefront/src/domains/almond-template/lib/catalog.ts` `PRINT_PRODUCTS` 의 master 를 종류별로 지정.
(지정 원천은 core `product_master_versions.shipping_group_code`, channel-adapter 가 Medusa shipping profile 로 동기화한다.)

## 8. 테스트

와우프레스는 전부 가짜 fetch / 가짜 클라이언트. 실 API 호출 금지(테스트 서버 없음).

- `wowpress.client.spec`: 묶음 `ordreq` 본문(원소마다 ordkey·ordbody), `order` 응답 파싱(ordinfo/dlvinfo, 원소 수 불일치 예외), `findByOrdkey` 의 dboxnum, `detail` 의 `dlvybox.shipnum`·택배사 판정(dboxnum 109/156, dlvyname 대체, 송장 없음).
- `print-order-submit.manager.spec`: 새 줄 3개 → `order` 1회·`ord_list` 3회·줄별 ordnum/박스/택배비 저장·파일 3회 / 하나는 미지원·하나는 주인 불일치 → 나머지 1개만 주문하고 응답 ordnum 그대로 / 링크 실패 줄 제외 / `ord_list` 가 한 줄 대응을 못 찾음 → 그 줄만 deferLookup / `order` 예외 → 전 줄 deferLookup / 이어가기 줄과 새 줄 섞임.
- `print-order.repository.integration.spec`(DB 가드): `claimDueBatch` 가 같은 판매주문만, 다른 인스턴스가 잠근 행은 건너뜀.
- `print-order-tracking.manager.spec`: 새 detail 반환 반영, 박스 번호 채움.
- `store-sales-orders.service.spec`: 같은 송장 두 행 → 배송 1건.

## 9. 범위 밖

- 고객 배송비 실시간 계산(#1075), 이미 나간 박스에 나중 줄 붙이기(`dlvy/bdle`), 콜백 수신, 부분 취소 시 미납금 자동 정산.
