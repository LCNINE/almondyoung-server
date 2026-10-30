/**
 * @jest-environment jsdom
 */
import { randomUUID } from 'node:crypto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { CustomError } from '@/lib/api/customError';
import type {
  ConsolidationOption,
  ConsolidationOptionReason,
  ConsolidationOptionShipment,
  ConsolidationOptionsResponse,
  ShipmentConsolidationResponse,
} from '@/lib/types/dto/fulfillment';
import { ConsolidationSheet } from './consolidation-sheet';
import type { PendingCommand } from './consolidation-sheet-model';

type OptionsState = {
  data: ConsolidationOptionsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
};

type CreateState = {
  mutateAsync: (
    command: PendingCommand
  ) => Promise<ShipmentConsolidationResponse>;
  isPending: boolean;
};

const mockUseConsolidationOptions = jest.fn<OptionsState, [string, boolean]>();
const mockUseCreateShipmentConsolidation = jest.fn<CreateState, []>();
const mockCan = jest.fn<boolean, [readonly string[]]>();

jest.mock('@/lib/services/orders/queries', () => ({
  useConsolidationOptions: (shipmentId: string, enabled: boolean) =>
    mockUseConsolidationOptions(shipmentId, enabled),
}));

// 배럴 전체를 끌어오지 않도록 Sheet 가 쓰는 두 개만 둔다.
jest.mock('@/lib/services/orders', () => ({
  getServerDenyMessage: jest.requireActual<
    typeof import('@/lib/api/server-error')
  >('@/lib/api/server-error').getServerDenyMessage,
  useCreateShipmentConsolidation: () => mockUseCreateShipmentConsolidation(),
}));

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({
    can: (anyOf: readonly string[]) => mockCan(anyOf),
    isPermissionLoading: false,
    canRun: () => true,
    blockedReason: () => null,
  }),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// radix 라디오가 크기를 재는 데 쓰는데 jsdom 에는 없다.
class NoopResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

globalThis.ResizeObserver = NoopResizeObserver;

// 멱등키를 만드는 crypto.randomUUID 가 jest 의 jsdom(20) 에는 없다.
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: randomUUID,
  configurable: true,
});

const shipment = (
  shipmentId: string,
  overrides: Partial<ConsolidationOptionShipment> = {}
): ConsolidationOptionShipment => ({
  shipmentId,
  status: 'draft',
  salesOrderNos: [`SO-${shipmentId}`],
  itemSummary: `${shipmentId} 상품`,
  totalQty: 1,
  recipientSnapshot: {
    recipientName: '김고객',
    roadAddress: '서울시 강남구 테헤란로 1',
    deliveryNote: '문 앞에 두세요',
  },
  batchId: null,
  waybillTrackingNo: null,
  manifestVersion: 3,
  reservationVersion: 5,
  createdAt: '2026-10-29T01:00:00Z',
  ...overrides,
});

const option = (
  shipmentId: string,
  reason: ConsolidationOptionReason,
  overrides: Partial<ConsolidationOptionShipment> = {}
): ConsolidationOption => ({
  ...shipment(shipmentId, overrides),
  reason,
  selectable: reason === 'ok' || reason === 'memo_differs',
});

const source = shipment('src');
const okOption = option('ok1', 'ok');
const memoOption = option('memo1', 'memo_differs', {
  recipientSnapshot: {
    recipientName: '김고객',
    roadAddress: '서울시 강남구 테헤란로 1',
    deliveryNote: '경비실에 맡겨 주세요',
  },
});
const addressOption = option('addr1', 'address_differs', {
  recipientSnapshot: {
    recipientName: '김고객',
    roadAddress: '부산시 해운대구 1',
  },
});

const completed: ShipmentConsolidationResponse = {
  operationId: 'op-1',
  operationStatus: 'completed',
  sourceShipmentIds: ['src', 'memo1'],
  targetShipmentId: 'target-1',
};

const mutateAsync = jest.fn<
  Promise<ShipmentConsolidationResponse>,
  [PendingCommand]
>();
const refetch = jest.fn<Promise<unknown>, []>();

