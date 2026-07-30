# 멤버십 정책 · 해지 · 환불 (구현 기준)

멤버십 가입/해지/환불이 **실제로 어떻게 동작하는지**를 코드 기준으로 정리한 문서. 정책 문구, 고객·관리자
화면, 가능한 모든 동작과 그 결과를 담는다. 정책 수치를 바꿀 때는 이 문서와
`apps/membership/src/services/subscription/refund-policy.service.ts` 를 함께 고친다.

- 조회 비용: 환불 가능 여부(wallet)는 **3초 타임아웃 + 30초 캐시**다. 이 조회는 마이페이지 렌더링
  경로에 있어서, wallet 이 느려질 때 화면 전체가 함께 느려지면 안 된다. 실패하면 '자동환불 불가(수동
  경로)'로 안전하게 떨어진다. 캐시는 판단 보조값에만 쓰이고 집행 권위는 wallet 에 있다.
- 정책 소유자(코드): `RefundPolicyService` — DB·HTTP 를 모르는 순수 계산기. 고객 셀프해지·관리자
  강제취소·미리보기(견적)가 **모두 이 한 곳**을 통과한다.
- 사실 수집: `CancellationContextReader` — 계약/플랜/자격/혜택사용/환불가능수단을 한 번에 모은다.
  미리보기와 실제 실행이 같은 입력을 쓰므로 "화면에 보인 금액 ≠ 실제 환불액" 이 생기지 않는다.

---

## 1. 상품 구조

| | 월간 | 연간 |
|---|---|---|
| 가격 | 4,990원 | 49,900원 (= 월정가 × 10, **2개월 할인**) |
| 기간 | 30일 | 365일 |
| 정기결제(자동갱신) | 가능 | **불가** |
| 1회 결제 | 가능 | 가능 |

연간은 정기결제가 **구조적으로 불가능**하다 — `subscription.creator.ts:19` 의
`RECURRING_MAX_DURATION_DAYS = 31` 이 31일 초과 플랜의 recurring 가입을 거부하고, 스토어프론트도
연간 선택 시 `one_time` 으로 강제한다. 따라서 **연간 = 항상 1회 결제 = 토스/무통장 = PG 자동환불 가능**.

결제 수단별 성질:

| 수단 | 쓰이는 곳 | PG 환불 |
|---|---|---|
| 토스(카드 등) | 1회 결제 | 가능 |
| 무통장(가상계좌) | 1회 결제 | 가능(수취 계좌 필요) |
| **효성 CMS 자동이체** | **월간 정기결제** | **불가** — 프로토콜에 환불 API 가 없다 |

CMS 는 환불이 불가하므로, 돈을 되돌리는 방법은 두 가지뿐이다.
1. **출금 전이면 예정 출금 삭제** — 돈이 애초에 나가지 않는다(정석).
2. 이미 출금됐으면 **관리자 계좌 수동 송금**.

---

## 2. 해지·환불 정책

### 2-1. 두 가지 해지 방식 — 고객이 고른다

| | 해지 예약 (`AT_PERIOD_END`) | 즉시 해지 (`IMMEDIATE_REFUND`) |
|---|---|---|
| 자격 | 이용 종료일까지 유지 | 즉시 종료 |
| 환불 | 없음 | 정책 산정액 |
| 이후 결제 | 청구 안 됨 | 청구 안 됨 |
| 계약 상태 | `ACTIVE` 유지 + `recurringCancelledAt` | `CANCELLED` |

해지 예약이 기본이고 권장값이다. 즉시 해지는 **환불이 가능할 때만** 권장값이 된다 — 잔여 이용권을
포기하는 선택이기 때문이다.

### 2-2. 환불 산정

**① 청약철회 — 결제 후 7일 내 + 혜택 미사용 → 전액 환불** (월간·연간 공통)

- `WITHDRAWAL_WINDOW_DAYS = 7`
- "혜택 미사용" = 이번 결제 주기에 멤버십 할인 적용 주문이 0건(`membership_cycle_benefits` 의
  `orderCount = 0 && totalDiscountAmount = 0`)
- 한 번이라도 썼으면 7일 내라도 환불 불가

**② 연간 중도해지 — 사용 기간을 월간 정가로 정산**

