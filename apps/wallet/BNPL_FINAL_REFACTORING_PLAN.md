# BNPL 최종 리팩토링 계획 (옵션 1 - 규칙 준수)

## 🎯 목표

**layer-architecture.md 규칙을 100% 준수하면서 Manager에 책임 집중**

## 📖 핵심 규칙 재확인

```
❌ 규칙 3: 레이어의 참조가 하위 레이어를 건너뛰지 않아야 함
- Business Layer가 Data Access Layer를 직접 참조 ❌
- Service가 Repository 직접 참조 ❌
- Business Layer는 Implementation Layer만 사용 ✅
```

## ✅ 올바른 레이어 구조

```
Controller (Presentation)
    ↓
Service (Business) ← 흐름만 표현
    ↓
Reader/Manager/Creator (Implementation) ← 비즈니스 로직
    ↓
Repository (Data Access) ← DB 접근
```

## 📋 리팩토링 상세 계획

### 1. Reader의 역할 재정의

**Before (단순 wrapping):**

```typescript
async findByUserId(userId: string) {
  try {
    return await this.repo.findAccountByUserId(userId);  // 그냥 통과
  } catch (error: any) {
    throw new Error('Account lookup failed');
  }
}
```

**After (의미 있는 캡슐화):**

```typescript
// 단순 조회
async findByUserId(userId: string): Promise<BnplAccount | null> {
  return await this.repo.findAccountByUserId(userId);
}

// 복잡한 조회 (검증 포함)
async findActiveAccount(userId: string): Promise<BnplAccount> {
  const account = await this.repo.findAccountByUserId(userId);
  if (!account) throw new Error('Account not found');
  if (account.status !== 'ACTIVE') throw new Error('Account not active');
  return account;
}
```

### 2. Manager에 비즈니스 로직 집중

**Before (Service에 검증 로직):**

```typescript
// Service
async createCreditEvent(userId, amount, ...) {
  const account = await this.accountReader.findByUserId(userId);
  if (!account) throw new Error('Account not found');           // ❌ Service에서 검증
  if (account.status !== 'ACTIVE') throw new Error('...');      // ❌ Service에서 검증
  if (account.availableLimit < amount) throw new Error('...');  // ❌ Service에서 검증

  const event = await this.eventManager.createCreditEvent(...);
  await this.creditManager.useCredit(account, amount, tx);
  return event;
}

// Manager
async useCredit(account, amount, tx) {
  await this.repo.updateAccount(...);  // 단순 업데이트만
}
```

**After (Manager에 모든 로직):**

```typescript
// Service - 흐름만
async purchaseWithCredit(userId, amount, orderId, intentId, tx) {
  const account = await this.accountReader.findByUserId(userId);
  await this.creditManager.useCreditForPurchase(account, amount, orderId, intentId, tx);
}

// Manager - 검증 + 생성 + 업데이트
async useCreditForPurchase(account, amount, orderId, intentId, tx) {
  // 1. 검증
  if (!account) throw new Error('Account not found');
  if (account.status !== 'ACTIVE') throw new Error('Account not active');
  if (account.availableLimit < amount) throw new Error('Insufficient credit');

  // 2. 이벤트 생성
  const event = await this.repo.createEvent({...}, tx);
  await this.repo.createEventDetail({...}, tx);

  // 3. 한도 차감
  await this.repo.updateAccount(account.id, {
    availableLimit: account.availableLimit - amount
  }, tx);
}
```

### 3. Service 단순화

**Before:**

```typescript
async createCreditEvent(userId, amount, orderId, intentId, tx) {
  const account = await this.accountReader.findByUserId(userId);
  if (!account) throw new Error('Account not found');
  if (account.status !== 'ACTIVE') throw new Error('Account not active');
  if (account.availableLimit < amount) throw new Error('Insufficient credit');

  const event = await this.eventManager.createCreditEvent(
    account.id, amount, orderId, intentId,
    account.availableLimit, account.creditLimit, tx
  );

  await this.creditManager.useCredit(account, amount, tx);
  return event;
}
```

**After:**

```typescript
async purchaseWithCredit(userId, amount, orderId, intentId, tx) {
  const account = await this.accountReader.findByUserId(userId);
  await this.creditManager.useCreditForPurchase(account, amount, orderId, intentId, tx);
}
```

**라인 수:** 15줄 → 3줄

## 🔧 구체적인 변경 사항

### BnplAccountReader

