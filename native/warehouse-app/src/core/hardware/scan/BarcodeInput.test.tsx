import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ScanProvider } from './ScanProvider';
import { useScanner } from './useScanner';
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