```
환불액 = 결제액 − (경과 개월수 × 월간 정가) − 그 기간에 받은 할인 혜택액     (최소 0)
경과 개월수 = ceil(경과일수 / 30), 최소 1        // 시작월도 1개월로 센다
```

| 경과 | 차감 | 환불액 |
|---|---|---|
| 1개월 | 4,990 | 44,910 |
| 3개월 | 14,970 | **34,930** |
| 6개월 | 29,940 | 19,960 |
| 9개월 | 44,910 | 4,990 |
| **10개월 이후** | 49,900 | **0** |

10개월(= 49,900 ÷ 4,990) 경과 후 환불액이 0이 되어 **'연간 2개월 무료' 혜택이 정확히 회수된다.**
환불액이 0이면 즉시 해지 자체를 막고 잔여기간 이용을 권한다(고객이 잔여 이용권만 잃는 선택을 하지
않도록).

월간 정가는 동일 티어의 활성 30일 플랜에서 읽고, 없으면 `연간가 ÷ 10` 을 폴백으로 쓴다
(`findMonthlyListPrice`). 할인 혜택액은 `membership_discount_events` 에서 취소되지 않은 주문만 합산.

**이번 주기의 시작은 `billing_events` 의 마지막 `CHARGE_SUCCESS` 시각이다** (`findLastChargeSuccessAt`).
`entitlement.endsAt − 플랜기간` 으로 역산하면, 결제와 무관하게 endsAt 를 미는 경로(관리자 기간 조정,
일시정지 재개)에서 주기 시작이 함께 밀려 **이미 지난 청약철회 7일 창이 되살아난다** — CS 가 사과로
7일을 연장해 준 고객이 전액 환불 대상이 되는 식이다. 결제 기록이 없는 옛 계약만 역산으로 폴백한다.

**일시정지 기간은 이용 기간으로 세지 않는다.** 연간 정산의 경과일에서 그 주기의 정지 일수를 뺀다
(`sumPausedDaysSince` — START~RESUME 구간 합산). 정지 중에는 혜택을 쓸 수 없기 때문이다. 반면
청약철회 7일 창은 법정 기준(결제일)이라 보정하지 않는다.

**환불액은 wallet 이 실제로 더 환불할 수 있는 금액을 넘지 않는다.** 정책액은 플랜 정가로 계산되므로,
이미 부분 환불이 나갔거나 실제 결제액이 더 적은 계약에서는 정책액이 남은 환불 가능액을 넘을 수 있다.
`GET /v1/payment-intents/:id/refundability` 의 `remainingRefundableAmount` 를 상한으로 쓴다(조회 실패나
0 이면 자르지 않는다 — 알 수 없는 값으로 정상 환불까지 막지 않기 위해).

**③ 월간, 7일 경과 → 환불 불가.** 해지 예약만 가능하다.

**④ 관리자 예외 환불** — 정책과 무관하게 금액 지정 가능. 단 상한이 있다(§4-3).

### 2-3. 환불 집행 경로

| 상황 | `refundExecution` | 처리 |
|---|---|---|
| 토스 카드 등 | `AUTO` | wallet → PG 환불 |
| 무통장 | `AUTO` + 계좌 필수 | wallet → 토스 자동 송금 |
| **효성 CMS** | `MANUAL` | **wallet 호출하지 않음.** 계좌를 받아 `REFUND_PENDING` 으로 남기고 관리자가 송금 |

환불 결과는 `COMPLETED / PENDING / FAILED` 로 **사실대로** 보고된다. `PENDING` 은 돈이 아직 나가지
않은 상태다(수동 송금 대기). 안내 문구도 상태별로 다르다.

### 2-4. 고객 안내 문구 (스토어프론트 결제·환불 안내)

`web/almondyoung-storefront/src/app/[countryCode]/(mypage)/mypage/membership/subscribe/payment/components.tsx`
의 `결제 · 환불 안내` 접이식 블록. 결제 방식·플랜별로 분기한다.

- **월간 정기결제**: 매월 자동 결제 / 이용 시작 후 환불 불가 / 다음 결제일 전 해지 시 이후 청구 없고
  결제한 기간은 종료일까지 이용 / **7일 내 + 혜택 미사용이면 청약철회 전액 환불**
