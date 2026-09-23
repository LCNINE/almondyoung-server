import {
  SHOP_LISTING_DISALLOWED_ELEMENTS,
  SHOP_LISTING_LINK_REL,
  rehypeShopListingLinks,
  shopListingUrlTransform,
  toPlainSummary,
} from './rules';

describe('shopListingUrlTransform', () => {
  it.each([
    ['https://open.kakao.com/o/abc', 'https://open.kakao.com/o/abc'],
    ['http://example.com', 'http://example.com'],
    ['tel:01012345678', 'tel:01012345678'],
    ['TEL:01012345678', 'TEL:01012345678'],
    ['/kr/shop-trade', '/kr/shop-trade'],
    ['#anchor', '#anchor'],
    ['javascript:alert(1)', ''],
    ['JavaScript:alert(1)', ''],
    ['data:text/html;base64,xx', ''],
    ['vbscript:msgbox(1)', ''],
    ['mailto:a@b.c', ''],
  ])('%s → %s', (input, expected) => {
    expect(shopListingUrlTransform(input)).toBe(expected);
  });
});

describe('rehypeShopListingLinks', () => {
  it('중첩된 a 까지 rel 을 붙인다', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'element', tagName: 'a', properties: { href: 'https://a.b' }, children: [] },
            {
              type: 'element',
              tagName: 'strong',
              properties: {},
              children: [{ type: 'element', tagName: 'a', properties: { href: 'tel:0212345678' }, children: [] }],
            },
          ],
        },
      ],
    };

    rehypeShopListingLinks()(tree);

    const p = tree.children[0];
    expect(p.children[0].properties).toEqual({ href: 'https://a.b', rel: ['nofollow', 'ugc', 'noopener'] });
    expect(p.children[1].children?.[0].properties).toEqual({ href: 'tel:0212345678', rel: ['nofollow', 'ugc', 'noopener'] });
  });

  it('a 가 아닌 요소는 건드리지 않는다', () => {
    const tree = { type: 'root', children: [{ type: 'element', tagName: 'p', properties: { id: 'x' }, children: [] }] };
    rehypeShopListingLinks()(tree);
    expect(tree.children[0].properties).toEqual({ id: 'x' });
  });
});

describe('상수', () => {
  it('rel 과 금지 요소', () => {
    expect(SHOP_LISTING_LINK_REL).toBe('nofollow ugc noopener');
    expect(SHOP_LISTING_DISALLOWED_ELEMENTS).toContain('img');
  });
});

describe('toPlainSummary', () => {
  it('제목·강조·링크 기호를 벗기고 한 줄로 만든다', () => {
    expect(toPlainSummary('# 강남 네일샵\n\n**권리금** 협의 [지도](https://map.x)\n> 역세권')).toBe(
      '강남 네일샵 권리금 협의 지도 역세권',
    );
  });

  it('이미지는 버린다', () => {
    expect(toPlainSummary('앞 ![사진](https://a/b.png) 뒤')).toBe('앞 뒤');
  });

  it('이관 글의 이스케이프(\\#)는 원래 글자로 돌린다', () => {
    expect(toPlainSummary('\\#1 매물 \\> 참고')).toBe('#1 매물 > 참고');
  });

  it('기본 160자에서 자른다', () => {
    expect(toPlainSummary('가'.repeat(200))).toHaveLength(160);
    expect(toPlainSummary('가나다라', 2)).toBe('가나');
  });
});
