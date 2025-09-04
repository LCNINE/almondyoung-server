좋아요. **스키마는 현 상태 유지(빌링키만 예외)**, **Drizzle 직접 사용 허용**, **Controller/Service 분리 규칙**을 그대로 따르는 전제로, 지금 당장 적용 가능한 \*\*결제 도메인 설계문서(v2)\*\*를 정리해 드립니다.
(디렉토리는 “컨트롤러와 서비스가 분리돼 있다”는 현재 구조를 그대로 따릅니다.)

---

# 결제 도메인 설계 문서 v2 (Minimal-Change)

## 0. 목표/범위/비범위

- **목표**

  - 즉시결제(카드/간편) · 후불결제(BNPL) · 멤버십 정기결제를 **하나의 유스케이스 흐름** 안에서 안정적으로 처리.
  - **Controller ⇄ Service 책임 분리** 규칙을 엄격히 준수.
  - **금액 정수화(KRW)**, **멱등성**, **상태전이 일관성**, **감사 이벤트**를 표준화.

- **범위**

  - API: `POST /payments/authorize`, `POST /payments/deferred/capture`, `POST /payments/refund`, `POST /payment-methods(…)/activate`
  - 스케줄러: BNPL 월말 정산, 구독 정기결제 일일 실행.

- **비범위**

  - 대규모 스키마 변경(❌) — _빌링키 관련 최소 확장만 허용_
  - 리포지토리 추상화의 전면 도입(❌) — _Drizzle 직접 사용 유지, 필요한 곳만 최소 래핑_

---

## 1. 디렉토리 구조 (현 구조 준수)

```
src/
  controllers/
    payments.controller.ts
    payment-methods.controller.ts
    webhooks.controller.ts         // (필요 시)
  services/
    payment-v2.service.ts          // 핵심 유스케이스(Authorize / Refund 일부)
    bnpl-capture.service.ts        // 후불 일괄 Capture 실행기
    subscription-billing.service.ts// 정기결제 실행기(빌링키 사용)
    payment-methods.service.ts     // 결제수단 등록/활성화
  adapters/
    toss-immediate.adapter.ts      // 즉시결제(카드/간편) 어댑터
    bnpl-deferred.adapter.ts       // 후불결제(BNPL) 어댑터
    point.adapter.ts               // 포인트 어댑터
    billing-key.adapter.ts         // (신규, 최소) 빌링키 조회/검증 포트
  schedulers/
    bnpl-capture.cron.ts           // 월말 정산 스케줄러
    subscription-billing.cron.ts   // 정기결제 일일 스케줄러
  shared/
    errors/
      payment.errors.ts            // 도메인 에러(Controller 변환 전용)
    utils/
      idempotency.util.ts          // 멱등키 생성/검증 헬퍼
      money.util.ts                // KRW 정수 변환/검증
      logging.util.ts              // 민감정보 마스킹
    events/
      payment.events.ts            // 이벤트 이름/페이로드 타입
  schema.ts                        // (업로드된 스키마 유지)
  main.ts ...
```

> **핵심 원칙**
>
> - Controller: 전송수단/에러변환/검증
> - Service: 비즈니스 로직(에러는 **도메인 에러**만 throw)
> - Adapter: 외부 연동·저수준 IO
> - Drizzle: Service에서 직접 사용 OK(중복/복잡 쿼리만 선택적 유틸화)

---

## 2. 상태 모델 & 이벤트

### 2.1 결제 세션 상태

- `PENDING` → (Authorize 성공)

  - **즉시결제만** 포함: `CAPTURED`
  - **BNPL 포함**(혼합 가능): `AUTHORIZED` (후불 확정은 별도 Capture 단계)

- 이후

  - `PARTIALLY_REFUNDED` → `REFUNDED`
  - 실패 시 `FAILED` (도메인/외부 오류 포함)

### 2.2 이벤트 (append-only)

- `payment.session.created`, `payment.amount.validated`
- `payment.authorized` (BNPL 승인 기록)
- `payment.captured` (즉시/후불 확정)
- `payment.refund.requested`, `payment.refunded`
- `payment.failed`

> 이벤트는 **감사/장애분석/리플레이**를 위해 필수. (현 DB 구성 유지 + 이벤트 테이블만 append)

---

## 3. 공통 규칙

### 3.1 금액 처리(KRW)

- DB `numeric` → 서비스 진입 직후 **정수(KRW)** 로 변환해 내부 로직 수행
- 총합 검증: `sum(method.amountKRW) + pointsKRW === session.amountKRW`
- 변환 헬퍼: `toKRWInt(n: unknown): number`

### 3.2 멱등성

- **키 스킴**: `authorize:${hash(JSON.stringify({sessionId, methods, usePoints}))}`
- 서비스 진입부에서 멱등 검사 → 히트 시 저장 응답 리턴
- 저장 위치는 현 idempotency 테이블·로직 유지

### 3.3 로그/보안

- 카드번호/빌링키 등 **민감정보 마스킹**
- 외부 응답 저장 시 **토큰/키 제거**, 필요한 메타만

