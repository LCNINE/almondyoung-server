import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { createScanBuffer } from './scanBuffer';

export interface ScanEvent {
  code: string;
  source: 'hid' | 'camera';
  at: number;
}

type Handler = (e: ScanEvent) => void;

interface ScanBus {
  subscribe(h: Handler): () => void;
  emit(e: ScanEvent): void;
}

const ScanContext = createContext<ScanBus | null>(null);

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const handlers = useRef(new Set<Handler>());

  const bus = useMemo<ScanBus>(
    () => ({
      subscribe(h) {
        handlers.current.add(h);
        return () => handlers.current.delete(h);
      },
      emit(e) {
        handlers.current.forEach((h) => h(e));
      },
    }),
    []
  );

  useEffect(() => {
    const buffer = createScanBuffer();
    function onKeyDown(ev: KeyboardEvent) {
      const code = buffer.feed(ev.key, performance.now());
      if (code) bus.emit({ code, source: 'hid', at: Date.now() });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bus]);

  return <ScanContext.Provider value={bus}>{children}</ScanContext.Provider>;
}

export function useScanBus(): ScanBus {
  const bus = useContext(ScanContext);
  if (!bus) throw new Error('useScanBus must be used within <ScanProvider>');
  return bus;
}
