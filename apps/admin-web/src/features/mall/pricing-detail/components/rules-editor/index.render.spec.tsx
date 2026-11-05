/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { PricingRuleResponseDto, PricingRulesResponseDto } from '@/lib/types/dto/products';
import { RulesEditor } from './index';

const rule = (over: Partial<PricingRuleResponseDto>): PricingRuleResponseDto => ({
  id: 'r-1',
  layer: 'base_price',
  order: 1,
  scopeType: 'all_variants',
  scopeTargetIds: null,
  operationType: 'override',
  operationValue: 20000,
  minQuantity: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('RulesEditor', () => {
  it('saves base and membership rules and never sends quantity rules back', () => {
    const rules: PricingRulesResponseDto = {
      basePriceRules: [rule({})],
      membershipPriceRules: [rule({ id: 'r-2', layer: 'membership_price', operationValue: 18000 })],
      tieredPriceRules: [rule({ id: 'r-3', layer: 'tiered_price', minQuantity: 2, operationValue: 17000 })],
    };
    const onSave = jest.fn();

    render(
      <RulesEditor
        rules={rules}
        readonly={false}
        canSave
        isSaving={false}
        isDeleting={false}
        optionGroups={[]}
        variantOptions={[]}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledWith({
      basePriceRules: [expect.objectContaining({ layer: 'base_price', operationValue: 20000 })],
      membershipPriceRules: [expect.objectContaining({ layer: 'membership_price', operationValue: 18000 })],
      tieredPriceRules: [],
    });
  });
});
