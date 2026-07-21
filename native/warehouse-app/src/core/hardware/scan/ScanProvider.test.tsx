import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
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
