import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { OperationContext } from '../../core/operations/OperationContext';
import { createOperationStore } from '../../core/operations/operationStore';
import { createOperationRunner } from '../../core/operations/operationRunner';
import type { ApiClient } from '../../core/data/httpClient';
import { AddCountItemSheet } from './AddCountItemSheet';
const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'token',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};
const place = { locationId: 'loc', locationCode: 'A', expectedItems: [] };
const stored = {
  sku: { id: 'sku', code: 'S', name: '상품', optionKey: '' },
  quantity: '12',
  key: 'saved-key',
};
it('재시작한 입력을 복원하고 스캐너 Enter로 확정하지 않는다', async () => {
  const store = createOperationStore(crypto.randomUUID());
  await store.draft('scope:draft:count-add:s:loc', () => stored);
  const request = vi.fn(async () => ({
    capabilities: { stocktakingAddCountItem: true },
  })) as ApiClient['request'];
  const runner = createOperationRunner({
    api: { request },
    store,
    getScope: async () => 'scope',
  });
  const done = vi.fn(async () => {});
  const tree = () => (
    <SessionProvider session={session}>
      <QueryClientProvider client={new QueryClient()}>
        <ApiClientProvider client={{ request }}>
          <OperationContext.Provider
            value={{
              store,
              runner,
              getScope: async () => 'scope',
              getCapabilities: async () => ({ stocktakingAddCountItem: true }),
            }}
          >
            <AddCountItemSheet
              sessionId="s"
              place={place}
              onCancel={() => {}}
              onExisting={() => {}}
              onConflict={async () => undefined}
              onDone={done}
            />
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const first = render(tree());
  const input = await screen.findByLabelText(/새 상품 실물 총수량/);
  expect(input).toHaveValue('12');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '실사에 추가' })).toBeEnabled()
  );
  screen.getByRole('button', { name: '실사에 추가' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(done).not.toHaveBeenCalled();
  await userEvent.clear(input);
  await userEvent.type(input, '25');
  await waitFor(async () =>
    expect(
      (await store.draft<{ quantity: string }>('scope:draft:count-add:s:loc'))
        ?.quantity
    ).toBe('25')
  );
  first.unmount();
  render(tree());
  expect(await screen.findByLabelText(/새 상품 실물 총수량/)).toHaveValue('25');
});
it('확정된 추가 요청은 재등록 없이 원래 키로 목록 복구를 요청한다', async () => {
  const store = createOperationStore(crypto.randomUUID());
  await store.draft('scope:draft:count-add:s:loc', () => stored);
  await store.begin({
    id: stored.key,
    scope: 'scope',
    resource: 'stocktaking:s',
    path: '/stocktaking/count-items',
    method: 'POST',
    bodyJson: '{}',
    createdAt: Date.now(),
  });
  await store.finish(stored.key, 'confirmed', {
    lineId: 'l',
    countedQuantity: 12,
    lineRevision: 1,
  });
  const request = vi.fn(async () => ({
    capabilities: { stocktakingAddCountItem: true },
  })) as ApiClient['request'];
  const runner = createOperationRunner({
    api: { request },
    store,
    getScope: async () => 'scope',
  });
  const done = vi.fn(async () => {});
  render(
    <SessionProvider session={session}>
      <QueryClientProvider client={new QueryClient()}>
        <ApiClientProvider client={{ request }}>
          <OperationContext.Provider
            value={{
              store,
              runner,
              getScope: async () => 'scope',
              getCapabilities: async () => ({ stocktakingAddCountItem: true }),
            }}
          >
            <AddCountItemSheet
              sessionId="s"
              place={place}
              onCancel={() => {}}
              onExisting={() => {}}
              onConflict={async () => undefined}
              onDone={done}
            />
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  await waitFor(() => expect(done).toHaveBeenCalledWith('saved-key'));
  expect(
    (request as ReturnType<typeof vi.fn>).mock.calls.some(
      ([opts]) => opts.path === '/stocktaking/count-items'
    )
  ).toBe(false);
});
