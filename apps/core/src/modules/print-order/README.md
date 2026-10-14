# print-order — 아몬드템플릿 와우프레스 자동 발주

고객이 아몬드템플릿으로 만든 시안이 담긴 판매주문 라인을 와우프레스(인쇄 업체)에 자동으로 발주하고, 송장을 받아 고객 배송조회에 보여 주는 모듈이다.
한 행(`print_orders`)은 판매주문 라인 하나다. 설계 전체는 `docs/superpowers/specs/2026-10-14-almond-template-wowpress-order-design.md` (특히 §6.3, §6.5, §6.7, §10).

## 하는 일

- 판매주문 라인에 `almond_design_id` 가 있으면 `pending` 행을 만든다.
- `PrintOrderSubmitWorker` (매분): ugc 에서 인쇄 파일 링크 → 와우프레스 가격조회 → 주문 → 파일 전달.
- `PrintOrderTrackingWorker` (30분): 주문상세로 송장·배송 상태 반영. 고객 배송조회(`/store/orders/by-channel-order/:id/tracking`)에 한 항목으로 덧붙는다.
- 취소: `PrintOrderCancellation` 이 판매주문 취소 앞단에서 와우프레스 취소를 먼저 시도한다.
- 운영자 보드: admin-web `주문 > 와우프레스 발주` (`/order/print-orders`).

## 상태

| 상태 | 뜻 | 다음 |
|---|---|---|
| `pending` | 발주 대기 (`next_attempt_at` 이후 워커가 집는다) | `submitting`, `unsupported`, `cancelled` |
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
이 경우 자동으로 다시 주문하지 않는다. `ordkey`(= `sales_order_line_id`)로 와우프레스에 조회해 있으면 `ordnum` 을 채우고, 없거나 조회가 실패하면 `failed`(`order sent but not confirmed — verify on WowPress before retry`)로 둔다. 보드에서는 `와우프레스 확인 필요`(`needsWowpressCheck`)로 표시된다.
운영자가 와우프레스에 그 주문이 없음을 직접 확인한 뒤 재전송하면서 `와우프레스에 주문 없음 확인`(`confirmNoWowpressOrder`)을 체크해야만 주문권이 풀리고(`order_attempted_at` 해제) 다시 주문된다. 체크 없이 재전송하면 거절된다.
중복 의심·번호 미저장·취소 뒤 주문 같은 보호 기록(`retryBlocked`)이 남은 행은 재전송 자체가 막힌다 — 와우프레스에서 처리한다 (`services/print-order-board.rules.ts`, `services/print-order-admin.manager.ts`).

## 품목 여는 절차

새 인쇄 품목을 자동 발주 대상으로 열 때마다 반복한다.

1. 와우프레스 제품상세 API 로 옵션 코드(`prodno`, `jobpresetno`, `prsjob`, `awkjob`)를 확인한다.
2. `wowpress/wowpress-products.ts` 의 `WOWPRESS_PRODUCTS` 에 PIM variant id 키로 한 줄 추가한다. `confirmed: false`. 가드 스펙이 키 중복·필수 필드를 검사한다.
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

1. core 마이그레이션 적용 (`npm run db:migrate -- --stage <stage> --deployment lcnine-services --yes`). 이 브랜치의 4개:
   - `apps/core/drizzle/20261014035334_add-print-orders.sql`
   - `apps/core/drizzle/20261014050741_add-print-order-attempted-at.sql`
   - `apps/core/drizzle/20261014065142_add-print-order-cancel-resolved.sql`
   - `apps/core/drizzle/20261014072709_add-print-order-sales-cancel-failed.sql`
2. `sst secret set WowpressAuthUid …`, `WowpressAuthPw`, `WowpressSender*` 값 입력 (사람이 직접).
3. 변경된 서비스만 `--target` 으로: ugc → core (`PRINT_ORDER_SUBMIT_ENABLED=false`) → channel-adapter → admin-web → storefront.
4. 위 품목 여는 절차로 개시한다.

## 알려진 한계·확인할 것

- Medusa 어드민에서 주문을 직접 취소하는 경로는 `PrintOrderCancellation` 을 지나지 않는다. 와우프레스에 발주된 라인이면 보드에서 따로 정리해야 한다.
- 지갑 쪽 환불·취소에서 외주 라인을 강제하는 부분은 후속 과제다.
- 첫 실주문에서 `ord_list`, `cjson_order` 응답 모양과 배송지 `sd/sgg/umd` 분해(`wowpress/korean-address.ts`)가 실제 응답과 맞는지 반드시 확인한다. 문서만으로 확정하지 못한 부분이다.
- 택배사 코드는 `dlvyno` 109=롯데, 156=CJ 만 매핑한다. 그 밖은 송장만 보인다.
