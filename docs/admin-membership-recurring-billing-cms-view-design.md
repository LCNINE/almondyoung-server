# 멤버십 정기결제(CMS) 관리자 뷰 설계

## 목적

관리자 페이지에 `멤버십 관리 > 정기결제 관리` 화면을 추가한다. 이 화면은 개발자가 CMS 로그를 보는 화면이 아니라, 운영자가 매일 확인해야 하는 멤버십 자동이체 문제를 빠르게 찾고 조치하는 업무 화면이다.

효성 CMS는 화면 전면의 메뉴명이 아니라 결제 방식의 내부 구현이다. 따라서 메뉴와 주요 문구는 `정기결제`, `자동이체`, `결제수단 심사`, `출금 결과 대기`처럼 운영자가 이해하는 표현을 사용하고, 상세 영역에서만 `CMS memberId`, `transactionId`, `paymentIntentId` 같은 기술 식별자를 노출한다.

## 기준 문서와 현재 코드

기준 문서:

- `apps/wallet/docs/FMS-TE-0046(Web_API-배치CMS).md`
- `apps/wallet/docs/implementation-plan-billing-and-refactor.md`
- `docs/wallet-payment-profile-management-api.md`
- `docs/admin-wallet-pages-design.md`

현재 코드 기준:

- CMS 원천 상태와 출금 상태는 `apps/wallet`의 `cms_members`, `cms_withdrawals`, `cms_agreements`, `payment_intents`, `charges`, `billing_methods`, `billing_agreements`가 가진다.
- 멤버십 계약, 플랜, 다음 결제일, 자동갱신 여부는 `apps/membership`이 가진다.
- 관리자 UI는 `apps/admin-web`의 기존 `Container + Header + FilterBox + DataTable + Dialog/Drawer` 패턴을 따른다.
- 메뉴는 `apps/admin-web/src/lib/utils/menu.ts`의 `membership` 그룹에 추가한다.

## CMS 문서와 맞춰야 하는 업무 흐름

### 1. 회원 등록: 결제수단 심사

효성 CMS 회원 등록 응답 상태는 `신청대기`, `신청중`, `신청실패`, `신청완료`다. 현재 wallet 내부 상태는 다음처럼 축약한다.

| 효성 CMS 상태 | Wallet 상태 | 관리자 표시 |
|---|---|---|
| 신청대기 | `PENDING` | 결제수단 심사 중 |
| 신청중 | `PENDING` | 결제수단 심사 중 |
| 신청실패 | `FAILED` | 결제수단 심사 실패 |
| 신청완료 | `REGISTERED` | 사용 가능 |
| 삭제됨 | `DELETED` | 삭제됨 |

운영 제약:

- 회원 등록은 즉시 완료가 아니다.
- 회원 등록/수정 마감은 영업일 12:00 기준으로 보아야 한다.
- 결과는 다음 영업일 확인 대상이다.
- `REGISTERED` 전의 CMS 결제수단은 정기 출금에 사용하면 안 된다.

### 2. 동의자료 등록

효성 CMS는 회원 등록 또는 결제정보 수정 회원의 자동이체 동의자료 제출 API를 별도로 제공한다. 현재 wallet은 `cms_agreements`로 동의자료 등록 상태를 추적한다.

관리자 화면에서는 1차 범위에서 동의자료 파일 자체를 다루지 않고, 상세 패널에 상태만 보여준다.

표시 원칙:

| 내부 값 | 관리자 표시 |
|---|---|
| 등록 | 동의자료 등록 완료 |
| 미등록 | 동의자료 미등록 |
| 실패 | 동의자료 등록 실패 |

`동의자료 미등록` 또는 `동의자료 등록 실패` 상태는 처리 필요 항목으로 분류한다. 다만 파일 재업로드 기능은 고객/스토어프론트 흐름과 개인정보 취급 범위가 얽히므로 2차 기능으로 둔다.

### 3. 출금 신청: 정기 출금

효성 CMS 출금 신청 응답 상태는 `출금대기`, `출금중`, `출금실패`, `출금성공`이다. 현재 wallet 내부 상태는 다음처럼 매핑한다.

| 효성 CMS 상태 | Wallet 상태 | 관리자 표시 |
|---|---|---|
| 출금대기 | `REQUESTED` | 출금 예약 |
| 출금중 | `PROCESSING` | 출금 처리 중 |
| 출금성공 | `SUCCEEDED` | 출금 성공 |
| 출금실패 | `FAILED` | 출금 실패 |
| 삭제됨 | `DELETED` | 출금 취소 |

운영 제약:

- 출금 신청에는 고유한 `transactionId`가 필요하다.
- 출금 신청 마감은 출금일 전 영업일 17:00다.
- 마감 이후 신청하면 다음 영업일 출금 가능일로 밀릴 수 있다.
- 출금 결과는 출금일 다음 영업일 확인 대상이다.
- 출금 수정/삭제는 마감 전까지만 안전하게 열어야 한다.
- 1차 관리자 UI에서는 출금 수정/삭제/재시도를 열지 않는다.

### 4. Wallet intent 상태

CMS는 즉시 성공 결제가 아니라 비동기 배치 출금이다. 따라서 wallet의 `payment_intents.status = PENDING_SETTLEMENT`는 운영자에게 `출금 결과 대기`로 표시한다.

| Wallet 상태 | 관리자 표시 | 의미 |
|---|---|---|
| `PENDING_SETTLEMENT` | 출금 결과 대기 | CMS 출금 신청 이후 결과 확인 전 |
| `AUTHORIZED` / `CAPTURED` | 결제 완료 | 출금 성공 후 wallet 정산 완료 |
| `FAILED` | 결제 실패 | 출금 실패 또는 시스템 실패 |
| `CREATED` / `PROCESSING` 장기 지속 | 확인 필요 | 재전달/stuck 가능성 |

