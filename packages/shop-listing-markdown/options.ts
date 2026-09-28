import { SHOP_LISTING_DISALLOWED_ELEMENTS, rehypeShopListingLinks, shopListingUrlTransform } from './rules';

export type ShopListingMarkdownOptions<G, B> = {
  remarkPlugins: Array<G | B>;
  rehypePlugins: Array<typeof rehypeShopListingLinks>;
  urlTransform: typeof shopListingUrlTransform;
  disallowedElements: string[];
  skipHtml: false;
};

/**
 * react-markdown 에 펼칠 설정 한 벌. remark 플러그인은 **앱이 자기 node_modules 에서 import 해 넘긴다** —
 * 이 패키지가 직접 import 하면 스토어프론트 turbopack·루트 jest 에서 해석이 깨진다(두 곳 모두 루트에 remark 가 없다).
 * 두 플러그인은 필수 인자라 빠뜨리면 타입 에러다. `remark-breaks` 가 없으면 이관 글의 <br> 과 회원이 textarea 에서
 * 친 Enter 가 전부 공백으로 합쳐진다.
 */
export function createShopListingMarkdownOptions<G, B>(plugins: {
  remarkGfm: G;
  remarkBreaks: B;
}): ShopListingMarkdownOptions<G, B> {
  return {
    remarkPlugins: [plugins.remarkGfm, plugins.remarkBreaks],
    rehypePlugins: [rehypeShopListingLinks],
    urlTransform: shopListingUrlTransform,
    disallowedElements: [...SHOP_LISTING_DISALLOWED_ELEMENTS],
    skipHtml: false,
  };
}
