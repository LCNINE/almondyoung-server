import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

const base = {
  title: '재고 조정',
  message: 'A-01-02 의 코튼셔츠를 −2 조정합니다.',
  confirmLabel: '조정',
  onConfirm: () => {},
  onCancel: () => {},
};

describe('ConfirmDialog', () => {
  it('open 이 false 면 아무것도 렌더하지 않는다', () => {
    render(<ConfirmDialog {...base} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('제목과 메시지를 렌더한다', () => {
    render(<ConfirmDialog {...base} open />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('A-01-02 의 코튼셔츠를 −2 조정합니다.')).toBeInTheDocument();
  });

  it('확인/취소를 각각 호출한다', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} open onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: '조정' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
