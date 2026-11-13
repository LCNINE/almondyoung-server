import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from '../../app/routeTree';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import type { Session } from '../../core/auth/session';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { STOCK_ADJUST_PERMISSION_MESSAGE } from '../../core/data/errorMessage';
import type { ApiClient } from '../../core/data/httpClient';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { WorkBoundary } from '../../core/operations/WorkBoundary';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const WAREHOUSE_ID = 'w-1';
const BARCODE = '8809000000017';
const SKU = { id: 'sku-1', code: 'AY-PERM-001', name: '아몬드 펌제 1제 500ml', currentStock: 68, safetyStock: 0 };
const RECEIVING = { id: 'loc-recv', code: '입고기본존' };

interface AdjustCall {
  body: { skuId: string; warehouseId: string; locationId: string; delta: number; reason: string };
  idempotencyKey?: string;
}

function createCore({ stockAdjust = true, onHand = 68 } = {}) {
  const state = { onHand, adjusts: [] as AdjustCall[], seenKeys: new Set<string>() };

  const request = vi.fn(
    async (opts: { path: string; method?: string; body?: unknown; idempotencyKey?: string }) => {
      const { path } = opts;

      if (path === '/inventory/work-context') {
        return { permissions: { stockAdjust } };
      }

      if (path === '/inventory/warehouses') {
        return [{ id: WAREHOUSE_ID, name: '부천 창고' }];
      }

      if (path === `/inventory/skus?barcode=${BARCODE}`) {
        return [SKU];
      }

      if (path === `/inventory/skus/${SKU.id}`) {
        return { id: SKU.id, code: SKU.code, name: SKU.name, safetyStock: 0, barcodes: [BARCODE] };
      }

      if (path === `/inventory/stocks/sku/${SKU.id}/warehouse/${WAREHOUSE_ID}`) {
        return {
          summary: { currentQuantity: state.onHand, availableQuantity: 0, reservedQuantity: state.onHand },
          details: [
            { locationId: RECEIVING.id, locationCode: RECEIVING.code, stockState: 'ON_HAND', quantity: state.onHand },
          ],
        };
      }

      if (path.startsWith('/locations/warehouses/')) {
        return { items: [{ id: RECEIVING.id, code: RECEIVING.code, displayName: RECEIVING.code }], total: 1 };
      }

      if (path === '/inventory/stocks/adjust' && opts.method === 'POST') {
        const call: AdjustCall = { body: opts.body as AdjustCall['body'], idempotencyKey: opts.idempotencyKey };

        state.adjusts.push(call);

        if (call.idempotencyKey && !state.seenKeys.has(call.idempotencyKey)) {
          state.seenKeys.add(call.idempotencyKey);
          state.onHand += call.body.delta;
        }

        return {};
      }

      return { items: [], total: 0 };
    }
  );

  return { state, client: { request: request as ApiClient['request'] } };
}

function renderApp(client: ApiClient, path = '/inventory') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const prefs = createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: WAREHOUSE_ID, name: '부천 창고' }),
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { session },
  });

  render(
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>
              <WorkBoundary>
                <RouterProvider router={router as never} />
              </WorkBoundary>
            </ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );

  return { router };
}

function scan(code: string) {
  act(() => {
    for (const key of [...code, 'Enter']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }
  });
}

function subTab(name: string) {
  return within(screen.getByRole('navigation', { name: '하위 탭' })).getByRole('link', { name });
}

async function openManufactureTab() {
  await waitFor(() => expect(subTab('제조 완료')).toBeInTheDocument());
  await userEvent.click(subTab('제조 완료'));
  await screen.findByText('만든 상품의 바코드를 스캔하세요.');
}

