import { planCode128 } from './code128';

describe('planCode128', () => {
  it('홀수 길이 숫자는 첫 자리를 B 로 찍고 쌍은 Code C 로 접는다', () => {
    expect(planCode128('11198120000')).toEqual({ zplData: '>:1>51198120000', modules: 112 });
  });

  it('짝수 길이 앞 숫자 구간(4 이상)은 Start C', () => {
    expect(planCode128('1119812000')?.zplData).toBe('>;1119812000');
  });

  it('짧은 숫자 구간이 낀 문자열은 B 로 둔다', () => {
    expect(planCode128('A-01-01')?.zplData).toBe('>:A-01-01');
    expect(planCode128('A-01-01')?.modules).toBe(11 * (1 + 7 + 1) + 13);
  });

  it('13자리 숫자는 B 한 자리 + 전환 + 쌍 6개', () => {
    expect(planCode128('8801234567890')?.zplData).toBe('>:8>5801234567890');
    expect(planCode128('8801234567890')?.modules).toBe(11 * (1 + 1 + 1 + 6 + 1) + 13);
  });

  it('끝의 4자리 이상 숫자는 C 로 바꾼다', () => {
    expect(planCode128('AB1234')?.zplData).toBe('>:AB>51234');
  });

  it('중간의 홀수 숫자 구간(6자리 이상)은 첫 자리를 B 로 찍고 바꾼다', () => {
    expect(planCode128('A1234567-')?.zplData).toBe('>:A1>5234567>6-');
  });

  it('데이터가 숫자 둘뿐이면 Start C', () => {
    expect(planCode128('12')?.zplData).toBe('>;12');
  });

  it("'>' 는 '>0' 로 이스케이프한다", () => {
    expect(planCode128('a>b')?.zplData).toBe('>:a>0b');
  });

  it('지원하지 않는 글자·빈 문자열은 null', () => {
    expect(planCode128('M-07-꼭대기')).toBeNull();
    expect(planCode128('AB^C')).toBeNull();
    expect(planCode128('A~')).toBeNull();
    expect(planCode128('')).toBeNull();
  });
});
