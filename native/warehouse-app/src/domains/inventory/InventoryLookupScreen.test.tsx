import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { InventoryLookupScreen } from './InventoryLookupScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function renderWith(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <InventoryLookupScreen />
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('InventoryLookupScreen', () => {
  it('searches and shows results with stock in a table', async () => {
    const client: ApiClient = {
      // vi.fn 반환 타입은 ApiClient.request의 제네릭 <T>를 만족 못 하므로 캐스트(httpClient.test.ts의 `doFetch as never`와 같은 패턴).
      request: vi.fn(async () => ({
        items: [
          { id: '1', code: 'SKU-8891', name: '코튼 티', optionKey: '흰색 / M', currentStock: 5, safetyStock: 10 },
        ],
        total: 1,
      })) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(await screen.findByText('코튼 티')).toBeInTheDocument();
    expect(screen.getByText('SKU-8891')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('부족')).toBeInTheDocument(); // 5 <= safetyStock 10
  });

  it('shows the empty message when there are no results', async () => {
    const client: ApiClient = {
      request: vi.fn(async () => ({ items: [], total: 0 })) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '없는상품');
    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(await screen.findByText('결과가 없어요.')).toBeInTheDocument();
  });

  it('shows a friendly message on error', async () => {
    const client: ApiClient = {
      request: vi.fn(async () => {
        throw new Error('GET /inventory/skus/search/advanced → 500');
      }) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/서버/);
    expect(screen.queryByText('결과가 없어요.')).toBeNull();
  });
});