- **월간 1회 결제**: 자동결제 없음 / 이용 시작 후 환불 불가 / 7일 내 + 혜택 미사용 청약철회
- **연간**: 자동결제 없음 / 7일 내 청약철회 / **12개월 전제로 2개월 할인한 가격이므로 중도해지 시
  이용 기간을 월간 정가로 정산** + 산식 명시 / 30일 단위·시작월 포함 / 정산 결과 0원 이하면 환불 없음

> 법률 유의: 계속거래는 방문판매법상 언제든 해지 가능하고 잔여기간 정산 의무가 다퉈질 수 있다.
> 연간 정산식을 약관에 명시하는 편이 방어적으로 유리하다. 최종 문구는 법률 확인 권장.

---

## 3. 고객 플로우

### 3-1. 어디에 있나

| 화면 | 파일 |
|---|---|
| 멤버십 홈(가입자) | `domains/membership/home/components/subscriber/subscriber-section.tsx` |
| 상태 카드(결제일/종료일) | `.../subscriber/member-details.tsx` |
| 해지 모달 | `domains/membership/components/modal.tsx` |
| 서버 액션 | `lib/api/membership/index.ts` |
| 페이지(데이터 로딩) | `app/[countryCode]/(mypage)/mypage/membership/page.tsx` |

페이지가 서버에서 `getCancellationPreview()` 를 함께 불러 내려준다. **미리보기가 없으면(활성 구독
없음 등) 해지 진입점을 아예 렌더하지 않는다** — 누를 수 없는 버튼을 보여주지 않는다.

### 3-2. 가능한 동작

| 동작 | 진입점 | API | 결과 |
|---|---|---|---|
| 해지 선택지·금액 확인 | 페이지 진입 시 자동 | `GET /subscriptions/cancel-preview` | 두 방식의 가능여부·금액·종료일·산출내역 |
| 해지 예약 | `멤버십 해지하기` → 방식 선택 | `POST /subscriptions/cancel` `cancelType=AT_PERIOD_END` | 잔여기간 유지, 이후 청구 없음 |
| 즉시 해지 + 환불 | 같은 모달에서 즉시해지 선택 | `POST /subscriptions/cancel` `cancelType=IMMEDIATE_REFUND` | 자격 즉시 종료 + 환불 |
| **해지 철회** | 해지 예약 배너의 `해지 취소하고 계속 이용하기` | `POST /subscriptions/cancel/undo` | 자동결제 재개. **정기결제였던 계약만** (`canUndoCancellation`) |
| 해지 사유 목록 | 모달 | `GET /subscriptions/cancellation-reasons` | 라디오 목록(없으면 '기타' 폴백) |

모든 라우트는 `JwtAuthGuard`. **`userId` 는 토큰에서만 온다** — 남의 구독을 지정할 방법이 없다.

### 3-3. 해지 모달 (동적 3스텝)

스텝은 상황에 따라 늘고 줄어든다.

```
[방식 선택]  ← 즉시해지가 가능할 때만
   ↓
[사유 선택]  ← 항상
   ↓
[환불 계좌]  ← 즉시해지 + 수취계좌 필요할 때만 (무통장·CMS 수동송금)
```

- **방식 선택**: 두 카드. 해지예약은 `{종료일}까지 이용 후 자동결제 중단, 환불 없음`, 즉시해지는
  `지금 해지하고 N원 환불`. 연간은 **산출 내역을 그대로 노출**(`결제액 49,900원`,
  `이용 3개월 × 월 정가 4,990원 = -14,970원`, 혜택 차감이 있으면 그 줄도). CMS 면
  `자동이체 결제는 즉시 환불이 불가해, 입력하신 계좌로 영업일 3일 내 송금` 안내.
- 즉시해지가 불가하면 이 스텝을 건너뛰고 **불가 사유를 사유 선택 화면에 그대로 보여준다**
  (`결제 후 7일이 지나 환불이 불가합니다.` 등). 이유를 숨기지 않는다.
- **사유 선택**: 사유를 고르기 전에는 진행 버튼 비활성. '기타' 선택 시 자유 입력.
- **환불 계좌**: 은행 select(토스 은행코드) + 계좌번호(숫자만) + 예금주. 셋 다 채워야 완료 가능.
  부분 입력 시 안내를 `aria-live` 로 알린다. 금융정보라 `autoComplete=off`·`spellCheck=false`.
- 뒤로/취소로 언제든 이탈 가능하며 **이탈 시 아무 요청도 나가지 않는다.** Esc 로 닫히고 포커스는
  모달 안에 갇힌다.

