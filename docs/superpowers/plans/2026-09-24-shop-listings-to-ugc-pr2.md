# 샵 매매 PR 2 — 프론트 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스토어프론트와 admin-web 의 샵 매매를 core 에서 ugc-service 로 전환하고, 회원 작성·연락처 보기·관리자 검토 화면을 연다.

**Architecture:** 마크다운 렌더 규칙은 외부 import 가 없는 `packages/shop-listing-markdown` 한 벌에 둔다. 두 앱은 각자 `react-markdown`·`remark-gfm`·`remark-breaks` 를 import 해 팩토리에 넘긴다. 스토어프론트는 공개 조회를 `ugc` 서비스 키로 바꾸고, 회원 기능은 결과 객체를 돌려주는 서버 액션과 `/mypage/shop-listings/*` 화면으로 연다. admin-web 은 `/proxy/ugc/admin/shop-listings` 로 전환하고, 검토 탭·판정 바·마크다운 편집을 얹는다. 판단 로직은 전부 `.ts` 순수 함수 + 스펙으로 뺀다.

**Tech Stack:** Next.js 15 (두 앱), react-markdown 10, remark-gfm 4, remark-breaks 4, next-intl(스토어프론트), TanStack Query + sonner + shadcn(admin-web), jest(루트, CI), vitest(스토어프론트, 수동).

**Spec:** `docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md` — §7(API), §8(프론트), §11.4(테스트). 이관 런북 `scripts/ops/shop-listings-migrate/README.md`.

**선행 조건:** PR #958 머지. 브랜치는 그 뒤 `develop` 에서 `feat/shop-listings-pr2-frontend` 로 딴다. PR 1(#957)은 라이브에 있다 — ugc API 는 이미 떠 있다.

## Global Constraints

- **관리자 수정 PUT 은 전체 교체다.** admin-web 이 보내는 본문은 `contactPhone`·`kakaoOpenChatUrl` 키를 **항상** 싣는다(비면 `null`). 빼면 회원이 등록한 번호가 지워진다.
- **승인·반려 본문에는 `expectedSubmittedAt`(상세 응답의 `submittedAt`)을 싣는다.** 409 면 새로고침을 안내한다.
- 회원 수정은 재검토(`pending`)로 내려간다. `hidden` 글은 수정하면 409, 삭제만 된다. 동시 게시 한도(3건) 초과는 409.
- 렌더 규칙: `remark-gfm` + `remark-breaks`. **`rehype-raw` 금지.** `img` 요소는 그리지 않는다. 링크 `rel="nofollow ugc noopener"`, 허용 스킴은 `http`·`https`·`tel`.
- `packages/shop-listing-markdown` 은 **외부 import 0개**다(루트 jest, 스토어프론트 turbopack dev, admin-web webpack 이 모두 그대로 읽어야 한다).
- 회원 화면은 `/mypage/shop-listings/*` 에만 둔다(`/shop-trade/*` 는 middleware 가 CDN 캐시한다).
- 연락처는 공개 목록·상세 응답에 절대 섞지 않는다. 로그인 회원만 `GET /shop-listings/public/:slug/contact` 로 받는다.
- 스토어프론트 UI 는 `web/almondyoung-storefront/DESIGN.md` 를 따른다. 오렌지(Primary)는 한 화면에 하나다. 상태 배지는 전부 뉴트럴(`variant="secondary"`)이다. 빨강은 실제 에러에만 쓴다. 색은 시맨틱 유틸만(hex 금지), 간격은 4px 그리드다. 문구는 「~했어요」 톤이고, 「오류가 발생했습니다」는 금지다.
- 스토어프론트 문구는 `src/i18n/messages/{ko,en,ja}/*.json` 세 벌에 **같은 키**로 넣는다(`locale-parity.test.ts`).
- 코드 스타일:
  - 스토어프론트: 세미콜론 없음, 큰따옴표.
  - admin-web·packages: 세미콜론, 작은따옴표.
- **스토어프론트 vitest 에는 `@/` 별칭이 없다.** vitest 로 검사하는 `.ts` 모듈은 값 import 를 상대경로로만 한다(`import type` 은 무관).
- 게이트:
  - 루트 `npx jest` 는 `packages/shop-listing-markdown`(이 PR 이 `roots` 에 추가)와 `apps/admin-web/src/**/*.spec.ts` 를 **CI 에서** 돈다.
  - 스토어프론트 vitest·tsc 와 두 앱의 `next build` 는 CI 에 없으므로 직접 돌린다.
  - 스토어프론트는 `typescript.ignoreBuildErrors: true` 라 빌드가 타입을 보지 않는다.

---

## File Structure

**신설 — 공유 패키지**
- `packages/shop-listing-markdown/package.json` — 이름·main
- `packages/shop-listing-markdown/rules.ts` — urlTransform, 금지 요소, rel, rehype 링크 플러그인, `toPlainSummary`
- `packages/shop-listing-markdown/options.ts` — `createShopListingMarkdownOptions` 팩토리
- `packages/shop-listing-markdown/index.ts`
- `packages/shop-listing-markdown/rules.spec.ts`, `options.spec.ts`, `app-wiring.spec.ts`(두 앱 컴포넌트 소스 가드)

**스토어프론트 (`web/almondyoung-storefront/src`)**
- 신설
  - `domains/shop-trade/components/listing-markdown/index.tsx` — 렌더 컴포넌트
  - `domains/shop-trade/components/listing-markdown/render.test.ts` — 실제 react-markdown 렌더 실측
  - `lib/api/ugc/shop-listings.ts` — 공개 조회·조회수·연락처(서버 액션)
  - `lib/api/ugc/my-shop-listings.ts` — 회원 서버 액션
  - `domains/shop-trade/action-result.ts` (+`.test.ts`) — 에러 → 결과 객체
  - `domains/shop-trade/my-listing-status.ts` (+`.test.ts`) — 상태 → 허용 동작
  - `domains/shop-trade/phone.ts` (+`.test.ts`) — 전화번호 정규화·표시
  - `domains/shop-trade/listing-form.ts` (+`.test.ts`) — 폼 값 ↔ 페이로드
  - `domains/shop-trade/components/contact-reveal/index.tsx` — 「연락처 보기」
  - `domains/shop-trade/components/my-listings/index.tsx` — 내 매물 목록(클라이언트)
  - `domains/shop-trade/components/listing-form/index.tsx`, `image-picker.tsx` — 작성·수정 폼
  - `app/[countryCode]/(mypage)/mypage/shop-listings/page.tsx`, `new/page.tsx`, `[id]/edit/page.tsx`
- 수정
  - `lib/types/dto/shop-listing.ts`, `lib/types/ui/shop-listing.ts` — ugc 응답 형태
  - 목록·상세 페이지, `listing-card`, `related-listings`, `view-beacon`, `home/template/shop-trade`, `app/sitemap.ts` — import·필드
  - `domains/mypage/components/constants/mypage-constants.ts` — 「내 매물」 메뉴 네 곳
  - `i18n/messages/{ko,en,ja}/shopTrade.json`, `mypage.json`
  - `package.json`, `package-lock.json`, `yarn.lock`, `next.config.js`
- 삭제: `lib/api/pim/shop-listings.ts`

**admin-web (`apps/admin-web/src`)**
- 신설
  - `features/mall/shop-listings/lib/admin-listing-rules.ts` (+`.spec.ts`) — 상태 → 버튼, 폼 ↔ DTO, 목록 쿼리, 409 분류
  - `features/mall/shop-listings/components/shop-listing-markdown/index.tsx`
  - `features/mall/shop-listings/components/moderation-bar/index.tsx`, `moderation-history/index.tsx`
- 수정
  - `lib/types/dto/products.ts`(샵 매매 DTO 교체), `lib/api/domains/products/shop-listings.client.ts`
  - `lib/services/products/queries.ts`·`mutations.ts`
  - `lib/api/domains/files/upload.client.ts`(컨텍스트), `features/mall/shop-listings/components/image-gallery-field/index.tsx`(주석)
  - `features/mall/shop-listings/template/index.tsx`(목록), `template/editor.tsx`(상세), `components/shop-listing-form/index.tsx`(폼)
  - `apps/admin-web/tsconfig.json`, `package.json`, `package-lock.json`

**루트·문서**
- `package.json`(jest `roots`·`moduleNameMapper`)
- spec §8.3·§8.4·§11.4 보정
- 런북 §3(배포 명령)

---

### Task 1: 공유 렌더 패키지 `packages/shop-listing-markdown`

**Files:**
- Create: `packages/shop-listing-markdown/package.json`, `rules.ts`, `options.ts`, `index.ts`, `rules.spec.ts`, `options.spec.ts`
- Modify: `package.json`(jest 블록), `docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md` §8.3·§8.4·§11.4

**Interfaces:**
- Produces:
  - `SHOP_LISTING_LINK_REL: 'nofollow ugc noopener'`
  - `SHOP_LISTING_DISALLOWED_ELEMENTS: readonly string[]`
  - `shopListingUrlTransform(value: string): string`
  - `rehypeShopListingLinks(): (tree: HastNode) => void`
  - `toPlainSummary(markdown: string, maxLength?: number): string`
  - `createShopListingMarkdownOptions<G, B>(plugins: { remarkGfm: G; remarkBreaks: B }): ShopListingMarkdownOptions<G, B>`
  - 전부 `@packages/shop-listing-markdown` 에서 export 된다.

- [ ] **Step 1: 패키지 뼈대와 jest 등록**

`packages/shop-listing-markdown/package.json`:

```json
{
  "name": "@packages/shop-listing-markdown",
  "version": "0.0.1",
  "description": "샵 매매 본문 마크다운 렌더 규칙 (외부 import 없음)",
  "private": true,
  "main": "index.ts",
  "types": "index.ts"
}
```

루트 `package.json` 의 jest 블록을 두 군데 고친다.

`moduleNameMapper` 에서 `product-description` 줄 바로 아래에 추가:

```json
      "^@packages/shop-listing-markdown(|/.*)$": "<rootDir>/packages/shop-listing-markdown$1",
```

`roots` 에서 `product-description` 줄 바로 아래에 추가:

```json
      "<rootDir>/packages/shop-listing-markdown/",
```

- [ ] **Step 2: `rules.spec.ts` 를 쓴다 (실패 확인용)**

```ts
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
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx jest packages/shop-listing-markdown`
Expected: FAIL — `Cannot find module './rules'`

- [ ] **Step 4: `rules.ts` 를 쓴다**

```ts
/**
 * 샵 매매 본문(마크다운) 렌더 규칙. 스토어프론트 상세·마이페이지 미리보기와 admin-web 미리보기가 이 한 벌을 쓴다
 * (spec §8.4). **외부 import 금지** — 스토어프론트 dev 의 turbopack, admin-web 의 webpack, 루트 jest 가 모두
 * 이 파일을 그대로 읽는다. 루트 밖 패키지가 의존성을 import 하면 셋 중 하나에서 해석이 깨진다.
 */

export const SHOP_LISTING_LINK_REL = 'nofollow ugc noopener';

/** 사진은 갤러리로만 받는다. 본문의 `![](…)` 은 그리지 않는다. */
export const SHOP_LISTING_DISALLOWED_ELEMENTS: readonly string[] = ['img'];

const ALLOWED_PROTOCOL = /^(https?|tel)$/i;

/**
 * react-markdown 의 기본 urlTransform 과 같은 판정에서 허용 스킴만 `http`·`https`·`tel` 로 좁혔다.
 * 스킴이 없는 상대경로·앵커는 통과, 그 밖은 빈 문자열(링크가 죽는다).
 */
export function shopListingUrlTransform(value: string): string {
  const colon = value.indexOf(':');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const slash = value.indexOf('/');

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    ALLOWED_PROTOCOL.test(value.slice(0, colon))
  ) {
    return value;
  }

  return '';
}

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * 모든 `a` 요소에 rel 을 붙이는 rehype 플러그인. `components.a`(JSX)로 하지 않는 이유는 이 패키지가
 * React 를 import 하지 않기 위해서다 — 루트 react(19.2)와 스토어프론트 react(19.0-rc)가 섞이는 것을 피한다.
 */
export function rehypeShopListingLinks() {
  return (tree: HastNode): void => {
    const visit = (node: HastNode) => {
      if (node.type === 'element' && node.tagName === 'a') {
        node.properties = { ...node.properties, rel: SHOP_LISTING_LINK_REL.split(' ') };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/** 메타 description 용 한 줄 요약. 마크다운 기호를 대강 벗긴다(정확한 파싱이 아니라 검색 스니펫 품질이 목적). */
export function toPlainSummary(markdown: string, maxLength = 160): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(?<!\\)[*_~`]/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest packages/shop-listing-markdown/rules.spec.ts`
Expected: PASS

- [ ] **Step 6: `options.spec.ts` 를 쓴다**

```ts
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
```

- [ ] **Step 7: 실패 확인**

Run: `npx jest packages/shop-listing-markdown/options.spec.ts`
Expected: FAIL — `Cannot find module './options'`

- [ ] **Step 8: `options.ts`, `index.ts` 를 쓴다**

`options.ts`:

```ts
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
```

`index.ts`:

```ts
export * from './options';
export * from './rules';
```

- [ ] **Step 9: 통과 확인**

Run: `npx jest packages/shop-listing-markdown`
Expected: PASS (2 suites)

- [ ] **Step 10: spec 보정 — 이 계획을 쓰며 바뀐 설계를 spec 에 반영한다**

`docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md`:

1. §8.4 의 `options.ts` 항목(「`remarkPlugins: [remarkGfm, remarkBreaks]` … peerDependency 이고 각 앱 `node_modules` 에서 해석된다.」)을 아래로 바꾼다:

   ```markdown
   - `options.ts` — `createShopListingMarkdownOptions({ remarkGfm, remarkBreaks })`. 앱이 자기 `node_modules` 의 플러그인을
     넘기면 `remarkPlugins`·`rehypePlugins: [rehypeShopListingLinks]`·`urlTransform`·`disallowedElements` 를 조립해 돌려준다.
     **패키지는 외부 import 가 0개다** — 스토어프론트 dev 는 turbopack 이라 webpack `resolve.modules` 폴백이 닿지 않고,
     루트 jest 에도 `remark-*` 가 없다. 두 플러그인은 필수 인자라 빠뜨리면 타입 에러다.
   ```

2. §8.4 배선 목록의 admin-web 줄을 `- admin-web: tsconfig \`paths\` 한 줄(선례 \`product-description\`). 외부 import 가 없으므로 해석 폴백은 필요 없다.` 로 바꾼다.
3. §8.3 본문 항목에서 「편집 / 미리보기」 `Tabs` 를 **「넓은 화면에서 좌우 배치(편집 | 미리보기), 좁으면 위아래 — 상품 상세설명 편집기(`product-description-focus-editor.tsx`)와 같은 배치」** 로 바꾼다. 「관리자 글의 slug 입력칸은 유지한다」는 **「slug 는 입력받지 않고 주소만 보여 준다(지금 폼과 같다)」** 로 바꾼다.
4. §11.4 첫 줄 「두 앱 모두 CI 게이트가 없다. CI 가 보는 것은 패키지 스펙뿐이다.」를 아래로 바꾼다:

   ```markdown
   CI 가 보는 것은 루트 `npx jest` 뿐이다. 루트 jest 는 패키지 스펙과 **`apps/admin-web/src/**/*.spec.ts`** 를 포함한다
   (CI 가 `npm ci --prefix apps/admin-web` 도 한다). 스토어프론트 vitest·tsc, admin-web tsc, 두 앱 `next build` 는 CI 밖이다.
   ```

   같은 절의 admin-web 항목에서 「`npm run test:admin-web` 으로 … 스펙을 돌린다」를 「폼 → DTO·상태 → 버튼·409 분류 스펙은 루트 jest(CI)가 돈다」로 바꾼다.
5. §11.4 패키지 항목의 「`options.ts` 소스 가드」 줄을 「`options.ts` 는 가짜 플러그인으로 조립 결과를 검사하고, `app-wiring.spec.ts` 가 두 앱 컴포넌트 소스를 읽어 `remark-gfm`·`remark-breaks` 전달과 `rehype-raw`·설정 덮어쓰기 부재를 확인한다」로 바꾼다.

- [ ] **Step 11: 커밋**

```bash
git add packages/shop-listing-markdown package.json docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md
git commit -m "feat(web): 샵 매매 마크다운 렌더 규칙을 외부 import 없는 공유 패키지로 둔다"
```

---

### Task 2: 스토어프론트 렌더 컴포넌트 배선과 실측

**Files:**
- Modify: `web/almondyoung-storefront/package.json`, `package-lock.json`, `yarn.lock`, `next.config.js`
- Create:
  - `web/almondyoung-storefront/src/domains/shop-trade/components/listing-markdown/index.tsx`
  - `web/almondyoung-storefront/src/domains/shop-trade/components/listing-markdown/render.test.ts`
- Modify: `scripts/ops/shop-listings-migrate/README.md` §3

**Interfaces:**
- Consumes: `createShopListingMarkdownOptions` (Task 1)
- Produces: `ShopListingMarkdown({ content, className? }: { content: string; className?: string })` — 서버·클라이언트 양쪽에서 쓸 수 있다(hook 없음, `"use client"` 없음)

- [ ] **Step 1: 의존성 추가**

`web/almondyoung-storefront/package.json` 의 `dependencies` 에 두 줄을 알파벳 위치에 넣는다:

```json
    "@packages/shop-listing-markdown": "file:../../packages/shop-listing-markdown",
```

```json
    "remark-breaks": "^4.0.0",
```

설치하고 두 lock 을 모두 갱신한다(이 앱은 둘 다 커밋돼 있다 — 선례 `a4d6e4d7d`):

```bash
cd web/almondyoung-storefront && npm install && npx --yes yarn@1.22.22 install && cd ../..
```

Expected: `package-lock.json`·`yarn.lock` 에 `remark-breaks`·`@packages/shop-listing-markdown` 항목이 생긴다. `node_modules/@packages/shop-listing-markdown` 은 심볼릭 링크다.

- [ ] **Step 2: `transpilePackages` 에 패키지 추가**

