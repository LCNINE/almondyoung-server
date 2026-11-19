/** @jest-environment jsdom */

import { randomUUID } from 'node:crypto';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import type {
  useOutboundBatchV2,
  useStartPickingV2,
} from '@/lib/services/orders';
import type {
  OutboundBatchV2,
  PickingStartResult,
} from '@/lib/types/dto/fulfillment';
import { V2PickingWorkspace } from './index';

// 외부 조회·명령만 대체하고 실제 화면 command, 재시도 hook, 오류 해석과 목록을 검증한다.
const mockRefetch = jest.fn<
  Promise<{ data: OutboundBatchV2; isError: boolean }>,
  []
>();
const mockBatchQuery = jest.fn<
  Pick<ReturnType<typeof useOutboundBatchV2>, 'data' | 'isLoading'> & {
    refetch: typeof mockRefetch;
  },
  [string]
>();
const mockStart = jest.fn<
  Promise<PickingStartResult>,
  [Parameters<ReturnType<typeof useStartPickingV2>['mutateAsync']>[0]]
>();

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ canRun: () => true }),
}));

jest.mock('@/lib/services/orders', () => {
  const inactiveMutation = () => ({ isPending: false, mutateAsync: jest.fn() });

  return {
    ...jest.requireActual('@/lib/api/server-error'),
    ...jest.requireActual('@/lib/services/orders/idempotency'),
    useOutboundBatchV2: (id: string) => mockBatchQuery(id),
    useShipmentDetail: () => ({ data: undefined }),
    useStartPickingV2: () => ({ isPending: false, mutateAsync: mockStart }),
    useAggregateBulkCartScan: inactiveMutation,
    useAggregateCartHandoff: inactiveMutation,
    useAggregateSortScan: inactiveMutation,
    useAssignTote: inactiveMutation,
    useCompletePickingV2: inactiveMutation,
    useDiscretePickingScan: inactiveMutation,
    usePickingHandoff: inactiveMutation,
    useRegisterTote: inactiveMutation,
    useReportShipmentShortPick: inactiveMutation,
    useReleaseTote: inactiveMutation,
    useToteHandoff: inactiveMutation,
    useToteScan: inactiveMutation,
  };
});

function deferred() {
  let resolve!: (value: PickingStartResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<PickingStartResult>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    }
  );

  return { promise, resolve, reject };
}

function batch(id = 'batch-1'): OutboundBatchV2 {
  return {
    id,
    batchNumber: id,
    name: id,
    warehouseId: 'warehouse-1',
    pickingMethod: 'individual',
    cartCapacity: null,
    status: 'created',
    totalItems: 0,
    totalQty: 0,
    workItems: [],
    picking: null,
    inventorySession: null,
    toteAssignments: [],
  };
}

const blockedError = {
  statusCode: 409,
  response: {
    code: 'BATCH_START_BLOCKED',
    message: 'cannot start: 1 blocker',
    errors: [
      {
        shipmentId: 'box-1',
        trackingNo: '123456789012',
        reason: 'STOCK_SHORT',
        skuId: 'sku-1',
        skuCode: 'SKU-1',
        skuName: '재고가 부족한 상품',
        requiredQty: 3,
        shortQty: 1,
      },
    ],
  },
};

const emptyBatchError = {
  statusCode: 409,
  response: { code: 'PICKING_BATCH_EMPTY', message: 'Batch is empty' },
};

function alertText(): string {
  return Array.from(document.querySelectorAll('[role="alert"]'))
    .map((element) => element.textContent ?? '')
    .join('\n');
}

