# print-order — 아몬드템플릿 와우프레스 자동 발주

고객이 아몬드템플릿으로 만든 시안이 담긴 판매주문 라인을 와우프레스(인쇄 업체)에 자동으로 발주하고, 송장을 받아 고객 배송조회에 보여 주는 모듈이다.
한 행(`print_orders`)은 판매주문 라인 하나다. 설계 전체는 `docs/superpowers/specs/2026-10-14-almond-template-wowpress-order-design.md` (특히 §6.3, §6.5, §6.7, §10).

## 하는 일

- 판매주문 라인에 `almond_design_id` 가 있으면 `pending` 행을 만든다.
- `PrintOrderSubmitWorker` (매분): 판매주문 하나씩 집어 시안 주인 확인 → ugc 에서 인쇄 파일 링크 → 와우프레스 가격조회 → 주문 → 파일 전달. 아래 묶음 발주 참고.
  시안 ID 는 고객이 장바구니 메타데이터로 넣는 값이라, 시안 주인(ugc `almond_designs.user_id`)과 주문 고객(`sales_orders.customer_id`)이 다르면 주문하지 않고 `failed` 로 둔다.
- `PrintOrderTrackingWorker` (30분): 주문상세로 송장·배송 상태 반영. 고객 배송조회(`/store/orders/by-channel-order/:id/tracking`)에 한 항목으로 덧붙는다.
- 취소: `PrintOrderCancellation` 이 판매주문 취소 앞단에서 와우프레스 취소를 먼저 시도한다. 아래 취소·환불 경로 참고.
- 운영자 보드: admin-web `주문 > 와우프레스 발주` (`/order/print-orders`).
- 배송지 변경: Medusa 에서 주소를 고쳐도 와우프레스로 이미 보냈거나 보내는 중인 인쇄 줄이 있으면 반영하지 않고 운영자 확인(`SHIPMENT_NOT_REVISABLE`)으로 남긴다. 와우프레스 쪽 주소는 사람이 고친다. 발주 전 줄은 발주할 때 새 주소를 읽는다.

## 묶음 발주

같은 판매주문의 인쇄 줄은 와우프레스 주문 한 건(`cjson_order` 요청 하나)으로 함께 보낸다. 한 박스로 묶이는 것은 그 가운데 와우프레스 묶음배송 그룹이 같은 제품끼리뿐이고, 묶음배송 그룹이 다르거나 없는 제품은 박스가 따로 나간다. 설계는 `docs/superpowers/specs/2026-10-15-wowpress-bundled-order-design.md`.

- 워커는 판매주문 단위로 줄을 선점한다. 묶음에는 이번 차례에 새로 주문할 줄(`order_attempted_at` 과 `vendor_order_number` 가 비어 있는 줄)만 들어간다. 응답 유실 복구 중이거나 파일만 다시 전달하는 줄은 넣지 않는다.
- 각 줄의 `ordkey` 는 줄 id(`sales_order_line_id`)다. 원소가 하나면 응답 `ordnum` 을 그대로 쓰고, 둘 이상이면 `ord_list` 의 `ordkey` 로 줄마다 대응한다. 대응하지 못한 줄은 주문 응답 유실과 같은 경로(다음 차례 `ordkey` 조회)로 넘어간다.
- 실패 후 재전송처럼 나중에 따로 재시도되는 줄은 혼자 발주된다. 이미 나간 박스에 붙이지 않으므로 별도 박스이고 택배비가 따로 붙는다.
- `vendor_box_number` 는 와우프레스 배송박스 번호(`dboxnum`), `vendor_shipping_fee` 는 그 박스의 청구 택배비(`dlvcost_bill`, 부가세 포함)다. 택배비는 발주 응답을 받은 줄에만 남고, 응답 유실 복구(`ord_list` 조회)로 번호를 찾은 줄은 박스 번호만 남는다. 그래서 택배비를 합산할 때는 박스별로 한 번(같은 박스 줄 중 값이 있는 것, 박스별 max) 센다. 응답에서 못 읽으면 null 이다.
- 묶음 일부만 취소하면 와우프레스가 남은 인쇄물에 택배비를 다시 청구할 수 있다(미납금 가능성). 취소 로직은 `ordnum` 단위 그대로다. 어드민 취소 확인 문구에도 적어 두었다.
- 디플로마는 와우프레스에 대응 제품이 없어 발주 범위 밖이다. 판매는 기존대로 두고 운영자가 처리한다(보드에는 미지원으로 뜬다).

