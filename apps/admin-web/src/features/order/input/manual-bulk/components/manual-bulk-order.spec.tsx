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
import type { ReactNode } from 'react';
import { BULK_ORDER_COLUMNS, toCsv } from '../../lib/bulk-order-csv';

const V1 = '11111111-1111-4111-8111-111111111111';

const mockMutateAsync = jest.fn<Promise<unknown>, [unknown]>();

jest.mock('@/lib/services/orders', () => ({
  useCreateSalesOrder: () => ({ mutateAsync: mockMutateAsync }),
}));

jest.mock('@/components/auth/can', () => ({
  CanOpen: ({ children }: { children: ReactNode }) => children,
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

const csvForMany = (orderNos: string[]) =>
  toCsv([
    [...BULK_ORDER_COLUMNS],
    ...orderNos.map((orderNo) => {
      const values: Record<string, string> = {
        orderNo,
        recipientName: '받는 분',
        recipientPhone: '010',
        zip: '00000',
        addr1: '도로명',
        addr2: '1호',
        variantId: V1,
        quantity: '1',
        unitPrice: '100',
      };

      return BULK_ORDER_COLUMNS.map((column) => values[column] ?? '');
    }),
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

    await screen.findAllByText(/저장됨/);
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

  it('파일 읽기 실패를 알리고 다음 파일을 다시 선택해 저장할 수 있다', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'saved-id' });
    render(<ManualBulkOrderPage />);

    upload(fileWith(Promise.reject(new Error('read failed'))));
    expect(
      await screen.findByText(
        'CSV 파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.'
      )
    ).toBeTruthy();

    upload(fileWith(csvFor('SO-1', '받는 분')));
    fireEvent.click(await screen.findByRole('button', { name: '1건 저장' }));

    await screen.findByText('시도 1 · orders.csv');
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('저장·중복·실패를 모두 세고 생성 주문 링크를 보여 준다', async () => {
    mockMutateAsync
      .mockResolvedValueOnce({ id: 'created-id' })
      .mockRejectedValueOnce(
        Object.assign(new Error('기존 번호'), { statusCode: 409 })
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('입력 오류'), { statusCode: 400 })
      );
    render(<ManualBulkOrderPage />);

    upload(fileWith(csvForMany(['SO-1', 'SO-2', 'SO-3'])));
    fireEvent.click(await screen.findByRole('button', { name: '3건 저장' }));

    expect(
      await screen.findByText(
        /저장 1건 · 기존 번호 중복 1건 · 실패 1건 · 결과 미확인 0건/
      )
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole('link', { name: '생성 주문 열기' })[0]
        .getAttribute('href')
    ).toBe('/cs?orderId=created-id&orderNo=SO-1');
    expect(
      screen
        .getAllByRole('link', { name: '주문내역에서 확인' })[0]
        .getAttribute('href')
    ).toBe('/order/history?orderNo=SO-2');
  });

  it('새 파일의 같은 번호를 다시 시도하면서 앞선 결과를 보존한다', async () => {
    mockMutateAsync
      .mockResolvedValueOnce({ id: 'first-id' })
      .mockRejectedValueOnce(
        Object.assign(new Error('기존 번호'), { statusCode: 409 })
      );
    render(<ManualBulkOrderPage />);

    upload(fileWith(csvFor('SO-1', '첫 받는 분')));
    fireEvent.click(await screen.findByRole('button', { name: '1건 저장' }));
    await screen.findByText('시도 1 · orders.csv');

    upload(fileWith(csvFor('SO-1', '바뀐 받는 분')));
    await screen.findByText('바뀐 받는 분');
    expect(screen.getByRole('button', { name: '1건 저장' })).toBeTruthy();
    expect(screen.getByText('시도 1 · orders.csv')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '1건 저장' }));
    await screen.findByText('시도 2 · orders.csv');

    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    expect(mockMutateAsync.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        channelOrderId: 'SO-1',
        shippingAddress: expect.objectContaining({
          recipientName: '바뀐 받는 분',
        }),
      })
    );
    expect(screen.getAllByText('SO-1').length).toBeGreaterThan(1);
    expect(screen.getAllByText(/저장됨/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/기존 번호 중복/).length).toBeGreaterThan(0);
  });

  it('응답 유실은 결과 미확인으로 남기고 같은 번호 재시도의 409도 별도 기록한다', async () => {
    mockMutateAsync
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(
        Object.assign(new Error('기존 번호'), { statusCode: 409 })
      );
    render(<ManualBulkOrderPage />);

    upload(fileWith(csvFor('SO-1', '받는 분')));
    fireEvent.click(await screen.findByRole('button', { name: '1건 저장' }));
    expect(
      await screen.findByText(
        /저장 0건 · 기존 번호 중복 0건 · 실패 0건 · 결과 미확인 1건/
      )
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: '실패·미확인 1건 다시 시도' })
    );
    await screen.findByText('시도 2 · orders.csv');

    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/결과 미확인 —/)).toBeTruthy();
    expect(screen.getAllByText(/기존 번호 중복/).length).toBeGreaterThan(0);
  });

  it('같은 파일에서 일부 실패를 재시도할 때 저장된 주문은 다시 보내지 않는다', async () => {
    mockMutateAsync
      .mockResolvedValueOnce({ id: 'first-id' })
      .mockRejectedValueOnce(
        Object.assign(new Error('입력 오류'), { statusCode: 400 })
      )
      .mockResolvedValueOnce({ id: 'second-id' });
    render(<ManualBulkOrderPage />);

    upload(fileWith(csvForMany(['SO-1', 'SO-2'])));
    fireEvent.click(await screen.findByRole('button', { name: '2건 저장' }));
    await screen.findByText('시도 1 · orders.csv');

    fireEvent.click(
      screen.getByRole('button', { name: '실패·미확인 1건 다시 시도' })
    );
    await screen.findByText('시도 2 · orders.csv');

    expect(mockMutateAsync).toHaveBeenCalledTimes(3);
    expect(mockMutateAsync.mock.calls[2][0]).toEqual(
      expect.objectContaining({ channelOrderId: 'SO-2' })
    );
  });

  it('저장 중에는 파일 선택과 두 번째 저장을 막는다', async () => {
    let finish: (value: { id: string }) => void = () => {};
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<ManualBulkOrderPage />);

    upload(fileWith(csvFor('SO-1', '받는 분')));
    fireEvent.click(await screen.findByRole('button', { name: '1건 저장' }));

    expect(
      (document.querySelector('input[type=file]') as HTMLInputElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '저장 중...' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    upload(fileWith(csvFor('SO-2', '새 받는 분')));

    await act(async () => finish({ id: 'first-id' }));
    await screen.findByText('시도 1 · orders.csv');
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('새 받는 분')).toBeNull();
  });
});
