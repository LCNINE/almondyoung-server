import { createShopListingMarkdownOptions } from './options';
import { SHOP_LISTING_DISALLOWED_ELEMENTS, rehypeShopListingLinks, shopListingUrlTransform } from './rules';

describe('createShopListingMarkdownOptions', () => {
  const remarkGfm = () => undefined;
  const remarkBreaks = () => undefined;
  const options = createShopListingMarkdownOptions({ remarkGfm, remarkBreaks });

  it('remark 플러그인은 gfm → breaks 순서로 받은 그대로 쓴다', () => {
    expect(options.remarkPlugins).toEqual([remarkGfm, remarkBreaks]);
  });

  it('rehype 는 링크 rel 플러그인 하나뿐이다 — rehype-raw 를 끼울 자리가 없다', () => {
    expect(options.rehypePlugins).toEqual([rehypeShopListingLinks]);
  });

  it('urlTransform 과 금지 요소를 싣는다', () => {
    expect(options.urlTransform).toBe(shopListingUrlTransform);
    expect(options.disallowedElements).toEqual([...SHOP_LISTING_DISALLOWED_ELEMENTS]);
  });

  it('원시 HTML 을 통째로 버리지도 않는다 — react-markdown 기본(이스케이프)을 쓴다', () => {
    expect(options.skipHtml).toBe(false);
  });
});
