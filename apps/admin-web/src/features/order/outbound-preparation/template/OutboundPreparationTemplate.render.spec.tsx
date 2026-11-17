/** @jest-environment jsdom */
import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { permissionLabel } from '@/lib/auth/permission-labels';
import { useOutboundPreparationSummary } from '@/lib/services/orders';
import type {
  OutboundPreparationSummary,
  PreparationBucket,
  PreparationShipmentDto,
} from '@/lib/types/dto/fulfillment';
import type {
  PreparationInput,
  PreparationProgress,
} from '@/lib/services/orders/outbound-preparation-runner';
import OutboundPreparationTemplate from './OutboundPreparationTemplate';

const mockRun = jest.fn<
  Promise<PreparationProgress>,
  [
    PreparationInput & {
      onProgress: (p: PreparationProgress) => void;
      assertActive: () => void;
    },
  ]
>();
const mockSplit = jest.fn();
const mockRefetch = jest.fn();
let mockKeyCounter = 0;
let mockAllowed = true;
let mockShipmentReadAllowed = true;
type MockBatch = {
  batchNumber: string;
  name: string;
  status: string;
  startedAt?: string;
  workItems: { shipmentId: string; status: string }[];
};
const mockLoadBatch = jest.fn<Promise<MockBatch>, [string]>();
let mockConsolidationAllowed = true;
let mockSummary: OutboundPreparationSummary;
let mockError = false;
let mockParams = new URLSearchParams();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/order/waybill-issue',
  useSearchParams: () => mockParams,
}));

jest.mock('@/lib/services/orders', () => ({
  useLoadMoreOutboundPreparation: Object.assign(
    () => ({ mutate: jest.fn(), isPending: false, isError: false }),
    { permission: ['fulfillment.shipment.read'] }
  ),
  useOutboundPreparationSummary: jest.fn(() => ({
    data: mockSummary,
    isError: mockError,
    isLoading: false,
    refetch: mockRefetch,
  })),
  useRunOutboundPreparation: Object.assign(
    () => ({ mutateAsync: mockRun, isPending: false }),
    { permission: ['fulfillment.warehouse.operate'] }
  ),
  useSplitUnreservedMany: Object.assign(
    () => ({ mutateAsync: mockSplit, isPending: false }),
    { permission: ['fulfillment.warehouse.operate'] }
  ),
  useCreateShipmentConsolidation: Object.assign(jest.fn(), {
    permission: ['fulfillment.shipment.consolidate'],
  }),
  createIdempotentCommand: (data: unknown) => ({
    data,
    idempotencyKey: `split-${++mockKeyCounter}`,
  }),
  useLoadOutboundBatchV2: () => mockLoadBatch,
  getServerDenyMessage: (_error: unknown, fallback: string) => fallback,
  parseServerError: jest.requireActual('@/lib/api/server-error')
    .parseServerError,
}));

const mockWarehouses = [
  {
    id: 'w1',
    name: '부천 물류창고',
    supportedPickingStrategies: ['pick_to_tote', 'aggregate_then_sort'],
  },
];
let mockWarehousesLoaded = true;

jest.mock('@/lib/services/inventory/queries', () => ({
  useWarehouses: () =>
    mockWarehousesLoaded
      ? { data: mockWarehouses, isSuccess: true }
      : { data: undefined, isSuccess: false },
}));

jest.mock('@/hooks/use-permission', () => ({
  useCan: () => ({ status: 'ready', allowed: mockShipmentReadAllowed }),
  useCanRun: (action: { permission: readonly string[] }) => ({
    status: 'ready',
    allowed:
      mockAllowed &&
      (!action.permission.includes('fulfillment.shipment.consolidate') ||
        mockConsolidationAllowed),
  }),
  usePermissionCheck: () => ({ canRun: () => mockAllowed }),
}));

