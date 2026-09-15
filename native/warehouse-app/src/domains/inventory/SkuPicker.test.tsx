import { it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SkuPicker } from './SkuPicker';
import userEvent from '@testing-library/user-event';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperFor(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

it('상품을 명시적으로 선택하고 새 검색 중에는 이전 후보를 선택하지 못한다', async () => {
  const selected = vi.fn();
  let release!: (value: unknown) => void;
  const client: ApiClient = {
    request: (async ({ path }: { path: string }) => {
      if (path.includes('search=second'))
        return new Promise<unknown>((resolve) => {
          release = resolve;
        });
      return {
        items: [
          {
            id: 's1',
            code: 'SKU-1',
            name: '셔츠',
            currentStock: 0,
            safetyStock: 0,
          },
        ],
        total: 1,
      };
    }) as ApiClient['request'],
  };
  render(<SkuPicker onSelect={selected} />, { wrapper: wrapperFor(client) });
  await userEvent.type(
    screen.getByLabelText('상품명·코드 검색'),
    'first{Enter}'
  );
  await userEvent.click(
    await screen.findByRole('button', { name: '셔츠 선택' })
  );
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  await userEvent.clear(screen.getByLabelText('상품명·코드 검색'));
  await userEvent.type(
    screen.getByLabelText('상품명·코드 검색'),
    'second{Enter}'
  );
  expect(screen.getByRole('button', { name: '셔츠 선택' })).toBeDisabled();
  release({ items: [], total: 0 });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '셔츠 선택' })).toBeNull()
  );
});
