/** @jest-environment jsdom */
import * as React from 'react';
import { randomUUID } from 'node:crypto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CustomError } from '@/lib/api/customError';
import type {
  CarrierTrackingAttention,
  CarrierTrackingItem,
  ConfirmCarrierTrackingRequest,
} from '@/lib/api/domains/orders/carrier-tracking.client';
import { AttemptCarrierStatus } from './attempt-carrier-status';
import { CarrierAttentionLine } from './carrier-attention-line';
import { CarrierAttentionPanel } from './carrier-attention-panel';

const mockSummary = jest.fn();
const mockAttention = jest.fn<Promise<CarrierTrackingAttention>, []>();
const mockShipment = jest.fn<
  Promise<{ items: CarrierTrackingItem[] }>,
  [string]
>();
const mockRecheck = jest.fn<
  Promise<{ items: CarrierTrackingItem[] }>,
  [string]
>();
const mockConfirm = jest.fn<
  Promise<{ confirmationId: string; resumeAt: string | null }>,
  [string, ConfirmCarrierTrackingRequest, string]
>();
const mockGranted = new Set<string>();

jest.mock('@/lib/api/domains/orders/carrier-tracking.client', () => ({
  carrierTrackingClient: {
    summary: () => mockSummary(),
    attention: () => mockAttention(),
    shipment: (id: string) => mockShipment(id),
    recheck: (id: string) => mockRecheck(id),
    confirm: (id: string, data: ConfirmCarrierTrackingRequest, key: string) =>
      mockConfirm(id, data, key),
  },
}));

jest.mock('@/hooks/use-permission', () => ({
  useCan: (keys: string[]) => ({
    status: 'ready',
    allowed: keys.some((key) => mockGranted.has(key)),
  }),
  useCanOpen: (screen: string) => ({
    status: 'ready',
    allowed: mockGranted.has(
      screen === '/order/history'
        ? 'order.order.read'
        : 'fulfillment.order.read'
    ),
  }),
  useCanRun: (action: { permission: string[] }) => ({
    status: 'ready',
    allowed: action.permission.every((key) => mockGranted.has(key)),
  }),
}));

