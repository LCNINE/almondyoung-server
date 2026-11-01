import { TENANT_HEADER } from '@app/tenancy';
import { AttendanceReviewService, parseAttendanceReview } from './attendance-review.service';

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

// file-service 내부 키 라우트는 헤더 테넌트의 파일만 보고, ② 에서 헤더 없음은 403 이다.
describe('attendance evidence lookup', () => {
  const env = { ...process.env };
  let sent: Headers[];

  beforeEach(() => {
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: 'k',
      FILE_SERVICE_URL: 'http://files.test',
      FILE_SERVICE_INTERNAL_KEY: 'k',
    });
    sent = [];
    // 증빙 조회에서 멈춘다 — 모델까지 가지 않는다.
    global.fetch = ((_url: string | URL, init?: RequestInit) => {
      sent.push(new Headers(init?.headers));
      return Promise.resolve(new Response('', { status: 404 }));
    }) as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  const input = {
    requestId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    version: 1,
    reason: '누락',
    fileIds: ['00000000-0000-4000-8000-000000000003'],
  };

  it('asks file-service for the evidence in the caller tenant', async () => {
    await expect(new AttendanceReviewService().review(input, '1')).rejects.toThrow();

    expect(sent.map((h) => h.get(TENANT_HEADER))).toEqual(['1']);
  });

  it('sends no tenant header when the caller tenant is unknown (transition step one)', async () => {
    await expect(new AttendanceReviewService().review(input, null)).rejects.toThrow();

    expect(sent.map((h) => h.has(TENANT_HEADER))).toEqual([false]);
  });
});
