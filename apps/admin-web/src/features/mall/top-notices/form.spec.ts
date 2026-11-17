import {
  EMPTY_TOP_NOTICE_FORM,
  topNoticeDisplayState,
  topNoticeFormFromDto,
  topNoticeFormToCreateDto,
  topNoticeFormToUpdateDto,
  validateTopNoticeForm,
  type TopNoticeFormValue,
} from './form';
import type { TopNoticeDto } from '@/lib/types/dto/products';

function makeForm(overrides: Partial<TopNoticeFormValue> = {}): TopNoticeFormValue {
  return { ...EMPTY_TOP_NOTICE_FORM, text: '5만원 이상 무료배송', ...overrides };
}

function makeDto(overrides: Partial<TopNoticeDto> = {}): TopNoticeDto {
  return {
    id: 'top-notice-1',
    text: '5만원 이상 무료배송',
    linkUrl: null,
    displayStartAt: null,
    displayEndAt: null,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('validateTopNoticeForm', () => {
  it('문구가 비면 막는다', () => {
    expect(validateTopNoticeForm(makeForm({ text: '   ' }))).not.toBeNull();
  });

  it('120자를 넘는 문구를 막는다', () => {
    expect(validateTopNoticeForm(makeForm({ text: '가'.repeat(121) }))).not.toBeNull();
    expect(validateTopNoticeForm(makeForm({ text: '가'.repeat(120) }))).toBeNull();
  });

  it('위험한 링크를 막고 사이트 내 경로와 http(s) 는 통과시킨다', () => {
    expect(validateTopNoticeForm(makeForm({ linkUrl: 'javascript:alert(1)' }))).not.toBeNull();
    expect(validateTopNoticeForm(makeForm({ linkUrl: '//evil.com' }))).not.toBeNull();
    expect(validateTopNoticeForm(makeForm({ linkUrl: '/cs/notice/abc' }))).toBeNull();
    expect(validateTopNoticeForm(makeForm({ linkUrl: 'https://example.com' }))).toBeNull();
  });

  it('종료가 시작보다 앞서면 막는다', () => {
    expect(
      validateTopNoticeForm(makeForm({ displayStartAt: '2026-12-01T00:00', displayEndAt: '2026-11-01T00:00' }))
    ).not.toBeNull();
  });
});

describe('topNotice 폼 변환', () => {
  it('등록은 빈 값을 보내지 않는다', () => {
    expect(topNoticeFormToCreateDto(makeForm({ text: ' 안내 ' }))).toEqual({
      text: '안내',
      linkUrl: undefined,
      displayStartAt: undefined,
      displayEndAt: undefined,
      isActive: true,
      sortOrder: 0,
    });
  });

  it('수정은 비운 링크와 기간을 null 로 보낸다', () => {
    expect(topNoticeFormToUpdateDto(makeForm({ sortOrder: '3' }))).toMatchObject({
      linkUrl: null,
      displayStartAt: null,
      displayEndAt: null,
      sortOrder: 3,
    });
  });

  it('응답을 폼 값으로 되돌린다', () => {
    expect(topNoticeFormFromDto(makeDto({ linkUrl: '/events/1', sortOrder: 2 }))).toMatchObject({
      linkUrl: '/events/1',
      sortOrder: '2',
    });
  });
});

describe('topNoticeDisplayState', () => {
  const now = new Date('2026-11-06T00:00:00.000Z').getTime();

  it('기간 전·중·후와 미사용을 구별한다', () => {
    expect(topNoticeDisplayState(makeDto({ isActive: false }), now).label).toBe('미사용');
    expect(topNoticeDisplayState(makeDto({ displayStartAt: '2026-11-10T00:00:00.000Z' }), now).label).toBe('예약됨');
    expect(topNoticeDisplayState(makeDto({ displayEndAt: '2026-11-01T00:00:00.000Z' }), now).label).toBe('종료됨');
    expect(topNoticeDisplayState(makeDto(), now).label).toBe('노출 중');
  });
});