`정산대기`라는 문구는 관리자에게 회계 정산으로 오해될 수 있으므로 이 화면에서는 쓰지 않는다.

## 메뉴와 화면 위치

메뉴:

```text
멤버십 관리
  멤버십 회원 관리
    회원 조회
    정기결제 관리
    결제 내역 조회
    해지 내역 조회
  멤버십 혜택 관리
    멤버십 플랜
```

권장 경로:

```text
/membership/recurring-billing
```

권장 파일 구조:

```text
apps/admin-web/src/app/(admin)/membership/recurring-billing/page.tsx
apps/admin-web/src/features/membership/recurring-billing/template/index.tsx
apps/admin-web/src/features/membership/recurring-billing/components/summary-cards/index.tsx
apps/admin-web/src/features/membership/recurring-billing/components/filter-box/index.tsx
apps/admin-web/src/features/membership/recurring-billing/components/table/index.tsx
apps/admin-web/src/features/membership/recurring-billing/components/detail-dialog/index.tsx
```

현재 admin-web에는 멤버십 상세에서 `Dialog` 패턴이 이미 쓰이고 있으므로 1차 구현은 `DetailDialog`가 가장 적합하다. 테이블 밀도가 높아지고 실시간 운영 화면으로 확장될 때 `Drawer`로 바꿀 수 있다.

## 화면 구조

### 기본 화면

기본 탭은 `처리 필요`다. 관리자가 이 화면에 들어오는 첫 이유는 전체 CMS 데이터 탐색이 아니라 오늘 확인할 문제를 찾는 것이기 때문이다.

상단 구성:

1. 페이지 제목: `정기결제 관리`
2. 설명: `자동이체 결제수단 심사, 월 정기 출금, 출금 결과 대기 상태를 확인합니다.`
3. 요약 카드
4. 탭
5. 필터
6. 테이블
7. 행 상세 다이얼로그

### 요약 카드

카드는 클릭 시 아래 테이블 필터를 즉시 변경한다.

| 카드 | 집계 기준 | 클릭 시 필터 |
|---|---|---|
| 처리 필요 | 심사 실패 + 출금 실패 + 오래된 처리중 + 오래된 결과 대기 | `needsAction=true` |
| 결제수단 심사 중 | `cms_members.status = PENDING` | `view=members&status=PENDING` |
| 심사 실패 | `cms_members.status = FAILED` | `view=members&status=FAILED` |
| 출금 예정 | `cms_withdrawals.status = REQUESTED` | `view=withdrawals&status=REQUESTED` |
| 출금 결과 대기 | `payment_intents.status = PENDING_SETTLEMENT` 또는 `cms_withdrawals.status = PROCESSING` | `view=withdrawals&status=PROCESSING` |
| 출금 실패 | `cms_withdrawals.status = FAILED` | `view=withdrawals&status=FAILED` |

## 탭 설계

### 1. 처리 필요

운영자가 매일 처음 보는 탭이다.

포함 조건:

- `cms_members.status = FAILED`
- `cms_agreements.status = 실패` 또는 `미등록`
- `cms_withdrawals.status = FAILED`
- `cms_withdrawals.status = PROCESSING`이고 최근 갱신 후 30분 이상 경과
- `payment_intents.status = PENDING_SETTLEMENT`이고 결과 확인 가능일 이후에도 미해결
- `billing_agreements.status = ACTIVE`인데 연결된 `billing_methods.status != ACTIVE`
- `billing_methods.provider_type = CMS_BATCH`인데 연결된 `cms_members.status != REGISTERED`
- membership 계약의 `nextBillingDate`가 지났는데 해당 주기의 결제 결과가 없음

컬럼:

| 컬럼 | 설명 |
|---|---|
| 상태 | `확인 필요`, `심사 실패`, `출금 실패`, `결과 대기 지연` |
| 처리 구분 | 결제수단 / 동의자료 / 출금 / 계약 |
| 고객 | 이름/이메일/로그인 ID 중 가능한 값, 보조로 userId |
| 멤버십 | 플랜명, 계약 상태 |
| 다음 결제일 | membership 계약 기준 |
| 출금일 | CMS withdrawal 기준, 없으면 `-` |
| 금액 | 요청 금액 |
| 실패 사유 | 사람이 읽는 메시지 우선, 코드 보조 |
| 최근 갱신 | `updatedAt` |
| 액션 | 상태 새로고침, 상세, 결제 상세, 회원 상세 |

### 2. 결제수단 심사

CMS 회원 등록과 결제수단 사용 가능 여부를 본다.

컬럼:

| 컬럼 | 설명 |
|---|---|
| 고객 | 고객명/이메일/userId |
| 상태 | 심사 중 / 사용 가능 / 심사 실패 / 삭제됨 |
| 은행 | `paymentCompany`를 은행명으로 변환 |
| 납부자 | 마스킹된 payerName |
| 신청일 | `createdAt` |
| 최근 확인일 | `updatedAt` |
| 실패 사유 | `resultMessage`, 보조로 `resultCode` |
| 연결 계약 | subscriberRef 또는 contractId |
| 액션 | 상태 새로고침, 고객 상세, 결제수단 상세 |

주의:

- 계좌번호와 생년월일/사업자번호는 관리자 테이블에 노출하지 않는다.
- 상세에서도 원문 전체를 노출하지 않고 마스킹된 값만 표시한다.

### 3. 정기 출금

실제 월 정기결제 출금 신청과 결과를 본다.

컬럼:

