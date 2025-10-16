# BNPL 아키텍처 냉정한 리뷰

## 🔴 현재 구조의 문제점

### 1. 불필요한 Wrapping Layer

```typescript
// ❌ 현재: BnplAccountReader
async findByUserId(userId: string) {
  try {
    return await this.repo.findAccountByUserId(userId);  // 그냥 통과
  } catch (error: any) {
    throw new Error('Account lookup failed');  // 에러만 바꿈
  }
}
```

**문제:** 아무런 비즈니스 로직 없이 단순히 Repository를 wrapping만 함.

### 2. Service에 너무 많은 책임

```typescript
// ❌ 현재: BnplAccountService
async createCreditEvent(userId, amount, ...) {
  const account = await this.accountReader.findByUserId(userId);
  if (!account) throw new Error('Account not found');           // 검증
  if (account.status !== 'ACTIVE') throw new Error('...');      // 검증
  if (account.availableLimit < amount) throw new Error('...');  // 검증

  const event = await this.eventManager.createCreditEvent(...); // 생성
  await this.creditManager.useCredit(account, amount, tx);      // 업데이트
  return event;
}
```

**문제:** Service가 검증, 조회, 생성, 업데이트를 모두 직접 수행. 이건 "흐름 중계"가 아님.

### 3. Manager의 역할 불명확

```typescript
// ❌ 현재: BnplCreditManager.useCredit
async useCredit(account: BnplAccount, amount: number, tx) {
  await this.repo.updateAccount(
    account.id,
    { availableLimit: account.availableLimit - amount },
    tx,
  );
}
```

**문제:**

- 검증은 Service에서 이미 했음
- Manager는 단순히 Repository 호출만 함
- 계산 로직(`account.availableLimit - amount`)도 Service에서 넘어온 값

## 📖 layer-architecture.md의 철학

```typescript
// ✅ 이상적인 예시
async businessPay(targetStore, usePoint, userId) {
  const user = await this.userReader.read(userId);
  const store = await this.storeReader.read(targetStore, new StoreGrade(user.type));
  await this.pointManager.use(user, usePoint);
  return await this.paymentAppender.append(user, store);
}
```

**핵심:**

- Service는 **흐름만** 표현
- 검증, 계산, 상세 로직은 **Manager가 담당**
- 코드만 봐도 비즈니스 흐름이 이해됨

## ✅ 올바른 구조 제안

### 옵션 1: Manager에 책임 집중 (추천)

```typescript
// ✅ Service - 흐름만 표현
@Injectable()
export class BnplAccountService {
  constructor(
    private readonly repo: BnplRepository,
    private readonly creditManager: BnplCreditManager,
  ) {}

  async purchaseWithCredit(
    userId: string,
    amount: number,
    orderId: string,
    intentId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const account = await this.repo.findAccountByUserId(userId);
    await this.creditManager.useCreditForPurchase(
      account,
      amount,
      orderId,
      intentId,
      tx,
    );
  }
}

// ✅ Manager - 모든 비즈니스 로직
@Injectable()
export class BnplCreditManager {
  constructor(private readonly repo: BnplRepository) {}

  async useCreditForPurchase(
    account: BnplAccount | null,
    amount: number,
    orderId: string,
    intentId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    // 1. 검증 (Manager가 담당)
    if (!account) throw new Error('Account not found');
    if (account.status !== 'ACTIVE') throw new Error('Account not active');
    if (account.availableLimit < amount) throw new Error('Insufficient credit');

    // 2. 이벤트 생성
    const event = await this.repo.createEvent(
      {
        id: getTsid().toString(),
        accountId: account.id,
        eventType: 'PURCHASE',
        eventCategory: 'CREDIT',
        amount,
        externalOrderId: orderId,
        paymentIntentId: intentId,
        aggregationPeriod: new Date().toISOString().slice(0, 7),
        isAggregated: false,
        status: 'PENDING',
        actor: 'SYSTEM',
      },
      tx,
    );

    // 3. 이벤트 상세 생성
    const detail = await this.repo.createEventDetail(
      {
        id: getTsid().toString(),
        eventId: event.id,
        accountId: account.id,
        eventType: 'PURCHASE',
        amount,
        balanceBefore: account.creditLimit - account.availableLimit,
        balanceAfter: account.creditLimit - account.availableLimit + amount,
        availableBefore: account.availableLimit,
        availableAfter: account.availableLimit - amount,
      },
      tx,
    );

    await this.repo.updateEventDetail(
      detail.id,
      {
        purchaseEventDetailId: detail.id,
        originalEventDetailId: detail.id,
      },
      tx,
    );

    // 4. 한도 차감
    await this.repo.updateAccount(
      account.id,
      { availableLimit: account.availableLimit - amount },
      tx,
    );

    this.logger.log(`Credit used: ${amount} for order ${orderId}`);
  }

  async restoreCreditForFailure(
    account: BnplAccount,
    amount: number,
    tx?: WalletExecutor,
  ): Promise<void> {
    if (!account) throw new Error('Account not found');

    await this.repo.updateAccount(
      account.id,
      { availableLimit: account.availableLimit + amount },
      tx,
    );

    this.logger.log(`Credit restored: ${amount}`);
  }
}
```

