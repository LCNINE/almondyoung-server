/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MergeWarning } from './merge-warning';
import type { MergePair } from './waybill-issue-model';

let mockAllowed: string[] = [];

jest.mock('@/lib/services/orders', () => ({
  useCreateShipmentConsolidation: Object.assign(() => ({}), {
    permission: ['fulfillment.shipment.consolidate'],
  }),
  useBatchIssueWaybills: Object.assign(() => ({}), {
    permission: ['fulfillment.warehouse.operate'],
  }),
}));

jest.mock('@/components/auth/can', () => ({
  Can: ({
    run,
    children,
  }: {
    run: { permission: string[] };
    children: React.ReactNode;
  }) => (
    <>
      {run.permission.every((key) => mockAllowed.includes(key))
        ? children
        : null}
    </>
  ),
}));

const pair: MergePair = {
  key: 'g1',
  shipmentIds: ['a', 'b'],
  labels: ['#6321', '#6322'],
};

describe('MergeWarning', () => {
  beforeEach(() => {
    mockAllowed = [
      'fulfillment.shipment.consolidate',
      'fulfillment.warehouse.operate',
    ];
  });

  it('같은 곳으로 가는 상자를 알리고 합치기와 따로 발급을 준다', async () => {
    const onMerge = jest.fn();
    const onDismiss = jest.fn();

    render(
      <MergeWarning pairs={[pair]} onMerge={onMerge} onDismiss={onDismiss} />
    );

    expect(
      screen.getByText(
        '먼저 확인해 주세요. 고른 상자 중 2개는 같은 곳으로 가요'
      )
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '합치기' }));
    expect(onMerge).toHaveBeenCalledWith(pair);

    await userEvent.click(screen.getByRole('button', { name: '따로 발급' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('합치기 권한이 없으면 합치기를, 발급 권한이 없으면 따로 발급을 숨긴다', () => {
    mockAllowed = ['fulfillment.warehouse.operate'];
    const { unmount } = render(
      <MergeWarning pairs={[pair]} onMerge={jest.fn()} onDismiss={jest.fn()} />
    );

    expect(screen.queryByRole('button', { name: '합치기' })).toBeNull();
    expect(screen.getByRole('button', { name: '따로 발급' })).toBeTruthy();
    unmount();

    mockAllowed = ['fulfillment.shipment.consolidate'];
    render(
      <MergeWarning pairs={[pair]} onMerge={jest.fn()} onDismiss={jest.fn()} />
    );

    expect(screen.getByRole('button', { name: '합치기' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '따로 발급' })).toBeNull();
  });

  it('짝이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <MergeWarning pairs={[]} onMerge={jest.fn()} onDismiss={jest.fn()} />
    );

    expect(container.firstChild).toBeNull();
  });
});
