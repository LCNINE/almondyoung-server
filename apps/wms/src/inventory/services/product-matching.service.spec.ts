import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { ProductMatchingService } from './product-matching.service';
import { InventoryService } from './inventory.service';
import { StockEventService } from './stock-event.service';
import { VoidMatchingStrategy } from '../strategies/void-matching.strategy';
import { VariantMatchingStrategy } from '../strategies/variant-matching.strategy';
import { OptionMatchingStrategy } from '../strategies/option-matching.strategy';
import { ResolveMatchingDto } from '../dto/product-matching/resolve-matching.dto';

interface PimVariantPayload {
  id: string;
  name: string;
  inventoryManagement: boolean;
  components: Array<{ skuName: string }>;
}

interface PimProductPayload {
  productId: string;
  name: string;
  variants: PimVariantPayload[];
}

describe('ProductMatchingService', () => {
  let service: ProductMatchingService;
  let mockDb: any;
  let mockTx: any;
  let mockInventoryService: any;
  let mockStockEventService: any;
  let mockVoidStrategy: any;
  let mockVariantStrategy: any;
  let mockOptionStrategy: any;

  beforeEach(async () => {
    mockTx = {
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      onConflictDoNothing: jest.fn().mockReturnThis(),
    };

    mockDb = {
      query: {
        productMatchings: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
        },
      },
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      onConflictDoNothing: jest.fn().mockReturnThis(),
      transaction: jest.fn().mockImplementation((callback) => callback(mockTx)),
    };

    mockInventoryService = {
      getDefaultWarehouseId: jest.fn().mockReturnValue('default-warehouse-id'),
      _createSkuInternal: jest.fn(),
    };

    mockStockEventService = {
      createStockEntry: jest.fn(),
    };

    mockVoidStrategy = {
      create: jest.fn(),
      lookup: jest.fn(),
      validate: jest.fn(),
      delete: jest.fn(),
    };

    mockVariantStrategy = {
      create: jest.fn(),
      lookup: jest.fn(),
      validate: jest.fn(),
      delete: jest.fn(),
    };

    mockOptionStrategy = {
      create: jest.fn(),
      lookup: jest.fn(),
      validate: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProductMatchingService,
        { provide: DbService, useValue: { db: mockDb } },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: StockEventService, useValue: mockStockEventService },
      ],
    }).compile();

    service = module.get<ProductMatchingService>(ProductMatchingService);

    // Mock the strategies
    (service as any).strategies.set('void', mockVoidStrategy);
    (service as any).strategies.set('variant', mockVariantStrategy);
    (service as any).strategies.set('option', mockOptionStrategy);
  });

  describe('handleManualMatchingRequest', () => {
    const validPayload: PimProductPayload = {
      productId: 'product-123',
      name: 'Test Product',
      variants: [
        {
          id: 'variant-123',
          name: 'Test Variant',
          inventoryManagement: true,
          components: [{ skuName: 'test-sku' }],
        },
      ],
    };

    it('should create manual matching request for new variants', async () => {
      mockDb.query.productMatchings.findFirst.mockResolvedValue(null);
      mockDb.returning.mockResolvedValue([{ id: 'matching-123' }]);

      const result = await service.handleManualMatchingRequest(validPayload);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        variantId: 'variant-123',
        status: 'created',
      });

      expect(mockDb.insert).toHaveBeenCalledWith(expect.anything());
      expect(mockDb.values).toHaveBeenCalledWith({
        variantId: 'variant-123',
        status: 'pending',
        priority: 'high',
        strategy: null,
        isResolved: false,
      });
    });

    it('should skip existing variants and mark as exists', async () => {
      mockDb.query.productMatchings.findFirst.mockResolvedValue({
        id: 'existing-matching-123',
        variantId: 'variant-123',
      });

      const result = await service.handleManualMatchingRequest(validPayload);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        variantId: 'variant-123',
        status: 'exists',
      });

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should handle variants with missing IDs', async () => {
      const payloadWithMissingId: PimProductPayload = {
        ...validPayload,
        variants: [{ ...validPayload.variants[0], id: '' }],
      };

      const result = await service.handleManualMatchingRequest(payloadWithMissingId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        variantId: 'unknown',
        status: 'error',
        error: 'Variant ID is required',
      });
    });

    it('should throw error for invalid payload', async () => {
      const invalidPayload = {} as PimProductPayload;

      await expect(service.handleManualMatchingRequest(invalidPayload)).rejects.toThrow(
        new BadRequestException('Invalid payload: productId and variants array are required')
      );
    });

    it('should handle database insertion failure', async () => {
      mockDb.query.productMatchings.findFirst.mockResolvedValue(null);
      mockDb.returning.mockResolvedValue([]); // Empty result indicates failure

      const result = await service.handleManualMatchingRequest(validPayload);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        variantId: 'variant-123',
        status: 'error',
        error: expect.stringContaining('Product matching entry creation failed'),
      });
    });

    it('should handle multiple variants with mixed results', async () => {
      const multiVariantPayload: PimProductPayload = {
        ...validPayload,
        variants: [
          { id: 'variant-1', name: 'Variant 1', inventoryManagement: true, components: [] },
          { id: 'variant-2', name: 'Variant 2', inventoryManagement: true, components: [] },
          { id: '', name: 'Variant 3', inventoryManagement: true, components: [] }, // Missing ID
        ],
      };

      mockDb.query.productMatchings.findFirst
        .mockResolvedValueOnce(null) // variant-1: new
        .mockResolvedValueOnce({ id: 'existing' }); // variant-2: exists

      mockDb.returning.mockResolvedValue([{ id: 'new-matching-1' }]);

      const result = await service.handleManualMatchingRequest(multiVariantPayload);

      expect(result).toHaveLength(3);
      expect(result[0].status).toBe('created');
      expect(result[1].status).toBe('exists');
      expect(result[2].status).toBe('error');
    });
  });

  describe('handleAutomaticMatchingRequest', () => {
    const payload: PimProductPayload = {
      productId: 'product-123',
      name: 'Test Product',
      variants: [
        {
          id: 'variant-123',
          name: 'Test Variant',
          inventoryManagement: true,
          components: [{ skuName: 'test-sku-1' }, { skuName: 'test-sku-2' }],
        },
        {
          id: 'variant-456',
          name: 'Digital Variant',
          inventoryManagement: false,
          components: [],
        },
      ],
    };

    it('should handle inventory-managed variants with variant strategy', async () => {
      mockTx.returning.mockResolvedValue([{ id: 'new-matching-123' }]);
      mockStockEventService.createStockEntry.mockResolvedValue({ skuId: 'sku-123' });
      mockVariantStrategy.create.mockResolvedValue(true);

      await service.handleAutomaticMatchingRequest(payload);

      expect(mockTx.insert).toHaveBeenCalledWith(expect.anything());
      expect(mockTx.values).toHaveBeenCalledWith({
        variantId: 'variant-123',
        status: 'matched',
        priority: 'normal',
        strategy: 'variant',
        isResolved: true,
        inventoryManagement: true,
        preStockSellable: true,
        alwaysSellableZeroStock: false,
      });

      expect(mockStockEventService.createStockEntry).toHaveBeenCalledTimes(2); // 2 components
      expect(mockVariantStrategy.create).toHaveBeenCalled();
    });

    it('should handle non-inventory-managed variants with void strategy', async () => {
      // Mock for non-inventory managed variant handling
      mockDb.onConflictDoNothing.mockReturnValue({ returning: jest.fn().mockResolvedValue([{ id: 'ignored-matching' }]) });

      await service.handleAutomaticMatchingRequest(payload);

      expect(mockDb.insert).toHaveBeenCalledWith(expect.anything());
      expect(mockDb.values).toHaveBeenCalledWith({
        variantId: 'variant-456',
        status: 'ignored',
        priority: 'normal',
        strategy: 'void',
        isResolved: true,
        inventoryManagement: false,
        preStockSellable: true,
        alwaysSellableZeroStock: false,
      });
    });
  });

  describe('resolveMatchingPending', () => {
    const matchingId = 'matching-123';
    const mockProductMatching = {
      id: matchingId,
      variantId: 'variant-123',
      isResolved: false,
      status: 'pending',
    };

    beforeEach(() => {
      mockDb.query.productMatchings.findFirst.mockResolvedValue(mockProductMatching);
      mockVariantStrategy.validate.mockResolvedValue(true);
      mockVariantStrategy.create.mockResolvedValue(true);
      mockTx.returning.mockResolvedValue([{ id: matchingId, status: 'matched' }]);
    });

    it('should resolve matching with ignore option', async () => {
      const resolveDto: ResolveMatchingDto = { ignore: true };

      mockDb.returning.mockResolvedValue([{ id: matchingId, status: 'ignored' }]);

      const result = await service.resolveMatchingPending(matchingId, resolveDto);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({
        status: 'ignored',
        strategy: 'void',
        isResolved: true,
        inventoryManagement: false,
        preStockSellable: true,
        alwaysSellableZeroStock: false,
        updatedAt: expect.any(Date),
      });
    });

    it('should resolve matching with SKU IDs', async () => {
      const resolveDto: ResolveMatchingDto = {
        skuIds: ['sku-1', 'sku-2'],
        strategy: 'variant',
      };

      await service.resolveMatchingPending(matchingId, resolveDto);

      expect(mockVariantStrategy.validate).toHaveBeenCalledWith(
        {
          variantId: 'variant-123',
          productMatchingId: matchingId,
        },
        [
          { skuId: 'sku-1', quantity: 1 },
          { skuId: 'sku-2', quantity: 1 },
        ]
      );

      expect(mockVariantStrategy.create).toHaveBeenCalled();
    });

    it('should resolve matching with SKU mappings', async () => {
      const resolveDto: ResolveMatchingDto = {
        skuMappings: [
          { skuId: 'sku-1', quantity: 2 },
          { skuId: 'sku-2', quantity: 3 },
        ],
        strategy: 'variant',
      };

      await service.resolveMatchingPending(matchingId, resolveDto);

      expect(mockVariantStrategy.validate).toHaveBeenCalledWith(
        expect.anything(),
        [
          { skuId: 'sku-1', quantity: 2 },
          { skuId: 'sku-2', quantity: 3 },
        ]
      );
    });

    it('should throw error when matching not found', async () => {
      mockDb.query.productMatchings.findFirst.mockResolvedValue(null);

      const resolveDto: ResolveMatchingDto = { skuIds: ['sku-1'] };

      await expect(service.resolveMatchingPending(matchingId, resolveDto)).rejects.toThrow(
        new NotFoundException(`Product matching with ID ${matchingId} not found or already resolved.`)
      );
    });

    it('should throw error when strategy validation fails', async () => {
      mockVariantStrategy.validate.mockResolvedValue(false);

      const resolveDto: ResolveMatchingDto = { skuIds: ['sku-1'] };

      await expect(service.resolveMatchingPending(matchingId, resolveDto)).rejects.toThrow(
        new BadRequestException('Invalid SKU mappings for the selected strategy')
      );
    });

    it('should throw error when no SKU information provided', async () => {
      const resolveDto: ResolveMatchingDto = {}; // No skuIds, skuMappings, or ignore

      await expect(service.resolveMatchingPending(matchingId, resolveDto)).rejects.toThrow(
        new BadRequestException('매칭할 SKU 정보를 제공하거나, 무시 옵션을 선택해야 합니다.')
      );
    });

    it('should use custom stock policy when provided', async () => {
      const resolveDto: ResolveMatchingDto = {
        skuIds: ['sku-1'],
        stockPolicy: {
          inventoryManagement: false,
          preStockSellable: false,
          alwaysSellableZeroStock: true,
        },
      };

      await service.resolveMatchingPending(matchingId, resolveDto);

      expect(mockTx.set).toHaveBeenCalledWith({
        status: 'matched',
        strategy: 'variant',
        isResolved: true,
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: true,
        updatedAt: expect.any(Date),
      });
    });
  });

  describe('getMatchingPendings', () => {
    const mockMatchings = [
      {
        id: 'matching-1',
        variantId: 'variant-1',
        status: 'pending',
        strategy: null,
        links: [],
      },
      {
        id: 'matching-2',
        variantId: 'variant-2',
        status: 'matched',
        strategy: 'variant',
        links: [{ sku: { id: 'sku-1', name: 'Test SKU' } }],
      },
    ];

    it('should return all matchings when no status filter', async () => {
      mockDb.query.productMatchings.findMany.mockResolvedValue(mockMatchings);
      mockVariantStrategy.lookup.mockResolvedValue([{ skuId: 'sku-1', quantity: 1 }]);

      const result = await service.getMatchingPendings();

      expect(result).toHaveLength(2);
      expect(result[1]).toHaveProperty('skuMappings');
    });

    it('should filter by status when provided', async () => {
      mockDb.query.productMatchings.findMany.mockResolvedValue([mockMatchings[0]]);

      await service.getMatchingPendings('pending');

      expect(mockDb.query.productMatchings.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: expect.any(Function),
        with: {
          links: {
            with: {
              sku: true,
            },
          },
        },
      }));
    });

    it('should handle strategy lookup errors gracefully', async () => {
      mockDb.query.productMatchings.findMany.mockResolvedValue([mockMatchings[1]]);
      mockVariantStrategy.lookup.mockRejectedValue(new Error('Strategy lookup failed'));

      const result = await service.getMatchingPendings();

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('skuMappings');
    });
  });

  describe('handleVariantDeletion', () => {
    const variantId = 'variant-123';

    it('should delete matched product matching with strategy cleanup', async () => {
      const mockMatching = {
        id: 'matching-123',
        variantId,
        status: 'matched',
        strategy: 'variant',
      };

      mockDb.query.productMatchings.findFirst.mockResolvedValue(mockMatching);
      mockVariantStrategy.delete.mockResolvedValue(true);

      await service.handleVariantDeletion(variantId);

      expect(mockVariantStrategy.delete).toHaveBeenCalledWith(
        {
          variantId,
          productMatchingId: 'matching-123',
        },
        mockTx
      );

      expect(mockTx.delete).toHaveBeenCalled();
    });

    it('should delete non-matched product matching without strategy', async () => {
      const mockMatching = {
        id: 'matching-123',
        variantId,
        status: 'pending',
        strategy: null,
      };

      mockDb.query.productMatchings.findFirst.mockResolvedValue(mockMatching);

      await service.handleVariantDeletion(variantId);

      expect(mockVariantStrategy.delete).not.toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should handle when no matching found', async () => {
      mockDb.query.productMatchings.findFirst.mockResolvedValue(null);

      await expect(service.handleVariantDeletion(variantId)).resolves.not.toThrow();
    });

    it('should handle matched status with null strategy by simple deletion', async () => {
      const mockMatching = {
        id: 'matching-123',
        variantId,
        status: 'matched',
        strategy: null, // This makes it skip the transaction block
      };

      mockDb.query.productMatchings.findFirst.mockResolvedValue(mockMatching);

      await service.handleVariantDeletion(variantId);

      // Should go to the else block and do simple deletion
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockVariantStrategy.delete).not.toHaveBeenCalled();
    });
  });

  describe('getSkusForVariant', () => {
    const variantId = 'variant-123';

    it('should return SKU mappings for matched variant', async () => {
      const mockMatching = {
        id: 'matching-123',
        variantId,
        status: 'matched',
        strategy: 'variant',
      };

      mockDb.query.productMatchings.findFirst.mockResolvedValue(mockMatching);
      mockVariantStrategy.lookup.mockResolvedValue([
        { skuId: 'sku-1', quantity: 1 },
        { skuId: 'sku-2', quantity: 2 },
      ]);

      const result = await service.getSkusForVariant(variantId);

      expect(result).toEqual([
        { skuId: 'sku-1', quantity: 1 },
        { skuId: 'sku-2', quantity: 2 },
      ]);

      expect(mockVariantStrategy.lookup).toHaveBeenCalledWith({
        variantId,
        productMatchingId: 'matching-123',
        optionData: undefined,
      });
    });

    it('should pass selected options to strategy', async () => {
      const mockMatching = {
        id: 'matching-123',
        variantId,
        status: 'matched',
        strategy: 'option',
      };
      const selectedOptions = [{ optionName: 'color', optionValue: 'red' }];

      mockDb.query.productMatchings.findFirst.mockResolvedValue(mockMatching);
      mockOptionStrategy.lookup.mockResolvedValue([{ skuId: 'sku-1', quantity: 1 }]);

      await service.getSkusForVariant(variantId, selectedOptions);

      expect(mockOptionStrategy.lookup).toHaveBeenCalledWith({
        variantId,
        productMatchingId: 'matching-123',
        optionData: selectedOptions,
      });
    });

    it('should throw error when no matched product found', async () => {
      mockDb.query.productMatchings.findFirst.mockResolvedValue(null);

      await expect(service.getSkusForVariant(variantId)).rejects.toThrow(
        new NotFoundException(`No matched product found for variant ${variantId}`)
      );
    });

    it('should throw error when strategy is null', async () => {
      const mockMatching = {
        id: 'matching-123',
        variantId,
        status: 'matched',
        strategy: null,
      };

      mockDb.query.productMatchings.findFirst.mockResolvedValue(mockMatching);

      await expect(service.getSkusForVariant(variantId)).rejects.toThrow(
        new NotFoundException(`No matched product found for variant ${variantId}`)
      );
    });
  });

  describe('setMatchingPriority', () => {
    const matchingId = 'matching-123';

    it('should update matching priority successfully', async () => {
      const updatedMatching = { id: matchingId, priority: 'high' };
      mockDb.returning.mockResolvedValue([updatedMatching]);

      const result = await service.setMatchingPriority(matchingId, 'high');

      expect(result).toEqual(updatedMatching);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({
        priority: 'high',
        updatedAt: expect.any(Date),
      });
    });

    it('should throw error when matching not found', async () => {
      mockDb.returning.mockResolvedValue([]);

      await expect(service.setMatchingPriority(matchingId, 'high')).rejects.toThrow(
        new NotFoundException(`Product matching with ID ${matchingId} not found or already resolved.`)
      );
    });
  });

  describe('getStockPolicyForVariant', () => {
    const variantId = 'variant-123';

    it('should return stock policy when matching exists', async () => {
      const mockMatching = {
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: true,
      };

      mockDb.query.productMatchings.findFirst.mockResolvedValue(mockMatching);

      const result = await service.getStockPolicyForVariant(variantId);

      expect(result).toEqual({
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: true,
      });
    });

    it('should return null when no matching found', async () => {
      mockDb.query.productMatchings.findFirst.mockResolvedValue(null);

      const result = await service.getStockPolicyForVariant(variantId);

      expect(result).toBeNull();
    });
  });

  describe('updateStockPolicy', () => {
    const matchingId = 'matching-123';

    it('should update stock policy successfully', async () => {
      const stockPolicy = {
        inventoryManagement: false,
        preStockSellable: true,
        alwaysSellableZeroStock: false,
      };

      const updatedMatching = { id: matchingId, ...stockPolicy };
      mockDb.returning.mockResolvedValue([updatedMatching]);

      const result = await service.updateStockPolicy(matchingId, stockPolicy);

      expect(result).toEqual(updatedMatching);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({
        ...stockPolicy,
        updatedAt: expect.any(Date),
      });
    });

    it('should throw error when matching not found', async () => {
      mockDb.returning.mockResolvedValue([]);

      const stockPolicy = { inventoryManagement: false };

      await expect(service.updateStockPolicy(matchingId, stockPolicy)).rejects.toThrow(
        new NotFoundException(`Product matching with ID ${matchingId} not found.`)
      );
    });
  });

  describe('createNewSkuForMatching', () => {
    const variantId = 'variant-123';

    it('should create new SKU with inventory management', async () => {
      const skuData = {
        name: 'Test SKU',
        inventoryManagement: true,
        alwaysSellableZeroStock: false,
      };

      const newSku = { id: 'new-sku-123', name: 'Test SKU' };
      mockInventoryService._createSkuInternal.mockResolvedValue(newSku);
      mockStockEventService.createStockEntry.mockResolvedValue({ skuId: 'new-sku-123' });

      const result = await service.createNewSkuForMatching(variantId, skuData);

      expect(result).toEqual(newSku);
      expect(mockInventoryService._createSkuInternal).toHaveBeenCalledWith(
        {
          name: 'Test SKU',
          source: 'manual_matching', // Use the actual enum value
        },
        mockTx
      );
      expect(mockStockEventService.createStockEntry).toHaveBeenCalledWith(
        {
          variantId,
          skuName: 'Test SKU',
          inventoryManagement: true,
          warehouseId: 'default-warehouse-id',
          quantity: 0,
          stockType: 'physical',
          reason: `manual_matching_for_variant_${variantId}`,
        },
        mockTx
      );
    });

    it('should create new SKU without inventory management', async () => {
      const skuData = {
        name: 'Digital SKU',
        inventoryManagement: false,
      };

      const newSku = { id: 'new-sku-456', name: 'Digital SKU' };
      mockInventoryService._createSkuInternal.mockResolvedValue(newSku);

      const result = await service.createNewSkuForMatching(variantId, skuData);

      expect(result).toEqual(newSku);
      expect(mockStockEventService.createStockEntry).not.toHaveBeenCalled();
    });
  });

  describe('getStrategy', () => {
    it('should throw error for unknown strategy', async () => {
      expect(() => (service as any).getStrategy('unknown')).toThrow(
        new BadRequestException('Unknown matching strategy: unknown')
      );
    });

    it('should return correct strategy for known types', () => {
      expect((service as any).getStrategy('void')).toBe(mockVoidStrategy);
      expect((service as any).getStrategy('variant')).toBe(mockVariantStrategy);
      expect((service as any).getStrategy('option')).toBe(mockOptionStrategy);
    });
  });
});