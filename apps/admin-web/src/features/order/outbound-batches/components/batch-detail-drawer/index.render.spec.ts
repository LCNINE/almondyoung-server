/** @jest-environment jsdom */

import { randomUUID } from 'node:crypto';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import type {
  useAddShipmentToBatch,
  useOutboundBatchEligibleShipments,
  useOutboundBatchV2,
} from '@/lib/services/orders';
import type {
  EligibleShipmentV2,
  OutboundBatchCommandResponse,
  OutboundBatchV2,
  OutboundBatchWorkItemV2,
} from '@/lib/types/dto/fulfillment';
import { BatchDetailDrawer } from './index';

// 외부 조회 hook은 화면이 소비하는 필드만 제공한다. 화면의 command와 재시도 hook은 실제 구현을 쓴다.
const mockRefetch = jest.fn<
  Promise<{ data: OutboundBatchV2 | undefined; isError: boolean }>,
  []
>();
const mockBatchQuery = jest.fn<
  Pick<ReturnType<typeof useOutboundBatchV2>, 'data' | 'isLoading'> & {
    refetch: typeof mockRefetch;
  },
  [string]
>();
const mockEligibleQuery = jest.fn<
  Pick<ReturnType<typeof useOutboundBatchEligibleShipments>, 'data'>,
  [string]
>();
const mockAddShipment = jest.fn<
  Promise<OutboundBatchCommandResponse>,
  [Parameters<ReturnType<typeof useAddShipmentToBatch>['mutateAsync']>[0]]
>();

const mockClaimPicker = jest.fn();
const mockExcludeShipment = jest.fn();

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ canRun: () => true }),
}));

jest.mock('@/features/order/fulfillments/detail/operation-operator', () => ({
  useOperatorNames: () => () => '',
}));

jest.mock('@/lib/services/orders', () => ({
  ...jest.requireActual('@/lib/api/server-error'),
  ...jest.requireActual('@/lib/services/orders/idempotency'),
  useAddShipmentToBatch: () => ({ mutateAsync: mockAddShipment }),
  useOutboundBatchEligibleShipments: (id: string) => mockEligibleQuery(id),
  useOutboundBatchV2: (id: string) => mockBatchQuery(id),
  useFollowBatchScanRejections: () => undefined,
  useExcludeShipmentFromBatch: () => ({ mutateAsync: mockExcludeShipment }),
  useClaimBatchPacker: () => ({ mutateAsync: jest.fn() }),
  useClaimBatchPicker: () => ({ mutateAsync: mockClaimPicker }),
  useHandoffBatchWorkItem: () => ({ mutateAsync: jest.fn() }),
  usePickingHandoff: () => ({ mutateAsync: jest.fn() }),
}));

function deferred() {
  let resolve!: (value: OutboundBatchCommandResponse) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<OutboundBatchCommandResponse>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    }
  );

  return { promise, resolve, reject };
}

function noticeTexts(role: 'alert' | 'status'): string[] {
  return Array.from(document.querySelectorAll(`[role="${role}"]`)).map(
    (element) => element.textContent ?? ''
  );
}

function workItem(shipmentId: string): OutboundBatchWorkItemV2 {
  const claim = {
    state: 'unclaimed' as const,
    workerId: null,
    claimedAt: null,
    releasedAt: null,
    leaseExpiresAt: null,
  };

  return {
    id: `work-${shipmentId}`,
    batchId: 'batch-1',
    shipmentId,
    status: 'queued',
    leaseVersion: 1,
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
    pickerClaim: claim,
    packerClaim: claim,
  };
}

function batch(id = 'batch-1'): OutboundBatchV2 {
  return {
    id,
    batchNumber: id,
    name: id,
    warehouseId: 'warehouse-1',
    pickingMethod: 'individual',
    cartCapacity: null,
    status: 'picking',
    totalItems: 0,
    totalQty: 0,
    startedAt: '2026-11-16T00:00:00Z',
    workItems: [],
    picking: null,
    inventorySession: {
      id: `session-${id}`,
      status: 'active',
      recoveryReason: null,
      version: 1,
      handedInQty: 0,
      settledQty: 0,
      returnedQty: 0,
      shortageQty: 0,
      balances: [],
    },
    toteAssignments: [],
  };
}

