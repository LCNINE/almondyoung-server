import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { createScanBuffer } from './scanBuffer';
import { createHumanKeyDetector } from './humanKeys';
import { isPreservedScanEnter } from './hidScanBoundary';
import { isCommandCode } from './commandPrefix';

export interface ScanEvent {
  code: string;
  source: 'hid' | 'camera';
  at: number;
}

type Handler = (e: ScanEvent) => void;
type CommandHandler = (code: string) => void;
type KeyHandler = (key: string) => void;

interface ScanBus {
  subscribe(h: Handler): () => void;
  /** 일반 구독자보다 먼저 받는다 — «다음 스캔에서 지운다» 류(피드백 테두리)가 같은 스캔의 결과를 지우지 않게. */
  observe(h: Handler): () => void;
  /**
   * 명령 바코드(`%…`) 수신처. 하나뿐이다(스테이션 셸). 없으면 명령 스캔은 버린다 —
   * 일반 구독자(출고 화면은 모든 스캔을 송장으로 연다)에게는 어떤 경우에도 가지 않는다.
   */
  setCommandHandler(h: CommandHandler): () => void;
  /** 사람이 친 키(스펙 §5.6) — 수량 입력·결품 창·직접 입력. 스캐너 묶음과 그 끝 Enter 는 오지 않는다. */
  subscribeKeys(h: KeyHandler): () => void;
  emit(e: ScanEvent): void;
}

const ScanContext = createContext<ScanBus | null>(null);

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const handlers = useRef(new Set<Handler>());
  const observers = useRef(new Set<Handler>());
  const keyHandlers = useRef(new Set<KeyHandler>());
  const commandHandler = useRef<CommandHandler | null>(null);

  const bus = useMemo<ScanBus>(
    () => ({
      subscribe(h) {
        handlers.current.add(h);
        return () => handlers.current.delete(h);
      },
      observe(h) {
        observers.current.add(h);
        return () => observers.current.delete(h);
      },
      setCommandHandler(h) {
        commandHandler.current = h;
        return () => {
          if (commandHandler.current === h) commandHandler.current = null;
        };
      },
      subscribeKeys(h) {
        keyHandlers.current.add(h);
        return () => keyHandlers.current.delete(h);
      },
      emit(e) {
        if (isCommandCode(e.code)) {
          commandHandler.current?.(e.code);
          return;
        }
        observers.current.forEach((h) => h(e));
        handlers.current.forEach((h) => h(e));
      },
    }),
    []
  );

  useEffect(() => {
    const buffer = createScanBuffer();
    const human = createHumanKeyDetector();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const emitKeys = (keys: string[]) =>
      keys.forEach((key) => keyHandlers.current.forEach((h) => h(key)));
    const reset = () => {
      buffer.reset();
      human.reset();
    };
    function onKeyDown(ev: KeyboardEvent) {
      const target = ev.target;
      if (
        (ev.defaultPrevented && !isPreservedScanEnter(ev)) ||
        ev.isComposing ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest('input, textarea, select, [inert]')))
      ) {
        reset();
        return;
      }
      const at = performance.now();
      if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        emitKeys(human.feed(ev.key, at));
        clearTimeout(flushTimer);
        // 미뤄 둔 글자는 묶음 간격이 지나면 사람 것으로 확정한다
        flushTimer = setTimeout(() => emitKeys(human.flush(performance.now())), 60);
      }
      const code = buffer.feed(ev.key, at);
      if (code) {
        ev.preventDefault();
        bus.emit({ code, source: 'hid', at: Date.now() });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('focusin', reset);
    window.addEventListener('focusout', reset);
    return () => {
      clearTimeout(flushTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('focusin', reset);
      window.removeEventListener('focusout', reset);
    };
  }, [bus]);

  return <ScanContext.Provider value={bus}>{children}</ScanContext.Provider>;
}

export function useScanBus(): ScanBus {
  const bus = useContext(ScanContext);
  if (!bus) throw new Error('useScanBus must be used within <ScanProvider>');
  return bus;
}
