import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from '../auth/session';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider, useApiClient } from '../data/ApiClientProvider';
import { apiBaseUrl } from '../../app/config';
import { createOperationStore } from './operationStore';
import { WorkArea } from './WorkBoundary';

const DEFAULT_OPERATION_DB = 'almondwms-work-v2';
const openDatabases = new Set<IDBDatabase>();

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];
type FetchHandler = (...args: FetchArgs) => Promise<Response>;
let fetchHandler: FetchHandler;
const fetchMock = vi.fn((...args: FetchArgs) => fetchHandler(...args));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: FetchArgs) => fetchMock(...args),
}));

let authed = false;
let activeToken = 'worker-token';
const listeners = new Set<() => void>();
const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => authed,
  getAccessToken: async () => {
    if (!authed) throw new Error('not logged in');
    return activeToken;
  },
  login: async () => {
    authed = true;
    listeners.forEach((fn) => fn());
  },
  logout: async () => {
    authed = false;
    listeners.forEach((fn) => fn());
  },
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function trackOpenedDatabases() {
  const open = indexedDB.open.bind(indexedDB);
  vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
    const request = version === undefined ? open(name) : open(name, version);
    request.addEventListener('success', () =>
      openDatabases.add(request.result)
    );
    return request;
  });
}

async function deleteDefaultOperationDb() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DEFAULT_OPERATION_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('operation DB remained open'));
  });
}

beforeEach(async () => {
  authed = false;
  activeToken = 'worker-token';
  listeners.clear();
  fetchMock.mockClear();
  fetchHandler = async (...args) => {
    const token =
      new Headers(args[1]?.headers)
        .get('Authorization')
        ?.replace('Bearer ', '') ?? '';
    return Response.json({
      actorId:
        token === 'token-a'
          ? 'worker-a'
          : token === 'token-b'
            ? 'worker-b'
            : 'worker',
      operationContractVersion: 2,
      capabilities: { inboundWorkflowConsistency: true },
    });
  };
  await deleteDefaultOperationDb();
  trackOpenedDatabases();
});

afterEach(async () => {
  cleanup();
  openDatabases.forEach((database) => database.close());
  openDatabases.clear();
  vi.restoreAllMocks();
  await deleteDefaultOperationDb();
});

