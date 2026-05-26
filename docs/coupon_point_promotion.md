# 쿠폰 · 적립금 · 프로모션 설계 문서

---

## 1. 전체 서비스 구조와 SoT

### 서비스 역할

| 서비스 | 역할 |
|--------|------|
| `core` | PIM(상품) + WMS(재고) 통합 백엔드 |
| `user-service` | 인증, 회원 계정 |
| `wallet` | 결제 인텐트, BNPL, 환불, 포인트 |
| `medusa` | 판매채널 — 장바구니, 체크아웃, 쿠폰/프로모션 |
| `channel-adapter` | 나이버, 쿠팡 등 외부 마켓플레이스 연동 |
| `membership` | 구독/멤버십 |
| `ugc-service` | 리뷰 |
| `search` | Elasticsearch 상품 검색 인덱스 |
| `file-service` | 파일 업로드 / S3 |
| `notification` | 푸시, 이메일, SMS |
| `orchestrator` | 크로스 서비스 사가 오케스트레이션 |
| `admin-web` | Next.js 어드민 대시보드 (모든 서비스 API 호출) |

### 도메인별 SoT

| 데이터 | SoT | 비고 |
|--------|-----|------|
| 회원 UUID / 인증 토큰 | `user-service` | |
| 메두사 customer 레코드 | `medusa` | user-service UUID와 별개의 내부 ID |
| 상품 (variant, 카테고리, 컬렉션) | `core` (PIM) | |
| 재고 (SKU, 수량, 이벤트) | `core` (WMS) | event sourcing |
| 배송지 | `core` | 나이버/쿠팡 등 멀티채널 공유 데이터 |
| 쿠폰 / 프로모션 / 캠페인 | `medusa` | 체크아웃과 직결, 메두사가 소유해야 함 |
| 장바구니 / 체크아웃 / 주문 | `medusa` | |
| 결제 인텐트 / BNPL | `wallet` | |
| 포인트 잔액 / 이력 | `wallet` | |
| 멤버십 | `membership` | |
| 리뷰 | `ugc-service` | |
| 판매주문 (나이버/쿠팡) | `channel-adapter` | 각 마켓플레이스 자체 쿠폰도 각 채널 소유 |
| 재고주문 | `core` (WMS) | 판매주문 변환 후 WMS가 이행 |

### 통신 방향 원칙

```
admin-web ──────────────────────────────────────────────────┐
          │ API 호출 가능                                     │
          ▼                                                  │
 ┌─────────────────┐     ┌─────────────┐     ┌──────────┐  │
 │     medusa      │────▶│    core     │     │  wallet  │  │
 │  (판매채널)      │     │ PIM + WMS   │     │  포인트  │  │
 └─────────────────┘     └─────────────┘     └──────────┘  │
          │                     ▲                           │
          │ 동기 요청 가능       │                           │
          │ (재고 확인 등)       │ Kafka 이벤트              │
          │                     │                           │
 ┌─────────────────┐     ┌─────────────┐                   │
 │ channel-adapter │────▶│ orchestrator│                   │
 │ 나이버/쿠팡     │     │  사가 조율  │                   │
 └─────────────────┘     └─────────────┘                   │
                                                            │
 admin-web ◀────────────────────────────────────────────────┘
```

**규칙:**
- `medusa` → `core` 동기 요청 가능 (메두사가 판매채널이므로 코어에 의존 가능)
- `core` → `medusa` 불가 (역방향 의존 금지)
- 비동기 연동은 Kafka 이벤트 사용
- `admin-web`은 모든 서비스 API를 직접 호출

### 쿠폰이 메두사에 있는 이유

배송지(멀티채널 공유 → 코어 소유)와 달리, 쿠폰은 메두사 장바구니에 적용되는 데이터.

- 코어에 두면: 체크아웃 시 메두사가 코어로 할인 검증을 외부 요청해야 함 + 메두사 네이티브 프로모션 엔진(rule, condition, campaign) 버려야 함
- 나이버/쿠팡 쿠폰은 각 채널이 자체 관리하는 별개 도메인 — 통합할 이유 없음
- 메두사 스토어프론트 쿠폰만 `medusa`가 SoT로 소유하면 됨

