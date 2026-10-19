import { almondFontFamily, almondFontsConfig, extractAlmondFontFileIds, sniffFontFormat } from './almond-print-fonts';

const FILE_ID = '0199a1b2-c3d4-7e5f-8071-8293a4b5c6d7';

describe('almond print fonts', () => {
  it('fileId ↔ 글꼴 이름이 왕복한다', () => {
    const family = almondFontFamily(FILE_ID);
    expect(family).toBe('AF0199a1b2c3d47e5f80718293a4b5c6d7');
    const svg = `<text font-family="'${family}', sans-serif">가</text><text font-family="'${family}'">나</text>`;
    expect(extractAlmondFontFileIds(svg)).toEqual([FILE_ID]);
  });

  it('긴 hex 안에 섞인 AF 는 글꼴로 보지 않는다', () => {
    expect(extractAlmondFontFileIds(`<path d="M0 0" id="xAF0199a1b2c3d47e5f80718293a4b5c6d7"/>`)).toEqual([]);
  });

  it('파일 앞머리로 형식을 가린다', () => {
    expect(sniffFontFormat(Buffer.from([0, 1, 0, 0, 0]))).toBe('ttf');
    expect(sniffFontFormat(Buffer.from('OTTO\0'))).toBe('otf');
    expect(sniffFontFormat(Buffer.from('wOFF\0'))).toBe('woff');
    expect(sniffFontFormat(Buffer.from('wOF2\0'))).toBe('woff2');
    expect(sniffFontFormat(Buffer.from('\x89PNG'))).toBeNull();
    expect(sniffFontFormat(Buffer.from('ttcf'))).toBeNull();
  });

  it('fontconfig 설정이 파일마다 이름을 덮어쓴다', () => {
    const family = almondFontFamily(FILE_ID);
    const config = almondFontsConfig('/tmp/a/fonts', '/tmp/a/cache', new Map([[family, `/tmp/a/fonts/${family}.ttf`]]));
    expect(config).toContain('<dir>/tmp/a/fonts</dir>');
    expect(config).toContain(`<string>/tmp/a/fonts/${family}.ttf</string>`);
    expect(config).toContain(`<edit name="family" mode="assign_replace"><string>${family}</string></edit>`);
  });
});
