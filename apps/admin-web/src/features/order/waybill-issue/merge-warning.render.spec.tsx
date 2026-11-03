/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MergeWarning } from './merge-warning';
import type { MergePair } from './waybill-issue-model';

const pair: MergePair = {
  key: 'g1',
  shipmentIds: ['a', 'b'],
  labels: ['#6321', '#6322'],
};

describe('MergeWarning', () => {
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

  it('짝이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <MergeWarning pairs={[]} onMerge={jest.fn()} onDismiss={jest.fn()} />
    );

    expect(container.firstChild).toBeNull();
  });
});
