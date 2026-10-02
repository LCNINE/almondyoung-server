import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Barcode } from './Barcode';
import { CommandSheetScreen } from './CommandSheetScreen';
import { COMMAND_SHEET_SECTIONS, SHEET_DIGITS } from './commandSheet';

describe('Barcode', () => {
  it('연속한 1 을 막대 하나로, 좌우 10모듈 여백을 두고 그린다', () => {
    const { container } = render(<Barcode bits="1101" label="t" />);
    const bars = [...container.querySelectorAll('rect[fill="#000"]')].map((r) => [r.getAttribute('x'), r.getAttribute('width')]);
    expect(bars).toEqual([
      ['10', '2'],
      ['13', '1'],
    ]);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 64');
  });
});

describe('CommandSheetScreen', () => {
  it('절마다 명령 바코드를, 끝에 숫자 10개를 그리고 인쇄는 OS 대화상자를 연다', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<CommandSheetScreen />);
    const actionCount = COMMAND_SHEET_SECTIONS.reduce((n, s) => n + s.actions.length, 0);
    expect(screen.getAllByRole('img')).toHaveLength(actionCount + SHEET_DIGITS.length);
    for (const section of COMMAND_SHEET_SECTIONS)
      expect(screen.getByRole('heading', { name: section.title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '인쇄' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});
