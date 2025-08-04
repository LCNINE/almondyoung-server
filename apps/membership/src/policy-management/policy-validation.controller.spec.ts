import { Test, TestingModule } from '@nestjs/testing';
import { PolicyValidationController } from './policy-validation.controller';
import { PolicyEngineService } from './policy-engine.service';

describe('PolicyValidationController', () => {
  let controller: PolicyValidationController;
  let service: jest.Mocked<PolicyEngineService>;

  beforeEach(async () => {
    const mockService = {
      validateRequest: jest.fn(),
      getApplicablePolicies: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PolicyValidationController],
      providers: [
        {
          provide: PolicyEngineService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<PolicyValidationController>(PolicyValidationController);
    service = module.get(PolicyEngineService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('validatePolicyCompliance', () => {
    it('should validate policy compliance', async () => {
      // Arrange
      const validationDto = {
        userId: 'user-123',
        action: 'PAUSE_SUBSCRIPTION',
        context: { subscriptionId: 'sub-123' },
      };
      const mockResult = {
        isValid: true,
        violatedPolicies: [],
        warnings: [],
        appliedPolicies: [{
          policyId: 'policy-1',
          policyName: 'Max Pauses Per Year',
          ruleType: 'MAX_PAUSES_PER_YEAR',
          appliedValue: { limit: 2 },
          context: {}
        }],
        executionTime: 100,
      };
      service.validateRequest.mockResolvedValue(mockResult);

      // Act
      const result = await controller.validatePolicyCompliance(validationDto);

      // Assert
      expect(result).toEqual(mockResult);
      expect(service.validateRequest).toHaveBeenCalledWith(
        'user-123',
        'PAUSE_SUBSCRIPTION',
        { subscriptionId: 'sub-123' },
        undefined
      );
    });

    it('should handle validation failure', async () => {
      // Arrange
      const validationDto = {
        userId: 'user-123',
        action: 'PAUSE_SUBSCRIPTION',
        context: {},
      };
      const mockResult = {
        isValid: false,
        violatedPolicies: [{
          policyId: 'policy-1',
          policyName: 'Max Pauses Per Year',
          ruleType: 'MAX_PAUSES_PER_YEAR',
          violationType: 'QUOTA_EXCEEDED',
          message: 'User has exceeded annual pause limit',
          severity: 'ERROR' as const
        }],
        warnings: [{
          policyId: 'policy-1',
          policyName: 'Max Pauses Per Year',
          message: 'User has exceeded annual pause limit',
          context: {}
        }],
        appliedPolicies: [{
          policyId: 'policy-1',
          policyName: 'Max Pauses Per Year',
          ruleType: 'MAX_PAUSES_PER_YEAR',
          appliedValue: { limit: 2 },
          context: {}
        }],
        executionTime: 120,
      };
      service.validateRequest.mockResolvedValue(mockResult);

      // Act
      const result = await controller.validatePolicyCompliance(validationDto);

      // Assert
      expect(result).toEqual(mockResult);
      expect(result.isValid).toBe(false);
      expect(result.violatedPolicies[0].ruleType).toBe('MAX_PAUSES_PER_YEAR');
    });
  });

  describe('bulkValidatePolicies', () => {
    it('should validate multiple requests', async () => {
      // Arrange
      const bulkValidationDto = {
        requests: [
          { userId: 'user-1', action: 'PAUSE_SUBSCRIPTION', context: {} },
          { userId: 'user-2', action: 'UPGRADE_SUBSCRIPTION', context: {} },
        ],
      };
      const mockResults = [
        { isValid: true, violatedPolicies: [], warnings: [], appliedPolicies: [], executionTime: 50 },
        { 
          isValid: false, 
          violatedPolicies: [{
            policyId: 'policy-2',
            policyName: 'Tier Limit',
            ruleType: 'TIER_SPECIFIC_LIMITS',
            violationType: 'TIER_LIMIT_EXCEEDED',
            message: 'Tier limit exceeded',
            severity: 'ERROR' as const
          }], 
          warnings: [], 
          appliedPolicies: [], 
          executionTime: 75 
        },
      ];
      service.validateRequest
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1]);

      // Act
      const result = await controller.bulkValidatePolicies(bulkValidationDto);

      // Assert
      expect(result).toEqual({
        results: mockResults,
        totalExecutionTime: expect.any(Number)
      });
      expect(service.validateRequest).toHaveBeenCalledTimes(2);
      expect(service.validateRequest).toHaveBeenNthCalledWith(1, 'user-1', 'PAUSE_SUBSCRIPTION', {}, undefined);
      expect(service.validateRequest).toHaveBeenNthCalledWith(2, 'user-2', 'UPGRADE_SUBSCRIPTION', {}, undefined);
    });

    it('should handle empty requests array', async () => {
      // Arrange
      const bulkValidationDto = { requests: [] };

      // Act
      const result = await controller.bulkValidatePolicies(bulkValidationDto);

      // Assert
      expect(result).toEqual({
        results: [],
        totalExecutionTime: 0
      });
      expect(service.validateRequest).not.toHaveBeenCalled();
    });
  });

  describe('getApplicablePolicies', () => {
    it('should return applicable policies for user', async () => {
      // Arrange
      const mockPolicies = [
        { 
          id: 'policy-1', 
          ruleType: 'MAX_PAUSES_PER_YEAR',
          ruleValue: { limit: 2 },
          isActive: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        { 
          id: 'policy-2', 
          ruleType: 'MIN_PAUSE_DURATION_DAYS',
          ruleValue: { minDays: 7 },
          isActive: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ];
      service.getApplicablePolicies.mockResolvedValue(mockPolicies);

      // Act
      const result = await controller.getApplicablePolicies('user-123', {});

      // Assert
      expect(result).toEqual(mockPolicies);
      expect(service.getApplicablePolicies).toHaveBeenCalledWith('user-123', {});
    });

    it('should handle context parameters', async () => {
      // Arrange
      const context = { tierId: 'tier-123', subscriptionId: 'sub-123' };
      service.getApplicablePolicies.mockResolvedValue([]);

      // Act
      const result = await controller.getApplicablePolicies('user-123', context);

      // Assert
      expect(result).toEqual([]);
      expect(service.getApplicablePolicies).toHaveBeenCalledWith('user-123', context);
    });
  });
});