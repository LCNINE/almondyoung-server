import 'fake-indexeddb/auto';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { OperationContext } from '../../core/operations/OperationContext';
import { createOperationRunner } from '../../core/operations/operationRunner';
import { createOperationStore } from '../../core/operations/operationStore';
import { PutawaySheet } from './PutawaySheet';
import type { ReceiptLineState } from './receiptState';

const state: ReceiptLineState = {
  lineId: 'line-1',
  receiptId: 'receipt-1',
  warehouseId: 'w-1',
  source: 'direct',
  receiptStatus: 'posted',
  skuId: 'sku-1',
  skuCode: 'SKU-1',
  skuName: '셔츠',
  originLocationId: 'origin-1',
  originLocationCode: '입고존',
  quantity: 10,
  pendingQty: 10,
  putawayFromOriginQty: 0,
  canceledQty: 0,
  returnedQty: 0,
  canPutaway: true,
  putawayBlockReason: null,
  canCancel: true,
  cancelBlockReason: null,
};
function fixture(capability = true) {
  let current = { ...state };
  const posts: unknown[] = [];
  let nextRead: Promise<ReceiptLineState> | undefined;
  const api: ApiClient = {
    request: async (r) => {
      if (r.path.startsWith('/inbound/lines/')) {
        const read = nextRead;
        nextRead = undefined;
        return (read ? await read : current) as never;
      }
      if (r.path.startsWith('/locations/warehouses/'))
        return {
          items: [{ id: 'dest-1', code: 'A-01', displayName: 'A-01' }],
          total: 1,
        } as never;
      if (r.path === '/inbound/cancel') {
        current = {
          ...current,
          canPutaway: false,
          putawayBlockReason: 'CANCELED',
          canCancel: false,
          cancelBlockReason: 'CANCELED',
          canceledQty: 10,
          pendingQty: 0,
          receiptStatus: 'voided',
        };
        return { success: true } as never;
      }
      if (r.path === '/inbound/putaway') {
        posts.push(r);
        const qty = (r.body as { quantity: number }).quantity;
        current = {
          ...current,
          pendingQty: current.pendingQty - qty,
          putawayFromOriginQty: current.putawayFromOriginQty + qty,
          canCancel: false,
          cancelBlockReason: 'ALREADY_PUTAWAY',
        };
        return { success: true } as never;
      }
      throw new Error(r.path);
    },
  };
  const store = createOperationStore(crypto.randomUUID());
  const runner = createOperationRunner({
    api,
    store,
    getScope: async () => 'scope',
    wait: async () => {},
  });
  const runtime = {
    runner,
    store,
    getScope: async () => 'scope',
    getCapabilities: async () => ({ inboundWorkflowConsistency: capability }),
  };
  const session = {
    bootstrap: async () => {},
    isAuthenticated: () => true,
    getAccessToken: async () => 'token',
    login: async () => {},
    logout: async () => {},
    subscribe: () => () => {},
  };
  const onDone = vi.fn();
  const view = render(
    <SessionProvider session={session}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ApiClientProvider client={runner}>
          <OperationContext.Provider value={runtime}>
            <ScanProvider>
              <PutawaySheet
                target={{
                  ...state,
                  originLocationId: 'origin-1',
                  originLocationCode: '입고존',
                }}
                warehouseId="w-1"
                lastDest={{ id: 'dest-1', code: 'A-01' }}
                onDone={onDone}
                onCancel={() => {}}
              />
            </ScanProvider>
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return {
    ...view,
    posts,
    store,
    runner,
    onDone,
    change: (patch: Partial<ReceiptLineState>) => {
      current = { ...current, ...patch };
    },
    delayRead: (promise: Promise<ReceiptLineState>) => {
      nextRead = promise;
    },
  };
}
it('다른 기기의 부분 적치는 입력을 보존하고 최신 잔량을 다시 확인한 후에만 전송한다', async () => {
  const f = fixture();
  await userEvent.click(
    screen.getByRole('button', { name: '직전 대상지 A-01 사용' })
  );
  const input = screen.getByLabelText('적치 수량 직접 입력 (낱개)');
  fireEvent.change(input, { target: { value: '4' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '적치' })).toBeEnabled()
  );
  f.change({
    pendingQty: 6,
    putawayFromOriginQty: 4,
    canCancel: false,
    cancelBlockReason: 'ALREADY_PUTAWAY',
  });
  await userEvent.click(screen.getByRole('button', { name: '적치' }));
  expect(await screen.findByText(/잔량이 바뀌었어요/)).toBeInTheDocument();
  expect(input).toHaveValue('4');
  expect(f.posts).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: '적치' }));
  await waitFor(() =>
    expect(f.onDone).toHaveBeenCalledWith({ id: 'dest-1', code: 'A-01' }, 4)
  );
  expect(f.posts).toHaveLength(1);
});
it('구형 서버는 목적지와 수량을 입력해도 새 적치를 전송하지 않는다', async () => {
  const f = fixture(false);
  expect(
    await screen.findByText(
      '앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.'
    )
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: '직전 대상지 A-01 사용' })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled()
  );
  expect(f.posts).toHaveLength(0);
});
it('키보드 Enter 중복은 자동 적치를 보내지 않는다', async () => {
  const f = fixture();
  await userEvent.click(
    screen.getByRole('button', { name: '직전 대상지 A-01 사용' })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '적치' })).toBeEnabled()
  );
  screen.getByRole('button', { name: '적치' }).focus();
  await userEvent.keyboard('{Enter}{Enter}');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(f.posts).toHaveLength(0);
});

