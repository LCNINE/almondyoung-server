import { textWidthMm } from '../../../label/svg-text';
import { koreanDate, rect, shrinkThenFit, svgDocument, text, wrapLines } from './hanjin-label-svg';

describe('hanjin-label-svg', () => {
  it('text: pt → mm 글자 크기, 굵기·정렬, 이스케이프', () => {
    expect(text({ x: 1, y: 2, pt: 10, text: 'A<B', bold: true, anchor: 'end' })).toBe(
      '<text x="1" y="2" font-size="3.53" font-weight="700" text-anchor="end">A&lt;B</text>',
    );
  });
  it('rect: 테두리만 0.4mm', () => {
    expect(rect(1, 2, 3, 4)).toBe(
      '<rect x="1" y="2" width="3" height="4" fill="none" stroke="#000" stroke-width="0.4"/>',
    );
  });
  it('koreanDate', () => {
    expect(koreanDate('2026-09-28')).toBe('2026년 09월 28일');
  });
  it('shrinkThenFit: 들어가면 원래 크기, 넘치면 먼저 줄이고 그래도 넘치면 자른다(최소 7pt)', () => {
    expect(shrinkThenFit('가나다', 50, 10)).toEqual({ pt: 10, text: '가나다' });
    const shrunk = shrinkThenFit('가'.repeat(15), 40, 10);
    expect(shrunk.pt).toBeLessThan(10);
    expect(shrunk.text).toBe('가'.repeat(15));
    const cut = shrinkThenFit('가'.repeat(100), 40, 10);
    expect(cut.pt).toBe(7);
    expect(cut.text.endsWith('…')).toBe(true);
  });
  describe('wrapLines — 좁은 칸에서 자르면 곤란한 자유 텍스트(FS ⑭)를 여러 줄로', () => {
    it('한 줄에 들어가면 그대로 한 줄', () => {
      expect(wrapLines('문앞에 두세요', 60, 9, 2)).toEqual(['문앞에 두세요']);
    });
    it('넘치면 칸 안에서 마지막 공백에서 끊는다 — 글자를 잃지 않는다', () => {
      const msg = '부재 시 경비실에 맡겨 주세요. 파손 주의 (공동현관 #1234)';
      const lines = wrapLines(msg, 62.95, 9, 2); // FS ⑭ 칸 폭
      expect(lines).toEqual(['부재 시 경비실에 맡겨 주세요. 파손 주의', '(공동현관 #1234)']);
      for (const l of lines) expect(textWidthMm(l, 9)).toBeLessThanOrEqual(62.95);
    });
    it('공백이 없으면 글자 단위로 끊는다', () => {
      // 9pt 한글 한 자 ≈ 3.02mm → 30mm 칸에 9자. 15자는 9 + 6.
      const lines = wrapLines('가'.repeat(15), 30, 9, 2);
      expect(lines).toEqual(['가'.repeat(9), '가'.repeat(6)]);
    });
    it('maxLines 를 넘치는 나머지는 마지막 줄에서 말줄임', () => {
      const lines = wrapLines('가'.repeat(100), 30, 9, 2);
      expect(lines).toHaveLength(2);
      expect(lines[1].endsWith('…')).toBe(true);
      for (const l of lines) expect(textWidthMm(l, 9)).toBeLessThanOrEqual(30);
    });
    it('빈 문자열은 빈 한 줄', () => {
      expect(wrapLines('', 30, 9, 2)).toEqual(['']);
    });
  });

  it('svgDocument: mm viewBox·나눔고딕, 블록은 순서대로 <g id>', () => {
    expect(
      svgDocument(100, 102, [
        ['a', ['<x/>']],
        ['b', ['<y/>', '<z/>']],
      ]),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="102mm" viewBox="0 0 100 102" font-family="NanumGothic">' +
        '<g id="a"><x/></g><g id="b"><y/><z/></g></svg>',
    );
  });
});
