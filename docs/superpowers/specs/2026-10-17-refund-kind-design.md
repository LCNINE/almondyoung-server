# 환불 종류 — «무엇을 되돌린 돈인가»를 데이터로 남긴다 (#1016 40번)

- 트래킹: #1016 40번 행
- 근거: `docs/adr/0043-refund-is-classified-by-what-it-reverses.md` 결정 6(«사유는 종류 + 자유 메모로 나눈다»)
- 상태: 설계 승인 대기 (2026-10-17)

## 1. 왜

wallet 환불에는 «이 돈이 무엇을 되돌렸는가»가 데이터로 없다. `refunds.reason_code`(varchar 128) 한 칸에
뜻이 다른 셋이 섞여 있다.

| 섞인 뜻 | 예 | 누가 쓰나 |
|---|---|---|
| 출처 표지(기계 신호) | `MEDUSA_REFUND`, `RETURN_COMPLETED`, `CUSTOMER_REFUND_REQUEST`, `ORPHAN_PAYMENT_RECONCILE` | 시스템 경로 |
| 고객이 고른 «왜» | `WRONG_ORDER`, `CHANGE_OF_MIND`, `OTHER`, `NOT_USING`, `LACK_OF_BENEFITS` | core 취소·membership 해지 |
| 운영자 자유 문장 | «엘라 맵핑실 본체1개+리필1개 품절 단종 부분 취소», «중복 결제», «반품건» | admin-web 결제 상세 환불 폼 |

2026-10-17 라이브 실측(READ ONLY): 환불 643건(SUCCEEDED 598 · FAILED 31 · PENDING 14, 2026-06-16 ~ 10-16).
`reason_code` null 128건(그중 77건은 `reason_message` 에만 사유).

종류를 읽는 쪽은 둘이다.

- **기계:** 나중의 부분취소·반품이 앞선 환불과 겹치는지 판정(37번 안전망, ADR-0043 «Why» 둘째 줄).
  **이 판정을 바꾸는 일은 이 작업 밖이다**(§3).
- **사람:** 환불 목록·결제 상세에서 «무슨 일이 일어났는지»를 종류 + 메모로 읽는다. 종류별로 보고 싶으면 목록 필터로 거른다
  (통계 화면·엔드포인트를 종류별로 나누는 건 이 작업 밖 — 설계자 판단).

## 2. 목표

1. wallet 환불 행마다 **종류**를 기록한다. 모르면 비워 둔다(= «모름»).
2. 환불을 만드는 모든 경로가 자기가 아는 종류를 싣는다.
3. admin-web 관리자 환불 폼은 «사유 코드» 자유 입력 대신 **종류 선택 + 메모**를 받는다.
4. 환불 목록·결제 상세에 종류를 보인다. 관리자 환불 목록은 종류로 거를 수 있다.
5. 옛 행 643건을 세 단계로 채운다(§7).
6. 운영자가 환불 행의 종류를 **나중에 고칠 수 있다**(§6.1). 잘못 고른 것과 옛 행의 «모름»을 사람이 채우는 길이다.

## 3. 하지 않는 것

- **37번 안전망이 종류를 읽게 바꾸지 않는다.** 그 경로는 core 출고 개통 전엔 돌 일이 없다(외부 환불이 붙은 주문은
  셀메이트 과도기에 전부 출고·취소 상태). 개통 때 39번(관리자 품목 환불 차단)과 함께 한다 — 2026-10-17 결정.
  «금액 조정은 통과», «품목 취소는 자동 차감» 같은 판정은 그때의 일이다.
- 38번(Medusa 금액 조정 경로)·41번(CS 연결)은 별도 행이다.
- 37번 안전망에서 운영자가 Medusa 장부를 재분류할 때 wallet 종류를 **자동으로** 함께 바꾸는 연동은 하지 않는다. 그 재분류
  흐름이 37번 판정 전환 때 바뀌므로 그때 붙인다. 손으로 고치는 길(§6.1)은 이 작업에 있다 — 2026-10-17 결정.
- `gateway.refund.succeeded` 이벤트 payload 에 종류를 싣지 않는다. 지금 그 이벤트의 소비자 셋(channel-adapter·membership·
  notification) 중 종류가 필요한 쪽이 없다. 필요해지는 행(37번 판정 전환 등)이 더한다.
