import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PurchaseSatisfactionSection } from '../purchase-satisfaction-section';

const mockUseCan = jest.fn();
const mockUseByOrder = jest.fn();

jest.mock('@/hooks/use-permission', () => ({
  useCan: (...args: unknown[]) => mockUseCan(...args),
}));
jest.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
}));
jest.mock('@/lib/services/purchase-satisfaction', () => ({
  usePurchaseSatisfactionByOrder: (...args: unknown[]) =>
    mockUseByOrder(...args),
  useSetPurchaseSatisfactionChecked: Object.assign(
    () => ({ isPending: false, isError: false, mutate: jest.fn() }),
    {
      permission: ['cs.satisfaction.manage'],
    }
  ),
}));

const item = {
  id: 's1',
  orderId: 'order_1',
  orderDisplayId: 1234,
  userId: 'u1',
  rating: 2,
  reasons: ['PAYMENT_ERROR'],
  memo: '결제가 두 번 눌렸어요',
  checkedAt: null,
  checkedBy: null,
  createdAt: '2026-10-28T01:00:00.000Z',
  updatedAt: '2026-10-28T01:00:00.000Z',
};

const render = () =>
  renderToStaticMarkup(
    createElement(PurchaseSatisfactionSection, { medusaOrderId: 'order_1' })
  );

describe('PurchaseSatisfactionSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCan.mockReturnValue({ status: 'ready', allowed: true });
    mockUseByOrder.mockReturnValue({ data: item });
  });

  it('응답이 있으면 사유 라벨과 메모를 보여 준다', () => {
    const html = render();
    expect(html).toContain('결제 중 오류가 났어요');
    expect(html).toContain('결제가 두 번 눌렸어요');
    expect(html).toContain('확인했어요');
    expect(html).toContain('/cs/purchase-satisfaction');
  });

  it('응답이 없으면 안내 문구를 보여 준다', () => {
    mockUseByOrder.mockReturnValue({ data: null });
    expect(render()).toContain('아직 응답이 없어요');
  });

  it('읽기 권한이 없으면 아무것도 그리지 않고 조회도 하지 않는다', () => {
    mockUseCan.mockReturnValue({ status: 'ready', allowed: false });
    expect(render()).toBe('');
    expect(mockUseByOrder).not.toHaveBeenCalled();
  });
});
