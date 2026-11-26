/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DirectDeliveryPreview } from '@/lib/api/domains/orders/direct-delivery.client';
import { DirectDeliveryDialog } from './direct-delivery-dialog';

const mockPreview = jest.fn();
const mockTakeover = jest.fn();
const mockDispatch = jest.fn();
const mockReturn = jest.fn();
const mockToast = { success: jest.fn(), error: jest.fn() };

jest.mock('sonner', () => ({
  toast: {
    success: (text: string) => mockToast.success(text),
    error: (text: string) => mockToast.error(text),
  },
}));
jest.mock('@/lib/services/orders/direct-delivery', () => ({
  useDirectDeliveryPreview: () => mockPreview(),
  useDirectDeliveryTakeover: () => ({
    mutateAsync: mockTakeover,
    isPending: false,
  }),
  useDirectDeliveryDispatch: () => ({
    mutateAsync: mockDispatch,
    isPending: false,
  }),
  useDirectDeliveryReturn: () => ({
    mutateAsync: mockReturn,
    isPending: false,
  }),
}));
// Radix Select 는 jsdom 에서 열기 어렵다 — 같은 값·같은 이름표의 기본 select 로 바꾼다
jest.mock('@/components/ui/select', () => {
  const items: Array<{ value: string; children: ReactNode }> = [];
  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value: string;
      onValueChange: (v: string) => void;
      disabled?: boolean;
      children: ReactNode;
    }) => (
      <div data-select-value={value} data-disabled={disabled}>
        {children}
        <select
          aria-label="고르기"
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        >
          <option value="" />
          {items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.value}
            </option>
          ))}
        </select>
      </div>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: ReactNode;
    }) => {
      if (!items.some((item) => item.value === value))
        items.push({ value, children });
      return <span data-option={value}>{children}</span>;
    },
  };
});

const refetch = jest.fn();

function preview(over: Partial<DirectDeliveryPreview> = {}) {
  mockPreview.mockReturnValue({
    data: {
      shipmentId: 'box',
      owner: 'warehouse',
      status: 'draft',
      manifestVersion: 3,
      supplierId: null,
      handedOff: false,
      salesOrderId: 'so',
      fulfillmentOrderId: 'fo',
      orderNo: 'A-1',
      lines: [
        {
          lineId: 'l1',
          skuId: 'sku',
          skuName: '상품 가',
          qty: 2,
          reservedQty: 1,
          linkedSupplierId: 'sup-1',
        },
      ],
      suggestedSupplierId: 'sup-1',
      suppliers: [
        { id: 'sup-1', name: '공급처 가' },
        { id: 'sup-2', name: '공급처 나' },
      ],
      recipient: {
        name: '받는분',
        phone: '010-0000-0000',
        address: '서울 1',
        memo: '',
        entrancePassword: '',
      },
      blockers: [],
      dispatchBlockers: [],
      ...over,
    },
    isPending: false,
    isFetching: false,
    refetch,
  });
}

function rejection(status: number, code: string) {
  return Object.assign(new Error('거절'), {
    statusCode: status,
    response: { code, message: '거절' },
  });
}

const open = () => {
  const onClose = jest.fn();
  render(
    <DirectDeliveryDialog shipmentId="box" orderText="#A-1" onClose={onClose} />
  );
  return onClose;
};

const selects = () => screen.getAllByRole('combobox', { name: '고르기' });

let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  configurable: true,
  value: () => `key-${++keys}`,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTakeover.mockReset();
  mockDispatch.mockReset();
  mockReturn.mockReset();
  keys = 0;
});

