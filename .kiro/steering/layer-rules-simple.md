---
alwaysApply: true
---

# 레이어 아키텍처 핵심 규칙 (간단 버전)

## Service 작성 규칙

- **2-3줄로 비즈니스 흐름만 표현**
- 검증 로직 금지 (Manager가 담당)
- Repository 직접 참조 금지 (Reader를 통해야 함)

```typescript
// ✅ 좋은 Service 예시
async purchaseWithCredit(userId, amount, orderId, intentId, tx) {
  const account = await this.accountReader.findByUserId(userId);
  await this.creditManager.useCreditForPurchase(account, amount, orderId, intentId, tx);
}
```

## 레이어 참조 방향

```
Controller → Service → Reader/Manager → Repository
```

## Implementation Layer 역할

- **Reader**: 데이터 조회 (xxx.reader.ts)
- **Manager**: 검증 + 비즈니스 로직 + DB 접근 (xxx.manager.ts)
- **Creator**: 신규 엔티티 생성 (xxx.creator.ts)
- **Repository**: 도메인당 1개 (xxx.repository.ts)

## 금지 사항

- ❌ Service에서 검증 로직
- ❌ Service에서 Repository 직접 참조
- ❌ 테이블마다 Repository 생성
- ❌ 레이어 건너뛰기 참조
