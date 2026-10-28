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
    mockUseByOrder.mockReturnValue({
      data: item,
      isPending: false,
      isError: false,
    });
  });

  it('응답이 있으면 사유 라벨과 메모를 보여 준다', () => {
    const html = render();
    expect(html).toContain('결제 중 오류가 났어요');
    expect(html).toContain('결제가 두 번 눌렸어요');
    expect(html).toContain('확인했어요');
    expect(html).toContain('/cs/purchase-satisfaction');
  });

  it('응답이 없으면 안내 문구를 보여 준다', () => {
    mockUseByOrder.mockReturnValue({
      data: null,
      isPending: false,
      isError: false,
    });
    expect(render()).toContain('아직 응답이 없어요');
  });

  it('읽기 권한이 없으면 아무것도 그리지 않고 조회도 하지 않는다', () => {
    mockUseCan.mockReturnValue({ status: 'ready', allowed: false });
    expect(render()).toBe('');
    expect(mockUseByOrder).not.toHaveBeenCalled();
  });

  it('미확인 응답에는 확인 전, 확인된 응답에는 확인함 배지를 보여 준다', () => {
    expect(render()).toContain('확인 전');
    mockUseByOrder.mockReturnValue({
      data: { ...item, checkedAt: '2026-10-28T02:00:00.000Z' },
      isPending: false,
      isError: false,
    });
    const html = render();
    expect(html).toContain('확인함');
    expect(html).not.toContain('확인 전');
  });

  it('조회 중에는 로딩 문구를, 실패하면 오류 문구를 보이고 미응답 문구는 숨긴다', () => {
    mockUseByOrder.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    let html = render();
    expect(html).toContain('불러오는 중이에요');
    expect(html).not.toContain('아직 응답이 없어요');
    mockUseByOrder.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });
    html = render();
    expect(html).toContain('만족도를 불러오지 못했어요');
    expect(html).not.toContain('아직 응답이 없어요');
  });

  it('본문을 주문 id 로 key 처리해 주문이 바뀌면 확인 처리 상태가 새로 시작된다', () => {
    const element = PurchaseSatisfactionSection({ medusaOrderId: 'order_9' });
    expect(element?.key).toBe('order_9');
  });
});
