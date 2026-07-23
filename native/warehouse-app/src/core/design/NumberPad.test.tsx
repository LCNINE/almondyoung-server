import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberPad } from './NumberPad';

describe('NumberPad', () => {
  it('숫자 키를 누르면 자릿수가 누적된다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={1} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '2' }));

    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('지우기는 마지막 자리를 없앤다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={12} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '지우기' }));

    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('한 자리에서 지우면 0 이 된다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={7} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '지우기' }));

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('allowNegative 가 아니면 부호 키가 없다', () => {
    render(<NumberPad value={0} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '부호' })).not.toBeInTheDocument();
  });

  it('allowNegative 면 부호 키가 값을 뒤집는다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={3} onChange={onChange} allowNegative />);

    await userEvent.click(screen.getByRole('button', { name: '부호' }));

    expect(onChange).toHaveBeenCalledWith(-3);
  });

  it('음수에서 자릿수를 누르면 부호를 유지한다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={-1} onChange={onChange} allowNegative />);

    await userEvent.click(screen.getByRole('button', { name: '2' }));

    expect(onChange).toHaveBeenCalledWith(-12);
  });
});