### 3-4. 해지 후 화면 (해지 예약 상태)

`subscriber-section.tsx:113` 배너 — **"언제 해지했고 언제까지 쓸 수 있는지"** 를 명시한다.

```
해지 예약됨
{해지일}에 해지 신청하셨습니다. {종료일}까지 멤버십 혜택을 이용하실 수 있으며,
이후 자동 결제는 청구되지 않습니다.
[해지 취소하고 계속 이용하기]
```

- 이 상태에서는 **해지 버튼이 사라진다**(중복 해지가 UI 에서 먼저 막힌다). 서버도 409 로 막는다.
- 상태 카드는 `자동갱신 없음` 이면 "다음 결제 예정일" 대신 **이용 종료일**을 안내한다.
- 1회 결제는 배너의 철회 버튼이 없다(되돌릴 정기결제가 없다). 서버가 미리보기의
  `canUndoCancellation` 으로 판단해 내려주고, `/cancel/undo` 도 409 로 막는다 — 철회는 wallet 자동이체
  약정을 새로 만들기 때문에, 1회 결제 고객에게 열어주면 **동의한 적 없는 정기결제가 시작된다.**
  해지 후에는 `autoRenewal` 이 꺼져 1회 결제와 구분되지 않으므로, 판정 근거는 해지 시점 사실
  (`RECURRING_CANCELLED` 이벤트의 `wasRecurring`)이다.

### 3-5. 1회 결제 고객

해지해도 잔여기간은 유지되고, 메시지가 정기결제와 다르다:
`해지 접수되었습니다. 1회 결제 건이므로 추가 결제는 없으며, 멤버십은 {종료일}까지 이용하실 수 있습니다.`
("정기결제가 중단되었습니다" 는 존재하지 않는 정기결제를 끊은 것처럼 읽히므로 쓰지 않는다.)

---

## 4. 관리자 플로우

### 4-1. 어디에 있나

- **멤버십 > 멤버십 회원** (`/membership/members`) → 행의 `수정` → 상세 모달 → **`해지 · 환불` 탭**
- **고객관리 > 고객 상세창 → 멤버십 탭** — 같은 패널(`MembershipDetailPanel`)을 렌더하며
  **동일한 액션을 쓸 수 있다.** 이전에는 읽기 전용이라 CS 가 멤버십 메뉴로 이동해야 했다.

파일: `apps/admin-web/src/features/membership/members/components/detail-dialog/index.tsx`

### 4-2. 탭 구성 (위→아래)

1. **현재 플랜** — 티어/기간, **결제 방식**(`정기결제(자동갱신)` / `정기결제(해지 예약됨)` /
   `일시결제(자동갱신 없음)`), 다음 결제일 또는 이용 종료일, **환불 상태**.
   환불 미완료는 `미완료 — 4,990원 처리 필요` 로 강조된다 — 자격은 회수됐는데 돈이 안 나간 건을
   놓치지 않게.
2. **해지 예약됨** (해당 시) — 해지 신청 시각·종료일·사유 + `해지 예약 철회 (자동 결제 재개)`
3. **해지 예약 (권장)** — 정기결제 계약에만. **사유 입력 필수**인 명시적 버튼.
   `POST /admin/subscriptions/:contractId/schedule-cancel` — 고객 셀프해지의 `AT_PERIOD_END` 와
   **완전히 같은 처리**다(해지 시각·사유 기록, `nextBillingDate=null`, dunning 삭제, 자동이체 약정 종료).
   이전의 '자동 연장' 토글은 청구만 멈춰서 (a) 화면상 1회 결제로 보이고 (b) 사유가 남지 않고
   (c) 은행에 걸린 효성 약정과 예정 출금이 살아남았다.
4. **자동 결제 없음** (1회 결제) — 예약 해지가 필요 없다는 안내
5. **즉시 해지 + 환불** — 파괴적 액션이라 마지막, `destructive` 스타일

### 4-3. 즉시 해지 다이얼로그 — 견적을 먼저 보여준다

`GET /admin/subscriptions/:contractId/cancellation-quote` 를 열 때 조회해 **금액을 짐작하지 않게** 한다.

