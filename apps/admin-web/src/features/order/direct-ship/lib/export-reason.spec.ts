import { exportReasonError } from './export-reason';

const MESSAGE = '사유를 5~200자로 적어 주세요.';

describe('exportReasonError', () => {
  it('trim 뒤 4자는 막는다', () => {
    expect(exportReasonError(' 넷글자임 ')).toBe(MESSAGE);
    expect(exportReasonError('  넷글자 ')).toBe(MESSAGE);
  });
  it('빈 문자열은 막는다', () => {
    expect(exportReasonError('')).toBe(MESSAGE);
    expect(exportReasonError('     ')).toBe(MESSAGE);
  });
  it('5자 이상이면 통과', () => {
    expect(exportReasonError('입점사 발송 요청')).toBeNull();
    expect(exportReasonError('다섯글자요')).toBeNull();
  });
  it('200자까지 통과, 201자는 막는다', () => {
    expect(exportReasonError('가'.repeat(200))).toBeNull();
    expect(exportReasonError('가'.repeat(201))).toBe(MESSAGE);
  });
});
