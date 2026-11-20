/** @jest-environment jsdom */
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomError } from '@/lib/api/customError';
import { ReplenishmentTable } from './components/table';
import { ReplenishmentSkuDrawer } from './components/sku-drawer';

const mockReplace = jest.fn();
const mockParams = { value: new URLSearchParams() };
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/inventory/replenishment',
  useSearchParams: () => mockParams.value,
}));

const mockSku = jest.fn();
jest.mock('@/lib/services/inventory', () => {
  const useCreateTransferOrder = () => ({
    mutateAsync: jest.fn(),
    isPending: false,
    variables: undefined,
  });
  useCreateTransferOrder.permission = ['inventory.stock.adjust'];
  const useAddToCart = () => ({ mutateAsync: jest.fn(), isPending: false });
  useAddToCart.permission = ['inventory.master.write'];

  return {
    useReplenishmentSuggestions: () => ({
      data: { items: [], evaluated: 0, total: 0 },
      isLoading: false,
      isError: false,
      error: null,
    }),
    useReplenishmentSku: (skuId: string | null) => mockSku(skuId),
    useAddToCart,
    useCreateTransferOrder,
  };
});

const mockCanRun = { value: true };
jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ canRun: () => mockCanRun.value }),
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const segment = { meanDays: 1, stdDays: 0, source: 'global_default' };
const sourced = { value: 1, source: 'global_default' };
const detail = {
  skuId: 'sku-1',
  skuCode: 'A-01',
  skuName: '상품 A',
  supplier: null,
  pattern: 'smooth',
  grade: 'A',
  confidence: 1,
  demand: { dailyMean: 1 },
  company: { onHand: 0, onOrder: 0, position: 0, reorderPoint: 0 },
  sellable: {
    onHand: 0,
    reserved: 0,
    inTransit: 0,
    position: 0,
    reorderPoint: 1,
    daysOfCover: 0,
  },
  actions: [
    {
      type: 'transfer',
      qty: 4,
      fromWarehouseId: 'w-from',
      toWarehouseId: 'w-to',
      lines: [{ fromLocationId: 'loc-1', quantity: 4 }],
    },
  ],
  flags: [],
  legacyReorderPoint: 0,
  profile: null,
  parameters: {
    excluded: false,
    alpha: sourced,
    l1: segment,
    l2: segment,
    coverDays: sourced,
    transferCoverDays: sourced,
    overrideSafetyStock: null,
    usesDefaultLeadTime: false,
  },
};

beforeEach(() => {
  mockReplace.mockReset();
  mockSku.mockReset();
  mockCanRun.value = true;
  mockParams.value = new URLSearchParams();
  mockSku.mockImplementation((skuId: string | null) =>
    skuId
      ? { data: detail, isLoading: false, isError: false, error: null }
      : { data: undefined, isLoading: false, isError: false, error: null }
  );
});

it('주소의 sku 로 그 상품의 판정을 열고, 닫으면 주소에서 뺀다', async () => {
  mockParams.value = new URLSearchParams('sku=sku-1');
  render(<ReplenishmentTable />);

  expect(await screen.findByText('상품 A (A-01)')).toBeTruthy();
  expect(mockSku).toHaveBeenCalledWith('sku-1');

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith('/inventory/replenishment')
  );
});

it('화면이 떠 있는 동안 주소의 sku 가 바뀌면 그 상품 판정으로 바꾸고, 빠지면 닫는다', async () => {
  mockParams.value = new URLSearchParams('sku=sku-1');
  const { rerender } = render(<ReplenishmentTable />);
  expect(await screen.findByRole('dialog')).toBeTruthy();

  mockParams.value = new URLSearchParams('sku=sku-2');
  rerender(<ReplenishmentTable />);
  expect(mockSku).toHaveBeenLastCalledWith('sku-2');

  mockParams.value = new URLSearchParams();
  rerender(<ReplenishmentTable />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('주소에 sku 가 없으면 판정을 열지 않는다', () => {
  render(<ReplenishmentTable />);

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockSku).not.toHaveBeenCalledWith('sku-1');
});

it('판정을 못 불러오면 «로딩 중» 대신 이유를 보인다', () => {
  mockSku.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: true,
    error: new CustomError({
      message: '판매 창고가 정확히 하나가 아닙니다.',
      statusCode: 409,
    }),
  });
  render(<ReplenishmentSkuDrawer skuId="sku-1" onOpenChange={jest.fn()} />);

  expect(
    screen.getByText(
      '판정을 불러오지 못했습니다. 판매 창고가 하나인지 확인하세요.'
    )
  ).toBeTruthy();
  expect(screen.queryByText('로딩 중...')).toBeNull();
});
