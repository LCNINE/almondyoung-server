---
alwaysApply: true
---

# Cursor Prompt Rules – Sustainable Clean Code for NestJS

# (폴더 구조 변경 금지 / Service-Implementation 분리 / CTO 스타일 에러 핸들링)

## 0) 불변 원칙 (DO & DON'T)

- DO: **기존 폴더 구조 유지**. 파일/폴더 이동 금지. (레거시 경로를 깨지 않는다)
- DO: 새 마이크로서비스/라이브러리는 항상 `nest g [app|lib] name` 사용
- DO: **Service(Port)와 Implementation(Adapter)** 를 **파일/네이밍/DI**로만 분리한다 (구조는 그대로)
- DON'T: 서비스 레이어에서 `HttpException` 던지지 않는다
- DON'T: 컨트롤러가 레포지토리를 직접 호출하지 않는다
- DON'T: 상위 → 하위 의존성 방향을 거꾸로 만들지 않는다

# 🧭 Cursor Prompt Rules – Sustainable Clean Code + CTO Style (Final Unified Version)

## 0) 기본 원칙 (DO & DON'T)

- ✅ **폴더 구조는 절대 변경 금지.**
  - 실제 파일 경로, import 경로, schema 경로를 그대로 유지해야 한다.
- ✅ **새 마이크로서비스/라이브러리 생성 시**
  - 반드시 `nest g [app|lib] name` CLI 명령어 사용.
- ✅ **DB 관련 토큰(`DB_CONNECTION`, `DB_SCHEMA`)은 이미 정의되어 있으므로 다시 생성하지 않는다.**
  - `src/common/db/db.service.ts`의 토큰이 DI의 표준이다.
  - AI는 절대 중복 토큰을 정의하거나 새 주입 키를 만들지 말 것.
- ❌ `HttpException`을 서비스 단에서 던지지 않는다.
- ❌ Controller가 Repository나 외부 Client를 직접 호출하지 않는다.
- ❌ 상위 → 하위의 의존성 방향을 거꾸로 만들지 않는다.

---

## 1) Layer Responsibilities (레이어별 책임)

| Layer                                              | Responsibility                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Controller**                                     | 전송 계층(HTTP/GraphQL/WebSocket) 처리, DTO 검증, 인증/인가, 트랜잭션 경계 시작/종료, **Error → Response 변환** |
| **Service (Port)**                                 | 순수 비즈니스 로직 / 도메인 규칙 정의, 실패 시 `throw new Error("...")` 사용                                    |
| **Implementation (Adapter / Repository / Client)** | DB 접근, 외부 API 호출, Kafka 메시징 등 인프라 세부 구현 담당                                                   |

> ⚙️ “서비스와 구현체를 나누라”는 블로그 철학을 **Port/Impl** 개념으로 적용하되,  
> 폴더 이동 없이 **파일명·DI 네이밍**으로 구분한다.

---

## 2) 네이밍 & 인터페이스 규칙 (폴더 유지)

- Service 인터페이스: `XxxService`
- 구현체(Adapter): `XxxServiceImpl`
- Repository 인터페이스: `XxxRepository`
- Repository 구현체: `XxxRepositoryImpl`
- 외부 Client: `XxxClient` / `XxxClientImpl`
- **토큰 이름 예시:** `PAYMENT_SERVICE = Symbol('PaymentService')`
- 단, **DB 관련 토큰은 예외**  
  (`DB_CONNECTION`, `DB_SCHEMA`는 이미 존재하며 재정의 금지)

---

## 3) Module 등록 규칙

- 모듈에서 인터페이스 → 구현체를 `useClass`로 바인딩한다.
- DB 관련 Provider는 이미 `DbService`로 구성되어 있으므로, **다시 정의하거나 래핑하지 않는다.**

```ts
@Module({
  providers: [
    { provide: PAYMENT_SERVICE, useClass: PaymentServiceImpl },
    { provide: 'PaymentRepository', useClass: PaymentRepositoryImpl },
  ],
  exports: [PAYMENT_SERVICE],
})
export class PaymentModule {}
```

---

## 4) Controller 규칙 (CTO 스타일)

- DTO 검증(class-validator / zod)은 컨트롤러 계층에서 처리.
- `Middleware`, `Guard`, `Pipe`, `Interceptor`, `Filter`는 모두 컨트롤러 소속.
- `try/catch`로 서비스의 일반 Error를 잡고 **문자열 기반 매핑**으로 HTTP 예외 변환.

```ts
try {
  return await this.service.refund(id);
} catch (e: any) {
  const msg = (e?.message ?? '').toLowerCase();
  if (msg.includes('not found')) throw new NotFoundException(e.message);
  if (msg.match(/already|invalid|failed|required|exceed/))
    throw new BadRequestException(e.message);
  throw new InternalServerErrorException(e.message);
}
```

---

## 5) Service (Port) 규칙

- **전송 수단(HTTP 등)과 완전히 분리.**
- 비즈니스 규칙만 포함.
- 실패 시 `throw new Error("명확한 키워드 메시지")`
  - `"Refund not found"`, `"Refund already processed"`, `"Amount exceeds limit"`

- DB 접근은 `DbService` 또는 Repository 구현체에서만.
- `HttpException`, Nest 전용 객체, Express Request 등을 import하지 않는다.

---

## 6) Repository / Implementation 규칙