---

## 2. 쿠폰 / 캠페인

**위치:** 자사몰 관리 > 마케팅 > 쿠폰/캠페인 (`/mall/marketing/coupons`)
**백엔드:** Medusa V2 Promotions + Campaigns API
**구조:** 단일 페이지, 쿠폰 탭 + 캠페인 탭으로 분리

### 구현 완료

| 기능 | 설명 |
|------|------|
| 쿠폰 목록 | 코드 검색, 상태 필터, 페이지네이션 |
| 쿠폰 생성 | 아래 폼 항목 참고 |
| 쿠폰 상세 보기 | 다이얼로그 |
| 상태 변경 | active ↔ inactive 전환 |
| 쿠폰 삭제 | 확인 다이얼로그 |
| 고객 발급 | 이메일 → 메두사 customer 조회 → promotion 연결 |
| 발급 현황 | 쿠폰에 연결된 고객 목록, 고객별 사용 횟수(주문 최대 100,000건 기준 집계), 1인 한도 도달 여부 |
| 캠페인 목록 | 이름/기간/예산/진행률 |
| 캠페인 생성 | 이름, 기간, 예산(횟수/금액) 설정 |
| 캠페인 상세 | 연결된 쿠폰 목록, 쿠폰 연결/해제 |

#### 쿠폰 생성 폼

| 항목 | 상태 |
|------|------|
| 쿠폰 코드 | ✅ |
| 할인 유형 — 정률(%) / 정액(원) | ✅ |
| 최대 할인 금액 (정률 시) | ❌ UI 미지원 (Medusa 기본 엔진 미지원 — 커스텀 워크플로우 필요) |
| 적용 대상 — 전체 주문 / 특정 상품 / 배송비 | ✅ |
| 특정 상품 선택 (상품/카테고리/컬렉션) | ✅ (브랜드 미지원) |
| 최소 주문금액 조건 | ✅ |
| 유효 기간 | ✅ |
| 총 사용 횟수 제한 (campaign budget: usage) | ✅ |
| 총 할인금액 한도 (campaign budget: spend) | ✅ |
| 1인당 사용 횟수 제한 (campaign budget: use_by_attribute) | ✅ |
| 발급 방식 — 공개 / 발급받기 / 발급 고객 전용 (`visibility` metadata) | ✅ |

#### 발급 방식 (visibility) 모델

`customer-promotion link` = 쿠폰이 특정 고객에게 발급된 기록. 발급 주체와 무관하게 "이 고객은 이 쿠폰을 사용할 수 있다"는 단일 권한 레코드로 관리.

| visibility | 마이페이지 노출 | 체크아웃 적용 조건 | 발급 주체 |
|------------|--------------|-----------------|---------|
| `public` | 공개 쿠폰 섹션 | link 없이 사용 가능 | 없음 (코드만 있으면 사용) |
| `claimable` | 발급받기 섹션 → 발급 후 발급받은 쿠폰 섹션 | customer-promotion link 필수 | 고객 셀프 발급 (`POST /store/customers/me/promotions/:id/claim`) |
| `assigned_only` | 발급받은 쿠폰 섹션 | customer-promotion link 필수 | 관리자 수동 발급 / 시스템 자동 발급 |

**checkout 검증 (2단계):**
1. `POST /store/carts/:id/promotions` — 발급 고객 전용 쿠폰(`claimable`, `assigned_only`)은 `per-customer-limit.ts` 미들웨어에서 선제 차단
2. `completeCartWorkflow.hooks.validate` — 주문 완료 직전 발급 링크 재검증 (cart.id로 promotions 명시 재조회)

claimable / assigned_only 모두 customer-promotion link 없으면 `COUPON_NOT_ASSIGNED` 오류 반환.