describe('제조 완료 등록 여정 (스테이션)', () => {
  it('F6 제조 완료 탭에서 스캔한 상품을 입고기본존에 제조 사유로 늘리고 결과를 보여 준다', async () => {
    const core = createCore();
    const { router } = renderApp(core.client);

    await openManufactureTab();

    expect(subTab('제조 완료')).toHaveAttribute('data-active', 'true');

    scan(BARCODE);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/inventory/manufacture/${SKU.id}`));
    expect(await screen.findByText(SKU.name)).toBeInTheDocument();
    expect(subTab('제조 완료')).toHaveAttribute('data-active', 'true');
    expect(await screen.findByText('재고가 있는 위치가 한 곳이라 먼저 골라 뒀어요.')).toBeInTheDocument();
    expect(screen.getByText(RECEIVING.code)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '파손' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '부호' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '4' }));
    await userEvent.click(screen.getByRole('button', { name: '제조 완료 등록' }));

    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveTextContent('68 → 72');
    expect(dialog).toHaveTextContent('사유 제조');

    await userEvent.click(within(dialog).getByRole('button', { name: '등록' }));

    expect(await screen.findByText('제조 완료를 등록했어요')).toBeInTheDocument();
    expect(screen.getByText('68 → 72')).toBeInTheDocument();
    expect(core.state.adjusts).toHaveLength(1);
    expect(core.state.adjusts[0].body).toEqual({
      skuId: SKU.id,
      warehouseId: WAREHOUSE_ID,
      locationId: RECEIVING.id,
      delta: 4,
      reason: '제조',
      idempotencyKey: expect.any(String),
    });
    expect(core.state.adjusts[0].idempotencyKey).toEqual(expect.any(String));
    expect(core.state.onHand).toBe(72);

    await userEvent.click(screen.getByRole('button', { name: '다음 상품 등록' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/manufacture'));
    expect(await screen.findByText('만든 상품의 바코드를 스캔하세요.')).toBeInTheDocument();
  });

  it('두 번째 상품은 새 멱등키로 보내 앞 등록의 재전송으로 접히지 않는다', async () => {
    const core = createCore();

    renderApp(core.client);
    await openManufactureTab();

    for (const qty of ['4', '3']) {
      scan(BARCODE);
      await screen.findByText('재고가 있는 위치가 한 곳이라 먼저 골라 뒀어요.');
      await userEvent.click(screen.getByRole('button', { name: qty }));
      await userEvent.click(screen.getByRole('button', { name: '제조 완료 등록' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '등록' }));
      await screen.findByText('제조 완료를 등록했어요');
      await userEvent.click(screen.getByRole('button', { name: '다음 상품 등록' }));
      await screen.findByText('만든 상품의 바코드를 스캔하세요.');
    }

    const keys = core.state.adjusts.map((a) => a.idempotencyKey);

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(core.state.onHand).toBe(68 + 4 + 3);
  });

  it('재고 조정 권한이 없으면 제조 완료 탭에서 입력 전에 막고 스캔해도 넘어가지 않는다', async () => {
    const core = createCore({ stockAdjust: false });
    const { router } = renderApp(core.client);

    await openManufactureTab();

    expect(await screen.findByText(STOCK_ADJUST_PERMISSION_MESSAGE)).toBeInTheDocument();

    scan(BARCODE);
    await act(async () => {});

    expect(router.state.location.pathname).toBe('/inventory/manufacture');
    expect(core.state.adjusts).toHaveLength(0);
  });

  it('재고 조회와 제조 완료 탭을 오가도 각 탭의 검색어가 남는다', async () => {
    const core = createCore();

    renderApp(core.client);

    const lookup = await screen.findByPlaceholderText('상품명·코드·바코드 검색');

    await userEvent.type(lookup, '터번');
    await openManufactureTab();
    await userEvent.type(screen.getByPlaceholderText('상품명·코드 검색'), '펌제');
    await userEvent.click(subTab('재고 조회'));

    expect(await screen.findByPlaceholderText('상품명·코드·바코드 검색')).toHaveValue('터번');

    await userEvent.click(subTab('제조 완료'));

    expect(await screen.findByPlaceholderText('상품명·코드 검색')).toHaveValue('펌제');
  });

  it('등록 확인 창에서 취소하면 재고를 올리지 않는다', async () => {
    const core = createCore();

    renderApp(core.client, `/inventory/manufacture/${SKU.id}`);

    await screen.findByText('재고가 있는 위치가 한 곳이라 먼저 골라 뒀어요.');
    await userEvent.click(screen.getByRole('button', { name: '4' }));
    await userEvent.click(screen.getByRole('button', { name: '제조 완료 등록' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '취소' }));

    expect(core.state.adjusts).toHaveLength(0);
    expect(core.state.onHand).toBe(68);
  });
});
