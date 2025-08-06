# 정책 관리 시스템 리팩토링 제안

## 현재 문제점
- 불필요한 Controller 분리 (PolicyManagementController + PolicyValidationController)
- MVP 단계에서 과도한 추상화
- 같은 도메인을 두 개의 엔드포인트로 분산

## 제안하는 구조

### 1. 단일 컨트롤러 통합 (추천)

```typescript
@Controller('policies')
export class PolicyController {
  constructor(
    private readonly policyService: PolicyService,
    private readonly policyEngine: PolicyEngineService
  ) {}

  // === CRUD 작업 ===
  @Get()
  getAllPolicies(@Query() query: GetPoliciesQuery) {
    return this.policyService.getAllPolicies(query);
  }

  @Post()
  createPolicy(@Body() dto: CreatePolicyRequest) {
    return this.policyService.createPolicy(dto);
  }

  @Put(':id')
  updatePolicy(@Param('id') id: string, @Body() dto: UpdatePolicyRequest) {
    return this.policyService.updatePolicy(id, dto);
  }

  @Delete(':id')
  deletePolicy(@Param('id') id: string) {
    return this.policyService.deletePolicy(id);
  }

  // === 검증 작업 ===
  @Post('validate')
  validatePolicy(@Body() dto: PolicyValidationRequest) {
    return this.policyEngine.validateRequest(
      dto.userId, 
      dto.action, 
      dto.context, 
      dto.policyIds
    );
  }

  @Get('user/:userId/applicable')
  getApplicablePolicies(
    @Param('userId') userId: string,
    @Query() context: GetApplicablePoliciesQuery
  ) {
    return this.policyEngine.getApplicablePolicies(userId, context);
  }
}
```

### 2. 검증 로직은 Service Layer에서

```typescript
// 기존 멤버십 서비스에서 직접 사용
@Injectable()
export class PauseService {
  constructor(private readonly policyEngine: PolicyEngineService) {}

  async pauseSubscription(userId: string, pauseData: PauseRequest) {
    // 정책 검증을 서비스 레벨에서 직접 호출
    const validation = await this.policyEngine.validateRequest(
      userId,
      'PAUSE_SUBSCRIPTION',
      { pauseDuration: pauseData.duration }
    );

    if (!validation.isValid) {
      throw new PolicyViolationError(validation.violations);
    }

    // 비즈니스 로직 실행
    return this.executePause(userId, pauseData);
  }
}
```

## 장점

1. **단순성**: 하나의 컨트롤러로 모든 정책 관련 작업 처리
2. **응집성**: 관련된 기능들이 한 곳에 모여있음
3. **유지보수성**: 정책 관련 변경사항을 한 곳에서 관리
4. **MVP 적합성**: 불필요한 추상화 제거

## 마이그레이션 계획

1. PolicyController 생성
2. 기존 두 컨트롤러의 메서드들을 PolicyController로 이동
3. 라우팅 경로 통합
4. 기존 컨트롤러 제거
5. 테스트 업데이트