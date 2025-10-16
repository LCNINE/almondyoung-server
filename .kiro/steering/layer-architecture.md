---

````md
---

## alwaysApply: true

# Layer Architecture Rules - 레이어 아키텍처 규칙

## 핵심 철학

**비즈니스 로직은 상세 구현을 모르더라도 흐름을 이해할 수 있어야 한다.**

신규 개발자, 사업 담당자, 영업 담당자에게 코드를 보면서 "대충 이런 흐름이다"라고 설명 가능한 수준이 이상적이다.

---

## 레이어 정의

### 1. Presentation Layer (Controller)

- **책임**: 외부 변화에 민감한 영역
- **포함**: HTTP/GraphQL/WebSocket 처리, DTO 검증, 인증/인가, Error → Response 변환
- **특징**: 외부 의존성이 높은 영역, 요청/응답 클래스
- **파일명 규칙**: `xxx.controller.ts`
- **예시**: `payment.controller.ts`, `user.controller.ts`

---

### 2. Business Layer (Service - Port)

- **책임**: 비즈니스 로직을 투영하는 레이어 (흐름 중심)
- **포함**: 도메인 규칙, 비즈니스 흐름 중계
- **특징**
  - 상세 구현 로직을 갖지 않음
  - 협력 도구 클래스들을 중계하는 역할
  - 각 협력 도구가 명시적으로 한 가지 일을 담당하도록 조율
  - 실패 시 `throw new Error("명확한 메시지")` 사용
- **파일명 규칙**: `xxx.service.ts` 또는 `xxx.usecase.ts`
- **예시**: `payment.service.ts`, `subscription.usecase.ts`

**예시 코드**

```typescript
@Injectable()
export class PaymentService {
  constructor(
    private readonly userReader: UserReader,
    private readonly storeReader: StoreReader,
    private readonly pointManager: PointManager,
    private readonly paymentAppender: PaymentAppender,
  ) {}

  async businessPay(
    targetStore: TargetStore,
    usePoint: UsePoint,
    userId: string,
  ) {
    const user = await this.userReader.read(userId);
    const store = await this.storeReader.read(
      targetStore,
      new StoreGrade(user.type),
    );
    await this.pointManager.use(user, usePoint);
    return await this.paymentAppender.append(user, store);
  }
}
```

---

### 3. Implementation Layer (ServiceImpl)

- **책임**: 상세 구현 로직을 담당하는 도구 클래스들
- **포함**: 데이터 조회/검증, 엔티티 생성/수정, 비즈니스 규칙 실행
- **특징**
  - 가장 많은 클래스가 존재
  - 재사용성이 높은 핵심 레이어
  - 각 클래스는 명확한 단일 책임을 가짐

#### 파일명 규칙 및 역할별 예시

| 유형                    | 설명                         | 파일명 규칙                             | 예시                                      |
| ----------------------- | ---------------------------- | --------------------------------------- | ----------------------------------------- |
| **Reader**              | 데이터 조회 / 읽기 전용      | `xxx.reader.ts`                         | `user.reader.ts`, `store.reader.ts`       |
| **Manager**             | 상태 변경 / 도메인 행위 수행 | `xxx.manager.ts`                        | `point.manager.ts`, `wallet.manager.ts`   |
| **Appender / Creator**  | 신규 엔티티 생성 / 추가      | `xxx.appender.ts` 또는 `xxx.creator.ts` | `payment.appender.ts`, `order.creator.ts` |
| **Validator**           | 입력/도메인 검증             | `xxx.validator.ts`                      | `payment.validator.ts`                    |
| **Calculator / Policy** | 계산 / 정책 로직 수행        | `xxx.calculator.ts`, `xxx.policy.ts`    | `discount.policy.ts`                      |

**규칙**

- 한 파일 = 한 책임
- 내부적으로 Repository 사용 가능
- 동일 레이어 간 협력 가능
- 외부(Service, Controller) 참조 불가

**예시 코드**

```typescript
class UserReader {
  async read(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('User not found');
    return user;
  }
}

class PointManager {
  async use(user: User, amount: number): Promise<void> {
    if (user.point < amount) throw new Error('Insufficient points');
    await this.userRepository.updatePoints(user.id, user.point - amount);
  }
}

class PaymentAppender {
  async append(user: User, store: Store): Promise<Payment> {
    return this.paymentRepository.create({
      userId: user.id,
      storeId: store.id,
    });
  }
}
```

