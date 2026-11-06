/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import type { PricingVariant } from '../../pricing-detail-model';
import { PriceSetTable } from './index';

const mockPriceSets = jest.fn();
jest.mock('../../use-variant-price-sets', () => ({
  useVariantPriceSets: () => mockPriceSets(),
}));

const variants: PricingVariant[] = [{ id: 'v-red', name: '빨강' }];

describe('PriceSetTable', () => {
  it('shows member tiers even when everyone else gets no quantity discount', () => {
    mockPriceSets.mockReturnValue([
      {
        isLoading: false,
        isError: false,
        data: {
          basePrice: 12000,
          membershipPrice: 8000,
          tieredPrices: [],
          membershipTieredPrices: [
            { minQuantity: 3, price: 7200 },
            { minQuantity: 6, price: 6400 },
          ],
        },
      },
    ]);

    render(<PriceSetTable variants={variants} versionId="ver-1" masterId="m-1" />);

    expect(screen.getByText('일반 할인 없음')).toBeTruthy();
    expect(screen.getByText('멤버십 3개↑ 7,200원 / 6개↑ 6,400원')).toBeTruthy();
  });

  it('shows a dash when there is no quantity discount at all', () => {
    mockPriceSets.mockReturnValue([
      { isLoading: false, isError: false, data: { basePrice: 12000, membershipPrice: 8000, tieredPrices: [], membershipTieredPrices: [] } },
    ]);

    render(<PriceSetTable variants={variants} versionId="ver-1" masterId="m-1" />);

    expect(screen.getByText('-')).toBeTruthy();
  });
});
