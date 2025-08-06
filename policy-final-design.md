# 정책 관리 시스템 최종 설계

## 컨트롤러 구조

### 1. 관리자용 정책 관리
```typescript
@Controller('admin/policies')
export class AdminPolicyController {
  @Get() getAllPolicies()
  @Post() createPolicy()
  @Put(':id') updatePolicy()
  @Delete(':id') deletePolicy()
  
  // 정책 변경 시 알림 서비스에 이벤트 발행
  private async notifyPolicyChange(policy: Policy) {
    await this.eventPublisher.publish('policy.changed', {
      policyId: policy.id,
      affectedUsers: await this.getAffectedUsers(policy)
    });
  }
}
```

### 2. 사용자용 정책 정보 조회
```typescript
@Controller('policies')
export class PolicyController {
  @Get('my-limits')
  getMyPolicyLimits(@CurrentUser() user) {
    // pauseUsageTracker + subscriptionPolicies 조합
  }
}
```

### 3. MSA용 정책 검증 (내부 API)
```typescript
@Controller('internal/policies')
export class InternalPolicyController {
  @Post('validate')
  validatePolicy(@Body() dto: PolicyValidationRequest) {
    // 다른 마이크로서비스에서 호출
  }
  
  @Post('validate/plan-change')
  validatePlanChange(@Body() dto: PlanChangeValidationRequest) {
    // 결제 서비스에서 결제 전 호출
  }
}
```

## 커스텀 데코레이터 패턴

### PolicyCheck 데코레이터
```typescript
export const PolicyCheck = (action: string, options?: PolicyOptions) => {
  return applyDecorators(
    SetMetadata('policyAction', action),
    SetMetadata('policyOptions', options),
    UseInterceptors(PolicyInterceptor)
  );
};

// 사용 예시
@Controller('subscriptions')
export class SubscriptionController {
  @Post('pause')
  @PolicyCheck('PAUSE_SUBSCRIPTION')
  pauseSubscription(@Body() dto: PauseRequest) {
    // 정책 검증이 자동으로 완료된 상태
    return this.pauseService.pauseSubscription(dto);
  }
  
  @Post('plan-change')
  @PolicyCheck('PLAN_CHANGE')
  changePlan(@Body() dto: PlanChangeRequest) {
    // 정책 검증 완료 후 실행
    return this.planService.changePlan(dto);
  }
}
```

### PolicyInterceptor 구현
```typescript
@Injectable()
export class PolicyInterceptor implements NestInterceptor {
  constructor(
    private policyEngine: PolicyEngineService,
    private reflector: Reflector
  ) {}
  
  async intercept(context: ExecutionContext, next: CallHandler) {
    const action = this.reflector.get<string>('policyAction', context.getHandler());
    const options = this.reflector.get<PolicyOptions>('policyOptions', context.getHandler());
    
    if (!action) return next.handle();
    
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    
    // 정책 검증 실행
    const result = await this.policyEngine.validateRequest(
      userId,
      action,
      { ...request.body, ...request.params, ...request.query }
    );
    
    if (!result.isValid) {
      throw new PolicyViolationException(result.violations);
    }
    
    // 검증 결과를 request에 추가 (필요시 사용)
    request.policyValidation = result;
    
    return next.handle();
  }
}
```

## 장점

1. **선언적 정책 검증**: `@PolicyCheck('ACTION')` 한 줄로 정책 검증
2. **관심사 분리**: 비즈니스 로직과 정책 검증 로직 분리
3. **재사용성**: 모든 컨트롤러에서 동일한 패턴 사용
4. **유지보수성**: 정책 검증 로직 변경 시 한 곳만 수정
5. **테스트 용이성**: 인터셉터만 모킹하면 정책 검증 우회 가능

## 사용 시나리오

### 일시정지
```typescript
@Post('pause')
@PolicyCheck('PAUSE_SUBSCRIPTION')
pauseSubscription(@Body() dto: PauseRequest) {
  // MAX_PAUSES_PER_YEAR, MIN_PAUSE_DURATION_DAYS 등 자동 검증
}
```

### 플랜 변경
```typescript
@Post('plan-change')
@PolicyCheck('PLAN_CHANGE')
changePlan(@Body() dto: PlanChangeRequest) {
  // PLAN_CHANGE_COOLDOWN_DAYS, ALLOWED_PLAN_CHANGES 등 자동 검증
}
```

### 결제 전 검증 (MSA)
```typescript
// 결제 서비스에서 호출
POST /internal/policies/validate/plan-change
{
  "userId": "user-123",
  "fromPlan": "basic",
  "toPlan": "premium"
}
```