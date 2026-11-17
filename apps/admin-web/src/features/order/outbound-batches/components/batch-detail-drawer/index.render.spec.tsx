/** @jest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import type {
  BatchClaimState,
  EligibleShipmentV2,
  OutboundBatchV2,
  OutboundBatchWorkItemV2,
} from '@/lib/types/dto/fulfillment';
import { BatchDetailDrawer } from '.';

const mockPickingHandoff = jest.fn();
const mockPackerHandoff = jest.fn();
const mockRefetch = jest.fn();
let mockBatchAt = 2;
let mockBatch: OutboundBatchV2;
let mockKey = 0;
let mockCanHandoff = true;
let mockCanReadAccounts = true;
let mockEligible: EligibleShipmentV2[] = [];
const mockEligibleEnabled: boolean[] = [];
const mockEligibleSnapshots: Array<number | undefined> = [];
let mockEligiblePending = false;

function mockMutation() {
  return Object.assign(() => ({ mutateAsync: jest.fn(), isPending: false }), {
    permission: ['fulfillment.warehouse.operate'],
  });
}
function mockHandoffMutation(run: () => jest.Mock) {
  return Object.assign(
    () => ({
      mutateAsync: (...args: unknown[]) => run()(...args),
      isPending: false,
    }),
    {
      permission: {
        allOf: [
          ['fulfillment.warehouse.operate'],
          ['fulfillment.work.supervise'],
        ],
      },
    }
  );
}

jest.mock('@/lib/services/orders', () => ({
  ...jest.requireActual('@/lib/api/server-error'),
  createIdempotentCommand: (data: unknown) => ({
    data,
    idempotencyKey: `key-${++mockKey}`,
  }),
  useOutboundBatchV2: () => ({
    data: mockBatch,
    isLoading: false,
    dataUpdatedAt: mockBatchAt,
    refetch: mockRefetch,
  }),
  useOutboundBatchEligibleShipments: (
    _id: string,
    options?: { enabled?: boolean; snapshotAt?: number }
  ) => {
    mockEligibleEnabled.push(options?.enabled ?? true);
    mockEligibleSnapshots.push(options?.snapshotAt);
    return {
      data: mockEligiblePending ? undefined : mockEligible,
      isPending: mockEligiblePending,
    };
  },
  useAddShipmentToBatch: mockMutation(),
  useExcludeShipmentFromBatch: mockMutation(),
  useClaimBatchPicker: mockMutation(),
  useClaimBatchPacker: mockMutation(),
  useHandoffBatchWorkItem: mockHandoffMutation(() => mockPackerHandoff),
  usePickingHandoff: mockHandoffMutation(() => mockPickingHandoff),
}));

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({
    canRun: (action: { permission: unknown }) =>
      typeof action.permission === 'object' &&
      action.permission !== null &&
      'allOf' in action.permission
        ? mockCanHandoff
        : true,
  }),
  useCan: () => ({ status: 'ready', allowed: mockCanReadAccounts }),
}));

const STAFF = [
  {
    id: 'worker-a',
    username: '김하나',
    loginId: 'kim1',
    holdsPermission: true,
  },
  {
    id: 'worker-b',
    username: '이두리',
    loginId: 'lee2',
    holdsPermission: true,
  },
  {
    id: 'office-c',
    username: '박사무',
    loginId: 'park3',
    holdsPermission: false,
  },
];

const mockStaffQueries: Array<Record<string, unknown>> = [];

jest.mock('@/lib/services/users/queries', () => ({
  STAFF_CANDIDATE_LIMIT: 1000,
  useAdminUsers: (query: Record<string, unknown>) => {
    mockStaffQueries.push(query);
    return {
      data: mockCanReadAccounts ? { data: STAFF } : undefined,
      isPending: false,
      isError: false,
      isPlaceholderData: false,
    };
  },
  useAdminUsersByIds: () => ({
    data: mockCanReadAccounts ? { data: STAFF } : undefined,
  }),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

// cmdk 가 목록 크기를 재는 데 쓰는 브라우저 API — jsdom 에는 없다
class NoopResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}
globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.scrollIntoView = () => undefined;

const claim = (over: Partial<BatchClaimState> = {}): BatchClaimState => ({
  state: 'unclaimed',
  workerId: null,
  claimedAt: null,
  releasedAt: null,
  leaseExpiresAt: null,
  ...over,
});

const workItem = (
  over: Partial<OutboundBatchWorkItemV2>
): OutboundBatchWorkItemV2 => ({
  id: 'item-1',
  batchId: 'batch-1',
  shipmentId: 'ship-1',
  status: 'queued',
  leaseVersion: 3,
  pickerId: null,
  pickerClaimedAt: null,
  pickerReleasedAt: null,
  packerId: null,
  packerClaimedAt: null,
  packerReleasedAt: null,
  handedOffAt: null,
  completedAt: null,
  leaseExpiresAt: null,
  exclusionReason: null,
  recoveryReason: null,
  waitingOperationId: null,
  pickerClaim: claim(),
  packerClaim: claim(),
  displayOrderNo: 'A-1',
  itemSummary: '상품',
  ...over,
});

const batchWith = (
  workItems: OutboundBatchWorkItemV2[],
  sessionId: string | null = 'session-1'
): OutboundBatchV2 =>
  ({
    id: 'batch-1',
    batchNumber: 'OB-1',
    name: '배치',
    warehouseId: 'wh-1',
    pickingMethod: 'individual',
    cartCapacity: null,
    status: 'picking',
    totalItems: workItems.length,
    totalQty: workItems.length,
    workItems,
    picking: null,
    inventorySession: sessionId
      ? {
          id: sessionId,
          status: 'active',
          version: 1,
          handedInQty: 0,
          settledQty: 0,
          returnedQty: 0,
          shortageQty: 0,
          balances: [],
        }
      : null,
    toteAssignments: [],
  }) as OutboundBatchV2;

const picking = workItem({
  status: 'picking',
  pickerClaim: claim({ state: 'active', workerId: 'worker-a' }),
});

const renderDrawer = () =>
  render(
    <BatchDetailDrawer batchId="batch-1" open onOpenChange={() => undefined} />
  );

const openHandoff = async (button: string) => {
  const user = userEvent.setup();
  renderDrawer();
  await user.click(screen.getByRole('button', { name: button }));
  return { user, dialog: await screen.findByRole('dialog', { name: button }) };
};

beforeEach(() => {
  mockPickingHandoff.mockReset().mockResolvedValue({});
  mockPackerHandoff.mockReset().mockResolvedValue({});
  mockRefetch.mockReset().mockResolvedValue({});
  mockBatchAt = 2;
  jest.mocked(toast.success).mockClear();
  jest.mocked(toast.error).mockClear();
  mockKey = 0;
  mockStaffQueries.length = 0;
  mockCanHandoff = true;
  mockCanReadAccounts = true;
  mockBatch = batchWith([picking]);
  mockEligible = [];
  mockEligibleEnabled.length = 0;
  mockEligibleSnapshots.length = 0;
  mockEligiblePending = false;
});

it('맡은 작업자를 이름으로 보이고, 시간이 지났으면 이름 옆에 적는다', () => {
  mockBatch = batchWith([
    picking,
    workItem({
      id: 'item-2',
      status: 'packing',
      pickerClaim: claim({ state: 'released', workerId: 'worker-a' }),
      packerClaim: claim({ state: 'expired', workerId: 'worker-b' }),
    }),
  ]);
  renderDrawer();
  const rows = screen.getAllByRole('row');

  expect(within(rows[1]).getByText('김하나')).toBeTruthy();
  expect(within(rows[2]).getByText('김하나 (놓음)')).toBeTruthy();
  expect(within(rows[2]).getByText('이두리 (시간 지남)')).toBeTruthy();
});

it('직원 목록을 볼 수 없으면 맡은 상태만 보인다', () => {
  mockCanReadAccounts = false;
  renderDrawer();

  expect(screen.getByText('맡음')).toBeTruthy();
});

it('넘길 작업자와 사유 칸은 넘기기를 누르기 전에는 없다', () => {
  renderDrawer();

  expect(screen.queryByLabelText('사유')).toBeNull();
  expect(screen.queryByText('넘겨받을 작업자 ID')).toBeNull();
});

it('피킹 중인 상자는 피킹을 이름으로 찾은 작업자에게 넘긴다', async () => {
  const { user, dialog } = await openHandoff('피킹 넘기기');

  expect(within(dialog).getByText('김하나')).toBeTruthy();
  await user.type(
    within(dialog).getByPlaceholderText('이름이나 아이디로 찾기'),
    '두리'
  );
  await user.click(within(dialog).getByText('이두리'));
  await user.click(
    within(dialog).getByRole('button', { name: '이두리 (lee2)에게 넘기기' })
  );

  await waitFor(() =>
    expect(mockPickingHandoff).toHaveBeenCalledWith({
      data: {
        batchId: 'batch-1',
        sessionId: 'session-1',
        workItemId: 'item-1',
        shipmentId: 'ship-1',
        targetWorkerId: 'worker-b',
        expectedLeaseVersion: 3,
        reason: '근무 교대',
      },
      idempotencyKey: 'key-1',
    })
  );
  expect(toast.success).toHaveBeenCalledWith(
    '이두리 (lee2)에게 피킹을 넘겼어요.'
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '피킹 넘기기' })).toBeNull()
  );
  expect(mockPackerHandoff).not.toHaveBeenCalled();
});

it('검수 중인 상자는 포장 담당을 넘긴다', async () => {
  mockBatch = batchWith([
    workItem({
      status: 'packing',
      packerClaim: claim({ state: 'active', workerId: 'worker-b' }),
    }),
  ]);
  const { user, dialog } = await openHandoff('포장 넘기기');

  await user.type(
    within(dialog).getByPlaceholderText('이름이나 아이디로 찾기'),
    'kim'
  );
  await user.click(within(dialog).getByText('김하나'));
  await user.click(
    within(dialog).getByRole('button', { name: '김하나 (kim1)에게 넘기기' })
  );

  await waitFor(() =>
    expect(mockPackerHandoff).toHaveBeenCalledWith({
      batchId: 'batch-1',
      workItemId: 'item-1',
      data: {
        expectedLeaseVersion: 3,
        claimType: 'packer',
        targetWorkerId: 'worker-a',
        reason: '근무 교대',
      },
      idempotencyKey: 'key-1',
    })
  );
  expect(screen.queryByRole('button', { name: '피킹 넘기기' })).toBeNull();
});

it('받을 사람 후보에는 지금 담당자와 현장 작업 권한이 없는 직원이 없다', async () => {
  const { dialog } = await openHandoff('피킹 넘기기');
  const options = within(dialog).getAllByRole('option');

  expect(options.map((option) => option.textContent)).toEqual([
    '이두리 (lee2)',
  ]);
});

it('넘기기가 거절되면 창을 그대로 두고, 다른 사람을 고르면 새 명령으로 보낸다', async () => {
  mockPickingHandoff.mockRejectedValueOnce({
    message: 'Worker already owns active picker work item',
    statusCode: 409,
    response: {
      statusCode: 409,
      code: 'WORKER_ACTIVE_CLAIM_EXISTS',
      message: 'Worker already owns active picker work item',
    },
  });
  mockBatch = batchWith([
    workItem({
      status: 'picking',
      pickerClaim: claim({ state: 'active', workerId: 'office-c' }),
    }),
  ]);
  const { user, dialog } = await openHandoff('피킹 넘기기');

  await user.click(within(dialog).getByText('이두리'));
  await user.click(
    within(dialog).getByRole('button', { name: '이두리 (lee2)에게 넘기기' })
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      '받을 작업자가 다른 상자를 맡고 있어요. 그 상자를 끝내거나 넘긴 뒤 다시 해 주세요.'
    )
  );
  expect(screen.getByRole('dialog', { name: '피킹 넘기기' })).toBeTruthy();

  await user.click(within(dialog).getByText('김하나'));
  await user.click(
    within(dialog).getByRole('button', { name: '김하나 (kim1)에게 넘기기' })
  );

  await waitFor(() => expect(mockPickingHandoff).toHaveBeenCalledTimes(2));
  expect(mockPickingHandoff.mock.calls[1][0]).toMatchObject({
    data: { targetWorkerId: 'worker-a' },
    idempotencyKey: 'key-2',
  });
});

it('현장 작업 감독 권한이 없으면 넘기기 단추가 없다', () => {
  mockCanHandoff = false;
  mockBatch = batchWith([
    picking,
    workItem({
      id: 'item-2',
      status: 'packing',
      packerClaim: claim({ state: 'active', workerId: 'worker-b' }),
    }),
  ]);
  renderDrawer();

  expect(screen.queryByRole('button', { name: '피킹 넘기기' })).toBeNull();
  expect(screen.queryByRole('button', { name: '포장 넘기기' })).toBeNull();
});

it('직원 목록을 볼 수 없으면 넘기기 창에서 이유를 알려 준다', async () => {
  mockCanReadAccounts = false;
  const { dialog } = await openHandoff('피킹 넘기기');

  expect(
    within(dialog).getByText(
      '회원 조회 권한이 있어야 받을 작업자를 고를 수 있어요.'
    )
  ).toBeTruthy();
  expect(
    (
      within(dialog).getByRole('button', {
        name: '피킹 넘기기',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});

it('창을 연 뒤 상자 버전이 바뀌어 거절되면, 같은 사람에게 다시 넘길 때 새 버전으로 보낸다', async () => {
  mockPickingHandoff.mockRejectedValueOnce({
    message: 'stale',
    statusCode: 409,
    response: {
      statusCode: 409,
      code: 'PICKING_HANDOFF_STALE',
      message: 'stale',
    },
  });
  mockRefetch.mockImplementation(async () => {
    mockBatch = batchWith([{ ...picking, leaseVersion: 4 }]);
    return {};
  });
  const { user, dialog } = await openHandoff('피킹 넘기기');

  await user.click(within(dialog).getByText('이두리'));
  const send = within(dialog).getByRole('button', {
    name: '이두리 (lee2)에게 넘기기',
  });
  await user.click(send);
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  await user.click(send);

  await waitFor(() => expect(mockPickingHandoff).toHaveBeenCalledTimes(2));
  expect(mockPickingHandoff.mock.calls[1][0]).toMatchObject({
    data: { expectedLeaseVersion: 4, targetWorkerId: 'worker-b' },
    idempotencyKey: 'key-2',
  });
});

it('넘기기 창을 연 사이 상자가 피킹을 마치면 창을 닫고, 다시 열지 않는다', async () => {
  mockPickingHandoff.mockRejectedValueOnce({
    message: 'not active',
    statusCode: 409,
    response: {
      statusCode: 409,
      code: 'PICKING_HANDOFF_NOT_ACTIVE',
      message: 'not active',
    },
  });
  mockRefetch.mockImplementation(async () => {
    mockBatch = batchWith([{ ...picking, status: 'ready_to_pack' }]);
    return {};
  });
  const user = userEvent.setup();
  const { rerender } = renderDrawer();
  await user.click(screen.getByRole('button', { name: '피킹 넘기기' }));
  const dialog = await screen.findByRole('dialog', { name: '피킹 넘기기' });

  await user.click(within(dialog).getByText('이두리'));
  await user.click(
    within(dialog).getByRole('button', { name: '이두리 (lee2)에게 넘기기' })
  );

  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '피킹 넘기기' })).toBeNull()
  );
  expect(toast.error).toHaveBeenCalledWith(
    '피킹 중인 담당자가 없어서 넘길 수 없어요. 목록을 다시 불러왔어요.'
  );

  // 같은 상자가 다시 피킹 중이 돼도 닫힌 창이 저절로 다시 열리지 않는다
  mockBatch = batchWith([{ ...picking, leaseVersion: 5 }]);
  rerender(
    <BatchDetailDrawer batchId="batch-1" open onOpenChange={() => undefined} />
  );
  expect(screen.queryByRole('dialog', { name: '피킹 넘기기' })).toBeNull();
});

it('검색어는 서버에 보내 직원이 많아도 찾게 한다', async () => {
  const { user, dialog } = await openHandoff('피킹 넘기기');

  await user.type(
    within(dialog).getByPlaceholderText('이름이나 아이디로 찾기'),
    'lee2'
  );

  await waitFor(() =>
    expect(mockStaffQueries.at(-1)).toMatchObject({
      audience: 'staff',
      holding: 'fulfillment.warehouse.operate',
      q: 'lee2',
    })
  );
  expect(mockStaffQueries[0].q).toBeUndefined();
});

describe('상자 추가와 재고 작업 안내는 배치 상태를 따른다', () => {
  const candidate: EligibleShipmentV2 = {
    shipmentId: 'ship-9',
    warehouseId: 'wh-1',
    shippingProfileId: 'profile-1',
    manifestVersion: 1,
    reservationVersion: 1,
    recipientHash: 'hash',
    totalItems: 1,
    totalQty: 2,
    waybillId: 'waybill-9',
    trackingNo: '100000000009',
    displayOrderNo: 'B-9',
    itemSummary: '다른 상품',
  };
  const done = workItem({ status: 'completed' });

  beforeEach(() => {
    mockEligible = [candidate];
  });

  it('출고를 마친 배치에는 추가할 상자를 묻지도 보이지도 않는다', () => {
    mockBatch = {
      ...batchWith([done], null),
      status: 'completed',
      startedAt: '2026-01-02T03:00:00.000Z',
    };
    renderDrawer();

    expect(mockEligibleEnabled).not.toContain(true);
    expect(screen.queryByText('추가할 수 있는 상자')).toBeNull();
    expect(screen.queryByRole('button', { name: '추가' })).toBeNull();
    expect(screen.queryByText('#B-9')).toBeNull();
    expect(screen.getByText('출고를 마쳐 재고 작업이 끝났어요.')).toBeTruthy();
    expect(screen.queryByText('피킹 시작 전입니다.')).toBeNull();
  });

  it('상자가 모두 빠져 취소된 배치도 추가를 막고 재고 작업이 끝났다고 한다', () => {
    mockBatch = {
      ...batchWith([workItem({ status: 'excluded' })], null),
      status: 'canceled',
      startedAt: '2026-01-02T03:00:00.000Z',
    };
    renderDrawer();

    expect(mockEligibleEnabled).not.toContain(true);
    expect(screen.queryByText('추가할 수 있는 상자')).toBeNull();
    expect(screen.queryByRole('button', { name: '추가' })).toBeNull();
    expect(
      screen.getByText('취소된 배치라 재고 작업이 끝났어요.')
    ).toBeTruthy();
  });

  it('재고 작업 복구가 필요한 진행 중 배치는 복구 뒤에 넣으라고 한다', () => {
    const base = batchWith([picking]);
    mockBatch = {
      ...base,
      startedAt: '2026-01-02T03:00:00.000Z',
      inventorySession: base.inventorySession && {
        ...base.inventorySession,
        status: 'recovery_required',
      },
    };
    renderDrawer();

    expect(screen.queryByRole('button', { name: '추가' })).toBeNull();
    expect(
      screen.getByText('재고 작업 복구가 끝나야 상자를 더 넣을 수 있어요.')
    ).toBeTruthy();
  });

  it('바구니가 모두 찬 배치는 정원을 알려 주고, 상자가 끝나 바구니가 비면 다시 받는다', () => {
    const tote = (items: OutboundBatchWorkItemV2[]): OutboundBatchV2 => ({
      ...batchWith(items),
      pickingMethod: 'multi_order',
      cartCapacity: 1,
      startedAt: '2026-01-02T03:00:00.000Z',
    });
    mockBatch = tote([picking]);
    const { unmount } = renderDrawer();

    expect(mockEligibleEnabled).not.toContain(true);
    expect(screen.queryByRole('button', { name: '추가' })).toBeNull();
    expect(
      screen.getByText('바구니 1개가 모두 차서 상자를 더 넣을 수 없어요.')
    ).toBeTruthy();

    unmount();
    mockBatch = tote([workItem({ status: 'completed' })]);
    renderDrawer();
    expect(screen.getByRole('button', { name: '추가' })).toBeTruthy();
  });

  it('후보를 받기 전에는 추가할 상자가 없다고 하지 않는다', () => {
    mockBatch = {
      ...batchWith([picking]),
      startedAt: '2026-01-02T03:00:00.000Z',
    };
    mockEligiblePending = true;
    renderDrawer();

    expect(screen.getByText('추가할 수 있는 상자를 확인하는 중…')).toBeTruthy();
    expect(screen.queryByText(/추가할 수 있는 상자가 없습니다/)).toBeNull();
  });

  it('후보는 받은 배치 시점을 기준으로 묻고, 배치가 새로 들어오면 그 시점으로 다시 묻는다', () => {
    mockBatch = {
      ...batchWith([picking]),
      startedAt: '2026-01-02T03:00:00.000Z',
    };
    const view = renderDrawer();
    expect(mockEligibleSnapshots.at(-1)).toBe(2);

    mockBatchAt = 5;
    view.rerender(
      <BatchDetailDrawer
        batchId="batch-1"
        open
        onOpenChange={() => undefined}
      />
    );
    expect(mockEligibleSnapshots.at(-1)).toBe(5);
  });

  it('이미 이 배치에 들어간 상자는 후보로 보이지 않는다', () => {
    mockBatch = {
      ...batchWith([picking, workItem({ id: 'item-9', shipmentId: 'ship-9' })]),
      startedAt: '2026-01-02T03:00:00.000Z',
    };
    renderDrawer();

    expect(screen.queryByRole('button', { name: '추가' })).toBeNull();
    expect(screen.getByText(/추가할 수 있는 상자가 없습니다/)).toBeTruthy();
  });

  it('피킹 중인 배치는 후보와 추가 버튼을 그대로 보인다', () => {
    mockBatch = {
      ...batchWith([picking]),
      startedAt: '2026-01-02T03:00:00.000Z',
    };
    renderDrawer();

    expect(mockEligibleEnabled).toContain(true);
    expect(screen.getByText('#B-9')).toBeTruthy();
    expect(screen.getByRole('button', { name: '추가' })).toBeTruthy();
  });

  it('시작 전 배치는 후보를 보이고 피킹 시작 전이라고 한다', () => {
    mockBatch = {
      ...batchWith([workItem({})], null),
      status: 'created',
    };
    renderDrawer();

    expect(screen.getByRole('button', { name: '추가' })).toBeTruthy();
    expect(screen.getByText('피킹 시작 전입니다.')).toBeTruthy();
  });
});
