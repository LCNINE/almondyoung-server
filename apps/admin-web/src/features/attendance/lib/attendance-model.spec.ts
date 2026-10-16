import {
  dateRange,
  changeLeaveType,
  changeStart,
  describeStatus,
  validateDraft,
} from './attendance-model';

describe('attendance UI models', () => {
  it('keeps working status and morning leave visible together', () => {
    expect(describeStatus('working', 'am')).toBe('근무 중 · 오전 반차');
  });

  it('keeps the normal end when the AM start changes', () => {
    const draft = changeLeaveType(
      { date: '2026-10-16', type: 'full' },
      'am',
      '10:00',
      '19:00'
    );

    expect(draft).toMatchObject({ start: '14:00', end: '19:00' });

    expect(changeStart(draft, '14:30', '19:00').end).toBe('19:00');

    expect(
      changeStart({ ...draft, end: '18:30', manualEnd: true }, '15:00', '19:00')
        .end
    ).toBe('18:30');
  });

  it('validates only the agreed time ordering', () => {
    expect(
      validateDraft({
        date: '2026-10-16',
        type: 'am',
        start: '14:00',
        end: '18:00',
      })
    ).toBeNull();

    expect(
      validateDraft({
        date: '2026-10-16',
        type: 'am',
        start: '18:00',
        end: '13:00',
      })
    ).toBeTruthy();
  });

  it('builds valid inclusive date ranges, rejects reversed and impossible dates', () => {
    expect(dateRange('2026-10-15', '2026-10-16')).toEqual([
      '2026-10-15',
      '2026-10-16',
    ]);

    expect(dateRange('2026-10-16', '2026-10-15')).toEqual([]);

    expect(dateRange('2026-02-30', '2026-03-01')).toEqual([]);
  });
});
