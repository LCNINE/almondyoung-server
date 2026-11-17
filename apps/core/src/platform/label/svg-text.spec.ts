import { getBit } from './label-model';
import { SvgRasterizer } from './svg-rasterizer';
import { escapeXml, fitSizePt, fitText, PT_TO_MM, textWidthMm } from './svg-text';

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
  it('글자 등급별 계수(em) × pt × 0.3528 — 나눔고딕 hmtx 실측 최대값 이상으로 잡는다', () => {
    const at10 = (ch: string) => textWidthMm(ch, 10) / (10 * PT_TO_MM);
    expect(at10('한')).toBeCloseTo(0.95, 6); // 실측 0.940
    expect(at10(' ')).toBeCloseTo(0.3, 6); // 0.280
    expect(at10(':')).toBeCloseTo(0.5, 6); // 0.303 (좁은 기호 최대 0.491)
    expect(at10('7')).toBeCloseTo(0.62, 6); // 0.606
    expect(at10('a')).toBeCloseTo(0.62, 6); // 0.545 (소문자 최대 0.606)
    expect(at10('A')).toBeCloseTo(0.75, 6); // 0.727
    expect(at10('G')).toBeCloseTo(0.82, 6); // 0.797
    expect(at10('W')).toBeCloseTo(1.05, 6); // 1.029
    expect(at10('m')).toBeCloseTo(1.05, 6); // 0.908
    expect(at10('%')).toBeCloseTo(1.1, 6); // 1.090
    expect(at10('…')).toBeCloseTo(1.1, 6); // 0.940
    expect(at10('😀')).toBeCloseTo(1.0, 6); // 폰트에 없음 → .notdef 0.940
  });

  describe('실제 렌더 폭(번들 나눔고딕 + resvg)을 과소추정하지 않는다 (#913 — 출고번호가 ITF 를 덮었다)', () => {
    const rasterizer = new SvgRasterizer();
    const DOTS_PER_MM_HI = 16; // 프린터(8 dot/mm)의 두 배 해상도로 재 가장자리 오차를 줄인다
    const X0 = 2;

    /** 기준점 x 부터 잉크 오른쪽 끝까지의 폭(mm). */
    const renderedWidthMm = (run: string, pt: number, bold: boolean): number => {
      const widthMm = X0 + textWidthMm(run, pt) * 2 + 10;
      const weight = bold ? ' font-weight="700"' : '';
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="10mm" viewBox="0 0 ${widthMm} 10" font-family="NanumGothic">` +
        `<text x="${X0}" y="7" font-size="${pt * PT_TO_MM}"${weight}>${escapeXml(run)}</text></svg>`;
      const b = rasterizer.rasterize(svg, Math.round(widthMm * DOTS_PER_MM_HI));
      let right = -1;
      for (let y = 0; y < b.heightDots; y++)
        for (let x = right + 1; x < b.widthDots; x++) if (getBit(b, x, y)) right = x;
      if (right < 0) throw new Error(`nothing rendered for ${run}`);
      return (right + 1) / DOTS_PER_MM_HI - X0;
    };

    const runs: Array<[string, string]> = [
      ['한글 음절', '가나다라마바사'],
      ['한글 받침 많은 음절', '출고번호뷁똠방각하'],
      ['넓은 대문자', 'WMWMWM'],
      ['둥근 대문자', 'GOQGOQ'],
      ['Crockford 대문자', 'ABCDEFGHJKMNPQRSTVWXYZ'],
      ['대문자 전체', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
      ['숫자', '0123456789'],
      ['소문자', 'abcdefghijklmnopqrstuvwxyz'],
      ['넓은 소문자·@', 'mwmwmw@@'],
      ['ASCII 기호', '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'],
      ['퍼센트', '%%%%'],
      ['그 밖의 BMP', '¾¼½…※→'],
      ['폰트에 없는 글자(.notdef — 잉크가 없어 앞뒤를 A 로 감싼다)', 'A丁①😀😀A'],
      ['공백 섞인 출고번호', '출고번호: AY0123456789ABCDEFGHJKMNPQRS'],
      ['공백 섞인 혼합', '토익 Speaking 외 1건'],
      ['공백 섞인 배송메시지', '문앞 (공동현관 #1234)'],
      ['공백 섞인 대문자', 'W M W M W M'],
    ];

    it.each(runs)('%s — 보통·굵게 모두 모델 폭 ≥ 실제 잉크 폭 (10pt)', (_label, run) => {
      const model = textWidthMm(run, 10);
      expect(model).toBeGreaterThanOrEqual(renderedWidthMm(run, 10, false));
      expect(model).toBeGreaterThanOrEqual(renderedWidthMm(run, 10, true));
    });

    it('작은 크기(4pt)에서도 과소추정하지 않는다 — 출고번호가 실제로 찍히는 크기', () => {
      const run = '출고번호: AYWMWMGQ0123456789ABCDEFGHJK';
      expect(textWidthMm(run, 4)).toBeGreaterThanOrEqual(renderedWidthMm(run, 4, false));
    });
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
    const text = `출고번호: ${'A'.repeat(20)}`;
    const pt = fitSizePt(text, 42, 10, 5);
    expect(textWidthMm(text, pt)).toBeLessThanOrEqual(42);
    expect(textWidthMm(text, pt + 0.5)).toBeGreaterThan(42);
  });
  it('최소 크기로도 안 들어가면 최소 크기', () => {
    expect(fitSizePt('A'.repeat(500), 42, 10, 5)).toBe(5);
  });
});
