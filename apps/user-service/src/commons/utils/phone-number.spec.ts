import { isKoreanMobileNumber, phoneNumberDigits } from './phone-number';

// Twilio Lookup 을 대체하는 검증이다. 여기가 느슨하면 잘못된 번호로 발송이 나가고, 빡빡하면
// 정상 사용자가 가입을 못 한다.
describe('isKoreanMobileNumber', () => {
  it.each([
    ['+821079323639', 'E.164'],
    ['01079323639', '숫자 로컬'],
    ['010-7932-3639', '하이픈 로컬'],
    ['011-234-5678', '10자리 구형 번호'],
    ['01612345678', '016 국번'],
  ])('%s (%s) 은 통과한다', (input) => {
    expect(isKoreanMobileNumber(input)).toBe(true);
  });

  it.each([
    ['0212345678', '지역번호(유선)'],
    ['0212345', '너무 짧음'],
    ['010123456789', '너무 김'],
    ['01212345678', '없는 국번 012'],
    ['', '빈 문자열'],
    ['+14155552671', '해외 번호'],
  ])('%s (%s) 은 거른다', (input) => {
    expect(isKoreanMobileNumber(input)).toBe(false);
  });
});

describe('phoneNumberDigits', () => {
  it('국가번호를 떼고 로컬 표기로 통일한다', () => {
    expect(phoneNumberDigits('+821079323639')).toBe('01079323639');
    expect(phoneNumberDigits('010-7932-3639')).toBe('01079323639');
    expect(phoneNumberDigits('01079323639')).toBe('01079323639');
  });
});
