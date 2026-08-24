import sanitize from "sanitize-html"

const MAX_LENGTH = 155
const BLOCK_BOUNDARY = /<\/(p|div|h[1-6]|li|tr|td|section|article)>|<br\s*\/?>/gi

// 상세 HTML 은 어드민 에디터/cafe24 이관본이라 마크업·공백이 뒤섞여 있다.
export function toMetaDescription(
  html: string | null | undefined
): string | undefined {
  if (!html) return undefined

  const text = sanitize(html.replace(BLOCK_BOUNDARY, " "), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!text) return undefined

  return text.length <= MAX_LENGTH
    ? text
    : `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…`
}
