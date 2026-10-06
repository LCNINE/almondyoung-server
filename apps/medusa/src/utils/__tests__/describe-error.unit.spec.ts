import { describeError } from '../describe-error';

describe('describeError', () => {
  it('Medusa 워크플로가 던지는 평범한 객체의 message 를 읽는다 — «[object Object]» 가 아니다', () => {
    expect(describeError({ message: '캡처 잔액 부족', name: 'Error' })).toBe('캡처 잔액 부족');
  });
  it('Error 는 message, 문자열은 그대로, 나머지는 JSON 으로', () => {
    expect(describeError(new Error('e'))).toBe('e');
    expect(describeError('s')).toBe('s');
    expect(describeError({ code: 1 })).toBe('{"code":1}');
  });
});