- DB I/O, 외부 API 호출, Kafka, Outbox 등은 모두 여기서 수행.
- `DbService<typeof walletSchema>`를 그대로 주입받는다.

```ts
constructor(private readonly db: DbService<typeof walletSchema>) {}
```

- `@Inject(DB_CONNECTION)`이나 `@Inject(DB_SCHEMA)`를 새로 정의하지 않는다.
- 재시도/타임아웃/서킷브레이커 같은 인프라 로직도 여기서만 수행.

---

## 7) 의존성 방향 (DIP)

```
Controller → Service(Port) → Implementation(Adapter/Repository)
```

- Port는 구현체를 모른다.
- Implementation만 기술 스택을 import할 수 있다.
  (`drizzle-orm`, `kafkajs`, `axios`, `postgres`, etc.)
- DB 관련 구성은 `DbService`가 중앙에서 관리한다.

---

## 8) Error Handling 정책 (CTO 철학)

- **서비스에서는 오직 `throw new Error("...")`만 사용**
- **컨트롤러에서만** `HttpException` 변환 수행
- 매핑 규칙:
  - `"not found"` → 404
  - `"already"`, `"exceeds"`, `"invalid"`, `"failed"`, `"required"` → 400
  - 그 외 → 500

- 로그는 컨트롤러에서만 기록 (`error.message`, correlationId 포함)

---

## 9) 트랜잭션 / 멱등성 / 동시성

- 트랜잭션은 컨트롤러 경계에서 시작/종료
- 멱등성 키(idempotency-key)는 컨트롤러에서 관리 → 구현체에서 저장/검증
- 동시성 제어는 서비스 규칙으로 명시, 실제 락 로직은 Repository에서 처리

---

## 10) 테스트 정책

| Layer               | 테스트 방식                                    |
| ------------------- | ---------------------------------------------- |
| **Service**         | 순수 단위 테스트 (`Error.message`로 검증)      |
| **Controller**      | e2e 테스트 (HTTP 응답 매핑, 상태 코드 확인)    |
| **Repository/Impl** | 통합 테스트 (Drizzle, Kafka, 외부 API 모킹 등) |

---

## 11) 커밋 & 리팩토링 규칙

- `feat(service): add RefundServiceImpl` — 새 기능 추가
- `refactor(service): extract RefundService Port` — 포트 추출
- `chore(di): bind RefundService token` — DI 바인딩
- 점진적 리팩토링 시:
  1. 기존 서비스 클래스를 `XxxService` 인터페이스로 추출
  2. 구현을 `XxxServiceImpl`로 리네임
  3. 모듈에 토큰 바인딩 추가
  4. 컨트롤러에서 토큰 기반 DI 적용
  5. 테스트 계층 분리 (unit/e2e)

---

## 12) 철학적 배경 (CTO + Clean Growth)

- **CTO 철학**
  - 서비스는 “로직만”, 컨트롤러는 “표현만”, 예외 변환은 컨트롤러 전용
  - 커스텀 에러 클래스 금지 → `Error.message` 기반 매핑
  - Nest CLI 기반 구조 일원화 (`nest g [app|lib] name`)

- **지속 성장 구조 (Medium 글 기반)**
  - 서비스(Port)와 구현체(Adapter) 분리
  - 기술 스택 변경 시 도메인 로직 영향 최소화
  - 테스트와 유지보수가 가능한 구조로 확장성 보장

- **DB 구성 예외 조항**
  - DB 관련 의존성은 이미 중앙화(`DbService`, `DB_CONNECTION`, `DB_SCHEMA`) 되어 있으므로 절대 수정하지 않는다.

---

## 13) AI를 위한 명시적 제약 (Cursor 적용 시 중요)

- ✅ 기존 `DbService`의 토큰(`DB_CONNECTION`, `DB_SCHEMA`)을 절대 재정의하지 말 것.
- ✅ `@Inject(DB_CONNECTION)`은 이미 존재하는 주입 경로이다.
- ✅ 새로운 Repository나 Adapter를 만들 때, DB 접근이 필요하면 항상
  `constructor(private readonly db: DbService<typeof walletSchema>)` 형태로 주입받을 것.
- ❌ `provide: DB_CONNECTION` 형태의 중복 Provider를 생성하지 말 것.
- ✅ AI는 `DbService`를 래핑하거나 override하지 않고 그대로 사용한다.

---

## 14) 레이어 아키텍처 핵심 규칙

### Service는 2-3줄로 비즈니스 흐름만 표현

```typescript
// ✅ 좋은 예시 - 흐름만 표현
async purchaseWithCredit(userId, amount, orderId, intentId, tx) {
  const account = await this.accountReader.findByUserId(userId);
  await this.creditManager.useCreditForPurchase(account, amount, orderId, intentId, tx);
}
```

### 레이어 참조 규칙

- ✅ Controller → Service → Reader/Manager → Repository (순방향만)
- ❌ Service가 Repository 직접 참조 금지 (Reader를 통해야 함)
- ❌ 검증 로직을 Service에 두지 않음 (Manager가 담당)

### Implementation Layer 역할 분담

- **Reader**: 데이터 조회 (Service와 Repository 사이 중간 레이어)
- **Manager**: 검증 + 비즈니스 로직 + DB 접근 (모든 로직 담당)
- **Creator**: 신규 엔티티 생성
- **Repository**: 도메인당 1개 (테이블마다 만들지 않음)

---