| 컬럼 | 설명 |
|---|---|
| 출금일 | `paymentDate` |
| 고객 | 고객명/이메일/userId |
| 계약 | contractId 또는 subscriberRef |
| 금액 | `amount`, 성공 시 `actualAmount` 보조 |
| 상태 | 출금 예약 / 출금 처리 중 / 출금 성공 / 출금 실패 / 출금 취소 |
| 실패 사유 | `resultMessage`, 보조로 `resultCode` |
| 결제 Intent | `paymentIntentId` 짧은 표시 |
| 최근 갱신 | `updatedAt` |
| 액션 | 결과 확인, 결제 상세, 회원 상세 |

주의:

- 1차 구현에서 `출금 수정`, `출금 취소`, `출금 재시도`는 제공하지 않는다.
- 재시도는 `transactionId` 고유성, 마감시간, 기존 intent/charge 중복 방지까지 설계한 뒤 2차로 연다.

### 4. 계약 상태

CS가 고객 문의에 답하기 위한 탭이다.

컬럼:

| 컬럼 | 설명 |
|---|---|
| 고객 | 고객명/이메일/userId |
| 플랜 | 현재 멤버십 플랜 |
| 계약 상태 | ACTIVE / SUSPENDED / REVOKED 등 |
| 자동갱신 | 켜짐 / 해지 예약 |
| 다음 결제일 | membership 기준 |
| 결제수단 | 자동이체(CMS), 상태 |
| 최근 결제 결과 | 성공 / 실패 / 결과 대기 |
| 최근 실패 사유 | 실패 코드/메시지 |
| 액션 | 회원 상세, 결제 내역, 결제수단 상세 |

## 상세 다이얼로그

행 클릭 시 상세 다이얼로그를 연다.

섹션:

1. 고객 정보
   - 이름, 이메일, userId
   - user-service/Medusa 혼용 가능성을 고려해 표시 가능한 값을 우선순위로 노출한다.
2. 멤버십 계약
   - contractId, 플랜, 상태, 시작일, 종료일, 다음 결제일, 자동갱신 여부
3. 결제수단
   - 표시명: `자동이체(CMS)`
   - CMS 상태, 은행명, cmsMemberId, 동의자료 상태
4. 출금 정보
   - transactionId, paymentDate, amount, actualAmount, fee, status
5. Wallet 결제 정보
   - paymentIntentId, chargeId, intent status, charge status, providerType
6. 실패 사유
   - 관리자 문구
   - 원본 code/message
7. 연결 링크
   - 멤버십 회원 상세
   - 멤버십 결제 내역
   - Wallet 결제 상세

기술 ID는 복사 버튼을 붙이되, 테이블 메인 컬럼에서 크게 보이지 않게 한다.

## 액션 설계

### 1차 액션

1차는 관측과 단건 조회 중심이다. 금전 상태를 바꾸는 액션은 열지 않는다.

| 액션 | 대상 | 동작 |
|---|---|---|
| 상태 새로고침 | CMS member | 효성 회원 단건 조회 후 `cms_members` 갱신 |
| 결과 확인 | CMS withdrawal | 효성 출금 단건 조회 후 `cms_withdrawals`, `charges`, `payment_intents` 갱신 |
| 고객 상세 | userId | 멤버십 회원 상세로 이동 또는 다이얼로그 열기 |
| 결제 상세 | paymentIntentId | wallet 결제 상세로 이동 |
| 실패 사유 복사 | failed row | 고객 안내/운영 공유용 메시지 복사 |

### 2차 액션

아래 액션은 문서상 제약과 금전 리스크가 있으므로 2차로 둔다.

| 액션 | 열기 전 필요한 조건 |
|---|---|
| 출금 재시도 | 새 transactionId 생성, 동일 billing cycle 중복 청구 방지, 기존 실패 intent와 membership 언블록 정책 정리 |
| 출금 수정 | 출금일 전 영업일 17:00 마감 검증 |
| 출금 취소 | 출금일 전 영업일 17:00 마감 검증, membership 상태 영향 정의 |
| 결제수단 재등록 요청 발송 | 고객 알림 채널, 개인정보 처리 동의, 기존 결제수단 상태 정책 |
| 관리자 메모 | 감사 로그, 작성자, 변경 이력 |
| 예외 환불 처리 | CMS는 PG 환불 개념이 아니므로 별도 입금/회계 프로세스 필요 |

## 필터 UX

기본 필터:

| 필터 | 옵션 |
|---|---|
| 탭 | 처리 필요 / 결제수단 심사 / 정기 출금 / 계약 상태 |
| 기간 기준 | 신청일 / 출금일 / 최근 갱신일 / 다음 결제일 |
| 빠른 기간 | 오늘 / 어제 / 최근 7일 / 최근 30일 |
| 상태 | 전체 / 처리 필요 / 심사 중 / 심사 실패 / 출금 예약 / 출금 처리 중 / 출금 성공 / 출금 실패 / 출금 결과 대기 |
| 검색 유형 | 고객 정보 / userId / contractId / cmsMemberId / transactionId / paymentIntentId |
| 결제방식 | 자동이체(CMS), 토스 빌링 |

초기값:

```text
tab=needs-action
dateType=updatedAt
range=last7days
page=1
pageSize=20
```

## 관리자 문구 사전

| 내부 값 | 관리자 표시 |
|---|---|
| `CMS_BATCH` | 자동이체(CMS) |
| `TOSS_BILLING` | 카드 자동결제 |
| `PENDING_SETTLEMENT` | 출금 결과 대기 |
| `cms_members.PENDING` | 결제수단 심사 중 |
| `cms_members.REGISTERED` | 사용 가능 |
| `cms_members.FAILED` | 결제수단 심사 실패 |
| `cms_withdrawals.REQUESTED` | 출금 예약 |
| `cms_withdrawals.PROCESSING` | 출금 처리 중 |
| `cms_withdrawals.SUCCEEDED` | 출금 성공 |
| `cms_withdrawals.FAILED` | 출금 실패 |
| `billing_agreements.ACTIVE` | 정기결제 사용 중 |
| `billing_agreements.SUSPENDED` | 정기결제 일시 중지 |
| `billing_agreements.REVOKED` | 정기결제 해지 |

