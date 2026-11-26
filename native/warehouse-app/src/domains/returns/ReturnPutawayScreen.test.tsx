import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import { createTestWorkRuntime, TestWorkProvider } from '../inbound/__fixtures__/workRuntime';
import { ReturnPutawayScreen } from './ReturnPutawayScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const BIN = {
  id: 'b',
  barcode: 'RB-1',
  warehouseId: 'wh',
  items: [{ skuId: 's-1', skuCode: 'C1', skuName: '볼펜', sourceLocationId: 'l-1', locationCode: 'A-01', qty: 1 }],
};

function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: Date.now() })}>
      스캔:{code}
    </button>
  );
}

type Request = { method?: string; path: string; body?: unknown; idempotencyKey?: string };

function mount(request: (o: Request) => Promise<unknown>, runtime?: ReturnType<typeof createTestWorkRuntime>) {
  const client: ApiClient = { request: vi.fn().mockImplementation(request) };
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'wh', name: '창고' }) });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="880" />
        <ScanButton code="A-01" />
        <ScanButton code="B-02" />
        <ScanButton code="Z-99" />
        <ReturnPutawayScreen />
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screenRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <WarehouseProvider prefs={prefs}>
        <QueryClientProvider client={new QueryClient()}>
          {runtime ? (
            <TestWorkProvider runtime={runtime}>
              <ScanProvider>{children}</ScanProvider>
            </TestWorkProvider>
          ) : (
            <ApiClientProvider client={client}>
              <ScanProvider>{children}</ScanProvider>
            </ApiClientProvider>
          )}
        </QueryClientProvider>
      </WarehouseProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
  return { user: userEvent.setup() };
}

const locations = [
  { locationCode: 'A-01', qty: 1 },
  { locationCode: 'B-02', qty: 2 },
];
const required = () => new ConflictError('location required', 'RETURN_LOCATION_REQUIRED', undefined, locations);
const putawayResult = {
  returnBin: { id: BIN.id, barcode: BIN.barcode, warehouseId: BIN.warehouseId },
  putAwayQty: 1,
  items: [],
};

async function waitingItem(name: string, location: string, qty: number) {
  const list = await screen.findByRole('list', { name: '대기 상품' });
  const row = await within(list).findByText(name);

  expect(row.closest('li')).toHaveTextContent(location);
  expect(row.closest('li')).toHaveTextContent(`${qty}개`);
}

async function scanProduct(user: ReturnType<typeof userEvent.setup>) {
  await waitingItem('볼펜', 'A-01', 1);
  await user.click(screen.getByRole('button', { name: '스캔:880' }));
}