```typescript
@Injectable()
export class BnplAccountReader {
  constructor(private readonly repo: BnplRepository) {}

  // 단순 조회
  async findByUserId(userId: string): Promise<BnplAccount | null> {
    return await this.repo.findAccountByUserId(userId);
  }

  async findById(
    accountId: string,
    tx?: WalletExecutor,
  ): Promise<BnplAccount | null> {
    return await this.repo.findAccountById(accountId, tx);
  }

  async findAccountsForBilling(): Promise<BnplAccount[]> {
    return await this.repo.findAccountsForBilling();
  }

  // 복잡한 조회 (검증 포함) - 선택적
  async findActiveAccount(userId: string): Promise<BnplAccount> {
    const account = await this.repo.findAccountByUserId(userId);
    if (!account) throw new Error('Account not found');
    if (account.status !== 'ACTIVE') throw new Error('Account not active');
    return account;
  }
}
```

### BnplCreditManager

```typescript
@Injectable()
export class BnplCreditManager {
  constructor(private readonly repo: BnplRepository) {}

  /**
   * 구매 시 신용 사용 (검증 + 이벤트 생성 + 한도 차감)
   */
  async useCreditForPurchase(
    account: BnplAccount | null,
    amount: number,
    orderId: string,
    intentId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    // 1. 검증
    if (!account) throw new Error('Account not found');
    if (account.status !== 'ACTIVE') throw new Error('Account not active');
    if (account.availableLimit < amount) throw new Error('Insufficient credit');

    // 2. 이벤트 생성
    const event = await this.repo.createEvent(
      {
        id: getTsid().toString(),
        accountId: account.id,
        eventType: 'PURCHASE' as any,
        eventCategory: 'CREDIT' as any,
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

    this.logger.log(`Credit used for purchase: ${amount}, order: ${orderId}`);
  }

  /**
   * 결제 성공 시 한도 복원 (검증 + 이벤트 생성 + 한도 복원)
   */
  async restoreCreditForPayment(
    account: BnplAccount | null,
    amount: number,
    batchId: string,
    aggregationPeriod: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    if (!account) throw new Error('Account not found');

    // 1. 상환 이벤트 생성
    await this.repo.createEvent(
      {
        id: getTsid().toString(),
        accountId: account.id,
        eventType: 'PAYMENT_SUCCESS' as any,
        eventCategory: 'DEBIT' as any,
        amount: -amount,
        aggregationPeriod,
        isAggregated: true,
        batchTransactionId: batchId,
        batchDueDate: new Date().toISOString().split('T')[0],
        status: 'COMPLETED' as any,
        actor: 'SYSTEM',
      },
      tx,
    );

    // 2. 한도 복원
    await this.repo.updateAccount(
      account.id,
      { availableLimit: account.availableLimit + amount },
      tx,
    );

    this.logger.log(`Credit restored: ${amount}, batch: ${batchId}`);
  }

  /**
   * 실패 시 한도 복원 (검증 + 한도 복원만)
   */
  async restoreCreditForFailure(
    account: BnplAccount | null,
    amount: number,
    tx?: WalletExecutor,
  ): Promise<void> {
    if (!account) throw new Error('Account not found');

    await this.repo.updateAccount(
      account.id,
      { availableLimit: account.availableLimit + amount },
      tx,
    );

    this.logger.log(`Credit restored for failure: ${amount}`);
  }

  /**
   * 다음 결제일 업데이트
   */
  async updateNextBillingDate(
    accountId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const nextBillingDate = this.calculateNextBillingDate(new Date());

    await this.repo.updateAccount(
      accountId,
      {
        nextBillingDate,
        billingCycleStart: new Date().toISOString().split('T')[0],
        billingCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
      },
      tx,
    );

    this.logger.log(`Next billing date updated: ${nextBillingDate}`);
  }

  private calculateNextBillingDate(baseDate: Date): string {
    const nextDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const dayOfWeek = nextDate.getDay();
    if (dayOfWeek === 0) nextDate.setDate(nextDate.getDate() + 1);
    else if (dayOfWeek === 6) nextDate.setDate(nextDate.getDate() + 2);
    return nextDate.toISOString().split('T')[0];
  }
}
```

### BnplAccountService

