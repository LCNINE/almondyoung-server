import DOMPurify from 'isomorphic-dompurify';

// 공지 본문 HTML 을 안전하게 정제한다. 어드민 보기 화면에서도 dangerouslySetInnerHTML 을
// 쓰므로 멀티 관리자 환경의 stored XSS 에 대비해 sanitize 한다. (storefront 와 동일 정책)
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'blockquote',
  'code',
  'pre',
  'span',
];

const ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'src',
  'alt',
  'title',
  'width',
  'height',
];

// 외부 링크에 rel/target 강제 (모듈 로드 시 1회 등록 — DOMPurify 싱글톤)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function sanitizeNoticeHtml(html: string): string {
  // ALLOWED_URI_REGEXP 는 지정하지 않는다 — 커스텀 정규식을 주면 DOMPurify 가 width 같은
  // 비-URI 숫자 속성값까지 그 정규식으로 검사해 제거한다(width="154" 가 사라지는 원인).
  // DOMPurify 기본값이 이미 javascript:/vbscript: 등 위험 스킴을 차단한다.
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });
}
