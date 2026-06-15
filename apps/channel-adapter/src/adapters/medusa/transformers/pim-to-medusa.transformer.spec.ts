// apps/channel-adapter/src/services/pim-medusa-sync/pim-to-medusa.transformer.spec.ts
import { transformPimToMedusa, validatePimSnapshot } from './pim-to-medusa.transformer';
import type { PimProductSnapshot } from '../../types';

describe('PimToMedusaTransformer', () => {
  const mockSnapshot: PimProductSnapshot = {
    masterId: 'master-123',
    versionId: 'version-456',
    version: 1,
    name: 'Test Product',
    description: 'Test Description',
    thumbnail: 'http://file-service/files/thumb-001',
    images: ['http://file-service/files/img-001', 'http://file-service/files/img-002'],
    categoryIds: ['cat-1'],
    tags: ['tag1', 'tag2'],
    optionGroups: [
      {
        id: 'opt-group-1',
        name: 'Color',
        values: [
          { id: 'val-1', name: 'Red' },
          { id: 'val-2', name: 'Blue' },
        ],
      },
    ],
    variants: [
      {
        id: 'var-001',
        sku: 'SKU-001',
        isDefault: false,
        status: 'active',
        optionCombination: [{ name: 'Color', value: 'Red' }],
        basePrice: 10000,
        membershipPrice: 9000,
        tieredPrices: [
          { minQuantity: 10, price: 8500 },
          { minQuantity: 50, price: 8000 },
        ],
      },
      {
        id: 'var-002',
        sku: 'SKU-002',
        isDefault: false,
        status: 'active',
        optionCombination: [{ name: 'Color', value: 'Blue' }],
        basePrice: 10000,
        membershipPrice: 9000,
      },
    ],
    status: 'active',
    isGiftcard: false,
    discountable: true,
  };

  beforeEach(() => {
    // Mock environment variables
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = 'cusgroup_test_123';
    process.env.SKIP_VARIANTS_WITHOUT_PRICE = 'false';
  });

  describe('transformPimToMedusa', () => {
    it('should transform PIM snapshot to Medusa payload', () => {
      const result = transformPimToMedusa(mockSnapshot);

      expect(result.title).toBe('Test Product');
      expect(result.handle).toBe('master-123');
      expect(result.status).toBe('published');
      expect(result.thumbnail).toBe('http://file-service/files/thumb-001');
      expect(result.images).toHaveLength(2);
      expect(result.variants).toHaveLength(2);
    });

    it('does not project product detail markdown or legacy HTML into Medusa description', () => {
      const result = transformPimToMedusa({
        ...mockSnapshot,
        description: '# Markdown detail\n\n::product-image{fileId="018f70fb-8a0f-7d44-9f1b-4d6f563a1111" alt="상세"}',
        descriptionHtml: '<img src="https://legacy.example/detail.jpg" />',
      });

      expect(result.description).toBeUndefined();
    });

    it('projects purchase constraints into separate Medusa product metadata', () => {
      const result = transformPimToMedusa({
        ...mockSnapshot,
        isMembershipOnly: false,
        purchaseConstraint: {
          requiresMembership: true,
          lifetimeQuantityLimit: 3,
        },
      });

      expect(result.metadata.pimPurchaseConstraint).toEqual({
        requiresMembership: true,
        lifetimeQuantityLimit: 3,
      });
      expect(result.metadata.isMembershipOnly).toBe(false);
    });

    it('projects isMembershipOnly as price-visibility metadata without hiding the product (status stays published)', () => {
      // isMembershipOnly는 "비회원에게 멤버십가 숨김" 표시 정책 값일 뿐,
      // Medusa 상품 노출(status/visibility)에 영향을 주면 안 된다.
      const result = transformPimToMedusa({
        ...mockSnapshot,
        isMembershipOnly: true,
      });

      expect(result.metadata.isMembershipOnly).toBe(true);
      expect(result.status).toBe('published');
    });

    it('sets null pimPurchaseConstraint when no purchase constraint exists so Medusa updates clear stale metadata', () => {
      const result = transformPimToMedusa({
        ...mockSnapshot,
        purchaseConstraint: undefined,
      });

      expect(result.metadata.pimPurchaseConstraint).toBeNull();
    });

    it('assigns the default shipping profile to physical products', () => {
      const result = transformPimToMedusa(
        { ...mockSnapshot, fulfillmentKind: 'physical' },
        { shipping_profile_id: 'sp_default' },
      );

      expect(result.shipping_profile_id).toBe('sp_default');
      expect(result.metadata.fulfillmentKind).toBe('physical');
      expect(result.metadata.requiresShipping).toBe(true);
    });

    it('clears shipping profile for digital products', () => {
      const result = transformPimToMedusa(
        { ...mockSnapshot, fulfillmentKind: 'digital' },
        { shipping_profile_id: 'sp_default' },
      );

      expect(result.shipping_profile_id).toBeNull();
      expect(result.metadata.fulfillmentKind).toBe('digital');
      expect(result.metadata.requiresShipping).toBe(false);
    });

    it('should map base variant price and preserve price-list metadata', () => {
      const result = transformPimToMedusa(mockSnapshot);
      const variant = result.variants![0];

      expect(variant.prices).toHaveLength(1);

      expect(variant.prices![0]).toEqual({
        amount: 10000,
        currency_code: 'krw',
      });
      expect(variant.metadata?.membershipPrice).toBe(9000);
      expect(variant.metadata?.tieredPrices).toEqual([
        { minQuantity: 10, price: 8500 },
        { minQuantity: 50, price: 8000 },
      ]);
    });

    it('should not add membership price to the product payload if MEMBERSHIP_GROUP_ID is not set', () => {
      delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

      const result = transformPimToMedusa(mockSnapshot);
      const variant = result.variants![0];

      expect(variant.prices).toHaveLength(1);
      expect(variant.prices!.every((p) => !p.rules?.customer_group_id)).toBe(true);
    });

    it('should handle variants without tier prices', () => {
      const result = transformPimToMedusa(mockSnapshot);
      const variant = result.variants![1]; // SKU-002 has no tier prices

      expect(variant.prices).toHaveLength(1);
      expect(variant.metadata?.tieredPrices).toBeUndefined();
    });

    it('should skip variants without basePrice when SKIP_VARIANTS_WITHOUT_PRICE is true', () => {
      process.env.SKIP_VARIANTS_WITHOUT_PRICE = 'true';

      const snapshotWithInvalidVariant: PimProductSnapshot = {
        ...mockSnapshot,
        variants: [
          ...mockSnapshot.variants,
          {
            id: 'var-003',
            sku: 'SKU-003',
            isDefault: false,
            status: 'active',
            // No basePrice!
          },
        ],
      };

      const result = transformPimToMedusa(snapshotWithInvalidVariant);

      // Should only have 2 variants (var-003 skipped)
      expect(result.variants).toHaveLength(2);
    });
  });

  describe('validatePimSnapshot', () => {
    it('should pass validation for valid snapshot', () => {
      expect(() => validatePimSnapshot(mockSnapshot)).not.toThrow();
    });

    it('should throw error if masterId is missing', () => {
      const invalid = { ...mockSnapshot, masterId: '' };
      expect(() => validatePimSnapshot(invalid)).toThrow('missing masterId');
    });

    it('should throw error if no variants exist', () => {
      const invalid = { ...mockSnapshot, variants: [] };
      expect(() => validatePimSnapshot(invalid)).toThrow('at least one variant');
    });

    it('should throw error if all variants have no price and SKIP_VARIANTS_WITHOUT_PRICE is true', () => {
      process.env.SKIP_VARIANTS_WITHOUT_PRICE = 'true';

      const invalid: PimProductSnapshot = {
        ...mockSnapshot,
        variants: [
          {
            id: 'var-001',
            sku: 'SKU-001',
            isDefault: false,
            status: 'active',
            // No basePrice
          },
        ],
      };

      expect(() => validatePimSnapshot(invalid)).toThrow('no variants with valid prices');
    });
  });
});
