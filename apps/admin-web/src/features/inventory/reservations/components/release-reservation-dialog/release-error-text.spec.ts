import { CustomError } from '@/lib/api/customError';
import { releaseErrorText } from './release-error-text';

const FALLBACK = '예약 해제에 실패했습니다.';

describe('releaseErrorText', () => {
  it('shows the server reason for a 409', () => {
    expect(
      releaseErrorText(
        new CustomError({
          message: '작업이 시작된 상자의 예약은 풀 수 없습니다',
          statusCode: 409,
        }),
      ),
    ).toBe('작업이 시작된 상자의 예약은 풀 수 없습니다');
  });

  it('falls back for other statuses, empty messages and non-errors', () => {
    expect(
      releaseErrorText(new CustomError({ message: 'Internal', statusCode: 500 })),
    ).toBe(FALLBACK);
    expect(
      releaseErrorText(new CustomError({ message: '', statusCode: 409 })),
    ).toBe(FALLBACK);
    expect(releaseErrorText('boom')).toBe(FALLBACK);
  });
});
