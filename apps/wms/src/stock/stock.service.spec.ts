// apps/wms/src/stock/stock.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { StockService } from './stock.service';
import { SkuService } from '../sku/sku.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { SkuCreationSource } from '../sku/dto/create-sku.dto';

describe('StockService (재고 서비스)', () => {
  let service: StockService;
  let mockDbService: any;
  let mockDb: any;
  let mockSkuService: any;
  let mockWarehouseService: any;

  beforeEach(async () => {
    mockDb = {
      query: {
        skus: {
          findFirst: jest.fn(),
        },
        stocks: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
        },
        stockEvents: {
          findMany: jest.fn(),
        },
      },
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      transaction: jest.fn((callback) => callback(mockDb)),
    };

    mockDbService = {
      db: mockDb,
    };

    mockSkuService = {
      findSkuById: jest.fn(),
      _createSkuInternal: jest.fn(),
      _updatePreStockSellableInternal: jest.fn(),
    };

    mockWarehouseService = {
      getDefaultWarehouseId: jest.fn().mockReturnValue('warehouse-1'),
      getDefaultWarehouseIdByType: jest.fn().mockReturnValue('warehouse-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: DbService, useValue: mockDbService },
        { provide: SkuService, useValue: mockSkuService },
        { provide: WarehouseService, useValue: mockWarehouseService },
      ],
    }).compile();

    service = module.get<StockService>(StockService);
  });

  describe('재고 생성', () => {
    it('기존 SKU로 재고를 생성해야 한다', async () => {
      const dto = {
        skuName: 'Test SKU',
        inventoryManagement: true,
        warehouseId: 'warehouse-1',
        quantity: 10,
        stockType: 'physical' as const,
      };

      const mockSku = {
        id: 'sku-1',
        name: 'Test SKU',
        inventoryManagement: true,
        preStockSellable: true,
      };

      mockDb.query.skus.findFirst.mockResolvedValue(mockSku);
      mockDb.returning.mockResolvedValueOnce([{ id: 'event-1' }])
        .mockResolvedValueOnce([{ id: 'stock-1', skuId: 'sku-1' }]);

      const result = await service.createStockEntry(dto);

      expect(result).toHaveProperty('id', 'stock-1');
      expect(mockSkuService._updatePreStockSellableInternal).toHaveBeenCalledWith(
        'sku-1',
        false,
        expect.anything()
      );
    });

    it('SKU가 없으면 자동으로 생성해야 한다 (수동 입력)', async () => {
      const dto = {
        skuName: 'New SKU',
        inventoryManagement: true,
        warehouseId: 'warehouse-1',
        quantity: 0,
        stockType: 'physical' as const,
      };

      mockDb.query.skus.findFirst.mockResolvedValue(null);
      mockSkuService._createSkuInternal.mockResolvedValue({
        id: 'new-sku-1',
        name: 'New SKU',
        inventoryManagement: true,
        preStockSellable: true,
      });
      mockDb.returning.mockResolvedValueOnce([{ id: 'event-1' }])
        .mockResolvedValueOnce([{ id: 'stock-1', skuId: 'new-sku-1' }]);

      await service.createStockEntry(dto);

      expect(mockSkuService._createSkuInternal).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New SKU',
          inventoryManagement: true,
          source: SkuCreationSource.MANUAL_ENTRY,
        }),
        mockDb
      );
    });

    it('variantId가 있으면 자동 매칭으로 SKU를 생성해야 한다', async () => {
      const dto = {
        variantId: 'variant-1',
        skuName: 'Auto SKU',
        inventoryManagement: true,
        warehouseId: 'warehouse-1',
        quantity: 0,
        stockType: 'physical' as const,
      };

      mockDb.query.skus.findFirst.mockResolvedValue(null);
      mockSkuService._createSkuInternal.mockResolvedValue({
        id: 'auto-sku-1',
        name: 'Auto SKU',
        inventoryManagement: true,
        preStockSellable: true,
      });
      mockDb.returning.mockResolvedValueOnce([{ id: 'event-1' }])
        .mockResolvedValueOnce([{ id: 'stock-1', skuId: 'auto-sku-1', variantId: 'variant-1' }]);

      const result = await service.createStockEntry(dto);

      expect(mockSkuService._createSkuInternal).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Auto SKU',
          inventoryManagement: true,
          source: SkuCreationSource.AUTO_MATCHING,
        }),
        mockDb
      );
      expect(result).toHaveProperty('variantId', 'variant-1');
    });

    it('음수 수량으로는 재고를 생성할 수 없다', async () => {
      const dto = {
        skuName: 'Test SKU',
        inventoryManagement: true,
        warehouseId: 'warehouse-1',
        quantity: -10,
        stockType: 'physical' as const,
      };

      await expect(service.createStockEntry(dto)).rejects.toThrow(BadRequestException);
    });

    it('재고 관리 대상이 아닌 SKU는 재고를 생성할 수 없다', async () => {
      const dto = {
        skuName: 'Digital SKU',
        warehouseId: 'warehouse-1',
        quantity: 10,
        stockType: 'physical' as const,
      };

      mockDb.query.skus.findFirst.mockResolvedValue({
        id: 'sku-1',
        name: 'Digital SKU',
        inventoryManagement: false,
      });

      await expect(service.createStockEntry(dto)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('입고 처리', () => {
    it('국내 거래처 입고를 처리해야 한다', async () => {
      const dto = {
        skuId: 'sku-1',
        quantity: 50,
        supplierType: 'domestic' as const,
        reason: '국내 거래처 입고',
      };

      mockSkuService.findSkuById.mockResolvedValue({
        id: 'sku-1',
        name: 'Test SKU',
        inventoryManagement: true,
        preStockSellable: false,
      });

      mockDb.returning.mockResolvedValueOnce([{ id: 'event-1' }])
        .mockResolvedValueOnce([{ id: 'stock-1' }]);

      await service.processInbound(dto);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'IN_DOMESTIC',
          quantity: 50,
        })
      );
    });

    it('해외 거래처 입고를 처리해야 한다', async () => {
      const dto = {
        skuId: 'sku-1',
        quantity: 100,
        supplierType: 'overseas' as const,
        reason: '해외 거래처 입고',
      };

      mockSkuService.findSkuById.mockResolvedValue({
        id: 'sku-1',
        name: 'Test SKU',
        inventoryManagement: true,
        preStockSellable: false,
      });

      mockDb.returning.mockResolvedValueOnce([{ id: 'event-1' }])
        .mockResolvedValueOnce([{ id: 'stock-1' }]);

      await service.processInbound(dto);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'IN_OVERSEAS',
          quantity: 100,
        })
      );
    });

    it('존재하지 않는 SKU는 입고할 수 없다', async () => {
      const dto = {
        skuId: 'non-existent-sku',
        quantity: 50,
        supplierType: 'domestic' as const,
        reason: '입고',
      };

      mockSkuService.findSkuById.mockResolvedValue(null);

      await expect(service.processInbound(dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('출고 처리', () => {
    it('정상적으로 출고를 처리해야 한다', async () => {
      const stockId = 'stock-1';
      const quantity = 30;
      const reason = '주문 출고';

      const mockStock = {
        id: 'stock-1',
        skuId: 'sku-1',
        warehouseId: 'warehouse-1',
        realQuantity: 100,
        availableQuantity: 80,
        reservedQuantity: 20,
      };

      mockDb.query.stocks.findFirst.mockResolvedValue(mockStock);
      mockDb.returning.mockResolvedValueOnce([{ id: 'event-1' }])
        .mockResolvedValueOnce([{ id: 'new-stock-1' }]);

      const result = await service.processOutbound(stockId, quantity, reason);

      expect(result.processedQuantity).toBe(30);
      expect(result.remainingQuantity).toBe(70);
    });

    it('재고가 부족하면 에러를 발생시켜야 한다', async () => {
      const mockStock = {
        id: 'stock-1',
        availableQuantity: 10,
      };

      mockDb.query.stocks.findFirst.mockResolvedValue(mockStock);

      await expect(
        service.processOutbound('stock-1', 20, '출고')
      ).rejects.toThrow(BadRequestException);
    });

    it('0 이하의 수량으로는 출고할 수 없다', async () => {
      await expect(
        service.processOutbound('stock-1', 0, '출고')
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('재고 조정', () => {
    it('양수 조정을 처리해야 한다', async () => {
      const mockStock = {
        id: 'stock-1',
        skuId: 'sku-1',
        warehouseId: 'warehouse-1',
        realQuantity: 50,
        reservedQuantity: 10,
        availableQuantity: 40,
      };

      mockDb.query.stocks.findFirst.mockResolvedValue(mockStock);
      mockSkuService.findSkuById.mockResolvedValue({
        id: 'sku-1',
        inventoryManagement: true,
        preStockSellable: true,
      });
      mockDb.returning.mockResolvedValueOnce([{ id: 'event-1' }])
        .mockResolvedValueOnce([{ id: 'new-stock-1' }]);

      await service.adjustStockManually('stock-1', 20, '재고 추가');

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          realQuantity: 70,
          availableQuantity: 60,
        })
      );
    });

    it('음수 조정으로 재고가 음수가 되면 에러를 발생시켜야 한다', async () => {
      const mockStock = {
        id: 'stock-1',
        skuId: 'sku-1',
        realQuantity: 10,
      };

      mockDb.query.stocks.findFirst.mockResolvedValue(mockStock);
      mockSkuService.findSkuById.mockResolvedValue({
        id: 'sku-1',
        inventoryManagement: true,
      });

      await expect(
        service.adjustStockManually('stock-1', -20, '재고 차감')
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('재고 조회', () => {
    it('SKU별 총 재고를 조회할 수 있어야 한다', async () => {
      const mockStocks = [
        { realQuantity: 50, reservedQuantity: 10, availableQuantity: 40 },
        { realQuantity: 30, reservedQuantity: 5, availableQuantity: 25 },
      ];

      mockDb.query.stocks.findMany.mockResolvedValue(mockStocks);

      const result = await service.getTotalStockBySku('sku-1');

      expect(result).toEqual({
        skuId: 'sku-1',
        totalRealQuantity: 80,
        totalReservedQuantity: 15,
        totalAvailableQuantity: 65,
      });
    });

    it('특정 창고의 SKU별 재고를 조회할 수 있어야 한다', async () => {
      const mockStocks = [
        { id: 'stock-1', skuId: 'sku-1', location: { code: 'A-1-1' } },
        { id: 'stock-2', skuId: 'sku-1', location: { code: 'A-1-2' } },
      ];

      mockDb.query.stocks.findMany.mockResolvedValue(mockStocks);

      const result = await service.getStockBySkuAndWarehouse('sku-1', 'warehouse-1');

      expect(result).toHaveLength(2);
      expect(mockDb.query.stocks.findMany).toHaveBeenCalled();
    });
  });
});