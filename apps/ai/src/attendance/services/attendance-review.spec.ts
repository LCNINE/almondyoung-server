import { parseAttendanceReview } from './attendance-review.service';

describe('attendance AI output boundary', () => {
  it('accepts a review summary without an attachment or automatic decision', () => {
    const review = {
      summary: '위치 권한 오류로 출근 기록이 누락되었다는 요청입니다.',
      evidence: [],
      questions: ['실제 근무 시각을 확인해 주세요.'],
      opinion: 'needs_information',
    };

    expect(parseAttendanceReview(JSON.stringify(review))).toEqual(review);
  });

  it('rejects approvals or invented decision fields', () => {
    expect(() =>
      parseAttendanceReview(JSON.stringify({ summary: '승인', evidence: [], questions: [], opinion: 'approved' })),
    ).toThrow();

    expect(() =>
      parseAttendanceReview(
        JSON.stringify({ summary: '요청', evidence: [], questions: [], opinion: 'reviewable', approve: true }),
      ),
    ).toThrow();
  });
});
