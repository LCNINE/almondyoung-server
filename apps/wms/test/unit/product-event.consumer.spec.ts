import { Test, TestingModule } from '@nestjs/testing';
import { ProductEventConsumer } from '../../src/inventory/handlers/product-event.consumer';
import { ProductMatchingService } from '../../src/inventory/services/product-matching.service';
import { ProductVariantCreatedPayload, ProductInventoryManagementChangedPayload } from '@packages/event-contracts';

describe('ProductEventConsumer - Phase 3 Payload Handling', () => {
  let consumer: ProductEventConsumer;
  let mockProductMatchingService: { 
    handleAutomaticMatchingRequest: jest.Mock;
    handleManualMatchingRequest: jest.Mock;
  };

  beforeEach(async () => {
    mockProductMatchingService = {
      handleAutomaticMatchingRequest: jest.fn().mockResolvedValue({ created: 1, skipped: 0 }),
      handleManualMatchingRequest: jest.fn().mockResolvedValue({ created: 1, skipped: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductEventConsumer],
      providers: [
        {
          provide: ProductMatchingService,
          useValue: mockProductMatchingService,
        },
      ],
    }).compile();

    consumer = module.get<ProductEventConsumer>(ProductEventConsumer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ProductVariantCreated Event', () => {
    it('✅ should pass masterId (not productId) to service', async () => {
      const payload: ProductVariantCreatedPayload = {
        masterId: 'master-uuid-123',
        versionId: 'version-uuid-456',
        version: 1,
        productName: 'Test Product',
        variantId: 'variant-uuid-789',
        variantName: 'Default',
        isDefault: true,
        status: 'active',
        inventoryManagement: true,
        createdAt: new Date().toISOString(),
      };

      const envelope = { correlationId: 'test-correlation-id' };

      await consumer.onProductVariantCreated(payload, envelope);

      expect(mockProductMatchingService.handleManualMatchingRequest).toHaveBeenCalledWith({
        masterId: 'master-uuid-123',
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-789',
            name: 'Default',
            inventoryManagement: true,
            preStockSellable: false,
            alwaysSellableZeroStock: false,
            components: [],
          },
        ],
      });
    });

    it('✅ should handle automatic matching (inventoryManagement=false)', async () => {
      const payload: ProductVariantCreatedPayload = {
        masterId: 'master-uuid-123',
        versionId: 'version-uuid-456',
        version: 1,
        productName: 'Test Product',
        variantId: 'variant-uuid-789',
        variantName: 'Default',
        isDefault: true,
        status: 'active',
        inventoryManagement: false,
        createdAt: new Date().toISOString(),
      };

      const envelope = { correlationId: 'test-correlation-id' };

      await consumer.onProductVariantCreated(payload, envelope);

      expect(mockProductMatchingService.handleAutomaticMatchingRequest).toHaveBeenCalledWith({
        masterId: 'master-uuid-123',
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-789',
            name: '',
            inventoryManagement: false,
            components: [],
          },
        ],
      });
    });

    it('✅ should not call with productId field', async () => {
      const payload: ProductVariantCreatedPayload = {
        masterId: 'master-uuid-123',
        versionId: 'version-uuid-456',
        version: 1,
        productName: 'Test Product',
        variantId: 'variant-uuid-789',
        variantName: 'Default',
        isDefault: true,
        status: 'active',
        inventoryManagement: true,
        createdAt: new Date().toISOString(),
      };

      const envelope = { correlationId: 'test-correlation-id' };

      await consumer.onProductVariantCreated(payload, envelope);

      const callArg = mockProductMatchingService.handleManualMatchingRequest.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('productId');
      expect(callArg).toHaveProperty('masterId');
    });
  });

  describe('ProductInventoryManagementChanged Event', () => {
    it('✅ should pass masterId to service', async () => {
      const payload: ProductInventoryManagementChangedPayload = {
        masterId: 'master-uuid-123',
        versionId: 'version-uuid-456',
        version: 2,
        productName: 'Test Product',
        inventoryManagement: true,
        affectedVariants: [
          {
            variantId: 'variant-uuid-111',
            variantName: 'Red',
          },
          {
            variantId: 'variant-uuid-222',
            variantName: 'Blue',
          },
        ],
        changedAt: new Date().toISOString(),
      };

      const envelope = { correlationId: 'test-correlation-id' };

      await consumer.onInventoryManagementChanged(payload, envelope);

      expect(mockProductMatchingService.handleManualMatchingRequest).toHaveBeenCalledWith({
        masterId: 'master-uuid-123',
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-111',
            name: 'Red',
            inventoryManagement: true,
            components: [],
          },
          {
            id: 'variant-uuid-222',
            name: 'Blue',
            inventoryManagement: true,
            components: [],
          },
        ],
      });
    });

    it('✅ should handle automatic matching when inventoryManagement=false', async () => {
      const payload: ProductInventoryManagementChangedPayload = {
        masterId: 'master-uuid-123',
        versionId: 'version-uuid-456',
        version: 2,
        productName: 'Test Product',
        inventoryManagement: false,
        affectedVariants: [
          {
            variantId: 'variant-uuid-111',
            variantName: 'Red',
          },
        ],
        changedAt: new Date().toISOString(),
      };

      const envelope = { correlationId: 'test-correlation-id' };

      await consumer.onInventoryManagementChanged(payload, envelope);

      expect(mockProductMatchingService.handleAutomaticMatchingRequest).toHaveBeenCalledWith({
        masterId: 'master-uuid-123',
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-111',
            name: 'Red',
            inventoryManagement: false,
            components: [],
          },
        ],
      });
    });
  });

  describe('Event Processing Error Handling', () => {
    it('✅ should throw error to send to DLQ on failure', async () => {
      mockProductMatchingService.handleManualMatchingRequest.mockRejectedValue(
        new Error('Database connection failed')
      );

      const payload: ProductVariantCreatedPayload = {
        masterId: 'master-uuid-123',
        versionId: 'version-uuid-456',
        version: 1,
        productName: 'Test Product',
        variantId: 'variant-uuid-789',
        variantName: 'Default',
        isDefault: true,
        status: 'active',
        inventoryManagement: true,
        createdAt: new Date().toISOString(),
      };

      const envelope = { correlationId: 'test-correlation-id' };

      await expect(consumer.onProductVariantCreated(payload, envelope)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });
});