## MSA 구조와 API 방향

원칙:

- admin-web은 효성 CMS를 직접 호출하지 않는다.
- admin-web은 내부 admin API만 호출한다.
- wallet은 CMS 원천 상태와 payment intent/charge 상태의 소유자다.
- membership은 계약, 플랜, nextBillingDate, autoRenewal의 소유자다.
- user-service/Medusa 고객 정보 혼용은 admin aggregation 단계에서 보강한다.

권장 API:

### Wallet admin API

```text
GET  /v1/admin/recurring-billing/overview
GET  /v1/admin/recurring-billing/items
GET  /v1/admin/recurring-billing/items/:type/:id
POST /v1/admin/recurring-billing/providers/cms/members/:id/poll
POST /v1/admin/recurring-billing/providers/cms/withdrawals/:id/poll
```

역할:

- `cms_members`, `cms_withdrawals`, `cms_agreements`, `payment_intents`, `charges`, `billing_methods`, `billing_agreements` 조합
- 효성 단건 조회 호출
- 상태 전이와 outbox 이벤트 발행
- 금전 상태 변경의 멱등성 보장

### Membership admin API

```text
GET /v1/admin/subscriptions/recurring-summary
GET /v1/admin/subscriptions/:contractId
GET /v1/admin/subscriptions/by-user/:userId
GET /v1/admin/billing-history
```

역할:

- 계약 상태
- 플랜/티어명
- nextBillingDate
- autoRenewal
- membership billing cycle 기준

### Admin-web aggregation

1차 구현에서는 admin-web이 wallet 목록을 먼저 받고, `userId`, `subscriberRef`, `intentId` 기준으로 membership API를 병합한다.

장기적으로는 backend-for-admin 형태의 aggregation API를 둘 수 있지만, 현재 MSA 경계를 깨면서 wallet이 membership DB를 직접 읽게 만들면 안 된다.

## 확장성 원칙

이 화면의 업무 도메인은 `CMS 관리`가 아니라 `멤버십 정기결제 관리`다. 효성 CMS는 현재 정기결제 provider 중 하나일 뿐이다. 따라서 화면, API, 프론트 feature 이름은 provider-neutral하게 잡고, provider별 세부 액션만 하위 경로와 detail payload로 분리한다.

장기 확장 대상:

- 국내 자동이체: 효성 CMS, 다른 CMS/펌뱅킹 사업자
- 국내 카드 빌링: Toss Billing, Nicepay Billing
- 해외 카드/구독 PG: Stripe, Adyen, PayPal/Braintree 등
- 국가별 현지 결제수단: SEPA Direct Debit, ACH, BECS, 지역별 wallet/mandate 방식

따라서 아래 이름은 피한다.

```text
/admin/cms
CmsAdminService
CmsAdminRow
CMS 운영 화면
```

아래 이름을 기본으로 사용한다.

```text
/admin/recurring-billing
RecurringBillingAdminService
RecurringBillingAdminRow
정기결제 관리
```

provider별로만 구체 이름을 둔다.

```text
providers/cms/members/:id/poll
providers/cms/withdrawals/:id/poll
providers/toss-billing/agreements/:id/sync
providers/stripe/subscriptions/:id/sync
```

## 백엔드 구현 상세

### Wallet 구현

Wallet은 정기결제 결제수단, payment intent, charge, provider 원천 상태의 소유자다. 따라서 정기결제 관리자 API는 `apps/wallet/src/admin` 아래에 둔다. 기존 `PaymentIntentAdminController`, `PaymentIntentAdminService`, `WalletAdminAuth` 패턴을 그대로 따른다.

추가 파일:

```text
apps/wallet/src/admin/recurring-billing-admin.controller.ts
apps/wallet/src/admin/recurring-billing-admin.service.ts
apps/wallet/src/admin/dto/admin-recurring-billing.dto.ts
```

`WalletModule` 변경:

```typescript
// imports
import { RecurringBillingAdminController } from './admin/recurring-billing-admin.controller';
import { RecurringBillingAdminService } from './admin/recurring-billing-admin.service';

// controllers
RecurringBillingAdminController,

// providers
RecurringBillingAdminService,
```

컨트롤러 경로:

```typescript
@ApiTags('Admin - Recurring Billing')
@WalletAdminAuth()
@Controller('v1/admin/recurring-billing')
export class RecurringBillingAdminController {}
```

권한:

- 반드시 `@WalletAdminAuth()`를 사용한다.
- 고객용 JWT/API key 경로와 분리한다.
- admin-web은 내부 wallet admin API만 호출하고 효성 API를 직접 호출하지 않는다.

#### Wallet DTO

`AdminRecurringBillingListQueryDto`:

```typescript
export class AdminRecurringBillingListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(['needs-action', 'members', 'withdrawals', 'contracts'])
  view?: 'needs-action' | 'members' | 'withdrawals' | 'contracts';

  @IsOptional()
  @IsEnum(['CMS_BATCH', 'TOSS_BILLING', 'NICEPAY_BILLING', 'STRIPE_BILLING'])
  providerType?: 'CMS_BATCH' | 'TOSS_BILLING' | 'NICEPAY_BILLING' | 'STRIPE_BILLING';

  @IsOptional()
  @IsEnum(['updatedAt', 'createdAt', 'paymentDate'])
  dateType?: 'updatedAt' | 'createdAt' | 'paymentDate';

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsEnum(['PENDING', 'REGISTERED', 'FAILED', 'DELETED'])
  cmsMemberStatus?: 'PENDING' | 'REGISTERED' | 'FAILED' | 'DELETED';

  @IsOptional()
  @IsEnum(['REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DELETED'])
  withdrawalStatus?: 'REQUESTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'DELETED';

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  cmsMemberId?: string;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  paymentIntentId?: string;
}
```

