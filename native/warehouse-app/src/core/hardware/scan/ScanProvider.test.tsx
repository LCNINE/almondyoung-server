import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanProvider } from './ScanProvider';
import { useScanner } from './useScanner';

function Probe({ onScan }: { onScan: (code: string) => void }) {
  useScanner((e) => onScan(e.code));
  return null;
}

function fireKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

describe('ScanProvider', () => {
  it('delivers a HID burst as one ScanEvent', () => {
    const onScan = vi.fn();
    render(
      <ScanProvider>
        <Probe onScan={onScan} />
      </ScanProvider>
    );
    for (const k of ['9', '9', '1', '2', 'Enter']) fireKey(k);
    expect(onScan).toHaveBeenCalledWith('9912');
  });
});

it('검색·수량 입력과 Enter를 상품 스캔으로 소비하지 않는다', () => {
  const onScan = vi.fn();
  render(
    <ScanProvider>
      <Probe onScan={onScan} />
      <input aria-label="검색" />
    </ScanProvider>
  );
  const input = screen.getByLabelText('검색');
  for (const key of ['9', '9', '1', '2', 'Enter'])
    fireEvent.keyDown(input, { key });
  expect(onScan).not.toHaveBeenCalled();
  for (const key of ['8', '8', '0', '1', 'Enter']) fireKey(key);
  expect(onScan.mock.calls).toEqual([['8801']]);
});
it('완료된 HID 스캔의 Enter는 포커스된 업무 버튼을 누르지 않는다', () => {
  const scan = vi.fn();
  const click = vi.fn();
  render(
    <ScanProvider>
      <Probe onScan={scan} />
      <button onClick={click}>입고 등록</button>
    </ScanProvider>
  );
  const button = screen.getByRole('button', { name: '입고 등록' });
  button.focus();
  for (const key of ['9', '9', '1', '2']) fireEvent.keyDown(button, { key });
  const enter = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  button.dispatchEvent(enter);
  expect(scan).toHaveBeenCalledWith('9912');
  expect(enter.defaultPrevented).toBe(true);
  expect(click).not.toHaveBeenCalled();
});
