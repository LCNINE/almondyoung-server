import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryPrefs } from '../../data/devicePrefs';
import {
  LABEL_PRINTER_KEY,
  PrinterError,
  printRaw,
  printerNameOf,
  readLabelPrinter,
  writeLabelPrinter,
} from './labelPrinter';
import { lastPrintFailed } from './printerStatus';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('라벨 프린터 설정', () => {
  it('이름을 spooler:// target 으로 저장하고 되읽는다', () => {
    const prefs = createMemoryPrefs();
    writeLabelPrinter(prefs, 'XP-DT108B');
    expect(prefs.get(LABEL_PRINTER_KEY)).toBe('spooler://XP-DT108B');
    expect(readLabelPrinter(prefs)).toBe('spooler://XP-DT108B');
  });

  it('앞뒤 공백을 지운다', () => {
    const prefs = createMemoryPrefs();
    writeLabelPrinter(prefs, '  XP-DT108B  ');
    expect(readLabelPrinter(prefs)).toBe('spooler://XP-DT108B');
  });

  it('이미 spooler:// 를 붙여 넣어도 접두어를 겹치지 않는다', () => {
    const prefs = createMemoryPrefs();
    writeLabelPrinter(prefs, ' spooler://XP-DT108B ');
    expect(readLabelPrinter(prefs)).toBe('spooler://XP-DT108B');
  });

  it('빈 이름이면 설정을 지운다', () => {
    const prefs = createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://OLD' });
    writeLabelPrinter(prefs, '   ');
    expect(readLabelPrinter(prefs)).toBeNull();
  });

  it('설정이 없으면 null', () => {
    expect(readLabelPrinter(createMemoryPrefs())).toBeNull();
  });

  it('printerNameOf 는 입력칸에 되돌릴 이름만 준다', () => {
    expect(printerNameOf('spooler://XP-DT108B')).toBe('XP-DT108B');
    expect(printerNameOf('')).toBe('');
  });
});

describe('printRaw', () => {
  beforeEach(() => invokeMock.mockReset());

  it('텍스트를 바이트 배열로 print_raw 에 넘긴다', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await printRaw('spooler://XP', '^XA');
    expect(invokeMock).toHaveBeenCalledWith('print_raw', {
      target: 'spooler://XP',
      data: [94, 88, 65],
    });
  });

  it('invoke 실패는 원문을 보존한 PrinterError 로 감싼다', async () => {
    invokeMock.mockRejectedValueOnce('OpenPrinterW failed: 1801');
    const error = await printRaw('spooler://XP', '^XA').catch((e) => e);
    expect(error).toBeInstanceOf(PrinterError);
    expect((error as PrinterError).detail).toBe('OpenPrinterW failed: 1801');
  });
});

describe('출력 결과 기록(상태바 «프린터»)', () => {
  beforeEach(() => invokeMock.mockReset());

  it('보내지 못하면 실패로, 보내면 성공으로 남는다', async () => {
    invokeMock.mockRejectedValueOnce('spooler offline');
    await expect(printRaw('spooler://P', '^XA^XZ')).rejects.toBeInstanceOf(PrinterError);
    expect(lastPrintFailed()).toBe(true);
    invokeMock.mockResolvedValueOnce(undefined);
    await printRaw('spooler://P', '^XA^XZ');
    expect(lastPrintFailed()).toBe(false);
  });

  it('프린터 설정을 바꾸면 옛 프린터의 실패는 지운다', async () => {
    invokeMock.mockRejectedValueOnce('spooler offline');
    await expect(printRaw('spooler://P', '^XA^XZ')).rejects.toBeInstanceOf(PrinterError);
    writeLabelPrinter(createMemoryPrefs(), 'XP-DT108B');
    expect(lastPrintFailed()).toBe(false);
  });
});
