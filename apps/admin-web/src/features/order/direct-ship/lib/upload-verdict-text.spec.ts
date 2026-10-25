import { ROW_ERROR_TEXT, applicableCount, rowErrorText, verdictLabel } from './upload-verdict-text';

describe('verdictLabel', () => {
  it.each([
    ['ship', '발송'],
    ['merge', '합포장 발송'],
    ['unfulfillable', '못 보냄'],
    ['waiting', '아직'],
    ['correct', '송장 정정'],
    ['unchanged', '변경 없음'],
    ['error', '오류'],
  ] as const)('%s → %s', (kind, label) => {
    expect(verdictLabel(kind)).toBe(label);
  });
});

describe('rowErrorText', () => {
  it('모든 오류 코드에 빈 문자열이 아닌 문구가 있다', () => {
    const codes = Object.keys(ROW_ERROR_TEXT) as (keyof typeof ROW_ERROR_TEXT)[];
    expect(codes).toHaveLength(17);
    for (const code of codes) expect(rowErrorText(code).trim()).not.toBe('');
  });

  it('문구는 운영자용 그대로다', () => {
    expect(rowErrorText('UNKNOWN_ROW_KEY')).toBe('행 키를 찾을 수 없습니다(지웠거나 다른 파일의 줄)');
    expect(rowErrorText('GROUP_HAS_ERROR')).toBe('같은 송장의 다른 줄에 오류가 있습니다');
  });
});

describe('applicableCount', () => {
  it('쓸 줄 = 발송 + 합포장 + 정정 + 못 보냄', () => {
    expect(
      applicableCount({ ship: 1, merge: 2, unfulfillable: 1, waiting: 5, correct: 1, unchanged: 3, error: 4 })
    ).toBe(5);
  });
});
