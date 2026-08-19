import sanitize from "sanitize-html"

// 공지 본문은 어드민 Tiptap 에디터가 생성한 HTML 이다. 어드민이 신뢰 주체이긴 하나
// 계정 탈취/내부자 리스크에 대비해 렌더 시점에 sanitize 한다.
//
// DOMPurify(isomorphic-dompurify) 는 서버에서 jsdom 을 요구하는데, jsdom 의 하위 의존성이
// ESM 으로 올라갈 때마다 Lambda(CJS) 런타임이 ERR_REQUIRE_ESM 으로 죽는다. sanitize-html 은
// htmlparser2 기반이라 DOM 구현이 필요 없다.
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "blockquote",
  "code",
  "pre",
  "span",
]

const ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "src",
  "alt",
  "title",
  "width",
  "height",
]

/**
 * 공지 본문 HTML 을 안전하게 정제한다.
 * javascript:/vbscript: 등 위험 스킴은 allowedSchemes 화이트리스트가 차단한다.
 */
export function sanitizeNoticeHtml(html: string): string {
  return sanitize(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { "*": ALLOWED_ATTR },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    // 외부 링크에 rel/target 강제
    transformTags: {
      a: sanitize.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer",
      }),
    },
  })
}
