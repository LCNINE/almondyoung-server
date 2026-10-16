import { validateCorrection, assertDecisionAllowed } from './attendance-request.manager';

describe('attendance correction boundaries', () => {
  it('accepts optional attachments and preserves multiline reasons', () => {
    const reason = '위치 확인 실패\n13시에 실제 출근했어요.';
    expect(
      validateCorrection(
        { workDate: '2026-10-15', checkIn: '2026-10-15T04:00:00Z', reason, fileIds: [] },
        new Date('2026-10-16T00:00:00Z'),
      ).reason,
    ).toBe(reason);
  });

  it.each([
    { workDate: '2026-10-15', checkIn: 'invalid', reason: '사유' },
    { workDate: '2026-10-15', checkIn: '2026-10-15T04:00:00Z', reason: '  ' },
    { workDate: '2026-10-15', checkIn: '2026-10-15T04:00:00Z', checkOut: '2026-10-15T03:00:00Z', reason: '사유' },
    { workDate: '2026-10-14', checkIn: '2026-10-15T04:00:00Z', reason: '사유' },
  ])('rejects unusable corrections %#', (value) => {
    expect(() => validateCorrection(value, new Date('2026-10-16T00:00:00Z'))).toThrow();
  });

  it('rejects stale, completed, and non-master decisions, but permits master self approval', () => {
    expect(() => assertDecisionAllowed(['admin'], 'pending', 1, 1)).toThrow();
    expect(() => assertDecisionAllowed(['master'], 'approved', 1, 1)).toThrow();
    expect(() => assertDecisionAllowed(['master'], 'pending', 2, 1)).toThrow();
    expect(() => assertDecisionAllowed(['master'], 'pending', 1, 1)).not.toThrow();
  });
});