const card = (orderNo: string) =>
  screen.getByRole('checkbox', { name: `주문 #${orderNo} 같이 보내기` });

const requestButton = () => screen.getByRole('button', { name: '합포장 요청' });

const renderSheet = () =>
  render(<ConsolidationSheet shipmentId="src" open onOpenChange={jest.fn()} />);

// 메모가 다른 주문을 골라 2단계에서 메모와 사유까지 채운다.
const fillMemoRequest = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(card('SO-memo1'));
  await user.click(screen.getByRole('button', { name: '다음' }));
  await user.click(screen.getByRole('radio', { name: /경비실에 맡겨 주세요/ }));
  await user.type(screen.getByLabelText('작업 사유'), '고객 요청');

  expect(
    screen
      .getByRole('radio', { name: /경비실에 맡겨 주세요/ })
      .getAttribute('aria-checked')
  ).toBe('true');
  expect(
    screen
      .getByRole('radio', { name: /문 앞에 두세요/ })
      .getAttribute('aria-checked')
  ).toBe('false');
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCan.mockReturnValue(true);
  refetch.mockResolvedValue(undefined);
  mutateAsync.mockResolvedValue(completed);
  mockUseConsolidationOptions.mockReturnValue({
    data: { source, options: [okOption, memoOption, addressOption] },
    isLoading: false,
    isError: false,
    error: null,
    refetch,
  });
  mockUseCreateShipmentConsolidation.mockReturnValue({
    mutateAsync,
    isPending: false,
  });
});