`web/almondyoung-storefront/next.config.js`:

```js
  transpilePackages: [
    "@packages/web-observability",
    "@packages/shop-listing-markdown",
  ],
```

- [ ] **Step 3: 실제 렌더 실측 테스트를 쓴다 (실패 확인용)**

`render.test.ts` — vitest 는 `.test.ts` 만 잡고 JSX 설정이 없으므로 `createElement` 로 쓴다. 컴포넌트 배선은 Task 3 의 가드 스펙이 따로 본다. 여기서는 **규칙이 진짜 react-markdown 에서 의도대로 도는지**를 본다.

```ts
import { createShopListingMarkdownOptions } from "@packages/shop-listing-markdown"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { describe, expect, it } from "vitest"

const options = createShopListingMarkdownOptions({ remarkGfm, remarkBreaks })
const render = (content: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, options, content))

describe("샵 매매 마크다운 렌더 (spec §8.1)", () => {
  it("본문 이미지는 그리지 않는다", () => {
    expect(render("앞 ![사진](https://a.b/c.png) 뒤")).not.toContain("<img")
  })

  it("원시 HTML 은 실행되지 않고 글자로 보인다", () => {
    const html = render("<script>alert(1)</script>")
    expect(html).not.toContain("<script")
    expect(html).toContain("&lt;script&gt;")
  })

  it("javascript: 링크는 무력화된다", () => {
    expect(render("[눌러](javascript:alert(1))")).not.toContain("javascript:")
  })

  it("링크에 rel 이 붙는다 (자동 링크 포함)", () => {
    expect(render("[지도](https://map.x)")).toContain(
      'rel="nofollow ugc noopener"'
    )
    expect(render("https://open.kakao.com/o/abc")).toContain(
      'rel="nofollow ugc noopener"'
    )
  })

  it("tel: 링크는 살린다", () => {
    expect(render("[전화](tel:01012345678)")).toContain('href="tel:01012345678"')
  })

  it("단일 줄바꿈을 <br> 로 그린다 (remark-breaks)", () => {
    expect(render("한 줄\n두 줄")).toContain("<br/>")
  })
})
```

- [ ] **Step 4: 실행해 결과를 본다**

Run: `cd web/almondyoung-storefront && npx vitest run src/domains/shop-trade/components/listing-markdown && cd ../..`
Expected: PASS 6건. 패키지·플러그인은 이미 있으므로 여기서 통과하는 게 정상이다. 이 테스트의 목적은 실패 확인이 아니라 **실측**이다. 실패하면 규칙(Task 1)이 react-markdown 실제 동작과 어긋난 것이니, 테스트를 고치지 말고 원인을 보고한다.

- [ ] **Step 5: 컴포넌트를 쓴다**

`listing-markdown/index.tsx`:

```tsx
import { createShopListingMarkdownOptions } from "@packages/shop-listing-markdown"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

// 규칙은 패키지 한 곳에 있다. 여기서 플러그인·urlTransform·components 를 더하거나 바꾸지 말 것 —
// packages/shop-listing-markdown/app-wiring.spec.ts 가 막는다. hook 이 없어 서버·클라이언트 양쪽에서 쓴다.
const options = createShopListingMarkdownOptions({ remarkGfm, remarkBreaks })

export function ShopListingMarkdown({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "prose prose-sm text-foreground max-w-none leading-relaxed",
        className
      )}
    >
      <ReactMarkdown {...options}>{content}</ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 6: 빌드로 배선을 실증한다 (spec §8.4 「첫 구현 단계」)**

```bash
cd web/almondyoung-storefront
npx tsc --noEmit 2>&1 | grep -E "listing-markdown|shop-listing-markdown" ; echo "tsc-filtered-exit=$?"
NEXT_DIST_DIR=.next-local npx next build
rm -rf .next-local
cd ../..
```

Expected:
- `grep` 결과 없음(`tsc-filtered-exit=1`).
- `next build` 성공.
- 이 시점에는 컴포넌트를 쓰는 페이지가 없어 트리셰이킹될 수 있다. 실제 번들 실증은 Task 4 의 빌드에서 다시 한다.

빌드가 `@packages/shop-listing-markdown` 해석 실패로 죽으면 **여기서 멈추고 보고한다.** spec §3 의 기각안(스토어프론트 복사 + 드리프트 가드)으로 물러날지는 사람이 정한다.

- [ ] **Step 7: 런북 배포 명령 보정**

`scripts/ops/shop-listings-migrate/README.md` 의 「## 3. PR 2 배포 직전」 절 끝에 추가:

````markdown
PR 2 는 스토어프론트와 admin-web 에 `remark-breaks` 를 더한다. `sst deploy` 는 **각 앱의 로컬 `node_modules`** 로 Next 를 빌드하므로
세 트리를 모두 lock 에 맞춘 뒤 배포한다(`sst.aws.Nextjs('Storefront')` 의 path 는 `web/almondyoung-storefront`):

```bash
npm ci && npm ci --prefix apps/admin-web && npm ci --prefix web/almondyoung-storefront
npx sst deploy --stage live
```
````

- [ ] **Step 8: 커밋**

```bash
git add web/almondyoung-storefront/package.json web/almondyoung-storefront/package-lock.json web/almondyoung-storefront/yarn.lock \
  web/almondyoung-storefront/next.config.js web/almondyoung-storefront/src/domains/shop-trade/components/listing-markdown \
  scripts/ops/shop-listings-migrate/README.md
git commit -m "feat(storefront): 샵 매매 본문을 공유 규칙의 마크다운으로 그리는 컴포넌트를 둔다"
```

---

### Task 3: admin-web 렌더 컴포넌트와 두 앱 배선 가드

**Files:**
- Modify: `apps/admin-web/package.json`, `apps/admin-web/package-lock.json`, `apps/admin-web/tsconfig.json`
- Create:
  - `apps/admin-web/src/features/mall/shop-listings/components/shop-listing-markdown/index.tsx`
  - `packages/shop-listing-markdown/app-wiring.spec.ts`

**Interfaces:**
- Consumes: `createShopListingMarkdownOptions` (Task 1)
- Produces: admin `ShopListingMarkdown({ value }: { value: string })`

- [ ] **Step 1: 가드 스펙을 쓴다 (실패 확인용)**

`packages/shop-listing-markdown/app-wiring.spec.ts`:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest packages/shop-listing-markdown/app-wiring.spec.ts`
Expected: FAIL — admin 파일 `ENOENT`(스토어프론트 쪽은 PASS)

- [ ] **Step 3: admin-web 배선**

`apps/admin-web/tsconfig.json` 의 `paths` 에 `product-description` 두 줄 아래로 추가:

```json
      "@packages/shop-listing-markdown": ["../../packages/shop-listing-markdown"],
      "@packages/shop-listing-markdown/*": ["../../packages/shop-listing-markdown/*"],
```

의존성:

```bash
cd apps/admin-web && npm install remark-breaks@^4.0.0 && cd ../..
```

Expected: `apps/admin-web/package.json` 에 `"remark-breaks": "^4.0.0"`, lock 갱신.

- [ ] **Step 4: admin 컴포넌트를 쓴다**

`shop-listing-markdown/index.tsx`:

```tsx
import { createShopListingMarkdownOptions } from '@packages/shop-listing-markdown';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

// 스토어프론트와 같은 규칙 한 벌 — 여기서 더하거나 바꾸지 말 것(app-wiring.spec.ts 가 막는다).
const options = createShopListingMarkdownOptions({ remarkGfm, remarkBreaks });

export function ShopListingMarkdown({ value }: { value: string }) {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown {...options}>{value}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: 가드 통과 확인**

Run: `npx jest packages/shop-listing-markdown`
Expected: PASS (3 suites)

- [ ] **Step 6: admin tsc**

Run: `cd apps/admin-web && npx tsc --noEmit; cd ../..`
Expected: 에러 0. 타입 에러가 `remarkPlugins` 할당 불가로 나면, `ShopListingMarkdownOptions` 의 배열 타입이 `PluggableList` 와 맞지 않는 것이다. 이 경우 `options.ts` 의 반환 타입을 조정한다. 컴포넌트에서 캐스팅하지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/package.json apps/admin-web/package-lock.json apps/admin-web/tsconfig.json \
  apps/admin-web/src/features/mall/shop-listings/components/shop-listing-markdown packages/shop-listing-markdown/app-wiring.spec.ts
git commit -m "feat(admin): 샵 매매 미리보기 렌더러를 공유 규칙으로 두고 두 앱 배선을 가드한다"
```

---

### Task 4: 스토어프론트 공개 조회를 ugc 로 전환

**Files:**
- Create: `web/almondyoung-storefront/src/lib/api/ugc/shop-listings.ts`
- Delete: `web/almondyoung-storefront/src/lib/api/pim/shop-listings.ts`
- Modify(`web/almondyoung-storefront/src/` 아래):
  - `lib/types/dto/shop-listing.ts`, `lib/types/ui/shop-listing.ts`
  - `app/[countryCode]/(main)/shop-trade/[slug]/page.tsx`, `app/[countryCode]/(main)/shop-trade/page.tsx`
  - `domains/shop-trade/components/listing-card/index.tsx`, `domains/shop-trade/components/related-listings/index.tsx`, `domains/shop-trade/components/view-beacon/index.tsx`
  - `domains/home/template/shop-trade/index.tsx`, `app/sitemap.ts`
  - `i18n/messages/{ko,en,ja}/shopTrade.json`

**Interfaces:**
- Consumes: `ShopListingMarkdown` (Task 2), `toPlainSummary` (Task 1)
- Produces:
  - DTO: `ShopListingStatus`, `ShopListingResponseDto`, `MyShopListingResponseDto`, `ShopListingContactDto`, `MemberShopListingPayload`
  - UI: `ShopListingItem`, `MyShopListingItem`
  - API: `listPublicShopListings()`, `getPublicShopListing(slug)`, `recordShopListingView(slug)`

- [ ] **Step 1: 기준선 기록**

```bash
cd web/almondyoung-storefront && npx tsc --noEmit 2>&1 | grep -c "error TS" ; cd ../..
```

값을 메모한다. 스토어프론트는 빌드가 타입을 안 봐서 기존 에러가 있을 수 있다. 이 PR 의 기준은 **샵 매매 관련 파일에서 새 에러 0** 이다.

- [ ] **Step 2: DTO 교체**

`lib/types/dto/shop-listing.ts` 에서 `SHOP_LISTING_*` 상수 셋은 그대로 두고, `ShopListingResponseDto` 이하를 아래로 바꾼다:

```ts
export const SHOP_LISTING_STATUSES = [
  "pending",
  "published",
  "rejected",
  "hidden",
  "closed",
] as const

export type ShopListingStatus = (typeof SHOP_LISTING_STATUSES)[number]

/** ugc `GET /shop-listings/public(/:slug)`. 연락처·작성자는 없다. status 는 published 또는 closed */
export interface ShopListingResponseDto {
  id: string
  slug: string
  title: string
  /** 마크다운 */
  content: string
  region: ShopListingRegion | null
  businessType: ShopListingBusinessType | null
  dealType: ShopListingDealType | null
  areaPyeong: number | null
  deposit: number | null
  monthlyRent: number | null
  keyMoney: number | null
  /** imageFileIds[0] */
  thumbnailFileId: string | null
  /** 순서 = 노출 순서 */
  imageFileIds: string[]
  status: ShopListingStatus
  viewCount: number
  createdAt: string
  updatedAt: string
}

/** ugc `GET /shop-listings/mine`·`/:id`. 작성 회원 본인에게만 */
export interface MyShopListingResponseDto extends ShopListingResponseDto {
  /** status 가 rejected 일 때만 */
  rejectReason: string | null
  /** 숫자만 */
  contactPhone: string | null
  kakaoOpenChatUrl: string | null
  submittedAt: string | null
}

/** ugc `GET /shop-listings/public/:slug/contact` (로그인 필요) */
export interface ShopListingContactDto {
  contactPhone: string | null
  kakaoOpenChatUrl: string | null
}

/** ugc `POST /shop-listings`·`PUT /shop-listings/:id` 본문 */
export interface MemberShopListingPayload {
  title: string
  content: string
  region: ShopListingRegion
  businessType: ShopListingBusinessType
  dealType: ShopListingDealType
  areaPyeong: number | null
  deposit: number | null
  monthlyRent: number | null
  keyMoney: number | null
  imageFileIds: string[]
  contactPhone: string
  kakaoOpenChatUrl: string | null
}
```

`lib/types/ui/shop-listing.ts` 의 import·export 에 `MyShopListingResponseDto`·`ShopListingStatus`·`SHOP_LISTING_STATUSES` 를 더한다. 그리고 `ShopListingItem` 아래에 추가:

```ts
export interface MyShopListingItem extends MyShopListingResponseDto {}
```

- [ ] **Step 3: API 모듈을 옮긴다**

`git mv web/almondyoung-storefront/src/lib/api/pim/shop-listings.ts web/almondyoung-storefront/src/lib/api/ugc/shop-listings.ts` 한 뒤, 파일 안의 `"pim"` 세 곳을 `"ugc"` 로 바꾼다. 나머지(캐시 태그 `shop-listings`, `revalidate: 60`, `encodeSlugOnce`, `x-visitor-ip`)는 그대로 둔다. 파일 머리 주석을 추가한다:

```ts
// 샵 매매는 2026-09 ugc-service 로 옮겼다(spec 2026-09-23-shop-listings-to-ugc-design). core(pim) 의 옛 API 는 PR 3 에서 지운다.
```

- [ ] **Step 4: import 경로 일괄 교체**

```bash
cd web/almondyoung-storefront
grep -rl "@/lib/api/pim/shop-listings" src | xargs sed -i 's#@/lib/api/pim/shop-listings#@/lib/api/ugc/shop-listings#'
grep -rn "api/pim/shop-listings" src ; cd ../..
```

Expected: 마지막 grep 결과 없음. 대상은 6곳(sitemap·목록·상세·related-listings·view-beacon·home)이다.

- [ ] **Step 5: 카드 — 필드 이름과 거래완료 배지**

`listing-card/index.tsx`:
- import 에 `import { Badge } from "@/components/ui/badge"` 추가.
- `images={listing.images}` → `images={listing.imageFileIds}`.
- 제목 `<h2>` 를 아래로 감싼다:

```tsx
        <div className="mt-0.5 flex min-w-0 items-center gap-1">
          {listing.status === "closed" && (
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px] font-medium">
              {t("closed")}
            </Badge>
          )}
          <h2 className="text-foreground line-clamp-1 text-sm font-medium sm:text-base">
            {listing.title}
          </h2>
        </div>
```

(원래 `<h2>` 의 `mt-0.5` 는 감싸는 div 로 옮겼다.)

- [ ] **Step 6: 상세 — 마크다운·요약·갤러리·배지**

`[slug]/page.tsx`:
- import 제거: `Image`, `sanitizeNoticeHtml`.
- import 추가: `toPlainSummary`, `Badge`, `ShopListingMarkdown`.

  ```tsx
  import { toPlainSummary } from "@packages/shop-listing-markdown"
  import { Badge } from "@/components/ui/badge"
  import { ShopListingMarkdown } from "@/domains/shop-trade/components/listing-markdown"
  ```
- 파일 안의 로컬 `toPlainSummary(html)` 함수를 **삭제**한다(패키지 것을 쓴다).
- 본문 컴포넌트의 `const thumbnailUrl = …` 선언을 삭제한다. `generateMetadata` 안의 것은 남긴다.
- 제목 `<h1>` 을 아래로 바꾼다:

```tsx
      <div className="mt-1 flex items-center gap-2">
        {listing.status === "closed" && (
          <Badge variant="secondary">{t("closed")}</Badge>
        )}
        <h1 className="text-foreground text-2xl font-bold">{listing.title}</h1>
      </div>
```

- 갤러리 블록(`{listing.images.length > 0 ? … : …}`) 전체를 아래로 바꾼다. 썸네일이 곧 `imageFileIds[0]` 이라 옛 대체 분기는 도달 불가다:

```tsx
      {listing.imageFileIds.length > 0 && (
        <ListingGallery images={listing.imageFileIds} alt={listing.title} />
      )}
```

- 본문 `<div … dangerouslySetInnerHTML … />` 를 아래로 바꾼다:

```tsx
      <ShopListingMarkdown content={listing.content} className="mt-6" />
```

- [ ] **Step 7: 문구 `closed`**

세 로케일 `shopTrade.json` 의 `"negotiable"` 바로 위에 추가:
- ko: `"closed": "거래완료",`
- en: `"closed": "Closed",`
- ja: `"closed": "取引完了",`

- [ ] **Step 8: 검증**

```bash
cd web/almondyoung-storefront
npx vitest run src/i18n
npx tsc --noEmit 2>&1 | grep -E "shop-trade|shop-listing|sitemap|home/template/shop-trade" ; echo "filtered-exit=$?"
NEXT_DIST_DIR=.next-local npx next build && rm -rf .next-local
cd ../..
```

Expected:
- 로케일 대조 PASS.
- 필터된 tsc 결과 없음(`filtered-exit=1`).
- 빌드 성공. 여기서 상세 페이지가 `@packages/shop-listing-markdown` 을 실제로 번들한다 — Task 2 Step 6 의 실증이 이것으로 끝난다.

- [ ] **Step 9: 커밋**

```bash
git add -A web/almondyoung-storefront/src
git commit -m "feat(storefront): 샵 매매 공개 조회를 ugc 로 옮기고 본문을 마크다운으로, 거래완료에 배지를 단다"
```

---

### Task 5: 스토어프론트 순수 로직 — 상태별 동작과 전화번호

**Files:**
- Create(`web/almondyoung-storefront/src/domains/shop-trade/`): `my-listing-status.ts`, `my-listing-status.test.ts`, `phone.ts`, `phone.test.ts`

**Interfaces:**
- Consumes: `ShopListingStatus` (Task 4, type-only)
- Produces:
  - `MyListingAction = "edit" | "close" | "reopen" | "delete"`
  - `myListingActions(status: ShopListingStatus): readonly MyListingAction[]`
  - `editRequiresReReview(status: ShopListingStatus): boolean`
  - `stripPhone(input: string): string`
  - `isValidPhone(digits: string): boolean`
  - `formatPhone(digits: string): string`

