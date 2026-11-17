import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { BARCODE_LABEL_PRINTER_KEY } from '../../core/hardware/print/labelPrinter';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { SessionProvider } from '../../app/session-context';
import { DiagnosticsScreen, PrinterDiagnostics } from './DiagnosticsScreen';
import type { Session } from '../../core/auth/session';

const stub: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

describe('DiagnosticsScreen', () => {
  it('hides diagnostics unless developer mode is explicitly enabled', () => {
    render(
      <SessionProvider session={stub}>
        <ScanProvider>
          <DiagnosticsScreen />
        </ScanProvider>
      </SessionProvider>
    );
    expect(screen.getByText(/관리자 권한이 필요해요/)).toBeInTheDocument();
    expect(screen.queryByText('Diagnostics')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /camera scan/i })
    ).not.toBeInTheDocument();
  });
});

describe('PrinterDiagnostics', () => {
  it('prompt 없이 저장된 칸 값으로 테스트 인쇄한다', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const prefs = createMemoryPrefs({ [BARCODE_LABEL_PRINTER_KEY]: 'spooler://LBL' });
    const prints = { waybill: vi.fn(async (_target: string, _text: string) => {}), label: vi.fn(async (_target: string, _text: string) => {}) };
    const onStatus = vi.fn();
    render(<PrinterDiagnostics onStatus={onStatus} prefs={prefs} prints={prints} />);
    await userEvent.click(screen.getByRole('button', { name: '라벨 프린터 테스트 인쇄' }));
    expect(prints.label.mock.calls[0]?.[0]).toBe('spooler://LBL');
    expect(prints.waybill).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('칸이 비었으면 그 칸의 설정 안내를 보인다', async () => {
    const prints = { waybill: vi.fn(async (_target: string, _text: string) => {}), label: vi.fn(async (_target: string, _text: string) => {}) };
    const onStatus = vi.fn();
    render(<PrinterDiagnostics onStatus={onStatus} prefs={createMemoryPrefs()} prints={prints} />);
    await userEvent.click(screen.getByRole('button', { name: '송장 프린터 테스트 인쇄' }));
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('송장 프린터가 설정되지 않았어요'));
    expect(prints.waybill).not.toHaveBeenCalled();
  });
});
