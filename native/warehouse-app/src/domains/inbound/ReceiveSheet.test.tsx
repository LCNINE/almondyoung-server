import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReceiveSheet } from './ReceiveSheet';
it('키보드로 입고 수량을 입력하고 빈 값과 초과 수량은 제출하지 않는다', async () => {
  const submit = vi.fn();
  render(
    <ReceiveSheet
      item={{
        skuId: 's',
        skuName: '셔츠',
        skuCode: 'S',
        orderedQty: 10,
        receivedQty: 2,
        outstandingQty: 8,
        expectedArrival: null,
      }}
      scanBump={0}
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