function renderBoundary(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SessionProvider session={session}>
        <ApiClientProvider>{children}</ApiClientProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

it('unlocks work after an initially signed-out session logs in successfully', async () => {
  renderBoundary(
    <WorkArea kind="inbound">
      <button>입고 실행</button>
    </WorkArea>
  );

  await act(async () => {});
  await act(async () => {
    await session.login();
  });

  await waitFor(() =>
    expect(screen.getByText('입고 실행').closest('[inert]')).toBeNull()
  );
  expect(
    screen.queryByText(
      '작업 저장소나 서버 연결을 확인하지 못했어요. 연결을 확인해 주세요.'
    )
  ).toBeNull();
});

it('recovers from a transient IndexedDB open failure after scope succeeds', async () => {
  authed = true;
  vi.mocked(indexedDB.open).mockImplementationOnce(() => {
    throw new Error('indexeddb unavailable');
  });
  renderBoundary(
    <WorkArea kind="inbound">
      <button>입고 실행</button>
    </WorkArea>
  );

  expect(
    await screen.findByText(
      '작업 저장소나 서버 연결을 확인하지 못했어요. 연결을 확인해 주세요.'
    )
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByText('입고 실행').closest('[inert]')).not.toBeNull();

  await userEvent.click(screen.getByRole('button', { name: '처리 내역 확인' }));

  await waitFor(() =>
    expect(screen.getByText('입고 실행').closest('[inert]')).toBeNull()
  );
  expect(
    screen.queryByText(
      '작업 저장소나 서버 연결을 확인하지 못했어요. 연결을 확인해 주세요.'
    )
  ).toBeNull();
});

it('rechecks readiness on reconnect after a transient IndexedDB failure', async () => {
  authed = true;
  vi.mocked(indexedDB.open).mockImplementationOnce(() => {
    throw new Error('indexeddb unavailable');
  });
  renderBoundary(
    <WorkArea kind="inbound">
      <button>입고 실행</button>
    </WorkArea>
  );
  expect(
    await screen.findByText(
      '작업 저장소나 서버 연결을 확인하지 못했어요. 연결을 확인해 주세요.'
    )
  ).toBeInTheDocument();

  act(() => window.dispatchEvent(new Event('online')));

  await waitFor(() =>
    expect(screen.getByText('입고 실행').closest('[inert]')).toBeNull()
  );
});

it('preserves an uncertain outbound operation when login restores saved work', async () => {
  const scope = JSON.stringify([apiBaseUrl, 'worker']);
  const store = createOperationStore();
  await store.begin({
    id: 'uncertain-outbound',
    scope,
    resource: '/shipments/shipment-1',
    method: 'POST',
    path: '/shipments/shipment-1/location-outbound-scans',
    bodyJson: JSON.stringify({
      warehouseId: 'warehouse-1',
      sourceLocationId: 'location-1',
      barcode: '8801',
      quantity: 1,
    }),
    createdAt: Date.now(),
  });
  await store.finish('uncertain-outbound', 'uncertain');
  renderBoundary(
    <WorkArea kind="outbound">
      <button>출고 실행</button>
    </WorkArea>
  );

  await act(async () => {
    await session.login();
  });

  expect(
    await screen.findByText(
      '처리 여부를 확인하고 있어요. 이 상품은 다시 찍지 마세요.'
    )
  ).toBeInTheDocument();
  expect(screen.getByText('출고 실행').closest('[inert]')).not.toBeNull();
  expect(await store.get('uncertain-outbound')).toMatchObject({
    status: 'uncertain',
    attempts: 0,
  });
});

it('keeps account B scan allowance after a late account A scope result', async () => {
  let resolveAccountA!: (response: Response) => void;
  const accountA = new Promise<Response>((resolve) => {
    resolveAccountA = resolve;
  });
  const accountBScope = JSON.stringify([apiBaseUrl, 'worker-b']);
  const store = createOperationStore();
  await store.begin({
    id: 'account-b-scan',
    scope: accountBScope,
    resource: '/shipments/shipment-b',
    method: 'POST',
    path: '/shipments/shipment-b/location-outbound-scans',
    bodyJson: JSON.stringify({
      warehouseId: 'warehouse-b',
      sourceLocationId: 'location-b',
      barcode: '8801',
      quantity: 1,
    }),
    createdAt: Date.now(),
  });
  fetchHandler = async (...args) => {
    const authorization = new Headers(args[1]?.headers).get('Authorization');
    if (authorization === 'Bearer token-a') return accountA;
    return Response.json({
      actorId: 'worker-b',
      operationContractVersion: 2,
      capabilities: { inboundWorkflowConsistency: true },
    });
  };
  activeToken = 'token-a';
  renderBoundary(
    <WorkArea
      kind="outbound"
      scanAllowance={{
        path: '/shipments/shipment-b/location-outbound-scans',
        operationId: 'account-b-scan',
        warehouseId: 'warehouse-b',
        sourceLocationId: 'location-b',
      }}
    >
      <button>계정 B 스캔</button>
    </WorkArea>
  );

  await act(async () => {
    await session.login();
  });
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).endsWith('/inventory/work-context')
      )
    ).toBe(true)
  );
  await act(async () => {
    await session.logout();
    activeToken = 'token-b';
    await session.login();
  });
  await waitFor(() =>
    expect(screen.getByText('계정 B 스캔').closest('[inert]')).toBeNull()
  );

  await act(async () => {
    resolveAccountA(
      Response.json({
        actorId: 'worker-a',
        operationContractVersion: 2,
        capabilities: { inboundWorkflowConsistency: true },
      })
    );
    await accountA;
  });

  expect(screen.getByText('계정 B 스캔').closest('[inert]')).toBeNull();
  expect(await store.get('account-b-scan')).toMatchObject({
    scope: accountBScope,
    status: 'queued',
  });
  expect(
    screen.queryByText(
      '작업 저장소나 서버 연결을 확인하지 못했어요. 연결을 확인해 주세요.'
    )
  ).toBeNull();
});

function ScanRequest() {
  const api = useApiClient();
  return (
    <WorkArea
      kind="outbound"
      scanAllowance={{
        path: '/shipments/shipment-1/location-outbound-scans',
        operationId: 'scan-1',
        warehouseId: 'warehouse-1',
        sourceLocationId: 'location-1',
      }}
    >
      <button
        onClick={() => {
          void api.request({
            method: 'POST',
            path: '/shipments/shipment-1/location-outbound-scans',
            idempotencyKey: 'scan-1',
            body: {
              warehouseId: 'warehouse-1',
              sourceLocationId: 'location-1',
              barcode: '8801',
              quantity: 1,
            },
          });
        }}
      >
        연속 스캔
      </button>
    </WorkArea>
  );
}

it('allows matching scans while sending and blocks them after the result becomes uncertain', async () => {
  let resolveScan!: (response: Response) => void;
  const scanResponse = new Promise<Response>((resolve) => {
    resolveScan = resolve;
  });
  const defaultHandler = fetchHandler;
  fetchHandler = async (...args) =>
    String(args[0]).endsWith('/shipments/shipment-1/location-outbound-scans')
      ? scanResponse
      : defaultHandler(...args);
  authed = true;
  renderBoundary(<ScanRequest />);
  await waitFor(() =>
    expect(screen.getByText('연속 스캔').closest('[inert]')).toBeNull()
  );

  await userEvent.click(screen.getByRole('button', { name: '연속 스캔' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).endsWith(
          '/shipments/shipment-1/location-outbound-scans'
        )
      )
    ).toBe(true)
  );
  expect(screen.getByText('연속 스캔').closest('[inert]')).toBeNull();

  resolveScan(Response.json({ error: 'Forbidden' }, { status: 403 }));

  await waitFor(() =>
    expect(screen.getByText('연속 스캔').closest('[inert]')).not.toBeNull()
  );
  expect(await createOperationStore().get('scan-1')).toMatchObject({
    status: 'uncertain',
    attempts: 1,
  });
});
