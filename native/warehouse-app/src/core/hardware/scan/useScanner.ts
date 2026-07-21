import { useEffect } from 'react';
import { useScanBus, type ScanEvent } from './ScanProvider';

export function useScanner(handler: (e: ScanEvent) => void): void {
  const bus = useScanBus();
  useEffect(() => bus.subscribe(handler), [bus, handler]);
}

export function useScanEmit(): (e: ScanEvent) => void {
  return useScanBus().emit;
}
