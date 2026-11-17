/**
 * @jest-environment jsdom
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { BULK_ORDER_COLUMNS, toCsv } from '../../lib/bulk-order-csv';

const V1 = '11111111-1111-4111-8111-111111111111';

const mockMutateAsync = jest.fn<Promise<unknown>, [unknown]>();

jest.mock('@/lib/services/orders', () => ({
  useCreateSalesOrder: () => ({ mutateAsync: mockMutateAsync }),
}));

jest.mock('@/lib/services/products', () => ({
  useVariantsBatch: (ids: string[]) => ({
    data:
      ids.length > 0
        ? new Map([[V1, { id: V1, masterId: 'm', masterName: '상품 A' }]])
        : undefined,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

import ManualBulkOrderPage from './index';

const csvFor = (orderNo: string, recipient: string) =>
  toCsv([
    [...BULK_ORDER_COLUMNS],
    BULK_ORDER_COLUMNS.map(
      (c) =>
        ({
          orderNo,
          recipientName: recipient,
          recipientPhone: '010',
          zip: '00000',
          addr1: '도로명',
          addr2: '1호',
          variantId: V1,
          quantity: '1',
          unitPrice: '100',
        })[c as string] ?? ''
    ),
  ]);

function fileWith(text: Promise<string> | string) {
  const file = new File([''], 'orders.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  return file;
}

function upload(file: File) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => mockMutateAsync.mockReset());

describe('대량 수동 주문', () => {
  it('검증된 주문을 저장하고 결과를 주문별로 보여 준다', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'saved' });
    render(<ManualBulkOrderPage />);

    upload(fileWith(csvFor('SO-1', '받는 분')));
    const save = await screen.findByRole('button', { name: '1건 저장' });
    fireEvent.click(save);

    await screen.findByText('저장됨');
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        channelOrderId: 'SO-1',
        salesChannel: '3pl',
        lines: [
          expect.objectContaining({ variantId: V1, productName: '상품 A' }),
        ],
      })
    );
  });

  it('새 파일을 읽는 동안에는 이전 파일로 저장할 수 없다', async () => {
    render(<ManualBulkOrderPage />);
    upload(fileWith(csvFor('SO-1', '받는 분')));
    await screen.findByRole('button', { name: '1건 저장' });

    let finish: (text: string) => void = () => {};
    upload(fileWith(new Promise<string>((resolve) => (finish = resolve))));

    const save = screen.getByRole('button', { name: /건 저장/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    expect(mockMutateAsync).not.toHaveBeenCalled();

    await act(async () => finish(csvFor('SO-1', '바뀐 분')));
    await waitFor(() => expect(screen.getByText('바뀐 분')).toBeTruthy());
  });
});
