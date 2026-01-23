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
            expect(result.handle).toBe('pim-master-123');
            expect(result.status).toBe('published');
            expect(result.thumbnail).toBe('http://file-service/files/thumb-001');
            expect(result.images).toHaveLength(2);
            expect(result.variants).toHaveLength(2);
        });

        it('should map variant prices correctly', () => {
            const result = transformPimToMedusa(mockSnapshot);
            const variant = result.variants![0];

            // Should have 4 prices: base, membership, tier-10, tier-50
            expect(variant.prices).toHaveLength(4);

            // Base price
            expect(variant.prices![0]).toEqual({
                amount: 10000,
                currency_code: 'KRW',
            });

            // Membership price with customer_group rule
            expect(variant.prices![1]).toEqual({
                amount: 9000,
                currency_code: 'KRW',
                rules: { customer_group_id: 'cusgroup_test_123' },
            });

            // Tier prices with min_quantity
            expect(variant.prices![2]).toEqual({
                amount: 8500,
                currency_code: 'KRW',
                min_quantity: 10,
            });

            expect(variant.prices![3]).toEqual({
                amount: 8000,
                currency_code: 'KRW',
                min_quantity: 50,
            });
        });

        it('should not add membership price if MEMBERSHIP_GROUP_ID is not set', () => {
            delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

            const result = transformPimToMedusa(mockSnapshot);
            const variant = result.variants![0];

            // Should only have base + tier prices (3 total, no membership)
            expect(variant.prices).toHaveLength(3);
            expect(variant.prices!.every((p) => !p.rules?.customer_group_id)).toBe(true);
        });

        it('should handle variants without tier prices', () => {
            const result = transformPimToMedusa(mockSnapshot);
            const variant = result.variants![1]; // SKU-002 has no tier prices

            // Should have 2 prices: base + membership
            expect(variant.prices).toHaveLength(2);
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