- [ ] **Step 1: 테스트를 쓴다**

`my-listing-status.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { editRequiresReReview, myListingActions } from "./my-listing-status"

describe("myListingActions (spec §8.1 표)", () => {
  it.each([
    ["published", ["edit", "close", "delete"]],
    ["closed", ["edit", "reopen", "delete"]],
    ["pending", ["edit", "delete"]],
    ["rejected", ["edit", "delete"]],
    ["hidden", ["delete"]],
  ] as const)("%s → %j", (status, expected) => {
    expect(myListingActions(status)).toEqual(expected)
  })
})

describe("editRequiresReReview", () => {
  it("공개 중인 글(게시·거래완료)만 수정하면 비공개로 내려간다", () => {
    expect(editRequiresReReview("published")).toBe(true)
    expect(editRequiresReReview("closed")).toBe(true)
    expect(editRequiresReReview("pending")).toBe(false)
    expect(editRequiresReReview("rejected")).toBe(false)
    expect(editRequiresReReview("hidden")).toBe(false)
  })
})
```

`phone.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { formatPhone, isValidPhone, stripPhone } from "./phone"

describe("stripPhone", () => {
  it("하이픈·공백을 지운다 (서버 stripPhoneSeparators 와 같은 규칙)", () => {
    expect(stripPhone(" 010-1234 5678 ")).toBe("01012345678")
  })
})

describe("isValidPhone", () => {
  it.each([
    ["01012345678", true],
    ["0212345678", true],
    ["021234567", true],
    ["1012345678", false],
    ["010123456789", false],
    ["0101234567a", false],
    ["", false],
  ])("%s → %s", (digits, expected) => {
    expect(isValidPhone(digits)).toBe(expected)
  })
})

describe("formatPhone", () => {
  it.each([
    ["01012345678", "010-1234-5678"],
    ["0311234567", "031-123-4567"],
    ["0212345678", "02-1234-5678"],
    ["021234567", "02-123-4567"],
    ["15881234", "15881234"],
  ])("%s → %s", (digits, expected) => {
    expect(formatPhone(digits)).toBe(expected)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd web/almondyoung-storefront && npx vitest run src/domains/shop-trade/my-listing-status.test.ts src/domains/shop-trade/phone.test.ts; cd ../..`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`my-listing-status.ts`:

```ts
import type { ShopListingStatus } from "../../lib/types/dto/shop-listing"

export type MyListingAction = "edit" | "close" | "reopen" | "delete"

// 서버 전이표(spec §5)의 회원 몫. hidden 은 수정하면 409 라 삭제만 연다.
const ACTIONS: Record<ShopListingStatus, readonly MyListingAction[]> = {
  published: ["edit", "close", "delete"],
  closed: ["edit", "reopen", "delete"],
  pending: ["edit", "delete"],
  rejected: ["edit", "delete"],
  hidden: ["delete"],
}

export function myListingActions(
  status: ShopListingStatus
): readonly MyListingAction[] {
  return ACTIONS[status]
}

/** 공개 중인 글을 고치면 pending 으로 내려가 공개 목록에서 빠진다 — 제출 전에 알린다 */
export function editRequiresReReview(status: ShopListingStatus): boolean {
  return status === "published" || status === "closed"
}
```

`phone.ts`:

```ts
const PHONE_PATTERN = /^0\d{8,10}$/

/** 서버(ugc stripPhoneSeparators)와 같이 하이픈·공백만 지운다 */
export function stripPhone(input: string): string {
  return input.replace(/[\s-]/g, "")
}

export function isValidPhone(digits: string): boolean {
  return PHONE_PATTERN.test(digits)
}

/** 숫자만 받은 번호를 보여줄 때 하이픈을 넣는다. 모르는 모양은 그대로 */
export function formatPhone(digits: string): string {
  if (digits.startsWith("02")) {
    if (digits.length === 9) return `02-${digits.slice(2, 5)}-${digits.slice(5)}`
    if (digits.length === 10) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`
    return digits
  }
  if (digits.length === 10)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  return digits
}
```

- [ ] **Step 4: 통과 확인**

Run: 위 Step 2 명령
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/almondyoung-storefront/src/domains/shop-trade/my-listing-status.ts web/almondyoung-storefront/src/domains/shop-trade/my-listing-status.test.ts \
  web/almondyoung-storefront/src/domains/shop-trade/phone.ts web/almondyoung-storefront/src/domains/shop-trade/phone.test.ts
git commit -m "feat(storefront): 내 매물 상태별 동작과 전화번호 표시 규칙을 순수 함수로 둔다"
```

---

### Task 6: 스토어프론트 순수 로직 — 작성 폼 모델

**Files:**
- Create: `web/almondyoung-storefront/src/domains/shop-trade/listing-form.ts`, `listing-form.test.ts`

**Interfaces:**
- Consumes: `stripPhone`, `isValidPhone`, `formatPhone` (Task 5); DTO 타입 (Task 4)
- Produces:
  - `ShopListingFormValues`
  - `ShopListingFormField = "title" | "region" | "businessType" | "imageFileIds" | "content" | "contactPhone" | "kakaoOpenChatUrl"`
  - `EMPTY_SHOP_LISTING_FORM: ShopListingFormValues`
  - `formValuesFromListing(listing: MyShopListingResponseDto): ShopListingFormValues`
  - `buildMemberPayload(values: ShopListingFormValues): { ok: true; payload: MemberShopListingPayload } | { ok: false; field: ShopListingFormField }`
  - `MAX_SHOP_LISTING_IMAGES = 15`

- [ ] **Step 1: 테스트를 쓴다**

```ts
import { describe, expect, it } from "vitest"
import type { MyShopListingResponseDto } from "../../lib/types/dto/shop-listing"
import {
  EMPTY_SHOP_LISTING_FORM,
  buildMemberPayload,
  formValuesFromListing,
  type ShopListingFormValues,
} from "./listing-form"

const FILE = "019f890e-dec0-7060-a32e-024c3e47c6be"

const valid: ShopListingFormValues = {
  ...EMPTY_SHOP_LISTING_FORM,
  title: " 강남 네일샵 ",
  content: "시설 좋아요",
  region: "seoul",
  businessType: "nail",
  dealType: "transfer",
  areaPyeong: "15",
  deposit: "2000",
  monthlyRent: "",
  keyMoney: "3000",
  imageFileIds: [FILE],
  contactPhone: "010-1234-5678",
  kakaoOpenChatUrl: " ",
}

describe("buildMemberPayload", () => {
  it("만원 → 원, 빈 칸 → null, 전화는 숫자만, 빈 오픈채팅은 null", () => {
    expect(buildMemberPayload(valid)).toEqual({
      ok: true,
      payload: {
        title: "강남 네일샵",
        content: "시설 좋아요",
        region: "seoul",
        businessType: "nail",
        dealType: "transfer",
        areaPyeong: 15,
        deposit: 20_000_000,
        monthlyRent: null,
        keyMoney: 30_000_000,
        imageFileIds: [FILE],
        contactPhone: "01012345678",
        kakaoOpenChatUrl: null,
      },
    })
  })

  it.each([
    [{ title: "  " }, "title"],
    [{ region: "" }, "region"],
    [{ businessType: "" }, "businessType"],
    [{ imageFileIds: [] }, "imageFileIds"],
    [{ imageFileIds: Array.from({ length: 16 }, (_, i) => `${i}`) }, "imageFileIds"],
    [{ content: " \n " }, "content"],
    [{ content: "가".repeat(10_001) }, "content"],
    [{ contactPhone: "" }, "contactPhone"],
    [{ contactPhone: "1234" }, "contactPhone"],
    [{ kakaoOpenChatUrl: "https://example.com" }, "kakaoOpenChatUrl"],
  ] as const)("%j → %s 에서 멈춘다", (patch, field) => {
    expect(buildMemberPayload({ ...valid, ...patch })).toEqual({ ok: false, field })
  })

  it("오픈채팅 주소는 그대로 싣는다", () => {
    const result = buildMemberPayload({
      ...valid,
      kakaoOpenChatUrl: "https://open.kakao.com/o/abc",
    })
    expect(result.ok && result.payload.kakaoOpenChatUrl).toBe(
      "https://open.kakao.com/o/abc"
    )
  })
})

describe("formValuesFromListing", () => {
  it("원 → 만원 문자열, 전화는 하이픈 표시, null 은 빈 칸", () => {
    const listing = {
      title: "t",
      content: "c",
      region: "busan",
      businessType: "lash",
      dealType: "lease",
      areaPyeong: null,
      deposit: 5_000_000,
      monthlyRent: null,
      keyMoney: null,
      imageFileIds: [FILE],
      contactPhone: "0212345678",
      kakaoOpenChatUrl: null,
    } as unknown as MyShopListingResponseDto

    expect(formValuesFromListing(listing)).toEqual({
      title: "t",
      content: "c",
      region: "busan",
      businessType: "lash",
      dealType: "lease",
      areaPyeong: "",
      deposit: "500",
      monthlyRent: "",
      keyMoney: "",
      imageFileIds: [FILE],
      contactPhone: "02-1234-5678",
      kakaoOpenChatUrl: "",
    })
  })
})
```

(테스트 픽스처의 `as unknown as` 는 필요한 필드만 채우려는 것이다. 제품 코드에는 캐스팅을 쓰지 않는다.)

- [ ] **Step 2: 실패 확인**

Run: `cd web/almondyoung-storefront && npx vitest run src/domains/shop-trade/listing-form.test.ts; cd ../..`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
import type {
  MemberShopListingPayload,
  MyShopListingResponseDto,
  ShopListingBusinessType,
  ShopListingDealType,
  ShopListingRegion,
} from "../../lib/types/dto/shop-listing"
import { formatPhone, isValidPhone, stripPhone } from "./phone"

// 서버 DTO(ugc MemberShopListingDto)와 같은 한계. 서버도 거르지만, 폼에서 먼저 막아 어느 칸인지 짚어 준다.
export const MAX_SHOP_LISTING_IMAGES = 15
const MAX_TITLE_LENGTH = 255
const MAX_CONTENT_LENGTH = 10_000
const KAKAO_OPEN_CHAT_PREFIX = "https://open.kakao.com/"

/** 금액은 만원 단위 문자열로 받는다 (admin 폼과 같은 단위) */
export interface ShopListingFormValues {
  title: string
  content: string
  region: ShopListingRegion | ""
  businessType: ShopListingBusinessType | ""
  dealType: ShopListingDealType
  areaPyeong: string
  deposit: string
  monthlyRent: string
  keyMoney: string
  imageFileIds: string[]
  contactPhone: string
  kakaoOpenChatUrl: string
}

export type ShopListingFormField =
  | "title"
  | "region"
  | "businessType"
  | "imageFileIds"
  | "content"
  | "contactPhone"
  | "kakaoOpenChatUrl"

export const EMPTY_SHOP_LISTING_FORM: ShopListingFormValues = {
  title: "",
  content: "",
  region: "",
  businessType: "",
  dealType: "transfer",
  areaPyeong: "",
  deposit: "",
  monthlyRent: "",
  keyMoney: "",
  imageFileIds: [],
  contactPhone: "",
  kakaoOpenChatUrl: "",
}

const toWon = (manwon: string): number | null =>
  manwon.trim() === "" ? null : Number(manwon) * 10_000
const toManwon = (won: number | null): string =>
  won === null ? "" : String(won / 10_000)
const toInt = (value: string): number | null =>
  value.trim() === "" ? null : Number(value)

export function formValuesFromListing(
  listing: MyShopListingResponseDto
): ShopListingFormValues {
  return {
    title: listing.title,
    content: listing.content,
    region: listing.region ?? "",
    businessType: listing.businessType ?? "",
    dealType: listing.dealType ?? "transfer",
    areaPyeong: listing.areaPyeong === null ? "" : String(listing.areaPyeong),
    deposit: toManwon(listing.deposit),
    monthlyRent: toManwon(listing.monthlyRent),
    keyMoney: toManwon(listing.keyMoney),
    imageFileIds: listing.imageFileIds,
    contactPhone: listing.contactPhone ? formatPhone(listing.contactPhone) : "",
    kakaoOpenChatUrl: listing.kakaoOpenChatUrl ?? "",
  }
}

export type BuildMemberPayloadResult =
  | { ok: true; payload: MemberShopListingPayload }
  | { ok: false; field: ShopListingFormField }

