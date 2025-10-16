# BNPL Service Architecture

## Before Refactoring ❌

```
┌─────────────────────────────────────┐
│      BnplAccountService             │
│  (Mixed Business + Data Access)     │
│                                     │
│  - createBnplAccount()              │
│  - createCreditEvent()              │
│  - findAccountsForBilling()         │
│  - getUnbilledAmount()              │
│  - markEventsAsAggregated()         │
│  - restoreCreditLimit()             │
│                                     │
│  ❌ Direct drizzle-orm usage        │
│  ❌ Direct DbService access         │
│  ❌ Mixed responsibilities          │
└─────────────────────────────────────┘
           ↓
    ┌──────────┐
    │ DbService│
    └──────────┘
```

## After Refactoring ✅

```
┌──────────────────────────────────────────────────────────────┐
│                    Controller Layer                          │
│  - HTTP/GraphQL handling                                     │
│  - Error → HTTP exception mapping                            │
│  - Transaction boundary management                           │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│              Business Layer (Port / Service)                 │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         BnplAccountService                         │    │
│  │  ✅ Pure business logic                            │    │
│  │  ✅ Domain rule validation                         │    │
│  │  ✅ Flow orchestration                             │    │
│  │  ✅ throw new Error("keyword-based")               │    │
│  └────────────────────────────────────────────────────┘    │
│                            ↓                                 │
│  ┌────────────────────────────────────────────────────┐    │
│  │       BnplSettlementService                        │    │
│  │  ✅ CMS batch processing flow                      │    │
│  │  ✅ Transaction coordination                       │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│           Implementation Layer (Adapter)                     │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ BnplAccountReader│  │BnplAccountCreator│                │
│  │      Impl        │  │      Impl        │                │
│  │                  │  │                  │                │
│  │ - findByUserId() │  │ - create()       │                │
│  │ - findById()     │  │                  │                │
│  │ - findForBilling│  └──────────────────┘                │
│  │ - getUnbilled()  │                                       │
│  └──────────────────┘                                       │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ BnplCreditManager│  │ BnplEventManager │                │
│  │      Impl        │  │      Impl        │                │
│  │                  │  │                  │                │
│  │ - useCredit()    │  │ - createCredit() │                │
│  │ - restoreCredit()│  │ - createDebit()  │                │
│  │ - updateBilling()│  │ - markAggregated│                │
│  └──────────────────┘  │ - failByBatch()  │                │
│                        └──────────────────┘                │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ BnplBatchCreator │  │ BnplCmsProcessor │                │
│  │      Impl        │  │      Impl        │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                              │
│  ┌──────────────────┐                                       │
│  │ BnplRetryManager │                                       │
│  │      Impl        │                                       │
│  └──────────────────┘                                       │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│              Data Access Layer (Repository)                  │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │      BnplCmsResponseRepository                     │    │
│  │  - createResponse()                                │    │
│  │  - findByBatchId()                                 │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│                  Infrastructure Layer                        │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │              DbService<walletSchema>               │    │
│  │  ✅ Centralized DB connection                      │    │
│  │  ✅ Transaction management                         │    │
│  │  ✅ Schema type safety                             │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Key Improvements

### 1. Clear Separation of Concerns

- **Business Layer**: What to do (domain rules)
- **Implementation Layer**: How to do it (technical details)
- **Repository Layer**: Where to store it (data persistence)

### 2. Dependency Direction

```
High Level (Business) → Low Level (Infrastructure)
```

- Business logic doesn't know about drizzle-orm
- Implementation can be swapped without changing business logic

### 3. Single Responsibility

Each implementation class has ONE job:

- `BnplAccountReaderImpl`: Read account data
- `BnplAccountCreatorImpl`: Create accounts
- `BnplCreditManagerImpl`: Manage credit limits
- `BnplEventManagerImpl`: Manage events

### 4. Testability

```typescript
// Unit Test (Business Layer)
const service = new BnplAccountService(
  mockReader,
  mockCreator,
  mockCreditManager,
  mockEventManager,
);

// Integration Test (Implementation Layer)
const reader = new BnplAccountReaderImpl(realDbService);
```

### 5. Error Handling Flow

```
Service Layer:
  throw new Error('Account not found')
         ↓
Controller Layer:
  catch (e) {
    if (msg.includes('not found'))
      throw new NotFoundException(e.message)
  }
```

## Compliance with Architecture Rules

✅ **Rule 1**: Service doesn't use `HttpException`  
✅ **Rule 2**: Controller doesn't call Repository directly  
✅ **Rule 3**: Service → Implementation dependency direction  
✅ **Rule 4**: No drizzle-orm in Service layer  
✅ **Rule 5**: DbService tokens not redefined  
✅ **Rule 6**: Keyword-based error messages  
✅ **Rule 7**: Explicit TypeScript types