describe('창고 상자를 공급처에 맡기기', () => {
  it('상품에 연결된 공급처를 미리 고르고, 송장 없이 맡기면 그 버전으로 맡김만 보낸다', async () => {
    preview();
    mockTakeover.mockResolvedValue({
      shipmentId: 'new',
      previousShipmentId: 'box',
      releasedQty: 1,
      dispatched: false,
      operationId: 'op',
    });
    const onClose = open();

    expect(screen.getByText(/잡은 재고 1개를 놓아요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '공급처에 맡기기' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockTakeover).toHaveBeenCalledWith({
      shipmentId: 'box',
      idempotencyKey: 'key-1',
      data: expect.objectContaining({
        supplierId: 'sup-1',
        expectedManifestVersion: 3,
        reasonCode: 'out_of_stock_supplier_ships',
      }),
    });
    expect(mockTakeover.mock.calls[0][0].data).not.toHaveProperty('carrier');
    expect(mockToast.success.mock.calls[0][0]).toContain('직배송 송장 기다림');
  });

  it('연결된 공급처가 없으면 고르기 전에는 보내지 않는다', () => {
    preview({ suggestedSupplierId: null });
    open();
    expect(screen.getByText(/연결된 공급처가 없어요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '공급처에 맡기기' }));
    expect(screen.getByText('공급처를 골라 주세요.')).toBeTruthy();
    expect(mockTakeover).not.toHaveBeenCalled();
  });

  it('택배사만 고르고 송장번호가 없으면 보내지 않고, 둘 다 넣으면 발송까지 보낸다', async () => {
    preview();
    mockTakeover.mockResolvedValue({
      shipmentId: 'new',
      previousShipmentId: 'box',
      releasedQty: 1,
      dispatched: true,
      operationId: 'op',
    });
    open();
    fireEvent.change(selects()[1], { target: { value: 'CJ' } });
    fireEvent.click(screen.getByRole('button', { name: '공급처에 맡기기' }));
    expect(screen.getByText(/함께 넣거나 둘 다 비워/)).toBeTruthy();
    expect(mockTakeover).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('송장번호'), {
      target: { value: ' 1234 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '맡기고 발송 완료' }));
    await waitFor(() => expect(mockTakeover).toHaveBeenCalled());
    expect(mockTakeover.mock.calls[0][0].data).toMatchObject({
      carrier: 'CJ',
      trackingNo: '1234',
    });
  });

  it('응답을 못 받으면 같은 키·같은 내용으로만 다시 보낸다', async () => {
    preview();
    mockTakeover
      .mockRejectedValueOnce(Object.assign(new Error('network'), {}))
      .mockResolvedValueOnce({
        shipmentId: 'new',
        previousShipmentId: 'box',
        releasedQty: 1,
        dispatched: false,
        operationId: 'op',
      });
    const onClose = open();
    fireEvent.click(screen.getByRole('button', { name: '공급처에 맡기기' }));
    await screen.findByText(/응답을 받지 못했어요/);
    expect(
      screen.queryByRole('button', { name: '공급처에 맡기기' })
    ).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: '같은 내용 다시 보내기' })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockTakeover).toHaveBeenCalledTimes(2);
    expect(mockTakeover.mock.calls[1][0]).toEqual(
      mockTakeover.mock.calls[0][0]
    );
  });

  it('창을 연 사이 바뀌었으면 알리고 새로 읽는다', async () => {
    preview();
    mockTakeover.mockRejectedValue(rejection(409, 'DIRECT_DELIVERY_CHANGED'));
    open();
    fireEvent.click(screen.getByRole('button', { name: '공급처에 맡기기' }));
    await screen.findByText(/창을 연 사이 상자가 바뀌었어요/);
    expect(refetch).toHaveBeenCalled();
  });

  it('배치에서 작업 중이면 맡기기 대신 이유와 배치 링크를 보인다', () => {
    preview({
      blockers: [{ code: 'active_work', batchId: 'b-1', batchNo: 'OB-1' }],
    });
    open();
    expect(screen.getByText(/배치 OB-1에서 작업 중인 상자예요/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '배치 열기' }).getAttribute('href')
    ).toBe('/order/outbound-batches?batchId=b-1');
    expect(
      screen.queryByRole('button', { name: '공급처에 맡기기' })
    ).toBeNull();
  });
});

