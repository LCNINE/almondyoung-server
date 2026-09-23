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
