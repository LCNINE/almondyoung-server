import {
  getValidPricingVariantId,
  hasRuleMissingScopeTarget,
  selectPricingVariants,
  toPricingVariantsFromMaster,
  toPricingVariantsFromVersion,
} from './pricing-detail-model';
import type { PricingRuleInput } from '@/lib/types/dto/products';

describe('pricing detail model', () => {
  const masterVariants = [
    {
      id: 'variant-active-1',
      masterId: 'master-1',
      name: 'Active Variant',
      status: 'active' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const versionVariants = [
    {
      id: 'variant-draft-9',
      masterId: 'master-1',
      variantName: 'Draft Variant',
      imageId: null,
      displayOrder: 1,
      status: 'active',
      isDefault: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      optionValues: [],
    },
  ];

  it('uses selected version variant ids for version-scoped pricing', () => {
    const selected = selectPricingVariants({
      selectedVersionId: 'ver-draft',
      masterVariants: toPricingVariantsFromMaster(masterVariants),
      versionVariants: toPricingVariantsFromVersion(versionVariants),
    });

    expect(selected).toEqual([{ id: 'variant-draft-9', name: 'Draft Variant' }]);
  });

  it('falls back to master variants only when no version is selected', () => {
    const selected = selectPricingVariants({
      selectedVersionId: null,
      masterVariants: toPricingVariantsFromMaster(masterVariants),
      versionVariants: toPricingVariantsFromVersion(versionVariants),
    });

    expect(selected).toEqual([{ id: 'variant-active-1', name: 'Active Variant' }]);
  });

  it('clears a selected variant id that is no longer in the selected version', () => {
    expect(
      getValidPricingVariantId(
        'variant-active-1',
        toPricingVariantsFromVersion(versionVariants),
      ),
    ).toBe('');

    expect(
      getValidPricingVariantId(
        'variant-draft-9',
        toPricingVariantsFromVersion(versionVariants),
      ),
    ).toBe('variant-draft-9');
  });
});

describe('hasRuleMissingScopeTarget', () => {
  const rule = (over: Partial<PricingRuleInput>): PricingRuleInput => ({
    order: 1,
    layer: 'base_price',
    scopeType: 'all_variants',
    operationType: 'override',
    operationValue: 0,
    ...over,
  });

  it('is false when all_variants rules have no targets', () => {
    expect(hasRuleMissingScopeTarget([rule({ scopeType: 'all_variants' })])).toBe(false);
  });

  it('is false when option-scoped rules carry at least one target', () => {
    expect(
      hasRuleMissingScopeTarget([
        rule({ scopeType: 'with_option', scopeTargetIds: ['ov-1'] }),
        rule({ scopeType: 'variants', scopeTargetIds: ['v-1', 'v-2'] }),
      ]),
    ).toBe(false);
  });

  it('is true when a with_option rule has an empty or missing target list', () => {
    expect(hasRuleMissingScopeTarget([rule({ scopeType: 'with_option', scopeTargetIds: [] })])).toBe(
      true,
    );
    expect(hasRuleMissingScopeTarget([rule({ scopeType: 'with_option' })])).toBe(true);
  });

  it('is true when a variants rule has no targets', () => {
    expect(
      hasRuleMissingScopeTarget([rule({ scopeType: 'variants', scopeTargetIds: undefined })]),
    ).toBe(true);
  });
});
