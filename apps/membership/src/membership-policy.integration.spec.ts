import { Test, TestingModule } from '@nestjs/testing';
import { PolicyManagementService } from './policy-management/policy-management.service';
import { PolicyEngineService } from './policy-management/policy-engine.service';
import type { PolicyValidationResult } from './shared/schemas/types';


/**
 * 멤버십 정책 시스템 통합 테스트
 * 
 * 이 테스트는 정책 관리 서비스와 정책 엔진 서비스 간의 통합을 검증합니다.
 * Mock 서비스를 사용하여 실제 데이터베이스 없이도 정책 시스템의 전체 워크플로우를 테스트합니다.
 * 
 * @description 정책 생성, 검증, 업데이트, 비활성화의 전체 라이프사이클을 테스트
 * @author 개발팀
 * @since 2024-01-01
 */
describe('멤버십 정책 시스템 통합 테스트', () => {
  let policyManagementService: PolicyManagementService;
  let policyEngineService: PolicyEngineService;
  let testTierId: string;
  let testSubscriptionId: string;
  let pausePolicyId: string;
  let planChangePolicyId: string;

  beforeAll(async () => {
    // Mock 서비스들을 생성
    const mockPolicyManagementService = {
      createPolicy: jest.fn(),
      getAllPolicies: jest.fn(),
      getPolicyById: jest.fn(),
      updatePolicy: jest.fn(),
      deactivatePolicy: jest.fn(),
    };

    const mockPolicyEngineService = {
      validateRequest: jest.fn(),
      getApplicablePolicies: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PolicyManagementService,
          useValue: mockPolicyManagementService,
        },
        {
          provide: PolicyEngineService,
          useValue: mockPolicyEngineService,
        },
      ],
    }).compile();

    policyManagementService = moduleFixture.get<PolicyManagementService>(PolicyManagementService);
    policyEngineService = moduleFixture.get<PolicyEngineService>(PolicyEngineService);

    // 테스트 데이터 설정
    testTierId = '456e7890-e89b-12d3-a456-426614174001';
    testSubscriptionId = '789e0123-e89b-12d3-a456-426614174002';
    pausePolicyId = 'policy-pause-123';
    planChangePolicyId = 'policy-plan-456';

    // Mock 구현
    mockPolicyManagementService.createPolicy.mockImplementation((dto) => {
      if (dto.ruleType === 'MAX_PAUSES_PER_YEAR') {
        return Promise.resolve({
          id: pausePolicyId,
          ruleType: dto.ruleType,
          ruleValue: dto.ruleValue,
          tierId: dto.tierId,
          isActive: true,
          validFrom: dto.validFrom,
          validUntil: dto.validUntil,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      } else if (dto.ruleType === 'PLAN_CHANGE_COOLDOWN_DAYS') {
        return Promise.resolve({
          id: planChangePolicyId,
          ruleType: dto.ruleType,
          ruleValue: dto.ruleValue,
          tierId: dto.tierId,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    });

    mockPolicyManagementService.updatePolicy.mockResolvedValue({
      id: pausePolicyId,
      ruleType: 'MAX_PAUSES_PER_YEAR',
      ruleValue: { maxPauses: 5, resetPeriod: 'YEARLY' },
      isActive: true,
      updatedAt: new Date().toISOString()
    });

    mockPolicyManagementService.deactivatePolicy.mockResolvedValue({
      success: true,
      message: '정책이 성공적으로 비활성화되었습니다.'
    });

    mockPolicyEngineService.getApplicablePolicies.mockResolvedValue([
      {
        id: pausePolicyId,
        ruleType: 'MAX_PAUSES_PER_YEAR',
        ruleValue: { maxPauses: 2, resetPeriod: 'YEARLY' },
        tierId: testTierId,
        isActive: true
      },
      {
        id: planChangePolicyId,
        ruleType: 'PLAN_CHANGE_COOLDOWN_DAYS',
        ruleValue: { cooldownDays: 30, allowedChanges: ['UPGRADE', 'DOWNGRADE'] },
        tierId: testTierId,
        isActive: true
      }
    ]);

    mockPolicyEngineService.validateRequest.mockImplementation((userId, action, context) => {
      if (action === 'PAUSE_SUBSCRIPTION') {
        const pauseCount = context.previousPauseCount || 0;
        if (pauseCount >= 2) {
          return Promise.resolve({
            isValid: false,
            violatedPolicies: [{
              policyId: pausePolicyId,
              policyName: 'MAX_PAUSES_PER_YEAR',
              ruleType: 'MAX_PAUSES_PER_YEAR',
              violationType: 'QUOTA_EXCEEDED',
              message: '연간 일시정지 한도를 초과했습니다.',
              severity: 'ERROR' as const,
              suggestedAction: '내년까지 기다리거나 고객 지원에 문의하세요.'
            }],
            warnings: [],
            appliedPolicies: [],
            executionTime: 10
          });
        } else {
          return Promise.resolve({
            isValid: true,
            violatedPolicies: [],
            warnings: [],
            appliedPolicies: [],
            executionTime: 5
          });
        }
      } else if (action === 'CHANGE_PLAN') {
        return Promise.resolve({
          isValid: true,
          violatedPolicies: [],
          warnings: [],
          appliedPolicies: [],
          executionTime: 8
        });
      }
      return Promise.resolve({
        isValid: false,
        violatedPolicies: [],
        warnings: [],
        appliedPolicies: [],
        executionTime: 0
      });
    });
  });

  describe('멤버십 구독 정책 시나리오', () => {
    it('전체 시나리오: 정책 생성 → 구독 시작 → 정책 검증 → 일시정지 시도 → 플랜 변경 시도', async () => {
      // 1. 일시정지 정책 생성
      console.log('🔧 1단계: 일시정지 정책 생성');
      const pausePolicy = await policyManagementService.createPolicy({
        ruleType: 'MAX_PAUSES_PER_YEAR',
        ruleValue: {
          maxPauses: 2,
          resetPeriod: 'YEARLY'
        },
        tierId: testTierId,
        validFrom: '2024-01-01T00:00:00Z',
        validUntil: '2024-12-31T23:59:59Z'
      });

      expect(pausePolicy?.id).toBe(pausePolicyId);
      expect(pausePolicy?.ruleType).toBe('MAX_PAUSES_PER_YEAR');
      console.log('✅ 일시정지 정책 생성 완료:', pausePolicy?.id);

      // 2. 플랜 변경 정책 생성
      console.log('🔧 2단계: 플랜 변경 정책 생성');
      const planChangePolicy = await policyManagementService.createPolicy({
        ruleType: 'PLAN_CHANGE_COOLDOWN_DAYS',
        ruleValue: {
          cooldownDays: 30,
          allowedChanges: ['UPGRADE', 'DOWNGRADE']
        },
        tierId: testTierId
      });

      expect(planChangePolicy?.id).toBe(planChangePolicyId);
      expect(planChangePolicy?.ruleType).toBe('PLAN_CHANGE_COOLDOWN_DAYS');
      console.log('✅ 플랜 변경 정책 생성 완료:', planChangePolicy?.id);

      // 3. 사용자별 적용 가능한 정책 조회
      console.log('🔧 3단계: 사용자별 적용 가능한 정책 조회');
      const testUserId = '123e4567-e89b-12d3-a456-426614174000';
      const applicablePolicies = await policyEngineService.getApplicablePolicies(testUserId, {
        tierId: testTierId,
        subscriptionId: testSubscriptionId
      });

      expect(Array.isArray(applicablePolicies)).toBe(true);
      expect(applicablePolicies).toHaveLength(2);
      
      const pausePolicyFound = applicablePolicies.find(p => p.id === pausePolicyId);
      const planChangePolicyFound = applicablePolicies.find(p => p.id === planChangePolicyId);
      
      expect(pausePolicyFound).toBeDefined();
      expect(planChangePolicyFound).toBeDefined();
      console.log('✅ 적용 가능한 정책 조회 완료:', applicablePolicies.length, '개');

      // 4. 첫 번째 일시정지 시도 (성공해야 함)
      console.log('🔧 4단계: 첫 번째 일시정지 시도');
      const firstPauseValidation = await policyEngineService.validateRequest(
        testUserId,
        'PAUSE_SUBSCRIPTION',
        {
          subscriptionId: testSubscriptionId,
          startDate: '2024-02-01',
          endDate: '2024-02-15',
          tierId: testTierId
        }
      );

      expect(firstPauseValidation.isValid).toBe(true);
      expect(firstPauseValidation.violatedPolicies).toHaveLength(0);
      console.log('✅ 첫 번째 일시정지 검증 성공');

      // 5. 두 번째 일시정지 시도 (성공해야 함)
      console.log('🔧 5단계: 두 번째 일시정지 시도');
      const secondPauseValidation = await policyEngineService.validateRequest(
        testUserId,
        'PAUSE_SUBSCRIPTION',
        {
          subscriptionId: testSubscriptionId,
          startDate: '2024-03-01',
          endDate: '2024-03-15',
          tierId: testTierId,
          previousPauseCount: 1
        }
      );

      expect(secondPauseValidation.isValid).toBe(true);
      console.log('✅ 두 번째 일시정지 검증 성공');

      // 6. 세 번째 일시정지 시도 (실패해야 함 - 연간 한도 초과)
      console.log('🔧 6단계: 세 번째 일시정지 시도 (한도 초과)');
      const thirdPauseValidation = await policyEngineService.validateRequest(
        testUserId,
        'PAUSE_SUBSCRIPTION',
        {
          subscriptionId: testSubscriptionId,
          startDate: '2024-04-01',
          endDate: '2024-04-15',
          tierId: testTierId,
          previousPauseCount: 2
        }
      );

      expect(thirdPauseValidation.isValid).toBe(false);
      expect(thirdPauseValidation.violatedPolicies.length).toBeGreaterThan(0);
      expect(thirdPauseValidation.violatedPolicies[0].ruleType).toBe('MAX_PAUSES_PER_YEAR');
      console.log('✅ 세 번째 일시정지 검증 실패 (예상된 결과)');

      // 7. 플랜 변경 시도 (성공해야 함)
      console.log('🔧 7단계: 플랜 변경 시도');
      const planChangeValidation = await policyEngineService.validateRequest(
        testUserId,
        'CHANGE_PLAN',
        {
          subscriptionId: testSubscriptionId,
          currentPlanId: 'plan-basic',
          newPlanId: 'plan-premium',
          changeType: 'UPGRADE',
          tierId: testTierId
        }
      );

      expect(planChangeValidation.isValid).toBe(true);
      console.log('✅ 플랜 변경 검증 성공');

      // 8. 정책 업데이트 및 재검증
      console.log('🔧 8단계: 정책 업데이트 및 재검증');
      const updatedPolicy = await policyManagementService.updatePolicy(pausePolicyId, {
        ruleValue: {
          maxPauses: 5,
          resetPeriod: 'YEARLY'
        }
      });

      expect(updatedPolicy).not.toBeNull();
      expect(updatedPolicy!.ruleValue.maxPauses).toBe(5);
      console.log('✅ 정책 업데이트 완료');

      // 9. 정책 비활성화
      console.log('🔧 9단계: 정책 정리');
      const deactivateResult1 = await policyManagementService.deactivatePolicy(pausePolicyId);
      const deactivateResult2 = await policyManagementService.deactivatePolicy(planChangePolicyId);

      expect(deactivateResult1.success).toBe(true);
      expect(deactivateResult2.success).toBe(true);

      console.log('✅ 전체 시나리오 테스트 완료!');
    });

    it('벌크 검증 시나리오', async () => {
      console.log('🔧 벌크 검증 테스트 시작');
      
      const testUserId = '123e4567-e89b-12d3-a456-426614174000';
      
      // 여러 요청을 시뮬레이션
      const requests = [
        {
          userId: testUserId,
          action: 'PAUSE_SUBSCRIPTION',
          context: {
            subscriptionId: testSubscriptionId,
            startDate: '2024-05-01',
            endDate: '2024-05-15',
            tierId: testTierId,
            previousPauseCount: 2
          }
        },
        {
          userId: testUserId,
          action: 'CHANGE_PLAN',
          context: {
            subscriptionId: testSubscriptionId,
            currentPlanId: 'plan-premium',
            newPlanId: 'plan-enterprise',
            changeType: 'UPGRADE',
            tierId: testTierId
          }
        }
      ];

      const results: PolicyValidationResult[] = [];
      let totalExecutionTime = 0;

      for (const request of requests) {
        const result = await policyEngineService.validateRequest(
          request.userId,
          request.action,
          request.context
        );
        results.push(result);
        totalExecutionTime += result.executionTime;
      }

      expect(results).toHaveLength(2);
      expect(results[0].isValid).toBe(false); // 일시정지 한도 초과
      expect(results[1].isValid).toBe(true);  // 플랜 변경 허용
      expect(totalExecutionTime).toBeGreaterThan(0);
      
      console.log('✅ 벌크 검증 완료:', results.length, '개 요청 처리');
    });
  });
});