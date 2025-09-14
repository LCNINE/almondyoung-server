import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DbService } from '@app/db';
import { MovementService } from './movement.service';
import { StockEventStore } from '../../inventory/repositories/stock-event.store';
import { MoveBatchDto } from '../dto/move-batch.dto';

describe('MovementService', () => {
  let service: MovementService;
  let mockDb: any;
  let mockStockEventStore: any;
  let mockTx: any;

  beforeEach(async () => {
    mockTx = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      query: {
        stockLedgers: {
          findFirst: jest.fn(),
        },
        movementJobs: {
          findFirst: jest.fn(),
        },
        movementJobLines: {
          findMany: jest.fn(),
        },
        movementWorkLogs: {
          findMany: jest.fn(),
        },
      },
    };

    mockDb = {
      query: {
        locations: {
          findMany: jest.fn(),
        },
        skus: {
          findMany: jest.fn(),
        },
        movementJobs: {
          findFirst: jest.fn(),
        },
        movementJobLines: {
          findMany: jest.fn(),
        },
        movementWorkLogs: {
          findMany: jest.fn(),
        },
      },
      transaction: jest.fn().mockImplementation((callback) => callback(mockTx)),
    };

    mockStockEventStore = {
      createEvent: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        MovementService,
        { provide: DbService, useValue: { db: mockDb } },
        { provide: StockEventStore, useValue: mockStockEventStore },
      ],
    }).compile();

    service = module.get<MovementService>(MovementService);
  });

  describe('moveImmediately', () => {
    const validMoveBatchDto: MoveBatchDto = {
      warehouseId: 'wh-123',
      actorId: 'actor-123',
      memo: 'Test movement',
      lines: [
        {
          skuId: 'sku-123',
          fromLocationId: 'loc-from-123',
          toLocationId: 'loc-to-123',
          quantity: 10,
          memo: 'Move test item',
        },
      ],
    };

    const mockLocations = [
      { id: 'loc-from-123', warehouseId: 'wh-123', code: 'A-01' },
      { id: 'loc-to-123', warehouseId: 'wh-123', code: 'B-01' },
    ];

    const mockSkus = [
      { id: 'sku-123', code: 'ITEM-001' },
    ];

    beforeEach(() => {
      mockDb.query.locations.findMany.mockResolvedValue(mockLocations);
      mockDb.query.skus.findMany.mockResolvedValue(mockSkus);
      mockTx.query.stockLedgers.findFirst.mockResolvedValue({ qty: 50 });
      mockTx.returning.mockResolvedValue([
        { id: 'journal-123' },
      ]);
      mockStockEventStore.createEvent.mockResolvedValue({ id: 'event-123' });
    });

    it('should successfully move items between locations', async () => {
      mockTx.returning
        .mockResolvedValueOnce([{ id: 'journal-123' }]) // journal insert
        .mockResolvedValueOnce([{
          id: 'job-123',
          warehouseId: 'wh-123',
          occurredAt: new Date(),
          totalQuantity: 10,
          journalId: 'journal-123',
          actorId: 'actor-123',
          memo: 'Test movement'
        }]) // job insert
        .mockResolvedValueOnce([{
          id: 'line-123',
          jobId: 'job-123',
          skuId: 'sku-123',
          quantity: 10,
          fromLocationId: 'loc-from-123',
          toLocationId: 'loc-to-123',
          eventId: 'event-123',
          memo: 'Move test item'
        }]); // line insert

      const result = await service.moveImmediately(validMoveBatchDto);

      expect(result.job).toMatchObject({
        id: 'job-123',
        warehouseId: 'wh-123',
        totalQuantity: 10,
        journalId: 'journal-123',
        actorId: 'actor-123',
        memo: 'Test movement',
      });

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatchObject({
        id: 'line-123',
        skuId: 'sku-123',
        quantity: 10,
        fromLocationId: 'loc-from-123',
        toLocationId: 'loc-to-123',
        eventId: 'event-123',
      });

      expect(mockStockEventStore.createEvent).toHaveBeenCalledWith({
        journalId: 'journal-123',
        skuId: 'sku-123',
        fromWarehouseId: 'wh-123',
        fromLocationId: 'loc-from-123',
        toWarehouseId: 'wh-123',
        toLocationId: 'loc-to-123',
        fromState: 'ON_HAND',
        toState: 'ON_HAND',
        transitionType: 'MOVE_INSTANT',
        quantity: 10,
        occurredAt: expect.any(Date),
        reason: 'Move test item',
      }, mockTx);
    });

    it('should throw error when no lines provided', async () => {
      const dtoWithoutLines = { ...validMoveBatchDto, lines: [] };

      await expect(service.moveImmediately(dtoWithoutLines)).rejects.toThrow(
        new BadRequestException('lines required')
      );
    });

    it('should throw error when from and to locations are the same', async () => {
      const dtoWithSameLocations = {
        ...validMoveBatchDto,
        lines: [{
          ...validMoveBatchDto.lines[0],
          fromLocationId: 'loc-same-123',
          toLocationId: 'loc-same-123',
        }],
      };

      await expect(service.moveImmediately(dtoWithSameLocations)).rejects.toThrow(
        new BadRequestException('from/to locations must be different')
      );
    });

    it('should throw error when SKU does not exist', async () => {
      mockDb.query.skus.findMany.mockResolvedValue([]); // No SKUs found

      await expect(service.moveImmediately(validMoveBatchDto)).rejects.toThrow(
        new BadRequestException('one or more skuId not found')
      );
    });

    it('should throw error when location does not exist', async () => {
      mockDb.query.locations.findMany.mockResolvedValue([]); // No locations found

      await expect(service.moveImmediately(validMoveBatchDto)).rejects.toThrow(
        new BadRequestException('invalid location id in lines')
      );
    });

    it('should throw error when locations belong to different warehouse', async () => {
      const locationsWithWrongWarehouse = [
        { id: 'loc-from-123', warehouseId: 'wh-different', code: 'A-01' },
        { id: 'loc-to-123', warehouseId: 'wh-123', code: 'B-01' },
      ];
      mockDb.query.locations.findMany.mockResolvedValue(locationsWithWrongWarehouse);

      await expect(service.moveImmediately(validMoveBatchDto)).rejects.toThrow(
        new BadRequestException('all locations must belong to provided warehouseId')
      );
    });

    it('should throw error when quantity is not positive', async () => {
      const dtoWithZeroQuantity = {
        ...validMoveBatchDto,
        lines: [{
          ...validMoveBatchDto.lines[0],
          quantity: 0,
        }],
      };

      await expect(service.moveImmediately(dtoWithZeroQuantity)).rejects.toThrow(
        new BadRequestException('quantity must be positive')
      );
    });

    it('should throw error when insufficient quantity at from location', async () => {
      mockTx.query.stockLedgers.findFirst.mockResolvedValue({ qty: 5 }); // Only 5 available, need 10

      await expect(service.moveImmediately(validMoveBatchDto)).rejects.toThrow(
        new BadRequestException('insufficient quantity at from location')
      );
    });

    it('should handle when no existing stock ledger found', async () => {
      mockTx.query.stockLedgers.findFirst.mockResolvedValue(null); // No stock ledger

      await expect(service.moveImmediately(validMoveBatchDto)).rejects.toThrow(
        new BadRequestException('insufficient quantity at from location')
      );
    });

    it('should handle multiple movement lines', async () => {
      const multiLineDto = {
        ...validMoveBatchDto,
        lines: [
          {
            skuId: 'sku-123',
            fromLocationId: 'loc-from-123',
            toLocationId: 'loc-to-123',
            quantity: 10,
            memo: 'First item',
          },
          {
            skuId: 'sku-456',
            fromLocationId: 'loc-from-123',
            toLocationId: 'loc-to-123',
            quantity: 5,
            memo: 'Second item',
          },
        ],
      };

      const multiMockSkus = [
        { id: 'sku-123', code: 'ITEM-001' },
        { id: 'sku-456', code: 'ITEM-002' },
      ];

      mockDb.query.skus.findMany.mockResolvedValue(multiMockSkus);
      mockTx.query.stockLedgers.findFirst.mockResolvedValue({ qty: 50 });

      mockTx.returning
        .mockResolvedValueOnce([{ id: 'journal-123' }]) // journal
        .mockResolvedValueOnce([{
          id: 'job-123',
          warehouseId: 'wh-123',
          occurredAt: new Date(),
          totalQuantity: 15, // 10 + 5
          journalId: 'journal-123',
          actorId: 'actor-123',
          memo: 'Test movement'
        }]) // job
        .mockResolvedValueOnce([{ id: 'line-123' }]) // first line
        .mockResolvedValueOnce([{ id: 'line-456' }]); // second line

      const result = await service.moveImmediately(multiLineDto);

      expect(result.job.totalQuantity).toBe(15);
      expect(result.lines).toHaveLength(2);
      expect(mockStockEventStore.createEvent).toHaveBeenCalledTimes(2);
    });

    it('should use provided occurredAt timestamp', async () => {
      const customTime = '2024-01-15T10:30:00Z';
      const dtoWithCustomTime = { ...validMoveBatchDto, occurredAt: customTime };

      mockTx.returning
        .mockResolvedValueOnce([{ id: 'journal-123' }])
        .mockResolvedValueOnce([{
          id: 'job-123',
          warehouseId: 'wh-123',
          occurredAt: new Date(customTime),
          totalQuantity: 10,
          journalId: 'journal-123',
          actorId: 'actor-123',
          memo: 'Test movement'
        }])
        .mockResolvedValueOnce([{ id: 'line-123' }]);

      await service.moveImmediately(dtoWithCustomTime);

      expect(mockStockEventStore.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          occurredAt: new Date(customTime),
        }),
        mockTx
      );
    });

    it('should handle when no memo provided at line level', async () => {
      const dtoWithoutLineMemo = {
        ...validMoveBatchDto,
        lines: [{
          ...validMoveBatchDto.lines[0],
          memo: undefined,
        }],
      };

      mockTx.returning
        .mockResolvedValueOnce([{ id: 'journal-123' }])
        .mockResolvedValueOnce([{
          id: 'job-123',
          warehouseId: 'wh-123',
          occurredAt: new Date(),
          totalQuantity: 10,
          journalId: 'journal-123',
          actorId: 'actor-123',
          memo: 'Test movement'
        }])
        .mockResolvedValueOnce([{ id: 'line-123' }]);

      await service.moveImmediately(dtoWithoutLineMemo);

      expect(mockStockEventStore.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'Test movement', // Should fall back to job memo
        }),
        mockTx
      );
    });
  });

  describe('getJobById', () => {
    const jobId = 'job-123';

    it('should return job with lines when job exists', async () => {
      const mockJob = {
        id: jobId,
        warehouseId: 'wh-123',
        occurredAt: new Date(),
        totalQuantity: 10,
        journalId: 'journal-123',
        actorId: 'actor-123',
        memo: 'Test job',
      };

      const mockLines = [
        {
          id: 'line-123',
          jobId: jobId,
          skuId: 'sku-123',
          quantity: 10,
          fromLocationId: 'loc-from-123',
          toLocationId: 'loc-to-123',
          eventId: 'event-123',
          memo: 'Test line',
        },
      ];

      mockDb.query.movementJobs.findFirst.mockResolvedValue(mockJob);
      mockDb.query.movementJobLines.findMany.mockResolvedValue(mockLines);

      const result = await service.getJobById(jobId);

      expect(result.job).toEqual(mockJob);
      expect(result.lines).toEqual(mockLines);
    });

    it('should throw error when job does not exist', async () => {
      mockDb.query.movementJobs.findFirst.mockResolvedValue(null);

      await expect(service.getJobById(jobId)).rejects.toThrow(
        new BadRequestException('movement job not found')
      );
    });
  });

  describe('getMovementHistory', () => {
    const mockWorkLogs = [
      {
        id: 'log-123',
        type: 'MOVE',
        jobId: 'job-123',
        skuId: 'sku-123',
        warehouseId: 'wh-123',
        fromLocationId: 'loc-from-123',
        toLocationId: 'loc-to-123',
        quantity: 10,
        timestamp: new Date('2024-01-15'),
      },
      {
        id: 'log-456',
        type: 'MOVE',
        jobId: 'job-456',
        skuId: 'sku-456',
        warehouseId: 'wh-123',
        fromLocationId: 'loc-from-456',
        toLocationId: 'loc-to-456',
        quantity: 5,
        timestamp: new Date('2024-01-14'),
      },
    ];

    beforeEach(() => {
      mockDb.query.movementWorkLogs.findMany.mockResolvedValue(mockWorkLogs);
    });

    it('should return movement history with default parameters', async () => {
      const result = await service.getMovementHistory();

      expect(result).toEqual(mockWorkLogs);
      expect(mockDb.query.movementWorkLogs.findMany).toHaveBeenCalledWith({
        where: expect.any(Function),
        orderBy: expect.any(Function),
      });
    });

    it('should filter by skuId when provided', async () => {
      await service.getMovementHistory({ skuId: 'sku-123' });

      expect(mockDb.query.movementWorkLogs.findMany).toHaveBeenCalledWith({
        where: expect.any(Function),
        orderBy: expect.any(Function),
      });
    });

    it('should filter by warehouseId when provided', async () => {
      await service.getMovementHistory({ warehouseId: 'wh-123' });

      expect(mockDb.query.movementWorkLogs.findMany).toHaveBeenCalledWith({
        where: expect.any(Function),
        orderBy: expect.any(Function),
      });
    });

    it('should use custom days parameter', async () => {
      await service.getMovementHistory({ days: 30 });

      expect(mockDb.query.movementWorkLogs.findMany).toHaveBeenCalledWith({
        where: expect.any(Function),
        orderBy: expect.any(Function),
      });
    });

    it('should handle combined filters', async () => {
      await service.getMovementHistory({
        skuId: 'sku-123',
        warehouseId: 'wh-123',
        days: 14
      });

      expect(mockDb.query.movementWorkLogs.findMany).toHaveBeenCalledWith({
        where: expect.any(Function),
        orderBy: expect.any(Function),
      });
    });

    it('should return empty array when no history found', async () => {
      mockDb.query.movementWorkLogs.findMany.mockResolvedValue([]);

      const result = await service.getMovementHistory();

      expect(result).toEqual([]);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle database transaction rollback on error', async () => {
      const dto = {
        warehouseId: 'wh-123',
        actorId: 'actor-123',
        memo: 'Test movement',
        lines: [
          {
            skuId: 'sku-123',
            fromLocationId: 'loc-from-123',
            toLocationId: 'loc-to-123',
            quantity: 10,
          },
        ],
      };

      mockDb.query.locations.findMany.mockResolvedValue([
        { id: 'loc-from-123', warehouseId: 'wh-123' },
        { id: 'loc-to-123', warehouseId: 'wh-123' },
      ]);
      mockDb.query.skus.findMany.mockResolvedValue([{ id: 'sku-123' }]);

      // Mock transaction to throw error before it gets to stock event creation
      mockTx.returning.mockRejectedValue(new Error('Event creation failed'));

      await expect(service.moveImmediately(dto)).rejects.toThrow('Event creation failed');
    });

    it('should handle exact quantity match (zero remaining after move)', async () => {
      const dto = {
        warehouseId: 'wh-123',
        lines: [{
          skuId: 'sku-123',
          fromLocationId: 'loc-from-123',
          toLocationId: 'loc-to-123',
          quantity: 50, // Exact match with available quantity
        }],
      };

      mockDb.query.locations.findMany.mockResolvedValue([
        { id: 'loc-from-123', warehouseId: 'wh-123' },
        { id: 'loc-to-123', warehouseId: 'wh-123' },
      ]);
      mockDb.query.skus.findMany.mockResolvedValue([{ id: 'sku-123' }]);
      mockTx.query.stockLedgers.findFirst.mockResolvedValue({ qty: 50 }); // Exact match

      mockTx.returning
        .mockResolvedValueOnce([{ id: 'journal-123' }])
        .mockResolvedValueOnce([{
          id: 'job-123',
          warehouseId: 'wh-123',
          occurredAt: new Date(),
          totalQuantity: 50,
          journalId: 'journal-123',
          actorId: undefined,
          memo: undefined
        }])
        .mockResolvedValueOnce([{ id: 'line-123' }]);

      const result = await service.moveImmediately(dto);

      expect(result.job.totalQuantity).toBe(50);
      expect(mockStockEventStore.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 50,
        }),
        mockTx
      );
    });
  });
});