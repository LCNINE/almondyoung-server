import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 두 앱의 렌더 컴포넌트가 공유 규칙을 **그대로** 쓰는지 소스로 본다. 두 앱은 컴포넌트 테스트를 돌릴 수 없고
 * 스토어프론트는 CI 가 0개라, 여기가 「rehype-raw 부재·remark-breaks 사용」을 지키는 유일한 CI 장치다.
 * 루트에는 react-markdown·remark-* 가 없어 import 로는 못 보고 소스 문자열로 본다.
 */
const ROOT = join(__dirname, '..', '..');
const COMPONENTS = [
  'web/almondyoung-storefront/src/domains/shop-trade/components/listing-markdown/index.tsx',
  'apps/admin-web/src/features/mall/shop-listings/components/shop-listing-markdown/index.tsx',
];

describe.each(COMPONENTS)('%s', (relativePath) => {
  const source = readFileSync(join(ROOT, relativePath), 'utf8');

  it('remark-gfm·remark-breaks 를 import 해 팩토리에 넘긴다', () => {
    expect(source).toMatch(/import remarkGfm from ["']remark-gfm["']/);
    expect(source).toMatch(/import remarkBreaks from ["']remark-breaks["']/);
    expect(source).toMatch(/createShopListingMarkdownOptions\(\{\s*remarkGfm,\s*remarkBreaks\s*\}\)/);
  });

  it('설정을 펼쳐 쓰고 덮어쓰지 않는다', () => {
    expect(source).toMatch(/<ReactMarkdown \{\.\.\.options\}>/);
    for (const override of [
      'rehype-raw',
      'rehypePlugins',
      'remarkPlugins',
      'urlTransform',
      'allowedElements',
      'disallowedElements',
      'skipHtml',
      'components=',
    ]) {
      expect(source).not.toContain(override);
    }
  });
});
