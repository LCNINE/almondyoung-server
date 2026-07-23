import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider, useWarehouse } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { WarehousePicker } from './WarehousePicker';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function Current() {
  const { warehouseName } = useWarehouse();
  return <span data-testid="current">{warehouseName ?? '없음'}</span>;
}

function renderPicker(client: ApiClient, onPicked?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={createMemoryPrefs()}>
            {children}
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(
    <>
      <WarehousePicker onPicked={onPicked} />
      <Current />
    </>,
    { wrapper: wrap }
  );
}

describe('WarehousePicker', () => {
  const client: ApiClient = {
    request: (async () => [
      { id: 'w-1', name: '본창고', location: '김포' },
      { id: 'w-2', name: '제2창고', location: '이천' },
    ]) as unknown as ApiClient['request'],
  };

  it('창고를 목록으로 보여준다', async () => {
    renderPicker(client);
    expect(
      await screen.findByRole('button', { name: /본창고/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /제2창고/ })).toBeInTheDocument();
  });

  it('선택하면 컨텍스트에 반영하고 onPicked 를 부른다', async () => {
    const onPicked = vi.fn();
    renderPicker(client, onPicked);

    await userEvent.click(
      await screen.findByRole('button', { name: /제2창고/ })
    );

    expect(screen.getByTestId('current')).toHaveTextContent('제2창고');
    expect(onPicked).toHaveBeenCalledTimes(1);
  });

  it('조회 실패는 에러 문구를 보여준다', async () => {
    const failing: ApiClient = {
      request: (async () => {
        throw new Error('GET /inventory/warehouses → 500');
      }) as unknown as ApiClient['request'],
    };
    renderPicker(failing);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서버에 문제가 있어요'
    );
  });
});
