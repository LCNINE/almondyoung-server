import {
  ADMIN_REVIEW_AUTHOR_MAX,
  buildAdminReviewPayload,
  emptyAdminReviewForm,
  kstToday,
  toWrittenAtIso,
  type AdminReviewFormValues,
} from './admin-review-form';

const NOW = new Date('2026-09-30T03:00:00.000Z'); // KST 2026-09-30 12:00

const filled = (over: Partial<AdminReviewFormValues> = {}): AdminReviewFormValues => ({
  productId: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  authorName: '홍길동',
  writtenDate: '2026-09-01',
  rating: 5,
  content: '향이 좋아요.',
  mediaFileIds: [],
  ...over,
});

describe('kstToday', () => {
  it('UTC 15:00 이 KST 날짜 경계다', () => {
    expect(kstToday(new Date('2026-09-30T14:59:59.999Z'))).toBe('2026-09-30');
    expect(kstToday(new Date('2026-09-30T15:00:00.000Z'))).toBe('2026-10-01');
  });
});

describe('toWrittenAtIso', () => {
  it('달력 날짜를 KST 자정 시각으로 보낸다', () => {
    expect(toWrittenAtIso('2026-09-01')).toBe('2026-09-01T00:00:00+09:00');
  });
});

describe('emptyAdminReviewForm', () => {
  it('작성일 기본값은 KST 오늘이다', () => {
    expect(emptyAdminReviewForm(NOW)).toEqual({
      productId: null,
      authorName: '',
      writtenDate: '2026-09-30',
      rating: null,
      content: '',
      mediaFileIds: [],
    });
  });
});

describe('buildAdminReviewPayload', () => {
  it('정상 입력은 서버 계약 모양으로 바꾼다 (작성자명 trim, 본문은 그대로)', () => {
    expect(buildAdminReviewPayload(filled({ authorName: '  홍길동 ', content: ' 원문 그대로 ' }), NOW)).toEqual({
      ok: true,
      payload: {
        productId: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
        authorName: '홍길동',
        writtenAt: '2026-09-01T00:00:00+09:00',
        rating: 5,
        content: ' 원문 그대로 ',
        mediaFileIds: [],
      },
    });
  });

  it.each<[string, Partial<AdminReviewFormValues>, string]>([
    ['상품 미선택', { productId: null }, 'productId'],
    ['작성자명 공백', { authorName: '   ' }, 'authorName'],
    ['작성자명 초과', { authorName: '가'.repeat(ADMIN_REVIEW_AUTHOR_MAX + 1) }, 'authorName'],
    ['작성일 비어 있음', { writtenDate: '' }, 'writtenDate'],
    ['작성일 미래(KST 내일)', { writtenDate: '2026-10-01' }, 'writtenDate'],
    ['별점 미선택', { rating: null }, 'rating'],
    ['본문 공백', { content: ' \n ' }, 'content'],
    ['사진 6장', { mediaFileIds: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'mediaFileIds'],
  ])('%s → %s 에서 멈춘다', (_label, over, field) => {
    const result = buildAdminReviewPayload(filled(over), NOW);
    expect(result).toEqual(expect.objectContaining({ ok: false, field }));
  });

  it('작성일이 KST 오늘이면 통과한다', () => {
    expect(buildAdminReviewPayload(filled({ writtenDate: '2026-09-30' }), NOW).ok).toBe(true);
  });
});
