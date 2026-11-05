/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { matchingClient } from '@/lib/api/domains/matching';
import { useOrderLines } from '@/lib/services/matching';
import { NameMatchButton } from './name-match-button';

let mockAllowed = true;

jest.mock('@/lib/api/domains/matching', () => ({
  matchingClient: {
    previewNameMatch: jest.fn(),
    applyNameMatch: jest.fn(),
    getOrderLines: jest.fn(),
  },
}));
jest.mock('@/components/auth/can', () => ({
  Can: ({
    run,
    children,
  }: {
    run: { permission: string[] };
    children: React.ReactNode;
  }) =>
    mockAllowed && run.permission.includes('order.matching.write') ? (
      <>{children}</>
    ) : null,
}));

const preview = jest.mocked(matchingClient.previewNameMatch);
const apply = jest.mocked(matchingClient.applyNameMatch);
const orderLines = jest.mocked(matchingClient.getOrderLines);

function OrderLinesObserver() {
  useOrderLines({});

  return null;
}

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <OrderLinesObserver />
      <NameMatchButton />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAllowed = true;
  preview.mockResolvedValue({
    candidates: 2,
    waitingOrderCandidates: 1,
    sample: [
      {
        matchingId: 'm1',
        productName: '가방',
        optionName: '파랑',
        skuId: 's1',
        skuName: '가방 파랑',
      },
    ],
  });
  apply.mockResolvedValue({
    resolved: 1,
    skipped: 0,
    failed: [{ matchingId: 'm2', reason: '연결하지 못했어요.' }],
  });
  orderLines.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
});

it('previews on open, confirms explicitly, shows the result and refetches order lines', async () => {
  mount();

  expect(preview).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole('button', { name: '전부 새로 매칭하기' })
  );
  expect(
    await screen.findByText(
      '이름이 똑같은 재고상품이 하나뿐인 2건을 자동으로 연결해요. 주문이 기다리는 건 1건이에요.'
    )
  ).toBeTruthy();
  expect(screen.getByText('가방 파랑 → 가방 파랑')).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: '연결하기' }));

  expect(
    await screen.findByText('1건 연결했어요 · 실패 1건')
  ).toBeTruthy();
  expect(apply).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(orderLines).toHaveBeenCalledTimes(2));
});

it('keeps calling apply in small batches until nothing is left', async () => {
  apply
    .mockResolvedValueOnce({ resolved: 30, skipped: 5, failed: [] })
    .mockResolvedValueOnce({ resolved: 5, skipped: 0, failed: [] });
  mount();
  await userEvent.click(
    screen.getByRole('button', { name: '전부 새로 매칭하기' })
  );
  await screen.findByRole('button', { name: '연결하기' });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '연결하기' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  );
  await userEvent.click(screen.getByRole('button', { name: '연결하기' }));

  expect(await screen.findByText('35건 연결했어요 · 실패 0건')).toBeTruthy();
  expect(apply).toHaveBeenCalledTimes(2);
});

it('stops when a batch connects nothing', async () => {
  apply.mockResolvedValue({
    resolved: 0,
    skipped: 4,
    failed: [{ matchingId: 'm9', reason: '연결하지 못했어요.' }],
  });
  mount();
  await userEvent.click(
    screen.getByRole('button', { name: '전부 새로 매칭하기' })
  );
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '연결하기' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  );
  await userEvent.click(screen.getByRole('button', { name: '연결하기' }));

  expect(await screen.findByText('0건 연결했어요 · 실패 1건')).toBeTruthy();
  expect(apply).toHaveBeenCalledTimes(1);
});

it('hides the action without matching write permission', () => {
  mockAllowed = false;
  mount();

  expect(
    screen.queryByRole('button', { name: '전부 새로 매칭하기' })
  ).toBeNull();
  expect(preview).not.toHaveBeenCalled();
});

it('disables apply when preview fails', async () => {
  preview.mockRejectedValue(new Error('unavailable'));
  mount();
  await userEvent.click(
    screen.getByRole('button', { name: '전부 새로 매칭하기' })
  );
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: '연결하기' }));

  expect(apply).not.toHaveBeenCalled();
});

it('does not apply when there are no candidates', async () => {
  preview.mockResolvedValue({
    candidates: 0,
    waitingOrderCandidates: 0,
    sample: [],
  });
  mount();
  await userEvent.click(
    screen.getByRole('button', { name: '전부 새로 매칭하기' })
  );
  await screen.findByText(
    '이름이 똑같은 재고상품이 하나뿐인 0건을 자동으로 연결해요. 주문이 기다리는 건 0건이에요.'
  );
  await userEvent.click(screen.getByRole('button', { name: '연결하기' }));

  expect(apply).not.toHaveBeenCalled();
});