- **정책 기준 환불액** + 종류 라벨(`7일 내 청약철회 · 전액` / `연간 중도해지 정산` / `정책상 환불 없음`)
- **산출 내역**: 결제액, `이용 N개월 × 월 정가` 차감, 혜택 차감
- **환불 수단**: `PG 자동환불 가능` 또는 `자동환불 불가 — 계좌 송금 필요(효성 CMS 등)`
- 정책상 환불 불가면 그 사유 + "예외 환불은 아래에서 금액을 직접 지정"
- 환불 유형: `환불 없음` / `정책 금액·직접 입력` / `전액 환불`.
  `정책 금액·직접 입력` 을 고르면 **정책 금액이 자동으로 채워지고**, `정책 금액` 버튼으로 되돌릴 수 있다.
- 연간에 `전액 환불` 을 고르면 경고: `연간 플랜 전액 환불은 정책 정산(34,930원)보다 큽니다.`
- 수취 계좌가 필요하면 **은행 select** + 계좌번호 + 예금주 (자유 입력 은행코드는 오타로 송금이
  실패하므로 쓰지 않는다. 결제관리 환불 화면과 같은 방식)
- 사유 미입력·계좌 미입력이면 요청을 보내지 않고 토스트로 막는다.
- 완료 후 토스트가 **실제 환불 결과**를 알린다:
  `COMPLETED` → 금액과 함께 완료 / `PENDING` → *수동 송금 대기 — 송금 후 결제관리에서 완료 처리* /
  `FAILED` → 계좌 송금으로 수동 처리 필요

### 4-4. 권한 — 환불 금액 상한

해지·환불은 CS 일상 업무라 `admin` 에게 열려 있다. 위험한 건 **큰 금액을 정책 없이** 환불하는 것이므로
그것만 분리했다.

| 스코프 | 부여 | 의미 |
|---|---|---|
| `membership.billing.refund` | admin, master | 해지 + 한도 이내 환불 |
| `membership.billing.refund_override` | master | **한도 초과 환불** (장애 보상 등) |

```
한도 = max(정책 산정액, 월 정가 1개월분)
```

월 정가를 하한으로 둔 이유: 정책액만으로 자르면 "월간 7일 경과 → 정책상 0원" 계약에 배송 지연 사과
같은 소액 보상조차 못 하게 되어 CS 가 매번 master 를 불러야 한다. 한도 초과 요청은 견적을 다시 계산해
**403** 으로 막는다(연간 회원에게 정산 없이 49,900원 전액 환불하는 사고가 주 표적).

기존 `ScopeGuard`(`@app/authorization`)를 재사용한다. 스코프는 JWT claim 이 아니라 **역할 이름으로
서버에서 조회**되므로 토큰·user-service 변경이 필요 없고, 부팅 시 `auth.scopes` /
`auth.role_scope_mapping` 이 선언에 맞춰 자동 정합화된다.

### 4-5. 관리자 API

| 동작 | 라우트 | 비고 |
|---|---|---|
| 해지·환불 견적 | `GET /admin/subscriptions/:contractId/cancellation-quote` | |
| 즉시 해지 + 환불 | `POST /admin/subscriptions/:contractId/force-cancel` | `@RequireScopes(BILLING_REFUND)` + `@IdempotentAdminOp` |
| 수동 송금 환불 완료 | `POST /admin/subscriptions/:contractId/refund/manual-complete` | CMS·무통장 계좌 송금 후 확정 |
| 해지 예약 | `POST /admin/subscriptions/:contractId/schedule-cancel` | 사유 필수. 셀프해지 `AT_PERIOD_END` 와 동일 처리 |
| 해지 예약 철회 | `PUT /admin/contracts/:contractId/auto-renewal` | `autoRenewal: true` |

전부 클래스 레벨 `@MembershipAdminAuth()`(= `RolesGuard('admin','master')`). 강제취소는
`Idempotency-Key` 로 재전송을 막고, **이미 `CANCELLED` 인 계약은 409 로 거부**해 환불이 두 번 나가지
않게 한다(멱등키는 같은 요청의 재전송만 막지, 두 번째 클릭은 새 키로 통과한다). 추가 환불이 필요하면
결제관리(wallet)에서 처리한다.

`force-cancel` 요청에는 `customerEmail` 을 함께 보낸다 — membership 은 사용자 조회를 하지 않으므로,
어드민 UI 가 이미 화면에 띄우고 있는 고객 이메일을 실어 보내야 나중에 알림을 붙일 수 있다.