`AdminRecurringBillingRowDto`는 화면의 공통 row 형태로 내려준다. membership 조인이 필요한 값은 nullable로 둔다.

```typescript
export class AdminRecurringBillingRowDto {
  issueType:
    | 'PROVIDER_METHOD'
    | 'PROVIDER_MANDATE'
    | 'PROVIDER_CHARGE'
    | 'PAYMENT_INTENT'
    | 'CONTRACT';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  needsAction: boolean;
  userId: string;
  providerType: 'CMS_BATCH' | 'TOSS_BILLING' | 'NICEPAY_BILLING' | 'STRIPE_BILLING';
  billingMethodId?: string;
  billingAgreementId?: string;
  subscriberRef?: string;
  subscriberType?: string;

  /**
   * Provider-specific state. UI must render a normalized label first and expose raw fields in detail only.
   */
  providerState?: {
    cmsMemberId?: string;
    cmsMemberStatus?: 'PENDING' | 'REGISTERED' | 'FAILED' | 'DELETED';
    agreementStatus?: string | null;
    withdrawalId?: string;
    transactionId?: string;
    withdrawalStatus?: 'REQUESTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'DELETED';
    paymentDate?: string;
    resultCode?: string | null;
    resultMessage?: string | null;
    rawStatus?: string | null;
  };

  amount?: number;
  actualAmount?: number | null;
  paymentIntentId?: string;
  paymentIntentStatus?: string;
  chargeId?: string;
  chargeStatus?: string;
  createdAt: string;
  updatedAt: string;
}
```

`AdminRecurringBillingOverviewDto`:

```typescript
export class AdminRecurringBillingOverviewDto {
  needsAction: number;
  memberPending: number;
  memberFailed: number;
  withdrawalRequested: number;
  settlementPending: number;
  withdrawalFailed: number;
}
```

#### Wallet API 메서드

```text
GET  /v1/admin/recurring-billing/overview
GET  /v1/admin/recurring-billing/items
GET  /v1/admin/recurring-billing/items/:type/:id
POST /v1/admin/recurring-billing/providers/cms/members/:id/poll
POST /v1/admin/recurring-billing/providers/cms/withdrawals/:id/poll
```

`GET /items` 하나로 탭별 목록을 제공하고, `view` 파라미터로 `needs-action`, `members`, `withdrawals`, `contracts`를 나눈다. 이 방식이 admin-web 테이블 훅과 pagination 구조에 가장 잘 맞는다.

#### Wallet Service 쿼리 원칙

`RecurringBillingAdminService`는 공통 정기결제 테이블과 provider별 원천 테이블을 조합한다.

공통 테이블:

- `billing_methods`
- `billing_agreements`
- `payment_intents`
- `charges`

CMS provider 테이블:

- `cms_members`
- `cms_withdrawals`
- `cms_agreements`

기본 join 방향:

```text
cms_members
  -> billing_methods       by billing_method_id
  -> billing_agreements    by billing_method_id

cms_withdrawals
  -> payment_intents       by intent_id
  -> charges               by charge_id
  -> cms_members           by cms_member_id
  -> billing_methods       by cms_member.billing_method_id
  -> billing_agreements    by billing_method_id
```

`subscriberRef`는 membership의 `contractId`로 쓰고 있으므로 row에 반드시 포함한다. admin-web은 이 값을 membership API 조회 키로 사용한다.

주의:

- `cms_agreements`는 `cmsMemberId` 기준으로 0..N일 수 있으므로 목록 row에서는 `등록` 상태가 하나라도 있으면 `agreementStatus = '등록'`으로 계산한다.
- 계좌번호 원문은 wallet DB에 저장하지 않으며, `payerNumber`는 관리자 API 응답에 내리지 않는다.
- `paymentCompany`는 코드로 내려주고, admin-web에서 은행명 매핑을 적용한다. 서버에서 은행명까지 내려줘도 되지만 원천값은 반드시 유지한다.

#### 처리 필요 판정 구현

`RecurringBillingAdminService`에 provider별 classifier를 pure function으로 분리한다.

```typescript
function classifyRecurringBillingRow(row: RecurringBillingRawRow, now = new Date()): {
  issueType: AdminRecurringBillingIssueType;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  needsAction: boolean;
  displayStatus: string;
} {
  if (row.providerType === 'CMS_BATCH') {
    return classifyCmsRow(row, now);
  }

  if (row.providerType === 'TOSS_BILLING') {
    return classifyBillingKeyRow(row, now);
  }

  return classifyUnknownProviderRow(row, now);
}

function classifyCmsRow(row: RecurringBillingRawRow, now = new Date()) {
  if (row.cmsMemberStatus === 'FAILED') {
    return { issueType: 'PROVIDER_METHOD', severity: 'CRITICAL', needsAction: true, displayStatus: '결제수단 심사 실패' };
  }

  if (row.agreementStatus !== '등록') {
    return { issueType: 'PROVIDER_MANDATE', severity: 'WARNING', needsAction: true, displayStatus: '동의자료 확인 필요' };
  }

  if (row.withdrawalStatus === 'FAILED') {
    return { issueType: 'PROVIDER_CHARGE', severity: 'CRITICAL', needsAction: true, displayStatus: '출금 실패' };
  }

  if (row.paymentIntentStatus === 'PENDING_SETTLEMENT' && isPastResultCheckDate(row.paymentDate, now)) {
    return { issueType: 'PAYMENT_INTENT', severity: 'WARNING', needsAction: true, displayStatus: '출금 결과 확인 지연' };
  }

  return { issueType: 'CONTRACT', severity: 'INFO', needsAction: false, displayStatus: '정상' };
}
```

