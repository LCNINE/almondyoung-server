import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanProvider } from './ScanProvider';
import { useScanner } from './useScanner';
import { preventScanEnterActivation } from './hidScanBoundary';
import { scanHid } from './__fixtures__/hid';

function Probe({ onScan }: { onScan: (code: string) => void }) {
  useScanner((e) => onScan(e.code));
  return null;
}

function fireKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

it('명시적으로 허용한 영역은 버튼 실행을 막은 Enter를 HID로 한 번 전달한다', () => {
  const scan = vi.fn();
  render(
    <ScanProvider>
      <Probe onScan={scan} />
      <div onKeyDown={(e) => preventScanEnterActivation(e.nativeEvent)}>
        <button>스캔 영역</button>
      </div>
    </ScanProvider>
  );
  const button = screen.getByRole('button', { name: '스캔 영역' });
  scanHid(button, 'B-05-03', 'NumpadEnter');
  expect(scan.mock.calls).toEqual([['B-05-03']]);
});

it('허용하지 않은 확인창과 하위 컨트롤이 취소한 Enter는 계속 무시한다', () => {
  const scan = vi.fn();
  render(
    <ScanProvider>
      <Probe onScan={scan} />
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
      >
        <button>확인창</button>
      </div>
      <div onKeyDown={(e) => preventScanEnterActivation(e.nativeEvent)}>
        <button
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
        >
          하위 차단
        </button>
      </div>
    </ScanProvider>
  );
  scanHid(screen.getByRole('button', { name: '확인창' }), 'B-05-03');
  scanHid(screen.getByRole('button', { name: '하위 차단' }), 'B-05-03');
  expect(scan).not.toHaveBeenCalled();
});

it('허용한 영역 안에서도 입력칸과 작업 잠금은 스캔을 받지 않는다', () => {
  const scan = vi.fn();
  render(
    <ScanProvider>
      <Probe onScan={scan} />
      <div onKeyDown={(e) => preventScanEnterActivation(e.nativeEvent)}>
        <input aria-label="수량" />
        <textarea aria-label="메모" />
        <select aria-label="선택" />
        <div contentEditable aria-label="편집" />
        <div inert>
          <button>잠금</button>
        </div>
        <button>정상</button>
      </div>
    </ScanProvider>
  );
  // jsdom does not implement the browser's isContentEditable getter.
  Object.defineProperty(screen.getByLabelText('편집'), 'isContentEditable', {
    value: true,
  });
  for (const target of [
    screen.getByLabelText('수량'),
    screen.getByLabelText('메모'),
    screen.getByLabelText('선택'),
    screen.getByLabelText('편집'),
    screen.getByText('잠금'),
  ])
    scanHid(target, 'B-05-03');
  expect(scan).not.toHaveBeenCalled();
  scanHid(screen.getByRole('button', { name: '정상' }), 'C-09-01');
  expect(scan.mock.calls).toEqual([['C-09-01']]);
});

it('일반 Enter와 짧은 입력은 허용한 영역에서도 스캔이 아니다', () => {
  const scan = vi.fn();
  render(
    <ScanProvider>
      <Probe onScan={scan} />
      <div onKeyDown={(e) => preventScanEnterActivation(e.nativeEvent)}>
        <button>영역</button>
      </div>
    </ScanProvider>
  );
  const target = screen.getByRole('button', { name: '영역' });
  expect(fireEvent.keyDown(target, { key: 'Enter' })).toBe(false);
  scanHid(target, '12');
  expect(scan).not.toHaveBeenCalled();
});

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