/** 화면 위에서 아래 순서로 첫 문제 칸 하나를 돌려준다 */
export function buildMemberPayload(
  values: ShopListingFormValues
): BuildMemberPayloadResult {
  const title = values.title.trim()
  if (!title || title.length > MAX_TITLE_LENGTH) return { ok: false, field: "title" }
  if (!values.region) return { ok: false, field: "region" }
  if (!values.businessType) return { ok: false, field: "businessType" }
  if (
    values.imageFileIds.length === 0 ||
    values.imageFileIds.length > MAX_SHOP_LISTING_IMAGES
  )
    return { ok: false, field: "imageFileIds" }
  if (!values.content.trim() || values.content.length > MAX_CONTENT_LENGTH)
    return { ok: false, field: "content" }

  const contactPhone = stripPhone(values.contactPhone)
  if (!isValidPhone(contactPhone)) return { ok: false, field: "contactPhone" }

  const kakao = values.kakaoOpenChatUrl.trim()
  if (kakao && !kakao.startsWith(KAKAO_OPEN_CHAT_PREFIX))
    return { ok: false, field: "kakaoOpenChatUrl" }

  return {
    ok: true,
    payload: {
      title,
      content: values.content,
      region: values.region,
      businessType: values.businessType,
      dealType: values.dealType,
      areaPyeong: toInt(values.areaPyeong),
      deposit: toWon(values.deposit),
      monthlyRent: toWon(values.monthlyRent),
      keyMoney: toWon(values.keyMoney),
      imageFileIds: values.imageFileIds,
      contactPhone,
      kakaoOpenChatUrl: kakao || null,
    },
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: Step 2 명령
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/almondyoung-storefront/src/domains/shop-trade/listing-form.ts web/almondyoung-storefront/src/domains/shop-trade/listing-form.test.ts
git commit -m "feat(storefront): 매물 작성 폼 값을 ugc 요청 본문으로 바꾸고 첫 문제 칸을 짚는다"
```

---

### Task 7: 스토어프론트 서버 액션 — 결과 객체와 회원 API

**Files:**
- Create:
  - `web/almondyoung-storefront/src/domains/shop-trade/action-result.ts`, `action-result.test.ts`
  - `web/almondyoung-storefront/src/lib/api/ugc/my-shop-listings.ts`
- Modify: `web/almondyoung-storefront/src/lib/api/ugc/shop-listings.ts` (연락처 액션 추가)

**Interfaces:**
- Consumes: `HttpApiError`·`ApiAuthError` (`lib/api/api-error.ts`), DTO (Task 4)
- Produces:
  - `ShopListingActionResult<T> = { ok: true; data: T } | ShopListingActionFailure`
  - `ShopListingActionFailure = { ok: false; status: number; message: string }`
  - `toActionFailure(error: unknown): ShopListingActionFailure`
  - `getShopListingContact(slug)`
  - `listMyShopListings()`, `getMyShopListing(id)`, `createMyShopListing(payload)`, `updateMyShopListing(id, payload)`, `closeMyShopListing(id)`, `reopenMyShopListing(id)`, `deleteMyShopListing(id)` — 전부 `Promise<ShopListingActionResult<…>>`

- [ ] **Step 1: 테스트**

`action-result.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { ApiAuthError, HttpApiError } from "../../lib/api/api-error"
import { toActionFailure } from "./action-result"

describe("toActionFailure", () => {
  it("서버 에러는 상태와 서버 문구를 그대로 싣는다", () => {
    expect(
      toActionFailure(new HttpApiError("매물은 3건까지입니다", 409, "Conflict"))
    ).toEqual({ ok: false, status: 409, message: "매물은 3건까지입니다" })
  })

  it("로그인이 없으면 401", () => {
    expect(toActionFailure(new ApiAuthError())).toEqual({
      ok: false,
      status: 401,
      message: "UNAUTHORIZED",
    })
  })

  it("모르는 에러는 500 과 빈 문구 — 화면이 자기 문구를 쓴다", () => {
    expect(toActionFailure(new Error("boom"))).toEqual({
      ok: false,
      status: 500,
      message: "",
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd web/almondyoung-storefront && npx vitest run src/domains/shop-trade/action-result.test.ts; cd ../..`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `action-result.ts`**

```ts
import { HttpApiError } from "../../lib/api/api-error"

export type ShopListingActionFailure = {
  ok: false
  status: number
  message: string
}

export type ShopListingActionResult<T> =
  | { ok: true; data: T }
  | ShopListingActionFailure

/**
 * 서버 액션이 throw 한 에러는 프로덕션에서 메시지가 지워져 화면이 한도 초과(409)와 숨김(409)을
 * 구별할 문구를 잃는다. 그래서 회원 서버 액션은 throw 하지 않고 이 모양으로 돌려준다.
 */
export function toActionFailure(error: unknown): ShopListingActionFailure {
  if (error instanceof HttpApiError) {
    return { ok: false, status: error.status, message: error.message }
  }
  return { ok: false, status: 500, message: "" }
}
```

- [ ] **Step 4: 통과 확인**

Run: Step 2 명령
Expected: PASS

- [ ] **Step 5: 연락처 액션**

`lib/api/ugc/shop-listings.ts` 에 import 두 개와 함수를 더한다:

```ts
import {
  toActionFailure,
  type ShopListingActionResult,
} from "@/domains/shop-trade/action-result"
import type { ShopListingContactDto } from "@/lib/types/dto/shop-listing"
```

```ts
/** 로그인 회원에게만. 공개 상세는 캐시되므로 연락처는 이 호출로만 받는다(spec §7.2) */
export async function getShopListingContact(
  slug: string
): Promise<ShopListingActionResult<ShopListingContactDto>> {
  try {
    const data = await api<ShopListingContactDto>(
      "ugc",
      `/shop-listings/public/${encodeSlugOnce(slug)}/contact`,
      { method: "GET", withAuth: true, cache: "no-store" }
    )
    return { ok: true, data }
  } catch (error) {
    return toActionFailure(error)
  }
}
```

- [ ] **Step 6: 회원 액션 모듈**

`lib/api/ugc/my-shop-listings.ts`:

```ts
"use server"

import { revalidateTag } from "next/cache"
import {
  toActionFailure,
  type ShopListingActionResult,
} from "@/domains/shop-trade/action-result"
import type {
  MemberShopListingPayload,
  MyShopListingResponseDto,
} from "@/lib/types/dto/shop-listing"
import { api } from "../api"

// 공개 조회(shop-listings.ts)의 캐시 태그. 회원이 글을 바꾸면 이 서버의 ISR 캐시는 바로 비운다 —
// CDN 층은 남으므로 공개 반영은 여전히 「60초 안」이다.
const SHOP_LISTINGS_TAG = "shop-listings"

async function call<T>(
  path: string,
  init: { method: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown },
  mutates: boolean
): Promise<ShopListingActionResult<T>> {
  try {
    const data = await api<T>("ugc", path, {
      method: init.method,
      body: init.body,
      withAuth: true,
      cache: "no-store",
    })
    if (mutates) revalidateTag(SHOP_LISTINGS_TAG)
    return { ok: true, data }
  } catch (error) {
    return toActionFailure(error)
  }
}

export async function listMyShopListings() {
  return call<MyShopListingResponseDto[]>("/shop-listings/mine", { method: "GET" }, false)
}

export async function getMyShopListing(id: string) {
  return call<MyShopListingResponseDto>(
    `/shop-listings/${encodeURIComponent(id)}`,
    { method: "GET" },
    false
  )
}

export async function createMyShopListing(payload: MemberShopListingPayload) {
  return call<MyShopListingResponseDto>(
    "/shop-listings",
    { method: "POST", body: payload },
    true
  )
}

export async function updateMyShopListing(
  id: string,
  payload: MemberShopListingPayload
) {
  return call<MyShopListingResponseDto>(
    `/shop-listings/${encodeURIComponent(id)}`,
    { method: "PUT", body: payload },
    true
  )
}

export async function closeMyShopListing(id: string) {
  return call<MyShopListingResponseDto>(
    `/shop-listings/${encodeURIComponent(id)}/close`,
    { method: "POST" },
    true
  )
}

export async function reopenMyShopListing(id: string) {
  return call<MyShopListingResponseDto>(
    `/shop-listings/${encodeURIComponent(id)}/reopen`,
    { method: "POST" },
    true
  )
}

export async function deleteMyShopListing(id: string) {
  return call<void>(
    `/shop-listings/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    true
  )
}
```

`api()` 의 `body?: unknown` 옵션은 JSON 으로 직렬화된다(`lib/api/api.ts` 의 `RequestOptions`). ugc 가 close/reopen 에 204 를 주면 `api()` 는 `undefined` 를 돌려준다. 화면은 `data` 를 쓰지 않고 `router.refresh()` 하므로 무해하다.

- [ ] **Step 7: tsc 필터 확인**

Run: `cd web/almondyoung-storefront && npx tsc --noEmit 2>&1 | grep -E "shop-trade|shop-listing" ; echo "filtered-exit=$?"; cd ../..`
Expected: 결과 없음

- [ ] **Step 8: 커밋**

```bash
git add web/almondyoung-storefront/src/domains/shop-trade/action-result.ts web/almondyoung-storefront/src/domains/shop-trade/action-result.test.ts \
  web/almondyoung-storefront/src/lib/api/ugc/shop-listings.ts web/almondyoung-storefront/src/lib/api/ugc/my-shop-listings.ts
git commit -m "feat(storefront): 샵 매매 회원·연락처 서버 액션이 에러를 결과 객체로 돌려준다"
```

---

### Task 8: 「연락처 보기」

**Files:**
- Create: `web/almondyoung-storefront/src/domains/shop-trade/components/contact-reveal/index.tsx`
- Modify: `web/almondyoung-storefront/src/app/[countryCode]/(main)/shop-trade/[slug]/page.tsx`, `i18n/messages/{ko,en,ja}/shopTrade.json`

**Interfaces:**
- Consumes: `getShopListingContact` (Task 7), `formatPhone` (Task 5)
- Produces: `ContactReveal({ slug, countryCode }: { slug: string; countryCode: string })`

- [ ] **Step 1: 문구 (세 로케일, `shopTrade.json` 최상위에 `contact` 객체)**

ko:

```json
  "contact": {
    "show": "연락처 보기",
    "call": "전화하기",
    "openChat": "카카오 오픈채팅",
    "none": "등록된 연락처가 없어요",
    "loadFail": "연락처를 불러오지 못했어요. 다시 시도해 주세요"
  },
```

en:

```json
  "contact": {
    "show": "Show contact",
    "call": "Call",
    "openChat": "KakaoTalk open chat",
    "none": "No contact info registered",
    "loadFail": "Couldn't load contact info. Please try again"
  },
```

ja:

```json
  "contact": {
    "show": "連絡先を見る",
    "call": "電話する",
    "openChat": "カカオオープンチャット",
    "none": "登録された連絡先がありません",
    "loadFail": "連絡先を読み込めませんでした。もう一度お試しください"
  },
```

- [ ] **Step 2: 컴포넌트**

```tsx
"use client"

import { MessageCircle, Phone } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { formatPhone } from "@/domains/shop-trade/phone"
import { getShopListingContact } from "@/lib/api/ugc/shop-listings"
import { siteConfig } from "@/lib/config/site"
import type { ShopListingContactDto } from "@/lib/types/dto/shop-listing"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"

/**
 * 상세 페이지는 뷰어 구분 없이 캐시된다(ADR-0038). 그래서 버튼은 로그인 여부와 무관하게 같은 모양이고,
 * 누른 뒤에야 서버 액션이 로그인 여부를 가른다. 이 화면의 Primary CTA 는 이 버튼 하나다(DESIGN.md §1).
 */
export function ContactReveal({
  slug,
  countryCode,
}: {
  slug: string
  countryCode: string
}) {
  const t = useTranslations("shopTrade.contact")
  const [pending, setPending] = useState(false)
  const [contact, setContact] = useState<ShopListingContactDto | null>(null)

  const reveal = async () => {
    setPending(true)
    const result = await getShopListingContact(slug)
    setPending(false)

    if (result.ok) {
      setContact(result.data)
      return
    }
    if (result.status === 401) {
      const path = getPathWithoutCountry(countryCode)
      window.location.href = `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
      return
    }
    toast.error(t("loadFail"))
  }

  if (!contact) {
    return (
      <Button
        onClick={() => void reveal()}
        disabled={pending}
        className="mt-6 h-[52px] w-full rounded-xl text-base font-bold"
      >
        {t("show")}
      </Button>
    )
  }

  if (!contact.contactPhone && !contact.kakaoOpenChatUrl) {
    return (
      <p className="bg-muted text-muted-foreground mt-6 rounded-xl p-4 text-center text-sm">
        {t("none")}
      </p>
    )
  }

  return (
    <div className="border-border mt-6 grid gap-2 rounded-xl border p-4">
      {contact.contactPhone && (
        <a
          href={`tel:${contact.contactPhone}`}
          className="text-foreground flex items-center gap-2 text-base font-bold"
        >
          <Phone className="h-4 w-4" />
          {formatPhone(contact.contactPhone)}
          <span className="text-muted-foreground text-sm font-normal">
            {t("call")}
          </span>
        </a>
      )}
      {contact.kakaoOpenChatUrl && (
        <a
          href={contact.kakaoOpenChatUrl}
          target="_blank"
          rel="nofollow noopener noreferrer"
          className="text-foreground flex items-center gap-2 text-sm font-medium"
        >
          <MessageCircle className="h-4 w-4" />
          {t("openChat")}
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 상세 페이지에 배치**

`[slug]/page.tsx`:
- 컴포넌트에서 `params` 로 `countryCode` 도 꺼낸다: `const { countryCode, slug } = await params`.
- 거래 조건 `<dl>` 바로 뒤, `<ShopListingMarkdown>` 앞에 추가:

```tsx
      <ContactReveal slug={listing.slug} countryCode={countryCode} />
```

- import 추가: `import { ContactReveal } from "@/domains/shop-trade/components/contact-reveal"`.

- [ ] **Step 4: 검증**

```bash
cd web/almondyoung-storefront
npx vitest run src/i18n
npx tsc --noEmit 2>&1 | grep -E "shop-trade|shop-listing" ; echo "filtered-exit=$?"
cd ../..
```

Expected: PASS, 필터 결과 없음

- [ ] **Step 5: 커밋**

```bash
git add web/almondyoung-storefront/src/domains/shop-trade/components/contact-reveal "web/almondyoung-storefront/src/app/[countryCode]/(main)/shop-trade/[slug]/page.tsx" \
  web/almondyoung-storefront/src/i18n/messages
git commit -m "feat(storefront): 샵 매매 상세에 로그인 회원 전용 「연락처 보기」를 둔다"
```

---

### Task 9: 내 매물 목록과 진입점

**Files:**
- Create:
  - `web/almondyoung-storefront/src/app/[countryCode]/(mypage)/mypage/shop-listings/page.tsx`
  - `web/almondyoung-storefront/src/domains/shop-trade/components/my-listings/index.tsx`
- Modify:
  - `web/almondyoung-storefront/src/domains/mypage/components/constants/mypage-constants.ts`
  - `web/almondyoung-storefront/src/app/[countryCode]/(main)/shop-trade/page.tsx`
  - `i18n/messages/{ko,en,ja}/shopTrade.json`, `mypage.json`

**Interfaces:**
- Consumes: `listMyShopListings`·`closeMyShopListing`·`reopenMyShopListing`·`deleteMyShopListing` (Task 7), `myListingActions` (Task 5), `MyShopListingItem` (Task 4)
- Produces: 라우트 `/mypage/shop-listings`; `MyListings({ items }: { items: MyShopListingItem[] })`

- [ ] **Step 1: 문구**

`mypage.json` 의 `menu` 에 `"review"` 다음 줄로 추가:
- ko `"myShopListings": "내 매물",`
- en `"myShopListings": "My shop listings",`
- ja `"myShopListings": "マイ物件",`

`shopTrade.json` 최상위에 `"register"` 와 `mine` 을 추가.

ko:

```json
  "register": "매물 등록",
  "mine": {
    "title": "내 매물",
    "empty": "아직 올린 매물이 없어요",
    "register": "매물 등록하기",
    "loadFail": "매물을 불러오지 못했어요. 다시 시도해 주세요",
    "status": {
      "pending": "검토 대기",
      "published": "게시 중",
      "rejected": "반려",
      "hidden": "숨김",
      "closed": "거래완료"
    },
    "rejectReason": "반려 사유: {reason}",
    "hiddenNotice": "관리자가 숨긴 글은 수정할 수 없어요",
    "edit": "수정",
    "close": "거래완료로 바꾸기",
    "reopen": "다시 게시하기",
    "delete": "삭제",
    "deleteTitle": "매물을 삭제할까요?",
    "deleteBody": "삭제하면 되돌릴 수 없어요.",
    "cancel": "취소",
    "closedDone": "거래완료로 바꿨어요",
    "reopenedDone": "다시 게시했어요",
    "deletedDone": "삭제했어요",
    "actionFail": "처리하지 못했어요. 다시 시도해 주세요"
  },
```

en:

```json
  "register": "List your shop",
  "mine": {
    "title": "My shop listings",
    "empty": "You haven't listed a shop yet",
    "register": "List a shop",
    "loadFail": "Couldn't load your listings. Please try again",
    "status": {
      "pending": "In review",
      "published": "Published",
      "rejected": "Rejected",
      "hidden": "Hidden",
      "closed": "Closed"
    },
    "rejectReason": "Reason: {reason}",
    "hiddenNotice": "Listings hidden by an admin can't be edited",
    "edit": "Edit",
    "close": "Mark as closed",
    "reopen": "Publish again",
    "delete": "Delete",
    "deleteTitle": "Delete this listing?",
    "deleteBody": "This can't be undone.",
    "cancel": "Cancel",
    "closedDone": "Marked as closed",
    "reopenedDone": "Published again",
    "deletedDone": "Deleted",
    "actionFail": "Couldn't complete that. Please try again"
  },
```

ja:

```json
  "register": "物件を登録",
  "mine": {
    "title": "マイ物件",
    "empty": "まだ登録した物件がありません",
    "register": "物件を登録する",
    "loadFail": "物件を読み込めませんでした。もう一度お試しください",
    "status": {
      "pending": "審査待ち",
      "published": "掲載中",
      "rejected": "差し戻し",
      "hidden": "非表示",
      "closed": "取引完了"
    },
    "rejectReason": "差し戻し理由: {reason}",
    "hiddenNotice": "管理者が非表示にした物件は編集できません",
    "edit": "編集",
    "close": "取引完了にする",
    "reopen": "再掲載する",
    "delete": "削除",
    "deleteTitle": "物件を削除しますか?",
    "deleteBody": "削除すると元に戻せません。",
    "cancel": "キャンセル",
    "closedDone": "取引完了にしました",
    "reopenedDone": "再掲載しました",
    "deletedDone": "削除しました",
    "actionFail": "処理できませんでした。もう一度お試しください"
  },
```

- [ ] **Step 2: 메뉴 네 곳**

`mypage-constants.ts` 에서 리뷰 항목 바로 뒤에 넣는다:
- `MENU_ITEMS`: `{ label: "mypage.menu.myShopListings", icon: "🏪", path: "/mypage/shop-listings" },`
- `MENU_SECTIONS` 의 benefits 섹션: 위와 같은 한 줄
- `SIDEBAR_MENU_ITEMS`: `{ id: "shop-listings", label: "mypage.menu.myShopListings", hasSubMenu: false, path: "/mypage/shop-listings" },`
- `SIDEBAR_SECTIONS` 의 benefits 섹션: `{ id: "shop-listings", label: "mypage.menu.myShopListings", path: "/mypage/shop-listings" },`

- [ ] **Step 3: 목록 클라이언트 컴포넌트**

`my-listings/index.tsx`:

```tsx
"use client"

import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardThumbnail } from "@/domains/shop-trade/components/listing-card/card-thumbnail"
import { myListingActions } from "@/domains/shop-trade/my-listing-status"
import {
  closeMyShopListing,
  deleteMyShopListing,
  reopenMyShopListing,
} from "@/lib/api/ugc/my-shop-listings"
import type { MyShopListingItem } from "@/lib/types/ui/shop-listing"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"

export function MyListings({ items }: { items: MyShopListingItem[] }) {
  const t = useTranslations("shopTrade.mine")
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MyShopListingItem | null>(null)

  const run = async (
    id: string,
    action: () => Promise<{ ok: boolean; message?: string }>,
    doneKey: "closedDone" | "reopenedDone" | "deletedDone"
  ) => {
    setPendingId(id)
    const result = await action()
    setPendingId(null)
    if (result.ok) {
      toast.success(t(doneKey))
      router.refresh()
    } else {
      // 한도 초과 같은 409 는 서버 문구가 더 정확하다
      toast.error(result.message || t("actionFail"))
    }
  }

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
        <Button asChild className="mt-4 h-[52px] rounded-xl px-6 text-base font-bold">
          <LocalizedClientLink href="/mypage/shop-listings/new">
            {t("register")}
          </LocalizedClientLink>
        </Button>
      </div>
    )
  }

  return (
    <>
      <ul className="divide-border divide-y border-y">
        {items.map((item) => {
          const actions = myListingActions(item.status)
          const busy = pendingId === item.id

          return (
            <li key={item.id} className="flex gap-4 py-4">
              <div className="bg-muted relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-lg sm:w-32">
                <CardThumbnail
                  images={item.imageFileIds}
                  fallbackFileId={item.thumbnailFileId}
                  alt={item.title}
                  sizes="128px"
                  enableHover={false}
                  enableSwipe={false}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="shrink-0">
                    {t(`status.${item.status}`)}
                  </Badge>
                  <p className="text-foreground line-clamp-1 text-sm font-medium">
                    {item.title}
                  </p>
                </div>

                {item.status === "rejected" && item.rejectReason && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("rejectReason", { reason: item.rejectReason })}
                  </p>
                )}
                {item.status === "hidden" && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("hiddenNotice")}
                  </p>
                )}

                <p className="text-muted-foreground mt-1 text-xs">
                  {formatDate(item.createdAt, DATE_FORMATS.KO_DOT)}
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  {actions.includes("edit") && (
                    <Button variant="outline" size="sm" asChild disabled={busy}>
                      <LocalizedClientLink href={`/mypage/shop-listings/${item.id}/edit`}>
                        {t("edit")}
                      </LocalizedClientLink>
                    </Button>
                  )}
                  {actions.includes("close") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(item.id, () => closeMyShopListing(item.id), "closedDone")
                      }
                    >
                      {t("close")}
                    </Button>
                  )}
                  {actions.includes("reopen") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(item.id, () => reopenMyShopListing(item.id), "reopenedDone")
                      }
                    >
                      {t("reopen")}
                    </Button>
                  )}
                  {actions.includes("delete") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDeleteTarget(item)}
                    >
                      {t("delete")}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleteTarget
                setDeleteTarget(null)
                if (target)
                  void run(target.id, () => deleteMyShopListing(target.id), "deletedDone")
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
```

`CardThumbnail` 는 `"use client"` 컴포넌트라 여기서 그대로 쓸 수 있다. `Button asChild` 에 `disabled` 는 링크에 먹지 않지만, 해가 없으므로 모양만 맞춘다.

- [ ] **Step 4: 페이지**

`mypage/shop-listings/page.tsx`:

```tsx
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { MyListings } from "@/domains/shop-trade/components/my-listings"
import { listMyShopListings } from "@/lib/api/ugc/my-shop-listings"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export async function generateMetadata() {
  const t = await getTranslations("mypage.menu")
  return getSEOTags({ title: t("myShopListings"), openGraph: {}, extraTags: {} })
}

export default async function MyShopListingsPage() {
  const tMenu = await getTranslations("mypage.menu")
  const t = await getTranslations("shopTrade.mine")
  const result = await listMyShopListings()

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: tMenu("myShopListings"),
      }}
    >
      <MypageLayout>
        <div className="px-4 py-6 md:px-0">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-foreground text-lg font-bold">{t("title")}</h1>
            {result.ok && result.data.length > 0 && (
              <Button variant="outline" size="sm" asChild>
                <LocalizedClientLink href="/mypage/shop-listings/new">
                  {t("register")}
                </LocalizedClientLink>
              </Button>
            )}
          </div>

          {result.ok ? (
            <MyListings items={result.data} />
          ) : (
            <p className="text-muted-foreground py-16 text-center text-sm">
              {t("loadFail")}
            </p>
          )}
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
```

- [ ] **Step 5: 공개 목록에 「매물 등록」**

`shop-trade/page.tsx` 에서 `<h1 …>{t("title")}</h1>` 을 아래로 바꾼다. Outline 버튼이다 — 이 화면에 Primary 를 늘리지 않는다:

```tsx
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-foreground text-2xl font-bold">{t("title")}</h1>
        <LocalizedClientLink
          href="/mypage/shop-listings/new"
          className="border-border text-foreground hover:bg-muted rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
        >
          {t("register")}
        </LocalizedClientLink>
      </div>
```

- [ ] **Step 6: 검증**

```bash
cd web/almondyoung-storefront
npx vitest run src/i18n src/domains/shop-trade
npx tsc --noEmit 2>&1 | grep -E "shop-trade|shop-listing|mypage-constants" ; echo "filtered-exit=$?"
cd ../..
```

Expected: PASS, 필터 결과 없음

- [ ] **Step 7: 커밋**

```bash
git add -A "web/almondyoung-storefront/src/app/[countryCode]/(mypage)/mypage/shop-listings" \
  web/almondyoung-storefront/src/domains/shop-trade/components/my-listings \
  web/almondyoung-storefront/src/domains/mypage/components/constants/mypage-constants.ts \
  "web/almondyoung-storefront/src/app/[countryCode]/(main)/shop-trade/page.tsx" web/almondyoung-storefront/src/i18n/messages
git commit -m "feat(storefront): 마이페이지에 내 매물 목록과 상태별 동작, 샵 매매에 등록 진입점을 둔다"
```

---

### Task 10: 매물 작성·수정 화면

**Files:**
- Create(`web/almondyoung-storefront/src/`):
  - `domains/shop-trade/components/listing-form/index.tsx`, `listing-form/image-picker.tsx`
  - `app/[countryCode]/(mypage)/mypage/shop-listings/new/page.tsx`, `[id]/edit/page.tsx`
- Modify: `i18n/messages/{ko,en,ja}/shopTrade.json`

**Interfaces:**
- Consumes:
  - `buildMemberPayload`·`formValuesFromListing`·`EMPTY_SHOP_LISTING_FORM`·`MAX_SHOP_LISTING_IMAGES` (Task 6)
  - `editRequiresReReview` (Task 5)
  - `createMyShopListing`·`updateMyShopListing`·`getMyShopListing` (Task 7)
  - `ShopListingMarkdown` (Task 2)
  - `uploadFile` (`lib/api/file/upload.ts`)
- Produces: `ShopListingFormView({ listing?: MyShopListingItem; countryCode: string })`

- [ ] **Step 1: 문구 (`shopTrade.json` 최상위 `form`)**

ko:

```json
  "form": {
    "newTitle": "매물 등록",
    "editTitle": "매물 수정",
    "title": "제목",
    "titlePlaceholder": "예) 강남역 네일샵 양도합니다",
    "region": "지역",
    "businessType": "업종",
    "dealType": "거래 유형",
    "select": "선택해 주세요",
    "areaPyeong": "평수",
    "deposit": "보증금",
    "monthlyRent": "월세",
    "keyMoney": "권리금",
    "manwon": "만원",
    "pyeongUnit": "평",
    "moneyHint": "비워 두면 「협의」로 보여요",
    "images": "샵 사진",
    "imagesHint": "1~15장, 첫 장이 대표 사진이에요",
    "addImage": "사진 추가",
    "moveUp": "앞으로",
    "moveDown": "뒤로",
    "removeImage": "빼기",
    "uploadFail": "사진을 올리지 못했어요. 다시 시도해 주세요",
    "content": "본문",
    "write": "작성",
    "preview": "미리보기",
    "contentPlaceholder": "샵 소개, 시설, 양도 사유 등을 적어 주세요",
    "previewEmpty": "작성한 내용이 여기에 보여요",
    "contactPhone": "연락처",
    "contactPhonePlaceholder": "010-1234-5678",
    "contactHint": "로그인한 회원에게만 보여요",
    "kakaoOpenChatUrl": "카카오 오픈채팅 (선택)",
    "kakaoPlaceholder": "https://open.kakao.com/o/…",
    "submitNew": "등록하기",
    "submitEdit": "수정하기",
    "reReviewTitle": "다시 검토를 받아요",
    "reReviewBody": "수정하면 다시 검토를 받고, 그동안 공개되지 않아요.",
    "cancel": "취소",
    "created": "등록했어요. 검토 후 공개돼요",
    "updated": "수정했어요. 검토 후 다시 공개돼요",
    "submitFail": "저장하지 못했어요. 다시 시도해 주세요",
    "invalid": {
      "title": "제목을 입력해 주세요",
      "region": "지역을 선택해 주세요",
      "businessType": "업종을 선택해 주세요",
      "imageFileIds": "사진을 1~15장 올려 주세요",
      "content": "본문을 입력해 주세요 (10,000자까지)",
      "contactPhone": "연락처를 확인해 주세요 (0으로 시작하는 9~11자리)",
      "kakaoOpenChatUrl": "카카오 오픈채팅 주소(https://open.kakao.com/…)만 넣을 수 있어요"
    }
  },
```

en:

```json
  "form": {
    "newTitle": "List your shop",
    "editTitle": "Edit listing",
    "title": "Title",
    "titlePlaceholder": "e.g. Nail salon near Gangnam Station for transfer",
    "region": "Region",
    "businessType": "Business type",
    "dealType": "Deal type",
    "select": "Select",
    "areaPyeong": "Area",
    "deposit": "Deposit",
    "monthlyRent": "Monthly rent",
    "keyMoney": "Key money",
    "manwon": "×10,000 KRW",
    "pyeongUnit": "pyeong",
    "moneyHint": "Leave blank to show \"Negotiable\"",
    "images": "Shop photos",
    "imagesHint": "1–15 photos. The first one is the cover",
    "addImage": "Add photo",
    "moveUp": "Move up",
    "moveDown": "Move down",
    "removeImage": "Remove",
    "uploadFail": "Couldn't upload the photo. Please try again",
    "content": "Description",
    "write": "Write",
    "preview": "Preview",
    "contentPlaceholder": "Describe the shop, facilities, reason for transfer, etc.",
    "previewEmpty": "Your text will appear here",
    "contactPhone": "Phone",
    "contactPhonePlaceholder": "010-1234-5678",
    "contactHint": "Only visible to signed-in members",
    "kakaoOpenChatUrl": "KakaoTalk open chat (optional)",
    "kakaoPlaceholder": "https://open.kakao.com/o/…",
    "submitNew": "Submit",
    "submitEdit": "Save changes",
    "reReviewTitle": "This goes back to review",
    "reReviewBody": "After editing, the listing is reviewed again and hidden until approved.",
    "cancel": "Cancel",
    "created": "Submitted. It will be published after review",
    "updated": "Saved. It will be published again after review",
    "submitFail": "Couldn't save. Please try again",
    "invalid": {
      "title": "Enter a title",
      "region": "Select a region",
      "businessType": "Select a business type",
      "imageFileIds": "Add 1–15 photos",
      "content": "Enter a description (up to 10,000 characters)",
      "contactPhone": "Check the phone number (9–11 digits starting with 0)",
      "kakaoOpenChatUrl": "Only KakaoTalk open chat links (https://open.kakao.com/…) are allowed"
    }
  },
```

ja:

```json
  "form": {
    "newTitle": "物件を登録",
    "editTitle": "物件を編集",
    "title": "タイトル",
    "titlePlaceholder": "例) 江南駅のネイルサロンを譲渡します",
    "region": "地域",
    "businessType": "業種",
    "dealType": "取引種別",
    "select": "選択してください",
    "areaPyeong": "広さ",
    "deposit": "保証金",
    "monthlyRent": "月額賃料",
    "keyMoney": "権利金",
    "manwon": "万ウォン",
    "pyeongUnit": "坪",
    "moneyHint": "空欄にすると「応相談」と表示されます",
    "images": "店舗写真",
    "imagesHint": "1〜15枚。1枚目が代表写真です",
    "addImage": "写真を追加",
    "moveUp": "前へ",
    "moveDown": "後ろへ",
    "removeImage": "外す",
    "uploadFail": "写真をアップロードできませんでした。もう一度お試しください",
    "content": "本文",
    "write": "作成",
    "preview": "プレビュー",
    "contentPlaceholder": "店舗の紹介、設備、譲渡理由などを書いてください",
    "previewEmpty": "書いた内容がここに表示されます",
    "contactPhone": "連絡先",
    "contactPhonePlaceholder": "010-1234-5678",
    "contactHint": "ログインした会員にのみ表示されます",
    "kakaoOpenChatUrl": "カカオオープンチャット(任意)",
    "kakaoPlaceholder": "https://open.kakao.com/o/…",
    "submitNew": "登録する",
    "submitEdit": "保存する",
    "reReviewTitle": "再審査になります",
    "reReviewBody": "編集すると再審査となり、その間は公開されません。",
    "cancel": "キャンセル",
    "created": "登録しました。審査後に公開されます",
    "updated": "保存しました。審査後に再公開されます",
    "submitFail": "保存できませんでした。もう一度お試しください",
    "invalid": {
      "title": "タイトルを入力してください",
      "region": "地域を選択してください",
      "businessType": "業種を選択してください",
      "imageFileIds": "写真を1〜15枚追加してください",
      "content": "本文を入力してください(10,000文字まで)",
      "contactPhone": "連絡先を確認してください(0で始まる9〜11桁)",
      "kakaoOpenChatUrl": "カカオオープンチャットのURL(https://open.kakao.com/…)のみ入力できます"
    }
  },
```

- [ ] **Step 2: 사진 선택기 `image-picker.tsx`**

```tsx
"use client"

import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { MAX_SHOP_LISTING_IMAGES } from "@/domains/shop-trade/listing-form"
import { uploadFile } from "@/lib/api/file/upload"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { cn } from "@/lib/utils"

// file-service file_contexts 시드와 같아야 한다(spec §8.2). 없으면 업로드가 404.
const SHOP_LISTING_IMAGE_CONTEXT_ID = "shop-listing-image"
const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp"

export function ImagePicker({
  value,
  onChange,
  invalid,
}: {
  value: string[]
  onChange: (next: string[]) => void
  invalid?: boolean
}) {
  const t = useTranslations("shopTrade.form")
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const room = MAX_SHOP_LISTING_IMAGES - value.length
    const picked = Array.from(files).slice(0, room)
    setUploading(true)
    try {
      const uploaded = await Promise.all(
        picked.map((file) => {
          const formData = new FormData()
          formData.append("file", file)
          formData.append("contextId", SHOP_LISTING_IMAGE_CONTEXT_ID)
          return uploadFile(formData)
        })
      )
      onChange([...value, ...uploaded.map((f) => f.id)])
    } catch {
      toast.error(t("uploadFail"))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return
    const next = [...value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  return (
    <div className={cn("grid gap-2 rounded-lg", invalid && "ring-destructive ring-2 ring-offset-2")}>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {value.map((fileId, index) => (
          <li key={fileId} className="bg-muted relative aspect-square overflow-hidden rounded-lg">
            <Image src={getThumbnailUrl(fileId)} alt="" fill sizes="160px" className="object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/40 p-1">
              <button type="button" aria-label={t("moveUp")} onClick={() => move(index, index - 1)} className="p-1 text-white">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label={t("removeImage")} onClick={() => onChange(value.filter((id) => id !== fileId))} className="p-1 text-white">
                <X className="h-4 w-4" />
              </button>
              <button type="button" aria-label={t("moveDown")} onClick={() => move(index, index + 1)} className="p-1 text-white">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
        {value.length < MAX_SHOP_LISTING_IMAGES && (
          <li>
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="border-border text-muted-foreground flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs"
            >
              <ImagePlus className="h-5 w-5" />
              {t("addImage")}
            </button>
          </li>
        )}
      </ul>
      <p className="text-muted-foreground text-xs">{t("imagesHint")}</p>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        hidden
        onChange={(e) => void add(e.target.files)}
      />
    </div>
  )
}
```

- [ ] **Step 3: 폼 `listing-form/index.tsx`**

```tsx
"use client"

import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ShopListingMarkdown } from "@/domains/shop-trade/components/listing-markdown"
import {
  EMPTY_SHOP_LISTING_FORM,
  buildMemberPayload,
  formValuesFromListing,
  type ShopListingFormField,
  type ShopListingFormValues,
} from "@/domains/shop-trade/listing-form"
import { editRequiresReReview } from "@/domains/shop-trade/my-listing-status"
import {
  createMyShopListing,
  updateMyShopListing,
} from "@/lib/api/ugc/my-shop-listings"
import {
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_REGIONS,
  type MyShopListingItem,
} from "@/lib/types/ui/shop-listing"
import { cn } from "@/lib/utils"
import { ImagePicker } from "./image-picker"

const INPUT = "bg-muted border-border rounded-lg"

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-foreground text-sm font-medium">
        {label}
        {required && <span className="text-primary ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  )
}

export function ShopListingFormView({
  listing,
  countryCode,
}: {
  listing?: MyShopListingItem
  countryCode: string
}) {
  const t = useTranslations("shopTrade")
  const tf = useTranslations("shopTrade.form")
  const router = useRouter()
  const [values, setValues] = useState<ShopListingFormValues>(
    listing ? formValuesFromListing(listing) : EMPTY_SHOP_LISTING_FORM
  )
  const [invalid, setInvalid] = useState<ShopListingFormField | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const set = <K extends keyof ShopListingFormValues>(key: K, value: ShopListingFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    if (invalid === key) setInvalid(null)
  }

  const submit = async () => {
    const built = buildMemberPayload(values)
    if (!built.ok) {
      setInvalid(built.field)
      toast.error(tf(`invalid.${built.field}`))
      return
    }
    setPending(true)
    const result = listing
      ? await updateMyShopListing(listing.id, built.payload)
      : await createMyShopListing(built.payload)
    setPending(false)

    if (!result.ok) {
      // 한도 초과·숨김(409)·검증(400)은 서버 문구가 정확하다
      toast.error(result.message || tf("submitFail"))
      return
    }
    toast.success(listing ? tf("updated") : tf("created"))
    router.push(`/${countryCode}/mypage/shop-listings`)
    router.refresh()
  }

  const onSubmitClick = () => {
    if (listing && editRequiresReReview(listing.status)) {
      setConfirmOpen(true)
      return
    }
    void submit()
  }

  const money = (key: "deposit" | "monthlyRent" | "keyMoney" | "areaPyeong", unit: string) => (
    <div className="relative">
      <Input
        inputMode="numeric"
        value={values[key]}
        onChange={(e) => set(key, e.target.value.replace(/\D/g, ""))}
        className={cn(INPUT, "pr-12")}
      />
      <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-xs">
        {unit}
      </span>
    </div>
  )

  return (
    <div className="grid gap-6 px-4 py-6 md:px-0">
      <h1 className="text-foreground text-lg font-bold">
        {listing ? tf("editTitle") : tf("newTitle")}
      </h1>

      <Field label={tf("title")} required>
        <Input
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={tf("titlePlaceholder")}
          aria-invalid={invalid === "title"}
          className={INPUT}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={tf("region")} required>
          <Select value={values.region} onValueChange={(v) => set("region", v as ShopListingFormValues["region"])}>
            <SelectTrigger aria-invalid={invalid === "region"} className={INPUT}>
              <SelectValue placeholder={tf("select")} />
            </SelectTrigger>
            <SelectContent>
              {SHOP_LISTING_REGIONS.map((r) => (
                <SelectItem key={r} value={r}>{t(`regions.${r}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={tf("businessType")} required>
          <Select value={values.businessType} onValueChange={(v) => set("businessType", v as ShopListingFormValues["businessType"])}>
            <SelectTrigger aria-invalid={invalid === "businessType"} className={INPUT}>
              <SelectValue placeholder={tf("select")} />
            </SelectTrigger>
            <SelectContent>
              {SHOP_LISTING_BUSINESS_TYPES.map((b) => (
                <SelectItem key={b} value={b}>{t(`businessTypes.${b}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={tf("dealType")} required>
          <Select value={values.dealType} onValueChange={(v) => set("dealType", v as ShopListingFormValues["dealType"])}>
            <SelectTrigger className={INPUT}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHOP_LISTING_DEAL_TYPES.map((d) => (
                <SelectItem key={d} value={d}>{t(`dealTypes.${d}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={tf("areaPyeong")}>{money("areaPyeong", tf("pyeongUnit"))}</Field>
          <Field label={tf("deposit")}>{money("deposit", tf("manwon"))}</Field>
          <Field label={tf("monthlyRent")}>{money("monthlyRent", tf("manwon"))}</Field>
          <Field label={tf("keyMoney")}>{money("keyMoney", tf("manwon"))}</Field>
        </div>
        <p className="text-muted-foreground text-xs">{tf("moneyHint")}</p>
      </div>

      <Field label={tf("images")} required>
        <ImagePicker
          value={values.imageFileIds}
          onChange={(next) => set("imageFileIds", next)}
          invalid={invalid === "imageFileIds"}
        />
      </Field>

      <Field label={tf("content")} required>
        <Tabs defaultValue="write">
          <TabsList>
            <TabsTrigger value="write">{tf("write")}</TabsTrigger>
            <TabsTrigger value="preview">{tf("preview")}</TabsTrigger>
          </TabsList>
          <TabsContent value="write">
            <Textarea
              value={values.content}
              onChange={(e) => set("content", e.target.value)}
              placeholder={tf("contentPlaceholder")}
              aria-invalid={invalid === "content"}
              rows={12}
              className={INPUT}
            />
          </TabsContent>
          <TabsContent value="preview">
            <div className="border-border min-h-[240px] rounded-lg border p-4">
              {values.content.trim() ? (
                <ShopListingMarkdown content={values.content} />
              ) : (
                <p className="text-muted-foreground text-sm">{tf("previewEmpty")}</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Field>

      <Field label={tf("contactPhone")} required hint={tf("contactHint")}>
        <Input
          inputMode="tel"
          value={values.contactPhone}
          onChange={(e) => set("contactPhone", e.target.value)}
          placeholder={tf("contactPhonePlaceholder")}
          aria-invalid={invalid === "contactPhone"}
          className={INPUT}
        />
      </Field>

      <Field label={tf("kakaoOpenChatUrl")}>
        <Input
          inputMode="url"
          value={values.kakaoOpenChatUrl}
          onChange={(e) => set("kakaoOpenChatUrl", e.target.value)}
          placeholder={tf("kakaoPlaceholder")}
          aria-invalid={invalid === "kakaoOpenChatUrl"}
          className={INPUT}
        />
      </Field>

      <Button
        onClick={onSubmitClick}
        disabled={pending}
        className="h-[52px] w-full rounded-xl text-base font-bold"
      >
        {listing ? tf("submitEdit") : tf("submitNew")}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tf("reReviewTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tf("reReviewBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tf("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                void submit()
              }}
            >
              {tf("submitEdit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

`countryCode` 를 prop 으로 받는 이유: middleware 가 countryCode 없는 경로를 308 로 보정하긴 하지만(`middleware.ts` 의 `!urlHasCountryCode` 분기), 리다이렉트를 한 번 더 거친다.

- [ ] **Step 4: 페이지 둘**

`mypage/shop-listings/new/page.tsx`:

```tsx
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { ShopListingFormView } from "@/domains/shop-trade/components/listing-form"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export async function generateMetadata() {
  const t = await getTranslations("shopTrade.form")
  return getSEOTags({ title: t("newTitle"), openGraph: {}, extraTags: {} })
}

export default async function NewShopListingPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const t = await getTranslations("shopTrade.form")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("newTitle"),
      }}
    >
      <MypageLayout>
        <ShopListingFormView countryCode={countryCode} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
```

`mypage/shop-listings/[id]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { ShopListingFormView } from "@/domains/shop-trade/components/listing-form"
import { getMyShopListing } from "@/lib/api/ugc/my-shop-listings"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export async function generateMetadata() {
  const t = await getTranslations("shopTrade.form")
  return getSEOTags({ title: t("editTitle"), openGraph: {}, extraTags: {} })
}

export default async function EditShopListingPage({
  params,
}: {
  params: Promise<{ countryCode: string; id: string }>
}) {
  const { countryCode, id } = await params
  const t = await getTranslations("shopTrade.form")
  const result = await getMyShopListing(id)

  // 남의 글·지운 글은 서버가 404 로 존재를 숨긴다(spec §7.3). 숨긴 글은 수정할 수 없으니 여기서도 막는다.
  if (!result.ok || result.data.status === "hidden") notFound()

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("editTitle"),
      }}
    >
      <MypageLayout>
        <ShopListingFormView listing={result.data} countryCode={countryCode} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
```

- [ ] **Step 5: 검증**

```bash
cd web/almondyoung-storefront
npx vitest run src/i18n src/domains/shop-trade
npx tsc --noEmit 2>&1 | grep -E "shop-trade|shop-listing" ; echo "filtered-exit=$?"
NEXT_DIST_DIR=.next-local npx next build && rm -rf .next-local
cd ../..
```

Expected: PASS, 필터 결과 없음, 빌드 성공

- [ ] **Step 6: 커밋**

```bash
git add -A web/almondyoung-storefront/src/domains/shop-trade/components/listing-form \
  "web/almondyoung-storefront/src/app/[countryCode]/(mypage)/mypage/shop-listings" web/almondyoung-storefront/src/i18n/messages
git commit -m "feat(storefront): 마이페이지에서 매물을 작성·수정한다 — 마크다운 미리보기, 사진 1~15장, 연락처"
```

---

### Task 11: admin-web 타입과 판단 규칙

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/products.ts` (샵 매매 DTO 교체)
- Create:
  - `apps/admin-web/src/features/mall/shop-listings/lib/admin-listing-rules.ts`
  - `apps/admin-web/src/features/mall/shop-listings/lib/admin-listing-rules.spec.ts`

**Interfaces:**
- Produces(products.ts):
  - `SHOP_LISTING_STATUSES`, `ShopListingStatus`
  - `SHOP_LISTING_AUTHOR_TYPES`, `ShopListingAuthorType`
  - `AdminShopListingDto`, `AdminShopListingDetailDto`, `ShopListingModerationDto`
  - `AdminShopListingListQuery`, `AdminShopListingPayload`
- Produces(rules):
  - `AdminListingAction = 'approve' | 'reject' | 'hide' | 'unhide' | 'close' | 'reopen'`
  - `adminListingActions(status): readonly AdminListingAction[]`
  - `SHOP_LISTING_STATUS_LABELS`, `SHOP_LISTING_MODERATION_LABELS`
  - `SHOP_LISTING_STATUS_TABS: readonly { value: ShopListingStatus | 'all'; label: string }[]`
  - `buildAdminListQuery(tab, author, q): AdminShopListingListQuery`
  - `AdminShopListingFormValues`, `adminFormValuesFrom(listing?: AdminShopListingDto): AdminShopListingFormValues`
  - `buildAdminPayload(v): { ok: true; payload: AdminShopListingPayload } | { ok: false; field: AdminFormField; message: string }`
  - `isModerationConflict(error: unknown): boolean`

- [ ] **Step 1: DTO 교체**

`products.ts` 의 `export interface ShopListingDto` 부터 `export interface ShopListingListQuery { … }` 끝까지(현재 810~870행 부근)를 지우고 아래를 넣는다. 지역·업종·거래유형 상수와 라벨은 그대로 둔다.

```ts
export const SHOP_LISTING_STATUSES = ['pending', 'published', 'rejected', 'hidden', 'closed'] as const;
export type ShopListingStatus = (typeof SHOP_LISTING_STATUSES)[number];

export const SHOP_LISTING_AUTHOR_TYPES = ['admin', 'member'] as const;
export type ShopListingAuthorType = (typeof SHOP_LISTING_AUTHOR_TYPES)[number];

/** ugc `GET /admin/shop-listings` 행 */
export interface AdminShopListingDto {
  id: string;
  slug: string;
  title: string;
  /** 마크다운 */
  content: string;
  region: ShopListingRegion | null;
  businessType: ShopListingBusinessType | null;
  dealType: ShopListingDealType | null;
  areaPyeong: number | null;
  deposit: number | null;
  monthlyRent: number | null;
  keyMoney: number | null;
  /** imageFileIds[0] */
  thumbnailFileId: string | null;
  /** 순서 = 노출 순서 */
  imageFileIds: string[];
  status: ShopListingStatus;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  rejectReason: string | null;
  /** 숫자만 */
  contactPhone: string | null;
  kakaoOpenChatUrl: string | null;
  /** 가장 최근 pending 진입 시각. 승인·반려의 expectedSubmittedAt 으로 되돌려 보낸다 */
  submittedAt: string | null;
  authorType: ShopListingAuthorType;
  authorUserId: string | null;
}

export interface ShopListingModerationDto {
  id: string;
  decidedBy: 'admin' | 'classifier';
  decision: 'approved' | 'rejected' | 'pending' | 'hidden' | 'unhidden';
  label: string | null;
  confidence: number | null;
  reason: string | null;
  actorUserId: string | null;
  createdAt: string;
}

/** ugc `GET /admin/shop-listings/:id` */
export interface AdminShopListingDetailDto extends AdminShopListingDto {
  /** 최신순 */
  moderations: ShopListingModerationDto[];
}

export interface AdminShopListingListQuery {
  status?: ShopListingStatus;
  authorType?: ShopListingAuthorType;
  /** 제목 부분일치 */
  q?: string;
}

/**
 * ugc `POST /admin/shop-listings`·`PUT /admin/shop-listings/:id` 본문. **PUT 은 전체 교체다** —
 * contactPhone·kakaoOpenChatUrl 은 항상 키를 싣는다(비면 null). 빼면 회원이 등록한 번호가 지워진다.
 */
export interface AdminShopListingPayload {
  title: string;
  content: string;
  region: ShopListingRegion;
  businessType: ShopListingBusinessType;
  dealType: ShopListingDealType;
  areaPyeong: number | null;
  deposit: number | null;
  monthlyRent: number | null;
  keyMoney: number | null;
  imageFileIds: string[];
  contactPhone: string | null;
  kakaoOpenChatUrl: string | null;
}
```

- [ ] **Step 2: 규칙 스펙을 쓴다**

`admin-listing-rules.spec.ts`:

```ts
import { CustomError } from '@/lib/api/customError';
import type { AdminShopListingDto } from '@/lib/types/dto/products';
import {
  adminFormValuesFrom,
  adminListingActions,
  buildAdminListQuery,
  buildAdminPayload,
  isModerationConflict,
  SHOP_LISTING_STATUS_TABS,
  type AdminShopListingFormValues,
} from './admin-listing-rules';

const FILE = '019f890e-dec0-7060-a32e-024c3e47c6be';

const memberListing: AdminShopListingDto = {
  id: 'l1',
  slug: 'gangnam-nail',
  title: '강남 네일',
  content: '본문',
  region: 'seoul',
  businessType: 'nail',
  dealType: 'transfer',
  areaPyeong: 15,
  deposit: 20_000_000,
  monthlyRent: null,
  keyMoney: 30_000_000,
  thumbnailFileId: FILE,
  imageFileIds: [FILE],
  status: 'pending',
  viewCount: 0,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
  rejectReason: null,
  contactPhone: '01012345678',
  kakaoOpenChatUrl: 'https://open.kakao.com/o/abc',
  submittedAt: '2026-09-24T00:00:00.000Z',
  authorType: 'member',
  authorUserId: 'u1',
};

describe('adminListingActions (spec §8.3 표)', () => {
  it.each([
    ['pending', ['approve', 'reject']],
    ['published', ['hide', 'close']],
    ['closed', ['hide', 'reopen']],
    ['hidden', ['unhide']],
    ['rejected', []],
  ] as const)('%s → %j', (status, expected) => {
    expect(adminListingActions(status)).toEqual(expected);
  });
});

describe('SHOP_LISTING_STATUS_TABS', () => {
  it('첫 탭(기본)은 검토 대기다', () => {
    expect(SHOP_LISTING_STATUS_TABS[0].value).toBe('pending');
  });
});

describe('buildAdminListQuery', () => {
  it('「전체」와 빈 검색어는 키를 싣지 않는다 — 쿼리 키가 흔들리지 않게', () => {
    expect(buildAdminListQuery('all', 'all', '  ')).toEqual({});
    expect(buildAdminListQuery('pending', 'member', ' 네일 ')).toEqual({
      status: 'pending',
      authorType: 'member',
      q: '네일',
    });
  });
});

describe('buildAdminPayload — PUT 전체 교체 계약', () => {
  it('회원 글을 그대로 저장해도 연락처가 살아남는다', () => {
    const result = buildAdminPayload(adminFormValuesFrom(memberListing));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.contactPhone).toBe('01012345678');
    expect(result.payload.kakaoOpenChatUrl).toBe('https://open.kakao.com/o/abc');
  });

  it('연락처가 비어도 키는 항상 싣는다(null)', () => {
    const values: AdminShopListingFormValues = {
      ...adminFormValuesFrom(memberListing),
      contactPhone: ' ',
      kakaoOpenChatUrl: '',
    };
    const result = buildAdminPayload(values);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.payload)).toEqual(expect.arrayContaining(['contactPhone', 'kakaoOpenChatUrl']));
    expect(result.payload.contactPhone).toBeNull();
    expect(result.payload.kakaoOpenChatUrl).toBeNull();
  });

  it('만원 → 원, 전화는 숫자만', () => {
    const result = buildAdminPayload({ ...adminFormValuesFrom(memberListing), deposit: '500', contactPhone: '02-123-4567' });
    expect(result.ok && result.payload.deposit).toBe(5_000_000);
    expect(result.ok && result.payload.contactPhone).toBe('021234567');
  });

  it.each([
    [{ title: ' ' }, 'title'],
    [{ region: '' }, 'region'],
    [{ businessType: '' }, 'businessType'],
    [{ imageFileIds: [] }, 'imageFileIds'],
    [{ content: '' }, 'content'],
    [{ contactPhone: '123' }, 'contactPhone'],
    [{ kakaoOpenChatUrl: 'https://x.y' }, 'kakaoOpenChatUrl'],
  ] as const)('%j → %s', (patch, field) => {
    const result = buildAdminPayload({ ...adminFormValuesFrom(memberListing), ...patch });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe(field);
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe('adminFormValuesFrom', () => {
  it('새 글은 빈 폼(거래 유형만 양도)', () => {
    expect(adminFormValuesFrom(undefined)).toMatchObject({ title: '', dealType: 'transfer', imageFileIds: [], contactPhone: '' });
  });
});

describe('isModerationConflict', () => {
  it('409 만 참', () => {
    expect(isModerationConflict(new CustomError({ message: 'x', statusCode: 409 }))).toBe(true);
    expect(isModerationConflict(new CustomError({ message: 'x', statusCode: 400 }))).toBe(false);
    expect(isModerationConflict(new Error('x'))).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/admin-web/src/features/mall/shop-listings/lib`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현 `admin-listing-rules.ts`**

```ts
import { isCustomError } from '@/lib/api/customError';
import type {
  AdminShopListingDto,
  AdminShopListingListQuery,
  AdminShopListingPayload,
  ShopListingAuthorType,
  ShopListingBusinessType,
  ShopListingDealType,
  ShopListingModerationDto,
  ShopListingRegion,
  ShopListingStatus,
} from '@/lib/types/dto/products';

export type AdminListingAction = 'approve' | 'reject' | 'hide' | 'unhide' | 'close' | 'reopen';

// 서버 전이표(spec §5)의 관리자 몫. rejected 는 회원이 고쳐 재제출할 때까지 할 일이 없다.
const ACTIONS: Record<ShopListingStatus, readonly AdminListingAction[]> = {
  pending: ['approve', 'reject'],
  published: ['hide', 'close'],
  closed: ['hide', 'reopen'],
  hidden: ['unhide'],
  rejected: [],
};

export function adminListingActions(status: ShopListingStatus): readonly AdminListingAction[] {
  return ACTIONS[status];
}

export const SHOP_LISTING_STATUS_LABELS: Record<ShopListingStatus, string> = {
  pending: '검토 대기',
  published: '게시 중',
  rejected: '반려',
  hidden: '숨김',
  closed: '거래완료',
};

export const SHOP_LISTING_MODERATION_LABELS: Record<ShopListingModerationDto['decision'], string> = {
  approved: '승인',
  rejected: '반려',
  pending: '검토 대기',
  hidden: '숨김',
  unhidden: '숨김 해제',
};

export const SHOP_LISTING_AUTHOR_LABELS: Record<ShopListingAuthorType, string> = {
  admin: '관리자',
  member: '회원',
};

export const SHOP_LISTING_STATUS_TABS: readonly { value: ShopListingStatus | 'all'; label: string }[] = [
  { value: 'pending', label: '검토 대기' },
  { value: 'published', label: '게시 중' },
  { value: 'rejected', label: '반려' },
  { value: 'hidden', label: '숨김' },
  { value: 'closed', label: '거래완료' },
  { value: 'all', label: '전체' },
];

export function buildAdminListQuery(
  tab: ShopListingStatus | 'all',
  author: ShopListingAuthorType | 'all',
  q: string,
): AdminShopListingListQuery {
  const query: AdminShopListingListQuery = {};
  if (tab !== 'all') query.status = tab;
  if (author !== 'all') query.authorType = author;
  const trimmed = q.trim();
  if (trimmed) query.q = trimmed;
  return query;
}

/** 금액은 만원 단위 문자열 (기존 폼과 같다) */
export interface AdminShopListingFormValues {
  title: string;
  content: string;
  region: ShopListingRegion | '';
  businessType: ShopListingBusinessType | '';
  dealType: ShopListingDealType;
  areaPyeong: string;
  deposit: string;
  monthlyRent: string;
  keyMoney: string;
  imageFileIds: string[];
  contactPhone: string;
  kakaoOpenChatUrl: string;
}

export type AdminFormField =
  | 'title'
  | 'region'
  | 'businessType'
  | 'imageFileIds'
  | 'content'
  | 'contactPhone'
  | 'kakaoOpenChatUrl';

const toManwon = (won: number | null): string => (won === null ? '' : String(won / 10_000));
const toWon = (manwon: string): number | null => (manwon.trim() === '' ? null : Number(manwon) * 10_000);
const PHONE_PATTERN = /^0\d{8,10}$/;

export function adminFormValuesFrom(listing: AdminShopListingDto | undefined): AdminShopListingFormValues {
  return {
    title: listing?.title ?? '',
    content: listing?.content ?? '',
    region: listing?.region ?? '',
    businessType: listing?.businessType ?? '',
    dealType: listing?.dealType ?? 'transfer',
    areaPyeong: listing && listing.areaPyeong !== null ? String(listing.areaPyeong) : '',
    deposit: toManwon(listing?.deposit ?? null),
    monthlyRent: toManwon(listing?.monthlyRent ?? null),
    keyMoney: toManwon(listing?.keyMoney ?? null),
    imageFileIds: listing?.imageFileIds ?? [],
    contactPhone: listing?.contactPhone ?? '',
    kakaoOpenChatUrl: listing?.kakaoOpenChatUrl ?? '',
  };
}

export type BuildAdminPayloadResult =
  | { ok: true; payload: AdminShopListingPayload }
  | { ok: false; field: AdminFormField; message: string };

/**
 * 관리자 PUT 은 전체 교체다. 연락처 두 키는 **항상** 싣는다 — 빼면 서버가 회원이 등록한 번호를 null 로 덮는다.
 * 화면 위에서 아래 순서로 첫 문제 칸 하나를 돌려준다.
 */
export function buildAdminPayload(values: AdminShopListingFormValues): BuildAdminPayloadResult {
  const title = values.title.trim();
  if (!title || title.length > 255) return { ok: false, field: 'title', message: '제목을 입력해 주세요.' };
  if (!values.region) return { ok: false, field: 'region', message: '지역을 선택해 주세요.' };
  if (!values.businessType) return { ok: false, field: 'businessType', message: '업종을 선택해 주세요.' };
  if (values.imageFileIds.length === 0 || values.imageFileIds.length > 15) {
    return { ok: false, field: 'imageFileIds', message: '샵 사진을 1~15장 올려 주세요.' };
  }
  if (!values.content.trim() || values.content.length > 10_000) {
    return { ok: false, field: 'content', message: '본문을 입력해 주세요. (10,000자까지)' };
  }

  const phone = values.contactPhone.replace(/[\s-]/g, '');
  if (phone && !PHONE_PATTERN.test(phone)) {
    return { ok: false, field: 'contactPhone', message: '전화번호는 0 으로 시작하는 9~11자리여야 해요.' };
  }
  const kakao = values.kakaoOpenChatUrl.trim();
  if (kakao && !kakao.startsWith('https://open.kakao.com/')) {
    return { ok: false, field: 'kakaoOpenChatUrl', message: '카카오 오픈채팅 주소(https://open.kakao.com/…)만 넣을 수 있어요.' };
  }

  return {
    ok: true,
    payload: {
      title,
      content: values.content,
      region: values.region,
      businessType: values.businessType,
      dealType: values.dealType,
      areaPyeong: values.areaPyeong.trim() === '' ? null : Number(values.areaPyeong),
      deposit: toWon(values.deposit),
      monthlyRent: toWon(values.monthlyRent),
      keyMoney: toWon(values.keyMoney),
      imageFileIds: values.imageFileIds,
      contactPhone: phone || null,
      kakaoOpenChatUrl: kakao || null,
    },
  };
}

/** 승인·반려 409 = 그사이 회원이 고쳤거나 상태가 바뀌었다. 새로고침으로 안내한다 */
export function isModerationConflict(error: unknown): boolean {
  return isCustomError(error) && error.statusCode === 409;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/admin-web/src/features/mall/shop-listings/lib`
Expected: PASS

- [ ] **Step 6: 커밋**

products.ts 교체로 기존 화면·훅이 타입 에러가 난다. 이 커밋은 테스트는 초록이지만 admin tsc 는 Task 14 까지 빨갛다. 태스크 경계는 리뷰 단위이고, admin tsc 초록은 Task 14 의 조건이다.

```bash
git add apps/admin-web/src/lib/types/dto/products.ts apps/admin-web/src/features/mall/shop-listings/lib
git commit -m "feat(admin): 샵 매매 ugc 응답 타입과 검토 버튼·전체 교체 본문 규칙을 둔다"
```

---

### Task 12: admin-web 클라이언트와 훅

**Files:**
- Modify:
  - `apps/admin-web/src/lib/api/domains/products/shop-listings.client.ts`
  - `apps/admin-web/src/lib/services/products/queries.ts` (548~566행 부근)
  - `apps/admin-web/src/lib/services/products/mutations.ts` (1017~1060행 부근)
  - `apps/admin-web/src/lib/api/domains/files/upload.client.ts:52`
  - `apps/admin-web/src/features/mall/shop-listings/components/image-gallery-field/index.tsx:16`

**Interfaces:**
- Consumes: Task 11 타입
- Produces:
  - `shopListingsClient.{list, get, create, update, approve, reject, hide, unhide, close, reopen, remove}`
  - 훅:
    - `useShopListings(query: AdminShopListingListQuery)`, `useShopListing(id)`
    - `useCreateShopListing()`, `useUpdateShopListing()`, `useDeleteShopListing()`
    - `useApproveShopListing()`, `useRejectShopListing()`, `useShopListingTransition(kind: 'hide' | 'unhide' | 'close' | 'reopen')`

- [ ] **Step 1: 클라이언트 교체**

`shop-listings.client.ts` 전체:

```ts
'use client';

// src/lib/api/domains/products/shop-listings.client.ts
// 샵 매매는 2026-09 ugc-service 로 옮겼다(spec 2026-09-23-shop-listings-to-ugc-design §7.4).
import { UGC_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  AdminShopListingDetailDto,
  AdminShopListingDto,
  AdminShopListingListQuery,
  AdminShopListingPayload,
} from '../../../types/dto/products';

const BASE = `${UGC_SERVICE_BASE_URL}/admin/shop-listings`;

const post = async (path: string, body?: object): Promise<AdminShopListingDto> => {
  const response = await client.post(`${BASE}${path}`, body ?? {});
  return response.data;
};

export const shopListingsClient = {
  list: async (query: AdminShopListingListQuery): Promise<AdminShopListingDto[]> => {
    const response = await client.get(BASE, { params: query });
    return response.data;
  },

  get: async (id: string): Promise<AdminShopListingDetailDto> => {
    const response = await client.get(`${BASE}/${id}`);
    return response.data;
  },

  create: async (payload: AdminShopListingPayload): Promise<AdminShopListingDto> => {
    const response = await client.post(BASE, payload);
    return response.data;
  },

  /** 전체 교체 — payload 는 buildAdminPayload 가 만든 것만 넘긴다 */
  update: async (id: string, payload: AdminShopListingPayload): Promise<AdminShopListingDto> => {
    const response = await client.put(`${BASE}/${id}`, payload);
    return response.data;
  },

  approve: (id: string, expectedSubmittedAt: string | null) =>
    post(`/${id}/approve`, expectedSubmittedAt ? { expectedSubmittedAt } : {}),

  reject: (id: string, reason: string, expectedSubmittedAt: string | null) =>
    post(`/${id}/reject`, expectedSubmittedAt ? { reason, expectedSubmittedAt } : { reason }),

  hide: (id: string) => post(`/${id}/hide`),
  unhide: (id: string) => post(`/${id}/unhide`),
  close: (id: string) => post(`/${id}/close`),
  reopen: (id: string) => post(`/${id}/reopen`),

  remove: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/${id}`);
  },
};
```

- [ ] **Step 2: 쿼리 훅**

`queries.ts` 의 import 에서 `ShopListingListQuery` 를 `AdminShopListingListQuery` 로 바꾼다. 두 훅을 아래로 바꾼다:

```ts
export const useShopListings = (query: AdminShopListingListQuery) => {
  return useQuery({
    queryKey: productQueryKeys.shopListingsList(query),
    queryFn: () => products.shopListings.list(query),
    staleTime: 30 * 1000,
  });
};

export const useShopListing = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.shopListing(id),
    queryFn: () => products.shopListings.get(id),
    enabled: !!id,
    // 판정 직전의 submittedAt 이 곧 CAS 기준이라 오래 두지 않는다
    staleTime: 0,
  });
};
```

- [ ] **Step 3: 뮤테이션 훅**

`mutations.ts` 의 import 에서 `CreateShopListingDto`·`UpdateShopListingDto` 를 지우고 `AdminShopListingPayload` 를 더한다. 「샵매매 뮤테이션」 절 전체를 아래로 바꾼다:

```ts
// ===== 샵매매 뮤테이션 =====

const useInvalidateShopListings = () => {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: productQueryKeys.shopListings });
    if (id) void queryClient.invalidateQueries({ queryKey: productQueryKeys.shopListing(id) });
  };
};

export const useCreateShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: (payload: AdminShopListingPayload) => products.shopListings.create(payload),
    onSuccess: () => invalidate(),
  });
};

export const useUpdateShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AdminShopListingPayload }) =>
      products.shopListings.update(id, payload),
    onSuccess: (_, { id }) => invalidate(id),
  });
};

export const useDeleteShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: (id: string) => products.shopListings.remove(id),
    onSuccess: () => invalidate(),
  });
};

export const useApproveShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: ({ id, expectedSubmittedAt }: { id: string; expectedSubmittedAt: string | null }) =>
      products.shopListings.approve(id, expectedSubmittedAt),
    // 409(그사이 수정)여도 상세를 새로 읽어야 하므로 성공·실패 모두 무효화한다
    onSettled: (_, __, { id }) => invalidate(id),
  });
};

export const useRejectShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: ({
      id,
      reason,
      expectedSubmittedAt,
    }: {
      id: string;
      reason: string;
      expectedSubmittedAt: string | null;
    }) => products.shopListings.reject(id, reason, expectedSubmittedAt),
    onSettled: (_, __, { id }) => invalidate(id),
  });
};

export const useShopListingTransition = (kind: 'hide' | 'unhide' | 'close' | 'reopen') => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: (id: string) => products.shopListings[kind](id),
    onSettled: (_, __, id) => invalidate(id),
  });
};
```

- [ ] **Step 4: 이미지 컨텍스트**

- `upload.client.ts:52`: `export const SHOP_LISTING_IMAGE_CONTEXT_ID = 'shop-listing-image';`
- `image-gallery-field/index.tsx:16` 주석: `/** file_contexts 의 shop-listing-image 정책(10MB, image/*)과 맞춘다 (서버도 같은 값으로 거른다) */`

- [ ] **Step 5: 커밋**

admin tsc 는 아직 화면(Task 13·14) 때문에 빨갛다.

```bash
git add apps/admin-web/src/lib/api/domains/products/shop-listings.client.ts apps/admin-web/src/lib/services/products/queries.ts \
  apps/admin-web/src/lib/services/products/mutations.ts apps/admin-web/src/lib/api/domains/files/upload.client.ts \
  apps/admin-web/src/features/mall/shop-listings/components/image-gallery-field/index.tsx
git commit -m "feat(admin): 샵 매매 클라이언트를 ugc 관리 API 로 바꾸고 검토 뮤테이션을 둔다"
```

---

### Task 13: admin-web 목록 — 검토 탭·작성자·검색

**Files:**
- Modify: `apps/admin-web/src/features/mall/shop-listings/template/index.tsx`

**Interfaces:**
- Consumes:
  - `useShopListings`·`useDeleteShopListing` (Task 12)
  - `SHOP_LISTING_STATUS_TABS`·`SHOP_LISTING_STATUS_LABELS`·`SHOP_LISTING_AUTHOR_LABELS`·`buildAdminListQuery` (Task 11)

- [ ] **Step 1: 상태와 쿼리**

`template/index.tsx` 에서 아래를 바꾼다.

import 추가:

```tsx
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SHOP_LISTING_AUTHOR_LABELS,
  SHOP_LISTING_STATUS_LABELS,
  SHOP_LISTING_STATUS_TABS,
  buildAdminListQuery,
} from '../lib/admin-listing-rules';
```

타입 import 를 `type AdminShopListingDto, type ShopListingAuthorType, type ShopListingStatus` 로 바꾸고 `ShopListingDto` 를 지운다.

컴포넌트 머리의 `useShopListings({ includeInactive: true })` 줄을 아래로 바꾼다:

```tsx
  const [tab, setTab] = useState<ShopListingStatus | 'all'>('pending');
  const [author, setAuthor] = useState<ShopListingAuthorType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const { data, isLoading } = useShopListings(buildAdminListQuery(tab, author, q));
```

`deleteTarget` 의 타입을 `AdminShopListingDto | null` 로 바꾼다. 탭·필터가 바뀌면 `setPage(1)` 한다(각 onChange 안에서 호출).

- [ ] **Step 2: 필터 줄**

헤더 `<div className="flex items-center justify-between">…</div>` 바로 아래에 추가한다. 머리 설명 문구는 「회원·관리자가 올린 가게 양도/양수 글을 검토하고 관리하는 곳이에요.」로 바꾼다.

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as ShopListingStatus | 'all');
            setPage(1);
          }}
        >
          <TabsList>
            {SHOP_LISTING_STATUS_TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Select
            value={author}
            onValueChange={(value) => {
              setAuthor(value as ShopListingAuthorType | 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">작성자 전체</SelectItem>
              <SelectItem value="member">회원</SelectItem>
              <SelectItem value="admin">관리자</SelectItem>
            </SelectContent>
          </Select>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQ(search);
              setPage(1);
            }}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="제목 검색 후 Enter"
              className="w-[200px]"
            />
          </form>
        </div>
      </div>
```

- [ ] **Step 3: 행과 빈 상태**

- 빈 상태 문구 「아직 올린 글이 없어요.」를 `{tab === 'pending' ? '검토할 글이 없어요.' : '조건에 맞는 글이 없어요.'}` 로 바꾸고, 「첫 글 쓰기」 버튼은 `tab === 'all'` 일 때만 보인다.
- `const thumbnailUrl = resolvePublicFileUrl(listing.thumbnailFileId);` 는 그대로 쓴다(필드가 남아 있다).
- 행의 배지 두 개(지역, `isActive`)를 아래로 바꾼다:

```tsx
                  <Badge variant={listing.status === 'pending' ? 'default' : 'secondary'}>
                    {SHOP_LISTING_STATUS_LABELS[listing.status]}
                  </Badge>
                  <Badge variant="outline">{SHOP_LISTING_AUTHOR_LABELS[listing.authorType]}</Badge>
                  {listing.region && (
                    <Badge variant="outline">{SHOP_LISTING_REGION_LABELS[listing.region]}</Badge>
                  )}
```

- 메타 줄의 날짜를 검토 대기일 때 제출일로 바꾼다:

```tsx
                  {listing.status === 'pending' && listing.submittedAt
                    ? `제출 ${new Date(listing.submittedAt).toLocaleString('ko-KR')}`
                    : new Date(listing.createdAt).toLocaleDateString('ko-KR')}{' '}
                  · 조회 {listing.viewCount.toLocaleString()} · /kr/shop-trade/{listing.slug}
```

- 「수정」 버튼 문구를 「열기」로 바꾼다. 상세가 검토 화면을 겸한다.

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/features/mall/shop-listings/template/index.tsx
git commit -m "feat(admin): 샵 매매 목록에 검토 대기 기본 탭과 작성자·제목 필터를 둔다"
```

---

### Task 14: admin-web 상세 — 판정 바·이력·마크다운 폼

**Files:**
- Create:
  - `apps/admin-web/src/features/mall/shop-listings/components/moderation-bar/index.tsx`
  - `apps/admin-web/src/features/mall/shop-listings/components/moderation-history/index.tsx`
- Modify:
  - `apps/admin-web/src/features/mall/shop-listings/template/editor.tsx`
  - `apps/admin-web/src/features/mall/shop-listings/components/shop-listing-form/index.tsx`(전체 교체)

**Interfaces:**
- Consumes:
  - Task 11 규칙 전부
  - Task 12 훅 전부
  - admin `ShopListingMarkdown` (Task 3)
- Produces:
  - `ModerationBar({ listing, onRefresh })`
  - `ModerationHistory({ items })`
  - `ShopListingForm({ listing?: AdminShopListingDetailDto })`

- [ ] **Step 1: 판정 바**

`moderation-bar/index.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  useApproveShopListing,
  useRejectShopListing,
  useShopListingTransition,
} from '@/lib/services/products';
import type { AdminShopListingDetailDto } from '@/lib/types/dto/products';
import {
  SHOP_LISTING_AUTHOR_LABELS,
  SHOP_LISTING_STATUS_LABELS,
  adminListingActions,
  isModerationConflict,
} from '../../lib/admin-listing-rules';

type Props = {
  listing: AdminShopListingDetailDto;
  onRefresh: () => void;
};

/** 선례: features/cs/business-licenses 상세의 승인·반려. 반려 사유는 서버가 요구하므로 비면 막는다. */
export function ModerationBar({ listing, onRefresh }: Props) {
  const approve = useApproveShopListing();
  const reject = useRejectShopListing();
  const hide = useShopListingTransition('hide');
  const unhide = useShopListingTransition('unhide');
  const close = useShopListingTransition('close');
  const reopen = useShopListingTransition('reopen');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const actions = adminListingActions(listing.status);
  const busy = [approve, reject, hide, unhide, close, reopen].some((m) => m.isPending);

  const handle = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      toast.success(done);
    } catch (error) {
      if (isModerationConflict(error)) {
        toast.error('그사이 회원이 글을 고쳤거나 상태가 바뀌었어요. 새로고침해서 바뀐 내용을 확인해 주세요.', {
          action: { label: '새로고침', onClick: onRefresh },
        });
        return;
      }
      toast.error(error instanceof Error ? error.message : '처리하지 못했어요.');
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge variant={listing.status === 'pending' ? 'default' : 'secondary'}>
              {SHOP_LISTING_STATUS_LABELS[listing.status]}
            </Badge>
            <Badge variant="outline">{SHOP_LISTING_AUTHOR_LABELS[listing.authorType]} 작성</Badge>
            {listing.submittedAt && (
              <span className="text-muted-foreground text-xs">
                제출 {new Date(listing.submittedAt).toLocaleString('ko-KR')}
              </span>
            )}
          </div>
          {listing.status === 'rejected' && listing.rejectReason && (
            <p className="text-muted-foreground text-sm">반려 사유: {listing.rejectReason}</p>
          )}
        </div>

        <div className="flex gap-2">
          {actions.includes('reject') && (
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => setRejectOpen(true)}>
              반려
            </Button>
          )}
          {actions.includes('approve') && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void handle(
                  () => approve.mutateAsync({ id: listing.id, expectedSubmittedAt: listing.submittedAt }),
                  '승인했어요. 1분 안에 쇼핑몰에 보여요.',
                )
              }
            >
              승인
            </Button>
          )}
          {actions.includes('hide') && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void handle(() => hide.mutateAsync(listing.id), '숨겼어요.')}>
              숨김
            </Button>
          )}
          {actions.includes('unhide') && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void handle(() => unhide.mutateAsync(listing.id), '다시 게시했어요.')}>
              숨김 해제
            </Button>
          )}
          {actions.includes('close') && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void handle(() => close.mutateAsync(listing.id), '거래완료로 바꿨어요.')}>
              거래완료
            </Button>
          )}
          {actions.includes('reopen') && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void handle(() => reopen.mutateAsync(listing.id), '다시 게시했어요.')}>
              재개
            </Button>
          )}
        </div>
      </CardContent>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>반려 처리</AlertDialogTitle>
            <AlertDialogDescription>
              반려 사유를 입력해 주세요. 회원의 「내 매물」 화면에 그대로 보여요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예) 매물과 관계없는 글이에요 / 사진에 연락처가 보여요"
            rows={4}
            maxLength={500}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim() || busy}
              onClick={() =>
                void handle(
                  () => reject.mutateAsync({ id: listing.id, reason: reason.trim(), expectedSubmittedAt: listing.submittedAt }),
                  '반려했어요.',
                ).then(() => setReason(''))
              }
            >
              반려 처리
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
```

- [ ] **Step 2: 판정 이력**

`moderation-history/index.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ShopListingModerationDto } from '@/lib/types/dto/products';
import { SHOP_LISTING_MODERATION_LABELS } from '../../lib/admin-listing-rules';

export function ModerationHistory({ items }: { items: ShopListingModerationDto[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">판정 이력</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">아직 판정한 적이 없어요.</p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium">{SHOP_LISTING_MODERATION_LABELS[item.decision]}</span>
                <span className="text-muted-foreground text-xs">
                  {item.decidedBy === 'classifier' ? '판정기' : `관리자 ${item.actorUserId ?? ''}`}
                </span>
                <span className="text-muted-foreground text-xs">{new Date(item.createdAt).toLocaleString('ko-KR')}</span>
                {item.reason && <p className="w-full text-sm">{item.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: 상세 템플릿**

`template/editor.tsx` 전체:

```tsx
'use client';

import { useShopListing } from '@/lib/services/products';
import { ModerationBar } from '../components/moderation-bar';
import { ModerationHistory } from '../components/moderation-history';
import { ShopListingForm } from '../components/shop-listing-form';

type Props = {
  id?: string;
};

export default function ShopListingEditorTemplate({ id }: Props) {
  const { data, isLoading, refetch } = useShopListing(id ?? '');

  if (id && isLoading) {
    return <p className="text-muted-foreground p-4 text-sm">불러오는 중…</p>;
  }

  if (id && !data) {
    return <p className="text-muted-foreground p-4 text-sm">글을 찾을 수 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {data && <ModerationBar listing={data} onRefresh={() => void refetch()} />}
      <ShopListingForm key={data?.id ?? 'new'} listing={data} />
      {data && <ModerationHistory items={data.moderations} />}
    </div>
  );
}
```

- [ ] **Step 4: 폼 전체 교체**

`components/shop-listing-form/index.tsx` 를 아래로 바꾼다.
- **빠지는 것:** tiptap 본문 접기·펼치기 장치(`RichTextEditor`, `useInViewport`, floating collapse, `createPortal`), `isActive` 스위치(상태는 판정 바가 다룬다).
- **유지하는 것:** dirty 경고, 필드 포커스, sticky 헤더, 레이아웃(2/3 + 1/3), `MoneyInput`, `ImageGalleryField`.
- **본문 배치:** 상품 상세설명 편집기처럼 넓을 때 좌우(편집 | 미리보기), 좁을 때 위아래다.

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SHOP_LISTING_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import { useCreateShopListing, useUpdateShopListing } from '@/lib/services/products';
import {
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_BUSINESS_TYPE_LABELS,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_DEAL_TYPE_LABELS,
  SHOP_LISTING_REGIONS,
  SHOP_LISTING_REGION_LABELS,
  type AdminShopListingDetailDto,
  type ShopListingBusinessType,
  type ShopListingDealType,
  type ShopListingRegion,
} from '@/lib/types/dto/products';
import { cn } from '@/lib/utils';
import {
  adminFormValuesFrom,
  buildAdminPayload,
  type AdminFormField,
  type AdminShopListingFormValues,
} from '../../lib/admin-listing-rules';
import { ImageGalleryField } from '../image-gallery-field';
import { MoneyInput } from '../money-input';
import { ShopListingMarkdown } from '../shop-listing-markdown';

type Props = {
  listing?: AdminShopListingDetailDto;
};

const invalidBox = 'rounded-md ring-2 ring-destructive ring-offset-2';

export function ShopListingForm({ listing }: Props) {
  const router = useRouter();
  const createMutation = useCreateShopListing();
  const updateMutation = useUpdateShopListing();
  const [values, setValues] = useState<AdminShopListingFormValues>(() => adminFormValuesFrom(listing));
  const [invalid, setInvalid] = useState<AdminFormField | null>(null);
  const fieldRefs = useRef<Partial<Record<AdminFormField, HTMLElement | null>>>({});

  const isPending = createMutation.isPending || updateMutation.isPending;
  const snapshot = useMemo(() => JSON.stringify(values), [values]);
  const initialSnapshot = useRef(snapshot);
  const savedRef = useRef(false);
  const isDirty = !savedRef.current && snapshot !== initialSnapshot.current;

  // 카페 글을 길게 붙여넣은 뒤 실수로 탭을 닫는 사고를 막는다
  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const set = <K extends keyof AdminShopListingFormValues>(key: K, value: AdminShopListingFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (invalid === key) setInvalid(null);
  };

  const bindRef = (field: AdminFormField) => (el: HTMLElement | null) => {
    fieldRefs.current[field] = el;
  };

  const leave = () => {
    if (isDirty && !window.confirm('저장하지 않은 내용이 있어요. 나갈까요?')) return;
    router.push('/mall/shop-listings');
  };

  const handleSave = async () => {
    const built = buildAdminPayload(values);
    if (!built.ok) {
      setInvalid(built.field);
      fieldRefs.current[built.field]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast.error(built.message);
      return;
    }
    setInvalid(null);

    try {
      if (listing) {
        await updateMutation.mutateAsync({ id: listing.id, payload: built.payload });
        toast.success('저장했습니다.');
      } else {
        await createMutation.mutateAsync(built.payload);
        toast.success('등록했습니다. 바로 쇼핑몰에 보여요.');
      }
      savedRef.current = true;
      router.push('/mall/shop-listings');
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-background border-border sticky top-14 z-20 flex items-center justify-between gap-3 border-b py-3 lg:top-16">
        <div className={cn('min-w-0', listing && 'min-h-[46px]')}>
          <h1 className="truncate text-xl font-bold">{listing ? '샵매매 글' : '샵매매 새 글'}</h1>
          {listing && isDirty && <p className="text-muted-foreground text-xs">저장하지 않은 변경사항이 있어요</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={leave} disabled={isPending}>
            취소
          </Button>
          <Button onClick={() => void handleSave()} disabled={isPending}>
            {listing ? '저장' : '등록'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <div className="grid gap-1.5" ref={bindRef('title')}>
                <Label htmlFor="title">
                  제목 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="title"
                  aria-invalid={invalid === 'title'}
                  value={values.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="예) 강남역 네일샵 양도합니다"
                />
              </div>

              <div className="grid gap-1.5" ref={bindRef('content')}>
                <Label>
                  내용 (마크다운) <span className="text-destructive">*</span>
                </Label>
                {/* 상품 상세설명 편집기와 같은 배치 — 넓을 땐 좌우, 좁을 땐 위아래 */}
                <div className={cn('grid gap-3 xl:grid-cols-2', invalid === 'content' && invalidBox)}>
                  <Textarea
                    value={values.content}
                    onChange={(e) => set('content', e.target.value)}
                    placeholder="본문을 마크다운으로 작성하세요. 줄바꿈은 그대로 보여요."
                    className="min-h-[420px] font-mono text-sm"
                  />
                  <div className="bg-muted/20 max-h-[600px] min-h-[420px] overflow-y-auto rounded-md border p-4">
                    <div className="text-muted-foreground mb-2 text-xs font-medium">미리보기</div>
                    {values.content.trim() ? (
                      <ShopListingMarkdown value={values.content} />
                    ) : (
                      <div className="text-muted-foreground py-6 text-center text-sm">작성한 내용이 여기에 보여요.</div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">거래 조건</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>거래 유형</Label>
                <Select value={values.dealType} onValueChange={(v) => set('dealType', v as ShopListingDealType)} disabled={isPending}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOP_LISTING_DEAL_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {SHOP_LISTING_DEAL_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MoneyInput id="areaPyeong" label="평수" value={values.areaPyeong} onChange={(v) => set('areaPyeong', v)} placeholder="15" unit="평" money={false} disabled={isPending} />
                <MoneyInput id="deposit" label="보증금" value={values.deposit} onChange={(v) => set('deposit', v)} placeholder="2000" unit="만원" disabled={isPending} />
                <MoneyInput id="monthlyRent" label="월세" value={values.monthlyRent} onChange={(v) => set('monthlyRent', v)} placeholder="120" unit="만원" disabled={isPending} />
                <MoneyInput id="keyMoney" label="권리금" value={values.keyMoney} onChange={(v) => set('keyMoney', v)} placeholder="3000" unit="만원" disabled={isPending} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">연락처</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5" ref={bindRef('contactPhone')}>
                <Label htmlFor="contactPhone">전화번호 (선택)</Label>
                <Input
                  id="contactPhone"
                  inputMode="tel"
                  aria-invalid={invalid === 'contactPhone'}
                  value={values.contactPhone}
                  onChange={(e) => set('contactPhone', e.target.value)}
                  placeholder="010-1234-5678"
                />
                <p className="text-muted-foreground text-xs">쇼핑몰에서는 로그인한 회원에게만 보여요.</p>
              </div>
              <div className="grid gap-1.5" ref={bindRef('kakaoOpenChatUrl')}>
                <Label htmlFor="kakaoOpenChatUrl">카카오 오픈채팅 (선택)</Label>
                <Input
                  id="kakaoOpenChatUrl"
                  inputMode="url"
                  aria-invalid={invalid === 'kakaoOpenChatUrl'}
                  value={values.kakaoOpenChatUrl}
                  onChange={(e) => set('kakaoOpenChatUrl', e.target.value)}
                  placeholder="https://open.kakao.com/o/…"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">분류</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div ref={bindRef('region')} className="grid gap-1.5">
                <Label>
                  지역 <span className="text-destructive">*</span>
                </Label>
                <Select value={values.region} onValueChange={(v) => set('region', v as ShopListingRegion)} disabled={isPending}>
                  <SelectTrigger aria-invalid={invalid === 'region'}>
                    <SelectValue placeholder="지역 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOP_LISTING_REGIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {SHOP_LISTING_REGION_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div ref={bindRef('businessType')} className="grid gap-1.5">
                <Label>
                  업종 <span className="text-destructive">*</span>
                </Label>
                <Select value={values.businessType} onValueChange={(v) => set('businessType', v as ShopListingBusinessType)} disabled={isPending}>
                  <SelectTrigger aria-invalid={invalid === 'businessType'}>
                    <SelectValue placeholder="업종 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOP_LISTING_BUSINESS_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {SHOP_LISTING_BUSINESS_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div ref={bindRef('imageFileIds')} className={cn(invalid === 'imageFileIds' && invalidBox)}>
                <ImageGalleryField
                  value={values.imageFileIds}
                  onChange={(next) => set('imageFileIds', next)}
                  contextId={SHOP_LISTING_IMAGE_CONTEXT_ID}
                  disabled={isPending}
                />
              </div>
            </CardContent>
          </Card>

          {listing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">인터넷 주소</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground font-mono text-xs break-all">/kr/shop-trade/{listing.slug}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
```

(Select `onValueChange` 의 `as ShopListingRegion` 등은 기존 폼에도 있던 캐스팅이다. shadcn Select 가 `string` 만 주기 때문이다.)

- [ ] **Step 5: 남은 참조 정리와 admin tsc**

```bash
grep -rn "ShopListingDto\b\|CreateShopListingDto\|UpdateShopListingDto\|ShopListingListQuery\b\|isActive" apps/admin-web/src/features/mall/shop-listings apps/admin-web/src/lib/services/products apps/admin-web/src/lib/api/domains/products
cd apps/admin-web && npx tsc --noEmit; cd ../..
```

Expected: grep 결과 없음, tsc 에러 0. 남은 참조가 있으면 Task 11 의 새 타입으로 옮긴다.

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/mall/shop-listings
git commit -m "feat(admin): 샵 매매 상세에 승인·반려·숨김 판정 바와 이력을 두고 본문을 마크다운으로 편집한다"
```

---

### Task 15: 전체 검증과 수동 스모크

**Files:** 없음(검증만). 발견한 결함은 해당 태스크 파일을 고치고 별도 커밋한다.

- [ ] **Step 1: CI 게이트 둘**

```bash
npm run type-check
npx jest --maxWorkers=2 2>&1 | tail -5
```

Expected: type-check 에러 0, jest 실패 0. 개수는 `tail` 로 자른 출력에서 세지 않는다 — `Tests:` 줄을 본다.

- [ ] **Step 2: CI 밖 게이트**

```bash
cd web/almondyoung-storefront && npx vitest run && npx tsc --noEmit 2>&1 | grep -E "shop-trade|shop-listing|mypage-constants|sitemap" ; echo "filtered-exit=$?"; cd ../..
cd apps/admin-web && npx tsc --noEmit && NEXT_DIST_DIR=.next-local npx next build && rm -rf .next-local; cd ../..
cd web/almondyoung-storefront && NEXT_DIST_DIR=.next-local npx next build && rm -rf .next-local; cd ../..
```

Expected: vitest 전부 PASS, 스토어프론트 필터 결과 없음, admin tsc 0, 두 빌드 성공. 스토어프론트 tsc 전체 에러 수는 Task 4 Step 1 기준선보다 늘지 않았는지도 본다.

- [ ] **Step 3: 로컬 E2E 환경에서 수동 스모크 (spec §11.4)**

```bash
npm run bootstrap:e2e:local
npm run start:all:local
npm run preflight:e2e:local
```

로컬 ugc DB 에 이관 글이 필요하면 런북 §2 의 복사 스크립트를 로컬 두 URL 로 돌린다(`CORE_DATABASE_URL`·`UGC_DATABASE_URL`).

spec §11.4 의 10항목을 하나씩 확인하고 결과를 PR 본문에 표로 적는다:
1. 회원 작성 → 내 매물에 「검토 대기」 → 공개 목록에 없음
2. 관리자 승인 → 60초 안에 공개 목록·상세 노출
3. 관리자 반려(사유) → 내 매물에 사유 → 수정 재제출 → 「검토 대기」
4. 승인된 글 회원 수정 → 재검토 안내 모달 → 공개 목록에서 빠짐, slug 불변
5. 거래완료 → 카드·상세 배지, 재개 → 배지 제거
6. 동시 게시 한도 4건째 → 서버 문구 토스트
7. 연락처 보기: 비로그인 → 로그인 → 돌아와서 다시 누르면 번호·오픈채팅
8. 관리자 작성 → 바로 공개. 관리자 숨김 → 내 매물에 「숨김」·수정 버튼 없음·삭제 가능
9. 본문 `<script>`·`![](…)`·`[x](javascript:…)` → 글자로 보이거나 렌더되지 않음
10. 이관 글: 옛 slug URL, 조회수 유지, `/sitemap.xml` 에 포함

**추가로 확인할 것:**
- 관리자가 **회원 글**을 열어 본문만 고쳐 저장한 뒤에도 연락처가 남아 있다(PUT 전체 교체 계약).
- 승인 버튼을 누르기 직전 다른 탭에서 회원이 그 글을 고치면, 승인 시 「새로고침」 토스트가 뜬다.
- 모바일 폭(375px)에서 작성 폼·내 매물·상세 「연락처 보기」가 가로 스크롤 없이 보인다.

- [ ] **Step 4: PR 초안 — push 전에 사람에게 확인받는다**

PR 본문에 넣을 것:
- 무엇이 바뀌나(스토어프론트·admin-web·패키지)
- 검증 결과(Step 1~3)
- **배포 절차는 런북 §2~§3 을 따른다**:
  - 쓰기 동결 → 복사 드라이런 → `--apply` → 머지 → 배포 직전 `--apply` 재실행
  - `npm ci` 세 트리 → `sst deploy`
  - 라이브 작업이라 단계마다 확인받는다
- 알고 두는 한계:
  - 관리자 PUT 에는 CAS 가 없다. 관리자가 폼을 연 채로 회원이 수정하면 관리자 저장이 회원 수정을 덮는다. 승인·반려와 달리 서버 계약에 `expectedSubmittedAt` 이 없다.
  - 후속 이슈 후보로 적는다.

---

## Self-Review 메모 (작성자 확인 완료)

- **spec 커버리지:**

  | spec 항목 | 태스크 |
  |---|---|
  | §8.1 API 전환 | 4 |
  | §8.1 렌더 | 2 |
  | §8.1 연락처 보기 | 8 |
  | §8.1 거래완료 배지 | 4 |
  | §8.1 등록 진입점 | 9 |
  | §8.1 회원 화면 | 9, 10 |
  | §8.1 메뉴 | 9 |
  | §8.1 순수 로직 | 5, 6, 7 |
  | §8.2 컨텍스트 | 10(스토어프론트), 12(admin) |
  | §8.3 클라이언트·타입 | 11, 12 |
  | §8.3 목록 | 13 |
  | §8.3 상세·폼 | 14 |
  | §8.4 패키지 | 1 |
  | §8.4 배선 | 2, 3 |
  | §8.5 디자인 | 8, 9, 10 |
  | §11.4 | 1, 2, 3, 11, 15 |
  | 런북 배포 명령 | 2 |

- **타입 일관성:**
  - `imageFileIds` 는 전 구간에서 같은 이름이다.
  - admin 은 `AdminShopListingPayload`/`buildAdminPayload`, 스토어프론트는 `MemberShopListingPayload`/`buildMemberPayload` 다.
  - 뮤테이션 인자는 `{ id, payload }` 로 Task 12 와 14 가 같다.
