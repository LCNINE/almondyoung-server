# 결제 관리자 페이지 설계

> Wallet 앱의 결제 데이터를 admin-web에서 열람·관리하기 위한 페이지 구성 설계

## 1. 개요

### 대상 도메인

| 도메인 | 설명 |
|--------|------|
| Payment Intent | 결제 주문 (항목, 할인, 금액 계산, 상태 머신) |
| Charge | Intent 내 개별 결제 시도 (AUTHORIZE → CAPTURE 등) |
| Refund | 환불 처리 |
| Payment Method | 사용자 결제 수단 (POINTS, TOSS, BANK_TRANSFER, BNPL) |
| Points | 포인트 적립/사용/취소 (lot 기반 추적) |
| Bank Transfer | 무통장입금 확인 대기 |
| State Transition | 모든 상태 변경 이력 (감사 로그) |

### Intent 상태 흐름

```
CREATED → PROCESSING → REQUIRES_ACTION → AUTHORIZED → CAPTURED → SUCCEEDED
                     → FAILED
                     → CANCELED
```

### Charge 상태 흐름

```
CREATED → PENDING → SUCCEEDED → REFUNDED
                  → FAILED
       → REQUIRES_ACTION → SUCCEEDED
       → CANCELED
```

---

## 2. 페이지 구성

### 2.1 `/payments` — 결제 목록

결제 전체를 조회하는 핵심 페이지.

**테이블 컬럼:**

| 컬럼 | 출처 | 비고 |
|-------|------|------|
| ID | paymentIntents.id | truncated + copy |
| 사용자 | paymentIntents.userId | |
| 결제금액 | paymentIntents.payableAmount | + currency |
| 결제수단 | charges → paymentMethod.type | TOSS, POINTS, 복합 등 |
| 상태 | paymentIntents.status | 배지 표시 |
| 생성일 | paymentIntents.createdAt | DateCell |

**필터:**
- 상태 — select (multi)
- 결제수단 타입 — select
- 날짜 범위 — date
- 금액 범위 — number

**검색:** intent ID, userId

**정렬:** 생성일, 금액

---

### 2.2 `/payments/[id]` — 결제 상세

`TwoColumnPage` 레이아웃 사용.

#### Main 영역

**기본 정보 섹션:**
- ID, 상태(배지), payableAmount, currency
- createdAt, expiresAt, metadata

**주문 항목 테이블 (paymentIntentItems):**

| 컬럼 | 설명 |
|-------|------|
| 항목명 | name |
| 유형 | itemType (product, subscription, shipping) |
| 단가 | unitPrice |
| 수량 | quantity |
| 항목 할인 | itemDiscountPerUnitTotal + itemDiscountFlatTotal |
| 결제금액 | payableAmount |

**주문 할인 (paymentIntentOrderDiscounts):**

| 컬럼 | 설명 |
|-------|------|
| 할인명 | discountRefId |
| 종류 | kind (ORDER) |
| 금액 | amount |

**Charges 테이블:**

| 컬럼 | 설명 |
|-------|------|
| ID | charge.id |
| 작업 | operation (AUTHORIZE / CAPTURE / CANCEL / REFUND) |
| 금액 | amount |
| 상태 | status (배지) |
| Provider Tx ID | providerTransactionId |
| 생성일 | createdAt |

**환불 내역 (해당 intent의 refunds):**

| 컬럼 | 설명 |
|-------|------|
| Refund ID | id |
| 금액 | amount |
| 상태 | status |
| 사유 | reasonCode + reasonMessage |
| 생성일 | createdAt |

**상태 변경 이력 (state_transitions):**
- 타임라인 형태 표시
- 각 항목: previousStatus → newStatus, triggeredByType, 일시

#### Sidebar 영역

**사용자 정보:**
- userId (사용자 상세 페이지 링크)

**결제수단 정보:**
- type, displayName

**액션 버튼:**
- `Capture` — AUTHORIZED 상태일 때 활성화
- `Cancel` — 취소 가능 상태일 때 활성화
- `Refund` — CAPTURED/SUCCEEDED 상태일 때 활성화 (금액 입력 모달)

---

### 2.3 `/payments/refunds` — 환불 목록

**테이블 컬럼:**

| 컬럼 | 출처 | 비고 |
|-------|------|------|
| Refund ID | refunds.id | truncated + copy |
| Intent ID | refunds.intentId | 결제 상세 링크 |
| 금액 | refunds.amount | + currency |
| 상태 | refunds.status | PENDING / SUCCEEDED / FAILED |
| 사유 | reasonCode + reasonMessage | |
| 생성일 | refunds.createdAt | DateCell |

**필터:** 상태(select), 날짜 범위(date)

---

