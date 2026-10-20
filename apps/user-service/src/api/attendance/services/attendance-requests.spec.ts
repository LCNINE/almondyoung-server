import { validateCorrection, assertDecisionAllowed, AttendanceRequestManager } from './attendance-request.manager';
import type { AttendanceRepository } from '../repositories/attendance.repository';

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
    expect(() => assertDecisionAllowed(false, 'pending', 1, 1)).toThrow();

    expect(() => assertDecisionAllowed(true, 'approved', 1, 1)).toThrow();

    expect(() => assertDecisionAllowed(true, 'pending', 2, 1)).toThrow();

    expect(() => assertDecisionAllowed(true, 'pending', 1, 1)).not.toThrow();
  });

  it('rejects malformed attachment metadata as an unusable attachment', async () => {
    const previousUrl = process.env.FILE_SERVICE_URL;
    const previousKey = process.env.FILE_SERVICE_INTERNAL_KEY;

    process.env.FILE_SERVICE_URL = 'http://files.test';
    process.env.FILE_SERVICE_INTERNAL_KEY = 'test-key';

    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('null'));

    try {
      const manager = new AttendanceRequestManager({} as AttendanceRepository);

      await expect(manager.verifyFiles('owner', ['image'])).rejects.toMatchObject({ status: 400 });
    } finally {
      fetchSpy.mockRestore();

      if (previousUrl === undefined) {
        delete process.env.FILE_SERVICE_URL;
      } else {
        process.env.FILE_SERVICE_URL = previousUrl;
      }

      if (previousKey === undefined) {
        delete process.env.FILE_SERVICE_INTERNAL_KEY;
      } else {
        process.env.FILE_SERVICE_INTERNAL_KEY = previousKey;
      }
    }
  });
});