jest.mock('@/features/order/fulfillments/detail/operation-operator', () => ({
  useOperatorNames: () => (id: string) => (id === 'u1' ? '김관리' : ''),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const NOW = new Date('2026-11-24T06:00:00.000Z');
const item = (
  over: Partial<CarrierTrackingItem> = {}
): CarrierTrackingItem => ({
  dispatchAttemptId: 'a1',
  attemptNo: 1,
  shipmentId: 's1',
  carrier: 'HANJIN',
  trackingNo: '510000000001',
  orders: [{ salesOrderId: 'o1', orderNo: '7', channelOrderId: 'order_7' }],
  kind: 'no_scan',
  raised: true,
  accepted: false,
  recalled: false,
  dispatchedAt: '2026-11-22T06:00:00.000Z',
  dueAt: '2026-11-23T06:00:00.000Z',
  attemptedAt: '2026-11-24T05:50:00.000Z',
  answeredAt: '2026-11-24T05:50:00.000Z',
  lastOutcome: 'no_scan',
  scan: null,
  scanKey: '',
  confirmations: [],
  ...over,
});
const confirmation = {
  id: 'c9',
  kind: 'no_scan',
  outcome: 'wait' as const,
  resumeAt: '2026-11-25T06:00:00.000Z',
  note: '먼저 통화함',
  actorId: 'u1',
  createdAt: '2026-11-24T05:59:00.000Z',
};
const attention = (
  items: CarrierTrackingItem[],
  over: Partial<CarrierTrackingAttention> = {}
): CarrierTrackingAttention => ({
  attention: items.filter((row) => row.raised).length,
  waiting: items.filter((row) => !row.raised).length,
  polling: { failing: false, lastAnsweredAt: null },
  items,
  ...over,
});
// 관리자 API 클라이언트가 4xx 를 바꿔 던지는 모양
const rejected = (status: number, code: string) =>
  new CustomError({
    message: code,
    statusCode: status,
    response: { code, message: code },
  });

function show(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

beforeEach(() => {
  [mockSummary, mockAttention, mockShipment, mockRecheck, mockConfirm].forEach(
    (mock) => mock.mockReset()
  );
  Object.values(toast).forEach((fn) => jest.mocked(fn).mockClear?.());
  mockGranted.clear();
  mockGranted.add('fulfillment.order.read');
  mockGranted.add('fulfillment.warehouse.operate');
  mockGranted.add('order.order.read');
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: randomUUID,
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('출고 준비 맨 위 한 줄', () => {
  const summary = (attentionCount: number, failing = false) => ({
    attention: attentionCount,
    polling: { failing, lastAnsweredAt: null },
  });

  it('확인할 송장이 없고 조회도 되면 그리지 않는다', async () => {
    mockSummary.mockResolvedValue(summary(0));
    const { container } = show(<CarrierAttentionLine />);
    await waitFor(() => expect(mockSummary).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('수와 정체 보드 추적으로 가는 링크를 보인다', async () => {
    mockSummary.mockResolvedValue(summary(3));
    show(<CarrierAttentionLine />);
    expect(
      await screen.findByText('출고했지만 택배사 확인이 필요한 송장 3장')
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '확인하러 가기' }).getAttribute('href')
    ).toBe('/order/stall-board?stage=track');
  });

  it('확인할 송장이 0장이어도 자동 조회가 안 되면 알린다', async () => {
    mockSummary.mockResolvedValue(summary(0, true));
    show(<CarrierAttentionLine />);
    expect(
      await screen.findByText('택배사 자동 조회가 안 되고 있어요')
    ).toBeTruthy();
  });

  it('불러오지 못하면 0장처럼 숨기지 않는다', async () => {
    mockSummary.mockRejectedValue(new Error('down'));
    show(<CarrierAttentionLine />);
    expect(await screen.findByText(/불러오지 못했어요/)).toBeTruthy();
  });

  it('0장이었어도 다시 읽기가 실패하면 «없음»으로 두지 않는다', async () => {
    mockSummary
      .mockResolvedValueOnce(summary(0))
      .mockRejectedValue(new Error('down'));
    const { client, container } = show(<CarrierAttentionLine />);
    await waitFor(() => expect(mockSummary).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    await client.refetchQueries();
    expect(await screen.findByText(/불러오지 못했어요/)).toBeTruthy();
  });

  it('조회 권한이 없으면 묻지 않는다', () => {
    mockGranted.clear();
    show(<CarrierAttentionLine />);
    expect(mockSummary).not.toHaveBeenCalled();
  });
});

describe('정체 보드 추적의 택배사 확인', () => {
  it('송장마다 이유·마지막 확인·다음 할 일과 상자·주문 링크를 보인다', async () => {
    mockAttention.mockResolvedValue(attention([item()]));
    show(<CarrierAttentionPanel now={NOW} />);
    const row = within(
      await screen.findByRole('group', { name: '택배사 확인이 필요한 송장' })
    );
    expect(row.getByText(/집하 기록이 없어요/)).toBeTruthy();
    expect(row.getByText(/10분 전 확인/)).toBeTruthy();
    expect(row.getByText('집하 기록 없음 1장')).toBeTruthy();
    expect(row.getByText(/물류 관리자에게/)).toBeTruthy();
    expect(
      row.getByRole('link', { name: '상자 상세' }).getAttribute('href')
    ).toBe('/order/fulfillments?shipmentId=s1');
    expect(row.getByRole('link', { name: '#7' }).getAttribute('href')).toBe(
      '/order/history?orderNo=order_7'
    );
  });

  it('주문내역을 열 수 없는 사람에게는 주문번호를 링크로 보이지 않는다', async () => {
    mockGranted.delete('order.order.read');
    mockAttention.mockResolvedValue(attention([item()]));
    show(<CarrierAttentionPanel now={NOW} />);
    await screen.findByText(/집하 기록이 없어요/);
    expect(screen.queryByRole('link', { name: '#7' })).toBeNull();
    expect(screen.getByText('#7')).toBeTruthy();
  });

  it('작업 권한이 없으면 다시 조회·확인 기록을 그리지 않는다', async () => {
    mockGranted.delete('fulfillment.warehouse.operate');
    mockAttention.mockResolvedValue(attention([item()]));
    show(<CarrierAttentionPanel now={NOW} />);
    await screen.findByText(/집하 기록이 없어요/);
    expect(screen.queryByRole('button', { name: '지금 다시 조회' })).toBeNull();
    expect(screen.queryByRole('button', { name: '확인 기록' })).toBeNull();
  });

  it('다시 조회하면 목록을 다시 읽고 결과를 말한다', async () => {
    mockAttention
      .mockResolvedValueOnce(attention([item()]))
      .mockResolvedValue(attention([]));
    mockRecheck.mockResolvedValue({ items: [item({ kind: null })] });
    show(<CarrierAttentionPanel now={NOW} />);
    await userEvent.click(
      await screen.findByRole('button', { name: '지금 다시 조회' })
    );
    expect(mockRecheck).toHaveBeenCalledWith('a1');
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        '다시 물었어요. 확인할 것이 없어졌어요.'
      )
    );
    expect(screen.queryByText(/집하 기록이 없어요/)).toBeNull();
  });

  it('확인 기록은 본 상태를 함께 보낸다. 빈 메모는 보내지 않는다', async () => {
    mockAttention.mockResolvedValue(
      attention([item({ scanKey: '07@x', confirmations: [confirmation] })])
    );
    mockConfirm.mockResolvedValue({ confirmationId: 'c', resumeAt: null });
    show(<CarrierAttentionPanel now={NOW} />);
    await userEvent.click(
      await screen.findByRole('button', { name: '확인 기록' })
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/먼저 통화함/)).toBeTruthy();
    await userEvent.click(
      dialog.getByRole('button', { name: '확인 기록 남기기' })
    );
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(dialog.getByText(/확인한 내용을 적어 주세요/)).toBeTruthy();
    await userEvent.click(dialog.getByRole('radio', { name: /더 볼 것 없음/ }));
    await userEvent.type(
      dialog.getByRole('textbox', { name: '확인한 내용' }),
      ' 배송된 것 확인 '
    );
    await userEvent.click(
      dialog.getByRole('button', { name: '확인 기록 남기기' })
    );
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockConfirm.mock.calls[0].slice(0, 2)).toEqual([
      'a1',
      {
        outcome: 'closed',
        note: '배송된 것 확인',
        expectedKind: 'no_scan',
        expectedScanKey: '07@x',
        expectedConfirmationId: 'c9',
      },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('다른 사람이 먼저 적었으면 그 기록을 보이고, 다시 남길 때 그 뒤에 잇는다', async () => {
    mockAttention
      .mockResolvedValueOnce(attention([item()]))
      .mockResolvedValue(
        attention([item({ raised: false, confirmations: [confirmation] })])
      );
    mockConfirm
      .mockRejectedValueOnce(rejected(409, 'CARRIER_TRACKING_CHANGED'))
      .mockResolvedValue({ confirmationId: 'c', resumeAt: null });
    show(<CarrierAttentionPanel now={NOW} />);
    await userEvent.click(
      await screen.findByRole('button', { name: '확인 기록' })
    );
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.type(
      dialog.getByRole('textbox', { name: '확인한 내용' }),
      '내 메모'
    );
    await userEvent.click(
      dialog.getByRole('button', { name: '확인 기록 남기기' })
    );
    expect(await dialog.findByText(/다른 사람이 먼저 기록했거나/)).toBeTruthy();
    expect(dialog.getByText(/김관리 .*먼저 통화함/)).toBeTruthy();
    await userEvent.click(
      dialog.getByRole('button', { name: '확인 기록 남기기' })
    );
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(2));
    expect(mockConfirm.mock.calls[1][1]).toMatchObject({
      note: '내 메모',
      expectedConfirmationId: 'c9',
    });
    expect(mockConfirm.mock.calls[1][2]).not.toBe(mockConfirm.mock.calls[0][2]);
  });

  it('다른 사람이 끝내 목록에서 빠져도 창은 남아 알린다', async () => {
    mockAttention
      .mockResolvedValueOnce(attention([item()]))
      .mockResolvedValue(attention([]));
    mockConfirm.mockRejectedValue(rejected(409, 'CARRIER_TRACKING_CHANGED'));
    show(<CarrierAttentionPanel now={NOW} />);
    await userEvent.click(
      await screen.findByRole('button', { name: '확인 기록' })
    );
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.type(
      dialog.getByRole('textbox', { name: '확인한 내용' }),
      '내 메모'
    );
    await userEvent.click(
      dialog.getByRole('button', { name: '확인 기록 남기기' })
    );
    expect(await dialog.findByText(/다른 사람이 먼저 끝냈거나/)).toBeTruthy();
    expect(
      dialog
        .getByRole('button', { name: '확인 기록 남기기' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('응답을 못 받으면 같은 키·같은 내용으로 다시 보낸다', async () => {
    mockAttention.mockResolvedValue(attention([item()]));
    mockConfirm
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue({ confirmationId: 'c', resumeAt: null });
    show(<CarrierAttentionPanel now={NOW} />);
    await userEvent.click(
      await screen.findByRole('button', { name: '확인 기록' })
    );
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.type(
      dialog.getByRole('textbox', { name: '확인한 내용' }),
      '통화'
    );
    await userEvent.click(
      dialog.getByRole('button', { name: '확인 기록 남기기' })
    );
    await userEvent.click(
      await dialog.findByRole('button', { name: '같은 기록 다시 보내기' })
    );
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(2));
    expect(mockConfirm.mock.calls[1]).toEqual(mockConfirm.mock.calls[0]);
  });

  it('조회가 안 되고 있으면 목록 위에 알리고, 기다리는 송장은 접어 둔다', async () => {
    mockAttention.mockResolvedValue(
      attention([item({ raised: false, confirmations: [confirmation] })], {
        polling: { failing: true, lastAnsweredAt: '2026-11-24T00:00:00.000Z' },
      })
    );
    show(<CarrierAttentionPanel now={NOW} />);
    expect(await screen.findByText(/자동 조회가 안 되고 있어요/)).toBeTruthy();
    expect(screen.getByText('확인하고 기다리는 송장 1장')).toBeTruthy();
    expect(screen.queryByText(/확인이 필요한 송장/)).toBeNull();
  });

  it('앞서 불러온 뒤 다시 읽기가 실패하면 낡은 목록이라고 말한다', async () => {
    mockAttention
      .mockResolvedValueOnce(attention([item()]))
      .mockRejectedValue(new Error('down'));
    const { client } = show(<CarrierAttentionPanel now={NOW} />);
    await screen.findByText(/집하 기록이 없어요/);
    await client.refetchQueries();
    expect(await screen.findByText(/조금 전 내용을 보이고/)).toBeTruthy();
    expect(screen.getByText(/집하 기록이 없어요/)).toBeTruthy();
  });
});

describe('상자 상세의 택배사 상태', () => {
  it('정상이면 언제부터 확인할 송장이 되는지만 보이고 확인 기록은 없다', async () => {
    mockShipment.mockResolvedValue({
      items: [
        item({ kind: null, raised: false, dueAt: '2999-01-01T00:00:00Z' }),
      ],
    });
    show(<AttemptCarrierStatus shipmentId="s1" attemptId="a1" />);
    expect(await screen.findByText(/집하를 기다리는 중/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '확인 기록' })).toBeNull();
    expect(screen.getByRole('button', { name: '지금 다시 조회' })).toBeTruthy();
  });

  it('끝낸 송장도 기록을 보이고 다시 기록할 수 있다', async () => {
    mockShipment.mockResolvedValue({
      items: [
        item({
          raised: false,
          confirmations: [
            { ...confirmation, outcome: 'closed', resumeAt: null },
          ],
        }),
      ],
    });
    show(<AttemptCarrierStatus shipmentId="s1" attemptId="a1" />);
    expect(await screen.findByText(/김관리 · 끝남 · 먼저 통화함/)).toBeTruthy();
    expect(screen.queryByText(/물류 관리자에게/)).toBeNull();
    expect(screen.getByRole('button', { name: '확인 기록' })).toBeTruthy();
  });

  it('다시 읽기가 실패하면 조금 전 내용이라고 말한다', async () => {
    mockShipment
      .mockResolvedValueOnce({ items: [item({ kind: null, accepted: true })] })
      .mockRejectedValue(new Error('down'));
    const { client } = show(
      <AttemptCarrierStatus shipmentId="s1" attemptId="a1" />
    );
    await screen.findByText('택배사가 받았어요.');
    await client.refetchQueries();
    expect(await screen.findByText(/조금 전 내용이에요/)).toBeTruthy();
    expect(screen.getByText('택배사가 받았어요.')).toBeTruthy();
  });

  it('추적하지 않는 출고에는 아무것도 붙이지 않는다', async () => {
    mockShipment.mockResolvedValue({ items: [] });
    const { container } = show(
      <AttemptCarrierStatus shipmentId="s1" attemptId="a1" />
    );
    await waitFor(() => expect(mockShipment).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