- `reason_code` 의 기존 값을 바꾸거나 지우지 않는다(§4.2).
- 실패 시 `reason_message` 를 PG 오류로 덮어쓰는 현행(`refunds.service.ts` 의 dispatch 실패 두 곳)은 고치지 않는다.
  그래서 FAILED 행에선 운영자 메모가 남지 않는다 — 돈이 안 나간 행이고, 운영자는 같은 메모로 다시 낸다. 알려진 한계로 둔다.

**실패로 치는 것(anti-goal):** 종류를 더하다가 Medusa 투영(`MEDUSA_REFUND` 판정)이 흔들려 이중 장부·이중 환불이 생기는 것.
종류 때문에 환불이 거절되는 것(종류는 언제나 선택 입력이다).

## 4. 데이터

### 4.1 종류 다섯 가지 (2026-10-17 결정)

| 값 | 화면 이름 | 뜻 | ADR-0043 |
|---|---|---|---|
| `ITEM_CANCEL` | 품목 취소 | 출고 안 된 수량을 주문에서 뺀다(품절·부족·단종·누락·고객 취소, 부분·전체 모두) | 품목 취소 |
| `RETURN` | 반품 | 출고된 수량이 돌아온다 | 반품 |
| `PRICE_ADJUSTMENT` | 금액 조정 | 품목은 그대로, 돈만 일부(차액·보상·배송비·지연) | 금액 조정 |
| `SUBSCRIPTION_FEE` | 구독료 환불 | 주문 없이 멤버십 구독료를 돌려준다 | (ADR 밖 — 주문 정본이 없는 결제) |
| `PAYMENT_ERROR` | 결제 오류 | 애초에 받으면 안 됐던 돈(중복 결제·고아 결제·시스템 보상) | (ADR 밖) |

ADR-0043 의 «주문 밖 보상»은 환불이 아니라 포인트라 목록에 없다. «결제 오류»는 품목 취소에 넣지 않고 따로 둔다(사용자 결정).
**ADR-0043 에 이 두 종류를 더하는 정정을 같은 PR 에 싣는다**(표 아래 한 단락).

### 4.2 칸 배치

- **새 칸 `refunds.kind`** — pgEnum `refund_kind`(위 다섯 값), **nullable**. null = 모름. 기본값 없음.
- `reason_code` — 출처 표지와 고객이 고른 «왜»를 담는 칸으로 **그대로** 둔다. `MEDUSA_REFUND` 는 Medusa 투영이 기댄다
  (`classify-wallet-refund.ts`, `plan-wallet-refund-bookings.ts`) — 값을 바꾸면 이중 장부.
- `reason_message` — 사람이 읽는 메모.
- 마이그 1건, additive(새 enum + nullable 컬럼) → **`migrate → deploy`**. 인덱스는 넣지 않는다(643행, 목록 필터는 기존
  `status, created_at` 인덱스 범위 안에서 거른다) — 빌더 판단으로 바꿔도 된다.

## 5. 경로별 종류 (정본: 2026-10-17 코드 조사)

`refunds` 행은 `RefundsService.create()`(`apps/wallet/src/refunds/refunds.service.ts`) 한 곳에서만 생긴다. 들어오는 길:
(A) `POST /v1/payment-intents/:id/refund` → `createByIntent` · (B) `POST /v1/admin/payment-intents/:id/refund` ·
(C) `POST /v1/admin/refund-requests/:id/approve` · (D) `POST /v1/refunds`(레포 안 호출자 없음).

| # | 경로 | 들어오는 길 | 종류 |
|---|---|---|---|
| 1 | Medusa 부분취소 `partial-cancel-order.ts` → `issuePaymentRefund` | A | `ITEM_CANCEL` |
| 2 | Medusa 채널 전체취소 `channel-cancel-order.ts` → `issuePaymentRefund` | A | `ITEM_CANCEL` |
| 3 | Medusa 구매확정 보상 `capture-order-payments-step.ts` 의 compensate | A | `PAYMENT_ERROR` |
| 4 | Medusa 관리자 대시보드 `POST /admin/payments/:id/refund` | A | 없음(null) — 레포 안 호출자 없음, 운영자는 쓰지 않는다 |
| 5 | Medusa 고아결제 정리 `scripts/orphan-payment-reconcile.ts` | A | `PAYMENT_ERROR` |
| 6 | core 반품 완료·재시도 `store-return-exchange.service.ts` | A | `RETURN` |
| 7 | core 레거시 전체취소·환불 재시도 `store-sales-orders.service.ts`(`'core'` 경로 채널) | A | `ITEM_CANCEL` |
| 8 | membership 해지 환불 `payment-client.service.ts` | A | `SUBSCRIPTION_FEE` |
| 9 | admin-web 결제 상세 환불 폼 | B | 운영자가 고른다 |
| 10 | 고객 무통장 환불 요청 승인 `refund-requests.service.ts` | C | `ITEM_CANCEL` (승인 뒤 core 가 전체 채널취소를 낸다) |
| 11 | `POST /v1/refunds` | D | 요청 바디에 있으면 그 값 |