it('제출 직전 지연된 조회보다 취소가 먼저 확정되면 낡은 응답으로 적치하지 않는다', async () => {
  const f = fixture();
  await userEvent.click(
    screen.getByRole('button', { name: '직전 대상지 A-01 사용' })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '적치' })).toBeEnabled()
  );
  let release!: (value: ReceiptLineState) => void;
  const delayed = new Promise<ReceiptLineState>((resolve) => {
    release = resolve;
  });
  f.delayRead(delayed);
  await userEvent.click(screen.getByRole('button', { name: '적치' }));
  await act(async () => {
    await f.runner.request({
      method: 'POST',
      path: '/inbound/cancel',
      body: { lineId: 'line-1', quantity: 10 },
      idempotencyKey: 'other-screen-cancel',
    });
  });
  await act(async () => {
    release(state);
    await delayed;
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled()
  );
  expect(f.posts).toHaveLength(0);
  expect(screen.getByLabelText('적치 수량 직접 입력 (낱개)')).toHaveValue('10');
});
it('상태 조회 404도 취소나 완료로 추정하지 않고 입력을 보존한다', async () => {
  const f = fixture();
  await userEvent.click(
    screen.getByRole('button', { name: '직전 대상지 A-01 사용' })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '적치' })).toBeEnabled()
  );
  let reject!: (reason: Error) => void;
  f.delayRead(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  await userEvent.click(screen.getByRole('button', { name: '적치' }));
  await act(async () => {
    reject(new ApiError('not found', 404));
  });
  expect(f.posts).toHaveLength(0);
  expect(screen.getByLabelText('적치 수량 직접 입력 (낱개)')).toHaveValue('10');
});

it('중복 클릭은 진행 중인 현재 상태 조회를 공유하며 한 번만 적치한다', async () => {
  const f = fixture();
  await userEvent.click(
    screen.getByRole('button', { name: '직전 대상지 A-01 사용' })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '적치' })).toBeEnabled()
  );
  let release!: (value: ReceiptLineState) => void;
  f.delayRead(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const button = screen.getByRole('button', { name: '적치' });
  fireEvent.click(button);
  fireEvent.click(button);
  await act(async () => {
    release(state);
  });
  await waitFor(() => expect(f.onDone).toHaveBeenCalledTimes(1));
  expect(f.posts).toHaveLength(1);
});