jest.mock('@/features/order/fulfillments/detail/consolidation-sheet', () => ({
  ConsolidationSheet: ({
    shipmentId,
    onPrepare,
  }: {
    shipmentId: string;
    onPrepare?: (id: string) => void;
  }) => (
    <div role="dialog" aria-label="합포장">
      {shipmentId}
      <button onClick={() => onPrepare?.('ready-2')}>이 상자 출고 준비</button>
    </div>
  ),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.hasPointerCapture = () => false;
Element.prototype.scrollIntoView = () => {};

function shipments(
  bucket: PreparationBucket,
  count: number
): PreparationShipmentDto[] {
  return Array.from({ length: count }, (_, index) => ({
    shipmentId: `${bucket}-${index + 1}`,
    orderNos: [`AY-${bucket}-${index + 1}`],
    itemSummary: '상품',
    totalQty: 1,
    single: index < 7,
    reason: bucket === 'needs_info' ? '배송 정보가 부족해요' : null,
    ...(bucket === 'partial' && {
      lines: [{ name: '상품', qty: 3, reservedQty: 2 }],
    }),
  }));
}

function result(
  changes: Partial<PreparationProgress> = {}
): PreparationProgress {
  return {
    stage: 'join',
    retrying: false,
    planned: 35,
    waybilled: 35,
    joined: 35,
    total: 35,
    batchId: 'batch-1',
    batchName: '11/05 토탈피킹 #1',
    failures: [],
    ...changes,
  };
}

function row(label: string) {
  const element = screen.getByText(label).closest('tr');

  if (!element) {
    throw new Error(`Missing row: ${label}`);
  }

  return within(element);
}

function checkedRows() {
  return document.querySelectorAll(
    'tbody [role="checkbox"][aria-checked="true"]'
  );
}

function batchData(
  data: Partial<MockBatch> = {},
  inBatch = Array.from({ length: 35 }, (_, index) => `ready-${index + 1}`)
): MockBatch {
  return {
    batchNumber: 'OB-1A2B3C4D5E6F',
    name: '11/05 토탈피킹 #1',
    status: 'created',
    workItems: inBatch.map((shipmentId) => ({ shipmentId, status: 'queued' })),
    ...data,
  };
}

const steps = (section: HTMLElement) =>
  within(section)
    .queryAllByRole('listitem')
    .map((item) => item.textContent);

async function start() {
  await userEvent.click(
    row('완전출고').getByRole('button', { name: '출고 준비' })
  );
  await userEvent.click(screen.getByRole('button', { name: '시작' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRun.mockReset();
  mockKeyCounter = 0;
  mockAllowed = true;
  mockShipmentReadAllowed = true;
  mockLoadBatch.mockReset();
  mockLoadBatch.mockImplementation(async () => {
    const joined = new Set<string>();

    for (const [index, [call]] of mockRun.mock.calls.entries()) {
      const done = await mockRun.mock.results[index]?.value.catch(() => null);
      const failed = new Set(
        (done?.failures ?? []).map(
          (failure: { shipmentId: string }) => failure.shipmentId
        )
      );

      for (const id of call.shipmentIds) {
        if (done && !failed.has(id)) {
          joined.add(id);
        }
      }
    }

    return batchData({}, [...joined]);
  });
  mockConsolidationAllowed = true;
  mockError = false;
  mockParams = new URLSearchParams();
  mockWarehousesLoaded = true;
  mockSummary = {
    warehouseId: 'w1',
    awaitingMatchingCount: 12,
    buckets: (
      [
        ['ready', 35],
        ['partial', 33],
        ['unavailable', 0],
        ['mergeable', 4],
        ['resume', 3],
        ['needs_info', 2],
      ] as const
    ).map(([bucket, count]) => ({
      bucket,
      count,
      singleCount: bucket === 'ready' ? 7 : 0,
      multiCount: bucket === 'ready' ? 28 : 0,
      shipments: shipments(bucket, count),
    })),
  };
  mockRun.mockImplementation(async ({ onProgress }) => {
    const progress = result();
    onProgress(progress);

    return progress;
  });
  mockSplit.mockResolvedValue({ succeeded: ['partial-1'], failed: [] });
});

describe('OutboundPreparationTemplate', () => {
  it('상자 조회 권한이 없으면 안내를 보여 주고 summary 조회를 끈다', () => {
    mockShipmentReadAllowed = false;

    render(<OutboundPreparationTemplate />);

    expect(
      screen.getByText(
        `상자 목록은 ${permissionLabel('fulfillment.shipment.read')} 권한이 있어야 보여요.`
      )
    ).toBeTruthy();
    expect(useOutboundPreparationSummary).toHaveBeenCalledWith('w1', false);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull();
  });

  it('분류 순서와 35장, 단일 7 / 합포 28을 보여 주고 출고불가 내역은 끈다', () => {
    render(<OutboundPreparationTemplate />);

    expect(screen.getByText('35장')).toBeTruthy();
    expect(screen.getByText('단일 7 / 합포 28')).toBeTruthy();
    expect(
      screen
        .getAllByRole('row')
        .slice(1)
        .map((element) => within(element).getAllByRole('cell')[0].textContent)
    ).toEqual([
      '완전출고',
      '부분출고',
      '출고불가',
      '미매칭',
      '합칠 주문 있음',
      '이어서 처리',
      '정보 부족',
    ]);
    expect(
      row('출고불가')
        .getByRole('button', { name: '내역보기' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      row('미매칭')
        .getByRole('link', { name: '매칭하러 가기' })
        .getAttribute('href')
    ).toBe('/order/matching');
  });

  it('확인 문구를 보여 주고 35개 상자를 기본 토탈피킹으로 시작한다', async () => {
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('완전출고').getByRole('button', { name: '출고 준비' })
    );

    expect(screen.getByText('완전출고 35건을 출고 준비할까요?')).toBeTruthy();
    expect(
      screen.getByText(
        '상자 확정, 송장 발급, 출고 배치에 담기까지 한 번에 해요.'
      )
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '시작' }));
    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));

    expect(mockRun.mock.calls[0][0]).toMatchObject({
      warehouseId: 'w1',
      pickingMethod: 'total_picking',
    });
    expect(mockRun.mock.calls[0][0].shipmentIds).toHaveLength(35);
    expect(screen.getByText(/상자 확정 35\/35/)).toBeTruthy();
    expect(screen.getByText(/송장 발급 35\/35/)).toBeTruthy();
    expect(screen.getByText(/출고 배치에 담기 35\/35/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '출고 배치 열기' }).getAttribute('href')
    ).toBe('/order/outbound-batches?batchId=batch-1');
  });

  it('실패한 상자 하나만 같은 배치로 재시도하고 누적 결과와 주문번호를 유지한다', async () => {
    mockRun.mockResolvedValueOnce(
      result({
        waybilled: 34,
        joined: 34,
        failures: [
          {
            shipmentId: 'ready-1',
            stage: 'waybill',
            message: '한진 주소 확인 불가',
            retryable: true,
          },
        ],
      })
    );
    mockRun.mockResolvedValueOnce(
      result({ planned: 1, waybilled: 1, joined: 1, total: 1, batchName: null })
    );
    render(<OutboundPreparationTemplate />);
    await start();

    expect(
      await screen.findByText('AY-ready-1', { exact: false })
    ).toBeTruthy();
    expect(screen.getByText('한진 주소 확인 불가')).toBeTruthy();
    // 다시 시도로 안 풀리는 멈춘 송장은 상자 상세에서 끊는다(#1241).
    expect(
      screen.getByRole('link', { name: '상자 보기' }).getAttribute('href')
    ).toBe('/order/fulfillments?shipmentId=ready-1');
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(2));

    expect(mockRun.mock.calls[1][0]).toMatchObject({
      shipmentIds: ['ready-1'],
      existingBatchId: 'batch-1',
    });
    expect(screen.getByText(/상자 확정 35\/35/)).toBeTruthy();
    expect(screen.getByText(/송장 발급 35\/35/)).toBeTruthy();
    expect(screen.getByText(/출고 배치에 담기 35\/35/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
  });

  it('확정 오류는 상자 보기와 다시 시도를 함께 남긴다', async () => {
    mockRun.mockResolvedValueOnce(
      result({
        waybilled: 34,
        joined: 34,
        failures: [
          {
            shipmentId: 'ready-1',
            stage: 'waybill',
            message: '송장 발급 결과를 확인해야 해요',
            retryable: false,
          },
        ],
      })
    );
    render(<OutboundPreparationTemplate />);
    await start();

    expect(
      await screen.findByText('송장 발급 결과를 확인해야 해요')
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '상자 보기' }).getAttribute('href')
    ).toBe('/order/fulfillments?shipmentId=ready-1');
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();
  });

  it('권한이 없으면 쓰기 버튼을 보여 주지 않는다', () => {
    mockAllowed = false;
    render(<OutboundPreparationTemplate />);

    expect(screen.queryByRole('button', { name: '출고 준비' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: '이어서 출고 준비' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: '있는 것만 먼저 보내기' })
    ).toBeNull();
  });

  it('100건만 미리 체크하고 해제한 상자는 준비에서 제외한다', async () => {
    mockSummary.buckets[0] = {
      ...mockSummary.buckets[0],
      count: 101,
      shipments: shipments('ready', 101),
    };
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('완전출고').getByRole('button', { name: '내역보기' })
    );

    expect(screen.getByText('한 번에 100건까지 처리해요')).toBeTruthy();
    const all = screen.getByLabelText('앞 100건 선택');
    const first = screen.getByLabelText('#AY-ready-1 선택');
    const last = screen.getByLabelText('#AY-ready-101 선택');
    expect(checkedRows()).toHaveLength(100);
    expect(all.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(last);
    expect(last.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(first);
    expect(all.getAttribute('aria-checked')).toBe('mixed');

    await userEvent.click(all);
    expect(checkedRows()).toHaveLength(100);
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(last.getAttribute('aria-checked')).toBe('false');

    await userEvent.click(first);
    await userEvent.click(last);
    expect(checkedRows()).toHaveLength(100);
    expect(all.getAttribute('aria-checked')).toBe('mixed');
    await userEvent.click(all);
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(last.getAttribute('aria-checked')).toBe('false');

    await userEvent.click(first);
    await start();

    expect(mockRun.mock.calls[0][0].shipmentIds).toHaveLength(99);
    expect(mockRun.mock.calls[0][0].shipmentIds).not.toContain('ready-1');
  });

  it('전체 해제한 뒤 고른 상자만 준비하고 건수를 그대로 보여 준다', async () => {
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('완전출고').getByRole('button', { name: '내역보기' })
    );
    const all = screen.getByLabelText('전체 선택');
    expect(all.getAttribute('aria-checked')).toBe('true');

    await userEvent.click(all);
    expect(checkedRows()).toHaveLength(0);
    expect(all.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('완전출고 내역 · 0건 선택')).toBeTruthy();
    expect(
      row('완전출고')
        .getByRole('button', { name: '출고 준비' })
        .hasAttribute('disabled')
    ).toBe(true);

    await userEvent.click(screen.getByLabelText('#AY-ready-2 선택'));
    expect(all.getAttribute('aria-checked')).toBe('mixed');
    expect(screen.getByText('완전출고 내역 · 1건 선택')).toBeTruthy();
    expect(row('완전출고').getByText('1건 선택')).toBeTruthy();
    await userEvent.click(
      row('완전출고').getByRole('button', { name: '출고 준비' })
    );
    expect(screen.getByText('완전출고 1건을 출고 준비할까요?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '시작' }));

    expect(mockRun.mock.calls[0][0].shipmentIds).toEqual(['ready-2']);
  });

  it('부분출고에서 체크한 상자만 나누고 성공·실패 건수를 결과 창에 보여 준다', async () => {
    mockSplit.mockResolvedValueOnce({
      succeeded: ['partial-2'],
      failed: [{ shipmentId: 'partial-3', message: '실패' }],
    });
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('부분출고').getByRole('button', { name: '내역보기' })
    );
    await userEvent.click(screen.getByLabelText('#AY-partial-1 선택'));
    await userEvent.click(
      screen.getByRole('button', { name: '있는 것만 먼저 보내기' })
    );
    await userEvent.click(screen.getByRole('button', { name: '나누기' }));

    await waitFor(() => expect(mockSplit).toHaveBeenCalledTimes(1));
    expect(mockSplit.mock.calls[0][0].data.shipmentIds).toHaveLength(32);
    expect(mockSplit.mock.calls[0][0].data.shipmentIds).not.toContain(
      'partial-1'
    );

    const dialog = await screen.findByRole('dialog', {
      name: '1건을 나눴어요',
    });

    expect(within(dialog).getByText('1건은 나누지 못했어요')).toBeTruthy();
    expect(within(dialog).getByText('#AY-partial-2')).toBeTruthy();
    expect(within(dialog).getByText('지금 보낼 2 · 기다릴 1')).toBeTruthy();
  });

  it('부분출고 내역과 나누기 확인 창에 품목별 주문·지금 보낼·기다릴 수량을 보여 준다', async () => {
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('부분출고').getByRole('button', { name: '내역보기' })
    );

    expect(row('#AY-partial-1').getByRole('listitem').textContent).toBe(
      '상품주문 3 · 지금 보낼 2 · 기다릴 1'
    );

    await userEvent.click(
      screen.getByRole('button', { name: '있는 것만 먼저 보내기' })
    );

    const dialog = screen.getByRole('alertdialog');

    expect(
      within(dialog).getByText('지금 보낼 상품 66개, 기다릴 상품 33개')
    ).toBeTruthy();
  });

  it('나눈 뒤 결과 창에서 나눈 상자만 골라 출고 준비를 이어 간다', async () => {
    mockSplit.mockResolvedValueOnce({
      succeeded: ['partial-1', 'partial-2'],
      failed: [],
    });
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('부분출고').getByRole('button', { name: '내역보기' })
    );
    await userEvent.click(screen.getByLabelText('전체 선택'));
    await userEvent.click(screen.getByLabelText('#AY-partial-1 선택'));
    await userEvent.click(screen.getByLabelText('#AY-partial-2 선택'));
    await userEvent.click(
      screen.getByRole('button', { name: '있는 것만 먼저 보내기' })
    );
    await userEvent.click(screen.getByRole('button', { name: '나누기' }));
    await userEvent.click(
      await screen.findByRole('button', { name: '지금 보낼 상자 출고 준비' })
    );

    expect(screen.getByText('완전출고 2건을 출고 준비할까요?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '시작' }));

    expect(mockRefetch).not.toHaveBeenCalled();
    expect(mockRun.mock.calls[0][0].shipmentIds).toEqual([
      'partial-1',
      'partial-2',
    ]);
  });

  it('한 건도 나누지 못하면 이어 갈 단추 없이 실패 건수만 보여 준다', async () => {
    mockSplit.mockResolvedValueOnce({
      succeeded: [],
      failed: [{ shipmentId: 'partial-1', message: '실패' }],
    });
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      screen.getByRole('button', { name: '있는 것만 먼저 보내기' })
    );
    await userEvent.click(screen.getByRole('button', { name: '나누기' }));

    const dialog = await screen.findByRole('dialog', {
      name: '상자를 나누지 못했어요',
    });

    expect(within(dialog).getByText('1건은 나누지 못했어요')).toBeTruthy();
    expect(
      within(dialog).queryByRole('button', { name: '지금 보낼 상자 출고 준비' })
    ).toBeNull();
  });

  it('나눈 뒤 결과 창에서 기다릴 상자가 있는 출고불가 내역을 연다', async () => {
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      screen.getByRole('button', { name: '있는 것만 먼저 보내기' })
    );
    await userEvent.click(screen.getByRole('button', { name: '나누기' }));
    await userEvent.click(
      await screen.findByRole('button', { name: '기다릴 상자 보기' })
    );

    expect(screen.getByRole('region', { name: '출고불가 내역' })).toBeTruthy();
  });

  it('분할 뒤 새 요약의 완전출고 원본으로 출고 준비를 시작한다', async () => {
    mockSummary.buckets[0] = {
      ...mockSummary.buckets[0],
      count: 0,
      shipments: [],
    };
    mockSplit.mockImplementationOnce(async () => {
      mockSummary = {
        ...mockSummary,
        buckets: mockSummary.buckets.map((bucket) =>
          bucket.bucket === 'ready'
            ? {
                ...bucket,
                count: 1,
                shipments: shipments('partial', 1),
              }
            : bucket
        ),
      };

      return { succeeded: ['partial-1'], failed: [] };
    });
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      screen.getByRole('button', { name: '있는 것만 먼저 보내기' })
    );
    await userEvent.click(screen.getByRole('button', { name: '나누기' }));
    await userEvent.click(await screen.findByRole('button', { name: '닫기' }));
    await waitFor(() => expect(row('완전출고').getByText('1장')).toBeTruthy());
    await start();

    expect(mockRun.mock.calls[0][0].shipmentIds).toEqual(['partial-1']);
  });

  it('합치기 권한 없이도 체크한 상자를 확인 후 따로 출고 준비한다', async () => {
    mockConsolidationAllowed = false;
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('합칠 주문 있음').getByRole('button', { name: '내역보기' })
    );
    await userEvent.click(screen.getByLabelText('#AY-mergeable-1 선택'));
    expect(screen.queryByRole('button', { name: '합치기' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '따로 보내기' }));

    expect(
      screen.getByText('합칠 수 있는 3건을 따로 출고 준비할까요?')
    ).toBeTruthy();
    expect(mockRun).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '시작' }));

    expect(mockRun.mock.calls[0][0]).toMatchObject({
      shipmentIds: ['mergeable-2', 'mergeable-3', 'mergeable-4'],
      pickingMethod: 'total_picking',
      warehouseId: 'w1',
    });
  });

  it('같은 주문을 나눈 상자는 몫을 보여 주고 따로 보낸 결과에서도 구분한다', async () => {
    const mergeable = mockSummary.buckets.find(
      (bucket) => bucket.bucket === 'mergeable'
    );

    if (!mergeable) {
      throw new Error('Missing mergeable bucket');
    }

    mergeable.count = 2;
    mergeable.shipments = ['split-a', 'split-b'].map((id, index) => ({
      shipmentId: id,
      orderNos: ['AY-SPLIT'],
      itemSummary: '상품',
      totalQty: 1,
      single: true,
      reason: null,
      split: { boxQty: 1, orderQty: 2, boxNo: index + 1, boxCount: 2 },
    }));
    mockRun.mockResolvedValueOnce(
      result({
        planned: 2,
        waybilled: 1,
        joined: 1,
        total: 2,
        failures: [
          {
            shipmentId: 'split-b',
            stage: 'waybill',
            message: '한진 주소 확인 불가',
            retryable: true,
          },
        ],
      })
    );
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('합칠 주문 있음').getByRole('button', { name: '내역보기' })
    );

    expect(screen.getByText('나눈 상자 1/2 · 주문 2개 중 1개')).toBeTruthy();
    expect(screen.getByText('나눈 상자 2/2 · 주문 2개 중 1개')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '따로 보내기' }));
    await userEvent.click(screen.getByRole('button', { name: '시작' }));

    const failure = (await screen.findByText('한진 주소 확인 불가'))
      .parentElement;

    expect(failure?.textContent).toContain('나눈 상자 2/2 · 주문 2개 중 1개');
  });

  it('출고 권한이 없으면 따로 보내기를 숨긴다', async () => {
    mockAllowed = false;
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('합칠 주문 있음').getByRole('button', { name: '내역보기' })
    );

    expect(screen.queryByRole('button', { name: '따로 보내기' })).toBeNull();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('합칠 주문의 각 줄에서 합포장 시트를 연다', async () => {
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('합칠 주문 있음').getByRole('button', { name: '내역보기' })
    );
    await userEvent.click(screen.getAllByRole('button', { name: '합치기' })[1]);

    expect(
      within(screen.getByRole('dialog', { name: '합포장' })).getByText(
        'mergeable-2'
      )
    ).toBeTruthy();
  });

  it('정보 부족은 사유와 상자 상세 링크를 보여 준다', async () => {
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('정보 부족').getByRole('button', { name: '내역보기' })
    );

    expect(screen.getAllByText('배송 정보가 부족해요')).toHaveLength(2);
    expect(
      screen.getAllByRole('link', { name: '상자 상세' })[0].getAttribute('href')
    ).toBe('/order/fulfillments?shipmentId=needs_info-1');
  });

  it('이어서 처리에서는 해당 상자들만 실행한다', async () => {
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      screen.getByRole('button', { name: '이어서 출고 준비' })
    );
    await userEvent.click(screen.getByRole('button', { name: '시작' }));

    expect(mockRun.mock.calls[0][0].shipmentIds).toEqual([
      'resume-1',
      'resume-2',
      'resume-3',
    ]);
  });

  it('멀티오더는 양의 정수 카트 용량을 요구한다', async () => {
    render(<OutboundPreparationTemplate />);
    await userEvent.click(screen.getByRole('combobox', { name: '피킹 방식' }));
    await userEvent.click(screen.getByRole('option', { name: /멀티오더/ }));
    const capacity = screen.getByRole('spinbutton', { name: '카트 용량' });
    fireEvent.change(capacity, { target: { value: '2.5' } });
    expect(
      row('완전출고')
        .getByRole('button', { name: '출고 준비' })
        .hasAttribute('disabled')
    ).toBe(true);
    fireEvent.change(capacity, { target: { value: '40' } });
    await start();

    expect(mockRun.mock.calls[0][0]).toMatchObject({
      pickingMethod: 'multi_order',
      cartCapacity: 40,
    });
  });

  it('재시도 중 안내를 표시하고 중복 시작과 닫기를 막는다', async () => {
    let finish!: (progress: PreparationProgress) => void;
    mockRun.mockImplementationOnce(({ onProgress }) => {
      onProgress(result({ retrying: true, batchId: null, batchName: null }));

      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    render(<OutboundPreparationTemplate />);
    await start();

    expect(
      screen.getByText('연결이 잠깐 끊겨서 다시 시도하고 있어요.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '시작' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    finish(result());
    await screen.findByRole('link', { name: '출고 배치 열기' });
  });

  it.each(['success', 'error'])(
    '실행 중 언마운트 후 진행·완료(%s) 상태를 갱신하지 않고 재진입한 실행과 분리한다',
    async (outcome) => {
      const useState = React.useState;
      const setters: jest.Mock[] = [];
      const stateSpy = jest
        .spyOn(React, 'useState')
        .mockImplementation((initial?: unknown) => {
          const [value, setValue] = useState(initial);
          const setter = jest.fn(setValue);

          setters.push(setter);

          return [value, setter];
        });

      let finish!: (progress: PreparationProgress) => void;
      let fail!: (error: Error) => void;

      mockRun.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = resolve;
            fail = reject;
          })
      );

      try {
        const { unmount } = render(<OutboundPreparationTemplate />);
        await start();

        const { onProgress, assertActive } = mockRun.mock.calls[0][0];
        expect(assertActive).not.toThrow();
        unmount();
        stateSpy.mockRestore();

        for (const setter of setters) {
          setter.mockClear();
        }

        expect(assertActive).toThrow('화면을 떠나 출고 준비를 중단했어요.');
        render(<OutboundPreparationTemplate />);
        await start();
        expect(mockRun.mock.calls[1][0].assertActive).not.toThrow();

        await act(async () => {
          onProgress(result({ planned: 0, waybilled: 0, joined: 0 }));

          if (outcome === 'success') {
            finish(result());
          } else {
            fail(new Error('network'));
          }
        });

        for (const setter of setters) {
          expect(setter).not.toHaveBeenCalled();
        }

        expect(toast.error).not.toHaveBeenCalled();
        expect(screen.getByText(/상자 확정 35\/35/)).toBeTruthy();
        expect(mockRun).toHaveBeenCalledTimes(2);
      } finally {
        stateSpy.mockRestore();
      }
    }
  );

  it('조회 실패면 이전 데이터로 쓰지 않고 오류와 다시 불러오기를 보여 준다', async () => {
    mockError = true;
    render(<OutboundPreparationTemplate />);

    expect(
      screen.getByText('출고 준비 내역을 불러오지 못했어요.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '출고 준비' })).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: '다시 불러오기' })
    );
    expect(mockRefetch).toHaveBeenCalled();
  });
  it('요약이 다시 조회돼도 실패 주문번호와 다른 실패를 유지한다', async () => {
    mockRun.mockResolvedValueOnce(
      result({
        planned: 34,
        waybilled: 33,
        joined: 33,
        failures: [
          {
            shipmentId: 'ready-1',
            stage: 'plan',
            message: '계획 실패',
            retryable: true,
          },
          {
            shipmentId: 'ready-2',
            stage: 'waybill',
            message: '송장 실패',
            retryable: true,
          },
        ],
      })
    );
    mockRun.mockResolvedValueOnce(
      result({ planned: 1, waybilled: 1, joined: 1, total: 1, batchName: null })
    );
    const { rerender } = render(<OutboundPreparationTemplate />);
    await start();

    mockSummary = { ...mockSummary, buckets: [] };
    rerender(<OutboundPreparationTemplate />);
    await userEvent.click(
      screen.getAllByRole('button', { name: '다시 시도' })[0]
    );

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: '다시 시도' })).toHaveLength(
        1
      )
    );
    expect(screen.getByText('#AY-ready-2')).toBeTruthy();
    expect(screen.getByText('송장 실패')).toBeTruthy();
    expect(screen.getByText(/상자 확정 35\/35/)).toBeTruthy();
    expect(screen.getByText(/송장 발급 34\/35/)).toBeTruthy();
    expect(screen.getByText(/출고 배치에 담기 34\/35/)).toBeTruthy();
  });

  it('모든 분류가 0건이면 기능 버튼을 끈다', () => {
    mockSummary = { ...mockSummary, awaitingMatchingCount: 0, buckets: [] };
    render(<OutboundPreparationTemplate />);

    expect(screen.getAllByRole('table')[0].querySelectorAll('a')).toHaveLength(
      0
    );

    for (const button of within(screen.getAllByRole('table')[0]).getAllByRole(
      'button'
    )) {
      expect(button.hasAttribute('disabled')).toBe(true);
    }
  });

  it('확인 창이 열린 뒤 권한을 잃으면 시작을 숨긴다', async () => {
    const { rerender } = render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('완전출고').getByRole('button', { name: '출고 준비' })
    );
    mockAllowed = false;
    rerender(<OutboundPreparationTemplate />);

    expect(screen.queryByRole('button', { name: '시작' })).toBeNull();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('분할 통신 실패는 같은 멱등 키로 자동 재시도한다', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    try {
      mockSplit.mockRejectedValueOnce(new Error('network'));
      render(<OutboundPreparationTemplate />);
      await user.click(
        screen.getByRole('button', { name: '있는 것만 먼저 보내기' })
      );
      await user.click(screen.getByRole('button', { name: '나누기' }));
      await act(() => jest.advanceTimersByTimeAsync(2000));

      await waitFor(() =>
        expect(
          screen.getByRole('dialog', { name: '1건을 나눴어요' })
        ).toBeTruthy()
      );
      expect(mockSplit).toHaveBeenCalledTimes(2);
      expect(mockSplit.mock.calls[1][0]).toEqual(mockSplit.mock.calls[0][0]);
      expect(mockKeyCounter).toBe(1);
      expect(toast.error).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('송장 실패 상자가 재시도 중 계획 단계에서 실패해도 완료 건수를 중복 합산하지 않는다', async () => {
    mockRun.mockResolvedValueOnce(
      result({
        waybilled: 34,
        joined: 34,
        failures: [
          {
            shipmentId: 'ready-1',
            stage: 'waybill',
            message: '송장 실패',
            retryable: true,
          },
        ],
      })
    );
    mockRun.mockResolvedValueOnce(
      result({
        planned: 0,
        waybilled: 0,
        joined: 0,
        total: 1,
        batchName: null,
        failures: [
          {
            shipmentId: 'ready-1',
            stage: 'plan',
            message: '계획 재확인 실패',
            retryable: true,
          },
        ],
      })
    );
    mockRun.mockResolvedValueOnce(
      result({ planned: 1, waybilled: 1, joined: 1, total: 1, batchName: null })
    );
    render(<OutboundPreparationTemplate />);
    await start();
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByText('계획 재확인 실패');
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(3));
    expect(screen.getByText(/상자 확정 35\/35/)).toBeTruthy();
    expect(screen.getByText(/송장 발급 35\/35/)).toBeTruthy();
  });

  it('분할 요청이 확정 거절되면 같은 선택에도 새 멱등 키를 쓴다', async () => {
    mockSplit.mockRejectedValueOnce({ response: { status: 409 } });
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      screen.getByRole('button', { name: '있는 것만 먼저 보내기' })
    );
    await userEvent.click(screen.getByRole('button', { name: '나누기' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('상자를 나누지 못했어요.')
    );
    await userEvent.click(
      screen.getByRole('button', { name: '있는 것만 먼저 보내기' })
    );
    await userEvent.click(screen.getByRole('button', { name: '나누기' }));

    expect(mockSplit.mock.calls[1][0].idempotencyKey).not.toBe(
      mockSplit.mock.calls[0][0].idempotencyKey
    );
  });
});

describe('합포장 결과에서 넘어온 상자', () => {
  it('넘어온 상자 하나만 담은 확인 창을 열고 주소에서 상자를 지운다', async () => {
    mockParams = new URLSearchParams({ warehouseId: 'w1', prepare: 'ready-5' });
    render(<OutboundPreparationTemplate />);

    expect(
      await screen.findByText('완전출고 1건을 출고 준비할까요?')
    ).toBeTruthy();
    expect(mockReplace).toHaveBeenCalledWith(
      '/order/waybill-issue?warehouseId=w1'
    );

    await userEvent.click(screen.getByRole('button', { name: '시작' }));

    expect(mockRun.mock.calls[0][0].shipmentIds).toEqual(['ready-5']);
  });

  it('창고 목록보다 요약이 먼저 와도 창고를 읽은 뒤 확인 창을 연다', async () => {
    mockWarehousesLoaded = false;
    mockParams = new URLSearchParams({ warehouseId: 'w1', prepare: 'ready-5' });
    const { rerender } = render(<OutboundPreparationTemplate />);

    expect(screen.queryByText(/피킹 방식을 확인한 뒤/)).toBeNull();
    expect(screen.queryByText(/출고 준비할까요/)).toBeNull();
    // 처리하기 전에는 주소의 상자를 지우지 않는다(새로고침하면 다시 찾는다)
    expect(mockReplace).not.toHaveBeenCalled();

    mockWarehousesLoaded = true;
    rerender(<OutboundPreparationTemplate />);

    expect(
      await screen.findByText('완전출고 1건을 출고 준비할까요?')
    ).toBeTruthy();
    expect(screen.queryByText(/피킹 방식을 확인한 뒤/)).toBeNull();
  });

  it('바로 준비할 수 없는 분류면 그 내역에서 상자만 골라 두고 이유를 알린다', async () => {
    mockParams = new URLSearchParams({ prepare: 'partial-2' });
    render(<OutboundPreparationTemplate />);

    expect(
      await screen.findByText(
        '이 상자는 «부분출고» 내역에 있어 바로 출고 준비할 수 없어요. 내역에서 이 상자만 골라 두었어요.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/출고 준비할까요/)).toBeNull();
    expect(
      screen.getByLabelText('#AY-partial-2 선택').getAttribute('aria-checked')
    ).toBe('true');
    expect(checkedRows()).toHaveLength(1);
  });

  it('목록에 없는 상자면 찾지 못했다고 알리고 아무것도 열지 않는다', async () => {
    mockParams = new URLSearchParams({ prepare: 'gone' });
    render(<OutboundPreparationTemplate />);

    expect(
      await screen.findByText(/출고 준비 목록에서 이 상자를 찾지 못했어요/)
    ).toBeTruthy();
    expect(screen.queryByText(/출고 준비할까요/)).toBeNull();
  });

  it('이 화면에서 합친 상자도 시트를 닫고 그 상자만 준비한다', async () => {
    render(<OutboundPreparationTemplate />);
    await userEvent.click(
      row('합칠 주문 있음').getByRole('button', { name: '내역보기' })
    );
    await userEvent.click(screen.getAllByRole('button', { name: '합치기' })[0]);
    await userEvent.click(
      screen.getByRole('button', { name: '이 상자 출고 준비' })
    );

    expect(screen.queryByRole('dialog', { name: '합포장' })).toBeNull();
    expect(
      await screen.findByText('완전출고 1건을 출고 준비할까요?')
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '시작' }));

    expect(mockRun.mock.calls[0][0].shipmentIds).toEqual(['ready-2']);
  });
});

describe('현장에 넘길 배치', () => {
  const handoff = () =>
    screen.findByRole('region', { name: '현장에 넘길 배치' });
  const joinFailure = () =>
    result({
      joined: 34,
      failures: [
        {
          shipmentId: 'ready-1',
          stage: 'join',
          message: '응답이 없어요',
          retryable: true,
        },
      ],
    });
  const deferred = () => {
    let resolve: (value: MockBatch) => void = () => undefined;
    const promise = new Promise<MockBatch>((done) => {
      resolve = done;
    });

    return { promise, resolve };
  };

  it('완료 창에 배치 이름·물류앱 코드와 현장 순서를 보여 준다', async () => {
    render(<OutboundPreparationTemplate />);
    await start();

    const batch = await handoff();
    await waitFor(() =>
      expect(
        within(batch).getByText('물류앱 코드').nextElementSibling?.textContent
      ).toBe('OB-1A2B3C4D5E6F')
    );
    expect(within(batch).getByText('11/05 토탈피킹 #1')).toBeTruthy();
    expect(within(batch).getByText('35상자')).toBeTruthy();
    expect(steps(batch)).toEqual([
      '물류앱 F2 «배치 현황»에서 OB-1A2B3C4D5E6F 를 고르세요.',
      '«작업 시작»을 누르세요.',
      '«송장 인쇄»로 송장을 뽑아 상자에 붙이세요.',
      'F1 «출고 검수»에서 송장을 스캔하고 상품을 검수하세요.',
    ]);
    expect(mockLoadBatch).toHaveBeenCalledTimes(1);
    expect(mockLoadBatch).toHaveBeenCalledWith('batch-1');
  });

  it('준비하지 못한 상자는 배치에 담기지 않았다고 따로 알린다', async () => {
    mockLoadBatch.mockResolvedValue(
      batchData(
        {},
        Array.from({ length: 34 }, (_, index) => `ready-${index + 2}`)
      )
    );
    mockRun.mockResolvedValueOnce(
      result({
        waybilled: 34,
        joined: 34,
        failures: [
          {
            shipmentId: 'ready-1',
            stage: 'waybill',
            message: '한진 주소 확인 불가',
            retryable: true,
          },
        ],
      })
    );
    render(<OutboundPreparationTemplate />);
    await start();

    expect(await within(await handoff()).findByText('34상자')).toBeTruthy();
    expect(
      await screen.findByText(
        '1상자는 준비하지 못했어요. 이 배치에 담기지 않았으니 현장에 넘기지 마세요.'
      )
    ).toBeTruthy();
  });

  it('응답을 못 받았지만 배치에 들어간 상자는 넘기지 말라고 하지 않는다', async () => {
    mockLoadBatch.mockResolvedValue(batchData());
    mockRun.mockResolvedValueOnce(joinFailure());
    render(<OutboundPreparationTemplate />);
    await start();

    expect(
      await screen.findByText('응답을 받지 못한 1상자도 배치에 들어가 있어요.')
    ).toBeTruthy();
    expect(within(await handoff()).getByText('35상자')).toBeTruthy();
    expect(
      screen.getByText('응답은 받지 못했지만 이 상자는 배치에 들어가 있어요.')
    ).toBeTruthy();
    expect(screen.getByText('35상자 출고 준비를 마쳤어요')).toBeTruthy();
    expect(screen.queryByText(/현장에 넘기지 마세요/)).toBeNull();
  });

  it('담기 응답을 모두 잃어도 배치에서 확인한 상자로 제목과 수량을 맞춘다', async () => {
    mockLoadBatch.mockResolvedValue(batchData());
    mockRun.mockResolvedValueOnce(
      result({
        joined: 0,
        failures: Array.from({ length: 35 }, (_, index) => ({
          shipmentId: `ready-${index + 1}`,
          stage: 'join' as const,
          message: '응답이 없어요',
          retryable: true,
        })),
      })
    );
    render(<OutboundPreparationTemplate />);
    await start();

    expect(await screen.findByText('35상자 출고 준비를 마쳤어요')).toBeTruthy();
    expect(screen.getByText(/출고 배치에 담기 35\/35/)).toBeTruthy();
    expect(steps(await handoff())).toHaveLength(4);
    expect(screen.queryByText('출고 배치에 담은 상자가 없어요.')).toBeNull();
  });

  it('배치를 확인하기 전에는 담기 실패를 단정하지 않고 순서도 보이지 않는다', async () => {
    mockLoadBatch.mockReturnValue(new Promise(() => undefined));
    mockRun.mockResolvedValueOnce(joinFailure());
    render(<OutboundPreparationTemplate />);
    await start();

    const batch = await handoff();
    expect(within(batch).getByText('불러오는 중…')).toBeTruthy();
    expect(steps(batch)).toEqual([]);
    expect(
      screen.getByText(
        '1상자는 준비하지 못했어요. 배치에 담겼는지는 «출고 배치 열기»에서 확인해 주세요.'
      )
    ).toBeTruthy();
  });

  it('다시 시도 전에 시작한 배치 확인 응답이 늦게 와도 버린다', async () => {
    const first = deferred();
    const second = deferred();
    mockLoadBatch
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    mockRun.mockResolvedValueOnce(joinFailure());
    mockRun.mockResolvedValueOnce(
      result({ planned: 1, waybilled: 1, joined: 1, total: 1, batchName: null })
    );
    render(<OutboundPreparationTemplate />);
    await start();

    await userEvent.click(
      await screen.findByRole('button', { name: '다시 시도' })
    );
    await waitFor(() => expect(mockLoadBatch).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve(
        batchData({ status: 'picking', startedAt: '2026-11-05T01:00:00.000Z' })
      );
    });
    await act(async () => {
      first.resolve(batchData());
    });

    expect(steps(await handoff())[1]).toBe(
      '이미 작업을 시작한 배치예요. «바뀐·미출력 송장만 다시»로 새로 담은 상자의 송장을 뽑아 붙이세요.'
    );
  });

  it('배치를 못 불러오면 다시 불러오기로 다시 확인한다', async () => {
    mockLoadBatch
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(batchData());
    render(<OutboundPreparationTemplate />);
    await start();

    const batch = await handoff();
    await within(batch).findByText('불러오지 못했어요');
    expect(within(batch).getByText('11/05 토탈피킹 #1')).toBeTruthy();
    expect(steps(batch)).toEqual([]);
    await userEvent.click(
      within(batch).getByRole('button', { name: '다시 불러오기' })
    );

    await waitFor(() => expect(steps(batch)).toHaveLength(4));
    expect(mockLoadBatch).toHaveBeenCalledTimes(2);
  });

  it('담기 응답을 모두 잃고 배치 확인도 실패하면 다시 불러오기로 확인한다', async () => {
    mockLoadBatch
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(batchData());
    mockRun.mockResolvedValueOnce(
      result({
        joined: 0,
        failures: Array.from({ length: 35 }, (_, index) => ({
          shipmentId: `ready-${index + 1}`,
          stage: 'join' as const,
          message: '응답이 없어요',
          retryable: true,
        })),
      })
    );
    render(<OutboundPreparationTemplate />);
    await start();

    const batch = await handoff();
    await within(batch).findByText('불러오지 못했어요');
    expect(within(batch).getByText('확인하지 못했어요')).toBeTruthy();
    expect(steps(batch)).toEqual([]);
    await userEvent.click(
      within(batch).getByRole('button', { name: '다시 불러오기' })
    );

    await waitFor(() => expect(steps(batch)).toHaveLength(4));
    expect(within(batch).getByText('35상자')).toBeTruthy();
    expect(screen.getByText('35상자 출고 준비를 마쳤어요')).toBeTruthy();
  });

  it('다시 시도가 실패해도 배치를 다시 확인해 안내를 되살린다', async () => {
    mockRun.mockResolvedValueOnce(joinFailure());
    mockRun.mockRejectedValueOnce(new Error('offline'));
    mockLoadBatch.mockResolvedValue(batchData());
    render(<OutboundPreparationTemplate />);
    await start();

    await userEvent.click(
      await screen.findByRole('button', { name: '다시 시도' })
    );

    await waitFor(() => expect(mockLoadBatch).toHaveBeenCalledTimes(2));
    await waitFor(async () => expect(steps(await handoff())).toHaveLength(4));
  });

  it('이미 작업을 시작한 배치면 작업 시작 단계를 빼고 안내한다', async () => {
    mockLoadBatch.mockResolvedValue(
      batchData({ status: 'picking', startedAt: '2026-11-05T01:00:00.000Z' })
    );
    render(<OutboundPreparationTemplate />);
    await start();

    const batch = await handoff();
    await waitFor(() =>
      expect(steps(batch)).toEqual([
        '물류앱 F2 «배치 현황»에서 OB-1A2B3C4D5E6F 를 고르세요.',
        '이미 작업을 시작한 배치예요. «바뀐·미출력 송장만 다시»로 새로 담은 상자의 송장을 뽑아 붙이세요.',
        'F1 «출고 검수»에서 송장을 스캔하고 상품을 검수하세요.',
      ])
    );
  });

  it('출고를 마친 배치면 순서 대신 새로 준비하라고 안내한다', async () => {
    mockLoadBatch.mockResolvedValue(batchData({ status: 'completed' }));
    render(<OutboundPreparationTemplate />);
    await start();

    const batch = await handoff();
    expect(
      await within(batch).findByText(
        '이 배치는 이미 출고를 마쳤어요. 남은 상자는 출고 준비에서 새로 준비해 주세요.'
      )
    ).toBeTruthy();
    expect(steps(batch)).toEqual([]);
  });

  it('상자가 모두 빠져 취소된 배치도 취소 안내를 보여 준다', async () => {
    mockLoadBatch.mockResolvedValue(
      batchData({
        status: 'canceled',
        startedAt: '2026-11-05T01:00:00.000Z',
        workItems: Array.from({ length: 35 }, (_, index) => ({
          shipmentId: `ready-${index + 1}`,
          status: 'excluded',
        })),
      })
    );
    render(<OutboundPreparationTemplate />);
    await start();

    expect(
      await screen.findByText(
        '이 배치는 취소됐어요. 남은 상자는 출고 준비에서 새로 준비해 주세요.'
      )
    ).toBeTruthy();
    expect(steps(await handoff())).toEqual([]);
  });

  it('배치에 담은 상자가 없으면 배치를 확인하지 않고 현장 안내도 보이지 않는다', async () => {
    mockRun.mockResolvedValueOnce(
      result({
        waybilled: 0,
        joined: 0,
        batchId: null,
        batchName: null,
        failures: [
          {
            shipmentId: 'ready-1',
            stage: 'waybill',
            message: '송장 실패',
            retryable: true,
          },
        ],
      })
    );
    render(<OutboundPreparationTemplate />);
    await start();

    expect(
      await screen.findByText('출고 배치에 담은 상자가 없어요.')
    ).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: '현장에 넘길 배치' })
    ).toBeNull();
    expect(mockLoadBatch).not.toHaveBeenCalled();
  });
});