### 3.4 에러 처리

- **Service**: `DomainError` 파생만 throw (예: `InvalidPaymentAmountError`)
- **Controller**: `DomainError` → HTTP Status 변환

  - NotFound: 세션/결제수단 미존재
  - BadRequest: 금액 불일치/비활성/파라미터 오류
  - Conflict: 멱등 충돌/이미 처리됨
  - 5xx: 미분류 내부 오류

---

## 4. 유스케이스 설계

### 4.1 Authorize (즉시/후불/포인트 혼합 처리)

**입력**

- `sessionId: string`
- `methods: [{ methodId: string; type: 'CARD'|'EASY_PAY'|'BNPL'; amount: number }]`
  → _주 결제수단 최대 1개 원칙_
- `usePoints?: number`
- `userId?: string` (포인트 사용 시 필수)
- `idemKey?: string`

**검증**

1. 세션 조회(PENDING만 허용)
2. 금액 정수화 + 합산 검증
3. 주 결제수단 개수=1 보장
4. 포인트 사용 시 `userId` 필수

**처리**

- **BNPL**: `bnpl.authorize()` → `authorizationId` 기록 → 세션 `AUTHORIZED`
- **즉시결제(CARD/EASY_PAY)**: `gateway.authorizeAndCapture()` → `captureId` 기록
- **포인트**: `points.authorizeAndCapture()` (동일 트랜잭션 원자화)
- **혼합 규칙**

  - BNPL 포함이면 세션 최종 상태는 `AUTHORIZED`
  - BNPL 미포함이면 `CAPTURED`

- 이벤트 기록: `payment.authorized`/`payment.captured`

**출력**

```
{
  status: 'AUTHORIZED' | 'CAPTURED',
  authorizationIds?: string[],
  capturedIds?: string[],
  pointsTxId?: string
}
```

---

### 4.2 Deferred Capture (BNPL 정산)

**트리거**

- 월별 정산일(ENV), 수동 재시도, 또는 결제내역 확정 요청

**입력**

- `authorizationIds[] | period (YYYY-MM)` — 구현은 프로젝트 사정에 맞춤
- 내부에서 세션/유저/한도 재검증(필요 시)

**처리**

- `bnpl.capture({ authorizationIds, batchId })` 호출
- 부분 성공 가능 — 실패 건은 재시도 큐에 적재
- 성공 건 `payment.captured` 이벤트, 세션 상태 업데이트(모든 권면 확정 시 CAPTURED)

**출력**

- `{ success: boolean, results: [{ authorizationId, ok, error? }] }`

---

### 4.3 Refund

**입력**

- `captureId | paymentId`, `amountKRW`, `reason`

**처리**

- 즉시결제: PG 환불 API
- BNPL: 이미 출금된 거래에 한해 환급 로직
- 포인트: ledger 가산(복원)

**상태**

- 일부 환불: `PARTIALLY_REFUNDED`
- 전액 환불: `REFUNDED`

---

### 4.4 Payment Method (등록/활성화)

**등록**

- `POST /payment-methods` → DB에 `PENDING`
- (빌링키 모드) 외부 UI/SDK로 토큰 취득

**활성화**

- `POST /payment-methods/:id/activate`
- `billing-key.adapter`로 키 검증/핑
- 성공 시 `ACTIVE`, 중복(유저+provider+keyRef) 유니크 보장

---

## 5. API 명세 (요약)

### 5.1 `POST /payments/authorize`

- **Body**

```
{
  "sessionId": "string",
  "methods": [{ "methodId": "string", "type": "CARD|EASY_PAY|BNPL", "amount": 1000 }],
  "usePoints": 0,
  "userId": "string",
  "idemKey": "string"
}
```

- **Response**

```
{
  "status": "AUTHORIZED|CAPTURED",
  "authorizationIds": ["..."],
  "capturedIds": ["..."],
  "pointsTxId": "..."
}
```

- **오류 매핑 예**

  - 400: 금액 불일치/포인트 userId 누락
  - 404: 세션/결제수단 없음
  - 409: 이미 처리됨(멱등 충돌)
  - 500: 내부 오류

### 5.2 `POST /payments/deferred/capture`

- **Body**: `{ "authorizationIds": ["..."], "batchId": "YYYYMM" }`
- **Response**: `{ "success": true, "results": [{ "authorizationId": "...", "ok": true }] }`

### 5.3 `POST /payments/refund`

- **Body**: `{ "captureId": "...", "amount": 1000, "reason": "..." }`
- **Response**: `{ "refundId": "...", "status": "REFUNDED|PARTIALLY_REFUNDED" }`

### 5.4 `POST /payment-methods`, `POST /payment-methods/:id/activate`

- 등록 후 활성화로 분리. 활성화 시 빌링키 검증.

---

## 6. 스케줄러/환경변수

### 6.1 BNPL 월말 정산