```typescript
@Injectable()
export class BnplAccountService {
  constructor(
    private readonly accountReader: BnplAccountReader,
    private readonly accountCreator: BnplAccountCreator,
    private readonly creditManager: BnplCreditManager,
  ) {}

  /**
   * BNPL 계정 생성
   */
  async createAccount(
    userId: string,
    creditLimit: number,
    tx?: WalletExecutor,
  ): Promise<BnplAccount> {
    const existing = await this.accountReader.findByUserId(userId);
    if (existing) throw new Error('Account already exists');

    return await this.accountCreator.create(userId, creditLimit, tx);
  }

  /**
   * 구매 시 신용 사용
   */
  async purchaseWithCredit(
    userId: string,
    amount: number,
    orderId: string,
    intentId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const account = await this.accountReader.findByUserId(userId);
    await this.creditManager.useCreditForPurchase(
      account,
      amount,
      orderId,
      intentId,
      tx,
    );
  }

  /**
   * 결제 성공 시 한도 복원
   */
  async completePayment(
    userId: string,
    amount: number,
    batchId: string,
    aggregationPeriod: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const account = await this.accountReader.findByUserId(userId);
    await this.creditManager.restoreCreditForPayment(
      account,
      amount,
      batchId,
      aggregationPeriod,
      tx,
    );
  }

  /**
   * 실패 시 한도 복원
   */
  async restoreCreditForFailure(
    accountId: string,
    amount: number,
    tx?: WalletExecutor,
  ): Promise<void> {
    const account = await this.accountReader.findById(accountId, tx);
    await this.creditManager.restoreCreditForFailure(account, amount, tx);
  }

  /**
   * 청구 대상 계정 조회
   */
  async findAccountsForBilling(): Promise<BnplAccount[]> {
    return await this.accountReader.findAccountsForBilling();
  }

  /**
   * 계정 조회
   */
  async findAccountByUserId(userId: string): Promise<BnplAccount | null> {
    return await this.accountReader.findByUserId(userId);
  }
}
```

## 📊 Before & After 비교

### Service 메서드 복잡도

| 메서드               | Before                        | After        | 개선     |
| -------------------- | ----------------------------- | ------------ | -------- |
| `createCreditEvent`  | 15줄 (검증 + 생성 + 업데이트) | 3줄 (흐름만) | 80% 감소 |
| `createDebitEvent`   | 10줄                          | 3줄          | 70% 감소 |
| `restoreCreditLimit` | 8줄                           | 3줄          | 62% 감소 |

### Manager 책임

| Before                   | After                          |
| ------------------------ | ------------------------------ |
| 단순 Repository 호출     | 검증 + 비즈니스 로직 + DB 접근 |
| Service에서 검증 후 호출 | 자체적으로 검증 수행           |
| 재사용 불가              | 다른 Service에서 재사용 가능   |

### Reader 역할

| Before                 | After                               |
| ---------------------- | ----------------------------------- |
| 단순 wrapping (무의미) | 레이어 규칙 준수를 위한 필수 레이어 |
| try-catch만 추가       | 복잡한 조회 캡슐화 가능             |

## ✅ 규칙 준수 확인

```
✅ 규칙 1: 순방향 참조
   Controller → Service → Reader/Manager → Repository

✅ 규칙 2: 역류 방지
   Manager가 Service 참조 안 함

✅ 규칙 3: 레이어 건너뛰기 방지
   Service가 Repository 직접 참조 안 함
   Service → Reader/Manager → Repository

✅ 규칙 4: 동일 레이어 참조
   Manager ↔ Manager 협력 가능
```

## 🎯 핵심 개선 효과

1. **Service는 정말 흐름만 표현**

   ```typescript
   const account = await this.accountReader.findByUserId(userId);
   await this.creditManager.useCreditForPurchase(
     account,
     amount,
     orderId,
     intentId,
     tx,
   );
   ```

2. **Manager가 도메인 행위 캡슐화**
   - `useCreditForPurchase()` - 구매 시 신용 사용
   - `restoreCreditForPayment()` - 결제 성공 시 복원
   - `restoreCreditForFailure()` - 실패 시 복원

3. **Reader가 레이어 규칙 준수**
   - Service와 Repository 사이의 필수 중간 레이어
   - 복잡한 조회 로직 캡슐화 가능

4. **재사용성 향상**
   - Manager 메서드를 다른 Service에서도 사용 가능
   - 검증 로직이 Manager에 있어서 일관성 보장

## 🚀 실행 순서

1. **BnplAccountReader 단순화** - try-catch 제거, 단순 조회만
2. **BnplCreditManager 확장** - 검증 + 비즈니스 로직 추가
3. **BnplEventManager 제거** - CreditManager에 통합
4. **BnplAccountService 단순화** - 흐름만 표현
5. **BnplSettlementService 업데이트** - 동일한 패턴 적용
6. **검증** - getDiagnostics 실행

---

**이제 layer-architecture.md의 철학을 100% 구현합니다.**