describe('피킹 시작 오류 안내', () => {
  let root: Root;
  let container: HTMLDivElement;
  let request: ReturnType<typeof deferred>;

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: randomUUID,
    });
  });

  beforeEach(async () => {
    toast.getToasts().forEach((entry) => toast.dismiss(entry.id));
    jest.clearAllMocks();
    request = deferred();
    mockStart.mockImplementation(() => request.promise);
    mockRefetch.mockResolvedValue({ data: batch(), isError: false });
    mockBatchQuery.mockImplementation((id) => ({
      data: id ? batch(id) : undefined,
      isLoading: false,
      refetch: mockRefetch,
    }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root.render(createElement(V2PickingWorkspace)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    toast.getToasts().forEach((entry) => toast.dismiss(entry.id));
  });

  async function clickButton(label: RegExp) {
    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => label.test(candidate.textContent ?? '')
    );
    if (!button) throw new Error(`${label} 버튼이 없습니다.`);

    await act(async () => button.click());
  }

  async function loadBatch(id: string) {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="서버가 발급한 outbound batch ID"]'
    );
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set;
    if (!input || !setValue) throw new Error('배치 조회 입력칸이 없습니다.');

    await act(async () => {
      setValue.call(input, id);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickButton(/^조회$/);
  }

  const start = () =>
    clickButton(/^(피킹 시작|작업 시작|원래 키로 시작 재시도)$/);

  it.each([
    {
      name: '재고 부족 상세 목록',
      error: blockedError,
      summary: '시작하지 못했어요 — 아래 박스를 먼저 처리해 주세요',
      details: ['재고 부족', '재고가 부족한 상품', '3개 중 1개 부족'],
    },
  ])(
    '$name 안내는 재시도 중 유지하고 성공하면 없애며 토스트를 띄우지 않는다',
    async ({ error, summary, details }) => {
      await loadBatch('batch-1');
      await start();
      await act(async () => request.reject(error));

      expect(alertText()).toContain(summary);
      for (const detail of details) expect(alertText()).toContain(detail);
      expect(toast.getToasts()).toHaveLength(0);

      const previous = alertText();
      request = deferred();
      await start();
      expect(alertText()).toBe(previous);
      expect(toast.getToasts()).toHaveLength(0);

      await act(async () =>
        request.resolve({
          state: 'started',
          operationId: 'operation-1',
          batchId: 'batch-1',
          sessionId: 'session-1',
          status: 'picking',
        })
      );

      expect(alertText()).toBe('');
      expect(
        toast
          .getToasts()
          .filter((entry) => 'type' in entry && entry.type === 'error')
      ).toHaveLength(0);
    }
  );

  it('상세 사유가 없으면 관리자가 확인할 화면을 안내한다', async () => {
    await loadBatch('batch-1');
    await start();
    await act(async () =>
      request.reject({
        ...blockedError,
        response: { ...blockedError.response, errors: [] },
      })
    );

    expect(alertText()).toContain('배치와 해당 박스의 출고 상태를 확인해 주세요.');
    expect(alertText()).not.toContain('관리자에게 문의해 주세요.');
  });

  it('시작 차단 응답 때 배치 화면이 사라지면 상세 토스트로 알린다', async () => {
    await loadBatch('batch-1');
    await start();
    mockBatchQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: mockRefetch,
    });
    await act(async () => root.render(createElement(V2PickingWorkspace)));
    await act(async () => request.reject(blockedError));

    expect(alertText()).toBe('');
    const receivedToast = toast.getToasts()[0];
    expect(receivedToast).toEqual(expect.objectContaining({ type: 'error' }));
    if (!receivedToast || !('title' in receivedToast))
      throw new Error('오류 토스트가 없습니다.');
    const title = String(receivedToast.title);
    expect(title).toContain('차단 항목 1건');
    expect(title).toContain('박스 box-1');
    expect(title).toContain('3개 중 1개 부족');
  });

  it.each([blockedError])(
    '다른 배치를 조회하면 이전 안내를 지우고 늦은 응답으로 되살리지 않는다: %p',
    async (error) => {
      await loadBatch('batch-1');
      await start();
      await act(async () => request.reject(error));
      expect(alertText()).not.toBe('');

      request = deferred();
      await start();
      await loadBatch('batch-2');
      expect(alertText()).toBe('');
      await act(async () => request.reject(error));
      expect(alertText()).toBe('');
      expect(toast.getToasts()).toHaveLength(0);

      await loadBatch('batch-1');
      expect(alertText()).toBe('');
    }
  );
  it('재시도 결과에 따라 차단 상세 목록과 일반 오류 문구를 교체한다', async () => {
    await loadBatch('batch-1');
    await start();
    await act(async () => request.reject(blockedError));
    expect(alertText()).toContain('재고 부족');

    request = deferred();
    await start();
    await act(async () => request.reject(emptyBatchError));
    expect(alertText()).toBe('');
    expect(toast.getToasts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          title: expect.stringContaining('박스가 없어서'),
        }),
      ])
    );
    toast.getToasts().forEach((entry) => toast.dismiss(entry.id));
    expect(alertText()).not.toContain('재고 부족');
    expect(toast.getToasts()).toHaveLength(0);

    request = deferred();
    await start();
    await act(async () => request.reject(blockedError));
    expect(alertText()).toContain('재고 부족');
    expect(alertText()).not.toContain('박스가 없어서');
    expect(toast.getToasts()).toHaveLength(0);
  });
});