이 함수는 단위 테스트 대상이다. 운영 UI의 핵심 로직이므로 컨트롤러나 React 컴포넌트에 흩어두면 안 된다.

#### 단건 poll 구현

현재 `CmsMemberPollerService`와 `CmsSettlementPollerService`는 cron 중심이다. 관리자 단건 액션이 같은 상태 전이 로직을 써야 중복/불일치가 없다.

권장 변경:

```text
CmsMemberPollerService
  pollPendingMembers()
  pollMemberById(cmsMemberRowId: string)
  pollMember(cmsMember: CmsMember) // 내부 공통

CmsSettlementPollerService
  pollPendingSettlements()
  pollWithdrawalById(withdrawalId: string)
  processWithdrawal(withdrawal: CmsWithdrawal) // 내부 공통
```

현재 `CmsSettlementPollerService.processWithdrawal()`가 private이면, 이름을 `processWithdrawal` 그대로 두되 `pollWithdrawalById()`만 public으로 추가한다. admin service가 효성 조회/상태 전이를 다시 구현하면 안 된다.

`POST /v1/admin/recurring-billing/providers/cms/withdrawals/:id/poll` 흐름:

1. withdrawal row 조회
2. 없으면 404
3. `SUCCEEDED`, `FAILED`, `DELETED`면 현재 상태 그대로 반환
4. `REQUESTED`, `PROCESSING`이면 `CmsSettlementPollerService.pollWithdrawalById(id)` 호출
5. 갱신된 detail 반환

`POST /v1/admin/recurring-billing/providers/cms/members/:id/poll` 흐름:

1. cms member row 조회
2. 없으면 404
3. `REGISTERED`, `FAILED`, `DELETED`이면 현재 상태 그대로 반환
4. `PENDING`이면 `CmsMemberPollerService.pollMemberById(id)` 호출
5. 갱신된 detail 반환

단건 poll은 금전 상태를 새로 만들면 안 된다. 이미 존재하는 효성 member/withdrawal의 상태를 확인하고 내부 상태만 전이한다.

#### 상태 전이와 트랜잭션

출금 성공/실패 처리는 반드시 한 흐름에서 정합성을 맞춘다.

성공:

```text
cms_withdrawals -> SUCCEEDED
charges -> SUCCEEDED
payment_intents: PENDING_SETTLEMENT -> AUTHORIZED
outbox: payment.intent.authorized
autoCaptureService.attemptAutoCapture()
```

실패:

```text
cms_withdrawals -> FAILED
charges -> FAILED
payment_intents: PENDING_SETTLEMENT -> FAILED
outbox: payment.intent.failed
membership BillingResultConsumer가 계약 unblock/실패 처리
```

주의:

- `payment_intents` 전이는 `StateTransitionService.transitionIntent()`를 사용한다.
- outbox `aggregateId`는 `paymentIntentId`로 통일한다.
- `subscriberRef`, `subscriberType`, `purpose`는 intent metadata에서 꺼내 outbox payload에 포함한다.
- 동일 poll 재시도에서 이미 terminal 상태면 조용히 현재 상태를 반환한다.

#### Wallet 테스트

필수 테스트:

```text
recurring-billing-admin.service.spec.ts
- overview 집계
- members 목록 status filter
- withdrawals 목록 status/date filter
- needs-action 분류
- agreement 미등록 row warning 처리
- PENDING_SETTLEMENT 결과 확인 가능일 경과 warning 처리
- terminal withdrawal poll idempotent skip
- REQUESTED withdrawal poll 성공 경로
- REQUESTED withdrawal poll 실패 경로

cms-settlement-poller.service.spec.ts
- pollWithdrawalById가 cron processWithdrawal과 같은 로직을 사용
- 성공 시 withdrawal/charge/intent/outbox 전이
- 실패 시 withdrawal/charge/intent/outbox 전이
- terminal 상태 재호출 시 중복 전이 없음
```

### Membership 구현

Membership은 계약과 플랜 정보의 소유자다. wallet admin API가 membership DB를 직접 읽지 않는다.

기존 파일:

```text
apps/membership/src/controllers/admin-operations.controller.ts
apps/membership/src/services/admin-operations.service.ts
apps/membership/src/services/admin/admin-members.reader.ts
```

추가 또는 확장 API:

```text
GET /admin/recurring-contracts
GET /admin/recurring-contracts/summary
GET /admin/recurring-contracts/by-ids?contractId=a&contractId=b
```

1차 구현에서는 기존 `/admin/members`, `/admin/members/:userId`, `/admin/billing-history`를 조합해도 되지만, 정기결제 관리 화면의 성능을 생각하면 `by-ids` bulk API가 필요하다.

`AdminRecurringContractQuery`:

```typescript
export interface AdminRecurringContractQuery {
  page?: number;
  limit?: number;
  userId?: string;
  contractId?: string;
  contractIds?: string[];
  status?: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED';
  autoRenewal?: boolean;
  nextBillingDateFrom?: string;
  nextBillingDateTo?: string;
}
```

응답:

```typescript
export interface AdminRecurringContractSummary {
  contractId: string;
  userId: string;
  status: string;
  planId: string;
  tierCode: string;
  planDurationDays: number;
  autoRenewal: boolean;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  lastPaymentIntentId: string | null;
}
```

쿼리는 `AdminMembersReader`에 추가하는 것이 현재 구조와 맞다. 이 reader는 이미 subscription contract, plan, tier 조합 조회를 담당하고 있다.