- **wallet 이 받는 모양:** (A)(B)(D) 바디에 `kind?`(위 다섯 값, `@IsOptional() @IsEnum`). 모르는 값은 400.
  `createByIntent` 는 결제분마다 `create` 를 부르니 같은 종류를 모든 행에 싣는다. (C) 는 wallet 이 스스로 `ITEM_CANCEL`.
- **Medusa provider 에 종류를 전하는 법:** provider(`almond-payment/service.ts` `refundPayment`)는 금액과 결제 `data` 만
  받는다. 정산은 이미 결제 `data` 에 표식(`refundAttempt`·`manualRefund`, `settlement/payment-data.ts`)을 쓰고 provider 가
  읽는다 — **같은 방식으로 종류를 싣는다.** `RefundAttempt` 에 `kind` 를 더할지, 별도 표식을 둘지는 빌더 판단. 표식이 없으면
  provider 는 `kind` 를 보내지 않는다(= null). 3번은 compensate 가 표식을 써야 한다. `reasonCode: 'MEDUSA_REFUND'` 는 그대로.
- **검증 파이프만 보면 겹침은 안전하다:** wallet `ValidationPipe` 가 `whitelist: true, forbidNonWhitelisted: false`
  (`apps/wallet/src/main.ts`)라 옛 wallet 은 모르는 `kind` 를 조용히 버린다. 호출자가 먼저 떠도 환불은 그대로 나가고
  그 사이 행만 null 이다. 반대로 wallet 이 먼저 떠도 옛 호출자는 `kind` 없이 보내 null. 하지만 멱등 키 때문에 순서 제약이 생긴다(바로 아래). 마이그는
  wallet 새 코드보다 먼저(`migrate → deploy`).
- **멱등 키 재시도 — 그래서 wallet 이 먼저 떠야 한다.** wallet 멱등 처리(`domain/idempotency/http-idempotency.interceptor.ts`
  → `idempotency.service.ts`)는 ValidationPipe 보다 먼저, 원래 바디를 해시한다. 같은 키에 바디가 다르면 이전 요청이 성공했어도
  409 `IDEMPOTENCY_KEY_HASH_MISMATCH`(기록 24시간). 같은 키로 다시 보내는 호출자가 있다 — core 반품 환불
  (`return:<id>:refund:<n>`, 불확정 응답이면 같은 키 재사용)·membership(`membership:refund:${intentId}:${amount}` 고정).
  옛 코드가 `kind` 없이 보낸 요청을 새 코드가 `kind` 를 붙여 다시 보내면 409 → core 는 이를 «확정 미환불»로 읽고 새 키로
  다음 시도를 낸다 → **이중 환불 경로**(§3 anti-goal). 그래서:
  - **환불 생성 요청의 해시에서 `kind` 를 뺀다.** 근거: 같은 키는 «같은 돈의 움직임»이고 종류는 돈을 바꾸지 않는다.
    빼는 방법(해시 전 바디에서 제외하는 operation 별 목록 등)은 빌더 판단. 저장된 첫 요청과 종류가 달라도 replay 는 첫 응답이다.
  - **wallet(PR 1) 배포가 끝난 뒤 호출자(PR 2)를 배포한다.** 옛 wallet 은 `kind` 까지 해시하므로 순서가 뒤집히면 위 409 가
    그대로 난다. SST 한 스택이라 PR 1 머지·배포 → PR 2 머지·배포로 나눈다. (설계자 판단 — 빌더 검토가 잡았다)

### 5.1 PG 에 보내는 취소 사유

지금 `reason_code` 가 그대로 PG 취소 사유로 나간다(`toss.provider.ts`·`nicepay.provider.ts`·`bank-transfer.provider.ts`,
비면 `'고객 요청'`). 관리자 폼이 자유 문장을 메모로 옮기면 토스 상점관리자에서 그 문장이 사라진다. 그래서 PG 사유를 이렇게 만든다:

