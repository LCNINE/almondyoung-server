import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ScanProvider } from './ScanProvider';
import { useCommandScans, useScanner } from './useScanner';
import { BarcodeInput } from './BarcodeInput';
it('포커스된 바코드 입력 Enter를 한 번만 접수한다', async () => {
  const accept = vi.fn();
  function Content() {
    useScanner((e) => accept(e.code));
    return <BarcodeInput label="상품 바코드" onSubmit={accept} />;
  }
  render(
    <ScanProvider>
      <Content />
    </ScanProvider>
  );
  await userEvent.type(screen.getByLabelText('상품 바코드'), '8801{Enter}');
  expect(accept.mock.calls).toEqual([['8801']]);
  expect(screen.getByLabelText('상품 바코드')).toHaveValue('');
});

it('입력칸에 찍힌 명령 바코드는 onSubmit 이 아니라 명령 수신처로 가고 칸은 비워진다', async () => {
  const submit = vi.fn();
  const command = vi.fn();
  function Content() {
    useCommandScans(command);
    return <BarcodeInput label="상품 바코드" onSubmit={submit} />;
  }
  render(
    <ScanProvider>
      <Content />
    </ScanProvider>
  );
  const input = screen.getByLabelText('상품 바코드');
  await userEvent.type(input, '%90%03{Enter}');
  expect(command.mock.calls).toEqual([['%90%03']]);
  expect(submit).not.toHaveBeenCalled();
  expect(input).toHaveValue('');
  await userEvent.type(input, '8801{Enter}');
  expect(submit.mock.calls).toEqual([['8801']]);
});
