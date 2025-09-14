import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { FulfillmentsService } from './fulfillments.service';
import { PoliciesService } from '../../shared/services/policies.service';
import { AvailabilityService } from '../../shared/services/availability.service';
import { MatchingsService } from '../../matchings/services/matchings.service';
import { EventPublisherService } from '@app/events';
import { OutboxService } from '../../shared/services/outbox.service';
import { AuditService } from '../../../shared/services/audit.service';

describe('FulfillmentsService', () => {
  let service: FulfillmentsService;
  let mockDb: any;
  let mockPolicies: any;
  let mockAvailability: any;
  let mockMatchings: any;
  let mockOutbox: any;
  let mockAudit: any;

  beforeEach(async () => {
    // Mock transaction with default successful responses
    const mockTx = {
      query: {
        salesOrders: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'so-123',
            status: 'confirmed',
          }),
        },
        warehouses: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'wh-456',
            name: 'Test Warehouse',
          }),
        },
        skus: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'sku-123',
            name: 'Test SKU',
          }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        salesOrderLines: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        fulfillmentOrderLines: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        fulfillmentOrders: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'fo-123',
            salesOrderId: 'so-123',
            status: 'created',
          }),
        },
      },
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 'fo-123' }]),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 'so-123', status: 'fulfilled' }]),
      }),
    } as any; // Cast to any to bypass TypeScript strict checking

    mockDb = {
      db: {
        transaction: jest.fn().mockImplementation((fn) => fn(mockTx)),
      },
    };

    mockPolicies = {
      getVariantPolicy: jest.fn(),
      evaluateFulfillability: jest.fn().mockReturnValue(true),
    };

    mockAvailability = {
      getAvailableQuantity: jest.fn(),
    };

    mockMatchings = {
      getByVariant: jest.fn(),
    };

    mockOutbox = {
      enqueue: jest.fn(),
    };

    mockAudit = {
      logResourceChange: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        FulfillmentsService,
        { provide: DbService, useValue: mockDb },
        { provide: PoliciesService, useValue: mockPolicies },
        { provide: AvailabilityService, useValue: mockAvailability },
        { provide: MatchingsService, useValue: mockMatchings },
        { provide: EventPublisherService, useValue: { publishEvent: jest.fn() } },
        { provide: OutboxService, useValue: mockOutbox },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<FulfillmentsService>(FulfillmentsService);
  });

  describe('create - Basic fulfillment creation', () => {
    it('should create fulfillment order with direct lines', async () => {
      const mockDto = {
        salesOrderId: 'so-123',
        warehouseId: 'wh-456',
        shippingAddress: { address: 'Test Address' },
        lines: [
          { skuId: 'sku-1', quantity: 5 },
          { skuId: 'sku-2', quantity: 3 },
        ],
      };

      // Mocks are already set up in beforeEach

      const result = await service.create(mockDto);

      expect(mockOutbox.enqueue).toHaveBeenCalledWith({
        eventType: expect.any(String),
        aggregateType: 'fulfillment',
        aggregateId: 'fo-123',
        partitionKey: 'fo-123',
        payload: { fulfillmentOrderId: 'fo-123' },
      }, expect.any(Object));
    });

    it('should reject fulfillment for cancelled sales order', async () => {
      const mockDto = {
        salesOrderId: 'so-cancelled',
        warehouseId: 'wh-456',
        lines: [{ skuId: 'sku-1', quantity: 5 }],
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'so-cancelled',
                status: 'cancelled',
              }),
            },
          },
        };
        return fn(mockTx);
      });

      await expect(service.create(mockDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(mockDto)).rejects.toThrow('cancelled sales order');
    });

    it('should reject fulfillment for non-existent sales order', async () => {
      const mockDto = {
        salesOrderId: 'so-nonexistent',
        warehouseId: 'wh-456',
        lines: [{ skuId: 'sku-1', quantity: 5 }],
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          },
        };
        return fn(mockTx);
      });

      await expect(service.create(mockDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(mockDto)).rejects.toThrow('not found');
    });

    it('should reject fulfillment for non-existent warehouse', async () => {
      const mockDto = {
        salesOrderId: 'so-123',
        warehouseId: 'wh-nonexistent',
        lines: [{ skuId: 'sku-1', quantity: 5 }],
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({ id: 'so-123', status: 'confirmed' }),
            },
            warehouses: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          },
        };
        return fn(mockTx);
      });

      await expect(service.create(mockDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(mockDto)).rejects.toThrow('Warehouse');
    });

    it('should reject fulfillment with invalid line data', async () => {
      const mockDto = {
        salesOrderId: 'so-123',
        warehouseId: 'wh-456',
        lines: [
          { skuId: 'sku-1', quantity: 0 }, // Invalid: zero quantity
          { skuId: '', quantity: 5 }, // Invalid: empty skuId
        ],
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({ id: 'so-123', status: 'confirmed' }),
            },
            warehouses: {
              findFirst: jest.fn().mockResolvedValue({ id: 'wh-456' }),
            },
          },
        };
        return fn(mockTx);
      });

      await expect(service.create(mockDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(mockDto)).rejects.toThrow('Invalid line data');
    });

    it('should reject fulfillment for non-existent SKU', async () => {
      const mockDto = {
        salesOrderId: 'so-123',
        warehouseId: 'wh-456',
        lines: [{ skuId: 'sku-nonexistent', quantity: 5 }],
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({ id: 'so-123', status: 'confirmed' }),
            },
            warehouses: {
              findFirst: jest.fn().mockResolvedValue({ id: 'wh-456' }),
            },
            skus: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          },
        };
        return fn(mockTx);
      });

      await expect(service.create(mockDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(mockDto)).rejects.toThrow('SKU');
      await expect(service.create(mockDto)).rejects.toThrow('not found');
    });
  });

  describe('create - Auto-configuration from Sales Order', () => {
    it('should create fulfillment with auto-configured lines from SO matching', async () => {
      const mockDto = {
        salesOrderId: 'so-123',
        warehouseId: 'wh-456',
        // No lines provided - should auto-configure from SO
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({ id: 'so-123', status: 'confirmed' }),
            },
            warehouses: {
              findFirst: jest.fn().mockResolvedValue({ id: 'wh-456' }),
            },
            salesOrderLines: {
              findMany: jest.fn().mockResolvedValue([
                { salesOrderId: 'so-123', variantId: 'var-1', quantity: 2 },
                { salesOrderId: 'so-123', variantId: 'var-2', quantity: 1 },
              ]),
            },
            fulfillmentOrderLines: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([{ id: 'fo-123' }]),
          }),
        };
        return fn(mockTx);
      });

      // Mock policy service
      mockPolicies.getVariantPolicy
        .mockResolvedValueOnce({ fulfillmentMode: 'in_house' })
        .mockResolvedValueOnce({ fulfillmentMode: 'in_house' });

      // Mock matching service
      mockMatchings.getByVariant
        .mockResolvedValueOnce({
          variantId: 'var-1',
          links: [{ skuId: 'sku-1', quantity: 1 }],
        })
        .mockResolvedValueOnce({
          variantId: 'var-2',
          links: [{ skuId: 'sku-2', quantity: 2 }],
        });

      const result = await service.create(mockDto);

      expect(mockMatchings.getByVariant).toHaveBeenCalledWith('var-1', expect.any(Object));
      expect(mockMatchings.getByVariant).toHaveBeenCalledWith('var-2', expect.any(Object));
    });

    it('should reject mixed fulfillment modes', async () => {
      const mockDto = {
        salesOrderId: 'so-123',
        warehouseId: 'wh-456',
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({ id: 'so-123', status: 'confirmed' }),
            },
            warehouses: {
              findFirst: jest.fn().mockResolvedValue({ id: 'wh-456' }),
            },
            salesOrderLines: {
              findMany: jest.fn().mockResolvedValue([
                { salesOrderId: 'so-123', variantId: 'var-1', quantity: 2 },
                { salesOrderId: 'so-123', variantId: 'var-2', quantity: 1 },
              ]),
            },
          },
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([{ id: 'fo-123' }]),
          }),
        };
        return fn(mockTx);
      });

      // Mock mixed policies
      mockPolicies.getVariantPolicy
        .mockResolvedValueOnce({ fulfillmentMode: 'in_house' })
        .mockResolvedValueOnce({ fulfillmentMode: 'drop_ship' });

      await expect(service.create(mockDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(mockDto)).rejects.toThrow('MIXED_FULFILLMENT_MODE_NOT_SUPPORTED');
    });

    it('should require owner for 3PL fulfillment mode', async () => {
      const mockDto = {
        salesOrderId: 'so-123',
        warehouseId: 'wh-456',
        // ownerId missing for 3PL
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({ id: 'so-123', status: 'confirmed' }),
            },
            warehouses: {
              findFirst: jest.fn().mockResolvedValue({ id: 'wh-456' }),
            },
            salesOrderLines: {
              findMany: jest.fn().mockResolvedValue([
                { salesOrderId: 'so-123', variantId: 'var-1', quantity: 2 },
              ]),
            },
          },
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([{ id: 'fo-123' }]),
          }),
        };
        return fn(mockTx);
      });

      mockPolicies.getVariantPolicy.mockResolvedValue({ fulfillmentMode: 'third_party_3pl' });

      await expect(service.create(mockDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(mockDto)).rejects.toThrow('OWNER_REQUIRED_FOR_3PL');
    });
  });

  describe('create - 3PL Validation', () => {
    it('should validate SKU holder matches owner for 3PL fulfillment', async () => {
      const mockDto = {
        salesOrderId: 'so-123',
        warehouseId: 'wh-456',
        ownerId: 'owner-123',
        lines: [{ skuId: 'sku-1', quantity: 5 }],
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({ id: 'so-123', status: 'confirmed' }),
            },
            warehouses: {
              findFirst: jest.fn().mockResolvedValue({ id: 'wh-456' }),
            },
            skus: {
              findFirst: jest.fn().mockResolvedValue({ id: 'sku-1', holderId: 'owner-123' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sku-1', holderId: 'different-owner' }, // Mismatched holder
              ]),
            },
            fulfillmentOrderLines: {
              findMany: jest.fn().mockResolvedValue([
                { fulfillmentOrderId: 'fo-123', skuId: 'sku-1' },
              ]),
            },
          },
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([{ id: 'fo-123', ownerId: 'owner-123' }]),
          }),
        };
        return fn(mockTx);
      });

      await expect(service.create(mockDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(mockDto)).rejects.toThrow('SKU_HOLDER_MISMATCH_FOR_3PL');
    });

    it('should pass 3PL validation when SKU holder matches owner', async () => {
      const mockDto = {
        salesOrderId: 'so-123',
        warehouseId: 'wh-456',
        ownerId: 'owner-123',
        lines: [{ skuId: 'sku-1', quantity: 5 }],
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({ id: 'so-123', status: 'confirmed' }),
            },
            warehouses: {
              findFirst: jest.fn().mockResolvedValue({ id: 'wh-456' }),
            },
            skus: {
              findFirst: jest.fn().mockResolvedValue({ id: 'sku-1', holderId: 'owner-123' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sku-1', holderId: 'owner-123' }, // Matching holder
              ]),
            },
            fulfillmentOrderLines: {
              findMany: jest.fn().mockResolvedValue([
                { fulfillmentOrderId: 'fo-123', skuId: 'sku-1' },
              ]),
            },
          },
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([{ id: 'fo-123', ownerId: 'owner-123' }]),
          }),
        };
        return fn(mockTx);
      });

      // Mock availability and policies for the availability check at the end
      mockAvailability.getAvailableQuantity.mockResolvedValue(10);
      mockPolicies.getVariantPolicy.mockResolvedValue({
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      });

      const result = await service.create(mockDto);

      expect(mockOutbox.enqueue).toHaveBeenCalled();
    });
  });

  describe('determineModeFromSalesOrder', () => {
    it('should return in_house when no lines found', async () => {
      // This is testing private method indirectly through create
      const mockDto = {
        salesOrderId: 'so-empty',
        warehouseId: 'wh-456',
      };

      mockDb.db.transaction.mockImplementation(async (fn) => {
        const mockTx = {
          query: {
            salesOrders: {
              findFirst: jest.fn().mockResolvedValue({ id: 'so-empty', status: 'confirmed' }),
            },
            warehouses: {
              findFirst: jest.fn().mockResolvedValue({ id: 'wh-456' }),
            },
            salesOrderLines: {
              findMany: jest.fn().mockResolvedValue([]), // Empty lines
            },
            fulfillmentOrderLines: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([{ id: 'fo-123' }]),
          }),
        };
        return fn(mockTx);
      });

      const result = await service.create(mockDto);
      expect(mockOutbox.enqueue).toHaveBeenCalled(); // Should succeed with in_house mode
    });
  });
});