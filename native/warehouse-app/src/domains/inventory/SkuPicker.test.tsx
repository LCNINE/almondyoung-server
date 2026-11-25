import { it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SkuPicker } from './SkuPicker';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { scanHid } from '../../core/hardware/scan/__fixtures__/hid';
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
        <ApiClientProvider client={client}>
          <ScanProvider>{children}</ScanProvider>
        </ApiClientProvider>
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

vi.mock('../../app/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/config')>()),
  filePublicBaseUrl: 'https://file.tenant-2.example',
}));

function infoClient() {
  const paths: string[] = [];
  const client: ApiClient = {
    request: (async ({ path }: { path: string }) => {
      paths.push(path);
      if (path.startsWith('/inventory/skus/s1')) {
        return {
          id: 's1',
          code: 'NDL-03',
          name: '니들 카트리지',
          optionKey: '0.30mm',
          safetyStock: 0,
          currentStock: 12,
          barcodes: [
            { id: 'b1', barcode: '8800000000011', isPrimary: true },
            { id: 'b2', barcode: '8800000000028', isPrimary: false },
          ],
          imageFileIds: ['f-main', 'f-side'],
        };
      }

      if (path.startsWith('/inventory/skus/s2')) {
        return {
          id: 's2',
          code: 'NDL-05',
          name: '니들 카트리지 굵게',
          safetyStock: 0,
          barcodes: [],
        };
      }

      return {
        items: [
          {
            id: 's1',
            code: 'NDL-03',
            name: '니들 카트리지',
            optionKey: '0.30mm',
            currentStock: 12,
            safetyStock: 0,
            imageFileIds: ['f-main', 'f-side'],
          },
          {
            id: 's2',
            code: 'NDL-05',
            name: '니들 카트리지 굵게',
            currentStock: 0,
            safetyStock: 0,
          },
        ],
        total: 2,
      };
    }) as ApiClient['request'],
  };

  return { client, paths };
}

async function searchNeedles() {
  await userEvent.type(
    screen.getByLabelText('상품명·코드 검색'),
    '니들{Enter}'
  );
  await screen.findByRole('button', { name: '니들 카트리지 선택' });
}

it('검색 결과 줄에 대표 사진을, 사진이 없으면 빈 자리를 보인다', async () => {
  const { client } = infoClient();
  const { container } = render(<SkuPicker onSelect={vi.fn()} />, {
    wrapper: wrapperFor(client),
  });
  await searchNeedles();

  const thumbnails = container.querySelectorAll('li img');
  expect(thumbnails).toHaveLength(1);
  expect(thumbnails[0]).toHaveAttribute(
    'src',
    'https://file.tenant-2.example/files/public/f-main'
  );
  expect(screen.getAllByTestId('sku-thumbnail-empty')).toHaveLength(1);
});

it('결과 줄을 누르면 상품 정보 창에 사진·옵션·바코드·현재고를 보이고 사진을 넘겨 본다', async () => {
  const { client, paths } = infoClient();
  render(<SkuPicker onSelect={vi.fn()} />, { wrapper: wrapperFor(client) });
  await searchNeedles();

  await userEvent.click(
    screen.getByRole('button', { name: '니들 카트리지 상품 정보' })
  );

  const dialog = await screen.findByRole('dialog', {
    name: '니들 카트리지 상품 정보',
  });
  expect(paths).toContain('/inventory/skus/s1');
  expect(await within(dialog).findByText('8800000000011')).toBeInTheDocument();
  expect(within(dialog).getByText('8800000000028')).toBeInTheDocument();
  expect(within(dialog).getByText('옵션 0.30mm')).toBeInTheDocument();
  expect(within(dialog).getByText('12개')).toBeInTheDocument();
  expect(
    within(dialog).getByRole('img', { name: '니들 카트리지 사진' })
  ).toHaveAttribute('src', 'https://file.tenant-2.example/files/public/f-main');

  await userEvent.click(
    within(dialog).getByRole('button', { name: '다음 사진' })
  );
  expect(
    within(dialog).getByRole('img', { name: '니들 카트리지 사진' })
  ).toHaveAttribute('src', 'https://file.tenant-2.example/files/public/f-side');
  expect(within(dialog).getByText('2 / 2')).toBeInTheDocument();
});

it('줄의 선택 버튼은 창을 열지 않고 바로 담는다', async () => {
  const { client } = infoClient();
  const selected = vi.fn();
  render(<SkuPicker onSelect={selected} />, { wrapper: wrapperFor(client) });
  await searchNeedles();

  await userEvent.click(
    screen.getByRole('button', { name: '니들 카트리지 선택' })
  );

  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('창의 선택은 같은 상품을 담고 창을 닫는다', async () => {
  const { client } = infoClient();
  const selected = vi.fn();
  render(<SkuPicker onSelect={selected} />, { wrapper: wrapperFor(client) });
  await searchNeedles();

  await userEvent.click(
    screen.getByRole('button', { name: '니들 카트리지 상품 정보' })
  );
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: '선택' }));

  expect(selected).toHaveBeenCalledTimes(1);
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('Esc 와 바깥 누르기로 창을 닫는다', async () => {
  const { client } = infoClient();
  const selected = vi.fn();
  render(<SkuPicker onSelect={selected} />, { wrapper: wrapperFor(client) });
  await searchNeedles();

  await userEvent.click(
    screen.getByRole('button', { name: '니들 카트리지 상품 정보' })
  );
  await screen.findByRole('dialog');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();

  await userEvent.click(
    screen.getByRole('button', { name: '니들 카트리지 굵게 상품 정보' })
  );
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(dialog.parentElement as HTMLElement);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(selected).not.toHaveBeenCalled();
});

it('막힌 상태에서는 결과 줄을 눌러도 창이 뜨지 않는다', async () => {
  const { client } = infoClient();
  const { rerender } = render(<SkuPicker onSelect={vi.fn()} />, {
    wrapper: wrapperFor(client),
  });
  await searchNeedles();

  rerender(<SkuPicker disabled onSelect={vi.fn()} />);
  await userEvent.click(screen.getByText('NDL-03 · 0.30mm'));

  expect(screen.queryByRole('dialog')).toBeNull();
});

it('창을 띄운 채 바코드를 찍으면 창이 닫히고 스캔은 화면으로 간다', async () => {
  const { client } = infoClient();
  render(<SkuPicker onSelect={vi.fn()} />, { wrapper: wrapperFor(client) });
  await searchNeedles();

  await userEvent.click(
    screen.getByRole('button', { name: '니들 카트리지 상품 정보' })
  );
  const dialog = await screen.findByRole('dialog');
  scanHid(dialog, '8801234');

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
