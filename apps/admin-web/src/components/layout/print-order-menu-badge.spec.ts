import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockSummary = jest.fn();
jest.mock('@/lib/services/orders/print-orders.queries', () => ({
  usePrintOrderSummary: () => mockSummary(),
}));

import { PrintOrderMenuBadge } from './print-order-menu-badge';

const render = () => renderToStaticMarkup(createElement(PrintOrderMenuBadge));
const summary = (over: Record<string, number>) => ({
  data: {
    cancelRefused: 0,
    testPending: 0,
    failed: 0,
    unsupported: 0,
    total: 9,
    ...over,
  },
  isLoading: false,
});

describe('PrintOrderMenuBadge', () => {
  it('처리할 건이 0이면 아무것도 그리지 않는다', () => {
    mockSummary.mockReturnValue(summary({}));
    expect(render()).toBe('');
  });

  it('로딩 중이면 아무것도 그리지 않는다', () => {
    mockSummary.mockReturnValue({ data: undefined, isLoading: true });
    expect(render()).toBe('');
  });

  it('취소 확인 필요가 있으면 빨간 배지에 합계를 보여준다', () => {
    mockSummary.mockReturnValue(
      summary({ cancelRefused: 2, failed: 1, unsupported: 2 })
    );
    const html = render();
    expect(html).toContain('bg-destructive');
    expect(html).toContain('>5<');
  });

  it('취소 확인 필요가 없으면 빨강이 아니다', () => {
    mockSummary.mockReturnValue(summary({ testPending: 4 }));
    const html = render();
    expect(html).not.toContain('bg-destructive');
    expect(html).toContain('>4<');
  });
});
