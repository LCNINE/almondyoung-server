import { BadRequestError } from '@app/shared';
import {
  assertPrintReadySvg,
  assertSafeDesignSvg,
  composeSideBySide,
  extractPublicFileIds,
  inlinePublicImages,
  readSvgSizeMm,
  sniffImageMime,
} from './almond-print-svg';

const FILE_A = '11111111-1111-4111-8111-111111111111';
const FILE_B = 'AAAAAAAA-2222-4222-8222-222222222222';
const PNG_DATA = 'data:image/png;base64,iVBORw0KGgo=';

const svg = (inner: string, attrs = 'width="94mm" height="54mm" viewBox="0 0 94 54"'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${inner}</svg>`;

describe('assertSafeDesignSvg', () => {
  it.each([
    ['내부 참조', '<defs><clipPath id="c"><rect/></clipPath></defs><use href="#c"/><rect clip-path="url(#c)"/>'],
    ['data 이미지', `<image href="${PNG_DATA}"/>`],
    ['상대 경로 공개 파일', `<image href="/files/public/${FILE_A}"/>`],
    ['프록시 경로 공개 파일', `<image xlink:href="/api/proxy/files/public/${FILE_A}?v=1"/>`],
    ['절대 URL 공개 파일', `<image href='https://file.almondyoung.com/files/public/${FILE_B}'/>`],
    ['한글 텍스트', `<text font-family="'Noto Sans CJK KR'">안녕하세요</text>`],
  ])('%s 는 받는다', (_, inner) => {
    expect(() => assertSafeDesignSvg(svg(inner), 'front')).not.toThrow();
  });

  it('XML 선언으로 시작해도 받는다', () => {
    expect(() => assertSafeDesignSvg(`<?xml version="1.0" encoding="UTF-8"?>\n${svg('')}`, 'front')).not.toThrow();
  });

  it.each([
    ['svg 로 시작하지 않는다', `<g>${svg('')}</g>`],
    ['script', svg('<script>alert(1)</script>')],
    ['foreignObject', svg('<foreignObject><div/></foreignObject>')],
    ['이벤트 핸들러', svg('<rect onclick="x"/>')],
    ['DOCTYPE', `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]>${svg('')}`],
    ['외부 URL href', svg('<image href="https://evil.example/a.png"/>')],
    ['file 스킴', svg('<image href="file:///etc/passwd"/>')],
    ['따옴표 없는 href', svg('<image href=https://evil.example/a.png />')],
    ['공개 파일이 아닌 file-service 경로', svg(`<image href="/files/private/${FILE_A}"/>`)],
    ['허용하지 않는 data 형식', svg('<image href="data:text/html;base64,PHNjcmlwdD4="/>')],
    ['CSS 외부 url()', svg('<rect style="fill:url(https://evil.example/x)"/>')],
    ['@import', svg('<style>@import "https://evil.example/x.css";</style>')],
    [
      '내장 SVG 안의 외부 참조',
      svg(
        `<image href="data:image/svg+xml;base64,${Buffer.from(svg('<image href="https://evil.example/a.png"/>')).toString('base64')}"/>`,
      ),
    ],
    ['mm 단위가 아니다', svg('', 'width="94" height="54" viewBox="0 0 94 54"')],
    ['viewBox 가 없다', svg('', 'width="94mm" height="54mm"')],
    ['3MB 를 넘는다', svg(`<!--${'a'.repeat(3 * 1024 * 1024)}-->`)],
  ])('%s 면 400', (_, value) => {
    expect(() => assertSafeDesignSvg(value, 'back')).toThrow(BadRequestError);
  });
});

describe('extractPublicFileIds / inlinePublicImages', () => {
  const source = svg(
    `<image href="https://x.test/files/public/${FILE_A}"/><image xlink:href="/files/public/${FILE_B}"/><image href="/files/public/${FILE_A}"/><use href="#a"/>`,
  );

  it('호스트와 무관하게 uuid 만 소문자로 중복 없이 뽑는다', () => {
    expect(extractPublicFileIds(source)).toEqual([FILE_A, FILE_B.toLowerCase()]);
  });

  it('공개 파일 URL 을 data URI 로 바꾸고 내부 참조는 그대로 둔다', () => {
    const inlined = inlinePublicImages(
      source,
      new Map([
        [FILE_A, PNG_DATA],
        [FILE_B.toLowerCase(), 'data:image/jpeg;base64,/9j/'],
      ]),
    );
    expect(inlined).not.toContain('/files/public/');
    expect(inlined.match(/data:image\/png/g)).toHaveLength(2);
    expect(inlined).toContain('xlink:href="data:image/jpeg;base64,/9j/"');
    expect(inlined).toContain('href="#a"');
  });

  it('받지 못한 이미지가 있으면 실패한다', () => {
    expect(() => inlinePublicImages(source, new Map([[FILE_A, PNG_DATA]]))).toThrow();
  });

  it('인쇄 직전 외부 참조가 남아 있으면 실패한다', () => {
    expect(() => assertPrintReadySvg(svg(`<image href="/files/public/${FILE_A}"/>`))).toThrow();
    expect(() => assertPrintReadySvg(svg(`<image href="${PNG_DATA}"/>`))).not.toThrow();
  });
});

describe('composeSideBySide', () => {
  const front = `<?xml version="1.0"?>\n${svg('<defs><clipPath id="c"/></defs><rect clip-path="url(#c)"/><use href="#c"/>')}`;
  const back = svg(
    '<defs><clipPath id="c"/></defs><rect clip-path="url(#c)"/>',
    'width="100mm" height="60mm" viewBox="0 0 100 60"',
  );

  it('앞면 왼쪽, 10mm 띄워 뒷면 오른쪽에 둔 한 장을 만든다', () => {
    const sheet = composeSideBySide(front, back, 10);
    expect(readSvgSizeMm(sheet)).toEqual({ width: 204, height: 60 });
    expect(sheet).toContain('viewBox="0 0 204 60"');
    expect(sheet).toContain('<svg x="0" y="0" width="94" height="54"');
    expect(sheet).toContain('<svg x="104" y="0" width="100" height="60"');
    expect(sheet.match(/<\?xml/g)).toHaveLength(1);
  });

  it('두 면의 id 가 부딪히지 않게 접두사를 붙인다', () => {
    const sheet = composeSideBySide(front, back, 10);
    expect(sheet).toContain('id="f-c"');
    expect(sheet).toContain('id="b-c"');
    expect(sheet).toContain('url(#f-c)');
    expect(sheet).toContain('url(#b-c)');
    expect(sheet).toContain('href="#f-c"');
    expect(sheet).not.toContain('id="c"');
  });

  it('단면이면 앞면만 담는다', () => {
    const sheet = composeSideBySide(front, null, 10);
    expect(readSvgSizeMm(sheet)).toEqual({ width: 94, height: 54 });
    expect(sheet.match(/<svg x=/g)).toHaveLength(1);
  });
});

describe('sniffImageMime', () => {
  it.each<[string, Buffer, string | null]>([
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png'],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]), 'image/webp'],
    ['svg', Buffer.from(svg('')), 'image/svg+xml'],
    ['html', Buffer.from('<html></html>'), null],
  ])('%s', (_, bytes, expected) => {
    expect(sniffImageMime(bytes)).toBe(expected);
  });
});
