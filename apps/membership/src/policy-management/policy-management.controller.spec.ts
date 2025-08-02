import { Test, TestingModule } from '@nestjs/testing';
import { PolicyManagementController } from './policy-management.controller';
import { PolicyManagementService } from './policy-management.service';

describe('PolicyManagementController', () => {
  let controller: PolicyManagementController;
  let service: jest.Mocked<PolicyManagementService>;

  beforeEach(async () => {
    const mockService = {
      getAllPolicies: jest.fn(),
      getPolicyById: jest.fn(),
      createPolicy: jest.fn(),
      updatePolicy: jest.fn(),
      deactivatePolicy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PolicyManagementController],
      providers: [
        {
          provide: PolicyManagementService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<PolicyManagementController>(PolicyManagementController);
    service = module.get(PolicyManagementService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAllPolicies', () => {
    it('should return all policies', async () => {
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
      service.getAllPolicies.mockResolvedValue(mockPolicies);

      // Act
      const result = await controller.getAllPolicies({});

      // Assert
      expect(result).toEqual(mockPolicies);
      expect(service.getAllPolicies).toHaveBeenCalled();
    });

    it('should handle query parameters', async () => {
      // Arrange
      const query = { active: true, ruleType: 'MAX_PAUSES_PER_YEAR' };
      service.getAllPolicies.mockResolvedValue([]);

      // Act
      const result = await controller.getAllPolicies(query);

      // Assert
      expect(result).toEqual([]);
      expect(service.getAllPolicies).toHaveBeenCalled();
    });
  });

  describe('getPolicyById', () => {
    it('should return policy by id', async () => {
      // Arrange
      const mockPolicy = { 
        id: 'policy-1', 
        ruleType: 'MAX_PAUSES_PER_YEAR',
        ruleValue: { limit: 2 },
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      service.getPolicyById.mockResolvedValue(mockPolicy);

      // Act
      const result = await controller.getPolicyById('policy-1');

      // Assert
      expect(result).toEqual(mockPolicy);
      expect(service.getPolicyById).toHaveBeenCalledWith('policy-1');
    });

    it('should return null when policy not found', async () => {
      // Arrange
      service.getPolicyById.mockResolvedValue(null);

      // Act
      const result = await controller.getPolicyById('non-existent');

      // Assert
      expect(result).toBeNull();
      expect(service.getPolicyById).toHaveBeenCalledWith('non-existent');
    });
  });

  describe('createPolicy', () => {
    it('should create new policy', async () => {
      // Arrange
      const createDto = {
        ruleType: 'MAX_PAUSES_PER_YEAR' as const,
        ruleValue: { limit: 3 },
        tierId: 'tier-123',
      };
      const mockCreatedPolicy = { 
        id: 'policy-new', 
        ...createDto,
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      service.createPolicy.mockResolvedValue(mockCreatedPolicy);

      // Act
      const result = await controller.createPolicy(createDto);

      // Assert
      expect(result).toEqual(mockCreatedPolicy);
      expect(service.createPolicy).toHaveBeenCalledWith(createDto);
    });
  });

  describe('updatePolicy', () => {
    it('should update existing policy', async () => {
      // Arrange
      const updateDto = { ruleValue: { limit: 5 } };
      const mockUpdatedPolicy = { 
        id: 'policy-1', 
        ruleType: 'MAX_PAUSES_PER_YEAR',
        ruleValue: { limit: 5 },
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      service.updatePolicy.mockResolvedValue(mockUpdatedPolicy);

      // Act
      const result = await controller.updatePolicy('policy-1', updateDto);

      // Assert
      expect(result).toEqual(mockUpdatedPolicy);
      expect(service.updatePolicy).toHaveBeenCalledWith('policy-1', updateDto);
    });
  });

  describe('deactivatePolicy', () => {
    it('should deactivate policy', async () => {
      // Arrange
      const mockResult = { success: true, message: 'Policy deactivated' };
      service.deactivatePolicy.mockResolvedValue(mockResult);

      // Act
      const result = await controller.deactivatePolicy('policy-1');

      // Assert
      expect(result).toEqual(mockResult);
      expect(service.deactivatePolicy).toHaveBeenCalledWith('policy-1');
    });
  });
});