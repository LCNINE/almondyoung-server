import { Test, TestingModule } from '@nestjs/testing';
import { ContractEventService } from '../contract-event.service';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';

describe('ContractEventService', () => {
  let service: ContractEventService;
  let mockDbService: any;
  let mockTx: any;

  beforeEach(async () => {
    // Mock transaction
    mockTx = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn(),
    };

    // Mock DbService
    mockDbService = {
      db: {
        transaction: jest.fn((callback) => callback(mockTx)),
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractEventService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<ContractEventService>(ContractEventService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addEvent', () => {
    it('이벤트를 성공적으로 추가해야 함', async () => {
      const mockEvent = {
        id: 1,
        contractId: 'contract-123',
        eventType: 'CANCELLED',
        userId: 'user-123',
        metadata: { reason: 'test' },
        batchId: null,
        causedBy: 'USER',
        causedByUserId: 'user-123',
        createdAt: new Date(),
      };

      mockTx.returning.mockResolvedValue([mockEvent]);

      const result = await service.addEvent(
        mockTx,
        'contract-123',
        'CANCELLED',
        { reason: 'test' },
        'USER',
        'user-123',
      );

      expect(result).toEqual(mockEvent);
      expect(mockTx.insert).toHaveBeenCalled();
      expect(mockTx.values).toHaveBeenCalledWith({
        contractId: 'contract-123',
        eventType: 'CANCELLED',
        userId: 'user-123',
        metadata: { reason: 'test' },
        batchId: null,
        causedBy: 'USER',
        causedByUserId: null,
      });
    });

    it('batchId와 causedByUserId를 포함하여 이벤트를 추가해야 함', async () => {
      const mockEvent = {
        id: 2,
        contractId: 'contract-456',
        eventType: 'REFUND_REQUESTED',
        userId: 'user-456',
        metadata: { amount: 10000 },
        batchId: 'batch-123',
        causedBy: 'ADMIN',
        causedByUserId: 'admin-123',
        createdAt: new Date(),
      };

      mockTx.returning.mockResolvedValue([mockEvent]);

      const result = await service.addEvent(
        mockTx,
        'contract-456',
        'REFUND_REQUESTED',
        { amount: 10000 },
        'ADMIN',
        'user-456',
        'batch-123',
        'admin-123',
      );

      expect(result).toEqual(mockEvent);
      expect(mockTx.values).toHaveBeenCalledWith({
        contractId: 'contract-456',
        eventType: 'REFUND_REQUESTED',
        userId: 'user-456',
        metadata: { amount: 10000 },
        batchId: 'batch-123',
        causedBy: 'ADMIN',
        causedByUserId: 'admin-123',
      });
    });
  });

  describe('getContractEvents', () => {
    it('계약의 모든 이벤트를 조회해야 함', async () => {
      const mockEvents = [
        {
          id: 1,
          contractId: 'contract-123',
          eventType: 'CREATED',
          userId: 'user-123',
          metadata: {},
          batchId: null,
          causedBy: 'SYSTEM',
          causedByUserId: null,
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 2,
          contractId: 'contract-123',
          eventType: 'CANCELLED',
          userId: 'user-123',
          metadata: { reason: 'test' },
          batchId: null,
          causedBy: 'USER',
          causedByUserId: 'user-123',
          createdAt: new Date('2024-01-02'),
        },
      ];

      mockDbService.db.orderBy.mockResolvedValue(mockEvents);

      const result = await service.getContractEvents('contract-123');

      expect(result).toEqual(mockEvents);
      expect(mockDbService.db.select).toHaveBeenCalled();
      expect(mockDbService.db.from).toHaveBeenCalled();
      expect(mockDbService.db.where).toHaveBeenCalled();
      expect(mockDbService.db.orderBy).toHaveBeenCalled();
    });

    it('이벤트가 없으면 빈 배열을 반환해야 함', async () => {
      mockDbService.db.orderBy.mockResolvedValue([]);

      const result = await service.getContractEvents('contract-999');

      expect(result).toEqual([]);
    });
  });

  describe('getEventsByType', () => {
    it('특정 타입의 이벤트만 조회해야 함', async () => {
      const mockEvents = [
        {
          id: 3,
          contractId: 'contract-123',
          eventType: 'REFUND_REQUESTED',
          userId: 'user-123',
          metadata: { amount: 10000 },
          batchId: null,
          causedBy: 'SYSTEM',
          causedByUserId: null,
          createdAt: new Date(),
        },
      ];

      mockDbService.db.orderBy.mockResolvedValue(mockEvents);

      const result = await service.getEventsByType(
        'contract-123',
        'REFUND_REQUESTED',
      );

      expect(result).toEqual(mockEvents);
      expect(mockDbService.db.where).toHaveBeenCalled();
    });
  });
});
