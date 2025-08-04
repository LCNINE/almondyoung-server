import { Test, TestingModule } from '@nestjs/testing';
import { PolicyEngineService } from './policy-engine.service';
import { DbService } from '@app/db';


describe('PolicyEngineService', () => {
  let service: PolicyEngineService;
  let mockDbService: any;

  beforeEach(async () => {
    // 완전한 Mock 체인 생성
    const mockQueryBuilder = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      then: jest.fn().mockResolvedValue([]),
    };

    mockDbService = {
      db: {
        select: jest.fn().mockReturnValue(mockQueryBuilder),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyEngineService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<PolicyEngineService>(PolicyEngineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateRequest', () => {
    it('should return default validation result', async () => {
      // Mock the buildPolicyContext method to avoid DB calls
      jest.spyOn(service as any, 'buildPolicyContext').mockResolvedValue({
        userId: 'user-123',
        tierId: null,
        subscriptionId: null,
        currentDate: new Date().toISOString(),
        userMetadata: {},
      });

      jest.spyOn(service as any, 'getApplicablePoliciesInternal').mockResolvedValue([]);

      // Act
      const result = await service.validateRequest('user-123', 'PAUSE_SUBSCRIPTION', {});

      // Assert
      expect(result).toEqual({
        isValid: true,
        violatedPolicies: [],
        warnings: [],
        appliedPolicies: [],
        executionTime: expect.any(Number),
      });
    });

    it('should handle validation with context', async () => {
      // Arrange
      const context = {
        subscriptionId: 'sub-123',
        currentTier: 'PREMIUM',
      };

      // Mock the buildPolicyContext method to avoid DB calls
      jest.spyOn(service as any, 'buildPolicyContext').mockResolvedValue({
        userId: 'user-123',
        tierId: 'tier-123',
        subscriptionId: 'sub-123',
        currentDate: new Date().toISOString(),
        userMetadata: context,
      });

      jest.spyOn(service as any, 'getApplicablePoliciesInternal').mockResolvedValue([]);

      // Act
      const result = await service.validateRequest('user-123', 'UPGRADE_SUBSCRIPTION', context);

      // Assert
      expect(result).toEqual({
        isValid: true,
        violatedPolicies: [],
        warnings: [],
        appliedPolicies: [],
        executionTime: expect.any(Number),
      });
    });
  });

  describe('getApplicablePolicies', () => {
    it('should return empty array for unimplemented method', async () => {
      // Mock the buildPolicyContext method to avoid DB calls
      jest.spyOn(service as any, 'buildPolicyContext').mockResolvedValue({
        userId: 'user-123',
        tierId: null,
        subscriptionId: null,
        currentDate: new Date().toISOString(),
        userMetadata: {},
      });

      jest.spyOn(service as any, 'getApplicablePoliciesInternal').mockResolvedValue([]);

      // Act
      const result = await service.getApplicablePolicies('user-123', {});

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle context parameters', async () => {
      // Arrange
      const context = {
        tierLevel: 3,
        subscriptionType: 'PREMIUM',
      };

      // Mock the buildPolicyContext method to avoid DB calls
      jest.spyOn(service as any, 'buildPolicyContext').mockResolvedValue({
        userId: 'user-123',
        tierId: 'tier-123',
        subscriptionId: null,
        currentDate: new Date().toISOString(),
        userMetadata: context,
      });

      jest.spyOn(service as any, 'getApplicablePoliciesInternal').mockResolvedValue([]);

      // Act
      const result = await service.getApplicablePolicies('user-123', context);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('getApplicablePoliciesWithPriority', () => {
    it('should return policies with priority sorted in descending order', async () => {
      // Arrange
      const mockPolicies = [
        {
          id: 'policy-1',
          ruleType: 'MAX_PAUSES_PER_YEAR',
          ruleValue: { maxPauses: 2 },
          tierId: null,
          isActive: true,
          validFrom: null,
          validUntil: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'policy-2',
          ruleType: 'MIN_PAUSE_DURATION_DAYS',
          ruleValue: { minDays: 7 },
          tierId: 'tier-123',
          isActive: true,
          validFrom: null,
          validUntil: null,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
      ];

      jest.spyOn(service as any, 'buildPolicyContext').mockResolvedValue({
        userId: 'user-123',
        tierId: 'tier-123',
        subscriptionId: null,
        currentDate: new Date().toISOString(),
        userMetadata: {},
      });

      jest.spyOn(service as any, 'getApplicablePoliciesInternal').mockResolvedValue(mockPolicies);
      jest.spyOn(service as any, 'calculatePolicyPriority')
        .mockReturnValueOnce(50) // policy-1
        .mockReturnValueOnce(150); // policy-2 (tier-specific, higher priority)

      // Act
      const result = await service.getApplicablePoliciesWithPriority('user-123', {});

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].policy.id).toBe('policy-2'); // Higher priority first
      expect(result[0].priority).toBe(150);
      expect(result[1].policy.id).toBe('policy-1');
      expect(result[1].priority).toBe(50);
      expect(result[0].isApplicable).toBe(true);
      expect(result[1].isApplicable).toBe(true);
    });
  });

  describe('applyPolicies', () => {
    it('should return DENY when validation fails', async () => {
      // Arrange
      const mockValidationResult = {
        isValid: false,
        violatedPolicies: [{
          policyId: 'policy-1',
          policyName: 'MAX_PAUSES_PER_YEAR',
          ruleType: 'MAX_PAUSES_PER_YEAR',
          violationType: 'QUOTA_EXCEEDED',
          message: 'Exceeded maximum pauses',
          severity: 'ERROR' as const,
        }],
        warnings: [],
        appliedPolicies: [],
        executionTime: 100,
      };

      jest.spyOn(service, 'validateRequest').mockResolvedValue(mockValidationResult);

      // Act
      const result = await service.applyPolicies('user-123', 'PAUSE_SUBSCRIPTION', {});

      // Assert
      expect(result.decision).toBe('DENY');
      expect(result.violations).toHaveLength(1);
      expect(result.metadata.reason).toBe('Policy violations detected');
    });

    it('should return WARNING when warnings exist', async () => {
      // Arrange
      const mockValidationResult = {
        isValid: true,
        violatedPolicies: [],
        warnings: [{
          policyId: 'policy-1',
          policyName: 'PAUSE_WARNING',
          message: 'Consider the timing',
          context: {},
        }],
        appliedPolicies: [],
        executionTime: 100,
      };

      jest.spyOn(service, 'validateRequest').mockResolvedValue(mockValidationResult);

      // Act
      const result = await service.applyPolicies('user-123', 'PAUSE_SUBSCRIPTION', {});

      // Assert
      expect(result.decision).toBe('WARNING');
      expect(result.warnings).toHaveLength(1);
      expect(result.metadata.reason).toBe('Warnings detected but action allowed');
    });

    it('should return ALLOW when all policies are satisfied', async () => {
      // Arrange
      const mockValidationResult = {
        isValid: true,
        violatedPolicies: [],
        warnings: [],
        appliedPolicies: [{
          policyId: 'policy-1',
          policyName: 'MAX_PAUSES_PER_YEAR',
          ruleType: 'MAX_PAUSES_PER_YEAR',
          appliedValue: { currentUsage: 1, maxPauses: 2 },
          context: {},
        }],
        executionTime: 100,
      };

      jest.spyOn(service, 'validateRequest').mockResolvedValue(mockValidationResult);

      // Act
      const result = await service.applyPolicies('user-123', 'PAUSE_SUBSCRIPTION', {});

      // Assert
      expect(result.decision).toBe('ALLOW');
      expect(result.violations).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.metadata.reason).toBe('All policies satisfied');
    });
  });

  describe('checkPolicyCompliance', () => {
    it('should check compliance for multiple policies', async () => {
      // Arrange
      const mockPolicies = [
        {
          id: 'policy-1',
          ruleType: 'MAX_PAUSES_PER_YEAR' as const,
          ruleValue: { maxPauses: 2 },
          tierId: null,
          isActive: true,
          validFrom: null,
          validUntil: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      jest.spyOn(service as any, 'buildPolicyContext').mockResolvedValue({
        userId: 'user-123',
        tierId: null,
        subscriptionId: null,
        currentDate: new Date().toISOString(),
        userMetadata: {},
      });

      jest.spyOn(service as any, 'evaluatePolicyRule').mockResolvedValue({
        violations: [],
        warnings: [],
        applied: true,
        appliedValue: { currentUsage: 1, maxPauses: 2 },
      });

      // Act
      const result = await service.checkPolicyCompliance('user-123', mockPolicies);

      // Assert
      expect(result.isCompliant).toBe(true);
      expect(result.totalPolicies).toBe(1);
      expect(result.compliantPolicies).toBe(1);
      expect(result.violationCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });
  });

  describe('filterPoliciesByTier', () => {
    it('should filter policies by tier', async () => {
      // Arrange
      const mockPolicies = [
        {
          id: 'policy-1',
          ruleType: 'MAX_PAUSES_PER_YEAR' as const,
          ruleValue: { maxPauses: 2 },
          tierId: 'tier-123',
          isActive: true,
          validFrom: null,
          validUntil: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'policy-2',
          ruleType: 'MIN_PAUSE_DURATION_DAYS' as const,
          ruleValue: { minDays: 7 },
          tierId: 'tier-456',
          isActive: true,
          validFrom: null,
          validUntil: null,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
        {
          id: 'policy-3',
          ruleType: 'TIER_SPECIFIC_LIMITS' as const,
          ruleValue: { value: 'test' },
          tierId: null,
          isActive: true,
          validFrom: null,
          validUntil: null,
          createdAt: new Date('2024-01-03'),
          updatedAt: new Date('2024-01-03'),
        },
      ];

      // Act
      const result = await service.filterPoliciesByTier(mockPolicies, 'tier-123');

      // Assert
      expect(result).toHaveLength(2); // tier-123 policy + global policy
      expect(result.map(p => p.id)).toContain('policy-1');
      expect(result.map(p => p.id)).toContain('policy-3');
      expect(result.map(p => p.id)).not.toContain('policy-2');
    });
  });

  describe('refreshPolicyCache', () => {
    it('should clear policy cache and expiry', async () => {
      // Arrange
      const clearSpy = jest.spyOn(service['policyCache'], 'clear');
      const expiryClearSpy = jest.spyOn(service['cacheExpiry'], 'clear');

      // Act
      await service.refreshPolicyCache();

      // Assert
      expect(clearSpy).toHaveBeenCalled();
      expect(expiryClearSpy).toHaveBeenCalled();
    });
  });

  describe('getPolicyFromCache', () => {
    it('should return cached policy if not expired', async () => {
      // Arrange
      const mockPolicy = {
        id: 'policy-1',
        ruleType: 'MAX_PAUSES_PER_YEAR' as const,
        ruleValue: { maxPauses: 2 },
        tierId: null,
        isActive: true,
        validFrom: null,
        validUntil: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      service['policyCache'].set('policy-1', mockPolicy);
      service['cacheExpiry'].set('policy-1', Date.now() + 10000); // 10 seconds from now

      // Act
      const result = await service.getPolicyFromCache('policy-1');

      // Assert
      expect(result).toEqual(mockPolicy);
    });

    it('should return null if policy is expired', async () => {
      // Arrange
      const mockPolicy = {
        id: 'policy-1',
        ruleType: 'MAX_PAUSES_PER_YEAR' as const,
        ruleValue: { maxPauses: 2 },
        tierId: null,
        isActive: true,
        validFrom: null,
        validUntil: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      service['policyCache'].set('policy-1', mockPolicy);
      service['cacheExpiry'].set('policy-1', Date.now() - 1000); // 1 second ago (expired)

      // Act
      const result = await service.getPolicyFromCache('policy-1');

      // Assert
      expect(result).toBeNull();
      expect(service['policyCache'].has('policy-1')).toBe(false);
      expect(service['cacheExpiry'].has('policy-1')).toBe(false);
    });

    it('should return null if policy not in cache', async () => {
      // Act
      const result = await service.getPolicyFromCache('non-existent');

      // Assert
      expect(result).toBeNull();
    });
  });

});