const eligible: EligibleShipmentV2[] = ['box-A', 'box-B'].map((shipmentId) => ({
  shipmentId,
  warehouseId: 'warehouse-1',
  shippingProfileId: 'profile-1',
  manifestVersion: 1,
  reservationVersion: 1,
  recipientHash: 'recipient',
  totalItems: 1,
  totalQty: 1,
  waybillId: `waybill-${shipmentId}`,
  trackingNo: `tracking-${shipmentId}`,
  displayOrderNo: shipmentId,
  itemSummary: '상품 1개',
}));

describe('배치 상세에 남는 상자 추가 결과', () => {
  let root: Root;
  let container: HTMLDivElement;
  let unmounted: boolean;
  let first: ReturnType<typeof deferred>;
  let second: ReturnType<typeof deferred>;

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: randomUUID,
    });
  });

  beforeEach(() => {
    toast.getToasts().forEach((entry) => toast.dismiss(entry.id));
    jest.clearAllMocks();
    first = deferred();
    second = deferred();
    unmounted = false;
    mockRefetch.mockResolvedValue({
      data: { ...batch(), workItems: [workItem('box-A'), workItem('box-B')] },
      isError: false,
    });
    mockBatchQuery.mockImplementation((id) => ({
      data: batch(id),
      isLoading: false,
      refetch: mockRefetch,
    }));
    mockEligibleQuery.mockReturnValue({
      data: eligible,
    });
    mockAddShipment.mockImplementation(({ shipmentId }) =>
      shipmentId === 'box-A' ? first.promise : second.promise
    );

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (!unmounted) await act(async () => root.unmount());
    container.remove();
    toast.getToasts().forEach((entry) => toast.dismiss(entry.id));
  });

  async function render(batchId = 'batch-1', open = true) {
    await act(async () => {
      root.render(
        createElement(BatchDetailDrawer, {
          batchId,
          open,
          onOpenChange: () => undefined,
        })
      );
    });
  }

  function addButton(shipmentId: string) {
    const row = Array.from(document.querySelectorAll('tr')).find((candidate) =>
      candidate.textContent?.includes(`#${shipmentId}`)
    );
    const button = row?.querySelector('button');
    if (!button) throw new Error(`${shipmentId}의 추가 버튼이 없습니다.`);

    return button;
  }

  async function add(shipmentId: string) {
    await act(async () => addButton(shipmentId).click());
  }

  const blocked = {
    statusCode: 409,
    response: {
      code: 'BATCH_JOIN_BLOCKED',
      message: 'Shipment box-A cannot join the running batch: 1 blocker(s)',
      errors: [
        {
          shipmentId: 'box-A',
          orderNos: ['ORDER-JOIN'],
          reason: 'STOCK_SHORT',
          shipmentLineId: 'line-A',
          skuId: 'sku-A',
          trackingNo: '123456789012',
          skuCode: 'SKU-A',
          skuName: '상품 A',
          requiredQty: 3,
          shortQty: 1,
          detail: null,
        },
      ],
    },
  };

  it.each(['success', 'blocked'] as const)(
    '추가 %s 후 재조회까지 모든 추가 버튼을 잠그고 완료 후 다시 허용한다',
    async (outcome) => {
      let finishRefresh!: (
        value: Awaited<ReturnType<typeof mockRefetch>>
      ) => void;
      mockRefetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          })
      );

      await render();
      // React가 disabled를 반영하기 전의 연속 클릭도 요청 하나만 보내야 한다.
      await act(async () => {
        addButton('box-A').click();
        addButton('box-B').click();
      });

      expect(mockAddShipment).toHaveBeenCalledTimes(1);
      expect(addButton('box-A').disabled).toBe(true);
      expect(addButton('box-B').disabled).toBe(true);

      await act(async () => {
        if (outcome === 'success')
          first.resolve({ operationId: 'op-A', workItem: workItem('box-A') });
        else first.reject(blocked);
      });
      expect(mockRefetch).toHaveBeenCalledTimes(1);
      expect(addButton('box-B').disabled).toBe(true);
      await add('box-B');
      expect(mockAddShipment).toHaveBeenCalledTimes(1);

      await act(async () => finishRefresh({ data: batch(), isError: false }));
      expect(addButton('box-A').disabled).toBe(false);
      expect(addButton('box-B').disabled).toBe(false);
      if (outcome === 'success') {
        expect(toast.getToasts()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'success',
              title: expect.stringContaining('송장 출력'),
            }),
          ])
        );
      } else {
        expect(noticeTexts('alert').join('')).toContain(
          '상품 A 3개 중 1개 부족'
        );
      }

      await add('box-B');
      expect(mockAddShipment).toHaveBeenCalledTimes(2);
      await act(async () =>
        second.resolve({ operationId: 'op-B', workItem: workItem('box-B') })
      );
      expect(addButton('box-B').disabled).toBe(false);
    }
  );

  it.each(['close', 'switch'])(
    '%s 후 새 추가를 허용하고 이전 요청 완료로 새 잠금을 풀지 않는다',
    async (change) => {
      await render();
      await add('box-A');
      if (change === 'close') await render('batch-1', false);
      await render(change === 'switch' ? 'batch-2' : 'batch-1');
      expect(addButton('box-B').disabled).toBe(false);

      await add('box-B');
      await act(async () =>
        first.resolve({ operationId: 'op-A', workItem: workItem('box-A') })
      );
      expect(addButton('box-A').disabled).toBe(true);
      expect(toast.getToasts()).toEqual([
        expect.objectContaining({
          type: 'success',
          title: expect.stringContaining('요청 배치 batch-1:'),
        }),
      ]);

      await act(async () =>
        second.resolve({ operationId: 'op-B', workItem: workItem('box-B') })
      );
      expect(addButton('box-A').disabled).toBe(false);
    }
  );

  it.each([
    {
      name: '시작된 배치',
      initialStarted: true,
      refreshedStarted: true,
      queryFailed: false,
      expectsGuidance: true,
    },
    {
      name: '추가 후 조회에서 시작을 확인한 배치',
      initialStarted: false,
      refreshedStarted: true,
      queryFailed: false,
      expectsGuidance: true,
    },
    {
      name: '시작 전 배치',
      initialStarted: false,
      refreshedStarted: false,
      queryFailed: false,
      expectsGuidance: false,
    },
    {
      name: '재조회에 실패한 시작된 배치',
      initialStarted: true,
      refreshedStarted: false,
      queryFailed: true,
      expectsGuidance: true,
    },
  ])(
    '$name에 추가 성공 시 출력 안내 여부를 구분한다',
    async ({
      initialStarted,
      refreshedStarted,
      queryFailed,
      expectsGuidance,
    }) => {
      const initialBatch = {
        ...batch(),
        startedAt: initialStarted ? batch().startedAt : undefined,
        inventorySession: initialStarted ? batch().inventorySession : null,
      };
      mockBatchQuery.mockReturnValue({
        data: initialBatch,
        isLoading: false,
        refetch: mockRefetch,
      });
      mockRefetch.mockResolvedValue({
        data: queryFailed
          ? undefined
          : {
              ...batch(),
              startedAt: refreshedStarted ? batch().startedAt : undefined,
              inventorySession: refreshedStarted
                ? batch().inventorySession
                : null,
            },
        isError: queryFailed,
      });

      await render();
      await add('box-A');
      await act(async () =>
        first.resolve({ operationId: 'op', workItem: workItem('box-A') })
      );

      expect(toast.getToasts()).toEqual([
        expect.objectContaining({
          type: 'success',
          title: expectsGuidance
            ? '배치에 넣었어요. 송장 출력이 필요한 박스는 창고 담당자에게 프린터가 있는 창고 앱에서 송장을 출력한 뒤 피킹하도록 안내해 주세요.'
            : '명령을 접수했습니다. 서버 상태를 다시 확인합니다.',
        }),
      ]);
    }
  );

  it('시작된 배치의 피킹 맡기 성공에는 출력 안내를 붙이지 않는다', async () => {
    mockBatchQuery.mockReturnValue({
      data: { ...batch(), workItems: [workItem('box-A')] },
      isLoading: false,
      refetch: mockRefetch,
    });
    mockClaimPicker.mockResolvedValue({
      operationId: 'claim',
      workItem: workItem('box-A'),
    });

    await render();
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === '내가 피킹 맡기'
    );
    if (!button) throw new Error('피킹 맡기 버튼이 없습니다.');

    await act(async () => button.click());

    expect(toast.getToasts()).toEqual([
      expect.objectContaining({
        type: 'success',
        title: '명령을 접수했습니다. 서버 상태를 다시 확인합니다.',
      }),
    ]);
  });

  it.each(['close', 'switch'])(
    '%s 후 늦게 도착한 합류 성공도 요청한 배치를 밝혀 알린다',
    async (change) => {
      await render();
      await add('box-A');
      await render(
        change === 'switch' ? 'batch-2' : 'batch-1',
        change !== 'close'
      );
      await act(async () =>
        first.resolve({ operationId: 'op', workItem: workItem('box-A') })
      );

      expect(toast.getToasts()).toEqual([
        expect.objectContaining({
          type: 'success',
          title: expect.stringContaining('요청 배치 batch-1:'),
        }),
      ]);
      expect(noticeTexts('alert').join('')).toBe('');
    }
  );

  it('합류 차단 사유를 토스트 대신 화면에 남기고 성공하면 지운다', async () => {
    await render();
    await add('box-A');
    await act(async () => first.reject(blocked));
    expect(noticeTexts('alert').join('')).toContain('ORDER-JOIN');
    expect(
      Array.from(document.querySelectorAll('[role="alert"] a')).map((link) =>
        link.getAttribute('href')
      )
    ).toEqual([
      '/order/history?orderNo=ORDER-JOIN',
      '/order/fulfillments?shipmentId=box-A',
    ]);
    expect(noticeTexts('alert').join('')).toContain('상품 A 3개 중 1개 부족');
    expect(toast.getToasts()).toHaveLength(0);
    expect(
      toast
        .getToasts()
        .filter((entry) => 'type' in entry && entry.type === 'error')
    ).toHaveLength(0);
    first = deferred();
    await add('box-A');
    await act(async () =>
      first.resolve({ operationId: 'op', workItem: workItem('box-A') })
    );
    expect(noticeTexts('alert')).toEqual([]);
  });

  it('합류 차단 안내가 떠 있을 때 상자를 배치에서 빼면 안내를 지운다', async () => {
    mockBatchQuery.mockImplementation((id) => ({
      data: { ...batch(id), workItems: [workItem('box-B')] },
      isLoading: false,
      refetch: mockRefetch,
    }));
    mockExcludeShipment.mockResolvedValue({ operationId: 'op-exclude' });
    await render();
    await add('box-A');
    await act(async () => first.reject(blocked));
    expect(noticeTexts('alert').join('')).toContain('상품 A 3개 중 1개 부족');

    const excludeButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === '배치에서 빼기'
    );
    if (!excludeButton) throw new Error('배치에서 빼기 버튼이 없습니다.');

    await act(async () => excludeButton.click());
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === '빼기'
    );
    if (!confirmButton) throw new Error('빼기 확인 버튼이 없습니다.');

    await act(async () => confirmButton.click());

    expect(mockExcludeShipment).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'batch-1', shipmentId: 'box-B' })
    );
    expect(noticeTexts('alert')).toEqual([]);
  });

  it('합류 차단의 상세 사유가 없으면 관리자가 확인할 화면을 안내한다', async () => {
    await render();
    await add('box-A');
    await act(async () =>
      first.reject({
        ...blocked,
        response: { ...blocked.response, errors: [] },
      })
    );

    expect(noticeTexts('alert').join('')).toContain('배치와 해당 박스의 출고 상태를 확인해 주세요.');
    expect(noticeTexts('alert').join('')).toContain('서버 상세: Shipment box-A cannot join the running batch');
    expect(noticeTexts('alert').join('')).not.toContain('관리자에게 문의해 주세요.');
  });

  it.each(['close', 'switch'])(
    '%s 후 늦게 도착한 차단 응답은 이전 배치의 상세 토스트로 알린다',
    async (change) => {
      await render();
      await add('box-A');
      await render(
        change === 'switch' ? 'batch-2' : 'batch-1',
        change !== 'close'
      );
      await act(async () => first.reject(blocked));
      await render();
      expect(noticeTexts('alert')).toEqual([]);
      expect(toast.getToasts()).toEqual([
        expect.objectContaining({
          type: 'error',
          title: expect.stringContaining('요청 배치 batch-1:'),
          duration: Infinity,
          closeButton: true,
          style: expect.objectContaining({
            maxHeight: '70vh',
            overflowY: 'auto',
            whiteSpace: 'pre-line',
          }),
        }),
      ]);
      const receivedToast = toast.getToasts()[0];
      if (!('title' in receivedToast)) throw new Error('오류 토스트가 없습니다.');
      const title = String(receivedToast.title);
      expect(title).toContain('차단 항목 1건');
      expect(title).toContain('주문번호 ORDER-JOIN');
      expect(title).toContain('123456789012');
      expect(title).toContain('SKU-A');
      expect(title).toContain('3개 중 1개 부족');
      expect(title).toContain('재고가 모자라 이 배치에 넣을 수 없어요. 재고를 확인해 주세요.');
      expect(title).not.toContain(blocked.response.message);
    }
  );

  it('차단 응답 때 배치가 완료되어 패널이 숨겨져도 상세 토스트를 보인다', async () => {
    await render();
    await add('box-A');
    mockBatchQuery.mockReturnValue({
      data: { ...batch(), status: 'completed', inventorySession: null },
      isLoading: false,
      refetch: mockRefetch,
    });
    await render();
    await act(async () => first.reject(blocked));

    expect(noticeTexts('alert')).toEqual([]);
    const receivedToast = toast.getToasts()[0];
    expect(receivedToast).toEqual(expect.objectContaining({ type: 'error' }));
    if (!receivedToast || !('title' in receivedToast))
      throw new Error('오류 토스트가 없습니다.');
    const title = String(receivedToast.title);
    expect(title).toContain('요청 배치 batch-1:');
    expect(title).toContain('차단 항목 1건');
    expect(title).toContain('주문번호 ORDER-JOIN');
    expect(title).not.toContain('박스 box-A');
    expect(title).toContain('SKU-A');
  });

  it('이전 배치의 차단 재조회가 늦게 끝나도 새 배치의 차단 패널을 지우지 않는다', async () => {
    let finishRefresh!: (value: Awaited<ReturnType<typeof mockRefetch>>) => void;
    mockRefetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        })
    );

    await render();
    await add('box-A');
    await act(async () => first.reject(blocked));
    await render('batch-2');
    await add('box-B');
    await act(async () =>
      second.reject({
        ...blocked,
        response: {
          ...blocked.response,
          message: 'Shipment box-B cannot join the running batch: 1 blocker(s)',
          errors: [
            {
              ...blocked.response.errors[0],
              shipmentId: 'box-B',
              skuName: '상품 B',
            },
          ],
        },
      })
    );
    expect(noticeTexts('alert').join('')).toContain('상품 B');

    await act(async () =>
      finishRefresh({ data: batch('batch-1'), isError: false })
    );
    expect(noticeTexts('alert').join('')).toContain('상품 B');
  });

  it('차단 응답 후 재조회에서 배치가 완료되면 숨겨진 패널 대신 상세 토스트를 보인다', async () => {
    await render();
    await add('box-A');
    const completed = {
      ...batch(),
      status: 'completed' as const,
      inventorySession: null,
    };
    mockRefetch.mockImplementationOnce(async () => {
      mockBatchQuery.mockReturnValue({
        data: completed,
        isLoading: false,
        refetch: mockRefetch,
      });
      await render();
      return { data: completed, isError: false };
    });
    await act(async () => first.reject(blocked));

    expect(noticeTexts('alert')).toEqual([]);
    const receivedToast = toast.getToasts()[0];
    expect(receivedToast).toEqual(expect.objectContaining({ type: 'error' }));
    if (!receivedToast || !('title' in receivedToast))
      throw new Error('오류 토스트가 없습니다.');
    const title = String(receivedToast.title);
    expect(title).toContain('요청 배치 batch-1:');
    expect(title).toContain('차단 항목 1건');
    expect(title).toContain('주문번호 ORDER-JOIN');
    expect(title).not.toContain('박스 box-A');
  });
});
