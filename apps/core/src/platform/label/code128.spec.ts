import { planCode128 } from './code128';

describe('planCode128', () => {
  it('숫자 쌍을 Code C 로 접고 남는 한 자리는 B 로 찍는다', () => {
    expect(planCode128('11198120000')).toEqual({ zplData: '>;1119812000>60', modules: 112 });
  });

  it('짧은 숫자 구간이 낀 문자열은 B 로 둔다', () => {
    expect(planCode128('A-01-01')?.zplData).toBe('>:A-01-01');
    expect(planCode128('A-01-01')?.modules).toBe(11 * (1 + 7 + 1) + 13);
  });

  it('13자리 숫자는 쌍 6개와 B 한 자리', () => {
    expect(planCode128('8801234567890')?.modules).toBe(11 * (1 + 6 + 1 + 1 + 1) + 13);
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

  it("'>' 는 '><' 로 이스케이프한다", () => {
    expect(planCode128('a>b')?.zplData).toBe('>:a><b');
  });

  it('지원하지 않는 글자·빈 문자열은 null', () => {
    expect(planCode128('M-07-꼭대기')).toBeNull();
    expect(planCode128('AB^C')).toBeNull();
    expect(planCode128('A~')).toBeNull();
    expect(planCode128('')).toBeNull();
  });
});
