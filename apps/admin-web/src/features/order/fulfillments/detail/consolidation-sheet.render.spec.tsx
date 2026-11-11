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
const mockCanRun = jest.fn<boolean, []>();
const mockExclude = jest.fn<
  Promise<void>,
  [{ batchId: string; shipmentId: string; reason: string }]
>();

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/services/orders/queries', () => ({
  useConsolidationOptions: (shipmentId: string, enabled: boolean) =>
    mockUseConsolidationOptions(shipmentId, enabled),
}));

jest.mock('@/lib/services/orders', () => ({
  getServerDenyMessage: jest.requireActual<
    typeof import('@/lib/api/server-error')
  >('@/lib/api/server-error').getServerDenyMessage,
  useCreateShipmentConsolidation: () => mockUseCreateShipmentConsolidation(),
  useExcludeShipmentFromBatch: () => ({
    mutateAsync: mockExclude,
    isPending: false,
  }),
}));

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({
    can: (anyOf: readonly string[]) => mockCan(anyOf),
    isPermissionLoading: false,
    canRun: () => mockCanRun(),
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
  mockCanRun.mockReturnValue(true);
  mockExclude.mockResolvedValue(undefined);
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
    expect(await screen.findByText('합포장했어요.')).toBeTruthy();
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

describe('합포장 요청 뒤 배치 제외', () => {
  const pending: ShipmentConsolidationResponse = {
    operationId: 'op-pending',
    operationStatus: 'pending',
    sourceShipmentIds: ['src', 'ok1', 'memo1'],
    targetShipmentId: null,
  };

  beforeEach(() => {
    mockUseConsolidationOptions.mockReturnValue({
      data: {
        source: shipment('src', { batchId: 'batch-src', status: 'planned' }),
        options: [
          okOption,
          { ...memoOption, batchId: 'batch-memo', status: 'planned' },
          option('unselected', 'ok', { batchId: 'batch-other' }),
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
    mutateAsync.mockResolvedValue(pending);
  });

  const submit = async () => {
    const user = userEvent.setup();

    await user.click(card('SO-ok1'));
    await fillMemoRequest(user);
    await user.click(requestButton());

    return user;
  };

  it('대기 중이면 합칠 상자 중 배치에 든 상자를 모두 빼고 진행 링크를 보인다', async () => {
    const sheet = renderSheet();

    await submit();

    await waitFor(() => expect(mockExclude).toHaveBeenCalledTimes(2));
    expect(mockExclude.mock.calls).toEqual([
      [{ batchId: 'batch-src', shipmentId: 'src', reason: '합포장' }],
      [{ batchId: 'batch-memo', shipmentId: 'memo1', reason: '합포장' }],
    ]);
    expect(
      screen.getByRole('heading', { name: '합포장을 요청했어요.' })
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '진행 보기' }).getAttribute('href')
    ).toBe('/order/fulfillments?shipmentId=src');

    // 창이 닫혀도 알림에서 진행을 볼 수 있다
    const action = jest.mocked(toast.success).mock.calls[0][1]?.action;

    if (!action || typeof action !== 'object' || !('onClick' in action)) {
      throw new Error('Missing progress action');
    }

    expect(jest.mocked(toast.success).mock.calls[0][0]).toBe(
      '합포장을 요청했어요.'
    );
    expect(action.label).toBe('진행 보기');
    sheet.unmount();
    render(<button onClick={action.onClick}>알림의 진행 보기</button>);
    await userEvent.click(
      screen.getByRole('button', { name: '알림의 진행 보기' })
    );
    expect(mockPush).toHaveBeenCalledWith('/order/fulfillments?shipmentId=src');
    expect(
      screen.queryByRole('link', { name: '이 상자 출고 준비' })
    ).toBeNull();
  });

  it('완료된 합포장은 배치에서 빼지 않는다', async () => {
    mutateAsync.mockResolvedValue({
      ...pending,
      operationStatus: 'completed',
      targetShipmentId: 'target',
    });
    renderSheet();
    await submit();

    expect(await screen.findByText('합포장했어요.')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('합포장했어요.');
    expect(mockExclude).not.toHaveBeenCalled();
  });

  it('배치 제외 권한이 없으면 대기 요청만 유지한다', async () => {
    mockCanRun.mockReturnValue(false);
    renderSheet();
    await submit();

    expect(mockExclude).not.toHaveBeenCalled();
    expect(await screen.findByText('합포장을 요청했어요.')).toBeTruthy();
    expect(screen.getByRole('link', { name: '진행 보기' })).toBeTruthy();
  });

  it('한 상자의 제외가 거절되어도 나머지를 처리하고 대기 요청을 유지한다', async () => {
    mockExclude.mockRejectedValueOnce(
      new CustomError({
        message: '발송 시도가 있어 배치에서 뺄 수 없어요.',
        statusCode: 409,
      })
    );
    const onRequested = jest.fn();
    const onOpenChange = jest.fn();

    render(
      <ConsolidationSheet
        shipmentId="src"
        open
        onOpenChange={onOpenChange}
        onRequested={onRequested}
      />
    );
    await submit();

    await waitFor(() => expect(onRequested).toHaveBeenCalledWith(pending));
    expect(mockExclude).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('발송 시도가 있어 배치에서 뺄 수 없어요.')
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('합포장을 요청했어요.')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: '같은 요청 다시 보내기' })
    ).toBeNull();
  });
});

describe('같은 주문을 나눈 상자', () => {
  const splitSource = shipment('src', {
    salesOrderNos: ['SO-1'],
    split: { boxQty: 2, orderQty: 3, boxNo: 1, boxCount: 2 },
  });
  const splitPeer = option('peer', 'ok', {
    salesOrderNos: ['SO-1'],
    split: { boxQty: 1, orderQty: 3, boxNo: 2, boxCount: 2 },
  });

  beforeEach(() => {
    mockUseConsolidationOptions.mockReturnValue({
      data: { source: splitSource, options: [splitPeer] },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
    mutateAsync.mockResolvedValue({
      ...completed,
      sourceShipmentIds: ['src', 'peer'],
    });
  });

  it('상자마다 몫을 보여 주고 확인과 결과에서 두 상자를 구분한다', async () => {
    const user = userEvent.setup();

    renderSheet();

    expect(screen.getByText('나눈 상자 1/2 · 주문 3개 중 2개')).toBeTruthy();
    expect(screen.getByText('나눈 상자 2/2 · 주문 3개 중 1개')).toBeTruthy();
    expect(screen.getByText(/같은 주문을 나눈 상자예요/)).toBeTruthy();

    await user.click(card('SO-1'));
    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(
      screen.getByText(
        '주문 #SO-1 상자 1/2(2개), #SO-1 상자 2/2(1개) → 상자 1개, 송장 1장'
      )
    ).toBeTruthy();

    await user.type(screen.getByLabelText('작업 사유'), '다시 합치기');
    await user.click(requestButton());

    expect(
      await screen.findByText('나눈 상자 2개를 다시 한 상자로 합쳤어요: #SO-1')
    ).toBeTruthy();
  });
});

describe('합포장 Sheet 상품과 수량', () => {
  beforeEach(() => {
    mockUseConsolidationOptions.mockReturnValue({
      data: {
        source: shipment('src', {
          items: [{ skuId: 'sku-1', name: '립밤', qty: 1 }],
        }),
        options: [
          option('ok1', 'ok', {
            items: [
              { skuId: 'sku-1', name: '립밤', qty: 2 },
              { skuId: 'sku-2', name: '핸드크림', qty: 1 },
            ],
          }),
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
  });

  it('주문마다 상품별 수량을 보여 주고 확인 단계에서 합친 결과를 상품별로 보여 준다', async () => {
    const user = userEvent.setup();

    renderSheet();

    expect(
      screen.getByRole('list', { name: '주문 #SO-src 상품' }).textContent
    ).toBe('립밤 1개');
    expect(
      screen.getByRole('checkbox', {
        name: '주문 #SO-ok1 같이 보내기',
        description: '립밤 2개 핸드크림 1개',
      })
    ).toBeTruthy();

    await user.click(card('SO-ok1'));
    await user.click(screen.getByRole('button', { name: '다음' }));

    const result = screen.getByRole('table', { name: '합친 상자에 담길 상품' });

    expect(result.textContent).toContain('2종 · 총 4개');
    expect(screen.getByRole('row', { name: /립밤/ }).textContent).toBe(
      '립밤#SO-src 1개 + #SO-ok1 2개3개'
    );
    expect(screen.getByRole('row', { name: /핸드크림/ }).textContent).toBe(
      '핸드크림#SO-ok1 1개1개'
    );
  });
});

describe('합포장 결과에서 이어 가기', () => {
  beforeEach(() => {
    mockUseConsolidationOptions.mockReturnValue({
      data: {
        source: shipment('src', {
          items: [{ skuId: 'sku-1', name: '립밤', qty: 1 }],
        }),
        options: [
          option('ok1', 'ok', {
            items: [{ skuId: 'sku-1', name: '립밤', qty: 2 }],
          }),
          memoOption,
          addressOption,
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
    mutateAsync.mockResolvedValue({
      ...completed,
      sourceShipmentIds: ['src', 'ok1'],
      target: {
        shipmentId: 'target-1',
        status: 'draft',
        warehouseId: 'wh-9',
        manifestVersion: 1,
        reservationVersion: 1,
      },
    });
  });

  const request = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText('작업 사유'), '고객 요청');
    await user.click(requestButton());
  };

  it('합친 뒤 시트를 닫지 않고 새 상자의 상품과 출고 준비 링크를 보여 준다', async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    render(
      <ConsolidationSheet shipmentId="src" open onOpenChange={onOpenChange} />
    );
    await user.click(card('SO-ok1'));
    await user.click(screen.getByRole('button', { name: '다음' }));
    await request(user);

    expect(await screen.findByRole('heading', { name: '합포장했어요.' })).toBe(
      document.activeElement
    );
    expect(
      screen.getByText('주문 #SO-src, #SO-ok1 → 새 상자 1개')
    ).toBeTruthy();
    expect(
      screen.getByRole('list', { name: '주문 #SO-src, #SO-ok1 새 상자 상품' })
        .textContent
    ).toBe('립밤 3개');
    expect(
      screen
        .getByRole('link', { name: '이 상자 출고 준비' })
        .getAttribute('href')
    ).toBe('/order/waybill-issue?warehouseId=wh-9&prepare=target-1');
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '닫기' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('응답을 못 받은 뒤 목록이 바뀌어도 다시 보낸 결과는 처음 고른 상자로 보여 준다', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('Network Error'));
    const user = userEvent.setup();
    const { rerender } = render(
      <ConsolidationSheet shipmentId="src" open onOpenChange={jest.fn()} />
    );

    await user.click(card('SO-ok1'));
    await user.click(screen.getByRole('button', { name: '다음' }));
    await request(user);
    await screen.findByRole('button', { name: '같은 요청 다시 보내기' });

    // 서버는 이미 합쳤고, 다시 읽은 후보에서는 합쳐진 상대 상자가 빠졌다
    mockUseConsolidationOptions.mockReturnValue({
      data: {
        source: shipment('src', {
          items: [{ skuId: 'sku-1', name: '립밤', qty: 1 }],
        }),
        options: [memoOption],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
    rerender(
      <ConsolidationSheet shipmentId="src" open onOpenChange={jest.fn()} />
    );
    await user.click(
      screen.getByRole('button', { name: '같은 요청 다시 보내기' })
    );

    expect(
      await screen.findByText('주문 #SO-src, #SO-ok1 → 새 상자 1개')
    ).toBeTruthy();
    expect(
      screen.getByRole('list', { name: '주문 #SO-src, #SO-ok1 새 상자 상품' })
        .textContent
    ).toBe('립밤 3개');
  });

  it('출고 준비 화면 안에서는 링크 대신 그 화면에 상자를 넘긴다', async () => {
    const user = userEvent.setup();
    const onPrepare = jest.fn();

    render(
      <ConsolidationSheet
        shipmentId="src"
        open
        onOpenChange={jest.fn()}
        onPrepare={onPrepare}
      />
    );
    await user.click(card('SO-ok1'));
    await user.click(screen.getByRole('button', { name: '다음' }));
    await request(user);
    await user.click(
      await screen.findByRole('button', { name: '이 상자 출고 준비' })
    );

    expect(onPrepare).toHaveBeenCalledWith('target-1');
  });

  it('미리 고른 주문이 모두 고를 수 있으면 확인 단계부터 연다', async () => {
    const user = userEvent.setup();

    render(
      <ConsolidationSheet
        shipmentId="src"
        preselect={['ok1']}
        open
        onOpenChange={jest.fn()}
      />
    );

    expect(
      screen.getByText('주문 #SO-src, #SO-ok1 → 상자 1개, 송장 1장')
    ).toBeTruthy();

    await request(user);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(
      mutateAsync.mock.calls[0][0].data.sources.map((entry) => entry.shipmentId)
    ).toEqual(['src', 'ok1']);
  });

  it('미리 고른 주문의 메모가 다르면 확인 단계에서 메모를 고르게 한다', () => {
    render(
      <ConsolidationSheet
        shipmentId="src"
        preselect={['memo1']}
        open
        onOpenChange={jest.fn()}
      />
    );

    expect(
      screen.getByText('합친 상자에 붙일 배송 메모를 골라 주세요')
    ).toBeTruthy();
    expect(requestButton().hasAttribute('disabled')).toBe(true);
  });

  it('미리 고른 주문 중 고를 수 없게 된 것이 있으면 고르는 단계에 남는다', () => {
    render(
      <ConsolidationSheet
        shipmentId="src"
        preselect={['ok1', 'addr1']}
        open
        onOpenChange={jest.fn()}
      />
    );

    expect(
      screen.getByText('이 주문과 같이 보낼 주문을 골라 주세요')
    ).toBeTruthy();
    expect(card('SO-ok1').getAttribute('aria-checked')).toBe('true');
  });
});
