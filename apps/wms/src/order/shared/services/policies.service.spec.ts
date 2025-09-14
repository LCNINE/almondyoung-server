import { Test } from '@nestjs/testing';
import { DbService } from '@app/db';
import { PoliciesService } from './policies.service';

describe('PoliciesService', () => {
  let service: PoliciesService;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      query: {
        salesVariantPolicies: {
          findFirst: jest.fn(),
        },
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        PoliciesService,
        { provide: DbService, useValue: { db: mockDb } },
      ],
    }).compile();

    service = module.get<PoliciesService>(PoliciesService);
  });

  describe('getVariantPolicy', () => {
    const variantId = 'variant-123';

    it('should return existing policy when found', async () => {
      const mockPolicy = {
        variantId,
        inventoryManagement: true,
        preStockSellable: true,
        alwaysSellableZeroStock: false,
        fulfillmentMode: 'in_house',
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: new Date('2024-12-31'),
        updatedBy: 'admin',
        updatedAt: new Date(),
      };

      mockDb.query.salesVariantPolicies.findFirst.mockResolvedValue(mockPolicy);

      const result = await service.getVariantPolicy(variantId);

      expect(result).toEqual(mockPolicy);
      expect(mockDb.query.salesVariantPolicies.findFirst).toHaveBeenCalledWith({
        where: expect.any(Function),
      });
    });

    it('should return default policy when no policy found', async () => {
      mockDb.query.salesVariantPolicies.findFirst.mockResolvedValue(null);

      const result = await service.getVariantPolicy(variantId);

      expect(result).toMatchObject({
        variantId,
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        fulfillmentMode: null,
        effectiveFrom: null,
        effectiveTo: null,
        updatedBy: null,
      });
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should work with transaction context', async () => {
      const mockTx = {
        query: {
          salesVariantPolicies: {
            findFirst: jest.fn().mockResolvedValue({
              variantId,
              inventoryManagement: true,
              preStockSellable: false,
            }),
          },
        },
      } as any; // Cast to any to bypass TypeScript strict checking for mock

      const result = await service.getVariantPolicy(variantId, mockTx);

      expect(result.inventoryManagement).toBe(true);
      expect(mockTx.query.salesVariantPolicies.findFirst).toHaveBeenCalled();
    });

    it('should handle policy with future effective date', async () => {
      const futureDate = new Date('2030-12-31');
      const mockPolicy = {
        variantId,
        inventoryManagement: true,
        effectiveFrom: futureDate,
        effectiveTo: null,
      };

      mockDb.query.salesVariantPolicies.findFirst.mockResolvedValue(mockPolicy);

      const result = await service.getVariantPolicy(variantId);

      expect(result).toEqual(mockPolicy);
    });

    it('should handle expired policy', async () => {
      const pastDate = new Date('2020-01-01');
      const mockPolicy = {
        variantId,
        inventoryManagement: true,
        effectiveFrom: null,
        effectiveTo: pastDate,
      };

      mockDb.query.salesVariantPolicies.findFirst.mockResolvedValue(mockPolicy);

      const result = await service.getVariantPolicy(variantId);

      expect(result).toEqual(mockPolicy);
    });
  });

  describe('evaluateAcceptance', () => {
    it('should accept when inventory management is disabled', () => {
      const policy = {
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      };

      const result = service.evaluateAcceptance(policy, 0, 100);

      expect(result).toBe(true);
    });

    it('should accept when pre-stock sellable is enabled', () => {
      const policy = {
        inventoryManagement: true,
        preStockSellable: true,
        alwaysSellableZeroStock: false,
      };

      const result = service.evaluateAcceptance(policy, 0, 100);

      expect(result).toBe(true);
    });

    it('should accept when always sellable zero stock is enabled', () => {
      const policy = {
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: true,
      };

      const result = service.evaluateAcceptance(policy, 0, 100);

      expect(result).toBe(true);
    });

    it('should accept when sufficient stock is available', () => {
      const policy = {
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      };

      const result = service.evaluateAcceptance(policy, 100, 50);

      expect(result).toBe(true);
    });

    it('should reject when insufficient stock and no special policies', () => {
      const policy = {
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      };

      const result = service.evaluateAcceptance(policy, 30, 50);

      expect(result).toBe(false);
    });

    it('should accept when exact stock matches request', () => {
      const policy = {
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      };

      const result = service.evaluateAcceptance(policy, 50, 50);

      expect(result).toBe(true);
    });
  });

  describe('evaluateFulfillability', () => {
    it('should be fulfillable when inventory management is disabled', () => {
      const policy = {
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      };

      const result = service.evaluateFulfillability(policy, 0, 100);

      expect(result).toBe(true);
    });

    it('should be fulfillable when sufficient stock exists', () => {
      const policy = {
        inventoryManagement: true,
        preStockSellable: true, // 이건 fulfillability에 영향 안함
        alwaysSellableZeroStock: true, // 이것도 fulfillability에 영향 안함
      };

      const result = service.evaluateFulfillability(policy, 100, 50);

      expect(result).toBe(true);
    });

    it('should not be fulfillable when insufficient physical stock', () => {
      const policy = {
        inventoryManagement: true,
        preStockSellable: true, // acceptance는 허용하지만
        alwaysSellableZeroStock: false,
      };

      const result = service.evaluateFulfillability(policy, 30, 50); // 실제 재고 부족

      expect(result).toBe(false);
    });

    it('should be fulfillable with exact stock match', () => {
      const policy = {
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      };

      const result = service.evaluateFulfillability(policy, 50, 50);

      expect(result).toBe(true);
    });

    it('should handle zero stock scenarios', () => {
      const policy = {
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: true, // acceptance에서는 허용
      };

      // 하지만 fulfillability는 실제 재고가 필요
      const result = service.evaluateFulfillability(policy, 0, 1);

      expect(result).toBe(false);
    });
  });
});