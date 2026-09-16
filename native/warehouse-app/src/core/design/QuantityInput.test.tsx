import { expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuantityInput, parseQuantity } from './QuantityInput';
it('빈 입력을 0으로 바꾸지 않고 정수 총수량만 허용한다', async () => {
  function Form() {
    const [value, setValue] = useState('3');
    return (
      <>
        <QuantityInput
          label="실물 수량"
          value={value}
          onChange={setValue}
          min={0}
        />
        <button disabled={parseQuantity(value, 0) === null}>저장</button>
      </>
    );
  }
  render(<Form />);
  const input = screen.getByLabelText(/실물 수량/);
  await userEvent.clear(input);
  expect(input).toHaveValue('');
  expect(screen.getByRole('button')).toBeDisabled();
  await userEvent.type(input, '0');
  expect(screen.getByRole('button')).toBeEnabled();
  for (const invalid of ['1.5', '1e3', '-1', '2147483648'])
    expect(parseQuantity(invalid, 0)).toBeNull();
  expect(parseQuantity('0', 1)).toBeNull();
});
