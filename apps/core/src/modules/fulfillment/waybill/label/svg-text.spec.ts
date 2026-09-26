import { escapeXml, fitSizePt, fitText, textWidthMm } from './svg-text';

describe('escapeXml', () => {
  it('XML 특수문자 다섯을 엔티티로 바꾼다', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  });

  it('XML 이 금지하는 제어문자·비문자는 제거한다 (resvg 가 non-XML character 로 파싱을 거부한다)', () => {
    expect(escapeXml('문\u0008앞\u000B￾')).toBe('문앞');
  });

  it('tab·LF·CR 은 XML 이 허용하므로 그대로 둔다', () => {
    expect(escapeXml('a\tb')).toBe('a\tb');
  });
});

describe('textWidthMm', () => {
  it('한글은 1em, 그 외는 0.6em 으로 근사한다 (10pt = 3.528mm)', () => {
    expect(textWidthMm('한', 10)).toBeCloseTo(3.528, 3);
    expect(textWidthMm('a', 10)).toBeCloseTo(3.528 * 0.6, 3);
  });
});

describe('fitText', () => {
  it('칸에 들어가면 그대로', () => {
    expect(fitText('문앞', 50, 10)).toBe('문앞');
  });
  it('넘치면 말줄임을 붙여 칸 폭 안으로 자른다', () => {
    const long = '가'.repeat(100);
    const out = fitText(long, 30, 10);
    expect(out.endsWith('…')).toBe(true);
    expect(textWidthMm(out, 10)).toBeLessThanOrEqual(30);
  });
});

describe('fitSizePt', () => {
  it('들어가면 최대 크기', () => {
    expect(fitSizePt('AY01', 42, 10, 5)).toBe(10);
  });
  it('안 들어가면 0.5pt 씩 줄여 들어가는 가장 큰 크기', () => {
    const text = `출고번호: ${'A'.repeat(28)}`;
    const pt = fitSizePt(text, 42, 10, 5);
    expect(textWidthMm(text, pt)).toBeLessThanOrEqual(42);
    expect(textWidthMm(text, pt + 0.5)).toBeGreaterThan(42);
  });
  it('최소 크기로도 안 들어가면 최소 크기', () => {
    expect(fitSizePt('A'.repeat(500), 42, 10, 5)).toBe(5);
  });
});
