import { isWholeHtmlDocument, stripContents, stripLines } from './strip-email-layout-lines';

describe('공통 레이아웃이 대신 넣는 줄 걷어내기', () => {
  const footer =
    '<p>문의: <a href="https://pf.kakao.com/_xaxgxazs">카카오톡 채널 아몬드영</a> · 고객센터 1877-7184</p>';

  it('제거 대상 줄만 빼고 나머지는 그대로 둔다', () => {
    expect(stripLines(`<p>안녕하세요.</p>\n${footer}`)).toBe('<p>안녕하세요.</p>');
    expect(stripLines('<p>안녕하세요.</p>')).toBeNull();
  });

  it('관리자가 손본 문장은 건드리지 않는다', () => {
    const edited = '<p>문의: 고객센터 1877-7184 (평일 10~17시)</p>';
    expect(stripLines(edited)).toBeNull();
  });

  it('언어·채널이 어떻게 중첩돼 있든 EMAIL 본문을 찾아 고친다', () => {
    const contents = { ko: { EMAIL: { subject: '제목', body: `<p>본문</p>\n${footer}` } } };
    expect(stripContents(contents)).toEqual({ ko: { EMAIL: { subject: '제목', body: '<p>본문</p>' } } });
    expect(stripContents({ EMAIL: { ko: { body: `<p>본문</p>\n${footer}` } } })).toEqual({
      EMAIL: { ko: { body: '<p>본문</p>' } },
    });
    expect(stripContents({ EMAIL: { ko: { body: '<p>본문</p>' } } })).toBeNull();
  });

  it('EMAIL 이 아닌 본문과 배열·부가 데이터는 그대로 둔다', () => {
    const contents = {
      ko: {
        EMAIL: { body: `<p>본문</p>\n${footer}`, attachments: [{ name: 'a.pdf' }] },
        SMS: { body: `문자 본문\n${footer}` },
      },
      meta: ['a', 'b'],
    };

    expect(stripContents(contents)).toEqual({
      ko: {
        EMAIL: { body: '<p>본문</p>', attachments: [{ name: 'a.pdf' }] },
        SMS: { body: `문자 본문\n${footer}` },
      },
      meta: ['a', 'b'],
    });
  });
});

describe('통째 HTML 문서 판별', () => {
  it('doctype 으로 시작하는 본문만 되돌림 대상이다', () => {
    expect(isWholeHtmlDocument({ ko: { EMAIL: { body: '<!doctype html><html>…</html>' } } })).toBe(true);
    expect(isWholeHtmlDocument({ ko: { EMAIL: { body: '## 제목\n\n본문' } } })).toBe(false);
    expect(isWholeHtmlDocument({ ko: { EMAIL: { body: '<p>옛 HTML 조각</p>' } } })).toBe(false);
  });
});
