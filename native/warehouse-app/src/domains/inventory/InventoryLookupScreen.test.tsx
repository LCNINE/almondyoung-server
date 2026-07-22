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
  it('searches and lists results', async () => {
    const client: ApiClient = {
      // A vi.fn's inferred return type can't satisfy ApiClient.request's generic <T> signature; cast the mock (same pattern as `doFetch as never` in httpClient.test.ts).
      request: vi.fn(async () => [
        { id: '1', code: 'SKU-8891', name: '코튼 티', optionKey: '흰색 / M' },
      ]) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));
    expect(await screen.findByText('코튼 티')).toBeInTheDocument();
    expect(screen.getByText(/SKU-8891/)).toBeInTheDocument();
  });

  it('shows a friendly message on error', async () => {
    const client: ApiClient = {
      // A vi.fn's inferred return type can't satisfy ApiClient.request's generic <T> signature; cast the mock (same pattern as `doFetch as never` in httpClient.test.ts).
      request: vi.fn(async () => {
        throw new Error('GET /inventory/skus → 500');
      }) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/서버/);
  });
});