describe('맡긴 공급처 상자', () => {
  const supplierBox = {
    owner: 'supplier' as const,
    supplierId: 'sup-1',
    handedOff: true,
  };

  it('송장을 넣으면 발송을 보낸다', async () => {
    preview(supplierBox);
    mockDispatch.mockResolvedValue({
      shipmentId: 'box',
      waybillId: 'w',
      handedOffNow: false,
    });
    const onClose = open();
    fireEvent.change(selects()[0], { target: { value: 'HANJIN' } });
    fireEvent.change(screen.getByLabelText('송장번호'), {
      target: { value: '5555' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '송장 넣고 발송 완료' })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockDispatch).toHaveBeenCalledWith({
      shipmentId: 'box',
      idempotencyKey: 'key-1',
      data: {
        carrier: 'HANJIN',
        trackingNo: '5555',
        expectedManifestVersion: 3,
      },
    });
  });

  it('창고로 되돌리면 공급처에 알리라고 말한다', async () => {
    preview(supplierBox);
    mockReturn.mockResolvedValue({
      shipmentId: 'new',
      previousShipmentId: 'box',
      wasHandedOff: true,
      operationId: 'op',
    });
    open();
    fireEvent.click(
      screen.getByRole('button', { name: '창고 출고로 되돌리기' })
    );
    await waitFor(() => expect(mockReturn).toHaveBeenCalled());
    expect(mockReturn.mock.calls[0][0].data).toMatchObject({
      expectedManifestVersion: 3,
      reasonCode: 'supplier_cannot_ship',
    });
    expect(mockToast.success.mock.calls[0][0]).toContain(
      '보내지 말라고 꼭 알려 주세요'
    );
  });

  it('창고로 되돌릴 수 없어도 송장은 넣을 수 있고, 되돌리지 못하는 이유를 따로 보인다', () => {
    preview({ ...supplierBox, blockers: [{ code: 'drop_shipped' }] });
    open();
    expect(
      screen.getByRole('button', { name: '송장 넣고 발송 완료' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: '창고 출고로 되돌리기' })
    ).toBeNull();
    expect(screen.getByText(/원래 공급처가 보내는 상품/)).toBeTruthy();
  });

  it('송장만 막히면 그 이유를 보이고 창고로 되돌리기는 연다', () => {
    preview({
      ...supplierBox,
      handedOff: false,
      dispatchBlockers: [{ code: 'recipient_incomplete' }],
    });
    open();
    expect(
      screen.queryByRole('button', { name: '송장 넣고 발송 완료' })
    ).toBeNull();
    expect(
      screen.getByRole('region', { name: '송장을 넣을 수 없는 이유' })
        .textContent
    ).toContain('받는 분');
    expect(
      screen.getByRole('button', { name: '창고 출고로 되돌리기' })
    ).toBeTruthy();
  });

  it('송장도 되돌리기도 막히면 이유만 보인다', () => {
    preview({
      ...supplierBox,
      blockers: [{ code: 'active_waybill' }],
      dispatchBlockers: [{ code: 'active_waybill' }],
    });
    open();
    expect(
      screen.queryByRole('button', { name: '송장 넣고 발송 완료' })
    ).toBeNull();
    expect(screen.getAllByText(/송장이 있는 상자예요/)).toHaveLength(1);
  });

  it('이미 쓴 송장번호면 다시 확인하라고 하고 창을 닫지 않는다', async () => {
    preview(supplierBox);
    mockDispatch.mockRejectedValue(rejection(409, 'TRACKING_IN_USE'));
    const onClose = open();
    fireEvent.change(selects()[0], { target: { value: 'CJ' } });
    fireEvent.change(screen.getByLabelText('송장번호'), {
      target: { value: '1' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '송장 넣고 발송 완료' })
    );
    await screen.findByText(/이미 다른 상자에 쓰였어요/);
    expect(onClose).not.toHaveBeenCalled();
  });
});
