/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExcludeShipmentDialog } from './exclude-shipment-dialog';

it('배치 서랍 기본값은 체크 해제이고 선택한 값을 확인 동작에 전달한다', async () => {
  const confirm = jest.fn();
  const user = userEvent.setup();

  render(
    <ExcludeShipmentDialog
      trackingNo="12345678"
      defaultVoidWaybill={false}
      onClose={() => undefined}
      onConfirm={confirm}
    />
  );
  const checkbox = screen.getByRole('checkbox', { name: '송장도 같이 무효화' });

  expect(checkbox.getAttribute('data-state')).toBe('unchecked');
  expect(
    screen.getByText(
      '이 송장(12345678)은 더 쓸 수 없게 돼요. 상품을 담은 상자면 다 꺼낸 뒤에 무효화돼요.'
    )
  ).toBeTruthy();
  await user.click(checkbox);
  await user.click(screen.getByRole('button', { name: '빼기' }));

  expect(confirm).toHaveBeenCalledWith(true);
});

it('확인을 취소하면 제외 요청을 보내지 않는다', async () => {
  const confirm = jest.fn();
  const close = jest.fn();
  const user = userEvent.setup();

  render(
    <ExcludeShipmentDialog
      defaultVoidWaybill={false}
      onClose={close}
      onConfirm={confirm}
    />
  );
  await user.click(screen.getByRole('button', { name: '취소' }));

  expect(confirm).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});
