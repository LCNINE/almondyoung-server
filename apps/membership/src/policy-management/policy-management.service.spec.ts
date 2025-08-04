import { Test, TestingModule } from '@nestjs/testing';
import { PolicyManagementService } from './policy-management.service';
import { DbService } from '@app/db';
import * as schema from '../shared/schemas/entities/schema';

describe('PolicyManagementService', () => {
  let service: PolicyManagementService;
  let dbService: jest.Mocked<DbService<typeof schema>>;

  beforeEach(async () => {
    const mockDbService = {
      db: {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  offset: jest.fn().mockResolvedValue([]),
                }),
              }),
              limit: jest.fn().mockReturnValue({
                then: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        insert: jest.fn().mockReturnValue({
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockReturnValue({
              then: jest.fn().mockResolvedValue([{ id: 'new-policy-id' }]),
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        }),
        transaction: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyManagementService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<PolicyManagementService>(PolicyManagementService);
    dbService = module.get(DbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllPolicies', () => {
    it('should return empty policy list when no policies exist', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn()
        .mockReturnValueOnce(mockQueryBuilder) // For count query
        .mockReturnValueOnce(mockQueryBuilder); // For data query

      // Act
      const result = await service.getAllPolicies();

      // Assert
      expect(result.policies).toEqual([]);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(0);
    });

    it('should handle query parameters correctly', async () => {
      // Arrange
      const query = { ruleType: 'MAX_PAUSES_PER_YEAR', isActive: true, page: 2, limit: 10 };

      // Act
      const result = await service.getAllPolicies(query);

      // Assert
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });
  });

  describe('getPolicyById', () => {
    it('should return null when policy not found', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockResolvedValue([]), // Empty array means no policy found
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getPolicyById('non-existent-id');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('createPolicy', () => {
    it('should create a new policy successfully', async () => {
      // Arrange
      const createPolicyDto = {
        ruleType: 'MAX_PAUSES_PER_YEAR' as const,
        ruleValue: { maxPauses: 2 },
      };

      // Mock checkDuplicatePolicy to not throw error
      jest.spyOn(service as any, 'checkDuplicatePolicy').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'validatePolicyInput').mockResolvedValue(undefined);

      // Mock getPolicyById to return the created policy
      jest.spyOn(service, 'getPolicyById').mockResolvedValue({
        id: 'new-policy-id',
        ruleType: 'MAX_PAUSES_PER_YEAR',
        ruleValue: { maxPauses: 2 },
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // Act
      const result = await service.createPolicy(createPolicyDto);

      // Assert
      expect(result).toBeDefined();
      expect(result?.id).toBe('new-policy-id');
      expect(result?.ruleType).toBe('MAX_PAUSES_PER_YEAR');
    });
  });

  describe('updatePolicy', () => {
    it('should update an existing policy successfully', async () => {
      // Arrange
      const updateDto = { ruleValue: { maxPauses: 3 } };

      // Mock getPolicyById to return existing policy first, then updated policy
      jest.spyOn(service, 'getPolicyById')
        .mockResolvedValueOnce({
          id: 'policy-id',
          ruleType: 'MAX_PAUSES_PER_YEAR',
          ruleValue: { maxPauses: 2 },
          isActive: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'policy-id',
          ruleType: 'MAX_PAUSES_PER_YEAR',
          ruleValue: { maxPauses: 3 },
          isActive: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });

      // Act
      const result = await service.updatePolicy('policy-id', updateDto);

      // Assert
      expect(result).toBeDefined();
      expect(result?.ruleValue).toEqual({ maxPauses: 3 });
    });
  });

  describe('deactivatePolicy', () => {
    it('should deactivate an existing policy successfully', async () => {
      // Arrange
      jest.spyOn(service, 'getPolicyById').mockResolvedValue({
        id: 'policy-id',
        ruleType: 'MAX_PAUSES_PER_YEAR',
        ruleValue: { maxPauses: 2 },
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // Act
      const result = await service.deactivatePolicy('policy-id');

      // Assert
      expect(result).toEqual({
        success: true,
        message: 'Policy successfully deactivated',
      });
    });

    it('should handle already inactive policy', async () => {
      // Arrange
      jest.spyOn(service, 'getPolicyById').mockResolvedValue({
        id: 'policy-id',
        ruleType: 'MAX_PAUSES_PER_YEAR',
        ruleValue: { maxPauses: 2 },
        isActive: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // Act
      const result = await service.deactivatePolicy('policy-id');

      // Assert
      expect(result).toEqual({
        success: true,
        message: 'Policy is already inactive',
      });
    });
  });
});