import { Test } from '@nestjs/testing';
import { DbService } from '@app/db';
import { AvailabilityService } from './availability.service';

describe('AvailabilityService', () => {
  let service: AvailabilityService;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      query: {
        stockSummary: {
          findFirst: jest.fn(),
        },
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        { provide: DbService, useValue: { db: mockDb } },
      ],
    }).compile();

    service = module.get<AvailabilityService>(AvailabilityService);
  });

  describe('getAvailableQuantity', () => {
    const skuId = 'sku-123';
    const warehouseId = 'wh-456';

    it('should return available quantity when stock summary exists', async () => {
      const mockStockSummary = {
        skuId,
        warehouseId,
        availableQuantity: 150,
        reservedQuantity: 50,
        onHandQuantity: 200,
      };

      mockDb.query.stockSummary.findFirst.mockResolvedValue(mockStockSummary);

      const result = await service.getAvailableQuantity(skuId, warehouseId);

      expect(result).toBe(150);
      expect(mockDb.query.stockSummary.findFirst).toHaveBeenCalledWith({
        where: expect.any(Function),
      });
    });

    it('should return 0 when stock summary does not exist', async () => {
      mockDb.query.stockSummary.findFirst.mockResolvedValue(null);

      const result = await service.getAvailableQuantity(skuId, warehouseId);

      expect(result).toBe(0);
    });

    it('should return 0 when availableQuantity is null', async () => {
      const mockStockSummary = {
        skuId,
        warehouseId,
        availableQuantity: null,
        reservedQuantity: 0,
        onHandQuantity: 0,
      };

      mockDb.query.stockSummary.findFirst.mockResolvedValue(mockStockSummary);

      const result = await service.getAvailableQuantity(skuId, warehouseId);

      expect(result).toBe(0);
    });

    it('should work with transaction context', async () => {
      const mockTx = {
        query: {
          stockSummary: {
            findFirst: jest.fn().mockResolvedValue({ availableQuantity: 100 }),
          },
        },
      } as any; // Cast to any to bypass TypeScript strict checking for mock

      const result = await service.getAvailableQuantity(skuId, warehouseId, mockTx);

      expect(result).toBe(100);
      expect(mockTx.query.stockSummary.findFirst).toHaveBeenCalledWith({
        where: expect.any(Function),
      });
    });

    it('should handle negative available quantity', async () => {
      const mockStockSummary = {
        skuId,
        warehouseId,
        availableQuantity: -10, // 음수 재고 (오버셀)
        reservedQuantity: 50,
        onHandQuantity: 40,
      };

      mockDb.query.stockSummary.findFirst.mockResolvedValue(mockStockSummary);

      const result = await service.getAvailableQuantity(skuId, warehouseId);

      expect(result).toBe(-10);
    });

    it('should handle zero available quantity', async () => {
      const mockStockSummary = {
        skuId,
        warehouseId,
        availableQuantity: 0,
        reservedQuantity: 100,
        onHandQuantity: 100,
      };

      mockDb.query.stockSummary.findFirst.mockResolvedValue(mockStockSummary);

      const result = await service.getAvailableQuantity(skuId, warehouseId);

      expect(result).toBe(0);
    });
  });
});