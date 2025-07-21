// apps/wms/src/sku/sku.service.spec.ts (한국어 describe/it 문구 버전)
import { Test, TestingModule } from '@nestjs/testing';
import { SkuService } from './sku.service';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { CreateSkuDto, SkuCreationSource } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { AddBarcodeDto } from './dto/add-barcode.dto';

describe('SkuService', () => {
  let service: SkuService;
  let dbService: DbService<typeof wmsTables>;
  let mockDb: any;

  const mockSku = {
    id: 'sku-123',
    name: 'Test SKU',
    code: 'P12345ABC',
    defaultBarcode: 'SKU_B_SKU-123_1234567890',
    inventoryManagement: true,
    preStockSellable: true,
    alwaysSellableZeroStock: false,
    sale1m: 100,
    sale3m: 300,
    deliveryProfileId: 'profile-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockBarcode = {
    id: 'barcode-123',
    skuId: 'sku-123',
    barcode: 'TEST_BARCODE_123',
    barcodeType: 'standard',
    packingUnit: 'box',
  };

  const mockSupplier = {
    id: 'supplier-123',
    name: 'Test Supplier',
  };

  const mockCategory = {
    id: 'category-123',
    name: 'Test Category',
  };

  beforeEach(async () => {
    mockDb = {
      query: {
        skus: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
        },
        skuBarcodes: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
        },
        suppliers: {
          findMany: jest.fn(),
        },
        categories: {
          findMany: jest.fn(),
        },
        warehouses: {
          findMany: jest.fn(),
        },
        stocks: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
        },
        productVariantSkuLinks: {
          findMany: jest.fn(),
        },
      },
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkuService,
        {
          provide: DbService,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<SkuService>(SkuService);
    dbService = module.get<DbService<typeof wmsTables>>(DbService);
  });

  describe('_generateSkuCode', () => {
    it('고유한 SKU 코드를 생성해야 한다', () => {
      const code1 = service['_generateSkuCode']();
      const code2 = service['_generateSkuCode']();

      expect(code1).toMatch(/^P\d{5}[A-Z]{3}$/);
      expect(code2).toMatch(/^P\d{5}[A-Z]{3}$/);
      expect(code1).not.toBe(code2);
    });
  });

  describe('_createSkuInternal', () => {
    it('자동 매칭 소스로 SKU를 생성해야 한다', async () => {
      const createDto = {
        name: 'Test Product',
        inventoryManagement: true,
        source: SkuCreationSource.AUTO_MATCHING,
        productName: 'Product Name',
        variantName: 'Variant Name',
      };

      mockDb.insert().values().returning.mockResolvedValue([mockSku]);
      mockDb.insert().values().returning
        .mockResolvedValueOnce([mockSku])
        .mockResolvedValueOnce([mockBarcode]);
      mockDb.update().set().where().returning.mockResolvedValue([mockSku]);

      const result = await service._createSkuInternal(createDto);

      expect(result.name).toBe('Product Name - Variant Name');
      expect(result.preStockSellable).toBe(true);
      expect(result.defaultBarcode).toBeDefined();
    });

    it('수동 매칭 소스로 SKU를 생성해야 한다', async () => {
      const createDto = {
        name: 'Manual SKU Name',
        inventoryManagement: false,
        source: SkuCreationSource.MANUAL_MATCHING,
      };

      mockDb.insert().values().returning.mockResolvedValue([
        { ...mockSku, inventoryManagement: false, preStockSellable: false },
      ]);
      mockDb.insert().values().returning
        .mockResolvedValueOnce([mockSku])
        .mockResolvedValueOnce([mockBarcode]);
      mockDb.update().set().where().returning.mockResolvedValue([mockSku]);

      const result = await service._createSkuInternal(createDto);

      expect(result.name).toBe('Manual SKU Name');
      expect(result.preStockSellable).toBe(false);
    });
  });

  describe('createSku', () => {
    it('공급업체와 카테고리를 포함하여 SKU를 생성해야 한다', async () => {
      const createDto: CreateSkuDto = {
        name: 'New SKU',
        inventoryManagement: true,
        supplierIds: ['supplier-1', 'supplier-2'],
        categoryIds: ['category-1'],
      };

      mockDb.transaction.mockImplementation(async (callback) => {
        const tx = { ...mockDb };
        return callback(tx);
      });

      mockDb.insert().values().returning.mockResolvedValue([mockSku]);
      mockDb.query.skus.findFirst.mockResolvedValue(mockSku);
      mockDb.query.skuBarcodes.findMany.mockResolvedValue([mockBarcode]);
      mockDb.select().from().innerJoin().where.mockResolvedValue([
        { name: 'Supplier 1' },
        { name: 'Supplier 2' },
      ]);
      mockDb.select().from().innerJoin().where
        .mockResolvedValueOnce([{ name: 'Supplier 1' }, { name: 'Supplier 2' }])
        .mockResolvedValueOnce([{ name: 'Category 1' }]);

      jest.spyOn(service, 'getSkuById').mockResolvedValue({
        id: mockSku.id,
        name: mockSku.name,
        code: mockSku.code,
        defaultBarcode: mockSku.defaultBarcode,
        inventoryManagement: mockSku.inventoryManagement,
        preStockSellable: mockSku.preStockSellable,
        alwaysSellableZeroStock: mockSku.alwaysSellableZeroStock,
        sale1m: mockSku.sale1m,
        sale3m: mockSku.sale3m,
        deliveryProfileId: mockSku.deliveryProfileId,
        barcodes: [],
        supplierNames: ['Supplier 1', 'Supplier 2'],
        categoryNames: ['Category 1'],
        createdAt: mockSku.createdAt,
        updatedAt: mockSku.updatedAt,
      });

      const result = await service.createSku(createDto);

      expect(result.supplierNames).toEqual(['Supplier 1', 'Supplier 2']);
      expect(result.categoryNames).toEqual(['Category 1']);
    });
  });

  describe('updateSku', () => {
    it('SKU와 그 연관 관계를 업데이트해야 한다', async () => {
      const updateDto: UpdateSkuDto = {
        name: 'Updated SKU',
        supplierIds: ['supplier-new'],
        categoryIds: [],
      };

      mockDb.transaction.mockImplementation(async (callback) => {
        const tx = { ...mockDb };
        return callback(tx);
      });

      mockDb.update().set().where().returning.mockResolvedValue([
        { ...mockSku, name: 'Updated SKU' },
      ]);
      mockDb.delete().where.mockResolvedValue({});

      jest.spyOn(service, 'getSkuById').mockResolvedValue({
        id: mockSku.id,
        name: 'Updated SKU',
        code: mockSku.code,
        defaultBarcode: mockSku.defaultBarcode,
        inventoryManagement: mockSku.inventoryManagement,
        preStockSellable: mockSku.preStockSellable,
        alwaysSellableZeroStock: mockSku.alwaysSellableZeroStock,
        barcodes: [],
        supplierNames: ['New Supplier'],
        categoryNames: [],
        createdAt: mockSku.createdAt,
        updatedAt: new Date(),
      });

      const result = await service.updateSku(mockSku.id, updateDto);

      expect(result.name).toBe('Updated SKU');
      expect(result.supplierNames).toEqual(['New Supplier']);
      expect(result.categoryNames).toEqual([]);
    });
  });

  describe('deleteSku', () => {
    it('활성 재고가 없으면 SKU를 삭제해야 한다', async () => {
      mockDb.query.stocks.findFirst.mockResolvedValue(null);
      mockDb.query.productVariantSkuLinks.findMany.mockResolvedValue([]);
      mockDb.delete().where.mockResolvedValue({});

      await expect(service.deleteSku(mockSku.id)).resolves.not.toThrow();
    });

    it('활성 재고가 있으면 ConflictException을 던져야 한다', async () => {
      mockDb.query.stocks.findFirst.mockResolvedValue({
        id: 'stock-123',
        skuId: mockSku.id,
        realQuantity: 10,
      });

      await expect(service.deleteSku(mockSku.id)).rejects.toThrow(ConflictException);
    });

    it('SKU가 상품 매칭에 사용 중이면 ConflictException을 던져야 한다', async () => {
      mockDb.query.stocks.findFirst.mockResolvedValue(null);
      mockDb.query.productVariantSkuLinks.findMany.mockResolvedValue([
        { productMatchingId: 'matching-123', skuId: mockSku.id },
      ]);

      await expect(service.deleteSku(mockSku.id)).rejects.toThrow(ConflictException);
    });
  });

  describe('getSkuById', () => {
    it('연관된 모든 데이터를 포함한 SKU를 반환해야 한다', async () => {
      mockDb.query.skus.findFirst.mockResolvedValue(mockSku);
      mockDb.query.skuBarcodes.findMany.mockResolvedValue([mockBarcode]);
      mockDb.select().from().innerJoin().where
        .mockResolvedValueOnce([{ name: 'Supplier 1' }])
        .mockResolvedValueOnce([{ name: 'Category 1' }]);

      const result = await service.getSkuById(mockSku.id);

      expect(result.id).toBe(mockSku.id);
      expect(result.barcodes).toHaveLength(1);
      expect(result.supplierNames).toEqual(['Supplier 1']);
      expect(result.categoryNames).toEqual(['Category 1']);
    });

    it('SKU를 찾을 수 없으면 NotFoundException을 던져야 한다', async () => {
      mockDb.query.skus.findFirst.mockResolvedValue(null);

      await expect(service.getSkuById('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchSkus', () => {
    it('다양한 조건으로 SKU를 검색해야 한다', async () => {
      const searchQuery = {
        name: 'test',
        inventoryManagement: true,
      };

      mockDb.select().from().leftJoin().where.mockResolvedValue([
        {
          sku: mockSku,
          barcode: mockBarcode,
          supplier: mockSupplier,
          category: mockCategory,
        },
      ]);

      const result = await service.searchSkus(searchQuery);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe(mockSku.name);
      expect(result[0].supplierNames).toContain(mockSupplier.name);
      expect(result[0].categoryNames).toContain(mockCategory.name);
    });
  });

  describe('addBarcode', () => {
    it('SKU에 바코드를 추가해야 한다', async () => {
      const addBarcodeDto: AddBarcodeDto = {
        barcode: 'NEW_BARCODE_456',
        barcodeType: 'standard',
        packingUnit: 'piece',
      };

      jest.spyOn(service, 'findSkuById').mockResolvedValue(mockSku);
      mockDb.query.skuBarcodes.findFirst.mockResolvedValue(null);
      mockDb.insert().values.mockResolvedValue({});

      await expect(service.addBarcode(mockSku.id, addBarcodeDto)).resolves.not.toThrow();
    });

    it('이미 존재하는 바코드면 ConflictException을 던져야 한다', async () => {
      const addBarcodeDto: AddBarcodeDto = {
        barcode: 'EXISTING_BARCODE',
      } as any;

      jest.spyOn(service, 'findSkuById').mockResolvedValue(mockSku);
      mockDb.query.skuBarcodes.findFirst.mockResolvedValue(mockBarcode);

      await expect(service.addBarcode(mockSku.id, addBarcodeDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('removeBarcode', () => {
    it('기본 바코드가 아닌 경우 제거해야 한다', async () => {
      jest.spyOn(service, 'findSkuById').mockResolvedValue(mockSku);
      mockDb.query.skuBarcodes.findFirst.mockResolvedValue({
        ...mockBarcode,
        barcode: 'REMOVABLE_BARCODE',
      });
      mockDb.delete().where.mockResolvedValue({});

      await expect(service.removeBarcode(mockSku.id, mockBarcode.id)).resolves.not.toThrow();
    });

    it('기본 바코드는 제거할 수 없으므로 BadRequestException을 던져야 한다', async () => {
      jest.spyOn(service, 'findSkuById').mockResolvedValue(mockSku);
      mockDb.query.skuBarcodes.findFirst.mockResolvedValue({
        ...mockBarcode,
        barcode: mockSku.defaultBarcode,
      });

      await expect(service.removeBarcode(mockSku.id, mockBarcode.id)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSkuStockSummary', () => {
    it('창고별 재고 요약을 반환해야 한다', async () => {
      jest.spyOn(service, 'findSkuById').mockResolvedValue(mockSku);

      const mockStocks = [
        {
          id: 'stock-1',
          skuId: mockSku.id,
          warehouseId: 'warehouse-1',
          realQuantity: 100,
          reservedQuantity: 20,
          availableQuantity: 80,
        },
        {
          id: 'stock-2',
          skuId: mockSku.id,
          warehouseId: 'warehouse-1',
          realQuantity: 50,
          reservedQuantity: 10,
          availableQuantity: 40,
        },
        {
          id: 'stock-3',
          skuId: mockSku.id,
          warehouseId: 'warehouse-2',
          realQuantity: 75,
          reservedQuantity: 0,
          availableQuantity: 75,
        },
      ];

      mockDb.query.stocks.findMany.mockResolvedValue(mockStocks);
      mockDb.query.warehouses.findMany.mockResolvedValue([
        { id: 'warehouse-1', name: 'Main Warehouse' },
        { id: 'warehouse-2', name: 'Secondary Warehouse' },
      ]);

      const result = await service.getSkuStockSummary(mockSku.id);

      expect(result.totalRealQuantity).toBe(225);
      expect(result.totalReservedQuantity).toBe(30);
      expect(result.totalAvailableQuantity).toBe(195);
      expect(result.warehouseStocks).toHaveLength(2);
      expect(result.warehouseStocks[0].warehouseName).toBe('Main Warehouse');
      expect(result.warehouseStocks[0].realQuantity).toBe(150);
    });
  });

  describe('updateAlwaysSellableZeroStock', () => {
    it('재고가 없을 때 alwaysSellableZeroStock을 true로 업데이트해야 한다', async () => {
      jest.spyOn(service, 'findSkuById').mockResolvedValue(mockSku);
      jest.spyOn(service, 'getSkuStockSummary').mockResolvedValue({
        skuId: mockSku.id,
        skuName: mockSku.name,
        skuCode: mockSku.code,
        totalRealQuantity: 0,
        totalReservedQuantity: 0,
        totalAvailableQuantity: 0,
        warehouseStocks: [],
      });
      mockDb.update().set().where.mockResolvedValue([]);

      await expect(service.updateAlwaysSellableZeroStock(mockSku.id, true)).resolves.not.toThrow();
    });

    it('재고가 존재하면 true로 변경할 수 없으므로 BadRequestException을 던져야 한다', async () => {
      jest.spyOn(service, 'findSkuById').mockResolvedValue(mockSku);
      jest.spyOn(service, 'getSkuStockSummary').mockResolvedValue({
        skuId: mockSku.id,
        skuName: mockSku.name,
        skuCode: mockSku.code,
        totalRealQuantity: 100,
        totalReservedQuantity: 0,
        totalAvailableQuantity: 100,
        warehouseStocks: [],
      });

      await expect(service.updateAlwaysSellableZeroStock(mockSku.id, true))
        .rejects.toThrow(BadRequestException);
    });

    it('재고 관리 대상이 아닌 SKU에 대해 호출하면 BadRequestException을 던져야 한다', async () => {
      jest.spyOn(service, 'findSkuById').mockResolvedValue({
        ...mockSku,
        inventoryManagement: false,
      });

      await expect(service.updateAlwaysSellableZeroStock(mockSku.id, true))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('batchUpdateAlwaysSellableZeroStock', () => {
    it('배치 업데이트를 수행하고 결과를 반환해야 한다', async () => {
      const updates = [
        { skuId: 'sku-1', value: true },
        { skuId: 'sku-2', value: false },
        { skuId: 'sku-3', value: true },
      ];

      jest.spyOn(service, 'updateAlwaysSellableZeroStock')
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new BadRequestException('Stock exists'));

      const result = await service.batchUpdateAlwaysSellableZeroStock(updates);

      expect(result.success).toHaveLength(2);
      expect(result.success).toContain('sku-1');
      expect(result.success).toContain('sku-2');
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].skuId).toBe('sku-3');
      expect(result.failed[0].reason).toBe('Stock exists');
    });
  });

  describe('_updatePreStockSellableInternal', () => {
    it('preStockSellable 필드를 업데이트해야 한다', async () => {
      mockDb.update().set().where().returning.mockResolvedValue([
        {
          ...mockSku,
          preStockSellable: false,
        },
      ]);

      const result = await service._updatePreStockSellableInternal(mockSku.id, false);

      expect(result.preStockSellable).toBe(false);
    });

    it('SKU를 찾을 수 없으면 NotFoundException을 던져야 한다', async () => {
      mockDb.update().set().where().returning.mockResolvedValue([]);

      await expect(
        service._updatePreStockSellableInternal('non-existent', false),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findSkuById', () => {
    it('ID로 SKU를 찾아야 한다', async () => {
      mockDb.query.skus.findFirst.mockResolvedValue(mockSku);

      const result = await service.findSkuById(mockSku.id);

      expect(result).toEqual(mockSku);
    });

    it('SKU를 찾지 못하면 null을 반환해야 한다', async () => {
      mockDb.query.skus.findFirst.mockResolvedValue(null);

      const result = await service.findSkuById('non-existent');

      expect(result).toBeNull();
    });

    it('트랜잭션 컨텍스트에서도 동작해야 한다', async () => {
      const mockTx = { query: { skus: { findFirst: jest.fn().mockResolvedValue(mockSku) } } };

      const result = await service.findSkuById(mockSku.id, mockTx as any);

      expect(result).toEqual(mockSku);
    });
  });
});
