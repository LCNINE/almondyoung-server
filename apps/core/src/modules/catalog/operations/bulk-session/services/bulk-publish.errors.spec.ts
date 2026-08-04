import { classifyPublishError } from './bulk-publish.errors';

describe('classifyPublishError', () => {
  it('variantCode 중복을 품목코드 문구로 옮긴다', () => {
    const error = new Error('Duplicate variantCode in version 9f0…: SKU-1, SKU-2');
    expect(classifyPublishError(error)).toBe('품목코드가 다른 상품과 중복됩니다: SKU-1, SKU-2');
  });

  it('productCode 중복을 상품코드 문구로 옮긴다', () => {
    const error = new Error('productCode AB-100 is already used by another active product');
    expect(classifyPublishError(error)).toBe('상품코드를 이미 사용 중인 다른 상품이 있습니다: AB-100');
  });

  it('길이 초과(22001)를 안내 문구로 옮긴다', () => {
    const error = new Error('value too long for type character varying(200)');
    expect(classifyPublishError(error)).toBe('입력한 값이 저장할 수 있는 길이(200자)를 넘었습니다.');
  });

  it('가격 검증 실패를 안내 문구로 옮긴다', () => {
    const error = new Error('Invalid calculated prices: \nVariant a: base price is -100 (must be >= 0)');
    expect(classifyPublishError(error)).toBe('계산된 판매가가 올바르지 않습니다. 가격 설정을 확인해 주세요.');
  });

  it('한국어 도메인 예외는 그대로 통과시킨다', () => {
    const error = new Error('기준이 변경되었습니다. 양식을 다시 받아 작업해 주세요.');
    expect(classifyPublishError(error)).toBe('기준이 변경되었습니다. 양식을 다시 받아 작업해 주세요.');
  });

  it('모르는 오류는 안내 + 잘라낸 원문을 함께 준다', () => {
    const error = new Error('ECONNRESET');
    expect(classifyPublishError(error)).toBe('발행에 실패했습니다. (원인: ECONNRESET)');
  });

  it('Error 가 아닌 것도 죽지 않는다', () => {
    expect(classifyPublishError('nope')).toBe('발행에 실패했습니다. (원인: 알 수 없는 오류)');
  });

  it('한국어 값이 섞인 영어 DB 오류는 통과시키지 않는다', () => {
    const error = new Error(
      'duplicate key value violates unique constraint "uq_x" Key (name)=(아몬드영 크림) already exists.',
    );
    expect(classifyPublishError(error)).toBe(
      '발행에 실패했습니다. (원인: duplicate key value violates unique constraint "uq_x" Key (name)=(아몬드영 크림) already exists.)',
    );
  });

  it('시트 접두가 붙은 행 오류는 그대로 통과시킨다', () => {
    const error = new Error('[조합] 같은 조합이 두 번 이상 적혀 있습니다: OV-1+OV-3');
    expect(classifyPublishError(error)).toBe('[조합] 같은 조합이 두 번 이상 적혀 있습니다: OV-1+OV-3');
  });

  // Task 6 리뷰 발견 2: purgeDrafts(정리)가 이 분류기를 재사용하는데, 폴백 문구가 "발행에
  // 실패했습니다"로 고정돼 있으면 삭제 실패를 발행 실패로 오진한다. action 두 번째 인자로
  // 문구만 갈아끼운다 — 나머지 분기는 두 번째 인자와 무관하게 공유한다(위 8건이 회귀 가드).
  it('action 인자를 생략하면 기존과 같이 "발행" 이다', () => {
    const error = new Error('ECONNRESET');
    expect(classifyPublishError(error)).toBe('발행에 실패했습니다. (원인: ECONNRESET)');
  });

  it("action 으로 '정리' 를 넘기면 폴백 문구가 '정리에 실패했습니다' 로 바뀐다", () => {
    const error = new Error('boom');
    expect(classifyPublishError(error, '정리')).toBe('정리에 실패했습니다. (원인: boom)');
  });

  // 최종 리뷰 발견 ②: draft 생성 실패(bulk-session-job.manager.ts 의 draftOne/failItem)가
  // 이 분류기를 아예 부르지 않아 예외 원문이 그대로 화면에 떴다. '생성' 액션을 추가해
  // 그 경로도 같은 분류기를 타게 한다 — 나머지 분기(길이 초과 등)는 action 과 무관하게 공유.
  it("action 으로 '생성' 을 넘기면 폴백 문구가 '생성에 실패했습니다' 로 바뀐다", () => {
    const error = new Error('boom');
    expect(classifyPublishError(error, '생성')).toBe('생성에 실패했습니다. (원인: boom)');
  });
});
