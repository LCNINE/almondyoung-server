import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryPrefs } from '../../data/devicePrefs';
import { LABEL_PRINTER_KEY, PrinterError } from './labelPrinter';
import { LabelPrinterSettings } from './LabelPrinterSettings';

describe('LabelPrinterSettings', () => {
  it('저장된 이름을 입력칸에 보여준다', () => {
    const prefs = createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP-DT108B' });
    render(<LabelPrinterSettings prefs={prefs} print={vi.fn()} />);
    expect(screen.getByLabelText('라벨 프린터 이름')).toHaveValue('XP-DT108B');
  });

  it('저장하면 spooler:// target 으로 남는다', async () => {
    const prefs = createMemoryPrefs();
    render(<LabelPrinterSettings prefs={prefs} print={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('라벨 프린터 이름'), 'XP-DT108B');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(prefs.get(LABEL_PRINTER_KEY)).toBe('spooler://XP-DT108B');
    expect(screen.getByRole('status')).toHaveTextContent('저장했어요');
  });

  it('테스트 인쇄는 입력값을 저장하고 그 target 으로 ZPL 을 보낸다', async () => {
    const prefs = createMemoryPrefs();
    const print = vi.fn(async () => {});
    render(<LabelPrinterSettings prefs={prefs} print={print} />);
    await userEvent.type(screen.getByLabelText('라벨 프린터 이름'), 'XP');
    await userEvent.click(screen.getByRole('button', { name: '테스트 인쇄' }));
    expect(prefs.get(LABEL_PRINTER_KEY)).toBe('spooler://XP');
    expect(print).toHaveBeenCalledTimes(1);
    const [target, text] = print.mock.calls[0] as unknown as [string, string];
    expect(target).toBe('spooler://XP');
    expect(text.startsWith('^XA')).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent('테스트 라벨을 보냈어요');
  });

  it('이름 없이 테스트 인쇄하면 안내만 한다', async () => {
    const print = vi.fn(async () => {});
    render(<LabelPrinterSettings prefs={createMemoryPrefs()} print={print} />);
    await userEvent.click(screen.getByRole('button', { name: '테스트 인쇄' }));
    expect(print).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('라벨 프린터가 설정되지 않았어요');
  });

  it('프린터 실패는 현장 문구와 원문을 함께 보인다', async () => {
    const print = vi.fn(async () => {
      throw new PrinterError('OpenPrinterW failed: 1801');
    });
    render(<LabelPrinterSettings prefs={createMemoryPrefs()} print={print} />);
    await userEvent.type(screen.getByLabelText('라벨 프린터 이름'), 'WRONG');
    await userEvent.click(screen.getByRole('button', { name: '테스트 인쇄' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('프린터로 보내지 못했어요');
    expect(alert).toHaveTextContent('OpenPrinterW failed: 1801');
  });

  it('같은 틱에 두 번 눌러도 테스트 라벨은 한 장만 보낸다', async () => {
    let release: () => void = () => {};
    const print = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const prefs = createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP' });
    render(<LabelPrinterSettings prefs={prefs} print={print} />);
    const button = screen.getByRole('button', { name: '테스트 인쇄' });
    // 한 act 안에서 연달아 누르면 busy state 가 반영되기 전이라 disabled 로는 못 막는다.
    await act(async () => {
      button.click();
      button.click();
    });
    release();
    expect(await screen.findByRole('status')).toHaveTextContent('테스트 라벨을 보냈어요');
    expect(print).toHaveBeenCalledTimes(1);
  });
});