### 고객 배송비 그룹

어드민 `몰 > 배송비 그룹` 에서 `print-card`(`flat`), `print-mini`(`flat`), `print-sign`(`per_quantity`), `print-board`(`per_quantity`) 네 그룹을 만들고 상품 일괄 정책 지정으로 인쇄 상품 master 를 종류별로 지정한다. 금액·근거·절차는 스펙 §7 이 정본이다.
사인제품(현수막·배너) 선불택배 가능 여부는 미확인이다. `prod_info` 의 `deliverinfo.dlvyprepay` 로 확정하기 전까지 `print-mini`·`print-sign`·`print-board` 는 설정만 하고 해당 상품 판매를 열지 않는다.

## 상태

| 상태 | 뜻 | 다음 |
|---|---|---|
| `pending` | 발주 대기 (`next_attempt_at` 이후 워커가 판매주문 단위로 집는다) | `submitting`, `unsupported`, `cancelled` |
| `submitting` | 워커가 선점해 외부 호출 중 | `submitted`, `pending`(재시도), `failed` |
| `submitted` | 와우프레스 주문번호(`ordnum`) 확보 | `shipped`, `cancelling` |
| `shipped` | 송장 확인됨 (택배는 보통 여기서 끝난다) | `delivered` |
| `delivered` | 와우프레스 `ordstat=85` | 종료 |
| `failed` | 재시도 3회 초과 | 운영자 재전송 → `pending` |
| `unsupported` | 품목 매핑표(`WOWPRESS_PRODUCTS`)에 해당 variant 가 없음 | 매핑 추가 후 재전송 |
| `cancelling` | 취소를 선점한 프로세스가 와우프레스 취소 호출 중 | `cancelled`, `cancel_refused` |
| `cancelled` | 취소됨 | 종료 |
| `cancel_refused` | 와우프레스가 취소를 거절(이미 생산 중) | 운영자가 전화 확인 후 `cancelled` 또는 `submitted` |

`cancelling` 은 오래 남으면(`CANCEL_CLAIM_STALE_MS`) 보드의 `취소 확인 필요` 로 넘어간다.

### 한 번만 주문할 권리 (`order_attempted_at`)

와우프레스 주문 API 는 중복 주문 위험이 있다. 주문 호출 직전에 `order_attempted_at` 을 찍고, 그 값이 있는데 `vendor_order_number` 가 비어 있으면 응답이 유실됐을 수 있다는 뜻이다.
이 경우 자동으로 다시 주문하지 않는다. 이번 차례에 보낸 주문의 응답을 잃었으면 바로 포기하지 않고 5분 미뤄(`pending`, `ORDER_LOOKUP_PENDING_ERROR`) 다음 차례에 `ordkey`(= `sales_order_line_id`)로 와우프레스에 조회한다. 있으면 `ordnum` 을 채우고 파일 전달부터 이어 가고, 없거나 조회가 실패하면 `failed`(`order sent but not confirmed — verify on WowPress before retry`)로 둔다. 보드에서는 `와우프레스 확인 필요`(`needsWowpressCheck`)로 표시된다.
운영자가 와우프레스에 그 주문이 없음을 직접 확인한 뒤 재전송하면서 `와우프레스에 주문 없음 확인`(`confirmNoWowpressOrder`)을 체크해야만 주문권이 풀리고(`order_attempted_at` 해제) 다시 주문된다. 체크 없이 재전송하면 거절된다.
중복 의심·번호 미저장·취소 뒤 주문 같은 보호 기록(`retryBlocked`)이 남은 행은 재전송 자체가 막힌다 — 와우프레스에서 처리한다 (`services/print-order-board.rules.ts`, `services/print-order-admin.manager.ts`).

## 취소·환불 경로

인쇄 상품이 섞인 주문은 어느 상품을 돌려주는지 아는 경로(부분 취소)로만 환불한다.