- 종류가 있으면 **종류의 화면 이름만** 보낸다(예: «품목 취소»)
- 종류가 없으면 지금처럼 `reason_code ?? '고객 요청'`

메모를 붙이지 않는 이유: dispatch 가 예외로 끝나면 `reason_message` 가 PG 오류 문장으로 덮이고(§3), 응답이 끊긴 환불은
같은 행·같은 토스 멱등 키로 다시 나간다(`resumeAmbiguousInTx`·재전송 잡). 메모를 붙이면 재전송 사유가 «품목 취소 · <PG 오류>»로
바뀌어 첫 전송과 달라진다. 종류는 행이 생길 때 정해지고, 다시 나갈 수 있는 동안에는 고치기(§6.1)가 막혀 있으니 재전송해도 같다. 대가로 토스 상점관리자에는 품목 문장이
안 남는다 — 그 문장은 wallet 메모와 admin-web 에 있다. 이 덕에 `MEDUSA_REFUND` 같은 코드가 토스 상점관리자에 찍히던 것도
«품목 취소»로 바뀐다. (설계자 판단 — 리뷰 때 확인)

## 6. 화면

- **관리자 환불 폼**(`apps/admin-web/src/app/(admin)/payments/[id]/payment-detail-sidebar.tsx`): «사유 코드»·«사유 메시지»
  두 입력을 **«종류»(필수 선택, 다섯 값) + «메모»(선택)**로 바꾼다. 화면에서 필수이고 API 에선 선택이다(§5).
  폼은 `reasonCode` 를 보내지 않는다 — 출처는 엔드포인트가 이미 말해 준다(관리자 라우트). 실패 토스트의
  `result.reasonCode` 대체 표시는 `failureCode` 로 바꾼다.
- **환불 목록**(`use-refund-table-columns.tsx`): «종류» 칸을 «사유 코드» 앞에 둔다. null 은 «모름». 메모는 지금처럼.
  목록 필터에 종류(다섯 값 + 모름)를 더한다 — wallet `v1/admin/refunds` 쿼리(`admin-refund.dto.ts`·
  `payment-intent-admin.service.ts`)에 `kind` 필터.
- **결제 상세 환불 이력**(`payment-detail-main.tsx`): 종류를 보인다.
### 6.1 종류 고치기 (2026-10-17 결정: 이 작업에 넣는다)

- wallet 관리자 API 로 환불 행 하나의 종류를 바꾼다(다섯 값 중 하나, 또는 비우기). 종류는 돈을 바꾸지 않으니 대개 허용한다 —
  이미 PG 로 나간 취소 사유(§5.1)는 바뀌지 않는다. **단 그 행이 아직 PG 로 다시 나갈 수 있으면 409 로 거절한다:**
  - AUTO `PENDING` — 멈추면 `refund-stuck-resend` 잡이 같은 행을 다시 보낸다
  - 응답 끊긴 `FAILED`(FAILED·`PROVIDER_EXCEPTION`·AUTO·14일 안 — `ambiguousWhere` 와 같은 조건) — 요청 경로가 같은 행을 되살려 보낸다

  둘 다 같은 토스 멱등 키(`wallet:refund:<id>`)로 나가고 재전송 사유는 종류에서 나온다(§5.1). 그 사이 종류를 고치면 같은 키의
  사유가 첫 전송과 달라진다. PG 결과가 확정된 뒤(SUCCEEDED, 다시 나가지 않는 FAILED)와 PG 를 부르지 않는 MANUAL 행은 고칠 수
  있다. 같은 값으로 고치는 요청은 어느 상태든 아무것도 쓰지 않는다. (2026-10-17 최종 리뷰 결정)
- **누가 언제 무엇에서 무엇으로 바꿨는지 남긴다.** `payment_state_transitions`(entity `REFUND`)에 한 행 — 이전·새 종류는
  payload 에. 37번 판정이 나중에 종류를 읽을 때 «기계가 붙인 값인지 사람이 고친 값인지»를 거기서 가른다.
- admin-web: 환불 목록·결제 상세 환불 이력에서 종류를 눌러 바꾼다. 옛 행의 «모름»을 채우는 길도 이것이다.
- 엔드포인트 경로·권한 이름·화면 상호작용은 빌더 판단(기존 wallet 관리자 라우트의 인가 방식을 따른다).

- 화면 이름(한국어 라벨)은 admin-web 한 파일에 둔다(결제수단 라벨 정본 `provider-descriptors.ts` 와 같은 방식).
- wallet 응답 `toRefundResponse`·`toRefundListItem`·`toAdminRefund` 에 `kind` 를 더한다(additive).