> **정리:** 발급 여부 검증은 우리 도메인 규칙이므로 유지한다. "1인당 몇 회 사용 가능"은 Medusa V2.13.4의 campaign attribute budget(`customer_id` 기준 `use_by_attribute` 타입)으로 처리한다. 쿠폰 생성 시 `maxUsesPerCustomer` 입력 시 campaign budget에 `type: 'use_by_attribute', attribute: 'customer_id', limit: N`으로 저장되며, Medusa 엔진이 체크아웃 시 자동으로 검증한다.

#### 캠페인과 쿠폰의 관계

Medusa Campaign은 여러 쿠폰을 하나의 행사로 묶는 단위:

```
Campaign "봄 할인 행사 2025"
├── 기간: 3월 1일 ~ 3월 31일
├── 예산: 사용 횟수 1,000회 (전체 합산)
├── Promotion "SPRING10"    → 10% 할인
├── Promotion "SPRING20"    → 20% 할인 (특정 상품)
└── Promotion "SPRINGSHIP"  → 배송비 무료
```

쿠폰 생성 시 기간/횟수를 설정하면 `CAMP_{코드}` 형태의 캠페인이 자동 생성됨.
이 자동 생성 캠페인도 캠페인 탭에서 관리 가능.

#### 1인당 사용 제한 방향

Medusa V2.11+는 campaign budget에서 attribute-based usage limit을 지원한다. `customer_id` 또는 `customer_email` 기준으로 budget usage를 기록하므로, 일반적인 "고객 1인당 N회 사용 가능" 정책은 Medusa 기본 campaign budget으로 처리하는 것이 맞다.

운영 기준:
- 쿠폰 1개당 1인 제한이 필요하면 쿠폰 생성 시 `CAMP_{코드}` 캠페인을 1:1로 만들고, 해당 캠페인에 `use_by_attribute` budget(`attribute: 'customer_id'`)을 둔다.
- 여러 쿠폰을 하나의 캠페인에 묶으면 1인 제한은 "캠페인 안의 모든 쿠폰 합산" 기준이 된다.
- 발급 여부(`public` / `claimable` / `assigned_only`)는 campaign budget이 해결하지 않는다. 이 검증은 `customer-promotion link` 기준으로 계속 직접 처리한다.
- ~~`promotion_meta.max_uses_per_customer`와 주문 수 조회 커스텀 검증은 제거됨~~ — Medusa campaign `use_by_attribute` budget이 대체.
- 기존에 `promotion_meta.max_uses_per_customer`가 설정된 구 쿠폰은 수동으로 캠페인 budget을 업데이트하거나 재생성 필요 (이관 스크립트 별도 작성 가능).
- 주의: `use_by_attribute` budget에서 customer_id가 null이면 Medusa가 에러를 던진다. 비로그인 게스트 장바구니에서는 1인당 제한이 있는 쿠폰 적용 불가.
- `promotion_meta.max_uses_per_customer` 컬럼은 `Migration20260527120000`으로 제거됨.

### 미구현 항목

