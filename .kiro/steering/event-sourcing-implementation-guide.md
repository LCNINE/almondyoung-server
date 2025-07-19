# Event Sourcing Implementation Guide

## 🎯 핵심 원칙

### Event Sourcing Pattern
- **NO DIRECT UPDATES**: Never update balances, statuses, or aggregates directly
- **EVENT-ONLY WRITES**: All state changes create new immutable events
- **CALCULATED STATE**: All current state is calculated from event streams
- **IMMUTABLE EVENTS**: Once created, events are never modified or deleted

### 실제 구현 예시
```typescript
// ❌ 잘못된 방법: 직접 잔액 업데이트
await db.update(bnplAccount).set({ 
  currentBalance: sql`${bnplAccount.currentBalance} - ${amount}` 
});

// ✅ 올바른 방법: 이벤트만 생성, 잔액은 실시간 계산
await db.insert(bnplTransaction).values({
  transactionType: 'CREDIT',
  amount: amount,
  // 잔액은 저장하지 않음
});

// 잔액은 이벤트 스트림에서 계산
const currentBalance = await calculateCurrentBalance(accountId);
```

## 🚨 자주 발생하는 실수들 (오답노트)

### 1. 타입 정합성 문제
**문제**: Drizzle 스키마와 Zod 스키마 간 타입 불일치
**해결**: 스키마 작업 시 반드시 두 파일을 동시에 수정

```typescript
// Drizzle Schema
metadata: text('metadata'), // string | null

// Zod Schema (잘못된 예)
metadata: z.record(z.any()).optional(), // Record<string, any>

// Zod Schema (올바른 예)
metadata: z.string().nullable().optional(), // string | null
```

### 2. Event Sourcing 원칙 위반
**문제**: `currentBalance` 필드를 DB에 저장하려고 시도
**해결**: 모든 잔액/상태는 이벤트에서 실시간 계산

```typescript
// ❌ 잘못된 스키마
export const bnplAccount = pgTable('bnpl_account', {
  currentBalance: numeric('current_balance'), // 저장하면 안됨
});

// ✅ 올바른 스키마
export const bnplAccount = pgTable('bnpl_account', {
  // currentBalance 필드 없음 - 실시간 계산
});
```

### 3. ID 타입 혼동
**문제**: ULID와 TSID 사용 구분 없이 사용
**해결**: 명확한 구분 기준 적용

```typescript
// TSID (21자리): 배치 CMS용 (HMS 연동)
bnplAccountId: varchar('id', { length: 21 })

// ULID (26자리): 나머지 모든 ID
paymentEventId: varchar('id', { length: 26 })
```

### 4. Metadata 처리 실수
**문제**: 객체를 직접 DB에 저장하려고 시도
**해결**: JSON 문자열로 변환 후 저장

```typescript
// ❌ 잘못된 방법
const dbPayload = {
  metadata: { type: 'PARTIAL_PAYMENT' } // 객체 직접 저장
};

// ✅ 올바른 방법
const dbPayload = {
  metadata: JSON.stringify({ type: 'PARTIAL_PAYMENT' }) // JSON 문자열로 변환
};
```

## 🛠️ 구현 체크리스트

### Event Sourcing 구현 시
- [ ] `currentBalance` 같은 계산된 값을 DB에 저장하지 않았는가?
- [ ] 모든 상태 변경이 이벤트로 기록되는가?
- [ ] 실시간 계산 메서드가 구현되어 있는가?
- [ ] 이벤트는 불변성을 보장하는가?

### 타입 정합성 확인 시
- [ ] Drizzle 스키마와 Zod 스키마가 일치하는가?
- [ ] nullable/optional 처리가 동일한가?
- [ ] ID 타입이 올바르게 구분되어 있는가?
- [ ] `npm run build`가 성공하는가?

### 메타데이터 처리 시
- [ ] 서비스 레이어에서는 객체로 받는가?
- [ ] DB 저장 시 JSON 문자열로 변환하는가?
- [ ] 응답 시 다시 객체로 파싱하는가?

## 🔧 디버깅 가이드

### 타입 에러 발생 시
1. Drizzle 스키마 확인
2. Zod 스키마 확인
3. 두 스키마 간 차이점 식별
4. 동시에 수정

### Event Sourcing 문제 시
1. 직접 업데이트 코드 검색: `update.*set`
2. 계산된 필드 저장 여부 확인
3. 실시간 계산 로직 구현 확인

### 빌드 실패 시
1. `npm run build` 실행
2. 타입 에러 메시지 분석
3. 스키마 정합성 확인
4. 단계별 수정 후 재빌드