자동갱신 재활성(철회)은 **wallet 자동이체 약정을 먼저 복구한 뒤** 상태를 커밋한다. 순서를 뒤집으면
다음 청구가 `BILLING_AGREEMENT_NOT_FOUND` 로 실패해 즉시 해지로 이어진다. 이미 만료된 구독은
409 로 거부하고 재가입을 안내한다(청구 불가 좀비 계약 방지).

---

## 5. 해지가 실제로 하는 일 (순서와 이유)

```
1. 방식 검증        정책상 불가한 방식이면 여기서 400. 계약은 손대지 않는다.
2. 상태 전이(TX)    ── 즉시해지: status=CANCELLED, cancelledAt, autoRenewal=false,
                       nextBillingDate=null, 자격 종료, dunning 삭제
                    └─ 해지예약: recurringCancelledAt, 사유, autoRenewal=false,
                       nextBillingDate=null, dunning 삭제 (status 는 ACTIVE 유지)
3. 환불 실행        AUTO 면 wallet 호출. MANUAL(CMS)이면 호출하지 않고 수동 대기로 기록.
                    결과를 계약 이벤트(REFUND_COMPLETED/PENDING/FAILED)로 남긴다.
4. 약정 종료        예정 출금 삭제 → 약정 REVOKE → (공유되지 않으면) 효성 회원삭제
5. 인보이스 무효화   즉시해지 + INVOICE 경로만
6. 이벤트 발행      MembershipStatusChanged (Medusa 고객 그룹 해제)
```

**재청구는 세 겹으로 막힌다**: `autoRenewal=false` + `nextBillingDate=null` + dunning 삭제.
`findDueContracts` 가 어떤 해지 경로로도 그 계약을 다시 집지 않는다(E2E 로 검증).

### 효성 CMS 약정 종료

효성 프로토콜(FMS-TE-0046)에는 **약정해지 API 가 없다.** 유일한 종료 수단이 회원삭제
(`DELETE /v1/members/{memberId}`)이므로 그 경로까지 잇는다:

```
POST /v1/billing-agreements/by-subscriber/terminate-mandate
  ① 마감 전 예정 출금 삭제        ← 돈이 애초에 나가지 않게. CMS 는 환불이 안 되므로 이게 정석.
  ② billing_agreements → REVOKED
  ③ 그 결제수단을 쓰는 다른 활성 약정이 없을 때만 효성 회원삭제
```

결제수단은 사용자당 공유되므로 ③ 의 조건이 없으면 남은 구독의 청구가 깨진다. 공유로 건너뛴 경우는
정상이므로 재정리 대상으로 남기지 않는다.

**INVOICE 경로 해지예약은 종료를 보류한다.** 자격을 선지급했고 그 기간의 수금이 남아 있어서, 지금
약정을 지우면 출금이 실패해 무료 이용이 된다. 인보이스가 정산/소멸되는 시점에
`InvoiceOutcomeHandler` 가 이어받아 종료한다.

약정 종료가 실패해도 해지는 되돌리지 않는다 — 재청구는 DB 플래그로 이미 막혀 있고,
`AGREEMENT_REVOKE_PENDING` 계약 이벤트로 후속 정리 대상만 남긴다.

**남은 정리는 `AgreementCleanupService` 가 매시간 이어서 끝낸다.** 계약별 최신 약정 이벤트가
`AGREEMENT_REVOKE_PENDING` 인 건만 골라 재시도하고, 성공하면 `AGREEMENT_REVOKED` 로 확정해 큐에서
빠진다(상태 컬럼 없이 이벤트만으로 큐가 비워진다). 효성 삭제 가드처럼 재시도로 풀리지 않는 건은
7일 뒤 `AGREEMENT_REVOKE_ABANDONED` 로 확정하고 재시도를 멈춘다 — 매시간 같은 실패를 반복하며
아무도 처리하지 않는 상태를 만들지 않기 위해서다.

---

## 6. 상태 표현

계약 상태는 여러 축으로 나뉘어 있어 화면마다 추론하면 어긋난다. **서버가 계산해 내려주는 값을 쓴다.**