describe('ReturnPutawayScreen', () => {
  it('loads my bin on open and puts away a product without scanning a bin or location', async () => {
    const calls: Request[] = [];
    const { user } = mount(async (o) => {
      calls.push(o);
      if (o.method === 'POST') return putawayResult;
      if (o.path === '/return-bins/mine?warehouseId=wh') return BIN;
      throw new Error(`unexpected ${o.path}`);
    });
    await waitingItem('볼펜', 'A-01', 1);
    expect(screen.queryByText(/RB-/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('바구니 바코드')).not.toBeInTheDocument();
    await scanProduct(user);
    expect(await screen.findByText('선반 복귀 완료')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([
      expect.objectContaining({
        path: '/return-bins/RB-1/putaways',
        body: { warehouseId: 'wh', barcode: '880', quantity: 1 },
        idempotencyKey: expect.any(String),
      }),
    ]);
  });

  it('shows an empty list for a worker with no registered bin and does not send scans', async () => {
    const calls: Request[] = [];
    const { user } = mount(async (o) => {
      calls.push(o);
      return { ...BIN, id: null, items: [] };
    });

    await screen.findByText('되돌릴 상품이 없어요.');
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(calls).toEqual([{ path: '/return-bins/mine?warehouseId=wh' }]);
    expect(screen.queryByLabelText('복귀 상품 바코드')).not.toBeInTheDocument();
  });

  it('shows server candidates and retries with a scanned location and a new key', async () => {
    const posts: Request[] = [];
    const { user } = mount(async (o) => {
      if (o.method !== 'POST') return BIN;
      posts.push(o);
      if (posts.length === 1) throw required();
      return putawayResult;
    });

    await scanProduct(user);
    await screen.findByText('어느 선반에 놓았나요?');
    expect(screen.getByRole('region', { name: '넣을 곳' })).toHaveTextContent('A-01 · 1개');
    expect(screen.getByRole('region', { name: '넣을 곳' })).toHaveTextContent('B-02 · 2개');
    expect(await screen.findByRole('alert')).toHaveTextContent('원래 로케이션이 여러 곳이에요.');
    await user.click(screen.getByRole('button', { name: '스캔:B-02' }));
    await screen.findByText('되돌릴 상품이 없어요.');
    expect(posts[1].body).toEqual({
      warehouseId: 'wh',
      barcode: '880',
      locationCode: 'B-02',
      quantity: 1,
    });
    expect(posts[1].idempotencyKey).not.toBe(posts[0].idempotencyKey);
  });

  it('keeps waiting for a location after a mismatch', async () => {
    let posts = 0;
    const { user } = mount(async (o) => {
      if (o.method !== 'POST') return BIN;
      if (++posts === 1) throw required();
      throw new ConflictError('m', 'RETURN_LOCATION_MISMATCH', undefined, locations);
    });
    await scanProduct(user);
    await screen.findByRole('region', { name: '넣을 곳' });
    await user.click(screen.getByRole('button', { name: '스캔:Z-99' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('원래 로케이션이 아니에요.');
    expect(screen.getByText('어느 선반에 놓았나요?')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '넣을 곳' })).toHaveTextContent('A-01 · 1개');
  });

  it.each([
    ['PICKING_SESSION_NOT_ACTIVE', '복구가 끝날 때까지 바구니에 두고 관리자에게 문의해 주세요'],
    ['RETURN_BIN_ITEM_NOT_FOUND', '이 바구니에 없는 상품이에요.'],
    ['RETURN_BIN_ITEM_SHORT', '바구니에 남은 수량보다 많아요.'],
  ])('reloads contents after %s and returns to product scanning', async (code, message) => {
    let gets = 0;
    const { user } = mount(async (o) => {
      if (o.method === 'POST') throw new ConflictError('m', code);
      gets += 1;
      return BIN;
    });

    await scanProduct(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByText('선반에 놓고 상품을 스캔하세요')).toBeInTheDocument();
    expect(gets).toBe(2);
  });

  it('다른 상품을 누르면 상품 단계로 돌아간다', async () => {
    const { user } = mount(async (o) => {
      if (o.method === 'POST') throw required();
      return BIN;
    });
    await scanProduct(user);
    await user.click(await screen.findByRole('button', { name: '다른 상품' }));
    expect(await screen.findByText('선반에 놓고 상품을 스캔하세요')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '넣을 곳' })).not.toBeInTheDocument();
  });

  it('retries loading my bin when the initial read fails', async () => {
    let attempts = 0;
    const { user } = mount(async () => {
      if (++attempts === 1) throw new Error('network');
      return BIN;
    });

    await user.click(await screen.findByRole('button', { name: '다시 불러오기' }));
    await waitingItem('볼펜', 'A-01', 1);
    expect(attempts).toBe(2);
  });

  it('재시작 뒤 복원된 적치는 저장된 키로 다시 보내고 남은 상품을 보인다', async () => {
    const posts: Request[] = [];
    const api = async (o: Request): Promise<unknown> => {
      if (o.method === 'POST') {
        posts.push(o);
        return {
          ...putawayResult,
          items: [{ skuId: 's-2', skuCode: 'C2', skuName: '노트', sourceLocationId: 'l-2', locationCode: 'B-02', qty: 2 }],
        };
      }
      return BIN;
    };
    const runtime = createTestWorkRuntime({ request: vi.fn().mockImplementation(api) });
    await runtime.store.draft('fixture:scan:return-putaway', () => [
      { id: 'k-1', data: { binBarcode: 'RB-1', warehouseId: 'wh', productBarcode: '880', locationCode: 'A-01' } },
    ]);
    mount(api, runtime);
    await waitingItem('노트', 'B-02', 2);
    expect(posts).toHaveLength(1);
    expect(posts[0].idempotencyKey).toBe('k-1');
    expect(posts[0].body).toEqual({ warehouseId: 'wh', barcode: '880', locationCode: 'A-01', quantity: 1 });
    await waitFor(async () => expect(await runtime.store.draft('fixture:scan:return-putaway')).toEqual([]));
  });

  it('blocks new scans after an uncertain failure and retries with the same key', async () => {
    const posts: Request[] = [];
    const { user } = mount(async (o) => {
      if (o.method !== 'POST') return BIN;
      posts.push(o);
      if (posts.length === 1) throw new Error('network');
      return putawayResult;
    });
    await scanProduct(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('처리 내역 확인');
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(posts).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '처리 내역 확인' }));
    await screen.findByText('선반 복귀 완료');
    expect(posts).toHaveLength(2);
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
    expect(posts[1].body).toEqual(posts[0].body);
  });

  it('처리한 상품은 대기 목록에서 빠지고 완료 카드에 쌓인다', async () => {
    const { user } = mount(async (o) => {
      if (o.method === 'POST') return putawayResult;
      return BIN;
    });
    await scanProduct(user);
    const done = await screen.findByRole('region', { name: '선반 복귀 완료' });
    const row = within(done).getByRole('listitem');
    expect(row).toHaveTextContent('볼펜');
    expect(row).toHaveTextContent('1개');
    expect(row).toHaveTextContent('A-01');
    expect(within(done).getByText('복귀 대기 0개')).toBeInTheDocument();
    expect(within(done).getByRole('link', { name: '작업 목록으로 돌아가기' })).toHaveAttribute('href', '/putaway');
    expect(screen.queryByRole('list', { name: '대기 상품' })).not.toBeInTheDocument();
  });

  it('다른 기기가 줄인 수량은 완료 내역에 들어가지 않는다', async () => {
    const two = {
      ...BIN,
      items: [
        ...BIN.items,
        { skuId: 's-2', skuCode: 'C2', skuName: '노트', sourceLocationId: 'l-2', locationCode: 'B-02', qty: 2 },
      ],
    };
    const { user } = mount(async (o) => {
      if (o.method !== 'POST') return two;
      return { ...putawayResult, items: [] };
    });
    await scanProduct(user);
    const done = await screen.findByRole('region', { name: '선반 복귀 완료' });
    expect(within(done).getAllByRole('listitem')).toHaveLength(1);
    expect(done).toHaveTextContent('볼펜');
    expect(done).not.toHaveTextContent('노트');
  });

  it('복귀 위치가 여러 곳이면 위치를 스캔하기 전에는 대기 수량이 줄지 않고 완료 내역도 비어 있다', async () => {
    let posts = 0;
    const { user } = mount(async (o) => {
      if (o.method !== 'POST') return BIN;
      if (++posts === 1) throw required();
      return putawayResult;
    });
    await scanProduct(user);
    await screen.findByRole('region', { name: '넣을 곳' });
    expect(screen.getByText('1건 · 1개')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '완료 내역' })).not.toBeInTheDocument();
    expect(screen.getByText(/위치 바코드를 스캔하세요/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '스캔:A-01' }));
    expect(await screen.findByRole('region', { name: '선반 복귀 완료' })).toBeInTheDocument();
    expect(posts).toBe(2);
  });

  it('스캔 입력에는 확인 버튼이 없다', async () => {
    mount(async () => BIN);
    await waitingItem('볼펜', 'A-01', 1);
    expect(screen.getByLabelText('복귀 상품 바코드')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '입력' })).not.toBeInTheDocument();
  });
});