주의:

- membership은 CMS 상태를 저장하지 않는다.
- membership은 wallet의 `cmsMemberId`, `transactionId`를 모른다.
- membership은 `lastPaymentIntentId`, `contractId`, `userId`, `nextBillingDate`, `autoRenewal`만 제공한다.
- 출금 재시도 같은 금전 액션은 1차 구현에서 열지 않는다. 기존 `retryBilling`은 운영 화면에 바로 노출하지 않는다.

### Admin-web 구현

추가 파일:

```text
apps/admin-web/src/app/(admin)/membership/recurring-billing/page.tsx
apps/admin-web/src/features/membership/recurring-billing/template/index.tsx
apps/admin-web/src/features/membership/recurring-billing/components/summary-cards/index.tsx
apps/admin-web/src/features/membership/recurring-billing/components/filter-box/index.tsx
apps/admin-web/src/features/membership/recurring-billing/components/table/index.tsx
apps/admin-web/src/features/membership/recurring-billing/components/detail-dialog/index.tsx
apps/admin-web/src/hooks/table/query/use-recurring-billing-table-query.tsx
apps/admin-web/src/hooks/table/columns/use-recurring-billing-table-columns.tsx
apps/admin-web/src/hooks/table/filters/use-recurring-billing-table-filters.ts
```

API client 확장:

```text
apps/admin-web/src/lib/api/domains/wallet/index.ts
apps/admin-web/src/lib/api/domains/membership/index.ts
apps/admin-web/src/lib/services/membership/query-keys.ts
apps/admin-web/src/lib/services/membership/queries.ts
```

`walletApi` 추가:

```typescript
getRecurringBillingOverview(): Promise<AdminRecurringBillingOverview>
listRecurringBillingItems(query: AdminRecurringBillingListQuery): Promise<PaginatedResponse<AdminRecurringBillingRow>>
getRecurringBillingItem(type: string, id: string): Promise<AdminRecurringBillingDetail>
pollCmsMember(id: string): Promise<AdminRecurringBillingDetail>
pollCmsWithdrawal(id: string): Promise<AdminRecurringBillingDetail>
```

`membershipApi` 추가:

```typescript
getRecurringContractsByIds(contractIds: string[]): Promise<AdminRecurringContractSummary[]>
```

React Query key:

```typescript
recurringBilling: () => [...membershipQueryKeys.all, 'recurringBilling'] as const,
recurringBillingList: (query) => [...membershipQueryKeys.recurringBilling(), query] as const,
recurringBillingOverview: () => [...membershipQueryKeys.recurringBilling(), 'overview'] as const,
```

데이터 병합:

1. `walletApi.listCmsItems(query)`로 CMS/payment row를 가져온다.
2. row의 `subscriberRef` 중 `subscriberType === 'MEMBERSHIP'`인 값을 contractIds로 모은다.
3. `membershipApi.getRecurringContractsByIds(contractIds)`로 계약 요약을 가져온다.
4. admin-web에서 contractId map으로 병합한다.
5. user-service/Medusa 고객명은 기존 `useMemberUserSearch` 또는 user name hook 패턴을 재사용한다.

중요:

- 병합 실패해도 CMS row는 보여준다. 계약 정보가 없으면 `계약 정보 없음` 배지를 표시한다.
- wallet row가 source of truth인 상태와 membership 계약 상태를 섞어 하나의 상태처럼 저장하지 않는다.
- 화면에서 action 이후에는 wallet CMS query와 membership query를 모두 invalidate한다.

## 코드상 주의할 점

### 멱등성

관리자 `poll` 액션은 조회성 상태 동기화이지만 외부 API 호출과 내부 상태 전이를 수행한다. 같은 버튼을 여러 번 눌러도 중복 이벤트가 생기면 안 된다.

원칙:

- terminal 상태는 재처리하지 않는다.
- `StateTransitionService`의 fromStatus 인자를 사용해 `PENDING_SETTLEMENT -> AUTHORIZED/FAILED`만 허용한다.
- outbox event는 intentId aggregate 기준으로 중복 여부를 확인하거나 상태 전이가 한 번만 일어나도록 보장한다.
- admin-web mutation에는 `Idempotency-Key`를 붙인다.

### 개인정보

관리자 화면에서 노출하지 않는 값:

- CMS 계좌번호
- 납부자 주민번호/사업자번호 원문
- 효성 API 원본 payload 전체

노출 가능한 값:

- 은행 코드와 은행명
- 마스킹된 납부자명
- cmsMemberId
- transactionId
- resultCode/resultMessage

### 장애 대응

효성 API 5xx 또는 timeout:

- 관리자 단건 poll은 502/503 계열로 응답하거나 `CMS_QUERY_FAILED`로 400 처리하지 않는다.
- 내부 상태는 바꾸지 않는다.
- 화면에는 `외부 조회 실패. 잠시 후 다시 확인`으로 표시한다.

효성 API business failure:

- 회원 등록 실패 또는 출금 실패로 확정 가능한 응답이면 내부 상태를 `FAILED`로 전이한다.
- 실패 사유는 `resultCode`, `resultMessage` 모두 저장한다.

### 날짜와 영업일

출금 가능일/결과 확인일은 효성 문서의 영업일 기준이다. 현재 단순 D+1/D+2 계산으로 시작할 수 있지만, wallet의 `cms-date.util.ts`에 영업일 유틸을 모아야 한다.

권장 유틸:

```typescript
nextCmsPaymentDate(now?: Date): string
isCmsCutoffPassed(now?: Date): boolean
isCmsResultCheckable(paymentDate: string, now?: Date): boolean
```

관리자 UI의 `오래된 결과 대기` 판정도 이 유틸과 같은 기준을 써야 한다.