| 상태 | DB | 미리보기/견적 |
|---|---|---|
| 정상 정기결제 | `ACTIVE` + `autoRenewal=true` | `isRecurring=true`, `alreadyScheduled=false` |
| 해지 예약 | `ACTIVE` + `recurringCancelledAt` | `alreadyScheduledForCancellation=true` |
| 즉시 해지 | `CANCELLED` + `cancelledAt` | (활성 구독 없음 → 404) |
| 1회 결제 | `ACTIVE` + `autoRenewal=false`, `recurringCancelledAt=null` | `isRecurring=false` |

`recurringCancelledAt` 이 해지예약의 SoT 다. `nextBillingDate` 로 추론하면 해지 시 null 로 지워져
1회 결제와 구분되지 않는다.

응답의 해지 시각은 DB 기록과 동일하다(매니저가 한 시점을 만들어 저장·반환에 함께 쓴다).

---

## 7. 검증 (전부 로컬)

```bash
docker compose up -d postgres

# 서비스 + HTTP 계층 (86 케이스)
npm run test:membership:cancellation-e2e

# 고객 UI — 실제 크로미움, 6 시나리오
cd web/almondyoung-storefront && npm run test:e2e:membership-cancel

# 관리자 UI — 실제 크로미움, 4 시나리오
cd apps/admin-web && npm run test:e2e:membership-cancel
```

- 서비스 계층(60): 상태 전이·자격·계약이벤트·더닝·재청구 차단, 관리자 해지예약 대행, 1회 결제 철회 차단,
  수동 송금 환불 완료 처리, 주기 시작 판정(관리자 연장·일시정지), 약정 정리 재시도
- HTTP 계층(26): JwtAuthGuard, ScopeGuard, zod, 도메인예외→상태코드, Idempotency-Key
- UI: 스텁 백엔드로 대체해 실제 화면 조작 (`e2e/membership-cancel/`)

함정
- 통합 스펙은 DB 를 공유하므로 **`--runInBand`** 필수. 병렬로 돌리면 서로 테이블을 비운다.
- `apps/membership/.env` 의 `DATABASE_URL` 이 공유 Neon 을 가리킨다. 로컬 규약은
  `postgresql://postgres:postgres@localhost:5432/<논리DB>`. 스크립트는 셸에서 주입하므로 안전하다.
- UI E2E 는 dev 서버를 띄운다. 스토어프론트·admin-web 을 **동시에 돌리면** 자원 경쟁으로
  `page.goto` 가 타임아웃된다. 하나씩 실행할 것.
- 스토어프론트 `.env.local` 은 원격(dev) 백엔드를 가리킨다. 러너가 로컬 모드를 강제한다.

---

## 8. 남은 것

- **해지·환불 알림 없음.** notification 서비스가 미성숙해(프로덕션 실동 채널이 Resend 이메일 하나,
  큐 없이 Kafka 핸들러에서 동기 발송) 보류했다. 복원 지점 커밋 `3e993916b`.
  `MembershipStatusChanged` 에는 이미 `email` / `periodEndsAt` / `refundAmount` / `refundStatus` 가
  실려 있어 발행측을 다시 손대지 않아도 된다. 컨슈머 + `templates` / `notification_events` 행만
  넣으면 동작한다(행이 없으면 컨슈머가 조용히 no-op 한다).
- **고객관리 상세창 멤버십 탭은 브라우저로 검증하지 못했다.** 같은 패널을 렌더하지만 그 화면까지
  띄우려면 customers 페이지와 core API 스택을 스텁해야 한다.
- **수동 환불 완료 처리**는 멤버십 화면에서 한다 — 해지·환불 탭의 환불 행에 `송금 완료 처리` 버튼
  (`POST /admin/subscriptions/:contractId/refund/manual-complete`). wallet 의 수동 완료
  (`POST /v1/admin/refunds/:id/confirm`)는 **무통장 전용**이고, 효성 CMS 는 wallet 에 환불 행 자체가
  만들어지지 않아(PG 환불 API 가 없다) 그 경로로 닫을 수 없다. 그대로 두면 `refundCompleted` 가
  영구히 false 로 남아 "미완료 — N원 처리 필요" 가 계속 떠 있는다.
- 이 작업은 **스키마 변경이 0건**이다. 라이브에는 마이그레이션 8건이 모두 적용돼 있어
  배포 시 `db:migrate` 가 필요 없다. 스코프 행은 부팅 시 자동 정합화된다.
