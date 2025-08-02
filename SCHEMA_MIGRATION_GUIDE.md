# Schema Migration Guide

## 개요

기존의 분산된 타입 정의 구조를 Zod 기반의 통합된 스키마 구조로 마이그레이션했습니다.

## 변경 사항

### 이전 구조 (문제점)
```
shared/
├── dtos/
│   ├── admin.dto.ts          # class-validator + Zod 혼용
│   └── subscription.dto.ts   # Zod 스키마 + 타입 추론
└── types/
    ├── plan.types.ts         # Zod 스키마 + 타입 추론
    └── subscription.types.ts # 일반 TypeScript 인터페이스
```

**문제점:**
- 일관성 없는 검증 방식 (class-validator vs Zod)
- 타입 정의 방식의 혼재 (interface vs Zod schema)
- 중복된 타입 정의
- 유지보수 어려움

### 새로운 구조 (해결책)
```
shared/schemas/
├── entities/
│   └── index.ts      # 데이터베이스 엔티티 스키마
├── requests/
│   └── index.ts      # API 요청 스키마
├── responses/
│   └── index.ts      # API 응답 스키마
└── index.ts          # 통합 export
```

**장점:**
- Zod로 통일된 검증 방식
- 타입 안전성 보장
- 중앙집중식 스키마 관리
- 자동 타입 추론
- 런타임 검증 지원

## 마이그레이션 매핑

### Admin Operations

| 이전 | 새로운 |
|------|--------|
| `CreateTierDto` | `CreateTierRequest` |
| `UpdateTierDto` | `UpdateTierRequest` |
| `CreatePlanDto` | `CreatePlanRequest` |
| `UpdatePlanDto` | `UpdatePlanRequest` |
| `DeactivateDto` | `DeactivatePlanRequest` |

### Subscription Operations

| 이전 | 새로운 |
|------|--------|
| `CreateSubscriptionDto` | `CreateSubscriptionRequest` |
| `UpgradeSubscriptionDto` | `UpgradeSubscriptionRequest` |
| `DowngradeSubscriptionDto` | `DowngradeSubscriptionRequest` |
| `PauseSubscriptionDto` | `PauseSubscriptionRequest` |
| `CancelSubscriptionDto` | `CancelSubscriptionRequest` |

## 사용법

### 1. 스키마 import
```typescript
// 요청 스키마
import {
  CreateTierRequest,
  CreateTierRequestSchema,
} from '../shared/schemas/requests';

// 응답 스키마
import {
  CreateTierResponse,
  CreateTierResponseSchema,
} from '../shared/schemas/responses';

// 엔티티 스키마
import {
  Tier,
  TierSchema,
} from '../shared/schemas/entities';
```

### 2. 컨트롤러에서 사용
```typescript
@Post('tiers')
@UsePipes(new ZodValidationPipe(CreateTierRequestSchema))
async createTier(@Body() request: CreateTierRequest) {
  return this.service.createTier(request);
}
```

### 3. 서비스에서 사용
```typescript
async createTier(request: CreateTierRequest): Promise<CreateTierResponse> {
  // 비즈니스 로직
  return {
    success: true,
    tierId: result.id,
    message: '티어가 생성되었습니다.',
  };
}
```

## 검증 개선사항

### 1. 일관된 검증 규칙
- 모든 UUID 필드: `z.string().uuid()`
- 통화 코드: `z.string().length(3)`
- 티어 코드: `z.string().regex(/^[A-Z_]+$/)`

### 2. 향상된 에러 메시지
```typescript
export const CreateTierRequestSchema = z.object({
  code: z.string()
    .min(1, '티어 코드는 필수입니다')
    .max(20, '티어 코드는 20자 이하여야 합니다')
    .regex(/^[A-Z_]+$/, '티어 코드는 대문자와 언더스코어만 사용할 수 있습니다'),
});
```

### 3. 타입 안전성
```typescript
// 자동 타입 추론
export type CreateTierRequest = z.infer<typeof CreateTierRequestSchema>;
```

## 마이그레이션 체크리스트

- [x] 기존 DTO/타입 파일 삭제
- [x] 새로운 스키마 구조 생성
- [x] 컨트롤러 업데이트
- [x] 서비스 업데이트
- [x] 테스트 통과 확인
- [ ] 다른 모듈 마이그레이션 (필요시)
- [ ] 문서 업데이트

## 주의사항

1. **점진적 마이그레이션**: 한 번에 모든 파일을 변경하지 말고 모듈별로 점진적으로 마이그레이션
2. **테스트 우선**: 각 마이그레이션 후 반드시 테스트 실행
3. **타입 호환성**: 기존 코드와의 호환성을 위해 필요시 임시 타입 정의 사용
4. **문서화**: 변경사항을 팀과 공유하고 문서화

## 다음 단계

1. 다른 모듈들도 동일한 패턴으로 마이그레이션
2. API 문서 자동 생성 (Swagger/OpenAPI)
3. 스키마 버전 관리 시스템 도입
4. 런타임 검증 최적화