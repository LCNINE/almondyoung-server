import DOMPurify from "isomorphic-dompurify"

// 공지 본문은 어드민 Tiptap 에디터가 생성한 HTML 이다. 어드민이 신뢰 주체이긴 하나
// 계정 탈취/내부자 리스크에 대비해 렌더 시점에 sanitize 한다.
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

const ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "title", "width", "height"]

// 외부 링크에 rel/target 강제 (모듈 로드 시 1회 등록 — DOMPurify 싱글톤)
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank")
    node.setAttribute("rel", "noopener noreferrer")
  }
})

/**
 * 공지 본문 HTML 을 안전하게 정제한다.
 * javascript:/vbscript: 등 위험 스킴은 DOMPurify 기본값이 차단한다.
 */
export function sanitizeNoticeHtml(html: string): string {
  // ALLOWED_URI_REGEXP 는 지정하지 않는다 — 커스텀 정규식을 주면 DOMPurify 가 width 같은
  // 비-URI 숫자 속성값까지 검사해 제거한다(width 가 사라지는 원인).
  // DOMPurify 기본값이 이미 javascript:/vbscript: 등 위험 스킴을 차단한다.
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  })
}
