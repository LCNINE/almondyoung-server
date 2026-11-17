import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryPrefs } from '../../data/devicePrefs';
import { BARCODE_LABEL_PRINTER_KEY, LABEL_PRINTER_KEY, PrinterError } from './labelPrinter';
import { PrinterSettings } from './PrinterSettings';

describe('PrinterSettings 송장 칸', () => {
  it('저장된 이름을 입력칸에 보여준다', () => {
    const prefs = createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP-DT108B' });
    render(<PrinterSettings slot="waybill" prefs={prefs} print={vi.fn()} />);
    expect(screen.getByLabelText('송장 프린터 이름')).toHaveValue('XP-DT108B');
  });

  it('저장하면 spooler:// target 으로 남는다', async () => {
    const prefs = createMemoryPrefs();
    render(<PrinterSettings slot="waybill" prefs={prefs} print={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('송장 프린터 이름'), 'XP-DT108B');
    await userEvent.click(screen.getByRole('button', { name: '송장 프린터 저장' }));
    expect(prefs.get(LABEL_PRINTER_KEY)).toBe('spooler://XP-DT108B');
    expect(screen.getByRole('status')).toHaveTextContent('저장했어요');
  });

  it('테스트 인쇄는 입력값을 저장하고 그 target 으로 ZPL 을 보낸다', async () => {
    const prefs = createMemoryPrefs();
    const print = vi.fn(async () => {});
    render(<PrinterSettings slot="waybill" prefs={prefs} print={print} />);
    await userEvent.type(screen.getByLabelText('송장 프린터 이름'), 'XP');
    await userEvent.click(screen.getByRole('button', { name: '송장 프린터 테스트 인쇄' }));
    expect(prefs.get(LABEL_PRINTER_KEY)).toBe('spooler://XP');
    expect(print).toHaveBeenCalledTimes(1);
    const [target, text] = print.mock.calls[0] as unknown as [string, string];
    expect(target).toBe('spooler://XP');
    expect(text.startsWith('^XA')).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent('테스트를 보냈어요');
  });

  it('이름 없이 테스트 인쇄하면 안내만 한다', async () => {
    const print = vi.fn(async () => {});
    render(<PrinterSettings slot="waybill" prefs={createMemoryPrefs()} print={print} />);
    await userEvent.click(screen.getByRole('button', { name: '송장 프린터 테스트 인쇄' }));
    expect(print).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('송장 프린터가 설정되지 않았어요');
  });

  it('프린터 실패는 현장 문구와 원문을 함께 보인다', async () => {
    const print = vi.fn(async () => {
      throw new PrinterError('OpenPrinterW failed: 1801');
    });
    render(<PrinterSettings slot="waybill" prefs={createMemoryPrefs()} print={print} />);
    await userEvent.type(screen.getByLabelText('송장 프린터 이름'), 'WRONG');
    await userEvent.click(screen.getByRole('button', { name: '송장 프린터 테스트 인쇄' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('프린터로 보내지 못했어요');
    expect(alert).toHaveTextContent('OpenPrinterW failed: 1801');
  });

  it('같은 틱에 두 번 눌러도 테스트 라벨은 한 장만 보낸다', async () => {
    let release: () => void = () => {};
    const print = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const prefs = createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP' });
    render(<PrinterSettings slot="waybill" prefs={prefs} print={print} />);
    const button = screen.getByRole('button', { name: '송장 프린터 테스트 인쇄' });
    // 한 act 안에서 연달아 누르면 busy state 가 반영되기 전이라 disabled 로는 못 막는다.
    await act(async () => {
      button.click();
      button.click();
    });
    release();
    expect(await screen.findByRole('status')).toHaveTextContent('테스트를 보냈어요');
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('PrinterSettings 라벨 칸·두 절', () => {
  it('라벨 칸은 자기 키에만 저장하고 송장 키는 건드리지 않는다', async () => {
    const prefs = createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP' });
    render(<PrinterSettings slot="label" prefs={prefs} print={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('라벨 프린터 이름'), 'TX400');
    await userEvent.click(screen.getByRole('button', { name: '라벨 프린터 저장' }));
    expect(prefs.get(BARCODE_LABEL_PRINTER_KEY)).toBe('spooler://TX400');
    expect(prefs.get(LABEL_PRINTER_KEY)).toBe('spooler://XP');
  });

  it('라벨 칸 테스트 인쇄는 50x30 ZPL 을 라벨 대상으로 보낸다', async () => {
    const prefs = createMemoryPrefs({ [BARCODE_LABEL_PRINTER_KEY]: 'spooler://TX400' });
    const print = vi.fn(async () => {});
    render(<PrinterSettings slot="label" prefs={prefs} print={print} />);
    await userEvent.click(screen.getByRole('button', { name: '라벨 프린터 테스트 인쇄' }));
    const [target, text] = print.mock.calls[0] as unknown as [string, string];
    expect(target).toBe('spooler://TX400');
    expect(text).toContain('^PW400');
    expect(text).toContain('^LL240');
  });

  it('칸이 비면 라벨 문구를 보인다', async () => {
    render(<PrinterSettings slot="label" prefs={createMemoryPrefs()} print={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '라벨 프린터 테스트 인쇄' }));
    expect(screen.getByRole('alert')).toHaveTextContent('라벨 프린터가 설정되지 않았어요');
  });

  it('두 절의 테스트 인쇄는 각자 자기 칸 대상으로만 간다', async () => {
    const prefs = createMemoryPrefs({
      [LABEL_PRINTER_KEY]: 'spooler://WAY',
      [BARCODE_LABEL_PRINTER_KEY]: 'spooler://LBL',
    });
    const printWay = vi.fn(async (_target: string, _text: string) => {});
    const printLbl = vi.fn(async (_target: string, _text: string) => {});
    render(
      <>
        <PrinterSettings slot="waybill" prefs={prefs} print={printWay} />
        <PrinterSettings slot="label" prefs={prefs} print={printLbl} />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: '라벨 프린터 테스트 인쇄' }));
    expect(printLbl.mock.calls[0]?.[0]).toBe('spooler://LBL');
    expect(printWay).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '송장 프린터 테스트 인쇄' }));
    expect(printWay.mock.calls[0]?.[0]).toBe('spooler://WAY');
    expect(printLbl).toHaveBeenCalledTimes(1);
  });
});