## 7. 옛 행 채우기 (2026-10-17 결정: 세 단계)

일회성 스크립트 `scripts/ops/1016-40-backfill-refund-kind.ts`. **dry-run 기본**, `--apply` 는 사람이 라이브에서.
`kind is null` 인 행만 건드린다(다시 돌려도 같은 결과). 단계마다 판정 근거를 출력한다.

1. **확실한 것 — 기계로 채운다**
   - 결제 intent `purpose = 'SUBSCRIPTION'` → `SUBSCRIPTION_FEE` (membership 해지 사유 코드는 여기로 빠진다)
   - `RETURN_COMPLETED` → `RETURN`
   - `CUSTOMER_REFUND_REQUEST`·`CUSTOMER_CANCEL` 및 고객 취소 사유 코드(`CHANGE_OF_MIND`·`WRONG_ORDER`·`FOUND_CHEAPER`·
     `DELAY`·`OTHER`, 정본 `store-order-actions.dto.ts`) → `ITEM_CANCEL`
   - `ORPHAN_PAYMENT_RECONCILE` → `PAYMENT_ERROR`
   - `MEDUSA_REFUND` → Medusa 장부의 그 환불 행 note 접두어(`partial-cancel:`·`channel-cancel:`)면 `ITEM_CANCEL`.
     wallet 환불 id ↔ Medusa 환불은 결제 `data` 의 `walletRefundIds` 로 잇는다. 못 이으면 3단계로.
2. **자유 문장 — 키워드로 후보를 만들고 사람이 본다** (`reason_code` 와 `reason_message` 를 함께 본다)
   - 품절·부족·단종·누락 + 취소 → `ITEM_CANCEL` · 차액·보상·배송비 → `PRICE_ADJUSTMENT` · 반품 → `RETURN` ·
     중복 결제·중복 주문 → `PAYMENT_ERROR`
   - 둘 이상 걸리면(예: «… 품절 … 변경 후 차액 부분 환불») 후보를 내지 않고 3단계로.
   - dry-run 이 후보 목록 CSV(행 id·금액·날짜·사유 원문·후보)를 낸다. 사람이 CSV 를 고치거나 지우고 `--apply --from <csv>` 로
     그 목록만 적용한다.
3. **나머지는 모름(null)으로 둔다.** 37번 안전망은 모름을 지금처럼 멈춤으로 다루니 결과가 달라지지 않는다.

키워드 목록·CSV 모양은 빌더 판단. 적용 결과(단계별 건수)는 #1016 «남은 운영 작업» 체크박스에 적는다.

## 8. 나눠 내기

1. **PR 1 — wallet:** 마이그·`kind` 칸·DTO·응답·관리자 목록 필터·종류 고치기 API(§6.1)·멱등 해시(§5)·PG 사유(§5.1)·
   (C) 의 `ITEM_CANCEL` + ADR-0043 정정.
2. **PR 2 — 호출자:** Medusa(표식·provider·3번·5번), core(6·7번), membership(8번), admin-web(폼·목록·상세).
   **PR 1 이 라이브에 뜬 뒤에** 머지·배포한다(§5 멱등 키). 앱별로 더 쪼개도 된다.
3. **PR 3 — 옛 행 스크립트.** PR 1 배포 뒤 라이브에서 dry-run → 사람 검토 → `--apply`.

배포 체크박스(#1016 «남은 운영 작업»): PR 1 `db:migrate`(wallet) → `sst deploy` · 옛 행 dry-run 건수 · `--apply` 건수.

## 9. 빌더에게 맡기는 것

- Medusa 표식의 정확한 모양(§5), 멱등 해시에서 `kind` 를 빼는 방법(§5), 화면 라벨 파일 위치, 키워드 목록·CSV 형식(§7), 인덱스 여부(§4.2).

## 10. 곁에서 찾은 것 (이 작업 밖)

- core `wallet-refund.client.ts` 와 membership `payment-client.service.ts` 가 FAILED 행의 `reasonCode` 를 errorCode 로 쓴다.
  wallet 은 실패 코드를 `failureCode` 에 따로 두므로 errorCode 가 `RETURN_COMPLETED` 같은 값이 될 수 있다.
- 고객 취소 사유(`CHANGE_OF_MIND` 등)는 Medusa 주문이면 channel-adapter 에서 버려져 wallet 에 닿지 않는다.
