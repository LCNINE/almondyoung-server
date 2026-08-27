import { qwertyToHangul, toJamo } from './text.utils';

describe('toJamo', () => {
  it('한글 음절을 초성/중성/종성으로 편다', () => {
    expect(toJamo('롤러킹')).toBe('ㄹㅗㄹㄹㅓㅋㅣㅇ');
    expect(toJamo('가')).toBe('ㄱㅏ');
  });

  it('겹받침과 이중모음까지 끝까지 편다 — 영타를 되돌린 자모 배열과 맞추기 위함이다', () => {
    // "값" 을 자판으로 치면 rkqt(ㄱㅏㅂㅅ) 라서 ㅄ 로 합치면 안 맞는다.
    expect(toJamo('값')).toBe('ㄱㅏㅂㅅ');
    expect(toJamo('과')).toBe('ㄱㅗㅏ');
  });

  it('오타는 자모 1개 차이로만 벌어진다 — 이게 fuzziness=1 이 먹는 근거다', () => {
    const distance = (a: string, b: string): number => {
      const rows = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
      );
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          rows[i][j] = Math.min(
            rows[i - 1][j] + 1,
            rows[i][j - 1] + 1,
            rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
          );
        }
      }
      return rows[a.length][b.length];
    };

    // 완성형에서는 첫 글자가 통째로 다르지만, 자모로 펴면 중성 하나만 다르다.
    expect(distance('롤러킹', '룰러킹')).toBe(1);
    expect(distance(toJamo('롤러킹'), toJamo('룰러킹'))).toBe(1);
    expect(distance(toJamo('가나슈'), toJamo('거나슈'))).toBe(1);
    expect(distance(toJamo('거치대'), toJamo('가치대'))).toBe(1);

    // 자모 문자열이 길어지는 것이 핵심 — 편집거리 1 이 전체 대비 훨씬 엄격해진다.
    expect(toJamo('롤러킹').length).toBe(8);
  });

  // 같은 글자를 두 가지로 표현할 수 있다. macOS 파일시스템이 NFD 를 쓰기 때문에
  // 편집 환경에 따라 테스트 결과가 갈렸다 — es-hangul 은 NFD 를 음절로 못 알아본다.
  it('NFD 로 들어와도 NFC 와 같은 자모를 낸다', () => {
    for (const word of ['값', '갃', '롤러킹', '퍼마 색소']) {
      expect(toJamo(word.normalize('NFD'))).toBe(toJamo(word.normalize('NFC')));
    }
    // 정규화가 없으면 여기가 "값" 그대로 나와서 자모 매칭이 통째로 빗나간다.
    expect(toJamo('값'.normalize('NFD'))).toBe('ㄱㅏㅂㅅ');
  });

  it('한글이 아닌 문자는 소문자로 보존하고 공백은 유지한다', () => {
    expect(toJamo('Perma Blend')).toBe('perma blend');
    expect(toJamo('퍼마 색소')).toBe('ㅍㅓㅁㅏ ㅅㅐㄱㅅㅗ');
    expect(toJamo('3D 젤')).toBe('3d ㅈㅔㄹ');
  });

  it('빈 문자열을 안전하게 처리한다 — brand 가 null 인 상품이 있다', () => {
    expect(toJamo('')).toBe('');
  });
});

describe('qwertyToHangul', () => {
  it('영타로 친 한글을 되돌린다', () => {
    expect(qwertyToHangul('tpwp')).toBe('세제');
    expect(qwertyToHangul('vjak')).toBe('퍼마');
  });

  it('이미 한글인 검색어는 교정으로 치지 않는다', () => {
    expect(qwertyToHangul('세제')).toBe('');
    expect(qwertyToHangul('퍼마 색소')).toBe('');
  });

  it('진짜 영문은 교정하지 않는다', () => {
    expect(qwertyToHangul('Perma')).toBe('');
    expect(qwertyToHangul('3D')).toBe('');
  });

  it('조합 불가능한 자모가 나오는 영문도 던지지 않고 빈 문자열을 준다', () => {
    // 라이브 500 을 낸 실제 검색어들 — es-hangul 이 "Invalid hangul Characters" 로 터졌다.
    expect(qwertyToHangul('elationpassport')).toBe('');
    expect(qwertyToHangul('how to heal stiff muscles')).toBe('');
    expect(qwertyToHangul('hotel tales')).toBe('');
  });
});
