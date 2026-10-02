import { ConfigService } from '@nestjs/config';
import { BadRequestError } from '@app/shared';
import { LogoContestPeriodService } from './logo-contest-period.service';
import { authorNickname } from '../mappers/author-nickname';

const configOf = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('LogoContestPeriodService', () => {
  it('KST 오프셋을 붙인 설정값을 UTC 로 해석한다', () => {
    const period = new LogoContestPeriodService(
      configOf({
        LOGO_CONTEST_STARTS_AT: '2026-10-01T00:00:00+09:00',
        LOGO_CONTEST_ENDS_AT: '2026-10-30T23:59:59+09:00',
      }),
    );

    expect(period.startsAt.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(period.endsAt.toISOString()).toBe('2026-10-30T14:59:59.000Z');
  });

  it('기간 경계에서 열림/마감을 가른다', () => {
    const period = new LogoContestPeriodService(
      configOf({
        LOGO_CONTEST_STARTS_AT: '2026-10-01T00:00:00+09:00',
        LOGO_CONTEST_ENDS_AT: '2026-10-30T23:59:59+09:00',
      }),
    );

    expect(period.isOpen(new Date('2026-09-30T14:59:59Z'))).toBe(false);
    expect(period.isOpen(new Date('2026-09-30T15:00:00Z'))).toBe(true);
    expect(period.isOpen(new Date('2026-10-30T14:59:59Z'))).toBe(true);
    expect(period.isOpen(new Date('2026-10-30T15:00:00Z'))).toBe(false);

    expect(period.isClosed(new Date('2026-10-30T14:59:59Z'))).toBe(false);
    expect(period.isClosed(new Date('2026-10-30T15:00:00Z'))).toBe(true);

    expect(() => period.assertOpen(new Date('2026-09-01T00:00:00Z'))).toThrow(BadRequestError);
    expect(() => period.assertOpen(new Date('2026-11-01T00:00:00Z'))).toThrow(BadRequestError);
    expect(() => period.assertOpen(new Date('2026-10-15T00:00:00Z'))).not.toThrow();
  });

  it('설정값이 깨져도 기본 기간으로 돌아간다', () => {
    const period = new LogoContestPeriodService(configOf({ LOGO_CONTEST_STARTS_AT: '언젠가' }));

    expect(period.startsAt.toISOString()).toBe('2026-09-27T15:00:00.000Z');
  });
});

describe('authorNickname', () => {
  it('같은 출품작은 늘 같은 닉네임이고 실명과 무관하다', () => {
    const id = '0b6f3c1e-2d4a-4f7e-9a1b-3c5d7e9f1a2b';

    expect(authorNickname(id)).toBe(authorNickname(id));
    expect(authorNickname(id)).toMatch(/^\S+ \S+ #\d{1,2}$/);
    expect(authorNickname(id)).not.toBe(authorNickname('1c7a4d2f-3e5b-4a8f-8b2c-4d6e8f0a2b3c'));
  });
});
