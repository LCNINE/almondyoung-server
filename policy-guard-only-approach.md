# Guard만 사용하는 정책 검증 방식

## 현재 문제점
- PolicyGuard + @PolicyCheck 데코레이터 + PolicyInterceptor = 3중 구조
- 불필요한 복잡성과 중복

## 개선안: Guard + 간단한 메타데이터 데코레이터

### 1. 간단한 메타데이터 데코레이터
```typescript
// policy-action.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const POLICY_ACTION_KEY = 'policyAction';
export const POLICY_OPTIONS_KEY = 'policyOptions';

export const PolicyAction = (action: string, options?: any) => 
  SetMetadata(POLICY_ACTION_KEY, { action, options });

// 사용법
@PolicyAction('PAUSE_SUBSCRIPTION')
@UseGuards(PolicyGuard)
pauseSubscription() {}
```

### 2. PolicyGuard에서 모든 로직 처리
```typescript
@Injectable()
export class PolicyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. 메타데이터에서 액션 추출
    const metadata = this.reflector.get(POLICY_ACTION_KEY, context.getHandler());
    if (!metadata) return true;
    
    // 2. 정책 검증 수행
    const result = await this.policyService.validateRequest(
      userId, 
      metadata.action, 
      context
    );
    
    // 3. 결과 처리
    if (!result.isValid) {
      throw new ForbiddenException(result.violations);
    }
    
    // 4. request에 결과 첨부
    request.policyResult = result;
    return true;
  }
}
```

### 3. 컨트롤러에서 사용
```typescript
@Controller('subscriptions/pause')
export class PauseController {
  @Post()
  @PolicyAction('PAUSE_SUBSCRIPTION')
  @UseGuards(PolicyGuard)
  pauseSubscription(@Req() req: any) {
    // req.policyResult에서 정책 검증 결과 활용
    console.log('남은 횟수:', req.policyResult.remainingQuota);
  }
}
```

## 장점
1. **단순성**: Guard 하나로 모든 처리
2. **명확성**: 정책 검증 로직이 한 곳에 집중
3. **성능**: 불필요한 인터셉터 체인 제거
4. **유지보수**: 수정할 곳이 적음

## 단점
1. **재사용성**: 다른 곳에서 정책 검증 시 Guard 의존
2. **테스트**: Guard를 모킹해야 함

하지만 MVP에서는 장점이 단점보다 훨씬 큽니다!