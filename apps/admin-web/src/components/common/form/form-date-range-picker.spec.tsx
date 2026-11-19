/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormDateRangePicker } from './form-date-range-picker';

// 달력은 이번 달을 먼저 보이므로 이번 달 날짜로 고른다
const today = new Date();
const day = (date: number) =>
  new Date(today.getFullYear(), today.getMonth(), date);

it.each([
  ['끝날짜 앞', 10, { from: day(10), to: day(20) }],
  ['끝날짜 뒤', 25, { from: day(20), to: day(25) }],
  ['끝날짜와 같은', 20, { from: day(20), to: day(20) }],
])(
  '끝날짜만 있을 때 %s 날을 누르면 그 날과 끝날짜로 기간을 만든다',
  async (_, clicked, expected) => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(
      <FormDateRangePicker
        value={{ from: undefined, to: day(20) }}
        onChange={onChange}
      />
    );

    await user.click(
      screen.getAllByText(/\d{4}-\d{2}-\d{2}|날짜 범위를 선택하세요/)[1]
    );
    const grid = screen.getAllByRole('grid')[0];
    const button = Array.from(grid.querySelectorAll('button')).find(
      (b) => b.textContent === String(clicked)
    );
    if (!button) throw new Error(`no day ${clicked}`);
  await user.click(button);

    expect(onChange).toHaveBeenLastCalledWith(expected);
  }
);
