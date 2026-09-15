import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReceiveSheet } from './ReceiveSheet';
function ControlledSheet(
  props: Omit<
    Parameters<typeof ReceiveSheet>[0],
    'quantityText' | 'onQuantityChange'
  > & { initialText: string }
) {
  const [text, setText] = useState(props.initialText);
  return (
    <ReceiveSheet {...props} quantityText={text} onQuantityChange={setText} />
  );
}
it('키보드로 입고 수량을 입력하고 빈 값과 초과 수량은 제출하지 않는다', async () => {
  const submit = vi.fn();
  render(
    <ControlledSheet
      item={{
        skuId: 's',
        skuName: '셔츠',
        skuCode: 'S',
        orderedQty: 10,
        receivedQty: 2,
        outstandingQty: 8,
        expectedArrival: null,
      }}
      initialText="8"
      pending={false}
      onSubmit={submit}
      onCancel={() => {}}
    />
  );
  const input = screen.getByLabelText(/입고 수량 직접 입력/);
  await userEvent.clear(input);
  expect(screen.getByRole('button', { name: '입고' })).toBeDisabled();
  await userEvent.type(input, '9');
  expect(screen.getByRole('button', { name: '입고' })).toBeDisabled();
  expect(screen.queryByText(/간편입고로 받으세요/)).not.toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, '5{Enter}');
  expect(submit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '입고' }));
  expect(submit).toHaveBeenCalledWith(5);
});

it('수량 입력이 잠긴 동안에도 시트 안의 스캔 복구를 누를 수 있다', async () => {
  const recover = vi.fn();
  render(
    <ControlledSheet
      item={{
        skuId: 's',
        skuName: '셔츠',
        skuCode: 'S',
        orderedQty: 10,
        receivedQty: 2,
        outstandingQty: 8,
        expectedArrival: null,
      }}
      initialText="1"
      pending
      recovery={
        <button type="button" onClick={recover}>
          이 스캔 제외
        </button>
      }
      onSubmit={() => {}}
      onCancel={() => {}}
    />
  );

  expect(screen.getByLabelText(/입고 수량 직접 입력/)).toBeDisabled();
  const recovery = screen.getByRole('button', { name: '이 스캔 제외' });
  expect(recovery).toBeEnabled();
  await userEvent.click(recovery);
  expect(recover).toHaveBeenCalledOnce();
});

it('completes manual entry with Enter by leaving the input ready for the next scanner event', async () => {
  const submit = vi.fn();
  render(
    <ControlledSheet
      item={{
        skuId: 's',
        skuName: '셔츠',
        skuCode: 'S',
        orderedQty: 10,
        receivedQty: 2,
        outstandingQty: 8,
        expectedArrival: null,
      }}
      initialText="1"
      onSubmit={submit}
      onCancel={() => {}}
    />
  );
  const input = screen.getByLabelText(/입고 수량 직접 입력/);
  await userEvent.click(input);
  expect(input).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(input).not.toHaveFocus();
  expect(submit).not.toHaveBeenCalled();
  expect(input).toHaveValue('1');
});
