import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockSummary = jest.fn();
const mockBoard = jest.fn();
jest.mock('@/lib/services/orders', () => ({
  useOutboundPreparationSummary: () => mockSummary(),
  useConsolidationBoard: () => mockBoard(),
}));
jest.mock('@/lib/services/inventory/queries', () => ({
  useWarehouses: () => ({ data: [{ id: 'w1', name: '창고' }] }),
}));
jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ can: () => true }),
}));

import {
  ConsolidationMenuBadge,
  OutboundPreparationMenuBadge,
} from './shipment-menu-badges';

const bucket = (name: string, count: number) => ({ bucket: name, count });

describe('출고 메뉴 배지', () => {
  it('출고 준비는 출고불가를 빼고 센다', () => {
    mockSummary.mockReturnValue({
      data: {
        buckets: [
          bucket('ready', 2),
          bucket('unavailable', 9),
          bucket('partial', 1),
        ],
      },
    });

    expect(
      renderToStaticMarkup(createElement(OutboundPreparationMenuBadge))
    ).toContain('>3<');
  });

  it('출고 준비할 게 없으면 그리지 않는다', () => {
    mockSummary.mockReturnValue({
      data: { buckets: [bucket('unavailable', 4)] },
    });

    expect(
      renderToStaticMarkup(createElement(OutboundPreparationMenuBadge))
    ).toBe('');
  });

  it('합칠 수 있는 주문은 묶음 수를 센다', () => {
    mockBoard.mockReturnValue({ data: { groups: [{}, {}] } });

    expect(
      renderToStaticMarkup(createElement(ConsolidationMenuBadge))
    ).toContain('>2<');
  });
});