| 경로 | 동작 |
|---|---|
| 어드민 주문내역 > 주문 취소 > 부분 취소 | 고른 상품만 취소. 인쇄 줄을 고르면 와우프레스 취소를 먼저 묻고, 거절되면 요청 전체를 막는다(실물만 다시 고르면 통과) |
| 어드민 결제 상세 금액 직접 환불·결제취소 | 취소되지 않은 인쇄 줄이 있으면 막고 부분 취소로 안내한다. 하자로 재제작이 불가하거나 배송 사고일 때만 체크해서 연다(와우프레스는 건드리지 않는다). Medusa 주문인데 core 가 아직 수집하지 않았으면 받은 돈을 돌려주는 동작을 막는다. 버튼을 누르는 순간 상태를 다시 읽는다 |
| 어드민 무통장 환불신청 승인 | 취소되지 않은 인쇄 줄(아직 안 보낸 실패·미지원 포함)이 있으면 409 `PRINT_NEEDS_PARTIAL_CANCEL` 로 승인을 막는다. 와우프레스 취소는 시도하지 않는다 |
| 고객 주문 취소 | 인쇄가 제작 중이고 다른 상품이 남으면 409 `PRINT_PARTIAL_CANCEL_AVAILABLE`. 스토어(`web/almondyoung-storefront/src/components/orders/print-partial-cancel-dialog.tsx`)가 안내창을 띄우고, 고객이 동의하면 `excludePrint: true` 로 다시 보내 취소되지 않은 인쇄 줄과 디지털 줄을 뺀 나머지를 부분 취소한다. 이 경로의 와우프레스 거절은 `cancel_refused` 로 남기지 않고 `submitted` 로 되돌린다(고객이 안내를 받았고 인쇄는 계속되므로 운영자 확인이 필요 없다) |

## 품목 여는 절차

새 인쇄 품목을 자동 발주 대상으로 열 때마다 반복한다.

1. 와우프레스 제품상세 API 로 옵션 코드(`prodno`, `jobpresetno`, `prsjob`, `awkjob`)를 확인한다.
2. `wowpress/wowpress-products.ts` 의 `WOWPRESS_PRODUCTS` 에 PIM variant id 키로 한 줄 추가한다. `confirmed: false`. `design` 에는 이 품목에 맞는 아몬드템플릿 상품 키와 시안 크기(mm)를 적는다 — 다른 시안이 붙은 주문은 발주하지 않고 `failed` 로 남는다. 가드 스펙이 키 중복·필수 필드를 검사한다.
3. 배포한다. 첫 품목이면 `PRINT_ORDER_SUBMIT_ENABLED=true` 로 바꿔 배포한다.
4. 와우프레스 선입금 0 상태에서 그 품목을 실제로 주문한다. `confirmed:false` 건은 테스트 메모가 붙어 입금대기로 들어간다.
5. 와우프레스에 전화로 그 주문이 의도대로 들어왔는지 확인한다. 보드 `테스트 확인대기` 탭에서 `확인 완료` + 결과 메모를 남긴다.
6. 문제 없으면 같은 줄을 `confirmed: true` 로 바꿔 배포한다. 다음 품목은 1번부터.

## 운영자 보드 탭

| 탭 | 대상 | 조치 |
|---|---|---|
| 취소 확인 필요 | `cancel_refused`, 오래 멈춘 `cancelling`, 판매주문 취소가 실패한 `cancelled` | 와우프레스에 전화 후 `취소 완료함`(이어서 판매주문 취소) 또는 `생산 진행으로 처리`(`submitted` 로 복귀) |
| 테스트 확인대기 | 테스트 메모를 붙였고 아직 확인 안 한 건 | 전화 확인 뒤 `확인 완료` |
| 발주 실패 | `failed` | 사유 확인 후 `재전송` |
| 미지원 품목 | `unsupported` | 매핑을 추가한 뒤 `재전송` |
| 전체 | 모든 행 | 상태 필터·주문번호 검색 |

카드 숫자는 사람이 처리할 건수다. 처리하면 빠진다.

## 설정