### 옵션 2: Reader/Manager 제거 (더 단순)

```typescript
// ✅ Service가 Repository 직접 사용
@Injectable()
export class BnplAccountService {
  constructor(private readonly repo: BnplRepository) {}

  async purchaseWithCredit(
    userId: string,
    amount: number,
    orderId: string,
    intentId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    // 1. 조회 및 검증
    const account = await this.repo.findAccountByUserId(userId);
    if (!account) throw new Error('Account not found');
    if (account.status !== 'ACTIVE') throw new Error('Account not active');
    if (account.availableLimit < amount) throw new Error('Insufficient credit');

    // 2. 이벤트 생성
    const event = await this.repo.createEvent({...}, tx);
    await this.repo.createEventDetail({...}, tx);

    // 3. 한도 차감
    await this.repo.updateAccount(
      account.id,
      { availableLimit: account.availableLimit - amount },
      tx,
    );
  }
}
```

## 🎯 추천: 옵션 1

### 이유

1. **Manager가 도메인 행위를 캡슐화**
   - `useCreditForPurchase()` - 명확한 비즈니스 의도
   - `restoreCreditForFailure()` - 실패 시 복원 로직

2. **Service는 정말 흐름만**

   ```typescript
   const account = await this.repo.findAccountByUserId(userId);
   await this.creditManager.useCreditForPurchase(
     account,
     amount,
     orderId,
     intentId,
     tx,
   );
   ```

   - 2줄로 비즈니스 흐름 표현
   - "계정 찾고 → 신용 사용"

3. **재사용 가능**
   - 다른 Service에서도 `creditManager.useCreditForPurchase()` 호출 가능
   - 검증 로직이 Manager에 있어서 일관성 보장

4. **테스트 용이**
   - Manager 단위 테스트 가능
   - Service는 Manager를 mock하면 됨

## 📊 비교표

| 항목              | 현재 구조                     | 옵션 1 (추천)      | 옵션 2       |
| ----------------- | ----------------------------- | ------------------ | ------------ |
| **Service 책임**  | 검증 + 조회 + 생성 + 업데이트 | 흐름만             | 모든 로직    |
| **Manager 역할**  | 단순 wrapping                 | 도메인 행위 캡슐화 | 없음         |
| **Reader 역할**   | 단순 wrapping                 | 없음               | 없음         |
| **코드 중복**     | 낮음                          | 매우 낮음          | 높을 수 있음 |
| **재사용성**      | 낮음                          | 높음               | 중간         |
| **테스트 용이성** | 중간                          | 높음               | 중간         |
| **가독성**        | 낮음                          | 매우 높음          | 높음         |

## 🔧 구체적인 리팩토링 단계

### 1단계: Reader 제거

- `BnplAccountReader` 삭제
- Service에서 `repo` 직접 사용

### 2단계: Manager에 책임 이동

- 검증 로직을 Manager로 이동
- 도메인 행위 메서드 생성 (`useCreditForPurchase`, `restoreCreditForFailure`)

### 3단계: Service 단순화

- Service는 2-3줄로 흐름만 표현
- 모든 상세 로직은 Manager에

### 4단계: 불필요한 메서드 제거

- Service의 단순 위임 메서드 제거
- 예: `findAccountByUserId()` → Controller에서 직접 repo 호출 또는 제거

## 💭 철학적 질문

**"Manager가 단순 wrapping만 한다면, 그 레이어가 필요한가?"**

**답:** 아니요. 불필요합니다.

**"Service가 검증 로직을 가진다면, 그게 '흐름 중계'인가?"**

**답:** 아니요. 그건 비즈니스 로직입니다.

## 🎓 결론

현재 구조는 **과도한 추상화**와 **책임 분산**의 문제가 있습니다.

**해결책:**

1. Reader 제거 (단순 wrapping은 무의미)
2. Manager에 도메인 행위 집중
3. Service는 정말 흐름만 표현

**목표:**

```typescript
// 이 코드만 봐도 비즈니스 흐름이 이해되어야 함
async purchaseWithCredit(userId, amount, orderId, intentId, tx) {
  const account = await this.repo.findAccountByUserId(userId);
  await this.creditManager.useCreditForPurchase(account, amount, orderId, intentId, tx);
}
```

**이게 layer-architecture.md의 진짜 의도입니다.**