describe('합포장 Sheet 1단계', () => {
  it('배송지가 다른 주문은 비활성이고 눌러도 선택되지 않는다', async () => {
    const user = userEvent.setup();

    renderSheet();

    const blocked = card('SO-addr1');

    expect(blocked.getAttribute('aria-disabled')).toBe('true');

    await user.click(blocked);

    expect(blocked.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByRole('button', { name: '다음' }).hasAttribute('disabled')
    ).toBe(true);
  });

  it('고를 수 있는 주문은 카드 아무 곳이나 눌러 선택한다', async () => {
    const user = userEvent.setup();

    renderSheet();

    await user.click(screen.getByText('ok1 상품'));

    expect(card('SO-ok1').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('#SO-ok1 을 골랐어요')).toBeTruthy();
  });

  it('수령인 변경 권한이 없으면 메모가 다른 주문을 고를 수 없다', async () => {
    mockCan.mockImplementation(
      (anyOf) => !anyOf.includes('fulfillment.shipment.override_recipient')
    );
    const user = userEvent.setup();

    renderSheet();

    const memoCard = card('SO-memo1');

    expect(memoCard.getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByText('배송 메모가 달라 합치려면 수령인 변경 권한이 필요해요')
    ).toBeTruthy();

    await user.click(memoCard);

    expect(memoCard.getAttribute('aria-checked')).toBe('false');
  });

  it('재개방 권한이 없으면 계획이 확정된 주문은 고를 수 없고 draft 끼리는 요청할 수 있다', async () => {
    mockCan.mockImplementation(
      (anyOf) => !anyOf.includes('fulfillment.shipment.reopen')
    );
    mockUseConsolidationOptions.mockReturnValue({
      data: {
        source,
        options: [okOption, option('plan1', 'ok', { status: 'planned' })],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
    const user = userEvent.setup();

    renderSheet();

    const plannedCard = card('SO-plan1');

    expect(plannedCard.getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByText(
        '출고 준비가 시작된 주문이라 합치려면 출고 재개방 권한이 필요해요'
      )
    ).toBeTruthy();

    await user.click(plannedCard);

    expect(plannedCard.getAttribute('aria-checked')).toBe('false');

    await user.click(card('SO-ok1'));
    await user.click(screen.getByRole('button', { name: '다음' }));
    await user.type(screen.getByLabelText('작업 사유'), '고객 요청');

    expect(requestButton().hasAttribute('disabled')).toBe(false);

    await user.click(requestButton());

    expect(mutateAsync.mock.calls[0][0].data.sources).toEqual([
      {
        shipmentId: 'src',
        expectedManifestVersion: 3,
        expectedReservationVersion: 5,
      },
      {
        shipmentId: 'ok1',
        expectedManifestVersion: 3,
        expectedReservationVersion: 5,
      },
    ]);
  });
});

describe('합포장 Sheet 2단계', () => {
  it('메모가 다른 주문을 고르면 메모를 고르기 전까지 요청할 수 없다', async () => {
    const user = userEvent.setup();

    renderSheet();

    await user.click(card('SO-memo1'));
    await user.click(screen.getByRole('button', { name: '다음' }));
    await user.type(screen.getByLabelText('작업 사유'), '고객 요청');

    expect(requestButton().hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByText('합친 상자의 배송 메모를 골라 주세요')
    ).toBeTruthy();

    await user.click(
      screen.getByRole('radio', { name: /경비실에 맡겨 주세요/ })
    );

    expect(requestButton().hasAttribute('disabled')).toBe(false);
  });

  it('요청 본문에는 메모를 가져올 상자만 담고 받는 사람 사본은 담지 않는다', async () => {
    const user = userEvent.setup();

    renderSheet();
    await fillMemoRequest(user);

    expect(requestButton().hasAttribute('disabled')).toBe(false);
    expect(
      screen.getByText('요청하면 상자 화면에서 다음 할 일을 알려 줘요')
    ).toBeTruthy();

    await user.click(requestButton());

    expect(mutateAsync).toHaveBeenCalledTimes(1);

    const [command] = mutateAsync.mock.calls[0];

    expect(command.data).toEqual({
      sources: [
        {
          shipmentId: 'src',
          expectedManifestVersion: 3,
          expectedReservationVersion: 5,
        },
        {
          shipmentId: 'memo1',
          expectedManifestVersion: 3,
          expectedReservationVersion: 5,
        },
      ],
      recipientSourceShipmentId: 'memo1',
      reason: '고객 요청',
    });
    expect('recipientSnapshot' in command.data).toBe(false);
    expect(command.idempotencyKey).not.toBe('');
  });

  it('상자 버전이 바뀌었다는 409 면 안내하고 다시 불러온다', async () => {
    mutateAsync.mockRejectedValueOnce(
      new CustomError({
        message: 'stale',
        statusCode: 409,
        response: { code: 'SHIPMENT_STALE_MANIFEST_VERSION' },
      })
    );
    const user = userEvent.setup();

    renderSheet();
    await fillMemoRequest(user);
    await user.click(requestButton());

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(jest.mocked(toast.info)).toHaveBeenCalledWith(
      '그사이 상자가 바뀌었어요. 다시 불러올게요'
    );
    expect(
      screen.getByText('이 주문과 같이 보낼 주문을 골라 주세요')
    ).toBeTruthy();
  });

  it('응답을 못 받은 요청은 같은 본문과 같은 멱등키로 다시 보낸다', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('Network Error'));
    const user = userEvent.setup();

    renderSheet();
    await fillMemoRequest(user);
    await user.click(requestButton());

    const retry = await screen.findByRole('button', {
      name: '같은 요청 다시 보내기',
    });

    expect(requestButton().hasAttribute('disabled')).toBe(true);

    await user.click(retry);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

    const [first] = mutateAsync.mock.calls[0];
    const [second] = mutateAsync.mock.calls[1];

    expect(second).toEqual(first);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(jest.mocked(toast.success)).toHaveBeenCalledWith('합포장했어요.');
  });

  it('5xx 도 응답 유실로 보고 같은 요청을 다시 보낸다', async () => {
    mutateAsync.mockRejectedValueOnce(
      new CustomError({ message: 'Internal', statusCode: 500 })
    );
    const user = userEvent.setup();

    renderSheet();
    await fillMemoRequest(user);
    await user.click(requestButton());
    await user.click(
      await screen.findByRole('button', { name: '같은 요청 다시 보내기' })
    );

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls[1][0]).toEqual(mutateAsync.mock.calls[0][0]);
  });
});