| 키 | 비고 |
|---|---|
| `WOWPRESS_AUTH_UID`, `WOWPRESS_AUTH_PW` | SST secret `WowpressAuthUid`, `WowpressAuthPw`. 로컬은 `apps/core/.env` |
| `WOWPRESS_SENDER_NAME/TEL/ZIPCODE/ADDR1/ADDR2` | 발송인(`dlvyfr`). SST secret `WowpressSender*` |
| `UGC_SERVICE_URL`, `UGC_INTERNAL_KEY` | ugc 내부 경로 호출. 키는 ugc 의 `UgcInternalKey` 와 같은 값 |
| `PRINT_ORDER_SUBMIT_ENABLED` | 기본 `false`. 꺼져 있으면 행만 쌓이고 전송하지 않는다 |

## 배포 순서

모두 additive 라 expand 순서(`migrate → deploy`)다.

1. core 마이그레이션 적용 (`npm run db:migrate -- --stage <stage> --deployment lcnine-services --yes`). 이 브랜치의 5개:
   - `apps/core/drizzle/20261014035334_add-print-orders.sql`
   - `apps/core/drizzle/20261014050741_add-print-order-attempted-at.sql`
   - `apps/core/drizzle/20261014065142_add-print-order-cancel-resolved.sql`
   - `apps/core/drizzle/20261014072709_add-print-order-sales-cancel-failed.sql`
   - `apps/core/drizzle/20261015042844_add-print-order-vendor-box.sql`
2. `sst secret set WowpressAuthUid …`, `WowpressAuthPw`, `WowpressSender*` 값 입력 (사람이 직접).
3. 변경된 서비스만 `--target` 으로: ugc → core (`PRINT_ORDER_SUBMIT_ENABLED=false`) → channel-adapter → admin-web → storefront. core 는 ugc 시안 정보의 `userId` 를 요구하므로 ugc 가 먼저다.
4. 위 품목 여는 절차로 개시한다.

## 알려진 한계·확인할 것

- Medusa 어드민에서 주문을 직접 취소하는 경로는 `PrintOrderCancellation` 을 지나지 않는다. 와우프레스에 발주된 라인이면 보드에서 따로 정리해야 한다.
- 무통장 환불신청 승인은 판매주문이 아직 없으면 통과시킨다. 환불 신청된 주문은 수집기가 일부러 수집하지 않으므로(`refund_status=requested`) 막으면 영영 풀리지 않는다. 남는 빈틈은 수집기가 주문을 이미 넘겼는데 core 처리가 늦는 짧은 사이의 승인이다(#1070).
- 결제 상세의 인쇄 확인은 어드민 화면에만 있다. wallet 환불 API 자체는 인쇄를 확인하지 않으므로, 화면을 거치지 않는 환불은 막지 못한다(#1070).
- 환불 신청(무통장 포함)에 상품 정보가 없어 인쇄 상품이 섞인 주문은 승인 대신 부분 취소로 처리한다. 신청에 상품을 담는 것은 후속 과제다.
- 인쇄만 출고되고 실물은 아직인 주문은 스토어 주문 액션이 출고로 판정해 고객 취소 버튼이 사라진다. 고객센터 → 부분 취소로 처리한다.
- 고객 반품은 창고 배송 기록이 있어야 신청되므로 인쇄 줄은 고를 수 없고, 교환은 `assertNoCustomMadeLines` 가 막는다. 인쇄 불량은 고객센터가 받는다.
- 인쇄물 하자는 일반 반품(창고 회수) 흐름에 맞지 않는다. 와우프레스 약관(18조2)은 수령 7일 안에 전량 반송하면 재작업이 원칙이고 환불은 예외다. 고객에게는 5일 안에 고객센터로 접수하라고 안내한다(우리가 와우프레스 7일 기한 안에 접수할 여유). API 대리 주문·고객 직배송 건에 약관이 그대로 적용되는지는 와우프레스 확인이 필요하다.
- 첫 실주문에서 `ord_list`, `cjson_order` 응답 모양과 배송지 `sd/sgg/umd` 분해(`wowpress/korean-address.ts`)가 실제 응답과 맞는지 반드시 확인한다. 문서만으로 확정하지 못한 부분이다.
- 택배사 코드는 109=롯데, 156=CJ 만 매핑한다. 그 밖은 송장만 보인다.
- 주문상세의 송장은 배송박스 단위(`ordinfo.dlvybox.shipnum`)다. `dlvyinvc`/`dlvyno` 는 콜백 전용 키라 상세에서 읽으면 비어 있다(와우프레스 문서 2026.10.14 §6.11·§6.13).
