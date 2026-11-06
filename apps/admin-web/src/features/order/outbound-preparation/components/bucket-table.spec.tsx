/** @jest-environment jsdom */
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BucketTable } from './bucket-table';
import type { OutboundPreparationSummary } from '@/lib/types/dto/fulfillment';

const mockLoadMore = {
  mutate: jest.fn(),
  isPending: false,
  isError: false,
  variables: 'ready',
};

jest.mock('@/lib/services/orders', () => ({
  useLoadMoreOutboundPreparation: () => mockLoadMore,
  useRunOutboundPreparation: jest.fn(),
  useSplitUnreservedMany: jest.fn(),
}));
jest.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => children,
}));

const summary: OutboundPreparationSummary = {
  warehouseId: 'w1',
  awaitingMatchingCount: 0,
  buckets: [
    {
      bucket: 'ready',
      count: 201,
      singleCount: 201,
      multiCount: 0,
      shipments: Array.from({ length: 200 }, (_, index) => ({
        shipmentId: `s${index}`,
        orderNos: [],
        itemSummary: '',
        totalQty: 1,
        single: true,
        reason: null,
      })),
    },
  ],
};

function table(data = summary, busy = false) {
  return (
    <BucketTable
      summary={data}
      busy={busy}
      canPrepare
      selectedCount={() => 0}
      onView={jest.fn()}
      onPrepare={jest.fn()}
      onSplit={jest.fn()}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadMore.isPending = false;
  mockLoadMore.isError = false;
});

it('loads more only for a bucket with undisplayed shipments', () => {
  const { rerender } = render(table());

  fireEvent.click(screen.getByRole('button', { name: '더 보기' }));

  expect(mockLoadMore.mutate).toHaveBeenCalledWith('ready', {
    onSuccess: expect.any(Function),
  });

  rerender(
    table({ ...summary, buckets: [{ ...summary.buckets[0], count: 200 }] })
  );

  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();
});

it('disables another request while loading or preparing and exposes a retryable load error', () => {
  mockLoadMore.isPending = true;
  const { rerender } = render(table());

  expect(
    screen
      .getByRole('button', { name: '불러오는 중…' })
      .hasAttribute('disabled')
  ).toBe(true);

  mockLoadMore.isPending = false;
  rerender(table(summary, true));

  expect(
    screen.getByRole('button', { name: '더 보기' }).hasAttribute('disabled')
  ).toBe(true);

  mockLoadMore.isError = true;
  rerender(table());

  expect(screen.getByRole('alert').textContent).toContain('다시 시도');
  expect(
    screen.getByRole('button', { name: '더 보기' }).hasAttribute('disabled')
  ).toBe(false);
});
