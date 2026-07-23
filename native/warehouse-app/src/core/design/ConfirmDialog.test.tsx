import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    expect(
      screen.getByText('A-01-02 의 코튼셔츠를 −2 조정합니다.')
    ).toBeInTheDocument();
  });

  it('확인/취소를 각각 호출한다', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog {...base} open onConfirm={onConfirm} onCancel={onCancel} />
    );

    await userEvent.click(screen.getByRole('button', { name: '조정' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape 키가 취소를 호출한다', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog {...base} open onConfirm={onConfirm} onCancel={onCancel} />
    );

    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('배경 클릭이 취소를 호출한다', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} open onCancel={onCancel} />);

    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement;
    await userEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('패널 내부 클릭은 배경 클릭을 트리거하지 않는다', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} open onCancel={onCancel} />);

    const dialog = screen.getByRole('dialog');
    await userEvent.click(dialog);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('대화창이 열리면 패널(버튼이 아님)에 포커스가 있다', () => {
    render(<ConfirmDialog {...base} open />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();

    const confirmButton = screen.getByRole('button', { name: '조정' });
    expect(confirmButton).not.toHaveFocus();
  });

  it('대화창이 열려 있는 동안 Enter 를 눌러도 onConfirm 이 호출되지 않는다 (스캐너 종단 Enter 방어)', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog {...base} open onConfirm={onConfirm} onCancel={onCancel} />
    );

    await userEvent.keyboard('{Enter}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('대화창이 닫히면 이전에 포커스가 있던 요소로 포커스가 돌아간다', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>열기 트리거</button>
          <ConfirmDialog
            {...base}
            open={open}
            onCancel={() => setOpen(false)}
          />
        </div>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: '열기 트리거' });
    await user.click(trigger); // 클릭이 트리거에 포커스를 준 채로 대화창을 연다
    expect(screen.getByRole('dialog')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('패널 내부에서 시작해 배경에서 끝난 드래그는 취소를 호출하지 않는다', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} open onCancel={onCancel} />);

    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;

    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('진짜 배경에서 시작해 배경에서 끝난 클릭은 취소를 호출한다', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} open onCancel={onCancel} />);

    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
