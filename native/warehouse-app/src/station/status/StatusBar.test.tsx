import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { reportServerReach } from '../../core/data/serverStatus';
import { LABEL_PRINTER_KEY, writeLabelPrinter } from '../../core/hardware/print/labelPrinter';
import { reportPrintOutcome, resetPrintOutcome } from '../../core/hardware/print/printerStatus';
import { OperationContext, type WorkRuntime } from '../../core/operations/OperationContext';
import type { StoredOperation } from '../../core/operations/operationStore';
import { BatchProgressProvider, useBatchProgress } from './batchProgress';
import { StatusBar } from './StatusBar';

const toneOf = (label: string) => screen.getByText(label).closest('[data-tone]')?.getAttribute('data-tone');

function Batch() {
  useBatchProgress({ code: 'B-1002', done: 13, total: 40 });
  return null;
}

describe('StatusBar', () => {
  it('프린터: 미설정이면 빨강, 설정하면 초록, 출력 실패 뒤 빨강, 다시 설정하면 초록', () => {
    resetPrintOutcome();
    const prefs = createMemoryPrefs();
    render(<StatusBar tab="F1" prefs={prefs} />);
    expect(toneOf('프린터')).toBe('bad');
    act(() => writeLabelPrinter(prefs, 'XP-DT108B'));
    expect(toneOf('프린터')).toBe('ok');
    act(() => reportPrintOutcome(false));
    expect(toneOf('프린터')).toBe('bad');
    act(() => writeLabelPrinter(prefs, 'XP-DT108B'));
    expect(toneOf('프린터')).toBe('ok');
  });

  it('서버: 마지막 요청이 서버에 못 닿았으면 빨강', () => {
    render(<StatusBar tab="F1" prefs={createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://P' })} />);
    act(() => reportServerReach('down'));
    expect(toneOf('서버')).toBe('bad');
    act(() => reportServerReach('up'));
    expect(toneOf('서버')).toBe('ok');
  });

  it('미전송 오퍼레이션이 있으면 미전송 N', () => {
    const op: StoredOperation = {
      id: 'op-1',
      scope: 's',
      resource: 'r',
      method: 'POST',
      path: '/shipments/x/simple-outbound-scans',
      bodyJson: '{}',
      createdAt: Date.now() - 5000,
      status: 'queued',
      attempts: 1,
    };
    const snapshot = [op]; // useSyncExternalStore 는 같은 참조를 돌려받아야 한다
    const runtime = {
      runner: { subscribe: () => () => {}, getSnapshot: () => snapshot },
      store: {},
      getScope: async () => 's',
    } as unknown as WorkRuntime;
    render(
      <OperationContext.Provider value={runtime}>
        <StatusBar tab="F3" prefs={createMemoryPrefs()} />
      </OperationContext.Provider>
    );
    expect(screen.getByText('미전송 1')).toBeInTheDocument();
  });

  it('배치 진행은 F1 에서 보이고 F3 에서는 없다', () => {
    const { rerender } = render(
      <BatchProgressProvider>
        <Batch />
        <StatusBar tab="F1" prefs={createMemoryPrefs()} />
      </BatchProgressProvider>
    );
    expect(screen.getByText('B-1002 13/40')).toBeInTheDocument();
    rerender(
      <BatchProgressProvider>
        <Batch />
        <StatusBar tab="F3" prefs={createMemoryPrefs()} />
      </BatchProgressProvider>
    );
    expect(screen.queryByText('B-1002 13/40')).toBeNull();
  });
});
