import { isBotUserAgent, newLinkCode, trackLinks } from './tracked-links';

describe('trackLinks', () => {
  const codes = () => {
    let n = 0;
    return () => `c${++n}`;
  };

  it('링크마다 코드를 붙여 바꾸고 원래 주소를 남긴다', () => {
    const result = trackLinks(
      '세일 https://almondyoung.com/kr/best 와 http://a.com/x?y=1 확인',
      'https://almondyoung.com/r',
      codes(),
    );
    expect(result.body).toBe('세일 https://almondyoung.com/r/c1 와 https://almondyoung.com/r/c2 확인');
    expect(result.links).toEqual([
      { code: 'c1', url: 'https://almondyoung.com/kr/best' },
      { code: 'c2', url: 'http://a.com/x?y=1' },
    ]);
  });

  it('붙어 있는 한글과 끝 문장부호는 링크에 넣지 않는다', () => {
    const result = trackLinks('https://a.com/kr에서 보세요. (https://b.com/p).', 'https://s.com/r', codes());
    expect(result.body).toBe('https://s.com/r/c1에서 보세요. (https://s.com/r/c2).');
    expect(result.links.map((l) => l.url)).toEqual(['https://a.com/kr', 'https://b.com/p']);
  });

  it('링크가 없으면 그대로', () => {
    expect(trackLinks('안녕하세요', 'https://s.com/r')).toEqual({ body: '안녕하세요', links: [] });
  });

  it('코드는 주소에 그대로 쓸 수 있는 8자다', () => {
    expect(newLinkCode()).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });
});

describe('isBotUserAgent', () => {
  it('미리보기·크롤러·UA 없음은 봇으로 본다', () => {
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent('okhttp/4.9.0')).toBe(true);
  });

  it('휴대폰 브라우저는 사람으로 본다', () => {
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
      ),
    ).toBe(false);
  });
});