---

### 4. Data Access Layer (Repository / Client)

- **책임**: 다양한 자원(DB, 외부 API 등)에 접근하는 기능 제공
- **포함**: DB 접근, 외부 API 호출, Kafka 메시징
- **특징**
  - 기술 의존성을 격리
  - 구현 로직에 순수한 인터페이스 제공
  - 일반적으로 별도 모듈로 구성

- **파일명 규칙**:
  - DB 접근: `xxx.repository.ts`
  - 외부 API: `xxx.client.ts`

- **예시**: `user.repository.ts`, `toss.client.ts`

---

## 4가지 핵심 규칙

### ✅ 규칙 1: 레이어는 위에서 아래로 순방향으로만 참조

```
Presentation → Business → Implementation → Data Access
```

### ❌ 규칙 2: 레이어의 참조 방향이 역류되지 않아야 함

- `UserReader`가 `UserService`를 참조하면 안 됨
- `UserService`가 `UserController`를 참조하면 안 됨
- Implementation이 Business를 알면 안 됨
- Business가 Presentation을 알면 안 됨

### ❌ 규칙 3: 레이어의 참조가 하위 레이어를 건너뛰지 않아야 함

- Business Layer가 Data Access Layer를 직접 참조 ❌
- Service가 Repository 여러 개 직접 참조 ❌
- Business Layer는 Implementation Layer만 사용
- Implementation Layer는 Data Access Layer를 사용

**나쁜 예시**

```typescript
// ❌ Service가 Repository를 직접 여러 개 참조
class PaymentService {
  constructor(
    private userRepo: UserRepository,
    private storeRepo: StoreRepository,
    private pointRepo: PointRepository,
    private paymentRepo: PaymentRepository,
  ) {}
}
```

**좋은 예시**

```typescript
// ✅ 흐름만 표현, 상세 구현은 Implementation Layer에
class PaymentService {
  constructor(
    private userReader: UserReader,
    private storeReader: StoreReader,
    private pointManager: PointManager,
    private paymentCreator: PaymentCreator,
  ) {}
}
```

### ❌ 규칙 4: 동일 레이어 간에는 서로 참조하지 않음 (단, Implementation Layer는 예외)

- Controller ↔ Controller ❌
- Service ↔ Service ❌
- Implementation ↔ Implementation ✅ (협력 가능)

---

## 실전 적용 가이드

### Business Layer 작성 시

```typescript
async processPayment(targetStore: string, usePoint: number) {
  const user = await this.userReader.read();
  const store = await this.storeReader.read(targetStore);
  await this.pointManager.use(user, usePoint);
  return await this.paymentAppender.append(user, store);
}
```

### Implementation Layer 작성 시

```typescript
class PointManager {
  async use(user: User, amount: number): Promise<void> {
    if (user.point < amount) throw new Error('Insufficient points');
    await this.db
      .update(users)
      .set({ point: user.point - amount })
      .where(eq(users.id, user.id));
  }
}
```

---

## AI 작성 시 체크리스트

- [ ] Service가 Repository 여러 개 직접 참조 ❌
- [ ] Service에 데이터 조회/검증/생성 로직 포함 ❌
- [ ] Implementation이 Business를 참조 ❌
- [ ] Business가 Data Access 건너뛰어 참조 ❌
- [ ] Service 코드만 봐도 비즈니스 흐름이 이해되는가 ✅
- [ ] 각 Implementation 클래스가 단일 책임을 가지는가 ✅

---

## 레이어 오염 방지

### Business Layer 금지 import

- `drizzle-orm`, `HttpException`, `Request`, `Response`
- Repository 구현체 (interface는 가능)

### Implementation Layer 허용 import

- `drizzle-orm`, `axios`, `kafkajs`, `postgres`, 등 기술 스택

---

## 확장 가능성

- 비즈니스 복잡 시 상위 Layer (UseCase, Application Layer 등) 추가 가능
- 변경/확장 시 README.md에 문서화
- 개발자 창의성 보장, 개방적 표준 유지

*

이 버전은  
✅ 원래의 “4가지 핵심 규칙 + 비즈니스 철학”을 유지하면서,  
✅ “파일명 규칙 / 클래스 명명 / 역할별 정의 / 통합한 완전한 레이어 표준 문서입니다.

```

```