| 항목 | 설명 |
|------|------|
| ~~1인당 사용 횟수 제한 Medusa 이관~~ | ✅ **구현 완료** — campaign budget `use_by_attribute` (attribute: 'customer_id'). 커스텀 per-customer-limit 검증 제거. `promotion_meta.max_uses_per_customer` 컬럼 drop은 Phase 2 |
| ~~발급 고객 전용 쿠폰 강제 적용~~ | ✅ **구현 완료** — `assigned_only`: 스토어 공개 목록 제외 + 비발급 고객 장바구니 적용/주문 완료 차단 |
| ~~고객 셀프 발급 (`claimable`)~~ | ✅ **구현 완료** — `POST /store/customers/me/promotions/:id/claim` 엔드포인트. 마이페이지 "발급받기 가능한 쿠폰" 섹션에서 버튼 클릭 시 customer-promotion link 생성 |
| ~~발급 수량 제한~~ | ✅ **구현 완료** — `promotion_meta.max_claims` 필드. claimable 쿠폰 생성 시 Admin에서 입력, claim endpoint에서 현재 link 수와 비교해 차단. 단순 count 방식으로 동시 다발 요청에서 소량 초과 가능 (고트래픽 선착순 쿠폰이면 atomic counter 필요) |
| 발급 조건 (고객 그룹) | ✅ **구현 완료** — 그룹 동기화: `channel-adapter` MembershipMedusaSyncService가 `MembershipStatusChanged` 처리 (ACTIVE → 그룹 추가, CANCELLED/EXPIRED → 제거). Claim 엔드포인트와 claimable 목록에서 `promotion.rules[customer.groups.id]` 검증 추가. Admin 쿠폰 생성 다이얼로그에 고객 그룹 rule 입력 추가 |
| 시스템 자동 발급 | ✅ **구현 완료** — `promotion_meta.auto_issue_trigger` 필드로 트리거 지정 (`customer_registered` / `membership_activated`; `birthday`는 미구현). channel-adapter inbox 패턴으로 처리: `UserEmailVerified` → `customer_registered` 쿠폰 발급, `MembershipStatusChanged(ACTIVE)` → `membership_activated` 쿠폰 발급. 발급은 Medusa `POST /admin/customers/:id/issue-coupons` 엔드포인트 경유. 발급 이력은 `promotion_issue_log` 테이블로 중복 방지 |
| buyget 유형 | "N개 사면 M개 무료" — `type: 'buyget'` + `buy_rules`. 현재 `type: 'standard'`만 지원 |
| 쿠폰 코드 수동 입력 (스토어프론트) | 체크아웃에서 코드 직접 입력 불가. 마이페이지 쿠폰 목록은 발급받은 쿠폰 / 발급받기 가능 쿠폰 / 공개 쿠폰 3개 섹션으로 표시. 체크아웃 드롭다운은 발급받은 쿠폰 + 공개 쿠폰만 노출 (미발급 claimable은 제외) |

---

## 3. 적립금 (포인트)

**백엔드:** wallet 서비스

### 페이지 역할 분리

| | 결제 관리 > 포인트 관리 (`/payments/points`) | 자사몰 관리 > 마케팅 > 적립금 (`/mall/marketing/points`) |
|---|---|---|
| **사용자** | CS팀 / 운영팀 | 마케팅팀 |
| **목적** | 특정 유저 문제 해결 | 정책 설정 / 전체 현황 |
| **단위** | 유저 1명 | 전체 / 그룹 |

### 결제 관리 > 포인트 관리

**구현 완료**
- 유저 ID 입력 → 잔액 카드 (확정 / 보류 / 사용가능)
- 포인트 이벤트 이력 테이블 (날짜·타입 필터, 페이지네이션)
- 적립 취소 (earn-cancel)
- 수동 지급 (earn) — 만료일 선택 가능

**미구현**

| 항목 | 설명 |
|------|------|
| (없음) | |

> 수동 차감(`POST /v1/admin/points/deduct` + `PointsDeductDialog`)과 유저 이름/이메일 검색(user-service `getAdminUsers` 연동)은 구현 완료.

### 자사몰 관리 > 마케팅 > 적립금

**구현 완료**
- 통계 대시보드: 총 발행 / 총 사용 / 적립 취소 / 현재 유통 중 (회사 부채)
- 전체 이벤트 로그 (기간·타입·유저ID 필터)
- 일괄 지급 (batch earn) — 유저 ID 목록, 1인당 금액, 사유 코드, 만료일
- 잔액 상위 10명 조회 (사이드 카드)

### 포인트 만료 설정

**스키마:** `point_events.expires_at` (nullable timestamp) — 발행 시 만료일 선택 가능

**크론잡:** 매일 새벽 2시 자동 실행 (`WALLET_POINTS_EXPIRATION_CRON` env로 오버라이드)
1. `expires_at < now`인 EARN 이벤트를 조회
2. 각 이벤트의 잔여 포인트 (EARN - EARN_CANCEL 합산) 계산
3. 잔여량만큼 EARN_CANCEL 생성 → 소멸 처리

