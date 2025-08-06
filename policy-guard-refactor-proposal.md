# PolicyGuard 리팩토링 제안

## 현재 문제
- 팩토리 함수 Guard는 테스트하기 어려움
- API 테스트가 복잡해짐
- 본질적인 API 동작 테스트에서 벗어남

## 제안: 메타데이터 기반 Guard

### 1. 메타데이터 데코레이터 생성
```typescript
// policy-action.decorator.ts
export const POLICY_ACTION_KEY = 'policyAction';

export const RequirePolicy = (action: string) => 
  SetMetadata(POLICY_ACTION_KEY, action);
```

### 2. 단순한 Guard 구현
```typescript
// policy.guard.ts
@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private policyEngine: PolicyEngineService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<string>(POLICY_ACTION_KEY, context.getHandler());
    if (!action) return true;
    
    // 정책 검증 로직
    const result = await this.policyEngine.validateRequest(userId, action, context);
    
    if (!result.isValid) {
      throw new ForbiddenException(result.violations);
    }
    
    request.policyValidation = result;
    return true;
  }
}
```

### 3. 컨트롤러에서 사용
```typescript
@Post()
@UseGuards(PolicyGuard)
@RequirePolicy('PAUSE_SUBSCRIPTION')
pauseSubscription() {}
```

### 4. 테스트에서 간단하게 모킹
```typescript
.overrideGuard(PolicyGuard).useValue(mockPolicyGuard)
```

## 장점
1. **테스트 친화적**: 표준 NestJS Guard 모킹 방식 사용
2. **API 테스트 집중**: 복잡한 팩토리 함수 모킹 불필요
3. **유지보수성**: Guard 로직과 테스트 로직이 분리됨
4. **가독성**: 데코레이터만 보면 어떤 정책인지 명확

## 단점
1. **데코레이터 추가**: @RequirePolicy 데코레이터 하나 더 필요
2. **약간의 보일러플레이트**: 메타데이터 설정 코드 필요

하지만 API 테스트가 목표라면 장점이 단점보다 훨씬 큽니다.