### Nicepay

Nicepay 관련 코드는 향후 사용 가능성을 위해 보존하되, 이 화면의 1차 범위에는 포함하지 않는다.

- 일반 1회 결제: Toss Payments 결제창
- 정기결제: CMS 자동이체
- Nicepay: 관리자 정기결제 뷰의 필터/액션에 노출하지 않음

## 데이터 모델 요구사항

관리자 row에는 최소 다음 필드가 필요하다.

```typescript
type RecurringBillingAdminRow = {
  issueType: 'PROVIDER_METHOD' | 'PROVIDER_MANDATE' | 'PROVIDER_CHARGE' | 'PAYMENT_INTENT' | 'CONTRACT';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  needsAction: boolean;
  userId: string;
  customerLabel?: string;
  contractId?: string;
  planName?: string;
  autoRenewal?: boolean;
  nextBillingDate?: string;
  providerType: 'CMS_BATCH' | 'TOSS_BILLING' | 'NICEPAY_BILLING' | 'STRIPE_BILLING';
  providerState?: Record<string, unknown>  amount?: number;
  actualAmount?: number;
  paymentIntentId?: string;
  paymentIntentStatus?: string;
  resultCode?: string;
  resultMessage?: string;
  updatedAt: string;
};
```

## 처리 필요 판정 규칙

```text
CRITICAL
- CMS 회원 심사 실패
- CMS 출금 실패
- active contract인데 active billing method가 없음
- nextBillingDate가 지났고 해당 billing cycle 결제 결과가 없음

WARNING
- CMS 출금 처리 중 상태가 30분 이상 유지
- PENDING_SETTLEMENT가 결과 확인 가능일 이후에도 유지
- CMS 동의자료 미등록/실패

INFO
- CMS 회원 심사 중
- CMS 출금 예약
- 출금 결과 대기 기간 내 PENDING_SETTLEMENT
```

결과 확인 가능일은 효성 문서 기준으로 출금일 다음 영업일이다. 1차 구현에서 영업일 계산이 없다면 보수적으로 `paymentDate + 2 calendar days` 이후를 warning으로 잡고, 이후 영업일 유틸을 wallet의 CMS date util과 맞춘다.

## 구현 단계

### Phase 1: 조회 중심 운영 화면

- 메뉴 추가: `멤버십 관리 > 정기결제 관리`
- wallet admin CMS 조회 API 추가
- admin-web 목록/요약 카드/필터/상세 다이얼로그 구현
- 단건 `상태 새로고침`, `결과 확인` 액션 구현
- 멤버십 회원 상세, wallet 결제 상세 링크 연결

Phase 1에서 하지 않는 것:

- 출금 재시도
- 출금 수정/취소
- 결제수단 강제 변경
- 환불/입금 처리
- 고객 알림 발송

### Phase 2: 운영 조치 확장

- 재등록 안내 발송
- 관리자 메모와 감사 로그
- 출금 재시도
- 출금 수정/취소
- 엑셀 다운로드
- 실패 코드별 고객 안내 템플릿

### Phase 3: 자동 운영 보조

- 실패 코드별 자동 라벨링
- 반복 실패 고객 알림
- 처리 SLA 대시보드
- 월별 CMS 성공/실패 리포트

## 테스트 기준

백엔드:

- `cms_members.PENDING/REGISTERED/FAILED/DELETED`가 관리자 문구로 정확히 매핑된다.
- `cms_withdrawals.REQUESTED/PROCESSING/SUCCEEDED/FAILED/DELETED`가 관리자 문구로 정확히 매핑된다.
- `PENDING_SETTLEMENT`는 `출금 결과 대기`로 반환된다.
- `POST /members/:id/poll`은 회원 상태만 갱신하고 금전 상태를 바꾸지 않는다.
- `POST /withdrawals/:id/poll`은 효성 결과에 따라 withdrawal, charge, payment intent를 하나의 일관된 전이로 갱신한다.
- 같은 poll 요청이 반복되어도 중복 이벤트나 중복 상태 변경이 발생하지 않는다.

프론트엔드:

- 기본 진입 시 `처리 필요` 탭이 보인다.
- 요약 카드를 누르면 해당 테이블 필터가 적용된다.
- 기술 ID는 상세에서 복사 가능하지만 테이블의 주 정보가 되지 않는다.
- 실패 사유는 코드보다 사람이 읽는 메시지가 먼저 보인다.
- 모바일/좁은 화면에서 테이블 액션과 상태 배지가 겹치지 않는다.

운영 검증:

- 효성 회원 등록 직후 `결제수단 심사 중`으로 보인다.
- 효성 회원 등록 실패 시 `처리 필요`와 `결제수단 심사` 탭에 잡힌다.
- CMS 출금 신청 직후 `출금 예약` 또는 `출금 결과 대기`로 보인다.
- 출금 실패 결과 조회 후 `출금 실패`와 `처리 필요`에 잡힌다.
- 출금 성공 결과 조회 후 membership 계약의 다음 결제일과 결제 내역 연결이 확인된다.

## 결론

관리자 메뉴명은 `정기결제 관리`가 맞다. CMS는 화면의 주제가 아니라 자동이체 정기결제를 처리하는 외부망이다. 따라서 관리자 UI는 `결제수단 심사`, `정기 출금`, `출금 결과 대기`, `확인 필요` 중심으로 설계해야 한다.

이 구조는 효성 CMS 문서의 회원등록/동의자료/출금신청/출금조회 흐름과 일치하고, 현재 코드의 MSA 경계에도 맞다. wallet은 CMS와 결제 상태를 소유하고, membership은 계약 상태를 소유하며, admin-web은 두 서비스를 운영 화면으로 조합한다.