`POST /v1/admin/points/expire` 로 수동 실행도 가능.

**알려진 제약:** 잔여량 계산 시 보류 중인 포인트(hold)를 고려하지 않음. 보류 해제 전 만료가 겹치면 소멸량이 실제 사용 가능 잔액보다 클 수 있음. 허용 가능한 수준이면 현행 유지, 정밀도가 중요하면 `available` 기준으로 교체 필요.

---

## 4. 프로모션 (타임세일)

### 현재 상태: dormant

코어 서비스의 `promotions` + `promotionProducts` 테이블이 존재하지만 완전히 비활성:
- `catalogSchema` 객체에 미포함 → DB 마이그레이션에도 미반영
- 서비스, 컨트롤러, 타입 없음
- 어드민 메뉴 `프로모션` 항목에 `path` 없는 플레이스홀더만 존재

### 두 개념의 차이

| | 코어 promotions (타임세일) | 메두사 promotions (쿠폰) |
|---|---|---|
| 개념 | 상품 가격 한시 할인 | 코드 기반 장바구니 할인 |
| 적용 방식 | 상품 페이지에 모든 고객에게 노출 | 코드 입력/발급 고객만 적용 |
| 단위 | 상품/SKU 레벨 | 주문/장바구니 레벨 |
| 예시 | "오늘만 30% 세일" | "SUMMER25 입력 시 할인" |
| SoT | 코어 (PIM 연결) | 메두사 (체크아웃 연결) |

두 개념은 충돌하지 않는다. 서로 다른 도메인.

### 메두사 이관 경로

타임세일을 메두사로 이관할 때 지금 쿠폰 시스템이 기반이 됨.
상품 한정 기능 위에 `is_automatic: true`만 추가하면 타임세일 수용 가능:

```
is_automatic: true           ← 코드 입력 없이 자동 적용
target_type: 'items'         ← 특정 상품에만 적용
target_rules: [
  { attribute: 'product_id', operator: 'in', values: ['prod_xxx'] }
]
campaign.starts_at / ends_at ← 기간 제한
```

이관 완료 후 코어의 `promotions`, `promotionProducts` 테이블은 삭제 대상.

---

## 5. 인프라 변경 사항

쿠폰/적립금 구현에서 SST 파일 변경 최소화:
- `services/infra/services.ts` — AdminWeb 환경변수 2개 추가 (`MEDUSA_API_URL`, `MEDUSA_API_KEY`)
- 신규 시크릿 생성 없음 — 기존 `medusaApiKey` 시크릿 참조
- 그 외 SST 파일 미변경

---

## 6. 로드맵

| 우선순위 | 기능 | 난이도 | 비고 |
|----------|------|--------|------|
| ~~1~~ | ~~claimable 발급 수량 제한~~ | ~~낮음~~ | ✅ **구현 완료** |
| ~~3~~ | ~~claimable 발급 조건 (고객 그룹)~~ | ~~중간~~ | ✅ **구현 완료** — channel-adapter MembershipMedusaSyncService + store claim/list 그룹 rule 검증 |
| ~~4~~ | ~~시스템 자동 발급~~ | ~~중간~~ | ✅ **구현 완료** — channel-adapter inbox 패턴 + Medusa POST /admin/customers/:id/issue-coupons (`birthday` 제외 미구현) |
| ~~2~~ | ~~1인당 사용 제한 Medusa campaign budget 이관 + 레거시 컬럼 제거~~ | ~~낮음~중간~~ | ✅ **구현 완료** |
| 5 | 최대 할인금액 체크아웃 강제 적용 | 중간 | Medusa 기본 엔진 미지원 — 커스텀 워크플로우 단계 필요 |
| 6 | 스토어프론트 쿠폰 코드 직접 입력 | 낮음 | 체크아웃 UI에 코드 입력란 추가 |
| 7 | 타임세일 (프로모션) 이관 | 중간 | is_automatic + target_rules, 코어 테이블 정리까지 |
| 8 | buyget 유형 쿠폰 | 높음 | 복잡도 높음 |