- `SETTLEMENT_BILLING_DAY=10` (예: 매월 10일)
- `SETTLEMENT_CRON=0 0 * * *` (매일 00:00 실행 → 당월/마감일 조건으로 실행)

### 6.2 정기결제(구독)

- `SUBSCRIPTION_CRON=0 0 * * *` (매일 00:00)
- 실행 시 “오늘 결제 예정” 대상 조회 → `POST /payments/authorize` 호출(빌링키 방식: 즉시결제)

> 두 스케줄러 모두 **테스트 모드** 지원:
> `*_TEST_MODE=true`, `*_TEST_INTERVAL_MS=300000`

---

## 7. 서비스/컨트롤러 역할 예시

### 7.1 Controller (예시)

- DTO 검증/가드/인증
- `try/catch`로 `DomainError` → HTTP 상태 변환
- 서비스 호출만 수행

### 7.2 Service (예시)

- 세션/PENDING 검증
- 금액 정수화·합산 검증
- 주 수단 1개 규칙 적용
- BNPL/즉시/포인트 순서 처리
- 최종 세션 상태 결정(`AUTHORIZED` vs `CAPTURED`)
- 이벤트 기록
- 도메인 에러 throw만 수행

---

## 8. 어댑터 가이드

### 8.1 `toss-immediate.adapter.ts`

- `authorizeAndCapture({ methodId, amountKRW })`
- 민감정보 로깅 금지, 외부 UI/Redirect 모드와 빌링키 모드 분기 유지

### 8.2 `bnpl-deferred.adapter.ts`

- `authorize({ bnplAccountId, amountKRW })` → `authorizationId`
- `capture({ authorizationIds, batchId })` → 부분 성공 결과 배열
- 멱등성: 동일 입력 재호출 시 동일 결과 반환 보장(가능하면)

### 8.3 `point.adapter.ts`

- `authorizeAndCapture({ userId, amountKRW })`
- **동일 트랜잭션** 내 잔액 확인→차감 원자화
- `userId`는 **Controller→Service에서 보장** 후 전달

### 8.4 `billing-key.adapter.ts` (신규, 최소)

- `verify({ billingKeyId })` → 활성 여부/유효성 체크
- 스키마 변경 없이, 단순 검증 포트만

---

## 9. 테스트 전략

- **서비스 단위 테스트**

  - 금액 합산/혼합 규칙(주 수단 1개)
  - BNPL 포함 시 상태 `AUTHORIZED`, 미포함 `CAPTURED`
  - 멱등 재호출 시 결과 동일

- **E2E 테스트**

  - 즉시결제 Happy-path
  - 포인트+즉시 혼합
  - BNPL 승인 후 월말 Capture
  - Refund 부분/전체
  - 에러 매핑(400/404/409/500)

---

## 10. 단계적 적용 플랜

1. **payment-v2.service.ts**에 다음 4가지만 먼저 적용

   - [ ] 금액 정수화/합산 검증 헬퍼 적용
   - [ ] BNPL 포함 시 최종 상태 `AUTHORIZED` 고정
   - [ ] 포인트 사용 시 `userId` 필수화 (Controller에서 전달)
   - [ ] 멱등키 스킴 통일(미지정 시 hash(dto))

2. **Controller**에서 도메인 에러 → HTTP 상태 변환 레이어 정착
3. **bnpl-capture.service.ts / schedulers** 연결 (월말 배치)
4. **subscription-billing.service.ts / schedulers** 연결 (일일 빌링)
5. 로깅/마스킹/이벤트 기록 정리
6. Refund 경로 정비

---

## 11. DTO/타입 가이드 (요약)

```ts
// controllers dto (요청/응답)
type MethodType = 'CARD' | 'EASY_PAY' | 'BNPL';

interface AuthorizeRequestDto {
  sessionId: string;
  methods: Array<{ methodId: string; type: MethodType; amount: number }>;
  usePoints?: number;
  userId?: string;
  idemKey?: string;
}
interface AuthorizeResponseDto {
  status: 'AUTHORIZED' | 'CAPTURED';
  authorizationIds?: string[];
  capturedIds?: string[];
  pointsTxId?: string;
}
```

---

## 12. 운영 체크리스트

- [ ] 금액 필드는 **항상 정수 KRW**로 로깅/저장
- [ ] 외부 응답 로깅 시 **민감정보 마스킹**
- [ ] 멱등 재시도는 **유스케이스별 키 스킴**으로
- [ ] BNPL 실패/부분성공은 **재시도 큐** 설계(간단한 테이블/상태 컬럼)
- [ ] 이벤트는 **append-only**로 보존(보관기간 정책 별도)

---

원하시면 위 문서에 맞춰 **각 파일별 diff 패치**(특히 `payment-v2.service.ts`, `payments.controller.ts`)를 바로 뽑아드릴게요.
또, 현재 디렉토리에 그대로 넣을 수 있는 **스켈레톤 코드**(새로 추가되는 `bnpl-capture.service.ts`, `subscription-billing.cron.ts`, `billing-key.adapter.ts`)도 준비해 드립니다.