### 2.4 `/payments/bank-transfers` — 입금 대기 관리

무통장입금 건의 입금 확인 처리 전용 페이지.

**테이블 컬럼:**

| 컬럼 | 출처 | 비고 |
|-------|------|------|
| Intent ID | paymentIntents.id | 결제 상세 링크 |
| 사용자 | userId | |
| 금액 | payableAmount | |
| 은행명 | charge.providerData → bankName | |
| 계좌번호 | charge.providerData → accountNumber | |
| 대기 시작일 | createdAt | DateCell |

**액션:** 각 행에 `입금 확인` 버튼 → `bank-transfer-confirm` API 호출

---

### 2.5 `/payments/points` — 포인트 관리

**상단:** 사용자 ID 검색 입력

**검색 후 표시:**

**잔액 카드:**
- confirmed (총 확정)
- reserved (홀드 중)
- available (사용 가능 = confirmed - reserved)

**포인트 이벤트 테이블:**

| 컬럼 | 출처 | 비고 |
|-------|------|------|
| 유형 | eventType | EARN / REDEEM / EARN_CANCEL / REDEEM_CANCEL |
| 금액 | amount | +/- 표시 |
| 사유 | reasonCode | |
| Intent ID | intentId | 결제 상세 링크 (있을 경우) |
| 일시 | createdAt | DateCell |

**액션 버튼:**
- `포인트 지급` — earn API 호출 (금액, 사유 입력 모달)
- `지급 취소` — earn-cancel API 호출 (원본 이벤트 선택, 취소 금액 입력 모달)

---

## 3. 프론트엔드 파일 구조

```
src/app/(admin)/payments/
├── page.tsx                              # 결제 목록
├── [id]/
│   ├── page.tsx                          # 결제 상세 (TwoColumnPage)
│   ├── payment-detail-main.tsx           # Main: 기본정보 + 항목 + charges + refunds + transitions
│   └── payment-detail-sidebar.tsx        # Sidebar: 사용자 + 결제수단 + 액션
├── refunds/
│   └── page.tsx                          # 환불 목록
├── bank-transfers/
│   └── page.tsx                          # 입금 대기
└── points/
    └── page.tsx                          # 포인트 관리

src/features/payments/
├── template/index.tsx                    # List template
└── components/
    ├── table/index.tsx
    └── ...

src/lib/api/domains/wallet/index.ts       # API 클라이언트 함수
src/lib/services/wallet/
├── queries.ts                            # React Query hooks
├── mutations.ts                          # capture, cancel, refund, bank-confirm, earn, earn-cancel
├── query-keys.ts
└── transformers.ts

src/lib/types/dto/wallet.ts               # DTO 타입 정의

src/hooks/table/
├── columns/use-payment-table-columns.tsx
├── filters/use-payment-table-filters.ts
└── query/use-payment-table-query.tsx
```

---

## 4. 백엔드 API 현황

### 이미 존재하는 엔드포인트

| 엔드포인트 | 용도 |
|------------|------|
| `GET /v1/admin/payment-intents/pending-bank-transfers` | 입금 대기 목록 |
| `POST /v1/admin/payment-intents/:id/bank-transfer-confirm` | 입금 확인 |
| `GET /v1/admin/points/balance?user_id=` | 포인트 잔액 |
| `GET /v1/admin/points/events?user_id=` | 포인트 이벤트 |
| `POST /v1/admin/points/earn` | 포인트 지급 |
| `POST /v1/admin/points/earn-cancel` | 지급 취소 |
| `POST /v1/payment-intents/:id/capture` | 캡처 (API-key) |
| `POST /v1/payment-intents/:id/cancel` | 취소 (JWT) |
| `POST /v1/refunds` | 환불 생성 (API-key) |

### 추가 필요한 엔드포인트

| 엔드포인트 | 용도 |
|------------|------|
| `GET /v1/admin/payment-intents` | 결제 목록 조회 (페이지네이션, 필터, 검색, 정렬) |
| `GET /v1/admin/payment-intents/:id` | 결제 상세 (items, discounts, charges, refunds 포함) |
| `GET /v1/admin/refunds` | 환불 목록 조회 (페이지네이션, 필터) |
| `GET /v1/admin/payment-intents/:id/state-transitions` | 상태 변경 이력 |

---

## 5. 참고

- 프론트엔드 패턴은 `apps/admin-web/src/app/(admin)/users/` 구현을 기반으로 함
- UI 컴포넌트: 기존 DataTable, TwoColumnPage, Container, Header 등 재사용
- 데이터 페칭: React Query (useQuery, useSuspenseQuery, useMutation)
- 상태 관리: URL searchParams 기반 (필터, 검색, 정렬, 페이지네이션)
