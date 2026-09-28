import { BadRequestError } from '@app/shared';
import { kstDayRange } from './user-notification-history.reader';

describe('kstDayRange', () => {
  it('KST 하루를 UTC 로 [00:00, 다음날 00:00) 로 바꾼다', () => {
    const { start, end } = kstDayRange('2026-09-15', '2026-09-15');
    expect(start.toISOString()).toBe('2026-09-14T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-15T15:00:00.000Z');
  });

  it('30일 차이까지는 받는다', () => {
    expect(() => kstDayRange('2026-08-16', '2026-09-15')).not.toThrow();
  });

  it('30일을 넘으면 거절한다', () => {
    expect(() => kstDayRange('2026-08-15', '2026-09-15')).toThrow(BadRequestError);
  });

  it('종료일이 시작일보다 앞서면 거절한다', () => {
    expect(() => kstDayRange('2026-09-15', '2026-09-14')).toThrow(BadRequestError);
  });
});
